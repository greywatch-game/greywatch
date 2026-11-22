/**
 * kit/desert/qubba.ts — buildQubba: a saint's domed tomb of the late Ottoman
 * province, a limewashed cube on a stone socle under a dog-tooth cornice and
 * a crenellated parapet, a framed portal with a striped arch, a broached
 * octagonal drum and a white dome laid in courses — the thing every burial
 * ground in this part of the world is laid out round. Part of the
 * desert-town set: follows the contract in kit/core.ts and the set's rules in
 * `./index.ts`. Invariants: the three colliders byte for byte and in their
 * order, restated at the top — the plinth, the cube to its merlons' head, the
 * drum and dome as one block — cover, never walked, never entered; variation
 * is seeded off where it stands, never `Math.random()`. Never imports another
 * builder.
 */
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import { CONFIG } from "../../../config";
import { mulberry32 } from "../../rng";
import { marksSway } from "../../sway";
import {
  ALLOY,
  Build,
  IRON,
  carve,
  hideBack,
  streetSeed,
  type BuildCtx,
  type BuildParams,
  type Mesher,
  type Side,
  type Structure,
  type V3,
} from "../core";
import {
  CLOTH,
  MUDBRICK,
  MUDBRICK_DARK,
  PALM_BEAM,
  PLINTH,
  ROOF_MUD,
  SCORCH,
  WHITEWASH,
  WINDOW_VOID,
} from "./shared";
import {
  HIDE_DOWN,
  Lay,
  TAU,
  above,
  band,
  blindBay,
  blob,
  cornice,
  courses,
  disc,
  domeProfile,
  kufic,
  lobe,
  log,
  pocks,
  pointed,
  ring,
  slabOn,
  socle,
  spall,
  spout,
  star,
} from "./lay";

/**
 * The qubba: a cube about as tall as it is wide, a parapet of stepped
 * merlons with a taller horn at each corner, a squat octagonal drum, and a
 * limewashed dome over it, with its one door on the -Z face.
 *
 * ## What it is FOR
 *
 * **A landmark you can READ, in a town whose one chroma is spent.** The
 * mosques carry `TILE_BLUE`; this is the other dome on the skyline, and it is
 * white, so it says "tomb" from four hundred metres and never "mosque". It
 * stands at the head of a burial ground or by a gate, which is where every
 * town on a caravan road put its saint, and on a map otherwise made of flat
 * roofs it is the one solid silhouette that is not a house.
 *
 * In play it is a pillar of mud the size of a small room: solid cover all
 * round, nothing to climb, nothing inside. The door is drawn and not cut —
 * a qubba is one chamber over a cenotaph, and a fight that could get into a
 * six-metre box would be a fight about a corner nobody can leave. So the door
 * is drawn SHUT and padlocked, which is what a tomb with a keeper is between
 * visits, rather than open on a dark room a body then walks into.
 *
 * ## What it is drawn as
 *
 * A saint's tomb of the Ottoman centuries in the river provinces, of a piece
 * with the hammam and the khan: limewashed brick on a socle of dressed stone,
 * pilasters squaring each corner, a dog-tooth cornice under the parapet's
 * merlons. Each side and the back carry a blind bay (`blindBay`); the sides'
 * hold the grilled window pilgrims look in at the cenotaph through, and rags
 * are tied to its bars — the custom, and cloth, so the wind has it. The back's
 * holds a niche under a star. On the front, a frontispiece stands proud of the
 * wall: jambs and a pointed arch in stone of two colours, a studded door of
 * palm boards shut under a lintel and a padlock, and the inscription — in the
 * tympanum on a small tomb, in a cartouche over the arch on a larger one, its
 * tympanum then a grille. Beside it, a lamp niche black with soot and a tin
 * alms box. The roof is mud with patches; the drum rises off a square base
 * whose corners are carried up as broaches, colonnettes at its angles,
 * grilled windows on the four bearings and blind niches between, a corbelled
 * ledge and a ring of small merlons round the dome's foot. The dome is laid
 * in courses (`courses`, pointed by `domeProfile`), as every dome in the set
 * is, and ends in an alem: three brass balls and a crescent.
 *
 * War has reached it as it has the town: render lost back to the brick, a
 * scatter of pocks, the spouts' streaks. Votive stones and clay lamps stand on
 * the step, and a half-step leads up onto the plinth from the ground.
 *
 * ## The dome is courses, white, and not the mosque's
 *
 * The cel shader bands light, so a smooth sphere bands into contour rings and
 * courses band into what reads as courses of plaster. It is limewashed rather
 * than tiled — the white is the read — and has no glass eyes, which are the
 * hammam's.
 *
 * ## Colliders
 *
 * The plinth, then the cube to the head of its merlons, then the drum and the
 * dome as one block over the middle — a round aimed at the dome from the
 * citadel stops on it rather than passing through a drawn dome into the sky.
 * Unchanged, and restated below exactly as first emitted. Everything after is
 * DRAWING: on a face (the frontispiece stands 0.1 proud, the pilasters 0.09,
 * the cornice 0.14 — a round passes them as it passes the hammam's), low
 * enough to step over (the threshold, the half-step, the lamps and stones),
 * or standing on a collider (the parapet, the drum, the dome, the alem).
 *
 * Seeded off where it stands (`streetSeed`), which is what puts it in
 * `CONFORMS_TO_TERRAIN`: which side the lamp niche is on, the rags, the
 * spalls, the pocks, the spouts and the roof's patches — and the plinth's face
 * and the half-step are carried down to the ground where it falls away.
 */
