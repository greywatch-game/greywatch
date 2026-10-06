/**
 * kit/city/planter.ts — buildPlanter: the precast council trough and its
 * three seeded plantings. Part of the downtown set: follows the contract in
 * kit/core.ts and the set's rules in `./index.ts`.
 */
import { Scene } from "@babylonjs/core";
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import { mulberry32 } from "../../rng";
import {
  Build,
  type BuildCtx,
  type BuildParams,
  type Structure,
  CONCRETE,
  DARK_CONCRETE,
  CREEPER,
  FIG_BARK,
  FIG_LEAF,
  FIG_LEAF_LIT,
  STRAW,
  TEAK,
  StoneBatch,
  convexSolid,
  Mesher,
  type V3,
  limb,
  rope,
  type Point3,
  streetSeed,
  HIDE_UNDER,
  hideBack,
  outward,
  runsAlongX,
} from "../core";

/**
 * A planter's soil: dark, because the bed is an up-facing surface and the sky
 * term brings every one of those back a stop and a half lighter than its hex.
 */
const PLANTER_SOIL = "#3b3226";
/**
 * Leaves in one planter's crown, the whole of its vertex budget bar ~2 k: six
 * vertices a leaf (two facets, one face), so this is ~5.4 k a placement and
 * the planter ~8 k — a structure's share, on the map that places eleven.
 */
const PLANTER_LEAVES = 900;

/**
 * A concrete planter: the street's low cover, and the only green on the map.
 *
 * The shrub is drawn 0.3 m proud of the collider on purpose. A planter is cover
 * you crouch behind and a shrub is not, so the box stops at the rim and the
 * foliage above it is a silhouette a round goes through — the same call
 * `buildFernClump` makes, and the reason `PROP_BODIES` keeps a tree's collider
 * to its trunk.
 *
 * What it is drawn as is the precast trough every council of the period set
 * along a precinct — and later along a frontage it wanted kept clear of a
 * lorry, which is the cover it is here:
 *
 * - **A body cast in one piece**, its four vertical arrises chamfered, standing
 *   on a TOE set back into a shadow gap so the unit reads as set down on the
 *   paving rather than growing out of it. The toe is carried down to the
 *   lowest ground under the four corners.
 * - **Fluted faces**: vertical ribs 3.5 cm proud between a plain margin at the
 *   foot and one under the coping — a step the ink draws, where a board-marked
 *   or exposed-aggregate finish would only be a texture this look cannot draw.
 * - **A coping** overhanging the ribs, its inner edge a real rim with the soil
 *   sunk 7 cm below it, so the bed reads as filled rather than as a lid. One
 *   corner of it is sometimes knocked off, and the piece lies at the foot.
 * - **Bark mulch** on the soil, and **one of three plantings**, seeded:
 *   clipped box balls; a loose evergreen shrub on visible stems; or a bed
 *   nobody has tended — the bare frame of a shrub, a third of it dead, its
 *   last leaves bunched at the living tips, dead leaves and weeds on the soil.
 *   Every leaf is a plate laid tangent to a billow over a dark core, so the
 *   gaps between leaves read as depth rather than as sky.
 * - **Ivy** spilling over the coping and down a face or two, seeded.
 *
 * The collider is unchanged. Everything drawn is flat on a face (ribs, coping,
 * ivy — at most 7 cm proud), low (the toe, the fallen piece), or above the
 * collider's top (the bed and what grows in it). The chipped corner takes 5 cm
 * off the coping over a 0.25 m run, which is as far as a round stops on air.
 * It seeds off where it stands, so it is in `CONFORMS_TO_TERRAIN`.
 */
