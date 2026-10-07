/**
 * kit/harbour/lighthouse.ts — buildLighthouse: a Stevenson rock tower on a
 * battered plinth, its corbelled gallery and glazed lantern, and the keeper's
 * cottage at its foot — with `dressed` (one stone laid in a round or battered
 * face) and `sashWindow`, which nothing else uses. Part of the volcanic-coast
 * set: follows the contract in kit/core.ts and the set's rules in
 * `./index.ts`. Invariants: not climbable; fixed by its plan, so nothing is
 * seeded. Never imports another builder.
 */
import { Scene } from "@babylonjs/core";
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import {
  Build,
  type BuildParams,
  type Point3,
  type Side,
  type Structure,
  HIDE_UNDER,
  StoneBatch,
  carve,
  convexSolid,
  outward,
  runsAlongX,
  slab,
  BASALT,
  BASALT_PALE,
  FLAME,
  IRON,
  PITCH,
  RUST,
  SLATE,
} from "../core";
import {
  bar,
  splitRun,
} from "./shared";

/**
 * A LIGHTHOUSE: a coursed basalt tower on a rusticated plinth, a corbelled
 * gallery with a lattice rail, a helically glazed lantern under a ribbed dome,
 * and the keeper's cottage at its foot.
 *
 * **This is what stopped seven watchtowers standing in for the one thing a
 * coast actually builds.** A timber watchtower on a headland says somebody is
 * looking out; a light says this water is dangerous and people come here
 * anyway, which is the whole read of an island with a harbour cut into it. It
 * also answers something the map needed at night and had no piece for: a
 * 1,500 m square with a wadeable bay across the middle of it wants a thing you
 * can steer by from the water, and a lamp on a lamp post is invisible at three
 * hundred metres.
 *
 * **Not climbable**, for `buildMinaret`'s reason: one way up to a gallery at
 * eighteen metres, on a map whose fog wall is 1,250, is a position with no
 * counter. It is a landmark and a light, and it costs four collider boxes to
 * be both — plus the cottage's seven, which make it a room you can walk into.
 *
 * The lantern carries a `LocalLight`, which is a real spend out of sixteen —
 * so a map lights the ones standing where somebody has to walk and lets the
 * rest be lights you can see rather than lights that light you.
 *
 * ## What it is drawn as
 *
 * A Stevenson rock tower brought ashore: what a lighthouse board built on a
 * headland of the island's own rock in the 1850s.
 *
 * - **The PLINTH is square and battered**, four courses of rock-faced basalt
 *   between pale quoins, on a footing carried below the ground so a slope
 *   cannot show under it, under a pale coping. Square, because the collider
 *   it stands over is — the round splay it replaced stood 0.8 m outside that
 *   box at the foot and inside it at the corners.
 * - **The SHAFT is ashlar**, laid as it was built: a ring of dressed stones a
 *   course, every other course turned half a stone so the joints break, over a
 *   dark core set back far enough that every joint is a step the ink finds.
 *   Its profile is the slight concave of a tower built to shed a sea. Two pale
 *   string courses give it scale, and stair windows climb it in pale margins.
 * - **The GALLERY is carried on twenty stepped corbels**, a soffit and a deck
 *   with a drip, and railed with stanchions braced by a diagonal lattice.
 * - **The LANTERN stands on a panelled iron pedestal with its door onto the
 *   gallery**, glazed between helical astragals — the one detail that says
 *   "lighthouse" from anywhere — under a ribbed RUST dome, a ventilator ball, a
 *   rod and a vane. The glow is a twelve-sided drum of panes, still one colour.
 * - **The COTTAGE is harled pale with dark dressed margins**, as a keeper's
 *   cottage was: quoins, a base course, sash windows in margins with sills, a
 *   slate roof thick enough to read as a roof, its gables in WALL colour with
 *   skews, skewputts and an apex stone, a wall-head stack with its cans, iron
 *   rainwater goods, a doorstep, the door standing open against the inside of
 *   the front wall and a fireplace on the inside of the +X wall.
 *
 * The windows used to be drawn centred in the walls they lit, so nothing of
 * them showed; they are on the faces now. Everything that varies here is
 * fixed by the plan, so nothing is seeded, and the footings are carried below
 * the ground rather than conformed to it — every placement stands on a pad.
 */
