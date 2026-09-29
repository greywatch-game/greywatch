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