export function buildQubba(
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(mats, "qubba");
  const w = p.width ?? 6;
  const skin = p.tint ?? WHITEWASH;
  const half = w / 2;
  // The cube's height: a little under its width, which is the proportion
  // that makes the dome sit ON the box rather than float off a tower.
  const hc = w * 0.72;
  const top = PLINTH + hc;
  const merlonH = 0.5;

  // --- the colliders ---------------------------------------------------------
  b.block({ w: w + 0.4, h: PLINTH, d: w + 0.4, x: 0, y: PLINTH / 2, z: 0 });
  b.block({ w, h: hc + merlonH, d: w, x: 0, y: PLINTH + (hc + merlonH) / 2, z: 0 });
  const drumD = w * 0.74;
  const drumH = Math.max(0.9, w * 0.17);
  const domeH = w * 0.46;
  b.block({
    w: drumD * 0.74,
    h: drumH + domeH * 0.8,
    d: drumD * 0.74,
    x: 0,
    y: top + 0.35 + (drumH + domeH * 0.8) / 2,
    z: 0,
  });

  // --- the drawing -------------------------------------------------------------
  const rnd = mulberry32(streetSeed(w, w, hc, ctx));
  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };
  const q: Qubba = {
    w,
    half,
    hc,
    top,
    skin,
    rnd,
    doorW: Math.min(1.3, w * 0.24),
    fw: Math.min(1.3, w * 0.24) + 1.3,
    bayW: w * 0.46,
    cornY: top - 0.42,
  };
  const lay = new Lay();
  walls(lay, q, ground);
  portal(lay, q, ground);
  parapet(lay, q);
  drum(lay, q, drumD, drumH, domeH);
  lay.flush(b);
  rags(b, q);

  b.box(w + 0.4, PLINTH, w + 0.4, 0, PLINTH / 2, 0, MUDBRICK_DARK);
  b.box(w, hc, w, 0, PLINTH + hc / 2, 0, skin);
  return b;
}

/** What every part of the drawing is measured off. */
interface Qubba {
  w: number;
  half: number;
  hc: number;
  top: number;
  skin: string;
  rnd: () => number;
  doorW: number;
  /** The frontispiece's width. */
  fw: number;
  /** A blind bay's width. */
  bayW: number;
  /** The cornice's foot, which every pilaster and bay stops under. */
  cornY: number;
}

const SIDES: readonly Side[] = ["-z", "+z", "-x", "+x"];

/** Where the socle's weathering course ends and the wall's dressing begins. */
const DADO = PLINTH + 0.72;

/** The blind bays' window, as `blindBay` lays it, for the rags tied to its grille. */
function bayWindow(q: Qubba): { ww: number; wh: number; sill: number } {
  const lo = DADO;
  const hi = q.cornY - 0.04;
  const span = q.bayW - 0.22 - 0.1;
  const rise = Math.max(span / 2, Math.min(span * 0.62, (hi - lo) * 0.42));
  const ys = hi - 0.12 - rise - 0.11;
  return {
    ww: Math.min(1.0, span * 0.4),
    wh: Math.min(1.4, (ys - lo) * 0.62),
    sill: lo + Math.max(0.45, (ys - lo) * 0.22),
  };
}

// --- the walls --------------------------------------------------------------------

/**
 * The socle, the corner pilasters, the cornice, the blind bays, the spouts and
 * what the war and the weather have done to the render — on every face, the
 * front's run carved round its frontispiece. And the plinth's face carried
 * down to the ground where the ground falls away under it.
 */
