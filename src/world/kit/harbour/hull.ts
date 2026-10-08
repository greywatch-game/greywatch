/**
 * kit/harbour/hull.ts — buildCareenedHull: a clinker-built open fishing boat
 * hauled up on the hard, chocked on cribbing and held upright by four shores,
 * her after half under a tarpaulin. Part of the volcanic-coast set: follows
 * the contract in kit/core.ts and the set's rules in `./index.ts`.
 * Invariants: the seven colliders are the ones the boxes-and-posts hull
 * declared, byte for byte and in the same order; everything after them is
 * drawing; what varies is seeded off where she stands (`streetSeed`), never
 * `Math.random()`. Never imports another builder.
 */
import { Scene, VertexData } from "@babylonjs/core";
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import { mulberry32 } from "../../rng";
import {
  Build,
  type BuildCtx,
  type BuildParams,
  type Point3,
  type Structure,
  type V3,
  StoneBatch,
  STENCIL,
  limb,
  streetSeed,
  BASALT,
  PITCH,
  PLANK,
  SAILCLOTH,
  TEAK,
  TIMBER,
} from "../core";
import { bar } from "./shared";

/** Strakes a side, garboard to sheer. */
const STRAKES = 7;

/**
 * The midship section, one `(x, y)` per land from the keel's rabbet to the
 * sheer: flat floors, a firm bilge at the waterline and topsides that flare a
 * little to the gunwale. It is beamy on purpose — a beach boat that has to sit
 * upright on her own bottom is — and it is what puts the bilge where the
 * shores' heads bear on it.
 */
const MIDSHIP: readonly (readonly [number, number])[] = [
  [0.08, 0.92],
  [0.5, 1.0],
  [0.92, 1.14],
  [1.24, 1.36],
  [1.45, 1.66],
  [1.56, 1.98],
  [1.61, 2.36],
  [1.63, 2.78],
];

/** Half the stem's width where the plank ends land on it. */
const STEM_HALF = 0.05;
/**
 * How far a strake's lower edge stands out over the one under it. Twice a
 * real plank, because the lap is the line the ink draws and 2 cm is not one.
 */
const LAP = 0.045;
/** The planking's thickness: the inner skin is this far inside the outer. */
const SKIN = 0.05;
/** The bottom boards, laid over the ballast. */
const FLOOR = 1.62;
/** The thwarts' top face. */
const THWART = 2.4;
/** The yard the tarpaulin is ridged over, lowered and lying fore and aft. */
const YARD = 3.31;
/** How many stations along the length every line is drawn through. */
const STATIONS = 26;

const add = (a: Point3, b: Point3, s = 1): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const sub = (a: Point3, b: Point3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Point3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: Point3, b: Point3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Point3, b: Point3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: Point3): V3 => scale(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));
const lerp = (a: Point3, b: Point3, t: number): V3 => add(a, sub(b, a), t);
/** A point on the starboard (+x) side carried to side `sx`. */
const onSide = (p: Point3, sx: number): V3 => [p[0] * sx, p[1], p[2]];

/**
 * Smooth surfaces in a flat colour, one surface per colour — `StoneBatch` for
 * things that are not boxes. A GRID is rows of points walked in step, and its
 * normals are shared inside it and nowhere else: a strake is smooth along its
 * length and meets the next one at a crease, which is what clinker is.
 *
 * The winding is decided ONCE per grid, off its middle quad against a hint,
 * the way `Mesher` decides it per triangle — so a grid can be walked in
 * whatever order is convenient, and the mirrored side comes out right.
 */
class Skin {
  private readonly sets = new Map<string, { pos: number[]; nrm: number[]; idx: number[] }>();

  /**
   * `across` decides how the normals are shared: `"smooth"` over the whole
   * grid (a tarpaulin, the inner skin), `"column"` one per column (a strake, a
   * rail). **The cel shader lights a triangle by its own FACET** and reads the
   * vertex normal only for which way that faces, so these are for the bakes
   * that read it (occlusion, wear) — what makes a band SHADE flat is a flat
   * quad, which is `Lines.rule`'s job and not this one's.
   */
  grid(rows: readonly (readonly Point3[])[], color: string, hint: Point3, across: "smooth" | "column" = "column"): void {
    let set = this.sets.get(color);
    if (!set) this.sets.set(color, (set = { pos: [], nrm: [], idx: [] }));
    const nr = rows.length;
    const nc = rows[0].length;
    const base = set.pos.length / 3;
    const r = Math.floor((nr - 1) / 2);
    const c = Math.floor((nc - 1) / 2);
    // Babylon's face normal is (v1 - v2) x (v3 - v2); `Mesher.tri` keeps the
    // order when that points along the hint.
    const face = (i: number, j: number): V3 => cross(sub(rows[i][j], rows[i][j + 1]), sub(rows[i + 1][j + 1], rows[i][j + 1]));
    const flip = dot(face(r, c), hint) < 0;
    const sum: V3[] = [];
    for (let k = 0; k < nr * nc; k++) sum.push([0, 0, 0]);
    for (let i = 0; i + 1 < nr; i++) {
      for (let j = 0; j + 1 < nc; j++) {
        const f = scale(face(i, j), flip ? -1 : 1);
        for (const k of [i * nc + j, i * nc + j + 1, (i + 1) * nc + j, (i + 1) * nc + j + 1]) sum[k] = add(sum[k], f);
        const p00 = base + i * nc + j;
        const p01 = p00 + 1;
        const p10 = p00 + nc;
        const p11 = p10 + 1;
        if (flip) set.idx.push(p00, p11, p01, p00, p10, p11);
        else set.idx.push(p00, p01, p11, p00, p11, p10);
      }
    }
    if (across === "column") {
      for (let j = 0; j < nc; j++) {
        let col: V3 = [0, 0, 0];
        for (let i = 0; i < nr; i++) col = add(col, sum[i * nc + j]);
        for (let i = 0; i < nr; i++) sum[i * nc + j] = col;
      }
    }
    for (let i = 0; i < nr; i++) {
      for (let j = 0; j < nc; j++) {
        const p = rows[i][j];
        const n = unit(sum[i * nc + j]);
        set.pos.push(p[0], p[1], p[2]);
        set.nrm.push(n[0], n[1], n[2]);
      }
    }
  }

