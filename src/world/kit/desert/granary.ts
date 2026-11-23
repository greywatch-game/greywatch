/**
 * kit/desert/granary.ts — buildGranary: a family's grain store of the river
 * provinces, three or four tapering bins of puddled mud raised by hand in
 * lifts on a stone-kerbed platform, each closed by a coursed mud dome under an
 * upturned pot, filled through a hatch near its head that palm-rib pegs climb
 * to and drawn from by a hole at its foot — solid mud standing in an alley of
 * walls. Part of the desert-town set: follows the contract in kit/core.ts and
 * the set's rules in `./index.ts`. Invariants: the platform's collider and
 * each bin's, byte for byte and in their order, restated at the top — cover,
 * never walked but for the platform, never entered; the bins' sizes come from
 * the params (`clothHash`), and everything drawn on them is seeded off where
 * it stands, never `Math.random()`. Never imports another builder.
 */
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import { mulberry32 } from "../../rng";
import {
  Build,
  IRON,
  Mesher,
  hideBack,
  streetSeed,
  type BuildCtx,
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
  SANDBAG,
  SCORCH,
  WHITEWASH,
  WINDOW_VOID,
  clothHash,
} from "./shared";
import { HIDE_DOWN, Lay, TAU, band, courses, disc, domeProfile, eye, lobe, ragged } from "./lay";

/**
 * The granary: three or four tapering mud bins on a shared platform, raised
 * by hand and none of them the same.
 *
 * ## What it is FOR
 *
 * It is the smallest thing in this set and the only one that is not a
 * building: nothing goes in it, nothing stands on it, and it is eight metres
 * across. What it does is stand in an ALLEY. The old town is 30 m plots on a
 * 7 m pitch, and what makes it a maze is that you cannot see OVER a compound
 * wall — but you can see along an alley, the whole length of one, so a quarter
 * of nothing but walls is a quarter of long straight looks at knee-to-eye
 * height. This is what a layout puts in one to break it: five metres of solid
 * mud in a footprint that still leaves room to walk past. The generator also
 * stands it behind the town wall and at the citadel's corners as the solid
 * towers a wall turns on, which it can be because it is solid all the way up.
 *
 * It is also the only piece of this vernacular with no straight line in its
 * silhouette, which is worth something on a map made of boxes.
 *
 * ## What it is drawn as
 *
 * The coil-built grain bin of the river villages, which is older than the
 * town and still built the same way: puddled mud and chopped straw laid by
 * hand in LIFTS a forearm high, each left a day to dry before the next is
 * pressed onto its head, so the bin narrows as it rises and every lift's head
 * stands a finger proud of the one laid on it. Those heads are drawn as real
 * ledges (`seam`) — the up-facing step the sky term lights and the ink finds,
 * spaced as unevenly as a hand lays them — and they are the whole of what
 * gives a smooth taper its scale. The head is a rolled lip and a low dome laid
 * in courses (`courses`), its filling hole stopped by an upturned pot or a mud
 * knob.
 *
 * Each bin turns its working face OUT from the platform: a filling hatch near
 * the head in a mud frame under a palm-log lintel, either shut by a board
 * door on a hasp and padlock or open, its door lying at the foot; under it
 * the pegs of split palm rib driven through the wall while it was wet, which
 * ARE the ladder, one of them snapped; and a little round the bin, the
 * draw-off hole at the foot — framed in palm, plugged with mud or left open
 * over a spill of grain — with a gap in the fieldstone collar the bin stands
 * in so a basket can be set under it. Hands are pressed in whitewash on a bin
 * against the eye, and a tally of sacks is kept in charcoal on one.
 *
 * It ages as mud does: rain cuts gullies down from the lip, and the war has
 * pocked it and on some granaries punched a shell's gouge through the render
 * into the dark straw-mud behind, the spall lying on the platform under it.
 * The platform is a mud floor kerbed in fieldstone and carried down to the
 * ground where it falls away; sand drifts against the bins' feet. What
 * lies on it is low enough to walk over: sacks laid flat, a basket
 * and a wooden measure full of grain, and — where a granary has only three
 * bins — the ladder for the hatches, lying in the fourth's place.
 *
 * ## Colliders
 *
 * The platform, then one block a bin, each `0.82` of its foot's diameter
 * square and the bin's height — unchanged, and restated below exactly as first
 * emitted, so the bins' sizes are still `clothHash` over the params, which a
 * structure without a seed of its own needed and the colliders still do. The
 * drawing follows the three rules: on a face (the frames, the doors, the
 * stains — the pegs and the lintels stand out from the wall as they always
 * did, visual only, since a 7 cm peg is a shape `NavGrid` cannot hold and
 * three rays a bin is a cost nobody wants), low enough to step over (the
 * collar, the kerb, everything on the platform), or standing on a collider
 * (the lips, the domes, the pots).
 *
 * Seeded off where it stands (`streetSeed`), which is what puts it in
 * `CONFORMS_TO_TERRAIN`: where each bin's lifts break, which way its hatch
 * faces and whether it is shut, the pot or the knob, the stains, the pocks,
 * the gouge, the hands and what lies on the platform — and the platform's face
 * is carried down to the ground where it falls away.
 */
