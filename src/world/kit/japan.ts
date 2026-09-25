/**
 * kit/japan.ts — The temple town: pagoda, temple hall, temple gate, bell
 * tower, machiya, minka, teahouse, kura, torii, stone lantern, stone pagoda,
 * garden wall and the arched bridge. All follow the contract in kit/core.ts
 * (origin-local geometry, no solid/pickable/collisions metadata, a front on
 * local -Z).
 *
 * ## What this set is, and why it is a set
 *
 * Kurenai is a temple town in a mountain valley in the last week of the
 * maples, and the rule `kit/harbour.ts` wrote down holds here unchanged: **a
 * map feels like a place because the buildings are the ones that place would
 * have built**, not because there are many of them. A valley like this one
 * built a temple with a pagoda for its landmark, a gate and a bell to go with
 * it, a street of narrow townhouses with lattice fronts, farmhouses under
 * thatch, storehouses in white plaster, a teahouse by the water, a shrine
 * reached through a tunnel of vermilion gates, and a bridge you walk UP.
 *
 * It is made of five materials and one accent: stained timber (`SUMI`) and
 * aged cypress (`HINOKI`), lime plaster (`SHIKKUI`) and earthen plaster
 * (`TSUCHI`), fired tile (`KAWARA`) — and vermilion (`SHU`), which is spent
 * only on what is SACRED or CROSSED: the torii, the bridge, the pagoda's
 * brackets. On a map where every tree is red, vermilion anywhere else stops
 * reading as a signal.
 *
 * ## The one new shape: a roof that curves
 *
 * Every roof in the older kits is straight slabs (`Build.gableRoof`), and a
 * Japanese roof is the one roof in the world that cannot be — the eave line
 * sweeping up at the corners and the pitch steepening toward the ridge is the
 * whole of what the silhouette says. `curvedRoof` below is that shape as
 * finished vertices: rings from the eave to the ridge, each ring higher and
 * tighter than the last on a power curve, the eave ring lifted at the corners,
 * a thickness under it and a band closing the edge. It is a CLOSED solid,
 * because the world's shadow map records back faces and every caster must be
 * one (`docs/rendering.md`), and every triangle is oriented against an outward
 * hint using Babylon's own face-normal formula, so the winding cannot come out
 * inside-out whichever way the rings are walked.
 *
 * Its COLLIDER is a flat slab at the eave, exactly `gableRoof`'s — nothing
 * walks on a roof in this town, and a curved ray shape would buy rounds a
 * centimetre of accuracy on a surface nobody stands behind.
 *
 * ## The rules this file adds to the kit contract
 *
 * - **Shoji glow, never shoji light.** A paper wall with a lamp behind it is a
 *   `Build.glow` panel with a `SUMI` lattice laid over its face — which is
 *   what the reference frame's hall is — and costs no light slot. Only a
 *   builder asked for `lit` spends one, and a layout should ask sparingly.
 * - **Everything walked obeys kit/terrain.ts's header**: the hall's plinth,
 *   the pagoda's plinth, the teahouse's deck and the bridge are all within
 *   `CONFIG.nav.stepHeight` of what is around them, and the bridge's ramps
 *   carry `rotX` on their colliders.
 * - **Colliders are emitted walked-first, roofs last**, because `NavGrid`
 *   drops surplus surfaces in ARRIVAL order (`docs/bots.md`) and a pagoda is
 *   five roofs stacked over one plinth.
 * - **Nothing tall is climbable.** The pagoda is the map's landmark and
 *   `buildMinaret`'s rule applies to it verbatim: a perch that sees every
 *   flag with one way up is not a position, it is a problem.
 */
import { Scene, VertexData } from "@babylonjs/core";
import { CONFIG } from "../../config";
import type { CelMaterialFactory } from "../../shaders/CelShader";
import {
  Build,
  type BuildParams,
  type Structure,
  GUARD_THICKNESS,
  VERDIGRIS,
} from "./core";

// --- palette -------------------------------------------------------------------
// Art constants, judged under a 14-degree gold key: every albedo here is a
// shade darker and greyer than its swatch would suggest, because the hour is
// in the LIGHT (see `kurenai/environment.ts`) and warming a material under a
// warm key double-counts it.

/** Stained timber: posts, lattice, the frame of everything. */
const SUMI = "#2f2620";
/** Aged cypress: the hall's pillars, an engawa, a floor. */
const HINOKI = "#5c4332";
/** Weathered cedar decking — lighter, because it is walked on and bleached. */
const CEDAR = "#6d5440";
/** Lime plaster. Cream rather than white, for the khaki clamp's reason. */
const SHIKKUI = "#b3aa97";
/** Earthen plaster: the garden walls and the farmhouses. */
const TSUCHI = "#8f7552";
/** Fired roof tile, a warm grey — the reference frame's roofs are not blue. */
const KAWARA = "#4a4744";
/** The ridge and the end tiles, a step darker so the ridge line reads. */
const KAWARA_DARK = "#35332f";
/** Old thatch. */
const KAYA = "#6a5a3f";
const KAYA_DARK = "#4d412d";
/** Vermilion: the sacred and the crossed, and nothing else. */
const SHU = "#b23a22";
/** Granite: lanterns, plinths, footings. */
const GRANITE = "#7a766d";
const GRANITE_DARK = "#56534d";
/** Temple bronze — the bell, the finials, the caps on the bridge's posts. */
const BRONZE = "#6f5b3a";
/** Namako tile: the storehouse's black skirt. */
const NAMAKO = "#2c2d2f";
/** Unlit paper — a shoji with nobody home. */
const PAPER = "#cbbd9e";
/** Paper with a lamp behind it. */
const SHOJI_GLOW = "#f2b56e";
/** The one dim glow: a sanctuary's gilt in the dark of the hall. */
const GILT_GLOW = "#e0a24a";
/** The noren over a shop door. */
const NOREN = "#2d3d58";

const TRANSLUCENCY = CONFIG.graphics.translucency;

// --- the roof ----------------------------------------------------------------

type V3 = [number, number, number];

/**
 * Finished triangles with their winding decided per triangle.
 *
 * `outward` is a HINT, not a normal: the triangle is flipped if Babylon's own
 * face normal — `(v1 - v2) x (v3 - v2)`, `VertexData.ComputeNormals` in a
 * left-handed scene — points away from it. So the ring loops below can walk
 * in whatever order is convenient, and a roof built upside down in the head
 * of whoever edits this still comes out facing the sky.
 */
class Mesher {
  private positions: number[] = [];
  private indices: number[] = [];

