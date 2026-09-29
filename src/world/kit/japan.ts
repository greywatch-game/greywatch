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
import { mulberry32 } from "../rng";
import {
  Build,
  type BuildCtx,
  type BuildParams,
  type Point3,
  type Side,
  type Structure,
  GUARD_THICKNESS,
  HIDE_UNDER,
  StoneBatch,
  VERDIGRIS,
  carve,
  convexSolid,
  hideBack,
  limb,
  orient,
  outward,
  runsAlongX,
  streetSeed,
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
/**
 * Persimmons drying under a farm's eave — the maples' own fallen flame
 * (`Props.ts`'s `FALLEN`), so the fruit shares the leaf litter's material
 * rather than adding a draw to every block a farm stands in.
 */
const KAKI = "#c9602a";

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
  /**
   * The slice of the slope drawn, as ring fractions (default the whole of
   * it): a COURSE of thatch is a band from the eave up to `to`.
   */
  from?: number;
  to?: number;
  /** Lifts the whole sheet: a course proud of the roof it lies on, or a tier under its eave. */
  raise?: number;
  /** Pushes every ring out by this much: a tier standing out of the eave's cut face. */
  grow?: number;
  /** Closes the top ring with a riser, for a band whose top edge is seen. */
  closeTop?: boolean;
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
 * the lower one both run straight across it — unless the sheet is a BAND
 * (`to` short of 1) whose top edge is seen, which `closeTop` closes.
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
  const from = o.from ?? 0;
  const to = o.to ?? 1;
  const raise = o.raise ?? 0;
  const grow = o.grow ?? 0;

  const ring = (k: number, drop: number): V3[] => {
    const t = from + ((to - from) * k) / rings;
    const hx = o.ex + (o.tx - o.ex) * t + grow;
    const hz = o.ez + (o.tz - o.ez) * t + grow;
    const h = o.y + o.rise * Math.pow(t, curve) + raise - drop;
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
    if (o.closeTop) {
      const ta = top[rings][j];
      const tc = top[rings][n];
      const inward: V3 = [cx - (ta[0] + tc[0]) / 2, 0, cz - (ta[2] + tc[2]) / 2];
      m.quad(ta, tc, bot[rings][n], bot[rings][j], inward);
    }
  }
  b.surface(m.data(), color);
}

/**
 * Where a `curvedRoof` sheet stands over plan point (x, z): its upper surface,
 * or with `under` its underside — the smooth surface its rings sample. The
 * profile is convex along both of the ring's directions, so the drawn facets
 * are chords that never fall below what this returns: a member hung under the
 * sheet by this height is covered at its top, and a tile laid on it by this
 * height sits on it to within a couple of centimetres. Only a full sheet
 * (`from` 0, `to` 1) is described.
 */
function roofHeight(o: RoofSpec, x: number, z: number, under = false): number {
  const grow = o.grow ?? 0;
  const ax = Math.abs(x - (o.x ?? 0));
  const az = Math.abs(z - (o.z ?? 0));
  const tX = (o.ex + grow - ax) / (o.ex - o.tx);
  const tZ = (o.ez + grow - az) / (o.ez - o.tz);
  const t = Math.max(0, Math.min(1, tX, tZ));
  const hx = o.ex + (o.tx - o.ex) * t + grow;
  const hz = o.ez + (o.tz - o.ez) * t + grow;
  // The point lies on the ring's side whose outward axis gave the smaller t,
  // and `u` runs along that side exactly as the ring loop's does.
  const u = Math.min(1, tZ <= tX ? ax / hx : az / hz);
  const lift = (o.upturn ?? 0) * (1 - t) * (1 - t) * u * u * u;
  return o.y + o.rise * Math.pow(t, o.curve ?? 1.6) + (o.raise ?? 0) + lift - (under ? (o.thick ?? 0.3) : 0);
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
 * A MACHIYA: the narrow townhouse the street is made of — a Kyoto merchant's
 * house of the late Edo period, built as a TSUSHI-NIKAI: a full ground floor
 * that is the shop, and over it a low loft under the roof, lit by slits in the
 * plaster. A street of them is one lattice front after another under one run
 * of pent roofs, which is what makes a row read as a street rather than a
 * terrace of boxes.
 *
 * - **The shop front (omote)**: posts and a deep head beam framing two bays
 *   either side of the door, each bay a lattice (kōshi) on a sill under a rail
 *   (kamoi), paper behind it — or the room's glow when `litWindows` is set —
 *   and a transom over it with a small lattice light. The lattice is one of
 *   three a street really had: close-set slats (senbon-gōshi), full slats
 *   with short ones hung between them in the top (kiriko), or heavy slats with
 *   thin ones between them stopped short of the sill (oya-ko). Before a bay
 *   there may stand a curved bamboo fence (inuyarai) that keeps dogs and
 *   splashing carts off the lattice, or the shop's bench (battari-shōgi)
 *   folded up against it for the night.
 * - **The door**: a noren on a rod from the kamoi, dyed with the house's mark
 *   (the kura's `KURA_CRESTS` — a merchant's mark is the same mark on the
 *   storehouse and the shop), a granite step before it, and — when the house
 *   is not `enterable` — a pair of lattice leaves over a boarded kick rail,
 *   shut. A signboard (kanban) under its own tile cap hangs on a corner post
 *   of half of them.
 * - **The pent roof (hisashi)**: a tile sheet with round tiles down it and the
 *   straight-edged eave tile (ichimonji-gawara) that is the Kyoto street's own
 *   line, on rafters, an eave beam and bracket arms out of the posts. A
 *   clay Shōki stands guard on a third of them.
 * - **The fire walls (udatsu)**: a plaster wall standing on the hisashi at
 *   each end, cut to its slope, with a timber edge and a tile coping — what
 *   stops a fire walking along the row, and what a merchant who could afford
 *   one built high.
 * - **The loft**: three plaster slit windows (mushiko-mado) in raised frames
 *   on sills, or two of them either side of a timber lattice window with a
 *   bamboo blind let down inside it; timber at the corners, an eave beam, and
 *   the rafter ends under the eave.
 * - **The roof**: a thick tile sheet with round tiles, end tiles and verge
 *   tiles, a ridge of courses banded in white mortar with a demon tile at each
 *   end, and on half of them the kitchen's smoke vent (kemuridashi) standing
 *   over the ridge under a little roof of its own. The gables are plaster.
 * - **The ends and the back**: aged boarding under battens to the height of a
 *   hand, plaster over it framed by posts, the floor beam and the wall plate;
 *   the back has its own door under a tile hood, a lattice window and a loft
 *   slit. A granite plinth runs round all four sides, carried down to the
 *   ground under its lowest corner.
 *
 * `enterable` hollows the ground floor behind the doorway; the upper storey is
 * its ceiling, as the townhouse's is. `tint` is the plaster.
 *
 * Seeded by where it stands (`streetSeed`), which is why it is in
 * `CONFORMS_TO_TERRAIN`: the lattice, what stands before each bay, the
 * signboard, the Shōki, the loft window, the vent, the back door and the
 * mark on the noren all vary along a street of 47.
 *
 * **The colliders are unchanged, byte for byte and in the same order** — the
 * ground floor's walls and the loft (`doorWall` and `wall` spelled out when it
 * is enterable, the two masses when it is not), then the retired `gableRoofX`'s flat slab
 * at the eave. Everything drawn is on a face (nothing more than 0.3 m proud
 * below the hisashi — inside any body's radius), ankle high (the plinth's lip
 * and the step), or overhead (the hisashi, its brackets and everything on
 * it). The repeated work is laid through `StoneBatch`, one surface per colour.
 */
export function buildMachiya(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "machiya");
  const w = p.width ?? 7;
  const d = p.depth ?? 11;
  const plaster = p.tint ?? SHIKKUI;
  const lit = !!p.litWindows;
  const t = 0.3;
  const g = 3.3;
  const up = 2.4;
  const h = g + up;
  const door = 1.8;
  const doorH = 2.3;
  const overhang = 0.55;

  // --- colliders, exactly as they were: the ground floor's walls (the old
  // `doorWall` and `wall` calls) or its mass, the loft, then the roof slab at
  // the eave (the old `gableRoofX`'s).
  if (p.enterable) {
    const side = (w - door) / 2;
    const off = door / 2 + side / 2;
    const fz = -d / 2 + t / 2;
    const lintel = g - doorH;
    b.block({ w: side, h: g, d: t, x: 0 - off, y: g / 2, z: fz });
    b.block({ w: side, h: g, d: t, x: 0 + off, y: g / 2, z: fz });
    b.block({ w: door, h: lintel, d: t, x: 0, y: g / 2 + g / 2 - lintel / 2, z: fz });
    b.block({ w, h: g, d: t, x: 0, y: g / 2, z: d / 2 - t / 2 });
    b.block({ w: t, h: g, d, x: -w / 2 + t / 2, y: g / 2, z: 0 });
    b.block({ w: t, h: g, d, x: w / 2 - t / 2, y: g / 2, z: 0 });
    b.block({ w, h: up, d, x: 0, y: g + up / 2, z: 0 });
  } else {
    b.block({ w, h: g, d, x: 0, y: g / 2, z: 0 });
    b.block({ w, h: up, d, x: 0, y: g + up / 2, z: 0 });
  }
  b.block({ w: w + overhang * 2, h: 0.3, d: d + overhang * 2, x: 0, y: h, z: 0 });

  // --- everything below is drawing -------------------------------------------
  const rnd = mulberry32(streetSeed(w, d, h, ctx));
  const lattice = Math.floor(rnd() * 3);
  const bays = [0, 1].map(() => {
    const r = rnd();
    return r < 0.45 ? "fence" : r < 0.7 ? "bench" : "none";
  });
  const kanban = rnd() < 0.55 ? (rnd() < 0.5 ? -1 : 1) : 0;
  const shoki = rnd() < 0.35;
  const loftWindow = rnd() < 0.5;
  const blind = 0.3 + rnd() * 0.5;
  const vent = rnd() < 0.5;
  const ventX = (rnd() - 0.5) * Math.max(0, w - 2.6);
  const backDoorU = (rnd() < 0.5 ? -1 : 1) * (w / 2 - 1.1);
  const mark = KURA_CRESTS[Math.floor(rnd() * KURA_CRESTS.length)];

  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };
  const foot =
    Math.min(
      0,
      ground(-w / 2 - 0.2, -d / 2 - 0.2),
      ground(w / 2 + 0.2, -d / 2 - 0.2),
      ground(-w / 2 - 0.2, d / 2 + 0.2),
      ground(w / 2 + 0.2, d / 2 + 0.2),
    ) - 0.08;

  const sb = new StoneBatch();
  const PL = 0.25;
  const F = -d / 2;
  const wallFace = (s: Side): number => (runsAlongX(s) ? d / 2 : w / 2);
  const SIDES: Side[] = ["-z", "+z", "-x", "+x"];
  /** A member on side `s`'s face, `out` from the face to its own centre. */
  const on = (
    s: Side,
    u: number,
    y: number,
    along: number,
    tall: number,
    thick: number,
    out: number,
    color: string,
  ): void => sb.onFace(s, wallFace(s), u, y, along, tall, thick, out, color, 0, 0, hideBack(s));
  /** A glow on side `s` (±z only), `out` from the face to its centre. */
  const glowOn = (s: Side, u: number, y: number, along: number, tall: number, out: number): void => {
    b.glow(along, tall, 0.02, u, y, outward(s) * (d / 2 + out), SHOJI_GLOW);
  };
  /** A bamboo or timber member on the street face from (oA, yA) to (oB, yB), `o` out from the face. */
  const lean = (
    u: number,
    oA: number,
    yA: number,
    oB: number,
    yB: number,
    color: string,
    hide: number,
    wide = 0.035,
  ): void => {
    const len = Math.hypot(yB - yA, oA - oB);
    const a = Math.atan2(oA - oB, yB - yA);
    sb.box(wide, len, wide, u, (yA + yB) / 2, F - (oA + oB) / 2, color, { x: a }, hide);
  };

  // --- the plinth: dressed granite round a dark core, down to the ground ---
  const plinthH = PL - foot;
  for (const s of SIDES) {
    const run = runsAlongX(s) ? w / 2 + 0.2 : d / 2 + 0.04;
    let u = -run;
    while (run - u > 0.05) {
      let len = 1.1 + rnd() * 0.8;
      if (run - (u + len) < 0.6) len = run - u;
      sb.onFace(s, wallFace(s) + 0.04, u + len / 2, foot + plinthH / 2 + 0.005, len - 0.022, plinthH + 0.01, 0.16, 0.08, GRANITE, 0, 0, hideBack(s));
      u += len;
    }
  }

  // --- the shop front: posts, the head beam and the kamoi ---------------------
  for (const sx of [-1, 1]) {
    on("-z", sx * (w / 2 - 0.13), (PL + g) / 2, 0.26, g - PL, 0.2, 0.1, SUMI);
    on("-z", sx * (door / 2 + 0.08), (PL + g - 0.3) / 2, 0.16, g - 0.3 - PL, 0.16, 0.08, SUMI);
  }
  on("-z", 0, g - 0.15, w + 0.1, 0.3, 0.24, 0.12, SUMI);
  on("-z", 0, doorH + 0.06, w - 0.52, 0.12, 0.16, 0.08, SUMI);

  // The two bays: sill, paper, lattice, rails, the transom, and what stands
  // before each.
  const u0 = door / 2 + 0.16;
  const u1 = w / 2 - 0.26;
  const bw = u1 - u0;
  const y0 = PL + 0.14;
  const y1 = doorH;
  const ty0 = doorH + 0.12;
  const ty1 = g - 0.3;
  for (const [i, sx] of [-1, 1].entries()) {
    const cx = (sx * (u0 + u1)) / 2;
    on("-z", cx, PL + 0.07, bw, 0.14, 0.14, 0.07, SUMI);
    if (lit) glowOn("-z", cx, (y0 + y1) / 2, bw, y1 - y0, 0.02);
    else on("-z", cx, (y0 + y1) / 2, bw, y1 - y0, 0.03, 0.015, PAPER);
    const slat = (u: number, ya: number, yb: number, wide: number): void =>
      on("-z", u, (ya + yb) / 2, wide, yb - ya, 0.06, 0.11, SUMI);
    const at = (f: number): number => cx - bw / 2 + f * bw;
    if (lattice === 0) {
      const n = Math.max(6, Math.round(bw / 0.11));
      for (let k = 1; k < n; k++) slat(at(k / n), y0, y1, 0.045);
    } else if (lattice === 1) {
      const n = Math.max(5, Math.round(bw / 0.15));
      for (let k = 1; k < n; k++) slat(at(k / n), y0, y1, 0.05);
      for (let k = 0; k < n; k++) slat(at((k + 0.5) / n), y1 - 0.55, y1, 0.035);
    } else {
      const n = Math.max(3, Math.round(bw / 0.38));
      for (let k = 1; k < n; k++) slat(at(k / n), y0, y1, 0.075);
      for (let k = 0; k < n; k++) {
        for (let j = 1; j <= 3; j++) slat(at((k + j / 4) / n), y0 + 0.45, y1, 0.03);
      }
    }
    on("-z", cx, y0 + 0.05, bw, 0.08, 0.04, 0.16, SUMI);
    on("-z", cx, y1 - 0.05, bw, 0.08, 0.04, 0.16, SUMI);

    // The transom: plaster, with a small lattice light in it.
    on("-z", cx, (ty0 + ty1) / 2, bw, ty1 - ty0, 0.03, 0.015, plaster);
    const rw = Math.min(0.9, bw - 0.5);
    const rh = 0.3;
    const ry = (ty0 + ty1) / 2;
    if (lit) glowOn("-z", cx, ry, rw, rh, 0.04);
    else on("-z", cx, ry, rw, rh, 0.02, 0.04, PAPER);
    for (let k = 0; k <= 4; k++) {
      on("-z", cx - rw / 2 + (k / 4) * rw, ry, k === 0 || k === 4 ? 0.06 : 0.03, rh + 0.06, 0.04, 0.06, SUMI);
    }
    for (const e of [-1, 1]) on("-z", cx, ry + (e * rh) / 2, rw, 0.05, 0.04, 0.06, SUMI);

    if (bays[i] === "fence") {
      // The inuyarai: bamboo from the ground out past the plinth, up to a
      // knee and back to the lattice, banded twice.
      const n = Math.max(8, Math.round(bw / 0.12));
      for (let k = 0; k <= n; k++) {
        const u = cx - bw / 2 + 0.04 + (k / n) * (bw - 0.08);
        const gy = ground(u, F - 0.3);
        lean(u, 0.3, gy - 0.05, 0.27, 0.45, HINOKI, HIDE_UNDER);
        lean(u, 0.27, 0.45, 0.1, 0.95, HINOKI, 1 << 2);
      }
      sb.box(bw, 0.045, 0.04, cx, 0.45, F - 0.3, SUMI);
      sb.box(bw, 0.045, 0.04, cx, 0.85, F - 0.165, SUMI);
    } else if (bays[i] === "bench") {
      // The battari-shōgi folded up for the night: its top against the
      // lattice, its legs folded flat on it.
      const bl = bw - 0.24;
      on("-z", cx, 0.78, bl, 0.62, 0.045, 0.19, HINOKI);
      for (const e of [-1, 1]) on("-z", cx + e * (bl / 2 - 0.12), 0.78, 0.06, 0.5, 0.04, 0.23, SUMI);
      on("-z", cx, 0.55, bl - 0.3, 0.05, 0.04, 0.23, SUMI);
    }
  }

  // --- the door ----------------------------------------------------------------
  if (!p.enterable) {
    // A pair of lattice leaves, shut, over a boarded kick rail.
    const dm = (PL + doorH) / 2;
    if (lit) glowOn("-z", 0, dm, door, doorH - PL, 0.02);
    else on("-z", 0, dm, door, doorH - PL, 0.03, 0.015, PAPER);
    on("-z", 0, PL + 0.2, door, 0.4, 0.04, 0.06, HINOKI);
    for (const e of [-1, 0, 1]) on("-z", (e * (door - 0.08)) / 2, dm, 0.08, doorH - PL, 0.05, 0.075, SUMI);
    on("-z", 0, doorH - 0.04, door, 0.08, 0.05, 0.075, SUMI);
    on("-z", 0, 1.35, door, 0.05, 0.05, 0.075, SUMI);
    for (const e of [-1, 1]) {
      const lc = (e * door) / 4;
      const lw = door / 2 - 0.08;
      const n = Math.round(lw / 0.1);
      for (let k = 1; k < n; k++) {
        on("-z", lc - lw / 2 + (k / n) * lw, (PL + 0.4 + doorH - 0.08) / 2, 0.03, doorH - 0.48 - PL, 0.03, 0.07, SUMI);
      }
    }
  }
  // The step before it, carried down to the ground.
  const stepG = ground(0, F - 0.5);
  const stepH = 0.15 + Math.max(0, stepG - foot);
  sb.box(door + 0.2, stepH, 0.4, 0, stepG + 0.15 - stepH / 2, F - 0.5, GRANITE);
  // The noren on its rod, with the house's mark on it.
  b.translucentBox(door + 0.2, 0.75, 0.04, 0, 1.95, F - 0.22, NOREN, TRANSLUCENCY.awning);
  on("-z", 0, doorH + 0.03, door + 0.4, 0.04, 0.04, 0.22, SUMI);
  for (const e of [-1, 1]) on("-z", e * (door / 2 + 0.12), doorH + 0.06, 0.04, 0.05, 0.12, 0.18, SUMI);
  for (const [du, dy, mw, mh] of mark) {
    on("-z", du * 0.45, 2.0 + dy * 0.45, mw * 0.45, mh * 0.45, 0.012, 0.247, PAPER);
  }
  // The signboard, on a corner post.
  if (kanban) {
    const ku = kanban * (w / 2 - 0.13);
    on("-z", ku, 1.6, 0.3, 1.2, 0.04, 0.22, HINOKI);
    on("-z", ku, 2.24, 0.38, 0.06, 0.12, 0.2, KAWARA_DARK);
    for (let k = 0; k < 4; k++) {
      on("-z", ku, 1.95 - k * 0.24, 0.14 + (k % 2) * 0.04, 0.12, 0.012, 0.246, SUMI);
    }
  }

  // --- the hisashi -------------------------------------------------------------
  const HIS = 1.1;
  const HP = 0.36;
  const cosH = Math.cos(HP);
  const sinH = Math.sin(HP);
  const hLen = HIS / cosH;
  const hy = g + 0.05;
  const hz = F - HIS / 2;
  const hisW = w + 0.3;
  /** A point `lift` off the sheet's mid-plane and `along` it toward the wall. */
  const hAt = (lift: number, along: number): [number, number] => [
    hy + cosH * lift + sinH * along,
    hz - sinH * lift + cosH * along,
  ];
  sb.box(hisW, 0.14, hLen, 0, hy, hz, KAWARA, { x: -HP });
  const hr = Math.round(hisW / 0.26);
  for (let k = 0; k < hr; k++) {
    const x = -hisW / 2 + (hisW / hr) * (k + 0.5);
    const [ry, rz] = hAt(0.11, 0.05);
    sb.box(0.1, 0.08, hLen - 0.1, x, ry, rz, KAWARA_DARK, { x: -HP }, HIDE_UNDER | (1 << 4) | (1 << 5));
    const [ey, ez] = hAt(0.12, -hLen / 2 + 0.03);
    sb.box(0.15, 0.13, 0.06, x, ey, ez, KAWARA_DARK, { x: -HP }, HIDE_UNDER | (1 << 4));
  }
  // The straight-edged eave tile along its foot.
  const [iy, iz] = hAt(0.02, -hLen / 2 - 0.02);
  sb.box(hisW + 0.04, 0.16, 0.05, 0, iy, iz, KAWARA_DARK);
  // Rafters under the sheet, the eave beam across them, and an arm out of
  // each post to carry it.
  const nr = Math.max(6, Math.round(w / 0.4));
  for (let k = 0; k <= nr; k++) {
    const [ty, tz] = hAt(-0.105, 0.05);
    sb.box(0.06, 0.07, hLen - 0.1, -w / 2 + 0.1 + (k / nr) * (w - 0.2), ty, tz, SUMI, { x: -HP }, (1 << 2) | (1 << 4));
  }
  const [by, bz] = hAt(-0.21, -hLen / 2 + 0.3);
  sb.box(w + 0.1, 0.14, 0.12, 0, by, bz, SUMI);
  for (const u of [-(w / 2 - 0.13), -(door / 2 + 0.08), door / 2 + 0.08, w / 2 - 0.13]) {
    const armLen = F - (bz - 0.1);
    sb.box(0.1, 0.12, armLen, u, by - 0.13, F - armLen / 2, SUMI);
  }
  if (shoki) {
    // The clay Shōki, sword up, guarding the door against what comes down
    // the street.
    const [sy, sz] = hAt(0.07, 0.1);
    sb.box(0.24, 0.08, 0.2, 0, sy + 0.04, sz, KAWARA_DARK);
    sb.box(0.18, 0.26, 0.13, 0, sy + 0.2, sz, KAWARA_DARK);
    sb.box(0.11, 0.11, 0.11, 0, sy + 0.38, sz, KAWARA_DARK);
    sb.box(0.2, 0.04, 0.12, 0, sy + 0.45, sz, KAWARA_DARK);
    sb.box(0.035, 0.32, 0.035, 0.13, sy + 0.3, sz - 0.03, KAWARA_DARK, { z: -0.5 });
  }

  // --- the udatsu: a fire wall on the hisashi at each end ----------------------
  const sheetTop = (z: number): number => hy + 0.07 / cosH + (z - hz) * Math.tan(HP) - 0.03;
  const zf = F - 0.95;
  const yt = g + 1.5;
  for (const sx of [-1, 1]) {
    const x = sx * (w / 2 - 0.12);
    const prof = (px: number): Point3[] => [
      [px, sheetTop(zf), zf],
      [px, sheetTop(F), F],
      [px, yt, F],
      [px, yt, zf],
    ];
    convexSolid(b, prof(x - 0.1), prof(x + 0.1), plaster);
    sb.box(0.24, yt - sheetTop(zf), 0.05, x, (yt + sheetTop(zf)) / 2, zf - 0.02, SUMI);
    sb.box(0.38, 0.1, 1.1, x, yt + 0.05, (zf + F) / 2 - 0.05, KAWARA_DARK);
    sb.box(0.14, 0.08, 1.12, x, yt + 0.14, (zf + F) / 2 - 0.05, KAWARA_DARK);
  }

  // --- the loft ------------------------------------------------------------------
  const slitY = g + up * 0.5;
  /** A mushiko-mado: plaster bars in a raised plaster frame, on a sill. */
  const mushiko = (s: Side, cx: number, ww: number, wh: number, glowing: boolean): void => {
    const ring = 0.12;
    for (const e of [-1, 1]) on(s, cx + e * (ww / 2 + ring / 2), slitY, ring, wh + ring * 2, 0.07, 0.035, plaster);
    on(s, cx, slitY + wh / 2 + ring / 2, ww, ring, 0.07, 0.035, plaster);
    on(s, cx, slitY - wh / 2 - 0.05, ww + ring * 2 + 0.1, 0.1, 0.12, 0.06, plaster);
    if (glowing) glowOn(s, cx, slitY, ww, wh, 0.01);
    else on(s, cx, slitY, ww, wh, 0.02, 0.01, SUMI);
    for (let k = 1; k < 5; k++) on(s, cx - ww / 2 + (k / 5) * ww, slitY, 0.08, wh, 0.07, 0.04, plaster);
  };
  const upX = w / 3.2;
  for (const sx of [-1, 0, 1]) {
    if (sx === 0 && loftWindow) continue;
    mushiko("-z", sx * upX, 1.1, 0.55, lit && sx === 0);
  }
  if (loftWindow) {
    // A timber lattice window with a bamboo blind let down inside it.
    const ww = 1.5;
    const wh = 0.8;
    if (lit) glowOn("-z", 0, slitY, ww, wh, 0.01);
    else on("-z", 0, slitY, ww, wh, 0.02, 0.01, PAPER);
    const bh = wh * blind;
    on("-z", 0, slitY + wh / 2 - bh / 2, ww - 0.06, bh, 0.02, 0.035, HINOKI);
    for (let y = slitY + wh / 2 - 0.1; y > slitY + wh / 2 - bh + 0.02; y -= 0.1) {
      on("-z", 0, y, ww - 0.06, 0.014, 0.01, 0.05, SUMI);
    }
    const n = Math.round(ww / 0.1);
    for (let k = 1; k < n; k++) on("-z", -ww / 2 + (k / n) * ww, slitY, 0.03, wh, 0.04, 0.08, SUMI);
    for (const e of [-1, 1]) {
      on("-z", (e * (ww + 0.08)) / 2, slitY, 0.08, wh + 0.16, 0.1, 0.05, SUMI);
      on("-z", 0, slitY + (e * (wh + 0.08)) / 2, ww, 0.08, 0.1, 0.05, SUMI);
    }
  }
  // Timber at the loft's corners, and the eave beam, front and back.
  for (const s of ["-z", "+z"] as const) {
    for (const sx of [-1, 1]) on(s, sx * (w / 2 - 0.09), (g + h) / 2, 0.18, up, 0.05, 0.025, SUMI);
    on(s, 0, h - 0.22, w, 0.2, 0.12, 0.06, SUMI);
    on(s, 0, g, w, 0.14, 0.05, 0.025, SUMI);
  }

  // --- the ends: boarding under battens, posts and plaster over it --------------
  const BOARD = 2.1;
  for (const s of ["-x", "+x"] as const) {
    on(s, 0, (PL + BOARD) / 2, d, BOARD - PL, 0.03, 0.015, HINOKI);
    const nb = Math.max(6, Math.round(d / 0.75));
    for (let k = 1; k < nb; k++) on(s, -d / 2 + (k / nb) * d, (PL + BOARD) / 2, 0.05, BOARD - PL, 0.03, 0.045, SUMI);
    on(s, 0, BOARD + 0.04, d + 0.02, 0.08, 0.07, 0.035, SUMI);
    const np = Math.max(2, Math.round(d / 3));
    for (let k = 0; k <= np; k++) {
      on(s, -d / 2 + 0.09 + (k / np) * (d - 0.18), (BOARD + 0.08 + h) / 2, 0.18, h - BOARD - 0.08, 0.05, 0.025, SUMI);
    }
    on(s, 0, g, d, 0.14, 0.05, 0.025, SUMI);
    on(s, 0, h - 0.1, d, 0.2, 0.05, 0.025, SUMI);
  }

  // --- the back: boarding, a door under a hood, a window, a loft slit --------------
  on("+z", 0, (PL + BOARD) / 2, w, BOARD - PL, 0.03, 0.015, HINOKI);
  {
    const nb = Math.max(6, Math.round(w / 0.6));
    for (let k = 1; k < nb; k++) {
      const u = -w / 2 + (k / nb) * w;
      if (Math.abs(u - backDoorU) < 0.6) continue;
      on("+z", u, (PL + BOARD) / 2, 0.05, BOARD - PL, 0.03, 0.045, SUMI);
    }
    on("+z", 0, BOARD + 0.04, w + 0.02, 0.08, 0.07, 0.035, SUMI);
  }
  // The back door: a boarded leaf on ledges in a timber frame.
  on("+z", backDoorU, PL + 0.95, 0.9, 1.9, 0.03, 0.045, HINOKI);
  for (const yl of [PL + 0.3, PL + 0.95, PL + 1.6]) on("+z", backDoorU, yl, 0.84, 0.1, 0.03, 0.075, SUMI);
  for (const e of [-1, 1]) on("+z", backDoorU + e * 0.5, PL + 1.0, 0.1, 2.0, 0.08, 0.04, SUMI);
  on("+z", backDoorU, PL + 2.0, 1.1, 0.1, 0.08, 0.04, SUMI);
  sb.box(1.4, 0.08, 0.62, backDoorU, 2.55, d / 2 + 0.3, KAWARA, { x: 0.3 });
  for (const e of [-1, 1]) sb.box(0.08, 0.1, 0.55, backDoorU + e * 0.55, 2.42, d / 2 + 0.275, SUMI);
  // The kitchen's window, on the other side.
  const bwU = -Math.sign(backDoorU) * (w / 2 - 1.3);
  if (lit) glowOn("+z", bwU, 1.55, 0.9, 0.6, 0.05);
  else on("+z", bwU, 1.55, 0.9, 0.6, 0.02, 0.05, PAPER);
  for (let k = 0; k <= 6; k++) on("+z", bwU - 0.45 + (k / 6) * 0.9, 1.55, k === 0 || k === 6 ? 0.07 : 0.03, 0.66, 0.04, 0.08, SUMI);
  for (const e of [-1, 1]) on("+z", bwU, 1.55 + e * 0.31, 0.97, 0.06, 0.05, 0.08, SUMI);
  mushiko("+z", 0, 0.9, 0.45, false);

  // --- the roof -----------------------------------------------------------------
  const RISE = 1.9;
  const RUN = d / 2 + overhang;
  const EAVE = d / 2 + 0.6;
  const pitch = Math.atan2(RISE, RUN);
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);
  const T = 0.22;
  const len = EAVE / cosP;
  const roofW = w + overhang * 2;
  const lineY = (z: number): number => h + RISE * (1 - Math.abs(z) / RUN);
  for (const s of [-1, 1]) {
    // A point `lift` off the roof line at `z`, along the slope's normal.
    const at = (z: number, lift: number): [number, number] => [lineY(z) + cosP * lift, z + s * sinP * lift];
    // The face of a member on this slope that looks UP it — into the ridge,
    // the wall or the rib above — which nobody sees.
    const upEnd = s > 0 ? 1 << 5 : 1 << 4;
    const zm = (s * EAVE) / 2;
    const [sy, sz] = at(zm, T / 2);
    sb.box(roofW, T, len, 0, sy, sz, KAWARA, { x: s * pitch });
    const [ry, rz] = at(zm, T + 0.045);
    const ribs = Math.round(roofW / 0.3);
    for (let i = 0; i < ribs; i++) {
      const x = -roofW / 2 + (roofW / ribs) * (i + 0.5);
      sb.box(0.12, 0.09, len - 0.2, x, ry - 0.1 * sinP, rz + s * 0.1 * cosP, KAWARA_DARK, { x: s * pitch }, HIDE_UNDER | (1 << 4) | (1 << 5));
      sb.box(0.17, 0.16, 0.06, x, ry - (len / 2) * sinP, rz + s * (len / 2) * cosP, KAWARA_DARK, { x: s * pitch }, HIDE_UNDER | upEnd);
    }
    sb.box(roofW, 0.1, 0.06, 0, sy - (len / 2) * sinP - 0.02, sz + s * (len / 2) * cosP, KAWARA_DARK);
    for (const sx of [-1, 1]) {
      const [ty, tz] = at(zm, T + 0.06);
      sb.box(0.24, 0.12, len, sx * (roofW / 2 - 0.12), ty, tz, KAWARA_DARK, { x: s * pitch });
    }
    // The rafter ends under the eave.
    const zr = (s * (d / 2 + EAVE - 0.08)) / 2;
    const [ay, az] = at(zr, -0.05);
    const rl = (EAVE - 0.08 - d / 2) / cosP;
    const nr2 = Math.max(6, Math.round(w / 0.5));
    for (let k = 0; k <= nr2; k++) {
      sb.box(0.07, 0.09, rl, -w / 2 + 0.12 + (k / nr2) * (w - 0.24), ay, az, SUMI, { x: s * pitch }, (1 << 2) | upEnd);
    }
  }
  // The gables: plaster, up under the roof.
  for (const sx of [-1, 1]) {
    const tri = (x: number): Point3[] => [
      [x, h, -d / 2],
      [x, h, d / 2],
      [x, h + RISE * 0.96, 0],
    ];
    convexSolid(b, tri(sx * (w / 2 + 0.01)), tri(sx * (w / 2 - 0.4)), plaster);
  }
  // The ridge: courses banded in white, a round cap, a demon tile each end.
  const ry0 = h + RISE + T / cosP - 0.06;
  const ridgeL = w + 0.4;
  let ridgeY = ry0;
  for (let i = 0; i < 3; i++) {
    const depth = 0.62 - i * 0.07;
    sb.box(ridgeL, 0.08, depth, 0, ridgeY + 0.04, 0, KAWARA_DARK);
    ridgeY += 0.08;
    if (i < 2) {
      sb.box(ridgeL - 0.04, 0.028, depth - 0.05, 0, ridgeY + 0.014, 0, SHIKKUI);
      ridgeY += 0.028;
    }
  }
  sb.box(ridgeL, 0.16, 0.3, 0, ridgeY + 0.08, 0, KAWARA_DARK);
  ridgeY += 0.16;
  for (const sx of [-1, 1]) {
    const ox = sx * (ridgeL / 2 + 0.02);
    sb.box(0.14, 0.66, 0.74, ox, ry0 + 0.27, 0, KAWARA_DARK);
    sb.box(0.14, 0.3, 0.46, ox, ry0 + 0.74, 0, KAWARA_DARK);
    sb.box(0.14, 0.3, 0.13, ox + sx * 0.02, ry0 + 0.94, 0, KAWARA_DARK, { z: -sx * 0.35 });
  }
  if (vent) {
    // The kitchen's smoke vent: a louvred box over the ridge under its own roof.
    const vb = ridgeY - 0.1;
    const vh = 0.42;
    sb.box(0.9, vh, 0.7, ventX, vb + vh / 2, 0, SUMI);
    for (const s of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        sb.box(0.84, 0.04, 0.05, ventX, vb + 0.1 + k * 0.12, s * 0.37, HINOKI, { x: s * 0.5 });
      }
      sb.box(1.2, 0.07, 0.62, ventX, vb + vh + 0.12, s * 0.27, KAWARA, { x: s * 0.5 });
    }
    sb.box(1.25, 0.1, 0.16, ventX, vb + vh + 0.29, 0, KAWARA_DARK);
  }

  sb.flush(b);

  // --- the cores, emitted after what hides them -----------------------------------
  b.box(w + 0.34, plinthH - 0.01, d + 0.34, 0, foot + (plinthH - 0.01) / 2, 0, GRANITE_DARK);
  if (p.enterable) {
    const side = (w - door) / 2;
    const off = door / 2 + side / 2;
    const lintel = g - doorH;
    b.box(w - 0.2, 0.2, d - 0.2, 0, 0.25, 0, CEDAR);
    b.box(side, g, t, -off, g / 2, F + t / 2, HINOKI);
    b.box(side, g, t, off, g / 2, F + t / 2, HINOKI);
    b.box(door, lintel, t, 0, g - lintel / 2, F + t / 2, HINOKI);
    b.box(w, g, t, 0, g / 2, d / 2 - t / 2, plaster);
    b.box(t, g, d, -w / 2 + t / 2, g / 2, 0, plaster);
    b.box(t, g, d, w / 2 - t / 2, g / 2, 0, plaster);
    b.box(w, up, d, 0, g + up / 2, 0, plaster);
  } else {
    b.box(w, g, d, 0, g / 2, 0, plaster);
    b.box(w, up, d, 0, g + up / 2, 0, plaster);
  }
  return b;
}