export function buildGranary(
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(mats, "granary");
  const w = p.width ?? 8;
  const d = p.depth ?? 7;
  const tall = p.height ?? 5.2;
  const skin = p.tint ?? MUDBRICK;

  // --- the colliders ---------------------------------------------------------
  b.block({ w, h: PLINTH, d, x: 0, y: PLINTH / 2, z: 0 });
  // Four positions on the plinth, the fourth dropped on about half of them,
  // which is what makes a row of these read as a store somebody kept adding to
  // rather than as a fitting placed four at a time.
  const spots: [number, number][] = [
    [-w * 0.24, -d * 0.2],
    [w * 0.22, -d * 0.22],
    [-w * 0.2, d * 0.24],
    [w * 0.25, d * 0.2],
  ];
  const n = clothHash(w, d, tall) > 0.45 ? 4 : 3;
  const bins: Bin[] = [];
  for (let i = 0; i < n; i++) {
    const [x, z] = spots[i];
    const r = clothHash(w, d, tall, i);
    const r2 = clothHash(tall, i, 11);
    const h = tall * (0.68 + r * 0.42);
    const bot = Math.min(w, d) * (0.3 + r2 * 0.09);
    const top = bot * (0.68 + r * 0.14);
    b.block({ w: bot * 0.82, h, d: bot * 0.82, x, y: PLINTH + h / 2, z });
    bins.push({ x, z, h, rb: (bot / 2) * 0.97, rt: (top / 2) * 0.97, yt: PLINTH + h });
  }

  // --- the drawing -------------------------------------------------------------
  const rnd = mulberry32(streetSeed(w, d, tall, ctx));
  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };
  const g: Granary = { w, d, skin, rnd, bins, lay: new Lay(), body: new Mesher() };
  platform(g, ground);
  for (const bin of bins) drawBin(g, bin);
  marks(g);
  dressing(g, n);
  g.lay.flush(b);
  // The bins' walls and the platform last: everything above is laid on them.
  b.surface(g.body.data(), skin);
  b.box(w, PLINTH, d, 0, PLINTH / 2, 0, MUDBRICK_DARK);
  return b;
}

/** One bin: its centre, height, its wall's apothem at the foot and the head, and the head's height. */
interface Bin {
  x: number;
  z: number;
  h: number;
  rb: number;
  rt: number;
  yt: number;
}

/** What every part of the drawing is measured off. */
interface Granary {
  w: number;
  d: number;
  skin: string;
  rnd: () => number;
  bins: Bin[];
  lay: Lay;
  /** The bins' plain walls, emitted after everything laid on them. */
  body: Mesher;
}

// --- a bin's faces ----------------------------------------------------------
//
// A bin is a frustum of `N` flat faces, face `k` looking along `k · TAU / N`
// (`band`'s phase 0). Everything laid on a bin is laid on ONE face, in that
// face's own terms — `u` across it, `y` up it, `out` past it — so every patch
// is planar on a planar facet, which the cel shader's per-facet light needs.

/** The faces a bin's wall is drawn in. */
const N = 12;
/** A box's local -Z face: the back of anything laid on a bin's face. */
const BACK = 1 << 5;

/** The bin's apothem at height `y`. */
const radius = (s: Bin, y: number): number => s.rb + ((s.rt - s.rb) * (y - PLINTH)) / s.h;
/** How far the wall leans in, as an angle off the vertical. */
const leanOf = (s: Bin): number => Math.atan2(s.rb - s.rt, s.h);
/** Half the width of a face at height `y`. */
const halfFace = (s: Bin, y: number): number => radius(s, y) * Math.tan(Math.PI / N);