  tri(a: V3, b: V3, c: V3, outward: V3): void {
    const ux = a[0] - b[0];
    const uy = a[1] - b[1];
    const uz = a[2] - b[2];
    const vx = c[0] - b[0];
    const vy = c[1] - b[1];
    const vz = c[2] - b[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    // A degenerate triangle has no normal to give the cel shader, and the
    // rings DO collapse — the ridge ring is a line.
    if (nx * nx + ny * ny + nz * nz < 1e-10) return;
    const flip = nx * outward[0] + ny * outward[1] + nz * outward[2] < 0;
    const order = flip ? [a, c, b] : [a, b, c];
    for (const v of order) {
      this.indices.push(this.positions.length / 3);
      this.positions.push(v[0], v[1], v[2]);
    }
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

interface RoofSpec {
  /** Centre of the roof in the structure's frame. */
  x?: number;
  z?: number;
  /** Height of the eave line (before the corners lift). */
  y: number;
  /** Half extents of the EAVE ring. */
  ex: number;
  ez: number;
  /**
   * Half extents of the TOP ring. `tz: 0` with `tx > 0` is a ridge — a hipped
   * roof; both near zero is a pyramid; both positive is a pagoda tier whose
   * top is hidden under the storey above it.
   */
  tx: number;
  tz: number;
  /** Height of the top ring over the eave. */
  rise: number;
  /**
   * The profile's exponent. 1 is a straight hip; above 1 the pitch is shallow
   * at the eave and steepens toward the ridge, which is the Japanese roof.
   */
  curve?: number;
  /** How far the four corners of the eave sweep up, in metres. */
  upturn?: number;
  /** Vertical thickness of the sheet. */
  thick?: number;
  /** Rings from eave to top, and samples along each side of a ring. */
  rings?: number;
  seg?: number;
}

/**
 * A curved hipped roof as one closed solid, added to `b` in `color`.
 *
 * Rings run from the eave (`t = 0`) to the top (`t = 1`); ring `t` is the
 * rectangle lerped between the two footprints and stands `rise * t^curve`
 * over the eave. The eave ring alone is lifted toward its corners by `upturn *
 * |u|^3`, where `u` runs -1..1 along each side, and the lift dies out over the
 * next rings so the sweep is in the eave and not in the whole slope. The sheet
 * is `thick` deep, its underside is the same surface lowered, and one band
 * closes the eave edge — the top ring needs none, because the upper sheet and
 * the lower one both run straight across it.
 */
function curvedRoof(b: Build, color: string, o: RoofSpec): void {
  const cx = o.x ?? 0;
  const cz = o.z ?? 0;
  const curve = o.curve ?? 1.6;
  const upturn = o.upturn ?? 0;
  const thick = o.thick ?? 0.3;
  const rings = o.rings ?? 5;
  const seg = o.seg ?? 6;
  const perRing = seg * 4;

  const ring = (k: number, drop: number): V3[] => {
    const t = k / rings;
    const hx = o.ex + (o.tx - o.ex) * t;
    const hz = o.ez + (o.tz - o.ez) * t;
    const h = o.y + o.rise * Math.pow(t, curve) - drop;
    const fade = (1 - t) * (1 - t);
    const pts: V3[] = [];
    for (let s = 0; s < 4; s++) {
      for (let i = 0; i < seg; i++) {
        const u = -1 + (2 * i) / seg;
        let x: number;
        let z: number;
        switch (s) {
          case 0:
            x = u * hx;
            z = -hz;
            break;
          case 1:
            x = hx;
            z = u * hz;
            break;
          case 2:
            x = -u * hx;
            z = hz;
            break;
          default:
            x = -hx;
            z = -u * hz;
        }
        const lift = upturn * fade * Math.pow(Math.abs(u), 3);
        pts.push([cx + x, h + lift, cz + z]);
      }
    }
    return pts;
  };

  const top: V3[][] = [];
  const bot: V3[][] = [];
  for (let k = 0; k <= rings; k++) {
    top.push(ring(k, 0));
    bot.push(ring(k, thick));
  }

  const m = new Mesher();
  const UP: V3 = [0, 1, 0];
  const DOWN: V3 = [0, -1, 0];
  for (let k = 0; k < rings; k++) {
    for (let j = 0; j < perRing; j++) {
      const n = (j + 1) % perRing;
      m.quad(top[k][j], top[k][n], top[k + 1][n], top[k + 1][j], UP);
      m.quad(bot[k][j], bot[k][n], bot[k + 1][n], bot[k + 1][j], DOWN);
    }
  }
  for (let j = 0; j < perRing; j++) {
    const n = (j + 1) % perRing;
    const a = top[0][j];
    const c = top[0][n];
    const out: V3 = [(a[0] + c[0]) / 2 - cx, 0, (a[2] + c[2]) / 2 - cz];
    m.quad(a, c, bot[0][n], bot[0][j], out);
  }
  b.surface(m.data(), color);
}

/**
 * The ridge over a curved roof: a tile ridge along X and a raised end tile at
 * each end — the one line on a Japanese roof that is straight, and the one
 * thing that says where its top is from across the valley.
 */
function ridge(b: Build, halfLen: number, y: number, z = 0, x = 0): void {
  b.box(halfLen * 2 + 0.4, 0.42, 0.55, x, y + 0.12, z, KAWARA_DARK);
  for (const s of [-1, 1]) {
    b.box(0.5, 0.95, 0.62, x + s * (halfLen + 0.2), y + 0.4, z, KAWARA_DARK, {
      z: -s * 0.18,
    });
  }
}

/**
 * A pitched roof whose ridge runs along X — `Build.gableRoof` turned a quarter,
 * which is what a townhouse facing its street needs (its ridge is parallel to
 * the frontage, so rain falls on the street and not on the neighbours).
 * Collider as `gableRoof`'s: a flat slab at the eave.
 */
function gableRoofX(
  b: Build,
  w: number,
  d: number,
  rise: number,
  y: number,
  color: string,
  overhang = 0.5,
): void {
  const slopeD = d / 2 + overhang;
  const len = Math.hypot(slopeD, rise);
  const pitch = Math.atan2(rise, slopeD);
  for (const s of [-1, 1]) {
    // rotX lowers the +Z end for a positive angle, so the +Z slab takes +pitch.
    b.box(w + overhang * 2, 0.2, len, 0, y + rise / 2, (s * slopeD) / 2, color, {
      x: s * pitch,
    });
  }
  for (const s of [-1, 1]) {
    const end = b.gableEnd(slopeD * 2, rise, 0.16, (s * w) / 2, y, 0, color);
    end.rotation.y = Math.PI / 2;
  }
  ridge(b, w / 2 + overhang - 0.3, y + rise, 0);
  b.block({ w: w + overhang * 2, h: 0.3, d: d + overhang * 2, x: 0, y, z: 0 });
}

/**
 * A shoji panel on a wall face: the paper (a glow if `lit`, plain paper if
 * not) and the lattice over it. `face` is the plane of the wall's outer face,
 * `nz` which way it faces (`-1` for -Z), and the panel runs along X — the
 * caller turns it for a side wall with `alongZ`.
 */
function shoji(
  b: Build,
  opts: {
    cx: number;
    cy: number;
    w: number;
    h: number;
    face: number;
    n: 1 | -1;
    alongZ?: boolean;
    lit?: boolean;
    cols?: number;
    rows?: number;
  },
): void {
  const { cx, cy, w, h, face, n } = opts;
  const cols = opts.cols ?? Math.max(2, Math.round(w / 0.45));
  const rows = opts.rows ?? Math.max(3, Math.round(h / 0.4));
  const paperOff = face + n * 0.03;
  const barOff = face + n * 0.07;
  const put = (
    bw: number,
    bh: number,
    along: number,
    y: number,
    off: number,
    thin: number,
    color: string,
    glow: boolean,
  ): void => {
    const [sx, sz, px, pz] = opts.alongZ
      ? [thin, bw, off, along]
      : [bw, thin, along, off];
    if (glow) b.glow(sx, bh, sz, px, y, pz, color);
    else b.box(sx, bh, sz, px, y, pz, color);
  };
  put(w, h, cx, cy, paperOff, 0.04, opts.lit ? SHOJI_GLOW : PAPER, !!opts.lit);
  // The frame and the kumiko lattice.
  for (let i = 0; i <= cols; i++) {
    const a = cx - w / 2 + (i / cols) * w;
    put(i === 0 || i === cols ? 0.09 : 0.04, h + 0.08, a, cy, barOff, 0.05, SUMI, false);
  }
  for (let j = 0; j <= rows; j++) {
    const y = cy - h / 2 + (j / rows) * h;
    put(w, j === 0 || j === rows ? 0.09 : 0.04, cx, y, barOff, 0.05, SUMI, false);
  }
}

// --- the gate everyone walks through ---------------------------------------------

/**
 * A TORII: two posts, a tie beam and the great lintel with its ends sweeping
 * up — the one shape on this map that tells a player they have crossed from
 * the town into the sacred without a word on screen.
 *
 * Solid posts (a body walks into one and a round stops on it) and the beams —
 * the tie, and the lintel's coloured beam and black cap — are `strut`s: ray
 * geometry and nothing else, because they are four metres over anybody's head
 * and a nav surface up there is a surface nobody can reach. `width` is the span between the posts, `height` the lintel's
 * underside; `tint` recolours the timber, and the cap on the lintel stays
 * black whatever it is.
 */
export function buildTorii(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "torii");
  const span = p.width ?? 4.6;
  const h = p.height ?? 6;
  const color = p.tint ?? SHU;
  const postD = Math.max(0.36, h * 0.075);

  for (const sx of [-1, 1]) {
    const x = (sx * span) / 2;
    b.cyl(h, postD * 0.88, postD, 10, x, h / 2, 0, color);
    // The black sleeve at the foot, and the granite it stands in.
    b.cyl(0.4, postD + 0.14, postD + 0.16, 10, x, 0.2, 0, SUMI);
    b.cyl(0.22, postD + 0.5, postD + 0.62, 8, x, 0.06, 0, GRANITE_DARK);
    b.block({ w: postD * 0.9, h, d: postD * 0.9, x, y: h / 2, z: 0 });
  }
  const tie = h - Math.max(0.9, h * 0.19);
  b.strut(span + postD * 2.6, postD * 0.62, postD * 0.52, 0, tie, 0, color);
  // The tablet between the beams.
  b.box(postD * 0.7, h - tie - 0.1, postD * 0.4, 0, (h + tie) / 2, 0, color);
  // The lintel: a coloured beam under a black cap, and the cap's ends swept.
  // Both beams of it are struts — the coloured one is the thicker half of
  // what a round aimed at the lintel meets. The swept ends are drawn only: a
  // collider carries no roll, and they are the last half-metre of the span.
  const reach = span / 2 + postD * 2.4;
  b.strut(reach * 2 - 0.4, postD * 0.62, postD * 0.95, 0, h + postD * 0.31, 0, color);
  b.strut(reach * 2 - 1.2, postD * 0.62, postD * 1.15, 0, h + postD * 0.93, 0, SUMI);
  for (const sx of [-1, 1]) {
    b.box(1.1, postD * 0.62, postD * 1.15, sx * (reach - 0.55), h + postD * 1.05, 0, SUMI, {
      z: sx * 0.16,
    });
  }
  return b;
}

// --- the garden's stone ------------------------------------------------------------

/**
 * A STONE LANTERN (toro): a hexagonal foot, a shaft, a platform, the firebox
 * with its windows and a broad six-sided cap with the jewel on it. The
 * reference frame's garden is lined with them.
 *
 * Its collider is its body at chest height and it is 1.9 m tall, so it bakes
 * as hard cover — which a granite post two feet thick is. `lit` puts a flame
 * glow in the firebox's windows and nothing else: a lantern at dusk is a thing
 * you SEE, and a garden of them spending light slots would evict every lit
 * interior on the map.
 */
export function buildToro(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "toro");
  const s = p.height ? p.height / 2.3 : 1;
  b.cyl(0.26 * s, 0.9 * s, 1.02 * s, 6, 0, 0.13 * s, 0, GRANITE_DARK);
  b.cyl(0.95 * s, 0.34 * s, 0.4 * s, 8, 0, 0.74 * s, 0, GRANITE);
  b.cyl(0.2 * s, 0.92 * s, 0.62 * s, 6, 0, 1.31 * s, 0, GRANITE);
  b.box(0.6 * s, 0.52 * s, 0.6 * s, 0, 1.67 * s, 0, GRANITE);
  for (const sz of [-1, 1]) {
    const z = sz * 0.305 * s;
    if (p.litWindows) b.glow(0.28 * s, 0.24 * s, 0.03, 0, 1.68 * s, z, SHOJI_GLOW);
    else b.box(0.28 * s, 0.24 * s, 0.03, 0, 1.68 * s, z, SUMI);
  }
  b.cyl(0.34 * s, 0.22 * s, 1.34 * s, 6, 0, 2.1 * s, 0, GRANITE_DARK);
  b.cyl(0.14 * s, 0.14 * s, 0.24 * s, 8, 0, 2.34 * s, 0, GRANITE);
  b.cyl(0.18 * s, 0.02, 0.2 * s, 8, 0, 2.5 * s, 0, GRANITE);
  b.block({ w: 0.62 * s, h: 1.95 * s, d: 0.62 * s, x: 0, y: 0.975 * s, z: 0 });
  return b;
}

/**
 * A STONE PAGODA (sekito): five thin granite roofs stacked on a block, four
 * metres of it, standing in a garden. The reference frame's is the thing the
 * eye lands on first — the big pagoda is the valley's landmark, and this is
 * the garden's.
 */
export function buildStonePagoda(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "sekito");
  const s = p.height ? p.height / 4.4 : 1;
  b.box(1.5 * s, 0.35 * s, 1.5 * s, 0, 0.175 * s, 0, GRANITE_DARK);
  b.box(1.0 * s, 0.9 * s, 1.0 * s, 0, 0.8 * s, 0, GRANITE);
  let y = 1.25 * s;
  for (let i = 0; i < 5; i++) {
    const r = (1.55 - i * 0.15) * s;
    b.cyl(0.18 * s, r * 0.72, r * 1.414, 4, 0, y + 0.09 * s, 0, GRANITE_DARK, {
      y: Math.PI / 4,
    });
    const body = (0.62 - i * 0.07) * s;
    if (i < 4) b.box(body, 0.42 * s, body, 0, y + 0.39 * s, 0, GRANITE);
    y += 0.6 * s;
  }
  // The finial: a stack of rings to a point.
  b.cyl(0.8 * s, 0.08 * s, 0.22 * s, 8, 0, y + 0.1 * s, 0, GRANITE);
  b.block({ w: 1.0 * s, h: 3.2 * s, d: 1.0 * s, x: 0, y: 1.6 * s, z: 0 });
  return b;
}

