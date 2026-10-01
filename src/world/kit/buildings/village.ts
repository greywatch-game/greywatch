/**
 * kit/buildings/village.ts — The words more than one village building is drawn
 * in: the elevations' members (`offFace`, `casement`, `doorway`, `framing`,
 * `boardUp`) laid over core.ts's `onFace`, the two lamplit colours, and the
 * numbers the roofs and boards share (`THATCH_PITCH`, `THATCH_DEPTH`,
 * `RAFTER_REMAINS`, `ROOF_PITCH`, `WEATHERBOARD`).
 * Invariants: VISUAL only — a house's masses and roof carry every collider it
 * has, and nothing here may add one.
 */
import {
  Build,
  carve,
  onFace,
  outward,
  runsAlongX,
  type Hole,
  type Side,
  CASEMENT,
  DARK_STONE,
  IRON,
  PLANK,
  TIMBER,
} from "../core";

// The words the cottage and the townhouse are drawn in, over `onFace` and
// `Side` in core.ts, because each lays the same member on four faces.
// Everything they make is VISUAL: the masses and the roof already carry every
// collider either building has, and nothing here may add one — see the header
// on `buildTownhouse`.

/** A lit room behind the same glass — the lamp colour the village has always had. */
export const LAMPLIT = "#ffb257";
/**
 * A lit SHOP window, which is the same room behind four times the glass. At
 * `LAMPLIT` a 4 m frontage bloomed into a lantern under Harrowmead's low sun —
 * `ROOM_GLOW`'s argument, that what an emissive may be is set by its AREA —
 * so the wide one is a step down and still reads as the same lamps.
 */
export const SHOPLIT = "#b3733a";
/**
 * A member standing OUT from a face, running from `r0` to `r1` past its plane
 * and from `y0` to `y1` as it goes: a bracket under the jetty, a stall board,
 * a sign's arm. `along` is its width on the run and `thick` its depth
 * vertically.
 */
export function offFace(
  b: Build,
  s: Side,
  plane: number,
  u: number,
  along: number,
  y0: number,
  y1: number,
  r0: number,
  r1: number,
  thick: number,
  color: string,
): void {
  const n = outward(s);
  const rise = Math.atan2(y1 - y0, r1 - r0);
  const len = Math.hypot(r1 - r0, y1 - y0);
  const c = n * (plane + (r0 + r1) / 2);
  const y = (y0 + y1) / 2;
  if (runsAlongX(s)) b.box(along, thick, len, u, y, c, color, rise ? { x: -n * rise } : undefined);
  else b.box(len, thick, along, c, y, u, color, rise ? { z: n * rise } : undefined);
}

/**
 * A casement: the glass (dark, or lamplit), a frame standing proud of the
 * plaster, a sill board, and mullions and a transom — which are what turn a
 * glowing rectangle into a window: a bright patch with no dark surround reads
 * as a stain on the wall, not an opening in it. `lit` names the lamplight
 * behind the glass, and `shutters` the leaves' paint, throwing a pair back
 * flat on the wall.
 */