/** A point on face `k` of bin `s`. */
function at(s: Bin, k: number, u: number, y: number, out: number): V3 {
  const a = (k * TAU) / N;
  const r = radius(s, y) + out;
  return [s.x + Math.sin(a) * r + Math.cos(a) * u, y, s.z + Math.cos(a) * r - Math.sin(a) * u];
}

/** The face looking most nearly along the bearing `a`. */
const faceToward = (a: number): number => (((Math.round(a / (TAU / N)) % N) + N) % N);

/** A box laid on face `k`, `out` being its centre past the face, `tilt` a turn in the face's plane. */
function onBin(g: Granary, s: Bin, k: number, u: number, y: number, along: number, tall: number, thick: number, out: number, color: string, tilt = 0): void {
  const c = at(s, k, u, y, out);
  g.lay.sb.box(along, tall, thick, c[0], c[1], c[2], color, { x: -leanOf(s), y: (k * TAU) / N, z: tilt }, BACK);
}

/** A stain on face `k` from `out0` to `out1`, fanned from `centre`, its edges' sides drawn only when asked. */
function onBinPoly(
  g: Granary,
  s: Bin,
  k: number,
  centre: readonly [number, number],
  pts: readonly (readonly [number, number])[],
  out0: number,
  out1: number,
  color: string,
  sides: boolean,
): void {
  const m = g.lay.m(color);
  const a = (k * TAU) / N;
  const fwd: V3 = [Math.sin(a), 0, Math.cos(a)];
  const c = at(s, k, centre[0], centre[1], out1);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    m.tri(c, at(s, k, p[0], p[1], out1), at(s, k, q[0], q[1], out1), fwd);
    if (!sides) continue;
    const mu = (p[0] + q[0]) / 2 - centre[0];
    const my = (p[1] + q[1]) / 2 - centre[1];
    const side: V3 = [Math.cos(a) * mu, my, -Math.sin(a) * mu];
    m.quad(at(s, k, p[0], p[1], out0), at(s, k, q[0], q[1], out0), at(s, k, q[0], q[1], out1), at(s, k, p[0], p[1], out1), side);
  }
}

// --- the bin ------------------------------------------------------------------

function drawBin(g: Granary, s: Bin): void {
  const { lay, rnd, skin } = g;
  // The wall itself: one frustum, emitted last.
  band(g.body, N, 0, s.rb, PLINTH, s.rt, s.yt, s.x, s.z);

  // The lifts' heads: a skirt running out and down from the wall to a ledge a
  // finger proud, lit on top. A lift is a forearm high and no two the same.
  const wall = lay.m(skin);
  let y = PLINTH + 0.5 + rnd() * 0.2;
  while (y < s.yt - 0.35) {
    const e = 0.028 + rnd() * 0.022;
    band(wall, N, 0, radius(s, y - 0.1), y - 0.1, radius(s, y) + e, y, s.x, s.z);
    disc(wall, N, 0, radius(s, y) + e, radius(s, y) - 0.01, y, true, s.x, s.z);
    y += 0.45 + rnd() * 0.4;
  }

  head(g, s);

  // The working face looks out from the platform, give or take a face.
  const out = faceToward(Math.atan2(s.x, s.z)) + Math.floor(rnd() * 3) - 1;
  const kh = (out + N) % N;
  const kd = (kh + (rnd() < 0.5 ? 2 : -2) + N) % N;
  hatch(g, s, kh);
  drawOff(g, s, kd);
  collar(g, s, kd);
  weather(g, s);
}

