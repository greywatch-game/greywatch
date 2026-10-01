/**
 * kit/buildings/gothic.ts — The chapel's words: a point, a polygon and a block
 * on an elevation, the pyramid a spire is, the pointed arch and its ring, the
 * lancet and the buttress — and `inside`, which the stilt hut borrows.
 * Invariants: VISUAL, except where a caller asks a buttress for the two boxes
 * that make it one to a body and a round.
 */
import {
  Build,
  type Point3,
  convexSolid,
  onFace,
  outward,
  runsAlongX,
  type Hole,
  type Side,
  CASEMENT,
  DARK_STONE,
  IRON,
  MOSS_STONE,
  STONE,
} from "../core";

// Five more words in the elevations' vocabulary, for the one building in the
// kit whose openings are POINTED and whose walls are held up by something
// standing off them. Everything they make is visual except where a caller
// asks a buttress for its blocks.

/** A point on an elevation: `u` along it, `y` up it, `out` past its plane. */
export function facePoint(s: Side, plane: number, u: number, y: number, out: number): Point3 {
  const c = outward(s) * (plane + out);
  return runsAlongX(s) ? [u, y, c] : [c, y, u];
}

/** A convex outline in an elevation's own `(u, y)`, laid on it from `out0` to `out1` past its plane. */
export function facePoly(
  b: Build,
  s: Side,
  plane: number,
  pts: readonly (readonly [number, number])[],
  out0: number,
  out1: number,
  color: string,
): void {
  convexSolid(
    b,
    pts.map(([u, y]) => facePoint(s, plane, u, y, out0)),
    pts.map(([u, y]) => facePoint(s, plane, u, y, out1)),
    color,
  );
}

/**
 * A convex SECTION standing out from an elevation, in `(out, y)`, run along
 * it from `u0` to `u1`: a weathering, a drip, the chamfer on a plinth.
 */
export function offFacePoly(
  b: Build,
  s: Side,
  plane: number,
  sec: readonly (readonly [number, number])[],
  u0: number,
  u1: number,
  color: string,
): void {
  convexSolid(
    b,
    sec.map(([o, y]) => facePoint(s, plane, u0, y, o)),
    sec.map(([o, y]) => facePoint(s, plane, u1, y, o)),
    color,
  );
}

/** `onFace`'s collider: the same box, declared rather than drawn. */
export function faceBlock(
  b: Build,
  s: Side,
  plane: number,
  u: number,
  y: number,
  along: number,
  tall: number,
  thick: number,
  out: number,
): void {
  const c = outward(s) * (plane + out);
  if (runsAlongX(s)) b.block({ w: along, h: tall, d: thick, x: u, y, z: c });
  else b.block({ w: thick, h: tall, d: along, x: c, y, z: u });
}

/** The inside face of a wall whose outside is `s`. */
export const inside = (s: Side): Side => (s === "-z" ? "+z" : s === "+z" ? "-z" : s === "-x" ? "+x" : "-x");

/**
 * An `n`-sided pyramid — or a frustum, given a top radius — with FLAT faces:
 * a spire, a pinnacle's cap, a font's cover. `r0`/`r1` are circumradii, and
 * the default phase puts a FLAT, not a corner, on each axis, which is how a
 * spire stands on a square tower.
 *
 * Not `cyl`, whose sides are smooth-shaded round the tessellation: an octagon
 * drawn that way is a cone with a banded shading step on it, and what the eye
 * reads a spire by is the hard line between two faces the ink finds.
 */
export function pyramid(
  b: Build,
  n: number,
  r0: number,
  r1: number,
  y0: number,
  y1: number,
  x: number,
  z: number,
  color: string,
  phase = Math.PI / n,
): void {
  const ring = (r: number, y: number): Point3[] =>
    Array.from({ length: n }, (_, i): Point3 => {
      const a = phase + (i * 2 * Math.PI) / n;
      return [x + r * Math.cos(a), y, z + r * Math.sin(a)];
    });
  convexSolid(b, ring(r0, y0), ring(Math.max(r1, 0.004), y1), color);
}

/** A tilt in the face plane, folded into `(-pi/2, pi/2]` — a box has no ends. */
export const fold = (a: number): number => (a > Math.PI / 2 ? a - Math.PI : a <= -Math.PI / 2 ? a + Math.PI : a);