// --- the town -----------------------------------------------------------------------

/**
 * A MACHIYA: the narrow townhouse the street is made of. Two storeys — a full
 * ground floor behind a lattice front, a low upper one with slit windows — a
 * pent roof over the street, a tiled roof whose ridge runs along the frontage,
 * and the plastered fire walls standing up at each end of it.
 *
 * The lattice is the building: vertical slats every 14 cm in front of the
 * ground floor, with the room's glow behind them when `litWindows` is set,
 * which is what a street of these at dusk looks like and what makes one row
 * read as a street rather than a terrace of boxes. `enterable` hollows the
 * ground floor behind a doorway under a noren; the upper storey is its
 * ceiling, as the townhouse's is. `tint` is the plaster.
 */
export function buildMachiya(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "machiya");
  const w = p.width ?? 7;
  const d = p.depth ?? 11;
  const plaster = p.tint ?? SHIKKUI;
  const t = 0.3;
  const g = 3.3;
  const up = 2.4;
  const h = g + up;
  const door = 1.8;

  b.box(w + 0.2, 0.25, d + 0.2, 0, 0.125, 0, GRANITE_DARK);
  if (p.enterable) {
    b.box(w - 0.2, 0.2, d - 0.2, 0, 0.25, 0, CEDAR);
    b.doorWall(w, g, t, 0, g / 2, -d / 2 + t / 2, HINOKI, door, 2.3);
    b.wall(w, g, t, 0, g / 2, d / 2 - t / 2, plaster);
    b.wall(t, g, d, -w / 2 + t / 2, g / 2, 0, plaster);
    b.wall(t, g, d, w / 2 - t / 2, g / 2, 0, plaster);
    b.wall(w, up, d, 0, g + up / 2, 0, plaster);
  } else {
    b.box(w, g, d, 0, g / 2, 0, plaster);
    b.block({ w, h: g, d, x: 0, y: g / 2, z: 0 });
    b.box(w, up, d, 0, g + up / 2, 0, plaster);
    b.block({ w, h: up, d, x: 0, y: g + up / 2, z: 0 });
    // The shop door, drawn shut.
    b.box(door, 2.3, 0.06, 0, 1.15, -d / 2 - 0.03, SUMI);
  }

  // The frame: corner posts bedded on the faces, the beam over the ground floor.
  const face = -d / 2;
  for (const sx of [-1, 1]) {
    b.box(0.26, g, 0.22, sx * (w / 2 - 0.13), g / 2, face - 0.11, SUMI);
    b.box(0.22, h, 0.26, sx * (w / 2 + 0.11), h / 2, face + 0.4, SUMI);
  }
  b.box(w + 0.1, 0.3, 0.24, 0, g - 0.15, face - 0.12, SUMI);

  // The lattice either side of the door, with the room behind it.
  const sideW = (w - door) / 2 - 0.35;
  for (const sx of [-1, 1]) {
    const cx = sx * (door / 2 + 0.15 + sideW / 2);
    if (p.litWindows) b.glow(sideW, 1.7, 0.04, cx, 1.45, face - 0.04, SHOJI_GLOW);
    else b.box(sideW, 1.7, 0.04, cx, 1.45, face - 0.04, PAPER);
    const slats = Math.max(4, Math.round(sideW / 0.14));
    for (let i = 0; i <= slats; i++) {
      const x = cx - sideW / 2 + (i / slats) * sideW;
      b.box(0.05, 2.05, 0.06, x, 1.35, face - 0.1, SUMI);
    }
    b.box(sideW + 0.1, 0.1, 0.08, cx, 2.4, face - 0.1, SUMI);
    b.box(sideW + 0.1, 0.1, 0.08, cx, 0.32, face - 0.1, SUMI);
  }
  // The noren over the door, which is cloth and lets the evening through.
  b.translucentBox(door + 0.2, 0.75, 0.04, 0, 1.95, face - 0.22, NOREN, TRANSLUCENCY.awning);

  // The pent roof over the street, on its brackets.
  const hisashi = 1.1;
  const pitch = 0.36;
  b.box(w + 0.3, 0.14, hisashi / Math.cos(pitch), 0, g + 0.05, face - hisashi / 2, KAWARA, {
    x: -pitch,
  });
  for (const sx of [-1, 1]) {
    b.box(0.12, 0.12, hisashi, sx * (w / 2 - 0.4), g - 0.2, face - hisashi / 2, SUMI);
  }

  // The low upper storey: slit windows in plaster (mushiko-mado).
  const slitY = g + up * 0.5;
  for (const sx of [-1, 0, 1]) {
    const cx = sx * (w / 3.2);
    if (p.litWindows && sx === 0) {
      b.glow(1.1, 0.55, 0.04, cx, slitY, face - 0.03, SHOJI_GLOW);
    } else {
      b.box(1.1, 0.55, 0.04, cx, slitY, face - 0.03, SUMI);
    }
    for (let i = 0; i <= 4; i++) {
      b.box(0.08, 0.6, 0.07, cx - 0.55 + i * 0.275, slitY, face - 0.06, plaster);
    }
  }

  // The fire walls at each end of the upper storey, with their own caps.
  for (const sx of [-1, 1]) {
    const x = sx * (w / 2 + 0.05);
    b.box(0.3, 1.3, 1.3, x, g + 0.5, face + 0.7, plaster);
    b.box(0.5, 0.12, 1.5, x, g + 1.2, face + 0.7, KAWARA_DARK);
  }

  gableRoofX(b, w, d, 1.9, h, KAWARA, 0.55);
  return b;
}