/**
 * A MINKA: an Edo farmhouse under a thatched roof as tall as the walls under
 * it — which is most of the building from any distance and is what makes a
 * farm read as a farm.
 *
 * **It was a mud box ringed by thin posts under a smooth brown hip of
 * thatch**: one seamless sheet with a bar along its top and five pairs of
 * sticks on it, the walls a plaster block with a post every bay, two grids of
 * shoji, a deck slab laid on nothing, and nothing on the back or the ends at
 * all. What makes a minka one is the THATCH — how thick it is, how it is cut
 * and how it is closed at the top — and the timber frame the mud is laid in,
 * so that is where this spends its vertices:
 *
 * - **The roof is a hip under a GABLE** (irimoya): the hip is the old roof
 *   exactly, and at each end of the ridge a vertical triangle stands on the
 *   hip, where the long slopes run on past the ridge's end as a thick verge of
 *   thatch cut plumb. `gx` is where that triangle stands, and it is where the
 *   plane of the triangle's two edges is the plane of the long slopes, so the
 *   verge slab lies ON the roof over its whole length and only floats where it
 *   crosses the hip — which is the gable roof. Half the farms keep the smoke
 *   gable open behind a lattice of slats; the other half plaster it white and
 *   write 水 on it, the fire charm a thatched house was never without.
 * - **The eave is CUT in tiers**, a dark bottom course standing furthest out
 *   and a middle one between it and the sheet, so the cut face reads as three
 *   layers of reed, and a course lies proud of the slope a third of the way up
 *   it — each a band of `curvedRoof` with `grow`/`raise` and, where its top
 *   edge is seen, a riser (`closeTop`). Rafters run under the eave from the
 *   wall to the cut, a pole ties them under their ends, and a heavier rafter
 *   runs out under each hip.
 * - **The ridge is bound**: a flared bundle of thatch with a bamboo rail
 *   along each shoulder, lashed every half metre, and pairs of crossed
 *   timbers (umanori) riding it with a pole laid in their crotches.
 * - **The walls are a FRAME**: a sill on the plinth, posts, a tie at door
 *   height and the wall plate, a board wainscot under battens round the back
 *   and the ends, and the mud between. The front is an engawa — sliding shoji
 *   between posts, lapped in two tracks over board kick panels, a box for the
 *   storm shutters at each end, the deck's boards laid lengthways on a front
 *   beam carried on short posts on stones. A boarded door with a wicket where
 *   the house is shut, the doorway where it is not, and a stone to step up by.
 * - **The back** has the kitchen door under a board hood and bamboo-barred
 *   windows in bays either side; one **end** has a window and the other a
 *   stack of firewood under a straw mat — and, on most, strings of persimmons
 *   drying under its eave (`KAKI`).
 * - **Inside** an enterable one, the roof slab the rounds already stop on is a
 *   boarded loft floor on joists and beams, and a hearth is let into the floor.
 *
 * Seeded by where it stands (`streetSeed`), which is why it is in
 * `CONFORMS_TO_TERRAIN`: which gable is open, which end is stacked, whether
 * the persimmons are up, the back door's bay and the wicket's leaf — and the
 * plinth, the deck's stones and the steps are carried down to the ground.
 *
 * **The colliders are unchanged, byte for byte and in the same order**: the
 * walls (the old `doorWall` and `wall` calls) or the mass, the deck, and the
 * flat roof slab at the eave. Everything drawn is on a face (none more than
 * 0.6 m proud — the firewood, as far out as the kura's leaves), ankle high (the plinth's lip, the hearth, the
 * steps), overhead (the roof, the loft's beams at 2.45 m), or ON the deck's
 * own collider, whose drawn top is its top. The repeated work is laid through
 * `StoneBatch` as one surface per colour.
 */
