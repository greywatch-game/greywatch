/**
 * kit/city/monument.ts — buildMonument: the war memorial, its stroke-font
 * inscription, its laurels and poppies and the bronze soldier on top. Part of
 * the downtown set: follows the contract in kit/core.ts and the set's rules
 * in `./index.ts`.
 */
import { Scene } from "@babylonjs/core";
import { CONFIG } from "../../../config";
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import { mulberry32 } from "../../rng";
import {
  Build,
  type BuildParams,
  type Structure,
  ASHLAR,
  CONCRETE,
  DARK_CONCRETE,
  IRON,
  LAMP_RED,
  ROAD_PAINT,
  StoneBatch,
  VERDIGRIS,
  convexSolid,
  limb,
  slab,
  type Point3,
  streetSeed,
  HIDE_UNDER,
  hideBack,
  runsAlongX,
  type Side,
} from "../core";

/**
 * Cast bronze after fifty years out of doors: a dark patina, green only a
 * little. `VERDIGRIS` is the colour of the streak and read as painted tin over
 * a whole figure — the up-facing surfaces of a statue against the sky come
 * back the stop and a half lighter every level face does — so the casting is
 * this and the streak stays where it is, on the rolls of honour's raised
 * letters.
 */
const BRONZE = "#33413b";

/**
 * The civic monument at the middle of a square: an interwar war memorial.
 *
 * The steps are 0.34 m, inside `CONFIG.nav.stepHeight`, so the whole thing
 * links to the pavement from every bearing and needs no ramp — a plinth a bot
 * cannot climb is a plinth that makes the flag on it uncapturable, which is a
 * failure with nothing to see. Each tier is its own collider for that reason
 * and not for the look.
 *
 * A control point may stand on the top tier, but its `pos` must NOT be inside
 * the shaft: `surfaceAt` returns -1 inside a collider, and a flag whose centre
 * is in one cannot be captured at all. Coldharbour's does, at (2.5, 2.5), so
 * **nothing drawn on the top tier may stand taller than a wreath** — the flag
 * and its ring are the tier's, and every tread is drawn with its top on its
 * collider's top so the ring's paint (18 mm over the box) is never buried.
 *
 * What it is drawn as, and it is one building on three maps, so it is the
 * kind of memorial every town of the period put up rather than any one town's:
 *
 * - **Three granite steps** laid as stones rather than poured: a course of
 *   step blocks round each edge with a NOSING standing 2.5 cm proud of the
 *   riser, flags filling the tread behind them, every joint 16 mm open over a
 *   core set back, so the ink draws the bond for free.
 * - **A pale ashlar die** on a granite plinth course, its four faces framed by
 *   corner blocks and rails round a sunk field, under a moulded cap. The front
 *   field is INSCRIBED — real letters, a stroke font below, cut dark into the
 *   pale stone — and the other three carry bronze rolls of honour, raised
 *   bronze on a dark patinated ground, since bronze on bronze has no value to
 *   read by.
 * - **A shaft of ashlar laid in a pinwheel bond**, the long stones turning a
 *   quarter every course so the corner joints break, carrying a bronze sword
 *   point-down on the two broad faces, a laurel wreath and the two wars' dates
 *   on the other two, and a frieze of small wreaths under the cornice.
 * - **A bronze soldier at rest on arms reversed** on an attic over the
 *   cornice, head bowed over the butt of his rifle — the finial the old shaft
 *   had was a spike, and a memorial's silhouette is the figure.
 * - **Poppy wreaths** laid against the die, seeded one or two.
 *
 * The colliders are unchanged and in the same order (a block per tier, the
 * die, the shaft). Everything else is drawing and obeys one of the three
 * rules: flat on a face (the plinth, rails, nosings, the bronze — at most 6 cm
 * proud), low (the wreaths, under 0.5 m and against the die), or standing on a
 * collider's top (the shaft's own plinth on the die, the cornice, the attic
 * and the figure on the shaft). Nothing is drawn INSIDE a collider's faces by
 * more than the 3 cm a sunk field or a joint needs.
 *
 * Colours are the city's own — granite in `CONCRETE`, the pale stone in
 * `ASHLAR`, cores in `DARK_CONCRETE` — plus `BRONZE` for the casting, the one
 * colour this adds (see its comment), `VERDIGRIS` for the tablets' raised
 * letters, and `LAMP_RED` and `IRON` for the poppies and the tablets' ground.
 * Every stone, letter and leaf is one `StoneBatch` surface per colour: ~28 k
 * vertices, placed once a map.
 */
