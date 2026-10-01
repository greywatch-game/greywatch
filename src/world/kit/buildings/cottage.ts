/**
 * kit/buildings/cottage.ts — buildCottage: the thatched, timber-framed village
 * house.
 * Part of the buildings set: follows the contract in kit/core.ts; the set's
 * files are listed in `./index.ts`.
 */
import { Scene } from "@babylonjs/core";
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import {
  Build,
  type BuildCtx,
  type BuildParams,
  type Point3,
  type Structure,
  streetSeed,
  carve,
  convexSolid,
  onFace,
  outward,
  runsAlongX,
  type Hole,
  type Side,
  CASEMENT,
  DOOR_PAINTS,
  BRICK,
  CITY_BRICK,
  DARK_STONE,
  PLANK,
  PLASTER,
  THATCH,
  TIMBER,
} from "../core";
import {
  LAMPLIT,
  offFace,
  casement,
  doorway,
  framing,
  boardUp,
  THATCH_PITCH,
  THATCH_DEPTH,
  RAFTER_REMAINS,
} from "./village";

/**
 * Village house: a timber frame filled with plaster under a thick thatch, a
 * stack on the ridge and a door in the gable end. The workhorse — most of
 * Hollowmere is these at varying sizes, and Cinderhaven places 178.
 *
 * Solid by default. Enterable cottages cost four extra colliders and a hole in
 * the nav grid, so only the ones worth fighting over get interiors.
 *
 * **The masses are the building's and the detail is the drawing, and only the
 * masses carry a collider** — the townhouse's rule, whose header argues it. The
 * block below is every collider a cottage has ever had, in the order it has
 * always emitted them, and the roof's is still the flat slab `gableRoof` laid
 * at the eaves with 0.35 of overhang: the thatch drawn over it is this builder's
 * own, because `gableRoof` draws a 0.18 m board and closes each end in roof
 * colour, and neither is thatch. So a change below that block owes no `npm run
 * collision`, and one inside it does.
 *
 * What the drawing is FOR is that the old one was a plaster box with a stripe
 * round it: no door on a house you could not enter, two glowing rectangles
 * with no frame, a gable end in roof colour and a roof as thin as a door. It is
 * now the things a thatched cottage is recognised by, each in the frame's own
 * vocabulary so the ink finds it:
 *
 * - **The thatch is DEEP, and cut PLUMB.** `THATCH_DEPTH` at
 *   `THATCH_PITCH`, trimmed vertical at the eave and the verge (`coat`) where a
 *   box is cut square to the slope and reads as a board, its eave rolled, two
 *   courses stepping down the slope, and a block-cut ridge — a raised cap with
 *   the points cut along its lower edge, pinned by two liggers, over a roll. **The roof is taller than it was and its collider is not**: a
 *   round through the roof above the eaves slab passed before this too, over
 *   1.5 m of rise rather than about two.
 * - **The frame is on every face**, bedded on it (`gx`/`gz`, which an
 *   enterable cottage sets half a wall further out, exactly as the townhouse's
 *   ground floor does): sole plate, corner posts, a rail and braces, and the
 *   tie beam each gable stands on.
 * - **The gables are wall**, plaster with a collar and a king post, their top
 *   edges buried in the thatch, and an attic light in the front one.
 * - **Every elevation has an opening**: the front door (ledged, or a frame
 *   round an enterable one's doorway) between two casements, one or two more
 *   down each side, a back door on a solid one, and a stack on the ridge kept
 *   inside the thatch so it needs no collider and shows nothing from inside.
 *
 * **The variation is seeded off where it stands** (`streetSeed`, which is what
 * puts `cottage` in `CONFORMS_TO_TERRAIN`): the door and shutter paint, whether
 * the front windows are shuttered, a thatched hood over the door, which end the
 * stack is at, and which side the back door is. Never close studding, which is
 * a street front's display and on a cottage's small front is all posts.
 *
 * **A ruin is BURNT, not merely roofless**: one slope and the back gable gone
 * to charred rafters and a heap under the eaves, what is left of the thatch
 * torn off ragged, and every opening boarded — which also answers why a round
 * stops on a window, since a ruined cottage is still a solid block.
 */