export function buildMinka(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "minka");
  const w = p.width ?? 12;
  const d = p.depth ?? 8;
  const h = p.height ?? 3.0;
  const t = 0.32;
  const lit = !!p.litWindows;
  const ex = w / 2 + 1.3;
  const ez = d / 2 + 1.3;

  // --- colliders, exactly as they were: the walls (the old `doorWall` and
  // `wall` calls) or the mass, the deck, then the roof slab at the eave.
  if (p.enterable) {
    const side = (w - 2.4) / 2;
    const off = 2.4 / 2 + side / 2;
    const lintel = h - 2.3;
    const fz = -d / 2 + t / 2;
    b.block({ w: side, h, d: t, x: 0 - off, y: h / 2, z: fz });
    b.block({ w: side, h, d: t, x: 0 + off, y: h / 2, z: fz });
    b.block({ w: 2.4, h: lintel, d: t, x: 0, y: h / 2 + h / 2 - lintel / 2, z: fz });
    b.block({ w, h, d: t, x: 0, y: h / 2, z: d / 2 - t / 2 });
    b.block({ w: t, h, d, x: -w / 2 + t / 2, y: h / 2, z: 0 });
    b.block({ w: t, h, d, x: w / 2 - t / 2, y: h / 2, z: 0 });
  } else {
    b.block({ w, h, d, x: 0, y: h / 2, z: 0 });
  }
  b.block({ w, h: 0.45, d: 1.2, x: 0, y: 0.225, z: -d / 2 - 0.6 });
  b.block({ w: ex * 2, h: 0.3, d: ez * 2, x: 0, y: h, z: 0 });

  // --- everything below is drawing -------------------------------------------
  const rnd = mulberry32(streetSeed(w, d, h, ctx));
  const woodEnd: Side = rnd() < 0.5 ? "-x" : "+x";
  const winEnd: Side = woodEnd === "-x" ? "+x" : "-x";
  const charm = rnd() < 0.5;
  const kaki = rnd() < 0.65;
  const wicket = rnd() < 0.5 ? -1 : 1;
  const bays = Math.max(3, Math.round(w / 1.8));
  const bayW = w / bays;
  const doorBay = 1 + Math.floor(rnd() * (bays - 2));
  const hearthX = (rnd() < 0.5 ? -1 : 1) * w * 0.22;

  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };
  const F = -d / 2;
  const foot =
    Math.min(
      0,
      ground(-w / 2 - 0.25, F - 1.2),
      ground(w / 2 + 0.25, F - 1.2),
      ground(-w / 2 - 0.25, d / 2 + 0.25),
      ground(w / 2 + 0.25, d / 2 + 0.25),
    ) - 0.08;

  const sb = new StoneBatch();
  const PL = 0.3;
  const DECK = 0.45;
  const KAMOI = 2.3;
  const KOSHI = 1.05;
  const NUKI = 2.0;
  const wallFace = (s: Side): number => (runsAlongX(s) ? d / 2 : w / 2);
  const faceLen = (s: Side): number => (runsAlongX(s) ? w : d);
  /** A member on side `s`'s face, `out` from the face to its own centre. */
  const on = (
    s: Side,
    u: number,
    y: number,
    along: number,
    tall: number,
    thick: number,
    out: number,
    color: string,
  ): void => sb.onFace(s, wallFace(s), u, y, along, tall, thick, out, color, 0, 0, hideBack(s));
  /** A glow on side `s`, `out` from the face to its centre. */
  const glowOn = (s: Side, u: number, y: number, along: number, tall: number, out: number): void => {
    const c = outward(s) * (wallFace(s) + out);
    if (runsAlongX(s)) b.glow(along, tall, 0.02, u, y, c, SHOJI_GLOW);
    else b.glow(0.02, tall, along, c, y, u, SHOJI_GLOW);
  };
  /** A square member from `a` to `c`. */
  const member = (a: Point3, c: Point3, size: number, color: string, hide = 0): void => {
    const o = orient(a, c);
    sb.box(size, size, o.len, o.mid[0], o.mid[1], o.mid[2], color, o.rot, hide);
  };

  // --- the roof's own geometry, which everything under the eave is cut to ------
  const y0 = h - 0.1;
  const rise = d * 0.62;
  const CURVE = 1.12;
  const TH = 0.7;
  const rx = Math.max(0.6, (w - d) / 2 + 0.8);
  const ry = y0 + rise;
  const T = (tt: number): number => y0 + rise * Math.pow(Math.min(1, Math.max(0, tt)), CURVE);
  /** How far up the slope (x, z) is: the ring it lies on. */
  const tAt = (x: number, z: number): number =>
    Math.min(1 - Math.abs(z) / ez, (ex - Math.abs(x)) / (ex - rx));
  /** The underside of the thatch over (x, z). */
  const under = (x: number, z: number): number => T(tAt(x, z)) - TH;
  // The smoke gable: its half base, where it stands, and how high its base is.
  const hz0 = ez * 0.3;
  const gx = rx + (hz0 * (ex - rx)) / ez;
  const H0 = T(1 - hz0 / ez);
  const k = (ry - H0) / hz0;

  // --- the plinth: dressed granite round a dark core, down to the ground ------
  const plinthH = PL - foot;
  for (const s of ["+z", "-x", "+x"] as const) {
    const run = runsAlongX(s) ? w / 2 + 0.23 : d / 2 + 0.15;
    let u = -run;
    while (run - u > 0.05) {
      let len = 0.9 + rnd() * 0.6;
      if (run - (u + len) < 0.5) len = run - u;
      sb.onFace(s, wallFace(s) + 0.15, u + len / 2, foot + plinthH / 2 + 0.005, len - 0.022, plinthH + 0.01, 0.16, 0.0, GRANITE, 0, 0, hideBack(s));
      u += len;
    }
  }

  // --- the frame on the back and the ends: sill, wainscot, posts, tie, plate ----
  const endN = 2 * Math.round((d / 2.4 - 1) / 2) + 1;
  const backDoorU = -w / 2 + (doorBay + 0.5) * bayW;
  const backWins: number[] = [];
  for (let i = 0; i < bays; i++) {
    const gap = i - doorBay;
    if (Math.abs(gap) >= 2 && gap % 3 === 0) backWins.push(-w / 2 + (i + 0.5) * bayW);
  }
  if (!backWins.length) backWins.push(-w / 2 + ((doorBay + Math.floor(bays / 2)) % bays + 0.5) * bayW);
  const doorCut: [number, number][] = [[backDoorU - 0.55, backDoorU + 0.55]];
  for (const s of ["+z", "-x", "+x"] as const) {
    const L = faceLen(s);
    const cuts = s === "+z" ? doorCut : [];
    on(s, 0, PL + 0.07, L + 0.02, 0.14, 0.1, 0.05, SUMI);
    // The wainscot: boards under battens, capped.
    for (const [a, c] of carve(-L / 2, L / 2, cuts)) {
      on(s, (a + c) / 2, (PL + 0.14 + KOSHI) / 2, c - a, KOSHI - PL - 0.14, 0.03, 0.015, HINOKI);
      on(s, (a + c) / 2, KOSHI + 0.03, c - a, 0.06, 0.07, 0.035, SUMI);
      const nb = Math.max(1, Math.round((c - a) / 0.45));
      for (let i = 1; i < nb; i++) {
        on(s, a + (i / nb) * (c - a), (PL + 0.14 + KOSHI) / 2, 0.05, KOSHI - PL - 0.14, 0.03, 0.045, SUMI);
      }
    }
    // Posts, the tie between them at door height, and the plate.
    const n = runsAlongX(s) ? bays : endN;
    for (let i = 0; i <= n; i++) {
      const u = -L / 2 + (i / n) * L;
      on(s, u, (PL + 0.14 + h - 0.26) / 2, 0.22, h - 0.26 - PL - 0.14, 0.12, 0.06, SUMI);
    }
    for (const [a, c] of carve(-L / 2, L / 2, cuts)) on(s, (a + c) / 2, NUKI, c - a, 0.1, 0.05, 0.025, SUMI);
  }
  for (const s of ["-z", "+z", "-x", "+x"] as const) on(s, 0, h - 0.13, faceLen(s) + 0.2, 0.26, 0.14, 0.07, SUMI);

  /** A bamboo-barred window (renji-mado) in a timber frame. */
  const barWindow = (s: Side, u: number, ww: number): void => {
    const wy = 1.55;
    const wh = 0.62;
    if (lit) glowOn(s, u, wy, ww, wh, 0.01);
    else on(s, u, wy, ww, wh, 0.02, 0.01, SUMI);
    const n = Math.round(ww / 0.1);
    for (let i = 1; i < n; i++) on(s, u - ww / 2 + (i / n) * ww, wy, 0.035, wh, 0.035, 0.05, HINOKI);
    for (const e of [-1, 1]) on(s, u + e * (ww / 2 + 0.04), wy, 0.08, wh + 0.16, 0.08, 0.04, HINOKI);
    on(s, u, wy + wh / 2 + 0.05, ww + 0.2, 0.1, 0.08, 0.04, HINOKI);
    on(s, u, wy - wh / 2 - 0.05, ww + 0.3, 0.1, 0.14, 0.07, HINOKI);
  };
  for (const u of backWins) barWindow("+z", u, Math.min(1.2, bayW - 0.6));
  barWindow(winEnd, 0, Math.min(1.3, d / endN - 0.7));

  // The kitchen door: a boarded leaf on ledges in a frame, under a board hood,
  // a stone before it.
  {
    const u = backDoorU;
    const top = PL + 1.85;
    on("+z", u, (PL + top) / 2, 0.9, top - PL, 0.03, 0.015, HINOKI);
    const nb = 5;
    for (let i = 1; i < nb; i++) on("+z", u - 0.45 + (i / nb) * 0.9, (PL + top) / 2, 0.012, top - PL, 0.012, 0.034, SUMI);
    for (const yl of [PL + 0.3, PL + 0.95, top - 0.3]) on("+z", u, yl, 0.84, 0.1, 0.03, 0.045, SUMI);
    for (const e of [-1, 1]) on("+z", u + e * 0.5, (PL + top + 0.1) / 2, 0.1, top + 0.1 - PL, 0.08, 0.04, SUMI);
    on("+z", u, top + 0.05, 1.1, 0.1, 0.08, 0.04, SUMI);
    sb.box(1.5, 0.06, 0.7, u, top + 0.45, d / 2 + 0.34, HINOKI, { x: 0.32 });
    for (let i = 0; i < 6; i++) sb.box(0.02, 0.02, 0.66, u - 0.625 + i * 0.25, top + 0.49, d / 2 + 0.33, SUMI, { x: 0.32 }, HIDE_UNDER);
    for (const e of [-1, 1]) {
      member([u + e * 0.62, top + 0.1, d / 2 + 0.02], [u + e * 0.62, top + 0.36, d / 2 + 0.6], 0.07, SUMI);
    }
    const sg = ground(u, d / 2 + 0.4);
    const sTop = Math.min(PL - 0.04, sg + 0.18);
    const sBot = Math.min(sg, foot) - 0.05;
    sb.box(1.0, sTop - sBot, 0.42, u, (sTop + sBot) / 2, d / 2 + 0.4, GRANITE, { y: (rnd() - 0.5) * 0.1 });
  }

  // --- the front: posts, the engawa's shoji, the shutter boxes, the door ----
  const JAMB = 1.3;
  const runA = JAMB + 0.1;
  const runB = w / 2 - 0.24 - 0.62;
  const postF = (u: number, wide: number): void =>
    on("-z", u, (DECK + h - 0.26) / 2, wide, h - 0.26 - DECK, 0.14, 0.07, SUMI);
  for (const sx of [-1, 1]) {
    postF(sx * (w / 2 - 0.12), 0.24);
    postF(sx * JAMB, 0.2);
    // The shoji, lapped in two tracks, over board kick panels.
    const L = runB - runA;
    const nP = Math.max(2, Math.round(L / 0.9));
    const pw = L / nP;
    const y0p = DECK + 0.36;
    const y1p = KAMOI - 0.04;
    for (let i = 0; i < nP; i++) {
      const u = sx * (runA + (i + 0.5) * pw);
      const lap = (i % 2) * 0.035;
      if (lit) glowOn("-z", u, (y0p + y1p) / 2, pw - 0.06, y1p - y0p, 0.02);
      else on("-z", u, (y0p + y1p) / 2, pw - 0.06, y1p - y0p, 0.03, 0.015, PAPER);
      on("-z", u, (DECK + 0.06 + y0p) / 2, pw - 0.06, y0p - DECK - 0.06, 0.03, 0.03 + lap, HINOKI);
      for (const e of [-1, 1]) on("-z", u + e * (pw / 2 - 0.03), (DECK + 0.05 + y1p) / 2, 0.06, y1p - DECK - 0.05, 0.05, 0.055 + lap, SUMI);
      for (const yr of [DECK + 0.08, y0p, y1p]) on("-z", u, yr, pw - 0.06, 0.05, 0.05, 0.055 + lap, SUMI);
      for (let c = 1; c < 3; c++) on("-z", u - pw / 2 + (c / 3) * pw, (y0p + y1p) / 2, 0.022, y1p - y0p, 0.03, 0.05 + lap, SUMI);
      for (let r = 1; r < 6; r++) on("-z", u, y0p + (r / 6) * (y1p - y0p), pw - 0.1, 0.022, 0.03, 0.05 + lap, SUMI);
      if (i > 0 && i % 2 === 0) postF(sx * (runA + i * pw), 0.16);
    }
    // The storm shutters' box, at the outer end of the run.
    const tu = sx * (runB + 0.32);
    const tTop = KAMOI + 0.12;
    on("-z", tu, (DECK + tTop) / 2, 0.6, tTop - DECK, 0.2, 0.1, HINOKI);
    for (const e of [-1, 1]) on("-z", tu + e * 0.28, (DECK + tTop) / 2, 0.05, tTop - DECK, 0.04, 0.22, SUMI);
    for (const yr of [DECK + 0.6, DECK + 1.3]) on("-z", tu, yr, 0.52, 0.04, 0.03, 0.215, SUMI);
    on("-z", tu, tTop + 0.03, 0.66, 0.06, 0.26, 0.13, SUMI);
  }
  // The head track over everything, and the sill track on the deck.
  on("-z", 0, KAMOI + 0.05, w - 0.1, 0.1, 0.1, 0.05, SUMI);
  on("-z", 0, DECK + 0.025, w - 0.1, 0.05, 0.1, 0.05, SUMI);
  if (!p.enterable) {
    // The great door, shut: two leaves of boards over a dark back, battened,
    // one with a wicket in it.
    on("-z", 0, (DECK + KAMOI) / 2, 2.4, KAMOI - DECK, 0.01, 0.005, SUMI);
    for (const e of [-1, 1]) {
      const lc = e * 0.6;
      const lap = e > 0 ? 0.035 : 0;
      for (let i = 0; i < 6; i++) {
        on("-z", lc - 0.6 + 0.1 + i * 0.2, (DECK + KAMOI) / 2, 0.185, KAMOI - DECK - 0.02, 0.03, 0.025 + lap, HINOKI);
      }
      for (const yr of [DECK + 0.25, DECK + 1.1, KAMOI - 0.2]) on("-z", lc, yr, 1.16, 0.1, 0.03, 0.055 + lap, SUMI);
      for (const e2 of [-1, 1]) on("-z", lc + e2 * 0.57, (DECK + KAMOI) / 2, 0.06, KAMOI - DECK, 0.03, 0.055 + lap, SUMI);
      if (e === wicket) {
        const wy0 = DECK + 0.3;
        const wy1 = DECK + 1.35;
        for (const e2 of [-1, 1]) on("-z", lc + e2 * 0.3, (wy0 + wy1) / 2, 0.05, wy1 - wy0, 0.02, 0.08 + lap, SUMI);
        on("-z", lc, wy1, 0.65, 0.05, 0.02, 0.08 + lap, SUMI);
        on("-z", lc + 0.2, (wy0 + wy1) / 2, 0.08, 0.05, 0.03, 0.09 + lap, KAWARA_DARK);
      }
    }
  }

  // --- the engawa: boards laid lengthways on a front beam, on posts on stones --
  {
    const nb = 6;
    const bw = 1.2 / nb;
    for (let j = 0; j < nb; j++) {
      const z = F - (j + 0.5) * bw;
      let u = -w / 2;
      while (w / 2 - u > 0.05) {
        let len = 2.6 + rnd() * 1.6;
        if (w / 2 - (u + len) < 1.2) len = w / 2 - u;
        sb.box(len - 0.008, 0.05, bw - 0.012, u + len / 2, DECK - 0.025, z, CEDAR, undefined, HIDE_UNDER);
        u += len;
      }
    }
    sb.box(w, 0.16, 0.14, 0, DECK - 0.05 - 0.08, F - 1.2 + 0.07, SUMI);
    const nPost = Math.max(3, Math.round(w / 1.8));
    for (let i = 0; i <= nPost; i++) {
      const x = -w / 2 + 0.12 + (i / nPost) * (w - 0.24);
      const sg = ground(x, F - 1.13);
      const sTop = Math.min(DECK - 0.3, sg + 0.08);
      const sBot = Math.min(sg, foot) - 0.05;
      sb.box(0.28, sTop - sBot, 0.28, x, (sTop + sBot) / 2, F - 1.13, GRANITE);
      const pTop = DECK - 0.21;
      if (pTop - sTop > 0.03) sb.box(0.12, pTop - sTop, 0.12, x, (pTop + sTop) / 2, F - 1.13, SUMI);
    }
    // The stone to step up by, before the door.
    const sg = ground(0, F - 1.55);
    const sTop = sg + 0.2;
    const sBot = Math.min(sg, foot) - 0.05;
    sb.box(1.05, sTop - sBot, 0.55, 0, (sTop + sBot) / 2, F - 1.55, GRANITE, { y: (rnd() - 0.5) * 0.12 });
  }

  // --- the firewood, stacked against one end under a straw mat ------------------
  const WL = Math.min(d - 1.8, 3.2);
  {
    const sgn = outward(woodEnd);
    const xf = sgn * (w / 2 + 0.15);
    const gw = Math.min(ground(xf + sgn * 0.25, -WL / 2), ground(xf + sgn * 0.25, WL / 2), ground(xf + sgn * 0.25, 0));
    const base = gw + 0.1;
    for (const e of [-1, 1]) sb.box(0.1, 0.1 + (gw - foot), WL, xf + sgn * (0.2 + e * 0.12), (base + foot) / 2, 0, SUMI);
    const rows = 9;
    const cols = Math.round(WL / 0.15);
    const cw = WL / cols;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const z = -WL / 2 + (i + 0.5 + (j % 2) * 0.35) * cw;
        if (z > WL / 2 - cw * 0.4) continue;
        const bh = 0.115 + rnd() * 0.03;
        const bz = cw - 0.03 - rnd() * 0.02;
        sb.box(0.42, bh, bz, xf + sgn * (0.22 + (rnd() - 0.5) * 0.03), base + (j + 0.5) * 0.14, z, rnd() < 0.2 ? CEDAR : HINOKI, { x: rnd() * 1.5 }, sgn > 0 ? 1 << 1 : 1);
      }
    }
    const top = base + rows * 0.14;
    sb.box(0.55, 0.06, WL + 0.2, xf + sgn * 0.22, top + 0.02, 0, KAYA, { z: -sgn * 0.12 });
    sb.box(0.36, 0.05, WL + 0.16, xf + sgn * 0.44, top - 0.1, 0, KAYA, { z: -sgn * 0.9 });
    // Persimmons drying on strings from a pole tied under the eave.
    if (kaki) {
      const px = sgn * (w / 2 + 0.3);
      const py = h + 0.04;
      sb.box(0.05, 0.05, WL + 0.3, px, py, 0, HINOKI);
      const ns = Math.round(WL / 0.32);
      for (let i = 0; i < ns; i++) {
        const z = -WL / 2 + (i + 0.5) * (WL / ns);
        const nf = 4 + Math.floor(rnd() * 2);
        sb.box(0.012, nf * 0.11 + 0.06, 0.012, px, py - (nf * 0.11 + 0.06) / 2, z, KAYA);
        for (let f = 0; f < nf; f++) {
          sb.box(0.075, 0.085, 0.075, px, py - 0.1 - f * 0.11, z + (rnd() - 0.5) * 0.02, KAKI, { y: rnd() });
        }
      }
    }
  }

  // --- under the eave: rafters from the wall to the cut, a pole under their ends --
  for (const sz of [-1, 1]) {
    const n = Math.round(w / 0.55);
    for (let i = 0; i <= n; i++) {
      const x = -w / 2 + 0.1 + (i / n) * (w - 0.2);
      const za = sz * (d / 2 + 0.05);
      const zb = sz * (ez - 0.12);
      const zm = (za + zb) / 2;
      const m: Point3 = [x, under(x, zm) - 0.1, zm];
      member([x, under(x, za) - 0.1, za], m, 0.08, SUMI, 1 << 2);
      member(m, [x, under(x, zb) - 0.1, zb], 0.08, SUMI, 1 << 2);
    }
    const zp = sz * (ez - 0.45);
    const px = w / 2 + 0.3;
    sb.box(2 * px, 0.07, 0.07, 0, under(0, zp) - 0.175, zp, HINOKI);
  }
  for (const sx of [-1, 1]) {
    const n = Math.round(d / 0.55);
    for (let i = 0; i <= n; i++) {
      const z = -d / 2 + 0.1 + (i / n) * (d - 0.2);
      const xa = sx * (w / 2 + 0.05);
      const xb = sx * (ex - 0.12);
      const xm = (xa + xb) / 2;
      const m: Point3 = [xm, under(xm, z) - 0.1, z];
      member([xa, under(xa, z) - 0.1, z], m, 0.08, SUMI, 1 << 2);
      member(m, [xb, under(xb, z) - 0.1, z], 0.08, SUMI, 1 << 2);
    }
    const xp = sx * (ex - 0.45);
    sb.box(0.07, 0.07, d + 0.6, xp, under(xp, 0) - 0.175, 0, HINOKI);
    for (const sz of [-1, 1]) {
      const a: Point3 = [sx * w / 2, 0, sz * d / 2];
      const c: Point3 = [sx * (ex - 0.15), 0, sz * (ez - 0.15)];
      member([a[0], under(a[0], a[2]) - 0.08, a[2]], [c[0], under(c[0], c[2]) - 0.08, c[2]], 0.12, SUMI, 1 << 2);
    }
  }

  // --- the smoke gables' faces --------------------------------------------------
  for (const s of ["-x", "+x"] as const) {
    const R = ry - H0;
    /** A member on the gable's face; `u` is to the viewer's right. */
    const g = (u: number, y: number, along: number, tall: number, thick: number, out: number, color: string): void =>
      sb.onFace(s, gx, s === "+x" ? u : -u, y, along, tall, thick, out, color, 0, 0, hideBack(s));
    g(0, H0 + 0.03, 2 * hz0 + 0.1, 0.12, 0.1, 0.05, SUMI);
    if (charm) {
      // 水, the charm against fire, in the plaster: five strokes.
      const c = Math.min(0.95, R * 0.45);
      const cy = H0 + R * 0.4;
      const stroke = (u1: number, v1: number, u2: number, v2: number): void => {
        const len = Math.hypot(u2 - u1, v2 - v1) + 0.08;
        const a = Math.atan2(u2 - u1, v2 - v1) * (s === "+x" ? 1 : -1);
        const x = outward(s) * (gx + 0.012);
        const z = (s === "+x" ? 1 : -1) * ((u1 + u2) / 2) * c;
        sb.box(0.025, len * c, 0.085 * c * 1.4, x, cy + ((v1 + v2) / 2) * c, z, SUMI, { x: a }, hideBack(s));
      };
      stroke(0, 0.5, 0, -0.44);
      stroke(0, -0.44, -0.13, -0.34);
      stroke(-0.38, 0.14, -0.06, 0.14);
      stroke(-0.06, 0.14, -0.42, -0.36);
      stroke(0.36, 0.3, 0.06, 0.02);
      stroke(0.06, 0.02, 0.44, -0.42);
    } else {
      // The smoke vent: a lattice of slats over the dark of the roof space.
      const vy0 = H0 + 0.18;
      const vh = Math.min(0.75, R * 0.45);
      const vw = 0.8 * 2 * hz0 * ((ry - vy0 - vh) / R);
      g(0, vy0 + vh / 2, vw, vh, 0.02, 0.01, SUMI);
      const n = Math.max(4, Math.round(vw / 0.11));
      for (let i = 1; i < n; i++) g(-vw / 2 + (i / n) * vw, vy0 + vh / 2, 0.035, vh, 0.03, 0.035, HINOKI);
      for (const e of [-1, 1]) g(e * (vw / 2 + 0.04), vy0 + vh / 2, 0.08, vh + 0.12, 0.06, 0.03, HINOKI);
      for (const e of [-1, 1]) g(0, vy0 + vh / 2 + e * (vh / 2 + 0.03), vw + 0.16, 0.06, 0.06, 0.03, HINOKI);
    }
  }

  // --- the ridge's binding and its crossed timbers -------------------------------
  const RL = gx + 0.45;
  const yt = ry + 0.42;
  const yShoulder = ry + 0.2;
  for (const e of [-1, 1]) {
    sb.box(2 * RL - 0.1, 0.06, 0.06, 0, yt + 0.03, e * 0.26, HINOKI);
    sb.box(2 * RL - 0.1, 0.06, 0.06, 0, yShoulder, e * 0.54, HINOKI);
  }
  for (let x = -RL + 0.25; x < RL - 0.2; x += 0.5) sb.box(0.05, 0.09, 0.6, x, yt + 0.025, 0, SUMI, undefined, HIDE_UNDER);
  const nU = Math.max(3, Math.round((2 * RL - 1) / 1.05));
  for (let i = 0; i <= nU; i++) {
    const x = -RL + 0.5 + (i / nU) * (2 * RL - 1);
    for (const e of [-1, 1]) sb.box(0.09, 1.15, 0.09, x, yt + 0.12, 0, SUMI, { x: e * 0.62 });
  }
  sb.box(2 * RL - 0.8, 0.08, 0.08, 0, yt + 0.12 + 0.13, 0, HINOKI);

  // --- inside an enterable one: the loft floor on joists and beams, the hearth ----
  if (p.enterable) {
    const ix = w / 2 - t;
    const iz = d / 2 - t;
    const CEIL = h - 0.15;
    sb.box(2 * ix, 0.04, 2 * iz, 0, CEIL + 0.02, 0, HINOKI, undefined, 1 << 2);
    const nj = Math.round((2 * iz) / 0.5);
    for (let j = 0; j <= nj; j++) sb.box(2 * ix, 0.08, 0.07, 0, CEIL - 0.04, -iz + 0.05 + (j / nj) * (2 * iz - 0.1), SUMI, undefined, 1 << 2);
    const nBeam = Math.max(2, Math.round((2 * ix) / 2.6));
    for (let i = 1; i < nBeam; i++) sb.box(0.24, 0.3, 2 * iz, -ix + (i / nBeam) * 2 * ix, CEIL - 0.08 - 0.15, 0, SUMI, undefined, 1 << 2);
    // Posts on the inner faces.
    for (let i = 0; i <= bays; i++) {
      const x = -ix + 0.1 + (i / bays) * (2 * ix - 0.2);
      if (Math.abs(x) > 1.1) sb.box(0.2, CEIL - 0.08 - 0.4, 0.08, x, (0.4 + CEIL - 0.08) / 2, -iz + 0.04, SUMI);
      sb.box(0.2, CEIL - 0.08 - 0.4, 0.08, x, (0.4 + CEIL - 0.08) / 2, iz - 0.04, SUMI);
    }
    for (const sx of [-1, 1]) {
      for (let i = 0; i <= endN; i++) {
        sb.box(0.08, CEIL - 0.08 - 0.4, 0.2, sx * (ix - 0.04), (0.4 + CEIL - 0.08) / 2, -iz + 0.1 + (i / endN) * (2 * iz - 0.2), SUMI);
      }
    }
    // The hearth let into the floor: a frame round a bed of ash, the ends of a fire.
    const hz = 0.4;
    sb.box(1.3, 0.02, 1.3, hearthX, 0.41, hz, GRANITE_DARK, undefined, HIDE_UNDER);
    for (const e of [-1, 1]) {
      sb.box(1.6, 0.05, 0.15, hearthX, 0.425, hz + e * 0.725, SUMI, undefined, HIDE_UNDER);
      sb.box(0.15, 0.05, 1.3, hearthX + e * 0.725, 0.425, hz, SUMI, undefined, HIDE_UNDER);
    }
    for (let i = 0; i < 3; i++) {
      const a = 0.4 + (i * 2 * Math.PI) / 3;
      sb.box(0.07, 0.06, 0.45, hearthX + Math.sin(a) * 0.26, 0.44, hz + Math.cos(a) * 0.26, SUMI, { y: a });
    }
  }

  sb.flush(b);

  // --- the cores, emitted after what hides them -----------------------------------
  b.box(w + 0.3, plinthH - 0.01, d + 0.3, 0, foot + (plinthH - 0.01) / 2, 0, GRANITE_DARK);
  b.box(w - 0.02, 0.1, 1.16, 0, DECK - 0.05 - 0.05, F - 0.6, SUMI);
  b.box(w - 0.3, DECK - 0.21 - foot, 1.06, 0, (DECK - 0.21 + foot) / 2, F - 0.53, SUMI);
  // The dark between the plate and the thatch, closed along every wall line.
  for (const sz of [-1, 1]) {
    const top = Math.max(under(0, d / 2), under(w / 2, d / 2)) + 0.06;
    b.box(w, top - h + 0.05, t, 0, (top + h - 0.05) / 2, sz * (d / 2 - t / 2), SUMI);
  }
  for (const sx of [-1, 1]) {
    const top = Math.max(under(w / 2, 0), under(w / 2, d / 2)) + 0.06;
    b.box(t, top - h + 0.05, d, sx * (w / 2 - t / 2), (top + h - 0.05) / 2, 0, SUMI);
  }
  if (p.enterable) {
    const side = (w - 2.4) / 2;
    const off = 2.4 / 2 + side / 2;
    const lintel = h - 2.3;
    b.box(w - 0.2, 0.2, d - 0.2, 0, 0.3, 0, CEDAR);
    b.box(side, h, t, -off, h / 2, F + t / 2, TSUCHI);
    b.box(side, h, t, off, h / 2, F + t / 2, TSUCHI);
    b.box(2.4, lintel, t, 0, h - lintel / 2, F + t / 2, TSUCHI);
    b.box(w, h, t, 0, h / 2, d / 2 - t / 2, TSUCHI);
    b.box(t, h, d, -w / 2 + t / 2, h / 2, 0, TSUCHI);
    b.box(t, h, d, w / 2 - t / 2, h / 2, 0, TSUCHI);
  } else {
    b.box(w, h, d, 0, h / 2, 0, TSUCHI);
  }

  // --- the roof: the hip, its courses and tiers, the smoke gables, the ridge ------
  const roof: RoofSpec = { y: y0, ex, ez, tx: rx, tz: 0, rise, curve: CURVE, upturn: 0.05, seg: 4 };
  curvedRoof(b, KAYA, { ...roof, thick: TH });
  curvedRoof(b, KAYA, { ...roof, to: 0.32, raise: 0.07, thick: 0.3, rings: 3, closeTop: true });
  curvedRoof(b, KAYA, { ...roof, to: 0.07, raise: -0.2, grow: 0.05, thick: 0.26, rings: 1 });
  curvedRoof(b, KAYA_DARK, { ...roof, to: 0.1, raise: -0.44, grow: 0.1, thick: 0.32, rings: 2, closeTop: true });
  for (const sx of [-1, 1]) {
    const tri = (x: number): Point3[] => [
      [x, H0 - 0.06, -hz0],
      [x, H0 - 0.06, hz0],
      [x, ry + 0.05, 0],
    ];
    convexSolid(b, tri(sx * (gx - 0.3)), tri(sx * gx), charm ? SHIKKUI : TSUCHI);
  }
  const X1 = gx + 0.35;
  const zE = hz0 + 0.35;
  for (const sz of [-1, 1]) {
    const prof = (x: number): Point3[] => [
      [x, ry + 0.1, 0],
      [x, H0 - 0.35 * k + 0.1, sz * zE],
      [x, H0 - 0.35 * k - 0.25, sz * zE],
      [x, ry - 0.25, 0],
    ];
    convexSolid(b, prof(-X1), prof(X1), KAYA);
  }
  const yb = ry + 0.05 - 0.55 * k;
  const rprof = (x: number): Point3[] => [
    [x, yb, -0.55],
    [x, yb, 0.55],
    [x, yShoulder, 0.52],
    [x, yt, 0.3],
    [x, yt, -0.3],
    [x, yShoulder, -0.52],
  ];
  convexSolid(b, rprof(-RL), rprof(RL), KAYA_DARK);
  return b;
}

