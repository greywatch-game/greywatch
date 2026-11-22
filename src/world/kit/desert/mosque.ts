/**
 * kit/desert/mosque.ts — buildMosque and buildMinaret: a congregational
 * mosque of lime-rendered brick — a flat-roofed prayer hall on four piers, a
 * tiled dome over its middle on a drum and a square chamber, an arcaded
 * portico of five bays with a cupola over each, a tiled inscription across
 * the front — and the banded minaret beside it, which nobody climbs. Part of
 * the desert-town set: follows the contract in kit/core.ts and the set's
 * rules in `./index.ts`. Invariants: every collider byte for byte and in its
 * order, restated at the top of each builder; the minaret is not climbable —
 * that is the decision, not an omission; the dome's and the inscriptions'
 * tile is the only chroma on the map; variation comes from the params, never
 * `Math.random()`. Never imports another builder.
 */
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import { mulberry32 } from "../../rng";
import {
  ALLOY,
  AWNING,
  Build,
  IRON,
  Mesher,
  archArc,
  carve,
  hideBack,
  runsAlongX,
  type BuildParams,
  type Side,
  type Structure,
  type V3,
} from "../core";
import {
  MUDBRICK,
  MUDBRICK_DARK,
  PALM_BEAM,
  PLINTH,
  ROOF_MUD,
  SLAB,
  TILE_BLUE,
  WHITEWASH,
  WINDOW_VOID,
  clothHash,
} from "./shared";
import {
  HIDE_DOWN,
  Lay,
  TAU,
  above,
  archRing,
  band,
  blindBay,
  courses,
  disc,
  domeProfile,
  drum,
  kufic,
  merlons,
  opp,
  pocks,
  pointed,
  slabOn,
  star,
} from "./lay";

/** A box laid on flat `k` of an `n`-sided ring whose flat 0 faces bearing `phase` (0 is +Z). */
function flatBox(
  lay: Lay,
  n: number,
  phase: number,
  k: number,
  apo: number,
  u: number,
  y: number,
  along: number,
  tall: number,
  thick: number,
  out: number,
  color: string,
  tilt = 0,
  hide = 1 << 5,
): void {
  const a = phase + (k * TAU) / n;
  const r = apo + out;
  const sa = Math.sin(a);
  const ca = Math.cos(a);
  lay.sb.box(along, tall, thick, sa * r + ca * u, y, ca * r - sa * u, color, { y: a, z: tilt }, hide);
}


/** The finial every dome and minaret is crowned with: three brass balls on a rod, and a crescent. */
function alem(lay: Lay, y: number, s: number): void {
  const m = lay.m(ALLOY);
  drum(m, 6, 0, 0.035 * s, y, 0.03 * s, y + 1.0 * s);
  for (const [at, d] of [
    [0.2, 0.2],
    [0.46, 0.16],
    [0.68, 0.12],
  ] as const) {
    band(m, 8, 0, d * 0.35 * s, y + (at - d * 0.4) * s, d * 0.5 * s, y + at * s);
    band(m, 8, 0, d * 0.5 * s, y + at * s, d * 0.3 * s, y + (at + d * 0.4) * s);
  }
  // The crescent: two horns leaning out off the rod's head, open to the sky.
  lay.sb.box(0.05 * s, 0.3 * s, 0.05 * s, -0.07 * s, y + 0.98 * s, 0, ALLOY, { z: 0.55 });
  lay.sb.box(0.05 * s, 0.3 * s, 0.05 * s, 0.07 * s, y + 0.98 * s, 0, ALLOY, { z: -0.55 });
  lay.sb.box(0.12 * s, 0.05 * s, 0.05 * s, 0, y + 0.86 * s, 0, ALLOY);
}


// --- the mosque ----------------------------------------------------------------

/**
 * The mosque: a congregational mosque of the Ottoman centuries in the
 * river provinces — a prayer hall of lime-rendered brick under a flat mud
 * roof carried on palm-log beams and four piers, a dome of glazed tile over
 * its middle bay, and a portico of five pointed arches on the court with a
 * small limewashed cupola over each bay. The hall's walls are panelled in
 * blind arches, each with a grilled window and a lancet over it; the portal
 * is framed and tiled; a band of square kufic runs across the front above
 * the portico; the mihrab projects from the qibla wall behind.
 *
 * Enterable, and enterable as ONE volume — no floors, no stair, nothing to
 * climb. That is deliberate against the shelled block: a fight over the mosque
 * is a fight through a portico and three doors into a room with four piers in
 * it, and the piers are the only cover in it; the block is a fight up a
 * stair. Two flags that play the same way are one flag.
 *
 * ## The colliders, which are unchanged
 *
 * The plinth, the front wall's three pieces round the portal, the qibla wall,
 * each side wall's two runs and the piece over its door, the four piers, the
 * roof, one block for the dome, the portico's six piers and its roof — 24
 * boxes in that order, restated below exactly as they were first emitted.
 * Everything after that block is DRAWING and keeps to the three rules: on a
 * face, low enough to step over, or standing on a collider (the parapets, the
 * dome, the cupolas) or overhead (the arcade's spandrels, the beams). The
 * arcade's spandrels are where a round meets drawn work with nothing behind
 * it, and it passes, as one through a ruin's top course does.
 *
 * ## The dome is courses, as every dome in the set is
 *
 * The cel shader bands light, and a smooth surface bands into visible
 * contour rings. A dome laid in courses, each set inside the head of the one
 * under it, bands into what reads as courses of tile, which is what a dome is
 * made of anyway. It rises off the roof on a square chamber, an octagon that
 * turns it, and a sixteen-sided drum with eight lights and the inscription
 * band — which is the dome's whole height in a quarter mosque, whose chamber
 * stretches so the dome stays over its collider.
 *
 * `tint` is the render: lime for the old town's, the cement the highway
 * strip's houses are rendered in for the one out there (a colour the map
 * already has).
 */