function walls(lay: Lay, q: Qubba, ground: (lx: number, lz: number) => number): void {
  const { half, skin, rnd, cornY } = q;
  const wrap = 0.054;
  // Which side the spalls and the pocks are on: the war came from one
  // quarter, and the far face is clean.
  const hit: Side = (["+z", "-x", "+x"] as const)[Math.floor(rnd() * 3)];
  for (const s of SIDES) {
    const back = hideBack(s);
    const front = s === "-z";
    for (const [a, c] of carve(-half - wrap, half + wrap, front ? [[-q.fw / 2, q.fw / 2]] : [])) {
      socle(lay, s, half, a, c, rnd);
    }

    // The pilasters: one each end, carried round the arris to meet the next
    // face's, from the weathering course to the cornice, with a base and a
    // capital in the shade.
    for (const e of [-1, 1]) {
      const u = e * (half - 0.18);
      lay.sb.onFace(s, half, u, (DADO + cornY) / 2, 0.54, cornY - DADO, 0.09, 0.045, skin, 0, 0, back);
      lay.sb.onFace(s, half, e * (half - 0.16), DADO + 0.06, 0.6, 0.12, 0.13, 0.065, MUDBRICK_DARK, 0, 0, back);
      lay.sb.onFace(s, half, e * (half - 0.16), cornY - 0.08, 0.6, 0.16, 0.14, 0.07, MUDBRICK_DARK, 0, 0, back);
    }
    cornice(lay, s, half, -half - 0.14, half + 0.14, cornY);

    // The plinth's face, down to the ground where it falls away.
    let low = 0;
    for (let i = 0; i <= 6; i++) {
      const u = -half - 0.2 + (i / 6) * (2 * half + 0.4);
      const o = (half + 0.25) * (s === "+z" || s === "+x" ? 1 : -1);
      low = Math.min(low, s === "-z" || s === "+z" ? ground(u, o) : ground(o, u));
    }
    if (low < -0.03) lay.sb.onFace(s, half, 0, low / 2, 2 * half + 0.4, -low, 0.2, 0.1, MUDBRICK_DARK, 0, 0, back);

    if (front) continue;
    const sideFace = s !== "+z";
    blindBay(lay, s, half, 0, q.bayW, DADO, cornY - 0.04, skin, sideFace);
    if (!sideFace) niche(lay, q, s);

    // The gap between the bay and the pilaster, where the spout runs and the
    // render goes.
    const g0 = q.bayW / 2;
    const g1 = half - 0.45;
    const gu = (g0 + g1) / 2;
    if (sideFace) {
      const e = rnd() < 0.5 ? -1 : 1;
      spout(lay, s, half, e * gu, q.top + 0.05, cornY - 0.04, rnd);
    }
    if (s === hit) {
      const e = rnd() < 0.5 ? -1 : 1;
      const hu = Math.min(0.3, (g1 - g0) / 2 - 0.08);
      spall(lay, s, half, e * gu, PLINTH + 1.15 + rnd() * 0.3, hu, 0.2 + rnd() * 0.08, skin, rnd);
      pocks(lay, s, half, -half + 0.5, half - 0.5, DADO + 0.2, cornY - 0.3, 6 + Math.floor(rnd() * 5), rnd);
    }
  }
}

/** The back's bay: a niche under a star, where a qibla wall would carry one. */
function niche(lay: Lay, q: Qubba, s: Side): void {
  const sill = DADO + 0.75;
  const nw = Math.min(0.6, q.bayW * 0.24);
  const spring = Math.min(1.0, q.hc * 0.24);
  const rise = nw * 0.6;
  slabOn(lay, s, q.half, pointed(0, sill, nw, spring, rise), 0.015, 0.027, MUDBRICK_DARK);
  ring(lay, s, q.half, 0, sill + spring, nw, rise, 0.1, 0.05, 0.04, [MUDBRICK]);
  for (const e of [-1, 1]) lay.sb.onFace(s, q.half, e * (nw / 2 + 0.05), sill + spring / 2, 0.1, spring, 0.05, 0.04, MUDBRICK, 0, 0, hideBack(s));
  lay.sb.onFace(s, q.half, 0, sill - 0.05, nw + 0.3, 0.1, 0.12, 0.06, MUDBRICK_DARK, 0, 0, hideBack(s));
  star(lay, s, q.half, 0, sill + spring + rise + 0.5, 0.34, 0.03, MUDBRICK_DARK);
}

// --- the portal ---------------------------------------------------------------------

/**
 * The front: a frontispiece proud of the wall with its own socle and a roll
 * round it, the door in stone of two colours — jambs, a pointed arch, a palm
 * lintel — and the leaves shut in it, strapped and studded, padlocked at the
 * meeting stiles. The inscription goes where it fits. Beside it the lamp
 * niche and the alms box, and at its foot the threshold, the half-step and
 * what pilgrims leave there.
 */