/** The rolled lip, the coursed dome and what stops the filling hole. */
function head(g: Granary, s: Bin): void {
  const { lay, rnd, skin } = g;
  const lip = lay.m(MUDBRICK_DARK);
  const o = 0.08 + rnd() * 0.03;
  band(lip, N, 0, s.rt, s.yt, s.rt + o, s.yt + 0.09, s.x, s.z);
  band(lip, N, 0, s.rt + o, s.yt + 0.09, s.rt + o - 0.012, s.yt + 0.22, s.x, s.z);
  disc(lip, N, 0, s.rt + o - 0.012, s.rt * 0.9, s.yt + 0.22, true, s.x, s.z);

  // The dome, cut off at the filling hole's neck.
  const neck = 0.15;
  const full = domeProfile(s.rt * 0.9, s.yt + 0.22, s.rt * (0.5 + rnd() * 0.14), 0.05, 5);
  const prof: [number, number][] = [];
  for (let i = 0; i < full.length; i++) {
    const [r, py] = full[i];
    if (r >= neck) {
      prof.push([r, py]);
      continue;
    }
    const [r0, y0] = full[i - 1];
    prof.push([neck, y0 + ((py - y0) * (r0 - neck)) / (r0 - r)]);
    break;
  }
  courses(lay.m(skin), N, 0, prof, 0.03, s.x, s.z);
  const yn = prof[prof.length - 1][1];

  if (rnd() < 0.62) {
    // An upturned pot over the hole: a rim sunk in the mud, a belly, a base.
    const pot = lay.m(MUDBRICK_DARK);
    const r = 0.19 + rnd() * 0.04;
    const pr: [number, number][] = [
      [neck + 0.02, yn - 0.02],
      [r, yn + 0.1],
      [r * 0.9, yn + 0.2],
      [r * 0.5, yn + 0.27],
      [r * 0.28, yn + 0.29],
    ];
    for (let i = 0; i + 1 < pr.length; i++) band(pot, 8, 0, pr[i][0], pr[i][1], pr[i + 1][0], pr[i + 1][1], s.x, s.z);
    disc(pot, 8, 0, pr[pr.length - 1][0], 0, pr[pr.length - 1][1], true, s.x, s.z);
  } else {
    // A knob of mud pressed over it, with a stick through it to lift it by.
    const knob = lay.m(MUDBRICK_DARK);
    band(knob, 8, 0, neck + 0.02, yn - 0.01, neck * 0.75, yn + 0.12, s.x, s.z);
    disc(knob, 8, 0, neck * 0.75, 0, yn + 0.12, true, s.x, s.z);
    const t = rnd() * TAU;
    eye(lay.m(PALM_BEAM), [s.x - Math.cos(t) * 0.2, yn + 0.09, s.z - Math.sin(t) * 0.2], [Math.cos(t), 0, Math.sin(t)], 0.022, 0.022, 0.4, 5, true, true);
  }
}

/** The filling hatch near the head and the pegs that climb to it. */
function hatch(g: Granary, s: Bin, k: number): void {
  const { rnd, skin } = g;
  const y = Math.min(PLINTH + s.h * 0.8, s.yt - 0.5);
  const hw = halfFace(s, y);
  const vw = Math.min(0.32, 2 * hw - 0.17);
  const vh = 0.44;
  onBin(g, s, k, 0, y, vw, vh, 0.02, 0.0, WINDOW_VOID);
  // The frame: mud jambs and a sill, a shade darker where hands have worn it,
  // under a palm-log lintel set in the wall.
  for (const t of [-1, 1]) onBin(g, s, k, t * (vw / 2 + 0.035), y, 0.07, vh + 0.06, 0.06, 0.02, MUDBRICK_DARK);
  onBin(g, s, k, 0, y - vh / 2 - 0.04, vw + 0.14, 0.08, 0.1, 0.03, MUDBRICK_DARK);
  onBin(g, s, k, 0, y + vh / 2 + 0.05, vw + 0.3, 0.1, 0.12, 0.03, PALM_BEAM);
  if (rnd() < 0.55) {
    // Shut: three boards on a batten, with daylight between them, a hasp and
    // a padlock.
    const bw = (vw - 0.03) / 3;
    for (let i = 0; i < 3; i++) {
      onBin(g, s, k, -vw / 2 + 0.015 + bw * (i + 0.5), y, bw - 0.014, vh - 0.02, 0.03, 0.035, PALM_BEAM);
    }
    onBin(g, s, k, 0, y + vh * 0.22, vw - 0.02, 0.06, 0.025, 0.06, PALM_BEAM);
    onBin(g, s, k, vw / 2 - 0.02, y, 0.09, 0.025, 0.015, 0.058, IRON);
    onBin(g, s, k, vw / 2 + 0.03, y - 0.04, 0.05, 0.06, 0.03, 0.06, IRON);
  } else {
    // Open: the door lies on the platform at the foot of the bin.
    const yaw = (k * TAU) / N + (rnd() - 0.5) * 0.8;
    const c = at(s, k, (rnd() - 0.5) * 0.3, PLINTH, 0.42);
    if (inside(g, c[0], c[2], 0.3)) g.lay.sb.box(vw, 0.03, vh, c[0], PLINTH + 0.016, c[2], PALM_BEAM, { y: yaw }, HIDE_DOWN);
  }
  // The pegs: split palm rib through the wall, alternating, from about a
  // knee's height to under the hatch. One of them has snapped.
  const pegs = g.lay.m(PALM_BEAM);
  const a = (k * TAU) / N;
  const dir: V3 = [Math.sin(a), -0.08, Math.cos(a)];
  const lo = PLINTH + 0.75;
  const count = Math.max(2, Math.floor((y - 0.35 - lo) / 0.46) + 1);
  const step = (y - 0.35 - lo) / Math.max(1, count - 1);
  const broken = Math.floor(rnd() * count);
  for (let i = 0; i < count; i++) {
    const py = lo + i * step;
    const pu = (i % 2 ? 1 : -1) * Math.min(0.13, halfFace(s, py) - 0.05);
    eye(pegs, at(s, k, pu, py, -0.04), dir, 0.035, 0.03, i === broken ? 0.13 : 0.4, 5, true, false);
  }
  // The wear the climbing leaves: the render rubbed dark between the pegs.
  onBinPoly(g, s, k, [0, (lo + y) / 2 - 0.2], [
    [-0.16, lo - 0.1],
    [0.16, lo - 0.1],
    [0.12, y - 0.45],
    [-0.12, y - 0.45],
  ], 0, 0.004, skin === MUDBRICK_DARK ? SCORCH : MUDBRICK_DARK, false);
}

