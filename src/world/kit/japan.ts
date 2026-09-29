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
  rope,
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

// --- the gate everyone walks through ---------------------------------------------

/**
 * A TORII — a myōjin gate, the shape every shrine in the valley uses and the
 * one on this map that tells a player they have crossed from the town into
 * the sacred without a word on screen.
 *
 * It is drawn as the gate is built. Each post stands in a black lacquered
 * sleeve (kamaki) on a granite mound (kamebara) on a plinth stone carried
 * down to the ground. The tie beam (nuki) runs through both posts and out
 * past them, locked by a wedge (kusabi) beside each post; a short king post
 * (gakuzuka) stands on it in the middle. Over the posts lies the straight
 * lower lintel (shimaki) in the gate's colour, and on that the great black
 * lintel (kasagi): a crowned section, flat between the posts and sweeping up
 * past them, with each end cut on a slant so its top overhangs.
 *
 * What it carries says what kind of gate it is. **The gate that marks a
 * precinct** hangs the shrine's name on the king post — a framed black
 * plaque (gaku) with its characters in bronze on the FRONT, which is local
 * -Z and faces the approach — and a sacred rope (shimenawa) under the tie
 * beam: two strands of straw twisted together, thick in the middle, hung with
 * zig-zag paper (shide) and straw tassels. **A `votive` gate** is one of the
 * close-set run up an Inari approach, given by a donor: it wears the Inari
 * collar (daiwa) at the head of each post, has no plaque and no rope, and
 * carries the donor's inscription in black down the BACK of both posts —
 * which is the side a walker coming back down the tunnel sees.
 *
 * Solid posts (a body walks into one and a round stops on it); the tie, the
 * lower lintel and the black lintel are `rayOnly` boxes — ray geometry and
 * nothing else, because they are four metres over anybody's head and a nav
 * surface up there is one nobody can reach. The drawing keeps to them: the
 * shimaki is exactly its box, and the kasagi's curve lifts only its TOP over
 * the collider and its bottom only past the collider's end. Everything low —
 * the plinth, the mound, the sleeve's band — is under a stride, and the
 * rope's paper and tassels hang no lower than 2.8 m.
 *
 * `width` is the span between the posts, `height` the lintel's underside;
 * `tint` recolours the timber, and the sleeve and the black lintel stay black
 * whatever it is. It is in `CONFORMS_TO_TERRAIN`: the characters and the
 * rope's twist are seeded off where it stands, and each post's plinth is
 * carried down to the ground under that post.
 */
export function buildTorii(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "torii");
  const span = p.width ?? 4.6;
  const h = p.height ?? 6;
  const color = p.tint ?? SHU;
  const postD = Math.max(0.36, h * 0.075);
  const tie = h - Math.max(0.9, h * 0.19);
  const reach = span / 2 + postD * 2.4;

  // --- the colliders, exactly as they were and in the same order -----------------
  for (const sx of [-1, 1]) {
    b.block({ w: postD * 0.9, h, d: postD * 0.9, x: (sx * span) / 2, y: h / 2, z: 0 });
  }
  const beam = (w: number, bh: number, d: number, y: number): void =>
    b.block({ w, h: bh, d, x: 0, y, z: 0, rotX: undefined, rotY: undefined, rayOnly: true });
  beam(span + postD * 2.6, postD * 0.62, postD * 0.52, tie);
  beam(reach * 2 - 0.4, postD * 0.62, postD * 0.95, h + postD * 0.31);
  beam(reach * 2 - 1.2, postD * 0.62, postD * 1.15, h + postD * 0.93);

  // --- everything below is drawing -------------------------------------------
  const votive = p.votive === true;
  const rnd = mulberry32(streetSeed(span, h, postD, ctx));
  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };
  const sb = new StoneBatch();
  /** How much bigger than the 6 m gate's parts this gate's are. */
  const k = postD / 0.45;
  const nukiH = postD * 0.62;
  const nukiD = postD * 0.52;
  const nukiTop = tie + nukiH / 2;
  const foot = Math.min(0, ground(-span / 2, 0), ground(span / 2, 0)) - 0.08;
  /** The post's radius at `y`: the cylinder tapers from `postD` at its foot to 0.88 of it. */
  const radius = (y: number): number => (postD - postD * 0.12 * ((y - foot) / (h - foot))) / 2;

  // The posts, each on its plinth, mound and sleeve.
  for (const sx of [-1, 1]) {
    const x = (sx * span) / 2;
    b.cyl(h - foot, postD * 0.88, postD, 16, x, (h + foot) / 2, 0, color);
    const s = postD * 1.2;
    const corners = [-1, 1].flatMap((cx) => [-1, 1].map((cz) => ground(x + cx * s, cz * s)));
    const top = Math.max(...corners) + 0.03;
    const low = Math.min(...corners) - 0.22;
    b.box(s * 2, top - low, s * 2, x, (top + low) / 2, 0, GRANITE_DARK);
    // The mound: three bands, each narrower, a dome the ink finds as bends.
    let y = top;
    for (const [hh, d0, d1] of [
      [0.08, 1.95, 1.72],
      [0.07, 1.72, 1.42],
      [0.05, 1.42, 1.18],
    ]) {
      b.cyl(hh, postD * d1, postD * d0, 16, x, y + hh / 2, 0, GRANITE);
      y += hh;
    }
    const sleeve = 0.62 * k;
    b.cyl(sleeve, postD + 0.06, postD + 0.08, 16, x, y + sleeve / 2, 0, SUMI);
    b.cyl(0.05, postD + 0.13, postD + 0.13, 16, x, y + sleeve - 0.05, 0, SUMI);
    b.cyl(0.04, postD + 0.12, postD + 0.12, 16, x, y + 0.02, 0, SUMI);
    // The Inari collar at the head of the post, under the lintel.
    if (votive) b.cyl(postD * 0.26, postD * 1.18, postD * 1.18, 16, x, h - postD * 0.13, 0, color);
    // The wedge driven beside the post, outboard, standing on the tie.
    const wx = sx * (span / 2 + radius(nukiTop) + postD * 0.13);
    b.box(postD * 0.24, postD * 0.34, nukiD * 0.72, wx, nukiTop + postD * 0.17, 0, color);
  }

  // The tie beam, and the king post on it.
  b.box(span + postD * 2.6, nukiH, nukiD, 0, tie, 0, color);
  const kpD = postD * 0.4;
  b.box(postD * 0.62, h - nukiTop, kpD, 0, (h + nukiTop) / 2, 0, color);

  // The lower lintel: exactly its collider.
  b.box(reach * 2 - 0.4, postD * 0.62, postD * 0.95, 0, h + postD * 0.31, 0, color);

  // The great lintel. A crowned section, laid as convex solids between
  // stations: one flat run between the posts, then a sweep out to each tip.
  // Its top rises `sori` past the posts; its bottom stays on the lower lintel
  // to that beam's end and lifts only past it; the tip is cut on a slant.
  {
    const y0 = h + postD * 0.62;
    const kh = postD * 0.62;
    const kd = postD * 1.15;
    const sori = postD * 0.7;
    const xs = span / 2;
    const xe = reach - 0.2;
    const topAt = (x: number): number => {
      const t = Math.max(0, (Math.abs(x) - xs) / (reach - xs));
      return y0 + kh + sori * t * t;
    };
    const botAt = (x: number): number => {
      const u = Math.max(0, (Math.abs(x) - xe) / (reach - xe));
      return y0 + 0.12 * u * u;
    };
    const section = (x: number, slant = 0): Point3[] => {
      const lo = botAt(x);
      const hi = topAt(x);
      const shoulder = lo + (hi - lo) * 0.78;
      const at = (y: number): number => x + (slant * (y - lo)) / (hi - lo);
      return [
        [at(lo), lo, -kd * 0.44],
        [at(lo), lo, kd * 0.44],
        [at(shoulder), shoulder, kd * 0.5],
        [at(hi), hi, 0],
        [at(shoulder), shoulder, -kd * 0.5],
      ];
    };
    convexSolid(b, section(-xs), section(xs), SUMI);
    for (const sx of [-1, 1]) {
      const stations = [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6].map((f) => xs + (reach - xs) * f);
      stations.push(xe);
      stations.sort((a, c) => a - c);
      stations.push(reach);
      for (let i = 0; i + 1 < stations.length; i++) {
        const last = i + 2 === stations.length;
        convexSolid(b, section(sx * stations[i]), section(sx * stations[i + 1], last ? sx * postD * 0.3 : 0), SUMI);
      }
    }
  }

  if (!votive) {
    // The plaque on the king post, on the front: a black board in a frame
    // under a little hood, bronze at its corners and the name in bronze.
    const gap = h - nukiTop;
    const ph = gap * 0.74;
    const pw = Math.max(0.36, ph * 0.66);
    const yc = (h + nukiTop) / 2;
    const zb = -(kpD / 2 + 0.02);
    const fz = zb - 0.035;
    sb.box(pw - 0.08, ph - 0.08, 0.04, 0, yc, zb, SUMI);
    for (const e of [-1, 1]) {
      sb.box(pw, 0.07, 0.07, 0, yc + e * (ph / 2 - 0.035), fz, color);
      sb.box(0.07, ph - 0.14, 0.07, e * (pw / 2 - 0.035), yc, fz, color);
    }
    sb.box(pw + 0.12, 0.05, 0.16, 0, yc + ph / 2 + 0.025, zb - 0.04, SUMI);
    for (const e of [-1, 1]) {
      for (const f of [-1, 1]) sb.box(0.09, 0.09, 0.02, e * (pw / 2 - 0.045), yc + f * (ph / 2 - 0.045), fz - 0.04, BRONZE);
    }
    const cells = 3;
    const cell = (ph - 0.2) / cells;
    const gw = pw - 0.2;
    const stroke = Math.max(0.028, cell * 0.12);
    for (let g = 0; g < cells; g++) {
      const gy = yc + ph / 2 - 0.1 - (g + 0.5) * cell;
      for (let s = 0; s < 5; s++) {
        const horiz = rnd() < 0.55;
        const len = (horiz ? gw : cell) * (0.35 + rnd() * 0.55);
        const x = (rnd() - 0.5) * (horiz ? gw - len : gw * 0.8);
        const y = gy + (rnd() - 0.5) * (horiz ? cell * 0.8 : cell - len);
        const roll = rnd() < 0.25 ? (rnd() - 0.5) * 1.2 : 0;
        sb.box(horiz ? len : stroke, horiz ? stroke : len, 0.02, x, y, zb - 0.03, BRONZE, { z: roll }, hideBack("-z"));
      }
    }

    // The sacred rope under the tie beam: two strands twisted, thick in the
    // middle, hung with paper and tassels.
    const ry = tie - nukiH / 2 - 0.05 * k;
    const half = span / 2 - radius(ry) * 0.6;
    const sag = Math.min(0.28, span * 0.05);
    const thick = 0.25 * k;
    const thin = 0.075 * k;
    const ropeZ = -nukiD * 0.1;
    const twist = 5 + Math.floor(rnd() * 3);
    const phase = rnd() * Math.PI;
    const at = (s: number): Point3 => [s * half, ry - thick / 2 - sag * (1 - s * s), ropeZ];
    const girth = (s: number): number => thin + (thick - thin) * (1 - Math.abs(s));
    for (let strand = 0; strand < 2; strand++) {
      for (const side of [-1, 1]) {
        const pts: Point3[] = [];
        for (let i = 0; i <= 8; i++) {
          const s = side * (1 - i / 8);
          const a = s * Math.PI * twist + strand * Math.PI + phase;
          const r = girth(s) * 0.24;
          const c = at(s);
          pts.push([c[0], c[1] + Math.cos(a) * r, c[2] + Math.sin(a) * r]);
        }
        rope(b, pts, thin * 0.68, thick * 0.68, KAYA, 6);
      }
    }
    // Paper: four zig-zag strips; straw: three tassels between them.
    const pieceW = 0.075 * k;
    const pieceH = 0.1 * k;
    for (const s of [-0.62, -0.21, 0.21, 0.62]) {
      const c = at(s);
      const y = c[1] - girth(s) / 2 + 0.01;
      for (let i = 0; i < 4; i++) {
        const off = (i % 2 === 0 ? -1 : 1) * pieceW * 0.4;
        sb.box(pieceW, pieceH, 0.008, c[0] + off, y - pieceH * (i + 0.5), c[2] - girth(s) * 0.2, PAPER);
      }
    }
    for (const s of [-0.42, 0, 0.42]) {
      const c = at(s);
      const len = 0.3 * k * (s === 0 ? 1.25 : 1);
      b.cyl(len, girth(s) * 0.55, girth(s) * 0.18, 6, c[0], c[1] - girth(s) * 0.35 - len / 2, c[2], KAYA);
    }
  } else {
    // The donor's inscription down the back of each post: a longer column
    // on one post (the name) and a shorter one on the other (the date).
    for (const sx of [-1, 1]) {
      const x = (sx * span) / 2;
      const gs = postD * 0.4;
      const pitch = gs * 1.22;
      const yTop = nukiTop - nukiH - 0.25;
      const room = Math.floor((yTop - 1.1) / pitch);
      const n = sx > 0 ? room : Math.max(3, room - 2 - Math.floor(rnd() * 3));
      const t = gs * 0.13;
      const lay = (u: number, y: number, w: number, hh: number, roll: number): void => {
        const r = radius(y) * 0.985 + 0.004;
        const th = u / r;
        sb.box(w, hh, 0.012, x + Math.sin(th) * r, y, Math.cos(th) * r, SUMI, { y: th, z: roll }, hideBack("+z"));
      };
      for (let g = 0; g < n; g++) {
        const gy = yTop - (g + 0.5) * pitch;
        const strokes = 5 + Math.floor(rnd() * 3);
        for (let s = 0; s < strokes; s++) {
          const kind = rnd();
          if (kind < 0.5) {
            const len = gs * (0.4 + rnd() * 0.55);
            lay((rnd() - 0.5) * (gs - len), gy + (rnd() - 0.5) * gs * 0.85, len, t, 0);
          } else if (kind < 0.82) {
            const len = gs * (0.3 + rnd() * 0.7);
            lay((rnd() - 0.5) * gs * 0.8, gy + (rnd() - 0.5) * (gs - len), t, len, 0);
          } else {
            const len = gs * (0.3 + rnd() * 0.35);
            lay((rnd() - 0.5) * gs * 0.6, gy + (rnd() - 0.5) * gs * 0.5, t, len, (rnd() < 0.5 ? -1 : 1) * 0.7);
          }
        }
      }
    }
  }
  sb.flush(b);
  return b;
}

// --- the garden's stone ------------------------------------------------------------

const TAU = Math.PI * 2;

/** A lotus petal's outline: (along its length from the base, across its width). */
const LOTUS_LEAF = [
  [0.04, -0.42],
  [0.04, 0.42],
  [0.5, 0.49],
  [0.96, 0],
  [0.5, -0.49],
] as const;

/** A tube's path point: (R, y) in a vertical plane through the axis, and the section's width and height. */
type TubePoint = [number, number, number, number];

/**
 * The garden's mason: the carving words the stone lantern and the stone
 * pagoda share. Everything is drawn in the model's own units and scaled once
 * by `s` as it is emitted, into ONE surface per colour — a `Mesher` per
 * colour for the carved solids and a `StoneBatch` for the laid boxes —
 * because a granite ornament is hundreds of small parts, and as parts that is
 * hundreds of meshes for the merge to build and throw away. The methods are
 * arrow properties, so a builder destructures the ones it uses.
 */
/** A maple leaf's five lobes, the middle one longest. */
const LEAF_LOBES = [1, 0.82, 0.5, 0.5, 0.82];

class Lapidary {
  readonly sb = new StoneBatch();
  private readonly meshers = new Map<string, Mesher>();

  constructor(private readonly s: number) {}

  mesher = (color: string): Mesher => {
    let m = this.meshers.get(color);
    if (!m) this.meshers.set(color, (m = new Mesher()));
    return m;
  };

  scaled = (q: V3): V3 => [q[0] * this.s, q[1] * this.s, q[2] * this.s];

  /**
   * `convexSolid`, into one surface per colour: every face wound against the
   * solid's centroid. `bedded` leaves out the `from` face, which lies in
   * the stone it was laid on.
   */
  solid = (color: string, from: V3[], to: V3[], bedded = false): void => {
    const m = this.mesher(color);
    const A = from.map(this.scaled);
    const B = to.map(this.scaled);
    const all = [...A, ...B];
    const c = [0, 1, 2].map((i) => all.reduce((t, q) => t + q[i], 0) / all.length);
    const face = (pts: V3[]): void => {
      const f = [0, 1, 2].map((i) => pts.reduce((t, q) => t + q[i], 0) / pts.length);
      const out: V3 = [f[0] - c[0], f[1] - c[1], f[2] - c[2]];
      for (let i = 1; i + 1 < pts.length; i++) m.tri(pts[0], pts[i], pts[i + 1], out);
    };
    if (!bedded) face(A);
    face(B);
    for (let i = 0; i < A.length; i++) {
      const j = (i + 1) % A.length;
      face([A[i], A[j], B[j], B[i]]);
    }
  };

  /**
   * A turned solid: `prof` is (radius, height) walked from the bottom up
   * over the OUTSIDE, closed by starting and ending on the axis. Vertices
   * stand at `phase + k/n` of a turn, so a facet's centre is half a step on.
   * Four facets at an eighth of a turn is a square, the radius its corner's.
   */
  lathe = (color: string, prof: [number, number][], n: number, phase: number): void => {
    const m = this.mesher(color);
    const s = this.s;
    const P = (r: number, y: number, a: number): V3 => [r * Math.cos(a) * s, y * s, r * Math.sin(a) * s];
    for (let i = 0; i + 1 < prof.length; i++) {
      const [r0, y0] = prof[i];
      const [r1, y1] = prof[i + 1];
      for (let k = 0; k < n; k++) {
        const a0 = phase + (k / n) * TAU;
        const a1 = phase + ((k + 1) / n) * TAU;
        const am = (a0 + a1) / 2;
        const out: V3 = [(y1 - y0) * Math.cos(am), r0 - r1, (y1 - y0) * Math.sin(am)];
        m.quad(P(r0, y0, a0), P(r0, y0, a1), P(r1, y1, a1), P(r1, y1, a0), out);
      }
    }
  };

  /**
   * A point on the slope from (r0, y0) to (r1, y1) — walked bottom to top — at
   * bearing `a`: `f` up the slope, `u` across it, `w` out of it.
   */
  slope = (r0: number, y0: number, r1: number, y1: number, a: number) => {
    const L = Math.hypot(r1 - r0, y1 - y0);
    const nr = (y1 - y0) / L;
    const ny = -(r1 - r0) / L;
    return (f: number, u: number, w: number): V3 => {
      const R = r0 + (r1 - r0) * f + nr * w;
      const y = y0 + (y1 - y0) * f + ny * w;
      return [R * Math.cos(a) - u * Math.sin(a), y, R * Math.sin(a) + u * Math.cos(a)];
    };
  };

  /**
   * A ring of lotus petals on a turned cone of `n` facets, one petal per
   * facet, its tip toward the `tip` end of the slope (0 the bottom, 1 the
   * top). Each is a pointed leaf bedded on its facet and bevelled to a
   * smaller face standing proud, so the ink finds both its edge and its crown.
   */
  petals = (r0: number, y0: number, r1: number, y1: number, n: number, phase: number, tip: 0 | 1): void => {
    const facet = 2 * Math.sin(Math.PI / n);
    const sink = 1 - Math.cos(Math.PI / n);
    const proud = Math.max(0.012, Math.abs(r1 - r0) * 0.12);
    for (let k = 0; k < n; k++) {
      const at = this.slope(r0, y0, r1, y1, phase + ((k + 0.5) / n) * TAU);
      const outline = (w: number, shrink: number): V3[] =>
        LOTUS_LEAF.map(([q0, v]): V3 => {
          const q = 0.5 + (q0 - 0.5) * shrink;
          const f = tip ? q : 1 - q;
          const r = r0 + (r1 - r0) * f;
          return at(f, v * shrink * facet * r, w - r * sink);
        });
      this.solid(GRANITE, outline(-0.004, 1), outline(proud, 0.78), true);
    }
  };

  /**
   * `per` lotus petals side by side across one PLANE slope (`at`), whose half
   * width at `f` is `halfAt(f)` — the petals of a square lotus, where
   * `petals`' offset from a facet's corners to its middle is a quarter of
   * the radius and would bury them.
   */
  leafRow = (at: (f: number, u: number, w: number) => V3, halfAt: (f: number) => number, per: number, tip: 0 | 1, proud: number): void => {
    for (let j = 0; j < per; j++) {
      const across = (j + 0.5) / per - 0.5;
      const outline = (w: number, shrink: number): V3[] =>
        LOTUS_LEAF.map(([q0, v]): V3 => {
          const q = 0.5 + (q0 - 0.5) * shrink;
          const f = tip ? q : 1 - q;
          return at(f, 2 * halfAt(f) * (across + (v * shrink) / per), w);
        });
      this.solid(GRANITE, outline(-0.004, 1), outline(proud, 0.78), true);
    }
  };

  /** A point on the face whose normal bears `th`, its outer plane standing `plane` out. */
  faceAt =
    (th: number, plane: number) =>
    (u: number, y: number, w: number): V3 => [
      (plane + w) * Math.cos(th) - u * Math.sin(th),
      y,
      (plane + w) * Math.sin(th) + u * Math.cos(th),
    ];

  /**
   * A stone laid on face `th`: `along` across it, `tall` up it, `thick` out of
   * it, its centre `w` out of the plane. `lift` raises its +u end.
   */
  onFace = (
    th: number,
    plane: number,
    u: number,
    y: number,
    w: number,
    along: number,
    tall: number,
    thick: number,
    color: string,
    lift = 0,
    hide = 0,
  ): void => {
    const s = this.s;
    const c = this.faceAt(th, plane)(u, y, w);
    this.sb.box(along * s, tall * s, thick * s, c[0] * s, c[1] * s, c[2] * s, color, { y: Math.PI / 2 - th, z: -lift }, hide);
  };

  /**
   * A member bending in the vertical plane at bearing `v` — a ridge down a
   * cap's corner, running out into its scroll: one tube of sections, each
   * square to the path, so a ridge and a curl are one member bending rather
   * than two things meeting. Capped at its ends only: a chain of capped
   * solids spent a third of its vertices on faces buried in the next link.
   */
  tube = (color: string, path: TubePoint[], v: number): void => {
    const m = this.mesher(color);
    const P = (R: number, y: number, u: number): V3 => [R * Math.cos(v) - u * Math.sin(v), y, R * Math.sin(v) + u * Math.cos(v)];
    const secs = path.map(([R, y, w, h], i) => {
      const a = path[Math.max(0, i - 1)];
      const c = path[Math.min(path.length - 1, i + 1)];
      const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const nR = -(c[1] - a[1]) / L;
      const ny = (c[0] - a[0]) / L;
      return [
        P(R - (nR * h) / 2, y - (ny * h) / 2, -w / 2),
        P(R - (nR * h) / 2, y - (ny * h) / 2, w / 2),
        P(R + (nR * h) / 2, y + (ny * h) / 2, w / 2),
        P(R + (nR * h) / 2, y + (ny * h) / 2, -w / 2),
      ];
    });
    /** A section's centre: the middle of its diagonal. */
    const mid = (q: V3[]): V3 => [(q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2, (q[0][2] + q[2][2]) / 2];
    for (let i = 0; i + 1 < secs.length; i++) {
      const A = secs[i].map(this.scaled);
      const B = secs[i + 1].map(this.scaled);
      const c = mid([mid(A), A[0], mid(B)]);
      for (let e = 0; e < 4; e++) {
        const f = (e + 1) % 4;
        const q = [0, 1, 2].map((j) => (A[e][j] + A[f][j] + B[e][j] + B[f][j]) / 4);
        m.quad(A[e], A[f], B[f], B[e], [q[0] - c[0], q[1] - c[1], q[2] - c[2]]);
      }
    }
    for (const [end, next] of [
      [secs[0], secs[1]],
      [secs[secs.length - 1], secs[secs.length - 2]],
    ]) {
      const E = end.map(this.scaled);
      const a = mid(E);
      const n = mid(next.map(this.scaled));
      m.quad(E[0], E[1], E[2], E[3], [a[0] - n[0], a[1] - n[1], a[2] - n[2]]);
    }
  };

  /**
   * A patch of pale lichen on a slope (`at`, `L` long): three or four jittered
   * lobes, each stepping off the last across the slope from (`f0`, `u0`), so a
   * patch is a drawn-out run of them and never one polygon — a single lobe
   * read as a coin. `halfAt(f)` is the slope's half width at `f`, which keeps
   * every lobe off the corners; `back` is how deep its bed sinks.
   */
  lichen = (
    rnd: () => number,
    at: (f: number, u: number, w: number) => V3,
    L: number,
    f0: number,
    u0: number,
    halfAt: (f: number) => number,
    back = -0.004,
  ): void => {
    const lobes = 3 + Math.floor(rnd() * 2);
    let u = u0;
    let fm = f0;
    const step = rnd() < 0.5 ? -1 : 1;
    for (let j = 0; j < lobes; j++) {
      const ru = 0.035 + rnd() * 0.03;
      const rf = (0.022 + rnd() * 0.018) / L;
      const fc = Math.min(0.85, Math.max(0.12, fm));
      const lim = Math.max(0, halfAt(fc) - ru - 0.02);
      const uc = Math.max(-lim, Math.min(lim, u));
      u += step * (0.04 + rnd() * 0.035);
      fm += ((rnd() - 0.5) * 0.05) / L;
      const edge = Array.from({ length: 7 }, () => 0.8 + rnd() * 0.3);
      const ring = (w: number): V3[] =>
        edge.map((k, q): V3 => {
          const a = (q / 7) * TAU;
          return at(fc + rf * k * Math.sin(a), uc + ru * k * Math.cos(a), w);
        });
      this.solid(GRANITE, ring(back), ring(0.005 + j * 0.002), true);
    }
  };

  /**
   * A fallen maple leaf lying on a slope (`at`, `L` long) at (`d` along it,
   * `u` across): five lobes, the middle one longest, turned by `turn`, in the
   * litter's red or its orange.
   */
  leaf = (
    rnd: () => number,
    at: (f: number, u: number, w: number) => V3,
    L: number,
    d: number,
    u: number,
    size: number,
    turn: number,
    w0: number,
  ): void => {
    const color = rnd() < 0.55 ? MOMIJI : KAKI;
    const P = (r: number, a: number, w: number): V3 => at((d + r * Math.cos(a)) / L, u + r * Math.sin(a), w);
    for (let k = 0; k < 5; k++) {
      const a = turn + (k * TAU) / 5;
      const half = TAU / 10;
      const r = size * LEAF_LOBES[k];
      const outline = (w: number): V3[] => [P(0, 0, w), P(size * 0.3, a - half, w), P(r, a, w), P(size * 0.3, a + half, w)];
      this.solid(color, outline(w0), outline(w0 + 0.005), true);
    }
  };

  /** Every colour's surface, then the laid boxes. */
  flush = (b: Build): void => {
    for (const [color, m] of this.meshers) b.surface(m.data(), color);
    this.sb.flush(b);
  };
}


/**
 * A STONE LANTERN (tōrō), drawn as the KASUGA lantern that lines every temple
 * approach in the country — granite, in six parts stacked on a foundation
 * stone, each part the shape its name says:
 *
 * - **The foundation (kiban)**: a flat dressed hexagon, carried down to the
 *   lowest ground under it.
 * - **The base (kiso)**: a hexagon with a sunk panel in each face between
 *   corner stiles, and on top of it a ring of LOTUS PETALS turned down
 *   (kaeribana) round the seat of the shaft.
 * - **The shaft (sao)**: round, tapering, with the three-ringed node (fushi)
 *   at its middle and a collar at its head — and the dedication cut into its
 *   front above the node and the donor's name into its back below it.
 * - **The middle platform (chūdai)**: lotus petals turned UP under it
 *   (ukebana), sunk panels round its six faces, and a step for the firebox.
 * - **The firebox (hibukuro)**: six panels between corner posts on a sill
 *   under a head. The front and the back are the light windows, a paper
 *   screen in a timber frame; the two front corners are the SUN, a round
 *   hole, and the MOON, a crescent; the two back corners are the DEER of
 *   Kasuga in relief on a sunk ground, a stag on one and a hind on the
 *   other, walking toward the front.
 * - **The cap (kasa)**: a broad six-sided eave slab under a roof that
 *   steepens toward the top, a ridge down each corner running out into a
 *   curled fern-frond scroll (warabite), pale lichen on its slopes; and on it
 *   a lotus cup carrying the jewel (hōju).
 *
 * Its collider is its body at chest height and it is 1.9 m tall, so it bakes
 * as hard cover — which a granite post two feet thick is. The drawing keeps
 * inside the old silhouette's reach but for the scrolls, which are overhead.
 * `lit` puts a glow in the firebox, seen through the screens, the sun and the
 * moon, and nothing else: a lantern at dusk is a thing you SEE, and a garden
 * of them spending light slots would evict every lit interior on the map.
 *
 * It is in `CONFORMS_TO_TERRAIN`: the characters on its shaft, which deer is
 * the stag and where the lichen grows are seeded off where it stands, and the
 * foundation stone is carried down to the ground. Everything is drawn in the
 * 2.3 m lantern's own units and scaled once by `height` as it is emitted, and
 * it is batched into one surface per colour, because 37 lanterns of loose
 * parts would be a merge of thousands.
 */
export function buildToro(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "toro");
  const s = p.height ? p.height / 2.3 : 1;