function portal(lay: Lay, q: Qubba, ground: (lx: number, lz: number) => number): void {
  const s: Side = "-z";
  const { half, skin, rnd, doorW, fw, cornY } = q;
  const back = hideBack(s);
  const PP = 0.1;
  // The panel, and the roll round its sides and head.
  lay.sb.onFace(s, half, 0, (PLINTH + cornY) / 2, fw, cornY - PLINTH, PP, PP / 2, skin, 0, 0, back);
  const fx = fw / 2 - 0.08;
  const fTop = cornY - 0.12;
  for (const e of [-1, 1]) lay.sb.onFace(s, half, e * fx, (DADO + fTop) / 2, 0.08, fTop - DADO, 0.05, PP + 0.025, MUDBRICK_DARK, 0, 0, back);
  lay.sb.onFace(s, half, 0, fTop, 2 * fx + 0.08, 0.08, 0.05, PP + 0.025, MUDBRICK_DARK, 0, 0, back);

  // The door's measure.
  const dw = doorW / 2;
  const jw = 0.22;
  const sill = PLINTH + 0.02;
  const dh = Math.min(3.0, q.hc * 0.7);
  const rise = doorW * 0.55;
  const spring = dh - rise;
  const ys = sill + spring;

  // The panel's socle, either side of the jambs.
  for (const e of [-1, 1]) {
    const a = dw + jw;
    const c = fw / 2;
    lay.sb.onFace(s, half, e * (a + c) / 2, PLINTH + 0.33, c - a, 0.62, 0.04, PP + 0.02, MUDBRICK, 0, 0, back);
    lay.sb.onFace(s, half, e * (a + c) / 2, PLINTH + 0.66, c - a + 0.04, 0.08, 0.1, PP + 0.04, MUDBRICK_DARK, 0, 0, back);
  }
  // The jambs and the arch: stone of two colours in turn.
  const nJ = Math.max(4, Math.round(spring / 0.3));
  const jh = spring / nJ;
  for (let i = 0; i < nJ; i++) {
    for (const e of [-1, 1]) {
      lay.sb.onFace(s, half, e * (dw + jw / 2), sill + (i + 0.5) * jh, jw, jh - 0.02, 0.08, PP + 0.04, i % 2 ? MUDBRICK_DARK : MUDBRICK, 0, 0, back);
    }
  }
  ring(lay, s, half, 0, ys, doorW, rise, jw, 0.08, PP + 0.04, [MUDBRICK, MUDBRICK_DARK]);
  // A rosette in each spandrel.
  for (const e of [-1, 1]) star(lay, s, half, e * (dw + jw + (fx - 0.04 - dw - jw) / 2), ys + rise * 0.7, 0.2, PP + 0.015, MUDBRICK_DARK);

  // The lintel, and the leaves under it.
  const lh = 0.14;
  lay.sb.onFace(s, half, 0, ys - lh / 2, doorW + 0.02, lh, 0.06, PP + 0.03, PALM_BEAM, 0, 0, back);
  const leafH = spring - lh;
  lay.sb.onFace(s, half, 0, sill + leafH / 2, doorW, leafH, 0.01, PP + 0.005, WINDOW_VOID, 0, 0, back);
  for (const e of [-1, 1]) {
    const nB = 4;
    const bw = dw / nB;
    for (let j = 0; j < nB; j++) {
      lay.sb.onFace(s, half, e * (0.008 + (j + 0.5) * bw), sill + leafH / 2, bw - 0.018, leafH - 0.02, 0.04, PP + 0.02 + rnd() * 0.006, PALM_BEAM, 0, 0, back);
    }
    // Three straps, studded, and a ring on a boss.
    for (const yy of [0.3, leafH / 2, leafH - 0.3]) {
      lay.sb.onFace(s, half, e * dw / 2, sill + yy, dw - 0.06, 0.05, 0.015, PP + 0.048, IRON, 0, 0, back);
      for (let c = 0; c < 4; c++) lay.sb.onFace(s, half, e * (0.08 + c * ((dw - 0.16) / 3)), sill + yy, 0.035, 0.035, 0.03, PP + 0.056, IRON, 0, 0, back);
    }
    const ku = e * dw * 0.45;
    const ky = sill + leafH * 0.56;
    lay.sb.onFace(s, half, ku, ky, 0.06, 0.06, 0.03, PP + 0.056, IRON, 0, 0, back);
    for (const t of [-1, 1]) {
      lay.sb.onFace(s, half, ku + t * 0.03, ky - 0.075, 0.016, 0.1, 0.016, PP + 0.066, IRON, (t * Math.PI) / 5, 0, back);
    }
  }
  // The hasp over the meeting stiles and the padlock hung on it.
  lay.sb.onFace(s, half, 0.04, sill + leafH * 0.5, 0.2, 0.05, 0.02, PP + 0.05, IRON, 0, 0, back);
  lay.sb.onFace(s, half, 0, sill + leafH * 0.5 - 0.11, 0.09, 0.11, 0.04, PP + 0.075, IRON, 0, 0, back);
  lay.sb.onFace(s, half, 0, sill + leafH * 0.5 - 0.03, 0.05, 0.06, 0.012, PP + 0.075, IRON, 0, 0, back);

  // The inscription: in a cartouche over the arch where the wall has the
  // height, its tympanum then a grille; in the tympanum where it has not.
  const tymp = above(pointed(0, sill, doorW, spring, rise), ys);
  const put = (u: number, yy: number, along: number, tall: number): void =>
    lay.sb.onFace(s, half, u, yy, along, tall, 0.02, PP + 0.02, skin, 0, 0, back);
  const cy0 = ys + rise + jw + 0.1;
  const cy1 = fTop - 0.1;
  const cw = 2 * fx - 0.3;
  if (cy1 - cy0 > 0.3) {
    slabOn(lay, s, half, [[-cw / 2, cy0], [cw / 2, cy0], [cw / 2, cy1], [-cw / 2, cy1]], PP, PP + 0.012, MUDBRICK_DARK);
    for (const e of [-1, 1]) lay.sb.onFace(s, half, e * (cw / 2 + 0.04), (cy0 + cy1) / 2, 0.08, cy1 - cy0 + 0.16, 0.05, PP + 0.025, MUDBRICK, 0, 0, back);
    for (const yy of [cy0 - 0.04, cy1 + 0.04]) lay.sb.onFace(s, half, 0, yy, cw + 0.16, 0.08, 0.05, PP + 0.025, MUDBRICK, 0, 0, back);
    const lineH = (cy1 - cy0 - 0.1) / 2;
    kufic(put, -cw / 2 + 0.05, cw / 2 - 0.05, cy0 + 0.03, lineH, rnd);
    kufic(put, -cw / 2 + 0.05, cw / 2 - 0.05, cy0 + lineH + 0.07, lineH, rnd);
    lay.sb.onFace(s, half, 0, cy0 + lineH + 0.05, cw - 0.1, 0.03, 0.02, PP + 0.02, MUDBRICK, 0, 0, back);
    // The grille: the void, two bars up and one across.
    slabOn(lay, s, half, tymp, PP, PP + 0.01, WINDOW_VOID);
    for (const t of [-1, 1]) lay.sb.onFace(s, half, t * doorW * 0.17, ys + rise * 0.4, 0.03, rise * 0.8, 0.03, PP + 0.03, IRON, 0, 0, back);
    lay.sb.onFace(s, half, 0, ys + rise * 0.35, doorW * 0.8, 0.03, 0.03, PP + 0.032, IRON, 0, 0, back);
  } else {
    slabOn(lay, s, half, tymp, PP, PP + 0.012, MUDBRICK_DARK);
    kufic(put, -dw * 0.62, dw * 0.62, ys + 0.04, rise * 0.44, rnd);
  }

  // The lamp niche on one side, black with the soot of the lamps lit in it;
  // the alms box on the other.
  const e = rnd() < 0.5 ? -1 : 1;
  const nu = e * (fw / 2 + (half - 0.45)) / 2;
  const ns = PLINTH + 1.05;
  slabOn(lay, s, half, pointed(nu, ns, 0.28, 0.3, 0.16), 0, 0.012, SCORCH);
  ring(lay, s, half, nu, ns + 0.3, 0.28, 0.16, 0.06, 0.05, 0.025, [MUDBRICK_DARK]);
  for (const t of [-1, 1]) lay.sb.onFace(s, half, nu + t * 0.17, ns + 0.15, 0.06, 0.3, 0.05, 0.025, MUDBRICK_DARK, 0, 0, back);
  lay.sb.onFace(s, half, nu, ns - 0.03, 0.42, 0.06, 0.14, 0.07, MUDBRICK_DARK, 0, 0, back);
  // The soot: a smudge fanning out of the niche's head, broader than it is
  // tall and a shade off the wall rather than black — lamp smoke on lime.
  const head = ns + 0.4;
  const sh = 0.26 + rnd() * 0.1;
  blob(lay, s, half, [nu, head + sh * 0.4], [
    [nu - 0.12, head],
    [nu + 0.12, head],
    [nu + 0.22, head + sh * 0.55],
    [nu + 0.14, head + sh * 0.95],
    [nu + 0.03, head + sh],
    [nu - 0.09, head + sh * 0.9],
    [nu - 0.2, head + sh * 0.6],
  ], 0, 0.005, MUDBRICK);
  const clay = lay.m(MUDBRICK_DARK);
  const lampZ = -(half + 0.07);
  band(clay, 6, 0, 0.05, ns, 0.035, ns + 0.05, nu, lampZ);
  disc(clay, 6, 0, 0.035, 0, ns + 0.05, true, nu, lampZ);
  // The alms box: a boarded box on the wall under a sloped lid, strapped,
  // its slot and its hasp.
  const au = -nu;
  const ay = PLINTH + 1.2;
  lay.sb.onFace(s, half, au, ay, 0.26, 0.32, 0.14, 0.07, PALM_BEAM, 0, 0, back);
  lay.sb.box(0.3, 0.03, 0.19, au, ay + 0.17, -(half + 0.085), PALM_BEAM, { x: 0.25 }, HIDE_DOWN);
  lay.sb.box(0.12, 0.012, 0.025, au, ay + 0.19, -(half + 0.1), WINDOW_VOID, { x: 0.25 }, HIDE_DOWN);
  for (const yy of [-0.1, 0.08]) lay.sb.onFace(s, half, au, ay + yy, 0.27, 0.035, 0.15, 0.075, IRON, 0, 0, back);
  lay.sb.onFace(s, half, au, ay - 0.02, 0.04, 0.08, 0.02, 0.15, IRON, 0, 0, back);
  lay.sb.onFace(s, half, au, ay - 0.08, 0.05, 0.05, 0.03, 0.16, IRON, 0, 0, back);

  // The threshold: one worn stone across the door from the wall to the
  // plinth's edge, its top the plinth's own so nothing walking in sinks; and
  // the half-step in front of the plinth, down to the ground.
  lay.sb.box(doorW + 0.5, 0.04, 0.2, 0, PLINTH, -(half + 0.1), MUDBRICK, undefined, HIDE_DOWN);
  const sw = doorW + 0.9;
  const z0 = half + 0.2;
  const z1 = z0 + 0.38;
  const g = Math.min(0, ground(-sw / 2, -z1), ground(sw / 2, -z1));
  const stepTop = PLINTH / 2;
  lay.sb.box(sw, stepTop - g, z1 - z0, 0, (stepTop + g) / 2, -(z0 + z1) / 2, MUDBRICK, undefined, HIDE_DOWN);
  // What pilgrims leave: clay lamps at the step's ends and votive stones
  // heaped beside them, a hand high.
  for (const t of [-1, 1]) {
    if (rnd() < 0.3) continue;
    const lx = t * (sw / 2 - 0.12);
    const lz = -(z0 + z1) / 2 + (rnd() - 0.5) * 0.12;
    band(clay, 6, 0, 0.055, stepTop, 0.04, stepTop + 0.05, lx, lz);
    disc(clay, 6, 0, 0.04, 0, stepTop + 0.05, true, lx, lz);
  }
  const heap = -e;
  for (let i = 0; i < 5; i++) {
    const r = rnd();
    const sz = 0.08 + r * 0.06;
    lay.sb.box(sz * 1.2, sz * 0.7, sz, heap * (sw / 2 + 0.1 + i * 0.1), sz * 0.35, -(z0 + 0.1 + (i % 2) * 0.12), i % 3 ? MUDBRICK : MUDBRICK_DARK, { y: r * 2, z: (r - 0.5) * 0.4 }, HIDE_DOWN);
  }
}