/**
 * A KURA: an Edo storehouse of the fireproof kind — a mud wall a foot thick
 * under a skin of lime plaster, on a granite plinth, with a skirt of black
 * NAMAKO tile round its foot. Solid — what is in a kura is not somewhere a
 * round goes. It is the building a brewery is made of, and a row of them is
 * the whitest thing in the valley.
 *
 * **It was a cream box with a black grid round its foot under a board roof**:
 * a plaster block, the skirt a square grid of white lines on a dark band, a
 * door that was a dark rectangle in a frame, one window, a roof two slabs as
 * thin as a door, and nothing on the back or the gable ends at all. What
 * makes a kura one is what fire-proofing made it — everything is THICK, and
 * every edge is plastered in steps — so that is where this spends its
 * vertices:
 *
 * - **The skirt is set on the DIAGONAL**, the square tiles turned 45 degrees
 *   under raised white joints, which is the pattern the name means; the square
 *   grid read as a window. Framed by beads at its head, its foot, its corners
 *   and the door, and capped by a sloped tile drip course.
 * - **The plaster is a SKIN**, three and a half centimetres proud of a mud
 *   core (`TSUCHI`), so where a kura has aged the lime has come off in a lobed
 *   patch or two on the back and the ends and the mud shows behind a step the
 *   ink draws. Never on the front: the brewery keeps its face.
 * - **The eaves are plastered in steps** — three courses of cornice under the
 *   front and back eaves, a closed plaster box under each verge — and the roof
 *   is a thick sheathing slab under rows of round tiles, end tiles along the
 *   eave, edge tiles up the verge, and a ridge of stacked flat tiles banded by
 *   white mortar with a demon tile at each end.
 * - **The door is the storehouse's whole argument**: a stepped plaster frame
 *   three rings deep, the heavy plaster doors themselves (open back against
 *   the wall in three placements in five, shut and hasped in the rest), a
 *   boarded inner door, a tile hood on brackets and a granite step. The
 *   windows are the same thing small — a stepped frame, iron bars, plaster
 *   shutters, a hood — on the front, on one gable end of most, and on the
 *   back of half.
 * - **A family crest on each gable**: a raised plaster roundel with a black
 *   field and a white mark in it, one of five (`KURA_CRESTS`), the one mark on
 *   the building that says whose it is. And rows of L-shaped iron pegs
 *   (orikugi) under the eaves and across the ends, where scaffolding is hung
 *   to re-plaster it.
 *
 * Seeded by where it stands (`streetSeed`), which is why it is in
 * `CONFORMS_TO_TERRAIN`: the eight in the brewery are one building eight
 * ways, and the plinth is carried down to the ground under its lowest corner.
 *
 * **The colliders are unchanged, byte for byte and in the same order**: the
 * mass, then the flat roof slab at the eave (the retired `gableRoofX`'s,
 * spelled out).
 * Everything drawn is on a face (the skirt, the skin, the frames and the
 * leaves, none more than 0.6 m proud), overhead (the cornice, the hoods, the
 * roof), or ankle high (the plinth's lip and the step). The repeated work —
 * the tile joints, the roof tiles, the pegs, the plinth stones, the skin — is
 * laid through `StoneBatch` as one surface per colour, because a part is a
 * mesh the install pays for.
 */
export function buildKura(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "kura");
  const w = p.width ?? 6;
  const d = p.depth ?? 5;
  const h = p.height ?? 5.4;

  // --- colliders, exactly as they were: the mass, then the roof slab at the
  // eave (the retired `gableRoofX`'s, with its 0.45 overhang spelled out).
  b.block({ w, h, d, x: 0, y: h / 2, z: 0 });
  const overhang = 0.45;
  b.block({ w: w + overhang * 2, h: 0.3, d: d + overhang * 2, x: 0, y: h, z: 0 });

  // --- everything below is drawing -------------------------------------------
  const rnd = mulberry32(streetSeed(w, d, h, ctx));
  const crest = KURA_CRESTS[Math.floor(rnd() * KURA_CRESTS.length)];
  const doorOpen = rnd() < 0.6;
  const frontShutters = rnd() < 0.65;
  const gableSide: Side = rnd() < 0.5 ? "-x" : "+x";
  const gableWindow = rnd() < 0.7;
  const backWindow = rnd() < 0.5;
  const backU = (rnd() - 0.5) * Math.max(0, w - 2.6);
  const gableU = (rnd() - 0.5) * 0.8;
  const gableOpen = rnd() < 0.5;
  const backOpen = rnd() < 0.5;

  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };
  const foot =
    Math.min(
      0,
      ground(-w / 2 - 0.2, -d / 2 - 0.2),
      ground(w / 2 + 0.2, -d / 2 - 0.2),
      ground(-w / 2 - 0.2, d / 2 + 0.2),
      ground(w / 2 + 0.2, d / 2 + 0.2),
    ) - 0.08;

  const sb = new StoneBatch();
  const SKIN = 0.035;
  const PLINTH = 0.45;
  const skirt = 1.5;
  const skirtTop = PLINTH + skirt;
  const half = (s: Side): number => (runsAlongX(s) ? w / 2 : d / 2);
  const wallFace = (s: Side): number => (runsAlongX(s) ? d / 2 : w / 2);
  const SIDES: Side[] = ["-z", "+z", "-x", "+x"];

  /**
   * A member laid on side `s`'s plaster, `out` measured from the skin's face
   * to the member's own centre; `pitch` drops its outer edge (a hood, a drip).
   */
  const onSkin = (
    s: Side,
    u: number,
    y: number,
    along: number,
    tall: number,
    thick: number,
    out: number,
    color: string,
    pitch = 0,
  ): void => {
    const n = outward(s);
    const c = n * (wallFace(s) + SKIN + out);
    if (runsAlongX(s)) sb.box(along, tall, thick, u, y, c, color, pitch ? { x: n * pitch } : undefined);
    else sb.box(thick, tall, along, c, y, u, color, pitch ? { z: -n * pitch } : undefined);
  };
  /** `onSkin` into the batch, its back face left out. */
  const onSkinBatch = (
    s: Side,
    u: number,
    y: number,
    along: number,
    tall: number,
    thick: number,
    out: number,
    color: string,
  ): void => sb.onFace(s, wallFace(s) + SKIN, u, y, along, tall, thick, out, color, 0, 0, hideBack(s));

  // A stepped plaster frame round an opening: rings from the outermost (the
  // widest, the least proud) in, each a pair of jambs, a head and a sill.
  const frame = (
    s: Side,
    u: number,
    y0: number,
    wo: number,
    ho: number,
    rings: readonly [number, number, number][],
    sill: boolean,
  ): void => {
    for (const [fw, fh, depth] of rings) {
      const jamb = (fw - wo) / 2;
      const base = sill ? y0 - jamb : y0;
      const head = base + fh - (y0 + ho);
      for (const sx of [-1, 1]) {
        onSkin(s, u + sx * (wo / 2 + jamb / 2), base + fh / 2, jamb, fh, depth, depth / 2, SHIKKUI);
      }
      onSkin(s, u, y0 + ho + head / 2, wo, head, depth, depth / 2, SHIKKUI);
      if (sill) onSkin(s, u, base + jamb / 2, wo, jamb, depth, depth / 2, SHIKKUI);
    }
  };

  // A lean-to of tile over an opening, on two brackets.
  const hood = (s: Side, u: number, yTop: number, wide: number, proj: number): void => {
    const a = 0.38;
    const len = proj / Math.cos(a);
    const drop = proj * Math.tan(a);
    const yc = yTop - drop / 2;
    onSkin(s, u, yc, wide, 0.09, len, proj / 2, KAWARA, a);
    const ribs = Math.max(3, Math.round(wide / 0.24));
    for (let i = 0; i < ribs; i++) {
      const ru = u - wide / 2 + (wide / ribs) * (i + 0.5);
      onSkin(s, ru, yc + 0.075, 0.09, 0.07, len, proj / 2, KAWARA_DARK, a);
    }
    onSkin(s, u, yTop - drop - 0.01, wide + 0.04, 0.12, 0.05, proj, KAWARA_DARK);
    for (const sx of [-1, 1]) {
      onSkin(s, u + sx * (wide / 2 - 0.2), yTop - drop - 0.14, 0.09, 0.1, proj - 0.05, (proj - 0.05) / 2, SUMI);
    }
  };

  // A window: stepped frame, a dark back, iron bars, plaster shutters open
  // against the wall or shut over it, and a hood.
  const kuraWindow = (s: Side, u: number, yc: number, open: boolean, small = false): void => {
    const wo = small ? 0.5 : 0.62;
    const ho = small ? 0.45 : 0.55;
    const y0 = yc - ho / 2;
    frame(s, u, y0, wo, ho, [
      [wo + 0.38, ho + 0.38, 0.08],
      [wo + 0.2, ho + 0.2, 0.16],
    ], true);
    onSkin(s, u, yc, wo, ho, 0.02, 0.01, NAMAKO);
    for (let i = 1; i <= 3; i++) {
      onSkin(s, u - wo / 2 + (wo / 4) * i, yc, 0.035, ho, 0.035, 0.07, SUMI);
    }
    const leafW = (wo + 0.2) / 2;
    const leafH = ho + 0.24;
    for (const sx of [-1, 1]) {
      if (open) {
        const lu = u + sx * ((wo + 0.38) / 2 + leafW / 2 + 0.02);
        onSkin(s, lu, yc, leafW, leafH, 0.12, 0.06, SHIKKUI);
        onSkin(s, lu, yc, leafW - 0.12, leafH - 0.12, 0.03, 0.135, SHIKKUI);
      } else {
        const lu = u + sx * (leafW / 2);
        onSkin(s, lu, yc, leafW - 0.01, leafH, 0.12, 0.22, SHIKKUI);
        onSkin(s, lu, yc, leafW - 0.13, leafH - 0.12, 0.03, 0.295, SHIKKUI);
      }
    }
    hood(s, u, yc + (ho + 0.38) / 2 + 0.34, wo + 0.7, small ? 0.36 : 0.45);
  };

  // --- the plinth: dressed granite round a dark core, down to the ground ---
  const plinthH = PLINTH - foot;
  for (const s of SIDES) {
    const run = runsAlongX(s) ? w / 2 + 0.2 : d / 2 + 0.04;
    let u = -run;
    while (run - u > 0.05) {
      let len = 0.75 + rnd() * 0.55;
      if (run - (u + len) < 0.45) len = run - u;
      sb.onFace(s, wallFace(s) + 0.04, u + len / 2, foot + plinthH / 2 + 0.005, len - 0.022, plinthH + 0.01, 0.16, 0.08, GRANITE, 0, 0, hideBack(s));
      u += len;
    }
  }

  // --- the skirt: black tile on the diagonal under raised white joints ---
  const LATTICE = 0.3;
  const BEAD = 0.045;
  const PROUD = 0.035;
  const doorW = 2.3;
  for (const s of SIDES) {
    const plane = wallFace(s) + 0.04;
    const run = half(s) + 0.04;
    const holes: [number, number][] = s === "-z" ? [[-doorW / 2, doorW / 2]] : [];
    const y0 = PLINTH;
    const y1 = skirtTop;
    const H = y1 - y0;
    for (const [a, c1] of carve(-run, run, holes)) {
      for (const k of [1, -1]) {
        // Lines u = c + k * (y - y0), on one lattice for the whole face so
        // both sides of the door stay in step.
        const cMin = k > 0 ? a - H : a;
        const cMax = k > 0 ? c1 : c1 + H;
        for (let c = -run + Math.ceil((cMin + run) / LATTICE) * LATTICE; c <= cMax; c += LATTICE) {
          const t0 = k > 0 ? Math.max(0, a - c) : Math.max(0, c - c1);
          const t1 = k > 0 ? Math.min(H, c1 - c) : Math.min(H, c - a);
          if (t1 - t0 < 0.03) continue;
          sb.onFace(
            s,
            plane,
            c + (k * (t0 + t1)) / 2,
            y0 + (t0 + t1) / 2,
            (t1 - t0) * Math.SQRT2,
            BEAD,
            PROUD,
            PROUD / 2,
            SHIKKUI,
            (k * Math.PI) / 4,
            0,
            hideBack(s),
          );
        }
      }
      // A bead down each end of the run: the corner, or the door's jamb.
      for (const e of [a, c1]) {
        sb.onFace(s, plane, e, y0 + H / 2, 0.07, H, PROUD + 0.01, (PROUD + 0.01) / 2, SHIKKUI, 0, 0, hideBack(s));
      }
    }
    // Head and foot beads the whole run.
    for (const yb of [y0 + 0.035, y1 - 0.035]) {
      sb.onFace(s, plane, 0, yb, run * 2 + 0.07, 0.07, PROUD + 0.01, (PROUD + 0.01) / 2, SHIKKUI, 0, 0, hideBack(s));
    }
    // The drip course over it: a sloped tile ledge.
    onSkin(s, 0, skirtTop + 0.06, half(s) * 2 + 0.3, 0.05, 0.2, 0.1, KAWARA, 0.42);
  }

  // --- the plaster skin, spalled back to the mud in a lobe or two ----------
  const spalls: { s: Side; lobes: [number, number, number][] }[] = [];
  const nSpalls = Math.floor(rnd() * 2.6);
  for (let i = 0; i < nSpalls; i++) {
    const s: Side = (["+z", "-x", "+x"] as const)[Math.floor(rnd() * 3)];
    const u = (rnd() - 0.5) * (half(s) * 2 - 1.4);
    const y = skirtTop + 0.3 + rnd() * (h - skirtTop - 1.6);
    const lobes: [number, number, number][] = [];
    const n = 2 + Math.floor(rnd() * 2);
    for (let j = 0; j < n; j++) {
      lobes.push([u + (rnd() - 0.5) * 0.45, y + (rnd() - 0.5) * 0.35, 0.12 + rnd() * 0.18]);
    }
    spalls.push({ s, lobes });
  }
  const BAND = 0.09;
  for (const s of SIDES) {
    const run = runsAlongX(s) ? w / 2 + SKIN : d / 2;
    const lobes = spalls.filter((sp) => sp.s === s).flatMap((sp) => sp.lobes);
    const y0 = skirtTop + 0.09;
    const y1 = runsAlongX(s) ? h - 0.5 : h;
    const slab = (a: number, c: number): void => {
      if (c - a > 0.01) onSkinBatch(s, 0, (a + c) / 2, run * 2, c - a, SKIN, -SKIN / 2, SHIKKUI);
    };
    if (!lobes.length) {
      slab(y0, y1);
      continue;
    }
    let lo = y1;
    let hi = y0;
    for (const [, ly, r] of lobes) {
      lo = Math.min(lo, ly - r);
      hi = Math.max(hi, ly + r);
    }
    lo = Math.max(y0, lo);
    hi = Math.min(y1, hi);
    slab(y0, lo);
    for (let y = lo; y < hi - 1e-6; y += BAND) {
      const yt = Math.min(hi, y + BAND);
      const yc = (y + yt) / 2;
      const cuts: [number, number][] = [];
      for (const [lu, ly, r] of lobes) {
        const dy = yc - ly;
        if (Math.abs(dy) < r) {
          const hc = Math.sqrt(r * r - dy * dy);
          cuts.push([lu - hc, lu + hc]);
        }
      }
      for (const [a, c] of carve(-run, run, cuts)) {
        onSkinBatch(s, (a + c) / 2, yc, c - a, yt - y, SKIN, -SKIN / 2, SHIKKUI);
      }
    }
    slab(hi, y1);
  }

  // --- the eaves: three steps of plaster cornice front and back, and the
  // lowest carried round the ends as a string course -------------------------
  for (const s of ["-z", "+z"] as const) {
    const steps: [number, number, number][] = [
      [h - 0.5, h - 0.36, 0.06],
      [h - 0.36, h - 0.22, 0.14],
      [h - 0.22, h + 0.02, 0.24],
    ];
    for (const [y0, y1, proj] of steps) {
      onSkin(s, 0, (y0 + y1) / 2, w + SKIN * 2 + proj * 2, y1 - y0, proj, proj / 2, SHIKKUI);
    }
  }
  for (const s of ["-x", "+x"] as const) {
    onSkin(s, 0, h - 0.43, d, 0.14, 0.06, 0.03, SHIKKUI);
  }

  // --- the door --------------------------------------------------------------
  const wo = 1.3;
  const ho = 2.15;
  frame("-z", 0, PLINTH, wo, ho, [
    [doorW, 2.95, 0.12],
    [2.05, 2.72, 0.24],
    [1.8, 2.5, 0.34],
  ], false);
  // The boarded inner door, set back on the wall's own face.
  for (let i = 0; i < 4; i++) {
    onSkin("-z", -wo / 2 + (wo / 4) * (i + 0.5), PLINTH + ho / 2, wo / 4 - 0.012, ho, 0.04, -0.01, SUMI);
  }
  for (const yb of [PLINTH + 0.4, PLINTH + ho - 0.4]) {
    onSkin("-z", 0, yb, wo, 0.06, 0.02, 0.015, NAMAKO);
  }
  // The plaster doors: open back against the wall, or shut over the frame.
  const leafW = 0.78;
  const leafH = 2.4;
  for (const sx of [-1, 1]) {
    if (doorOpen) {
      const lu = sx * (doorW / 2 + leafW / 2 + 0.03);
      onSkin("-z", lu, PLINTH + leafH / 2, leafW, leafH, 0.2, 0.1, SHIKKUI);
      onSkin("-z", lu, PLINTH + leafH / 2, leafW - 0.16, leafH - 0.16, 0.05, 0.225, SHIKKUI);
    } else {
      const lu = sx * (leafW / 2 + 0.005);
      onSkin("-z", lu, PLINTH + leafH / 2, leafW, leafH, 0.2, 0.44, SHIKKUI);
      onSkin("-z", lu, PLINTH + leafH / 2, leafW - 0.16, leafH - 0.16, 0.05, 0.565, SHIKKUI);
    }
  }
  if (!doorOpen) {
    onSkin("-z", 0, PLINTH + 1.15, 0.1, 0.24, 0.04, 0.61, SUMI);
    onSkin("-z", 0, PLINTH + 1.02, 0.16, 0.06, 0.06, 0.62, SUMI);
  }
  hood("-z", 0, PLINTH + 2.95 + 0.42, 2.9, 0.8);
  // The step: a granite slab on the ground in front of the door, carried down
  // to it where the plinth is.
  const stepG = ground(0, -d / 2 - 0.55);
  const stepH = 0.2 + Math.max(0, stepG - foot);
  sb.box(1.7, stepH, 0.6, 0, stepG + 0.2 - stepH / 2, -d / 2 - 0.55, GRANITE);

  // --- the windows -------------------------------------------------------------
  kuraWindow("-z", 0, h - 1.3, frontShutters);
  if (gableWindow) kuraWindow(gableSide, gableU, h - 1.25, gableOpen, true);
  if (backWindow) kuraWindow("+z", backU, h - 1.3, backOpen);

  // --- the pegs (orikugi) scaffolding hangs from -----------------------------
  for (const s of SIDES) {
    const run = half(s);
    const rows = runsAlongX(s) ? [h - 0.72] : [skirtTop + 1.0, h - 0.72];
    for (const y of rows) {
      const n = Math.max(2, Math.round((run * 2 - 0.8) / 0.95));
      for (let i = 0; i <= n; i++) {
        const u = -run + 0.4 + ((run * 2 - 0.8) / n) * i;
        const high = y > h - 2;
        if (s === "-z" && Math.abs(u) < 0.9 && high) continue;
        if (s === "+z" && backWindow && Math.abs(u - backU) < 0.8) continue;
        if (s === gableSide && gableWindow && Math.abs(u - gableU) < 0.8 && high) continue;
        onSkinBatch(s, u, y, 0.035, 0.035, 0.15, 0.075, SUMI);
        onSkinBatch(s, u, y + 0.045, 0.035, 0.09, 0.035, 0.135, SUMI);
      }
    }
  }

  // --- the roof ---------------------------------------------------------------
  const RISE = 1.5;
  const RUN = d / 2 + overhang;
  const EAVE = d / 2 + 0.55;
  const pitch = Math.atan2(RISE, RUN);
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);
  const T = 0.22;
  const len = EAVE / cosP;
  const roofW = w + overhang * 2;
  const lineY = (z: number): number => h + RISE * (1 - Math.abs(z) / RUN);
  for (const s of [-1, 1]) {
    const zm = (s * EAVE) / 2;
    // A point `lift` off the roof line mid-run, along the slope's normal.
    const at = (lift: number): [number, number] => [lineY(zm) + cosP * lift, zm + s * sinP * lift];
    const [sy, sz] = at(T / 2);
    sb.box(roofW, T, len, 0, sy, sz, KAWARA, { x: s * pitch });
    // Round tiles down the slope, their ends out at the eave.
    const [ry, rz] = at(T + 0.045);
    const ribs = Math.round(roofW / 0.28);
    for (let i = 0; i < ribs; i++) {
      const x = -roofW / 2 + (roofW / ribs) * (i + 0.5);
      sb.box(0.12, 0.09, len - 0.2, x, ry - 0.1 * sinP, rz + s * 0.1 * cosP, KAWARA_DARK, { x: s * pitch }, HIDE_UNDER);
      sb.box(0.17, 0.16, 0.06, x, ry - (len / 2) * sinP, rz + s * (len / 2) * cosP, KAWARA_DARK, { x: s * pitch });
    }
    // The eave's front tile.
    sb.box(roofW, 0.1, 0.06, 0, sy - (len / 2) * sinP - 0.02, sz + s * (len / 2) * cosP, KAWARA_DARK);
    for (const sx of [-1, 1]) {
      // Edge tiles up the verge, and the plaster box closing the overhang under it.
      const [ty, tz] = at(T + 0.06);
      sb.box(0.24, 0.12, len, sx * (roofW / 2 - 0.12), ty, tz, KAWARA_DARK, { x: s * pitch });
      const [by, bz] = at(-0.16);
      sb.box(overhang + SKIN, 0.32, len - 0.05, sx * (w / 2 + (overhang + SKIN) / 2), by, bz, SHIKKUI, { x: s * pitch });
    }
  }
  // The gable ends: plaster, flush with the skin, up under the roof.
  for (const sx of [-1, 1]) {
    const tri = (x: number): Point3[] => [
      [x, h, -d / 2],
      [x, h, d / 2],
      [x, h + RISE * 0.96, 0],
    ];
    convexSolid(b, tri(sx * (w / 2 + SKIN)), tri(sx * (w / 2 - 0.4)), SHIKKUI);
  }
  // The ridge: flat tiles stacked in courses, banded by white mortar, under a
  // round cap, a demon tile at each end.
  const ry0 = h + RISE + T / cosP - 0.06;
  const ridgeL = roofW - 0.2;
  let ridgeY = ry0;
  for (let i = 0; i < 4; i++) {
    const depth = 0.66 - i * 0.07;
    sb.box(ridgeL, 0.075, depth, 0, ridgeY + 0.0375, 0, KAWARA_DARK);
    ridgeY += 0.075;
    if (i < 3) {
      sb.box(ridgeL - 0.04, 0.028, depth - 0.05, 0, ridgeY + 0.014, 0, SHIKKUI);
      ridgeY += 0.028;
    }
  }
  sb.box(ridgeL, 0.16, 0.3, 0, ridgeY + 0.08, 0, KAWARA_DARK);
  for (const sx of [-1, 1]) {
    const ox = sx * (ridgeL / 2 + 0.02);
    sb.box(0.14, 0.72, 0.78, ox, ry0 + 0.3, 0, KAWARA_DARK);
    sb.box(0.14, 0.34, 0.5, ox, ry0 + 0.8, 0, KAWARA_DARK);
    sb.box(0.14, 0.34, 0.14, ox + sx * 0.02, ry0 + 1.02, 0, KAWARA_DARK, { z: -sx * 0.35 });
  }

  // --- the crests ---------------------------------------------------------
  for (const s of ["-x", "+x"] as const) {
    const n = outward(s);
    const yc = h + RISE * 0.4;
    const face = w / 2 + SKIN;
    b.cyl(0.05, 0.92, 0.92, 20, n * (face + 0.025), yc, 0, SHIKKUI, { z: Math.PI / 2 });
    b.cyl(0.03, 0.74, 0.74, 20, n * (face + 0.065), yc, 0, NAMAKO, { z: Math.PI / 2 });
    for (const [du, dy, bw, bh] of crest) {
      sb.box(0.04, bh, bw, n * (face + 0.095), yc + dy, du, SHIKKUI);
    }
  }

  sb.flush(b);

  // --- the cores, emitted after what hides them -------------------------------
  b.box(w + 0.34, plinthH - 0.01, d + 0.34, 0, foot + (plinthH - 0.01) / 2, 0, GRANITE_DARK);
  b.box(w + 0.08, skirt, d + 0.08, 0, PLINTH + skirt / 2, 0, NAMAKO);
  b.box(w, h - skirtTop, d, 0, skirtTop + (h - skirtTop) / 2, 0, TSUCHI);
  return b;
}

