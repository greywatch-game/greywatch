/**
 * kit/buildings/smithy.ts — buildSmithy: the stone shop open to the street,
 * with its forge.
 * Part of the buildings set: follows the contract in kit/core.ts; the set's
 * files are listed in `./index.ts`.
 */
import { Scene } from "@babylonjs/core";
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import {
  Build,
  type Point3,
  type Structure,
  convexSolid,
  onFace,
  type Side,
  CASEMENT,
  BRICK,
  CITY_BRICK,
  DARK_STONE,
  EMBER,
  IRON,
  PITCH,
  PLANK,
  SLATE,
  STONE,
  SLAG,
  TIMBER,
} from "../core";
import { SHOPLIT, offFace, casement, ROOF_PITCH } from "./village";

/**
 * The smithy: a stone shop open to the street under a slate roof, a forge at
 * the back with its hood, bellows and stack, and the trade laid out in front of
 * it. The open front makes it a piece of cover you fight *through* rather than
 * around.
 *
 * **The shell's colliders are the ones it has always had, in the order it has
 * always emitted them** — three walls, the open front's jambs and lintel, and
 * the roof's flat slab at the eaves, which `gableRoof` used to lay and is now
 * stated by hand because the roof drawn over it is this builder's own. The
 * tavern's rule, whose header argues it.
 *
 * **What was wrong was that it read as a shed with a lamp in it.** Stone that
 * came out as plaster because nothing on it was dressed, a shallow roof whose
 * gables were slate, a chimney standing in the room as a column from the floor
 * to the sky with nothing under it but a glowing plate on a waist-high box, an
 * anvil the size of a chest on a stump the size of a barrel, and grass growing
 * through the floor. It is now the things a village forge is recognised by:
 *
 * - **Stone that reads as masonry**: quoins at every corner, the opening
 *   dressed the same way under a heavy oak lintel, and COPED gables — the
 *   walls carried up past the slate with a coping on each rake and a kneeler
 *   at each eave, which is what a stone building's gable is and what a slate
 *   triangle is not. The roof is `ROOF_PITCH` and cut plumb (the tavern's
 *   construction, turned to run along Z) with a stone ridge and a louvre on it
 *   to let the heat out, and a pentice over the opening on braced bearers.
 * - **A FORGE rather than a fireplace**: a hearth at the height a smith works
 *   at, with an ash pit under it and the fire in a bed of coal on top, not on
 *   its face — this builder's old lesson, which the manor's `fireplace`
 *   records — a brick hood over it gathering into the flue, the stack rising
 *   from the back gable's apex, great bellows on a trestle beside it worked by
 *   a rocking pole, a slake trough on its front, a coal bunker, and tongs.
 * - **The trade in front of it**: an anvil of real size and shape on its stump,
 *   a slack tub, a bench with a leg vice under the window and tools over it,
 *   bar stock racked on the wall, shoes on a rail, a cone mandrel; outside, a
 *   grindstone, a cartwheel waiting on the wall and a shoe over the door.
 *
 * **The shop is FLOORED and its work places are solid.** Six colliders after
 * the shell's, so its prefix of the collision bake is unchanged: the walked
 * floor under the plinth and the apron in front (the tavern's floor, for its
 * reasons — a body stood 0.2 m down in the stone and grass grew through it),
 * the hearth, the trough on its face, the anvil, the tub and the bench. The
 * anvil and the tub are low, soft cover and the hearth is not much more; the
 * bellows, the bunker, the mandrel and the grindstone are visual, walking
 * through one being the cheaper lie. The floor from the street to the anvil is
 * kept clear.
 */