  /**
   * A box from its centre and three HALF-axes, which need not be square to
   * the structure — a letter painted on a curved bow. `back` leaves out the
   * face along `-n`, the one turned to whatever it is laid on.
   */
  plate(c: Point3, u: Point3, v: Point3, n: Point3, color: string, back = true): void {
    for (const [ax, p, q] of [
      [u, v, n],
      [v, n, u],
      [n, u, v],
    ] as const) {
      for (const sg of [1, -1]) {
        if (!back && ax === n && sg < 0) continue;
        const f = add(c, ax, sg);
        this.grid(
          [
            [add(add(f, p, -1), q, -1), add(add(f, p, 1), q, -1)],
            [add(add(f, p, -1), q, 1), add(add(f, p, 1), q, 1)],
          ],
          color,
          scale(ax, sg),
        );
      }
    }
  }

  /**
   * A rectangular section `2 hw` across and `2 hh` up, swept along `path`
   * with its own `across` and `up` at every point: a gunwale, a stem.
   */
  sweep(path: readonly Point3[], across: readonly Point3[], up: readonly Point3[], hw: number, hh: number, color: string): void {
    const corner = (sa: number, su: number): V3[] => path.map((p, i) => add(add(p, across[i], sa * hw), up[i], su * hh));
    const lo0 = corner(-1, -1);
    const lo1 = corner(1, -1);
    const hi1 = corner(1, 1);
    const hi0 = corner(-1, 1);
    const m = Math.floor(path.length / 2);
    this.grid([lo0, lo1], color, scale(up[m], -1));
    this.grid([lo1, hi1], color, across[m]);
    this.grid([hi1, hi0], color, up[m]);
    this.grid([hi0, lo0], color, scale(across[m], -1));
  }

  flush(b: Build): void {
    for (const [color, set] of this.sets) {
      const data = new VertexData();
      data.positions = set.pos;
      data.indices = set.idx;
      const uvs: number[] = [];
      for (let i = 0; i < set.pos.length; i += 3) uvs.push(set.pos[i], set.pos[i + 2]);
      data.uvs = uvs;
      data.normals = set.nrm;
      b.surface(data, color);
    }
    this.sets.clear();
  }
}

/**
 * The hull's lines, on the starboard (+x) side: each LAND (a strake's edge)
 * as a curve from the stem to the sternpost, parametrised by `u` in [-1, 1]
 * so that every land is drawn through the same stations and the strakes
 * between them are quads.
 *
 * At `u = 0` a land is at its `MIDSHIP` point. Toward either end it rises
 * (the sheer, and the rocker of the lower lands) and draws in (`1 - a^p`,
 * finer below than above, so the entry is sharp at the forefoot and full at
 * the gunwale), and at `u = ±1` it lands on the stem's rabbet — the lower
 * lands on the forefoot, the upper ones up the stem — which is where a
 * double-ender's planks end.
 */
interface Lines {
  /** How far along each land runs before it lands on the stem. */
  ends: readonly (readonly [number, number])[];
  /** The stem's rabbet at `s` (0 at the forefoot, 1 at the sheer), as `(z, y)` on the +z end. */
  stem(s: number): [number, number];
  land(k: number, u: number): V3;
  /** The outward normal of the section at land `k`, in the x-y plane. */
  normal(k: number, u: number): V3;
  /** Land `k` where it crosses `z`, or null if it has landed on the stem short of it. */
  at(k: number, z: number): V3 | null;
  /** The outside of the planking's half-breadth at `(z, y)`. */
  half(z: number, y: number): number;
  /** Land `k` at `z`, carried on up the stem's rabbet past where it ends. */
  edge(k: number, z: number): V3;
  /**
   * Where on land `k + 1` the plank laid from land `k` at station `u` is
   * RULED to — the `u` there whose tangent, this one's and the line between
   * them lie in one plane. A plank is a developable sheet bent onto the
   * frames, so ruled this way a strake's quads come out FLAT; ruled by equal
   * `u` they were twisted up to 30 degrees at the ends, and the cel shader,
   * which lights a triangle by its own facet, drew each one's two halves as a
   * pair of triangles.
   */
  rule(k: number, u: number): number;
}