export function buildMonument(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "monument");
  const w = p.width ?? 11;
  const step = 0.34;
  if (import.meta.env.DEV && step > CONFIG.nav.stepHeight) {
    throw new Error(
      `monument: a ${step} m tier is over stepHeight (${CONFIG.nav.stepHeight}) ` +
        "and would strand its own top — see buildMonument.",
    );
  }
  // ---- the colliders, as they always were and in the same order ----------
  for (let i = 0; i < 3; i++) {
    const s = w - i * 2.2;
    const y = (i + 1) * step;
    b.block({ w: s, h: step, d: s, x: 0, y: y - step / 2, z: 0 });
  }
  const base = 3 * step;
  b.block({ w: 2.4, h: 1.0, d: 2.4, x: 0, y: base + 0.5, z: 0 });
  b.block({ w: 1.3, h: 8.0, d: 1.3, x: 0, y: base + 5.0, z: 0 });

  // ---- the drawing ---------------------------------------------------------
  const rnd = mulberry32(streetSeed(w, w, 10));
  const sb = new StoneBatch();
  const SIDES: readonly Side[] = ["-z", "+z", "-x", "+x"];
  /** The joint between two stones. */
  const g = 0.016;

  // The three steps. A ring of step blocks round each edge, nosed; flags
  // behind them out to the next riser; the top tier flagged in two courses
  // round the die.
  for (let i = 0; i < 3; i++) {
    const half = (w - i * 2.2) / 2;
    const top = (i + 1) * step;
    const ring = 0.55;
    monumentCourse(sb, half - ring, half, top, step, CONCRETE, 1.0, 1.8, rnd, true);
    const inner = i < 2 ? (w - (i + 1) * 2.2) / 2 : 1.2;
    const flags = half - ring - g - inner;
    const courses = Math.max(1, Math.round(flags / 0.8));
    for (let c = 0; c < courses; c++) {
      const hOut = half - ring - g - (c * flags) / courses;
      monumentCourse(sb, hOut - flags / courses, hOut, top, 0.08, CONCRETE, 0.6, 1.1, rnd, false);
    }
  }

  // The die: a granite plinth course, corner blocks and rails round a sunk
  // field on each face, and a moulded cap.
  const die = 1.2;
  const field = die - 0.03;
  monumentCourse(sb, die - 0.3, die + 0.06, base + 0.2, 0.2, CONCRETE, 0.7, 1.0, rnd, false);
  const dy0 = base + 0.2;
  const dy1 = base + 0.86;
  for (const cx of [-1, 1]) {
    for (const cz of [-1, 1]) {
      sb.box(0.3, dy1 - dy0, 0.3, cx * (die - 0.15), (dy0 + dy1) / 2, cz * (die - 0.15), ASHLAR, undefined, HIDE_UNDER);
    }
  }
  for (const s of SIDES) {
    const hb = hideBack(s) | HIDE_UNDER;
    const along = 2 * (die - 0.3) - 2 * g;
    sb.onFace(s, die, 0, dy0 + 0.05, along, 0.1, 0.08, -0.04, ASHLAR, 0, 0, hb);
    sb.onFace(s, die, 0, dy1 - 0.05, along, 0.1, 0.08, -0.04, ASHLAR, 0, 0, hb);
  }
  // The cap: a sloped bed mould, then a corona 6 cm over the die's faces. A
  // slope rather than a second step: two steps of 2-3 cm each are under what
  // the ink can hold at ten metres, and broke into dashes along the die.
  const square = (h: number, y: number): Point3[] => [[-h, y, -h], [h, y, -h], [h, y, h], [-h, y, h]];
  convexSolid(b, square(die, dy1), square(die + 0.06, dy1 + 0.07), ASHLAR);
  sb.box(2.52, 0.07, 2.52, 0, base + 1.0 - 0.035, 0, ASHLAR);

  // The front field is cut: three lines, dark in the pale stone.
  const lines = ["THEIR NAME", "LIVETH FOR", "EVERMORE"];
  lines.forEach((t, k) => monumentInscribe(sb, "-z", field, t, base + 0.66 - k * 0.15, 0.1, DARK_CONCRETE));
  // The other three carry the names, cast: a dark ground, a raised border,
  // a heading and two columns of names in bronze.
  for (const s of ["+z", "-x", "+x"] as const) {
    const hb = hideBack(s);
    const yc = (dy0 + dy1) / 2;
    sb.onFace(s, field, 0, yc, 1.56, 0.42, 0.02, 0.01, IRON, 0, 0, hb);
    for (const e of [-1, 1]) {
      sb.onFace(s, field, 0, yc + e * 0.195, 1.56, 0.03, 0.026, 0.013, VERDIGRIS, 0, 0, hb);
      sb.onFace(s, field, e * 0.765, yc, 0.03, 0.42, 0.026, 0.013, VERDIGRIS, 0, 0, hb);
    }
    sb.onFace(s, field, 0, yc + 0.135, 0.5 + rnd() * 0.2, 0.03, 0.026, 0.013, VERDIGRIS, 0, 0, hb);
    // Ranged left as the face is read, which on two of the three is -u.
    const read = s === "+x" ? 1 : -1;
    for (const col of [-1, 1]) {
      for (let r = 0; r < 5; r++) {
        const len = 0.3 + rnd() * 0.32;
        const u0 = col * 0.36 - 0.33;
        sb.onFace(s, field, read * (u0 + len / 2), yc + 0.07 - r * 0.052, len, 0.02, 0.024, 0.012, VERDIGRIS, 0, 0, hb);
      }
    }
  }

  // The shaft: its own plinth standing on the die, a chamfer, then ten
  // courses of ashlar in a pinwheel bond up to a string course.
  const sh = 0.65;
  sb.box(1.56, 0.4, 1.56, 0, base + 1.2, 0, ASHLAR, undefined, HIDE_UNDER);
  convexSolid(b, square(0.78, base + 1.4), square(sh, base + 1.5), ASHLAR);
  const s0 = base + 1.5;
  const s1 = base + 8.38;
  const nCourse = 10;
  const ch = (s1 - s0) / nCourse;
  for (let k = 0; k < nCourse; k++) {
    const y = s0 + (k + 0.5) * ch - g / 2;
    for (const s of SIDES) {
      const long = runsAlongX(s) === (k % 2 === 0);
      const along = long ? 2 * sh : 2 * sh - 0.4 - 2 * g;
      sb.onFace(s, sh, 0, y, along, ch - g, 0.2, -0.1, ASHLAR, 0, 0, hideBack(s) | HIDE_UNDER);
    }
  }
  // A sword point-down on each broad face.
  for (const s of ["-z", "+z"] as const) {
    const hb = hideBack(s);
    const bronze = (u: number, y: number, along: number, tall: number, thick: number, tilt = 0): void =>
      sb.onFace(s, sh, u, y, along, tall, thick, thick / 2, BRONZE, tilt, 0, hb);
    const tip = base + 2.75;
    const hilt = base + 5.45;
    bronze(0, (tip + hilt) / 2, 0.15, hilt - tip, 0.035);
    bronze(0, (tip + hilt) / 2 + 0.02, 0.03, hilt - tip - 0.12, 0.045);
    bronze(0, tip, 0.106, 0.106, 0.035, Math.PI / 4);
    bronze(0, hilt + 0.05, 0.7, 0.1, 0.06);
    for (const e of [-1, 1]) bronze(e * 0.37, hilt + 0.05, 0.09, 0.09, 0.07, Math.PI / 4);
    bronze(0, hilt + 0.3, 0.07, 0.4, 0.05);
    for (let r = 0; r < 3; r++) bronze(0, hilt + 0.18 + r * 0.12, 0.085, 0.022, 0.06);
    bronze(0, hilt + 0.57, 0.11, 0.11, 0.065, Math.PI / 4);
  }
  // A wreath and the dates on each narrow face.
  const dates: Record<"-x" | "+x", [string, string]> = { "+x": ["1914", "1918"], "-x": ["1939", "1945"] };
  for (const s of ["-x", "+x"] as const) {
    monumentLaurel(sb, s, sh, 0, base + 6.55, 0.33, BRONZE);
    monumentInscribe(sb, s, sh, dates[s][0], base + 4.85, 0.2, DARK_CONCRETE);
    monumentInscribe(sb, s, sh, "-", base + 4.55, 0.2, DARK_CONCRETE);
    monumentInscribe(sb, s, sh, dates[s][1], base + 4.25, 0.2, DARK_CONCRETE);
  }

  // The head of the shaft: a string course, a frieze with a small wreath on
  // each face, and the cornice — a bed mould, a corona and a sloped cymatium.
  sb.box(1.36, 0.06, 1.36, 0, s1 + 0.03, 0, ASHLAR);
  for (const s of SIDES) monumentLaurel(sb, s, sh, 0, s1 + 0.3, 0.12, BRONZE);
  sb.box(1.44, 0.12, 1.44, 0, base + 8.94, 0, ASHLAR);
  sb.box(1.72, 0.18, 1.72, 0, base + 9.09, 0, ASHLAR);
  convexSolid(b, square(0.86, base + 9.18), square(0.58, base + 9.32), ASHLAR);
  // The attic the figure stands on, and its cap.
  sb.box(1.04, 0.56, 1.04, 0, base + 9.6, 0, ASHLAR, undefined, HIDE_UNDER);
  sb.box(1.18, 0.1, 1.18, 0, base + 9.93, 0, ASHLAR);

  // Poppy wreaths laid against the die: one at a corner of the front, and a
  // second there or round the back. Under the inscription's last line, which
  // is narrower than the field, so nothing cut is hidden.
  const lean = 0.2;
  const wr = 0.21;
  const wy = base + 0.03 + wr * Math.cos(lean);
  const first = rnd() < 0.5 ? -1 : 1;
  monumentPoppies(sb, first * 0.8, wy, -(die + 0.03 + wr * Math.sin(lean)), wr, lean, rnd);
  if (rnd() < 0.5) monumentPoppies(sb, -first * 0.8, wy, -(die + 0.03 + wr * Math.sin(lean)), wr, lean, rnd);
  else monumentPoppies(sb, 0, wy, die + 0.03 + wr * Math.sin(lean), wr, -lean, rnd);

  // The stones, and only then the cores they hide.
  sb.flush(b);
  for (let i = 0; i < 3; i++) {
    const s = w - i * 2.2 - 0.1;
    const top = (i + 1) * step - 0.04;
    const bot = i === 0 ? -0.2 : i * step;
    b.box(s, top - bot, s, 0, (top + bot) / 2, 0, DARK_CONCRETE);
  }
  b.box(2 * field, dy1 - dy0, 2 * field, 0, (dy0 + dy1) / 2, 0, ASHLAR);
  b.box(2 * sh - 0.06, s1 - s0, 2 * sh - 0.06, 0, (s0 + s1) / 2, 0, CONCRETE);
  b.box(2 * sh, 0.44, 2 * sh, 0, s1 + 0.28, 0, ASHLAR);

  monumentSoldier(b, base + 9.98);
  return b;
}