export function casement(
  b: Build,
  s: Side,
  plane: number,
  u: number,
  sill: number,
  ww: number,
  wh: number,
  o: { lit?: string; shutters?: string; lights?: number } = {},
): Hole {
  const top = sill + wh;
  const mid = sill + wh / 2;
  if (o.lit) {
    const c = outward(s) * (plane + 0.015);
    if (runsAlongX(s)) b.glow(ww, wh, 0.05, u, mid, c, o.lit);
    else b.glow(0.05, wh, ww, c, mid, u, o.lit);
  } else {
    onFace(b, s, plane, u, mid, ww, wh, 0.06, 0.01, CASEMENT);
  }
  for (const k of [-1, 1]) {
    onFace(b, s, plane, u + k * (ww / 2 + 0.06), mid + 0.07, 0.12, wh + 0.14, 0.16, 0.04, TIMBER);
  }
  onFace(b, s, plane, u, top + 0.07, ww + 0.24, 0.14, 0.16, 0.04, TIMBER);
  onFace(b, s, plane, u, sill - 0.06, ww + 0.4, 0.12, 0.26, 0.09, TIMBER);
  const lights = o.lights ?? (ww > 0.75 ? 2 : 1);
  for (let i = 1; i < lights; i++) {
    onFace(b, s, plane, u - ww / 2 + (i * ww) / lights, mid, 0.07, wh, 0.1, 0.04, TIMBER);
  }
  onFace(b, s, plane, u, sill + wh * 0.7, ww, 0.07, 0.1, 0.04, TIMBER);

  let reach = ww / 2 + 0.12;
  if (o.shutters) {
    const leaf = ww / 2;
    for (const k of [-1, 1]) {
      const lu = u + k * (ww / 2 + 0.14 + leaf / 2);
      onFace(b, s, plane, lu, mid, leaf, wh, 0.06, 0.04, o.shutters);
      for (const y of [sill + 0.22, top - 0.22]) {
        onFace(b, s, plane, lu, y, leaf - 0.08, 0.09, 0.03, 0.085, TIMBER);
      }
    }
    reach += leaf + 0.04;
  }
  return { u0: u - reach, u1: u + reach, y0: sill - 0.12, y1: top + 0.14 };
}

/**
 * A doorway on the plinth: jambs, a head, a stone step, and — when `leaf`
 * names a paint — a ledged door shut in it, with its seams, its strap hinges
 * and its latch. `null` draws the frame alone, round an opening the walls
 * have already left (an enterable ground floor's).
 */
export function doorway(
  b: Build,
  s: Side,
  plane: number,
  stepPlane: number,
  u: number,
  dw: number,
  dh: number,
  leaf: string | null,
): Hole {
  const foot = 0.3; // the plinth's top
  const top = foot + dh;
  for (const k of [-1, 1]) {
    onFace(b, s, plane, u + k * (dw / 2 + 0.09), (foot + top + 0.2) / 2, 0.18, dh + 0.2, 0.18, 0.05, TIMBER);
  }
  onFace(b, s, plane, u, top + 0.1, dw + 0.46, 0.2, 0.18, 0.05, TIMBER);
  onFace(b, s, stepPlane, u, 0.08, dw + 0.5, 0.16, 0.4, 0.2, DARK_STONE);
  if (leaf) {
    const mid = foot + dh / 2;
    onFace(b, s, plane, u, mid, dw, dh, 0.06, 0.02, leaf);
    for (let k = 1; k < 4; k++) {
      onFace(b, s, plane, u - dw / 2 + (k * dw) / 4, mid, 0.025, dh - 0.06, 0.02, 0.055, TIMBER);
    }
    for (const y of [foot + 0.4, top - 0.4]) {
      onFace(b, s, plane, u - dw * 0.12, y, dw * 0.72, 0.07, 0.02, 0.065, IRON);
    }
    onFace(b, s, plane, u + dw * 0.36, foot + dh * 0.48, 0.07, 0.12, 0.04, 0.07, IRON);
  }
  return { u0: u - dw / 2 - 0.2, u1: u + dw / 2 + 0.2, y0: 0, y1: top + 0.2 };
}

/**
 * The frame of one storey on one face, between its corner posts: posts at a
 * pitch, an optional rail, and a brace in each end panel — every member
 * stopped at an opening rather than drawn across it, which is what a real
 * frame does, since the window was framed into it.
 *
 * `close` is close studding, the street front's display; `panel` is square
 * framing with a brace at each end, what the other three faces are built in.
 * A post that would only graze an opening's frame is left out rather than
 * drawn as a sliver beside it.
 */