  // --- the collider, exactly as it was -------------------------------------------
  b.block({ w: 0.62 * s, h: 1.95 * s, d: 0.62 * s, x: 0, y: 0.975 * s, z: 0 });

  // --- everything below is drawing -------------------------------------------
  const rnd = mulberry32(streetSeed(0.62, 0.62, 2.3 * s, ctx));
  /** The ground under a local point, in the lantern's own units. */
  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return (ctx.terrain.surfaceAt(ctx.x + (lx * cos + lz * sin) * s, ctx.z + (-lx * sin + lz * cos) * s) - ctx.y) / s;
  };
  const HEX = Math.PI / 3;
  const { sb, solid, lathe, slope, petals, faceAt, onFace, tube, lichen, flush } = new Lapidary(s);
  /** A six-sided ring, vertices at `rot + k/6` of a turn — flats toward ±Z by default. */
  const hexRing = (R: number, y: number, rot = 0): V3[] =>
    Array.from({ length: 6 }, (_, k): V3 => [R * Math.cos(rot + k * HEX), y, R * Math.sin(rot + k * HEX)]);
  const hex = (color: string, R0: number, y0: number, R1: number, y1: number, rot = 0): void =>
    solid(color, hexRing(R0, y0, rot), hexRing(R1, y1, rot));
  /** A post standing on the corner at bearing `v`, its centre `rc` out. */
  const onCorner = (v: number, rc: number, y: number, wide: number, tall: number, deep: number): void =>
    sb.box(wide * s, tall * s, deep * s, rc * Math.cos(v) * s, y * s, rc * Math.sin(v) * s, GRANITE, { y: Math.PI / 2 - v });
  /** The bearing of face `k`'s normal: 1 is the back (+Z), 4 the front (-Z). */
  const faceTh = (k: number): number => Math.PI / 6 + k * HEX;
  /** A stone laid on a face keeps its back out of the batch: it is buried. */
  const BURIED = 1 << 5;

  /**
   * A hexagon with a sunk panel in each face: a band under and over a dark
   * core set `sunk` back, and a stile on every corner.
   */
  const panelled = (R: number, y0: number, band: number, core: number, sunk: number): void => {
    const y1 = y0 + band;
    const y2 = y1 + core;
    hex(GRANITE, R, y0, R, y1);
    hex(GRANITE, R, y2, R, y2 + band);
    const stile = R * 0.12;
    for (let k = 0; k < 6; k++) onCorner(k * HEX, R - stile / 2 + 0.008, (y1 + y2) / 2, stile, core, stile);
    const Rc = R - sunk / Math.cos(Math.PI / 6);
    hex(GRANITE_DARK, Rc, y1, Rc, y2);
  };

  // The foundation stone, carried down to the lowest ground under it.
  {
    const R = 0.6;
    const ring = hexRing(R, 0, Math.PI / 6);
    const low = Math.min(0, ...ring.map((q) => ground(q[0], q[2]))) - 0.06;
    hex(GRANITE_DARK, R, low, R, 0.05, Math.PI / 6);
  }

  // The base: a panelled hexagon and the downturned lotus round the shaft's seat.
  panelled(0.52, 0.05, 0.04, 0.1, 0.028);
  const LOTUS = 12;
  const lotusPhase = -Math.PI / 2 - Math.PI / LOTUS;
  lathe(GRANITE, [[0, 0.23], [0.44, 0.23], [0.25, 0.33], [0, 0.33]], LOTUS, lotusPhase);
  petals(0.44, 0.23, 0.25, 0.33, LOTUS, lotusPhase, 0);

  // The shaft: a seat, the taper, the three-ringed node and a collar. Ten
  // facets with one square to the front and one to the back, so the
  // inscriptions lie flat on stone.
  const SAO = 10;
  const saoPhase = (3 * Math.PI) / 2 - Math.PI / SAO;
  lathe(
    GRANITE,
    [
      [0, 0.33],
      [0.25, 0.33],
      [0.25, 0.37],
      [0.2, 0.37],
      [0.19, 0.7],
      [0.205, 0.715],
      [0.19, 0.73],
      [0.225, 0.745],
      [0.225, 0.755],
      [0.19, 0.77],
      [0.205, 0.785],
      [0.183, 0.8],
      [0.17, 1.13],
      [0.21, 1.14],
      [0.21, 1.17],
      [0, 1.17],
    ],
    SAO,
    saoPhase,
  );
  {
    const radius = (y: number): number =>
      y < 0.75 ? 0.2 + ((0.19 - 0.2) * (y - 0.37)) / 0.33 : 0.183 + ((0.17 - 0.183) * (y - 0.8)) / 0.33;
    const inscribe = (th: number, yTop: number, n: number, gs: number): void => {
      const pitch = gs * 1.25;
      const t = gs * 0.14;
      for (let g = 0; g < n; g++) {
        const gy = yTop - (g + 0.5) * pitch;
        const strokes = 5 + Math.floor(rnd() * 3);
        for (let k = 0; k < strokes; k++) {
          const horiz = rnd() < 0.55;
          const len = gs * (0.35 + rnd() * 0.6);
          const u = (rnd() - 0.5) * (horiz ? gs - len : gs * 0.8);
          const y = gy + (rnd() - 0.5) * (horiz ? gs * 0.85 : gs - len);
          const lift = rnd() < 0.25 ? (rnd() - 0.5) * 1.2 : 0;
          const plane = radius(y) * Math.cos(Math.PI / SAO);
          onFace(th, plane, u, y, 0.001, horiz ? len : t, horiz ? t : len, 0.012, GRANITE_DARK, lift, BURIED);
        }
      }
    };
    inscribe((3 * Math.PI) / 2, 1.1, 2, 0.09);
    inscribe(Math.PI / 2, 0.66, 2, 0.08);
  }

  // The middle platform: upturned lotus under it, panelled faces, a step.
  lathe(GRANITE, [[0, 1.17], [0.21, 1.17], [0.38, 1.27], [0, 1.27]], LOTUS, lotusPhase);
  petals(0.21, 1.17, 0.38, 1.27, LOTUS, lotusPhase, 1);
  panelled(0.46, 1.27, 0.03, 0.08, 0.025);
  hex(GRANITE, 0.37, 1.41, 0.37, 1.44);

  // The firebox: a sill, six panels between corner posts, a head.
  const Af = 0.29;
  const T = 0.05;
  const fy0 = 1.49;
  const fy1 = 1.85;
  const yc = 1.67;
  const half = Af * Math.tan(Math.PI / 6);
  hex(GRANITE, 0.36, 1.44, 0.36, fy0);
  hex(GRANITE, 0.37, fy1, 0.37, 1.9);
  for (let k = 0; k < 6; k++) onCorner(k * HEX, 0.33, (fy0 + fy1) / 2, 0.07, fy1 - fy0, 0.08);
  /** A face's stone round a hole `hw` by `hh` at the firebox's centre height. */
  const pierced = (th: number, hw: number, hh: number): void => {
    const sw = half - hw / 2;
    for (const e of [-1, 1]) onFace(th, Af, e * (half - sw / 2), (fy0 + fy1) / 2, -T / 2, sw, fy1 - fy0, T, GRANITE);
    const top = yc + hh / 2;
    const bot = yc - hh / 2;
    onFace(th, Af, 0, (top + fy1) / 2, -T / 2, hw, fy1 - top, T, GRANITE);
    onFace(th, Af, 0, (fy0 + bot) / 2, -T / 2, hw, bot - fy0, T, GRANITE);
  };
  /** A round hole: a square one with its corners filled back to a twelve-sided circle. */
  const round = (th: number, rh: number): void => {
    pierced(th, rh * 2, rh * 2);
    const F = faceAt(th, Af);
    for (const su of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          const b0 = (i / 3) * (Math.PI / 2);
          const b1 = ((i + 1) / 3) * (Math.PI / 2);
          const pts: [number, number][] = [
            [su * rh, yc + sy * rh],
            [su * rh * Math.cos(b0), yc + sy * rh * Math.sin(b0)],
            [su * rh * Math.cos(b1), yc + sy * rh * Math.sin(b1)],
          ];
          solid(GRANITE, pts.map(([u, y]) => F(u, y, -T)), pts.map(([u, y]) => F(u, y, 0)));
        }
      }
    }
  };
  // Front and back: the light windows, a screen's frame and bars in each.
  for (const th of [faceTh(4), faceTh(1)]) {
    const hw = 0.19;
    const hh = 0.21;
    pierced(th, hw, hh);
    const bar = 0.018;
    for (const e of [-1, 1]) {
      onFace(th, Af, e * (hw / 2 - bar / 2), yc, -0.035, bar, hh, 0.02, SUMI);
      onFace(th, Af, 0, yc + e * (hh / 2 - bar / 2), -0.035, hw - bar * 2, bar, 0.02, SUMI);
    }
    onFace(th, Af, 0, yc, -0.037, bar * 0.6, hh - bar * 2, 0.012, SUMI);
    onFace(th, Af, 0, yc + 0.012, -0.037, hw - bar * 2, bar * 0.6, 0.012, SUMI);
  }
  // The front corners: the sun on the east, the moon on the west — a round
  // hole with a disc set into its back, off centre, leaving a crescent.
  const RH = 0.085;
  round(faceTh(5), RH);
  round(faceTh(3), RH);
  {
    const F = faceAt(faceTh(3), Af);
    const disc = (w: number): V3[] =>
      Array.from({ length: 12 }, (_, i): V3 => {
        const a = (i / 12) * TAU;
        return F(-0.42 * RH + RH * 0.94 * Math.cos(a), yc + 0.22 * RH + RH * 0.94 * Math.sin(a), w);
      });
    solid(GRANITE, disc(-T + 0.004), disc(-0.012));
  }
  // The back corners: the deer on a sunk ground inside a frame, walking to
  // the front. The figure stands 2.4 cm off the ground and the frame 3 cm,
  // which is what a relief needs to be seen at all (craft.md).
  const stag = rnd() < 0.5 ? 0 : 2;
  for (const k of [0, 2]) {
    const th = faceTh(k);
    const dir = Math.cos(th) > 0 ? -1 : 1;
    const fw = 0.045;
    for (const e of [-1, 1]) {
      onFace(th, Af, e * (half - fw / 2), (fy0 + fy1) / 2, -T / 2, fw, fy1 - fy0, T, GRANITE);
      onFace(th, Af, 0, e > 0 ? fy1 - fw / 2 : fy0 + fw / 2, -T / 2, half * 2 - fw * 2, fw, T, GRANITE);
    }
    onFace(th, Af, 0, (fy0 + fy1) / 2, -0.045, half * 2 - fw * 2, fy1 - fy0 - fw * 2, 0.03, GRANITE_DARK);
    const part = (u: number, y: number, along: number, tall: number, lift: number): void =>
      onFace(th, Af, dir * u, yc + y, -0.02, along, tall, 0.028, GRANITE, dir * lift, BURIED);
    part(0, -0.005, 0.12, 0.052, 0.05);
    part(0.058, 0.035, 0.028, 0.07, -0.45);
    part(0.087, 0.068, 0.046, 0.026, -0.35);
    part(0.067, 0.085, 0.012, 0.024, 0.6);
    part(-0.066, 0.016, 0.02, 0.012, 0.5);
    for (const [u, lean] of [
      [0.052, 0.12],
      [0.036, -0.08],
      [-0.038, 0.1],
      [-0.053, -0.15],
    ] as const) {
      part(u, -0.066, 0.013, 0.075, lean);
    }
    if (k === stag) {
      part(0.064, 0.108, 0.01, 0.05, 0.35);
      part(0.08, 0.118, 0.008, 0.03, -0.3);
      part(0.056, 0.128, 0.008, 0.026, 0.9);
    }
  }
  if (p.litWindows) b.glow(0.32 * s, 0.34 * s, 0.32 * s, 0, yc * s, 0, SHOJI_GLOW);
  else b.box(0.32 * s, 0.34 * s, 0.32 * s, 0, yc * s, 0, SUMI);

  // The cap: a bed, the eave slab, a roof that steepens to the top.
  hex(GRANITE_DARK, 0.42, 1.9, 0.42, 1.93);
  hex(GRANITE_DARK, 0.66, 1.93, 0.66, 2.0);
  hex(GRANITE_DARK, 0.63, 2.0, 0.44, 2.05);
  hex(GRANITE_DARK, 0.44, 2.05, 0.15, 2.21);
  // A ridge down each corner, running out over the eave into its scroll. The
  // scroll is small and tight — drawn a hand high it read as a pair of horns.
  {
    const roofY = (R: number): number => (R > 0.44 ? 2.0 + ((0.63 - R) / 0.19) * 0.05 : 2.05 + ((0.44 - R) / 0.29) * 0.16);
    const path: [number, number, number, number][] = [
      [0.17, roofY(0.17) + 0.01, 0.034, 0.04],
      [0.44, roofY(0.44) + 0.012, 0.04, 0.044],
      [0.6, roofY(0.6) + 0.014, 0.044, 0.046],
      [0.645, 2.02, 0.046, 0.046],
      [0.675, 2.044, 0.044, 0.042],
      [0.686, 2.078, 0.04, 0.036],
      [0.67, 2.102, 0.036, 0.03],
      [0.649, 2.094, 0.032, 0.026],
      [0.647, 2.073, 0.028, 0.022],
    ];
    for (let k = 0; k < 6; k++) tube(GRANITE_DARK, path, k * HEX);
  }
  // Lichen on the slopes: three or four patches of overlapping pale lobes.
  {
    const c30 = Math.cos(Math.PI / 6);
    const t30 = Math.tan(Math.PI / 6);
    const patches = 3 + Math.floor(rnd() * 2);
    for (let i = 0; i < patches; i++) {
      const th = faceTh(Math.floor(rnd() * 6));
      const upper = rnd() < 0.6;
      const [a0, y0, a1, y1] = upper ? [0.44 * c30, 2.05, 0.15 * c30, 2.21] : [0.63 * c30, 2.0, 0.44 * c30, 2.05];
      const at = slope(a0, y0, a1, y1, th);
      const L = Math.hypot(a1 - a0, y1 - y0);
      const f0 = upper ? 0.15 + rnd() * 0.4 : 0.3 + rnd() * 0.4;
      const u0 = (rnd() - 0.5) * (a0 + (a1 - a0) * f0) * t30;
      lichen(rnd, at, L, f0, u0, (f) => (a0 + (a1 - a0) * f) * t30);
    }
  }
  // The jewel: a step, a neck, a lotus cup and the pointed pearl in it.
  const TOP = 8;
  const topPhase = -Math.PI / 2 - Math.PI / TOP;
  lathe(
    GRANITE,
    [
      [0, 2.195],
      [0.16, 2.195],
      [0.16, 2.25],
      [0.1, 2.25],
      [0.09, 2.27],
      [0.145, 2.335],
      [0.105, 2.335],
      [0.12, 2.37],
      [0.128, 2.41],
      [0.112, 2.45],
      [0.07, 2.495],
      [0.03, 2.54],
      [0, 2.585],
    ],
    TOP,
    topPhase,
  );
  petals(0.09, 2.27, 0.145, 2.335, TOP, topPhase, 1);

  flush(b);
  return b;
}

/**
 * The maples' own red on the ground (`Props.ts`'s `FALLEN`), for the leaves
 * lying on a stone pagoda — the litter's material, so a leaf on a ledge adds
 * no draw to a garden block the litter already carpets. `KAKI` is the other.
 */
const MOMIJI = "#b33c20";

/**
 * A STONE PAGODA (sekitō): a GOJŪ-NO-TŌ in granite, the five-storey tower of
 * a Kamakura garden, standing where the reference frame's is — the thing the
 * eye lands on first in the temple garden, as the big pagoda is the valley's.
 * A stone pagoda is a timber one said in stone, and every part is the stone
 * name for the wooden part it copies:
 *
 * - **The kerb (kiso-ishi)**: a course of dressed stones round the foot with
 *   open joints, each carried down to the ground under it.
 * - **The base (kidan)**: a block with two cusped panels (kōzama) sunk in
 *   each face between stiles, under a coping, and on it a square lotus with
 *   its petals turned down (kaeribana-za) round the seat of the shaft.
 * - **The first storey's shaft (shoju jikubu)**: the Buddhas of the four
 *   quarters, each seated on a lotus in a round niche with a roll round it,
 *   hands in the lap and a halo behind the head — the healing Buddha of the
 *   east holding his jar.
 * - **Five roof stones (kasa)**: each a thick eave cut plumb with its
 *   corners swept up and its underside swept with them, a slope steepening
 *   to a seat for the storey above, a hip ridge down each corner and the two
 *   steps under the eave that stand for the rafters; pale lichen on the
 *   slopes.
 * - **Four upper shafts (jikubu)**: a post at every corner, a sill and a head
 *   rail, a two-leaved door front and back and a barred window at each side.
 * - **The spire (sōrin)**: dew basin, inverted bowl, lotus, the nine rings,
 *   a second lotus and the jewel.
 *
 * Maple leaves lie on the kerb and on the lowest roofs.
 *
 * **The collider is unchanged**: the old block, a metre square to 3.2 m. The
 * drawing stands inside it but for three things, each of which the old
 * drawing already did: the base and the kerb (knee high), the roofs' eaves
 * (overhead from the second storey up, and a stone's thickness at the first),
 * and the upper storeys and the spire over the block's top. The first shaft
 * is the block's own face, its niches 3 cm into it and its figures 2 cm out.
 *
 * Drawn in the 4.4 m pagoda's own units and scaled once by `height` as it is
 * emitted — the spire's jewel stands at 4.8 of them, as the old finial stood
 * at 4.75 — and batched into one surface per colour through `Lapidary`. In
 * `CONFORMS_TO_TERRAIN`: the kerb's stones, the lichen and the leaves are
 * seeded off where it stands, and the kerb is carried down to the ground.
 */
