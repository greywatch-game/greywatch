/**
 * kit/harbour/netLoft.ts — buildNetLoft: a tarred sea loft over an open
 * undercroft on laid basalt piers, its loading door and hoist in the -Z gable
 * and the nets hung to dry underneath. Part of the volcanic-coast set: follows
 * the contract in kit/core.ts and the set's rules in `./index.ts`.
 * Invariants: the loft is not reachable; the colliders are restated byte for
 * byte in the order they always were; what varies is seeded off where it
 * stands (`streetSeed`), never `Math.random()`. Never imports another builder.
 */
import { Scene } from "@babylonjs/core";
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import {
  Build,
  type BuildCtx,
  type BuildParams,
  type Point3,
  type Side,
  type Structure,
  HIDE_UNDER,
  StoneBatch,
  convexSolid,
  hideBack,
  outward,
  runsAlongX,
  streetSeed,
  BASALT,
  BASALT_PALE,
  FLAME,
  IRON,
  PITCH,
  PLANK,
  RUST,
  SAILCLOTH,
  SLATE,
  TEAK,
  TIMBER,
} from "../core";
import { mulberry32 } from "../../rng";
import {
  TRANSLUCENCY,
  bar,
  type Cut,
  lapCourse,
  boardedWindow,
  NET_PAINTS,
} from "./shared";

/**
 * A NET LOFT: a sea loft of tarred weatherboard over an open undercroft on
 * coursed basalt piers, a loading door in the -Z gable under a hooded hoist
 * beam, and the nets hung to dry underneath.
 *
 * **The Netlofts quarter was built out of cottages** — a quarter named after a
 * building the map did not have. This is that building: gear is kept dry
 * upstairs and the boat's tackle is worked in the open underneath, which is
 * why the ground floor is six piers and no wall.
 *
 * That undercroft is why it is worth having on a shooter's map. It is a mass
 * you can see a body's legs through at forty metres and cannot shoot through
 * at chest height, standing in a row of houses that are solid to the ground —
 * so a street of them has sightlines a street of cottages does not, and the
 * piers are cover you fight AROUND rather than behind.
 *
 * **The loft is not reachable, and that is a decision rather than an
 * omission.** A flight to a 2.9 m floor is an 8.5 m run at the smelter's `GRADE` — a stair
 * longer than the building, projecting into streets cut to five metres — and
 * what it would buy is one more upstairs room on a map that already has three
 * floors of shophouse on the Strand.
 *
 * ## What it is drawn as
 *
 * The black net shops of a shingle beach, built on a rock instead of a beach:
 *
 * - **The piers are laid, not poured** — five courses of basalt round a core
 *   set back for the joints, a long and a short stone round every corner
 *   swapping course by course, a pale dressed cap under the girder and a
 *   footing carried down to the ground, which on the ramp the quarter stands
 *   on is a different depth under each.
 * - **The floor is carpentry you can see from under it**: a girder across
 *   each pair of piers, joists along the bays between them, the boards over
 *   those, and a rim beam round the edge the boarding stands on. All of it is
 *   inside the deck's collider, so nothing hangs below where a round stops.
 * - **The walls are lapped boards tipped at their feet**, every course a
 *   shading band and a line for the ink, cut round each opening, with corner
 *   boards over the ends and a frieze closing the eaves.
 * - **The gables are boarded in the WALL's colour** and the roof is slate in
 *   lapped courses over sarking, laid in runs that do not quite agree, with
 *   rafter feet, a fascia, an iron gutter and a downpipe off each back corner
 *   that finds its way round the jetty to a pier and down it.
 * - **The loading door stands open**, both leaves flat back against the
 *   gable with their ledges and braces out; the hoist beam over it carries a
 *   board hood, a knee brace, a block and the fall with its hook clear of
 *   every head, and the hauling part runs back in through the door.
 * - **The windows are painted frames in the black**, each with a sill and a
 *   drip: a lit one has its shutters open flat beside it, a dark one has them
 *   shut or shows its glass. The back wall and its gable get a light and a
 *   louvred vent, because the back of a building you can walk round is seen.
 * - **The nets hang in folds** from poles hooked to the joists, corks along
 *   the head rope and the leads along the foot, and what was put down under
 *   them — a coil, a heap of net, a fish box, an anchor, oars against a pier
 *   — is all low enough to walk over.
 *
 * **What varies is seeded off where it stands** (`streetSeed`): the paint on
 * the doors and shutters, which dark windows are shuttered, the slate runs,
 * the jitter in the pier stones and what lies in the undercroft — and the
 * footings are cut to the ground, which is what puts `netLoft` in
 * `CONFORMS_TO_TERRAIN`. Without a `BuildCtx` it is drawn on level ground.
 *
 * The colliders are restated by hand at the top, byte for byte and in the
 * order they always were: six piers, the deck, `doorWall`'s jambs and lintel,
 * the back wall, the flanks, `gableRoof`'s slab and the hoist beam's strut.
 * Everything after them is drawing, and every drawn part is laid on a face,
 * low enough to walk over, overhead, or standing on a collider.
 */