/**
 * A square course of stones between two half-widths, its top at `top`: a
 * square in each corner and runs between them in seeded lengths, each 16 mm
 * shy of the next so the core behind shows as a joint. A `nosed` course is a
 * flight's step blocks and stands a lip 2.5 cm proud along its top edge.
 */
function monumentCourse(
  sb: StoneBatch,
  hIn: number,
  hOut: number,
  top: number,
  t: number,
  color: string,
  min: number,
  max: number,
  rnd: () => number,
  nosed: boolean,
): void {
  const g = 0.016;
  const deep = hOut - hIn - g;
  const mid = hOut - deep / 2;
  const y = top - t / 2;
  for (const s of ["-z", "+z", "-x", "+x"] as const) {
    const hb = hideBack(s) | HIDE_UNDER;
    let u = -hIn;
    const runs: [number, number][] = [];
    while (hIn - u > max) {
      const l = min + rnd() * (max - min);
      runs.push([u, u + l]);
      u += l;
    }
    if (runs.length && hIn - u < min) runs[runs.length - 1][1] = hIn;
    else runs.push([u, hIn]);
    for (const [u0, u1] of runs) {
      const along = u1 - u0 - g;
      sb.onFace(s, hOut, (u0 + u1) / 2, y, along, t, deep, -deep / 2, color, 0, 0, hb);
      if (nosed) sb.onFace(s, hOut, (u0 + u1) / 2, top - 0.025, along, 0.05, 0.04, 0.005, color, 0, 0, hideBack(s));
    }
  }
  for (const cx of [-1, 1]) {
    for (const cz of [-1, 1]) {
      sb.box(deep, t, deep, cx * mid, y, cz * mid, color, undefined, HIDE_UNDER);
      if (!nosed) continue;
      const lip = deep + 0.025;
      sb.onFace(cz < 0 ? "-z" : "+z", hOut, cx * (mid + 0.0125), top - 0.025, lip, 0.05, 0.04, 0.005, color, 0, 0, 0);
      sb.onFace(cx < 0 ? "-x" : "+x", hOut, cz * (mid + 0.0125), top - 0.025, lip, 0.05, 0.04, 0.005, color, 0, 0, 0);
    }
  }
}