// --- the parapet and the roof ---------------------------------------------------------

/**
 * A low band round the roof and a row of stepped merlons on it, with a
 * taller "horn" at each corner — the silhouette that says North Africa and
 * the Gulf at once, and the one thing at roof height a cube can hang a
 * shadow from. Inside it, the roof's mud and the darker patches where it has
 * been made good.
 */
function parapet(lay: Lay, q: Qubba): void {
  const { w, half, top, skin, rnd } = q;
  const sb = lay.sb;
  const band = 0.24;
  const merlonH = 0.5;
  for (const sz of [-1, 1]) sb.box(w, band, 0.36, 0, top + band / 2, sz * (half - 0.18), skin);
  for (const sx of [-1, 1]) sb.box(0.36, band, w - 0.72, sx * (half - 0.18), top + band / 2, 0, skin);
  // A coping along the band's outer edge, standing a little proud of the
  // wall, which is the line the merlons rise from.
  for (const sz of [-1, 1]) sb.box(w + 0.06, 0.05, 0.1, 0, top + band - 0.02, sz * (half - 0.02), MUDBRICK_DARK, undefined, HIDE_DOWN);
  for (const sx of [-1, 1]) sb.box(0.1, 0.05, w + 0.06, sx * (half - 0.02), top + band - 0.02, 0, MUDBRICK_DARK, undefined, HIDE_DOWN);
  const mer = Math.max(3, Math.round((w - 1.2) / 0.78));
  for (let i = 1; i < mer; i++) {
    const t = -half + 0.6 + (i / mer) * (w - 1.2);
    const mh = merlonH - band + 0.08;
    for (const s of [-1, 1]) {
      sb.box(0.34, mh, 0.32, t, top + band + mh / 2, s * (half - 0.18), skin, undefined, HIDE_DOWN);
      sb.box(0.17, 0.14, 0.32, t, top + band + mh + 0.07, s * (half - 0.18), skin, undefined, HIDE_DOWN);
      sb.box(0.32, mh, 0.34, s * (half - 0.18), top + band + mh / 2, t, skin, undefined, HIDE_DOWN);
      sb.box(0.32, 0.14, 0.17, s * (half - 0.18), top + band + mh + 0.07, t, skin, undefined, HIDE_DOWN);
    }
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * (half - 0.26);
      const z = sz * (half - 0.26);
      sb.box(0.52, 0.72, 0.52, x, top + 0.36, z, skin, undefined, HIDE_DOWN);
      sb.box(0.36, 0.22, 0.36, x, top + 0.83, z, skin, undefined, HIDE_DOWN);
      sb.box(0.18, 0.18, 0.18, x, top + 1.03, z, skin, undefined, HIDE_DOWN);
      // A knob of mud on each horn's head.
      sb.box(0.1, 0.08, 0.1, x, top + 1.16, z, MUDBRICK_DARK, { y: Math.PI / 4 }, HIDE_DOWN);
    }
  }
  // The roof: mud inside the band, and two or three patches made good.
  sb.box(w - 0.72, 0.03, w - 0.72, 0, top + 0.015, 0, ROOF_MUD, undefined, HIDE_DOWN);
  const patch = lay.m(MUDBRICK_DARK);
  const n = 2 + Math.floor(rnd() * 2);
  for (let i = 0; i < n; i++) {
    const a = rnd() * TAU;
    const r = half - 0.75 - rnd() * 0.2;
    lobe(patch, Math.sin(a) * r, top + 0.04, Math.cos(a) * r, 0.25 + rnd() * 0.2, 0.15 + rnd() * 0.1, rnd() * Math.PI, rnd);
  }
}