export function buildMosque(
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(mats, "mosque");
  const w = p.width ?? 26;
  const d = p.depth ?? 20;
  const h = p.height ?? 7.4;
  const t = 0.7;
  const base = PLINTH + 0.2;
  const skin = p.tint ?? WHITEWASH;
  const rnd = mulberry32(Math.floor(clothHash(w, d, h) * 0x7fffffff));

  // --- the colliders, restated in their order ----------------------------------
  b.block({ w: w + 2.4, h: base, d: d + 5.2, x: 0, y: base / 2, z: -1.4 });
  // The front wall round the portal: `doorWall`'s arithmetic, spelled out.
  const yW = base + h / 2;
  const zF = -(d - t) / 2;
  const doorW = 3.2;
  const doorH = 3.6;
  const side = (w - doorW) / 2;
  const off = doorW / 2 + side / 2;
  const lintel = h - doorH;
  b.block({ w: side, h, d: t, x: 0 - off, y: yW, z: zF });
  b.block({ w: side, h, d: t, x: 0 + off, y: yW, z: zF });
  b.block({ w: doorW, h: lintel, d: t, x: 0, y: yW + h / 2 - lintel / 2, z: zF });
  b.block({ w, h, d: t, x: 0, y: base + h / 2, z: (d - t) / 2 });
  const run = (d - 2 * t - 2.2) / 2;
  for (const sx of [-1, 1] as const) {
    const x = (sx * (w - t)) / 2;
    for (const sz of [-1, 1] as const) {
      b.block({ w: t, h, d: run, x, y: base + h / 2, z: (sz * (run + 2.2)) / 2 });
    }
    b.block({ w: t, h: h - 2.6, d: 2.2, x, y: base + 2.6 + (h - 2.6) / 2, z: 0 });
  }
  // The four piers: the only cover in the hall, and thick enough that
  // `NavGrid` can represent them.
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      b.block({ w: 0.8, h: h - 0.4, d: 0.8, x: sx * w * 0.24, y: base + (h - 0.4) / 2, z: sz * d * 0.2 });
    }
  }
  // The roof. Walked in the sense that a round stops on it and nothing else —
  // there is no way up, which is the point of the minaret standing beside it.
  b.block({ w: w + 0.8, h: SLAB, d: d + 0.8, x: 0, y: base + h + SLAB / 2, z: 0 });
  const domeY = base + h + SLAB;
  const dDrum = Math.min(w, d) * 0.42;
  b.block({ w: dDrum, h: 6.5, d: dDrum, x: 0, y: domeY + 3.25, z: 0 });
  // The portico: six piers carrying a flat roof across the entrance.
  const pz = -(d / 2) - 3.0;
  const pierX: number[] = [];
  for (let i = 0; i <= 5; i++) {
    const x = -w / 2 + (i / 5) * w;
    pierX.push(x);
    b.block({ w: 0.8, h: h - 2.2, d: 0.8, x, y: base + (h - 2.2) / 2, z: pz });
  }
  b.block({ w: w + 1.6, h: 0.55, d: 3.4, x: 0, y: base + h - 1.9, z: pz + 0.4 });

  // --- the drawing ---------------------------------------------------------------
  const lay = new Lay();
  const top = base + h;
  const canopyLo = base + h - 1.9 - 0.275;
  const porchTop = base + h - 1.35;
  const roofTop = top + SLAB;

  hall(lay, w, d, h, base, skin, rnd);
  portal(lay, w, d, base, canopyLo, skin, rnd);
  portico(lay, w, d, h, base, pz, pierX, canopyLo, porchTop, skin, rnd);
  frieze(lay, w, d, porchTop, top, rnd);
  parapet(lay, w + 0.8, d + 0.8, roofTop, skin);
  interior(lay, w, d, h, base, t, skin, rnd);
  dome(lay, dDrum, domeY, skin, rnd);
  lay.flush(b);

  // --- the masses, after what is laid on them ------------------------------------
  b.box(w + 2.4, base, d + 5.2, 0, base / 2, -1.4, MUDBRICK_DARK);
  b.box(side, h, t, 0 - off, yW, zF, skin);
  b.box(side, h, t, 0 + off, yW, zF, skin);
  b.box(doorW, lintel, t, 0, yW + h / 2 - lintel / 2, zF, skin);
  b.box(w, h, t, 0, base + h / 2, (d - t) / 2, skin);
  for (const sx of [-1, 1] as const) {
    const x = (sx * (w - t)) / 2;
    for (const sz of [-1, 1] as const) b.box(t, h, run, x, base + h / 2, (sz * (run + 2.2)) / 2, skin);
    b.box(t, h - 2.6, 2.2, x, base + 2.6 + (h - 2.6) / 2, 0, skin);
  }
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      b.box(0.8, h - 0.4, 0.8, sx * w * 0.24, base + (h - 0.4) / 2, sz * d * 0.2, skin);
    }
  }
  b.box(w + 0.8, SLAB, d + 0.8, 0, base + h + SLAB / 2, 0, ROOF_MUD);
  for (const x of pierX) b.box(0.8, h - 2.2, 0.8, x, base + (h - 2.2) / 2, pz, skin);
  b.box(w + 1.6, 0.55, 3.4, 0, base + h - 1.9, pz + 0.4, skin);
  b.box(w + 1.9, 0.3, 3.8, 0, base + h - 1.5, pz + 0.4, MUDBRICK_DARK);
  return b;
}

/** The nearest odd count of bays of about `bay` metres in `len`. */
function oddBays(len: number, bay: number): number {
  const n = Math.max(1, Math.round(len / bay));
  if (n % 2) return n;
  return len / bay > n ? n + 1 : n - 1;
}


/**
 * The hall's three free elevations — the sides and the qibla wall — and the
 * cornice and the portico's two return faces: a dark dado, pilasters between
 * bays, a blind arch in each with its windows, the side doors framed under
 * tiled tympana, the mihrab's projection on the qibla wall, a corbelled
 * cornice under the roof's lip, and the spouts that drain it.
 */
function hall(lay: Lay, w: number, d: number, h: number, base: number, skin: string, rnd: () => number): void {
  const top = base + h;
  const dado = 0.6;
  const lo = base + dado;
  const hi = top - 0.62;
  const pw = 0.5;
  for (const s of ["-x", "+x", "+z"] as const) {
    const along = runsAlongX(s);
    const len = along ? w : d;
    const plane = along ? d / 2 : w / 2;
    const door = !along;
    const cuts: [number, number][] = door ? [[-1.1, 1.1]] : [];
    for (const [a, c] of carve(-len / 2, len / 2, cuts)) {
      lay.sb.onFace(s, plane, (a + c) / 2, base + dado / 2, c - a, dado, 0.08, 0.04, MUDBRICK_DARK, 0, 0, hideBack(s));
    }
    const nb = oddBays(len, 4.2);
    const bw = len / nb;
    for (let i = 0; i <= nb; i++) {
      const u = -len / 2 + i * bw;
      const uc = Math.max(-len / 2 + pw / 2, Math.min(len / 2 - pw / 2, u));
      lay.sb.onFace(s, plane, uc, (lo + hi) / 2, pw, hi - lo, 0.12, 0.06, skin, 0, 0, hideBack(s));
    }
    for (let i = 0; i < nb; i++) {
      const u = -len / 2 + (i + 0.5) * bw;
      const mid = i === (nb - 1) / 2;
      if (mid && door) sideDoor(lay, s, plane, base, hi);
      else if (mid && s === "+z") mihrabBack(lay, plane, base, lo, hi, bw - pw, skin);
      else blindBay(lay, s, plane, u, bw - pw, lo, hi, skin, true);
    }
    cornice(lay, s, plane, len, top);
    // Two spouts through the parapet, each over a bay, and the stain its
    // water has left down the lime to the arch below.
    for (const k of [-1, 1]) {
      const bay = Math.floor(nb / 2) + k * Math.max(1, Math.floor(nb / 4));
      const u = -len / 2 + (bay + 0.5) * bw + (rnd() - 0.5) * 0.6;
      lay.sb.onFace(s, plane, u, top + SLAB + 0.1, 0.15, 0.13, 0.9, 0.42, PALM_BEAM);
      const streak = 0.5 + rnd() * 0.5;
      lay.sb.onFace(s, plane, u, hi - streak / 2, 0.16 + rnd() * 0.08, streak, 0.02, 0.012, MUDBRICK_DARK, 0, 0, hideBack(s));
    }
    pocks(lay, s, plane, -len / 2 + 0.5, len / 2 - 0.5, base + 0.7, base + 2.8, along ? 6 : 10, rnd);
  }
  cornice(lay, "-z", d / 2, w, top);
}

/**
 * The corbelled cornice under the roof's lip: a row of small dark corbels,
 * a band over them, and a second band standing further out under the
 * slab's overhang, so the eaves line is three inked steps and not one.
 */