/**
 * Capitals and figures as strokes on a grid three wide and four tall, for
 * cutting into stone. Only what the monument says is drawn; anything else is
 * a space.
 */
const MONUMENT_GLYPHS: Readonly<Record<string, readonly (readonly [number, number, number, number])[]>> = {
  A: [[0, 0, 1.5, 4], [1.5, 4, 3, 0], [0.7, 1.4, 2.3, 1.4]],
  E: [[0, 0, 0, 4], [0, 4, 2.6, 4], [0, 2, 2.1, 2], [0, 0, 2.6, 0]],
  F: [[0, 0, 0, 4], [0, 4, 2.6, 4], [0, 2, 2.1, 2]],
  H: [[0, 0, 0, 4], [3, 0, 3, 4], [0, 2, 3, 2]],
  I: [[0, 0, 0, 4]],
  L: [[0, 4, 0, 0], [0, 0, 2.6, 0]],
  M: [[0, 0, 0, 4], [0, 4, 1.75, 0.8], [1.75, 0.8, 3.5, 4], [3.5, 4, 3.5, 0]],
  N: [[0, 0, 0, 4], [0, 4, 3, 0], [3, 0, 3, 4]],
  O: [[1, 0, 2, 0], [2, 0, 3, 1], [3, 1, 3, 3], [3, 3, 2, 4], [2, 4, 1, 4], [1, 4, 0, 3], [0, 3, 0, 1], [0, 1, 1, 0]],
  R: [[0, 0, 0, 4], [0, 4, 2.2, 4], [2.2, 4, 3, 3.3], [3, 3.3, 3, 2.7], [3, 2.7, 2.2, 2], [2.2, 2, 0, 2], [1.4, 2, 3, 0]],
  T: [[0, 4, 3, 4], [1.5, 4, 1.5, 0]],
  V: [[0, 4, 1.5, 0], [1.5, 0, 3, 4]],
  "-": [[0.4, 2, 2.6, 2]],
  "1": [[0, 3.2, 1, 4], [1, 4, 1, 0]],
  "3": [[0, 3.4, 0.6, 4], [0.6, 4, 2.4, 4], [2.4, 4, 3, 3.4], [3, 3.4, 3, 2.6], [3, 2.6, 2.4, 2], [2.4, 2, 1, 2], [2.4, 2, 3, 1.4], [3, 1.4, 3, 0.6], [3, 0.6, 2.4, 0], [2.4, 0, 0.6, 0], [0.6, 0, 0, 0.6]],
  "4": [[2.2, 0, 2.2, 4], [2.2, 4, 0, 1.2], [0, 1.2, 3, 1.2]],
  "5": [[3, 4, 0.2, 4], [0.2, 4, 0, 2.2], [0, 2.2, 2.4, 2.2], [2.4, 2.2, 3, 1.6], [3, 1.6, 3, 0.6], [3, 0.6, 2.4, 0], [2.4, 0, 0.6, 0], [0.6, 0, 0, 0.6]],
  "8": [[0.6, 2, 2.4, 2], [0.6, 2, 0, 2.6], [0, 2.6, 0, 3.4], [0, 3.4, 0.6, 4], [0.6, 4, 2.4, 4], [2.4, 4, 3, 3.4], [3, 3.4, 3, 2.6], [3, 2.6, 2.4, 2], [0.6, 2, 0, 1.4], [0, 1.4, 0, 0.6], [0, 0.6, 0.6, 0], [0.6, 0, 2.4, 0], [2.4, 0, 3, 0.6], [3, 0.6, 3, 1.4], [3, 1.4, 2.4, 2]],
  "9": [[3, 2.2, 0.6, 2.2], [0.6, 2.2, 0, 2.8], [0, 2.8, 0, 3.4], [0, 3.4, 0.6, 4], [0.6, 4, 2.4, 4], [2.4, 4, 3, 3.4], [3, 3.4, 3, 0.6], [3, 0.6, 2.4, 0], [2.4, 0, 0.4, 0]],
};