/**
 * A MINKA: the farmhouse, under a thatched hip as tall as the walls under it.
 * Earthen plaster between dark posts, a deck along the front, paper doors
 * either side of the entrance, and the roof — which is most of the building
 * from any distance and is what makes a farm read as a farm.
 */
export function buildMinka(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "minka");
  const w = p.width ?? 12;
  const d = p.depth ?? 8;
  const h = p.height ?? 3.0;
  const t = 0.32;
  b.box(w + 0.3, 0.3, d + 0.3, 0, 0.15, 0, GRANITE_DARK);
  if (p.enterable) {
    b.box(w - 0.2, 0.2, d - 0.2, 0, 0.3, 0, CEDAR);
    b.doorWall(w, h, t, 0, h / 2, -d / 2 + t / 2, TSUCHI, 2.4, 2.3);
    b.wall(w, h, t, 0, h / 2, d / 2 - t / 2, TSUCHI);
    b.wall(t, h, d, -w / 2 + t / 2, h / 2, 0, TSUCHI);
    b.wall(t, h, d, w / 2 - t / 2, h / 2, 0, TSUCHI);
  } else {
    b.box(w, h, d, 0, h / 2, 0, TSUCHI);
    b.block({ w, h, d, x: 0, y: h / 2, z: 0 });
  }
  // Posts on every face, a beam under the eave.
  const bays = Math.max(3, Math.round(w / 1.8));
  for (let i = 0; i <= bays; i++) {
    const x = -w / 2 + (i / bays) * w;
    for (const sz of [-1, 1]) b.box(0.22, h, 0.12, x, h / 2, sz * (d / 2 + 0.06), SUMI);
  }
  for (const sx of [-1, 1]) {
    for (let i = 0; i <= 3; i++) {
      b.box(0.12, h, 0.22, sx * (w / 2 + 0.06), h / 2, -d / 2 + (i / 3) * d, SUMI);
    }
  }
  for (const sz of [-1, 1]) b.box(w + 0.2, 0.26, 0.14, 0, h - 0.13, sz * (d / 2 + 0.07), SUMI);
  // Paper doors either side of the entrance.
  for (const sx of [-1, 1]) {
    shoji(b, {
      cx: sx * (1.2 + (w / 2 - 1.5) / 2 + 0.1),
      cy: 1.35,
      w: w / 2 - 1.8,
      h: 1.9,
      face: -d / 2,
      n: -1,
      lit: p.litWindows,
    });
  }
  // The deck along the front, walked at 0.45.
  b.box(w, 0.18, 1.2, 0, 0.36, -d / 2 - 0.6, CEDAR);
  b.block({ w, h: 0.45, d: 1.2, x: 0, y: 0.225, z: -d / 2 - 0.6 });
  // The roof.
  const ex = w / 2 + 1.3;
  const ez = d / 2 + 1.3;
  curvedRoof(b, KAYA, {
    y: h - 0.1,
    ex,
    ez,
    tx: Math.max(0.6, (w - d) / 2 + 0.8),
    tz: 0,
    rise: d * 0.62,
    curve: 1.12,
    upturn: 0.05,
    thick: 0.7,
    seg: 4,
  });
  // The ridge: a darker bundle along the top with its crossed boards.
  const rx = Math.max(0.6, (w - d) / 2 + 0.8);
  const ry = h - 0.1 + d * 0.62;
  b.box(rx * 2 + 0.6, 0.55, 0.8, 0, ry + 0.1, 0, KAYA_DARK);
  for (let i = -2; i <= 2; i++) {
    b.box(0.12, 0.9, 0.12, i * (rx / 2.2), ry + 0.35, 0, SUMI, { x: 0.6 });
    b.box(0.12, 0.9, 0.12, i * (rx / 2.2), ry + 0.35, 0, SUMI, { x: -0.6 });
  }
  b.block({ w: ex * 2, h: 0.3, d: ez * 2, x: 0, y: h, z: 0 });
  return b;
}

