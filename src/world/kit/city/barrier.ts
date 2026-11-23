/**
 * kit/city/barrier.ts — buildBarrier: a run of precast concrete safety barrier.
 * Part of the downtown set: follows the contract in kit/core.ts and the set's
 * rules in `./index.ts`.
 */
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import { mulberry32 } from "../../rng";
import {
  Build,
  type BuildCtx,
  type BuildParams,
  type Point3,
  type Structure,
  type V3,
  Lay,
  ALLOY,
  ASHLAR,
  ASPHALT,
  CONCRETE,
  DARK_CONCRETE,
  LAMP_RED,
  ROAD_PAINT,
  RUST,
  STENCIL,
  TAU,
  carve,
  convexSolid,
  rod,
  streetSeed,
} from "../core";

/** The collider's height, and the top of every unit. */
const H = 0.9;
/**
 * The New Jersey section as `[half-width, y]` up its right side: a vertical
 * toe, the steep lower slope a tyre rides up, the near-vertical upper face
 * and a chamfered arris onto a 0.12 m top. Every unit is this, lofted.
 */
const SECTION: readonly (readonly [number, number])[] = [
  [0.3, 0],
  [0.3, 0.075],
  [0.125, 0.33],
  [0.085, 0.87],
  [0.06, H],
];
/** The two faces marks are laid on, as their foot and head on the right side. */
const LOWER = { a: SECTION[1], b: SECTION[2] };
const UPPER = { a: SECTION[2], b: SECTION[3] };
type Face = typeof LOWER;
/** How high the drainage slots through the foot are, and where the loft is cut for them. */
const SLOT = 0.1;
/** The arris chamfer round each unit's two ends. */
const END = 0.025;
/** How much smaller the end face is than the section, on the base. */
const END_IN = 0.02;

/** Half the section's width at height `y`. */
function halfAt(y: number): number {
  for (let i = 1; i < SECTION.length; i++) {
    const [w0, y0] = SECTION[i - 1];
    const [w1, y1] = SECTION[i];
    if (y <= y1) return w0 + ((w1 - w0) * (y - y0)) / (y1 - y0);
  }
  return SECTION[SECTION.length - 1][0];
}

/**
 * The section's outline between `lo` and `hi`, at `z`, `ox` across, shrunk by
 * the affine map that takes the base in by `inset` and the top down by it —
 * affine, so every edge of the shrunk outline stays parallel to its own and
 * the chamfer between the two is planar facets, which the cel shader's
 * per-facet light needs (craft.md).
 */
function outline(lo: number, hi: number, z: number, ox: number, inset: number): Point3[] {
  const sx = 1 - inset / SECTION[0][0];
  const sy = 1 - inset / H;
  const right: [number, number][] = [[halfAt(lo), lo]];
  for (const [w, y] of SECTION) if (y > lo + 1e-6 && y < hi - 1e-6) right.push([w, y]);
  right.push([halfAt(hi), hi]);
  const pts: Point3[] = [];
  for (const [w, y] of right) pts.push([ox + w * sx, y * sy, z]);
  // The top is a flat; anything lower closes across its own head.
  for (let i = right.length - 1; i >= 0; i--) pts.push([ox - right[i][0] * sx, right[i][1] * sy, z]);
  return pts;
}