export function buildSmithy(scene: Scene, mats: CelMaterialFactory): Structure {
  const b = new Build(scene, mats, "smithy");
  const w = 9;
  const d = 8;
  const h = 4.4;
  const t = 0.5;

  // ------------------------------------------------------------ the masses
  //
  // Every collider the shell has. See the header before adding to it.
  b.wall(w, h, t, 0, h / 2, d / 2, STONE);
  b.wall(t, h, d, -w / 2, h / 2, 0, STONE);
  b.wall(t, h, d, w / 2, h / 2, 0, STONE);
  // Open front: jambs and a lintel only.
  b.doorWall(w, h, t, 0, h / 2, -d / 2, STONE, 5.0, 3.2);
  // The roof's collider: exactly the slab `gableRoof` laid at the eaves.
  b.block({ w: w + 0.7, h: 0.3, d: d + 0.7, x: 0, y: h, z: 0 });

  // ----------------------------------------------------------- the drawing
  /** The walls' outer faces, and the shop's inner ones. */
  const gx = w / 2 + t / 2;
  const gz = d / 2 + t / 2;
  const ix = w / 2 - t / 2;
  const iz = d / 2 - t / 2;
  /** The floor, which is the plinth's top. */
  const F = 0.2;
  /** Half the opening, and its head. */
  const open = 2.5;
  const head = 3.2;
  /** How far the plinth runs out in front of the opening, as a yard. */
  const apron = 1.0;

  // ---- the plinth, and the walked floor under it: the tavern's collider with
  // no geometry of its own, covering the apron too so the step up from the
  // street is where the stone starts rather than at the threshold.
  b.box(w + 0.9, F, d + 0.9 + apron, 0, F / 2, -apron / 2, DARK_STONE);
  b.block({ w: w + 0.9, h: 1.3, d: d + 0.9 + apron, x: 0, y: F - 0.65, z: -apron / 2 });

  // ---- quoins at the four corners, long and short, standing proud of both
  // faces they turn (which fills the notch the wall colliders leave there);
  // and the opening dressed the same way through the wall's thickness, under
  // an oak lintel that bears on the jambs either side.
  const QN = 12;
  const QH = (h - F) / QN;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      for (let i = 0; i < QN; i++) {
        const [lx, lz] = i % 2 === 0 ? [0.6, 0.37] : [0.35, 0.62];
        b.box(lx, QH, lz, sx * (gx + 0.06 - lx / 2), F + (i + 0.5) * QH, sz * (gz + 0.06 - lz / 2), DARK_STONE);
      }
    }
  }
  const JN = 9;
  const JH = (head - F) / JN;
  for (const sx of [-1, 1]) {
    for (let i = 0; i < JN; i++) {
      const lx = i % 2 === 0 ? 0.55 : 0.32;
      b.box(lx, JH, t + 0.08, sx * (open + lx / 2 - 0.03), F + (i + 0.5) * JH, -d / 2, DARK_STONE);
    }
  }
  b.box(2 * open + 0.9, 0.36, t + 0.1, 0, head + 0.18, -d / 2, TIMBER);

  /** A shoe nailed up points-up, for luck: two heels and the toe between. */
  const horseshoe = (s: Side, plane: number, u: number, y: number): void => {
    for (const k of [-1, 1]) {
      onFace(b, s, plane, u + k * 0.05, y + 0.03, 0.026, 0.09, 0.016, 0.01, IRON);
      onFace(b, s, plane, u + k * 0.037, y - 0.03, 0.05, 0.026, 0.016, 0.01, IRON, k * 0.9);
    }
    onFace(b, s, plane, u, y - 0.047, 0.05, 0.026, 0.016, 0.01, IRON);
  };
  horseshoe("-z", gz, 0, head + 0.5);

  // ---- a small window in each side wall, under a dressed lintel and over a
  // stone sill, as the tavern's stone ends have. The +X one lights the bench;
  // the -X one is beside the forge and carries its glow to the lane.
  const sideWindow = (s: "-x" | "+x", u: number, lit?: string): void => {
    const sill = 1.35;
    const wh = 0.75;
    casement(b, s, gx, u, sill, 0.8, wh, { lit });
    onFace(b, s, gx, u, sill + wh + 0.28, 1.35, 0.26, 0.2, 0.06, DARK_STONE);
    onFace(b, s, gx, u, sill - 0.18, 1.15, 0.12, 0.3, 0.1, DARK_STONE);
    casement(b, s === "+x" ? "-x" : "+x", -ix, u, sill, 0.8, wh);
  };
  sideWindow("+x", 1.4);
  sideWindow("-x", 1.3, SHOPLIT);
  // A high light in the back wall over the coal, and the anchor plates of the
  // tie rods through the side walls at the two trusses.
  casement(b, "+z", gz, 2.4, 1.9, 0.6, 0.6);
  onFace(b, "+z", gz, 2.4, 2.78, 1.15, 0.26, 0.2, 0.06, DARK_STONE);
  onFace(b, "+z", gz, 2.4, 1.72, 0.95, 0.12, 0.3, 0.1, DARK_STONE);
  casement(b, "-z", -iz, 2.4, 1.9, 0.6, 0.6);
  for (const s of ["-x", "+x"] as const) {
    for (const u of [-2.1, 0.9]) {
      for (const kk of [-1, 1]) onFace(b, s, gx, u, h - 0.45, 0.42, 0.06, 0.03, 0.02, IRON, kk * 0.8);
      onFace(b, s, gx, u, h - 0.45, 0.09, 0.09, 0.05, 0.03, IRON);
    }
  }

  // ---- the roof, described by its UNDERSIDE — the tavern's construction with
  // the ridge along Z, so the gables are the street front and the back.
  const k = ROOF_PITCH;
  const pitch = Math.atan(k);
  const cosP = Math.cos(pitch);
  const T = 0.24;
  /** The eave's tip, horizontally from the ridge. */
  const xe = gx + 0.45;
  /** The slate's underside at `x` from the ridge, and its top. */
  const under = (x: number): number => h - 0.02 + (gx - x) * k;
  const topAt = (x: number): number => under(x) + T / cosP;
  const ridgeTop = topAt(0);
  /**
   * A slab in the roof plane on side `sx`: `x0` to `x1` from the ridge, `o0`
   * to `o1` out along the normal from the underside, and `z0` to `z1` along
   * the ridge. Cut PLUMB at both ends, as the tavern's `slope` is.
   */
  const slope = (sx: number, x0: number, x1: number, o0: number, o1: number, z0: number, z1: number, color: string): void => {
    const section = (z: number): Point3[] => [
      [sx * x0, under(x0) + o0 / cosP, z],
      [sx * x1, under(x1) + o0 / cosP, z],
      [sx * x1, under(x1) + o1 / cosP, z],
      [sx * x0, under(x0) + o1 / cosP, z],
    ];
    convexSolid(b, section(z0), section(z1), color);
  };
  for (const sx of [-1, 1]) {
    // Run into the gables, whose parapets stand over the slate's ends.
    slope(sx, 0, xe, 0, T, -d / 2, d / 2, SLATE);
    for (const f of [0.2, 0.37, 0.54, 0.71, 0.87]) {
      const xc = xe * f;
      slope(sx, xc - 0.04, xc + 0.04, T - 0.01, T + 0.035, -iz, iz, IRON);
    }
    // The rafters' feet under the eave, and the fascia on its plumb face.
    for (let z = -iz + 0.3; z < iz; z += 0.6) {
      slope(sx, gx - 0.05, xe - 0.06, -0.15, 0, z - 0.05, z + 0.05, TIMBER);
    }
    b.box(0.05, 0.22, d, sx * (xe + 0.025), under(xe) + 0.07, 0, TIMBER);
  }
  // A stone ridge, laid as a roll.
  b.box(0.3, 0.3, 2 * iz, 0, ridgeTop + 0.02, 0, DARK_STONE, { z: Math.PI / 4 });

  // ---- the gables: the stone carried up past the slate as a parapet, a
  // coping on each rake and a kneeler at each eave, which is what closes the
  // eave's end — and a small louvred vent in the street gable.
  const parapet = 0.1;
  const COPE = 0.16;
  const gTop = (x: number): number => topAt(x) + parapet;
  const kx = gx - 0.35;
  for (const sz of [-1, 1]) {
    const zc = (sz * d) / 2;
    const face = (z: number): Point3[] => [
      [-gx, h - 0.02, z],
      [gx, h - 0.02, z],
      [gx, gTop(gx), z],
      [0, gTop(0), z],
      [-gx, gTop(gx), z],
    ];
    convexSolid(b, face(zc - t / 2), face(zc + t / 2), STONE);
    for (const sx of [-1, 1]) {
      const cope = (z: number): Point3[] => [
        [0, gTop(0), z],
        [sx * (gx - 0.2), gTop(gx - 0.2), z],
        [sx * (gx - 0.2), gTop(gx - 0.2) + COPE / cosP, z],
        [0, gTop(0) + COPE / cosP, z],
      ];
      convexSolid(b, cope(zc - t / 2 - 0.06), cope(zc + t / 2 + 0.06), DARK_STONE);
      const ky0 = h - 0.3;
      const ky1 = gTop(kx) + COPE / cosP;
      b.box(xe + 0.1 - kx, ky1 - ky0, t + 0.14, (sx * (kx + xe + 0.1)) / 2, (ky0 + ky1) / 2, zc, DARK_STONE);
    }
  }
  b.box(0.34, 0.2, t + 0.18, 0, gTop(0) + COPE / cosP + 0.04, -d / 2, DARK_STONE);
  {
    const vy = 5.9;
    onFace(b, "-z", gz, 0, vy, 0.38, 0.6, 0.04, 0.01, CASEMENT);
    onFace(b, "+z", -iz, 0, vy, 0.38, 0.6, 0.04, 0.01, CASEMENT);
    for (let i = 0; i < 4; i++) onFace(b, "-z", gz, 0, vy - 0.22 + i * 0.15, 0.38, 0.05, 0.06, 0.03, TIMBER);
    for (const kk of [-1, 1]) onFace(b, "-z", gz, kk * 0.26, vy, 0.14, 0.6, 0.14, 0.05, DARK_STONE);
    onFace(b, "-z", gz, 0, vy + 0.4, 0.72, 0.2, 0.16, 0.06, DARK_STONE);
    onFace(b, "-z", gz, 0, vy - 0.36, 0.62, 0.12, 0.22, 0.08, DARK_STONE);
  }

  // ---- the louvre on the ridge: a dark throat behind four slats a side,
  // boarded ends, and a gabled cap of its own.
  {
    const lz = -1.6;
    const half = 0.55;
    const ld = 1.2;
    const y0 = under(half) - 0.05;
    const y1 = ridgeTop + 0.55;
    b.box(2 * half, y1 - y0, ld, 0, (y0 + y1) / 2, lz, CASEMENT);
    for (const sz of [-1, 1]) {
      b.box(2 * half + 0.02, y1 - y0, 0.05, 0, (y0 + y1) / 2, lz + (sz * ld) / 2, PLANK);
    }
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) b.box(0.1, y1 - y0, 0.1, sx * (half - 0.03), (y0 + y1) / 2, lz + sz * (ld / 2 - 0.03), TIMBER);
      for (let i = 0; i < 4; i++) {
        b.box(0.16, 0.03, ld - 0.12, sx * (half + 0.01), topAt(half) + 0.14 + i * 0.16, lz, TIMBER, { z: -sx * 0.6 });
      }
    }
    const kl = 0.75;
    const cL = Math.cos(Math.atan(kl));
    const reach = half + 0.2;
    const capUnder = (x: number): number => y1 + (half - x) * kl;
    for (const sx of [-1, 1]) {
      const sec = (z: number): Point3[] => [
        [0, capUnder(0), z],
        [sx * reach, capUnder(reach), z],
        [sx * reach, capUnder(reach) + 0.1 / cL, z],
        [0, capUnder(0) + 0.1 / cL, z],
      ];
      convexSolid(b, sec(lz - ld / 2 - 0.15), sec(lz + ld / 2 + 0.15), SLATE);
    }
    for (const sz of [-1, 1]) b.gableEnd(2 * half, half * kl, 0.05, 0, y1, lz + (sz * ld) / 2, PLANK);
  }

  // ---- the pentice over the opening: bearers braced off the jambs, a plate
  // across their ends, rafters from a ledger on the gable, and slate.
  {
    const pz = (r: number): number => -(gz + r);
    const fall = 0.25;
    const pa = Math.atan(fall);
    const cosA = Math.cos(pa);
    /** The rafters' underside, `r` out from the wall. */
    const yu = (r: number): number => 4.25 - fall * r;
    const reach = 1.55;
    const plate = 1.3;
    b.box(6.8, 0.2, 0.14, 0, yu(0) - 0.1, pz(0.07), TIMBER);
    b.box(6.6, 0.18, 0.16, 0, yu(plate) - 0.09, pz(plate), TIMBER);
    const by = yu(plate) - 0.28;
    for (const kk of [-1, 1]) {
      b.box(0.16, 0.2, plate + 0.1, kk * 3.0, by, pz((plate + 0.1) / 2), TIMBER);
      offFace(b, "-z", gz, kk * 3.0, 0.12, 2.85, by - 0.1, 0.02, 0.8, 0.14, TIMBER);
    }
    for (let i = 0; i <= 10; i++) {
      const x = -3.2 + i * 0.64;
      b.box(0.1, 0.14, reach / cosA, x, yu(reach / 2) + 0.07 / cosA, pz(reach / 2), TIMBER, { x: -pa });
    }
    b.box(6.9, 0.08, reach / cosA, 0, yu(reach / 2) + 0.18 / cosA, pz(reach / 2), SLATE, { x: -pa });
    b.box(7.0, 0.18, 0.05, 0, yu(reach) + 0.12, pz(reach + 0.02), TIMBER);
    for (const kk of [-1, 1]) {
      b.box(0.05, 0.18, reach / cosA, kk * 3.47, yu(reach / 2) + 0.12 / cosA, pz(reach / 2), TIMBER, { x: -pa });
    }
  }

  // ---- overhead: wall plates, two trusses (a tie beam, a king post and two
  // struts to the purlins), a ridge beam and the rafters — what a player looks
  // up at, since the shop has no ceiling.
  const flueY = 3.3;
  const flueZ0 = 3.0;
  for (const sx of [-1, 1]) {
    b.box(0.22, 0.22, 2 * iz, sx * (ix - 0.11), h - 0.13, 0, TIMBER);
    slope(sx, 2.2, 2.45, -0.4, -0.15, -iz, iz, TIMBER);
    for (let z = -iz + 0.3; z < iz - 0.1; z += 0.6) {
      slope(sx, z > flueZ0 - 0.1 ? 0.66 : 0.09, gx - 0.05, -0.15, 0, z - 0.04, z + 0.04, TIMBER);
    }
  }
  b.box(0.18, 0.28, flueZ0 + iz, 0, under(0) - 0.14, (flueZ0 - iz) / 2, TIMBER);
  for (const z of [-2.1, 0.9]) {
    b.box(2 * ix, 0.28, 0.24, 0, h - 0.16, z, TIMBER);
    const kpTop = under(0) - 0.28;
    b.box(0.2, kpTop - h, 0.2, 0, (kpTop + h) / 2, z, TIMBER);
    const y0 = h + 0.25;
    const y1 = under(2.3) - 0.4;
    const dx = 2.2;
    const ang = Math.atan2(y1 - y0, dx);
    for (const sx of [-1, 1]) {
      b.box(Math.hypot(dx, y1 - y0), 0.14, 0.14, sx * (0.1 + dx / 2), (y0 + y1) / 2, z, TIMBER, { z: sx * ang });
    }
  }

  // ------------------------------------------------------------- the forge
  //
  // The hearth at working height against the back wall: brick, an ash pit
  // under the fire, a coped rim round a bed of coal with the fire IN it, a
  // fireback, and a tuyere from the bellows. One collider for the whole of it.
  const Hh = F + 0.72;
  const hz0 = 2.45;
  const hzc = (hz0 + iz) / 2;
  const hd = iz - hz0;
  const fz = 3.1;
  b.block({ w: 2.2, h: Hh + 0.1, d: hd, x: 0, y: (Hh + 0.1) / 2, z: hzc });
  {
    const pit0 = -0.9;
    const pit1 = -0.2;
    const pitH = 0.42;
    const pitC = (pit0 + pit1) / 2;
    const pitW = pit1 - pit0;
    b.box(1.1 + pit0, Hh - F, hd, (-1.1 + pit0) / 2, (F + Hh) / 2, hzc, BRICK);
    b.box(1.1 - pit1, Hh - F, hd, (1.1 + pit1) / 2, (F + Hh) / 2, hzc, BRICK);
    b.box(pitW, Hh - F - pitH, hd, pitC, (F + pitH + Hh) / 2, hzc, BRICK);
    b.box(pitW, pitH, iz - 3.0, pitC, F + pitH / 2, (3.0 + iz) / 2, SLAG);
    b.box(pitW + 0.12, 0.06, 0.05, pitC, F + pitH + 0.03, hz0 - 0.02, IRON);
    b.cyl(0.14, 0.12, 0.5, 7, pitC, F + 0.07, 2.8, SLAG);
  }
  b.box(2.3, 0.1, 0.2, 0, Hh + 0.05, hz0 + 0.05, DARK_STONE);
  for (const sx of [-1, 1]) b.box(0.2, 0.1, hd, sx * 1.05, Hh + 0.05, hzc, DARK_STONE);
  b.box(1.9, 0.05, hd - 0.15, 0, Hh + 0.025, hzc + 0.07, SLAG);
  // The coals sit *on* the forge bed rather than on its face: a glow plate
  // hung off the front reads as a floating light box from the street. The
  // flame is what stops the bed reading as a lamp, and the lumps banked round
  // the glow are what make it a fire in a heap rather than a plate on a box.
  b.glow(0.6, 0.06, 0.45, 0, Hh + 0.05, fz, EMBER);
  for (const [x, z, s, r] of [
    [-0.36, 3.0, 0.18, 0.4],
    [0.37, 3.2, 0.16, 1.1],
    [0.05, 3.4, 0.2, 0.7],
    [-0.2, 2.82, 0.14, 1.4],
    [0.28, 2.86, 0.15, 0.2],
  ] as const) {
    b.box(s, s * 0.6, s, x, Hh + 0.05, z, SLAG, { y: r });
  }
  b.flame(0.18, 0.42, 0, Hh + 0.06, fz, 3);
  b.box(0.9, 0.55, 0.05, 0, Hh + 0.3, iz - 0.03, IRON);
  // A bar left in the fire, its end out over the rim.
  b.box(1.0, 0.03, 0.03, 0.4, Hh + 0.12, 2.8, IRON, { y: 0.55 });
  // The tuyere, from the bellows' nozzle through the rim into the fire.
  const tuyY = Hh + 0.07;
  b.cyl(0.75, 0.08, 0.08, 8, -0.725, tuyY, fz, IRON, { z: Math.PI / 2 });
  // Tongs on a rail along the hearth's face.
  b.box(0.85, 0.03, 0.03, -0.62, Hh - 0.08, hz0 - 0.03, IRON);
  for (const x of [-0.95, -0.7, -0.45]) {
    for (const kk of [-1, 1]) b.box(0.02, 0.5, 0.02, x + kk * 0.02, Hh - 0.35, hz0 - 0.05, IRON, { z: kk * 0.05 });
    b.box(0.06, 0.08, 0.025, x, Hh - 0.62, hz0 - 0.05, IRON);
  }
  b.light(EMBER, 20, 2.3, 0.45, 0, 1.9, 1.6);
  b.sound("fire", 0, Hh + 0.3, fz);

  // The slake trough on the hearth's face: a stone trough of dark water.
  {
    const tx = 0.675;
    const tz = 2.225;
    const top = Hh - 0.05;
    b.block({ w: 0.85, h: top, d: 0.45, x: tx, y: top / 2, z: tz });
    b.box(0.85, 0.72 - F, 0.45, tx, (F + 0.72) / 2, tz, DARK_STONE);
    for (const kk of [-1, 1]) {
      b.box(0.85, top - 0.72, 0.1, tx, (top + 0.72) / 2, tz + kk * 0.175, DARK_STONE);
      b.box(0.1, top - 0.72, 0.25, tx + kk * 0.375, (top + 0.72) / 2, tz, DARK_STONE);
    }
    b.box(0.65, 0.02, 0.25, tx, 0.78, tz, CASEMENT);
  }

  // The hood: brick, gathering from over the hearth into the flue, with an
  // iron lip round its open sides. The flue carries on up as the stack, out of
  // the back gable's apex, with a band, a cap and a pot.
  {
    const hoodY = 2.05;
    const rect = (y: number, half: number, z0: number): Point3[] => [
      [-half, y, z0],
      [half, y, z0],
      [half, y, iz],
      [-half, y, iz],
    ];
    convexSolid(b, rect(hoodY, 1.2, hz0 - 0.15), rect(flueY, 0.6, flueZ0), BRICK);
    // Its mouth, seen from under it, is soot rather than a ceiling.
    b.box(2.38, 0.02, iz - hz0 + 0.14, 0, hoodY - 0.01, (iz + hz0 - 0.15) / 2, SLAG);
    b.box(2.44, 0.1, 0.04, 0, hoodY + 0.05, hz0 - 0.17, IRON);
    for (const sx of [-1, 1]) b.box(0.04, 0.1, iz - hz0 + 0.17, sx * 1.21, hoodY + 0.05, (iz + hz0 - 0.17) / 2, IRON);
  }
  const stackTop = gTop(0) + COPE / cosP + 1.1;
  const sz = (flueZ0 + gz - 0.05) / 2;
  const sd = gz - 0.05 - flueZ0;
  // Brick in the shop, where the smoke is, and the gable's stone above it.
  const roofAt = under(0.6);
  b.box(1.2, roofAt + 0.3 - flueY, sd, 0, (flueY + roofAt + 0.3) / 2, sz, BRICK);
  b.box(1.2, stackTop - roofAt, sd, 0, (roofAt + stackTop) / 2, sz, STONE);
  b.box(1.32, 0.12, sd + 0.12, 0, stackTop - 0.45, sz, DARK_STONE);
  b.box(1.42, 0.18, sd + 0.22, 0, stackTop + 0.09, sz, DARK_STONE);
  b.cyl(0.42, 0.36, 0.44, 8, 0, stackTop + 0.39, sz, CITY_BRICK);

  // The great bellows on a trestle to the forge's left: a pear-shaped board
  // top, middle and bottom with leather between, a nozzle into the tuyere, and
  // a rocking pole off a bracket on the back wall to work them from the hearth.
  {
    const zc = 3.05;
    /** Nozzle to butt: narrow where it meets the tuyere, broad at the back. */
    const OUTLINE: [number, number][] = [
      [-1.5, -0.08],
      [-2.1, -0.3],
      [-2.8, -0.42],
      [-3.35, -0.36],
      [-3.6, -0.16],
      [-3.6, 0.16],
      [-3.35, 0.36],
      [-2.8, 0.42],
      [-2.1, 0.3],
      [-1.5, 0.08],
    ];
    /**
     * The boards are hinged at the nozzle and open toward the butt, so each
     * face is a plane rising (or falling) along the bellows: `lo`/`hi` are the
     * heights at the nozzle and at the butt. The leather between is inset so
     * the boards read as edges on it.
     */
    const along = (x: number): number => (x + 1.5) / -2.1;
    const layer = (lo0: number, lo1: number, hi0: number, hi1: number, inset: number, color: string): void => {
      const at = (y0: number, y1: number): Point3[] =>
        OUTLINE.map(([x, z]): Point3 => {
          const xi = -2.5 + (x + 2.5) * (1 - inset);
          return [xi, y0 + (y1 - y0) * along(xi), zc + z * (1 - inset * 2)];
        });
      convexSolid(b, at(lo0, lo1), at(hi0, hi1), color);
    };
    const bot = (x: number): number => tuyY - 0.06 - 0.26 * along(x);
    const top = (x: number): number => tuyY + 0.06 + 0.36 * along(x);
    layer(tuyY - 0.11, tuyY - 0.37, tuyY - 0.06, tuyY - 0.32, 0, PLANK);
    layer(tuyY - 0.06, tuyY - 0.32, tuyY - 0.03, tuyY - 0.03, 0.05, PITCH);
    layer(tuyY - 0.03, tuyY - 0.03, tuyY + 0.03, tuyY + 0.03, 0, PLANK);
    layer(tuyY + 0.03, tuyY + 0.03, tuyY + 0.06, tuyY + 0.42, 0.05, PITCH);
    layer(tuyY + 0.06, tuyY + 0.42, tuyY + 0.11, tuyY + 0.47, 0, PLANK);
    b.cyl(0.45, 0.06, 0.14, 8, -1.325, tuyY, zc, IRON, { z: -Math.PI / 2 });
    // The trestle the middle board is fixed to.
    for (const x of [-2.0, -3.0]) {
      const y = bot(x) - 0.06;
      for (const kk of [-1, 1]) b.box(0.08, y - F, 0.08, x, (F + y) / 2, zc + kk * 0.3, TIMBER);
      b.box(0.1, 0.08, 0.72, x, y - 0.04, zc, TIMBER);
    }
    b.box(0.12, 0.14, iz - zc + 0.05, -2.5, 2.32, (iz + zc) / 2, TIMBER);
    const poleY = 2.2;
    const tilt = 0.05;
    b.box(2.4, 0.1, 0.1, -2.55, poleY, zc, TIMBER, { z: tilt });
    const poleAt = (x: number): number => poleY + (x + 2.55) * tilt;
    const lift = top(-3.3) + 0.05;
    b.box(0.025, poleAt(-3.3) - lift, 0.025, -3.3, (poleAt(-3.3) + lift) / 2, zc, IRON);
    b.box(0.025, poleAt(-1.45) - 1.62, 0.025, -1.45, (poleAt(-1.45) + 1.62) / 2, zc, IRON);
    b.cyl(0.3, 0.05, 0.05, 6, -1.45, 1.6, zc, TIMBER, { x: Math.PI / 2 });
  }

  // The coal bunker on its right: two low brick walls with the hearth for a
  // third, a heap of coal banked against the back wall, and a shovel.
  {
    const x0 = 1.1;
    const x1 = 2.7;
    const z0 = 2.6;
    b.box(x1 - x0, 0.5, 0.14, (x0 + x1) / 2, F + 0.25, z0 + 0.07, BRICK);
    b.box(0.14, 0.5, iz - z0, x1 - 0.07, F + 0.25, (z0 + iz) / 2, BRICK);
    b.box(x1 - x0 + 0.04, 0.06, 0.18, (x0 + x1) / 2, F + 0.53, z0 + 0.07, DARK_STONE);
    b.box(0.18, 0.06, iz - z0, x1 - 0.07, F + 0.53, (z0 + iz) / 2, DARK_STONE);
    b.cyl(0.5, 0.35, 1.3, 7, 1.9, F + 0.25, 3.25, SLAG);
    for (const [x, y, z, s] of [
      [1.45, 0.42, 2.95, 0.18],
      [2.3, 0.36, 2.92, 0.16],
      [1.85, 0.5, 3.35, 0.2],
      [2.12, 0.3, 2.85, 0.14],
    ] as const) {
      b.box(s, s * 0.7, s, x, F + y, z, SLAG, { y: s * 7, x: 0.3 });
    }
    b.cyl(1.1, 0.035, 0.035, 6, 2.35, F + 0.55, z0 - 0.12, TIMBER, { x: 0.3 });
    b.box(0.22, 0.26, 0.02, 2.35, F + 0.13, z0 - 0.27, IRON, { x: 0.3 });
  }

  // ------------------------------------------------------------ the trade
  //
  // The anvil on its stump, horn to the left: a real one's size, which is
  // knee to waist rather than a chest on a barrel.
  {
    const ax = -0.4;
    const az = 0.7;
    const top = F + 0.45;
    b.block({ w: 1.0, h: F + 0.8, d: 0.72, x: ax - 0.08, y: (F + 0.8) / 2, z: az });
    b.cyl(0.45, 0.62, 0.7, 10, ax, F + 0.225, az, TIMBER);
    b.cyl(0.05, 0.69, 0.69, 10, ax, F + 0.3, az, IRON);
    b.box(0.5, 0.08, 0.32, ax, top + 0.04, az, IRON);
    b.box(0.3, 0.12, 0.17, ax, top + 0.14, az, IRON);
    b.box(0.54, 0.14, 0.16, ax + 0.03, top + 0.27, az, IRON);
    b.box(0.12, 0.1, 0.13, ax + 0.36, top + 0.29, az, IRON);
    b.cyl(0.32, 0.02, 0.14, 8, ax - 0.4, top + 0.26, az, IRON, { z: Math.PI / 2 });
    // A hammer left on the face.
    b.cyl(0.36, 0.035, 0.03, 6, ax + 0.12, top + 0.36, az - 0.1, TIMBER, { x: Math.PI / 2 });
    b.box(0.13, 0.045, 0.045, ax + 0.12, top + 0.365, az + 0.1, IRON);
  }
  // A cone mandrel for truing rings, standing between it and the bellows.
  b.cyl(1.0, 0.03, 0.26, 10, -1.5, F + 0.5, 1.75, IRON);

  // The slack tub, hooped, full of dark water.
  {
    const tx = 0.75;
    const tz = 0.25;
    b.block({ w: 0.75, h: F + 0.6, d: 0.75, x: tx, y: (F + 0.6) / 2, z: tz });
    b.cyl(0.6, 0.72, 0.62, 10, tx, F + 0.3, tz, PLANK);
    b.cyl(0.05, 0.66, 0.66, 10, tx, F + 0.12, tz, IRON);
    b.cyl(0.05, 0.73, 0.73, 10, tx, F + 0.5, tz, IRON);
    b.cyl(0.02, 0.62, 0.62, 10, tx, F + 0.61, tz, CASEMENT);
  }

  // The bench under the +X window, with a leg vice on its front edge, and the
  // tools hung on a rail over it.
  {
    const bx = ix - 0.36;
    const bz = 0.8;
    const bl = 2.8;
    const top = F + 0.86;
    b.block({ w: 0.72, h: top, d: bl, x: bx, y: top / 2, z: bz });
    b.box(0.72, 0.08, bl, bx, top - 0.04, bz, PLANK);
    for (const kx2 of [-1, 1]) {
      for (const kz of [-1, 1]) b.box(0.1, top - F - 0.08, 0.1, bx + kx2 * 0.26, (F + top - 0.08) / 2, bz + kz * (bl / 2 - 0.12), TIMBER);
    }
    b.box(0.6, 0.05, bl - 0.2, bx, F + 0.22, bz, PLANK);
    b.box(0.06, 0.12, bl - 0.1, bx - 0.3, top - 0.14, bz, TIMBER);
    const vx = bx - 0.4;
    const vz = bz - 0.9;
    b.box(0.07, top + 0.1 - F, 0.09, vx, (F + top + 0.1) / 2, vz, IRON);
    b.box(0.12, 0.16, 0.14, vx + 0.04, top + 0.08, vz, IRON);
    b.cyl(0.4, 0.03, 0.03, 6, vx - 0.08, top + 0.02, vz, IRON, { x: Math.PI / 2 });
    // Things left on it: a box of nails, a file, two shoes.
    b.box(0.3, 0.1, 0.2, bx + 0.1, top + 0.05, bz + 0.5, PLANK);
    b.box(0.03, 0.02, 0.32, bx - 0.1, top + 0.01, bz - 0.2, IRON, { y: 0.3 });
    for (const z of [bz + 0.05, bz + 0.2]) b.box(0.12, 0.02, 0.13, bx - 0.05, top + 0.01, z, IRON);

    onFace(b, "-x", -ix, 0, 1.9, 1.2, 0.08, 0.06, 0.03, TIMBER);
    for (const [u, tongs] of [
      [-0.45, true],
      [-0.15, false],
      [0.15, true],
      [0.45, false],
    ] as const) {
      if (tongs) {
        for (const kk of [-1, 1]) onFace(b, "-x", -ix, u + kk * 0.02, 1.58, 0.02, 0.6, 0.02, 0.06, IRON, kk * 0.04);
        onFace(b, "-x", -ix, u, 1.26, 0.06, 0.07, 0.03, 0.06, IRON);
      } else {
        onFace(b, "-x", -ix, u, 1.8, 0.14, 0.05, 0.05, 0.08, IRON);
        onFace(b, "-x", -ix, u, 1.6, 0.035, 0.36, 0.035, 0.08, TIMBER);
      }
    }
  }

  // Shoes on a rail on the -X wall, and bar stock racked on pegs beyond them,
  // with the long lengths stood in the corner.
  onFace(b, "+x", -ix, -0.45, 1.8, 1.5, 0.07, 0.05, 0.025, TIMBER);
  for (let i = 0; i < 6; i++) horseshoe("+x", -ix, -1.05 + i * 0.24, 1.66);
  for (const y of [1.0, 1.5]) {
    for (const u of [-3.2, -1.9]) offFace(b, "+x", -ix, u, 0.06, y, y + 0.03, 0, 0.34, 0.06, TIMBER);
    for (const [j, s] of [0.05, 0.03, 0.04].entries()) {
      b.box(s, s, 1.9, -ix + 0.1 + j * 0.09, y + 0.06 + s / 2, -2.55, IRON);
    }
  }
  for (let i = 0; i < 3; i++) {
    b.box(0.035, 2.1, 0.035, -ix + 0.15 + i * 0.05, F + 1.05, -iz + 0.2 + i * 0.07, IRON, { z: 0.05 });
  }

  // Outside: a grindstone on the yard beside the opening, its wheel turned to
  // the lane and standing in its trough, and a cartwheel stood against the +X
  // wall waiting for its tyre to be set.
  {
    const x = -3.6;
    const z = -(gz + 0.62);
    const ay = F + 0.66;
    // The trough is what the lower half of the stone turns in, and is most of
    // what makes this a grindstone rather than a disc on a stool.
    b.box(0.38, 0.36, 1.0, x, F + 0.38, z, PLANK);
    b.box(0.3, 0.02, 0.9, x, F + 0.55, z, CASEMENT);
    for (const kk of [-1, 1]) {
      const rx = x + kk * 0.24;
      b.box(0.1, 0.12, 1.3, rx, F + 0.5, z, TIMBER);
      for (const j of [-1, 1]) b.box(0.1, 0.44, 0.1, rx, F + 0.22, z + j * 0.55, TIMBER);
      b.box(0.1, ay - F - 0.5, 0.14, rx, (ay + F + 0.5) / 2, z, TIMBER);
    }
    b.cyl(0.14, 1.0, 1.0, 16, x, ay, z, STONE, { z: Math.PI / 2 });
    b.cyl(0.7, 0.05, 0.05, 6, x, ay, z, IRON, { z: Math.PI / 2 });
    b.box(0.04, 0.26, 0.04, x + 0.35, ay - 0.11, z, IRON);
    b.cyl(0.16, 0.04, 0.04, 6, x + 0.43, ay - 0.23, z, TIMBER, { z: Math.PI / 2 });
  }
  {
    const xw = gx + 0.13;
    const cz = -2.3;
    const R = 0.6;
    const cy = F + 0.68;
    b.cyl(0.26, 0.2, 0.2, 10, xw, cy, cz, TIMBER, { z: Math.PI / 2 });
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6;
      b.box(0.07, 0.09, 0.34, xw, cy + R * Math.cos(a), cz + R * Math.sin(a), TIMBER, { x: a });
      b.box(0.08, 0.025, 0.36, xw, cy + (R + 0.057) * Math.cos(a), cz + (R + 0.057) * Math.sin(a), IRON, { x: a });
    }
    for (let i = 0; i < 10; i++) {
      const a = (i * Math.PI) / 5 + 0.3;
      const r = R / 2 + 0.03;
      b.box(0.045, R - 0.12, 0.045, xw, cy + r * Math.cos(a), cz + r * Math.sin(a), TIMBER, { x: a });
    }
  }
  return b;
}