/**
 * One line of cut letters, centred on face `s` with its foot at `y` and its
 * capitals `h` tall. Laid in the order the face is READ: looking at it from
 * outside, +X runs to the right on -Z, +Z on +X, -X on +Z and -Z on -X.
 */
function monumentInscribe(sb: StoneBatch, s: Side, plane: number, text: string, y: number, h: number, color: string): void {
  const unit = h / 4;
  const sw = h * 0.14;
  const gap = unit * 1.1;
  const sgn = s === "-z" || s === "+x" ? 1 : -1;
  const chars = [...text];
  const widths = chars.map((c) => {
    const k = MONUMENT_GLYPHS[c];
    return k ? Math.max(...k.flatMap((st) => [st[0], st[2]])) * unit : unit * 2;
  });
  let r = -(widths.reduce((a, v) => a + v, 0) + gap * (chars.length - 1)) / 2;
  chars.forEach((c, i) => {
    for (const [x0, y0, x1, y1] of MONUMENT_GLYPHS[c] ?? []) {
      const du = (x1 - x0) * unit;
      const dy = (y1 - y0) * unit;
      const u = sgn * (r + ((x0 + x1) / 2) * unit);
      const tilt = Math.atan2(dy, sgn * du);
      sb.onFace(s, plane, u, y + ((y0 + y1) / 2) * unit, Math.hypot(du, dy) + sw, sw, 0.012, 0.002, color, tilt, 0, hideBack(s));
    }
    r += widths[i] + gap;
  });
}