/**
 * A run of jersey barrier: roadworks, a closed lane, a checkpoint that was.
 *
 * Chest-high cover you can put anywhere, and the one piece of city furniture
 * whose whole job is to break an avenue's sightline at the ground plane. **The
 * collider is the run's envelope, declared first and unchanged**: one box the
 * section's base wide and `H` high, the length of the run. Every unit stands
 * inside it, and what stands above it — the lifting loops, the joint pins'
 * heads — is steel a round has always crossed.
 *
 * **It is drawn as what it is**: precast units three metres long, each the New
 * Jersey section (`SECTION`) lofted with chamfered ends, two drainage slots
 * cut through its foot (real holes, which is why the loft is cut at `SLOT` —
 * a slot is ten centimetres at the ground and a round finding one stops on
 * the collider at a body's ankle, which nothing reads), steel loops cast into
 * both ends and a pin dropped through them where two units meet, and two
 * lifting loops on top. Units are a centimetre out of line with each other,
 * as anything set down off a lorry's crane is.
 *
 * **What marks it is LAID on its faces**, 3–10 mm proud, in colours a street
 * block draws already: road grime up the lower slope, tyre scuffs where a
 * wheel rode it, rust run down from every loop, strikes (a pale ring round a
 * dark core), spalls showing pale aggregate and the rebar in it, and one of
 * three paint schemes for the whole run — faded hazard stripes, a stencilled
 * unit number, or bare — with a reflector on some runs. A unit standing over
 * a dip is bedded on a pad of lean mix carried down to the ground.
 *
 * **Seeded off where it stands** (`streetSeed`, which is why it is in
 * `CONFORMS_TO_TERRAIN`): each unit's offset, the loops' set, the paint
 * scheme and its chips, every scuff, strike and spall. Nothing seeded reaches
 * the collider.
 */
