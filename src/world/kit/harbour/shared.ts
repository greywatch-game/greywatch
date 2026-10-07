/**
 * kit/harbour/shared.ts — The words more than one building on the working
 * coast is drawn with: `bar` (a straight member into a batch), `splitRun` (a
 * run cut into stones whose joints break), the tarred lapped boarding and the
 * window cut into it (`lapCourse`, `boardedWindow`, `Cut`), `NET_PAINTS` (a
 * net loft's door paints, which the crane's winch house wears too) and
 * `TRANSLUCENCY`, the setting a hung net is drawn translucent by. Part of the
 * volcanic-coast set: follows the contract in kit/core.ts and the set's rules
 * in `./index.ts`. Invariants: drawing only — nothing here declares a
 * collider — and `boardedWindow` draws from the `rnd` it is handed only for a
 * dark window, and once, so its callers' seeded order is theirs to keep.
 * Never builds a building, and never imports one.
 */
import { CONFIG } from "../../../config";
import {
  Build,
  type Point3,
  type Side,
  StoneBatch,
  carve,
  hideBack,
  orient,
  outward,
  runsAlongX,
  FLAME,
  IRON,
  PITCH,
  PLANK,
  RUST,
  SAILCLOTH,
  TEAK,
} from "../core";

export const TRANSLUCENCY = CONFIG.graphics.translucency;

/** A straight member from `a` to `c` into a batch: a rail, an astragal, a rib. */
export function bar(sb: StoneBatch, a: Point3, c: Point3, wide: number, thick: number, color: string): void {
  const o = orient(a, c);
  sb.box(wide, thick, o.len, o.mid[0], o.mid[1], o.mid[2], color, o.rot);
}

/**
 * `[u0, u1]` cut into stones about `stone` long, every other course starting
 * on a half stone so the vertical joints break.
 */
export function splitRun(u0: number, u1: number, stone: number, broken: boolean): [number, number][] {
  const n = Math.max(1, Math.round((u1 - u0) / stone));
  const len = (u1 - u0) / n;
  const at = [u0];
  for (let i = 1; i < n; i++) at.push(u0 + (i - (broken ? 0.5 : 0)) * len);
  if (broken && n > 1) at.push(u1 - len / 2);
  at.push(u1);
  const out: [number, number][] = [];
  for (let i = 1; i < at.length; i++) if (at[i] - at[i - 1] > 0.2) out.push([at[i - 1], at[i]]);
  return out;
}

/** A rectangle cut out of a face's boarding: [u0, u1, y0, y1]. */
export type Cut = [number, number, number, number];

/** How far a lapped board's foot is tipped out from the face it is nailed to. */
const BOARD_TIP = 0.075;

/** One tarred lapped board on a face, its foot tipped out. */
function lapBoard(sb: StoneBatch, s: Side, plane: number, u: number, y: number, len: number, tall: number): void {
  const c = outward(s) * (plane + 0.022);
  if (runsAlongX(s)) sb.box(len, tall, 0.025, u, y, c, PITCH, { x: outward(s) * -BOARD_TIP }, hideBack(s));
  else sb.box(0.025, tall, len, c, y, u, PITCH, { z: outward(s) * BOARD_TIP }, hideBack(s));
}

/**
 * One course of lapped boarding from `u0` to `u1` between `yb` and `yt`, cut
 * round every opening it crosses — every course a shading band and a line for
 * the ink, which flat boards side by side are not.
 */
export function lapCourse(sb: StoneBatch, s: Side, plane: number, u0: number, u1: number, yb: number, yt: number, cuts: Cut[]): void {
  const hit = cuts.filter((c) => c[2] < yt && c[3] > yb).map((c): [number, number] => [c[0], c[1]]);
  for (const [a, c] of carve(u0, u1, hit)) {
    if (c - a > 0.05) lapBoard(sb, s, plane, (a + c) / 2, (yb + yt) / 2 - 0.015, c - a, yt - yb + 0.03);
  }
}

