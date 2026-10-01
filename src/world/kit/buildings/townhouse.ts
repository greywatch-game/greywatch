/**
 * kit/buildings/townhouse.ts — buildTownhouse: the two-storey jettied townhouse
 * under a slate roof.
 * Part of the buildings set: follows the contract in kit/core.ts; the set's
 * files are listed in `./index.ts`.
 */
import { Scene } from "@babylonjs/core";
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import {
  Build,
  type BuildCtx,
  type BuildParams,
  type Structure,
  streetSeed,
  carve,
  onFace,
  outward,
  runsAlongX,
  type Hole,
  type Side,
  DOOR_PAINTS,
  BRICK,
  CITY_BRICK,
  DARK_STONE,
  IRON,
  PLANK,
  PLASTER,
  SLATE,
  TIMBER,
} from "../core";
import { LAMPLIT, SHOPLIT, offFace, casement, doorway, framing } from "./village";

/**
 * Two-storey townhouse: a jettied upper floor oversailing the ground floor,
 * a timber frame on both storeys, a steep slate roof and a brick stack.
 *
 * The cottage is a village silhouette; this is a *street* silhouette — taller
 * than it is wide, so a row of them walls a lane in and gives the square an
 * actual skyline. `enterable` hollows the ground floor only; the upper storey
 * is the ceiling.
 *
 * **The masses are the building's and the detail is the drawing, and only the
 * masses carry a collider.** The first block below — the two storeys, the
 * bressumer, the roof and the stack — is every collider and every box the
 * collision bake has ever seen here, and nothing after it may add one: a
 * window frame or a joist end is a few centimetres of timber that `NavGrid`
 * can only get wrong, and a townhouse is placed sixty times over on
 * Cinderhaven. So a change below that line owes no `npm run collision`, and a
 * change above it does.
 *
 * What the drawing is FOR is that the old one was two plaster boxes with
 * stripes on the upper one: no door, no window on a house whose lamps were
 * out, a gable end in roof slate, and nothing under the jetty to say what was
 * holding it up. Read front to back it is now the things a jettied house is
 * recognised by, each built from the frame's own vocabulary so the ink finds
 * it: joist ends and corner brackets under the oversail, a sole plate, posts
 * and braces on the ground storey and close studding over it, casements with
 * mullions in every elevation, a plastered gable with its collar and king
 * post under a pair of bargeboards, and clay ridge tiles and pots against the
 * slate.
 *
 * **Every applied member is bedded on a FACE**, and an enterable ground floor
 * has its face half a wall further out than a solid one — its walls are
 * centred on the footprint line — which is why `gx`/`gz` exist. The old corner
 * posts were centred on the footprint corner, and on the enterable one the
 * walls closed over them completely (`kit/core.ts`'s applied-member rule).
 *
 * **The variation is seeded off the placement's position and size, never
 * drawn** (world building may not call `Math.random()`, and `streetSeed` says
 * why that costs an entry in `CONFORMS_TO_TERRAIN`): which paint the door and
 * shutters are, whether the street front is close-studded or square-framed,
 * and whether a solid one keeps a SHOP — its door at one end, a wide window
 * with the stall board let down as a counter and the upper board propped over
 * it, and a sign on an iron arm. An enterable one is never a shop, because its
 * doorway is a collider's and is centred.
 */