/**
 * A KURA: the storehouse, in thick white plaster over a black tile skirt, with
 * one heavy door and one small shuttered window. Solid — what is in a kura is
 * not somewhere a round goes. It is the building a brewery is made of, and a
 * row of them is the whitest thing in the valley.
 */
export function buildKura(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "kura");
  const w = p.width ?? 6;
  const d = p.depth ?? 5;
  const h = p.height ?? 5.4;
  b.box(w + 0.4, 0.45, d + 0.4, 0, 0.225, 0, GRANITE_DARK);
  b.box(w, h - 0.45, d, 0, 0.45 + (h - 0.45) / 2, 0, SHIKKUI);
  b.block({ w, h, d, x: 0, y: h / 2, z: 0 });
  // The namako skirt and its grid of white joints.
  const skirt = 1.5;
  b.box(w + 0.08, skirt, d + 0.08, 0, 0.45 + skirt / 2, 0, NAMAKO);
  const jointsX = Math.round(w / 0.5);
  const jointsZ = Math.round(d / 0.5);
  for (const sz of [-1, 1]) {
    for (let i = 1; i < jointsX; i++) {
      b.box(0.05, skirt, 0.03, -w / 2 + (i / jointsX) * w, 0.45 + skirt / 2, sz * (d / 2 + 0.055), SHIKKUI);
    }
  }
  for (const sx of [-1, 1]) {
    for (let i = 1; i < jointsZ; i++) {
      b.box(0.03, skirt, 0.05, sx * (w / 2 + 0.055), 0.45 + skirt / 2, -d / 2 + (i / jointsZ) * d, SHIKKUI);
    }
  }
  for (const y of [0.45 + skirt / 3, 0.45 + (2 * skirt) / 3]) {
    b.box(w + 0.12, 0.05, d + 0.12, 0, y, 0, SHIKKUI);
  }
  b.box(w + 0.16, 0.18, d + 0.16, 0, 0.45 + skirt + 0.09, 0, SUMI);
  // The door in its thick plaster frame, and the shuttered window over it.
  b.box(1.9, 2.6, 0.3, 0, 0.45 + 1.3, -d / 2 - 0.12, SHIKKUI);
  b.box(1.3, 2.1, 0.08, 0, 0.45 + 1.05, -d / 2 - 0.3, SUMI);
  b.box(1.0, 0.85, 0.2, 0, h - 1.25, -d / 2 - 0.08, SHIKKUI);
  b.box(0.7, 0.6, 0.06, 0, h - 1.25, -d / 2 - 0.2, SUMI);
  b.box(1.3, 0.1, 0.45, 0, h - 0.72, -d / 2 - 0.2, KAWARA);
  gableRoofX(b, w, d, 1.5, h, KAWARA, 0.45);
  return b;
}

/**
 * A TEAHOUSE: a paper room on a raised deck, under a curved tile roof, with the
 * deck carried round it as a veranda. The reference frame's hall on the right
 * is this building: every wall a lattice of glowing paper, the eaves wide
 * enough to stand under.
 *
 * The deck is walked at 0.55 — inside `stepHeight`, so it is stepped onto from
 * anywhere and the veranda is somewhere to fight from. The room is enterable
 * by one door on the front; its walls are paper and are drawn as paper, but
 * they are WALLS to a body and a round, because a room whose four sides stop
 * nothing is a gazebo. `lit` spends one light slot inside.
 */
export function buildTeahouse(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "teahouse");
  const w = p.width ?? 7;
  const d = p.depth ?? 6;
  const floorY = 0.55;
  const wallH = 2.5;
  const veranda = 1.2;
  const t = 0.18;
  // Footings, then the deck (walked first — see the kit header).
  for (const sx of [-1, 0, 1]) {
    for (const sz of [-1, 1]) {
      b.box(0.5, 0.3, 0.5, sx * (w / 2 + veranda - 0.3), 0.15, sz * (d / 2 + veranda - 0.3), GRANITE);
    }
  }
  b.box(w + veranda * 2, floorY - 0.25, d + veranda * 2, 0, 0.25 + (floorY - 0.25) / 2, 0, CEDAR);
  b.block({ w: w + veranda * 2, h: floorY, d: d + veranda * 2, x: 0, y: floorY / 2, z: 0 });
  b.box(w + veranda * 2 + 0.1, 0.12, d + veranda * 2 + 0.1, 0, floorY - 0.06, 0, HINOKI);

  const wy = floorY + wallH / 2;
  const door = 1.5;
  b.doorWall(w, wallH, t, 0, wy, -d / 2 + t / 2, SUMI, door, 2.0);
  b.wall(w, wallH, t, 0, wy, d / 2 - t / 2, SUMI);
  b.wall(t, wallH, d, -w / 2 + t / 2, wy, 0, SUMI);
  b.wall(t, wallH, d, w / 2 - t / 2, wy, 0, SUMI);

  // Paper on every face, between posts. The lower wainscot and the plaster
  // band over the lintel frame it.
  const paperY = floorY + 0.35 + (wallH - 0.85) / 2;
  const paperH = wallH - 0.85;
  const sideW = (w - door) / 2 - 0.2;
  for (const sx of [-1, 1]) {
    shoji(b, {
      cx: sx * (door / 2 + 0.1 + sideW / 2),
      cy: paperY,
      w: sideW,
      h: paperH,
      face: -d / 2,
      n: -1,
      lit: p.litWindows,
    });
  }
  shoji(b, { cx: 0, cy: paperY, w: w - 0.4, h: paperH, face: d / 2, n: 1, lit: p.litWindows });
  for (const sx of [-1, 1] as const) {
    shoji(b, {
      cx: 0,
      cy: paperY,
      w: d - 0.4,
      h: paperH,
      face: sx * (w / 2),
      n: sx,
      alongZ: true,
      lit: p.litWindows,
    });
  }
  b.box(w + 0.06, 0.45, d + 0.06, 0, floorY + wallH - 0.225, 0, SHIKKUI);
  b.box(w + 0.1, 0.12, d + 0.1, 0, floorY + wallH - 0.5, 0, SUMI);
  // Corner and veranda posts carrying the eave.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.box(0.2, wallH + 0.3, 0.2, sx * (w / 2 + 0.1), floorY + (wallH + 0.3) / 2, sz * (d / 2 + 0.1), SUMI);
      b.box(0.16, wallH + 0.25, 0.16, sx * (w / 2 + veranda - 0.2), floorY + (wallH + 0.25) / 2, sz * (d / 2 + veranda - 0.2), HINOKI);
    }
  }
  const eave = floorY + wallH + 0.25;
  const ex = w / 2 + veranda + 0.7;
  const ez = d / 2 + veranda + 0.7;
  curvedRoof(b, KAWARA, {
    y: eave,
    ex,
    ez,
    tx: Math.max(0.4, (w - d) / 2 + 0.6),
    tz: 0,
    rise: 2.6,
    curve: 1.55,
    upturn: 0.4,
    thick: 0.28,
  });
  ridge(b, Math.max(0.4, (w - d) / 2 + 0.6), eave + 2.6);
  b.block({ w: ex * 2, h: 0.3, d: ez * 2, x: 0, y: eave, z: 0 });
  if (p.lit) b.light("#ffb866", 9, 1.1, 0.06, 0, floorY + 1.8, 0);
  return b;
}

// --- the temple ------------------------------------------------------------------