function cornice(lay: Lay, s: Side, plane: number, len: number, top: number): void {
  const L = len + 0.24;
  lay.sb.onFace(s, plane, 0, top - 0.43, L, 0.2, 0.16, 0.08, WHITEWASH, 0, 0, hideBack(s));
  lay.sb.onFace(s, plane, 0, top - 0.14, L + 0.4, 0.28, 0.3, 0.15, MUDBRICK_DARK, 0, 0, hideBack(s));
  const n = Math.floor(len / 0.42);
  for (let i = 0; i <= n; i++) {
    lay.sb.onFace(s, plane, -len / 2 + 0.1 + (i * (len - 0.2)) / n, top - 0.6, 0.13, 0.14, 0.12, 0.06, MUDBRICK_DARK, 0, 0, hideBack(s));
  }
}

/**
 * A side door: the opening the collider leaves (2.2 m by 2.6), framed in
 * dark jambs, under a pointed arch whose tympanum over the flat lintel is
 * tiled, with a star at its heart; a step at the threshold, under the walk
 * height; and a palm-log leaf folded back against the inside of the wall.
 */
function sideDoor(lay: Lay, s: Side, plane: number, base: number, hi: number): void {
  const dw = 2.2;
  const dh = 2.6;
  const ring = 0.24;
  for (const k of [-1, 1]) {
    lay.sb.onFace(s, plane, k * (dw / 2 + 0.15), base + dh / 2, 0.3, dh, 0.14, 0.07, MUDBRICK_DARK, 0, 0, hideBack(s));
  }
  const span = dw + 0.3;
  const rise = Math.min(span * 0.62, hi - 0.15 - (base + dh) + 0.2);
  const ys = base + dh - 0.2;
  archRing(lay, s, plane, 0, ys, span, Math.max(span / 2, rise), ring, 0.14, 0.07, MUDBRICK_DARK);
  const tym = above(pointed(0, ys - 0.1, span, 0.1, Math.max(span / 2, rise)), base + dh);
  if (tym.length >= 3) {
    slabOn(lay, s, plane, tym, 0, 0.03, TILE_BLUE);
    star(lay, s, plane, 0, base + dh + Math.max(span / 2, rise) * 0.38, 0.32, 0.045, WHITEWASH);
  }
  lay.sb.onFace(s, plane, 0, base + dh + 0.07, dw + 0.4, 0.14, 0.14, 0.07, PALM_BEAM, 0, 0, hideBack(s));
  // The leaf, folded back flat against the inside face of the wall.
  lay.sb.onFace(opp(s), -(plane - 0.7), -(dw / 2 + 0.62), base + (dh - 0.1) / 2, 1.0, dh - 0.1, 0.07, 0.035, PALM_BEAM, 0, 0, hideBack(opp(s)));
}

/**
 * The mihrab's back: on the outside of the qibla wall, the niche shows as a
 * shallow framed panel standing proud of the wall the height of the bay,
 * with a pointed head and a hood over it.
 */
function mihrabBack(lay: Lay, plane: number, base: number, lo: number, hi: number, bw: number, skin: string): void {
  const s: Side = "+z";
  const pw = Math.min(2.6, bw - 0.4);
  const rise = pw * 0.6;
  const ys = hi - 0.2 - rise;
  slabOn(lay, s, plane, pointed(0, base, pw, ys - base, rise), 0, 0.22, skin);
  archRing(lay, s, plane, 0, ys, pw - 0.3, rise - 0.12, 0.16, 0.1, 0.27, MUDBRICK_DARK);
  slabOn(lay, s, plane, pointed(0, lo + 0.3, pw - 0.62, ys - lo - 0.3, rise - 0.3), 0.22, 0.24, MUDBRICK);
}

/**
 * The portal under the portico: the opening the collider leaves (3.2 m by
 * 3.6), framed in a dark rectangle (the alfiz) to the portico's ceiling;
 * where the hall is tall enough, a pointed arch springing off its jambs with
 * a tiled tympanum over the lintel and a star in it; and the two studded
 * leaves standing open inside.
 */
function portal(lay: Lay, w: number, d: number, base: number, canopyLo: number, skin: string, rnd: () => number): void {
  const s: Side = "-z";
  const plane = d / 2;
  const dw = 3.2;
  const dh = 3.6;
  const head = canopyLo - 0.12;
  for (const k of [-1, 1]) {
    lay.sb.onFace(s, plane, k * (dw / 2 + 0.2), base + (head - base) / 2, 0.4, head - base, 0.16, 0.08, MUDBRICK_DARK, 0, 0, hideBack(s));
  }
  const tym = head - (base + dh);
  if (tym > 0.7) {
    lay.sb.onFace(s, plane, 0, head - 0.2, dw + 0.8, 0.4, 0.16, 0.08, MUDBRICK_DARK, 0, 0, hideBack(s));
    const span = dw;
    const rise = Math.min(span * 0.6, head - 0.45 - (base + dh) + 0.9);
    const ys = base + dh - 0.9;
    archRing(lay, s, plane, 0, ys, span, Math.max(span / 2, rise), 0.26, 0.14, 0.07, skin);
    const t = above(pointed(0, ys - 0.1, span, 0.1, Math.max(span / 2, rise)), base + dh);
    if (t.length >= 3) {
      slabOn(lay, s, plane, t, 0, 0.03, TILE_BLUE);
      star(lay, s, plane, 0, base + dh + (ys + Math.max(span / 2, rise) - base - dh) * 0.45, 0.42, 0.045, WHITEWASH);
    }
    // The spandrels of the alfiz: tile, between the arch and the frame.
    const yS = ys + Math.max(span / 2, rise);
    for (const k of [-1, 1]) {
      slabOn(lay, s, plane, [
        [k * (dw / 2), head - 0.4],
        [k * (dw / 2), ys + 0.3],
        [k * 0.4, head - 0.4],
      ].map(([u, y]) => [u, Math.min(y, yS)] as [number, number]), 0, 0.02, TILE_BLUE);
    }
  }
  lay.sb.onFace(s, plane, 0, base + dh + 0.08, dw + 0.5, 0.16, 0.16, 0.08, PALM_BEAM, 0, 0, hideBack(s));
  // The leaves, standing open against the inside of the front wall.
  const inner = -(plane - 0.7);
  for (const k of [-1, 1]) {
    const u = k * (dw / 2 + 0.85);
    lay.sb.onFace(opp(s), inner, u, base + dh / 2 - 0.05, 1.55, dh - 0.1, 0.09, 0.045, PALM_BEAM, 0, 0, hideBack(opp(s)));
    for (let i = 0; i < 3; i++) lay.sb.onFace(opp(s), inner, u, base + 0.6 + i * 1.2, 1.5, 0.08, 0.03, 0.1, IRON, 0, 0, hideBack(opp(s)));
  }
  pocks(lay, s, plane, -w / 2 + 0.5, w / 2 - 0.5, base + 0.6, Math.min(head, base + 3), 16, rnd);
}

/**
 * The portico: each pier given a base and an impost, a pointed arch between
 * every pair standing the piers' depth (its soffit drawn, so it is an arch
 * from under it and not a cut-out), an arch at each end back to the hall,
 * palm-log joist ends under the roof's front overhang, the strip of roof
 * between the portico and the hall that the old drawing left open to the
 * sky, the inscription on the fascia, a low parapet, and a limewashed
 * cupola over every bay.
 */