/** The draw-off hole at the foot: framed in palm, plugged or open over a spill. */
function drawOff(g: Granary, s: Bin, k: number): void {
  const { rnd } = g;
  const y = PLINTH + 0.6;
  onBin(g, s, k, 0, y, 0.2, 0.18, 0.02, 0.0, WINDOW_VOID);
  onBin(g, s, k, 0, y + 0.12, 0.34, 0.06, 0.08, 0.03, PALM_BEAM);
  onBin(g, s, k, 0, y - 0.12, 0.3, 0.05, 0.08, 0.03, PALM_BEAM);
  const plugged = rnd() < 0.5;
  if (plugged) onBin(g, s, k, 0.01, y - 0.01, 0.17, 0.15, 0.05, 0.03, MUDBRICK_DARK, (rnd() - 0.5) * 0.2);
  // The grain that came out when it was last drawn.
  const c = at(s, k, (rnd() - 0.5) * 0.1, PLINTH, plugged ? 0.3 : 0.4);
  const a = plugged ? 0.18 : 0.32;
  if (inside(g, c[0], c[2], a + 0.05)) lobe(g.lay.m(SANDBAG), c[0], PLINTH + 0.014, c[2], a, a * 0.66, (k * TAU) / N, rnd);
}

/** The fieldstones the bin stands in, with a gap where the draw-off is. */
function collar(g: Granary, s: Bin, kd: number): void {
  const { rnd } = g;
  const count = Math.round((TAU * s.rb) / 0.34);
  const gap = (kd * TAU) / N;
  for (let j = 0; j < count; j++) {
    const a = ((j + rnd() * 0.3) * TAU) / count;
    const off = Math.abs(((a - gap + Math.PI * 3) % TAU) - Math.PI);
    if (off < 0.26) continue;
    const len = 0.22 + rnd() * 0.12;
    const tall = 0.14 + rnd() * 0.1;
    const deep = 0.14 + rnd() * 0.06;
    const r = s.rb + deep / 2 - 0.05;
    g.lay.sb.box(len, tall, deep, s.x + Math.sin(a) * r, PLINTH + tall / 2 - 0.01, s.z + Math.cos(a) * r, MUDBRICK, { y: a, z: (rnd() - 0.5) * 0.16 }, HIDE_DOWN);
  }
}