export function buildBarrier(
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(mats, "barrier");
  const len = p.length ?? 6;
  const units = Math.max(1, Math.round(len / 3));

  // --- the collider: the run's envelope, and nothing else -------------------
  b.block({ w: 0.62, h: H, d: len, x: 0, y: H / 2, z: 0 });

  const rnd = mulberry32(streetSeed(0.62, len, H, ctx));
  const lay = new Lay();
  const sb = lay.sb;
  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };

  const scheme = rnd();
  const stripes = scheme < 0.35;
  const numbered = !stripes && scheme < 0.7;
  const reflectors = rnd() < 0.45;
  const firstNumber = 10 + Math.floor(rnd() * 80);

  /** A point on `face` of side `s`, at `z` along the run and `y` up it, `off` proud. */
  const on = (f: Face, s: number, ox: number, z: number, y: number, off: number): V3 => {
    const [xa, ya] = f.a;
    const [xb, yb] = f.b;
    const t = (y - ya) / (yb - ya);
    const dx = xb - xa;
    const dy = yb - ya;
    const l = Math.hypot(dx, dy);
    return [ox + s * (xa + dx * t + (dy / l) * off), y + (-dx / l) * off, z];
  };
  const outOf = (f: Face, s: number): V3 => {
    const dx = f.b[0] - f.a[0];
    const dy = f.b[1] - f.a[1];
    return [s * dy, -dx, 0];
  };
  /** A star-shaped patch on a face, fanned from its own centre. */
  const patch = (f: Face, s: number, ox: number, pts: readonly (readonly [number, number])[], off: number, color: string): void => {
    if (pts.length < 3) return;
    const m = lay.m(color);
    let cz = 0;
    let cy = 0;
    for (const [z, y] of pts) {
      cz += z / pts.length;
      cy += y / pts.length;
    }
    const c = on(f, s, ox, cz, cy, off);
    const n = outOf(f, s);
    for (let i = 0; i < pts.length; i++) {
      const [z0, y0] = pts[i];
      const [z1, y1] = pts[(i + 1) % pts.length];
      m.tri(c, on(f, s, ox, z0, y0, off), on(f, s, ox, z1, y1, off), n);
    }
  };
  /** A ragged round outline. */
  const ragged = (z: number, y: number, r: number, n: number): [number, number][] => {
    const ph = rnd() * TAU;
    const pts: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * TAU;
      const k = 0.78 + 0.16 * Math.sin(2 * t + ph) + rnd() * 0.22;
      pts.push([z + Math.cos(t) * r * k, y + Math.sin(t) * r * k]);
    }
    return pts;
  };
  /** The part of a polygon between two z's: Sutherland–Hodgman against both. */
  const clipZ = (pts: [number, number][], z0: number, z1: number): [number, number][] => {
    let out = pts;
    for (const [edge, keep] of [
      [z0, (z: number) => z >= z0],
      [z1, (z: number) => z <= z1],
    ] as const) {
      const next: [number, number][] = [];
      for (let i = 0; i < out.length; i++) {
        const a = out[i];
        const c = out[(i + 1) % out.length];
        const ka = keep(a[0]);
        const kc = keep(c[0]);
        if (ka) next.push(a);
        if (ka !== kc) {
          const t = (edge - a[0]) / (c[0] - a[0]);
          next.push([edge, a[1] + (c[1] - a[1]) * t]);
        }
      }
      out = next;
    }
    return out;
  };
  /** A tapering streak run down a face from `(z, y)`, `drop` long. */
  const streak = (f: Face, s: number, ox: number, z: number, y: number, drop: number, w: number, color: string): void => {
    const bend = (rnd() - 0.5) * 0.03;
    patch(f, s, ox, [
      [z - w / 2, y],
      [z + w / 2, y],
      [z + bend + w * 0.15, y - drop],
      [z + bend - w * 0.15, y - drop],
    ], 0.002, color);
  };

  const bodies: (() => void)[] = [];
  const step = len / units;
  const unit = step - 0.1;
  for (let i = 0; i < units; i++) {
    const zc = -len / 2 + (i + 0.5) * step;
    const z0 = zc - unit / 2;
    const z1 = zc + unit / 2;
    const ox = (rnd() - 0.5) * 0.016;

    // --- the unit: its foot cut for the slots, its body, chamfered ends ---
    const slots: [number, number][] = [-0.22, 0.22].map((k) => [zc + k * unit - 0.16, zc + k * unit + 0.16]);
    const prism = (lo: number, hi: number, za: number, zb: number): void => {
      const atA = za <= z0 + 1e-6;
      const atB = zb >= z1 - 1e-6;
      const a = atA ? za + END : za;
      const c = atB ? zb - END : zb;
      bodies.push(() => {
        if (atA) convexSolid(b, outline(lo, hi, za, ox, END_IN), outline(lo, hi, a, ox, 0), CONCRETE);
        convexSolid(b, outline(lo, hi, a, ox, 0), outline(lo, hi, c, ox, 0), CONCRETE);
        if (atB) convexSolid(b, outline(lo, hi, c, ox, 0), outline(lo, hi, zb, ox, END_IN), CONCRETE);
      });
    };
    for (const [za, zb] of carve(z0, z1, slots)) prism(0, SLOT, za, zb);
    prism(SLOT, H, z0, z1);

    // A unit over a dip is bedded on lean mix carried down to the ground.
    let low = 0;
    for (const z of [z0, zc, z1]) for (const x of [-0.28, 0.28]) low = Math.min(low, ground(x + ox, z));
    if (low < -0.015) sb.box(0.58, -low + 0.02, unit - 0.04, ox, low / 2 - 0.01, zc, DARK_CONCRETE);

    // --- the steel: loops cast into both ends, lifting loops on top ---------
    // Each end's loops are set at their own heights so the next unit's stack
    // between them, and a pin dropped through the four holds the pair.
    for (const [ze, dir] of [
      [z0, -1],
      [z1, 1],
    ] as const) {
      const hs = dir > 0 ? [0.27, 0.6] : [0.33, 0.66];
      for (const y of hs) {
        const tip = ze + dir * 0.045;
        const back = ze - dir * 0.01;
        rod(lay, [ox - 0.03, y, back], [ox - 0.03, y, tip], 0.014, RUST);
        rod(lay, [ox + 0.03, y, back], [ox + 0.03, y, tip], 0.014, RUST);
        rod(lay, [ox - 0.037, y, tip], [ox + 0.037, y, tip], 0.014, RUST);
      }
    }
    if (i + 1 < units) {
      const zj = zc + step / 2;
      rod(lay, [0, 0.2, zj], [0, 0.94, zj], 0.022, RUST);
      const turn = rnd() * TAU;
      rod(lay, [0, 0.94, zj], [Math.sin(turn) * 0.07, 0.94, zj + Math.cos(turn) * 0.04], 0.022, RUST);
    }
    for (const k of [-0.3, 0.3]) {
      const z = zc + k * unit;
      const flat = rnd() < 0.2;
      const top = flat ? H + 0.018 : H + 0.055;
      const lean = flat ? 0.06 : 0;
      rod(lay, [ox, H - 0.01, z - 0.04], [ox + lean, top, z - 0.04], 0.012, RUST);
      rod(lay, [ox, H - 0.01, z + 0.04], [ox + lean, top, z + 0.04], 0.012, RUST);
      rod(lay, [ox + lean, top, z - 0.046], [ox + lean, top, z + 0.046], 0.012, RUST);
      for (const s of [-1, 1]) if (rnd() < 0.8) streak(UPPER, s, ox, z, 0.86, 0.18 + rnd() * 0.3, 0.035, RUST);
    }

    // --- the faces -----------------------------------------------------------
    for (const s of [-1, 1]) {
      // Road grime up the lower slope, its head a slow wave along the unit.
      const ph = rnd() * TAU;
      const grime = (z: number): number => 0.19 + 0.035 * Math.sin((z - z0) * 2.1 + ph) + 0.02 * Math.sin((z - z0) * 5.3 + ph * 2);
      const n = Math.max(4, Math.round(unit / 0.2));
      const m = lay.m(DARK_CONCRETE);
      for (let k = 0; k < n; k++) {
        const za = z0 + 0.03 + ((unit - 0.06) * k) / n;
        const zb = z0 + 0.03 + ((unit - 0.06) * (k + 1)) / n;
        m.quad(on(LOWER, s, ox, za, SLOT, 0.003), on(LOWER, s, ox, zb, SLOT, 0.003), on(LOWER, s, ox, zb, grime(zb), 0.003), on(LOWER, s, ox, za, grime(za), 0.003), outOf(LOWER, s));
      }
      // Tyre scuffs where a wheel rode up the slope.
      const scuffs = Math.floor(rnd() * 3);
      for (let k = 0; k < scuffs; k++) {
        const za = z0 + 0.1 + rnd() * (unit - 1.1);
        const zb = za + 0.35 + rnd() * 0.6;
        const ya = 0.13 + rnd() * 0.1;
        const rise = (rnd() - 0.3) * 0.08;
        const th = 0.018 + rnd() * 0.03;
        patch(LOWER, s, ox, [
          [za, ya],
          [zb, ya + rise],
          [zb - 0.04, ya + rise + th],
          [za + 0.04, ya + th * 0.6],
        ], 0.005, ASPHALT);
      }

      // The paint.
      if (stripes) {
        const lo = 0.42;
        const hi = 0.76;
        const w = 0.22;
        const lean = (hi - lo) * s;
        let c = 0;
        for (let z = z0 - 0.4; z < z1 + 0.4; z += w, c++) {
          const poly = clipZ(
            [
              [z, lo],
              [z + w, lo],
              [z + w + lean, hi],
              [z + lean, hi],
            ],
            z0 + 0.05,
            z1 - 0.05,
          );
          patch(UPPER, s, ox, poly, 0.004, c % 2 ? ROAD_PAINT : LAMP_RED);
        }
        // Where the paint has chipped back to the concrete.
        const chips = 3 + Math.floor(rnd() * 5);
        for (let k = 0; k < chips; k++) {
          const z = z0 + 0.1 + rnd() * (unit - 0.2);
          const y = lo + 0.02 + rnd() * (hi - lo - 0.04);
          patch(UPPER, s, ox, ragged(z, y, 0.02 + rnd() * 0.04, 7), 0.006, CONCRETE);
        }
      } else if (numbered) {
        const text = String(firstNumber + i).padStart(2, "0");
        const g = 0.024;
        const width = text.length * 3 * g + (text.length - 1) * g;
        const zt = zc - (s * width) / 2;
        const yt = 0.5;
        let u = 0;
        for (const ch of text) {
          for (const [x0, y0, x1, y1] of STENCIL[ch] ?? []) {
            const za = zt + s * (u + x0 * g);
            const zb = zt + s * (u + x1 * g);
            patch(UPPER, s, ox, [
              [Math.min(za, zb), yt + y0 * g],
              [Math.max(za, zb), yt + y0 * g],
              [Math.max(za, zb), yt + y1 * g],
              [Math.min(za, zb), yt + y1 * g],
            ], 0.004, ROAD_PAINT);
          }
          u += 4 * g;
        }
      }
      if (reflectors) {
        const z = zc + (stripes ? 0 : s * 0.55);
        patch(UPPER, s, ox, [
          [z - 0.075, 0.8],
          [z + 0.075, 0.8],
          [z + 0.075, 0.855],
          [z - 0.075, 0.855],
        ], 0.008, ALLOY);
        patch(UPPER, s, ox, [
          [z - 0.06, 0.808],
          [z + 0.06, 0.808],
          [z + 0.06, 0.847],
          [z - 0.06, 0.847],
        ], 0.012, s > 0 ? ROAD_PAINT : LAMP_RED);
      }

      // Strikes: a pale ring of crushed skin round a dark core.
      const strikes = Math.floor(rnd() * rnd() * 7);
      for (let k = 0; k < strikes; k++) {
        const z = z0 + 0.08 + rnd() * (unit - 0.16);
        const y = 0.36 + rnd() * 0.42;
        const r = 0.025 + rnd() * 0.03;
        patch(UPPER, s, ox, ragged(z, y, r, 8), 0.007, ASHLAR);
        patch(UPPER, s, ox, ragged(z, y, r * 0.45, 6), 0.01, DARK_CONCRETE);
      }
    }

    // A spall off the top arris or the toe of one face, showing the rebar.
    if (rnd() < 0.45) {
      const s = rnd() < 0.5 ? -1 : 1;
      const z = z0 + 0.25 + rnd() * (unit - 0.5);
      const top = rnd() < 0.7;
      const f = top ? UPPER : LOWER;
      const y = top ? 0.76 + rnd() * 0.03 : 0.2;
      const hu = 0.1 + rnd() * 0.12;
      const hy = top ? 0.07 : 0.05;
      const pts: [number, number][] = [];
      const ph = rnd() * TAU;
      for (let k = 0; k < 12; k++) {
        const t = (k / 12) * TAU;
        const kk = 0.8 + 0.15 * Math.sin(2 * t + ph) + rnd() * 0.15;
        pts.push([z + Math.cos(t) * hu * kk, y + Math.sin(t) * hy * kk]);
      }
      patch(f, s, ox, pts, 0.006, ASHLAR);
      const bars = 1 + Math.floor(rnd() * 2);
      for (let k = 0; k < bars; k++) {
        const yb = y + (k - (bars - 1) / 2) * 0.035;
        rod(lay, on(f, s, ox, z - hu * 0.75, yb, 0.012), on(f, s, ox, z + hu * 0.75, yb, 0.012), 0.012, RUST);
      }
      // A streak stops at the face's foot: below it the plane is not the unit's.
      const from = y - hy * 0.6;
      streak(f, s, ox, z + (rnd() - 0.5) * hu, from, Math.min(0.1 + rnd() * 0.15, from - f.a[1] - 0.01), 0.04, RUST);
    }
  }

  // The marks first and the units after, so the concrete they cover is
  // rejected by the depth test rather than shaded under them (craft.md).
  lay.flush(b);
  for (const body of bodies) body();
  return b;
}