// --- the drum and the dome -------------------------------------------------------------

/** A point on the octagon's flat that faces bearing `a`: `u` across it, `y` up, `r` from the axis. */
function onFlat(a: number, u: number, y: number, r: number): V3 {
  const s = Math.sin(a);
  const c = Math.cos(a);
  return [s * r + c * u, y, c * r - s * u];
}

/** A convex outline in a flat's `(u, y)`, laid on it from `r0` to `r1` out from the axis. */
function flatSlab(m: Mesher, a: number, pts: readonly [number, number][], r0: number, r1: number): void {
  const n = pts.length;
  const f = pts.map(([u, y]) => onFlat(a, u, y, r1));
  const r = pts.map(([u, y]) => onFlat(a, u, y, r0));
  const s = Math.sin(a);
  const c = Math.cos(a);
  for (let i = 1; i + 1 < n; i++) m.tri(f[0], f[i], f[i + 1], [s, 0, c]);
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  const sg = area > 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const du = pts[j][0] - pts[i][0];
    const dy = pts[j][1] - pts[i][1];
    m.quad(r[i], r[j], f[j], f[i], [c * sg * dy, -sg * du, -s * sg * dy]);
  }
}

/**
 * The square base the squinches turn into an octagon, its corners carried up
 * the diagonal flats as broaches; the drum with a colonnette at every angle,
 * a grilled window on each bearing and a blind niche between; the corbelled
 * ledge at its head with a ring of small merlons round the dome's foot; the
 * dome in courses; and the alem.
 */