/**
 * The TEMPLE HALL (hondo): a paper-walled hall on a granite plinth, ringed by
 * pillars carrying a roof that is taller than the hall under it, with the
 * altar's gilt glowing in the dark at the back.
 *
 * The plinth is walked at 0.55 and is the whole veranda — nineteen pillars on
 * it and the hall's walls set 1.6 m in from its edge — so it is a place to
 * fight along as well as a way in. The front has THREE doorways and each side
 * one, because a flag hall with one door is a corridor to die in. Everything
 * inside is one surface: a hall is one room, and the altar is cover.
 */
export function buildTempleHall(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "hondo");
  const w = p.width ?? 20;
  const d = p.depth ?? 15;
  const plinthH = 0.55;
  const ring = 1.6;
  const pw = w + ring * 2;
  const pd = d + ring * 2;
  const wallH = 5.0;
  const t = 0.3;
  const top = plinthH + wallH;

  // The plinth and its front steps (walked first).
  b.box(pw, plinthH, pd, 0, plinthH / 2, 0, GRANITE);
  b.block({ w: pw, h: plinthH, d: pd, x: 0, y: plinthH / 2, z: 0 });
  b.box(pw + 0.3, 0.12, pd + 0.3, 0, plinthH - 0.06, 0, GRANITE_DARK);
  b.box(7, 0.28, 1.1, 0, 0.14, -pd / 2 - 0.55, GRANITE_DARK);
  b.box(pw - 0.3, 0.05, pd - 0.3, 0, plinthH + 0.025, 0, CEDAR);

  // The walls, in segments round the openings.
  const wy = plinthH + wallH / 2;
  const segs: [number, number, boolean][] = [];
  {
    // Front: solid / door / solid / door / solid / door / solid, scaled to w.
    const unit = w / 20;
    const plan = [3, 3, 2, 4, 2, 3, 3];
    let x = -w / 2;
    plan.forEach((len, i) => {
      segs.push([x + (len * unit) / 2, len * unit, i % 2 === 1]);
      x += len * unit;
    });
  }
  const doorH = 3.4;
  const fz = -d / 2 + t / 2;
  for (const [cx, len, open] of segs) {
    if (open) {
      b.wall(len, wallH - doorH, t, cx, plinthH + doorH + (wallH - doorH) / 2, fz, SHIKKUI);
      b.box(len + 0.1, 0.25, 0.36, cx, plinthH + doorH, fz, SUMI);
    } else {
      b.wall(len, wallH, t, cx, wy, fz, SUMI);
      shoji(b, {
        cx,
        cy: plinthH + 1.9,
        w: len - 0.3,
        h: 2.6,
        face: -d / 2,
        n: -1,
        lit: p.litWindows,
      });
    }
  }
  b.wall(w, wallH, t, 0, wy, d / 2 - t / 2, SUMI);
  shoji(b, { cx: 0, cy: plinthH + 1.9, w: w - 1, h: 2.6, face: d / 2, n: 1, lit: false, cols: 24 });
  // `doorWall` only runs along X, so the side walls are laid out by hand.
  for (const sx of [-1, 1] as const) {
    const x = sx * (w / 2 - t / 2);
    const side = (d - 2.4) / 2;
    for (const sz of [-1, 1]) {
      b.wall(t, wallH, side, x, wy, sz * (1.2 + side / 2), SUMI);
      shoji(b, {
        cx: sz * (1.2 + side / 2),
        cy: plinthH + 1.9,
        w: side - 0.5,
        h: 2.6,
        face: sx * (w / 2),
        n: sx,
        alongZ: true,
        lit: p.litWindows,
      });
    }
    b.wall(t, wallH - doorH, 2.4, x, plinthH + doorH + (wallH - doorH) / 2, 0, SHIKKUI);
  }
  // The plaster band and beams over the paper.
  b.box(w + 0.08, 1.1, d + 0.08, 0, top - 0.55, 0, SHIKKUI);
  b.box(w + 0.14, 0.22, d + 0.14, 0, top - 1.2, 0, SUMI);
  b.box(w + 0.14, 0.22, d + 0.14, 0, top - 0.05, 0, SUMI);

  // Inside: four pillars, the altar and its gilt.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.cyl(wallH, 0.5, 0.52, 10, sx * w * 0.22, wy, sz * d * 0.18, HINOKI);
      b.block({ w: 0.42, h: wallH, d: 0.42, x: sx * w * 0.22, y: wy, z: sz * d * 0.18 });
    }
  }
  b.wall(w * 0.4, 1.0, 2.2, 0, plinthH + 0.5, d / 2 - 2.0, SUMI);
  b.box(w * 0.4 + 0.2, 0.1, 2.3, 0, plinthH + 1.05, d / 2 - 2.0, BRONZE);
  b.glow(2.2, 2.4, 0.3, 0, plinthH + 2.3, d / 2 - 2.2, GILT_GLOW);
  b.glow(0.6, 0.9, 0.3, -2.6, plinthH + 1.5, d / 2 - 2.2, GILT_GLOW);
  b.glow(0.6, 0.9, 0.3, 2.6, plinthH + 1.5, d / 2 - 2.2, GILT_GLOW);
  b.light("#ffb45a", 14, 1.2, 0.08, 0, plinthH + 2.6, d / 2 - 3.2);

  // The veranda pillars and the beam ring they carry.
  const pillarH = wallH + 0.9;
  const px = pw / 2 - 0.4;
  const pz = pd / 2 - 0.4;
  const colsX = Math.round((px * 2) / 3.6);
  const colsZ = Math.round((pz * 2) / 3.6);
  const pillar = (x: number, z: number): void => {
    b.cyl(pillarH, 0.46, 0.5, 10, x, plinthH + pillarH / 2, z, HINOKI);
    b.cyl(0.2, 0.75, 0.8, 8, x, plinthH + 0.1, z, GRANITE_DARK);
    b.block({ w: 0.4, h: pillarH, d: 0.4, x, y: plinthH + pillarH / 2, z });
  };
  for (let i = 0; i <= colsX; i++) {
    const x = -px + (i / colsX) * px * 2;
    pillar(x, -pz);
    pillar(x, pz);
  }
  for (let i = 1; i < colsZ; i++) {
    const z = -pz + (i / colsZ) * pz * 2;
    pillar(-px, z);
    pillar(px, z);
  }
  const beamY = plinthH + pillarH;
  for (const sz of [-1, 1]) b.box(px * 2 + 0.6, 0.4, 0.4, 0, beamY, sz * pz, SUMI);
  for (const sx of [-1, 1]) b.box(0.4, 0.4, pz * 2 + 0.6, sx * px, beamY, 0, SUMI);
  // The bracket band: the reference frame's hall reads as timber under its
  // eave because this is there.
  b.box(pw + 0.4, 0.5, pd + 0.4, 0, beamY + 0.45, 0, HINOKI);

  const eave = beamY + 0.7;
  const ex = pw / 2 + 2.4;
  const ez = pd / 2 + 2.4;
  const rx = (w - d) / 2 + 3;
  const rise = 6.4;
  curvedRoof(b, KAWARA, {
    y: eave,
    ex,
    ez,
    tx: rx,
    tz: 0,
    rise,
    curve: 1.75,
    upturn: 1.0,
    thick: 0.5,
    rings: 7,
    seg: 8,
  });
  ridge(b, rx, eave + rise);
  // Roofs last (see the kit header).
  b.block({ w: ex * 2, h: 0.4, d: ez * 2, x: 0, y: eave, z: 0 });
  return b;
}

/**
 * The FIVE-STOREY PAGODA: the valley's landmark, twenty-eight metres of it, and
 * the one thing on the map you can see from every flag.
 *
 * Five storeys each narrower than the last, each under a curved roof whose
 * eaves reach two metres past its walls, and the bronze spire with its nine
 * rings over the top. Only the plinth is walked; the storeys are solid,
 * because a pagoda has no floors to stand on and a perch over every flag with
 * one stair up it is a problem (see the kit header). The ground storey has a
 * door on each face with the lamp inside showing round it.
 */