/**
 * The marks a kura's crest may carry, as bars `[u, dy, width, height]` on its
 * black field: one, two and three bars (hikiryō), a cross, and the well frame
 * (igeta). A merchant's mark, not a sacred one, so it is white on black and
 * never vermilion.
 */
const KURA_CRESTS: readonly (readonly [number, number, number, number][])[] = [
  [[0, 0, 0.56, 0.1]],
  [
    [0, 0.1, 0.56, 0.09],
    [0, -0.1, 0.56, 0.09],
  ],
  [
    [0, 0.15, 0.54, 0.08],
    [0, 0, 0.58, 0.08],
    [0, -0.15, 0.54, 0.08],
  ],
  [
    [0, 0, 0.56, 0.09],
    [0, 0, 0.09, 0.56],
  ],
  [
    [0, 0.1, 0.52, 0.07],
    [0, -0.1, 0.52, 0.07],
    [0.1, 0, 0.07, 0.52],
    [-0.1, 0, 0.07, 0.52],
  ],
];

/**
 * A TEAHOUSE: the sukiya-style teahouse of an Edo hot-spring inn — a paper
 * room on a raised engawa, under a tiled hip-and-gable roof whose eaves are
 * wide enough to stand under. The reference frame's hall on the right is this
 * building: every wall a lattice of glowing paper.
 *
 * The deck is walked at 0.55 — inside `stepHeight`, so it is stepped onto from
 * anywhere and the veranda is somewhere to fight from. The room is enterable
 * by one door on the front; its walls are paper and are drawn as paper, but
 * they are WALLS to a body and a round, because a room whose four sides stop
 * nothing is a gazebo. `lit` spends one light slot inside.
 *
 * **It was a box of glowing grids on a plank slab under one smooth grey
 * sheet**: a square lattice of big panes on every face, a slotted block for a
 * ridge, four sticks holding the eave up, and nothing inside at all. What
 * makes a sukiya teahouse one is that its FRAME is its ornament, so that is
 * where this spends its vertices:
 *
 * - **The elevations are bays between cypress posts**, on a sill, under a
 *   head rail and a plate: shoji in two lapped tracks over board kick panels,
 *   a low lattice transom over the front and back, and a plaster band under
 *   the eave. One bay of the back is earthen plaster — the tokonoma is behind
 *   it — and the middle bay of each end is plaster with a window in it: a
 *   ROUND window with a bamboo lattice on one end, and on the other the tea
 *   room's own window, a SHITAJI-MADO of bare reeds where the plaster was left
 *   off the lath.
 * - **The roof is a HIP-AND-GABLE (irimoya)**, the hip kept exactly as it was
 *   and a gable standing on it where the third ring of five meets the hips:
 *   the verge carried out over it as the z-faces' own slope, a tympanum of
 *   lattice or of plaster and timber under it, a barge board with a hanging
 *   ornament at its apex. Round-tile rows with end tiles down every face,
 *   a banded ridge with demon tiles, the gable's descending ridges and the
 *   four hip ridges each ending on a demon tile.
 * - **The eaves are CARRIED**: rafters over a board lining from the plate to
 *   the eave, a hip beam into each corner, a purlin swept up with the eave on
 *   the four veranda posts, and a tie from every wall post out to it.
 * - **The engawa** is boards laid along each side inside an edge beam, over a
 *   dark underfloor on short posts on stones cut to the ground, with a stone
 *   to step up by before the door — sandals left on it in most — and
 *   stepping stones out into the garden.
 * - **The door** has a noren split in three with the house's mark
 *   (`KURA_CRESTS`), and paper lanterns hung from the eave either side of it
 *   or on one. Rolled blinds hang under the purlin on some sides, a wind bell
 *   from one hip beam on most.
 * - **Inside**: tatami with their dark borders, a board ceiling on battens, a
 *   paper lining to every shoji bay, the tokonoma's board with a scroll and a
 *   sprig of maple in a bronze vase, a brazier with a kettle, two cushions.
 *
 * Seeded by where it stands (`streetSeed`), which is why it is in
 * `CONFORMS_TO_TERRAIN`: which end has the round window, the gable's finish,
 * the tokonoma's bay, the lanterns, the blinds, the bell, the sandals and the
 * mark on the noren all vary, and the footings, the underfloor, the step and
 * the stepping stones are carried down to the ground.
 *
 * **The colliders are unchanged, byte for byte and in the same order**: the
 * deck, the walls (the retired `doorWall` and `wall` calls spelled out), then
 * the roof slab at the eave. Everything drawn is on a face (none more than
 * 0.13 m proud), overhead (the purlin, the ties and the lanterns clear the
 * deck by 2.4 m or the ground by 2.5), or at the feet (the boards, the step,
 * the tatami, the tokonoma's board, the brazier).
 */