function drum(lay: Lay, q: Qubba, drumD: number, drumH: number, domeH: number): void {
  const { top, skin } = q;
  const m = lay.m(skin);
  const dark = lay.m(MUDBRICK_DARK);
  const yb = top + 0.35;
  const yh = yb + drumH;
  // The drum's apothem: the octagon the first cut drew, measured to its flats.
  const ao = (drumD / 2) * Math.cos(Math.PI / 8);
  const k8 = 1 / Math.cos(Math.PI / 8);
  const hs = (drumD + 0.3) / 2;
  lay.sb.box(2 * hs, yb - top - 0.03, 2 * hs, 0, (top + 0.03 + yb) / 2, 0, skin, undefined, HIDE_DOWN);
  band(m, 8, 0, ao, yb, ao, yh);
  // The broaches: each corner of the square carried up to a point on the
  // diagonal flat above it.
  const bh = 0.3;
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const corner: V3 = [Math.sin(a) * hs * Math.SQRT2, yb, Math.cos(a) * hs * Math.SQRT2];
    const v = (ang: number): V3 => [Math.sin(ang) * ao * k8, yb, Math.cos(ang) * ao * k8];
    const apex: V3 = [Math.sin(a) * ao, yb + bh, Math.cos(a) * ao];
    const out: V3 = [Math.sin(a), 0.7, Math.cos(a)];
    m.tri(corner, v(a - Math.PI / 8), apex, out);
    m.tri(corner, apex, v(a + Math.PI / 8), out);
  }
  // The colonnettes at the angles.
  for (let k = 0; k < 8; k++) {
    const a = ((k + 0.5) * TAU) / 8;
    const r = ao * k8 - 0.01;
    lay.sb.box(0.09, drumH - 0.12, 0.09, Math.sin(a) * r, yb + (drumH - 0.12) / 2, Math.cos(a) * r, skin, { y: a }, HIDE_DOWN);
  }
  // The windows: grilled on the four bearings, blind between.
  const glass = lay.m(WINDOW_VOID);
  const shade = lay.m(MUDBRICK);
  const ww = 0.26;
  const wr = 0.15;
  const sill = yb + bh;
  const wsp = Math.max(0.2, drumH - 0.62);
  for (let k = 0; k < 8; k++) {
    const a = (k * TAU) / 8;
    const outline = pointed(0, sill, ww, wsp, wr);
    flatSlab(k % 2 ? shade : glass, a, outline, ao - 0.01, ao + 0.012);
    lay.sb.box(ww + 0.12, 0.05, 0.08, ...xz(onFlat(a, 0, sill - 0.025, ao + 0.03)), MUDBRICK_DARK, { y: a });
    if (k % 2 === 0) {
      lay.sb.box(0.025, wsp + wr * 0.8, 0.02, ...xz(onFlat(a, 0, sill + (wsp + wr * 0.8) / 2, ao + 0.022)), IRON, { y: a });
      lay.sb.box(ww, 0.025, 0.02, ...xz(onFlat(a, 0, sill + wsp * 0.55, ao + 0.024)), IRON, { y: a });
    }
  }
  // The corbelled ledge, and the merlons round the dome's foot on it.
  band(dark, 8, 0, ao, yh - 0.12, ao + 0.07, yh - 0.04);
  band(dark, 8, 0, ao + 0.07, yh - 0.04, ao + 0.07, yh);
  const R = ao - 0.12;
  disc(dark, 8, 0, ao + 0.07, R - 0.02, yh);
  const fl = 2 * ao * Math.tan(Math.PI / 8);
  for (let k = 0; k < 8; k++) {
    const a = (k * TAU) / 8;
    for (const t of [-1, 0, 1]) {
      const u = (t * fl) / 3;
      lay.sb.box(0.2, 0.22, 0.1, ...xz(onFlat(a, u, yh + 0.11, ao - 0.05)), skin, { y: a }, HIDE_DOWN);
      lay.sb.box(0.1, 0.08, 0.1, ...xz(onFlat(a, u, yh + 0.26, ao - 0.05)), skin, { y: a }, HIDE_DOWN);
    }
  }

  // The dome, pointed a little, in courses to the collider's head and a
  // little over it, where the alem stands.
  const prof = domeProfile(R, yh, domeH * 0.84, 0.12, 10);
  courses(m, 16, 0, prof, 0.04);
  alem(lay, prof[prof.length - 1][1] - 0.02);
}