export function buildPlanter(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "planter");
  const w = p.width ?? 2.6;
  const d = p.depth ?? 1.4;
  const h = 0.95;
  // ---- the collider, as it always was ----------------------------------------
  b.block({ w, h, d, x: 0, y: h / 2, z: 0 });

  const rnd = mulberry32(streetSeed(w, d, h, ctx));
  const sb = new StoneBatch();
  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };
  const TOE = 0.07; // the shadow gap's height
  const GAP = 0.03; // and its set-back
  const CAP = 0.09; // the coping's depth
  const OVER = 0.05; // the coping's overhang past the body face, clear of the ribs
  const RIB = 0.035; // a flute's projection
  const CH = 0.05; // the chamfer on a vertical arris
  const RIM = 0.17; // body wall plus coping, inner edge to outer face of the body
  const hw = w / 2;
  const hd = d / 2;
  const iw = hw - RIM; // the bed's half-extents
  const id = hd - RIM;
  const soil = h - 0.07;

  // The toe, down to the lowest corner: a planter on a fall is bedded level.
  const low = Math.min(0, ground(-hw, -hd), ground(hw, -hd), ground(-hw, hd), ground(hw, hd)) - 0.03;
  b.box(w - 2 * GAP, TOE - low, d - 2 * GAP, 0, (TOE + low) / 2, 0, DARK_CONCRETE);

  // The body, chamfered at its four arrises; its top is under the coping and the bed.
  const ring = (y: number): Point3[] => [
    [-hw + CH, y, -hd],
    [hw - CH, y, -hd],
    [hw, y, -hd + CH],
    [hw, y, hd - CH],
    [hw - CH, y, hd],
    [-hw + CH, y, hd],
    [-hw, y, hd - CH],
    [-hw, y, -hd + CH],
  ];
  convexSolid(b, ring(TOE), ring(h - CAP), CONCRETE);

  // The flutes, between a plain margin at the foot and one under the coping.
  const fy0 = TOE + 0.1;
  const fy1 = h - CAP - 0.09;
  for (const s of ["-z", "+z", "-x", "+x"] as const) {
    const half = runsAlongX(s) ? hw : hd;
    const plane = runsAlongX(s) ? hd : hw;
    const span = half - CH - 0.12;
    const n = Math.max(2, Math.round((2 * span) / 0.2) + 1);
    for (let i = 0; i < n; i++) {
      const u = -span + (i * 2 * span) / (n - 1);
      sb.onFace(s, plane, u, (fy0 + fy1) / 2, 0.075, fy1 - fy0, RIB, RIB / 2, CONCRETE, 0, 0, hideBack(s));
    }
  }

  // The coping: the long sides own the corners. One corner may be knocked off.
  const chip = rnd() < 0.55 ? { sx: rnd() < 0.5 ? -1 : 1, sz: rnd() < 0.5 ? -1 : 1, len: 0.16 + rnd() * 0.09 } : null;
  const band = OVER + RIM;
  const capY = h - CAP / 2;
  for (const sz of [-1, 1]) {
    const zc = sz * (hd + OVER - band / 2);
    let x0 = -hw - OVER;
    let x1 = hw + OVER;
    if (chip && chip.sz === sz) {
      if (chip.sx < 0) x0 += chip.len;
      else x1 -= chip.len;
      // What is left of the corner: the stub of the coping, broken lower.
      const cx = chip.sx * (hw + OVER - chip.len / 2);
      const drop = 0.05;
      sb.box(chip.len, CAP - drop, band, cx, h - CAP + (CAP - drop) / 2, zc, CONCRETE, undefined, HIDE_UNDER);
      sb.box(chip.len * 0.55, 0.035, band * 0.6, cx - chip.sx * chip.len * 0.18, h - drop + 0.01, zc - sz * band * 0.12, CONCRETE, { y: 0.4, z: chip.sx * 0.25 }, HIDE_UNDER);
      // And the piece, where it fell.
      const fx = chip.sx * (hw + 0.25 + rnd() * 0.3);
      const fz = sz * (hd + 0.15 + rnd() * 0.35);
      sb.box(0.16, 0.06, 0.11, fx, ground(fx, fz) + 0.025, fz, CONCRETE, { y: rnd() * Math.PI, z: 0.3 }, HIDE_UNDER);
    }
    sb.box(x1 - x0, CAP, band, (x0 + x1) / 2, capY, zc, CONCRETE);
  }
  for (const sx of [-1, 1]) {
    sb.box(band, CAP, 2 * id, sx * (hw + OVER - band / 2), capY, 0, CONCRETE);
  }
  sb.flush(b);

  // ---- the bed -----------------------------------------------------------------
  const chips = new StoneBatch();
  for (let i = 0, n = Math.round(iw * id * 30); i < n; i++) {
    const x = (rnd() * 2 - 1) * (iw - 0.04);
    const z = (rnd() * 2 - 1) * (id - 0.04);
    chips.box(0.05 + rnd() * 0.06, 0.016, 0.025 + rnd() * 0.03, x, soil + 0.006, z, TEAK, { y: rnd() * Math.PI, z: (rnd() - 0.5) * 0.3 }, HIDE_UNDER);
  }

  // A leaf is a pointed blade folded down its midrib, laid tangent to what it
  // grows on and turned about its own normal by `spin`. The fold is a bend the
  // ink finds and two facets the bands shade apart, which is what keeps a
  // crown of them from reading as confetti. Only its outer face is drawn on a
  // billow: nothing sees a leaf from inside its own crown, and what casts is
  // the billow's closed core, which is the shape the shadow map has to be
  // given. A leaf on an open branch is seen from both sides and casts by
  // itself, so it is drawn `both` ways — a closed shell (the back face is
  // culled, never fought).
  const unit = (x: number, y: number, z: number): V3 => {
    const m = Math.hypot(x, y, z);
    return [x / m, y / m, z / m];
  };
  /** Two unit vectors across normal `n`, which a leaf's `spin` turns between. */
  const frame = (n: V3): [V3, V3] => {
    const ref = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const t0 = unit(ref[1] * n[2] - ref[2] * n[1], ref[2] * n[0] - ref[0] * n[2], ref[0] * n[1] - ref[1] * n[0]);
    return [t0, [n[1] * t0[2] - n[2] * t0[1], n[2] * t0[0] - n[0] * t0[2], n[0] * t0[1] - n[1] * t0[0]]];
  };
  /** The spin that points a leaf on `n` straight down it, as ivy hangs. */
  const downSpin = (n: V3): number => {
    const [t0, b0] = frame(n);
    return Math.atan2(-b0[1], -t0[1]);
  };
  const meshers = new Map<string, Mesher>();
  const leaf = (p: V3, n: V3, spin: number, len: number, wid: number, color: string, both = false): void => {
    let m = meshers.get(color);
    if (!m) meshers.set(color, (m = new Mesher()));
    const [t0, b0] = frame(n);
    const c = Math.cos(spin);
    const s = Math.sin(spin);
    const t: V3 = [t0[0] * c + b0[0] * s, t0[1] * c + b0[1] * s, t0[2] * c + b0[2] * s];
    const q: V3 = [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]];
    const at = (a: number, b: number, h: number): V3 => [
      p[0] + t[0] * a + q[0] * b + n[0] * h,
      p[1] + t[1] * a + q[1] * b + n[1] * h,
      p[2] + t[2] * a + q[2] * b + n[2] * h,
    ];
    const fold = -wid * 0.24;
    const base = at(-len * 0.42, 0, 0);
    const tip = at(len * 0.58, 0, 0);
    const left = at(-len * 0.04, wid / 2, fold);
    const right = at(-len * 0.04, -wid / 2, fold);
    m.tri(base, left, tip, n);
    m.tri(base, tip, right, n);
    if (!both) return;
    const back: V3 = [-n[0], -n[1], -n[2]];
    m.tri(base, tip, left, back);
    m.tri(base, right, tip, back);
  };
  /** Mostly the creeper's green, the lit one picked more often on what faces up. */
  const tone = (ny: number): string => (rnd() < 0.1 + Math.max(0, ny) * 0.12 ? FIG_LEAF_LIT : CREEPER);
  /**
   * A billow of foliage: a dark core of three octagonal bands inside an
   * ellipsoid, skinned in leaves on a golden spiral down to where the bed or
   * the billow's own underside hides them. `shag` jitters the leaf normals —
   * low for a clipped box, high for a loose shrub.
   */
  interface Billow {
    cx: number;
    cy: number;
    cz: number;
    rx: number;
    ry: number;
    rz: number;
    shag: number;
  }
  const crown: Billow[] = [];
  /** The skinned share of a billow's ellipsoid: everything above the bed. */
  const skin = (o: Billow): number => ((4 * Math.PI * (o.rx * o.ry + o.ry * o.rz + o.rx * o.rz)) / 3) * 0.75;
  const billow = ({ cx, cy, cz, rx, ry, rz, shag }: Billow, n: number, size: number): void => {
    const turn = rnd() * Math.PI;
    const hoop = (u: number): Point3[] => {
      const r = Math.sqrt(1 - u * u) * 0.88;
      return Array.from({ length: 8 }, (_, k): Point3 => {
        const a = turn + (k / 8) * Math.PI * 2;
        return [cx + Math.cos(a) * rx * r, cy + u * ry * 0.88, cz + Math.sin(a) * rz * r];
      });
    };
    const hoops = [-0.55, 0.05, 0.6, 0.92].map(hoop);
    for (let k = 0; k + 1 < hoops.length; k++) convexSolid(b, hoops[k], hoops[k + 1], FIG_LEAF);
    for (let i = 0; i < n; i++) {
      const uy = 1 - ((i + 0.5) / n) * 1.5;
      const r = Math.sqrt(Math.max(0, 1 - uy * uy));
      const a = i * 2.39996 + (rnd() - 0.5) * 0.5;
      const ux = Math.cos(a) * r;
      const uz = Math.sin(a) * r;
      const y = cy + uy * ry;
      if (y < soil + 0.03) continue;
      const nn = unit(ux / rx + (rnd() - 0.5) * shag, uy / ry + (rnd() - 0.5) * shag, uz / rz + (rnd() - 0.5) * shag);
      const sz = size * (0.8 + rnd() * 0.4);
      leaf([cx + ux * rx, y, cz + uz * rz], nn, rnd() * Math.PI * 2, sz, sz * 0.55, tone(nn[1]));
    }
  };

  /**
   * What is left of a shrub nobody has cut back or watered: no crown at all,
   * but the frame of one — stems leaning out of the soil and kinked where
   * they forked, a third of them dead and grey, a twig fork at each dead end
   * — with the leaf it still has bunched toward the living tips, a few gone
   * yellow, and last year's lying on the bed. A mound of billows thinned out
   * still read as a mound, and its core as a faceted egg; what makes a shrub
   * read as neglected is that you can see what holds it up.
   */
  const neglectedShrubs = (): void => {
    const live: [Point3, Point3][] = [];
    const count = Math.max(2, Math.round(iw * 2));
    const stepOut = (p: Point3, bearing: number, lean: number, l: number): Point3 => {
      const x = Math.max(-iw - 0.12, Math.min(iw + 0.12, p[0] + Math.sin(bearing) * Math.sin(lean) * l));
      const z = Math.max(-id - 0.12, Math.min(id + 0.12, p[2] + Math.cos(bearing) * Math.sin(lean) * l));
      return [x, p[1] + Math.cos(lean) * l, z];
    };
    const deadFork = (p: Point3, bearing: number, lean: number): void => {
      for (const side of [-1, 1]) {
        limb(b, p, stepOut(p, bearing + side * (0.4 + rnd() * 0.4), lean + 0.2, 0.07 + rnd() * 0.07), 0.01, 0.005, FIG_BARK, 4);
      }
    };
    for (let i = 0; i < count; i++) {
      const q = i / (count - 1);
      const x = (q * 2 - 1) * iw * 0.55 + (rnd() - 0.5) * 0.15;
      const z = (rnd() - 0.5) * id * 0.3;
      const stems = 4 + Math.floor(rnd() * 3);
      const turn = rnd() * Math.PI * 2;
      for (let j = 0; j < stems; j++) {
        const bearing = turn + (j / stems) * Math.PI * 2 + (rnd() - 0.5) * 0.7;
        const lean = 0.45 + rnd() * 0.5;
        const len = 0.55 + rnd() * 0.4;
        const dead = rnd() < 0.3;
        const p0: Point3 = [x + (rnd() - 0.5) * 0.06, soil - 0.02, z + (rnd() - 0.5) * 0.06];
        const p1 = stepOut(p0, bearing, lean * 0.6, len * 0.5);
        const p2 = stepOut(p1, bearing + (rnd() - 0.5) * 0.5, lean * 1.3, len * 0.5);
        rope(b, [p0, p1, p2], 0.035, 0.012, dead ? FIG_BARK : TEAK, 5);
        const sideBearing = bearing + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.5);
        const p3 = stepOut(p1, sideBearing, lean * 1.6 + 0.2, 0.2 + rnd() * 0.18);
        const sideDead = dead || rnd() < 0.2;
        limb(b, p1, p3, 0.018, 0.008, sideDead ? FIG_BARK : TEAK, 4);
        if (dead) deadFork(p2, bearing, lean * 1.3);
        else live.push([p1, p2]);
        if (sideDead) deadFork(p3, sideBearing, lean * 1.6 + 0.2);
        else live.push([p1, p3]);
      }
    }
    // The leaf it has left, shared along the living wood by length and bunched
    // toward each tip, standing off the stem on every side of it.
    const length = (g: [Point3, Point3]): number => Math.hypot(g[1][0] - g[0][0], g[1][1] - g[0][1], g[1][2] - g[0][2]);
    const total = live.reduce((sum, g) => sum + length(g), 0);
    const budget = Math.round(PLANTER_LEAVES * 0.5 * Math.min(2, (w * d) / (2.6 * 1.4)));
    for (const g of live) {
      const [a, c] = g;
      const dir = unit(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
      const [u0, u1] = frame(dir);
      for (let k = 0, n = Math.round((budget * length(g)) / Math.max(total, 1e-3)); k < n; k++) {
        const t = 0.35 + 0.65 * Math.sqrt(rnd());
        const th = rnd() * Math.PI * 2;
        const ct = Math.cos(th);
        const st = Math.sin(th);
        const radial: V3 = [u0[0] * ct + u1[0] * st, u0[1] * ct + u1[1] * st, u0[2] * ct + u1[2] * st];
        const off = 0.02 + t * 0.05;
        const p: V3 = [
          a[0] + (c[0] - a[0]) * t + radial[0] * off,
          a[1] + (c[1] - a[1]) * t + radial[1] * off,
          a[2] + (c[2] - a[2]) * t + radial[2] * off,
        ];
        if (p[1] < soil + 0.05) continue;
        const nn = unit(radial[0] + dir[0] * 0.3, radial[1] + 0.6 + dir[1] * 0.3, radial[2] + dir[2] * 0.3);
        const sz = 0.1 + rnd() * 0.05;
        leaf(p, nn, rnd() * Math.PI * 2, sz, sz * 0.55, rnd() < 0.12 ? STRAW : tone(nn[1]), true);
      }
    }
    // Last year's leaves, lying where they dropped.
    for (let k = 0; k < 16; k++) {
      const nn = unit((rnd() - 0.5) * 0.4, 1, (rnd() - 0.5) * 0.4);
      const p: V3 = [(rnd() * 2 - 1) * (iw - 0.06), soil + 0.022, (rnd() * 2 - 1) * (id - 0.06)];
      leaf(p, nn, rnd() * Math.PI * 2, 0.1 + rnd() * 0.04, 0.055, rnd() < 0.6 ? STRAW : FIG_BARK);
    }
    // Weeds where the bed meets the rim: rosettes of blades lying out over
    // the soil, the way a dandelion or a plantain claims bare ground.
    for (let k = 0; k < 4; k++) {
      const wx = (rnd() < 0.5 ? -1 : 1) * (iw - 0.08 - rnd() * 0.25);
      const wz = (rnd() * 2 - 1) * (id - 0.08);
      const blades = 5 + Math.floor(rnd() * 3);
      const turn = rnd() * Math.PI * 2;
      for (let j = 0; j < blades; j++) {
        const a = turn + (j / blades) * Math.PI * 2;
        const l = 0.11 + rnd() * 0.07;
        const lift = 0.35 + rnd() * 0.35;
        const nn = unit(-Math.sin(a) * lift, 1, -Math.cos(a) * lift);
        const p: V3 = [wx + Math.sin(a) * l * 0.45, soil + 0.02 + lift * l * 0.25, wz + Math.cos(a) * l * 0.45];
        leaf(p, nn, downSpin(nn) + Math.PI, l, l * 0.4, CREEPER);
      }
    }
  };

  const kind = rnd();
  if (kind < 0.4) {
    // Clipped box, in balls along the bed: small leaves, close and even.
    const count = iw > 0.85 ? (rnd() < 0.5 ? 2 : 3) : 1;
    const r = Math.min(id * 0.95, count === 3 ? iw * 0.42 : iw * 0.55);
    for (let i = 0; i < count; i++) {
      const x = count === 1 ? 0 : -iw * 0.62 + (i * 2 * iw * 0.62) / (count - 1);
      const s = r * (0.92 + rnd() * 0.12);
      crown.push({ cx: x + (rnd() - 0.5) * 0.06, cy: soil + s * 0.8, cz: (rnd() - 0.5) * 0.06, rx: s, ry: s * 0.9, rz: s, shag: 0.35 });
    }
  } else if (kind < 0.8) {
    // A loose evergreen shrub: a mound of billows sat down on the bed, the
    // stems showing only where it lifts off the soil.
    const count = Math.max(2, Math.round(iw * 2.6));
    for (let i = 0; i < count; i++) {
      const q = i / (count - 1);
      const x = (q * 2 - 1) * iw * 0.62 + (rnd() - 0.5) * 0.12;
      const z = (rnd() - 0.5) * id * 0.4;
      const s = 0.4 + rnd() * 0.12 + (1 - Math.abs(q * 2 - 1)) * 0.08;
      const ry = s * (0.8 + rnd() * 0.2);
      const cy = soil + ry * 0.7 + rnd() * 0.06;
      const rz = Math.min(s, id * 0.95);
      crown.push({ cx: x, cy, cz: z, rx: s * 1.1, ry, rz, shag: 1.0 });
      for (let k = 0; k < 2; k++) {
        const fx = x + (rnd() - 0.5) * s * 0.8;
        const fz = z + (rnd() - 0.5) * rz * 0.6;
        limb(b, [fx, soil - 0.02, fz], [x + (fx - x) * 0.3, cy, z + (fz - z) * 0.3], 0.04, 0.025, TEAK, 5);
      }
    }
  } else {
    neglectedShrubs();
  }
  // The leaves are a BUDGET, shared out by area, and a leaf's size follows
  // from its share: two balls or three, a shrub or a clipped one, a planter
  // costs the same, where a fixed leaf size made a third ball a third more.
  // Sized so the skin is just covered — the dark core showing between is
  // depth, not a hole. A neglected bed has no billows and has spent its own
  // half-budget on its branches already.
  const total = crown.reduce((sum, o) => sum + skin(o), 0);
  const leaves = Math.round(PLANTER_LEAVES * Math.min(2, (w * d) / (2.6 * 1.4)));
  for (const o of crown) {
    const n = Math.max(12, Math.round((leaves * skin(o)) / total));
    billow(o, n, Math.sqrt((skin(o) * 0.95) / (n * 0.275)));
  }

  // Ivy, rooted along the bed's edge, over the coping and down the face.
  for (const s of ["-z", "+z", "-x", "+x"] as const) {
    if (rnd() > (runsAlongX(s) ? 0.35 : 0.2)) continue;
    const half = runsAlongX(s) ? hw : hd;
    const plane = runsAlongX(s) ? hd : hw;
    const runLen = Math.min(2 * half - 0.4, 0.5 + rnd() * 0.8);
    const u0 = -half + 0.2 + rnd() * (2 * half - 0.4 - runLen);
    const u1 = u0 + runLen;
    const o = outward(s);
    // A point `out` past this face's plane at `u` along it, as local x/z.
    const at = (u: number, out: number): [number, number] => (runsAlongX(s) ? [u, o * (plane + out)] : [o * (plane + out), u]);
    const nOut = (side: number, ny: number): V3 => (runsAlongX(s) ? unit(side * 0.35, ny, o) : unit(o, ny, side * 0.35));
    for (let u = u0 + rnd() * 0.06; u < u1; u += 0.1 + rnd() * 0.12) {
      const q = (u - u0) / (u1 - u0);
      const env = Math.sqrt(Math.max(0, Math.sin(Math.PI * q)));
      const bottom = Math.max(h - 0.08 - (0.25 + rnd() * 0.45) * env, fy0 + 0.08);
      // Over the coping: the runner from the bed to the lip, leafed.
      const [rx, rz] = at(u, OVER / 2 - RIM / 2);
      const runner = band + 0.02;
      if (runsAlongX(s)) chips.box(0.022, 0.02, runner, rx, h + 0.008, rz, CREEPER, undefined, HIDE_UNDER);
      else chips.box(runner, 0.02, 0.022, rx, h + 0.008, rz, CREEPER, undefined, HIDE_UNDER);
      for (let k = 0; k < 2; k++) {
        const [lx, lz] = at(u + (rnd() - 0.5) * 0.1, -RIM + rnd() * band);
        const nn = unit((rnd() - 0.5) * 1.1, 1, (rnd() - 0.5) * 1.1);
        leaf([lx, h + 0.03, lz], nn, rnd() * Math.PI * 2, 0.12, 0.08, CREEPER);
      }
      // Down the face, in front of the flutes, its leaves hanging tip down.
      const out = OVER + 0.02;
      if (h - bottom > 0.1) {
        chips.onFace(s, plane, u, (h + bottom) / 2, 0.02, h - bottom, 0.02, out, CREEPER, (rnd() - 0.5) * 0.06, 0, hideBack(s));
      }
      let side = rnd() < 0.5 ? -1 : 1;
      for (let y = h - 0.05 - rnd() * 0.05; y > bottom + 0.03; y -= 0.09 + rnd() * 0.07) {
        const [lx, lz] = at(u + side * (0.04 + rnd() * 0.03), out + 0.03 + rnd() * 0.015);
        const nn = nOut(side, -0.2 + rnd() * 0.3);
        leaf([lx, y, lz], nn, downSpin(nn) + side * (0.4 + rnd() * 0.4), 0.13 + rnd() * 0.04, 0.09 + rnd() * 0.03, tone(0));
        side = -side;
      }
    }
  }
  chips.flush(b);
  for (const [color, m] of meshers) b.surface(m.data(), color);

  // The soil, after everything laid on it.
  b.box(2 * iw, 0.1, 2 * id, 0, soil - 0.05, 0, PLANTER_SOIL);
  return b;
}