export function buildTeahouse(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "teahouse");
  const w = p.width ?? 7;
  const d = p.depth ?? 6;
  const floorY = 0.55;
  const wallH = 2.5;
  const veranda = 1.2;
  const t = 0.18;
  const door = 1.5;
  const doorH = 2.0;

  // --- colliders, exactly as they were: the deck, the walls (the old
  // `doorWall` and `wall` calls), then the roof slab at the eave.
  b.block({ w: w + veranda * 2, h: floorY, d: d + veranda * 2, x: 0, y: floorY / 2, z: 0 });
  const wy = floorY + wallH / 2;
  const side = (w - door) / 2;
  const off = door / 2 + side / 2;
  const lintel = wallH - doorH;
  const fz = -d / 2 + t / 2;
  b.block({ w: side, h: wallH, d: t, x: 0 - off, y: wy, z: fz });
  b.block({ w: side, h: wallH, d: t, x: 0 + off, y: wy, z: fz });
  b.block({ w: door, h: lintel, d: t, x: 0, y: wy + wallH / 2 - lintel / 2, z: fz });
  b.block({ w, h: wallH, d: t, x: 0, y: wy, z: d / 2 - t / 2 });
  b.block({ w: t, h: wallH, d, x: -w / 2 + t / 2, y: wy, z: 0 });
  b.block({ w: t, h: wallH, d, x: w / 2 - t / 2, y: wy, z: 0 });
  const eave = floorY + wallH + 0.25;
  const ex = w / 2 + veranda + 0.7;
  const ez = d / 2 + veranda + 0.7;
  b.block({ w: ex * 2, h: 0.3, d: ez * 2, x: 0, y: eave, z: 0 });

  // --- everything below is drawing -------------------------------------------
  const lit = !!p.litWindows;
  const rnd = mulberry32(streetSeed(w, d, wallH, ctx));
  const roundEnd: Side = rnd() < 0.5 ? "-x" : "+x";
  const latticeGable = rnd() < 0.5;
  const lanterns = rnd() < 0.55 ? [-1, 1] : [rnd() < 0.5 ? -1 : 1];
  const geta = rnd() < 0.6;
  const bellCorner = rnd() < 0.7 ? Math.floor(rnd() * 4) : -1;
  const blinds = [rnd() < 0.45, rnd() < 0.45, rnd() < 0.45];
  const brazier = rnd() < 0.5 ? -1 : 1;
  const mark = KURA_CRESTS[Math.floor(rnd() * KURA_CRESTS.length)];
  const shitajiU = (rnd() - 0.5) * 0.3;
  const backBays = Math.max(2, Math.round(w / 1.8));
  const tokoBay = backBays >= 3 ? 1 + Math.floor(rnd() * (backBays - 2)) : Math.floor(rnd() * backBays);

  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };
  const DW = w / 2 + veranda;
  const DD = d / 2 + veranda;
  let foot = 0;
  for (const gi of [-1, 0, 1]) {
    for (const gj of [-1, 0, 1]) {
      if (gi || gj) foot = Math.min(foot, ground(gi * DW, gj * DD));
    }
  }
  foot -= 0.08;

  const sb = new StoneBatch();
  const SIDES: Side[] = ["-z", "+z", "-x", "+x"];
  const OPP: Record<Side, Side> = { "-z": "+z", "+z": "-z", "-x": "+x", "+x": "-x" };
  const CORNERS = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const;
  // A member laid from `a` to `c` along its own Z hides these faces.
  const TOP = 1 << 2;
  const START = 1 << 5;
  const END = 1 << 4;
  const wallFace = (s: Side): number => (runsAlongX(s) ? d / 2 : w / 2);
  const faceLen = (s: Side): number => (runsAlongX(s) ? w : d);
  /** Plan point `n` out from the centre on side `s`, `u` along it. */
  const at = (s: Side, u: number, n: number): [number, number] =>
    runsAlongX(s) ? [u, outward(s) * n] : [outward(s) * n, u];
  /** A member on side `s`'s outer face, `out` from the face to its own centre. */
  const on = (s: Side, u: number, y: number, along: number, tall: number, thick: number, out: number, color: string): void =>
    sb.onFace(s, wallFace(s), u, y, along, tall, thick, out, color, 0, 0, hideBack(s));
  /** The same on the wall's inner face, `out` into the room. */
  const inner = (s: Side, u: number, y: number, along: number, tall: number, thick: number, out: number, color: string): void =>
    sb.onFace(s, wallFace(s) - t, u, y, along, tall, thick, -out, color, 0, 0, hideBack(OPP[s]));
  /** A glow on side `s` whose centre is `plane` out from the building's centre. */
  const glowAt = (s: Side, plane: number, u: number, y: number, along: number, tall: number): void => {
    const c = outward(s) * plane;
    if (runsAlongX(s)) b.glow(along, tall, 0.02, u, y, c, SHOJI_GLOW);
    else b.glow(0.02, tall, along, c, y, u, SHOJI_GLOW);
  };
  const member = (a: Point3, c: Point3, wide: number, deep: number, color: string, hide = 0): void => {
    const o = orient(a, c);
    sb.box(wide, deep, o.len, o.mid[0], o.mid[1], o.mid[2], color, o.rot, hide);
  };
  /** An end tile: one face 1.5 cm past `c`, square to the member from `a`. */
  const endTile = (a: Point3, c: Point3, size: number): void => {
    const o = orient(a, c);
    const k = 0.015 / o.len;
    sb.box(size, size, 0.01, c[0] + (c[0] - a[0]) * k, c[1] + (c[1] - a[1]) * k, c[2] + (c[2] - a[2]) * k, KAWARA_DARK, o.rot, 63 & ~END);
  };

  // --- the heights of the frame --------------------------------------------------
  const F0 = floorY;
  const KICK = F0 + 0.34;
  const KAMOI = F0 + doorH;
  const PLATE = F0 + wallH - 0.15;
  const CEIL = F0 + wallH - 0.08;

  // --- the roof's own geometry, which everything under and on it is cut to ------
  const RISE = 2.6;
  const CURVE = 1.55;
  const TH = 0.28;
  const tx = Math.max(0.4, (w - d) / 2 + 0.6);
  const roof: RoofSpec = { y: eave, ex, ez, tx, tz: 0, rise: RISE, curve: CURVE, upturn: 0.4, thick: TH };
  const T = (tt: number): number => eave + RISE * Math.pow(Math.min(1, Math.max(0, tt)), CURVE);
  // The gable stands where the third ring of five meets the hips, so the
  // verge over it is the z-faces' own two top facets carried out past it —
  // coplanar with the roof where the roof is there, and its own slab where
  // the hip end falls away under it.
  const TG = 0.6;
  const n8 = 0.2 * ez;
  const n6 = 0.4 * ez;
  const nE = 0.44 * ez;
  const gx = ex + (tx - ex) * TG;
  const X1 = gx + 0.35;
  const H0 = T(TG);
  const slopeV = (T(0.8) - T(TG)) / (n6 - n8);
  /** The verge's top over `n` out from the ridge: the two facets, the lower one carried on. */
  const vergeTop = (n: number): number => {
    const a = Math.abs(n);
    if (a <= n8) return T(1) + (T(0.8) - T(1)) * (a / n8);
    return T(0.8) - slopeV * (a - n8);
  };
  /** Where a tile lies over (x, z): the verge over the gable, the curved sheet everywhere else. */
  const topAt = (x: number, z: number): number => {
    const ax = Math.abs(x);
    const az = Math.abs(z);
    if (ax <= X1 && (az <= n6 || (az <= nE && ax >= gx))) return Math.max(roofHeight(roof, x, z), vergeTop(az));
    return roofHeight(roof, x, z);
  };
  /** The underside of the board lining, which the rafters are hung under. */
  const soffit = (x: number, z: number): number => roofHeight(roof, x, z, true) - 0.03;

  // --- the elevations: which bay is which ----------------------------------------
  type Bay = { a: number; c: number; kind: "shoji" | "plaster" | "door" };
  const baysOf = (s: Side): Bay[] => {
    const out: Bay[] = [];
    const split = (a: number, c: number, n: number): void => {
      for (let i = 0; i < n; i++) out.push({ a: a + ((c - a) * i) / n, c: a + ((c - a) * (i + 1)) / n, kind: "shoji" });
    };
    if (s === "-z") {
      const j = door / 2 + 0.08;
      const n = Math.max(1, Math.round((w / 2 - j) / 1.8));
      split(-w / 2, -j, n);
      out.push({ a: -j, c: j, kind: "door" });
      split(j, w / 2, n);
    } else if (s === "+z") {
      split(-w / 2, w / 2, backBays);
      out[tokoBay].kind = "plaster";
    } else {
      const n = 2 * Math.round((d / 1.8 - 1) / 2) + 1;
      split(-d / 2, d / 2, n);
      out[(n - 1) / 2].kind = "plaster";
    }
    return out;
  };
  const bays: Record<Side, Bay[]> = { "-z": baysOf("-z"), "+z": baysOf("+z"), "-x": baysOf("-x"), "+x": baysOf("+x") };
  const posts = (s: Side): number[] => {
    const us = [bays[s][0].a];
    for (const bay of bays[s]) us.push(bay.c);
    return us;
  };

  /**
   * A window in a plaster bay: the panel laid round a hole, the paper glowing
   * behind it and, from outside, what is in the hole. `dir` is 1 on the
   * outer face and -1 on the inner. A ROUND hole is the square the frame's
   * ring is drawn round, its corners filled by diamonds of the same plaster
   * turned 45 degrees so the hole left is an octagon and the ring covers the
   * difference; a SQUARE one is the tea room's reed window.
   */
  const plasterWindow = (
    s: Side,
    dir: 1 | -1,
    a: number,
    c: number,
    cu: number,
    cy: number,
    hw: number,
    hh: number,
    round: boolean,
    dressed: boolean,
  ): void => {
    const plane = dir > 0 ? wallFace(s) : wallFace(s) - t;
    const hide = hideBack(dir > 0 ? s : OPP[s]);
    const P = (u: number, y: number, along: number, tall: number, thick: number, out: number, color: string, tilt = 0): void =>
      sb.onFace(s, plane, u, y, along, tall, thick, dir * out, color, tilt, 0, hide);
    const y0 = F0 + 0.06;
    const y1 = KAMOI;
    P((a + cu - hw) / 2, (y0 + y1) / 2, cu - hw - a, y1 - y0, 0.02, 0.02, TSUCHI);
    P((cu + hw + c) / 2, (y0 + y1) / 2, c - cu - hw, y1 - y0, 0.02, 0.02, TSUCHI);
    P(cu, (cy + hh + y1) / 2, 2 * hw, y1 - cy - hh, 0.02, 0.02, TSUCHI);
    P(cu, (y0 + cy - hh) / 2, 2 * hw, cy - hh - y0, 0.02, 0.02, TSUCHI);
    if (lit) glowAt(s, plane + dir * 0.008, cu, cy, 2 * hw, 2 * hh);
    else P(cu, cy, 2 * hw, 2 * hh, 0.01, 0.008, PAPER);
    if (round) {
      const k = hw * (Math.SQRT2 - 1) * Math.SQRT2;
      for (const [du, dv] of CORNERS) P(cu + du * hw, cy + dv * hh, k, k, 0.02, 0.02, TSUCHI, Math.PI / 4);
      // The ring, in sixteen pieces round the circle.
      const R = hw + 0.02;
      const n = outward(s) * (plane + dir * 0.045);
      const pt = (th: number): Point3 =>
        runsAlongX(s) ? [cu + R * Math.cos(th), cy + R * Math.sin(th), n] : [n, cy + R * Math.sin(th), cu + R * Math.cos(th)];
      for (let i = 0; i < 16; i++) {
        const th0 = (i * Math.PI) / 8 - 0.02;
        const th1 = ((i + 1) * Math.PI) / 8 + 0.02;
        member(pt(th0), pt(th1), 0.05, 0.09, HINOKI);
      }
      if (dressed) {
        // Bamboo across it, three up and two over.
        for (const f of [-0.5, 0, 0.5]) {
          const du = f * hw;
          P(cu + du, cy, 0.03, 2 * Math.sqrt(hw * hw - du * du), 0.03, 0.03, KAYA);
        }
        for (const f of [-0.3, 0.3]) {
          const dv = f * hw;
          P(cu, cy + dv, 2 * Math.sqrt(hw * hw - dv * dv), 0.03, 0.03, 0.035, KAYA);
        }
      }
    } else if (dressed) {
      // The lath left bare: reeds at odd spacings, lashed where they cross.
      const us = [-0.66, -0.2, 0.28, 0.7].map((f) => cu + f * hw + (rnd() - 0.5) * 0.04);
      const ys = [-0.5, 0.06, 0.56].map((f) => cy + f * hh + (rnd() - 0.5) * 0.04);
      for (const u of us) P(u, cy, 0.02, 2 * hh + 0.04, 0.02, 0.028, KAYA);
      for (const y of ys) P(cu, y, 2 * hw + 0.04, 0.02, 0.02, 0.042, KAYA);
      for (let i = 0; i < 4; i++) P(us[(i * 3) % 4], ys[i % 3], 0.035, 0.035, 0.02, 0.05, SUMI, Math.PI / 4);
    }
  };

  // --- the outer elevations -----------------------------------------------------
  for (const s of SIDES) {
    const L = faceLen(s);
    const pu = posts(s);
    const doorCut: [number, number][] = s === "-z" ? [[-door / 2, door / 2]] : [];
    for (const [a, c] of carve(-L / 2, L / 2, doorCut)) on(s, (a + c) / 2, F0 + 0.03, c - a, 0.06, 0.1, 0.05, HINOKI);
    on(s, 0, KAMOI + 0.04, L, 0.08, 0.1, 0.05, HINOKI);
    on(s, 0, (KAMOI + 0.08 + PLATE) / 2, L - 0.02, PLATE - KAMOI - 0.08, 0.02, 0.01, SHIKKUI);
    on(s, 0, PLATE + 0.075, L + 0.3, 0.15, 0.16, 0.08, HINOKI);
    for (let i = 0; i < pu.length; i++) {
      const corner = i === 0 || i === pu.length - 1;
      on(s, pu[i], (F0 + PLATE) / 2, corner ? 0.2 : 0.15, PLATE - F0, 0.12, 0.06, HINOKI);
    }
    for (const bay of bays[s]) {
      const a = bay.a + 0.075;
      const c = bay.c - 0.075;
      const cu = (a + c) / 2;
      if (bay.kind === "shoji") {
        // One sheet of paper behind two sashes in two tracks.
        if (lit) glowAt(s, wallFace(s) + 0.015, cu, (KICK + KAMOI) / 2, c - a, KAMOI - KICK);
        else on(s, cu, (KICK + KAMOI) / 2, c - a, KAMOI - KICK, 0.02, 0.015, PAPER);
        const np = Math.max(1, Math.round((c - a) / 0.95));
        const pw = (c - a) / np;
        for (let i = 0; i < np; i++) {
          const u = a + (i + 0.5) * pw;
          const lap = (i % 2) * 0.035;
          const y0 = F0 + 0.06;
          on(s, u, (y0 + KICK) / 2, pw - 0.06, KICK - y0, 0.03, 0.03 + lap, HINOKI);
          for (const e of [-1, 1]) on(s, u + e * (pw / 2 - 0.03), (y0 + KAMOI) / 2, 0.06, KAMOI - y0, 0.05, 0.055 + lap, SUMI);
          for (const yr of [y0 + 0.025, KICK, KAMOI - 0.025]) on(s, u, yr, pw - 0.06, 0.05, 0.05, 0.055 + lap, SUMI);
          for (let k = 1; k < 3; k++) on(s, u - pw / 2 + 0.03 + (k * (pw - 0.06)) / 3, (KICK + KAMOI) / 2, 0.022, KAMOI - KICK - 0.05, 0.03, 0.05 + lap, SUMI);
          for (let r = 1; r < 6; r++) on(s, u, KICK + (r * (KAMOI - 0.025 - KICK)) / 6, pw - 0.1, 0.022, 0.03, 0.05 + lap, SUMI);
        }
      } else if (bay.kind === "plaster") {
        const cy = F0 + 1.25;
        if (s === "+z") on(s, cu, (F0 + 0.06 + KAMOI) / 2, c - a, KAMOI - F0 - 0.06, 0.02, 0.02, TSUCHI);
        else if (s === roundEnd) plasterWindow(s, 1, a, c, cu, cy, 0.52, 0.52, true, true);
        else plasterWindow(s, 1, a, c, cu + shitajiU, cy, 0.34, 0.4, false, true);
      }
      // The lattice transom over the front's and the back's paper and door.
      if (runsAlongX(s) && bay.kind !== "plaster") {
        const r0 = KAMOI + 0.12;
        const r1 = PLATE - 0.04;
        if (lit) glowAt(s, wallFace(s) + 0.032, cu, (r0 + r1) / 2, c - a, r1 - r0);
        else on(s, cu, (r0 + r1) / 2, c - a, r1 - r0, 0.01, 0.03, PAPER);
        for (const yr of [r0, r1]) on(s, cu, yr, c - a, 0.03, 0.03, 0.05, SUMI);
        const nb = Math.round((c - a) / 0.14);
        for (let k = 1; k < nb; k++) on(s, a + (k / nb) * (c - a), (r0 + r1) / 2, 0.02, r1 - r0, 0.02, 0.05, SUMI);
      }
    }
  }

  // --- the door: its linings, the noren, the lanterns --------------------------
  sb.box(0.08, KAMOI - F0, t + 0.02, -(door / 2 + 0.02), (F0 + KAMOI) / 2, fz, HINOKI);
  sb.box(0.08, KAMOI - F0, t + 0.02, door / 2 + 0.02, (F0 + KAMOI) / 2, fz, HINOKI);
  sb.box(door, 0.04, t + 0.02, 0, KAMOI + 0.01, fz, HINOKI);
  sb.box(door, 0.03, t + 0.04, 0, F0 + 0.015, fz, HINOKI, undefined, HIDE_UNDER);
  {
    const nw = door + 0.12;
    const nz = -d / 2 - 0.13;
    const ny = KAMOI - 0.02 - 0.27;
    for (let i = 0; i < 3; i++) {
      b.translucentBox(nw / 3 - 0.02, 0.54, 0.02, -nw / 2 + (i + 0.5) * (nw / 3), ny, nz, NOREN, TRANSLUCENCY.awning);
    }
    sb.box(nw + 0.2, 0.03, 0.03, 0, KAMOI - 0.01, nz, SUMI);
    for (const e of [-1, 1]) sb.box(0.03, 0.06, 0.1, e * (nw / 2 + 0.05), KAMOI + 0.01, nz + 0.05, SUMI);
    for (const [du, dv, mw, mh] of mark) sb.box(mw * 0.3, mh * 0.3, 0.012, du * 0.3, ny + 0.04 + dv * 0.3, nz - 0.017, PAPER);
  }
  for (const e of lanterns) {
    const lx = e * (door / 2 + 0.55);
    const lz = -(DD + 0.3);
    const sy = soffit(lx, lz);
    const cy = sy - 0.18 - 0.2;
    sb.box(0.012, 0.18, 0.012, lx, sy - 0.09, lz, SUMI);
    for (const dy of [-0.22, 0.22]) {
      sb.box(0.19, 0.04, 0.19, lx, cy + dy, lz, SUMI);
      sb.box(0.19, 0.04, 0.19, lx, cy + dy, lz, SUMI, { y: Math.PI / 4 });
    }
    if (lit) {
      for (const turn of [0, Math.PI / 4]) b.glow(0.26, 0.3, 0.26, lx, cy, lz, SHOJI_GLOW).rotation.y = turn;
      for (const dy of [-0.17, 0.17]) b.glow(0.2, 0.06, 0.2, lx, cy + dy, lz, SHOJI_GLOW).rotation.y = Math.PI / 8;
    } else {
      for (const turn of [0, Math.PI / 4]) sb.box(0.26, 0.3, 0.26, lx, cy, lz, PAPER, { y: turn });
    }
  }

  // --- the inner elevations ------------------------------------------------------
  for (const s of SIDES) {
    const L = faceLen(s) - 2 * t;
    const lim = L / 2 - 0.06;
    for (const u of posts(s)) {
      if (Math.abs(u) < lim) inner(s, u, (F0 + CEIL) / 2, 0.12, CEIL - F0, 0.04, 0.02, HINOKI);
    }
    const doorCut: [number, number][] = s === "-z" ? [[-door / 2 - 0.06, door / 2 + 0.06]] : [];
    for (const [a, c] of carve(-L / 2, L / 2, doorCut)) inner(s, (a + c) / 2, KAMOI + 0.04, c - a, 0.08, 0.04, 0.02, HINOKI);
    inner(s, 0, (KAMOI + 0.08 + CEIL) / 2, L, CEIL - KAMOI - 0.08, 0.01, 0.005, TSUCHI);
    for (const bay of bays[s]) {
      const a = Math.max(bay.a + 0.06, -L / 2);
      const c = Math.min(bay.c - 0.06, L / 2);
      const cu = (a + c) / 2;
      if (bay.kind === "shoji") {
        const y0 = F0 + 0.3;
        if (lit) glowAt(s, wallFace(s) - t - 0.012, cu, (y0 + KAMOI) / 2, c - a, KAMOI - y0);
        else inner(s, cu, (y0 + KAMOI) / 2, c - a, KAMOI - y0, 0.01, 0.012, PAPER);
        inner(s, cu, (F0 + y0) / 2, c - a, y0 - F0, 0.02, 0.01, HINOKI);
        // The sashes seen from the room: stiles, rails and the lattice.
        const np = Math.max(1, Math.round((c - a) / 0.95));
        const pw = (c - a) / np;
        for (let i = 1; i < np; i++) inner(s, a + i * pw, (y0 + KAMOI) / 2, 0.05, KAMOI - y0, 0.03, 0.025, SUMI);
        for (const yr of [y0 + 0.02, KAMOI - 0.02]) inner(s, cu, yr, c - a, 0.04, 0.03, 0.025, SUMI);
        for (let r = 1; r < 6; r++) inner(s, cu, y0 + (r * (KAMOI - y0)) / 6, c - a, 0.02, 0.02, 0.02, SUMI);
        for (let i = 0; i < np; i++) {
          for (let k = 1; k < 3; k++) inner(s, a + i * pw + (k * pw) / 3, (y0 + KAMOI) / 2, 0.02, KAMOI - y0, 0.02, 0.02, SUMI);
        }
      } else if (bay.kind === "plaster") {
        const cy = F0 + 1.25;
        if (s === "+z") inner(s, cu, (F0 + KAMOI) / 2, c - a, KAMOI - F0, 0.01, 0.005, TSUCHI);
        else if (s === roundEnd) plasterWindow(s, -1, a, c, cu, cy, 0.52, 0.52, true, false);
        else plasterWindow(s, -1, a, c, cu + shitajiU, cy, 0.34, 0.4, false, false);
      }
    }
  }

  // --- inside: the tatami, the tokonoma, the brazier, the ceiling ---------------
  const IW = w - 2 * t;
  const ID = d - 2 * t;
  {
    const rz = Math.max(2, Math.round(ID / 0.95));
    const md = ID / rz;
    const cx = Math.max(1, Math.round(IW / 1.85));
    const ml = IW / cx;
    for (let r = 0; r < rz; r++) {
      const z = -ID / 2 + (r + 0.5) * md;
      const cuts: number[] = [-IW / 2];
      for (let i = 1; i < cx; i++) cuts.push(-IW / 2 + i * ml + (r % 2 ? -ml / 2 : 0));
      if (r % 2) cuts.push(IW / 2 - ml / 2);
      cuts.push(IW / 2);
      for (let i = 0; i + 1 < cuts.length; i++) {
        sb.box(cuts[i + 1] - cuts[i] - 0.012, 0.06, md - 0.012, (cuts[i] + cuts[i + 1]) / 2, F0 - 0.02, z, KAYA, undefined, HIDE_UNDER);
      }
    }
    for (let r = 0; r <= rz; r++) {
      const z = Math.max(-ID / 2 + 0.02, Math.min(ID / 2 - 0.02, -ID / 2 + r * md));
      sb.box(IW, 0.02, 0.035, 0, F0 + 0.012, z, SUMI, undefined, HIDE_UNDER);
    }
  }
  {
    // The tokonoma: a raised board with a lacquered edge, the scroll over it,
    // a sprig of maple in a bronze vase.
    const bay = bays["+z"][tokoBay];
    const a0 = Math.max(bay.a + 0.08, -IW / 2 + 0.02);
    const c0 = Math.min(bay.c - 0.08, IW / 2 - 0.02);
    const cu = (a0 + c0) / 2;
    const bw = c0 - a0;
    const zb = ID / 2 - 0.25;
    sb.box(bw, 0.1, 0.5, cu, F0 + 0.055, zb, HINOKI, undefined, HIDE_UNDER);
    sb.box(bw + 0.01, 0.115, 0.05, cu, F0 + 0.0575, ID / 2 - 0.5, SUMI, undefined, HIDE_UNDER);
    const sy = F0 + 1.35;
    inner("+z", cu, sy - 0.02, 0.5, 1.28, 0.012, 0.02, NOREN);
    inner("+z", cu, sy + 0.02, 0.38, 0.84, 0.01, 0.031, PAPER);
    for (let i = 0; i < 4; i++) {
      sb.onFace("+z", d / 2 - t, cu + (rnd() - 0.5) * 0.03, sy + 0.3 - i * 0.2, 0.035, 0.1 + rnd() * 0.06, 0.004, -0.038, SUMI, (rnd() - 0.5) * 0.5, 0, hideBack("-z"));
    }
    for (const yr of [sy - 0.66, sy + 0.64]) inner("+z", cu, yr, 0.58, 0.035, 0.035, 0.03, SUMI);
    const vx = cu + bw * 0.28;
    b.cyl(0.22, 0.09, 0.12, 8, vx, F0 + 0.105 + 0.11, zb, BRONZE);
    member([vx, F0 + 0.3, zb], [vx - 0.08, F0 + 0.62, zb - 0.02], 0.012, 0.012, SUMI);
    for (let i = 0; i < 5; i++) {
      const f = 0.35 + i * 0.15;
      sb.box(0.08, 0.012, 0.06, vx - 0.08 * f + (i % 2 ? 0.05 : -0.05), F0 + 0.3 + 0.32 * f, zb - 0.02 * f, KAKI, { y: rnd() * 3, z: (rnd() - 0.5) * 0.8 });
    }
  }
  {
    // A brazier with a kettle on it, and two cushions.
    const hx = brazier * (IW / 2 - 0.6);
    const hz = -(ID / 2 - 0.6);
    for (const e of [-1, 1]) {
      sb.box(0.46, 0.24, 0.05, hx, F0 + 0.12, hz + e * 0.205, HINOKI, undefined, HIDE_UNDER);
      sb.box(0.05, 0.24, 0.36, hx + e * 0.205, F0 + 0.12, hz, HINOKI, undefined, HIDE_UNDER);
    }
    sb.box(0.36, 0.02, 0.36, hx, F0 + 0.2, hz, GRANITE_DARK, undefined, HIDE_UNDER);
    b.cyl(0.14, 0.15, 0.2, 8, hx, F0 + 0.28, hz, SUMI);
    sb.box(0.05, 0.03, 0.05, hx, F0 + 0.365, hz, BRONZE);
    sb.box(0.1, 0.03, 0.03, hx - brazier * 0.12, F0 + 0.3, hz, SUMI, { z: brazier * 0.6 });
    sb.box(0.17, 0.015, 0.015, hx, F0 + 0.43, hz, SUMI);
    for (const e of [-1, 1]) sb.box(0.015, 0.08, 0.015, hx + e * 0.08, F0 + 0.39, hz, SUMI);
    const cushions: [number, number, number][] = [
      [hx - brazier * 0.7, hz + 0.15, 0.1],
      [hx - brazier * 0.1, hz + 0.75, -0.15],
    ];
    for (const [x, z, yaw] of cushions) sb.box(0.5, 0.06, 0.52, x, F0 + 0.04, z, NOREN, { y: yaw + (rnd() - 0.5) * 0.2 }, HIDE_UNDER);
  }
  // The board ceiling on its battens, a cornice round it.
  sb.box(IW, 0.03, ID, 0, CEIL + 0.015, 0, CEDAR, undefined, TOP);
  {
    const nb = Math.max(3, Math.round(ID / 0.45));
    for (let i = 1; i < nb; i++) sb.box(IW, 0.03, 0.03, 0, CEIL - 0.015, -ID / 2 + (i / nb) * ID, SUMI, undefined, TOP);
    for (const e of [-1, 1]) {
      sb.box(IW, 0.06, 0.06, 0, CEIL - 0.03, e * (ID / 2 - 0.03), HINOKI, undefined, TOP);
      sb.box(0.06, 0.06, ID, e * (IW / 2 - 0.03), CEIL - 0.03, 0, HINOKI, undefined, TOP);
    }
  }

  // --- the engawa: boards along each side, the edge beam, posts on stones -------
  {
    const nb = 6;
    const bw = veranda / nb;
    const run = (along: "x" | "z", lo: number, hi: number, fixed: number): void => {
      let u = lo;
      while (hi - u > 0.05) {
        let len = 2.4 + rnd() * 1.4;
        if (hi - (u + len) < 1.0) len = hi - u;
        const mid = u + len / 2;
        if (along === "x") sb.box(len - 0.008, 0.05, bw - 0.012, mid, F0 - 0.025, fixed, CEDAR, undefined, HIDE_UNDER);
        else sb.box(bw - 0.012, 0.05, len - 0.008, fixed, F0 - 0.025, mid, CEDAR, undefined, HIDE_UNDER);
        u += len;
      }
    };
    for (let j = 0; j < nb; j++) {
      for (const e of [-1, 1]) {
        run("x", -DW, DW, e * (d / 2 + (j + 0.5) * bw));
        run("z", -d / 2, d / 2, e * (w / 2 + (j + 0.5) * bw));
      }
    }
    for (const e of [-1, 1]) {
      sb.box(2 * DW + 0.12, 0.16, 0.12, 0, F0 + 0.012 - 0.08, e * (DD - 0.04), HINOKI, undefined, HIDE_UNDER);
      sb.box(0.12, 0.16, 2 * DD + 0.12, e * (DW - 0.04), F0 + 0.012 - 0.08, 0, HINOKI, undefined, HIDE_UNDER);
    }
    const postAt = (x: number, z: number): void => {
      const g = ground(x, z);
      const sTop = Math.min(F0 - 0.25, g + 0.08);
      const sBot = Math.min(g, foot) - 0.05;
      sb.box(0.28, sTop - sBot, 0.28, x, (sTop + sBot) / 2, z, GRANITE, { y: (rnd() - 0.5) * 0.3 });
      const pTop = F0 - 0.14;
      if (pTop - sTop > 0.03) sb.box(0.1, pTop - sTop, 0.1, x, (pTop + sTop) / 2, z, HINOKI);
    };
    const nx = Math.max(3, Math.round((2 * DW) / 1.5));
    const nzp = Math.max(3, Math.round((2 * DD) / 1.5));
    for (let i = 0; i <= nx; i++) {
      const x = -DW + 0.08 + (i / nx) * (2 * DW - 0.16);
      for (const e of [-1, 1]) postAt(x, e * (DD - 0.08));
    }
    for (let i = 1; i < nzp; i++) {
      const z = -DD + 0.08 + (i / nzp) * (2 * DD - 0.16);
      for (const e of [-1, 1]) postAt(e * (DW - 0.08), z);
    }
    // The stone to step up by, sandals on it, and stepping stones away.
    const zs = -(DD + 0.33);
    const g = ground(0, zs);
    const sTop = Math.min(F0 - 0.2, g + 0.24);
    const sBot = Math.min(g, foot) - 0.05;
    sb.box(1.0, sTop - sBot, 0.55, 0, (sTop + sBot) / 2, zs, GRANITE, { y: (rnd() - 0.5) * 0.1 });
    if (geta) {
      for (const e of [-1, 1]) {
        const gx0 = e * 0.12 + 0.05;
        sb.box(0.09, 0.025, 0.21, gx0, sTop + 0.057, zs - 0.03, HINOKI);
        for (const dz of [-0.06, 0.06]) sb.box(0.09, 0.045, 0.025, gx0, sTop + 0.0225, zs - 0.03 + dz, HINOKI, undefined, HIDE_UNDER);
        sb.box(0.012, 0.02, 0.09, gx0, sTop + 0.078, zs - 0.07, NOREN);
      }
    }
    let px = 0;
    for (let k = 0; k < 3; k++) {
      px += (rnd() - 0.5) * 0.5;
      const z = zs - 0.6 * (k + 1);
      const gk = ground(px, z);
      sb.box(0.46 + rnd() * 0.16, 0.14, 0.4 + rnd() * 0.12, px, gk - 0.03, z, GRANITE, { y: rnd() * 3 });
    }
  }

  // --- under the eave: the purlin on the veranda posts, the ties, the rafters ----
  const RD = 0.08;
  const PD = 0.15;
  const purlinN = (s: Side): number => wallFace(s) + veranda - 0.2;
  const purlinHalf = (s: Side): number => (runsAlongX(s) ? w / 2 : d / 2) + veranda - 0.2 + 0.28;
  const purlinAt = (s: Side, u: number): number => {
    const [x, z] = at(s, u, purlinN(s));
    return soffit(x, z) - RD - PD / 2;
  };
  /** The purlin's centre over `u`: four straight lengths swept up with the eave. */
  const purlinY = (s: Side, u: number): number => {
    const L = purlinHalf(s);
    const k = Math.max(0, Math.min(3.999, ((u + L) / (2 * L)) * 4));
    const i = Math.floor(k);
    const ya = purlinAt(s, -L + (i * L) / 2);
    const yb = purlinAt(s, -L + ((i + 1) * L) / 2);
    return ya + (yb - ya) * (k - i);
  };
  for (const s of SIDES) {
    const L = purlinHalf(s);
    const n = purlinN(s);
    for (let i = 0; i < 4; i++) {
      const ua = -L + (i * L) / 2;
      const uc = ua + L / 2;
      const [xa, za] = at(s, ua, n);
      const [xc, zc] = at(s, uc, n);
      member([xa, purlinY(s, ua), za], [xc, purlinY(s, uc), zc], 0.14, PD, HINOKI, (i > 0 ? START : 0) | (i < 3 ? END : 0));
    }
    // A tie from every post in the wall out to it.
    const pu = posts(s);
    for (let i = 1; i < pu.length - 1; i++) {
      const [xa, za] = at(s, pu[i], wallFace(s) + 0.12);
      const [xc, zc] = at(s, pu[i], n);
      member([xa, PLATE + 0.075, za], [xc, purlinY(s, pu[i]), zc], 0.1, 0.12, HINOKI, START | END);
    }
    // The rafters: from the plate to the eave, in two lengths under the lining.
    const along = runsAlongX(s) ? ex : ez;
    const other = runsAlongX(s) ? w / 2 : d / 2;
    const nEave = runsAlongX(s) ? ez : ex;
    const SP = 0.33;
    const K = Math.floor((along - 0.12) / SP);
    for (let k = -K; k <= K; k++) {
      const u = k * SP;
      const n0 = wallFace(s) + Math.max(0.02, Math.abs(u) - other + 0.09);
      const n1 = nEave - 0.05;
      if (n1 - n0 < 0.2) continue;
      const pt = (nn: number): Point3 => {
        const [x, z] = at(s, u, nn);
        return [x, soffit(x, z) - RD / 2, z];
      };
      const m = pt((n0 + n1) / 2);
      member(pt(n0), m, 0.065, RD, SUMI, TOP | START | END);
      member(m, pt(n1), 0.065, RD, SUMI, TOP | START);
    }
  }
  // The four veranda posts, a bearing block on each.
  for (const [sx, sz] of CORNERS) {
    const x = sx * (DW - 0.2);
    const z = sz * (DD - 0.2);
    const top = Math.min(purlinY(sz < 0 ? "-z" : "+z", x), purlinY(sx < 0 ? "-x" : "+x", z)) - PD / 2;
    sb.box(0.15, top - 0.06 - F0, 0.15, x, (F0 + top - 0.06) / 2, z, HINOKI);
    sb.box(0.21, 0.06, 0.21, x, top - 0.03, z, HINOKI);
  }
  // The hip beams, one into each corner, a wind bell hung from one.
  CORNERS.forEach(([sx, sz], i) => {
    const P = (f: number): Point3 => {
      const x = sx * (w / 2 + f * (ex - 0.06 - w / 2));
      const z = sz * (d / 2 + f * (ez - 0.06 - d / 2));
      return [x, soffit(x, z) - 0.075, z];
    };
    member(P(0), P(0.5), 0.11, 0.15, SUMI, TOP | START | END);
    member(P(0.5), P(1), 0.11, 0.15, SUMI, TOP | START);
    if (i === bellCorner) {
      const [bx, by, bz] = P(0.93);
      sb.box(0.01, 0.12, 0.01, bx, by - 0.135, bz, SUMI);
      b.cyl(0.12, 0.07, 0.15, 8, bx, by - 0.255, bz, BRONZE);
      sb.box(0.01, 0.14, 0.01, bx, by - 0.385, bz, SUMI);
      sb.box(0.06, 0.18, 0.005, bx, by - 0.54, bz, PAPER, { y: Math.atan2(sx, sz) + Math.PI / 2 });
    }
  });
  // Rolled blinds under the purlin on some sides.
  (["+z", "-x", "+x"] as const).forEach((s, i) => {
    if (!blinds[i]) return;
    const half = (runsAlongX(s) ? w / 2 : d / 2) + veranda - 0.2 - 0.3;
    const [x, z] = at(s, 0, purlinN(s) + 0.1);
    const y = purlinY(s, 0) - PD / 2 - 0.07;
    b.cyl(2 * half, 0.12, 0.12, 8, x, y, z, KAYA, runsAlongX(s) ? { z: Math.PI / 2 } : { x: Math.PI / 2 });
    for (const f of [-0.6, 0.6]) {
      const [tx0, tz0] = at(s, f * half, purlinN(s) + 0.1);
      sb.box(0.14, 0.16, 0.14, tx0, y + 0.03, tz0, SUMI);
    }
  });

  // --- the gables: the tympanum's facing, the barge boards, the hanging ornament -
  const U = (n: number): number => vergeTop(n) - TH - 0.01;
  const B = H0 - 0.08;
  const nc = n8 + ((U(n8) - B) / (U(n8) - U(n6))) * (n6 - n8);
  /** Half the tympanum's width at height `y`. */
  const halfAt = (y: number): number =>
    y >= U(n8) ? (n8 * (U(0) - y)) / (U(0) - U(n8)) : n8 + ((U(n8) - y) / (U(n8) - U(n6))) * (n6 - n8);
  for (const s of ["-x", "+x"] as const) {
    const sgn = outward(s);
    /** A member on the tympanum's face; `u` runs along Z. */
    const g = (u: number, y: number, along: number, tall: number, thick: number, out: number, color: string): void =>
      sb.onFace(s, gx, u, y, along, tall, thick, out, color, 0, 0, hideBack(s));
    if (latticeGable) {
      g(0, H0 + 0.05, 2 * nc, 0.1, 0.05, 0.025, HINOKI);
      for (let u = -nc + 0.06; u < nc - 0.05; u += 0.1) {
        const top = U(Math.abs(u) + 0.03) - 0.02;
        if (top - H0 > 0.12) g(u, (H0 + 0.1 + top) / 2, 0.045, top - H0 - 0.1, 0.03, 0.015, HINOKI);
      }
    } else {
      g(0, H0 + 0.09, 2 * nc, 0.14, 0.08, 0.04, HINOKI);
      g(0, (H0 + 0.16 + U(0)) / 2, 0.14, U(0) - H0 - 0.16, 0.07, 0.035, HINOKI);
      for (const f of [0.38, 0.68]) {
        const y = H0 + (U(0) - H0) * f;
        g(0, y, 2 * halfAt(y + 0.05) - 0.04, 0.09, 0.05, 0.025, HINOKI);
      }
    }
    // The barge boards down the verge, both ways from the apex.
    for (const sz of [-1, 1]) {
      const P = (n: number): Point3 => [sgn * (X1 + 0.025), vergeTop(n) - 0.03 - 0.17, sz * n];
      member(P(0), P(n8), 0.05, 0.34, HINOKI, END);
      member(P(n8), P(n6), 0.05, 0.34, HINOKI, START | END);
      member(P(n6), P(nE), 0.05, 0.34, HINOKI, START);
    }
    const ya = vergeTop(0) - 0.34;
    const plate = (x: number): Point3[] => [
      [x, ya + 0.02, 0],
      [x, ya - 0.06, 0.26],
      [x, ya - 0.42, 0.2],
      [x, ya - 0.5, 0],
      [x, ya - 0.42, -0.2],
      [x, ya - 0.06, -0.26],
    ];
    convexSolid(b, plate(sgn * (X1 + 0.045)), plate(sgn * (X1 + 0.085)), HINOKI);
    for (const e of [-1, 1]) sb.box(0.02, 0.06, 0.06, sgn * (X1 + 0.095), ya - 0.2, e * 0.1, BRONZE);
  }

  // --- the tiles: round-tile rows, end tiles, the ridges and demon tiles ----
  {
    const RSP = 0.5;
    const RH = 0.12;
    const segLen = 0.6;
    /** A row of round tiles from `n0` to `n1` on side `s`, `u` along it, ending on an end tile at the eave. */
    const row = (s: Side, u: number, n0: number, n1: number, eaveEnd: boolean): void => {
      if (n1 - n0 < 0.2) return;
      const segs = Math.max(1, Math.ceil((n1 - n0) / segLen));
      for (let j = 0; j < segs; j++) {
        const na = n0 + ((n1 - n0) * j) / segs - (j > 0 ? 0.03 : 0);
        const nb = n0 + ((n1 - n0) * (j + 1)) / segs + (j < segs - 1 ? 0.03 : 0);
        const [xa, za] = at(s, u, na);
        const [xc, zc] = at(s, u, nb);
        const a: Point3 = [xa, topAt(xa, za) + RH / 2 - 0.025, za];
        const c: Point3 = [xc, topAt(xc, zc) + RH / 2 - 0.025, zc];
        const last = j === segs - 1;
        member(a, c, 0.15, RH, KAWARA_DARK, HIDE_UNDER | START | (last && eaveEnd ? 0 : END));
        if (last && eaveEnd) endTile(a, c, 0.16);
      }
    };
    // The eave tiles' lip, one band along every eave the round ends stand on,
    // swept up with the corners — without it the ends read as battlements.
    for (const s of SIDES) {
      const half = runsAlongX(s) ? ex : ez;
      const nEave = runsAlongX(s) ? ez : ex;
      const N = 12;
      const pt = (i: number): Point3 => {
        const [x, z] = at(s, -half + (2 * half * i) / N, nEave);
        return [x, roofHeight(roof, x, z) - 0.02, z];
      };
      for (let i = 0; i < N; i++) member(pt(i), pt(i + 1), 0.05, 0.1, KAWARA_DARK, (i > 0 ? START : 0) | (i < N - 1 ? END : 0));
    }
    const tX = (ax: number): number => (ex - ax) / (ex - tx);
    for (const s of ["-z", "+z"] as const) {
      const K = Math.floor((ex - 0.25) / RSP - 0.5);
      for (let k = -K - 1; k <= K; k++) {
        const u = (k + 0.5) * RSP;
        const au = Math.abs(u);
        if (au <= gx - 0.1) row(s, u, 0.32, ez + 0.02, true);
        else row(s, u, Math.max(ez * (1 - tX(au)) + 0.14, nE + 0.1), ez + 0.02, true);
      }
    }
    for (const s of ["-x", "+x"] as const) {
      const K = Math.floor((ez - 0.25) / RSP - 0.5);
      for (let k = -K - 1; k <= K; k++) {
        const u = (k + 0.5) * RSP;
        const au = Math.abs(u);
        const hip = ex - (ex - tx) * (1 - au / ez) + 0.14;
        row(s, u, au <= nE + 0.05 ? Math.max(hip, X1 + 0.12) : hip, ex + 0.02, true);
      }
    }
    // The verge: a roll of tiles along each edge of it.
    for (const sgn of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const P = (n: number): Point3 => [sgn * (X1 - 0.04), vergeTop(n) + 0.05, sz * n];
        member(P(0.3), P(n8), 0.1, 0.1, KAWARA_DARK, HIDE_UNDER | START | END);
        member(P(n8), P(nE), 0.1, 0.1, KAWARA_DARK, HIDE_UNDER | START);
      }
    }
    // The main ridge: a base, courses banded in white, a round cap, a demon tile each end.
    const RL = 2 * (X1 + 0.06);
    const ry0 = T(1) - 0.05;
    sb.box(RL, 0.3, 0.62, 0, ry0 - 0.15, 0, KAWARA_DARK, undefined, HIDE_UNDER);
    let ridgeY = ry0;
    for (let i = 0; i < 3; i++) {
      const depth = 0.58 - i * 0.07;
      sb.box(RL, 0.08, depth, 0, ridgeY + 0.04, 0, KAWARA_DARK, undefined, HIDE_UNDER);
      ridgeY += 0.08;
      if (i < 2) {
        sb.box(RL - 0.04, 0.028, depth - 0.05, 0, ridgeY + 0.014, 0, SHIKKUI, undefined, HIDE_UNDER);
        ridgeY += 0.028;
      }
    }
    sb.box(RL, 0.16, 0.3, 0, ridgeY + 0.08, 0, KAWARA_DARK, undefined, HIDE_UNDER);
    for (const sx of [-1, 1]) {
      const ox = sx * (RL / 2 + 0.02);
      sb.box(0.14, 0.66, 0.74, ox, ry0 + 0.27, 0, KAWARA_DARK);
      sb.box(0.14, 0.3, 0.46, ox, ry0 + 0.74, 0, KAWARA_DARK);
      sb.box(0.14, 0.3, 0.13, ox + sx * 0.02, ry0 + 0.94, 0, KAWARA_DARK, { z: -sx * 0.35 });
    }
    /** A ridge from `a` to `c`: a body, a white band and a cap. */
    const ridgeRun = (a: Point3, c: Point3): void => {
      const up = (p0: Point3, dy: number): Point3 => [p0[0], p0[1] + dy, p0[2]];
      member(up(a, 0.1), up(c, 0.1), 0.3, 0.22, KAWARA_DARK, HIDE_UNDER | START | END);
      member(up(a, 0.09), up(c, 0.09), 0.33, 0.03, SHIKKUI, START | END | TOP | HIDE_UNDER);
      member(up(a, 0.26), up(c, 0.26), 0.18, 0.1, KAWARA_DARK, HIDE_UNDER | START | END);
    };
    const oni = (p0: Point3, yaw: number): void => {
      sb.box(0.5, 0.58, 0.14, p0[0], p0[1] + 0.28, p0[2], KAWARA_DARK, { y: yaw });
      sb.box(0.34, 0.3, 0.2, p0[0], p0[1] + 0.28, p0[2], KAWARA_DARK, { y: yaw });
      sb.box(0.15, 0.15, 0.12, p0[0], p0[1] + 0.62, p0[2], KAWARA_DARK, { y: yaw, z: Math.PI / 4 });
    };
    for (const [sx, sz] of CORNERS) {
      // The gable's descending ridge down the verge, a demon tile at its foot.
      const V = (n: number): Point3 => [sx * (X1 - 0.24), vergeTop(n), sz * n];
      const nFoot = nE - 0.24;
      ridgeRun(V(0.28), V(n8));
      ridgeRun(V(n8), V(nFoot));
      oni(V(nFoot + 0.02), 0);
      // The hip ridge from under it to the corner of the eave.
      const Hp = (f: number, lift: number): Point3 => {
        const x = sx * (tx + f * (ex - tx));
        const z = sz * f * ez;
        return [x, roofHeight(roof, x, z) + lift, z];
      };
      const f0 = 0.45;
      const fOni = 1 - 0.65 / Math.hypot(ex - tx, ez);
      for (let j = 0; j < 3; j++) {
        const fa = f0 + ((fOni - f0) * j) / 3;
        const fb = f0 + ((fOni - f0) * (j + 1)) / 3;
        ridgeRun(Hp(fa, 0), Hp(fb, 0));
      }
      oni(Hp(fOni + 0.01, 0), Math.atan2(sx * (ex - tx), sz * ez));
      const a = Hp(fOni + 0.02, 0.07);
      const c = Hp(1.0, 0.07);
      member(a, c, 0.22, 0.16, KAWARA_DARK, HIDE_UNDER | START);
      endTile(a, c, 0.22);
    }
  }

  sb.flush(b);

  // --- the cores, emitted after what hides them ------------------------------------
  b.box(side, wallH, t, -off, wy, fz, SUMI);
  b.box(side, wallH, t, off, wy, fz, SUMI);
  b.box(door, lintel, t, 0, wy + wallH / 2 - lintel / 2, fz, SUMI);
  b.box(w, wallH, t, 0, wy, d / 2 - t / 2, SUMI);
  b.box(t, wallH, d, -w / 2 + t / 2, wy, 0, SUMI);
  b.box(t, wallH, d, w / 2 - t / 2, wy, 0, SUMI);
  // The dark between the plate and the lining, closed along every wall line.
  const wallTop = F0 + wallH;
  for (const sz of [-1, 1]) {
    const top = Math.max(soffit(0, sz * d / 2), soffit(w / 2, sz * d / 2)) + 0.1;
    b.box(w, top - wallTop + 0.02, t, 0, (top + wallTop - 0.02) / 2, sz * (d / 2 - t / 2), SUMI);
  }
  for (const sx of [-1, 1]) {
    const top = Math.max(soffit(sx * w / 2, 0), soffit(sx * w / 2, d / 2)) + 0.1;
    b.box(t, top - wallTop + 0.02, d, sx * (w / 2 - t / 2), (top + wallTop - 0.02) / 2, 0, SUMI);
  }
  b.box(2 * DW - 0.2, F0 - 0.05 - foot, 2 * DD - 0.2, 0, (F0 - 0.05 + foot) / 2, 0, SUMI);

  // --- the roof: the lining, the verge and the gables, then the sheet --------------
  curvedRoof(b, CEDAR, { ...roof, raise: -TH - 0.004, thick: 0.02 });
  for (const sz of [-1, 1]) {
    const P = (x: number, n: number, drop: number): Point3 => [x, vergeTop(n) - drop, sz * n];
    const strip = (na: number, nb: number, x0: number, x1: number): void => {
      const prof = (x: number): Point3[] => [P(x, na, 0), P(x, nb, 0), P(x, nb, TH), P(x, na, TH)];
      convexSolid(b, prof(x0), prof(x1), KAWARA);
    };
    strip(0, n8, -X1, X1);
    strip(n8, n6, -X1, X1);
    for (const sx of [-1, 1]) strip(n6, nE, sx * gx, sx * X1);
  }
  const tymp = latticeGable ? SUMI : SHIKKUI;
  for (const sx of [-1, 1]) {
    const pent = (x: number): Point3[] => [
      [x, B, -n8],
      [x, U(n8), -n8],
      [x, U(0), 0],
      [x, U(n8), n8],
      [x, B, n8],
    ];
    convexSolid(b, pent(sx * (gx - 0.3)), pent(sx * gx), tymp);
    for (const sz of [-1, 1]) {
      const tri = (x: number): Point3[] => [
        [x, B, sz * n8],
        [x, U(n8), sz * n8],
        [x, B, sz * nc],
      ];
      convexSolid(b, tri(sx * (gx - 0.3)), tri(sx * gx), tymp);
    }
  }
  curvedRoof(b, KAWARA, roof);
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
 * The FIVE-STOREY PAGODA (gojū-no-tō): the valley's landmark, twenty-eight
 * metres of it, and the one thing on the map you can see from every flag.
 *
 * It is drawn as a painted Edo-period pagoda — Kiyomizu's colours on Tō-ji's
 * five storeys — and every detail follows from how one is built:
 *
 * - **The podium** is dan-jō-zumi: a ground course, granite posts at even
 *   bays with the panels between them set back, and a coping course over it;
 *   the top is laid in flags, and a flight of two steps meets the middle of
 *   each face. It is carried down to the ground under it.
 * - **Each storey** is three bays a side: round vermilion pillars on the
 *   faces, a sill, the door-head nageshi and the head tie whose ends run on
 *   past the corners. The ground storey's doors stand open on the two faces
 *   the courtyard sees (±X) with the lamp inside showing, and are shut
 *   panelled doors on the other two with the lamp showing through their
 *   lattice; the upper storeys have boarded doors. Every side bay has a
 *   renji window — green bars on the diagonal in a vermilion frame.
 * - **Under every eave** is the bracket band on a white wall: a plate on the
 *   pillar heads, a bearing block on each pillar, arms along the wall and out
 *   from it carrying small blocks, a frog-leg strut in each bay, a diagonal
 *   arm at the corners, and the eave purlin the rafters rest on. The rafters
 *   are two layers, base and flying, parallel and cut against the hip beam
 *   at each corner, their ends painted; the hip beam carries a wind bell.
 * - **Each roof** is tiled in rows of round tiles with an end tile at the
 *   eave, a hip ridge down each corner banded in white under a round cap, a
 *   demon tile where it turns up and a short ridge on to the corner.
 * - **Each upper storey** stands on a balcony: a floor on small brackets
 *   over the roof below and a railing of posts, three rails crossed at the
 *   corners and struts between.
 * - **The spire** (sōrin): the dew basin, the inverted bowl, the lotus, the
 *   nine rings, the water flame, the dragon car and the jewel — and four
 *   chains from under the flame down to the corners of the top roof.
 *
 * **The colliders are the ones the pagoda always had, in the same order**:
 * the plinth, the five storeys, then the five roofs (walked first — see the
 * kit header). Only the plinth is walked; the storeys are solid, because a
 * pagoda has no floors to stand on and a perch over every flag with one stair
 * up it is a problem. Everything on the plinth is flat on a face or under
 * 0.3 m; everything else is overhead or stands on a collider.
 *
 * It reads the ground (`BuildCtx`) to carry its podium and its steps down,
 * and seeds the podium's stone lengths off where it stands — which is what
 * puts `pagoda` in `CONFORMS_TO_TERRAIN`.
 */