/**
 * A laurel wreath in relief on a face: two rings of leaves leaning opposite
 * ways round the circle, open at the foot where a knot ties it and two ribbon
 * tails hang.
 */
function monumentLaurel(sb: StoneBatch, s: Side, plane: number, uc: number, yc: number, r: number, color: string): void {
  const hb = hideBack(s);
  const leaf = r * 0.27;
  for (const [rr, n, out, lean] of [
    [r * 0.9, 32, 0.02, 0.6],
    [r * 1.06, 36, 0.014, -0.6],
    [r * 1.2, 40, 0.008, 0.6],
  ] as const) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      if (Math.abs(a - 1.5 * Math.PI) < 0.3) continue;
      sb.onFace(s, plane, uc + Math.cos(a) * rr, yc + Math.sin(a) * rr, leaf, leaf * 0.38, 0.02, out, color, a + Math.PI / 2 + lean, 0, hb);
    }
  }
  sb.onFace(s, plane, uc, yc - r, r * 0.22, r * 0.22, 0.03, 0.02, color, Math.PI / 4, 0, hb);
  for (const e of [-1, 1]) {
    sb.onFace(s, plane, uc + e * r * 0.26, yc - r * 1.45, r * 0.16, r * 0.85, 0.012, 0.01, color, e * 0.35, 0, hb);
  }
}