function hullLines(len: number): Lines {
  const lh = len / 2;
  // The forefoot starts this far in from the collider's ends, and the stem's
  // rabbet reaches just past them at the sheer.
  const z0 = lh - 1.25;
  const z1 = lh + 0.12;
  const y0 = MIDSHIP[0][1];
  const y1 = 3.12;
  const stem = (s: number): [number, number] =>
    s < 0 ? [z0 + s, y0] : [z0 + ((z1 - z0) * (2 * s - 0.6 * s * s)) / 1.4, y0 + (y1 - y0) * Math.pow(s, 1.5)];
  const ends = MIDSHIP.map((_, k) => stem(k === 0 ? 0 : Math.pow(k / STRAKES, 0.85)));
  const land = (k: number, u: number): V3 => {
    const a = Math.min(1, Math.abs(u));
    const [ze, ye] = ends[k];
    const [xm, ym] = MIDSHIP[k];
    const f = 1 - Math.pow(a, 2 + (1.6 * k) / STRAKES);
    return [STEM_HALF + (xm - STEM_HALF) * f, ym + (ye - ym) * Math.pow(a, 1.8), (u < 0 ? -a : a) * ze];
  };
  const normal = (k: number, u: number): V3 => {
    const p = land(Math.max(0, k - 1), u);
    const q = land(Math.min(STRAKES, k + 1), u);
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const l = Math.hypot(dx, dy) || 1;
    return [dy / l, -dx / l, 0];
  };
  const at = (k: number, z: number): V3 | null => (Math.abs(z) > ends[k][0] ? null : land(k, z / ends[k][0]));
  const half = (z: number, y: number): number => {
    let prev: V3 | null = null;
    for (let k = 0; k <= STRAKES; k++) {
      const p = at(k, z);
      if (!p) continue;
      if (p[1] >= y) {
        if (!prev) return STEM_HALF;
        return prev[0] + ((p[0] - prev[0]) * (y - prev[1])) / (p[1] - prev[1]);
      }
      prev = p;
    }
    return prev ? prev[0] : STEM_HALF;
  };
  const edge = (k: number, z: number): V3 => {
    if (Math.abs(z) <= ends[k][0]) return land(k, z / ends[k][0]);
    // Up the rabbet to the `s` whose z this is.
    let a = 0;
    let c = 1;
    for (let i = 0; i < 30; i++) {
      const m = (a + c) / 2;
      if (stem(m)[0] < Math.abs(z)) a = m;
      else c = m;
    }
    return [STEM_HALF, stem((a + c) / 2)[1], z];
  };
  const tangent = (k: number, u: number): V3 => unit(sub(land(k, Math.min(1, u + 0.002)), land(k, Math.max(-1, u - 0.002))));
  const rule = (k: number, u: number): number => {
    if (Math.abs(u) >= 1) return u;
    const p = land(k, u);
    const tp = tangent(k, u);
    const f = (v: number): number => {
      const q = land(k + 1, v);
      return dot(cross(tp, tangent(k + 1, v)), sub(q, p));
    };
    // The root nearest the station's own `u`, which is where it started.
    let best = u;
    let near = Infinity;
    const steps = 60;
    let v0 = Math.max(-0.999, u - 0.3);
    let f0 = f(v0);
    for (let i = 1; i <= steps; i++) {
      const v1 = Math.min(0.999, u - 0.3 + (0.6 * i) / steps);
      const f1 = f(v1);
      if (f0 * f1 <= 0) {
        let a = v0;
        let c = v1;
        let fa = f0;
        for (let j = 0; j < 24; j++) {
          const m = (a + c) / 2;
          const fm = f(m);
          if (fa * fm <= 0) c = m;
          else {
            a = m;
            fa = fm;
          }
        }
        const r = (a + c) / 2;
        if (Math.abs(r - u) < near) {
          near = Math.abs(r - u);
          best = r;
        }
      }
      v0 = v1;
      f0 = f1;
    }
    return best;
  };
  return { ends, stem, land, normal, at, half, edge, rule };
}

/**
 * The lap at station `u`, run out to almost nothing at the ends: a clinker
 * plank is rebated flush where it lands on the stem (the gain), which is also
 * what lets every strake end in the stem's side rather than stand off it.
 */
const lapAt = (u: number): number => LAP * Math.max(0.08, 1 - Math.pow(Math.abs(u), 8));

/** The port letters a boat may be registered under: only letters `STENCIL` draws. */
const PORTS = ["LH", "CH", "PD", "FR", "SH"] as const;