/** Rain gullies from the lip, pocks, and now and then a shell's gouge. */
function weather(g: Granary, s: Bin): void {
  const { rnd, skin } = g;
  const stain = skin === MUDBRICK_DARK ? SCORCH : MUDBRICK_DARK;
  const gullies = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < gullies; i++) {
    const k = Math.floor(rnd() * N);
    const top = s.yt - 0.03;
    const len = Math.min(top - PLINTH - 0.6, 0.7 + rnd() * 1.6);
    const u = (rnd() - 0.5) * halfFace(s, top) * 0.8;
    const wa = 0.06 + rnd() * 0.05;
    const sway = (rnd() - 0.5) * 0.06;
    onBinPoly(g, s, k, [u, top - len * 0.3], [
      [u - wa, top],
      [u + wa, top],
      [u + wa * 0.7 + sway, top - len * 0.4],
      [u + 0.02 + sway, top - len * 0.82],
      [u + sway * 1.4, top - len],
      [u - 0.02 + sway, top - len * 0.74],
      [u - wa * 0.8 + sway * 0.5, top - len * 0.35],
    ], 0, 0.005, stain, false);
  }
  // Pocks come in bursts, where a burst of fire walked across the bin.
  const bursts = Math.floor(rnd() * 3);
  for (let j = 0; j < bursts; j++) {
    const k0 = Math.floor(rnd() * N);
    const y0 = PLINTH + 0.8 + rnd() * (s.h - 1.4);
    const count = 3 + Math.floor(rnd() * 5);
    for (let i = 0; i < count; i++) {
      const k = k0 + Math.floor(rnd() * 3) - 1;
      const py = y0 + (rnd() - 0.5) * 0.9;
      const sz = 0.03 + rnd() * 0.045;
      onBin(g, s, k, (rnd() - 0.5) * halfFace(s, py) * 1.4, py, sz * (0.8 + rnd() * 0.5), sz, 0.02, 0.0, SCORCH, rnd() * 1.2);
    }
  }
}

/**
 * What the people who use it have left on it, once a granary: a shell's
 * gouge on one bin, hands pressed in whitewash on one, and a tally of sacks
 * in charcoal on one.
 */
function marks(g: Granary): void {
  const { rnd, bins, skin } = g;
  const pick = (): Bin => bins[Math.floor(rnd() * bins.length)];

  if (rnd() < 0.5) {
    // The gouge: render blown off to the dark straw-mud, a deeper hole in the
    // middle of it, a lip of render standing round it and the spall below.
    const s = pick();
    const k = Math.floor(rnd() * N);
    const y = PLINTH + 1.3 + rnd() * Math.max(0.2, s.h - 2.4);
    const hw = halfFace(s, y);
    const a = Math.min(0.2, hw - 0.04);
    const pts = ragged(0, y, a, 0.16 + rnd() * 0.05, 10, rnd);
    onBinPoly(g, s, k, [0, y], pts, 0, 0.006, MUDBRICK_DARK, false);
    onBinPoly(g, s, k, [0, y], ragged(0, y, a * 0.45, 0.07, 7, rnd), 0, 0.009, WINDOW_VOID, false);
    for (let i = 0; i < pts.length; i++) {
      const [ua, ya] = pts[i];
      const [ub, yb] = pts[(i + 1) % pts.length];
      const t = Math.atan2(yb - ya, ub - ua);
      onBin(g, s, k, (ua + ub) / 2, (ya + yb) / 2, Math.hypot(ub - ua, yb - ya) + 0.03, 0.04, 0.03, 0.012, skin, t > Math.PI / 2 ? t - Math.PI : t <= -Math.PI / 2 ? t + Math.PI : t);
    }
    for (let i = 0; i < 4; i++) {
      const c = at(s, k, (rnd() - 0.5) * 0.6, PLINTH, 0.25 + rnd() * 0.4);
      if (!inside(g, c[0], c[2], 0.1)) continue;
      const sz = 0.06 + rnd() * 0.07;
      g.lay.sb.box(sz * 1.3, sz * 0.6, sz, c[0], PLINTH + sz * 0.28, c[2], skin, { y: rnd() * TAU, z: (rnd() - 0.5) * 0.4 }, HIDE_DOWN);
    }
  }

  // The hands: palm and fingers pressed flat, two or three in a row.
  if (rnd() < 0.75) {
    const s = pick();
    const k = faceToward(Math.atan2(s.x, s.z)) + Math.floor(rnd() * 5) - 2;
    const count = 1 + Math.floor(rnd() * 3);
    const y0 = PLINTH + 1.3 + rnd() * 0.35;
    for (let i = 0; i < count; i++) {
      const u = (i - (count - 1) / 2) * 0.15;
      const y = y0 + (rnd() - 0.5) * 0.05;
      const turn = (rnd() - 0.5) * 0.35;
      const c = Math.cos(turn);
      const sn = Math.sin(turn);
      const put = (du: number, dy: number, along: number, tall: number, tilt: number): void =>
        onBin(g, s, k, u + du * c - dy * sn, y + du * sn + dy * c, along, tall, 0.006, 0.004, WHITEWASH, turn + tilt);
      put(0, 0, 0.08, 0.09, 0);
      put(-0.027, 0.075, 0.016, 0.056, 0.06);
      put(-0.009, 0.083, 0.016, 0.07, 0.02);
      put(0.009, 0.082, 0.016, 0.072, -0.02);
      put(0.027, 0.072, 0.016, 0.058, -0.06);
      put(-0.054, 0.0, 0.018, 0.055, 0.75);
    }
  }

  // The tally: strokes in fives, a few groups to a row.
  if (rnd() < 0.6) {
    const s = pick();
    const k = Math.floor(rnd() * N);
    const y = PLINTH + 0.95 + rnd() * 0.3;
    const groups = 1 + Math.floor(rnd() * 3);
    for (let r = 0; r < groups; r++) {
      const u0 = (r - (groups - 1) / 2) * 0.13 - 0.04;
      const strokes = r === groups - 1 ? 1 + Math.floor(rnd() * 4) : 4;
      for (let i = 0; i < strokes; i++) onBin(g, s, k, u0 + i * 0.022, y + (rnd() - 0.5) * 0.01, 0.011, 0.085, 0.006, 0.004, SCORCH, (rnd() - 0.5) * 0.08);
      if (strokes === 4) onBin(g, s, k, u0 + 0.033, y, 0.011, 0.11, 0.006, 0.005, SCORCH, -1.0);
    }
  }
}