/**
 * A poppy wreath leaning against a face: two rings of flowers on a ring tipped
 * back by `lean` (its top toward +Z for a positive lean), each a red square
 * turned at random with a black heart, and a card tied in the middle.
 */
function monumentPoppies(sb: StoneBatch, x: number, y: number, z: number, r: number, lean: number, rnd: () => number): void {
  const nY = Math.abs(Math.sin(lean));
  const nZ = -Math.cos(lean) * Math.sign(lean || 1);
  for (const [rr, n] of [
    [r, 17],
    [r * 0.68, 12],
  ] as const) {
    for (let i = 0; i < n; i++) {
      const a = ((i + rnd() * 0.4) / n) * Math.PI * 2;
      const px = x + Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr * Math.cos(lean);
      const pz = z + Math.sin(a) * rr * Math.sin(lean);
      const rot = { x: lean, z: rnd() * Math.PI };
      sb.box(0.075, 0.075, 0.028, px, py, pz, LAMP_RED, rot);
      sb.box(0.026, 0.026, 0.02, px + 0, py + nY * 0.014, pz + nZ * 0.014, IRON, rot);
    }
  }
  sb.box(0.12, 0.08, 0.006, x, y, z, ROAD_PAINT, { x: lean, z: (rnd() - 0.5) * 0.3 });
}

/**
 * The figure on the attic, feet at `y0`, facing -Z: a soldier in a greatcoat
 * and a steel helmet, head bowed, hands folded on the butt of a rifle grounded
 * muzzle-down in front of him. Bronze throughout — the ink and the key draw
 * the folds a modeller would have, and at ten metres up what reads is the
 * SILHOUETTE: the brim, the bowed head, the elbows out, the rifle's line.
 */