export function buildStonePagoda(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "sekito");
  const s = p.height ? p.height / 4.4 : 1;

  // --- the collider, exactly as it was -------------------------------------------
  b.block({ w: 1.0 * s, h: 3.2 * s, d: 1.0 * s, x: 0, y: 1.6 * s, z: 0 });

  // --- everything below is drawing -------------------------------------------
  const rnd = mulberry32(streetSeed(1.5, 1.5, 4.4 * s, ctx));
  /** The ground under a local point, in the pagoda's own units. */
  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return (ctx.terrain.surfaceAt(ctx.x + (lx * cos + lz * sin) * s, ctx.z + (-lx * sin + lz * cos) * s) - ctx.y) / s;
  };
  const { sb, mesher, scaled, solid, lathe, slope, petals, leafRow, faceAt, onFace, tube, lichen, leaf, flush } = new Lapidary(s);
  const Q = Math.PI / 2;
  const SQ2 = Math.SQRT2;
  /** The faces' bearings: +X, the back (+Z), -X and the front (-Z). */
  const FACES = [0, Q, Math.PI, 3 * Q];
  const BACK = Q;
  const FRONT = 3 * Q;
  /** A box's faces are +x -x +y -y +z -z; a stone laid on a face has its back in -z. */
  const TOP = 1 << 2;
  const BURIED = 1 << 5;
  /** A square slab on the axis, half `h` a side. */
  const slab = (color: string, h: number, y0: number, y1: number, hide = 0): void =>
    sb.box(h * 2 * s, (y1 - y0) * s, h * 2 * s, 0, ((y0 + y1) / 2) * s, 0, color, undefined, hide);
  /**
   * An outline (u, y) carved on face `th` whose plane stands `plane` out: from
   * `w0` to `w1` off the plane, its front drawn in by `shrink` about its middle.
   */
  const relief = (
    th: number,
    plane: number,
    pts: [number, number][],
    w0: number,
    w1: number,
    color = GRANITE,
    shrink = 1,
    bedded = true,
  ): void => {
    const F = faceAt(th, plane);
    const cu = pts.reduce((t, q) => t + q[0], 0) / pts.length;
    const cy = pts.reduce((t, q) => t + q[1], 0) / pts.length;
    solid(
      color,
      pts.map(([u, y]) => F(u, y, w0)),
      pts.map(([u, y]) => F(cu + (u - cu) * shrink, cy + (y - cy) * shrink, w1)),
      bedded,
    );
  };
  const oval = (u: number, y: number, ru: number, ry: number, n = 8): [number, number][] =>
    Array.from({ length: n }, (_, i): [number, number] => [u + ru * Math.cos((i / n) * TAU), y + ry * Math.sin((i / n) * TAU)]);
  /**
   * The corner of a hole filled back to a quarter circle about (cu, cy) — the
   * corner is at (cu + su r, cy + sy r) — as a fan of flush stones.
   */
  const fillet = (th: number, plane: number, cu: number, cy: number, r: number, su: number, sy: number, depth: number, n = 6): void => {
    for (let i = 0; i < n; i++) {
      const b0 = (i / n) * Q;
      const b1 = ((i + 1) / n) * Q;
      relief(
        th,
        plane,
        [
          [cu + su * r, cy + sy * r],
          [cu + su * r * Math.cos(b0), cy + sy * r * Math.sin(b0)],
          [cu + su * r * Math.cos(b1), cy + sy * r * Math.sin(b1)],
        ],
        -depth,
        0,
        GRANITE,
        1,
        false,
      );
    }
  };

  const T = 0.03;

  // The base (kidan): a block with two cusped panels sunk in each face
  // between stiles, the panels showing its darker core — a relief needs a
  // dark ground to be seen at all (craft.md).
  const KH = 0.65;
  const KT = 0.12;
  const k1 = 0.27;
  for (const th of FACES) {
    onFace(th, KH, 0, KT + 0.0125, -T / 2, 2 * KH, 0.025, T, GRANITE, 0, BURIED);
    onFace(th, KH, 0, k1 - 0.015, -T / 2, 2 * KH, 0.03, T, GRANITE, 0, BURIED | TOP);
    const pb = KT + 0.025;
    const pt = k1 - 0.03;
    for (const [uc, wide] of [
      [-(KH - 0.035), 0.07],
      [0, 0.06],
      [KH - 0.035, 0.07],
    ]) {
      onFace(th, KH, uc, (pb + pt) / 2, -T / 2, wide, pt - pb, T, GRANITE, 0, BURIED);
    }
    for (const [ua, ub] of [
      [-(KH - 0.07), -0.03],
      [0.03, KH - 0.07],
    ]) {
      // The head rounded into the stiles, the feet curled, and a cusp hanging
      // from the middle of the head: the kōzama's outline.
      fillet(th, KH, ua + 0.04, pt - 0.04, 0.04, -1, 1, T);
      fillet(th, KH, ub - 0.04, pt - 0.04, 0.04, 1, 1, T);
      fillet(th, KH, ua + 0.018, pb + 0.018, 0.018, -1, -1, T, 3);
      fillet(th, KH, ub - 0.018, pb + 0.018, 0.018, 1, -1, T, 3);
      const um = (ua + ub) / 2;
      for (const e of [-1, 1]) {
        relief(th, KH, [[um, pt], [um + e * 0.075, pt], [um + e * 0.03, pt - 0.014]], -T, 0, GRANITE, 1, false);
        relief(th, KH, [[um, pt], [um + e * 0.03, pt - 0.014], [um, pt - 0.034]], -T, 0, GRANITE, 1, false);
      }
    }
  }
  slab(GRANITE_DARK, KH - T, KT, k1, TOP);
  slab(GRANITE, 0.675, k1, 0.3);
  // The downturned lotus: six broad petals a side on a square cone.
  {
    const [h0, y0, h1, y1] = [0.66, 0.3, 0.53, 0.36];
    lathe(GRANITE, [[0, y0], [h0 * SQ2, y0], [h1 * SQ2, y1], [0, y1]], 4, Math.PI / 4);
    for (const th of FACES) leafRow(slope(h0, y0, h1, y1, th), (f) => h0 + (h1 - h0) * f, 6, 0, 0.02);
  }
  slab(GRANITE, 0.53, 0.36, 0.375, TOP);

  // The first storey's shaft: a round niche in each face with a roll round
  // it, and in it the Buddha of that quarter seated on a lotus.
  const SH = 0.5;
  const S0 = 0.375;
  const S1 = 1.25;
  const NY = 0.81;
  const NR = 0.29;
  /** A seated Buddha, 2 cm proud of the face at its most: outlines about the niche's centre. */
  const buddha = (th: number, jar: boolean): void => {
    const carve = (pts: [number, number][], depth: number, shrink = 0.86): void =>
      relief(th, SH, pts.map(([u, y]): [number, number] => [u, NY + y]), -T - 0.004, -T + depth, GRANITE, shrink);
    carve(oval(0, 0.115, 0.1, 0.1, 16), 0.008, 0.97);
    carve([[-0.11, -0.26], [0.11, -0.26], [0.2, -0.19], [-0.2, -0.19]], 0.03, 0.92);
    for (let i = 0; i < 5; i++) {
      const u = -0.14 + i * 0.07;
      carve([[u - 0.028, -0.245], [u + 0.028, -0.245], [u + 0.03, -0.218], [u, -0.192], [u - 0.03, -0.218]], 0.04, 0.8);
    }
    carve([[-0.21, -0.19], [0.21, -0.19], [0.2, -0.14], [0.1, -0.11], [-0.1, -0.11], [-0.2, -0.14]], 0.04);
    carve([[-0.11, -0.13], [0.11, -0.13], [0.115, 0.02], [0.085, 0.05], [-0.085, 0.05], [-0.115, 0.02]], 0.042);
    for (const e of [-1, 1]) {
      carve([[e * 0.125, 0.03], [e * 0.095, 0.03], [e * 0.075, -0.125], [e * 0.165, -0.125]], 0.048);
      carve([[e * 0.05, 0.078], [e * 0.062, 0.084], [e * 0.062, 0.13], [e * 0.05, 0.136]], 0.036, 0.8);
    }
    carve(oval(0, -0.12, 0.065, 0.028), 0.052);
    if (jar) carve(oval(0, -0.098, 0.028, 0.026), 0.062);
    carve([[-0.03, 0.04], [0.03, 0.04], [0.03, 0.07], [-0.03, 0.07]], 0.038);
    carve(oval(0, 0.115, 0.05, 0.06, 10), 0.05);
    carve(oval(0, 0.178, 0.026, 0.022), 0.046);
  };
  for (const th of FACES) {
    for (const e of [-1, 1]) onFace(th, SH, (e * (SH + NR)) / 2, (S0 + S1) / 2, -T / 2, SH - NR, S1 - S0, T, GRANITE, 0, BURIED);
    onFace(th, SH, 0, (NY + NR + S1) / 2, -T / 2, 2 * NR, S1 - NY - NR, T, GRANITE, 0, BURIED);
    onFace(th, SH, 0, (S0 + NY - NR) / 2, -T / 2, 2 * NR, NY - NR - S0, T, GRANITE, 0, BURIED);
    for (const su of [-1, 1]) for (const sy of [-1, 1]) fillet(th, SH, 0, NY, NR, su, sy, T);
    for (let i = 0; i < 24; i++) {
      const a0 = (i / 24) * TAU;
      const a1 = ((i + 1) / 24) * TAU;
      const at = (r: number, a: number): [number, number] => [r * Math.cos(a), NY + r * Math.sin(a)];
      relief(th, SH, [at(NR - 0.005, a0), at(NR + 0.03, a0), at(NR + 0.03, a1), at(NR - 0.005, a1)], -0.004, 0.012, GRANITE, 1);
    }
    buddha(th, th === 0);
  }
  slab(GRANITE_DARK, SH - T, S0, S1, TOP);

  // The storeys: a roof stone on each shaft, and on each roof but the top
  // one the next shaft, a post at every corner and a door or a window in
  // every face.
  const BODY = [0.31, 0.275, 0.24, 0.205];
  const RISE = 0.12;
  const CURVE = 1.7;
  const UP = 0.055;
  const SEG = 8;
  /** The slope's rings, eave to top, as fractions of the way up it. */
  const SLOPE_T = [0, 0.12, 0.26, 0.42, 0.6, 0.8, 1];
  let under = SH;
  for (let i = 0; i < 5; i++) {
    const y = S1 + i * 0.6;
    const E = (1.55 - i * 0.15) / 2;
    const above = i < 4 ? BODY[i] : 0.165;
    const top = above + 0.06;
    const yu = y + 0.06;
    const ye = y + 0.135;
    const half = (t: number): number => E + (top - E) * t;
    const rise = (t: number): number => ye + RISE * Math.pow(t, CURVE);

    // The two steps under the eave, which stand for the rafters.
    slab(GRANITE_DARK, under + 0.05, y, y + 0.03, TOP);
    slab(GRANITE_DARK, under + 0.11, y + 0.03, yu, TOP);

    // The roof stone: a flat underside sweeping up into the corners, an eave
    // cut plumb, and a slope that steepens to the top — one closed solid,
    // wound against a point inside it.
    {
      const ring = (h: number, yy: number, lift: number): V3[] => {
        const pts: V3[] = [];
        for (let side = 0; side < 4; side++) {
          for (let j = 0; j < SEG; j++) {
            const u = -1 + (2 * j) / SEG;
            const [x, z] = side === 0 ? [u * h, -h] : side === 1 ? [h, u * h] : side === 2 ? [-u * h, h] : [-h, -u * h];
            pts.push([x, yy + UP * lift * Math.pow(Math.abs(u), 3), z]);
          }
        }
        return pts;
      };
      const rings = [
        ring(under + 0.11, yu, 0),
        ring(E - 0.09, yu, 0.15),
        ring(E, yu, 1),
        ...SLOPE_T.map((t) => ring(half(t), rise(t), (1 - t) * (1 - t))),
      ];
      const m = mesher(GRANITE_DARK);
      const C: V3 = [0, y + 0.12, 0];
      const hint = (...q: V3[]): V3 => [0, 1, 2].map((k) => q.reduce((t, v) => t + v[k], 0) / q.length - C[k]) as V3;
      const n = SEG * 4;
      for (let r = 0; r + 1 < rings.length; r++) {
        for (let j = 0; j < n; j++) {
          const a = rings[r][j];
          const c = rings[r][(j + 1) % n];
          const d = rings[r + 1][(j + 1) % n];
          const e = rings[r + 1][j];
          m.quad(scaled(a), scaled(c), scaled(d), scaled(e), hint(a, c, d, e));
        }
      }
      for (const [rg, cy] of [
        [rings[0], yu],
        [rings[rings.length - 1], rise(1)],
      ] as const) {
        const o: V3 = [0, cy, 0];
        for (let j = 0; j < n; j++) m.tri(scaled(o), scaled(rg[j]), scaled(rg[(j + 1) % n]), hint(o, rg[j], rg[(j + 1) % n]));
      }
    }
    // A hip ridge down each corner, flaring up off the eave's tip.
    {
      const path: TubePoint[] = SLOPE_T.slice()
        .reverse()
        .map((t): TubePoint => [half(t) * SQ2, rise(t) + UP * (1 - t) * (1 - t) + 0.009, 0.042, 0.026]);
      path.push([E * SQ2 + 0.014, ye + UP + 0.022, 0.036, 0.022]);
      for (let k = 0; k < 4; k++) tube(GRANITE_DARK, path, Math.PI / 4 + k * Q);
    }
    // The seat for what stands on it.
    slab(GRANITE_DARK, above + 0.035, y + 0.245, y + 0.275, i < 4 ? TOP : 0);
    // Lichen in a patch or two, on the slopes' middle, off the corners — laid
    // on a short chord of the curve so it neither floats nor sinks.
    {
      const patches = Math.floor(rnd() * 2.6);
      for (let j = 0; j < patches; j++) {
        const th = FACES[Math.floor(rnd() * 4)];
        const ta = 0.2 + rnd() * 0.35;
        const tb = ta + 0.3;
        const at = slope(half(ta), rise(ta), half(tb), rise(tb), th);
        const L = Math.hypot(half(tb) - half(ta), rise(tb) - rise(ta));
        const f0 = 0.3 + rnd() * 0.4;
        const u0 = (rnd() - 0.5) * 0.6 * half(ta);
        lichen(rnd, at, L, f0, u0, (f) => 0.45 * (half(ta) + (half(tb) - half(ta)) * f), -0.009);
      }
    }
    // Leaves come down on the two lowest roofs.
    if (i < 2) {
      const leaves = Math.floor(rnd() * (i === 0 ? 4 : 3));
      for (let j = 0; j < leaves; j++) {
        const th = FACES[Math.floor(rnd() * 4)];
        const at = slope(half(0.1), rise(0.1), half(0.45), rise(0.45), th);
        const L = Math.hypot(half(0.45) - half(0.1), rise(0.45) - rise(0.1));
        leaf(rnd, at, L, L * (0.25 + rnd() * 0.5), (rnd() - 0.5) * 0.8 * E, 0.04 + rnd() * 0.015, rnd() * TAU, -0.006);
      }
    }

    // The shaft of the storey above: corner posts, a sill and a head rail on
    // every face, a door of two leaves front and back and bars at the sides,
    // all on a dark core that the openings show.
    if (i < 4) {
      const yb = y + 0.275;
      const yt = y + 0.6;
      const hb = above;
      const cp = 0.05;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          sb.box(cp * s, (yt - yb) * s, cp * s, sx * (hb - cp / 2) * s, ((yb + yt) / 2) * s, sz * (hb - cp / 2) * s, GRANITE, undefined, TOP | HIDE_UNDER);
        }
      }
      const ow = hb - cp;
      const o0 = yb + 0.03;
      const o1 = yt - 0.04;
      const oh = o1 - o0;
      for (const th of FACES) {
        onFace(th, hb, 0, yt - 0.02, -0.01, 2 * ow, 0.04, 0.02, GRANITE, 0, BURIED | TOP);
        onFace(th, hb, 0, yb + 0.015, -0.01, 2 * ow, 0.03, 0.02, GRANITE, 0, BURIED | HIDE_UNDER);
        if (th === FRONT || th === BACK) {
          const lw = ow - 0.022;
          for (const e of [-1, 1]) {
            const u = e * (0.004 + lw / 2);
            onFace(th, hb, u, (o0 + o1) / 2, -0.012, lw, oh - 0.036, 0.014, GRANITE, 0, BURIED);
            onFace(th, hb, u, o0 + oh * 0.64, -0.003, lw - 0.024, 0.012, 0.006, GRANITE, 0, BURIED);
          }
        } else {
          for (let j = 0; j < 5; j++) onFace(th, hb, -ow + ((j + 0.5) * 2 * ow) / 5, (o0 + o1) / 2, -0.011, 0.022, oh, 0.018, GRANITE, 0, BURIED);
        }
      }
      slab(GRANITE_DARK, hb - 0.02, y + 0.24, yt, TOP);
    }
    under = above;
  }

  // The spire on the top roof's seat: the dew basin, the inverted bowl, a
  // lotus, the nine rings, a second lotus and the jewel.
  const Z = S1 + 4 * 0.6 + 0.275;
  slab(GRANITE, 0.165, Z, Z + 0.065, HIDE_UNDER);
  slab(GRANITE, 0.18, Z + 0.06, Z + 0.085);
  {
    const z = Z + 0.085;
    const ROUND = 12;
    const EIGHT = 8;
    const p12 = -Math.PI / 2 - Math.PI / ROUND;
    const p8 = -Math.PI / 2 - Math.PI / EIGHT;
    lathe(
      GRANITE,
      [
        [0, z],
        [0.15, z],
        [0.15, z + 0.015],
        [0.145, z + 0.035],
        [0.132, z + 0.058],
        [0.11, z + 0.078],
        [0.08, z + 0.09],
        [0.07, z + 0.09],
        [0.07, z + 0.105],
        [0, z + 0.105],
      ],
      ROUND,
      p12,
    );
    const u = z + 0.105;
    lathe(GRANITE, [[0, u], [0.06, u], [0.14, u + 0.055], [0.132, u + 0.065], [0, u + 0.065]], EIGHT, p8);
    petals(0.06, u, 0.14, u + 0.055, EIGHT, p8, 1);
    const r0 = u + 0.065;
    const rings: [number, number][] = [
      [0, r0],
      [0.068, r0],
    ];
    for (let k = 0; k < 9; k++) {
      const y0 = r0 + 0.01 + k * 0.05;
      const rs = 0.066 - k * 0.0022;
      const rr = rs + 0.028 - k * 0.001;
      rings.push([rs, y0], [rr, y0 + 0.012], [rr, y0 + 0.03], [rs, y0 + 0.042]);
    }
    const j0 = r0 + 0.46;
    rings.push([0.047, j0], [0, j0]);
    lathe(GRANITE, rings, 10, -Math.PI / 2 - Math.PI / 10);
    lathe(
      GRANITE,
      [
        [0, j0],
        [0.04, j0],
        [0.078, j0 + 0.028],
        [0.07, j0 + 0.036],
        [0.055, j0 + 0.038],
        [0.072, j0 + 0.06],
        [0.08, j0 + 0.082],
        [0.074, j0 + 0.105],
        [0.056, j0 + 0.128],
        [0.03, j0 + 0.148],
        [0, j0 + 0.165],
      ],
      EIGHT,
      p8,
    );
    petals(0.04, j0, 0.078, j0 + 0.028, EIGHT, p8, 1);
  }

  // The kerb: dressed stones with open joints round the foot, each carried
  // down to the lowest ground under it, on a core the joints show. The runs
  // at the ends butt between the front's and the back's.
  {
    const KERB = 0.78;
    const KD = 0.22;
    let low = 0;
    for (const th of FACES) {
      const end = th === 0 || th === Math.PI;
      const u0 = end ? -KERB + KD + 0.02 : -KERB;
      const u1 = -u0;
      const F = faceAt(th, KERB);
      let u = u0;
      while (u < u1 - 0.01) {
        let len = 0.36 + rnd() * 0.22;
        if (u1 - (u + len) < 0.24) len = u1 - u;
        const a = u === u0 ? u : u + 0.01;
        const c = u + len >= u1 - 1e-6 ? u1 : u + len - 0.01;
        const g =
          Math.min(
            ...[F(a, 0, 0), F(c, 0, 0), F(a, 0, -KD), F(c, 0, -KD)].map((q) => ground(q[0], q[2])),
          ) - 0.05;
        low = Math.min(low, g);
        const lid = KT + (rnd() - 0.5) * 0.006;
        onFace(th, KERB, (a + c) / 2, (g + lid) / 2, -KD / 2, c - a, lid - g, KD, GRANITE_DARK, 0, BURIED | HIDE_UNDER);
        u += len;
      }
    }
    slab(GRANITE_DARK, KERB - 0.05, low - 0.02, KT - 0.004, HIDE_UNDER);
    // Lichen on the kerb's ledge, and the maples' leaves come down on it.
    // The chord runs on in under the base, so a lobe that wanders inward is
    // hidden rather than hung off the kerb's front edge.
    const ledge = (th: number) => slope(KERB - 0.01, KT + 0.001, 0.52, KT + 0.001, th);
    const LL = KERB - 0.01 - 0.52;
    for (let j = Math.floor(rnd() * 3); j > 0; j--) {
      const th = FACES[Math.floor(rnd() * 4)];
      lichen(rnd, ledge(th), LL, 0.18 + rnd() * 0.12, (rnd() - 0.5) * 1.1, () => 0.62, -0.006);
    }
    for (let j = 5 + Math.floor(rnd() * 5); j > 0; j--) {
      const th = FACES[Math.floor(rnd() * 4)];
      leaf(rnd, ledge(th), LL, 0.04 + rnd() * 0.05, (rnd() - 0.5) * 1.4, 0.032 + rnd() * 0.014, rnd() * TAU, -0.002);
    }
  }

  flush(b);
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
 * The TEMPLE HALL (hondō): the main hall of an Edo-period temple in the
 * native (wayō) manner — a paper-walled hall on a granite base, ringed by a
 * veranda of pillars carrying a hipped roof that is taller than the hall
 * under it, with the altar's gilt glowing in the dark at the back.
 *
 * The plinth is walked at 0.55 and is the whole veranda — nineteen pillars on
 * it and the hall's walls set 1.6 m in from its edge — so it is a place to
 * fight along as well as a way in. The front has THREE doorways and each side
 * one, because a flag hall with one door is a corridor to die in. Everything
 * inside is one surface: a hall is one room, and the altar is cover.
 *
 * **It was a box of glowing grids ringed by bare posts under one smooth grey
 * hip**: a slab where the brackets should be, a slotted block for a ridge, a
 * plaster band round the top and a black box with a gilt rectangle over it
 * for an altar. What makes a hall one is that its FRAME is its ornament and
 * its EAVE is carried, so that is where this spends its vertices:
 *
 * - **The base (kidan)** is dan-jō granite — a ground course, posts with sunk
 *   panels between them and a coping — carried down to the ground, with the
 *   veranda's edge beam on it and boards laid along each side inside it. A
 *   granite step before the front doors and before each side door.
 * - **The hall's walls are a frame**: posts on a sill, a waist rail, the
 *   door-head nageshi with a bronze nail cover at every post, plaster over it
 *   to a head tie, and a plate. The paper bays are two lapped sashes of
 *   lattice over a board waist; the back is lapped boards with a shut
 *   boarded door in its middle bay. Over the plate the wall carries on up to
 *   the rafters in white plaster between the posts, which is what the veranda
 *   looks up at.
 * - **The doors** stand open, their panelled leaves folded back against the
 *   wall inside, with linings and a threshold in every opening.
 * - **The veranda's pillars** are tied through their heads (kashiranuki, its
 *   ends run on past the corners), and each carries a BRACKET SET — a bearing
 *   block, an arm along the tie and an arm out from it carrying small blocks,
 *   the plate along the pillar line and the eave purlin one step out — with a
 *   frog-leg strut (kaerumata) in every bay. A cambered tie beam runs in from
 *   each pillar to the hall's plate, and white plaster fills the pillar line
 *   from the plate up to the rafters.
 * - **The eave is two layers of parallel rafters** (base and flying, the
 *   flying ends capped in bronze) under a board lining, cut against a hip
 *   beam into each corner, which carries a wind bell.
 * - **The roof** is tiled in rows of round tiles with end tiles on an eave
 *   lip, under a ridge of courses banded in white with a demon tile at each
 *   end, and a hip ridge down each corner ending on its own demon tile.
 * - **The front** has a plaque on the bracket band, a curtain along the
 *   pillar line under the tie with the temple's mark in each bay, a gong
 *   before the middle door with a rope to ring it by, and bronze lanterns
 *   hung in the veranda.
 * - **Inside**: board floors, a coffered ceiling, a nageshi ringing the four
 *   inner pillars, and the altar drawn as a Sumeru dais (shumidan) — lacquer
 *   with bronze mouldings, gilt openings round its waist and a railing on it
 *   — carrying a seated Buddha on a lotus against a gilt halo and mandorla,
 *   two standing attendants, a canopy, candles, an incense burner and lotus
 *   vases, with a desk, a bowl and a drum on the floor before it.
 *
 * Seeded by where it stands (`streetSeed`), which is why it is in
 * `CONFORMS_TO_TERRAIN`: the stone and board lengths, the glyphs on the plaque
 * and the lanterns at the back vary, and the base and the steps are carried
 * down to the ground.
 *
 * **The colliders are the ones it always had, in the same order**: the
 * plinth, the walls (the retired `wall` calls spelled out as blocks), the four
 * inner pillars, the altar, the nineteen veranda pillars, then the roof slab.
 * Everything drawn is on a face (none more than 0.14 m proud), under 0.3 m
 * (the boards, the steps, the bases, the desk), overhead (everything from the
 * nageshi up clears the floor by 3.4 m, the gong's rope by a metre), or on a
 * collider (the altar's railing and figures, the upper walls on the hall's).
 */
export function buildTempleHall(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
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
  const doorH = 3.4;

  // --- colliders, exactly as they were: the plinth, the walls (the old `wall`
  // calls), the inner pillars, the altar, the veranda's pillars, the roof.
  b.block({ w: pw, h: plinthH, d: pd, x: 0, y: plinthH / 2, z: 0 });
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
  const fz = -d / 2 + t / 2;
  for (const [cx, len, open] of segs) {
    if (open) b.block({ w: len, h: wallH - doorH, d: t, x: cx, y: plinthH + doorH + (wallH - doorH) / 2, z: fz });
    else b.block({ w: len, h: wallH, d: t, x: cx, y: wy, z: fz });
  }
  b.block({ w, h: wallH, d: t, x: 0, y: wy, z: d / 2 - t / 2 });
  const side = (d - 2.4) / 2;
  for (const sx of [-1, 1] as const) {
    const x = sx * (w / 2 - t / 2);
    for (const sz of [-1, 1]) b.block({ w: t, h: wallH, d: side, x, y: wy, z: sz * (1.2 + side / 2) });
    b.block({ w: t, h: wallH - doorH, d: 2.4, x, y: plinthH + doorH + (wallH - doorH) / 2, z: 0 });
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) b.block({ w: 0.42, h: wallH, d: 0.42, x: sx * w * 0.22, y: wy, z: sz * d * 0.18 });
  }
  b.block({ w: w * 0.4, h: 1.0, d: 2.2, x: 0, y: plinthH + 0.5, z: d / 2 - 2.0 });
  const pillarH = wallH + 0.9;
  const px = pw / 2 - 0.4;
  const pz = pd / 2 - 0.4;
  const colsX = Math.round((px * 2) / 3.6);
  const colsZ = Math.round((pz * 2) / 3.6);
  const pillars: [number, number][] = [];
  for (let i = 0; i <= colsX; i++) {
    const x = -px + (i / colsX) * px * 2;
    pillars.push([x, -pz], [x, pz]);
  }
  for (let i = 1; i < colsZ; i++) {
    const z = -pz + (i / colsZ) * pz * 2;
    pillars.push([-px, z], [px, z]);
  }
  for (const [x, z] of pillars) b.block({ w: 0.4, h: pillarH, d: 0.4, x, y: plinthH + pillarH / 2, z });
  const beamY = plinthH + pillarH;
  const eave = beamY + 0.7;
  const ex = pw / 2 + 2.4;
  const ez = pd / 2 + 2.4;
  // Roofs last (see the kit header).
  b.block({ w: ex * 2, h: 0.4, d: ez * 2, x: 0, y: eave, z: 0 });

  // --- everything below is drawing -------------------------------------------
  const rnd = mulberry32(streetSeed(pw, pd, top, ctx));
  const backLanterns = rnd() < 0.6;
  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };
  const PX = pw / 2;
  const PZ = pd / 2;
  let foot = Math.min(0, ground(0, -(PZ + 1.1)), ground(-(PX + 0.9), 0), ground(PX + 0.9, 0));
  for (const gx of [-1, 0, 1]) {
    for (const gz of [-1, 0, 1]) {
      if (gx || gz) foot = Math.min(foot, ground(gx * (PX + 0.3), gz * (PZ + 0.3)));
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
  /** The veranda's pillar line on side `s`. */
  const lineN = (s: Side): number => (runsAlongX(s) ? pz : px);
  /** Plan point `n` out from the centre on side `s`, `u` along it. */
  const at = (s: Side, u: number, n: number): [number, number] =>
    runsAlongX(s) ? [u, outward(s) * n] : [outward(s) * n, u];
  /** A member on side `s`'s outer wall face, `out` from the face to its own centre. */
  const on = (s: Side, u: number, y: number, along: number, tall: number, thick: number, out: number, color: string, tilt = 0): void =>
    sb.onFace(s, wallFace(s), u, y, along, tall, thick, out, color, tilt, 0, hideBack(s));
  /** The same on the wall's inner face, `out` into the hall. */
  const inner = (s: Side, u: number, y: number, along: number, tall: number, thick: number, out: number, color: string): void =>
    sb.onFace(s, wallFace(s) - t, u, y, along, tall, thick, -out, color, 0, 0, hideBack(OPP[s]));
  /** A member centred on plane `n` of side `s` — the pillar line's timbers. */
  const onLine = (s: Side, n: number, u: number, y: number, along: number, tall: number, thick: number, color: string, tilt = 0, hide = 0): void =>
    sb.onFace(s, n, u, y, along, tall, thick, 0, color, tilt, 0, hide);
  /** A glow on side `s` whose centre is `plane` out from the building's centre. */
  const glowAt = (s: Side, plane: number, u: number, y: number, along: number, tall: number, color = SHOJI_GLOW): void => {
    const c = outward(s) * plane;
    if (runsAlongX(s)) b.glow(along, tall, 0.02, u, y, c, color);
    else b.glow(0.02, tall, along, c, y, u, color);
  };
  const member = (a: Point3, c: Point3, wide: number, deep: number, color: string, hide = 0): void => {
    const o = orient(a, c);
    sb.box(wide, deep, o.len, o.mid[0], o.mid[1], o.mid[2], color, o.rot, hide);
  };
  /** An end face 1.5 cm past `c`, square to the member from `a` — a tile's, or a rafter's cap. */
  const endFace = (a: Point3, c: Point3, wide: number, deep: number, color: string): void => {
    const o = orient(a, c);
    const k = 0.015 / o.len;
    sb.box(wide, deep, 0.01, c[0] + (c[0] - a[0]) * k, c[1] + (c[1] - a[1]) * k, c[2] + (c[2] - a[2]) * k, color, o.rot, 63 & ~END);
  };
  /** A disc of gilt light facing along Z — a halo — `sy` stretching it upward. */
  const glowDisc = (dia: number, x: number, y: number, z: number, sy = 1): void => {
    const m = b.cyl(0.02, dia, dia, 20, x, y, z, BRONZE, { x: Math.PI / 2 });
    m.material = mats.getEmissive(GILT_GLOW);
    m.metadata = { noInk: true };
    m.scaling.z = sy;
  };

  // --- the heights of the frame --------------------------------------------------
  const F0 = plinthH;
  const SILL = F0 + 0.14;
  const KICK = F0 + 0.6;
  const P0 = KICK + 0.1;
  const KAMOI = F0 + doorH;
  const P1 = KAMOI - 0.2;
  const NAGE = KAMOI + 0.25;
  const TIE = top - 0.2;
  const PLATE = top + 0.2;
  const CEIL = top - 0.15;
  // The veranda's bracket band, from the pillar heads up.
  const KN0 = beamY - 0.35;
  const KN1 = beamY - 0.05;
  const DAI = beamY + 0.2;
  const ARM = DAI + 0.16;
  const MAK = ARM + 0.1;
  const PL1 = MAK + 0.2;

  // --- the roof's own geometry, which everything under and on it is cut to ------
  const RISE = 6.4;
  const CURVE = 1.75;
  const TH = 0.3;
  const rx = (w - d) / 2 + 3;
  const roof: RoofSpec = { y: eave, ex, ez, tx: rx, tz: 0, rise: RISE, curve: CURVE, upturn: 1.0, thick: TH, rings: 7, seg: 8 };
  /** The underside of the board lining, which the rafters hang under. */
  const soffit = (x: number, z: number): number => roofHeight(roof, x, z, true) - 0.03;
  const RB = 0.16;
  const RF = 0.12;
  /** The underside of the base rafters over (u, n) on side `s`. */
  const underAt = (s: Side, u: number, n: number): number => {
    const [x, z] = at(s, u, n);
    return soffit(x, z) - RB;
  };
  /** Where the hip crosses the row `u` of side `s`, as a distance out from the centre. */
  const nHip = (s: Side, u: number): number =>
    runsAlongX(s) ? (ez * (Math.abs(u) - rx)) / (ex - rx) : ex - ((ex - rx) * (ez - Math.abs(u))) / ez;

  // --- the elevations: which bay is which ----------------------------------------
  type Bay = { a: number; c: number; kind: "shoji" | "door" | "boards" | "itado" };
  const front: Bay[] = segs.map(([cx, len, open]) => ({ a: cx - len / 2, c: cx + len / 2, kind: open ? "door" : "shoji" }));
  const sideBays: Bay[] = [];
  for (const [a, c, kind] of [
    [-d / 2, -1.2, "shoji"],
    [-1.2, 1.2, "door"],
    [1.2, d / 2, "shoji"],
  ] as const) {
    if (kind === "door") sideBays.push({ a, c, kind });
    else for (let i = 0; i < 2; i++) sideBays.push({ a: a + ((c - a) * i) / 2, c: a + ((c - a) * (i + 1)) / 2, kind });
  }
  const bays: Record<Side, Bay[]> = {
    "-z": front,
    "+z": front.map((bay, i) => ({ a: bay.a, c: bay.c, kind: i === 3 ? "itado" : "boards" })),
    "-x": sideBays,
    "+x": sideBays,
  };
  /** The posts in a wall, a door's two stood off it onto the wall so none hangs in the opening. */
  const posts = (s: Side): number[] => {
    const bs = bays[s];
    return [bs[0].a, ...bs.map((bay, i) => bay.c + (bay.kind === "door" ? 0.14 : bs[i + 1]?.kind === "door" ? -0.14 : 0))];
  };

  // --- the base: dan-jō granite, carried to the ground, the veranda's edge ------
  const plinthFace = (s: Side): number => (runsAlongX(s) ? PZ : PX);
  const plinthLen = (s: Side): number => (runsAlongX(s) ? pw : pd);
  const kf = (s: Side, u: number, y: number, along: number, tall: number, thick: number, out: number, color: string): void =>
    sb.onFace(s, plinthFace(s), u, y, along, tall, thick, out, color, 0, 0, hideBack(s));
  const course = (s: Side, y0: number, y1: number, proud: number): void => {
    const run = plinthLen(s) / 2 + proud;
    let u = -run;
    while (run - u > 0.05) {
      let len = 1.1 + rnd() * 0.6;
      if (run - (u + len) < 0.5) len = run - u;
      kf(s, u + len / 2, (y0 + y1) / 2, len - 0.02, y1 - y0, proud * 2, 0, GRANITE);
      u += len;
    }
  };
  for (const s of SIDES) {
    const L = plinthLen(s);
    course(s, foot, 0.1, 0.04);
    const n = Math.max(4, Math.round(L / 1.9));
    for (let k = 0; k <= n; k++) {
      const u = k === 0 ? -L / 2 + 0.12 : k === n ? L / 2 - 0.12 : -L / 2 + (k * L) / n;
      kf(s, u, 0.21, 0.24, 0.22, 0.1, 0, GRANITE);
      if (k < n) kf(s, -L / 2 + ((k + 0.5) * L) / n, 0.21, L / n - 0.2, 0.22, 0.03, 0, GRANITE);
    }
    course(s, 0.32, 0.42, 0.07);
    kf(s, 0, (0.42 + F0 + 0.012) / 2, L + 0.08, F0 + 0.012 - 0.42, 0.16, -0.04, HINOKI);
  }
  // The steps: a broad one before the three front doors and one before each side door.
  const step = (x: number, z: number, along: number, deep: number, alongX: boolean): void => {
    const g = ground(x, z);
    const sTop = 0.28;
    const sBot = Math.min(g, foot) - 0.05;
    let u = -along / 2;
    while (along / 2 - u > 0.05) {
      let len = 1.3 + rnd() * 0.8;
      if (along / 2 - (u + len) < 0.6) len = along / 2 - u;
      const c = u + len / 2;
      if (alongX) sb.box(len - 0.02, 0.1, deep, x + c, sTop - 0.05, z, GRANITE, undefined, HIDE_UNDER);
      else sb.box(deep, 0.1, len - 0.02, x, sTop - 0.05, z + c, GRANITE, undefined, HIDE_UNDER);
      u += len;
    }
    if (alongX) b.box(along - 0.04, sTop - 0.1 - sBot, deep - 0.04, x, (sTop - 0.1 + sBot) / 2, z, GRANITE_DARK);
    else b.box(deep - 0.04, sTop - 0.1 - sBot, along - 0.04, x, (sTop - 0.1 + sBot) / 2, z, GRANITE_DARK);
  };
  const doorSpan = front[front.length - 2].c - front[1].a;
  step(0, -PZ - 0.55, doorSpan + 1.2, 1.1, true);
  for (const sx of [-1, 1]) step(sx * (PX + 0.45), 0, 3.6, 0.9, false);

  // --- the floors: the veranda's boards along each side, the hall's across it ---
  const boardRun = (alongX: boolean, lo: number, hi: number, fixed: number, bw: number, color: string): void => {
    let u = lo;
    while (hi - u > 0.05) {
      let len = 2.4 + rnd() * 1.6;
      if (hi - (u + len) < 1.0) len = hi - u;
      const mid = u + len / 2;
      if (alongX) sb.box(len - 0.008, 0.05, bw - 0.012, mid, F0 - 0.025, fixed, color, undefined, HIDE_UNDER);
      else sb.box(bw - 0.012, 0.05, len - 0.008, fixed, F0 - 0.025, mid, color, undefined, HIDE_UNDER);
      u += len;
    }
  };
  {
    const VB = 5;
    for (const e of [-1, 1]) {
      const bz = (PZ - 0.12 - d / 2) / VB;
      for (let j = 0; j < VB; j++) boardRun(true, -(PX - 0.12), PX - 0.12, e * (d / 2 + (j + 0.5) * bz), bz, CEDAR);
      const bx = (PX - 0.12 - w / 2) / VB;
      for (let j = 0; j < VB; j++) boardRun(false, -d / 2, d / 2, e * (w / 2 + (j + 0.5) * bx), bx, CEDAR);
    }
  }
  const IW = w - 2 * t;
  const ID = d - 2 * t;
  const AW = w * 0.2;
  const AZ0 = d / 2 - 3.1;
  const AZ1 = d / 2 - 0.9;
  {
    const nr = Math.round(ID / 0.3);
    const bw = ID / nr;
    for (let r = 0; r < nr; r++) {
      const z = -ID / 2 + (r + 0.5) * bw;
      const cuts: [number, number][] = z > AZ0 && z < AZ1 ? [[-AW, AW]] : [];
      for (const [a, c] of carve(-IW / 2, IW / 2, cuts)) boardRun(true, a, c, z, bw, HINOKI);
    }
  }

  // --- the hall's outer elevations ------------------------------------------------
  const lit = !!p.litWindows;
  /** A paper bay's lattice: sashes in two tracks, `dir` 1 outside and -1 in. */
  const sashes = (s: Side, a: number, c: number, dir: 1 | -1): void => {
    const put = dir > 0 ? on : inner;
    const np = Math.max(1, Math.round((c - a) / 1.0));
    const sw = (c - a) / np;
    const rows = Math.round((P1 - P0) / 0.34);
    for (let i = 0; i < np; i++) {
      const u = a + (i + 0.5) * sw;
      const lap = dir > 0 ? (i % 2) * 0.035 : 0;
      for (const e of [-1, 1]) put(s, u + e * (sw / 2 - 0.035), (P0 + P1) / 2, 0.07, P1 - P0, 0.05, 0.055 + lap, SUMI);
      for (const yr of [P0 + 0.035, P1 - 0.035]) put(s, u, yr, sw - 0.07, 0.07, 0.05, 0.055 + lap, SUMI);
      for (let k = 1; k < 3; k++) put(s, u - sw / 2 + 0.035 + (k * (sw - 0.07)) / 3, (P0 + P1) / 2, 0.03, P1 - P0 - 0.07, 0.03, 0.05 + lap, SUMI);
      for (let r = 1; r < rows; r++) put(s, u, P0 + (r * (P1 - P0)) / rows, sw - 0.1, 0.03, 0.03, 0.05 + lap, SUMI);
    }
  };
  for (const s of SIDES) {
    const L = faceLen(s);
    const pu = posts(s);
    const doors: [number, number][] = bays[s].filter((bay) => bay.kind === "door").map((bay) => [bay.a, bay.c]);
    for (const [a, c] of carve(-L / 2, L / 2, doors)) on(s, (a + c) / 2, (F0 + SILL) / 2, c - a, SILL - F0, 0.1, 0.05, HINOKI);
    pu.forEach((u, i) => {
      const corner = i === 0 || i === pu.length - 1;
      on(s, u, (F0 + top) / 2, corner ? 0.34 : 0.28, top - F0, 0.12, 0.06, HINOKI);
      on(s, u, (KAMOI + NAGE) / 2, 0.12, 0.12, 0.02, 0.14, BRONZE);
      on(s, u, (KAMOI + NAGE) / 2, 0.06, 0.06, 0.02, 0.155, BRONZE);
    });
    on(s, 0, (KAMOI + NAGE) / 2, L + 0.12, NAGE - KAMOI, 0.12, 0.07, HINOKI);
    for (const bay of bays[s]) on(s, (bay.a + bay.c) / 2, (NAGE + TIE) / 2, bay.c - bay.a, TIE - NAGE, 0.02, 0.01, SHIKKUI);
    on(s, 0, (TIE + top) / 2, L + 0.12, top - TIE, 0.1, 0.05, HINOKI);
    on(s, 0, (top + PLATE) / 2, L + 0.36, PLATE - top, 0.16, 0.08, HINOKI);

    for (const bay of bays[s]) {
      const a = bay.a + 0.14;
      const c = bay.c - 0.14;
      const cu = (a + c) / 2;
      if (bay.kind === "shoji") {
        const nb = Math.max(2, Math.round((c - a) / 0.3));
        for (let k = 0; k < nb; k++) {
          on(s, a + ((k + 0.5) * (c - a)) / nb, (SILL + KICK) / 2, (c - a) / nb - 0.01, KICK - SILL, 0.03, 0.02 + (k % 2) * 0.014, HINOKI);
        }
        on(s, cu, KICK + 0.05, c - a, 0.1, 0.08, 0.04, HINOKI);
        if (lit) glowAt(s, wallFace(s) + 0.015, cu, (P0 + P1) / 2, c - a, P1 - P0);
        else on(s, cu, (P0 + P1) / 2, c - a, P1 - P0, 0.02, 0.015, PAPER);
        on(s, cu, (P1 + KAMOI) / 2, c - a, KAMOI - P1, 0.08, 0.04, HINOKI);
        sashes(s, a, c, 1);
      } else if (bay.kind === "boards" || bay.kind === "itado") {
        const nb = Math.max(2, Math.round((c - a) / 0.32));
        for (let k = 0; k < nb; k++) {
          on(s, a + ((k + 0.5) * (c - a)) / nb, (SILL + KAMOI) / 2, (c - a) / nb - 0.01, KAMOI - SILL, 0.03, 0.02 + (k % 2) * 0.014, HINOKI);
        }
        if (bay.kind === "boards") {
          on(s, cu, F0 + 1.9, c - a, 0.12, 0.08, 0.06, HINOKI);
        } else {
          // A shut boarded door: two leaves strapped in bronze, ring pulls, a frame.
          const lw = (c - a - 0.3) / 2;
          for (const e of [-1, 1]) {
            on(s, cu + e * (lw + 0.1), (SILL + KAMOI) / 2, 0.1, KAMOI - SILL, 0.08, 0.06, HINOKI);
            const lu = cu + (e * lw) / 2;
            for (const yf of [0.2, 0.5, 0.8]) on(s, lu, SILL + (KAMOI - SILL) * yf, lw - 0.1, 0.07, 0.02, 0.06, BRONZE);
            on(s, cu + e * 0.1, SILL + (KAMOI - SILL) * 0.42, 0.07, 0.14, 0.03, 0.065, BRONZE);
          }
          on(s, cu, (SILL + KAMOI) / 2, 0.03, KAMOI - SILL, 0.04, 0.05, SUMI);
        }
      } else {
        // An open doorway: its linings and its threshold.
        const [jx, jz] = at(s, 0, wallFace(s) - t / 2);
        const lining = (u: number, y: number, along: number, tall: number, hide = 0): void => {
          if (runsAlongX(s)) sb.box(along, tall, t + 0.03, u, y, jz, HINOKI, undefined, hide);
          else sb.box(t + 0.03, tall, along, jx, y, u, HINOKI, undefined, hide);
        };
        for (const u of [bay.a + 0.05, bay.c - 0.05]) lining(u, (F0 + KAMOI) / 2, 0.1, KAMOI - F0);
        lining((bay.a + bay.c) / 2, KAMOI + 0.01, bay.c - bay.a, 0.04);
        lining((bay.a + bay.c) / 2, F0 - 0.01, bay.c - bay.a, 0.05, HIDE_UNDER);
      }
    }

    // Over the plate the wall carries on up to the rafters, in plaster between the posts.
    for (const bay of bays[s]) {
      const topA = Math.min(underAt(s, bay.a, wallFace(s) + 0.02), underAt(s, bay.c, wallFace(s) + 0.02), underAt(s, (bay.a + bay.c) / 2, wallFace(s) + 0.02));
      if (topA - PLATE < 0.1) continue;
      on(s, (bay.a + bay.c) / 2, (PLATE + topA) / 2, bay.c - bay.a, topA - PLATE, 0.02, 0.01, SHIKKUI);
      for (const band of [PLATE + 1.2, PLATE + 2.4]) {
        if (band + 0.2 < topA) on(s, (bay.a + bay.c) / 2, band, bay.c - bay.a, 0.16, 0.08, 0.04, HINOKI);
      }
    }
    for (const u of pu) {
      const up = underAt(s, u, wallFace(s) + 0.02) + 0.04;
      if (up > PLATE + 0.1) on(s, u, (PLATE + up) / 2, 0.24, up - PLATE, 0.1, 0.05, HINOKI);
    }
  }

  // --- the hall's inner elevations -------------------------------------------------
  for (const s of SIDES) {
    const L = faceLen(s) - 2 * t;
    const lim = L / 2 - 0.08;
    for (const u of posts(s)) {
      if (Math.abs(u) < lim) inner(s, u, (F0 + CEIL) / 2, 0.22, CEIL - F0, 0.05, 0.025, HINOKI);
    }
    inner(s, 0, (KAMOI + NAGE) / 2, L, NAGE - KAMOI, 0.08, 0.04, HINOKI);
    inner(s, 0, (NAGE + CEIL) / 2, L, CEIL - NAGE, 0.01, 0.005, SHIKKUI);
    for (const bay of bays[s]) {
      const a = Math.max(bay.a + 0.11, -L / 2);
      const c = Math.min(bay.c - 0.11, L / 2);
      const cu = (a + c) / 2;
      if (bay.kind === "shoji") {
        inner(s, cu, (F0 + KICK) / 2, c - a, KICK - F0, 0.02, 0.01, HINOKI);
        inner(s, cu, KICK + 0.05, c - a, 0.1, 0.06, 0.03, HINOKI);
        inner(s, cu, (P0 + P1) / 2, c - a, P1 - P0, 0.01, 0.012, PAPER);
        inner(s, cu, (P1 + KAMOI) / 2, c - a, KAMOI - P1, 0.06, 0.03, HINOKI);
        sashes(s, a, c, -1);
      } else if (bay.kind !== "door") {
        inner(s, cu, (F0 + KAMOI) / 2, c - a, KAMOI - F0, 0.02, 0.01, HINOKI);
        for (const yr of [F0 + 0.9, F0 + 2.2]) inner(s, cu, yr, c - a, 0.1, 0.06, 0.03, HINOKI);
      } else {
        // The door's panelled leaves, folded back against the wall either side.
        const lw = (bay.c - bay.a) / 2 - 0.06;
        for (const e of [-1, 1]) {
          const edge = e < 0 ? bay.a - 0.06 : bay.c + 0.06;
          const lu = edge + (e * lw) / 2;
          if (Math.abs(lu) + lw / 2 > L / 2) continue;
          const y0 = F0 + 0.03;
          const y1 = KAMOI - 0.04;
          const mid = y0 + (y1 - y0) * 0.4;
          inner(s, lu, (y0 + y1) / 2, lw, y1 - y0, 0.03, 0.075, HINOKI);
          for (const f of [-1, 1]) inner(s, lu + f * (lw / 2 - 0.05), (y0 + y1) / 2, 0.1, y1 - y0, 0.05, 0.115, HINOKI);
          for (const yr of [y0 + 0.07, mid, y1 - 0.06]) inner(s, lu, yr, lw - 0.2, 0.12, 0.05, 0.115, HINOKI);
          const g0 = mid + 0.06;
          const g1 = y1 - 0.12;
          inner(s, lu, (g0 + g1) / 2, lw - 0.2, g1 - g0, 0.01, 0.095, SUMI);
          for (let k = 1; k < 4; k++) inner(s, lu - (lw - 0.2) / 2 + ((lw - 0.2) * k) / 4, (g0 + g1) / 2, 0.03, g1 - g0, 0.03, 0.11, HINOKI);
          for (let k = 1; k < 7; k++) inner(s, lu, g0 + ((g1 - g0) * k) / 7, lw - 0.2, 0.03, 0.03, 0.11, HINOKI);
          inner(s, lu - e * (lw / 2 - 0.16), mid - 0.3, 0.08, 0.08, 0.03, 0.15, BRONZE);
        }
      }
    }
  }

  // --- the coffered ceiling, the inner pillars' nageshi -----------------------------
  sb.box(IW, 0.03, ID, 0, CEIL + 0.015, 0, CEDAR, undefined, TOP);
  {
    const nx = Math.max(4, Math.round(IW / 0.9));
    const nz = Math.max(4, Math.round(ID / 0.9));
    for (let i = 1; i < nx; i++) sb.box(0.07, 0.08, ID, -IW / 2 + (i * IW) / nx, CEIL - 0.04, 0, SUMI, undefined, TOP);
    for (let i = 1; i < nz; i++) sb.box(IW, 0.08, 0.07, 0, CEIL - 0.04, -ID / 2 + (i * ID) / nz, SUMI, undefined, TOP);
    for (const e of [-1, 1]) {
      sb.box(IW, 0.16, 0.14, 0, CEIL - 0.08, e * (ID / 2 - 0.07), HINOKI, undefined, TOP);
      sb.box(0.14, 0.16, ID, e * (IW / 2 - 0.07), CEIL - 0.08, 0, HINOKI, undefined, TOP);
    }
    const ix = w * 0.22;
    const iz = d * 0.18;
    for (const e of [-1, 1]) {
      sb.box(2 * ix, 0.25, 0.14, 0, (KAMOI + NAGE) / 2, e * iz, HINOKI);
      sb.box(0.14, 0.25, 2 * iz, e * ix, (KAMOI + NAGE) / 2, 0, HINOKI);
      sb.box(2 * ix, 0.2, 0.12, 0, CEIL - 0.26, e * iz, HINOKI);
      sb.box(0.12, 0.2, 2 * iz, e * ix, CEIL - 0.26, 0, HINOKI);
    }
    for (const [sx, sz] of CORNERS) b.cyl(0.05, 0.72, 0.76, 10, sx * ix, F0 + 0.025, sz * iz, GRANITE_DARK);
  }

  // --- the altar: a Sumeru dais, the figures on it, what is laid before them -------
  const AT = F0 + 1.0;
  const zA = (AZ0 + AZ1) / 2;
  {
    // The dais's faces: front and ends. Its back is 0.6 m from the wall, in the dark.
    for (const s of ["-z", "-x", "+x"] as const) {
      const half = runsAlongX(s) ? AW : 1.1;
      const plane = runsAlongX(s) ? 1.1 : AW;
      const cz = runsAlongX(s) ? 0 : zA;
      const A = (u: number, y: number, along: number, tall: number, thick: number, out: number, color: string): void => {
        if (runsAlongX(s)) sb.box(along, tall, thick, u, y, zA - (plane + out), color, undefined, hideBack(s));
        else sb.box(thick, tall, along, outward(s) * (plane + out), y, cz + u, color, undefined, hideBack(s));
      };
      const L = 2 * half;
      A(0, F0 + 0.08, L + 0.12, 0.16, 0.1, 0.03, SUMI);
      A(0, F0 + 0.19, L + 0.06, 0.06, 0.08, 0.02, BRONZE);
      A(0, AT - 0.2, L + 0.06, 0.06, 0.08, 0.02, BRONZE);
      A(0, AT - 0.08, L + 0.16, 0.14, 0.12, 0.04, SUMI);
      A(0, AT + 0.02, L + 0.2, 0.06, 0.14, 0.05, BRONZE);
      // The waist: panels between posts, a gilt opening in each.
      const n = Math.max(2, Math.round(L / 0.8));
      for (let k = 0; k <= n; k++) A(-half + (k * L) / n, (F0 + 0.22 + AT - 0.23) / 2, 0.1, AT - 0.45 - F0, 0.04, 0.01, BRONZE);
      for (let k = 0; k < n; k++) {
        const u = -half + ((k + 0.5) * L) / n;
        const gw = L / n - 0.3;
        A(u, (F0 + AT) / 2, gw, 0.24, 0.02, 0.01, BRONZE);
        A(u, (F0 + AT) / 2, gw - 0.09, 0.15, 0.02, 0.02, SUMI);
        for (const e of [-1, 1]) A(u + e * (gw / 2 - 0.08), (F0 + AT) / 2 + 0.05, 0.05, 0.05, 0.02, 0.025, BRONZE);
      }
    }
    // The railing round its top, open in the middle of the front.
    const RY = AT + 0.05;
    const railRun = (a: Point3, c: Point3): void => {
      member([a[0], RY + 0.28, a[2]], [c[0], RY + 0.28, c[2]], 0.05, 0.05, SUMI);
      member([a[0], RY + 0.12, a[2]], [c[0], RY + 0.12, c[2]], 0.03, 0.03, SUMI);
      const len = Math.hypot(c[0] - a[0], c[2] - a[2]);
      const n = Math.max(1, Math.round(len / 0.5));
      for (let k = 0; k <= n; k++) {
        const f = k / n;
        const x = a[0] + (c[0] - a[0]) * f;
        const z = a[2] + (c[2] - a[2]) * f;
        sb.box(0.05, 0.3, 0.05, x, RY + 0.15, z, SUMI, undefined, HIDE_UNDER);
        if (k === 0 || k === n) sb.box(0.08, 0.06, 0.08, x, RY + 0.33, z, BRONZE, undefined, HIDE_UNDER);
      }
    };
    const rX = AW - 0.02;
    const rZ0 = AZ0 + 0.04;
    const rZ1 = AZ1 - 0.04;
    railRun([-rX, 0, rZ0], [-0.75, 0, rZ0]);
    railRun([0.75, 0, rZ0], [rX, 0, rZ0]);
    railRun([-rX, 0, rZ0], [-rX, 0, rZ1]);
    railRun([rX, 0, rZ0], [rX, 0, rZ1]);
    railRun([-rX, 0, rZ1], [rX, 0, rZ1]);
  }
  const y0 = AT + 0.04;
  sb.box(2 * AW + 0.1, 0.05, 2.3, 0, AT + 0.015, zA, SUMI);
  /** A lotus pedestal of `r` at (x, z) from `yb`: a base, a waist, two rows of petals and a seat. Returns the seat. */
  const lotus = (x: number, z: number, yb: number, r: number, petals: number): number => {
    b.cyl(0.16 * r, 1.3 * r, 1.4 * r, 8, x, yb + 0.08 * r, z, SUMI);
    b.cyl(0.24 * r, 0.8 * r, 1.05 * r, 8, x, yb + 0.28 * r, z, BRONZE);
    b.cyl(0.16 * r, 1.45 * r, 0.9 * r, 16, x, yb + 0.48 * r, z, BRONZE);
    for (const [row, rr, yy] of [
      [0, 0.64, 0.5],
      [1, 0.54, 0.64],
    ] as const) {
      for (let k = 0; k < petals; k++) {
        const ang = ((k + row * 0.5) / petals) * Math.PI * 2;
        sb.box(0.34 * r, 0.26 * r, 0.04, x + Math.sin(ang) * rr * r, yb + yy * r, z + Math.cos(ang) * rr * r, BRONZE, { x: 0.5, y: ang });
      }
    }
    b.cyl(0.06 * r, 1.1 * r, 1.1 * r, 16, x, yb + 0.76 * r, z, BRONZE);
    return yb + 0.79 * r;
  };
  {
    // The seated Buddha, on a lotus, before a mandorla and a halo.
    const zB = zA + 0.25;
    const ys = lotus(0, zB, y0, 1, 16);
    // Crossed legs, a torso broader at the shoulders than the waist, the robe
    // over the shoulders, the arms down to the hands in the lap, a round head.
    b.cyl(0.34, 1.1, 1.18, 12, 0, ys + 0.17, zB, BRONZE).scaling.z = 0.74;
    b.cyl(0.6, 0.66, 0.52, 10, 0, ys + 0.64, zB + 0.08, BRONZE).scaling.z = 0.6;
    b.cyl(0.2, 0.3, 0.72, 10, 0, ys + 1.03, zB + 0.08, BRONZE).scaling.z = 0.6;
    for (const e of [-1, 1]) {
      const sh: Point3 = [e * 0.3, ys + 0.9, zB + 0.08];
      const el: Point3 = [e * 0.42, ys + 0.56, zB - 0.02];
      const hd: Point3 = [e * 0.1, ys + 0.42, zB - 0.22];
      limb(b, sh, el, 0.2, 0.17, BRONZE, 6);
      limb(b, el, hd, 0.16, 0.12, BRONZE, 6);
      sb.box(0.05, 0.2, 0.09, e * 0.165, ys + 1.3, zB + 0.06, BRONZE);
    }
    sb.box(0.3, 0.08, 0.18, 0, ys + 0.42, zB - 0.24, BRONZE);
    b.cyl(0.12, 0.17, 0.2, 8, 0, ys + 1.16, zB + 0.07, BRONZE);
    b.cyl(0.18, 0.33, 0.22, 10, 0, ys + 1.3, zB + 0.05, BRONZE);
    b.cyl(0.16, 0.24, 0.33, 10, 0, ys + 1.47, zB + 0.05, BRONZE);
    b.cyl(0.12, 0.1, 0.2, 8, 0, ys + 1.61, zB + 0.05, BRONZE);
    // The mandorla ringed in bronze, and the halo before it ringed the same way.
    b.cyl(0.03, 1.86, 1.86, 20, 0, ys + 1.0, zB + 0.62, BRONZE, { x: Math.PI / 2 }).scaling.z = 1.3;
    glowDisc(1.7, 0, ys + 1.0, zB + 0.58, 1.3);
    b.cyl(0.03, 0.98, 0.98, 20, 0, ys + 1.42, zB + 0.5, BRONZE, { x: Math.PI / 2 });
    glowDisc(0.86, 0, ys + 1.42, zB + 0.47);
    // The attendants, standing on smaller lotuses either side.
    for (const e of [-1, 1]) {
      const x = e * (AW - 0.95);
      const z = zB + 0.15;
      const ya = lotus(x, z, y0, 0.5, 12);
      // A robe falling to the feet, shoulders over it, the hands together.
      b.cyl(1.0, 0.34, 0.48, 10, x, ya + 0.5, z, BRONZE).scaling.z = 0.8;
      b.cyl(0.46, 0.44, 0.32, 10, x, ya + 1.22, z, BRONZE).scaling.z = 0.7;
      for (const f of [-1, 1]) {
        limb(b, [x + f * 0.19, ya + 1.36, z], [x + f * 0.22, ya + 1.08, z - 0.1], 0.11, 0.1, BRONZE, 5);
        limb(b, [x + f * 0.22, ya + 1.08, z - 0.1], [x + f * 0.02, ya + 1.2, z - 0.22], 0.1, 0.08, BRONZE, 5);
      }
      sb.box(0.06, 0.18, 0.08, x, ya + 1.26, z - 0.24, BRONZE);
      b.cyl(0.08, 0.1, 0.12, 8, x, ya + 1.49, z, BRONZE);
      b.cyl(0.14, 0.2, 0.15, 8, x, ya + 1.6, z, BRONZE);
      b.cyl(0.12, 0.15, 0.21, 8, x, ya + 1.73, z, BRONZE);
      b.cyl(0.14, 0.12, 0.18, 8, x, ya + 1.86, z, BRONZE);
      b.cyl(0.03, 0.6, 0.6, 16, x, ya + 1.7, z + 0.3, BRONZE, { x: Math.PI / 2 });
      glowDisc(0.52, x, ya + 1.7, z + 0.27);
    }
    // The canopy over the Buddha, hung from the ceiling on four rods.
    const cy = CEIL - 0.7;
    const cr = 1.0;
    for (const e of [-1, 1]) {
      sb.box(2 * cr, 0.14, 0.08, 0, cy, zB + e * cr, BRONZE);
      sb.box(0.08, 0.14, 2 * cr, e * cr, cy, zB, BRONZE);
    }
    sb.box(2 * cr, 0.03, 2 * cr, 0, cy + 0.08, zB, BRONZE, undefined, TOP);
    for (const [sx, sz] of CORNERS) {
      sb.box(0.02, CEIL - cy - 0.08, 0.02, sx * (cr - 0.1), (CEIL + cy + 0.08) / 2, zB + sz * (cr - 0.1), SUMI);
      sb.box(0.1, 0.1, 0.1, sx * cr, cy - 0.1, zB + sz * cr, BRONZE, { y: Math.PI / 4 });
    }
    const ns = 9;
    for (let k = 0; k < ns; k++) {
      const u = -cr + 0.1 + ((2 * cr - 0.2) * (k + 0.5)) / ns;
      const len = 0.28 + (k % 2) * 0.12;
      for (const e of [-1, 1]) {
        sb.box(0.02, len, 0.02, u, cy - 0.07 - len / 2, zB + e * (cr + 0.05), BRONZE);
        sb.box(0.02, len, 0.02, e * (cr + 0.05), cy - 0.07 - len / 2, zB + u, BRONZE);
      }
    }
  }
  {
    // Laid on the dais's front edge: candles, the incense burner, lotus vases.
    const zo = AZ0 + 0.35;
    b.cyl(0.16, 0.34, 0.26, 10, 0, y0 + 0.12, zo, BRONZE);
    b.cyl(0.08, 0.3, 0.34, 10, 0, y0 + 0.24, zo, BRONZE);
    b.cyl(0.06, 0.04, 0.1, 6, 0, y0 + 0.31, zo, BRONZE);
    for (const e of [-1, 1]) {
      const x = e * 0.95;
      b.cyl(0.05, 0.26, 0.26, 8, x, y0 + 0.025, zo, BRONZE);
      b.cyl(0.46, 0.05, 0.06, 6, x, y0 + 0.28, zo, BRONZE);
      b.cyl(0.03, 0.18, 0.18, 8, x, y0 + 0.52, zo, BRONZE);
      b.cyl(0.16, 0.05, 0.05, 6, x, y0 + 0.62, zo, PAPER);
      b.glow(0.04, 0.08, 0.04, x, y0 + 0.74, zo, SHOJI_GLOW);
      const vx = e * 1.65;
      b.cyl(0.3, 0.12, 0.22, 8, vx, y0 + 0.15, zo, BRONZE);
      limb(b, [vx, y0 + 0.28, zo], [vx + e * 0.05, y0 + 0.78, zo], 0.02, 0.015, BRONZE, 4);
      b.cyl(0.02, 0.3, 0.3, 10, vx + e * 0.12, y0 + 0.58, zo, BRONZE, { z: -e * 0.4 });
      b.cyl(0.02, 0.24, 0.24, 10, vx - e * 0.1, y0 + 0.5, zo, BRONZE, { z: e * 0.5 });
      b.cyl(0.16, 0.02, 0.1, 8, vx + e * 0.05, y0 + 0.86, zo, BRONZE);
    }
    // Before it on the floor: a sutra desk with a book on it, a bowl on a cushion and a drum on another.
    const zf = AZ0 - 0.9;
    sb.box(0.9, 0.04, 0.4, 0, F0 + 0.26, zf, SUMI);
    for (const e of [-1, 1]) sb.box(0.06, 0.24, 0.36, e * 0.4, F0 + 0.12, zf, SUMI, undefined, HIDE_UNDER);
    sb.box(0.3, 0.04, 0.22, 0.05, F0 + 0.3, zf, PAPER, { y: 0.1 });
    sb.box(0.56, 0.06, 0.56, 0, F0 + 0.03, zf - 0.75, NOREN, { y: 0.05 }, HIDE_UNDER);
    for (const e of [-1, 1]) sb.box(0.5, 0.08, 0.5, e * 1.0, F0 + 0.04, zf, NOREN, { y: e * 0.2 }, HIDE_UNDER);
    b.cyl(0.22, 0.44, 0.3, 12, 1.0, F0 + 0.19, zf, BRONZE);
    b.cyl(0.3, 0.3, 0.36, 10, -1.0, F0 + 0.23, zf, HINOKI, { z: Math.PI / 2 });
    sb.box(0.04, 0.02, 0.3, -1.0, F0 + 0.1, zf - 0.28, HINOKI, { y: 0.4 });
  }

  // --- the veranda: the pillar line's timbers and its bracket sets ------------------
  for (const s of SIDES) {
    const N = lineN(s);
    const us = runsAlongX(s)
      ? Array.from({ length: colsX + 1 }, (_, i) => -px + (i / colsX) * px * 2)
      : Array.from({ length: colsZ + 1 }, (_, i) => -pz + (i / colsZ) * pz * 2);
    const half = runsAlongX(s) ? px : pz;
    const NG = N + 0.55;
    // The head tie through the pillars, its ends run on past the corners.
    onLine(s, N, 0, (KN0 + KN1) / 2, 2 * half + 1.0, KN1 - KN0, 0.22, HINOKI);
    for (const e of [-1, 1]) onLine(s, N, e * (half + 0.42), KN0 - 0.04, 0.16, 0.08, 0.2, HINOKI, 0, TOP);
    // The plate along the pillar line, and the eave purlin one step out, swept with the eave.
    onLine(s, N, 0, (MAK + PL1) / 2, 2 * half + 0.9, PL1 - MAK, 0.2, HINOKI);
    const LG = half + 0.55 + 0.3;
    const gTop = (u: number): number => underAt(s, u, NG);
    const NS = 8;
    for (let i = 0; i < NS; i++) {
      const ua = -LG + (2 * LG * i) / NS;
      const uc = -LG + (2 * LG * (i + 1)) / NS;
      const [xa, za] = at(s, ua, NG);
      const [xc, zc] = at(s, uc, NG);
      member([xa, gTop(ua) - 0.11, za], [xc, gTop(uc) - 0.11, zc], 0.2, 0.22, HINOKI, (i > 0 ? START : 0) | (i < NS - 1 ? END : 0));
    }
    // White plaster up to the rafters over the plate, bay by bay.
    for (let i = 0; i + 1 < us.length; i++) {
      const ua = us[i] + 0.1;
      const uc = us[i + 1] - 0.1;
      const topK = Math.min(underAt(s, ua, N), underAt(s, uc, N), underAt(s, (ua + uc) / 2, N)) - 0.005;
      if (topK - PL1 > 0.05) onLine(s, N, (ua + uc) / 2, (PL1 + topK) / 2, uc - ua, topK - PL1, 0.06, SHIKKUI);
    }
    us.forEach((u, i) => {
      const corner = i === 0 || i === us.length - 1;
      // The bearing block, the arm along the tie with its small blocks, and the arm out.
      if (runsAlongX(s) || !corner) {
        const [x, z] = at(s, u, N);
        sb.box(0.5, DAI - beamY, 0.5, x, (beamY + DAI) / 2, z, HINOKI);
        sb.box(0.36, 0.06, 0.36, x, beamY - 0.03, z, HINOKI, undefined, TOP);
      }
      onLine(s, N, u, (DAI + ARM) / 2, 1.3, ARM - DAI, 0.2, HINOKI);
      for (const du of [-0.5, 0, 0.5]) onLine(s, N, u + du, (ARM + MAK) / 2, 0.24, MAK - ARM, 0.24, HINOKI, 0, TOP);
      if (!corner) {
        const [xa, za] = at(s, u, N - 0.4);
        const [xc, zc] = at(s, u, N + 0.72);
        member([xa, (DAI + ARM) / 2, za], [xc, (DAI + ARM) / 2, zc], 0.2, ARM - DAI, HINOKI);
        const [bx, bz] = at(s, u, NG);
        const bTop = gTop(u) - 0.22;
        sb.box(0.24, bTop - ARM, 0.24, bx, (ARM + bTop) / 2, bz, HINOKI, undefined, TOP);
      } else {
        // At a corner the arm along runs on out under the next side's purlin.
        const next: Side = runsAlongX(s) ? (u < 0 ? "-x" : "+x") : u < 0 ? "-z" : "+z";
        const bTop = underAt(next, outward(s) * N, lineN(next) + 0.55) - 0.22;
        const [bx, bz] = at(s, u + Math.sign(u) * 0.55, N);
        sb.box(0.24, bTop - ARM, 0.24, bx, (ARM + bTop) / 2, bz, HINOKI, undefined, TOP);
      }
    });
    // A frog-leg strut in every bay, a small block on it under the plate.
    for (let i = 0; i + 1 < us.length; i++) {
      const um = (us[i] + us[i + 1]) / 2;
      for (const e of [-1, 1]) onLine(s, N, um + e * 0.2, (KN1 + ARM) / 2 - 0.04, 0.09, 0.48, 0.14, HINOKI, e * 0.62);
      onLine(s, N, um, KN1 + 0.05, 0.62, 0.1, 0.16, HINOKI, 0, TOP);
      onLine(s, N, um, ARM - 0.06, 0.34, 0.12, 0.18, HINOKI);
      onLine(s, N, um, (ARM + MAK) / 2, 0.24, MAK - ARM, 0.24, HINOKI, 0, TOP);
    }
    // A cambered tie in from every pillar that faces the hall's wall.
    const wHalf = faceLen(s) / 2;
    for (const u of us) {
      if (Math.abs(u) > wHalf - 0.15) continue;
      const yT = PLATE + 0.17;
      const [xa, za] = at(s, u, N - 0.1);
      const [xm, zm] = at(s, u, (N + wallFace(s)) / 2);
      const [xc, zc] = at(s, u, wallFace(s) + 0.12);
      member([xa, yT, za], [xm, yT + 0.07, zm], 0.22, 0.34, HINOKI, END);
      member([xm, yT + 0.07, zm], [xc, yT, zc], 0.22, 0.34, HINOKI, START);
    }
  }
  // The pillars' own drawing: the round shafts and their granite bases.
  for (const [x, z] of pillars) {
    b.cyl(pillarH, 0.46, 0.5, 10, x, plinthH + pillarH / 2, z, HINOKI);
    b.cyl(0.2, 0.75, 0.8, 8, x, plinthH + 0.1, z, GRANITE_DARK);
  }

  // --- the eave: rafters in two layers, the hip beams, the wind bells ---------------
  for (const s of SIDES) {
    const along = runsAlongX(s) ? ex : ez;
    const nEave = runsAlongX(s) ? ez : ex;
    const halfW = faceLen(s) / 2;
    const N = lineN(s);
    const nB = N + 0.95;
    const nF = N + 0.75;
    const SP = 0.36;
    const K = Math.floor((along - 0.15) / SP);
    for (let k = -K; k <= K; k++) {
      const u = k * SP;
      const hip = nHip(s, u) + 0.12;
      const n0 = Math.abs(u) <= halfW - 0.06 ? Math.max(wallFace(s) + 0.02, hip) : hip;
      const lay = (na: number, nc: number, wide: number, deep: number, cap: string | null): void => {
        if (nc - na < 0.15) return;
        const [xa, za] = at(s, u, na);
        const [xc, zc] = at(s, u, nc);
        const a: Point3 = [xa, soffit(xa, za) - deep / 2, za];
        const c: Point3 = [xc, soffit(xc, zc) - deep / 2, zc];
        member(a, c, wide, deep, HINOKI, TOP | START);
        if (cap) endFace(a, c, wide + 0.01, deep + 0.01, cap);
      };
      lay(n0, nB, 0.12, RB, null);
      lay(Math.max(nF, n0), nEave - 0.04, 0.1, RF, BRONZE);
    }
  }
  {
    const fW = Math.max(0, (w / 2 - rx) / (ex - rx));
    CORNERS.forEach(([sx, sz]) => {
      const H = (f: number, deep: number): Point3 => {
        const x = sx * (rx + f * (ex - rx));
        const z = sz * f * ez;
        return [x, soffit(x, z) - deep / 2, z];
      };
      member(H(fW, 0.34), H(0.82, 0.34), 0.3, 0.34, HINOKI, TOP | START);
      const a = H(0.74, 0.26);
      const c = H(0.995, 0.26);
      member(a, c, 0.24, 0.26, HINOKI, TOP | START);
      endFace(a, c, 0.26, 0.28, BRONZE);
      const [bx, by0, bz] = c;
      const by = by0 - 0.13;
      sb.box(0.03, 0.18, 0.03, bx, by - 0.09, bz, BRONZE);
      b.cyl(0.34, 0.15, 0.26, 8, bx, by - 0.35, bz, BRONZE);
      sb.box(0.02, 0.18, 0.02, bx, by - 0.61, bz, BRONZE);
      sb.box(0.15, 0.24, 0.012, bx, by - 0.82, bz, BRONZE, { y: Math.atan2(sx, sz) + Math.PI / 2 });
    });
  }

  // --- the front: the plaque, the curtain, the gong; the lanterns in the veranda -----
  {
    // The plaque hung from the eave purlin over the middle door: a frame, a
    // black ground and three characters in bronze.
    const pzP = -(pz + 0.8);
    const PWd = 1.9;
    const PHt = 0.78;
    const gBot = underAt("-z", 0, pz + 0.55) - 0.22;
    const pyC = gBot - 0.03 - PHt / 2;
    for (const e of [-1, 1]) sb.box(0.05, 0.08, 0.3, e * 0.6, gBot - 0.03, -(pz + 0.68), BRONZE);
    sb.box(PWd - 0.1, PHt - 0.1, 0.05, 0, pyC, pzP, SUMI);
    for (const e of [-1, 1]) {
      sb.box(PWd, 0.09, 0.09, 0, pyC + e * (PHt / 2 - 0.045), pzP - 0.02, HINOKI);
      sb.box(0.09, PHt, 0.09, e * (PWd / 2 - 0.045), pyC, pzP - 0.02, HINOKI);
    }
    for (let g = 0; g < 3; g++) {
      const gx = (g - 1) * 0.56;
      for (let k = 0; k < 6; k++) {
        const horiz = rnd() < 0.5;
        const len = 0.14 + rnd() * 0.28;
        const x = gx + (rnd() - 0.5) * (horiz ? 0.2 : 0.34);
        const y = pyC + (rnd() - 0.5) * (horiz ? 0.4 : 0.2);
        sb.box(horiz ? len : 0.045, horiz ? 0.045 : len, 0.02, x, y, pzP - 0.035, BRONZE, { z: (rnd() - 0.5) * 0.5 });
      }
    }
    // The curtain along the front under the head tie, the temple's mark in each bay.
    const cz = -(pz + 0.28);
    const cyC = KN0 - 0.3;
    b.translucentBox(2 * px + 0.5, 0.58, 0.02, 0, cyC, cz, NOREN, TRANSLUCENCY.awning);
    sb.box(2 * px + 0.7, 0.04, 0.04, 0, KN0 - 0.02, cz, SUMI);
    for (let i = 0; i < colsX; i++) {
      const bx = -px + ((i + 0.5) / colsX) * px * 2;
      const r = 0.17;
      for (const [sx, sy] of CORNERS) sb.box(r * Math.SQRT2 + 0.03, 0.045, 0.012, bx + (sx * r) / 2, cyC + (sy * r) / 2, cz - 0.017, PAPER, { z: (-sx * sy * Math.PI) / 4 });
      sb.box(0.06, 0.06, 0.012, bx, cyC, cz - 0.017, PAPER, { z: Math.PI / 4 });
    }
    // The gong before the middle door on a bronze arm, and the rope to ring it by.
    const gz = -(pz + 0.5);
    const gy = KN0 - 0.95;
    sb.box(0.05, 0.05, 0.42, 0, KN0 + 0.1, -(pz + 0.3), BRONZE);
    for (const e of [-1, 1]) sb.box(0.02, KN0 + 0.08 - (gy + 0.4), 0.02, e * 0.18, (KN0 + 0.08 + gy + 0.4) / 2, gz, SUMI);
    b.cyl(0.24, 0.88, 0.88, 16, 0, gy, gz, BRONZE, { x: Math.PI / 2 });
    b.cyl(0.26, 0.3, 0.3, 12, 0, gy, gz, BRONZE, { x: Math.PI / 2 });
    sb.box(0.7, 0.05, 0.03, 0, gy - 0.15, gz - 0.13, SUMI);
    rope(
      b,
      [
        [0, gy - 0.46, gz - 0.06],
        [0.03, gy - 1.6, gz - 0.1],
        [-0.02, gy - 2.7, gz - 0.12],
        [0.02, F0 + 1.05, gz - 0.14],
      ],
      0.08,
      0.07,
      KAYA,
      6,
    );
    for (const e of [-1, 1]) b.translucentBox(0.1, 0.9, 0.012, e * 0.07, F0 + 1.4, gz - 0.2, NOREN, TRANSLUCENCY.awning);
    // Bronze lanterns hung in the veranda, two at the front and at the back on most.
    const lanternAt = (lx: number, lz: number): void => {
      const hy = soffit(lx, lz);
      const cy = PLATE - 0.4;
      sb.box(0.02, hy - (cy + 0.5), 0.02, lx, (hy + cy + 0.5) / 2, lz, BRONZE);
      b.cyl(0.18, 0.12, 0.66, 6, lx, cy + 0.44, lz, BRONZE);
      b.cyl(0.06, 0.46, 0.46, 6, lx, cy - 0.3, lz, BRONZE);
      b.cyl(0.14, 0.24, 0.42, 6, lx, cy - 0.4, lz, BRONZE);
      for (let k = 0; k < 6; k++) {
        const ang = (k / 6) * Math.PI * 2;
        sb.box(0.04, 0.6, 0.04, lx + Math.sin(ang) * 0.22, cy + 0.02, lz + Math.cos(ang) * 0.22, BRONZE);
      }
      for (const dy of [-0.18, 0.2]) b.cyl(0.03, 0.47, 0.47, 6, lx, cy + dy, lz, BRONZE);
      if (lit) b.glow(0.3, 0.52, 0.3, lx, cy + 0.02, lz, SHOJI_GLOW);
      else b.cyl(0.52, 0.34, 0.34, 6, lx, cy + 0.02, lz, PAPER);
    };
    // In the bay nearest a quarter of the way along the front, either side.
    let lx = 0;
    for (let i = 0; i < colsX; i++) {
      const c = Math.abs(-px + ((i + 0.5) / colsX) * px * 2);
      if (Math.abs(c - w / 4) < Math.abs(lx - w / 4)) lx = c;
    }
    for (const e of [-1, 1]) {
      const x = e * lx;
      lanternAt(x, -(pz - 0.55));
      if (backLanterns) lanternAt(x, pz - 0.55);
    }
  }

  // --- the tiles: round-tile rows, end tiles, the ridges and demon tiles ------------
  {
    const RSP = 0.5;
    const RH = 0.13;
    const segLen = 1.0;
    const topAt = (x: number, z: number): number => roofHeight(roof, x, z);
    const row = (s: Side, u: number, n0: number, n1: number): void => {
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
        member(a, c, 0.17, RH, KAWARA_DARK, HIDE_UNDER | START | (last ? 0 : END));
        if (last) endFace(a, c, 0.19, 0.19, KAWARA_DARK);
      }
    };
    // The eave tiles' lip along every eave, swept up with the corners.
    for (const s of SIDES) {
      const half = runsAlongX(s) ? ex : ez;
      const nEave = runsAlongX(s) ? ez : ex;
      const NL = 16;
      const pt = (i: number): Point3 => {
        const [x, z] = at(s, -half + (2 * half * i) / NL, nEave);
        return [x, topAt(x, z) - 0.02, z];
      };
      for (let i = 0; i < NL; i++) member(pt(i), pt(i + 1), 0.06, 0.12, KAWARA_DARK, (i > 0 ? START : 0) | (i < NL - 1 ? END : 0));
    }
    for (const s of SIDES) {
      const along = runsAlongX(s) ? ex : ez;
      const nEave = runsAlongX(s) ? ez : ex;
      const K = Math.floor((along - 0.3) / RSP - 0.5);
      for (let k = -K - 1; k <= K; k++) {
        const u = (k + 0.5) * RSP;
        const n0 = runsAlongX(s) && Math.abs(u) <= rx - 0.1 ? 0.36 : nHip(s, u) + 0.2;
        row(s, u, n0, nEave + 0.02);
      }
    }
    // The main ridge: a base, courses banded in white, a round cap, a demon tile each end.
    const RL = 2 * rx + 0.7;
    const ry0 = eave + RISE - 0.06;
    sb.box(RL, 0.36, 0.86, 0, ry0 - 0.12, 0, KAWARA_DARK, undefined, HIDE_UNDER);
    let ridgeY = ry0 + 0.06;
    for (let i = 0; i < 4; i++) {
      const depth = 0.78 - i * 0.07;
      sb.box(RL, 0.11, depth, 0, ridgeY + 0.055, 0, KAWARA_DARK, undefined, HIDE_UNDER);
      ridgeY += 0.11;
      if (i < 3) {
        sb.box(RL - 0.05, 0.035, depth - 0.06, 0, ridgeY + 0.0175, 0, SHIKKUI, undefined, HIDE_UNDER);
        ridgeY += 0.035;
      }
    }
    b.cyl(RL, 0.4, 0.4, 8, 0, ridgeY + 0.12, 0, KAWARA_DARK, { z: Math.PI / 2 });
    /** A demon tile of scale `k` standing at `p0`, turned to `yaw`. */
    const oni = (p0: Point3, yaw: number, k: number): void => {
      sb.box(0.5 * k, 0.6 * k, 0.14 * k, p0[0], p0[1] + 0.3 * k, p0[2], KAWARA_DARK, { y: yaw });
      sb.box(0.34 * k, 0.32 * k, 0.22 * k, p0[0], p0[1] + 0.3 * k, p0[2], KAWARA_DARK, { y: yaw });
      sb.box(0.16 * k, 0.16 * k, 0.12 * k, p0[0], p0[1] + 0.66 * k, p0[2], KAWARA_DARK, { y: yaw, z: Math.PI / 4 });
      for (const e of [-1, 1]) {
        const c = Math.cos(yaw);
        const sn = Math.sin(yaw);
        sb.box(0.1 * k, 0.3 * k, 0.1 * k, p0[0] + e * 0.2 * k * c, p0[1] + 0.68 * k, p0[2] - e * 0.2 * k * sn, KAWARA_DARK, { y: yaw, z: -e * 0.35 });
      }
    };
    for (const sx of [-1, 1]) {
      oni([sx * (RL / 2 + 0.04), ry0 - 0.2, 0], Math.PI / 2, 1.9);
      sb.box(0.3, 0.3, 0.3, sx * (RL / 2 - 0.2), ridgeY + 0.35, 0, KAWARA_DARK, { y: Math.PI / 4 });
    }
    /** A ridge from `a` to `c`: a body, a white band and a cap. */
    const ridgeRun = (a: Point3, c: Point3): void => {
      const up = (p0: Point3, dy: number): Point3 => [p0[0], p0[1] + dy, p0[2]];
      member(up(a, 0.13), up(c, 0.13), 0.44, 0.3, KAWARA_DARK, HIDE_UNDER | START | END);
      member(up(a, 0.12), up(c, 0.12), 0.48, 0.035, SHIKKUI, START | END | TOP | HIDE_UNDER);
      member(up(a, 0.34), up(c, 0.34), 0.26, 0.14, KAWARA_DARK, HIDE_UNDER | START | END);
    };
    for (const [sx, sz] of CORNERS) {
      const Hp = (f: number, lift: number): Point3 => {
        const x = sx * (rx + f * (ex - rx));
        const z = sz * f * ez;
        return [x, topAt(x, z) + lift, z];
      };
      const f0 = 0.05;
      const fOni = 1 - 1.0 / Math.hypot(ex - rx, ez);
      const nr = 6;
      for (let j = 0; j < nr; j++) ridgeRun(Hp(f0 + ((fOni - f0) * j) / nr, 0), Hp(f0 + ((fOni - f0) * (j + 1)) / nr, 0));
      oni(Hp(fOni + 0.01, 0), Math.atan2(sx * (ex - rx), sz * ez), 1.3);
      const a = Hp(fOni + 0.02, 0.08);
      const c = Hp(1.0, 0.08);
      member(a, c, 0.26, 0.2, KAWARA_DARK, HIDE_UNDER | START);
      endFace(a, c, 0.28, 0.24, KAWARA_DARK);
    }
  }

  sb.flush(b);

  // --- the cores, emitted after what hides them ------------------------------------
  for (const [cx, len, open] of segs) {
    if (open) b.box(len, wallH - doorH, t, cx, plinthH + doorH + (wallH - doorH) / 2, fz, SUMI);
    else b.box(len, wallH, t, cx, wy, fz, SUMI);
  }
  b.box(w, wallH, t, 0, wy, d / 2 - t / 2, SUMI);
  for (const sx of [-1, 1] as const) {
    const x = sx * (w / 2 - t / 2);
    for (const sz of [-1, 1]) b.box(t, wallH, side, x, wy, sz * (1.2 + side / 2), SUMI);
    b.box(t, wallH - doorH, 2.4, x, plinthH + doorH + (wallH - doorH) / 2, 0, SUMI);
  }
  // The walls over the plate, up into the roof: one surface, cut to the soffit.
  {
    const m = new Mesher();
    for (const s of SIDES) {
      const L = faceLen(s);
      const nP = Math.max(4, Math.round(L / 0.6));
      const P = (u: number, n: number, y: number): V3 => {
        const [x, z] = at(s, u, n);
        return [x, y, z];
      };
      const hTop = (u: number): number => {
        const [x, z] = at(s, u, wallFace(s) - t / 2);
        return soffit(x, z) + 0.12;
      };
      const out: V3 = runsAlongX(s) ? [0, 0, outward(s)] : [outward(s), 0, 0];
      const back: V3 = [-out[0], 0, -out[2]];
      for (let i = 0; i < nP; i++) {
        const ua = -L / 2 + (L * i) / nP;
        const uc = -L / 2 + (L * (i + 1)) / nP;
        const o = wallFace(s);
        const n = wallFace(s) - t;
        m.quad(P(ua, o, top), P(uc, o, top), P(uc, o, hTop(uc)), P(ua, o, hTop(ua)), out);
        m.quad(P(ua, n, top), P(uc, n, top), P(uc, n, hTop(uc)), P(ua, n, hTop(ua)), back);
        m.quad(P(ua, n, hTop(ua)), P(uc, n, hTop(uc)), P(uc, o, hTop(uc)), P(ua, o, hTop(ua)), [0, 1, 0]);
      }
    }
    b.surface(m.data(), SUMI);
  }
  b.box(w * 0.4, 1.0, 2.2, 0, plinthH + 0.5, d / 2 - 2.0, SUMI);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) b.cyl(wallH, 0.5, 0.52, 10, sx * w * 0.22, wy, sz * d * 0.18, HINOKI);
  }
  b.box(pw - 0.02, F0 - 0.05 - foot, pd - 0.02, 0, (F0 - 0.05 + foot) / 2, 0, GRANITE_DARK);

  // --- the roof: the lining under the rafters, then the sheet ---------------------------
  curvedRoof(b, CEDAR, { ...roof, raise: -TH - 0.004, thick: 0.02 });
  curvedRoof(b, KAWARA, roof);
  b.light("#ffb45a", 14, 1.2, 0.08, 0, plinthH + 2.6, d / 2 - 3.2);
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
 * 寺, "temple" — the last character of every temple's name — as strokes in
 * glyph units, x to the right and y up in the square ±0.5: a gate's plaque
 * ends in it and its lantern carries it.
 */