export function buildNetLoft(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "netloft");
  const w = p.width ?? 9;
  const d = p.depth ?? 7;
  /** Clear headroom under the loft floor. */
  const clear = 2.5;
  const loftH = p.height ?? 3.1;
  const deck = 0.4;
  const floorY = clear + deck;
  const t = 0.28;
  const overhang = 0.45;
  const rise = 1.5;
  /** The wall head, and the hoist beam half a metre over it. */
  const top = floorY + loftH;
  const beamY = floorY + loftH + 0.5;

  // --- the colliders, byte for byte and in the order they always were -----
  // Six piers — the corners and the middle of each long side. Nothing else at
  // ground level, which is the whole point of the building.
  for (const sx of [-1, 1] as const) {
    for (const dz of [-1, 0, 1]) {
      b.block({ w: 0.85, h: clear, d: 0.85, x: sx * (w / 2 - 0.6), y: clear / 2, z: dz * (d / 2 - 0.6) });
    }
  }
  b.block({ w, h: deck, d, x: 0, y: clear + deck / 2, z: 0 });
  // `doorWall`'s two jambs and its lintel, the back wall, the flanks, and
  // `gableRoof`'s flat slab at the eaves.
  const midY = floorY + loftH / 2;
  const frontZ = -(d - t) / 2;
  const jamb = (w - 1.7) / 2;
  const off = 1.7 / 2 + jamb / 2;
  const lintel = loftH - 2.2;
  b.block({ w: jamb, h: loftH, d: t, x: 0 - off, y: midY, z: frontZ });
  b.block({ w: jamb, h: loftH, d: t, x: 0 + off, y: midY, z: frontZ });
  b.block({ w: 1.7, h: lintel, d: t, x: 0, y: midY + loftH / 2 - lintel / 2, z: frontZ });
  b.block({ w, h: loftH, d: t, x: 0, y: midY, z: (d - t) / 2 });
  for (const sx of [-1, 1] as const) {
    b.block({ w: t, h: loftH, d: d - t * 2, x: (sx * (w - t)) / 2, y: midY, z: 0 });
  }
  b.block({ w: w + overhang * 2, h: 0.3, d: d + overhang * 2, x: 0, y: top, z: 0 });
  // The hoist beam out of the gable: timber a round stops on, six metres over
  // the street, and nothing a body meets.
  b.strut(0.28, 0.28, 2.6, 0, beamY, -(d / 2 + 1.1), TIMBER);

  // Everything below is drawing.
  const rnd = mulberry32(streetSeed(w, d, loftH, ctx));
  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };
  const sb = new StoneBatch();
  /** The doors' and shutters' paint, and the frames', which are always pale. */
  const paint = NET_PAINTS[Math.floor(rnd() * NET_PAINTS.length)];
  const FRAME = SAILCLOTH;
  const pierX = w / 2 - 0.6;
  const pierZ = d / 2 - 0.6;

  // --- the piers ----------------------------------------------------------
  const PH = 0.425;
  const pierCourses = 5;
  const pc = clear / pierCourses;
  const SIDES: Side[] = ["-z", "+z", "-x", "+x"];
  /** One stone of a pier at (px, pz): its outer face `a` out on side `s`, `u` along it. */
  const pierStone = (px: number, pz: number, s: Side, u: number, y: number, len: number, tall: number, a: number, color: string, hide: number): void => {
    const r = outward(s) * (a - 0.12);
    if (runsAlongX(s)) sb.box(len, tall, 0.24, px + u, y, pz + r, color, undefined, hide);
    else sb.box(0.24, tall, len, px + r, y, pz + u, color, undefined, hide);
  };
  for (const sx of [-1, 1] as const) {
    for (const dz of [-1, 0, 1]) {
      const px = sx * pierX;
      const pz = dz * pierZ;
      for (let k = 0; k < pierCourses; k++) {
        const cap = k === pierCourses - 1;
        const y = (k + 0.5) * pc;
        for (const s of SIDES) {
          // The long stone of a course runs out to the corner and shows its
          // end on the next face; the next course swaps which face that is.
          const long = (k + (runsAlongX(s) ? 0 : 1)) % 2 === 0;
          const a = PH + (cap ? 0.04 : 0.014 + rnd() * 0.014);
          const end = long ? a : a - 0.265;
          const at = [-end];
          if (!cap && !long && rnd() < 0.6) at.push(-end + 0.2 + rnd() * (2 * end - 0.4));
          else if (!cap && long && rnd() < 0.35) at.push(-end + 0.3 + rnd() * (2 * end - 0.6));
          at.push(end);
          for (let i = 1; i < at.length; i++) {
            pierStone(px, pz, s, (at[i - 1] + at[i]) / 2, y, at[i] - at[i - 1] - 0.025, pc - 0.025, a, cap ? BASALT_PALE : BASALT, cap ? hideBack(s) : hideBack(s) | HIDE_UNDER);
          }
        }
      }
      // The footing, carried down to the lowest ground under it.
      const g = Math.min(ground(px - 0.55, pz - 0.55), ground(px + 0.55, pz - 0.55), ground(px - 0.55, pz + 0.55), ground(px + 0.55, pz + 0.55));
      const fBot = Math.min(g, 0) - 0.15;
      sb.box(1.1, 0.14 - fBot, 1.1, px, (0.14 + fBot) / 2, pz, BASALT, undefined, HIDE_UNDER);
    }
  }

  // --- the floor, seen from under it --------------------------------------
  // All of it inside the deck's collider (2.5 to 2.9 m): the rim the walls
  // stand on, a girder across each pair of piers, and joists along the bays.
  for (const sz of [-1, 1] as const) sb.box(w + 0.04, deck, 0.1, 0, clear + deck / 2, sz * (d / 2 - 0.03), TIMBER);
  for (const sx of [-1, 1] as const) sb.box(0.1, deck, d - 0.12, sx * (w / 2 - 0.03), clear + deck / 2, 0, TIMBER);
  for (const dz of [-1, 0, 1]) sb.box(w - 0.16, 0.34, 0.3, 0, clear + 0.17, dz * pierZ, TIMBER, undefined, 1 << 2);
  const joists = Math.max(4, Math.round((w - 0.3) / 0.55));
  for (let i = 0; i < joists; i++) {
    const x = -(w - 0.3) / 2 + ((i + 0.5) * (w - 0.3)) / joists;
    sb.box(0.1, 0.2, d - 0.16, x, clear + 0.24, 0, TIMBER, undefined, 1 << 2);
  }

  // --- the boarding -------------------------------------------------------
  const courses = Math.max(8, Math.round(loftH / 0.24));
  const cH = loftH / courses;

  // --- the windows --------------------------------------------------------
  const winY = floorY + loftH * 0.55;
  /** A painted frame on a face, its sill and drip, and what is in it. Returns the boarding's cut. */
  const windowAt = (s: Side, plane: number, u: number, gw: number, gh: number, lit: boolean): Cut =>
    boardedWindow(b, sb, rnd, s, plane, u, winY, gw, gh, lit, paint);
  const lit = p.litWindows === true;
  const flankCuts = new Map<Side, Cut[]>();
  for (const s of ["-x", "+x"] as const) {
    flankCuts.set(s, [-0.22, 0.22].map((f) => windowAt(s, w / 2, f * d, 0.66, 0.85, lit)));
  }
  const backCut = windowAt("+z", d / 2, 0, 0.5, 0.6, lit);

  // --- the loading door ---------------------------------------------------
  const DOOR = 0.85;
  for (const e of [-1, 1] as const) sb.onFace("-z", d / 2, e * (DOOR + 0.05), floorY + 1.15, 0.1, 2.3, 0.06, 0.05, FRAME);
  sb.onFace("-z", d / 2, 0, floorY + 2.25, 2 * DOOR + 0.2, 0.1, 0.06, 0.05, FRAME);
  sb.box(2 * DOOR + 0.2, 0.08, 0.22, 0, floorY, -(d / 2 + 0.07), TIMBER);
  // Both leaves stand open, flat back against the gable, ledges outward.
  for (const e of [-1, 1] as const) {
    const lu = e * (DOOR + 0.12 + DOOR / 2);
    for (let i = 0; i < 5; i++) sb.onFace("-z", d / 2, lu - (2 * DOOR) / 5 + (i * DOOR) / 5, floorY + 1.1, DOOR / 5 - 0.012, 2.15, 0.03, 0.06, paint);
    for (const y of [0.3, 1.1, 1.9]) sb.onFace("-z", d / 2, lu, floorY + y, DOOR - 0.06, 0.11, 0.03, 0.09, paint);
    for (const y0 of [0.3, 1.1]) {
      const rise0 = 0.8 - 0.11;
      const run0 = DOOR - 0.22;
      sb.onFace("-z", d / 2, lu, floorY + y0 + 0.4, Math.hypot(rise0, run0), 0.1, 0.03, 0.09, paint, e * Math.atan2(rise0, run0));
    }
    for (const y of [0.3, 1.9]) sb.onFace("-z", d / 2, e * (DOOR + 0.12 + 0.28), floorY + y, 0.56, 0.05, 0.015, 0.11, IRON);
  }
  // What the hauling part is made fast to, and the lamp the loft is worked by.
  if (lit) {
    b.glow(0.14, 0.22, 0.14, 0.55, floorY + 1.85, -d / 2 + 0.9, FLAME);
    sb.box(0.2, 0.05, 0.2, 0.55, floorY + 1.985, -d / 2 + 0.9, IRON);
    sb.box(0.02, top - floorY - 2.0, 0.02, 0.55, (top + floorY + 2.0) / 2, -d / 2 + 0.9, IRON);
  }

  // --- the walls' boarding, now every cut is known ------------------------
  const doorCut: Cut = [-(DOOR + 0.12), DOOR + 0.12, floorY - 1, floorY + 2.32];
  const ventY = top + rise * 0.42;
  const run = w / 2 + overhang;
  const pitch = Math.atan2(rise, run);
  const roofAt = (x: number): number => top + (rise * (run - Math.abs(x))) / run;
  const faces: [Side, number, number, Cut[]][] = [
    ["-z", d / 2, w / 2, [doorCut]],
    ["+z", d / 2, w / 2, [backCut]],
    ["-x", w / 2, d / 2, flankCuts.get("-x") ?? []],
    ["+x", w / 2, d / 2, flankCuts.get("+x") ?? []],
  ];
  for (const [s, plane, half, cuts] of faces) {
    for (let k = 0; k < courses; k++) lapCourse(sb, s, plane, -half, half, floorY + k * cH, floorY + (k + 1) * cH, cuts);
    for (const e of [-1, 1] as const) sb.onFace(s, plane, e * (half - 0.07), midY - 0.015, 0.14, loftH + 0.03, 0.04, 0.055, PITCH);
  }
  // The gables, boarded on up to the roof, round the beam and the vent.
  const gableCuts: Record<"-z" | "+z", Cut[]> = {
    "-z": [[-0.2, 0.2, beamY - 0.18, beamY + 0.18]],
    "+z": [[-0.36, 0.36, ventY - 0.29, ventY + 0.29]],
  };
  for (const s of ["-z", "+z"] as const) {
    for (let j = 0; ; j++) {
      const yb = top + j * cH;
      const yt = yb + cH;
      const half = Math.min(w / 2, run - (((yb + yt) / 2 - top) * run) / rise);
      if (half < 0.12) break;
      lapCourse(sb, s, d / 2, -half, half, yb, yt, gableCuts[s]);
    }
  }
  // The vent: a pale frame and three louvres.
  for (const e of [-1, 1] as const) sb.onFace("+z", d / 2, e * 0.31, ventY, 0.07, 0.5, 0.05, 0.045, FRAME);
  for (const e of [-1, 1] as const) sb.onFace("+z", d / 2, 0, ventY + e * 0.25, 0.69, 0.07, 0.05, 0.045, FRAME);
  for (const f of [-0.13, 0, 0.13]) sb.box(0.56, 0.12, 0.02, 0, ventY + f, d / 2 + 0.035, PITCH, { x: -0.55 });
  // The frieze closing the eaves over each flank.
  for (const s of ["-x", "+x"] as const) sb.onFace(s, w / 2, 0, top + 0.035, d + 0.1, 0.15, 0.03, 0.03, PITCH);
  // Tie beams and king posts, seen through the door.
  for (const sz of [-1, 1] as const) {
    sb.box(w - 2 * t, 0.16, 0.16, 0, top + 0.08, (sz * d) / 4, TIMBER);
    sb.box(0.12, rise - 0.35, 0.12, 0, top + 0.16 + (rise - 0.35) / 2, (sz * d) / 4, TIMBER);
  }

  // --- the roof -----------------------------------------------------------
  const roofLen = d + overhang * 2;
  const slope = Math.hypot(run, rise);
  const nx = Math.sin(pitch);
  const ny = Math.cos(pitch);
  const slates = 9;
  for (const s of [-1, 1] as const) {
    for (let i = 0; i < slates; i++) {
      const f = (i + 0.5) / slates;
      // Each course laid in runs that do not quite agree with each other.
      const at = [-roofLen / 2];
      while (at[at.length - 1] < roofLen / 2 - 1.2) at.push(at[at.length - 1] + 1.2 + rnd() * 1.8);
      at[at.length - 1] = roofLen / 2;
      for (let r = 1; r < at.length; r++) {
        const lift = 0.055 + (rnd() - 0.5) * 0.018;
        const x = s * run * (1 - f) + s * nx * lift;
        const y = top + rise * f + ny * lift;
        sb.box(slope / slates + 0.1, 0.1, at[r] - at[r - 1] - 0.01, x, y, (at[r] + at[r - 1]) / 2, SLATE, { z: -s * (pitch - 0.06) });
      }
    }
    // Rafter feet under the eaves, a fascia on their ends and the gutter.
    const rafters = Math.round(d / 0.6) + 1;
    const xm = (w / 2 + run) / 2;
    for (let j = 0; j < rafters; j++) {
      const z = -d / 2 + 0.1 + (j * (d - 0.2)) / (rafters - 1);
      sb.box((run - w / 2) / Math.cos(pitch) + 0.05, 0.1, 0.06, s * xm, roofAt(xm) - 0.03 - 0.05 / ny, z, TIMBER, { z: -s * pitch });
    }
    sb.box(0.04, 0.18, roofLen, s * (run + 0.02), top - 0.04, 0, TIMBER);
    sb.box(0.13, 0.1, roofLen - 0.1, s * (run + 0.11), top - 0.1, 0, IRON);
    // The downpipe off the back corner, down the boarding, round under the
    // jetty onto the back pier and down that to a shoe.
    const zp = d / 2 - 0.1;
    const zq = d / 2 - 0.4;
    const xw = s * (w / 2 + 0.1);
    const xq = s * (w / 2 - 0.175 + 0.075);
    const gq = ground(xq, zq);
    bar(sb, [s * (run + 0.11), top - 0.12, zp], [xw, top - 0.45, zp], 0.08, 0.08, IRON);
    sb.box(0.08, top - 0.45 - (clear + 0.05), 0.08, xw, (top - 0.45 + clear + 0.05) / 2, zp, IRON);
    bar(sb, [xw, clear + 0.05, zp], [xq, clear - 0.3, zq], 0.08, 0.08, IRON);
    sb.box(0.08, clear - 0.3 - (gq + 0.12), 0.08, xq, (clear - 0.3 + gq + 0.12) / 2, zq, IRON);
    sb.box(0.2, 0.07, 0.09, xq + s * 0.07, gq + 0.12, zq, IRON);
  }
  // Bargeboards up each verge, a finial at each apex, and the purlins' ends
  // carrying the verge out past the gable.
  for (const sz of [-1, 1] as const) {
    const z = sz * (d / 2 + overhang - 0.03);
    for (const s of [-1, 1] as const) bar(sb, [s * (run + 0.03), top - 0.01, z], [0, top + rise, z], 0.05, 0.24, TIMBER);
    sb.box(0.1, 0.55, 0.1, 0, top + rise + 0.2, z, TIMBER);
    for (const x of [-run * 0.5, 0, run * 0.5]) {
      sb.box(0.12, 0.18, overhang, x, roofAt(x) - 0.12, sz * (d / 2 + overhang / 2 - 0.03), TIMBER);
    }
  }

  // --- the hoist ----------------------------------------------------------
  const zs = -(d / 2 + 2.1);
  const sy = beamY - 0.5;
  sb.box(0.32, 0.32, 0.05, 0, beamY, -(d / 2 + 2.25), IRON);
  sb.box(0.06, 0.22, 0.06, 0, beamY - 0.24, zs, IRON);
  for (const e of [-1, 1] as const) sb.box(0.04, 0.54, 0.46, e * 0.08, sy, zs, TIMBER);
  b.cyl(0.1, 0.4, 0.4, 10, 0, sy, zs, RUST, { z: Math.PI / 2 });
  sb.box(0.22, 0.06, 0.06, 0, sy, zs, IRON);
  // The load fall to a hook block hung clear of every head, and the hauling
  // part back in through the door.
  const hookY = 2.69;
  sb.box(0.05, sy - (hookY + 0.13), 0.05, 0, (sy + hookY + 0.13) / 2, zs - 0.2, PLANK);
  sb.box(0.16, 0.26, 0.14, 0, hookY, zs - 0.2, TIMBER);
  sb.box(0.04, 0.14, 0.04, 0, hookY - 0.2, zs - 0.2, IRON);
  sb.box(0.04, 0.04, 0.16, 0, hookY - 0.25, zs - 0.14, IRON);
  sb.box(0.04, 0.09, 0.04, 0, hookY - 0.21, zs - 0.08, IRON);
  bar(sb, [0.08, sy + 0.2, zs + 0.15], [0.08, floorY + 1.9, -d / 2 + 0.25], 0.05, 0.05, PLANK);
  // The knee brace under the beam, and the board hood over it.
  bar(sb, [0, Math.max(top - 0.45, floorY + 2.45), -(d / 2 + 0.05)], [0, beamY - 0.14, -(d / 2 + 1.0)], 0.16, 0.16, TIMBER);
  const hood = 2.55;
  const hp = Math.atan2(0.28, 0.45);
  for (const s of [-1, 1] as const) {
    sb.box(Math.hypot(0.45, 0.28) + 0.04, 0.04, hood, s * 0.225 + s * Math.sin(hp) * 0.02, beamY + 0.3 + Math.cos(hp) * 0.02, -(d / 2 + hood / 2), PITCH, { z: -s * hp });
  }
  for (const z of [-(d / 2 + 1.2), -(d / 2 + hood - 0.1)]) sb.box(0.9, 0.05, 0.07, 0, beamY + 0.165, z, TIMBER);
  const hoodEnd = (z: number): Point3[] => [
    [-0.44, beamY + 0.15, z],
    [0.44, beamY + 0.15, z],
    [0, beamY + 0.43, z],
  ];

  // --- the nets -----------------------------------------------------------
  // Hung in folds from a pole hooked to the joists — the one place the key
  // light comes through a building on this map — corks along the head rope
  // and the leads along the foot.
  for (const sz of [-1, 1] as const) {
    const nw = w * 0.5;
    const cx = sz * w * 0.15;
    const z = sz * (d / 2 - 0.95);
    sb.box(nw + 0.4, 0.07, 0.07, cx, 2.45, z, TIMBER);
    for (const e of [-1, 1] as const) sb.box(0.02, 0.2, 0.02, cx + e * nw * 0.4, 2.56, z, IRON);
    // Separate drops of different widths and lengths, each folded once in
    // plan, so a pole of them reads as nets put up to dry and not a curtain.
    let x0 = cx - nw / 2 + rnd() * 0.15;
    while (x0 < cx + nw / 2 - 0.45) {
      const dw = Math.min(0.5 + rnd() * 0.45, cx + nw / 2 - x0);
      const tall = 1.15 + rnd() * 0.45;
      const fold = (rnd() < 0.5 ? 1 : -1) * (0.25 + rnd() * 0.15);
      const pw = dw / 2;
      const len = pw / Math.cos(fold);
      for (const e of [-1, 1] as const) {
        const x = x0 + pw / 2 + (e > 0 ? pw : 0);
        const yaw = e * fold;
        b.translucentBox(len, tall, 0.04, x, 2.31 - tall / 2, z, SAILCLOTH, TRANSLUCENCY.awning, { y: yaw });
        sb.box(len, 0.03, 0.03, x, 2.31, z, PLANK, { y: yaw });
        sb.box(len, 0.035, 0.035, x, 2.31 - tall, z, IRON, { y: yaw });
        sb.box(0.09, 0.07, 0.09, x, 2.31, z, TEAK, { y: yaw });
      }
      x0 += dw + 0.15 + rnd() * 0.25;
    }
  }

  // --- what was put down under it -----------------------------------------
  // All of it under 0.3 m, between the piers on each side.
  const slots: [number, number][] = [];
  for (const sx of [-1, 1] as const) for (const f of [-0.5, 0.5]) slots.push([sx * (pierX - 0.75), f * pierZ]);
  for (const [lx, lz] of slots) {
    const kind = Math.floor(rnd() * 6);
    const gy = ground(lx, lz);
    const yaw = rnd() * Math.PI;
    if (kind === 0) {
      b.cyl(0.14, 0.62, 0.68, 10, lx, gy + 0.07, lz, PLANK);
      b.cyl(0.16, 0.22, 0.22, 8, lx, gy + 0.08, lz, PITCH);
    } else if (kind === 1) {
      b.cyl(0.22, 0.9, 1.3, 7, lx, gy + 0.11, lz, TEAK);
      b.cyl(0.14, 0.45, 0.8, 7, lx + 0.25, gy + 0.27, lz - 0.1, TEAK);
      for (let c = 0; c < 3; c++) sb.box(0.09, 0.07, 0.09, lx - 0.3 + c * 0.22, gy + 0.24, lz + 0.35 - c * 0.15, TEAK, { y: yaw + c });
    } else if (kind === 2) {
      // A fish box: four sides on a bottom, so it is open.
      const fb = (u: number, v: number, bw: number, bh: number, bd: number, y: number): void => {
        sb.box(bw, bh, bd, lx + u * Math.cos(yaw) + v * Math.sin(yaw), gy + y, lz - u * Math.sin(yaw) + v * Math.cos(yaw), TIMBER, { y: yaw });
      };
      fb(0, 0, 0.9, 0.03, 0.55, 0.035);
      for (const e of [-1, 1] as const) fb(0, e * 0.26, 0.9, 0.24, 0.03, 0.14);
      for (const e of [-1, 1] as const) fb(e * 0.435, 0, 0.03, 0.24, 0.49, 0.14);
    } else if (kind === 3) {
      // An anchor lying flat: the shank, the stock across one end, the arms.
      const ax = (u: number): [number, number] => [lx + u * Math.sin(yaw), lz + u * Math.cos(yaw)];
      const [mx, mz] = ax(0);
      sb.box(0.07, 0.06, 1.1, mx, gy + 0.04, mz, IRON, { y: yaw });
      const [stx, stz] = ax(0.48);
      sb.box(0.9, 0.06, 0.06, stx, gy + 0.04, stz, IRON, { y: yaw });
      const [arx, arz] = ax(-0.5);
      for (const e of [-1, 1] as const) sb.box(0.06, 0.06, 0.55, arx, gy + 0.04, arz, IRON, { y: yaw + e * 0.9 });
    } else if (kind === 4) {
      for (let c = 0; c < 6; c++) sb.box(0.11, 0.08, 0.11, lx + (rnd() - 0.5) * 0.6, gy + 0.05, lz + (rnd() - 0.5) * 0.6, TEAK, { y: rnd() * 3 });
    }
    // kind 5: nothing — not every bay is full.
  }
  // A coil hung on the outer face of one front pier.
  if (rnd() < 0.6) {
    const px = (rnd() < 0.5 ? -1 : 1) * pierX;
    const pz = -(pierZ + PH + 0.07);
    b.cyl(0.08, 0.5, 0.5, 10, px, 1.6, pz, PLANK, { x: Math.PI / 2 });
    b.cyl(0.09, 0.18, 0.18, 8, px, 1.6, pz - 0.005, PITCH, { x: Math.PI / 2 });
  }
  // Oars stood blade up against the inner face of a middle pier.
  if (rnd() < 0.5) {
    const sx = rnd() < 0.5 ? -1 : 1;
    const ox = sx * (pierX - PH - 0.06);
    const gy = ground(ox, 0);
    for (const e of [-1, 1] as const) {
      const lean = e * 0.1;
      sb.box(0.06, 2.3, 0.06, ox, gy + 1.15, e * 0.18 + Math.sin(lean) * 1.15, PLANK, { x: lean });
      sb.box(0.03, 0.62, 0.15, ox, gy + 2.0, e * 0.18 + Math.sin(lean) * 2.0, PLANK, { x: lean });
    }
  }

  // The batch before what it hides, then the cores it hides.
  sb.flush(b);
  for (const sx of [-1, 1] as const) {
    for (const dz of [-1, 0, 1]) b.box(0.79, clear, 0.79, sx * pierX, clear / 2, dz * pierZ, PITCH);
  }
  b.box(w - 0.16, 0.06, d - 0.16, 0, floorY - 0.03, 0, PLANK);
  b.box(jamb, loftH, t, 0 - off, midY, frontZ, PITCH);
  b.box(jamb, loftH, t, 0 + off, midY, frontZ, PITCH);
  b.box(1.7, lintel, t, 0, midY + loftH / 2 - lintel / 2, frontZ, PITCH);
  b.box(w, loftH, t, 0, midY, (d - t) / 2, PITCH);
  for (const sx of [-1, 1] as const) b.box(t, loftH, d - t * 2, (sx * (w - t)) / 2, midY, 0, PITCH);
  for (const [z0, z1] of [
    [-d / 2, -d / 2 + t],
    [d / 2 - t, d / 2],
  ]) {
    const gable = (z: number): Point3[] => [
      [-w / 2, top, z],
      [w / 2, top, z],
      [w / 2, roofAt(w / 2), z],
      [0, top + rise, z],
      [-w / 2, roofAt(w / 2), z],
    ];
    convexSolid(b, gable(z0), gable(z1), PITCH);
  }
  convexSolid(b, hoodEnd(-(d / 2 + hood)), hoodEnd(-(d / 2 + hood) + 0.03), PITCH);
  for (const s of [-1, 1] as const) {
    b.box(slope + 0.02, 0.03, roofLen, (s * run) / 2 - s * nx * 0.015, top + rise / 2 - ny * 0.015, 0, PLANK, { z: -s * pitch });
  }
  const ridge = (z: number): Point3[] => [
    [-0.24, top + rise - 0.02, z],
    [0.24, top + rise - 0.02, z],
    [0, top + rise + 0.2, z],
  ];
  convexSolid(b, ridge(-roofLen / 2 - 0.04), ridge(roofLen / 2 + 0.04), BASALT);
  return b;
}