function portico(
  lay: Lay,
  w: number,
  d: number,
  h: number,
  base: number,
  pz: number,
  pierX: readonly number[],
  canopyLo: number,
  porchTop: number,
  skin: string,
  rnd: () => number,
): void {
  const pierTop = base + h - 2.2;
  for (const x of pierX) {
    lay.sb.box(1.0, 0.28, 1.0, x, base + 0.14, pz, MUDBRICK_DARK);
    lay.sb.box(1.04, 0.22, 1.04, x, pierTop - 0.11, pz, MUDBRICK_DARK);
    lay.sb.box(0.92, 0.16, 0.92, x, pierTop - 0.3, pz, skin);
  }
  const yT = canopyLo;
  const arch = (s: Side, plane: number, u0: number, u1: number, depth0: number, depth1: number): void => {
    const span = u1 - u0;
    const u = (u0 + u1) / 2;
    const rise = Math.max(span / 2, Math.min(span * 0.6, yT - 0.18 - (base + 2.2)));
    const ys = yT - 0.18 - rise;
    const pts = archArc(u, ys, span, rise, 0, 6);
    for (const k of [-1, 1]) {
      const corner: [number, number] = [k < 0 ? u0 : u1, yT];
      const outline: [number, number][] = [corner];
      for (const [au, ay] of pts) outline.push([k < 0 ? au : 2 * u - au, ay]);
      outline.push([u, yT]);
      slabOn(lay, s, plane, outline, depth0, depth1, skin, true);
    }
    // A dark ring round the arch on both its faces.
    archRing(lay, opp(s), -(plane + depth0), u, ys, span, rise, 0.16, 0.05, 0.02, MUDBRICK_DARK);
    archRing(lay, s, plane + depth1, u, ys, span, rise, 0.16, 0.05, 0.02, MUDBRICK_DARK);
  };
  // The front arcade, the piers' depth through: the `-z` side's plane is
  // `-z`'s distance, so the arcade stands from `-pz - 0.4` to `-pz + 0.4`.
  for (let i = 0; i < 5; i++) arch("-z", -pz - 0.4, pierX[i] + 0.4, pierX[i + 1] - 0.4, 0, 0.8);
  // The two ends, from the end pier back to the hall's face.
  for (const sx of [-1, 1] as const) {
    const s: Side = sx < 0 ? "-x" : "+x";
    arch(s, w / 2 - 0.4, pz + 0.4, -d / 2, 0, 0.8);
  }
  // Joist ends under the roof's front overhang, and the strip over the gap
  // between the portico's roof and the hall.
  const front = pz + 0.4 - 1.7;
  for (let x = -w / 2 - 0.55; x <= w / 2 + 0.56; x += 0.55) {
    lay.sb.box(0.13, 0.15, 0.95, x, yT - 0.075, front + 0.5, PALM_BEAM, undefined, 1 << 2);
  }
  // Its soffit 2 cm over the portico's own, so the two colours never share a plane.
  lay.sb.box(w + 1.6, 0.53, 0.92, 0, base + h - 1.9 + 0.01, -d / 2 - 0.45, ROOF_MUD);
  lay.sb.box(w + 1.9, 0.3, 0.95, 0, base + h - 1.5, -d / 2 - 0.47, MUDBRICK_DARK);
  // The inscription on the fascia, on a band of tile.
  const fz = -(front - 0.002);
  lay.sb.onFace("-z", fz, 0, base + h - 1.9, w + 1.2, 0.36, 0.04, 0.02, TILE_BLUE, 0, 0, hideBack("-z"));
  kufic((u, y, along, tall) => lay.sb.onFace("-z", fz, u, y, along, tall, 0.03, 0.05, WHITEWASH, 0, 0, hideBack("-z")), -w / 2 - 0.5, w / 2 + 0.5, base + h - 2.06, 0.32, rnd);
  // The parapet round the portico's roof: front and ends, the hall behind.
  const pr = (w + 1.9) / 2;
  const fr = pz + 0.4 - 1.9;
  merlons(lay, "-z", -fr - 0.05, 0, w + 1.8, porchTop, 0.3, skin);
  for (const s of ["-x", "+x"] as const) merlons(lay, s, pr - 0.05, (fr + 0.35 - d / 2) / 2, -d / 2 - fr - 0.35, porchTop, 0.3, skin);
  // A cupola over every bay: a square base, an octagon, a dome in courses.
  const bay = w / 5;
  const cd = Math.min(bay * 0.6, 2.7);
  for (let i = 0; i < 5; i++) {
    const x = -w / 2 + (i + 0.5) * bay;
    const z = pz + 0.4;
    const m = lay.m(skin);
    const y0 = porchTop;
    const sq = cd + 0.3;
    lay.sb.box(sq, 0.32, sq, x, y0 + 0.16, z, skin, undefined, HIDE_DOWN);
    band(m, 8, Math.PI / 8, cd / 2 + 0.1, y0 + 0.32, cd / 2 + 0.1, y0 + 0.7, x, z);
    disc(m, 8, Math.PI / 8, cd / 2 + 0.1, cd / 2 - 0.02, y0 + 0.7, true, x, z);
    const prof = domeProfile(cd / 2, y0 + 0.7, cd * 0.55, 0.06, 5);
    courses(m, 12, 0, prof, 0.03, x, z);
    lay.sb.box(0.05, 0.42, 0.05, x, prof[prof.length - 1][1] + 0.2, z, ALLOY);
  }
}


/**
 * The parapet round a flat roof `W` by `D` whose top is at `y`, with a
 * taller stepped horn at every corner.
 */
function parapet(lay: Lay, W: number, D: number, y: number, skin: string): void {
  merlons(lay, "-z", D / 2 - 0.05, 0, W - 0.1, y, 0.28, skin);
  merlons(lay, "+z", D / 2 - 0.05, 0, W - 0.1, y, 0.28, skin);
  merlons(lay, "-x", W / 2 - 0.05, 0, D - 0.7, y, 0.28, skin);
  merlons(lay, "+x", W / 2 - 0.05, 0, D - 0.7, y, 0.28, skin);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * (W / 2 - 0.32);
      const z = sz * (D / 2 - 0.32);
      lay.sb.box(0.56, 0.8, 0.56, x, y + 0.4, z, skin, undefined, HIDE_DOWN);
      lay.sb.box(0.38, 0.24, 0.38, x, y + 0.92, z, skin, undefined, HIDE_DOWN);
      lay.sb.box(0.2, 0.2, 0.2, x, y + 1.14, z, skin, undefined, HIDE_DOWN);
    }
  }
}

/**
 * The inscription across the front: a band of tile on the hall's face
 * between the portico's roof and the cornice, the length of the hall, in
 * square kufic — what the court reads the building by, beside its dome.
 */
function frieze(lay: Lay, w: number, d: number, porchTop: number, top: number, rnd: () => number): void {
  const s: Side = "-z";
  const plane = d / 2;
  const y0 = porchTop + 0.12;
  const y1 = top - 0.76;
  if (y1 - y0 < 0.3) return;
  const H = Math.min(0.62, y1 - y0);
  const yc = y0 + (y1 - y0) / 2;
  lay.sb.onFace(s, plane, 0, yc, w - 0.3, H + 0.12, 0.06, 0.03, MUDBRICK_DARK, 0, 0, hideBack(s));
  lay.sb.onFace(s, plane, 0, yc, w - 0.5, H, 0.04, 0.06, TILE_BLUE, 0, 0, hideBack(s));
  kufic((u, y, along, tall) => lay.sb.onFace(s, plane, u, y, along, tall, 0.03, 0.09, WHITEWASH, 0, 0, hideBack(s)), -w / 2 + 0.4, w / 2 - 0.4, yc - H / 2 + 0.03, H - 0.06, rnd);
}