const TERA: readonly (readonly [number, number, number, number])[] = [
  [-0.26, 0.36, 0.26, 0.36],
  [0, 0.5, 0, 0.16],
  [-0.42, 0.16, 0.42, 0.16],
  [-0.48, -0.04, 0.48, -0.04],
  [0.18, 0.1, 0.18, -0.46],
  [0.18, -0.46, 0.04, -0.37],
  [-0.24, -0.17, -0.12, -0.29],
];

/**
 * The CARPENTRY of a small temple building under a curved tiled HIP — the
 * words the temple gate and the bell tower both build with, and why they
 * are here rather than in either builder: members laid on a face or from
 * point to point, a beam's slant-cut end, a bracket's arm, bearing blocks and
 * small blocks, purlins cut to the rafters over them, two layers of rafters
 * under a board lining, the hip beams with their wind bells, and the tiles —
 * round-tile rows on an eave lip, a ridge banded in white with a demon tile
 * at each end, and a hip ridge down each corner.
 *
 * Everything is cut to one `RoofSpec`, a hip whose ridge runs along X
 * (`tx` its half length, `tz` 0), through `roofHeight`, so a rafter hangs
 * under the lining and a tile lies on the sheet wherever the sheet is. The
 * laid members go into `sb`, which the builder flushes when it has emitted
 * what they hide; the slant-cut ends, the arms, the bells and the ridge's
 * round cap are parts of their own, emitted as they are called, exactly as
 * they were when this was the gate's own closures.
 */