// --- the platform -------------------------------------------------------------

/** Whether `(x, z)` is on the platform with `margin` to spare. */
const inside = (g: Granary, x: number, z: number, margin: number): boolean =>
  Math.abs(x) < g.w / 2 - margin && Math.abs(z) < g.d / 2 - margin;

/**
 * The platform: a kerb of fieldstones over its mud, a footing carried down to
 * the ground where it falls away, and sand blown against the bins' feet.
 */
function platform(g: Granary, ground: (lx: number, lz: number) => number): void {
  const { rnd, w, d } = g;
  const sides: Side[] = ["-z", "+z", "-x", "+x"];
  for (const s of sides) {
    const alongX = s === "-z" || s === "+z";
    const plane = alongX ? d / 2 : w / 2;
    const len = alongX ? w : d;
    const sign = s === "+z" || s === "+x" ? 1 : -1;
    const back = hideBack(s) | HIDE_DOWN;
    const local = (u: number, out: number): [number, number] => (alongX ? [u, sign * (plane + out)] : [sign * (plane + out), u]);

    // The kerb: fieldstones of a hand's height to a forearm's length, set in
    // the mud with their joints open.
    let u = -len / 2 + 0.02;
    while (u < len / 2 - 0.12) {
      const l = Math.min(len / 2 - 0.02 - u, 0.32 + rnd() * 0.38);
      const t = 0.15 + rnd() * 0.05;
      if (l > 0.1) g.lay.sb.onFace(s, plane, u + l / 2, 0.03 + t / 2 + rnd() * 0.02, l, t, 0.05, 0.015, MUDBRICK, (rnd() - 0.5) * 0.04, 0, back);
      u += l + 0.035;
    }

    // The footing, in four runs, each as deep as the lowest ground under it.
    const runs = 4;
    for (let i = 0; i < runs; i++) {
      const a = -len / 2 + (i * len) / runs;
      const c = a + len / runs;
      let low = 0;
      for (const uu of [a, (a + c) / 2, c]) {
        const [lx, lz] = local(uu, 0.15);
        low = Math.min(low, ground(lx, lz));
      }
      if (low < -0.03) g.lay.sb.onFace(s, plane, (a + c) / 2, (low + 0.03) / 2, c - a + 0.01, 0.03 - low, 0.12, 0.0, MUDBRICK_DARK, 0, 0, hideBack(s));
    }
  }

  // Sand against each bin's foot, inside the collar.
  for (const s of g.bins) {
    const t = rnd() * TAU;
    const r = s.rb + 0.32;
    const x = s.x + Math.sin(t) * r;
    const z = s.z + Math.cos(t) * r;
    const a = 0.35 + rnd() * 0.2;
    if (inside(g, x, z, a)) lobe(g.lay.m(SANDBAG), x, PLINTH + 0.016, z, a, 0.17 + rnd() * 0.08, t + Math.PI / 2, rnd);
  }
}

/**
 * What lies on the platform, all of it under a shin's height: sacks laid
 * flat, a basket and a measure of grain, and — where there are only three
 * bins — the hatches' ladder in the fourth's place.
 */