/**
 * Inside: a base and a capital to each pier and the impost that carries it
 * to the ceiling; the roof's palm-log girders over the piers and its joists
 * between them; the mihrab on the qibla wall, framed, tiled and hooded; and
 * carpets on the floor — the floor seen through every door.
 */
function interior(lay: Lay, w: number, d: number, h: number, base: number, t: number, skin: string, rnd: () => number): void {
  const top = base + h;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * w * 0.24;
      const z = sz * d * 0.2;
      lay.sb.box(1.0, 0.24, 1.0, x, base + 0.12, z, MUDBRICK_DARK, undefined, HIDE_DOWN);
      lay.sb.box(1.0, 0.26, 1.0, x, top - 0.4 - 0.13, z, MUDBRICK_DARK);
      lay.sb.box(0.8, 0.4, 0.8, x, top - 0.2, z, skin);
    }
  }
  // Two girders along X over the piers, wall to wall, and joists along Z
  // from wall to wall resting on them.
  const inW = w - 2 * t;
  const inD = d - 2 * t;
  for (const sz of [-1, 1]) lay.sb.box(inW, 0.38, 0.4, 0, top - 0.19, sz * d * 0.2, PALM_BEAM);
  const nj = Math.floor(inW / 0.75);
  for (let i = 0; i <= nj; i++) {
    const x = -inW / 2 + 0.2 + (i * (inW - 0.4)) / nj;
    lay.sb.box(0.15, 0.16, inD, x, top - 0.08 - 0.001, 0, PALM_BEAM);
  }
  // The mihrab, on the inside face of the qibla wall.
  const s: Side = "-z";
  const plane = -(d / 2 - t);
  const mw = Math.min(2.4, w * 0.12);
  const mh = Math.min(h - 1.2, 4.2);
  lay.sb.onFace(s, plane, 0, base + mh / 2, mw + 1.0, mh, 0.16, 0.08, skin, 0, 0, hideBack(s));
  const rise = mw * 0.55;
  slabOn(lay, s, plane, pointed(0, base + 0.25, mw, mh - 0.6 - rise, rise), 0.16, 0.18, TILE_BLUE);
  archRing(lay, s, plane, 0, base + mh - 0.35 - rise, mw, rise, 0.16, 0.08, 0.2, MUDBRICK_DARK);
  kufic((u, y, along, tall) => lay.sb.onFace(s, plane, u, y, along, tall, 0.03, 0.2, WHITEWASH, 0, 0, hideBack(s)), -mw / 2 + 0.1, mw / 2 - 0.1, base + 0.5, 0.5, rnd);
  // The carpets: one to each aisle between the piers and the walls.
  for (const [cx, cz, cw, cd] of [
    [0, 0, w * 0.36, d * 0.32],
    [-w * 0.37, 0, w * 0.18, d * 0.62],
    [w * 0.37, 0, w * 0.18, d * 0.62],
    [0, d * 0.33, w * 0.36, d * 0.16],
    [0, -d * 0.33, w * 0.36, d * 0.16],
  ] as const) {
    lay.sb.box(cw, 0.012, cd, cx, base + 0.006, cz, AWNING, undefined, HIDE_DOWN);
    lay.sb.box(cw - 0.5, 0.012, cd - 0.5, cx, base + 0.018, cz, MUDBRICK_DARK, undefined, HIDE_DOWN);
  }
}

/**
 * The dome over the middle bay: a square chamber off the roof with a blind
 * arch and a light in each face, corner broaches turning it to an octagon, a
 * sixteen-sided drum with ribs at its angles, eight lights and the
 * inscription band at its head under a dark cornice, the dome in courses of
 * tile, and the finial.
 */
function dome(lay: Lay, dDrum: number, domeY: number, skin: string, rnd: () => number): void {
  const R = dDrum / 2;
  const domeH = R * 1.18;
  const hd = R * 0.42 + 0.4;
  const ho = 0.55;
  const hb = Math.max(1.2, 6.9 - (ho + hd + domeH));
  const sq = dDrum + 0.6;
  const m = lay.m(skin);
  // The chamber.
  lay.sb.box(sq, hb, sq, 0, domeY + hb / 2, 0, skin, undefined, HIDE_DOWN);
  const yc = domeY + hb;
  // A blind arcade round the chamber, as many arches a face as its height
  // will take at the proportion every arch here is struck to.
  const span0 = Math.min(2.4, (hb - 0.45) / 0.6);
  const nA = Math.max(1, Math.round((sq - 0.4) / (span0 + 0.3)));
  const span = (sq - 0.4) / nA - 0.3;
  const rise = span * 0.6;
  const ys = yc - 0.3 - rise;
  for (const s of ["-z", "+z", "-x", "+x"] as const) {
    const plane = sq / 2;
    if (ys >= domeY + 0.15) {
      for (let i = 0; i < nA; i++) {
        const u = -(sq - 0.4) / 2 + (i + 0.5) * ((sq - 0.4) / nA);
        archRing(lay, s, plane, u, ys, span, rise, 0.18, 0.1, 0.05, skin);
        slabOn(lay, s, plane, pointed(u, domeY + 0.1, span, ys - domeY - 0.1, rise), 0, 0.015, MUDBRICK);
        if (span > 0.9) {
          const lw = span * 0.26;
          slabOn(lay, s, plane, pointed(u, ys - 0.25, lw, 0.3, lw * 0.7), 0.015, 0.04, WINDOW_VOID);
        }
      }
    }
    lay.sb.onFace(s, plane, 0, yc - 0.11, sq + 0.22, 0.18, 0.2, 0.06, MUDBRICK_DARK, 0, 0, hideBack(s));
  }
  // The octagon and its broaches.
  const ao = sq / 2 - 0.12;
  band(m, 8, 0, ao, yc, ao, yc + ho);
  disc(m, 8, 0, ao, 0, yc + ho);
  const k8 = 1 / Math.cos(Math.PI / 8);
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const ca: V3 = [Math.sin(a) * (sq / 2) * Math.SQRT2, yc, Math.cos(a) * (sq / 2) * Math.SQRT2];
    const v = (ang: number): V3 => [Math.sin(ang) * ao * k8, yc, Math.cos(ang) * ao * k8];
    const p1 = v(a - Math.PI / 8);
    const p2 = v(a + Math.PI / 8);
    const apex: V3 = [Math.sin(a) * ao, yc + ho * 0.9, Math.cos(a) * ao];
    const outw: V3 = [Math.sin(a), 0.7, Math.cos(a)];
    m.tri(ca, p1, apex, outw);
    m.tri(ca, apex, p2, outw);
  }
  // The drum.
  const y0 = yc + ho;
  const y1 = y0 + hd;
  band(m, 16, 0, R, y0, R, y1);
  for (let k = 0; k < 16; k++) {
    const a = Math.PI / 16 + (k * TAU) / 16;
    const rr = R / Math.cos(Math.PI / 16);
    lay.sb.box(0.16, hd - 0.1, 0.16, Math.sin(a) * rr, y0 + (hd - 0.1) / 2, Math.cos(a) * rr, skin, { y: a });
  }
  const fw = 2 * R * Math.tan(Math.PI / 16);
  const bandH = Math.min(0.55, hd * 0.32);
  const winTop = y1 - bandH - 0.18;
  const wh = winTop - (y0 + 0.2);
  if (wh > 0.45) {
    for (let k = 0; k < 16; k += 2) {
      const ww = fw * 0.42;
      const rise = ww * 0.65;
      const sp = wh - rise;
      // A lancet on the flat's face: its void, and a dark sill.
      const a = (k * TAU) / 16;
      const sa = Math.sin(a);
      const ca = Math.cos(a);
      const mv = lay.m(WINDOW_VOID);
      const pts = pointed(0, y0 + 0.2, ww, sp, rise);
      const P = (u: number, y: number, o: number): V3 => [sa * (R + o) + ca * u, y, ca * (R + o) - sa * u];
      for (let i = 1; i + 1 < pts.length; i++) {
        mv.tri(P(pts[0][0], pts[0][1], 0.02), P(pts[i][0], pts[i][1], 0.02), P(pts[i + 1][0], pts[i + 1][1], 0.02), [sa, 0, ca]);
      }
      flatBox(lay, 16, 0, k, R, 0, y0 + 0.16, ww + 0.2, 0.08, 0.12, 0.04, MUDBRICK_DARK);
    }
  }
  // The inscription band under the cornice.
  const yb = y1 - 0.12 - bandH;
  band(lay.m(TILE_BLUE), 16, 0, R + 0.03, yb, R + 0.03, yb + bandH);
  for (let k = 0; k < 16; k++) {
    kufic((u, y, along, tall) => flatBox(lay, 16, 0, k, R + 0.03, u, y, along, tall, 0.03, 0.012, WHITEWASH), -fw / 2 + 0.05, fw / 2 - 0.05, yb + 0.02, bandH - 0.04, rnd);
  }
  const mc = lay.m(MUDBRICK_DARK);
  band(mc, 16, 0, R + 0.06, y1 - 0.12, R + 0.2, y1);
  disc(mc, 16, 0, R + 0.2, R - 0.06, y1);
  // The dome.
  const prof = domeProfile(R - 0.06, y1, domeH, R * 0.08, R > 3.5 ? 10 : 8);
  courses(lay.m(TILE_BLUE), 16, 0, prof, 0.05);
  alem(lay, prof[prof.length - 1][1] - 0.04, Math.max(1, R / 2.6));
}