class Joinery {
  readonly sb = new StoneBatch();
  /** The ridge's half length, and the eave ring's half extents. */
  readonly rx: number;
  readonly ex: number;
  readonly ez: number;
  /** A base rafter's depth, a flying rafter's, and a purlin's. */
  readonly RB = 0.15;
  readonly RF = 0.12;
  readonly KD = 0.26;

  constructor(
    private readonly b: Build,
    private readonly color: string,
    readonly roof: RoofSpec,
  ) {
    this.rx = roof.tx;
    this.ex = roof.ex;
    this.ez = roof.ez;
  }

  /** Plan point `n` out from the centre on side `s`, `u` along it. */
  at = (s: Side, u: number, n: number): [number, number] => (runsAlongX(s) ? [u, outward(s) * n] : [outward(s) * n, u]);

  /** A member centred `out` off plane `plane` of side `s`. */
  on = (s: Side, plane: number, u: number, y: number, along: number, tall: number, thick: number, out: number, c: string, tilt = 0, hide = 0): void =>
    this.sb.onFace(s, plane, u, y, along, tall, thick, out, c, tilt, 0, hide);

  member = (a: Point3, c: Point3, wide: number, deep: number, col: string, hide = 0): void => {
    const o = orient(a, c);
    this.sb.box(wide, deep, o.len, o.mid[0], o.mid[1], o.mid[2], col, o.rot, hide);
  };

