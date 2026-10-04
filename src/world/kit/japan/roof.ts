/**
 * kit/japan/roof.ts — The kit's one CURVED ROOF: `curvedRoof` (a hipped
 * roof as rings from eave to ridge on a power curve, the corners swept up)
 * and `roofHeight` (where that sheet stands over a plan point, so a rafter
 * hangs under it and a tile lies on it). Why the shape exists is
 * `./index.ts`'s.
 * Invariants: every sheet is a CLOSED solid, because the world's shadow map
 * records back faces. Draws only — a roof's collider is its builder's flat
 * slab at the eave, never anything here.
 */
import { Mesher, type Build, type V3 } from "../core";

export interface RoofSpec {
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
export function curvedRoof(b: Build, color: string, o: RoofSpec): void {
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
export function roofHeight(o: RoofSpec, x: number, z: number, under = false): number {
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