// --- the minaret -----------------------------------------------------------------

/**
 * The minaret: the banded brick minaret of the river towns — a square stage
 * on its pedestal with the stair's door in it, broaches turning it to an
 * octagonal shaft laid in bands (a dark brick course at its foot, panels of
 * raised lozenge brickwork, two bands of tiled inscription), slit lights
 * winding up it with the stair, a gallery corbelled out on three tiers of
 * stalactite brackets with a pierced balustrade and the loudspeakers wired to
 * it, a slimmer upper shaft, an open lantern and a tiled cap under the
 * finial. The tallest have a second, smaller gallery at the upper shaft's head.
 *
 * **Not climbable, and that is the decision rather than an omission.** A tower
 * a player can get to the top of, on a map with a 560 m view, is a position
 * that sees every flag — and there is no counter to it, because there is only
 * one way up. What it is instead is the LANDMARK: the tallest thing in the
 * town, visible from every quarter, the thing a player orients on before they
 * have learned the streets. It costs three collider boxes to be that — the
 * pedestal, the lower shaft and the upper one, unchanged and in that order;
 * the gallery and everything over the upper shaft are drawing a round passes.
 */
export function buildMinaret(
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(mats, "minaret");
  const h = p.height ?? 26;
  const base = 4.2;
  const lower = h * 0.62;
  const bal = 1.2 + lower;
  const upper = h - lower - 2.7;
  const rnd = mulberry32(Math.floor(clothHash(h, 7) * 0x7fffffff));

  // --- the colliders, restated in their order ----------------------------------
  b.block({ w: base + 1.2, h: 1.2, d: base + 1.2, x: 0, y: 0.6, z: 0 });
  b.block({ w: base, h: lower, d: base, x: 0, y: 1.2 + lower / 2, z: 0 });
  b.block({
    w: base * 0.68,
    h: upper + 1.5,
    d: base * 0.68,
    x: 0,
    y: bal + (upper + 1.5) / 2,
    z: 0,
  });

  const lay = new Lay();
  const m = lay.m(WHITEWASH);
  const half = base / 2;

  // --- the pedestal and the square stage ---------------------------------------
  lay.sb.box(base + 1.4, 0.12, base + 1.4, 0, 1.26, 0, WHITEWASH, undefined, HIDE_DOWN);
  lay.sb.box(base + 1.5, 0.2, base + 1.5, 0, 0.1, 0, MUDBRICK_DARK, undefined, HIDE_DOWN);
  const sqH = Math.min(4.6, lower * 0.3);
  const ySq = 1.32 + sqH;
  lay.sb.box(base, sqH, base, 0, 1.32 + sqH / 2, 0, WHITEWASH);
  for (const s of ["-z", "+z", "-x", "+x"] as const) {
    if (s === "-z" && sqH > 2.9) {
      // The stair's door, shut: two boarded leaves under a pointed head.
      const dw = 0.95;
      const dh = Math.min(2.1, sqH - 0.9);
      slabOn(lay, s, half, pointed(0, 1.32, dw, dh, dw * 0.6), 0, 0.04, PALM_BEAM);
      archRing(lay, s, half, 0, 1.32 + dh, dw, dw * 0.6, 0.2, 0.12, 0.06, MUDBRICK_DARK);
      for (const k of [-1, 1]) lay.sb.onFace(s, half, k * (dw / 2 + 0.1), 1.32 + dh / 2, 0.2, dh, 0.12, 0.06, MUDBRICK_DARK, 0, 0, hideBack(s));
      lay.sb.onFace(s, half, 0, 1.32 + dh / 2, 0.03, dh, 0.03, 0.055, WINDOW_VOID, 0, 0, hideBack(s));
      for (let i = 0; i < 3; i++) lay.sb.onFace(s, half, 0, 1.6 + i * (dh - 0.6) / 2, dw - 0.1, 0.06, 0.03, 0.06, IRON, 0, 0, hideBack(s));
    } else {
      const span = base * 0.5;
      const rise = span * 0.6;
      const ys = ySq - 0.45 - rise;
      if (ys > 1.6) {
        archRing(lay, s, half, 0, ys, span, rise, 0.18, 0.1, 0.05, MUDBRICK_DARK);
        slabOn(lay, s, half, pointed(0, 1.62, span, ys - 1.62, rise), 0, 0.015, MUDBRICK);
        const lw = 0.24;
        slabOn(lay, s, half, pointed(0, ys - 0.35, lw, 0.45, lw * 0.7), 0.015, 0.04, WINDOW_VOID);
      }
    }
    lay.sb.onFace(s, half, 0, ySq - 0.12, base + 0.24, 0.24, 0.2, 0.06, MUDBRICK_DARK, 0, 0, hideBack(s));
  }

  // --- the octagonal shaft -------------------------------------------------------
  // Flats face the axes, so the square stage's faces carry straight up; the
  // corners it cuts off are turned by broaches.
  const a0 = half - 0.02;
  const a1 = half * 0.86;
  const shaftLo = ySq;
  const shaftHi = bal;
  const L = shaftHi - shaftLo;
  const apo = (y: number): number => a0 + ((a1 - a0) * (y - shaftLo)) / L;
  band(m, 8, 0, a0, shaftLo, a1, shaftHi);
  const k8 = 1 / Math.cos(Math.PI / 8);
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const ca: V3 = [Math.sin(a) * half * Math.SQRT2, ySq, Math.cos(a) * half * Math.SQRT2];
    const v = (ang: number): V3 => [Math.sin(ang) * a0 * k8, ySq, Math.cos(ang) * a0 * k8];
    m.tri(ca, v(a - Math.PI / 8), [Math.sin(a) * a0, ySq + 0.8, Math.cos(a) * a0], [Math.sin(a), 0.8, Math.cos(a)]);
    m.tri(ca, [Math.sin(a) * a0, ySq + 0.8, Math.cos(a) * a0], v(a + Math.PI / 8), [Math.sin(a), 0.8, Math.cos(a)]);
  }
  const ring = (y: number, hgt: number, proud: number, color: string): void => {
    band(lay.m(color), 8, 0, apo(y) + proud, y, apo(y + hgt) + proud, y + hgt);
    disc(lay.m(color), 8, 0, apo(y + hgt) + proud, apo(y + hgt), y + hgt);
  };
  ring(shaftLo + 0.15, 0.3, 0.06, MUDBRICK_DARK);
  // Bands up the shaft: lozenge brickwork and tiled inscription, alternating
  // with plain render. Their places are fractions of the shaft, so a short
  // quarter minaret carries the same order as the great one, closer set.
  const tileBand = (y: number, H: number): void => {
    ring(y - 0.06, H + 0.12, 0.03, MUDBRICK_DARK);
    ring(y, H, 0.05, TILE_BLUE);
    for (let k = 0; k < 8; k++) {
      const ap = apo(y + H / 2) + 0.05;
      const fw = 2 * ap * Math.tan(Math.PI / 8);
      kufic((u, yy, along, tall) => flatBox(lay, 8, 0, k, ap, u, yy, along, tall, 0.03, 0.012, WHITEWASH), -fw / 2 + 0.06, fw / 2 - 0.06, y + 0.02, H - 0.04, rnd);
    }
  };
  const lozenge = (y: number, H: number): void => {
    ring(y - 0.08, 0.08, 0.04, MUDBRICK_DARK);
    ring(y + H, 0.08, 0.04, MUDBRICK_DARK);
    for (let k = 0; k < 8; k++) {
      const ap = apo(y + H / 2);
      const fw = 2 * ap * Math.tan(Math.PI / 8) - 0.2;
      const cell = 0.34;
      const cols = Math.max(2, Math.floor(fw / cell));
      const rows = Math.max(1, Math.floor(H / cell));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const u = -fw / 2 + (c + (r % 2 ? 1 : 0.5)) * (fw / cols);
          if (u > fw / 2 - 0.05) continue;
          flatBox(lay, 8, 0, k, ap, u, y + (r + 0.5) * (H / rows), 0.15, 0.15, 0.05, 0.02, MUDBRICK, Math.PI / 4);
        }
      }
    }
  };
  if (L > 8) lozenge(shaftLo + L * 0.22, Math.min(1.4, L * 0.09));
  tileBand(shaftLo + L * 0.5, Math.min(0.7, L * 0.06));
  if (L > 8) lozenge(shaftLo + L * 0.7, Math.min(1.0, L * 0.07));
  tileBand(shaftHi - 1.7, 0.55);
  // The stair's slit lights, winding up the shaft a quarter turn a storey.
  for (let y = shaftLo + 1.6, k = 2; y < shaftHi - 2.2; y += 2.4, k = (k + 3) % 8) {
    const ap = apo(y);
    flatBox(lay, 8, 0, k, ap, 0, y, 0.16, 0.62, 0.04, 0.012, WINDOW_VOID);
    flatBox(lay, 8, 0, k, ap, 0, y - 0.36, 0.3, 0.08, 0.1, 0.04, MUDBRICK_DARK);
  }

  // --- the gallery --------------------------------------------------------------
  // Three tiers of corbels flaring out from the shaft's head, each with a row
  // of small stalactite brackets under its lip: the muqarnas a balcony stands
  // on, drawn as the steps of it the ink can find.
  const gR = 3.72;
  const tiers: [number, number][] = [
    [a1, a1 + 0.62],
    [a1 + 0.58, a1 + 1.24],
    [a1 + 1.2, gR - 0.05],
  ];
  const tierH = 0.34;
  for (let i = 0; i < 3; i++) {
    const [r0, r1] = tiers[i];
    const y = bal - (3 - i) * tierH;
    band(m, 16, 0, r0, y, r1, y + tierH);
    for (let k = 0; k < 16; k++) {
      const a = (k * TAU) / 16;
      const rr = (r0 + r1) / 2;
      lay.sb.box(0.22, tierH * 0.6, 0.24, Math.sin(a) * rr, y + tierH * 0.25, Math.cos(a) * rr, i % 2 ? WHITEWASH : MUDBRICK_DARK, { y: a });
    }
  }
  const md = lay.m(MUDBRICK_DARK);
  band(md, 16, 0, gR, bal, gR, bal + 0.22);
  disc(md, 16, 0, gR, 0, bal + 0.22);
  disc(md, 16, 0, gR, tiers[2][1], bal, false);
  // The balustrade: a post at every angle, two rails, and a pierced panel
  // in every bay.
  const k16 = 1 / Math.cos(Math.PI / 16);
  const rp = gR - 0.12;
  const fw16 = 2 * rp * Math.tan(Math.PI / 16);
  for (let k = 0; k < 16; k++) {
    const a = Math.PI / 16 + (k * TAU) / 16;
    lay.sb.box(0.14, 1.0, 0.14, Math.sin(a) * rp * k16, bal + 0.72, Math.cos(a) * rp * k16, WHITEWASH, { y: a });
    flatBox(lay, 16, 0, k, rp, 0, bal + 1.24, fw16 + 0.06, 0.1, 0.2, 0, WHITEWASH, 0, 0);
    flatBox(lay, 16, 0, k, rp, 0, bal + 0.29, fw16, 0.1, 0.16, 0, WHITEWASH, 0, 0);
    flatBox(lay, 16, 0, k, rp, 0, bal + 0.76, fw16 - 0.12, 0.84, 0.05, 0, WHITEWASH, 0, 0);
    flatBox(lay, 16, 0, k, rp, 0, bal + 0.76, 0.22, 0.22, 0.08, 0, WINDOW_VOID, Math.PI / 4, 0);
  }
  // The loudspeakers, four horns on brackets off the rail, each canted down
  // at the roofs it calls over, and the conduit they hang from.
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const r = gR + 0.18;
    const y = bal + 1.55;
    lay.sb.box(0.06, 0.5, 0.06, Math.sin(a) * (gR - 0.1), bal + 1.45, Math.cos(a) * (gR - 0.1), ALLOY);
    const horn = lay.m(ALLOY);
    const hx = Math.sin(a) * r;
    const hz = Math.cos(a) * r;
    const ax = Math.sin(a) * Math.cos(0.3);
    const ay = -Math.sin(0.3);
    const az = Math.cos(a) * Math.cos(0.3);
    hornAt(horn, [hx, y, hz], [ax, ay, az], 0.06, 0.24, 0.5);
  }

  // --- the upper shaft, its head and the cap ------------------------------------
  const u0 = base * 0.68 * 0.5 - 0.02;
  const u1 = u0 * 0.86;
  const upLo = bal + 0.22;
  const upHi = bal + 1.5 + upper;
  band(m, 8, 0, u0, upLo, u1, upHi);
  // The gallery's door onto the balustrade.
  flatBox(lay, 8, 0, 4, u0, 0, upLo + 0.95, 0.62, 1.7, 0.04, 0.015, PALM_BEAM);
  flatBox(lay, 8, 0, 4, u0, 0, upLo + 1.86, 0.8, 0.14, 0.1, 0.04, MUDBRICK_DARK);
  const upApo = (y: number): number => u0 + ((u1 - u0) * (y - upLo)) / (upHi - upLo);
  const upRing = (y: number, hgt: number, proud: number, color: string): void => {
    band(lay.m(color), 8, 0, upApo(y) + proud, y, upApo(y + hgt) + proud, y + hgt);
    disc(lay.m(color), 8, 0, upApo(y + hgt) + proud, upApo(y + hgt), y + hgt);
  };
  if (upper > 3) {
    const yb = upLo + (upHi - upLo) * 0.55;
    upRing(yb - 0.06, 0.62, 0.03, MUDBRICK_DARK);
    upRing(yb, 0.5, 0.05, TILE_BLUE);
    for (let k = 0; k < 8; k++) {
      const ap = upApo(yb + 0.25) + 0.05;
      const fw = 2 * ap * Math.tan(Math.PI / 8);
      kufic((u, yy, along, tall) => flatBox(lay, 8, 0, k, ap, u, yy, along, tall, 0.025, 0.012, WHITEWASH), -fw / 2 + 0.05, fw / 2 - 0.05, yb + 0.02, 0.46, rnd);
    }
  }
  for (let y = upLo + 2.4, k = 1; y < upHi - 0.9; y += 2.2, k = (k + 3) % 8) {
    flatBox(lay, 8, 0, k, upApo(y), 0, y, 0.14, 0.5, 0.04, 0.012, WINDOW_VOID);
  }
  // The head: a corbelled cornice, and on the tallest a second gallery.
  let yh = upHi;
  const second = h >= 24;
  const hR = second ? u1 + 0.75 : u1 + 0.3;
  band(md, 8, 0, u1, yh - 0.3, hR, yh);
  disc(md, 8, 0, hR, 0, yh);
  if (second) {
    for (let k = 0; k < 8; k++) {
      const a = Math.PI / 8 + (k * TAU) / 8;
      lay.sb.box(0.1, 0.85, 0.1, Math.sin(a) * (hR - 0.08) * k8, yh + 0.43, Math.cos(a) * (hR - 0.08) * k8, WHITEWASH, { y: a });
      flatBox(lay, 8, 0, k, hR - 0.08, 0, yh + 0.84, 2 * (hR - 0.08) * Math.tan(Math.PI / 8) + 0.05, 0.08, 0.14, 0, WHITEWASH, 0, 0);
    }
  }
  // The lantern: eight slender posts under a ring, open between them.
  const lr = u1 * 0.62;
  const lh = 1.3 + (second ? 0.2 : 0);
  const mv = lay.m(WINDOW_VOID);
  drum(mv, 8, 0, lr - 0.12, yh, lr - 0.12, yh + lh);
  for (let k = 0; k < 8; k++) {
    const a = Math.PI / 8 + (k * TAU) / 8;
    lay.sb.box(0.16, lh, 0.16, Math.sin(a) * lr * k8, yh + lh / 2, Math.cos(a) * lr * k8, WHITEWASH, { y: a });
  }
  yh += lh;
  band(md, 8, 0, lr + 0.1, yh, lr + 0.2, yh + 0.16);
  disc(md, 8, 0, lr + 0.2, 0, yh + 0.16);
  yh += 0.16;
  // The cap: a tiled pointed dome a little fuller than the lantern under it.
  const capR = lr + 0.1;
  const capH = 2.0 + (second ? 0.5 : 0);
  const prof: [number, number][] = [
    [capR, yh],
    [capR * 1.12, yh + capH * 0.18],
    [capR * 1.1, yh + capH * 0.36],
    [capR * 0.86, yh + capH * 0.56],
    [capR * 0.55, yh + capH * 0.74],
    [capR * 0.26, yh + capH * 0.9],
    [0.03, yh + capH],
  ];
  courses(lay.m(TILE_BLUE), 12, 0, prof, 0.04);
  alem(lay, yh + capH - 0.05, 0.85);

  lay.flush(b);
  // --- the masses, after what is laid on them ------------------------------------
  b.box(base + 1.2, 1.2, base + 1.2, 0, 0.6, 0, MUDBRICK_DARK);
  return b;
}