  /** An end face 1.5 cm past `c`, square to the member from `a` — a tile's, or a rafter's paint. */
  endFace = (a: Point3, c: Point3, wide: number, deep: number, col: string): void => {
    const o = orient(a, c);
    const k = 0.015 / o.len;
    this.sb.box(wide, deep, 0.01, c[0] + (c[0] - a[0]) * k, c[1] + (c[1] - a[1]) * k, c[2] + (c[2] - a[2]) * k, col, o.rot, 63 & ~J_END);
  };

  /**
   * A beam's end run on past a post, its underside cut up on a slant to the
   * tip (a kibana): from `a0` along the beam's axis for `len` the way `sgn`
   * says, the beam centred `c` across it.
   */
  nose = (alongX: boolean, c: number, a0: number, sgn: number, len: number, yb: number, yt: number, th: number): void => {
    const a1 = a0 + sgn * len;
    const prof = (q: number): Point3[] => {
      const P = (a: number, y: number): Point3 => (alongX ? [a, y, q] : [q, y, a]);
      return [P(a0, yb), P(a1 - sgn * 0.14, yb), P(a1, yb + (yt - yb) * 0.45), P(a1, yt), P(a0, yt)];
    };
    convexSolid(this.b, prof(c - th / 2), prof(c + th / 2), this.color);
  };

  /** A bracket arm (hijiki): a beam `len` long centred at `uc` along its axis, its ends' undersides rounded up. */
  arm = (alongX: boolean, uc: number, c: number, len: number, yb: number, yt: number, th: number): void => {
    const dy = yt - yb;
    const L = len / 2;
    const prof = (q: number): Point3[] => {
      const P = (a: number, y: number): Point3 => (alongX ? [uc + a, y, q] : [q, y, uc + a]);
      return [P(-L, yt), P(L, yt), P(L, yt - dy * 0.45), P(L - 0.16, yb), P(-L + 0.16, yb), P(-L, yt - dy * 0.45)];
    };
    convexSolid(this.b, prof(c - th / 2), prof(c + th / 2), this.color);
  };

  /** A bearing block of `size` on a post head at (x, z), from `y0` to `y1`. */
  block = (x: number, z: number, size: number, y0: number, y1: number): void => {
    this.sb.box(size, y1 - y0 - 0.04, size, x, (y0 + y1 - 0.04) / 2, z, this.color, undefined, HIDE_UNDER);
    this.sb.box(size - 0.08, 0.04, size - 0.08, x, y1 - 0.02, z, this.color, undefined, HIDE_UNDER);
  };

  /** Three small blocks along an arm, from `y0` to `y1`. */
  makito = (alongX: boolean, x: number, z: number, spread: number, y0: number, y1: number): void => {
    for (const du of [-spread, 0, spread]) {
      if (alongX) this.sb.box(0.22, y1 - y0, 0.22, x + du, (y0 + y1) / 2, z, this.color, undefined, J_TOP);
      else this.sb.box(0.22, y1 - y0, 0.22, x, (y0 + y1) / 2, z + du, this.color, undefined, J_TOP);
    }
  };

  /** The underside of the board lining, which the rafters hang under. */
  soffit = (x: number, z: number): number => roofHeight(this.roof, x, z, true) - 0.03;

  /** The underside of the base rafters over (u, n) on side `s`. */
  underAt = (s: Side, u: number, n: number): number => {
    const [x, z] = this.at(s, u, n);
    return this.soffit(x, z) - this.RB;
  };

  /** Where the hip crosses the row `u` of side `s`, as a distance out from the centre. */
  nHip = (s: Side, u: number): number => {
    const { rx, ex, ez } = this;
    return runsAlongX(s) ? (ez * (Math.abs(u) - rx)) / (ex - rx) : ex - ((ex - rx) * (ez - Math.abs(u))) / ez;
  };

  /**
   * A purlin along side `s`, `n` out and `half` either way, its top at
   * `top(u)` — cut to the rafters over it, so it follows the eave where the
   * hip comes down over its run-on end.
   */
  purlin = (s: Side, n: number, half: number, top: (u: number) => number): void => {
    const NS = 8;
    const KD = this.KD;
    for (let i = 0; i < NS; i++) {
      const ua = -half + (2 * half * i) / NS;
      const uc = -half + (2 * half * (i + 1)) / NS;
      const [xa, za] = this.at(s, ua, n);
      const [xc, zc] = this.at(s, uc, n);
      this.member([xa, top(ua) - KD / 2, za], [xc, top(uc) - KD / 2, zc], 0.24, KD, this.color, (i > 0 ? J_START : 0) | (i < NS - 1 ? J_END : 0));
    }
  };

  /**
   * A frog-leg strut (kaerumata) in the middle of side `s`'s bay, `n` out: a
   * sill on the tie at `y0`, two splayed legs with a boss between them, a
   * block, and an arm under the purlin whose underside is `y1`.
   */
  frogLeg = (s: Side, n: number, y0: number, y1: number): void => {
    const { on, color } = this;
    const legH = (y1 - y0) * 0.5;
    on(s, n, 0, y0 + 0.05, 0.86, 0.1, 0.18, 0, color, 0, J_TOP);
    for (const e of [-1, 1]) on(s, n, e * 0.24, y0 + 0.1 + legH / 2, 0.1, legH, 0.15, 0, color, e * 0.62);
    on(s, n, 0, y0 + 0.1 + legH * 0.42, 0.18, 0.24, 0.11, 0, color);
    const yb = y0 + 0.1 + legH;
    on(s, n, 0, yb + 0.06, 0.42, 0.12, 0.2, 0, color);
    on(s, n, 0, yb + 0.12 + (y1 - 0.2 - yb - 0.12) / 2, 0.24, y1 - 0.2 - yb - 0.12, 0.22, 0, color, 0, J_TOP);
    this.arm(runsAlongX(s), 0, outward(s) * n, 1.1, y1 - 0.2, y1, 0.2);
  };

  /**
   * The eave's rafters in two layers on every side: the base rafters from
   * `from` out (or the hip) to 0.9 past the side's purlin line `purlinAt(s)`,
   * the flying rafters from 0.7 past it to the eave, their ends painted white.
   */
  rafters = (purlinAt: (s: Side) => number, from = 0.14): void => {
    const { ex, ez } = this;
    for (const s of J_SIDES) {
      const along = runsAlongX(s) ? ex : ez;
      const nEave = runsAlongX(s) ? ez : ex;
      const N = purlinAt(s);
      const nB = N + 0.9;
      const nF = N + 0.7;
      const SP = 0.32;
      const K = Math.floor((along - 0.15) / SP);
      for (let k = -K; k <= K; k++) {
        const u = k * SP;
        const n0 = Math.max(from, this.nHip(s, u) + 0.12);
        const lay = (na: number, nc: number, wide: number, deep: number, cap: string | null): void => {
          if (nc - na < 0.15) return;
          const [xa, za] = this.at(s, u, na);
          const [xc, zc] = this.at(s, u, nc);
          const a: Point3 = [xa, this.soffit(xa, za) - deep / 2, za];
          const c: Point3 = [xc, this.soffit(xc, zc) - deep / 2, zc];
          this.member(a, c, wide, deep, this.color, J_TOP | J_START);
          if (cap) this.endFace(a, c, wide + 0.01, deep + 0.01, cap);
        };
        lay(n0, nB, 0.12, this.RB, null);
        lay(Math.max(nF, n0), nEave - 0.04, 0.1, this.RF, SHIKKUI);
      }
    }
  };

  /** A hip beam into each corner, its end capped in bronze and a wind bell hung from it. */
  hipBeams = (): void => {
    const { rx, ex, ez, sb } = this;
    J_CORNERS.forEach(([sx, sz]) => {
      const H = (f: number, deep: number): Point3 => {
        const x = sx * (rx + f * (ex - rx));
        const z = sz * f * ez;
        return [x, this.soffit(x, z) - deep / 2, z];
      };
      this.member(H(0.03, 0.3), H(0.82, 0.3), 0.26, 0.3, this.color, J_TOP | J_START);
      const a = H(0.74, 0.24);
      const c = H(0.995, 0.24);
      this.member(a, c, 0.22, 0.24, this.color, J_TOP | J_START);
      this.endFace(a, c, 0.24, 0.26, BRONZE);
      const [bx, by0, bz] = c;
      const by = by0 - 0.12;
      sb.box(0.025, 0.16, 0.025, bx, by - 0.08, bz, BRONZE);
      this.b.cyl(0.28, 0.12, 0.22, 8, bx, by - 0.3, bz, BRONZE);
      sb.box(0.02, 0.16, 0.02, bx, by - 0.52, bz, BRONZE);
      sb.box(0.13, 0.2, 0.012, bx, by - 0.7, bz, BRONZE, { y: Math.atan2(sx, sz) + Math.PI / 2 });
    });
  };

  /**
   * The tiles: round-tile rows, end tiles, the eave lip, the ridges and the
   * demon tiles. A pyramid (`tx` 0) has no main `ridge`, and whoever builds
   * one caps its apex instead.
   */
  tiles = (ridge = true): void => {
    const { roof, rx, ex, ez, sb, member, endFace, at } = this;
    const eave = roof.y;
    const RSP = 0.42;
    const RH = 0.12;
    const segLen = 0.9;
    const topAt = (x: number, z: number): number => roofHeight(roof, x, z);
    const row = (s: Side, u: number, n0: number, n1: number): void => {
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
        member(a, c, 0.15, RH, KAWARA_DARK, HIDE_UNDER | J_START | (last ? 0 : J_END));
        if (last) endFace(a, c, 0.17, 0.17, KAWARA_DARK);
      }
    };
    // The eave tiles' lip along every eave, swept up with the corners.
    for (const s of J_SIDES) {
      const half = runsAlongX(s) ? ex : ez;
      const nEave = runsAlongX(s) ? ez : ex;
      const NL = 14;
      const pt = (i: number): Point3 => {
        const [x, z] = at(s, -half + (2 * half * i) / NL, nEave);
        return [x, topAt(x, z) - 0.02, z];
      };
      for (let i = 0; i < NL; i++) member(pt(i), pt(i + 1), 0.05, 0.11, KAWARA_DARK, (i > 0 ? J_START : 0) | (i < NL - 1 ? J_END : 0));
    }
    for (const s of J_SIDES) {
      const along = runsAlongX(s) ? ex : ez;
      const nEave = runsAlongX(s) ? ez : ex;
      const K = Math.floor((along - 0.3) / RSP - 0.5);
      for (let k = -K - 1; k <= K; k++) {
        const u = (k + 0.5) * RSP;
        const n0 = runsAlongX(s) && Math.abs(u) <= rx - 0.1 ? 0.32 : this.nHip(s, u) + 0.2;
        row(s, u, n0, nEave + 0.02);
      }
    }
    /** A demon tile of scale `k` standing at `p0`, turned to `yaw`. */
    const oni = (p0: Point3, yaw: number, k: number): void => {
      sb.box(0.5 * k, 0.6 * k, 0.14 * k, p0[0], p0[1] + 0.3 * k, p0[2], KAWARA_DARK, { y: yaw });
      sb.box(0.34 * k, 0.32 * k, 0.22 * k, p0[0], p0[1] + 0.3 * k, p0[2], KAWARA_DARK, { y: yaw });
      sb.box(0.16 * k, 0.16 * k, 0.12 * k, p0[0], p0[1] + 0.66 * k, p0[2], KAWARA_DARK, { y: yaw, z: Math.PI / 4 });
      const c = Math.cos(yaw);
      const sn = Math.sin(yaw);
      for (const e of [-1, 1]) {
        sb.box(0.1 * k, 0.3 * k, 0.1 * k, p0[0] + e * 0.2 * k * c, p0[1] + 0.68 * k, p0[2] - e * 0.2 * k * sn, KAWARA_DARK, { y: yaw, z: -e * 0.35 });
      }
    };
    if (ridge) {
      // The main ridge: a base, courses banded in white, a round cap, a demon tile each end.
      const RL = 2 * rx + 0.6;
      const ry0 = eave + roof.rise - 0.05;
      sb.box(RL, 0.32, 0.72, 0, ry0 - 0.1, 0, KAWARA_DARK, undefined, HIDE_UNDER);
      let ridgeY = ry0 + 0.06;
      for (let i = 0; i < 3; i++) {
        const depth = 0.64 - i * 0.07;
        sb.box(RL, 0.1, depth, 0, ridgeY + 0.05, 0, KAWARA_DARK, undefined, HIDE_UNDER);
        ridgeY += 0.1;
        if (i < 2) {
          sb.box(RL - 0.05, 0.03, depth - 0.06, 0, ridgeY + 0.015, 0, SHIKKUI, undefined, HIDE_UNDER);
          ridgeY += 0.03;
        }
      }
      this.b.cyl(RL, 0.32, 0.32, 8, 0, ridgeY + 0.1, 0, KAWARA_DARK, { z: Math.PI / 2 });
      for (const sx of [-1, 1]) {
        oni([sx * (RL / 2 + 0.04), ry0 - 0.16, 0], Math.PI / 2, 1.5);
        sb.box(0.24, 0.24, 0.24, sx * (RL / 2 - 0.2), ridgeY + 0.3, 0, KAWARA_DARK, { y: Math.PI / 4 });
      }
    }
    /** A ridge from `a` to `c`: a body, a white band and a cap. */
    const ridgeRun = (a: Point3, c: Point3): void => {
      const up = (p0: Point3, dy: number): Point3 => [p0[0], p0[1] + dy, p0[2]];
      member(up(a, 0.12), up(c, 0.12), 0.38, 0.26, KAWARA_DARK, HIDE_UNDER | J_START | J_END);
      member(up(a, 0.11), up(c, 0.11), 0.42, 0.03, SHIKKUI, J_START | J_END | J_TOP | HIDE_UNDER);
      member(up(a, 0.3), up(c, 0.3), 0.22, 0.12, KAWARA_DARK, HIDE_UNDER | J_START | J_END);
    };
    for (const [sx, sz] of J_CORNERS) {
      const Hp = (f: number, lift: number): Point3 => {
        const x = sx * (rx + f * (ex - rx));
        const z = sz * f * ez;
        return [x, topAt(x, z) + lift, z];
      };
      const f0 = 0.06;
      const fOni = 1 - 0.8 / Math.hypot(ex - rx, ez);
      const nr = 4;
      for (let j = 0; j < nr; j++) ridgeRun(Hp(f0 + ((fOni - f0) * j) / nr, 0), Hp(f0 + ((fOni - f0) * (j + 1)) / nr, 0));
      oni(Hp(fOni + 0.01, 0), Math.atan2(sx * (ex - rx), sz * ez), 1.05);
      const a = Hp(fOni + 0.02, 0.07);
      const c = Hp(1.0, 0.07);
      member(a, c, 0.22, 0.18, KAWARA_DARK, HIDE_UNDER | J_START);
      endFace(a, c, 0.24, 0.22, KAWARA_DARK);
    }
  };

  /** The roof itself: the board lining the rafters hang under, then the sheet. */
  sheet = (): void => {
    const TH = this.roof.thick ?? 0.3;
    curvedRoof(this.b, CEDAR, { ...this.roof, raise: -TH - 0.004, thick: 0.02 });
    curvedRoof(this.b, KAWARA, this.roof);
  };
}

/** The four sides and the four corners, in the order `Joinery` walks them. */
const J_SIDES: readonly Side[] = ["-z", "+z", "-x", "+x"];
const J_CORNERS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
] as const;
/** The faces a member laid from `a` to `c` along its own Z may hide. */
const J_TOP = 1 << 2;
const J_START = 1 << 5;
const J_END = 1 << 4;

/**
 * The TEMPLE GATE — the SHIKYAKUMON, the "four-legged gate" an Edo temple
 * sets in its precinct wall: two great pillars in the wall's line carrying
 * the ridge, four lesser posts before and behind them carrying the eaves, and
 * a plastered side bay either way for the precinct wall to run into. It is
 * the one door into Koyo-ji, and everybody who takes the flag in there comes
 * through it or over the wall beside it.
 *
 * **It was a plaster box with a doorway cut through it under one smooth grey
 * hip**: a plank slab where the brackets should be and a slotted block for a
 * ridge. What makes a gate one is that it is ALL frame and nothing hides it —
 * there is no ceiling, so everything overhead is looked up at by everyone who
 * walks through — and that is where this spends its vertices:
 *
 * - **The base** is a granite platform: a kerb of dressed stones round it,
 *   carried down to the ground, flags laid in running bond inside it, and a
 *   granite step before and behind the passage.
 * - **The posts**: the two main pillars are round, on granite bases, in
 *   bronze root sleeves; the four lesser posts are chamfered square on bases
 *   of their own. Paper pilgrim slips (senja-fuda) are pasted up them.
 * - **The frame**: a tie through the posts along each row and through each
 *   post line, its ends run on past the posts and cut on a slant; the main
 *   row's head beam runs on over the side bays. On each lesser post a
 *   bracket set — a bearing block, an arm, three small blocks, a second arm
 *   — carries the eave purlin, and a frog-leg strut stands in the middle of
 *   the front and back bays. On each main pillar a cambered beam runs out to
 *   both purlins, and a king strut braced on it carries the ridge beam. Each
 *   side bay's end post carries an outrigger that the purlins' ends and an
 *   end purlin rest on, and a hip beam runs into each corner with a wind bell
 *   hung at its end.
 * - **The eave** is two layers of rafters, base and flying, their ends
 *   painted white, under a board lining — seen whole from underneath.
 * - **The roof** is the hip it always was, tiled in rows of round tiles on an
 *   eave lip, under a ridge banded in white with a demon tile at each end and
 *   a hip ridge down each corner ending on its own.
 * - **The side bays** are plaster in a frame of sill, waist rail and head
 *   rails over a skirt of boards, with a barred window (renji) in the front;
 *   on the back, the gate's two plank leaves stand folded back flat against
 *   them.
 * - **The front** hangs the temple's name on a framed plaque before the
 *   frog-leg strut, and the passage hangs a great paper lantern (chōchin)
 *   under the main row's head beam, its foot 2.4 m over the platform.
 *
 * `tint` recolours the timber (vermilion for a shrine, cypress for a temple —
 * the default); the plaster, the stone and the tile stay what they are. It is
 * in `CONFORMS_TO_TERRAIN`: the stones' and flags' lengths, the plaque's
 * first two characters (the third is always 寺, as the lantern's is) and
 * the pilgrim slips are seeded off where it stands, and the platform and
 * both steps are carried down to the ground.
 *
 * **The colliders are the ones it always had, in the same order**: the six
 * posts and each side bay (its retired `wall` spelled out as a block), then
 * the roof slab at the eave. Everything drawn obeys the kit's three rules:
 * the skirt, the rails, the window and the folded leaves are on a side bay's
 * face (none more than 0.13 m proud); the platform and the steps are under
 * 0.3 m; the bases hug their posts; and everything from the ties up is
 * overhead — the lowest, the ties through the post lines, clear the platform
 * by 3.4 m, and the lantern by 2.4.
 */