function dressing(g: Granary, n: number): void {
  const { rnd, bins, w, d } = g;
  const clear = (x: number, z: number, r: number): boolean =>
    inside(g, x, z, r) && bins.every((s) => Math.hypot(x - s.x, z - s.z) > s.rb + 0.28 + r);

  if (n === 3) {
    const cx = w * 0.25 - 0.2;
    const cz = d * 0.2;
    const yaw = (rnd() - 0.5) * 0.5;
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const L = 2.3;
    const wood = g.lay.sb;
    for (const t of [-1, 1]) wood.box(L, 0.07, 0.07, cx - t * 0.22 * sn, PLINTH + 0.035, cz + t * 0.22 * c, PALM_BEAM, { y: -yaw }, HIDE_DOWN);
    for (let i = 0; i < 6; i++) {
      const along = -L / 2 + 0.2 + (i * (L - 0.4)) / 5;
      wood.box(0.05, 0.05, 0.56, cx + along * c, PLINTH + 0.095, cz + along * sn, PALM_BEAM, { y: -yaw }, HIDE_DOWN);
    }
  }

  // Candidate places, tried in a seeded order: the platform's middle, its
  // edges between the bins, and the empty fourth place.
  const spots: [number, number][] = [
    [0, 0],
    [0, d * 0.42],
    [0, -d * 0.42],
    [w * 0.42, 0],
    [-w * 0.42, 0],
    [w * 0.3, d * 0.36],
    [-w * 0.05, d * 0.36],
  ];
  for (let i = spots.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [spots[i], spots[j]] = [spots[j], spots[i]];
  }
  const sacks = g.lay.m(SANDBAG);
  const wood = g.lay.m(PALM_BEAM);
  let placed = 0;
  for (const [x, z] of spots) {
    if (placed >= 3) break;
    if (!clear(x, z, 0.4)) continue;
    const kind = placed === 1 ? "basket" : "sacks";
    if (kind === "sacks") {
      // One or two sacks laid flat, slumped, each tied at the neck with its
      // ear past the tie — the set's sandbag, filled with something else.
      const yaw = rnd() * TAU;
      for (let j = 0; j < 1 + Math.floor(rnd() * 2); j++) {
        const a = yaw + (rnd() - 0.5) * 0.3;
        const c = Math.cos(a);
        const sn = Math.sin(a);
        const sx = x - j * 0.44 * sn;
        const sz = z + j * 0.44 * c;
        g.lay.sb.box(0.6, 0.16, 0.4, sx, PLINTH + 0.08, sz, SANDBAG, { y: -a }, HIDE_DOWN);
        g.lay.sb.box(0.48, 0.07, 0.3, sx - c * 0.02, PLINTH + 0.19, sz - sn * 0.02, SANDBAG, { y: -a }, HIDE_DOWN);
        eye(sacks, [sx + c * 0.29, PLINTH + 0.11, sz + sn * 0.29], [c, 0.1, sn], 0.07, 0.035, 0.08, 6, false, false);
        eye(sacks, [sx + c * 0.37, PLINTH + 0.118, sz + sn * 0.37], [c, 0.25, sn], 0.06, 0.02, 0.09, 6, true, false);
      }
    } else {
      // A palm-leaf basket heaped with grain, and the wooden measure beside it.
      band(wood, 8, 0, 0.15, PLINTH, 0.21, PLINTH + 0.2, x, z);
      disc(wood, 8, 0, 0.215, 0.18, PLINTH + 0.2, true, x, z);
      band(sacks, 8, 0, 0.185, PLINTH + 0.2, 0.08, PLINTH + 0.24, x, z);
      disc(sacks, 8, 0, 0.08, 0, PLINTH + 0.24, true, x, z);
      const t = rnd() * TAU;
      const mx = x + Math.cos(t) * 0.38;
      const mz = z + Math.sin(t) * 0.38;
      band(wood, 8, 0, 0.11, PLINTH, 0.11, PLINTH + 0.18, mx, mz);
      disc(wood, 8, 0, 0.11, 0.09, PLINTH + 0.18, true, mx, mz);
      disc(sacks, 8, 0, 0.09, 0, PLINTH + 0.165, true, mx, mz);
      band(g.lay.m(IRON), 8, 0, 0.115, PLINTH + 0.13, 0.115, PLINTH + 0.155, mx, mz);
    }
    placed++;
  }
}
