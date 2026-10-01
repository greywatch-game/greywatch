/**
 * kit/buildings/tavern.ts — buildTavern: the coaching inn, floored and
 * furnished.
 * Part of the buildings set: follows the contract in kit/core.ts; the set's
 * files are listed in `./index.ts`.
 */
import { Scene } from "@babylonjs/core";
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import {
  Build,
  type Point3,
  type Structure,
  carve,
  convexSolid,
  onFace,
  runsAlongX,
  type Hole,
  type Side,
  CASEMENT,
  BRICK,
  CITY_BRICK,
  DARK_STONE,
  EMBER,
  FLAME,
  IRON,
  PLANK,
  PLASTER,
  SLATE,
  STONE,
  TEAK,
  TIMBER,
  VERDIGRIS,
} from "../core";
import { LAMPLIT, SHOPLIT, offFace, casement, doorway, framing, ROOF_PITCH } from "./village";

/**
 * The tavern: the biggest house in the village and the only one with its
 * lights still on. Stone gable walls and a framed front and back, a jettied
 * upper storey, a slate roof with dormers in it and a stack at each end, a
 * porch on the -Z face and a sign on an iron bracket. Always enterable — a
 * taproom you can brawl in is the whole point.
 *
 * **The shell's colliders are the ones it has always had, in the order it has
 * always emitted them**, and the roof's is still the flat slab `gableRoof` laid
 * at the eaves — stated by hand now, because the roof drawn over it is this
 * builder's own. Everything on the ELEVATIONS is drawing, in the townhouse's
 * words (`onFace`, `casement`, `doorway`, `framing`) and under its rule: the
 * masses carry the colliders and a window frame never does.
 *
 * **What was wrong was that it read as a barn with a porch.** A shallow board
 * roof in thatch colour with its gable to the street, plaster from end to end,
 * six glowing rectangles with no frame, a lit sign that was the brightest
 * thing on it, and two chimney stacks standing INSIDE the taproom as columns
 * you walked through, with no hearth under either. It is now the things a
 * coaching inn is recognised by:
 *
 * - **The ridge runs along the frontage**, so the street sees an eave line
 *   broken by two dormers rather than a gable, and the gables are the ±X ends
 *   — which is where the stone walls already were, so each stack now rises
 *   off a stone end over a hearth. The pitch is `ROOF_PITCH`, steep enough for
 *   slate and a roof taller than the one it replaced; a round through it above
 *   the eaves slab passes, as the cottage's and the townhouse's do.
 * - **The stone ends turn the corner in quoins**, and the framed front and
 *   back run between them: a sole plate, posts stopped at every opening, and
 *   the jetty's joist ends and corner brackets above. Close studding on the
 *   upper front, square panels everywhere else.
 * - **The porch is built rather than propped**: posts on padstones, a beam and
 *   two ties braced into them, rafters under a slate lean-to that tucks under
 *   the jetty, a bench either side of the door and a lantern on a chain, which
 *   is where the porch's light now comes from. The sign is a board on an iron
 *   bracket, hung edge-on to the street and LIT BY NOTHING — a crescent in
 *   gilt on green, one palette slot.
 *
 * **The taproom is FLOORED and FURNISHED, and both are solid.** Eight
 * colliders, emitted after the shell's so its prefix of the collision bake is
 * unchanged: the walked floor under the boards, a hearth at each end (one
 * block for the breast, as `fireplace` in the manor argues — the firebox is a
 * hollow nothing can stand in), the counter and the back bar on the +X side of
 * the yard door, and three trestle tables. Every
 * height is the city's argument about furniture as COVER: the counter and the
 * tables are under `CoverMap`'s lines and read as soft, the back bar and the
 * breasts are over them and read as hard, and the benches are visual because
 * walking through one is the cheaper lie. The aisle from the street door to
 * the yard door is kept clear, so the room still plays as a crossing. Each
 * hearth has its fire, its light and its crackle — what is drawn as burning is
 * heard burning.
 */