export function buildTempleGate(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "sanmon");
  const opening = 4.6;
  const wing = 2.4;
  const w = opening + wing * 2;
  const d = 4.2;
  const h = 4.6;
  const color = p.tint ?? HINOKI;

  // --- colliders, exactly as they were: the posts and each wing (the old
  // `wall` call), then the roof slab at the eave.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 0, 1]) {
      const x = (sx * opening) / 2;
      const z = (sz * (d - 0.8)) / 2;
      const dia = sz === 0 ? 0.62 : 0.44;
      b.block({ w: dia * 0.85, h, d: dia * 0.85, x, y: h / 2, z });
    }
    const wx = sx * (opening / 2 + wing / 2);
    b.block({ w: wing, h: h - 0.4, d: 0.5, x: wx, y: (h - 0.4) / 2, z: 0 });
  }
  const eave = h + 0.45;
  const ex = w / 2 + 1.3;
  const ez = d / 2 + 1.5;
  b.block({ w: ex * 2, h: 0.3, d: ez * 2, x: 0, y: eave, z: 0 });

  // --- everything below is drawing -------------------------------------------
  const rnd = mulberry32(streetSeed(w, d, h, ctx));
  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };
  /** The post lines, the front and back rows, and each side bay's end post. */
  const XP = opening / 2;
  const ZP = (d - 0.8) / 2;
  const XE = w / 2 - 0.15;
  /** The platform: its half extents and its top. */
  const PX = w / 2 + 0.15;
  const PZ = d / 2;
  const PT = 0.3;
  let foot = 0;
  for (const gx of [-1, -0.5, 0, 0.5, 1]) {
    for (const gz of [-1, 0, 1]) foot = Math.min(foot, ground(gx * PX, gz * PZ));
  }
  foot -= 0.08;

  // --- the roof's own geometry, which everything under and on it is cut to ------
  const RISE = 2.9;
  const TH = 0.32;
  const rx = w / 2 - 1.0;
  const roof: RoofSpec = { y: eave, ex, ez, tx: rx, tz: 0, rise: RISE, curve: 1.6, upturn: 0.55, thick: TH, rings: 6, seg: 8 };
  const j = new Joinery(b, color, roof);
  const { sb, at, on, member, nose, arm, block, underAt, KD } = j;
  // A member laid from `a` to `c` along its own Z hides these faces.
  const TOP = 1 << 2;
  // --- the heights of the frame --------------------------------------------------
  /** The ties along each post line, and along the front and back rows. */
  const ZT0 = h - 0.88;
  const ZT1 = h - 0.6;
  const NK0 = h - 0.58;
  const NK1 = h - 0.28;
  /** The main row's head beam, over the side bays too. */
  const MB0 = h - 0.38;
  const MB1 = h - 0.02;
  /** A bracket set, from the post's head up: block, arm, small blocks; the second arm is cut to its purlin. */
  const DAI = h + 0.22;
  const ARM1 = DAI + 0.18;
  const MAK = ARM1 + 0.13;
  /** The eave purlins' underside along the front and back rows. */
  const ketaBot = (s: Side, u: number): number => underAt(s, u, ZP) - KD;
  /** The end purlins, carried on each side bay's outrigger. */
  const XEP = XE + 0.15;
  const endBot = (s: Side, u: number): number => underAt(s, u, XEP) - KD;

  // --- the platform: a kerb of dressed stones, flags inside it, the two steps ----
  {
    const KW = 0.24;
    const kerb = (s: Side, run: number): void => {
      const plane = runsAlongX(s) ? PZ : PX;
      let u = -run;
      while (run - u > 0.05) {
        let len = 0.8 + rnd() * 0.6;
        if (run - (u + len) < 0.45) len = run - u;
        const c = u + len / 2;
        const [gx, gz] = at(s, c, plane);
        const yb = Math.min(foot, ground(gx, gz) - 0.1);
        on(s, plane, c, (yb + PT) / 2, len - 0.02, PT - yb, KW, -KW / 2 + 0.02, GRANITE, 0, hideBack(s));
        u += len;
      }
    };
    kerb("-z", PX + 0.02);
    kerb("+z", PX + 0.02);
    kerb("-x", PZ - KW + 0.02);
    kerb("+x", PZ - KW + 0.02);
    // The flags, in running bond across the passage, not laid under the side bays.
    const rows = Math.round((2 * (PZ - KW)) / 0.55);
    const rw = (2 * (PZ - KW)) / rows;
    for (let r = 0; r < rows; r++) {
      const z = -(PZ - KW) + (r + 0.5) * rw;
      const cuts: [number, number][] = Math.abs(z) < 0.25 + rw / 2 ? [[-PX, -XP], [XP, PX]] : [];
      for (const [a, c] of carve(-(PX - KW + 0.02), PX - KW + 0.02, cuts)) {
        let x = a + (r % 2 ? 0.35 : 0);
        if (r % 2) sb.box(0.33, 0.06, rw - 0.02, a + 0.165, PT - 0.03, z, GRANITE, undefined, HIDE_UNDER);
        while (c - x > 0.05) {
          let len = 0.7 + rnd() * 0.5;
          if (c - (x + len) < 0.35) len = c - x;
          sb.box(len - 0.02, 0.06, rw - 0.02, x + len / 2, PT - 0.03, z, GRANITE, undefined, HIDE_UNDER);
          x += len;
        }
      }
    }
    // A step before and behind the passage, its stones carried to the ground.
    for (const sz of [-1, 1]) {
      const z = sz * (PZ + 0.27);
      const sTop = PT / 2;
      const sBot = Math.min(foot, ground(0, z) - 0.05);
      let u = -1.9;
      while (1.9 - u > 0.05) {
        let len = 1.1 + rnd() * 0.7;
        if (1.9 - (u + len) < 0.6) len = 1.9 - u;
        sb.box(len - 0.02, 0.1, 0.5, u + len / 2, sTop - 0.05, z, GRANITE, undefined, HIDE_UNDER);
        u += len;
      }
      b.box(3.76, sTop - 0.1 - sBot, 0.46, 0, (sTop - 0.1 + sBot) / 2, z, GRANITE_DARK);
    }
  }

  // --- the posts: bases, root sleeves, the pilgrims' slips -------------------------
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 0, 1]) {
      const x = sx * XP;
      const z = sz * ZP;
      const main = sz === 0;
      const r = main ? 0.31 : 0.22 * Math.cos(Math.PI / 8);
      if (main) {
        b.cyl(0.12, 0.9, 0.96, 12, x, PT + 0.06, z, GRANITE);
        b.cyl(0.3, 0.68, 0.7, 12, x, PT + 0.27, z, BRONZE);
        b.cyl(0.04, 0.72, 0.72, 12, x, PT + 0.4, z, BRONZE);
      } else {
        b.cyl(0.1, 0.66, 0.72, 8, x, PT + 0.05, z, GRANITE, { y: Math.PI / 8 });
        b.cyl(0.2, 0.5, 0.5, 8, x, PT + 0.2, z, BRONZE, { y: Math.PI / 8 });
      }
      const n = Math.floor(rnd() * 4.2);
      for (let k = 0; k < n; k++) {
        let ang = rnd() * Math.PI * 2;
        if (!main) ang = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
        const y = 1.3 + rnd() * 1.4;
        sb.box(0.075, 0.21, 0.006, x + Math.sin(ang) * (r + 0.004), y, z + Math.cos(ang) * (r + 0.004), PAPER, { y: ang, z: (rnd() - 0.5) * 0.14 });
      }
    }
    // The side bay's end post, capping the plaster.
    sb.box(0.3, h - PT, 0.6, sx * XE, (PT + h) / 2, 0, color, undefined, HIDE_UNDER);
  }

  // --- the ties and the head beam ------------------------------------------------
  for (const sz of [-1, 1]) {
    // Along each row, through the lesser posts, run on past them.
    const z = sz * ZP;
    sb.box(2 * XP, NK1 - NK0, 0.2, 0, (NK0 + NK1) / 2, z, color);
    for (const sx of [-1, 1]) nose(true, z, sx * XP, sx, 0.5, NK0, NK1, 0.2);
  }
  for (const sx of [-1, 1]) {
    // Along each post line, through all three, run on past the front and back.
    const x = sx * XP;
    sb.box(0.2, ZT1 - ZT0, 2 * ZP, x, (ZT0 + ZT1) / 2, 0, color);
    for (const sz of [-1, 1]) nose(false, x, sz * ZP, sz, 0.5, ZT0, ZT1, 0.2);
  }
  sb.box(w, MB1 - MB0, 0.3, 0, (MB0 + MB1) / 2, 0, color);

  // --- the bracket sets and the purlins -------------------------------------------
  // On each lesser post: a block, an arm along the row, small blocks, a second arm under the purlin.
  for (const [sx, sz] of J_CORNERS) {
    const s: Side = sz < 0 ? "-z" : "+z";
    const x = sx * XP;
    const z = sz * ZP;
    block(x, z, 0.44, h, DAI);
    arm(true, x, z, 1.2, DAI, ARM1, 0.2);
    j.makito(true, x, z, 0.42, ARM1, MAK);
    arm(true, x, z, 1.8, MAK, ketaBot(s, x), 0.2);
  }
  // On each side bay's end post: a block, the outrigger along Z, and over its
  // ends and middle the second arms under the purlins.
  for (const sx of [-1, 1]) {
    const x = sx * XE;
    const se: Side = sx < 0 ? "-x" : "+x";
    block(x, 0, 0.36, h, DAI);
    sb.box(0.24, MAK - DAI, 2 * ZP, x, (DAI + MAK) / 2, 0, color, undefined, TOP);
    for (const sz of [-1, 1]) {
      nose(false, x, sz * ZP, sz, 0.42, DAI, MAK, 0.24);
      arm(true, x - sx * 0.2, sz * ZP, 1.0, MAK, ketaBot(sz < 0 ? "-z" : "+z", x), 0.2);
    }
    arm(false, 0, x + sx * 0.08, 1.4, MAK, endBot(se, 0), 0.2);
  }
  // The eave purlins along the front and back, and the end purlins along the
  // ends.
  for (const s of ["-z", "+z"] as const) j.purlin(s, ZP, XEP + 0.28, (u) => underAt(s, u, ZP));
  for (const s of ["-x", "+x"] as const) j.purlin(s, XEP, ZP + 0.24, (u) => underAt(s, u, XEP));

  // --- the frog-leg struts over the front and back bays ------------------------------
  for (const s of ["-z", "+z"] as const) j.frogLeg(s, ZP, NK1, ketaBot(s, 0));

  // --- the main pillars: the cambered beams, the king struts, the ridge beam -------
  const ridgeBot = underAt("-z", 0, 0) - 0.3;
  for (const sx of [-1, 1]) {
    const x = sx * XP;
    block(x, 0, 0.56, h, h + 0.26);
    const y0 = h + 0.26;
    const y1 = y0 + 0.4;
    const zE = ZP + 0.12;
    member([x, (y0 + y1) / 2, -zE], [x, (y0 + y1) / 2 + 0.07, 0], 0.24, y1 - y0, color, J_END);
    member([x, (y0 + y1) / 2 + 0.07, 0], [x, (y0 + y1) / 2, zE], 0.24, y1 - y0, color, J_START);
    for (const sz of [-1, 1]) nose(false, x, sz * zE, sz, 0.3, y0, y1, 0.24);
    // The king strut, braced from the beam, a block and an arm under the ridge beam.
    const sTop = ridgeBot - 0.34;
    const sBot = y1 + 0.07;
    sb.box(0.22, sTop - sBot, 0.22, x, (sTop + sBot) / 2, 0, color);
    for (const sz of [-1, 1]) member([x, sBot, sz * 0.62], [x, sBot + 0.62, sz * 0.1], 0.14, 0.14, color);
    block(x, 0, 0.34, sTop, sTop + 0.18);
    arm(false, 0, x, 1.2, sTop + 0.18, ridgeBot, 0.2);
  }
  sb.box(2 * rx + 0.1, 0.3, 0.26, 0, ridgeBot + 0.15, 0, color, undefined, TOP);

  // --- the eave: rafters in two layers, the hip beams, the wind bells ---------------
  j.rafters((s) => (runsAlongX(s) ? ZP : XEP));
  j.hipBeams();

  // --- the side bays: sill, rails, skirt, the window; the leaves folded back -------
  {
    const WF = 0.25;
    for (const sx of [-1, 1]) {
      const mid = sx * (XP + wing / 2);
      const a = XP + 0.32;
      const c = XE - 0.15;
      const uc = (sx * (a + c)) / 2;
      const uw = c - a;
      for (const s of ["-z", "+z"] as const) {
        const f = (u: number, y: number, along: number, tall: number, thick: number, out: number, col: string, tilt = 0): void =>
          on(s, WF, u, y, along, tall, thick, out, col, tilt, hideBack(s));
        f(mid, PT + 0.08, wing, 0.16, 0.1, 0.05, color);
        f(mid, 3.71, wing, 0.18, 0.1, 0.05, color);
        f(mid, MB0 - 0.08, wing, 0.14, 0.08, 0.04, color);
        if (s === "-z") {
          // A skirt of lapped boards under the waist rail.
          const nb = Math.max(3, Math.round(uw / 0.26));
          for (let k = 0; k < nb; k++) {
            f(uc - uw / 2 + ((k + 0.5) * uw) / nb, (PT + 0.16 + 1.35) / 2, uw / nb - 0.01, 1.35 - PT - 0.16, 0.03, 0.02 + (k % 2) * 0.014, color);
          }
          f(mid, 1.42, wing, 0.14, 0.1, 0.05, color);
          // The barred window: a dark ground, bars turned on the diagonal, a frame.
          const WW = 1.1;
          const WH = 1.25;
          const wy = 2.62;
          f(uc, wy, WW, WH, 0.02, 0.01, SUMI);
          const nBar = Math.round(WW / 0.12);
          for (let k = 1; k < nBar; k++) {
            sb.onFace(s, WF, uc - WW / 2 + (WW * k) / nBar, wy, 0.05, WH, 0.05, 0.04, color, 0, Math.PI / 4, TOP | HIDE_UNDER);
          }
          for (const e of [-1, 1]) f(uc + e * (WW / 2 + 0.05), wy, 0.1, WH + 0.2, 0.1, 0.05, color);
          f(uc, wy + WH / 2 + 0.05, WW, 0.1, 0.1, 0.05, color);
          f(uc, wy - WH / 2 - 0.06, WW + 0.24, 0.12, 0.13, 0.065, color);
        } else {
          // The leaf, folded back flat against the bay: boards on a dark
          // ground, battens across them studded in bronze, a stile each edge,
          // straps at the hinge and a ring pull.
          const y0 = PT + 0.17;
          const y1 = 3.6;
          const ym = (y0 + y1) / 2;
          f(uc, ym, uw, y1 - y0, 0.02, 0.02, SUMI);
          const nb = 5;
          for (let k = 0; k < nb; k++) f(uc - uw / 2 + ((k + 0.5) * uw) / nb, ym, uw / nb - 0.012, y1 - y0, 0.03, 0.045 + (k % 2) * 0.008, color);
          for (const e of [-1, 1]) f(uc + e * (uw / 2 - 0.05), ym, 0.1, y1 - y0, 0.05, 0.075, color);
          for (const fy of [0.08, 0.37, 0.64, 0.92]) {
            const y = y0 + (y1 - y0) * fy;
            f(uc, y, uw - 0.2, 0.12, 0.05, 0.085, color);
            for (let k = 0; k < nb; k++) f(uc - uw / 2 + ((k + 0.5) * uw) / nb, y, 0.045, 0.045, 0.02, 0.12, BRONZE);
          }
          const hinge = sx * a;
          for (const fy of [0.08, 0.92]) f(hinge + sx * 0.22, y0 + (y1 - y0) * fy, 0.42, 0.08, 0.02, 0.12, BRONZE);
          const pull = sx * (c - 0.28);
          b.cyl(0.02, 0.16, 0.16, 10, pull, y0 + (y1 - y0) * 0.5, WF + 0.12, BRONZE, { x: Math.PI / 2 });
          f(pull, y0 + (y1 - y0) * 0.5 + 0.09, 0.05, 0.05, 0.03, 0.115, BRONZE);
        }
      }
    }
  }

  // --- the plaque on the front, the lantern in the passage -----------------------
  {
    const PW = 0.9;
    const PHt = 0.94;
    const pzP = -(ZP + 0.3);
    const pyC = NK1 + 0.02 + PHt / 2;
    const kb = ketaBot("-z", 0);
    for (const e of [-1, 1]) {
      sb.box(0.05, kb - (pyC + PHt / 2) + 0.02, 0.04, e * 0.26, (kb + pyC + PHt / 2) / 2, pzP + 0.02, BRONZE);
      sb.box(0.05, 0.05, 0.2, e * 0.26, kb - 0.04, pzP + 0.14, BRONZE);
    }
    sb.box(PW - 0.1, PHt - 0.1, 0.05, 0, pyC, pzP, SUMI);
    for (const e of [-1, 1]) {
      sb.box(PW + 0.1, 0.1, 0.09, 0, pyC + e * (PHt / 2 - 0.02), pzP - 0.02, color);
      sb.box(0.1, PHt, 0.09, e * (PW / 2 - 0.02), pyC, pzP - 0.02, color);
    }
    // Three characters stacked down it in bronze, the temple's name ending in 寺.
    for (const [x0, y0, x1, y1] of TERA) {
      const S = 0.24;
      const len = Math.hypot(x1 - x0, y1 - y0) * S;
      const y = pyC - 0.27 + ((y0 + y1) / 2) * S;
      sb.box(len + 0.04, 0.04, 0.02, ((x0 + x1) / 2) * S, y, pzP - 0.035, BRONZE, { z: Math.atan2(y1 - y0, x1 - x0) });
    }
    for (let g = 0; g < 2; g++) {
      const gy = pyC + (1 - g) * 0.27;
      for (let k = 0; k < 5; k++) {
        const horiz = rnd() < 0.5;
        const len = 0.1 + rnd() * 0.2;
        const x = (rnd() - 0.5) * (horiz ? 0.16 : 0.34);
        const y = gy + (rnd() - 0.5) * (horiz ? 0.18 : 0.08);
        sb.box(horiz ? len : 0.04, horiz ? 0.04 : Math.min(len, 0.22), 0.02, x, y, pzP - 0.035, BRONZE, { z: (rnd() - 0.5) * 0.5 });
      }
    }
  }
  {
    // The great paper lantern, hung from the head beam over the passage: a
    // lacquered cap and foot, and between them paper on bamboo ribs, swelling
    // to its waist, with the temple's character 寺 painted on each face.
    const top = MB0;
    sb.box(0.04, 0.12, 0.04, 0, top - 0.06, 0, BRONZE);
    const capT = top - 0.12;
    b.cyl(0.12, 0.56, 0.62, 16, 0, capT - 0.06, 0, SUMI);
    /** The paper's profile, top to bottom: heights under the cap and diameters. */
    const prof: [number, number][] = [
      [0, 0.64],
      [0.2, 0.84],
      [0.5, 0.92],
      [0.8, 0.84],
      [1.0, 0.64],
    ];
    const b0 = capT - 0.12;
    const Y = (f: number): number => b0 - f * 1.1;
    for (let i = 0; i + 1 < prof.length; i++) {
      const [fa, da] = prof[i];
      const [fc, dc] = prof[i + 1];
      b.cyl(Y(fa) - Y(fc), da, dc, 16, 0, (Y(fa) + Y(fc)) / 2, 0, PAPER);
    }
    b.cyl(0.12, 0.62, 0.56, 16, 0, Y(1) - 0.06, 0, SUMI);
    /** The paper's radius at height `y`. */
    const radius = (y: number): number => {
      const f = Math.min(1, Math.max(0, (b0 - y) / 1.1));
      for (let i = 0; i + 1 < prof.length; i++) {
        const [fa, da] = prof[i];
        const [fc, dc] = prof[i + 1];
        if (f <= fc) return (da + ((dc - da) * (f - fa)) / (fc - fa)) / 2;
      }
      return prof[prof.length - 1][1] / 2;
    };
    // The ribs, a line round the paper every few centimetres.
    for (let k = 1; k < 12; k++) {
      const y = Y(k / 12);
      const dia = 2 * radius(y) + 0.008;
      b.cyl(0.012, dia, dia, 16, 0, y, 0, CEDAR);
    }
    // 寺, a stroke at a time, each laid on the paper in short pieces turned to
    // face out where they lie, so a stroke across the swell stays on it.
    const S = 0.54;
    const ym = Y(0.5);
    for (const sz of [-1, 1]) {
      for (const [x0, y0, x1, y1] of TERA) {
        // Seen from the back the character is mirrored in world X.
        const ax = -sz * x0 * S;
        const cx = -sz * x1 * S;
        const ay = ym + y0 * S;
        const cy = ym + y1 * S;
        const len = Math.hypot(cx - ax, cy - ay);
        const n = Math.max(1, Math.ceil(len / 0.07));
        const phi = Math.atan2(cy - ay, cx - ax);
        for (let k = 0; k < n; k++) {
          const f = (k + 0.5) / n;
          const x = ax + (cx - ax) * f;
          const y = ay + (cy - ay) * f;
          const r = radius(y);
          const z = Math.sqrt(Math.max(0, r * r - x * x)) - 0.004;
          sb.box(len / n + 0.012, 0.05, 0.03, x, y, sz * z, SUMI, { y: sz * Math.asin(x / r), z: phi });
        }
      }
    }
  }

  // --- the tiles: round-tile rows, end tiles, the ridges and demon tiles ------------
  j.tiles();

  sb.flush(b);

  // --- the cores, emitted after what hides them ------------------------------------
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 0, 1]) {
      const x = sx * XP;
      const z = sz * ZP;
      if (sz === 0) b.cyl(h - PT - 0.42, 0.6, 0.64, 12, x, (PT + 0.42 + h) / 2, z, color);
      else b.cyl(h - PT - 0.3, 0.44, 0.44, 8, x, (PT + 0.3 + h) / 2, z, color, { y: Math.PI / 8 });
    }
    b.box(wing, MB0 + 0.02, 0.5, sx * (opening / 2 + wing / 2), (MB0 + 0.02) / 2, 0, SHIKKUI);
  }
  b.box(2 * PX - 0.1, PT - 0.06 - foot, 2 * PZ - 0.1, 0, (PT - 0.06 + foot) / 2, 0, GRANITE_DARK);

  // --- the roof: the lining under the rafters, then the sheet ---------------------------
  j.sheet();
  return b;
}

/**
 * The BELL TOWER — a SHŌRŌ, the open bell house an Edo temple stands in its
 * precinct: four splayed posts on a stone platform under a tiled pyramid,
 * the great bronze bell hung in the middle and the striking log hung beside
 * it. After the hall and the pagoda it is the precinct's third silhouette,
 * and the one of the three a player walks under and looks up into.
 *
 * **It was four posts on a slab under a smooth grey hat**, with a bronze
 * tube for a bell and a slotted block for a ridge. It is drawn as one is
 * built:
 *
 * - **The platform (kidan)**: face stones in two courses carried down to the
 *   ground, a coping round the top, flags in running bond inside it, a step
 *   before the front and one on the side facing the hall, and maple leaves
 *   blown onto it.
 * - **The posts**: chamfered square cypress, splayed out toward the foot
 *   (uchikorobi) as a bell house's are, each on a round granite base in a
 *   bronze root sleeve.
 * - **The frame**: a flying tie through the posts each way — the two at
 *   different heights, so they pass — and a head tie over them, every end run
 *   on and cut on a slant; a bracket set both ways on every post head; a
 *   frog-leg strut in the middle of every side; and between the head tie and
 *   the purlins a band of white plaster (kokabe) the brackets are half buried
 *   in, as a temple's are.
 * - **Inside**: a coffered ceiling, black ribs over cedar boards inside a
 *   cornice, and under it the bell beam resting on the side head ties.
 * - **The eave and the roof**: two layers of rafters under a board lining,
 *   hip beams with wind bells, and a PYRAMID (hōgyō) of round-tile rows on an
 *   eave lip with a hip ridge and a demon tile down each corner, capped by a
 *   bronze dew basin, an inverted bowl and the jewel. **It is a pyramid and
 *   not a hip because the plan is square**: `curvedRoof` lerps its rings, so
 *   a ridge over a square plan pitches its ends steeper than its sides and no
 *   purlin under them can run level.
 * - **The bell (bonshō)**: cast with a rolled lip, its upper, middle and
 *   lower bands and the four vertical ones (kesa-dasuki); eighty nipples
 *   (chi) in four framed panels under the upper band; a lotus striking seat
 *   (tsukiza) either side where the middle band crosses a vertical one; and a
 *   crown (ryūzu) of two dragons back to back with the jewel between them,
 *   hung on an iron hook from the bell beam.
 * - **The striking log (shumoku)**: bound in iron at both ends, hung level in
 *   two rope slings from the bell beam, its end tethered to a post with the
 *   tail of the rope run down the post's face; and on the front post a board
 *   of the hours under a little roof.
 *
 * It is in `CONFORMS_TO_TERRAIN`: the lengths of the stones, the flags and
 * the steps, where the leaves lie and the characters on the board are seeded
 * off where it stands, and the platform's face and both steps are carried
 * down to the ground.
 *
 * **The colliders are the ones it always had, in the same order**: the
 * platform, the four posts, the bell and the roof slab at the eave.
 * Everything drawn obeys the kit's three rules. The steps are under 0.3 m;
 * the bases, the sleeves and the board hug their posts; the rope's tail is
 * on a post's face. Everything between the posts is overhead: the lowest tie
 * clears the floor by 2.7 m and the log and its tether by 2.4, and the old
 * waist tie — a beam a metre over the floor between two posts, where nothing
 * stopped a body walking through it — is gone. The bell fills its box, and
 * the ceiling is drawn at the roof slab's underside, so a round fired
 * straight up inside stops on the ceiling it strikes.
 */