/**
 * The two arcs of a pointed arch over a span `S` with a `rise`, as the points
 * along the LEFT one at radius `R + grow` from springing to apex (the right
 * one is its mirror about `u`). Two-centred: each arc is struck from a centre
 * on the springing line `c` past the middle, which is equilateral when the
 * rise is `S * sqrt(3) / 2` and a lancet above that.
 *
 * **A rise under half the span has no two-centred arch**: `c` goes negative,
 * each arc peaks short of the middle and the two meet in a DIP — a cupid's bow
 * where the apex should be, which is what the first cut of the doorway drew.
 * So `c` is clamped at zero, and such a rise is drawn as the semicircle over
 * the span: the caller that wants a flatter head owes a four-centred one.
 */
function archArc(u: number, ys: number, S: number, rise: number, grow: number, n: number): [number, number][] {
  const c = Math.max(0, (rise * rise - (S * S) / 4) / S);
  const R = c + S / 2 + grow;
  const end = c > 0 ? Math.atan2(rise, -c) : Math.PI / 2;
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = Math.PI + ((end - Math.PI) * i) / n;
    pts.push([u + c + R * Math.cos(a), ys + R * Math.sin(a)]);
  }
  return pts;
}

/** Stones laid along both arcs of an arch: its voussoirs, or its hood mould. */
export function archRing(
  b: Build,
  s: Side,
  plane: number,
  u: number,
  ys: number,
  S: number,
  rise: number,
  grow: number,
  width: number,
  thick: number,
  out: number,
  color: string,
): void {
  const pts = archArc(u, ys, S, rise, grow, 4);
  for (const k of [-1, 1]) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ua, ya] = pts[i];
      const [ub, yb] = pts[i + 1];
      const u0 = k < 0 ? ua : 2 * u - ua;
      const u1 = k < 0 ? ub : 2 * u - ub;
      const len = Math.hypot(u1 - u0, yb - ya);
      onFace(b, s, plane, (u0 + u1) / 2, (ya + yb) / 2, len + 0.03, width, thick, out, color, fold(Math.atan2(yb - ya, u1 - u0)));
    }
  }
}

interface LancetOpts {
  /** The candlelight behind the glass; absent is glass with nobody behind it. */
  lit?: string;
  /** What the wall around it is, which the corners of the head are filled in. */
  fill: string;
  /** What it is dressed in: the jambs, the arch and the sill. */
  dress: string;
  /** A hood mould over the head, which only an OUTSIDE face carries. */
  hood?: boolean;
  /** Leaded diamond quarries and saddle bars, which are only visible against light. */
  cames?: boolean;
}

/**
 * A lancet: a tall light under a pointed head, in its dressings.
 *
 * The glass is a rectangle to the APEX and the head is cut out of it by two
 * spandrels in the wall's own colour, then drawn over by the arch ring — the
 * only way to a pointed opening on a face whose light is a box (`Build.glow`
 * takes no outline). The ring is what the eye reads the arch by, and it is
 * wide enough to cover the sliver between the chord the spandrels are cut to
 * and the arc it is drawn on.
 *
 * **Jambs are laid long and short, as the quoins are**: an opening in a stone
 * wall is recognised by its dressing far more than by the hole, and a pale
 * rectangle with no surround reads as a stain on the wall.
 */