export function buildTavern(scene: Scene, mats: CelMaterialFactory): Structure {
  const b = new Build(scene, mats, "tavern");
  const w = 13;
  const d = 10;
  const g = 3.6;
  const up = 3.4;
  const h = g + up;
  const t = 0.4;
  const jut = 0.5;
  const eaves = 0.5;

  // ------------------------------------------------------------ the masses
  //
  // Every collider the shell has. See the header before adding to it.
  //
  // Boards stand PROUD of the plinth they are laid on. Flush tops (both at
  // 0.3) put 130 m2 of taproom floor and stone footing on one plane, and the
  // two are different colours so they merge into different meshes — the depth
  // test is then a tie the draw order breaks arbitrarily, per pixel, and the
  // floor flickers as you walk. The 0.04 is the board thickness showing.
  b.box(w + 0.6, 0.3, d + 0.6, 0, 0.15, 0, DARK_STONE);
  b.box(w, 0.2, d, 0, 0.24, 0, PLANK);
  b.doorWall(w, g, t, 0, g / 2, -d / 2, PLASTER, 2.2, 2.6);
  b.doorWall(w, g, t, 0, g / 2, d / 2, PLASTER, 1.8, 2.3); // yard door
  b.wall(t, g, d, -w / 2, g / 2, 0, STONE);
  b.wall(t, g, d, w / 2, g / 2, 0, STONE);
  b.wall(w + jut * 2, up, d + jut * 2, 0, g + up / 2, 0, PLASTER);
  // The bressumer: the beam the oversailing storey stands on.
  b.box(w + jut * 2 + 0.2, 0.36, d + jut * 2 + 0.2, 0, g + 0.18, 0, TIMBER);
  // The roof's collider: exactly the slab `gableRoof` laid at the eaves when
  // it drew this roof, so the bake cannot tell the drawing moved.
  b.block({ w: w + jut * 2 + eaves * 2, h: 0.3, d: d + jut * 2 + eaves * 2, x: 0, y: h, z: 0 });

  // ----------------------------------------------------------- the drawing
  /** The ground storey's faces: stone ends at `gx`, framed front and back at `gz`. */
  const gx = w / 2 + t / 2;
  const gz = d / 2 + t / 2;
  /** The jettied storey's faces. */
  const ux = w / 2 + jut;
  const uz = d / 2 + jut;
  /** The taproom's inner faces, and its floor. */
  const ix = w / 2 - t / 2;
  const iz = d / 2 - t / 2;
  const F = 0.34;
  const gPlane = (s: Side): number => (runsAlongX(s) ? gz : gx);
  const uPlane = (s: Side): number => (runsAlongX(s) ? uz : ux);
  const uHalf = (s: Side): number => (runsAlongX(s) ? ux : uz);
  const SIDES: Side[] = ["-z", "+z", "-x", "+x"];
  /** How far the framed front and back run, between the quoins. */
  const frameHalf = gx - 0.55;
  const sole = 0.5;
  const gTop = g - 0.44;
  const uFoot = g + 0.36;
  const uSill = uFoot + 0.75;
  const uWin = 1.2;
  const uRail = uSill - 0.2;
  const uTop = h - 0.28;
  const front = "-z" as const;
  const back = "+z" as const;

  // ---- the stone ends turn each corner in quoins, laid long and short so the
  // edge reads as dressed stone against the rubble and the plaster. Laid from
  // the plinth to the jetty, and standing 0.07 proud of both faces they turn,
  // which fills the corner the two wall colliders leave between them.
  const QH = 0.33;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      for (let i = 0; i < 10; i++) {
        const [lx, lz] = i % 2 === 0 ? [0.6, 0.37] : [0.35, 0.65];
        b.box(lx, QH, lz, sx * (gx + 0.07 - lx / 2), 0.3 + (i + 0.5) * QH, sz * (gz + 0.07 - lz / 2), DARK_STONE);
      }
    }
  }

  // ---- the ground storey's front and back: framed between the quoins, with a
  // sole plate cut at each doorway (the townhouse's note on a beam across a
  // threshold), a top plate, and an end post against each quoin.
  const doorHoles: Record<"-z" | "+z", Hole> = {
    "-z": doorway(b, front, gz, d / 2 + 0.3, 0, 2.2, 2.3, null),
    "+z": doorway(b, back, gz, d / 2 + 0.3, 0, 1.8, 2.0, null),
  };
  const groundHoles: Record<"-z" | "+z", Hole[]> = {
    "-z": [
      doorHoles["-z"],
      ...[-1, 1].map((k) => casement(b, front, gz, k * 4.8, 0.95, 1.6, 1.35, { lit: SHOPLIT, lights: 3 })),
    ],
    "+z": [
      doorHoles["+z"],
      casement(b, back, gz, -4.0, 1.0, 1.1, 1.2, { lit: LAMPLIT }),
      casement(b, back, gz, 4.0, 1.0, 1.1, 1.2),
    ],
  };
  for (const s of [front, back] as const) {
    onFace(b, s, gz, 0, g - 0.31, 2 * frameHalf + 0.1, 0.26, 0.16, 0.04, TIMBER);
    for (const k of [-1, 1]) {
      onFace(b, s, gz, k * (frameHalf - 0.11), (sole + gTop) / 2, 0.22, gTop - sole, 0.16, 0.04, TIMBER);
    }
    framing(b, s, gz, frameHalf, sole, gTop, null, groundHoles[s], "panel");
    const cut: [number, number] = [doorHoles[s].u0, doorHoles[s].u1];
    for (const [a, c] of carve(-frameHalf, frameHalf, [cut])) {
      onFace(b, s, gz, (a + c) / 2, (0.3 + sole) / 2, c - a, sole - 0.3, 0.16, 0.04, TIMBER);
    }
  }

  // ---- the stone ends: two lights each, either side of the hearth inside,
  // under a dressed lintel and over a stone sill.
  for (const s of ["-x", "+x"] as const) {
    for (const u of [-3.3, 3.3]) {
      const sill = 1.05;
      const wh = 1.05;
      casement(b, s, gx, u, sill, 0.8, wh, { lit: LAMPLIT });
      onFace(b, s, gx, u, sill + wh + 0.3, 1.5, 0.26, 0.2, 0.06, DARK_STONE);
      onFace(b, s, gx, u, sill - 0.18, 1.3, 0.12, 0.3, 0.1, DARK_STONE);
    }
  }

  // ---- under the jetty, on all four faces: the joists' ends where the floor
  // runs out past the wall, and a bracket at each end of every face.
  for (const s of SIDES) {
    const half = (runsAlongX(s) ? gx : gz) - 0.45;
    const len = uPlane(s) - gPlane(s);
    const n = Math.max(2, Math.round((2 * half) / 0.55));
    for (let i = 0; i <= n; i++) {
      onFace(b, s, gPlane(s), -half + (i * 2 * half) / n, g - 0.09, 0.15, 0.18, len, len / 2, TIMBER);
    }
    for (const k of [-1, 1]) {
      offFace(b, s, gPlane(s), k * (half + 0.2), 0.16, g - 0.95, g - 0.18, 0.08, len - 0.03, 0.16, TIMBER);
    }
  }

  // ---- the jettied storey: a head plate all round, a post at each corner,
  // close studding on the street front and square panels on the rest.
  for (const s of SIDES) {
    onFace(b, s, uPlane(s), 0, h - 0.14, 2 * uHalf(s) + 0.2, 0.28, 0.18, 0.05, TIMBER);
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.box(0.3, uTop - uFoot, 0.3, sx * (ux - 0.05), (uFoot + uTop) / 2, sz * (uz - 0.05), TIMBER);
    }
  }
  const upperWindows: Record<Side, [number, boolean][]> = {
    "-z": [[-4.9, false], [-1.8, true], [1.8, true], [4.9, true]],
    "+z": [[-4.4, false], [0, true], [4.4, false]],
    "-x": [[-2.9, false], [2.9, true]],
    "+x": [[-2.9, true], [2.9, false]],
  };
  for (const s of SIDES) {
    const holes = upperWindows[s].map(([u, on]) =>
      casement(b, s, uPlane(s), u, uSill, runsAlongX(s) ? 1.15 : 1.0, uWin, { lit: on ? LAMPLIT : undefined }),
    );
    framing(b, s, uPlane(s), uHalf(s), uFoot, uTop, uRail, holes, s === front ? "close" : "panel");
  }

  // ---- the sign: a board on an iron bracket off the +X end of the street
  // front, hung edge-on so it is read from along the street. Lit by nothing —
  // the old one glowed, and was the brightest thing on the building.
  {
    const su = ux - 0.55;
    const armY = 6.3;
    const yb = armY - 0.77;
    const at = (r: number): number => -(uz + r);
    offFace(b, front, uz, su, 0.07, armY, armY, 0, 1.7, 0.07, IRON);
    offFace(b, front, uz, su, 0.05, armY - 0.75, armY - 0.04, 0.03, 1.15, 0.05, IRON);
    b.box(0.1, 0.1, 0.1, su, armY, at(1.72), IRON);
    for (const r of [0.5, 1.4]) b.box(0.03, 0.36, 0.03, su, armY - 0.2, at(r), IRON);
    b.box(0.08, 0.78, 1.2, su, yb, at(0.95), VERDIGRIS);
    for (const y of [yb - 0.4, yb + 0.4]) b.box(0.11, 0.07, 1.3, su, y, at(0.95), TIMBER);
    for (const r of [0.33, 1.57]) b.box(0.11, 0.86, 0.07, su, yb, at(r), TIMBER);
    // A crescent: a gilt disc with a smaller one in the board's own paint laid
    // over it off-centre, standing proud of both faces.
    b.cyl(0.12, 0.5, 0.5, 16, su, yb + 0.02, at(0.9), FLAME, { z: Math.PI / 2 });
    b.cyl(0.14, 0.42, 0.42, 16, su, yb + 0.08, at(1.03), VERDIGRIS, { z: Math.PI / 2 });
  }

  // ---- the porch: two posts on padstones, a beam and two ties back to the
  // wall braced into them, and a slate lean-to on rafters that tucks under the
  // jetty's joists. Visual throughout, as the old one was.
  {
    const pz = (r: number): number => -(gz + r);
    const post = 3.3; // how far out the posts stand
    const px = 3.15;
    const fall = 0.44 / post;
    const pa = Math.atan(fall);
    const cosA = Math.cos(pa);
    /** The rafters' underside, `r` out from the wall. */
    const yu = (r: number): number => 3.18 - fall * r;
    const reach = 3.9;
    const brace = Math.atan2(0.45, 0.56);
    for (const k of [-1, 1]) {
      b.box(0.42, 0.2, 0.42, k * px, 0.1, pz(post), DARK_STONE);
      b.box(0.26, 2.3, 0.26, k * px, 1.35, pz(post), TIMBER);
      b.box(0.2, 0.24, post, k * px, 2.62, pz(post / 2), TIMBER);
      for (const j of [-1, 1]) {
        b.box(0.72, 0.12, 0.12, k * px + j * 0.28, 2.275, pz(post), TIMBER, { z: j * brace });
      }
      b.box(0.12, 0.12, 0.72, k * px, 2.275, pz(post - 0.28), TIMBER, { x: -brace });
      // A bench against the wall either side of the door.
      b.box(1.5, 0.07, 0.36, k * 2.3, 0.46, pz(0.3), PLANK);
      for (const j of [-1, 1]) b.box(0.07, 0.42, 0.32, k * 2.3 + j * 0.6, 0.21, pz(0.3), TIMBER);
    }
    b.box(7.5, 0.24, 0.24, 0, 2.62, pz(post), TIMBER);
    b.box(7.6, 0.2, 0.16, 0, 3.08, pz(0.08), TIMBER);
    for (let i = 0; i <= 10; i++) {
      const x = -3.6 + i * 0.72;
      b.box(0.1, 0.14, reach / cosA, x, yu(reach / 2) + 0.07 / cosA, pz(reach / 2), TIMBER, { x: -pa });
    }
    b.box(7.7, 0.1, reach / cosA, 0, yu(reach / 2) + 0.19 / cosA, pz(reach / 2), SLATE, { x: -pa });
    b.box(7.8, 0.2, 0.05, 0, yu(reach) + 0.12, pz(reach + 0.02), TIMBER);
    for (const k of [-1, 1]) {
      b.box(0.05, 0.2, reach / cosA, k * 3.87, yu(reach / 2) + 0.12 / cosA, pz(reach / 2), TIMBER, { x: -pa });
    }
    // The lantern, on a chain off the middle rafter: an iron cage round the
    // flame, and the porch's light.
    const lz = pz(1.9);
    b.box(0.03, yu(1.9) - 2.69, 0.03, 0, (yu(1.9) + 2.69) / 2, lz, IRON);
    b.cyl(0.14, 0.04, 0.32, 4, 0, 2.62, lz, IRON, { y: Math.PI / 4 });
    b.glow(0.17, 0.24, 0.17, 0, 2.43, lz, FLAME);
    b.box(0.24, 0.04, 0.24, 0, 2.29, lz, IRON);
    for (const cx of [-0.1, 0.1]) {
      for (const cz of [-0.1, 0.1]) b.box(0.025, 0.28, 0.025, cx, 2.43, lz + cz, IRON);
    }
    b.light("#ffb257", 24, 2.1, 0.22, 0, 2.43, lz);
  }

  // ---- the roof, described by its UNDERSIDE — the cottage's construction
  // turned to run along X: a plane through the top of each eaves face at
  // `ROOF_PITCH`, so the slate sits on the wall head with no slit under it.
  const k = ROOF_PITCH;
  const pitch = Math.atan(k);
  const cosP = Math.cos(pitch);
  const T = 0.24;
  /** The eave's tip, horizontally from the ridge, and the verge past each gable. */
  const ze = uz + eaves;
  const xe = ux + 0.45;
  /** The roof's underside at `z` from the ridge, and its top. */
  const under = (z: number): number => h - 0.02 + (uz - z) * k;
  const topAt = (z: number): number => under(z) + T / cosP;
  const ridgeTop = topAt(0);
  /**
   * A slab laid in the roof plane on side `sz`: from `z0` to `z1` from the
   * ridge, `o0` to `o1` out along the normal from the underside, and `x0` to
   * `x1` along the ridge. Cut PLUMB at both ends, which is what makes an eave
   * read as a fascia and lets the two slopes meet at the ridge with no notch.
   */
  const slope = (sz: number, z0: number, z1: number, o0: number, o1: number, x0: number, x1: number, color: string): void => {
    const section = (x: number): Point3[] => [
      [x, under(z0) + o0 / cosP, sz * z0],
      [x, under(z1) + o0 / cosP, sz * z1],
      [x, under(z1) + o1 / cosP, sz * z1],
      [x, under(z0) + o1 / cosP, sz * z0],
    ];
    convexSolid(b, section(x0), section(x1), color);
  };

  // Dormers: two on the street slope and one behind. Each is a plaster box set
  // back from the eave with its bottom buried in the slope, so the slate cuts
  // its cheeks to shape; a steep gabled roof whose ridge dives into the main
  // slope; a casement; bargeboards and a finial. Their X spans are kept, so
  // the course lines can be stopped at them.
  const dormerSpans: Record<number, [number, number][]> = { [-1]: [], [1]: [] };
  const dormer = (xd: number, sz: number, lit: boolean): void => {
    const s: Side = sz < 0 ? "-z" : "+z";
    const dw = 1.9;
    const half = dw / 2;
    const zf = uz - 0.35;
    const y0 = topAt(zf) - 0.04;
    const ye = y0 + 1.5;
    const zb = uz - (ye - topAt(uz)) / k;
    b.box(dw, ye - y0, zf - zb, xd, (y0 + ye) / 2, (sz * (zf + zb)) / 2, PLASTER);
    for (const kk of [-1, 1]) {
      onFace(b, s, zf, xd + kk * (half - 0.08), (y0 + ye) / 2, 0.16, ye - y0, 0.12, 0.03, TIMBER);
    }
    onFace(b, s, zf, xd, ye - 0.08, dw + 0.04, 0.16, 0.14, 0.04, TIMBER);
    onFace(b, s, zf, xd, y0 + 0.08, dw, 0.16, 0.12, 0.03, TIMBER);
    casement(b, s, zf, xd, y0 + 0.36, 0.9, 0.82, { lit: lit ? LAMPLIT : undefined });

    const kd = 0.95;
    const cD = Math.cos(Math.atan(kd));
    const Td = 0.16;
    const tipD = half + 0.18;
    const underD = (xl: number): number => ye - 0.02 + (half - xl) * kd;
    const topD = underD(0) + Td / cD;
    const zr = uz - (topD - topAt(uz)) / k - 0.15;
    const zFront = zf + 0.28;
    for (const sx of [-1, 1]) {
      const sec = (z: number, o0: number, o1: number, x1: number): Point3[] => [
        [xd, underD(0) + o0 / cD, z],
        [xd + sx * x1, underD(x1) + o0 / cD, z],
        [xd + sx * x1, underD(x1) + o1 / cD, z],
        [xd, underD(0) + o1 / cD, z],
      ];
      convexSolid(b, sec(sz * zr, 0, Td, tipD), sec(sz * zFront, 0, Td, tipD), SLATE);
      convexSolid(
        b,
        sec(sz * zFront, -0.16, Td + 0.02, tipD + 0.02),
        sec(sz * (zFront + 0.05), -0.16, Td + 0.02, tipD + 0.02),
        TIMBER,
      );
    }
    const aD = half + 0.1 / kd;
    b.gableEnd(2 * aD, aD * kd, 0.1, xd, ye - 0.02, sz * (zf - 0.05), PLASTER);
    const kingTop = underD(0) - 0.05;
    onFace(b, s, zf, xd, (ye + kingTop) / 2, 0.12, kingTop - ye, 0.1, 0.03, TIMBER);
    b.box(0.1, 0.5, 0.1, xd, topD + 0.12, sz * (zFront + 0.025), TIMBER);
    dormerSpans[sz].push([xd - tipD - 0.08, xd + tipD + 0.08]);
  };
  dormer(-3.3, -1, true);
  dormer(3.3, -1, false);
  dormer(-2.0, 1, true);

  for (const sz of [-1, 1]) {
    slope(sz, 0, ze, 0, T, -xe, xe, SLATE);
    // The slate's courses, as lines on its own plane (the townhouse's), stopped
    // either side of a dormer rather than drawn through its roof.
    for (const f of [0.2, 0.37, 0.54, 0.71, 0.87]) {
      const zc = ze * f;
      for (const [a, c] of carve(-xe + 0.04, xe - 0.04, dormerSpans[sz])) {
        slope(sz, zc - 0.04, zc + 0.04, T - 0.01, T + 0.035, a, c, IRON);
      }
    }
    // The rafters' feet under the eave, and the fascia on its plumb face.
    for (let x = -ux + 0.3; x <= ux - 0.25; x += 0.6) {
      slope(sz, uz - 0.05, ze - 0.06, -0.15, 0, x - 0.05, x + 0.05, TIMBER);
    }
    b.box(2 * xe + 0.1, 0.22, 0.05, 0, under(ze) + 0.07, sz * (ze + 0.025), TIMBER);
  }
  // A stone ridge, laid as a roll.
  b.box(2 * xe + 0.1, 0.3, 0.3, 0, ridgeTop + 0.02, 0, DARK_STONE, { x: Math.PI / 4 });

  // ---- the gables: plaster on the tie beam with both top edges buried in the
  // slate, a collar, a king post and a pair of struts, under bargeboards that
  // cover the verge and a finial and pendant at the apex.
  const gt = 0.3;
  const ga = uz + 0.15 / k;
  for (const sx of [-1, 1]) {
    const s: Side = sx < 0 ? "-x" : "+x";
    b.gableEnd(2 * ga, ga * k, gt, sx * (ux - gt / 2), h - 0.02, 0, PLASTER).rotation.y = Math.PI / 2;
    const yCol = h + 0.5 * uz * k;
    const colHalf = uz - (yCol - h) / k - 0.12;
    onFace(b, s, ux, 0, yCol, 2 * colHalf, 0.16, 0.12, 0.03, TIMBER);
    const kingTop = under(0) - 0.04;
    onFace(b, s, ux, 0, (yCol + kingTop) / 2, 0.16, kingTop - yCol, 0.12, 0.03, TIMBER);
    for (const kk of [-1, 1]) {
      const r = 0.62 * uz;
      const st = under(r) - 0.03;
      onFace(b, s, ux, kk * r, (h + 0.02 + st) / 2, 0.15, st - h - 0.02, 0.12, 0.03, TIMBER);
    }
    for (const sz of [-1, 1]) slope(sz, 0, ze + 0.02, -0.2, T + 0.03, sx * xe, sx * (xe + 0.06), TIMBER);
    b.box(0.14, 0.9, 0.14, sx * (xe + 0.03), ridgeTop + 0.15, 0, TIMBER);
    b.box(0.12, 0.5, 0.12, sx * (xe + 0.03), under(0) - 0.3, 0, TIMBER);
  }

  // ---- the stacks: one over each hearth, in the stone of the ends they rise
  // from, with an oversailing band, a cap and a pair of pots.
  const stackTop = ridgeTop + 1.35;
  for (const sx of [-1, 1]) {
    const cx = sx * (ix - 0.5);
    b.box(1.0, stackTop - (h - 0.3), 1.4, cx, (h - 0.3 + stackTop) / 2, 0, STONE);
    b.box(1.1, 0.12, 1.5, cx, stackTop - 0.45, 0, DARK_STONE);
    b.box(1.2, 0.18, 1.6, cx, stackTop + 0.09, 0, DARK_STONE);
    for (const kk of [-1, 1]) b.cyl(0.5, 0.22, 0.3, 8, cx, stackTop + 0.43, kk * 0.3, CITY_BRICK);
  }

  // ------------------------------------------------------------ the taproom
  //
  // The walked floor, as a collider with no geometry of its own: the boards
  // above are its visible top, 0.04 proud of it, as the manor's are. Without
  // it the taproom was floored in TERRAIN — a body stood 0.34 m down inside
  // the boards, and the grass (which rejects a tuft only inside a collider)
  // grew up through them. Down to a metre under the plinth so a floor that
  // dips under the placement is still covered.
  b.block({ w: w - t, h: 1.3, d: d - t, x: 0, y: -0.35, z: 0 });

  // Overhead: two beams from the front wall to the back and the joists across
  // them, which is what a player looks up at.
  for (const sx of [-1, 1]) b.box(0.34, 0.32, 2 * iz, sx * 2.2, g - 0.16, 0, TIMBER);
  for (let z = -iz + 0.5; z < iz - 0.3; z += 0.62) b.box(2 * ix, 0.14, 0.12, 0, g - 0.07, z, TIMBER);

  // The windows and the street door from inside. The glass is dark: the walls
  // are colliders, so there is nothing to see through them to.
  for (const kk of [-1, 1]) {
    casement(b, "+z", -iz, kk * 4.8, 0.95, 1.6, 1.35, { lights: 3 });
    for (const u of [-3.3, 3.3]) casement(b, kk < 0 ? "+x" : "-x", -ix, u, 1.05, 0.8, 1.05);
    // The street door's two leaves, hung back flat against the wall.
    const lu = kk * 1.64;
    b.box(1.04, 2.25, 0.05, lu, F + 1.125, -iz + 0.03, PLANK);
    for (const y of [F + 0.4, F + 1.85]) b.box(0.95, 0.12, 0.03, lu, y, -iz + 0.065, TIMBER);
    for (const y of [F + 0.55, F + 1.7]) b.box(0.6, 0.05, 0.02, kk * 1.42, y, -iz + 0.09, IRON);
  }
  casement(b, "-z", -iz, -4.0, 1.0, 1.1, 1.2);

  // A hearth at each end: one collider for the breast (the manor's
  // `fireplace` argues it), stone jambs, a sooted back, an oak bressumer with a
  // shelf on it, a plastered breast to the ceiling and the stack's flue above
  // that — and the fire, which is drawn, lit and heard.
  for (const sx of [-1, 1]) {
    const D = 1.0;
    const W = 2.6;
    const oW = 1.6;
    const oH = 1.3;
    const oD = 0.62;
    const face = ix - D;
    const xc = sx * (ix - D / 2);
    const jw = (W - oW) / 2;
    b.block({ w: D, h: g, d: W, x: xc, y: g / 2, z: 0 });
    for (const kk of [-1, 1]) b.box(D, F + oH, jw, xc, (F + oH) / 2, (kk * (oW + jw)) / 2, STONE);
    b.box(D - oD, F + oH, oW, sx * (ix - (D - oD) / 2), (F + oH) / 2, 0, DARK_STONE);
    b.box(D, g - F - oH, W, xc, (g + F + oH) / 2, 0, PLASTER);
    b.box(0.42, 0.34, W + 0.3, sx * (face + 0.06), F + oH + 0.1, 0, TIMBER);
    const shelf = F + oH + 0.3;
    b.box(0.3, 0.06, W + 0.5, sx * (face - 0.1), shelf, 0, TIMBER);
    for (const kk of [-1, 1]) {
      b.cyl(0.02, 0.32, 0.32, 12, sx * (face - 0.04), shelf + 0.19, kk * 0.5, IRON, { z: Math.PI / 2 });
      b.cyl(0.16, 0.1, 0.11, 8, sx * (face - 0.12), shelf + 0.11, kk * 1.0, IRON);
    }
    // The hearthstone, placed by its top face and deep rather than thin — the
    // manor's note on a flat slab walked over at a grazing angle.
    b.box(1.35, 0.4, W + 0.2, sx * (face + 0.1), F + 0.04 - 0.2, 0, DARK_STONE);
    const bed = F + 0.04;
    const fx = sx * (face + oD * 0.45);
    for (const kk of [-1, 1]) {
      b.box(0.5, 0.06, 0.06, fx, bed + 0.12, kk * 0.36, IRON);
      b.box(0.06, 0.34, 0.06, sx * (face + 0.08), bed + 0.17, kk * 0.36, IRON);
    }
    b.cyl(1.0, 0.15, 0.17, 6, fx - sx * 0.08, bed + 0.23, 0, TEAK, { x: Math.PI / 2 });
    b.cyl(0.9, 0.13, 0.14, 6, fx + sx * 0.1, bed + 0.32, 0.05, PLANK, { x: Math.PI / 2 });
    b.glow(0.45, 0.1, oW - 0.5, fx, bed + 0.06, 0, EMBER);
    b.flame(0.2, 0.7, fx, bed + 0.12, -0.25, 3);
    b.flame(0.17, 0.55, fx, bed + 0.12, 0.28, 3);
    b.light(EMBER, 12, 1.3, 0.5, sx * (face - 0.4), F + oH * 0.6, 0);
    b.sound("fire", fx, bed + 0.35, 0);
  }

  // The bar, on the +X side of the yard door with room behind it to serve
  // from: a panelled counter, and a back bar of casks on a rack under two
  // shelves of pots and bottles.
  {
    const cx = 3.4;
    const cl = 2.8;
    const cz = 2.9;
    const cd = 0.6;
    const ch = F + 1.05;
    b.block({ w: cl, h: ch, d: cd, x: cx, y: ch / 2, z: cz });
    b.box(cl, ch - F - 0.07, cd - 0.08, cx, (F + ch - 0.07) / 2, cz + 0.02, PLANK);
    b.box(cl + 0.12, 0.07, cd + 0.12, cx, ch - 0.035, cz, TEAK);
    const cf = cz - cd / 2 + 0.01;
    b.box(cl, 0.14, 0.05, cx, F + 0.07, cf, TIMBER);
    b.box(cl, 0.08, 0.05, cx, ch - 0.18, cf, TIMBER);
    for (let i = 0; i <= 4; i++) b.box(0.1, ch - F - 0.3, 0.05, cx - cl / 2 + 0.05 + (i * (cl - 0.1)) / 4, F + (ch - F - 0.07) / 2, cf, TIMBER);
    b.cyl(0.16, 0.1, 0.11, 8, cx - 0.7, ch + 0.08, cz - 0.05, IRON);
    b.cyl(0.16, 0.1, 0.11, 8, cx + 0.2, ch + 0.08, cz + 0.1, IRON);
    b.cyl(0.24, 0.14, 0.2, 8, cx + 0.9, ch + 0.12, cz, BRICK);

    const bz = iz - 0.225;
    const bh = F + 1.9;
    b.block({ w: cl, h: bh, d: 0.45, x: cx, y: bh / 2, z: bz });
    b.box(cl, bh - F, 0.06, cx, (F + bh) / 2, iz - 0.03, PLANK);
    for (const kk of [-1, 1]) b.box(0.06, bh - F, 0.45, cx + kk * (cl / 2 - 0.03), (F + bh) / 2, bz, TIMBER);
    b.box(cl - 0.1, 0.1, 0.4, cx, F + 0.05, bz, TIMBER);
    for (const i of [-1, 0, 1]) {
      const x = cx + i * 0.9;
      b.cyl(0.42, 0.56, 0.56, 12, x, F + 0.38, bz, PLANK, { x: Math.PI / 2 });
      b.cyl(0.04, 0.6, 0.6, 12, x, F + 0.38, bz - 0.18, IRON, { x: Math.PI / 2 });
      b.box(0.05, 0.05, 0.12, x, F + 0.24, bz - 0.26, IRON);
    }
    /** What stands on a shelf: a bottle, a jug or a pot, walked in order. */
    const WARES: [number, number, number, string][] = [
      [0.26, 0.07, 0.08, VERDIGRIS],
      [0.22, 0.14, 0.2, BRICK],
      [0.15, 0.1, 0.11, IRON],
      [0.28, 0.07, 0.09, CASEMENT],
    ];
    for (const [j, y] of [F + 1.15, F + 1.55].entries()) {
      b.box(cl - 0.1, 0.05, 0.36, cx, y, bz - 0.02, TEAK);
      for (let i = 0; i < 7; i++) {
        const [wh, dt, db, color] = WARES[(i + j * 2) % WARES.length];
        b.cyl(wh, dt, db, 8, cx - 1.15 + i * 0.38, y + 0.025 + wh / 2, bz - 0.02, color);
      }
    }
    b.box(cl + 0.1, 0.1, 0.5, cx, bh - 0.05, bz - 0.02, TIMBER);
  }

  // Three trestle tables with a bench down each side. The table is the
  // collider and the benches are not — see the header.
  for (const [x, z] of [
    [-3.1, -2.6],
    [-3.1, 2.6],
    [2.9, -2.5],
  ] as const) {
    const tw = 2.1;
    const td = 0.8;
    const top = F + 0.76;
    b.block({ w: tw, h: top, d: td, x, y: top / 2, z });
    b.box(tw + 0.1, 0.07, td + 0.1, x, top - 0.035, z, PLANK);
    for (const kk of [-1, 1]) {
      b.box(0.1, top - F - 0.07, td - 0.2, x + kk * (tw / 2 - 0.3), (F + top - 0.07) / 2, z, TIMBER);
      b.box(0.12, 0.08, td - 0.1, x + kk * (tw / 2 - 0.3), F + 0.04, z, TIMBER);
      const bz = z + kk * (td / 2 + 0.32);
      b.box(tw - 0.1, 0.06, 0.3, x, F + 0.44, bz, PLANK);
      for (const jj of [-1, 1]) b.box(0.06, 0.41, 0.26, x + jj * (tw / 2 - 0.3), F + 0.205, bz, TIMBER);
    }
    b.box(tw - 0.6, 0.08, 0.08, x, F + 0.3, z, TIMBER);
    b.cyl(0.16, 0.1, 0.11, 8, x - 0.4, top + 0.08, z - 0.1, IRON);
    b.cyl(0.16, 0.1, 0.11, 8, x + 0.5, top + 0.08, z + 0.15, IRON);
  }

  return b;
}