function monumentSoldier(b: Build, y0: number): void {
  const B = BRONZE;
  const P = (x: number, y: number, z: number): Point3 => [x, y0 + y, z];
  const oct = (rx: number, rz: number, y: number, cz: number): Point3[] =>
    Array.from({ length: 8 }, (_, k) => {
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
      return P(Math.cos(a) * rx, y, cz + Math.sin(a) * rz);
    });
  // The ground he stands on: a cast slab with a few stones in it.
  b.box(0.92, 0.08, 0.92, 0, y0 - 0.04, 0, B);
  b.box(0.22, 0.06, 0.16, 0.26, y0, 0.24, B, { y: 0.5 });
  b.box(0.16, 0.05, 0.14, -0.3, y0, -0.2, B, { y: -0.3 });
  // Boots and puttees.
  for (const e of [-1, 1]) {
    b.box(0.12, 0.1, 0.27, e * 0.11, y0 + 0.05, -0.04, B, { y: e * 0.12 });
    limb(b, P(e * 0.11, 0.08, 0), P(e * 0.115, 0.6, 0.01), 0.13, 0.15, B, 8);
  }
  // The greatcoat: the skirt to below the knee, the body, the shoulders.
  convexSolid(b, oct(0.34, 0.26, 0.5, 0.03), oct(0.2, 0.15, 1.15, 0), B);
  convexSolid(b, oct(0.2, 0.15, 1.13, 0), oct(0.27, 0.17, 1.55, -0.03), B);
  convexSolid(b, oct(0.27, 0.17, 1.55, -0.03), oct(0.17, 0.12, 1.72, -0.05), B);
  b.box(0.47, 0.07, 0.35, 0, y0 + 1.17, 0, B);
  for (let k = 0; k < 4; k++) b.box(0.035, 0.035, 0.02, 0.07, y0 + 1.28 + k * 0.09, -0.185, B);
  b.cyl(0.08, 0.15, 0.2, 8, 0, y0 + 1.75, -0.05, B);
  // The pack, its rolled blanket, a water bottle and the bayonet's scabbard.
  b.box(0.3, 0.26, 0.12, 0, y0 + 1.42, 0.21, B);
  b.cyl(0.34, 0.08, 0.08, 8, 0, y0 + 1.6, 0.2, B, { z: Math.PI / 2 });
  b.cyl(0.16, 0.08, 0.08, 8, 0.25, y0 + 1.05, 0.08, B);
  slab(b, P(-0.25, 1.12, 0.04), P(-0.28, 0.62, 0.12), 0.04, 0.025, B);
  // The head, bowed, and the helmet's broad brim over it.
  const bow = 0.62;
  const ax: Point3 = [0, Math.cos(bow), -Math.sin(bow)];
  const hc = P(0, 1.85, -0.11);
  const along = (d: number): Point3 => [hc[0] + ax[0] * d, hc[1] + ax[1] * d, hc[2] + ax[2] * d];
  b.cyl(0.21, 0.15, 0.16, 8, hc[0], hc[1], hc[2], B, { x: -bow });
  // A Brodie: a shallow bowl pressed out of one plate with the brim all round
  // it, so the dome is nearly as wide as the brim and barely taller than it.
  const brim = along(0.08);
  b.cyl(0.018, 0.33, 0.36, 12, brim[0], brim[1], brim[2], B, { x: -bow });
  const dome = along(0.115);
  b.cyl(0.06, 0.22, 0.29, 12, dome[0], dome[1], dome[2], B, { x: -bow });
  const crown = along(0.15);
  b.cyl(0.02, 0.12, 0.22, 12, crown[0], crown[1], crown[2], B, { x: -bow });
  // Arms down and forward, the hands folded one over the other on the butt.
  for (const e of [-1, 1]) {
    const sho = P(e * 0.25, 1.66, -0.03);
    const elb = P(e * 0.25, 1.36, -0.15);
    const wri = P(e * 0.08, 1.25, -0.31);
    limb(b, sho, elb, 0.15, 0.13, B, 8);
    limb(b, elb, wri, 0.13, 0.12, B, 8);
    limb(b, P(e * 0.11, 1.265, -0.27), wri, 0.155, 0.15, B, 8);
    b.box(0.1, 0.06, 0.11, e * 0.035, y0 + 1.24 + (e > 0 ? 0.035 : 0), -0.345, B, { y: e * 0.3 });
  }
  // The rifle, reversed: butt under the hands, muzzle on the ground.
  slab(b, P(0, 1.21, -0.345), P(0, 0.86, -0.36), 0.045, 0.13, B);
  slab(b, P(0, 0.86, -0.36), P(0, 0.74, -0.365), 0.04, 0.06, B);
  slab(b, P(0, 0.74, -0.365), P(0, 0.6, -0.37), 0.045, 0.075, B);
  b.box(0.035, 0.11, 0.05, 0, y0 + 0.64, -0.425, B);
  slab(b, P(0, 0.6, -0.37), P(0, 0.18, -0.39), 0.04, 0.05, B);
  limb(b, P(0, 0.18, -0.39), P(0, 0.03, -0.4), 0.024, 0.022, B, 6);
}