export function lancet(
  b: Build,
  s: Side,
  plane: number,
  u: number,
  sill: number,
  ww: number,
  spring: number,
  rise: number,
  o: LancetOpts,
): Hole {
  const hw = ww / 2;
  const ys = sill + spring;
  const yt = ys + rise;
  const mid = (sill + yt) / 2;
  const ring = Math.min(0.2, ww * 0.24);
  if (o.lit) {
    const c = outward(s) * (plane + 0.015);
    if (runsAlongX(s)) b.glow(ww, yt - sill, 0.05, u, mid, c, o.lit);
    else b.glow(0.05, yt - sill, ww, c, mid, u, o.lit);
  } else {
    onFace(b, s, plane, u, mid, ww, yt - sill, 0.06, 0.01, CASEMENT);
  }
  for (const k of [-1, 1]) {
    facePoly(b, s, plane, [[u + k * (hw + 0.03), ys - 0.01], [u + k * (hw + 0.03), yt + 0.04], [u, yt + 0.04]], 0, 0.056, o.fill);
  }
  archRing(b, s, plane, u, ys, ww, rise, ring / 2, ring, 0.15, 0.035, o.dress);
  // The jambs, from the sill to the springing.
  const n = Math.max(2, Math.round(spring / 0.4));
  const jh = spring / n;
  for (const k of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const len = i % 2 === 0 ? ring + 0.1 : ring;
      onFace(b, s, plane, u + k * (hw + len / 2), sill + (i + 0.5) * jh, len, jh - 0.012, 0.15, 0.035, o.dress);
    }
  }
  // A weathered sill on the outside, a deep splayed one within.
  onFace(b, s, plane, u, sill - 0.07, ww + 2 * ring + 0.12, 0.14, o.hood ? 0.26 : 0.3, o.hood ? 0.09 : 0.1, o.dress);
  if (o.hood) {
    archRing(b, s, plane, u, ys, ww, rise, ring + 0.06, 0.1, 0.2, 0.06, o.dress);
    const [ue] = archArc(u, ys, ww, rise, ring + 0.06, 1)[0];
    for (const k of [-1, 1]) onFace(b, s, plane, k < 0 ? ue : 2 * u - ue, ys - 0.1, 0.14, 0.22, 0.22, 0.07, o.dress);
  }
  if (o.cames) {
    // Diamond quarries: two families of leads clipped to the light's outline
    // (the rectangle and the chord of its head, which the ring covers the
    // rest of), and two saddle bars across the rectangle.
    const poly: [number, number][] = [
      [u - hw, sill],
      [u + hw, sill],
      [u + hw, ys],
      [u, yt],
      [u - hw, ys],
    ];
    const m = 1.7;
    const pitch = Math.min(0.26, ww / 3);
    const span = (yt - sill) / m;
    for (const sign of [1, -1]) {
      const slope = sign * m;
      for (let a = u - hw - span - pitch * 0.5; a < u + hw + span; a += pitch) {
        // The line through (a, sill) rising at `slope`, clipped Cyrus-Beck.
        let t0 = -Infinity;
        let t1 = Infinity;
        for (let i = 0; i < poly.length; i++) {
          const [ex, ey] = poly[i];
          const [fx, fy] = poly[(i + 1) % poly.length];
          const nx = -(fy - ey);
          const ny = fx - ex;
          const num = nx * (a - ex) + ny * (sill - ey);
          const den = nx * 1 + ny * slope;
          if (Math.abs(den) < 1e-9) {
            if (num < 0) t1 = -Infinity;
            continue;
          }
          const t = -num / den;
          if (den > 0) t0 = Math.max(t0, t);
          else t1 = Math.min(t1, t);
        }
        if (t1 - t0 < 0.05) continue;
        const tm = (t0 + t1) / 2;
        const len = (t1 - t0) * Math.hypot(1, slope);
        onFace(b, s, plane, a + tm, sill + slope * tm, len, 0.022, 0.02, 0.055, IRON, Math.atan(slope));
      }
    }
    for (let i = 1; i <= 2; i++) {
      const y = sill + (i * spring) / 3;
      onFace(b, s, plane, u, y, ww, 0.032, 0.03, 0.06, IRON);
    }
  }
  return { u0: u - hw - ring - 0.12, u1: u + hw + ring + 0.12, y0: sill - 0.15, y1: yt + ring + 0.18 };
}

/**
 * A buttress in two stages, each stepped back under a sloped weathering and
 * the top one weathered into the wall — and, when asked, the two boxes that
 * make it one to a body and a round. `wide` is along the face, `deep0` and
 * `deep1` how far each stage stands off it.
 *
 * **Bedded on the face, never centred in the wall** — which is the whole of
 * what was wrong with the old chapel's: ten boxes 0.5 m deep at `x = ±w / 2`,
 * the middle of a 0.6 m wall, so every one of them was inside the stone. The
 * weatherings are lichened, being the one up-facing ledge on a flank.
 */
export function buttress(
  b: Build,
  s: Side,
  plane: number,
  u: number,
  o: { y0: number; step: number; top: number; wide: number; deep0: number; deep1: number; collide: boolean },
): void {
  const { y0, step, top, wide, deep0, deep1 } = o;
  const u0 = u - wide / 2;
  const u1 = u + wide / 2;
  onFace(b, s, plane, u, (y0 + step) / 2, wide, step - y0, deep0, deep0 / 2, STONE);
  offFacePoly(b, s, plane, [[deep1, step], [deep0 + 0.05, step], [deep1, step + (deep0 - deep1) * 1.2]], u0, u1, MOSS_STONE);
  onFace(b, s, plane, u, step - 0.06, wide + 0.06, 0.12, deep0 + 0.05, (deep0 + 0.05) / 2, DARK_STONE);
  onFace(b, s, plane, u, (step + top) / 2, wide - 0.08, top - step, deep1, deep1 / 2, STONE);
  offFacePoly(b, s, plane, [[0, top], [deep1 + 0.05, top], [0, top + deep1 * 1.3]], u0 + 0.04, u1 - 0.04, MOSS_STONE);
  if (o.collide) {
    faceBlock(b, s, plane, u, (y0 + step) / 2, wide, step - y0, deep0, deep0 / 2);
    faceBlock(b, s, plane, u, (step + top) / 2, wide - 0.08, top - step, deep1, deep1 / 2);
  }
}