export function buildCottage(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const w = p.width ?? 7;
  const d = p.depth ?? 6;
  const h = p.height ?? 3.4;
  const b = new Build(scene, mats, "cottage");
  const t = 0.35;
  const open = p.enterable === true;
  const ruined = p.ruined === true;
  const lit = p.litWindows && !ruined ? LAMPLIT : undefined;

  // ------------------------------------------------------------ the masses
  //
  // Every collider this building has. See the header before adding to it.
  b.box(w + 0.4, 0.3, d + 0.4, 0, 0.15, 0, DARK_STONE); // plinth
  if (open) {
    // Proud of the plinth — see buildTavern's floor. It used to sit 0.1 under
    // it, which floored the room in plinth stone.
    b.box(w, 0.2, d, 0, 0.24, 0, PLANK);
    b.doorWall(w, h, t, 0, h / 2, -d / 2, PLASTER, 1.6, 2.2);
    b.wall(w, h, t, 0, h / 2, d / 2, PLASTER);
    b.wall(t, h, d, -w / 2, h / 2, 0, PLASTER);
    b.wall(t, h, d, w / 2, h / 2, 0, PLASTER);
  } else {
    // A solid block reads identically from outside and costs one collider.
    b.box(w, h, d, 0, h / 2, 0, PLASTER);
    b.block({ w, h, d, x: 0, y: h / 2, z: 0 });
  }
  if (ruined) b.block({ w: w + 0.6, h: 0.3, d: d + 0.6, x: 0, y: h, z: 0 });
  else b.block({ w: w + 0.7, h: 0.3, d: d + 0.7, x: 0, y: h, z: 0 });

  // ----------------------------------------------------------- the drawing
  const seed = streetSeed(w, d, h, ctx);
  const paint = DOOR_PAINTS[(seed >>> 20) % DOOR_PAINTS.length];
  const shuttered = ((seed >>> 13) & 3) !== 0;
  const hooded = ((seed >>> 16) & 1) === 0;
  const stackEnd = ((seed >>> 25) & 1) === 0 ? 1 : -1;
  const sideDoor: Side = ((seed >>> 29) & 1) === 0 ? "+x" : "-x";

  /** The outer wall faces. See the header on the enterable one. */
  const gx = w / 2 + (open ? t / 2 : 0);
  const gz = d / 2 + (open ? t / 2 : 0);
  const plane = (s: Side): number => (runsAlongX(s) ? gz : gx);
  const half = (s: Side): number => (runsAlongX(s) ? gx : gz);
  /** The plinth's own face, which a doorstep stands out from. */
  const plinth = (s: Side): number => (runsAlongX(s) ? d : w) / 2 + 0.2;
  const SIDES: Side[] = ["-z", "+z", "-x", "+x"];
  /** Top of the sole plate, the posts' heads, and the rail between them. */
  const sole = 0.5;
  const top = h - 0.25;
  const rail = Math.max(2.3, h * 0.68);

  // The roof, described by its UNDERSIDE: a plane through the top of the wall
  // face at `THATCH_PITCH`, so the thatch sits on the wall head with no slit
  // under it and everything else is measured off that one line.
  const k = THATCH_PITCH;
  const pitch = Math.atan(k);
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);
  const T = THATCH_DEPTH;
  /** The eave's tip, horizontally from the ridge. */
  const tip = gx + 0.5;
  /** The verge, past each gable. */
  const zEnd = gz + 0.35;
  /** The thatch's underside at `x` from the ridge. */
  const under = (x: number): number => h - 0.02 + (gx - x) * k;
  /** The thatch's top face over the ridge. */
  const ridgeTop = under(0) + T / cosP;
  /**
   * A slab laid in the roof plane on side `sx`: from `x0` to `x1` from the
   * ridge (measured on the underside), `o0` to `o1` out along the normal from
   * it, and `z0` to `z1` along the ridge. Cut square to the slope, which is
   * right for a rafter and wrong for thatch — see `coat`.
   */
  const onRoof = (
    sx: number,
    x0: number,
    x1: number,
    o0: number,
    o1: number,
    z0: number,
    z1: number,
    color: string,
  ): void => {
    const xm = (x0 + x1) / 2;
    const o = (o0 + o1) / 2;
    b.box((x1 - x0) / cosP, o1 - o0, z1 - z0, sx * (xm + o * sinP), under(xm) + o * cosP, (z0 + z1) / 2, color, {
      z: -sx * pitch,
    });
  };

  /** The point `x` from the ridge on side `sx`, `o` out from the underside. */
  const roofPt = (sx: number, x: number, o: number, z: number): Point3 => [
    sx * (x + o * sinP),
    under(x) + o * cosP,
    z,
  ];
  /**
   * Thatch from `x0` to `x1` and `o0` to `o1` deep, cut PLUMB at both ends: a
   * coat is trimmed vertical at the eave, which is most of what tells it from a
   * board, and two coats cut plumb at the ridge meet with no notch between them.
   * `round` takes both of the eave's corners off, which is the roll a thatched
   * eave has and the cel bands draw as one.
   */
  const coat = (sx: number, x0: number, x1: number, o0: number, o1: number, z0: number, z1: number, round = 0): void => {
    const lo = (x: number): number => under(x) + o0 / cosP;
    const hi = (x: number): number => under(x) + o1 / cosP;
    const eave: [number, number][] =
      round > 0
        ? [
            [x1 - round, lo(x1 - round)],
            [x1, lo(x1 - round) + round * 0.3],
            [x1, hi(x1) - round],
            [x1 - round * 0.8, hi(x1 - round * 0.8)],
          ]
        : [
            [x1, lo(x1)],
            [x1, hi(x1)],
          ];
    const section = (z: number): Point3[] => [
      [sx * x0, lo(x0), z],
      ...eave.map(([x, y]): Point3 => [sx * x, y, z]),
      [sx * x0, hi(x0), z],
    ];
    convexSolid(b, section(z0), section(z1), THATCH);
  };

  // Head members, and the corner posts under them. On the gable ends the head
  // is the tie beam the gable stands on; on the eaves sides it is the plate,
  // tall enough to run up into the thatch.
  for (const s of SIDES) {
    onFace(b, s, plane(s), 0, h - 0.12, half(s) * 2 + 0.2, 0.28, 0.18, 0.05, TIMBER);
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.box(0.3, top - sole, 0.3, sx * (gx - 0.05), (sole + top) / 2, sz * (gz - 0.05), TIMBER);
    }
  }

  /** A window, or on a ruin the same window boarded over. */
  const windowAt = (s: Side, u: number, sill: number, ww: number, wh: number, o: { lit?: string; shutters?: string } = {}): Hole => {
    const hole = casement(b, s, plane(s), u, sill, ww, wh, ruined ? {} : o);
    if (ruined) boardUp(b, s, plane(s), u, sill, sill + wh, ww, 0.14);
    return hole;
  };
  /** A door: the frame alone round an enterable doorway, and boarded on a ruin. */
  const doorAt = (s: Side, u: number, dw: number, dh: number, leaf: string): Hole => {
    const opening = open && s === "-z";
    const hole = doorway(b, s, plane(s), plinth(s), u, dw, dh, opening || ruined ? null : leaf);
    if (ruined && !opening) {
      onFace(b, s, plane(s), u, 0.3 + dh / 2, dw, dh, 0.06, 0.02, CASEMENT);
      boardUp(b, s, plane(s), u, 0.45, 0.3 + dh - 0.1, dw, 0.17);
    }
    return hole;
  };
  const doors: Record<Side, Hole[]> = { "-z": [], "+z": [], "-x": [], "+x": [] };

  // ---- the front (-Z): the door between a pair of casements, and a hood
  // over it on some. An enterable one's doorway is the collider gap's own
  // 1.6 x 2.2, centred.
  const front: Side = "-z";
  const dw = open ? 1.6 : 1.0;
  doors[front].push(doorAt(front, 0, dw, 1.9, paint));
  const pairL = dw / 2 + 0.3;
  const pairR = gx - 0.32;
  const pairU = (pairL + pairR) / 2;
  const span = pairR - pairL;
  const withShutters = shuttered && (span - 0.36) / 2 >= 0.55;
  const ww = withShutters ? Math.min(0.9, (span - 0.36) / 2) : Math.min(0.9, span - 0.3);
  const fHoles = [...doors[front]];
  for (const u of [-pairU, pairU]) {
    fHoles.push(windowAt(front, u, 1.0, ww, 1.0, { lit, shutters: withShutters ? paint : undefined }));
  }
  framing(b, front, gz, gx, sole, top, rail, fHoles, "panel");
  if (hooded && !ruined) {
    // A thatched hood on two brackets, which is the cottage's porch.
    const hy = 2.64;
    offFace(b, front, gz, 0, dw + 0.8, hy + 0.12, hy - 0.12, 0.02, 0.72, 0.15, THATCH);
    for (const kk of [-1, 1]) {
      offFace(b, front, gz, kk * (dw / 2 + 0.24), 0.08, hy - 0.62, hy - 0.1, 0.03, 0.6, 0.08, TIMBER);
    }
  }

  // ---- the back (+Z): one casement off to the side.
  const back: Side = "+z";
  framing(b, back, gz, gx, sole, top, rail, [windowAt(back, -gx * 0.42, 1.05, 0.75, 0.9)], "panel");

  // ---- the eaves sides: a back door on one of them on a solid cottage, and
  // casements in the rest of both. The side without the door carries the lamp.
  for (const s of ["-x", "+x"] as const) {
    const holes: Hole[] = [];
    const withDoor = !open && s === sideDoor;
    const lamp = s === sideDoor ? undefined : lit;
    if (withDoor) {
      doors[s].push(doorAt(s, gz * 0.42, 0.95, 1.85, PLANK));
      holes.push(...doors[s], windowAt(s, -gz * 0.4, 1.05, 0.8, 0.95, { lit: lamp }));
    } else {
      for (const u of [-gz * 0.42, gz * 0.42]) holes.push(windowAt(s, u, 1.05, 0.8, 0.95, { lit: lamp }));
    }
    framing(b, s, gx, gz, sole, top, rail, holes, "panel");
  }

  // ---- the sole plate on the plinth, cut at every doorway — the townhouse's
  // note on a beam across a threshold.
  for (const s of SIDES) {
    const run = half(s) + 0.1;
    const cuts = doors[s].map((hole): [number, number] => [hole.u0, hole.u1]);
    for (const [a, c] of carve(-run, run, cuts)) {
      if (c - a > 0.15) onFace(b, s, plane(s), (a + c) / 2, (0.3 + sole) / 2, c - a, sole - 0.3, 0.16, 0.04, TIMBER);
    }
  }

  // ---- the gables: plaster, standing on the tie beam with both top edges
  // buried in the thatch, framed with a collar and a king post. A ruin's back
  // gable is down to two ragged courses.
  const gt = open ? t : 0.3;
  for (const s of ["-z", "+z"] as const) {
    const n = outward(s);
    const zc = n * (gz - gt / 2);
    if (ruined && s === "+z") {
      // Two convex pieces, because a broken edge is not a convex outline:
      // a course sheared off on a slant, and a lump of it still standing.
      const piece = (outline: [number, number][]): void => {
        const at = (z: number): Point3[] => outline.map(([x, y]): Point3 => [x, y, z]);
        convexSolid(b, at(zc - gt / 2), at(zc + gt / 2), PLASTER);
      };
      piece([
        [-gx, h - 0.02],
        [gx, h - 0.02],
        [gx * 0.5, h + 0.35],
        [-gx * 0.5, h + 0.6],
      ]);
      piece([
        [-gx * 0.5, h + 0.55],
        [-gx * 0.05, h + 0.45],
        [-gx * 0.2, h + 1.15],
        [-gx * 0.45, h + 1.05],
      ]);
      continue;
    }
    const a = gx + 0.15 / k;
    b.gableEnd(2 * a, a * k, gt, 0, h - 0.02, zc, PLASTER);
    const yCol = h + 0.5 * gx * k;
    const colHalf = gx - (yCol - h) / k - 0.12;
    onFace(b, s, gz, 0, yCol, 2 * colHalf, 0.16, 0.12, 0.03, TIMBER);
    const kingTop = under(0) - 0.04;
    onFace(b, s, gz, 0, (yCol + kingTop) / 2, 0.16, kingTop - yCol, 0.12, 0.03, TIMBER);
    for (const kk of [-1, 1]) {
      const r = 0.64 * gx;
      const st = under(r) - 0.03;
      onFace(b, s, gz, kk * r, (h + 0.02 + st) / 2, 0.15, st - h - 0.02, 0.12, 0.03, TIMBER);
    }
    const attic = Math.min(0.6, yCol - 0.2 - (h + 0.28));
    if (s === front && attic > 0.3) windowAt(front, 0, h + 0.28, 0.5, attic);
  }

  // ---- the thatch.
  if (!ruined) {
    const xc = 0.85; // how far down the slope the ridge cap reaches
    /** The top of the coats, where the ridge is laid. */
    const Tr = T + 0.1;
    for (const sx of [-1, 1]) {
      coat(sx, 0, tip, 0, T, -zEnd, zEnd, 0.16);
      // Two more courses, each laid over the one below and ending in its own
      // butt: the steps down the slope are the lines a thatched roof is read
      // by from across a street, and they run ALONG it where a tiled roof's
      // run both ways and a boarded one's run down it.
      coat(sx, 0, tip * 0.66, T - 0.02, T + 0.05, -zEnd, zEnd);
      coat(sx, 0, tip * 0.36, T + 0.03, Tr, -zEnd, zEnd);
      // The block-cut ridge: a raised cap, the points cut along its lower
      // edge, and two liggers pinning it.
      coat(sx, 0, xc, Tr - 0.02, Tr + 0.14, -zEnd + 0.06, zEnd - 0.06);
      for (let z = -zEnd + 0.3; z < zEnd - 0.2; z += 0.5) {
        const o0 = Tr - 0.02;
        const o1 = Tr + 0.07;
        const tooth = (o: number): Point3[] => [
          roofPt(sx, xc - 0.02, o, z - 0.21),
          roofPt(sx, xc + 0.28, o, z),
          roofPt(sx, xc - 0.02, o, z + 0.21),
        ];
        convexSolid(b, tooth(o0), tooth(o1), THATCH);
      }
      for (const x of [0.3, xc - 0.16]) {
        onRoof(sx, x, x + 0.05, Tr + 0.14, Tr + 0.19, -zEnd + 0.12, zEnd - 0.12, TIMBER);
      }
    }
    b.cyl(2 * zEnd - 0.1, 0.46, 0.46, 8, 0, ridgeTop + 0.28, 0, THATCH, { x: Math.PI / 2 });
  } else {
    // Burnt: the -X slope holds over the front and is torn off ragged behind,
    // and everywhere else the rafters stand bare, most of them broken short.
    const zCut = gz * 0.2;
    coat(-1, 0, tip, 0, T, -zEnd, zCut, 0.16);
    coat(-1, 0, tip * 0.66, T - 0.02, T + 0.05, -zEnd, zCut);
    coat(-1, 0, tip * 0.45, 0, T, zCut, zCut + 0.9);
    const beamEnd = gz * 0.55;
    b.box(0.22, 0.26, beamEnd + zEnd - 0.1, 0, under(0) - 0.12, (beamEnd - zEnd + 0.1) / 2, TIMBER);
    let i = seed % RAFTER_REMAINS.length;
    for (let z = -gz + 0.3; z <= gz - 0.2; z += 0.8) {
      for (const sx of [-1, 1]) {
        if (sx < 0 && z < zCut + 0.9) continue; // still under the thatch
        const reach = (gx + 0.2) * RAFTER_REMAINS[i++ % RAFTER_REMAINS.length];
        onRoof(sx, gx + 0.2 - reach, gx + 0.2, -0.17, -0.02, z - 0.06, z + 0.06, TIMBER);
      }
    }
    // What came down, under the open eave: charred thatch and a rafter. Low
    // enough to walk over, which is the rule for anything outside the
    // footprint that carries no collider.
    b.box(1.3, 0.3, d * 0.55, gx + 0.7, 0.1, -d * 0.12, TIMBER, { y: 0.1, z: -0.14 });
    b.box(0.8, 0.26, d * 0.3, gx + 0.55, 0.14, d * 0.2, TIMBER, { y: -0.2, z: 0.18 });
    b.box(0.14, 0.14, 2.4, gx + 0.9, 0.26, d * 0.06, TIMBER, { x: 0.1, y: 0.5 });
  }

  // ---- the stack on the ridge, based just inside the thatch so it shows
  // nothing to a room under it. A ruin's stands from the wall head, pots gone
  // — the bit of a burnt cottage that always survives — except over an
  // enterable one, where it would hang in the room's air.
  if (!(ruined && open)) {
    const cz = stackEnd * (d / 2 - 0.8);
    const base = ruined ? h - 0.1 : under(0) + 0.02;
    const ch = ridgeTop + (ruined ? 0.8 : 1.25);
    b.box(0.8, ch - base, 0.95, 0, (base + ch) / 2, cz, BRICK);
    b.box(1.0, 0.16, 1.15, 0, ch, cz, DARK_STONE);
    b.box(0.9, 0.1, 1.05, 0, ch - 0.42, cz, DARK_STONE);
    if (!ruined) for (const kk of [-1, 1]) b.cyl(0.45, 0.2, 0.28, 8, 0, ch + 0.3, cz + kk * 0.24, CITY_BRICK);
  }

  // ---- inside an enterable one: the tie beams across the room and the ridge
  // piece, which are what a player looks up at.
  if (open) {
    for (const z of [-d / 4, d / 4]) b.box(w - t, 0.24, 0.22, 0, h - 0.12, z, TIMBER);
    if (!ruined) b.box(0.2, 0.26, d, 0, under(0) - 0.13, 0, TIMBER);
  }

  return b;
}