/** A point's three numbers, for a box centred on it. */
const xz = (p: V3): [number, number, number] => [p[0], p[1], p[2]];

/** The alem: a brass rod through three balls, and a crescent, horns up. */
function alem(lay: Lay, y: number): void {
  const m = lay.m(ALLOY);
  log(m, [0, y, 0], [0, y + 0.86, 0], 0.025, 6);
  band(m, 8, 0, 0.09, y, 0.07, y + 0.06);
  for (const [cy, r] of [
    [0.2, 0.1],
    [0.43, 0.08],
    [0.62, 0.06],
  ] as const) {
    band(m, 8, 0, r * 0.45, y + cy - r, r, y + cy - r * 0.35);
    band(m, 8, 0, r, y + cy - r * 0.35, r, y + cy + r * 0.35);
    band(m, 8, 0, r, y + cy + r * 0.35, r * 0.45, y + cy + r);
  }
  // The crescent, in segments round an arc that thins to its horns.
  const cr = 0.13;
  const cy = y + 0.86 + cr * 0.55;
  const n = 7;
  for (let i = 0; i < n; i++) {
    const t0 = Math.PI + 0.35 + ((Math.PI - 0.7) * i) / n;
    const t1 = Math.PI + 0.35 + ((Math.PI - 0.7) * (i + 1)) / n;
    const mid = (i + 0.5) / n;
    const thick = 0.022 + 0.034 * Math.sin(mid * Math.PI);
    const x0 = Math.cos(t0) * cr;
    const y0 = Math.sin(t0) * cr;
    const x1 = Math.cos(t1) * cr;
    const y1 = Math.sin(t1) * cr;
    lay.sb.box(Math.hypot(x1 - x0, y1 - y0) + 0.01, thick, 0.025, (x0 + x1) / 2, cy + (y0 + y1) / 2, 0, ALLOY, { z: Math.atan2(y1 - y0, x1 - x0) });
  }
}

// --- the rags -------------------------------------------------------------------------

/**
 * Rags tied to the bars of the side windows' grilles, which is what a pilgrim
 * leaves at a saint's tomb: strips of cloth a hand to a forearm long, marked
 * for the wind like every drape in the set. Visual only, as a drape is.
 */
function rags(b: Build, q: Qubba): void {
  const { half, rnd } = q;
  const trans = CONFIG.graphics.translucency.awning;
  const { ww, wh, sill } = bayWindow(q);
  for (const sx of [-1, 1]) {
    // Spread across the window in slots so no two hang one over the other.
    const n = 3 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const bar = 1 + Math.floor(rnd() * 3);
      const yb = sill + (bar * wh) / 4;
      const len = Math.min(0.2 + rnd() * 0.22, yb - sill - 0.04);
      const u = -ww / 2 + ((i + 0.3 + rnd() * 0.4) / n) * ww;
      const rw = 0.03 + rnd() * 0.025;
      // The knot round the bar, and the tail hanging from it.
      marksSway(b.translucentBox(0.03, 0.05, rw + 0.02, sx * (half + 0.09), yb, u, CLOTH, trans), "cloth");
      marksSway(
        b.translucentBox(0.014, len, rw, sx * (half + 0.1 + rnd() * 0.01), yb - len / 2 - 0.01, u, CLOTH, trans, { x: (rnd() - 0.5) * 0.4, y: (rnd() - 0.5) * 0.8 }),
        "cloth",
      );
    }
  }
}