export function buildPagoda(
  scene: Scene,
  mats: CelMaterialFactory,
  _p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "pagoda");
  const plinthH = 0.55;
  const base = 6.2;

  // --- colliders, exactly as they were: the plinth, the storeys, the roofs --
  b.block({ w: base + 4.4, h: plinthH, d: base + 4.4, x: 0, y: plinthH / 2, z: 0 });
  interface Tier {
    i: number;
    bw: number;
    hb: number;
    /** The storey's foot. */
    y0: number;
    eave: number;
    roof: RoofSpec;
  }
  const tiers: Tier[] = [];
  let y = plinthH;
  for (let i = 0; i < 5; i++) {
    const bw = base - 0.55 * i;
    const hb = i === 0 ? 3.6 : 2.1;
    b.block({ w: bw, h: hb, d: bw, x: 0, y: y + hb / 2, z: 0 });
    const eave = y + hb + 0.45;
    const next = i < 4 ? base - 0.55 * (i + 1) : 0.7;
    tiers.push({
      i,
      bw,
      hb,
      y0: y,
      eave,
      roof: {
        y: eave,
        ex: bw / 2 + 2.0,
        ez: bw / 2 + 2.0,
        tx: next / 2,
        tz: next / 2,
        rise: i < 4 ? 1.25 : 2.6,
        curve: 1.6,
        upturn: 0.6,
        thick: 0.34,
        rings: 5,
        seg: 6,
      },
    });
    y = eave + 0.95;
  }
  // Roofs last (see the kit header).
  for (const t of tiers) {
    b.block({ w: t.bw + 4.0, h: 0.3, d: t.bw + 4.0, x: 0, y: t.eave, z: 0 });
  }

  // --- everything below is drawing -------------------------------------------
  const plinthW = base + 4.4;
  const PH = plinthW / 2;
  const rnd = mulberry32(streetSeed(plinthW, plinthW, 28, ctx));
  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };
  let foot = 0;
  for (const gx of [-1, 0, 1]) {
    for (const gz of [-1, 0, 1]) {
      if (gx || gz) foot = Math.min(foot, ground(gx * (PH + 0.9), gz * (PH + 0.9)));
    }
  }
  foot -= 0.08;

  const sb = new StoneBatch();
  const SIDES: Side[] = ["-z", "+z", "-x", "+x"];
  const CORNERS = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const;
  /** Plan point `n` out from the centre on side `s`, `u` along it. */
  const at = (s: Side, u: number, n: number): [number, number] =>
    runsAlongX(s) ? [u, outward(s) * n] : [outward(s) * n, u];
  // A member laid from `a` to `c` along its own Z hides these faces.
  const TOP = 1 << 2;
  const START = 1 << 5;
  const END = 1 << 4;
  const member = (a: Point3, c: Point3, wide: number, deep: number, color: string, hide = 0): void => {
    const o = orient(a, c);
    sb.box(wide, deep, o.len, o.mid[0], o.mid[1], o.mid[2], color, o.rot, hide);
  };
  /** A painted end: one face, 1.5 cm past `c`, square to the member from `a`. */
  const endFace = (a: Point3, c: Point3, wide: number, deep: number, color: string): void => {
    const o = orient(a, c);
    const k = 0.015 / o.len;
    sb.box(
      wide,
      deep,
      0.01,
      c[0] + (c[0] - a[0]) * k,
      c[1] + (c[1] - a[1]) * k,
      c[2] + (c[2] - a[2]) * k,
      color,
      o.rot,
      63 & ~END,
    );
  };
  /** A member on side `s`'s face `plane`, its back left out. */
  const face = (
    s: Side,
    plane: number,
    u: number,
    yc: number,
    along: number,
    tall: number,
    thick: number,
    out: number,
    color: string,
  ): void => sb.onFace(s, plane, u, yc, along, tall, thick, out, color, 0, 0, hideBack(s));

  // --- the podium: dan-jō-zumi granite, carried down to the ground ----------
  const course = (s: Side, y0: number, y1: number, proud: number, run: number): void => {
    let u = -run;
    while (run - u > 0.05) {
      let len = 1.05 + rnd() * 0.6;
      if (run - (u + len) < 0.5) len = run - u;
      face(s, PH, u + len / 2, (y0 + y1) / 2, len - 0.02, y1 - y0, proud * 2, 0, GRANITE);
      u += len;
    }
  };
  const bays = 6;
  for (const s of SIDES) {
    course(s, foot, 0.1, 0.07, PH + 0.07);
    for (let k = 0; k <= bays; k++) {
      const edge = k === 0 || k === bays;
      const u = edge ? (k === 0 ? -1 : 1) * (PH - 0.06) : -PH + (k * plinthW) / bays;
      face(s, PH, u, 0.265, 0.24, 0.33, 0.12, 0, GRANITE);
      if (k < bays) {
        const u0 = -PH + (k * plinthW) / bays;
        face(s, PH, u0 + plinthW / bays / 2, 0.265, plinthW / bays - 0.2, 0.33, 0.05, 0, GRANITE);
      }
    }
    course(s, 0.43, 0.55, 0.08, PH + 0.08);
    // The flight: two treads in the middle of the face, carried down.
    for (const [top, deep] of [
      [0.15, 0.7],
      [0.3, 0.35],
    ] as const) {
      face(s, PH + 0.08, 0, (foot + top) / 2, 2.6, top - foot, deep, deep / 2, GRANITE);
    }
  }
  // The flags on top, in running bond, laid round the ground storey.
  {
    const inner = base / 2 - 0.05;
    const lim = PH - 0.08;
    const pitch = (lim * 2) / 14;
    for (let r = 0; r < 14; r++) {
      const zc = -lim + pitch * (r + 0.5);
      const spans: [number, number][] = Math.abs(zc) < inner
        ? [
            [-lim, -inner],
            [inner, lim],
          ]
        : [[-lim, lim]];
      for (const [a, c] of spans) {
        let x = a;
        if (r % 2 === 1 && c - a > 2) x += 0.3 + rnd() * 0.3;
        if (x > a) sb.box(x - a - 0.02, 0.05, pitch - 0.02, (a + x) / 2, plinthH - 0.025, zc, GRANITE, undefined, HIDE_UNDER);
        while (c - x > 0.05) {
          let len = 0.85 + rnd() * 0.45;
          if (c - (x + len) < 0.35) len = c - x;
          sb.box(len - 0.02, 0.05, pitch - 0.02, x + len / 2, plinthH - 0.025, zc, GRANITE, undefined, HIDE_UNDER);
          x += len;
        }
      }
    }
  }

  // --- the storeys -----------------------------------------------------------
  /** The side faces of a member on side `s`, turned by `yaw`, that look into the wall. */
  const facing = (s: Side, yaw: number): number => {
    const nx = runsAlongX(s) ? 0 : outward(s);
    const nz = runsAlongX(s) ? outward(s) : 0;
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    let hide = 0;
    for (const [fx, fz, bit] of [
      [c, -sn, 1],
      [-c, sn, 1 << 1],
      [sn, c, 1 << 4],
      [-sn, -c, 1 << 5],
    ] as const) {
      if (fx * nx + fz * nz < -1e-6) hide |= bit;
    }
    return hide;
  };
  /** A renji window: a frame, a dark ground and green bars on the diagonal. */
  const renji = (s: Side, plane: number, u: number, yc: number, w: number, h: number): void => {
    face(s, plane, u, yc, w, h, 0.02, 0.01, SUMI);
    const n = Math.max(4, Math.round(w / 0.11));
    for (let k = 1; k < n; k++) {
      sb.onFace(s, plane, u - w / 2 + (w * k) / n, yc, 0.045, h, 0.045, 0.045, VERDIGRIS, 0, Math.PI / 4, TOP | HIDE_UNDER | facing(s, Math.PI / 4));
    }
    for (const su of [-1, 1]) face(s, plane, u + su * (w / 2 + 0.05), yc, 0.1, h + 0.2, 0.12, 0.06, SHU);
    face(s, plane, u, yc + h / 2 + 0.05, w, 0.1, 0.12, 0.06, SHU);
    face(s, plane, u, yc - h / 2 - 0.06, w + 0.3, 0.12, 0.16, 0.08, SHU);
  };
  /** A door frame: two jambs and a head, proud of the wall. */
  const doorFrame = (s: Side, plane: number, yb: number, w: number, h: number): void => {
    for (const su of [-1, 1]) face(s, plane, su * (w / 2 + 0.06), yb + h / 2, 0.12, h, 0.14, 0.07, SHU);
  };
  /** Shut boarded doors: two leaves of three boards, strapped, with ring pulls. */
  const itado = (s: Side, plane: number, yb: number, w: number, h: number): void => {
    face(s, plane, 0, yb + h / 2, w, h, 0.02, 0.01, SUMI);
    const lw = w / 2;
    for (const su of [-1, 1]) {
      const lu = su * (lw / 2);
      for (let k = 0; k < 3; k++) {
        face(s, plane, lu - lw / 2 + (lw / 3) * (k + 0.5), yb + h / 2, lw / 3 - 0.014, h - 0.02, 0.05, 0.025, SHU);
      }
      for (const yf of [0.22, 0.78]) face(s, plane, lu, yb + h * yf, lw - 0.1, 0.07, 0.02, 0.06, BRONZE);
      face(s, plane, su * 0.07, yb + h * 0.5, 0.06, 0.12, 0.03, 0.065, BRONZE);
    }
  };
  /** Shut panelled doors (sankarado): lattice over the lamp above, boards below. */
  const sankarado = (s: Side, plane: number, yb: number, w: number, h: number): void => {
    const lw = w / 2;
    const midY = yb + h * 0.42;
    const topY = yb + h;
    for (const su of [-1, 1]) {
      const lu = su * (lw / 2);
      const [gx, gz] = at(s, lu, plane + 0.012);
      const panelH = topY - midY - 0.2;
      const panelY = (midY + topY) / 2 - 0.01;
      if (runsAlongX(s)) b.glow(lw - 0.2, panelH, 0.02, gx, panelY, gz, GILT_GLOW);
      else b.glow(0.02, panelH, lw - 0.2, gx, panelY, gz, GILT_GLOW);
      face(s, plane, lu, (yb + midY) / 2, lw - 0.16, midY - yb, 0.04, 0.02, SHU);
      for (const e of [-1, 1]) face(s, plane, lu + e * (lw / 2 - 0.05), yb + h / 2, 0.1, h, 0.08, 0.04, SHU);
      for (const [yr, hr] of [
        [yb + 0.08, 0.16],
        [midY, 0.14],
        [topY - 0.06, 0.12],
      ] as const) {
        face(s, plane, lu, yr, lw - 0.2, hr, 0.08, 0.04, SHU);
      }
      for (let k = 1; k < 3; k++) face(s, plane, lu - (lw - 0.2) / 2 + ((lw - 0.2) * k) / 3, panelY, 0.035, panelH, 0.04, 0.045, SHU);
      for (let k = 1; k < 5; k++) face(s, plane, lu, midY + 0.07 + (panelH * k) / 5, lw - 0.2, 0.035, 0.04, 0.045, SHU);
      face(s, plane, su * 0.09, midY - 0.25, 0.07, 0.07, 0.03, 0.095, BRONZE);
    }
  };

  const ringPillars: [number, number, number][] = [];
  for (const t of tiers) {
    const half = t.bw / 2;
    const top = t.y0 + t.hb;
    const ground0 = t.i === 0;
    const floor = ground0 ? t.y0 : t.y0 + 0.15;
    const bay = t.bw / 3;
    // Pillars at the corners and either side of the middle bay, their centres
    // on the faces.
    const posts: [number, number][] = [];
    for (const [sx, sz] of CORNERS) posts.push([sx * half, sz * half]);
    for (const s of SIDES) for (const su of [-1, 1]) posts.push(at(s, (su * half) / 3, half));
    for (const [px, pz] of posts) {
      if (ground0) {
        b.cyl(t.hb, 0.4, 0.42, 10, px, t.y0 + t.hb / 2, pz, SHU);
        ringPillars.push([px, pz, 0.62]);
      } else {
        b.cyl(top - floor, 0.3, 0.3, 6, px, (floor + top) / 2, pz, SHU);
      }
    }
    for (const s of SIDES) {
      // The sill, the door-head nageshi and the head tie, whose ends run on
      // past the corner pillars.
      face(s, half, 0, floor + 0.1, t.bw + 0.1, 0.2, 0.12, 0.06, SHU);
      const doorH = ground0 ? 2.4 : 1.2;
      const doorB = floor + 0.2;
      const nageshi = doorB + doorH + 0.1;
      face(s, half, 0, nageshi, t.bw + 0.12, ground0 ? 0.2 : 0.14, 0.12, 0.06, SHU);
      face(s, half, 0, top - (ground0 ? 0.3 : 0.24), t.bw + 0.5, ground0 ? 0.2 : 0.16, 0.1, 0.05, SHU);
      // The middle bay's doors.
      const doorW = ground0 ? 1.6 : Math.min(1.1, bay - 0.45);
      doorFrame(s, half, doorB, doorW, doorH);
      if (!ground0) itado(s, half, doorB, doorW, doorH);
      else if (runsAlongX(s)) sankarado(s, half, doorB, doorW, doorH);
      else {
        const [gx, gz] = at(s, 0, half + 0.012);
        b.glow(0.02, doorH, doorW, gx, doorB + doorH / 2, gz, GILT_GLOW);
      }
      // A renji window in each side bay.
      const winW = ground0 ? 1.1 : Math.min(0.9, bay - 0.55);
      const winH = ground0 ? 1.0 : 0.72;
      const winY = nageshi - (ground0 ? 0.2 : 0.15) - winH / 2 - 0.08;
      for (const su of [-1, 1]) renji(s, half, (su * bay), winY, winW, winH);
    }
    if (!ground0) {
      // The balcony: a floor on small brackets over the roof below, an edge
      // beam, and a railing crossed at the corners.
      const rim = half + 0.6;
      sb.box(t.bw + 1.2, 0.1, t.bw + 1.2, 0, t.y0 + 0.1, 0, HINOKI);
      const railN = rim - 0.05;
      for (const s of SIDES) {
        face(s, rim, 0, t.y0 + 0.07, t.bw + 1.24, 0.16, 0.08, 0, SHU);
        const nb = Math.round((t.bw + 1.0) / 0.95);
        for (let k = 0; k <= nb; k++) {
          sb.onFace(s, rim, -half - 0.5 + ((t.bw + 1.0) * k) / nb, t.y0 - 0.06, 0.12, 0.22, 0.3, -0.15, SHU, 0, 0, hideBack(s) | TOP);
        }
        const along = railN * 2 + 0.24;
        face(s, railN, 0, t.y0 + 0.82, along, 0.08, 0.09, 0, SHU);
        face(s, railN, 0, t.y0 + 0.52, along, 0.06, 0.06, 0, SHU);
        face(s, railN, 0, t.y0 + 0.21, along, 0.1, 0.08, 0, SHU);
        for (const u of [-half / 3, half / 3]) face(s, railN, u, t.y0 + 0.5, 0.09, 0.7, 0.09, 0, SHU);
        const ns = Math.round((railN * 2) / 0.6);
        for (let k = 1; k < ns; k++) {
          sb.onFace(s, railN, -railN + (railN * 2 * k) / ns, t.y0 + 0.395, 0.04, 0.3, 0.04, 0, SHU, 0, 0, TOP | HIDE_UNDER);
        }
      }
      for (const [sx, sz] of CORNERS) {
        sb.box(0.11, 0.78, 0.11, sx * railN, t.y0 + 0.54, sz * railN, SHU);
        sb.box(0.13, 0.08, 0.13, sx * railN, t.y0 + 0.97, sz * railN, BRONZE);
      }
    }
  }
  for (const [px, pz, d] of ringPillars) b.cyl(0.06, d - 0.04, d, 10, px, plinthH + 0.03, pz, GRANITE_DARK);

  // --- under every eave: the bracket band, the rafters and the hip beams ----
  const RAFTER_BASE = 0.14;
  const RAFTER_FLY = 0.1;
  for (const t of tiers) {
    const R = t.roof;
    const half = t.bw / 2;
    const Y0 = t.y0 + t.hb;
    const soffit = (x: number, z: number): number => roofHeight(R, x, z, true) + 0.02;
    // The base rafters run from the wall to `baseEnd` and rest on the purlin at
    // `purlinN`; its top is where their straight run passes over it.
    const baseStart = half - 0.05;
    const baseEnd = half + 1.25;
    const purlinN = half + 0.5;
    const s0 = soffit(0, -baseStart);
    const s1 = soffit(0, -baseEnd);
    const purlinTop = s0 + ((s1 - s0) * (purlinN - baseStart)) / (baseEnd - baseStart) - RAFTER_BASE - 0.01;
    const purlinBot = Y0 + 0.51;

    // The white wall the brackets read against, up into the roof.
    const panelTop = soffit(0, -baseStart) + 0.05;
    sb.box(t.bw - 0.1, panelTop - Y0, t.bw - 0.1, 0, (Y0 + panelTop) / 2, 0, SHIKKUI);

    for (const s of SIDES) {
      face(s, half, 0, Y0 + 0.05, t.bw + 0.5, 0.1, 0.3, 0.1, SHU);
      // The bracket sets on the pillars: a bearing block, an arm along the
      // wall carrying two small blocks, and one out from it carrying another.
      for (const u of [-half / 3, half / 3]) {
        sb.onFace(s, half, u, Y0 + 0.19, 0.34, 0.18, 0.34, 0.1, SHU, 0, 0, hideBack(s) | TOP);
        face(s, half, u, Y0 + 0.345, 1.0, 0.13, 0.14, 0.1, SHU);
        for (const du of [-0.4, 0.4]) sb.onFace(s, half, u + du, Y0 + 0.46, 0.18, 0.1, 0.18, 0.1, SHU, 0, 0, hideBack(s) | TOP);
      }
      // The frog-leg strut in each bay.
      for (const u of [-(2 * half) / 3, 0, (2 * half) / 3]) {
        face(s, half, u, Y0 + 0.14, 0.48, 0.08, 0.16, 0.08, SHU);
        face(s, half, u, Y0 + 0.23, 0.22, 0.1, 0.16, 0.08, SHU);
        sb.onFace(s, half, u, Y0 + 0.46, 0.18, 0.1, 0.18, 0.1, SHU, 0, 0, hideBack(s) | TOP);
      }
      for (const u of [-half, -half / 3, 0, half / 3, half, -(2 * half) / 3, (2 * half) / 3]) {
        face(s, half, u, Y0 + 0.345, 0.14, 0.13, 0.77, 0.335, SHU);
        sb.onFace(s, half, u, Y0 + 0.46, 0.18, 0.1, 0.18, 0.5, SHU, 0, 0, hideBack(s) | TOP);
      }
      // The wall purlin and the eave purlin, crossed at the corners.
      face(s, half, 0, Y0 + 0.57, t.bw + 0.4, 0.12, 0.14, 0.1, SHU);
      face(s, half, 0, (purlinBot + purlinTop) / 2, t.bw + 1.2, purlinTop - purlinBot, 0.2, 0.5, SHU);
    }
    for (const [sx, sz] of CORNERS) {
      const yaw = Math.atan2(sx, sz);
      sb.box(0.4, 0.18, 0.4, sx * half, Y0 + 0.19, sz * half, SHU);
      member([sx * (half - 0.05), Y0 + 0.345, sz * (half - 0.05)], [sx * (half + 0.62), Y0 + 0.345, sz * (half + 0.62)], 0.16, 0.13, SHU);
      sb.box(0.2, 0.1, 0.2, sx * purlinN, Y0 + 0.46, sz * purlinN, SHU, { y: yaw });
    }

    // The rafters: parallel, base and flying, cut against the hip at the
    // corners, their tops tucked into the sheet and their ends painted.
    const SP = 0.36;
    const K = Math.floor((R.ex - 0.1) / SP);
    for (const s of SIDES) {
      for (let k = -K; k <= K; k++) {
        const u = k * SP;
        const au = Math.abs(u);
        const lay = (n0: number, n1: number, wide: number, deep: number): void => {
          if (n1 - n0 < 0.15) return;
          const [xa, za] = at(s, u, n0);
          const [xc, zc] = at(s, u, n1);
          const a: Point3 = [xa, soffit(xa, za) - deep / 2, za];
          const c: Point3 = [xc, soffit(xc, zc) - deep / 2, zc];
          member(a, c, wide, deep, SHU, TOP | START);
          endFace(a, c, wide - 0.01, deep - 0.01, SHIKKUI);
        };
        lay(Math.max(baseStart, au + 0.1), baseEnd, 0.12, RAFTER_BASE);
        lay(Math.max(half + 1.1, au + 0.1), R.ex - 0.04, 0.1, RAFTER_FLY);
      }
    }
    // The hip beam under each corner, capped in bronze, and a wind bell on it.
    for (const [sx, sz] of CORNERS) {
      const P = (n: number, deep: number): Point3 => [sx * n, roofHeight(R, sx * n, sz * n, true) + 0.02 - deep / 2, sz * n];
      member(P(half - 0.1, 0.28), P(half + 1.25, 0.28), 0.24, 0.28, SHU, TOP | START);
      const a = P(half + 1.1, 0.22);
      const c = P(R.ex + 0.06, 0.22);
      member(a, c, 0.2, 0.22, SHU, TOP | START);
      endFace(a, c, 0.22, 0.24, BRONZE);
      const bx = c[0];
      const bz = c[2];
      const by = c[1] - 0.11;
      sb.box(0.03, 0.16, 0.03, bx, by - 0.08, bz, BRONZE);
      b.cyl(0.3, 0.13, 0.22, 8, bx, by - 0.31, bz, BRONZE);
      sb.box(0.13, 0.2, 0.012, bx, by - 0.6, bz, BRONZE, { y: Math.atan2(sx, sz) + Math.PI / 2 });
    }
  }

  // --- the tiles: round-tile rows, end tiles, hip ridges and demon tiles ----
  for (const t of tiers) {
    const R = t.roof;
    const topAt = (x: number, z: number): number => roofHeight(R, x, z);
    const RSP = 0.5;
    const RH = 0.12;
    const segLen = R.rise > 2 ? 0.55 : 0.8;
    const K = Math.floor((R.ex - 0.25) / RSP - 0.5);
    for (const s of SIDES) {
      for (let k = -K - 1; k <= K; k++) {
        const u = (k + 0.5) * RSP;
        const au = Math.abs(u);
        const n0 = Math.max(R.tx - 0.04, au + 0.12);
        const n1 = R.ex - 0.01;
        if (n1 - n0 < 0.2) continue;
        const segs = Math.max(1, Math.ceil((n1 - n0) / segLen));
        for (let j = 0; j < segs; j++) {
          const na = n0 + ((n1 - n0) * j) / segs - (j > 0 ? 0.03 : 0);
          const nb = n0 + ((n1 - n0) * (j + 1)) / segs + (j < segs - 1 ? 0.03 : 0);
          const [xa, za] = at(s, u, na);
          const [xc, zc] = at(s, u, nb);
          const a: Point3 = [xa, topAt(xa, za) + RH / 2 - 0.025, za];
          const c: Point3 = [xc, topAt(xc, zc) + RH / 2 - 0.025, zc];
          // Laid inward-out, so `c` is the eave end.
          member(a, c, 0.15, RH, KAWARA_DARK, HIDE_UNDER | START | (j < segs - 1 ? END : 0));
          if (j === segs - 1) endFace(a, c, 0.2, 0.19, KAWARA_DARK);
        }
      }
    }
    for (const [sx, sz] of CORNERS) {
      const yaw = Math.atan2(sx, sz);
      const P = (n: number, lift: number): Point3 => [sx * n, topAt(sx * n, sz * n) + lift, sz * n];
      const oniN = R.ex - 0.6;
      const n0 = R.tx - 0.06;
      const segs = 4;
      for (let j = 0; j < segs; j++) {
        const na = n0 + ((oniN - n0) * j) / segs - (j > 0 ? 0.04 : 0);
        const nb = n0 + ((oniN - n0) * (j + 1)) / segs + 0.04;
        member(P(na, 0.09), P(nb, 0.09), 0.36, 0.26, KAWARA_DARK, HIDE_UNDER | START | END);
        member(P(na, 0.08), P(nb, 0.08), 0.39, 0.03, SHIKKUI, START | END | TOP | HIDE_UNDER);
        member(P(na, 0.26), P(nb, 0.26), 0.2, 0.12, KAWARA_DARK, HIDE_UNDER | START | END);
      }
      // The demon tile where the ridge turns up, and the short ridge on to
      // the corner under its own end tile.
      const [ox, oy, oz] = P(oniN + 0.04, 0);
      sb.box(0.52, 0.62, 0.14, ox, oy + 0.3, oz, KAWARA_DARK, { y: yaw });
      sb.box(0.36, 0.34, 0.2, ox, oy + 0.3, oz, KAWARA_DARK, { y: yaw });
      sb.box(0.16, 0.16, 0.12, ox, oy + 0.66, oz, KAWARA_DARK, { y: yaw, z: Math.PI / 4 });
      const a = P(oniN + 0.08, 0.06);
      const c = P(R.ex + 0.02, 0.06);
      member(a, c, 0.22, 0.16, KAWARA_DARK, HIDE_UNDER | START);
      endFace(a, c, 0.24, 0.2, KAWARA_DARK);
    }
  }

  // --- the spire (sōrin) -----------------------------------------------------
  const spire = tiers[4].eave + 2.6;
  sb.box(1.3, 0.2, 1.3, 0, spire - 0.05, 0, BRONZE);
  sb.box(1.1, 0.3, 1.1, 0, spire + 0.2, 0, BRONZE);
  b.cyl(0.25, 0.95, 1.05, 12, 0, spire + 0.475, 0, BRONZE);
  b.cyl(0.2, 0.55, 0.95, 12, 0, spire + 0.7, 0, BRONZE);
  b.cyl(0.35, 0.95, 0.4, 12, 0, spire + 0.975, 0, VERDIGRIS);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    sb.box(0.2, 0.22, 0.05, Math.sin(a) * 0.46, spire + 1.12, Math.cos(a) * 0.46, VERDIGRIS, { y: a, x: 0.45 });
  }
  b.cyl(5.9, 0.16, 0.2, 8, 0, spire + 1.1 + 2.95, 0, BRONZE);
  for (let r = 0; r < 9; r++) {
    const dia = 1.0 - r * 0.035;
    b.cyl(0.1, dia, dia, 12, 0, spire + 1.4 + r * 0.5, 0, VERDIGRIS);
  }
  // The water flame: two openwork plates crossed, each a pointed flame.
  const flameY = spire + 5.7;
  for (const turn of [0, Math.PI / 2]) {
    const c = Math.cos(turn);
    const sn = Math.sin(turn);
    const outline: [number, number][] = [
      [0, 0],
      [0.3, 0.12],
      [0.44, 0.45],
      [0.38, 0.8],
      [0.2, 1.05],
      [0, 1.2],
      [-0.2, 1.05],
      [-0.38, 0.8],
      [-0.44, 0.45],
      [-0.3, 0.12],
    ];
    const plate = (off: number): Point3[] => outline.map(([h, v]) => [h * c + off * sn, flameY + v, -h * sn + off * c]);
    convexSolid(b, plate(-0.02), plate(0.02), VERDIGRIS);
  }
  b.cyl(0.14, 0.3, 0.12, 8, 0, spire + 7.0, 0, BRONZE);
  b.cyl(0.14, 0.12, 0.3, 8, 0, spire + 7.14, 0, BRONZE);
  b.cyl(0.3, 0.36, 0.14, 8, 0, spire + 7.36, 0, BRONZE);
  b.cyl(0.32, 0.02, 0.36, 8, 0, spire + 7.67, 0, BRONZE);
  // The chains, from under the flame to the corners of the top roof.
  {
    const R = tiers[4].roof;
    const n = R.ex - 0.75;
    for (const [sx, sz] of CORNERS) {
      const A: Point3 = [sx * 0.12, spire + 5.55, sz * 0.12];
      const C: Point3 = [sx * n, roofHeight(R, sx * n, sz * n) + 0.45, sz * n];
      const pts: Point3[] = [];
      for (let k = 0; k <= 3; k++) {
        const f = k / 3;
        pts.push([A[0] + (C[0] - A[0]) * f, A[1] + (C[1] - A[1]) * f - Math.sin(f * Math.PI) * 0.45, A[2] + (C[2] - A[2]) * f]);
      }
      for (let k = 0; k < 3; k++) limb(b, pts[k], pts[k + 1], 0.045, 0.045, BRONZE, 4);
    }
  }

  sb.flush(b);

  // --- the roofs, over the tiles laid on them, and the cores ----------------
  for (const t of tiers) curvedRoof(b, KAWARA, t.roof);
  for (const t of tiers) b.box(t.bw, t.hb, t.bw, 0, t.y0 + t.hb / 2, 0, SHIKKUI);
  b.box(plinthW, plinthH - 0.03 - foot, plinthW, 0, (foot + plinthH - 0.03) / 2, 0, GRANITE_DARK);
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