export function buildPagoda(scene: Scene, mats: CelMaterialFactory): Structure {
  const b = new Build(scene, mats, "pagoda");
  const plinthH = 0.55;
  const base = 6.2;
  b.box(base + 4.4, plinthH, base + 4.4, 0, plinthH / 2, 0, GRANITE);
  b.block({ w: base + 4.4, h: plinthH, d: base + 4.4, x: 0, y: plinthH / 2, z: 0 });
  b.box(base + 4.7, 0.12, base + 4.7, 0, plinthH - 0.06, 0, GRANITE_DARK);
  for (const [sx, sz] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
    b.box(sx ? 1.0 : 3, 0.28, sz ? 1.0 : 3, sx * (base / 2 + 2.7), 0.14, sz * (base / 2 + 2.7), GRANITE_DARK);
  }

  const roofs: { w: number; y: number }[] = [];
  let y = plinthH;
  for (let i = 0; i < 5; i++) {
    const bw = base - 0.55 * i;
    const hb = i === 0 ? 3.6 : 2.1;
    b.box(bw, hb, bw, 0, y + hb / 2, 0, SHIKKUI);
    b.block({ w: bw, h: hb, d: bw, x: 0, y: y + hb / 2, z: 0 });
    // Posts at the corners and either side of the middle, bedded on the faces.
    for (const s of [-1, 1]) {
      for (const k of [-1, -0.33, 0.33, 1]) {
        b.box(0.24, hb, 0.14, (k * bw) / 2, y + hb / 2, s * (bw / 2 + 0.07), SHU);
        b.box(0.14, hb, 0.24, s * (bw / 2 + 0.07), y + hb / 2, (k * bw) / 2, SHU);
      }
    }
    b.box(bw + 0.2, 0.3, bw + 0.2, 0, y + hb - 0.15, 0, SHU);
    if (i === 0) {
      for (const [sx, sz] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
        const dw = sx ? 0.08 : 1.6;
        const dd = sz ? 0.08 : 1.6;
        b.glow(dw, 2.4, dd, (sx * bw) / 2 + sx * 0.05, y + 1.2, (sz * bw) / 2 + sz * 0.05, GILT_GLOW);
      }
    } else {
      // A balcony rail round each upper storey.
      b.box(bw + 1.2, 0.1, bw + 1.2, 0, y + 0.1, 0, HINOKI);
      for (const s of [-1, 1]) {
        b.box(bw + 1.2, 0.08, 0.08, 0, y + 0.75, s * (bw / 2 + 0.56), SHU);
        b.box(0.08, 0.08, bw + 1.2, s * (bw / 2 + 0.56), y + 0.75, 0, SHU);
      }
    }
    // The bracket band the eave sits on.
    b.box(bw + 0.9, 0.45, bw + 0.9, 0, y + hb + 0.22, 0, HINOKI);
    const eave = y + hb + 0.45;
    roofs.push({ w: bw, y: eave });
    const next = i < 4 ? base - 0.55 * (i + 1) : 0.7;
    const top = i < 4;
    curvedRoof(b, KAWARA, {
      y: eave,
      ex: bw / 2 + 2.0,
      ez: bw / 2 + 2.0,
      tx: next / 2,
      tz: next / 2,
      rise: top ? 1.25 : 2.6,
      curve: 1.6,
      upturn: 0.6,
      thick: 0.34,
      seg: 6,
    });
    y = eave + 0.95;
  }
  // The spire: a pedestal, the pole, nine rings, the flame and the jewel.
  const spire = y - 0.95 + 2.6;
  b.box(1.0, 0.8, 1.0, 0, spire + 0.2, 0, BRONZE);
  b.cyl(7.2, 0.18, 0.26, 8, 0, spire + 4.2, 0, BRONZE);
  for (let r = 0; r < 9; r++) {
    const dia = 1.05 - r * 0.05;
    b.cyl(0.12, dia, dia, 10, 0, spire + 1.2 + r * 0.52, 0, VERDIGRIS);
  }
  b.cyl(0.9, 0.1, 0.7, 8, 0, spire + 6.6, 0, VERDIGRIS);
  b.cyl(0.45, 0.02, 0.36, 8, 0, spire + 7.8, 0, BRONZE);
  // Roofs last.
  for (const r of roofs) {
    b.block({ w: r.w + 4.0, h: 0.3, d: r.w + 4.0, x: 0, y: r.y, z: 0 });
  }
  return b;
}

/**
 * The TEMPLE GATE: a roofed gateway four and a half metres wide, with plastered
 * wings either side for the precinct wall to run into. `tint` recolours the
 * posts (vermilion for a shrine, cypress for a temple — the default).
 */
export function buildTempleGate(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "sanmon");
  const opening = 4.6;
  const wing = 2.4;
  const w = opening + wing * 2;
  const d = 4.2;
  const h = 4.6;
  const color = p.tint ?? HINOKI;
  b.box(w + 0.6, 0.3, d, 0, 0.15, 0, GRANITE_DARK);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 0, 1]) {
      const x = (sx * opening) / 2;
      const z = (sz * (d - 0.8)) / 2;
      const dia = sz === 0 ? 0.62 : 0.44;
      b.cyl(h, dia, dia, 10, x, h / 2, z, color);
      b.block({ w: dia * 0.85, h, d: dia * 0.85, x, y: h / 2, z });
    }
    // The wing: plaster between a post and the corner.
    const wx = sx * (opening / 2 + wing / 2);
    b.wall(wing, h - 0.4, 0.5, wx, (h - 0.4) / 2, 0, SHIKKUI);
    b.box(0.3, h, 0.6, sx * (w / 2 - 0.15), h / 2, 0, color);
    b.box(wing, 0.25, 0.56, wx, h - 0.55, 0, SUMI);
    b.box(wing, 0.5, 0.56, wx, 0.25, 0, SUMI);
  }
  // Lintels and tie beams.
  for (const sz of [-1, 0, 1]) {
    b.box(w, 0.36, 0.3, 0, h - 0.2, (sz * (d - 0.8)) / 2, color);
  }
  for (const sx of [-1, 1]) b.box(0.3, 0.36, d, (sx * opening) / 2, h - 0.6, 0, color);
  b.box(w + 0.6, 0.5, d + 0.4, 0, h + 0.2, 0, HINOKI);
  const eave = h + 0.45;
  const ex = w / 2 + 1.3;
  const ez = d / 2 + 1.5;
  curvedRoof(b, KAWARA, {
    y: eave,
    ex,
    ez,
    tx: w / 2 - 1.0,
    tz: 0,
    rise: 2.9,
    curve: 1.6,
    upturn: 0.55,
    thick: 0.32,
  });
  ridge(b, w / 2 - 1.0, eave + 2.9);
  b.block({ w: ex * 2, h: 0.3, d: ez * 2, x: 0, y: eave, z: 0 });
  return b;
}

/**
 * The BELL TOWER (shoro): four splayed posts on a granite plinth, a curved
 * roof, and the bronze bell hung in the middle with the striking log beside
 * it. A precinct's second silhouette after its hall.
 */