/**
 * A horn: a cone from a throat `d0` across to a mouth `d1`, `len` long from
 * `at` along `dir`, in twelve flats — the public-address horn every
 * minaret in the region has carried since the 1960s.
 */
function hornAt(m: Mesher, at: V3, dir: V3, d0: number, d1: number, len: number): void {
  const [dx, dy, dz] = dir;
  const n = Math.hypot(dx, dy, dz);
  const f: V3 = [dx / n, dy / n, dz / n];
  const up: V3 = Math.abs(f[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const r1: V3 = [f[1] * up[2] - f[2] * up[1], f[2] * up[0] - f[0] * up[2], f[0] * up[1] - f[1] * up[0]];
  const rl = Math.hypot(...r1);
  const e1: V3 = [r1[0] / rl, r1[1] / rl, r1[2] / rl];
  const e2: V3 = [f[1] * e1[2] - f[2] * e1[1], f[2] * e1[0] - f[0] * e1[2], f[0] * e1[1] - f[1] * e1[0]];
  const ring = (c: V3, r: number, a: number): V3 => [
    c[0] + (Math.cos(a) * e1[0] + Math.sin(a) * e2[0]) * r,
    c[1] + (Math.cos(a) * e1[1] + Math.sin(a) * e2[1]) * r,
    c[2] + (Math.cos(a) * e1[2] + Math.sin(a) * e2[2]) * r,
  ];
  const c1: V3 = [at[0] + f[0] * len, at[1] + f[1] * len, at[2] + f[2] * len];
  const N = 12;
  for (let k = 0; k < N; k++) {
    const aa = (k * TAU) / N;
    const ab = ((k + 1) * TAU) / N;
    const mid = (aa + ab) / 2;
    const o: V3 = [Math.cos(mid) * e1[0] + Math.sin(mid) * e2[0], Math.cos(mid) * e1[1] + Math.sin(mid) * e2[1], Math.cos(mid) * e1[2] + Math.sin(mid) * e2[2]];
    m.quad(ring(at, d0 / 2, aa), ring(at, d0 / 2, ab), ring(c1, d1 / 2, ab), ring(c1, d1 / 2, aa), o);
    // The mouth's inside, which is what you see of a horn from in front.
    m.tri(c1, ring(c1, d1 / 2, aa), ring(c1, d1 / 2, ab), f);
  }
}