export function buildBellTower(scene: Scene, mats: CelMaterialFactory, _p: BuildParams = {}, ctx?: BuildCtx): Structure {
  const b = new Build(scene, mats, "shoro");
  const plinthH = 0.55;
  const postH = 4.4;
  const bellY = plinthH + postH - 1.9;
  const eave = plinthH + postH + 0.1;

  // --- colliders, exactly as they were: the platform, the posts, the bell, the roof slab.
  b.block({ w: 5.2, h: plinthH, d: 5.2, x: 0, y: plinthH / 2, z: 0 });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * 1.55;
      const z = sz * 1.55;
      b.block({ w: 0.36, h: postH, d: 0.36, x, y: plinthH + postH / 2, z });
    }
  }
  b.block({ w: 1.1, h: 1.7, d: 1.1, x: 0, y: bellY, z: 0 });
  b.block({ w: 6.6, h: 0.3, d: 6.6, x: 0, y: eave, z: 0 });

  // --- everything below is drawing -------------------------------------------
  const rnd = mulberry32(streetSeed(5.2, 5.2, postH, ctx));
  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };
  const color = HINOKI;
  /** The floor, and the platform's half width. */
  const F = plinthH;
  const P = 2.6;
  let foot = 0;
  for (const gx of [-1, -0.5, 0, 0.5, 1]) {
    for (const gz of [-1, -0.5, 0, 0.5, 1]) foot = Math.min(foot, ground(gx * (P + 0.5), gz * (P + 0.5)));
  }
  foot -= 0.08;

  const roof: RoofSpec = { y: eave, ex: 3.3, ez: 3.3, tx: 0, tz: 0, rise: 2.5, curve: 1.6, upturn: 0.55, thick: 0.24, rings: 6, seg: 8 };
  const j = new Joinery(b, color, roof);
  const { sb, at, on, member, nose, arm, block, underAt, KD } = j;
  const lap = new Lapidary(1);
  const TOP = 1 << 2;

  // --- the heights of the frame ---------------------------------------------------
  /** The post line at the head: the purlins, the plaster and the brackets stand on it. */
  const N = 1.5;
  /** The posts' drawn head; the bearing blocks stand on it. */
  const PTOP = 4.6;
  /** Where a post's axis stands at height `y`: 10 cm further out at the floor than at the head. */
  const postAt = (y: number): number => N + (0.1 * (PTOP - y)) / (PTOP - F);
  /** A post's half width at height `y`, tapering a centimetre to its head. */
  const halfAt = (y: number): number => 0.16 - (0.01 * (y - F)) / (PTOP - F);
  const BASE = F + 0.1;
  /** The flying ties, along X and (lower, to pass them) along Z; then the head ties. */
  const XT0 = 3.52;
  const XT1 = 3.72;
  const ZT0 = 3.28;
  const ZT1 = 3.48;
  const KT0 = 4.32;
  const KT1 = 4.56;
  /** A bracket set: block, arm, small blocks; the second arm is cut to its purlin. */
  const DAI = PTOP + 0.2;
  const ARM1 = DAI + 0.16;
  const MAK = ARM1 + 0.12;
  /** A purlin's underside along side `s`, held level past the corner posts. */
  const clampU = (u: number): number => Math.max(-N, Math.min(N, u));
  const ketaBot = (s: Side, u: number): number => underAt(s, clampU(u), N) - KD;
  /** The roof slab's underside, which the ceiling is drawn at. */
  const CEIL = eave - 0.15;
  /** The bell beam, on the side head ties. */
  const BB0 = KT1;
  const BB1 = KT1 + 0.28;
  /** The plaster's inner face. */
  const C = N - 0.07;

  // --- the platform: two courses of face stones, a coping, flags, two steps --------
  {
    const KW = 0.22;
    const CW = 0.34;
    /** A course of face stones along side `s`, `run` either way, from `y0` (the ground, if null) to `y1`. */
    const course = (s: Side, run: number, y0: number | null, y1: number, first: number): void => {
      let u = -run;
      let len = first;
      while (run - u > 0.05) {
        if (run - (u + len) < 0.45) len = run - u;
        const c = u + len / 2;
        let yb = y0 ?? 0;
        if (y0 === null) {
          const [gx, gz] = at(s, c, P);
          yb = Math.min(foot, ground(gx, gz) - 0.1);
        }
        on(s, P, c, (yb + y1) / 2, len - 0.02, y1 - yb, KW, -KW / 2, GRANITE, 0, hideBack(s));
        u += len;
        len = 0.8 + rnd() * 0.6;
      }
    };
    /** The coping along side `s`, `run` either way, standing 3 cm proud of the face. */
    const coping = (s: Side, run: number): void => {
      let u = -run;
      while (run - u > 0.05) {
        let len = 0.9 + rnd() * 0.5;
        if (run - (u + len) < 0.5) len = run - u;
        on(s, P, u + len / 2, F - 0.0375, len - 0.02, 0.075, CW, -CW / 2 + 0.03, GRANITE, 0, HIDE_UNDER);
        u += len;
      }
    };
    for (const s of J_SIDES) {
      const run = runsAlongX(s) ? P : P - KW;
      course(s, run, null, 0.29, 0.8 + rnd() * 0.6);
      course(s, run, 0.31, 0.455, 0.35 + rnd() * 0.4);
      coping(s, runsAlongX(s) ? P + 0.03 : P + 0.03 - CW);
    }
    // The flags inside the coping, in running bond.
    const IN = P + 0.03 - CW;
    const rows = 10;
    const rw = (2 * IN) / rows;
    for (let r = 0; r < rows; r++) {
      const z = -IN + (r + 0.5) * rw;
      let x = -IN;
      let len = r % 2 ? 0.3 + rnd() * 0.3 : 0.6 + rnd() * 0.4;
      while (IN - x > 0.05) {
        if (IN - (x + len) < 0.35) len = IN - x;
        sb.box(len - 0.02, 0.06, rw - 0.02, x + len / 2, F - 0.03, z, GRANITE, undefined, HIDE_UNDER);
        x += len;
        len = 0.6 + rnd() * 0.4;
      }
    }
    // A step before the front and on the side toward the hall: two stones
    // on a darker core carried down to the ground.
    const flat =
      (y: number) =>
      (f: number, u: number, w: number): V3 => [f, y + w, u];
    for (const s of ["-z", "-x"] as const) {
      const top = 0.29;
      const split = -0.95 + 0.7 + rnd() * 0.5;
      for (const [a, c] of [
        [-0.95, split],
        [split, 0.95],
      ]) {
        on(s, P, (a + c) / 2, top - 0.05, c - a - 0.02, 0.1, 0.46, 0.23, GRANITE, 0, HIDE_UNDER);
      }
      let bot = foot;
      for (const u of [-0.9, 0, 0.9]) {
        const [gx, gz] = at(s, u, P + 0.4);
        bot = Math.min(bot, ground(gx, gz) - 0.05);
      }
      const [cx, cz] = at(s, 0, P + 0.23);
      b.box(runsAlongX(s) ? 1.86 : 0.42, top - 0.1 - bot, runsAlongX(s) ? 0.42 : 1.86, cx, (top - 0.1 + bot) / 2, cz, GRANITE_DARK);
      {
        const [lx, lz] = at(s, (rnd() - 0.5) * 1.6, P + 0.1 + rnd() * 0.26);
        lap.leaf(rnd, flat(top), 1, lx, lz, 0.04 + rnd() * 0.02, rnd() * TAU, -0.002);
      }
    }
    // Leaves blown in over the flags.
    for (let k = 0; k < 9; k++) {
      const lx = (rnd() * 2 - 1) * (IN - 0.12);
      const lz = (rnd() * 2 - 1) * (IN - 0.12);
      lap.leaf(rnd, flat(F), 1, lx, lz, 0.045 + rnd() * 0.02, rnd() * TAU, -0.002);
    }
  }

  // --- the posts' bases and root sleeves --------------------------------------------
  /** A chamfered square section of half width `h` round (cx, cz) at height `y`. */
  const oct = (cx: number, cz: number, y: number, h: number, ch: number): Point3[] => [
    [cx + h, y, cz - h + ch],
    [cx + h, y, cz + h - ch],
    [cx + h - ch, y, cz + h],
    [cx - h + ch, y, cz + h],
    [cx - h, y, cz + h - ch],
    [cx - h, y, cz - h + ch],
    [cx - h + ch, y, cz - h],
    [cx + h - ch, y, cz - h],
  ];
  /** Post (sx, sz)'s section at height `y`, grown by `grow`. */
  const section = (sx: number, sz: number, y: number, grow: number): Point3[] =>
    oct(sx * postAt(y), sz * postAt(y), y, halfAt(y) + grow, 0.04 + grow * 0.5);
  for (const [sx, sz] of J_CORNERS) {
    b.cyl(0.1, 0.56, 0.64, 12, sx * postAt(F), F + 0.05, sz * postAt(F), GRANITE);
    convexSolid(b, section(sx, sz, BASE, 0.03), section(sx, sz, BASE + 0.04, 0.03), BRONZE);
    convexSolid(b, section(sx, sz, BASE + 0.04, 0.018), section(sx, sz, BASE + 0.27, 0.018), BRONZE);
    convexSolid(b, section(sx, sz, BASE + 0.27, 0.03), section(sx, sz, BASE + 0.31, 0.03), BRONZE);
  }

  // --- the ties ----------------------------------------------------------------------
  /** A tie through the posts on both rows along X (or Z), run on past them and cut on a slant. */
  const tie = (alongX: boolean, y0: number, y1: number, run: number): void => {
    const c = postAt((y0 + y1) / 2);
    for (const e of [-1, 1]) {
      if (alongX) sb.box(2 * c, y1 - y0, 0.18, 0, (y0 + y1) / 2, e * c, color);
      else sb.box(0.18, y1 - y0, 2 * c, e * c, (y0 + y1) / 2, 0, color);
      for (const g of [-1, 1]) nose(alongX, e * c, g * c, g, run, y0, y1, 0.18);
    }
  };
  tie(true, XT0, XT1, 0.36);
  tie(false, ZT0, ZT1, 0.36);
  tie(true, KT0, KT1, 0.42);
  tie(false, KT0, KT1, 0.42);

  // --- the bracket sets, the purlins, the frog-leg struts, the plaster -------------
  for (const [sx, sz] of J_CORNERS) {
    const x = sx * N;
    const z = sz * N;
    const sX: Side = sz < 0 ? "-z" : "+z";
    const sZ: Side = sx < 0 ? "-x" : "+x";
    block(x, z, 0.42, PTOP, DAI);
    arm(true, x, z, 1.3, DAI, ARM1, 0.2);
    arm(false, z, x, 1.3, DAI, ARM1, 0.2);
    j.makito(true, x, z, 0.4, ARM1, MAK);
    j.makito(false, x, z, 0.4, ARM1, MAK);
    arm(true, x, z, 1.3, MAK, ketaBot(sX, x), 0.2);
    arm(false, z, x, 1.3, MAK, ketaBot(sZ, z), 0.2);
  }
  for (const s of J_SIDES) {
    j.purlin(s, N, N + 0.3, (u) => underAt(s, clampU(u), N));
    j.frogLeg(s, N, KT1, ketaBot(s, 0));
    // The plaster band, in strips so its head follows the purlin's sweep.
    const half = N - 0.21;
    const K = 5;
    for (let k = 0; k < K; k++) {
      const ua = -half + (2 * half * k) / K;
      const uc = ua + (2 * half) / K;
      const top = Math.max(ketaBot(s, ua), ketaBot(s, uc)) + 0.04;
      on(s, N, (ua + uc) / 2, (KT1 + top) / 2, uc - ua, top - KT1, 0.06, -0.04, SHIKKUI);
    }
  }

  // --- the ceiling and the bell beam --------------------------------------------------
  sb.box(2 * C, 0.02, 2 * C, 0, CEIL + 0.07, 0, CEDAR, undefined, TOP);
  {
    const cells = 6;
    for (let k = 0; k <= cells; k++) {
      const u = -C + 0.06 + ((2 * C - 0.12) * k) / cells;
      sb.box(0.06, 0.06, 2 * C, u, CEIL + 0.03, 0, SUMI, undefined, TOP);
      sb.box(2 * C, 0.06, 0.06, 0, CEIL + 0.03, u, SUMI, undefined, TOP);
    }
  }
  for (const s of J_SIDES) on(s, C, 0, CEIL + 0.02, 2 * C, 0.12, 0.1, -0.05, SUMI, 0, TOP);
  sb.box(2 * C, BB1 - BB0, 0.28, 0, (BB0 + BB1) / 2, 0, color);

  // --- the bell -------------------------------------------------------------------
  /** The lip, and the bell's profile over it: down the inside, round the lip, up the outside. */
  const Y0 = bellY - 0.85;
  const BELL: [number, number][] = [
    [0, 1.58],
    [0.3, 1.56],
    [0.42, 1.49],
    [0.455, 1.36],
    [0.462, 0.08],
    [0.472, 0],
    [0.545, 0],
    [0.556, 0.035],
    [0.556, 0.095],
    [0.532, 0.135],
    [0.518, 0.22],
    [0.506, 0.6],
    [0.5, 1.0],
    [0.497, 1.4],
    [0.49, 1.5],
    [0.462, 1.585],
    [0.4, 1.645],
    [0.3, 1.69],
    [0.16, 1.715],
    [0, 1.725],
  ];
  lap.lathe(
    BRONZE,
    BELL.map(([r, y]) => [r, Y0 + y]),
    32,
    0,
  );
  /** The body's radius `y` over the lip, from the lower band to the shoulder. */
  const BODY = BELL.slice(9, 15);
  const rAt = (y: number): number => {
    for (let i = 0; i + 1 < BODY.length; i++) {
      const [ra, ya] = BODY[i];
      const [rc, yc] = BODY[i + 1];
      if (y <= yc || i + 2 === BODY.length) return ra + ((rc - ra) * (y - ya)) / (yc - ya);
    }
    return BODY[0][0];
  };
  /** A band round the body from `y0` to `y1` over the lip, standing `proud`. */
  const band = (y0: number, y1: number, proud: number): void => {
    const r = rAt((y0 + y1) / 2);
    const prof: [number, number][] = [
      [r - 0.006, Y0 + y0],
      [r + proud, Y0 + y0],
      [r + proud, Y0 + y1],
      [r - 0.006, Y0 + y1],
    ];
    lap.lathe(BRONZE, prof, 32, 0);
  };
  band(0.14, 0.26, 0.022);
  band(0.835, 0.853, 0.016);
  band(0.885, 0.903, 0.016);
  band(1.12, 1.14, 0.014);
  band(1.38, 1.46, 0.022);
  /** A line down the body at bearing `a`, `u` round from it, from `y0` to `y1` over the lip. */
  const line = (a: number, u: number, y0: number, y1: number): void => {
    const ym = (y0 + y1) / 2;
    lap.onFace(a, rAt(ym), u, Y0 + ym, 0.006, 0.02, y1 - y0, 0.02, BRONZE);
  };
  for (let q = 0; q < 4; q++) {
    const a = (q * Math.PI) / 2;
    for (const [y0, y1] of [
      [0.26, 0.55],
      [0.55, 0.835],
      [0.903, 1.12],
      [1.14, 1.38],
    ]) {
      for (const e of [-1, 1]) line(a, e * 0.035, y0, y1);
    }
  }
  /**
   * A round boss on the body at bearing `a`, `y` high and `du` round from it:
   * `r0` at its foot, `r1` at its face, standing `h` out of a foot sunk
   * `sink` into the bronze.
   */
  const boss = (a: number, y: number, du: number, r0: number, r1: number, h: number, n: number, sink: number): void => {
    const m = lap.mesher(BRONZE);
    const R = rAt(y - Y0) - sink;
    const d: V3 = [Math.cos(a), 0, Math.sin(a)];
    const t: V3 = [-Math.sin(a), 0, Math.cos(a)];
    const c0: V3 = [R * d[0] + du * t[0], y, R * d[2] + du * t[2]];
    const Q = (r: number, off: number, k: number): V3 => {
      const ph = (k / n) * TAU;
      const ct = Math.cos(ph) * r;
      return [c0[0] + d[0] * off + t[0] * ct, c0[1] + Math.sin(ph) * r, c0[2] + d[2] * off + t[2] * ct];
    };
    const face: V3 = [c0[0] + d[0] * h, c0[1], c0[2] + d[2] * h];
    for (let k = 0; k < n; k++) {
      const ph = ((k + 0.5) / n) * TAU;
      const out: V3 = [t[0] * Math.cos(ph), Math.sin(ph), t[2] * Math.cos(ph)];
      m.quad(Q(r0, 0, k), Q(r0, 0, k + 1), Q(r1, h, k + 1), Q(r1, h, k), out);
      m.tri(face, Q(r1, h, k), Q(r1, h, k + 1), d);
    }
  };
  // The nipples: four panels of four rows of five under the upper band, each framed.
  for (let q = 0; q < 4; q++) {
    const a0 = Math.PI / 4 + (q * Math.PI) / 2;
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 5; col++) boss(a0 + (col - 2) * 0.14, Y0 + 1.175 + row * 0.05, 0, 0.02, 0.01, 0.034, 6, 0.004);
    }
    for (const e of [-1, 1]) line(a0 + e * 0.37, 0, 1.14, 1.38);
  }
  // The striking seats: a lotus on a disc where the middle band crosses a vertical one.
  for (const a of [0, Math.PI]) {
    const y = Y0 + 0.87;
    boss(a, y, 0, 0.125, 0.12, 0.04, 16, 0.018);
    for (let k = 0; k < 8; k++) {
      const ph = (k / 8) * TAU;
      boss(a, y + Math.sin(ph) * 0.078, Math.cos(ph) * 0.078, 0.03, 0.02, 0.05, 6, 0.012);
    }
    boss(a, y, 0, 0.045, 0.032, 0.066, 10, 0.004);
  }
  // The crown: a collar, two dragons' bodies arched back to back across the
  // bell, their heads biting the shoulder, and the jewel between them.
  const TOPY = Y0 + 1.725;
  lap.lathe(
    BRONZE,
    [
      [0, TOPY - 0.01],
      [0.21, TOPY - 0.01],
      [0.19, TOPY + 0.045],
      [0, TOPY + 0.045],
    ],
    16,
    0,
  );
  const loop: TubePoint[] = [[0.15, TOPY + 0.03, 0.07, 0.085]];
  for (let k = 0; k <= 10; k++) {
    const th = (k / 10) * Math.PI;
    loop.push([0.15 * Math.cos(th), TOPY + 0.07 + 0.24 * Math.sin(th), 0.07, 0.085]);
  }
  loop.push([-0.15, TOPY + 0.03, 0.07, 0.085]);
  lap.tube(BRONZE, loop, Math.PI / 2);
  for (const e of [-1, 1]) {
    lap.sb.box(0.12, 0.1, 0.16, 0, TOPY + 0.1, e * 0.21, BRONZE, { x: e * 0.35 });
    lap.sb.box(0.08, 0.06, 0.13, 0, TOPY + 0.055, e * 0.3, BRONZE, { x: e * 0.55 });
    lap.sb.box(0.1, 0.04, 0.1, 0, TOPY + 0.155, e * 0.19, BRONZE, { x: -e * 0.3 });
    for (const g of [-1, 1]) lap.sb.box(0.02, 0.13, 0.02, g * 0.04, TOPY + 0.2, e * 0.15, BRONZE, { x: -e * 0.55 });
  }
  lap.lathe(
    BRONZE,
    [
      [0, TOPY + 0.34],
      [0.045, TOPY + 0.35],
      [0.06, TOPY + 0.39],
      [0.05, TOPY + 0.43],
      [0.02, TOPY + 0.47],
      [0, TOPY + 0.49],
    ],
    10,
    0,
  );
  // The iron hook, down from a plate under the bell beam and through the crown.
  {
    const HX = 0.13;
    const hy = TOPY + 0.2425;
    sb.box(0.05, BB0 - 0.03 - hy, 0.05, HX, (BB0 - 0.03 + hy) / 2, 0, SUMI);
    sb.box(HX + 0.125, 0.05, 0.05, (HX - 0.1) / 2, hy, 0, SUMI);
    sb.box(0.05, 0.1, 0.05, -0.1, hy + 0.045, 0, SUMI);
    sb.box(0.2, 0.03, 0.3, HX, BB0 - 0.015, 0, SUMI);
  }

  // --- the striking log, its slings and its tether; the board of the hours --------
  {
    const LOG_Y = 3.08;
    const L0 = 0.62;
    const L1 = 1.95;
    b.cyl(L1 - L0, 0.24, 0.24, 8, (L0 + L1) / 2, LOG_Y, 0, CEDAR, { z: Math.PI / 2 });
    for (const x of [L0 + 0.06, L1 - 0.06]) b.cyl(0.05, 0.256, 0.256, 8, x, LOG_Y, 0, SUMI, { z: Math.PI / 2 });
    for (const x of [0.9, 1.3]) {
      b.cyl(0.05, 0.27, 0.27, 8, x, LOG_Y, 0, KAYA, { z: Math.PI / 2 });
      for (const e of [-1, 1]) member([x, LOG_Y + 0.1, e * 0.1], [x, BB0, e * 0.06], 0.035, 0.035, KAYA);
    }
    // The tether: from the log's end to the post on its right, twice round
    // it, and the tail run down the post's outer face to a knot.
    const pY = 2.99;
    const pc = postAt(pY);
    const ph = halfAt(pY) + 0.018;
    member([L1 - 0.1, LOG_Y - 0.05, -0.1], [pc, pY, -pc + ph], 0.035, 0.035, KAYA);
    for (const y of [pY, pY - 0.045]) {
      for (const e of [-1, 1]) {
        sb.box(2 * ph + 0.035, 0.035, 0.035, pc, y, -pc + e * ph, KAYA);
        sb.box(0.035, 0.035, 2 * ph + 0.035, pc + e * ph, y, -pc, KAYA);
      }
    }
    const tail = (y: number): Point3 => [postAt(y) + halfAt(y) + 0.018, y, -postAt(y) + 0.06];
    member(tail(pY - 0.06), tail(F + 1.3), 0.035, 0.035, KAYA);
    const [kx, ky, kz] = tail(F + 1.28);
    sb.box(0.06, 0.07, 0.06, kx, ky, kz, KAYA);
    sb.box(0.03, 0.14, 0.03, kx, ky - 0.1, kz, KAYA);

    // The board of the hours on the front of the front left post.
    const y0 = F + 1.05;
    const y1 = F + 1.7;
    const ym = (y0 + y1) / 2;
    const bx = -postAt(ym);
    const bz = -(postAt(ym) + halfAt(ym)) - 0.0085;
    sb.box(0.26, y1 - y0, 0.025, bx, ym, bz, CEDAR);
    for (const e of [-1, 1]) sb.box(0.17, 0.02, 0.07, bx + e * 0.068, y1 + 0.04, bz - 0.02, SUMI, { z: -e * 0.45 });
    const front = bz - 0.0145;
    // Two columns of brushed characters, the first of each larger: every
    // character a handful of strokes, some of them dots, none quite square.
    for (let col = 0; col < 2; col++) {
      for (let ch = 0; ch < 6; ch++) {
        const size = ch === 0 ? 0.07 : 0.045;
        const cy = y1 - 0.07 - (ch === 0 ? 0 : 0.03 + ch * 0.083);
        const cx = bx + (col === 0 ? 0.055 : -0.055);
        const strokes = 4 + Math.floor(rnd() * 3);
        for (let k = 0; k < strokes; k++) {
          const dot = rnd() < 0.2;
          const horiz = rnd() < 0.5;
          const len = dot ? 0.016 : size * (0.3 + rnd() * 0.7);
          const x = cx + (rnd() - 0.5) * (horiz ? size * 0.4 : size * 0.9);
          const y = cy + (rnd() - 0.5) * (horiz ? size * 0.9 : size * 0.4);
          const slant = dot ? 0.8 : (rnd() - 0.5) * 0.7;
          sb.box(horiz ? len : 0.009, horiz ? 0.009 : len, 0.004, x, y, front, SUMI, { z: slant });
        }
      }
    }
  }

  // --- the eave, the tiles and the finial -----------------------------------------------
  j.rafters(() => N, 1.35);
  j.hipBeams();
  j.tiles(false);
  {
    const A = eave + roof.rise;
    sb.box(0.62, 0.5, 0.62, 0, A - 0.05, 0, KAWARA_DARK, undefined, HIDE_UNDER);
    sb.box(0.56, 0.18, 0.56, 0, A + 0.29, 0, BRONZE, undefined, HIDE_UNDER);
    sb.box(0.62, 0.04, 0.62, 0, A + 0.4, 0, BRONZE, undefined, HIDE_UNDER);
    lap.lathe(
      BRONZE,
      [
        [0, A + 0.42],
        [0.22, A + 0.42],
        [0.21, A + 0.5],
        [0.16, A + 0.57],
        [0.08, A + 0.61],
        [0, A + 0.62],
      ],
      12,
      0,
    );
    lap.lathe(
      BRONZE,
      [
        [0, A + 0.61],
        [0.05, A + 0.62],
        [0.05, A + 0.66],
        [0.14, A + 0.69],
        [0.17, A + 0.76],
        [0.16, A + 0.84],
        [0.11, A + 0.92],
        [0.05, A + 0.99],
        [0, A + 1.04],
      ],
      12,
      0,
    );
  }

  sb.flush(b);
  lap.flush(b);

  // --- the cores, emitted after what hides them -----------------------------------------
  for (const [sx, sz] of J_CORNERS) convexSolid(b, section(sx, sz, BASE, 0), section(sx, sz, PTOP, 0), color);
  b.box(2 * (P - 0.05), F - 0.06 - foot, 2 * (P - 0.05), 0, (F - 0.06 + foot) / 2, 0, GRANITE_DARK);

  // --- the roof: the lining under the rafters, then the sheet ---------------------------
  j.sheet();
  return b;
}

/**
 * A GARDEN WALL — a TSUIJIBEI, the tiled-coped wall an Edo temple and a good
 * inn put round their ground. Runs along X for `length`, the same on both
 * faces, because a precinct wall is looked at from the street and the garden
 * alike.
 *
 * It is drawn as one is built. A course of dressed granite kerb stones, set
 * with open joints over a darker core, is carried down to the ground under
 * each stone. On it stands a timber-framed wall of plaster, a post at each
 * end and every three metres or so, with a head rail along the top of each
 * face. **What the plaster SAYS is its colour**: the ochre earthen wall
 * (`TSUCHI`, the default) is a temple's SUJIBEI, and carries five raised
 * white lines — the highest of the ranks — run between the posts; the white
 * lime wall (`SHIKKUI`) is a house's, and wears a skirt of dark boards under
 * battens with a drip rail over it instead. Over the head rail, rafters on
 * both faces carry a board lining and the coping: a sheet of tile laid with
 * round-tile rows, an end tile on each at the eave over a straight eave lip,
 * a ridge banded in white on a base course with a demon tile at each end,
 * and at each end of the run a gable — the wall head carried up to the
 * tiles in plaster under barge boards and a roll of verge tiles.
 *
 * **The collider is exactly what it was**: one box, `length` by `height` by
 * 0.8, and the plaster is now drawn at its faces (it stood 5 cm inside them).
 * Everything else obeys the kit's three rules: posts, lines, the skirt and the
 * stones are applied on a face; the coping stands on the collider's top; the
 * eave's lowest point clears 2.35 m on a default wall and lies 0.72 m out of
 * the centre line, inside the 0.8 m a body's radius keeps it from the face,
 * so nobody walks under it.
 *
 * It is in `CONFORMS_TO_TERRAIN`: the stones' lengths are seeded off where it
 * stands, and each stone runs down to the ground under it — a run laid across
 * a fall shows a deeper course at its low end rather than a gap.
 */
export function buildGardenWall(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "tsuijibei");
  const len = p.length ?? 12;
  const h = p.height ?? 2.4;
  const plaster = p.tint ?? TSUCHI;

  // --- the collider, exactly as it was ---------------------------------------------
  b.block({ w: len, h, d: 0.8, x: 0, y: h / 2, z: 0 });

  // --- everything below is drawing -------------------------------------------------
  const rnd = mulberry32(streetSeed(len, 0.8, h, ctx));
  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };
  const sb = new StoneBatch();
  const half = len / 2;
  /** The plaster's face, which is the collider's. */
  const FACE = 0.4;
  /** Top of the kerb course, where the plaster starts. */
  const BASE = 0.5;
  const SIDES_Z = [
    [-1, "-z"],
    [1, "+z"],
  ] as const;
  /** The end of a member laid down the slope on side `s` that is toward the ridge. */
  const inEnd = (s: number): number => (s < 0 ? 1 << 4 : 1 << 5);
  const TOP = 1 << 2;

  // --- the kerb course -----------------------------------------------------------
  // Dressed stones with a 2 cm joint, their faces 7.5 cm proud of the plaster
  // and 2.5 cm proud of a core behind them, so every joint is a step the ink
  // finds. An end stone turns each end of the run.
  const KERB = FACE + 0.075;
  const END_STONE = 0.14;
  let low = 0;
  for (const [s, side] of SIDES_Z) {
    let x = -half + END_STONE + 0.02;
    while (x < half - END_STONE - 0.3) {
      let l = 0.75 + rnd() * 0.6;
      if (half - END_STONE - 0.02 - (x + l) < 0.45) l = half - END_STONE - 0.02 - x;
      const x1 = x + l;
      const foot = Math.min(ground(x, s * KERB), ground(x1, s * KERB)) - 0.12;
      low = Math.min(low, foot);
      const top = BASE - 0.004 + (rnd() - 0.5) * 0.008;
      const out = (rnd() - 0.5) * 0.008;
      sb.box(l, top - foot, 0.12, x + l / 2, (top + foot) / 2, s * (KERB - 0.06 + out), GRANITE, undefined, (1 << 3) | hideBack(side));
      x = x1 + 0.02;
    }
  }
  for (const sx of [-1, 1]) {
    const foot = Math.min(ground(sx * half, -KERB), ground(sx * half, KERB)) - 0.12;
    low = Math.min(low, foot);
    sb.box(END_STONE, BASE - foot, KERB * 2, sx * (half - END_STONE / 2 + 0.005), (BASE + foot) / 2, 0, GRANITE, undefined, 1 << 3);
  }

  // --- the frame: posts and the head rail -------------------------------------------
  const bays = Math.max(1, Math.round(len / 3.3));
  const POST = 0.2;
  const posts: number[] = [];
  for (let i = 0; i <= bays; i++) posts.push(-half + (len * i) / bays);
  const wallH = h - BASE;
  const midY = BASE + wallH / 2;
  // The end posts are full depth and cap the plaster's end.
  for (const sx of [-1, 1]) {
    sb.box(POST, wallH, FACE * 2 + 0.07, sx * (half - POST / 2 + 0.005), midY, 0, SUMI, undefined, 1 << 3);
  }
  for (const [s, side] of SIDES_Z) {
    for (let i = 1; i < bays; i++) sb.onFace(side, FACE, posts[i], midY, POST, wallH, 0.035, 0.0175, SUMI, 0, 0, hideBack(side));
    // The head rail, on the plaster's top edge under the rafters.
    sb.box(len, 0.12, 0.1, 0, h + 0.06, s * (FACE + 0.02), SUMI, undefined, 1 << 3);
  }
  /** Each bay's clear run between post faces. */
  const bayRuns = posts.slice(0, -1).map((x0, i) => [x0 + POST / 2 + (i === 0 ? POST / 2 : 0), posts[i + 1] - POST / 2 - (i === bays - 1 ? POST / 2 : 0)] as const);

  if (plaster === TSUCHI) {
    // --- the five lines -------------------------------------------------------------
    for (const [, side] of SIDES_Z) {
      for (const [x0, x1] of bayRuns) {
        for (let i = 0; i < 5; i++) {
          sb.onFace(side, FACE, (x0 + x1) / 2, h - 0.34 - i * 0.13, x1 - x0, 0.045, 0.02, 0.01, SHIKKUI, 0, 0, hideBack(side));
        }
      }
    }
  } else {
    // --- the board skirt -----------------------------------------------------------
    const SKIRT = 0.85;
    for (const [, side] of SIDES_Z) {
      for (const [x0, x1] of bayRuns) {
        const u = (x0 + x1) / 2;
        const run = x1 - x0;
        sb.onFace(side, FACE, u, BASE + SKIRT / 2, run, SKIRT, 0.02, 0.01, SUMI, 0, 0, hideBack(side));
        const n = Math.max(1, Math.round(run / 0.45));
        for (let k = 1; k < n; k++) {
          sb.onFace(side, FACE, x0 + (run * k) / n, BASE + SKIRT / 2, 0.045, SKIRT, 0.02, 0.03, SUMI, 0, 0, hideBack(side) | (1 << 3));
        }
        sb.onFace(side, FACE, u, BASE + SKIRT + 0.03, run, 0.06, 0.05, 0.025, SUMI, 0, 0, hideBack(side));
      }
    }
  }

  // --- the coping -------------------------------------------------------------------
  // One pitch on both faces. `yTop(n)` is the tile sheet's top `n` out from
  // the centre line; `slope(s, n, lift)` is that point on side `s` lifted
  // `lift` along the sheet's normal.
  const E = 0.72;
  const OV = 0.12;
  const TAN = 0.45;
  const P = Math.atan(TAN);
  const cosP = Math.cos(P);
  const sinP = Math.sin(P);
  const SHEET = 0.08;
  const Y0 = h + 0.12 + E * TAN;
  const yTop = (n: number): number => Y0 - n * TAN;
  const slope = (s: number, n: number, lift: number): [number, number] => [yTop(n) + lift * cosP, s * (n + lift * sinP)];
  /** A member of section `wide` x `deep` laid down the slope on side `s` from `n0` to `n1`, its centre `lift` off the sheet. */
  const down = (s: number, x: number, n0: number, n1: number, lift: number, wide: number, deep: number, color: string, hide = 0): void => {
    const [y, z] = slope(s, (n0 + n1) / 2, lift);
    sb.box(wide, deep, (n1 - n0) / cosP, x, y, z, color, { x: s * P }, hide);
  };
  const RUN = len + OV * 2;
  const ROW = 0.28;
  const rows = Math.floor((RUN - 0.2) / ROW);
  const rowPitch = (RUN - 0.2) / rows;
  for (const [s] of SIDES_Z) {
    // Round-tile rows, each ending on an end tile, over a straight eave lip.
    for (let k = 0; k < rows; k++) {
      const x = -RUN / 2 + 0.1 + rowPitch * (k + 0.5);
      down(s, x, 0.14, E - 0.01, 0.035, 0.1, 0.08, KAWARA_DARK, (1 << 3) | (1 << 4) | (1 << 5));
      const [ey, ez] = slope(s, E - 0.015, 0.03);
      sb.box(0.13, 0.1, 0.04, x, ey, ez, KAWARA_DARK, { x: s * P }, (1 << 3) | inEnd(s));
    }
    const [ly, lz] = slope(s, E + 0.02, -0.01);
    sb.box(RUN + 0.02, 0.13, 0.04, 0, ly, lz, KAWARA_DARK, { x: s * P });
    // The verge: a roll of tiles down each end, and a barge board under it.
    for (const sx of [-1, 1]) {
      down(s, sx * (RUN / 2 - 0.05), 0.12, E + 0.01, 0.04, 0.1, 0.09, KAWARA_DARK, (1 << 3) | inEnd(s));
      down(s, sx * (RUN / 2 + 0.005), 0, E, -SHEET / 2 - 0.035, 0.03, 0.15, SUMI, inEnd(s));
    }
    // The sheet, then the lining under it and the rafters under that.
    down(s, 0, 0, E, -SHEET / 2, RUN, SHEET, KAWARA, inEnd(s));
    down(s, 0, 0.3, E - 0.02, -SHEET - 0.01, len + 0.1, 0.02, HINOKI, TOP | inEnd(s));
    const raft = Math.round(len / 0.33);
    for (let k = 0; k < raft; k++) {
      const x = -half + (len * (k + 0.5)) / raft;
      down(s, x, FACE, E - 0.06, -SHEET - 0.02 - 0.0275, 0.055, 0.055, SUMI, TOP | inEnd(s));
    }
  }
  // The ridge: a base course, a white band, a course and a round cap, and a
  // demon tile at each end.
  const RL = RUN - 0.06;
  let ry = Y0 + 0.08;
  sb.box(RL, 0.18, 0.36, 0, ry - 0.09, 0, KAWARA_DARK, undefined, 1 << 3);
  sb.box(RL - 0.04, 0.025, 0.32, 0, ry + 0.0125, 0, SHIKKUI, undefined, 1 << 3);
  ry += 0.025;
  sb.box(RL, 0.07, 0.28, 0, ry + 0.035, 0, KAWARA_DARK, undefined, 1 << 3);
  ry += 0.07;
  sb.box(RL, 0.09, 0.17, 0, ry + 0.045, 0, KAWARA_DARK, undefined, 1 << 3);
  for (const sx of [-1, 1]) {
    const ox = sx * (RL / 2 + 0.03);
    sb.box(0.08, 0.36, 0.44, ox, Y0 + 0.1, 0, KAWARA_DARK);
    sb.box(0.08, 0.16, 0.26, ox, Y0 + 0.36, 0, KAWARA_DARK);
    sb.box(0.08, 0.1, 0.1, ox, Y0 + 0.47, 0, KAWARA_DARK, { x: Math.PI / 4 });
  }
  sb.flush(b);

  // --- what all of that hides, emitted after it ------------------------------------
  b.box(len, wallH, FACE * 2, 0, midY, 0, plaster);
  // The wall head carried up under the lining: the gable at each end.
  const under = (n: number): number => yTop(n) - SHEET / cosP - 0.005;
  const head = (x: number): Point3[] => [
    [x, h, -FACE],
    [x, h, FACE],
    [x, under(FACE), FACE],
    [x, under(0), 0],
    [x, under(FACE), -FACE],
  ];
  convexSolid(b, head(-half), head(half), plaster);
  b.box(len - END_STONE * 2, BASE - 0.02 - low, (KERB - 0.025) * 2, 0, (BASE - 0.02 + low) / 2, 0, GRANITE_DARK);
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