export function buildLighthouse(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "lighthouse");
  const h = p.height ?? 26;
  const baseH = 2.6;
  /** Where the gallery's corbel course sits. The shaft is everything under. */
  const galleryY = h - 8.0;
  const shaft = galleryY - baseH;
  const lampY = galleryY + 2.5;

  // --- the colliders, byte for byte and in the order they always were -----
  // The tower is four boxes, a landmark and a light; the cottage is its walls
  // and `gableRoof`'s slab, restated so the drawing over them is free.
  b.block({ w: 9.8, h: baseH, d: 9.8, x: 0, y: baseH / 2, z: 0 });
  b.block({ w: 6.9, h: shaft, d: 6.9, x: 0, y: baseH + shaft / 2, z: 0 });
  b.block({ w: 8.6, h: 2.2, d: 8.6, x: 0, y: galleryY + 1.1, z: 0 });
  b.block({ w: 4.2, h: 3.0, d: 4.2, x: 0, y: lampY + 1.4, z: 0 });
  // The colour is a warm WHITE rather than the `FLAME` a fire gets — this is
  // the one thing on the island meant to be picked out from the far shore of
  // the bay, and a lamp that reads as a bonfire reads as somewhere to go
  // rather than a warning.
  b.light("#ffe2a8", 44, 2.0, 0.03, 0, lampY + 1.2, 0);

  const cw = 7.4;
  const cd = 5.4;
  const ch = 3.2;
  const cz = -(5.4 + cd / 2);
  const overhang = 0.4;
  b.doorWall(cw, ch, 0.35, 0, ch / 2, cz - cd / 2, BASALT_PALE, 1.5, 2.2);
  b.wall(cw, ch, 0.35, 0, ch / 2, cz + cd / 2, BASALT_PALE);
  for (const sx of [-1, 1] as const) b.wall(0.35, ch, cd, (sx * cw) / 2, ch / 2, cz, BASALT_PALE);
  b.block({ w: cw + overhang * 2, h: 0.3, d: cd + overhang * 2, x: 0, y: ch, z: cz });

  // Everything below is drawing.
  const sb = new StoneBatch();
  const lamp = new StoneBatch();

  // --- the plinth ---------------------------------------------------------
  /** Top of the footing, top of the battered courses, and their half-widths. */
  const P0 = 0.25;
  const P1 = 2.4;
  const foot = 5.15;
  const head = 4.92;
  const pLean = Math.atan((foot - head) / (P1 - P0));
  const pCourses = 4;
  const ph = (P1 - P0) / pCourses;
  const plinthAt = (y: number): number => foot - ((foot - head) * (y - P0)) / (P1 - P0);
  /** The +Z face's doorway, as a cut out of its courses. */
  const DOOR = 0.95;
  for (let k = 0; k < pCourses; k++) {
    const ym = P0 + (k + 0.5) * ph;
    const a = plinthAt(ym);
    for (let f = 0; f < 4; f++) {
      const yaw = (f * Math.PI) / 2;
      // A long and a short stone round every corner, swapping each course, so
      // the quoins interlock — both ends of one face are the same length.
      const q = (k + f) % 2 === 0 ? 0.95 : 0.55;
      for (const e of [-1, 1] as const) {
        dressed(sb, yaw, a + 0.02, e * (a - q / 2), ym, q - 0.03, ph - 0.04, 0.34, pLean, BASALT_PALE);
      }
      const cuts: [number, number][] = f === 0 ? [[-DOOR, DOOR]] : [];
      for (const [u0, u1] of carve(-a + q, a - q, cuts)) {
        for (const [s0, s1] of splitRun(u0, u1, 1.15, k % 2 === 1)) {
          dressed(sb, yaw, a, (s0 + s1) / 2, ym, s1 - s0 - 0.05, ph - 0.05, 0.3, pLean, BASALT);
        }
      }
    }
  }
  // The tower door, on the face away from the cottage: jamb stones coursed
  // with the plinth, a recessed boarded leaf on iron straps, a lintel and a
  // keystone.
  for (let k = 0; k < pCourses; k++) {
    const ym = P0 + (k + 0.5) * ph;
    for (const e of [-1, 1] as const) {
      dressed(sb, 0, plinthAt(ym) + 0.03, e * 0.785, ym, 0.3, ph - 0.04, 0.34, pLean, BASALT_PALE);
    }
  }
  const leafY = P0 + 0.925;
  for (let i = 0; i < 5; i++) {
    dressed(sb, 0, plinthAt(leafY) - 0.05, -0.496 + i * 0.248, leafY, 0.24, 1.85, 0.1, pLean, PITCH);
  }
  for (const y of [0.65, 1.75]) dressed(sb, 0, plinthAt(y) - 0.02, -0.15, y, 0.85, 0.07, 0.05, pLean, IRON);
  dressed(sb, 0, plinthAt(2.25) + 0.05, 0, 2.25, 2.2, 0.3, 0.4, pLean, BASALT_PALE);
  dressed(sb, 0, plinthAt(2.25) + 0.09, 0, 2.25, 0.36, 0.42, 0.4, pLean, BASALT_PALE);
  // A barred vent in each flank, lighting the store under the stair.
  for (const yaw of [Math.PI / 2, -Math.PI / 2]) {
    const ym = P0 + 2.5 * ph;
    const a = plinthAt(ym);
    dressed(sb, yaw, a + 0.04, 0, ym, 0.34, 0.72, 0.1, pLean, IRON);
    for (const e of [-1, 1] as const) dressed(sb, yaw, a + 0.07, e * 0.26, ym, 0.18, 0.96, 0.14, pLean, BASALT_PALE);
    dressed(sb, yaw, a + 0.1, 0, ym - 0.42, 0.74, 0.1, 0.18, pLean, BASALT_PALE);
    dressed(sb, yaw, a + 0.08, 0, ym + 0.44, 0.7, 0.16, 0.16, pLean, BASALT_PALE);
  }

  // --- the shaft ----------------------------------------------------------
  /** The shaft's radius at its foot and its head; the profile between is concave. */
  const R0 = 4.3;
  const R1 = 2.9;
  const tAt = (y: number): number => Math.min(1, Math.max(0, (y - baseH) / shaft));
  const radius = (y: number): number => R1 + (R0 - R1) * Math.pow(1 - tAt(y), 1.25);
  const lean = (y: number): number => Math.atan(((R0 - R1) * 1.25 * Math.pow(1 - tAt(y), 0.25)) / shaft);
  /** Stones a course. */
  const N = 20;
  const courses = Math.max(8, Math.round(shaft / 0.55));
  const hc = shaft / courses;
  const bands = new Set([Math.round(courses / 3), Math.round((2 * courses) / 3)]);
  for (let k = 0; k < courses; k++) {
    const ym = baseH + (k + 0.5) * hc;
    const band = bands.has(k);
    const a = radius(ym) + (band ? 0.12 : 0);
    const side = 2 * a * Math.tan(Math.PI / N);
    const off = ((k % 2) * Math.PI) / N;
    for (let j = 0; j < N; j++) {
      const yaw = off + (j * 2 * Math.PI) / N;
      if (band) dressed(sb, yaw, a, 0, ym, side - 0.03, hc - 0.03, 0.42, lean(ym), BASALT_PALE);
      else dressed(sb, yaw, a, 0, ym, side - 0.035, hc - 0.035, 0.28, lean(ym), BASALT);
    }
  }
  // Stair windows, a quarter-turn and four courses apart: the stair inside
  // climbs, so its lights climb round the tower with it.
  for (let i = 0, k = 3; k + 2 < courses - 2; i++, k += 4) {
    if (bands.has(k) || bands.has(k + 1)) continue;
    const yaw = ((i * 5 + 3) * 2 * Math.PI) / N + ((k % 2) * Math.PI) / N;
    const y0 = baseH + k * hc + 0.06;
    const y1 = baseH + (k + 2) * hc - 0.06;
    const ym = (y0 + y1) / 2;
    const a = radius(ym) + 0.05;
    const tilt = lean(ym);
    dressed(sb, yaw, a, 0, ym, 0.42, y1 - y0 - 0.22, 0.12, tilt, IRON);
    for (const e of [-1, 1] as const) dressed(sb, yaw, a + 0.03, e * 0.31, ym, 0.2, y1 - y0, 0.16, tilt, BASALT_PALE);
    dressed(sb, yaw, a + 0.06, 0, y0 + 0.06, 0.9, 0.12, 0.22, tilt, BASALT_PALE);
    dressed(sb, yaw, a + 0.04, 0, y1 - 0.1, 0.82, 0.2, 0.18, tilt, BASALT_PALE);
  }

  // --- the gallery --------------------------------------------------------
  // Twenty corbels, each four stones stepping out, under a soffit and a deck.
  for (let j = 0; j < N; j++) {
    const yaw = ((j + 0.5) * 2 * Math.PI) / N;
    for (let i = 0; i < 4; i++) {
      const a = R1 + 0.33 * (i + 1);
      dressed(sb, yaw, a, 0, galleryY - 1.12 + 0.28 * i + 0.14, 0.4, 0.26, a - R1 + 0.3, 0, BASALT_PALE);
    }
  }
  b.cyl(0.3, 8.7, 8.7, N, 0, galleryY + 0.15, 0, BASALT_PALE);
  b.cyl(0.3, 9.1, 9.1, N, 0, galleryY + 0.45, 0, BASALT_PALE);
  /** The deck the rail and the lantern stand on. */
  const D = galleryY + 0.6;
  const railR = 4.3;
  const rail = (j: number, y: number): Point3 => {
    const a = (j * 2 * Math.PI) / N;
    return [Math.sin(a) * railR, y, Math.cos(a) * railR];
  };
  for (let j = 0; j < N; j++) {
    const [x, , z] = rail(j, 0);
    sb.box(0.07, 1.05, 0.07, x, D + 0.525, z, IRON, { y: (j * 2 * Math.PI) / N });
    bar(sb, rail(j, D + 1.05), rail(j + 1, D + 1.05), 0.07, 0.06, IRON);
    bar(sb, rail(j, D + 0.1), rail(j + 1, D + 0.1), 0.06, 0.05, IRON);
    bar(sb, rail(j, D + 0.1), rail(j + 1, D + 1.05), 0.035, 0.035, IRON);
    bar(sb, rail(j, D + 1.05), rail(j + 1, D + 0.1), 0.035, 0.035, IRON);
  }

  // --- the lantern --------------------------------------------------------
  /** Sides of the lantern, and the apothem of its pedestal and of its glass. */
  const L = 12;
  const pedA = 1.884;
  const glassA = 1.8;
  const facet = (j: number): number => (j * 2 * Math.PI) / L;
  for (let j = 0; j < L; j++) {
    const yaw = facet(j);
    const side = 2 * pedA * Math.tan(Math.PI / L);
    dressed(sb, yaw, pedA, 0, D + 0.575, side, 1.15, 0.14, 0, IRON);
    // A panel on every face but the one that is the door onto the gallery.
    if (j === 0) {
      dressed(sb, yaw, pedA + 0.05, 0, D + 0.5, 0.62, 0.95, 0.1, 0, IRON);
      dressed(sb, yaw, pedA + 0.09, 0.2, D + 0.55, 0.05, 0.12, 0.06, 0, BASALT_PALE);
    } else {
      dressed(sb, yaw, pedA + 0.03, 0, D + 0.6, side * 0.66, 0.7, 0.06, 0, IRON);
    }
    dressed(sb, yaw, 2.0, 0, D + 1.21, 2 * 2.0 * Math.tan(Math.PI / L) + 0.01, 0.12, 0.3, 0, IRON);
  }
  const G0 = D + 1.27;
  const G1 = D + 3.65;
  const GH = G1 - G0;
  const corner = (j: number, y: number, r = 1.89): Point3 => {
    const a = facet(j) + Math.PI / L;
    return [Math.sin(a) * r, y, Math.cos(a) * r];
  };
  for (let j = 0; j < L; j++) {
    dressed(lamp, facet(j), glassA, 0, (G0 + G1) / 2, 2 * glassA * Math.tan(Math.PI / L) + 0.01, GH, 0.06, 0, "#ffe6b0");
    const [x, , z] = corner(j, 0, 1.87);
    sb.box(0.13, GH, 0.11, x, (G0 + G1) / 2, z, IRON, { y: facet(j) + Math.PI / L });
    // The helical astragals: each bar climbs half the glazing across one pane
    // and the next carries on from where it stopped, so the bars wind round
    // the drum and no pane has a vertical edge of its own.
    bar(sb, corner(j, G0, 1.91), corner(j + 1, G0 + GH / 2, 1.91), 0.1, 0.07, IRON);
    bar(sb, corner(j, G0 + GH / 2, 1.91), corner(j + 1, G1, 1.91), 0.1, 0.07, IRON);
    bar(sb, corner(j, G0 + 0.04), corner(j + 1, G0 + 0.04), 0.09, 0.08, IRON);
    bar(sb, corner(j, G1 - 0.04), corner(j + 1, G1 - 0.04), 0.09, 0.08, IRON);
    dressed(sb, facet(j), 2.14, 0, G1 + 0.11, 2 * 2.14 * Math.tan(Math.PI / L) + 0.01, 0.22, 0.42, 0, RUST);
  }
  // The dome: a ribbed cone and a neck, a ventilator ball, the rod and vane.
  const dome0 = G1 + 0.22;
  b.cyl(1.0, 1.3, 4.1, L, 0, dome0 + 0.5, 0, RUST);
  b.cyl(0.35, 0.55, 1.3, L, 0, dome0 + 1.175, 0, RUST);
  for (let j = 0; j < L; j++) bar(sb, corner(j, dome0 + 0.02, 2.11), corner(j, dome0 + 1.02, 0.72), 0.07, 0.07, RUST);
  const ball = dome0 + 1.35;
  b.cyl(0.14, 0.62, 0.42, 8, 0, ball + 0.07, 0, IRON);
  b.cyl(0.2, 0.62, 0.62, 8, 0, ball + 0.24, 0, IRON);
  b.cyl(0.14, 0.38, 0.62, 8, 0, ball + 0.41, 0, IRON);
  b.cyl(1.25, 0.04, 0.07, 6, 0, ball + 1.1, 0, IRON);
  const vane = ball + 1.35;
  for (const yaw of [0, Math.PI / 2]) sb.box(0.6, 0.03, 0.03, 0, vane - 0.22, 0, IRON, { y: yaw });
  sb.box(0.95, 0.035, 0.035, 0, vane, 0, IRON);
  sb.box(0.04, 0.22, 0.3, -0.45, vane, 0, IRON);
  sb.box(0.14, 0.14, 0.03, 0.47, vane, 0, IRON, { z: Math.PI / 4 });

  // --- the keeper's cottage -----------------------------------------------
  // What turns a light into somewhere somebody lives, on a headland otherwise
  // made of rock: harled pale, dressed in dark stone.
  /** Where its faces are: the front wall's outer plane, and the flanks'. */
  const front = -cz + cd / 2 + 0.175;
  const flank = cw / 2 + 0.175;
  /** The rear wall's centre line, against the tower. */
  const rear = -cz - cd / 2;
  for (const [u0, u1] of carve(-flank, flank, [[-0.75, 0.75]])) {
    sb.onFace("-z", front, (u0 + u1) / 2, 0.075, u1 - u0, 0.75, 0.08, 0.02, BASALT);
  }
  for (const s of ["-x", "+x"] as const) {
    sb.onFace(s, flank, (-front - rear) / 2, 0.075, front - rear, 0.75, 0.08, 0.02, BASALT);
  }
  // Quoins round the two front corners, long on the front and short on the
  // flank course by course, which also closes the notch the walls leave there.
  const qh = (ch - 0.45) / 8;
  for (const sx of [-1, 1] as const) {
    for (let q = 0; q < 8; q++) {
      const y = 0.45 + (q + 0.5) * qh;
      if (q % 2 === 0) sb.box(0.62, qh - 0.03, 0.295, sx * (flank + 0.04 - 0.31), y, -front + 0.1075, BASALT);
      else sb.box(0.295, qh - 0.03, 0.62, sx * (flank + 0.04 - 0.1475), y, -front - 0.04 + 0.31, BASALT);
    }
  }
  // The door: margins, a doorstep, and the leaf standing open against the
  // inside of the front wall.
  for (const e of [-1, 1] as const) sb.onFace("-z", front, e * 0.85, 1.2, 0.2, 2.4, 0.06, 0.01, BASALT);
  sb.onFace("-z", front, 0, 2.3, 1.9, 0.2, 0.06, 0.01, BASALT);
  b.box(1.8, 0.12, 0.45, 0, 0.06, -front - 0.225, BASALT_PALE);
  const inner = front - 0.35;
  for (let i = 0; i < 4; i++) b.box(0.345, 2.15, 0.045, -0.75 - 0.175 - i * 0.35, 1.075, -inner + 0.0255, PITCH);
  for (const y of [0.35, 1.07, 1.8]) b.box(1.36, 0.12, 0.03, -1.45, y, -inner + 0.063, PITCH);
  // Sash windows: two in the front, one in each flank.
  sashWindow(b, sb, "-z", front, -2.225);
  sashWindow(b, sb, "-z", front, 2.225);
  sashWindow(b, sb, "-x", flank, cz - 0.8);
  sashWindow(b, sb, "+x", flank, cz - 0.8);
  // The fireplace on the inside of the +X wall, and its stack on the wall head
  // over it, rising through the eaves with two cans on the cope.
  const fz = -6.7;
  const room = -(cw / 2 - 0.175);
  sb.onFace("-x", room, fz, 0.4, 0.8, 0.75, 0.02, 0.01, IRON);
  for (const e of [-1, 1] as const) sb.onFace("-x", room, fz + e * 0.525, 0.525, 0.25, 1.05, 0.1, 0.05, BASALT);
  sb.onFace("-x", room, fz, 0.9, 1.3, 0.2, 0.1, 0.05, BASALT);
  sb.onFace("-x", room, fz, 1.11, 1.45, 0.08, 0.22, 0.11, BASALT);
  b.box(0.6, 0.04, 1.5, cw / 2 - 0.175 - 0.3, 0.02, fz, BASALT);
  b.box(0.8, 2.3, 1.0, cw / 2, ch + 1.05, fz, BASALT_PALE);
  b.box(0.95, 0.1, 1.15, cw / 2, ch + 2.25, fz, BASALT);
  for (const e of [-1, 1] as const) b.cyl(0.42, 0.2, 0.25, 8, cw / 2, ch + 2.51, fz + e * 0.26, RUST);

  // The roof: gables in WALL colour, then slate laid in lapped courses over
  // them, a ridge, skews up the front gable, and the eaves closed and guttered.
  const run = cw / 2 + overhang;
  const rise = 1.3;
  const pitch = Math.atan2(rise, run);
  const roofAt = (x: number): number => ch + (rise * (run - Math.abs(x))) / run;
  for (const [z0, z1] of [
    [-front, -front + 0.35],
    [-rear - 0.175, -rear + 0.175],
  ]) {
    const gable = (z: number): Point3[] => [
      [-flank, ch, z],
      [flank, ch, z],
      [flank, roofAt(flank), z],
      [0, ch + rise, z],
      [-flank, roofAt(flank), z],
    ];
    convexSolid(b, gable(z0), gable(z1), BASALT_PALE);
  }
  const slope = Math.hypot(run, rise);
  const slates = 8;
  const roofLen = front - (rear - 0.175) + 0.24;
  const nx = Math.sin(pitch);
  const ny = Math.cos(pitch);
  for (const s of [-1, 1] as const) {
    for (let i = 0; i < slates; i++) {
      const f = (i + 0.5) / slates;
      const x = s * run * (1 - f) + s * nx * 0.055;
      const y = ch + rise * f + ny * 0.055;
      sb.box(slope / slates + 0.1, 0.1, roofLen, x, y, cz, SLATE, { z: -s * (pitch - 0.06) });
    }
    // The eaves: a soffit back to the wall, a fascia and an iron gutter, and
    // a downpipe at the front corner run down the flank to the ground.
    b.box(0.25, 0.03, roofLen, s * (flank + 0.12), ch + 0.035, cz, BASALT);
    b.box(0.13, 0.11, roofLen, s * (run + 0.07), ch - 0.03, cz, IRON);
    b.box(0.3, 0.06, 0.08, s * (flank + 0.17), ch - 0.08, -front + 0.75, IRON);
    b.box(0.08, ch - 0.1, 0.08, s * (flank + 0.06), (ch - 0.1) / 2, -front + 0.75, IRON);
    // The skew up the front gable, on a skewputt at the eaves.
    const lo: Point3 = [s * (flank + 0.05), roofAt(flank + 0.05) + 0.2, -front + 0.175];
    const hi: Point3 = [0, ch + rise + 0.2, -front + 0.175];
    slab(b, lo, hi, 0.45, 0.16, BASALT);
    b.box(0.5, 0.45, 0.5, s * (flank - 0.05), ch + 0.2, -front + 0.175, BASALT);
  }
  b.box(0.3, 0.35, 0.45, 0, ch + rise + 0.32, -front + 0.175, BASALT);
  const ridge = (z: number): Point3[] => [
    [-0.25, ch + rise - 0.02, z],
    [0.25, ch + rise - 0.02, z],
    [0, ch + rise + 0.2, z],
  ];
  convexSolid(b, ridge(-front - 0.12), ridge(-rear + 0.175 + 0.12), BASALT);

  // The stones before what they hide, then the cores they hide.
  sb.flush(b);
  lamp.flushGlow(b);
  for (let k = 0; k < courses; k += 2) {
    const y0 = baseH + k * hc;
    const y1 = baseH + Math.min(courses, k + 2) * hc;
    b.cyl(y1 - y0, 2 * (radius(y1) - 0.07), 2 * (radius(y0) - 0.07), N, 0, (y0 + y1) / 2, 0, IRON);
  }
  const core = (y: number): Point3[] => {
    const a = plinthAt(y) - 0.08;
    return [
      [-a, y, -a],
      [a, y, -a],
      [a, y, a],
      [-a, y, a],
    ];
  };
  convexSolid(b, core(P0), core(P1), IRON);
  b.box(10.7, 0.85, 10.7, 0, P0 - 0.425, 0, BASALT);
  b.box(10.0, 0.08, 10.0, 0, P1 + 0.04, 0, BASALT_PALE);
  b.box(10.2, 0.12, 10.2, 0, P1 + 0.14, 0, BASALT_PALE);
  return b;
}