/**
 * A CAREENED HULL: a clinker-built open fishing boat up on the hard, chocked
 * on cribbing under her keel with four shores holding her upright and a
 * tarpaulin over her after half.
 *
 * **There is no boat in this game and this is not waiting to be one.** It
 * answers a question every waterfront on this map raised and none of them
 * answered: eleven boat sheds, eight jetties, three slipways, and nothing
 * anywhere that had ever been in the water. A hull on the hard is what a
 * fishing town looks like between tides, and it is the piece that makes the
 * jetties read as jetties rather than as decking.
 *
 * It is also the only real hard cover on an open strand — 2.9 m, over
 * `CONFIG.bots.cover.hardHeight`, so it stops a round at a body standing up —
 * which is why the collider is one honest box from the ground to the sheer
 * rather than a shell you could shoot underneath. The shores are struts, so
 * a round that hits one stops on it.
 *
 * **What she is drawn as is a northern double-ender**, the open boat a lava
 * island with no timber of its own would buy in and keep tarred: seven lapped
 * strakes a side on a keel, stem and sternpost (`hullLines`), every lap a
 * step the ink finds and run out flush at the ends; tarred to the waterline
 * with a pale boot-top band; ribs, risers, thwarts and bottom boards inside,
 * a short foredeck with a bulkhead and a cuddy door under it and stern sheets
 * abaft the tarpaulin, the mast
 * stepped through the forward thwart with its yard lowered and the sail
 * furled on it, and that yard the ridge the tarpaulin is thrown over, lashed
 * down at the hem and closed at both ends, on a crutch at the stern. Her port
 * letters and number are painted up the bow.
 *
 * **The colliders are the old hull's, byte for byte and in the same order**,
 * restated at the top as `block`s: the cribbing under each end of the keel,
 * each followed by its two shores — which are `rayOnly` posts standing
 * UPRIGHT at `x = ±2.15`, because `strut` carries its rotation's X and Y onto
 * the collider and never its Z — and the hull. Everything drawn obeys one of
 * the three rules: the hull and its cribbing are inside their boxes, the
 * clutter round her is under 0.3 m, and what stands above 2.9 m (the stem
 * heads, the tarpaulin's ridge, the mast) stands on the box.
 *
 * Seeded off where she stands: whether her topsides are tarred or oiled,
 * where the tarpaulin begins, how many oars lie in her, her registration, and
 * what lies on the hard beside her — so it is in `CONFORMS_TO_TERRAIN`, and
 * it carries the cribbing's footings, the shores' soles and that clutter down
 * to the ground under each.
 */