/** The width of the pale frame round a window in tarred boarding. */
const FRAME_W = 0.07;

/**
 * A window in tarred boarding, centred `u` along face `s` at height `y`: a
 * pale frame with a sill and a drip, and in it a lit pane with its shutters
 * open flat beside it, or — dark — either the shutters shut or dark glass
 * behind its bars, which is the one draw it takes from `rnd`. Returns the cut
 * the boarding owes it.
 */
export function boardedWindow(
  b: Build,
  sb: StoneBatch,
  rnd: () => number,
  s: Side,
  plane: number,
  u: number,
  y: number,
  gw: number,
  gh: number,
  lit: boolean,
  paint: string,
): Cut {
  const shut = !lit && rnd() < 0.55;
  if (lit) {
    const c = outward(s) * (plane + 0.012);
    if (runsAlongX(s)) b.glow(gw, gh, 0.02, u, y, c, FLAME);
    else b.glow(0.02, gh, gw, c, y, u, FLAME);
  } else if (!shut) {
    sb.onFace(s, plane, u, y, gw, gh, 0.02, 0.012, IRON);
  }
  sb.onFace(s, plane, u, y + gh / 2 + FRAME_W / 2, gw + 2 * FRAME_W, FRAME_W, 0.05, 0.045, SAILCLOTH);
  sb.onFace(s, plane, u, y - gh / 2 - FRAME_W / 2, gw + 2 * FRAME_W, FRAME_W, 0.05, 0.045, SAILCLOTH);
  for (const e of [-1, 1] as const) sb.onFace(s, plane, u + e * (gw / 2 + FRAME_W / 2), y, FRAME_W, gh, 0.05, 0.045, SAILCLOTH);
  sb.onFace(s, plane, u, y - gh / 2 - FRAME_W - 0.03, gw + 2 * FRAME_W + 0.14, 0.06, 0.15, 0.075, SAILCLOTH);
  sb.onFace(s, plane, u, y + gh / 2 + FRAME_W + 0.03, gw + 2 * FRAME_W + 0.08, 0.06, 0.1, 0.05, SAILCLOTH);
  const leaf = gw / 2 + FRAME_W;
  if (shut) {
    // Shut: three boards in the opening on two ledges.
    for (let i = 0; i < 3; i++) sb.onFace(s, plane, u - gw / 3 + (i * gw) / 3, y, gw / 3 - 0.012, gh, 0.03, 0.03, paint);
    for (const f of [-0.3, 0.3]) sb.onFace(s, plane, u, y + f * gh, gw - 0.04, 0.08, 0.025, 0.055, paint);
  } else {
    sb.onFace(s, plane, u, y, 0.03, gh, 0.025, 0.03, SAILCLOTH);
    sb.onFace(s, plane, u, y, gw, 0.03, 0.025, 0.03, SAILCLOTH);
    if (lit) {
      // Open: each leaf flat back against the boarding beside the frame.
      for (const e of [-1, 1] as const) {
        const lu = u + e * (gw / 2 + FRAME_W + 0.01 + leaf / 2);
        for (let i = 0; i < 3; i++) sb.onFace(s, plane, lu - leaf / 3 + (i * leaf) / 3, y, leaf / 3 - 0.01, gh + 2 * FRAME_W, 0.03, 0.06, paint);
        for (const f of [-0.32, 0.32]) sb.onFace(s, plane, lu, y + f * gh, leaf - 0.03, 0.08, 0.025, 0.085, paint);
      }
    }
  }
  return [u - gw / 2 - FRAME_W - 0.01, u + gw / 2 + FRAME_W + 0.01, y - gh / 2 - FRAME_W - 0.06, y + gh / 2 + FRAME_W + 0.06];
}

/**
 * What a net loft paints its doors and shutters: red oxide, or the brown of
 * the teak and plank the kit already has, so a street of them spends no new
 * colour on it.
 */
export const NET_PAINTS = [RUST, TEAK, PLANK] as const;