export function buildBellTower(scene: Scene, mats: CelMaterialFactory): Structure {
  const b = new Build(scene, mats, "shoro");
  const plinthH = 0.55;
  b.box(5.2, plinthH, 5.2, 0, plinthH / 2, 0, GRANITE);
  b.block({ w: 5.2, h: plinthH, d: 5.2, x: 0, y: plinthH / 2, z: 0 });
  const postH = 4.4;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * 1.55;
      const z = sz * 1.55;
      b.cyl(postH, 0.34, 0.42, 8, x, plinthH + postH / 2, z, HINOKI, {
        x: -sz * 0.05,
        z: sx * 0.05,
      });
      b.block({ w: 0.36, h: postH, d: 0.36, x, y: plinthH + postH / 2, z });
    }
  }
  for (const s of [-1, 1]) {
    b.box(3.8, 0.3, 0.3, 0, plinthH + postH - 0.2, s * 1.5, SUMI);
    b.box(0.3, 0.3, 3.8, s * 1.5, plinthH + postH - 0.2, 0, SUMI);
    b.box(3.6, 0.2, 0.2, 0, plinthH + 1.0, s * 1.58, HINOKI);
  }
  // The bell and its log.
  const bellY = plinthH + postH - 1.9;
  b.cyl(1.7, 1.05, 1.22, 14, 0, bellY, 0, BRONZE);
  b.cyl(0.25, 0.6, 1.05, 14, 0, bellY + 0.97, 0, BRONZE);
  b.box(0.25, 0.7, 0.25, 0, bellY + 1.45, 0, SUMI);
  b.cyl(1.8, 0.2, 0.22, 8, 1.4, bellY + 0.1, 0, CEDAR, { z: Math.PI / 2 });
  b.block({ w: 1.1, h: 1.7, d: 1.1, x: 0, y: bellY, z: 0 });
  const eave = plinthH + postH + 0.1;
  curvedRoof(b, KAWARA, {
    y: eave,
    ex: 3.3,
    ez: 3.3,
    tx: 0.8,
    tz: 0,
    rise: 2.5,
    curve: 1.6,
    upturn: 0.55,
    thick: 0.3,
  });
  ridge(b, 0.8, eave + 2.5);
  b.block({ w: 6.6, h: 0.3, d: 6.6, x: 0, y: eave, z: 0 });
  return b;
}

/**
 * A GARDEN WALL (tsuijibei): earthen plaster on a stone course, under its own
 * little tiled roof, with the three white lines a temple's wall carries. Runs
 * along X for `length`. Built LEVEL — it stands on a precinct, and the
 * generator lays these only on ground it has flattened; a run across a slope
 * owes `groundRun`, which this does not take.
 */
export function buildGardenWall(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "tsuijibei");
  const len = p.length ?? 12;
  const h = p.height ?? 2.4;
  const plaster = p.tint ?? TSUCHI;
  b.box(len, 0.5, 0.95, 0, 0.25, 0, GRANITE_DARK);
  b.box(len, h - 0.5, 0.7, 0, 0.5 + (h - 0.5) / 2, 0, plaster);
  b.block({ w: len, h, d: 0.8, x: 0, y: h / 2, z: 0 });
  if (plaster === TSUCHI) {
    for (let i = 0; i < 3; i++) {
      b.box(len, 0.06, 0.74, 0, h - 0.55 - i * 0.2, 0, SHIKKUI);
    }
  }
  for (const s of [-1, 1]) {
    b.box(len + 0.1, 0.1, 0.62, 0, h + 0.16, s * 0.25, KAWARA, { x: s * 0.5 });
  }
  b.box(len + 0.2, 0.18, 0.26, 0, h + 0.33, 0, KAWARA_DARK);
  return b;
}

// --- the bridge ------------------------------------------------------------------

/** Walked height of the arch's crown over LOCAL ZERO, which is bank grade. */
const ARCH_CROWN = 1.7;
/** Approach grade — the trestle's argument, under `MAX_WALKABLE_GRADE`. */
const ARCH_GRADE = 0.3;
/** How far each approach runs on into the bank to be buried. */
const ARCH_DROP = 0.6;

/**
 * The ARCHED BRIDGE (taikobashi): vermilion rails over a plank deck that rises
 * to a crown and falls away again, with bronze caps on its posts and stone
 * abutments in the water.
 *
 * **It is `buildTrestleBridge` in everything that is walked**, and the same
 * placement rule applies: local zero is BANK grade, so a placement over the
 * channel states `y` as minus the bed's depth at its centre. The deck is flat
 * over the water span and the approaches are straight ramps at 0.3 either
 * side — a curve would be steeper than the nav graph links at its ends — so
 * the ARCH is in the drawing: a vermilion fascia under each rail follows a
 * true arc from one bank to the other, which is what the eye reads.
 */
export function buildArchBridge(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "taikobashi");
  const len = p.length ?? 10;
  const w = p.width ?? 3.0;
  const rise = ARCH_CROWN + ARCH_DROP;
  const run = rise / ARCH_GRADE;
  const pitch = Math.atan(ARCH_GRADE);
  const slab = Math.hypot(run, rise);
  const deckT = 0.45;
  const rampT = 0.4;

  b.wall(w, deckT, len, 0, ARCH_CROWN - deckT / 2, 0, CEDAR);
  for (const s of [-1, 1]) {
    const midZ = s * (len / 2 + run / 2);
    const surface = ARCH_CROWN - rise / 2;
    const y = surface - rampT / 2 / Math.cos(pitch);
    b.box(w, rampT, slab, 0, y, midZ, CEDAR, { x: s * pitch });
    b.block({ w, h: rampT, d: slab, x: 0, y, z: midZ, rotX: s * pitch });
    // Stone abutments where the arch meets the water, and a sill at each foot.
    b.box(w + 1.2, 2.4, 1.4, 0, ARCH_CROWN - 1.7, s * (len / 2 + 0.2), GRANITE_DARK);
    b.box(w + 0.6, 0.6, 0.8, 0, -0.35, s * (len / 2 + run - 0.3), GRANITE_DARK);
  }

  // The arch the eye reads: a vermilion fascia on each side, a true arc from
  // foot to foot, drawn as short chords.
  const span = len + run * 2;
  const chords = 14;
  const arcRise = ARCH_CROWN + 0.2;
  const R = (span * span) / (8 * arcRise) + arcRise / 2;
  const arcY = (z: number): number => Math.sqrt(Math.max(0, R * R - z * z)) - (R - arcRise) - 0.35;
  for (let i = 0; i < chords; i++) {
    const z0 = -span / 2 + (i / chords) * span;
    const z1 = -span / 2 + ((i + 1) / chords) * span;
    const y0 = arcY(z0);
    const y1 = arcY(z1);
    const ang = Math.atan2(y0 - y1, z1 - z0);
    for (const sx of [-1, 1]) {
      b.box(0.14, 0.42, Math.hypot(z1 - z0, y1 - y0) + 0.02, sx * (w / 2 + 0.07), (y0 + y1) / 2, (z0 + z1) / 2, SHU, {
        x: ang,
      });
    }
  }

  for (const side of ["-x", "+x"] as const) {
    const sx = side === "+x" ? 1 : -1;
    const edge = (sx * w) / 2;
    b.guard(side, edge, 0, len, ARCH_CROWN, { color: SHU, height: 0.95 });
    for (const s of [-1, 1]) {
      b.guard(side, edge, s * (len / 2 + run / 2), run, ARCH_CROWN - rise / 2, {
        pitch: -s * pitch,
        color: SHU,
        height: 0.95,
      });
    }
    const postX = (sx * (w + GUARD_THICKNESS)) / 2;
    const posts: [number, number][] = [
      [-len / 2, ARCH_CROWN],
      [len / 2, ARCH_CROWN],
      [-len / 2 - run + 0.8, ARCH_CROWN - rise + 0.8 * ARCH_GRADE],
      [len / 2 + run - 0.8, ARCH_CROWN - rise + 0.8 * ARCH_GRADE],
    ];
    for (const [z, sy] of posts) {
      b.box(0.24, 1.2, 0.24, postX, sy + 0.6, z, SHU);
      b.cyl(0.3, 0.05, 0.3, 8, postX, sy + 1.35, z, BRONZE);
    }
  }
  return b;
}