export function buildCareenedHull(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "hull");
  const len = p.length ?? 11;

  // --- The colliders, exactly as the boxes-and-posts hull declared them:
  // each end's cribbing (a `wall`) then its two shores (`strut`s, which put
  // no Z rotation on the box), then the hull.
  for (const sz of [-1, 1] as const) {
    b.block({ w: 1.3, h: 0.7, d: 1.1, x: 0, y: 0.35, z: sz * len * 0.25 });
    for (const sx of [-1, 1] as const) {
      b.block({ w: 0.26, h: 2.2, d: 0.26, x: sx * 2.15, y: 0.85, z: sz * len * 0.28, rayOnly: true });
    }
  }
  b.block({ w: 3.3, h: 2.9, d: len, x: 0, y: 1.45, z: 0 });

  // --- Everything below is drawing.
  const rnd = mulberry32(streetSeed(len, 3.3, 2.9, ctx));
  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };

  const lh = len / 2;
  const L = hullLines(len);
  const zeOf = (k: number): number => L.ends[k][0];
  const sheerAt = (z: number): V3 => L.at(STRAKES, z) ?? L.land(STRAKES, Math.sign(z));

  // Tarred to the waterline and either tarred or oiled above it.
  const oiled = rnd() < 0.5;
  const topside = oiled ? TEAK : PITCH;
  const strakeColor = (k: number): string => (k >= 4 ? topside : PITCH);
  /** The strake the boot-top band is painted along the foot of. */
  const BAND = 4;
  // The plan of her inside: a foredeck forward, an open waist, the tarpaulin
  // over the after part from wherever it was thrown to the crutch.
  const zf = -0.62 * lh;
  const zm = -0.12 * len;
  const zt0 = (0.02 + rnd() * 0.2) * lh;
  const zt1 = 0.78 * lh;
  const zc = 0.84 * lh;

  const stations: number[] = [];
  for (let i = 0; i <= STATIONS; i++) stations.push(Math.sin(((2 * i) / STATIONS - 1) * (Math.PI / 2)));

  const outer = new Skin();
  const sb = new StoneBatch();
  const inner = new Skin();

  // --- The tarpaulin, first, because it hides most of what is under it.
  {
    const steps = Math.max(6, Math.round((zt1 - zt0) / 0.15));
    const lash0 = zt0 + 0.45;
    const rows: V3[][] = [];
    const across = (z: number): V3[] => {
      const g = sheerAt(z);
      const gun: V3 = [g[0] + 0.13, g[1] + 0.1, z];
      const drop = 0.28 - 0.035 * Math.cos((2 * Math.PI * (z - lash0)) / 0.9);
      const hem: V3 = [g[0] + 0.17, g[1] - drop, z];
      const slope: V3[] = [0.25, 0.5, 0.75].map((t): V3 => [gun[0] * (1 - t), gun[1] + (YARD + 0.07 - gun[1]) * t - 0.07 * Math.sin(Math.PI * t), z]);
      const right = [hem, gun, ...slope];
      return [...right, [0, YARD + 0.07, z], ...right.reverse().map((q) => onSide(q, -1))];
    };
    for (let i = 0; i <= steps; i++) rows.push(across(zt0 + ((zt1 - zt0) * i) / steps));
    outer.grid(rows, SAILCLOTH, [0, 1, 0], "smooth");
    outer.grid(rows, SAILCLOTH, [0, -1, 0], "smooth");
    // Each end folded down to the gunwale.
    for (const [z, e] of [
      [zt0, -1],
      [zt1, 1],
    ] as const) {
      const edge = across(z + e * 0.02).slice(1, -1);
      const base = edge.map((q): V3 => [q[0], edge[0][1], q[2]]);
      outer.grid([edge, base], SAILCLOTH, [0, 0, e]);
      outer.grid([edge, base], SAILCLOTH, [0, 0, -e]);
    }
    // Lashings from the hem down under the rubbing strake.
    for (let z = lash0; z < zt1 - 0.1; z += 0.9) {
      const g = sheerAt(z);
      for (const sx of [-1, 1]) {
        const y = g[1] - 0.55;
        bar(sb, onSide([g[0] + 0.17, g[1] - 0.2, z], sx), onSide([L.half(z, y) + 0.03, y, z], sx), 0.035, 0.035, PITCH);
      }
    }
  }

  // --- The gunwale: a capping rail over the sheer and a rubbing strake under
  // it, swept along the sheer with the stem's head covering their ends.
  for (const sx of [-1, 1]) {
    const us = stations.filter((u) => Math.abs(u) < 0.96);
    us.unshift(-0.96);
    us.push(0.96);
    const path: V3[] = [];
    const out: V3[] = [];
    const up: V3[] = [];
    for (const u of us) {
      const p = L.land(STRAKES, u);
      const t = sub(L.land(STRAKES, u + 0.01), L.land(STRAKES, u - 0.01));
      path.push(onSide(p, sx));
      out.push(onSide(unit([t[2], 0, -t[0]]), sx));
      up.push([0, 1, 0]);
    }
    outer.sweep(path.map((p, i) => add(add(p, out[i], 0.02), up[i], 0.05)), out, up, 0.1, 0.035, TEAK);
    outer.sweep(path.map((p, i) => add(add(p, out[i], 0.045), up[i], -0.065)), out, up, 0.045, 0.065, oiled ? SAILCLOTH : PITCH);
  }

  // --- The planking: each strake a band from its lap to under the next one,
  // and the lap's own edge, which faces down and is the line. Strakes are
  // ruled across by `Lines.rule`; the garboard cannot be, its lower edge
  // being the keel's straight rabbet, so it is ruled at equal z instead —
  // its hood end running on up the stem — and drawn in three rows, which
  // takes its twist down to a third.
  for (const sx of [-1, 1]) {
    for (let k = 0; k < STRAKES; k++) {
      const lo: V3[] = [];
      const hi: V3[] = [];
      const seam: V3[] = [];
      let prev = -Infinity;
      for (const u of stations) {
        let p: V3;
        let q: V3;
        let lap: number;
        let v: number;
        if (k === 0) {
          const z = u * zeOf(1);
          p = L.edge(0, z);
          q = L.edge(1, z);
          v = u;
          lap = lapAt(Math.abs(z) > zeOf(0) ? 1 : z / zeOf(0));
        } else {
          v = Math.max(prev + 1e-4, L.rule(k, u));
          prev = v;
          p = L.land(k, u);
          q = L.land(k + 1, v);
          lap = lapAt(u);
        }
        const out = k === 0 ? (unit([q[1] - p[1], -(q[0] - p[0]), 0]) as V3) : L.normal(k, u);
        lo.push(onSide(add(p, out, lap), sx));
        // Run on up under the next strake as far as its lap covers it, and a
        // little inside it: where the lap runs out at the ends the two would
        // otherwise share a surface and fight for it.
        hi.push(onSide(add(add(q, unit(sub(q, p)), (0.03 * lapAt(v)) / LAP), L.normal(k + 1, v), -0.006), sx));
        seam.push(onSide(p, sx));
      }
      const n = onSide(L.normal(k, 0), sx);
      const down = onSide(scale(unit(sub(L.land(k + 1, 0), L.land(k, 0))), -1), sx);
      const color = strakeColor(k);
      const band = (t: number): V3[] => lo.map((q, i) => lerp(q, hi[i], t));
      if (k === 0) {
        outer.grid([lo, band(1 / 3), band(2 / 3), hi], color, n);
        outer.grid([seam, lo], color, down);
      } else if (k === BAND) {
        const mid = band(0.3);
        outer.grid([lo, mid], SAILCLOTH, n);
        outer.grid([mid, hi], color, n);
        outer.grid([seam, lo], SAILCLOTH, down);
      } else {
        outer.grid([lo, hi], color, n);
        outer.grid([seam, lo], color, down);
      }
    }
  }

  // --- The stem and the sternpost: the rabbet's curve, standing proud of the
  // plank ends, run on past the sheer to a head.
  {
    const ss: number[] = [-0.3, 0];
    for (let i = 1; i <= 12; i++) ss.push(i / 12);
    const pts = ss.map((s) => L.stem(s));
    const [za, ya] = L.stem(0.99);
    const [zb, yb] = L.stem(1);
    const t = unit([0, yb - ya, zb - za]);
    for (const d of [0.16, 0.32]) pts.push([zb + t[2] * d, yb + t[1] * d]);
    for (const e of [-1, 1]) {
      const path: V3[] = [];
      const out: V3[] = [];
      const xs: V3[] = [];
      for (let i = 0; i < pts.length; i++) {
        const [z, y] = pts[i];
        const [zp, yp] = pts[Math.max(0, i - 1)];
        const [zn, yn] = pts[Math.min(pts.length - 1, i + 1)];
        const tz = zn - zp;
        const ty = yn - yp;
        const l = Math.hypot(tz, ty) || 1;
        const nrm: V3 = [0, -tz / l, (e * ty) / l];
        out.push(nrm);
        xs.push([1, 0, 0]);
        path.push(add([0, y, e * z], nrm, 0.05));
      }
      outer.sweep(path, xs, out, 0.075, 0.17, topside);
      const top = path[path.length - 1];
      const tt = unit(sub(top, path[path.length - 2]));
      const nn = out[out.length - 1];
      outer.plate(add(top, tt, 0.001), [0.075, 0, 0], scale(nn, 0.17), scale(tt, 0.001), topside);
    }
  }

  // --- The keel she sits on.
  sb.box(0.16, 0.22, 2 * (L.stem(0)[0] + 0.25), 0, 0.81, 0, PITCH);

  // --- Her port letters and number up each side of the bow, on the sheer
  // strake, read from outside: painted, so pale on whatever she is.
  {
    const text = `${PORTS[Math.floor(rnd() * PORTS.length)]} ${1 + Math.floor(rnd() * 98)}`;
    const cell = 0.052;
    const pitch = cell * 4.2;
    const k = STRAKES - 1;
    const zeAvg = (zeOf(k) + zeOf(k + 1)) / 2;
    const surf = (u: number): [V3, V3] => {
      const p = L.land(k, u);
      const q = L.land(k + 1, u);
      return [add(p, L.normal(k, u), lapAt(u)), add(q, unit(sub(q, p)), 0.03)];
    };
    for (const sx of [-1, 1]) {
      for (let i = 0; i < text.length; i++) {
        const glyph = STENCIL[text[i]];
        if (!glyph) continue;
        const u = -0.56 + (sx * (i - (text.length - 1) / 2) * pitch) / zeAvg;
        const [lo, hi] = surf(u).map((q) => onSide(q, sx));
        const [lo2, hi2] = surf(u + 0.01).map((q) => onSide(q, sx));
        const o = lerp(lo, hi, 0.5);
        const tz = unit(sub(lerp(lo2, hi2, 0.5), o));
        const u0 = unit(sub(hi, lo));
        let n = unit(cross(tz, u0));
        if (n[0] * sx < 0) n = scale(n, -1);
        let v = unit(cross(n, tz));
        if (dot(v, u0) < 0) v = scale(v, -1);
        const x = scale(tz, sx);
        for (const [x0, y0, x1, y1] of glyph) {
          const c = add(add(add(o, x, ((x0 + x1) / 2 - 1.5) * cell), v, ((y0 + y1) / 2 - 2.5) * cell), n, 0.012);
          outer.plate(c, scale(x, ((x1 - x0) / 2) * cell), scale(v, ((y1 - y0) / 2) * cell), scale(n, 0.012), SAILCLOTH, false);
        }
      }
    }
  }

  // --- Inside: the foredeck, the waist's ribs, risers, thwarts and bottom
  // boards, all emitted before the inner skin they hide.
  const deckY = (z: number): number => sheerAt(z)[1] - 0.1;
  {
    // The foredeck and the stern sheets: boards along her, crowned, each run
    // toward its end until the hull closes on it, over a coaming across the
    // edge that faces the waist.
    const deck = (edge: number, e: -1 | 1): void => {
      const hw0 = L.half(edge, deckY(edge)) - 0.05;
      for (let x = -hw0 + 0.09; x < hw0 - 0.05; x += 0.165) {
        let z = edge;
        while (Math.abs(z) < zeOf(STRAKES) - 0.2 && L.half(z + e * 0.05, deckY(z + e * 0.05)) - 0.05 > Math.abs(x) + 0.08) z += e * 0.05;
        if (Math.abs(z - edge) < 0.2) continue;
        const crown = 0.05 * (1 - (x / hw0) ** 2);
        bar(sb, [x, deckY(edge) + crown, edge - e * 0.02], [x, deckY(z) + crown, z], 0.15, 0.04, PLANK);
      }
      sb.box(2 * hw0, 0.14, 0.08, 0, deckY(edge) + 0.03, edge - e * 0.02, TIMBER);
    };
    deck(zf, -1);
    deck(zt1 + 0.04, 1);
    // A coil of the anchor's cable on it.
    b.cyl(0.08, 0.58, 0.6, 10, 0.35, deckY(zf - 0.75) + 0.08, zf - 0.75, PITCH);
    b.cyl(0.06, 0.36, 0.4, 10, 0.35, deckY(zf - 0.75) + 0.14, zf - 0.75, PITCH);
  }
  // The bulkhead under the coaming, and the cuddy door in it.
  {
    const ys = [0, 0.25, 0.5, 0.75, 1].map((t) => FLOOR - 0.02 + (deckY(zf) - FLOOR + 0.02) * t);
    const right = ys.map((y): V3 => [L.half(zf, y) - 0.07, y, zf + 0.02]);
    outer.grid([right, right.map((q) => onSide(q, -1))], PLANK, [0, 0, 1]);
    sb.box(0.46, 0.66, 0.03, 0, FLOOR + 0.4, zf + 0.035, topside);
    sb.box(0.56, 0.05, 0.05, 0, FLOOR + 0.76, zf + 0.04, TIMBER);
  }
  // Ribs, from the bottom boards to under the gunwale, through the waist.
  for (let z = zf + 0.3; z < zt0 - 0.1; z += 0.45) {
    const top = sheerAt(z)[1] - 0.05;
    const ys = [0, 0.25, 0.5, 0.75, 1].map((t) => FLOOR - 0.02 + (top - FLOOR + 0.02) * t);
    for (const sx of [-1, 1]) {
      const pts = ys.map((y): V3 => onSide([L.half(z, y) - 0.085, y, z], sx));
      for (let i = 0; i + 1 < pts.length; i++) bar(sb, pts[i], pts[i + 1], 0.07, 0.05, TIMBER);
    }
  }
  // The risers the thwarts sit on.
  {
    const ry = THWART - 0.09;
    const zs: number[] = [];
    for (let z = zf + 0.05; z < zt0 + 0.25; z += 0.5) zs.push(z);
    zs.push(zt0 + 0.25);
    for (const sx of [-1, 1]) {
      for (let i = 0; i + 1 < zs.length; i++) {
        bar(sb, onSide([L.half(zs[i], ry) - 0.135, ry, zs[i]], sx), onSide([L.half(zs[i + 1], ry) - 0.135, ry, zs[i + 1]], sx), 0.05, 0.12, TIMBER);
      }
    }
  }
  // The thwarts, the mast's among them, and the thole pins on the gunwale
  // abaft each one, where the oarsman sitting on it pulls.
  const thwarts = [zm - 1.0, zm, zt0 - 0.3].filter((z, i, all) => z > zf + 0.35 && z < zt0 - 0.12 && (i === 0 || z - all[i - 1] > 0.7));
  for (const z of thwarts) {
    const hw = L.half(z, THWART - 0.03) - 0.11;
    sb.box(2 * hw, 0.06, 0.24, 0, THWART - 0.03, z, PLANK);
    for (const dz of [0.3, 0.45]) {
      const g = sheerAt(z + dz);
      for (const sx of [-1, 1]) sb.box(0.045, 0.2, 0.045, sx * (g[0] + 0.02), g[1] + 0.185, z + dz, TIMBER);
    }
  }
  // The bottom boards, each run as far as the bilge lets it.
  for (let i = -6; i <= 6; i++) {
    const x = i * 0.23;
    const fits = (z: number): boolean => L.half(z, FLOOR) - 0.07 >= Math.abs(x) + 0.1;
    let za = zm;
    let zb = zm;
    if (!fits(zm)) continue;
    while (za > zf + 0.05 && fits(za - 0.05)) za -= 0.05;
    while (zb < zt0 + 0.6 && fits(zb + 0.05)) zb += 0.05;
    sb.box(0.2, 0.04, zb - za, x, FLOOR, (za + zb) / 2, PLANK);
  }
  // The oars, laid fore and aft over the thwarts and on under the tarpaulin.
  {
    const oars = 2 + Math.floor(rnd() * 3);
    const xs = [-0.28, 0.28, -0.6, 0.6];
    for (let i = 0; i < oars; i++) {
      const z = zf + 0.2 + rnd() * 0.3;
      const y = THWART + 0.04;
      const end = Math.min(z + 4.4, zt1 - 0.3);
      if (end - z < 2) continue;
      limb(b, [xs[i], y, z], [xs[i], y, end - 1.0], 0.075, 0.065, PLANK, 6);
      bar(sb, [xs[i], y, end - 1.1], [xs[i], y - 0.01, end], 0.16, 0.025, PLANK);
    }
  }

  // --- The mast, stepped on the keelson through the forward thwart and
  // raked a little aft, and its rigging.
  const rake = 0.04;
  const mastLen = 5.0;
  const head: V3 = [0, FLOOR + mastLen * Math.cos(rake), zm + mastLen * Math.sin(rake)];
  b.cyl(mastLen, 0.14, 0.24, 8, 0, FLOOR + (mastLen / 2) * Math.cos(rake), zm + (mastLen / 2) * Math.sin(rake), PLANK, { x: rake });
  sb.box(0.2, 0.32, 0.22, 0, head[1] - 0.45, head[2] - 0.45 * Math.sin(rake), PITCH, { x: rake });
  b.cyl(0.07, 0.32, 0.32, 8, 0, THWART + 0.03, zm + (THWART - FLOOR) * Math.sin(rake), PITCH);
  {
    const [zs, ys] = L.stem(1);
    const stemHead: V3 = [0, ys + 0.28, -(zs + 0.07)];
    limb(b, add(head, [0, -0.3, 0]), stemHead, 0.035, 0.035, PITCH, 4);
    const zw = zm + 0.55;
    const g = sheerAt(zw);
    for (const sx of [-1, 1]) {
      limb(b, add(head, [0, -0.35, 0]), onSide([g[0] + 0.05, g[1] + 0.06, zw], sx), 0.03, 0.03, PITCH, 4);
    }
    // The halyard, down to where the yard is slung.
    limb(b, add(head, [0.11, -0.45, 0]), [0.11, YARD + 0.05, zm + 0.12], 0.03, 0.03, PITCH, 4);
  }
  // The yard, its forward end at the mast and its after end in the crutch,
  // with the sail furled along it as far as the tarpaulin.
  limb(b, [0, YARD - 0.01, zm - 0.45], [0, YARD + 0.01, zc + 0.3], 0.11, 0.09, PLANK, 6);
  if (zt0 - zm > 0.5) {
    limb(b, [0, YARD - 0.09, zm + 0.16], [0, YARD - 0.09, zt0 + 0.05], 0.36, 0.3, SAILCLOTH, 8);
    for (const t of [0.3, 0.7]) b.cyl(0.05, 0.38, 0.38, 8, 0, YARD - 0.09, zm + 0.16 + (zt0 - zm - 0.16) * t, PITCH, { x: Math.PI / 2 });
  }
  {
    const g = sheerAt(zc);
    for (const sx of [-1, 1]) bar(sb, onSide([g[0] - 0.06, g[1] + 0.03, zc], sx), onSide([-0.2, YARD + 0.17, zc], sx), 0.08, 0.06, TIMBER);
  }

  // --- The inner skin, last of the hull: tarred, smooth, inside every rib.
  for (const sx of [-1, 1]) {
    const rows: V3[][] = [];
    for (let k = 0; k <= STRAKES; k++) rows.push(stations.map((u) => onSide(add(L.land(k, u), L.normal(k, u), -SKIN), sx)));
    inner.grid(rows, PITCH, onSide(scale(L.normal(3, 0), -1), sx), "smooth");
  }

  // --- The cradle: the cribbing under each end of the keel and the shores.
  for (const sz of [-1, 1] as const) {
    const zb = sz * len * 0.25;
    const g = Math.min(ground(-0.65, zb - 0.55), ground(0.65, zb - 0.55), ground(-0.65, zb + 0.55), ground(0.65, zb + 0.55), ground(0, zb));
    // A footing of two basalt slabs, carried down to the lowest ground.
    for (const sx of [-1, 1]) {
      const h = 0.18 - (g - 0.08);
      sb.box(0.63, h, 1.1, sx * 0.33, 0.18 - h / 2, zb, BASALT);
    }
    // Two baulks across, three along, then a pair of folding wedges.
    for (const dz of [-0.36, 0.36]) sb.box(1.3, 0.22, 0.32, 0, 0.29, zb + dz, TIMBER);
    for (const dx of [-0.42, 0, 0.42]) sb.box(0.26, 0.2, 1.1, dx, 0.5, zb, TIMBER);
    sb.box(0.5, 0.05, 0.28, 0, 0.625, zb, PLANK, { z: 0.05 });
    sb.box(0.5, 0.05, 0.28, 0, 0.675, zb, PLANK, { z: -0.05 });
    // The shores: a sole board on the hard, the shore from it to the bilge.
    const zs = sz * len * 0.28;
    for (const sx of [-1, 1]) {
      const gf = ground(sx * 2.85, zs);
      sb.box(0.8, 0.07, 0.34, sx * 2.8, gf + 0.035, zs, PLANK);
      const hy = 1.85;
      bar(sb, [sx * 2.85, gf + 0.07, zs], [sx * (L.half(zs, hy) + 0.12), hy, zs], 0.24, 0.24, TIMBER);
    }
  }

  // --- On the hard round her: a roller under the forefoot, and by seed a
  // tar pot with its brush, spare planks on bearers, and her rudder.
  {
    const zr = -(lh - 0.7);
    b.cyl(1.6, 0.24, 0.26, 8, 0, ground(0, zr) + 0.12, zr, TIMBER, { z: Math.PI / 2 });
    const sxc = rnd() < 0.5 ? -1 : 1;
    if (rnd() < 0.7) {
      const x = sxc * 2.25;
      const z = -0.05 * len;
      const g = ground(x, z);
      b.cyl(0.28, 0.3, 0.26, 10, x, g + 0.14, z, PITCH);
      limb(b, [x - 0.25, g + 0.3, z], [x + 0.2, g + 0.26, z + 0.1], 0.035, 0.03, TIMBER, 4);
    }
    if (rnd() < 0.6) {
      const x = -sxc * 2.45;
      const z = 0.12 * len;
      const ga = ground(x, z - 1.1);
      const gb = ground(x, z + 1.1);
      for (const [zz, gg] of [
        [z - 1.1, ga],
        [z + 1.1, gb],
      ] as const)
        sb.box(0.9, 0.08, 0.1, x, gg + 0.04, zz, TIMBER);
      for (let i = 0; i < 3; i++) {
        const y = 0.1 + i * 0.037;
        const dx = (i - 1) * 0.06 + (rnd() - 0.5) * 0.08;
        bar(sb, [x + dx, ga + y, z - 1.5], [x + dx, gb + y, z + 1.5], 0.2, 0.035, PLANK);
      }
    }
    {
      const x = -sxc * 2.3;
      const z = lh - 1.0;
      const g = ground(x, z);
      sb.box(0.5, 0.05, 1.5, x, g + 0.04, z, topside);
      sb.box(0.1, 0.1, 2.0, x - sxc * 0.27, g + 0.06, z - 0.15, TIMBER);
      bar(sb, [x - sxc * 0.4, g + 0.05, z - 1.4], [x - sxc * 1.1, g + 0.05, z - 2.3], 0.07, 0.06, TIMBER);
    }
  }

  outer.flush(b);
  sb.flush(b);
  inner.flush(b);
  return b;
}