export function buildTownhouse(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "townhouse");
  const w = p.width ?? 6.5;
  const d = p.depth ?? 6.5;
  const h = p.height ?? 6.8;
  const t = 0.35;
  const g = 3.3; // ground-floor ceiling
  const up = h - g; // upper storey
  const jut = 0.45; // how far the upper floor oversails
  const rise = 2.1;
  const eaves = 0.4;
  const open = p.enterable === true;
  const lit = p.litWindows ? LAMPLIT : undefined;

  // ------------------------------------------------------------ the masses
  //
  // Every collider this building has. See the header before adding to it.
  b.box(w + 0.5, 0.3, d + 0.5, 0, 0.15, 0, DARK_STONE); // plinth
  if (open) {
    // Proud of the plinth, not flush with it — see buildTavern's floor.
    b.box(w, 0.2, d, 0, 0.24, 0, PLANK);
    b.doorWall(w, g, t, 0, g / 2, -d / 2, PLASTER, 1.6, 2.3);
    b.wall(w, g, t, 0, g / 2, d / 2, PLASTER);
    b.wall(t, g, d, -w / 2, g / 2, 0, PLASTER);
    b.wall(t, g, d, w / 2, g / 2, 0, PLASTER);
    // The upper floor doubles as the ceiling slab.
    b.wall(w + jut * 2, up, d + jut * 2, 0, g + up / 2, 0, PLASTER);
  } else {
    b.box(w, g, d, 0, g / 2, 0, PLASTER);
    b.block({ w, h: g, d, x: 0, y: g / 2, z: 0 });
    b.box(w + jut * 2, up, d + jut * 2, 0, g + up / 2, 0, PLASTER);
    b.block({ w: w + jut * 2, h: up, d: d + jut * 2, x: 0, y: g + up / 2, z: 0 });
  }
  // The bressumer: the beam the oversailing storey stands on.
  b.box(w + jut * 2 + 0.2, 0.34, d + jut * 2 + 0.2, 0, g + 0.17, 0, TIMBER);
  b.gableRoof(w + jut * 2, d + jut * 2, rise, 0, h, 0, SLATE, eaves);
  // Brick stack, kept inside the footprint so it needs no collider of its own.
  const ch = h + 2.6;
  const cx = w / 2 - 0.6;
  const cz = d / 2 - 1.4;
  b.box(1.0, ch, 1.0, cx, ch / 2, cz, BRICK);
  b.box(1.3, 0.24, 1.3, cx, ch, cz, DARK_STONE);

  // ----------------------------------------------------------- the drawing
  // Each choice reads its own HIGH bits: the finaliser's low ones walked
  // seven of the eleven doors on Hollowmere and Harrowmead to one paint.
  const seed = streetSeed(w, d, h, ctx);
  const paint = DOOR_PAINTS[(seed >>> 20) % DOOR_PAINTS.length];
  const shop = !open && (seed >>> 11) % 3 === 0;
  const closeStudded = ((seed >>> 25) & 1) === 0;

  /** The two storeys' outer faces. See the header on the enterable one. */
  const gx = w / 2 + (open ? t / 2 : 0);
  const gz = d / 2 + (open ? t / 2 : 0);
  const ux = w / 2 + jut;
  const uz = d / 2 + jut;
  const gPlane = (s: Side): number => (runsAlongX(s) ? gz : gx);
  const gHalf = (s: Side): number => (runsAlongX(s) ? gx : gz);
  const uPlane = (s: Side): number => (runsAlongX(s) ? uz : ux);
  /** The plinth's own face, which a doorstep stands out from. */
  const plinth = (s: Side): number => (runsAlongX(s) ? d : w) / 2 + 0.25;
  const SIDES: Side[] = ["-z", "+z", "-x", "+x"];

  /** Top of the sole plate, and underside of the ground storey's top plate. */
  const sole = 0.52;
  const gTop = g - 0.44;
  /** Top of the bressumer, and the upper storey's window sill and rail. */
  const uFoot = g + 0.34;
  const uSill = uFoot + 0.72;
  const uRail = uSill - 0.2;
  const uWin = Math.min(1.2, h - 0.54 - uSill - 0.14);

  // Plates and posts. The corner posts stand on the sole plate and run up to
  // the plate over them, 0.1 proud of both faces they turn.
  for (const s of SIDES) {
    onFace(b, s, gPlane(s), 0, g - 0.31, gHalf(s) * 2 + 0.2, 0.26, 0.16, 0.04, TIMBER);
    // The two gable ends carry a TIE beam, deep enough to close the strip
    // between the wall head and the plaster gable standing on it; the eaves
    // sides a plate tall enough to close the slit under the roof slab.
    if (runsAlongX(s)) {
      onFace(b, s, uz, 0, h + 0.02, ux * 2 + 0.2, 0.32, 0.2, 0.06, TIMBER);
    } else {
      onFace(b, s, ux, 0, h - 0.05, uz * 2 + 0.2, 0.38, 0.16, 0.04, TIMBER);
    }
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.box(0.32, gTop - sole, 0.32, sx * (gx - 0.06), (sole + gTop) / 2, sz * (gz - 0.06), TIMBER);
      const top = h - 0.24;
      b.box(0.3, top - uFoot, 0.3, sx * (ux - 0.05), (uFoot + top) / 2, sz * (uz - 0.05), TIMBER);
    }
  }

  // Under the jetty: the joists' ends where the floor they carry runs out past
  // the wall, and a bracket off each corner post on the two gable ends. This
  // is the detail that says the upper storey is held up rather than stacked.
  for (const s of SIDES) {
    const half = gHalf(s) - 0.4;
    const len = uPlane(s) - gPlane(s);
    const n = Math.max(2, Math.round((2 * half) / 0.55));
    for (let i = 0; i <= n; i++) {
      onFace(b, s, gPlane(s), -half + (i * 2 * half) / n, g - 0.09, 0.15, 0.18, len, len / 2, TIMBER);
    }
  }
  for (const s of ["-z", "+z"] as const) {
    for (const k of [-1, 1]) {
      offFace(b, s, gz, k * (gx - 0.06), 0.16, g - 0.95, g - 0.18, 0.1, uz - gz - 0.03, 0.16, TIMBER);
    }
  }

  // ---- the street front (-Z)
  const front: Side = "-z";
  const fGround: Hole[] = [];
  const fUpper: Hole[] = [];
  // Where a pair of windows either side of a centred door falls. The upper
  // storey keeps the same pair on a shop too, so the rhythm reads up the face.
  const dHalf = open ? 0.8 : 0.525;
  const pairL = dHalf + 0.3;
  const pairR = gx - 0.32;
  const pairU = (pairL + pairR) / 2;
  if (shop) {
    const sd = ((seed >>> 28) & 1) === 0 ? 1 : -1;
    const dw = 1.0;
    const ud = sd * (pairR - 0.1 - dw / 2 - 0.18);
    fGround.push(doorway(b, front, gz, plinth(front), ud, dw, 1.95, paint));
    const uA = -sd * pairR;
    const uB = ud - sd * (dw / 2 + 0.4);
    const uc = (uA + uB) / 2;
    const ww = Math.abs(uB - uA) - 0.24;
    const sill = 1.0;
    const head = sill + 1.3;
    fGround.push(casement(b, front, gz, uc, sill, ww, 1.3, { lit: lit && SHOPLIT, lights: Math.max(2, Math.round(ww / 0.6)) }));
    // The stall board, let down on two brackets as a counter...
    offFace(b, front, gz, uc, ww + 0.1, 0.84, 0.84, 0.02, 0.6, 0.07, PLANK);
    for (const k of [-1, 1]) {
      offFace(b, front, gz, uc + k * ww * 0.35, 0.06, 0.4, 0.8, 0.02, 0.5, 0.06, TIMBER);
    }
    // ...and the board over it propped out as a pentice on two iron stays.
    offFace(b, front, gz, uc, ww + 0.1, head + 0.16, head - 0.06, 0.08, 0.75, 0.05, paint);
    for (const k of [-1, 1]) {
      offFace(b, front, gz, uc + k * (ww / 2 - 0.1), 0.03, head + 0.62, head - 0.02, 0.05, 0.72, 0.03, IRON);
    }
    // A sign on an iron arm off the corner post, hung edge-on to the street
    // so it is read from along it.
    const uArm = sd * (gx - 0.06);
    offFace(b, front, gz, uArm, 0.05, 2.78, 2.78, 0.1, 1.05, 0.05, IRON);
    offFace(b, front, gz, uArm, 0.05, 2.35, 2.35, 0.3, 0.95, 0.5, paint);
    for (const r of [0.38, 0.87]) {
      offFace(b, front, gz, uArm, 0.025, 2.68, 2.68, r - 0.015, r + 0.015, 0.2, IRON);
    }
  } else {
    fGround.push(
      doorway(b, front, gz, plinth(front), 0, dHalf * 2, open ? 2.0 : 1.95, open ? null : paint),
    );
    const span = pairR - pairL;
    const shuttered = (span - 0.36) / 2 >= 0.6;
    const ww = shuttered ? Math.min(1.05, (span - 0.36) / 2) : Math.min(1.05, span - 0.3);
    for (const k of [-1, 1]) {
      fGround.push(casement(b, front, gz, k * pairU, 1.0, ww, 1.2, { lit, shutters: shuttered ? paint : undefined }));
    }
  }
  for (const k of [-1, 1]) {
    fUpper.push(casement(b, front, uz, k * pairU, uSill, 1.0, uWin, { lit }));
  }
  framing(b, front, gz, gx, sole, gTop, null, fGround, "panel");
  framing(b, front, uz, ux, uFoot, h - 0.14, uRail, fUpper, closeStudded ? "close" : "panel");

  // ---- the back (+Z): a plain door away from the stack, the scullery window
  // beside it, and one light upstairs.
  const back: Side = "+z";
  const bGround = [
    doorway(b, back, gz, plinth(back), -(pairR - 0.1 - 0.47 - 0.18), 0.95, 1.9, PLANK),
    casement(b, back, gz, pairU, 1.1, 0.75, 0.95),
  ];
  framing(b, back, gz, gx, sole, gTop, null, bGround, "panel");
  framing(b, back, uz, ux, uFoot, h - 0.14, uRail, [casement(b, back, uz, 0, uSill, 0.95, uWin)], "panel");

  // ---- the flanks: one window upstairs on each, and one down on the side
  // away from the hearth.
  for (const s of ["-x", "+x"] as const) {
    const below = s === "-x" ? [casement(b, s, gx, 0, 1.1, 0.75, 1.0)] : [];
    framing(b, s, gx, gz, sole, gTop, null, below, "panel");
    framing(b, s, ux, uz, uFoot, h - 0.24, uRail, [casement(b, s, ux, 0, uSill, 0.85, uWin)], "panel");
  }

  // ---- the sole plate the ground storey stands on, laid on the plinth and
  // cut at every doorway: a beam across a threshold draws a step the ground
  // probe says is not there (the barn's footing note), and a door's jambs
  // stand on the plinth either side of the cut.
  const doors: Record<Side, Hole[]> = {
    "-z": fGround.filter((hole) => hole.y0 === 0),
    "+z": bGround.filter((hole) => hole.y0 === 0),
    "-x": [],
    "+x": [],
  };
  for (const s of SIDES) {
    const run = gHalf(s) + 0.1;
    const cuts = doors[s].map((hole): [number, number] => [hole.u0, hole.u1]);
    for (const [a, c] of carve(-run, run, cuts)) {
      if (c - a > 0.15) onFace(b, s, gPlane(s), (a + c) / 2, (0.3 + sole) / 2, c - a, sole - 0.3, 0.16, 0.04, TIMBER);
    }
  }

  // ---- the gables. `gableRoof` closes each end in a slate panel, which is
  // right for the roof void and wrong for a timber house: a gable is wall. So
  // a plaster one stands in front of it, its sloped edges tucked up into the
  // slabs, framed with a collar and a king post round an attic light, under a
  // pair of bargeboards and a finial at the apex.
  const slopeW = ux + eaves;
  const slopeK = rise / slopeW;
  const pitch = Math.atan2(rise, slopeW);
  const slabLen = Math.hypot(slopeW, rise);
  for (const s of ["-z", "+z"] as const) {
    const n = outward(s);
    const a = ux + 0.1;
    const yb = h + (slopeW - a) * slopeK - 0.06;
    const face = uz + 0.15;
    b.gableEnd(2 * a, a * slopeK, 0.06, 0, yb, n * (uz + 0.12), PLASTER);
    const yCol = yb + 0.5 * a * slopeK;
    onFace(b, s, face, 0, yCol, a - 0.2, 0.16, 0.12, 0.03, TIMBER);
    const kingTop = yb + a * slopeK - 0.2;
    onFace(b, s, face, 0, (yCol + kingTop) / 2, 0.16, kingTop - yCol, 0.12, 0.03, TIMBER);
    for (const kk of [-1, 1]) {
      const r = 0.62 * a;
      const top = yb + (a - r) * slopeK - 0.1;
      onFace(b, s, face, kk * r, (yb + top) / 2, 0.15, top - yb, 0.12, 0.03, TIMBER);
    }
    const attic = yCol - 0.22 - (yb + 0.28);
    if (attic > 0.3) casement(b, s, face, 0, yb + 0.28, 0.55, Math.min(0.75, attic), { lights: 1 });

    const barge = n * (uz + eaves - 0.05);
    for (const sx of [-1, 1]) {
      b.box(slabLen - 0.1, 0.24, 0.06, (sx * slopeW) / 2, h + rise / 2 - 0.2 / Math.cos(pitch), barge, TIMBER, {
        z: -sx * pitch,
      });
    }
    b.box(0.14, 0.7, 0.14, 0, h + rise + 0.15, barge, TIMBER);
  }

  // ---- the roof: clay ridge tiles, and the slate's courses as lines on its
  // own plane — one slab is one tone whatever the light is doing, and a course
  // line is a depth step the ink can find.
  b.box(0.3, 0.16, 2 * (uz + eaves) + 0.04, 0, h + rise + 0.09, 0, BRICK);
  const off = 0.108; // the slab's half thickness and the course's
  for (const sx of [-1, 1]) {
    for (const f of [0.2, 0.4, 0.6, 0.8]) {
      const r = slopeW * (1 - f);
      b.box(
        0.09,
        0.035,
        2 * (uz + eaves) - 0.02,
        sx * (r + Math.sin(pitch) * off),
        h + rise * f + Math.cos(pitch) * off,
        0,
        IRON,
        { z: -sx * pitch },
      );
    }
  }
  // The stack's oversailing course and its pots.
  b.box(1.1, 0.12, 1.1, cx, ch - 0.55, cz, DARK_STONE);
  for (const kk of [-1, 1]) b.cyl(0.5, 0.22, 0.3, 8, cx + kk * 0.24, ch + 0.37, cz, CITY_BRICK);

  return b;
}