/** The face of a `dressed` stone that is turned to the core: its local -Z. */
const TO_CORE = 1 << 5;

/**
 * A dressed stone in a round or battered face: its outer face centred `a` out
 * from the axis along bearing `yaw`, `u` along the face, at height `y`, and
 * leaning back by `lean` as the face it is laid in does. Local Z is the stone's
 * depth into the wall, so the underside and the back are left out — one is
 * bedded on the course below and the other on the core.
 */
function dressed(
  sb: StoneBatch,
  yaw: number,
  a: number,
  u: number,
  y: number,
  len: number,
  tall: number,
  deep: number,
  lean: number,
  color: string,
): void {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  const r = a - (deep / 2) * Math.cos(lean);
  sb.box(len, tall, deep, s * r + c * u, y - (deep / 2) * Math.sin(lean), c * r - s * u, color, { y: yaw, x: -lean }, HIDE_UNDER | TO_CORE);
}

/**
 * A keeper's sash window laid on a face: the lit pane, its bars, dark dressed
 * margins and a projecting sill. `plane` is the face's distance from the
 * origin along its axis and `u` the window's centre along the face.
 */
function sashWindow(b: Build, sb: StoneBatch, s: Side, plane: number, u: number): void {
  const sill = 1.0;
  const tall = 1.15;
  const wide = 0.85;
  const c = outward(s) * (plane + 0.01);
  if (runsAlongX(s)) b.glow(wide, tall, 0.02, u, sill + tall / 2, c, FLAME);
  else b.glow(0.02, tall, wide, c, sill + tall / 2, u, FLAME);
  sb.onFace(s, plane, u, sill + tall / 2, 0.045, tall, 0.03, 0.025, IRON);
  for (const f of [1 / 3, 2 / 3]) sb.onFace(s, plane, u, sill + tall * f, wide, 0.04, 0.03, 0.025, IRON);
  for (const e of [-1, 1] as const) sb.onFace(s, plane, u + e * (wide / 2 + 0.08), sill + tall / 2 + 0.08, 0.16, tall + 0.16, 0.05, 0.015, BASALT);
  sb.onFace(s, plane, u, sill + tall + 0.08, wide + 0.32, 0.16, 0.05, 0.015, BASALT);
  sb.onFace(s, plane, u, sill - 0.045, wide + 0.25, 0.09, 0.16, 0.06, BASALT);
}