export function framing(
  b: Build,
  s: Side,
  plane: number,
  half: number,
  y0: number,
  y1: number,
  rail: number | null,
  holes: Hole[],
  style: "close" | "panel",
): void {
  const inner = half - 0.22; // the corner posts' inner edge
  const pitch = style === "close" ? 0.52 : 1.35;
  const pw = style === "close" ? 0.15 : 0.2;
  const n = Math.max(1, Math.round((2 * inner) / pitch));
  const posts: number[] = [];
  for (let i = 1; i < n; i++) {
    const u = -inner + (i * 2 * inner) / n;
    const hit = holes.filter((h) => u + pw / 2 > h.u0 - 0.06 && u - pw / 2 < h.u1 + 0.06);
    if (hit.some((h) => u < h.u0 + 0.1 || u > h.u1 - 0.1)) continue;
    posts.push(u);
    const cuts = hit.map((h): [number, number] => [h.y0, h.y1]);
    for (const [a, c] of carve(y0, y1, cuts)) {
      if (c - a > 0.15) onFace(b, s, plane, u, (a + c) / 2, pw, c - a, 0.14, 0.03, TIMBER);
    }
  }
  if (rail !== null) {
    const cuts = holes
      .filter((h) => rail + 0.08 > h.y0 && rail - 0.08 < h.y1)
      .map((h): [number, number] => [h.u0, h.u1]);
    for (const [a, c] of carve(-inner, inner, cuts)) {
      if (c - a > 0.15) onFace(b, s, plane, (a + c) / 2, rail, c - a, 0.16, 0.14, 0.03, TIMBER);
    }
  }
  if (style !== "panel") return;
  // A brace in each end panel, high at the corner and low toward the middle,
  // in the deeper of the two bands the rail leaves (or the whole storey).
  let lo = y0 + 0.02;
  let hi = y1 - 0.02;
  if (rail !== null) {
    if (rail - y0 > y1 - rail) hi = rail - 0.08;
    else lo = rail + 0.08;
  }
  for (const k of [-1, 1]) {
    const edge = k * inner;
    const next = posts.length ? (k > 0 ? posts[posts.length - 1] : posts[0]) : 0;
    const span = Math.abs(edge - next) - 0.1;
    if (span < 0.5) continue;
    const uIn = edge - k * span;
    const [ua, ub] = k > 0 ? [uIn, edge] : [edge, uIn];
    if (holes.some((h) => h.u1 > ua - 0.05 && h.u0 < ub + 0.05 && h.y1 > lo && h.y0 < hi)) continue;
    const du = edge - uIn;
    const dy = hi - lo;
    onFace(b, s, plane, (edge + uIn) / 2, (lo + hi) / 2, Math.hypot(du, dy), 0.16, 0.12, 0.02, TIMBER, Math.atan2(dy, du));
  }
}

/** Planks nailed across an opening, alternately canted: a house nobody is coming back to. */
export function boardUp(
  b: Build,
  s: Side,
  plane: number,
  u: number,
  y0: number,
  y1: number,
  across: number,
  out: number,
): void {
  const n = Math.max(2, Math.round((y1 - y0) / 0.55));
  for (let i = 0; i < n; i++) {
    const y = y0 + ((i + 0.5) * (y1 - y0)) / n;
    onFace(b, s, plane, u, y, across + 0.3, 0.17, 0.04, out, PLANK, (i % 2 === 0 ? 1 : -1) * 0.13);
  }
}

/**
 * A cottage roof's pitch, as rise over run. A property of THATCH rather than
 * of the house — a coat of reed sheds water only at about this angle — so it is
 * one number for every width, and a wider cottage is a taller roof.
 */
export const THATCH_PITCH = 0.62;
/** How deep a coat of thatch is, which is what its eave and verge read as. */
export const THATCH_DEPTH = 0.4;
/**
 * What a burnt roof's rafters reach as a fraction of their run, walked in
 * order from a seeded start — `buildBarn`'s board widths, for the same reason.
 */
export const RAFTER_REMAINS = [1, 0.5, 0.85, 0.3, 1, 0.65, 0.4] as const;

/**
 * Painted weatherboard: the mill's upper storeys. A pale board over dark
 * trims is what a village mill's timber half is recognised by, and it is lighter
 * than `PLASTER` so the lapped courses carry their shading bands.
 */
export const WEATHERBOARD = "#7d776a";

/**
 * A slate roof's pitch, as rise over run: the tavern's, the smithy's and the
 * mill's. The chapel's is steeper (`CHAPEL_PITCH`).
 */
export const ROOF_PITCH = 0.62;
