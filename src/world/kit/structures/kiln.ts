/**
 * kit/structures/kiln.ts — buildKiln: the brick bottle kiln.
 * Part of the structures set: follows the contract in kit/core.ts, and the
 * cover heights and round-collider rule in `./index.ts`.
 */
import { Scene, type Mesh } from "@babylonjs/core";
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import { mulberry32 } from "../../rng";
import {
  Build,
  convexSolid,
  limb,
  type BuildCtx,
  type BuildParams,
  type Structure,
  type Point3,
  streetSeed,
  BRICK,
  DARK_STONE,
  EMBER,
  IRON,
  STONE,
  TIMBER,
} from "../core";

/**
 * The kiln is a brick BOTTLE KILN: a battered drum on a two-course stone
 * plinth, bound with iron bonts, turning in at a string course to a neck and
 * a short corbelled stack with the fire showing in its throat. The one kiln
 * stands for three trades — Hollowmere's charcoal burners, Harrowmead's
 * brickworks and Cinderhaven's sulphur works — and the bottle is the form all
 * three were built in, so nothing on it names the trade.
 *
 * Everything is laid on one of the nine FACES, never across a corner, and the
 * rings are all turned so a face looks square down -Z: that is where the
 * WICKET is, the arched doorway the kiln is set and drawn through. It is
 * CLAMMED for the firing — bricked up inside its arch ring, set back from it so
 * the ink finds the doorway it fills, with a peep hole — and the fire is fed
 * through an iron-framed, barred mouth left at its foot. Four smaller fire
 * mouths stand round the drum, each either firing (lit, barred, sooted round
 * its arch) or clammed. Between the bonts are patches of brickwork where the
 * mortar has gone, laid to one bond for the whole drum so a patch is a run of
 * its own courses rather than bricks scattered on it; two spy holes, one
 * sometimes glowing; and a ladder of climbing irons up one face to the crown.
 * At its foot: the ash raked out of the mouth with coals still alight in it,
 * fuel heaped against the drum, a hack of spare brick for the next clamming,
 * and the rake.
 *
 * Seeded off where it stands (`streetSeed`) — which mouths are firing, where
 * each bont is tightened, which face carries the irons, the brickwork and the
 * dressing — and its plinth is carried down to the lowest ground round the
 * drum, which puts `kiln` in `CONFORMS_TO_TERRAIN`. What burns is heard
 * burning: the one light is where it always was, and the fire's sound is at
 * the wicket's mouth.
 *
 * **The box is the DRUM, at its middle width.** It carried the haystack's bug
 * twice over: 3.8 is the circumdiameter of a nine-sided drum at its foot, and
 * the box held that width for 3.6 m — a metre past where the drum stops and
 * the neck starts narrowing to 1.3. Measured at 3.4 m up, where the kiln is a
 * chimney, the box stopped rounds on nothing at every bearing tested off the
 * axis.
 *
 * So it is 3.4 across (the drum's silhouette at 1.3 m, its half height) and
 * 2.6 tall (the drum, and nothing above it). Everything drawn over the drum
 * obeys the kit's three rules: it is bedded on a face and stands at most
 * 0.12 m off it (the bonts 2.5 cm, the arch rings 7, the climbing irons 12 —
 * `PROP_BODIES` is explicit that you do not lose a round to a piece of wire),
 * it is under 0.3 m and walked over (the plinth, the ash, the fuel, the
 * brick), or it stands above the box (the string course, the neck and the
 * stack). The neck and the stack are outside the box for the reason the
 * haystack's cap is — they start at 2.6 m, which clears a standing hit sphere
 * by nearly a metre, so nothing shelters there and the only cost is a round
 * clipping brick on its way over the top.
 */
export function buildKiln(
  scene: Scene,
  mats: CelMaterialFactory,
  _p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "kiln");
  // --- the collider: unchanged ---------------------------------------------
  b.block({ w: 3.4, h: 2.6, d: 3.4, x: 0, y: 1.3, z: 0 });

  // --- everything after this is drawing ------------------------------------
  const rnd = mulberry32(streetSeed(3.4, 3.4, 2.6, ctx));
  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };

  // The drum and the neck are nine-sided, and everything here is laid on one
  // of their FACES, so the rings are all turned by one angle that puts a face
  // (not a corner) square to -Z, where the wicket is. A Babylon cylinder's
  // first corner is at bearing 90°; its first face centre is half a side on.
  const SIDES = 9;
  const STEP = (2 * Math.PI) / SIDES;
  const TURN = Math.PI / 2 - STEP / 2;
  /** A face's distance from the axis over a corner's, and its half-width over a corner's. */
  const APO = Math.cos(Math.PI / SIDES);
  const HALF = Math.sin(Math.PI / SIDES);
  const turned = { y: TURN };
  interface Frustum {
    y0: number;
    y1: number;
    /** CIRCUMradii at y0 and y1 — what `b.cyl` is given, halved. */
    r0: number;
    r1: number;
  }
  const DRUM: Frustum = { y0: 0, y1: 2.6, r0: 1.9, r1: 1.5 };
  const NECK: Frustum = { y0: 2.6, y1: 3.7, r0: 1.5, r1: 0.65 };
  const circum = (f: Frustum, y: number): number => f.r0 + ((f.r1 - f.r0) * (y - f.y0)) / (f.y1 - f.y0);
  const lean = (f: Frustum): number => Math.atan(((f.r0 - f.r1) * APO) / (f.y1 - f.y0));
  /** Half the width of a face at height y: how far along it a part may reach. */
  const faceHalf = (f: Frustum, y: number): number => circum(f, y) * HALF;

  /**
   * A point on face `k` (bearing π + k·STEP), `u` along it and at height `y`,
   * stood `off` out along the face's own normal — which leans back with the
   * batter, so a part bedded on the face is bedded all the way up it.
   */
  const facePt = (f: Frustum, k: number, u: number, y: number, off: number): Point3 => {
    const phi = Math.PI + k * STEP;
    const t = lean(f);
    const a = circum(f, y) * APO;
    const s = Math.sin(phi);
    const c = Math.cos(phi);
    return [s * a + c * u + s * Math.cos(t) * off, y + Math.sin(t) * off, c * a - s * u + c * Math.cos(t) * off];
  };
  /**
   * Stands a part `d` deep on face `k` with its front `proud` off it, turned
   * `roll` in the face's own plane (X toward face-up). A `disc` is a cylinder
   * whose axis is the face normal.
   */
  const place = (m: Mesh, f: Frustum, k: number, u: number, y: number, d: number, proud: number, roll = 0, disc = false): Mesh => {
    const p = facePt(f, k, u, y, proud - d / 2);
    m.position.set(p[0], p[1], p[2]);
    const t = lean(f);
    m.rotation.set(disc ? Math.PI / 2 - t : -t, Math.PI + k * STEP, roll);
    return m;
  };
  const brick = (f: Frustum, k: number, u: number, y: number, w: number, h: number, proud: number, color: string, roll = 0): Mesh =>
    place(b.box(w, h, proud + 0.04, 0, 0, 0, color), f, k, u, y, proud + 0.04, proud, roll);
  /** A 9-sided band hugging `f` between y ± h/2, stood `proud` off it. */
  const ring = (f: Frustum, y: number, h: number, proud: number, color: string): void => {
    const e = proud / APO;
    b.cyl(h, 2 * (circum(f, y + h / 2) + e), 2 * (circum(f, y - h / 2) + e), SIDES, 0, y, 0, color, turned);
  };
  /**
   * An arch-headed slab on face `k`: a rectangle from `yb` to the springing
   * `ys`, under a semicircle of radius `wo`. Convex, so one solid; its front
   * `proud` off the face and `d` deep.
   */
  const archSlab = (k: number, wo: number, yb: number, ys: number, proud: number, d: number, color: string): void => {
    const outline: [number, number][] = [
      [-wo, yb],
      [wo, yb],
    ];
    for (let i = 0; i <= 10; i++) {
      const th = (Math.PI * i) / 10;
      outline.push([wo * Math.cos(th), ys + wo * Math.sin(th)]);
    }
    convexSolid(
      b,
      outline.map(([u, y]) => facePt(DRUM, k, u, y, proud)),
      outline.map(([u, y]) => facePt(DRUM, k, u, y, proud - d)),
      color,
    );
  };
  /**
   * An arched opening on face `k`: quoined brick jambs from the plinth to the
   * springing, an arch ring of `n` voussoirs with a proud keystone, and the
   * dark ground inside — the hole the ring is built round. What fills it is
   * the caller's.
   */
  const opening = (k: number, wo: number, ys: number, ringD: number, jamb: number, n: number): void => {
    archSlab(k, wo, PLINTH, ys, 0.012, 0.05, DARK_STONE);
    const courses = Math.max(2, Math.round((ys - PLINTH) / 0.17));
    const ch = (ys - PLINTH) / courses;
    for (const s of [-1, 1]) {
      for (let c = 0; c < courses; c++) {
        const w = c % 2 ? jamb * 0.7 : jamb;
        brick(DRUM, k, s * (wo + w / 2), PLINTH + (c + 0.5) * ch, w, ch - 0.014, 0.07, BRICK);
      }
    }
    const rm = wo + ringD / 2;
    for (let i = 0; i < n; i++) {
      const th = (Math.PI * (i + 0.5)) / n;
      const key = i === (n - 1) / 2;
      const len = key ? ringD + 0.06 : ringD;
      const r = key ? rm + 0.03 : rm;
      brick(DRUM, k, r * Math.cos(th), ys + r * Math.sin(th), (Math.PI * rm) / n - 0.014, len, key ? 0.09 : 0.07, BRICK, th - Math.PI / 2);
    }
  };
  /**
   * Soot: the blackening a firing mouth leaves round its own arch — small
   * lobes along the extrados, thickest over the crown and licked a hand's
   * width up from it. It does not climb the drum: a plume of discs stacked up
   * the face read as a keyhole cut in the brick, and at thirty metres as a
   * hole.
   */
  const soot = (k: number, ys: number, ro: number): void => {
    for (let i = 0; i < 9; i++) {
      const th = Math.PI * (0.18 + 0.64 * rnd());
      const reach = ro + 0.02 + rnd() * 0.08 * (1 - Math.abs(th - Math.PI / 2));
      const u = reach * Math.cos(th);
      const y = ys + reach * Math.sin(th);
      const r = 0.05 + rnd() * 0.04;
      const sx = 1.1 + rnd() * 0.5;
      if (Math.abs(u) + r * sx > faceHalf(DRUM, y) - 0.06) continue;
      const m = place(b.cyl(0.012, 2 * r, 2 * r, 8, 0, 0, 0, IRON), DRUM, k, u, y, 0.012, 0.008 + i * 0.0005, 0, true);
      m.scaling.x = sx;
      m.scaling.z = 1.2 + rnd() * 0.4;
    }
  };

  /** Where the drum stands on its plinth: the foot of every opening. */
  const PLINTH = 0.22;
  const BANDS = [1.58, 2.02, 2.44];
  const WICKET = { wo: 0.36, ys: 0.85, ring: 0.19 };
  const MOUTH = { wo: 0.2, ys: 0.5, ring: 0.13 };
  /** The four fire mouths round the drum: two a side of the wicket, two at the back. */
  const MOUTHS = [2, 4, 5, 7];
  const stepFace = rnd() < 0.5 ? 3 : 6;
  const spyFaces = [stepFace === 3 ? 6 : 3, rnd() < 0.5 ? 1 : 8];

  // --- the plinth: two courses of stone, carried down to the ground --------
  let gMin = 0;
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * 2 * Math.PI;
    gMin = Math.min(gMin, ground(Math.sin(a) * 2.1, Math.cos(a) * 2.1));
  }
  const footH = 0.1 - (gMin - 0.12);
  b.cyl(footH, 2 * 2.1, 2 * 2.12, SIDES, 0, 0.1 - footH / 2, 0, STONE, turned);
  b.cyl(PLINTH - 0.1, 2 * 1.99, 2 * 2.02, SIDES, 0, (0.1 + PLINTH) / 2, 0, STONE, turned);

  // --- the wicket, face 0: bricked up over a grated fire mouth --------------
  // A bottle kiln is set and drawn through its wicket and CLAMMED for the
  // firing: bricked up and daubed, with the fire fed through a mouth left at
  // its foot. The clamming is set back from the arch ring so the ink finds
  // the whole outline of the doorway it fills.
  opening(0, WICKET.wo, WICKET.ys, WICKET.ring, 0.2, 9);
  const mouthTop = 0.62;
  archSlab(0, WICKET.wo - 0.005, mouthTop + 0.045, WICKET.ys, 0.035, 0.06, BRICK);
  for (let c = 0; c < 6; c++) {
    const y = mouthTop + 0.1 + c * 0.082;
    const off = c % 2 ? 0.058 : 0;
    for (let u = -0.29 + off; u < 0.3; u += 0.232) {
      if (rnd() < 0.45) brick(DRUM, 0, u, y, 0.21, 0.068, 0.05, BRICK);
    }
  }
  // The peep hole in the clamming, and what the burner sees through it.
  brick(DRUM, 0, 0.12, 1.14, 0.11, 0.08, 0.04, DARK_STONE);
  place(b.glow(0.07, 0.045, 0.02, 0, 0, 0, EMBER), DRUM, 0, 0.12, 1.14, 0.02, 0.043);
  place(b.glow(0.5, 0.24, 0.02, 0, 0, 0, EMBER), DRUM, 0, 0, PLINTH + 0.16, 0.02, 0.03);
  brick(DRUM, 0, 0, mouthTop + 0.02, 2 * WICKET.wo + 0.05, 0.07, 0.065, IRON); // the lintel plate
  for (const s of [-1, 1]) brick(DRUM, 0, s * 0.3, PLINTH + 0.2, 0.045, 0.4, 0.05, IRON);
  for (const y of [PLINTH + 0.1, PLINTH + 0.22]) brick(DRUM, 0, 0, y, 0.6, 0.026, 0.06, IRON);

  // --- the fire mouths: each either firing or clammed ----------------------
  for (const k of MOUTHS) {
    opening(k, MOUTH.wo, MOUTH.ys, MOUTH.ring, 0.13, 5);
    if (rnd() < 0.55) {
      place(b.glow(0.3, 0.13, 0.02, 0, 0, 0, EMBER), DRUM, k, 0, PLINTH + 0.1, 0.02, 0.025);
      brick(DRUM, k, 0, PLINTH + 0.15, 2 * MOUTH.wo + 0.02, 0.026, 0.05, IRON);
      soot(k, MOUTH.ys, MOUTH.wo + MOUTH.ring);
    } else {
      archSlab(k, MOUTH.wo - 0.005, PLINTH, MOUTH.ys, 0.035, 0.06, BRICK);
      for (let c = 0; c < 4; c++) {
        if (rnd() < 0.6) brick(DRUM, k, (c % 2 ? 0.06 : -0.05) + (rnd() - 0.5) * 0.05, PLINTH + 0.07 + c * 0.082, 0.2, 0.068, 0.05, BRICK);
      }
    }
  }

  // --- the bonts: iron hoops cut to the batter, each with its tightener ----
  for (const y of BANDS) {
    ring(DRUM, y, 0.1, 0.025, IRON);
    const k = Math.floor(rnd() * SIDES);
    const u = (rnd() - 0.5) * 0.5;
    for (const s of [-1, 1]) brick(DRUM, k, u + s * 0.045, y, 0.04, 0.15, 0.085, IRON);
    place(b.cyl(0.18, 0.03, 0.03, 6, 0, 0, 0, IRON), DRUM, k, u, y, 0.03, 0.07, Math.PI / 2);
  }
  // The string course where the drum turns in to the neck, and the neck's own.
  ring(DRUM, 2.6, 0.12, 0.06, BRICK);
  ring(NECK, 3.15, 0.08, 0.025, IRON);

  // --- spy holes between the bonts, and the climbing irons -----------------
  for (const k of spyFaces) {
    const y = (BANDS[0] + BANDS[1]) / 2;
    brick(DRUM, k, 0, y, 0.12, 0.09, 0.006, DARK_STONE);
    if (rnd() < 0.5) place(b.glow(0.07, 0.05, 0.02, 0, 0, 0, EMBER), DRUM, k, 0, y, 0.02, 0.009);
    brick(DRUM, k, 0, y + 0.08, 0.26, 0.07, 0.03, BRICK);
    brick(DRUM, k, 0, y - 0.075, 0.24, 0.06, 0.03, BRICK);
    for (const s of [-1, 1]) brick(DRUM, k, s * 0.09, y, 0.06, 0.09, 0.03, BRICK);
  }
  const staple = (f: Frustum, y: number): void => {
    for (const s of [-1, 1]) place(b.box(0.028, 0.028, 0.14, 0, 0, 0, IRON), f, stepFace, s * 0.14, y, 0.14, 0.12);
    brick(f, stepFace, 0, y, 0.31, 0.028, 0.12, IRON);
  };
  for (let y = 0.55; y < 2.5; y += 0.36) {
    if (!BANDS.some((by) => Math.abs(by - y) < 0.08)) staple(DRUM, y);
  }
  for (const y of [2.82, 3.42]) staple(NECK, y);

  // --- weathered brickwork: patches where the mortar has gone -------------
  // Laid to one bond for the whole drum, so a patch is a run of the kiln's
  // own courses standing out rather than bricks scattered on it.
  const clear = (k: number, u: number, y: number, hw: number, hh: number): boolean => {
    if (y - hh < PLINTH + 0.06 || y + hh > 2.5) return false;
    if (Math.abs(u) + hw > faceHalf(DRUM, y) - 0.05) return false;
    if (BANDS.some((by) => Math.abs(y - by) < 0.07 + hh)) return false;
    if (k === 0 && Math.abs(u) < 0.62 + hw && y < 1.5 + hh) return false;
    if (MOUTHS.includes(k) && Math.abs(u) < 0.38 + hw && y < 0.9 + hh) return false;
    if (k === stepFace && Math.abs(u) < 0.2 + hw) return false;
    if (spyFaces.includes(k) && Math.abs(u) < 0.18 + hw && Math.abs(y - 1.8) < 0.1 + hh) return false;
    return true;
  };
  for (let k = 0; k < SIDES; k++) {
    for (let p = 0; p < 2; p++) {
      const c0 = Math.floor(rnd() * 26);
      const uc = (rnd() - 0.5) * 0.9;
      const n = 3 + Math.floor(rnd() * 3);
      for (let c = c0; c < c0 + n; c++) {
        const y = PLINTH + 0.05 + c * 0.082;
        const off = c % 2 ? 0.116 : 0;
        const run = 1 + Math.floor(rnd() * 3);
        const start = Math.round((uc - off) / 0.232 - run / 2 + (rnd() - 0.5));
        for (let i = start; i < start + run; i++) {
          const u = off + i * 0.232;
          if (clear(k, u, y, 0.11, 0.034)) brick(DRUM, k, u, y, 0.22, 0.068, 0.014 + rnd() * 0.01, BRICK);
        }
      }
    }
  }

  // --- the crown: a short stack, corbelled out, with the fire in its throat --
  b.cyl(0.4, 2 * 0.62, 2 * 0.66, SIDES, 0, 3.8, 0, BRICK, turned);
  b.cyl(0.07, 2 * 0.66, 2 * 0.67, SIDES, 0, 3.74, 0, IRON, turned);
  b.cyl(0.1, 2 * 0.78, 2 * 0.74, SIDES, 0, 4.01, 0, BRICK, turned);
  const lipIn = 0.44;
  for (let k = 0; k < SIDES; k++) {
    const a0 = Math.PI + (k - 0.5) * STEP;
    const a1 = Math.PI + (k + 0.5) * STEP;
    const at = (r: number, a: number, y: number): Point3 => [Math.sin(a) * r, y, Math.cos(a) * r];
    const course = (y: number): Point3[] => [at(lipIn, a0, y), at(0.72, a0, y), at(0.72, a1, y), at(lipIn, a1, y)];
    convexSolid(b, course(4.06), course(4.18), BRICK);
  }
  b.cyl(0.025, 2 * 0.5, 2 * 0.5, 12, 0, 4.0725, 0, DARK_STONE);
  // Two squares crossed are an octagon; its corners run under the lip, so
  // what shows is the throat's own outline.
  for (const a of [0, Math.PI / 4]) b.glow(0.7, 0.01, 0.7, 0, 4.1, 0, EMBER).rotation.y = a;

  // --- at its foot: the ash drawn out of the mouth, fuel, spare brick, a rake --
  // Raked out in a fan from the mouth: a low bank of cinder against the
  // plinth, thinning to scattered clinker, with a few coals still alight.
  for (let i = 0; i < 6; i++) {
    const x = (rnd() - 0.5) * (0.4 + i * 0.12);
    const z = -2.05 - i * 0.07 - rnd() * 0.1;
    const d = 0.5 - i * 0.05 + rnd() * 0.15;
    const h = 0.07 - i * 0.008;
    const m = b.cyl(h, d * 0.6, d, 7, x, ground(x, z) + h / 2 - 0.01, z, IRON, { y: rnd() * Math.PI });
    m.scaling.x = 1.2 + rnd() * 0.5;
  }
  for (let i = 0; i < 7; i++) {
    const x = (rnd() - 0.5) * 1.3;
    const z = -2.1 - rnd() * 0.6;
    const s = 0.05 + rnd() * 0.06;
    b.box(s, s * 0.6, s * 1.3, x, ground(x, z) + 0.02, z, DARK_STONE, { x: rnd() * 0.5, y: rnd() * 3 });
  }
  for (let i = 0; i < 3; i++) {
    const x = (rnd() - 0.5) * 0.5;
    const z = -2.08 - rnd() * 0.2;
    b.glow(0.045, 0.03, 0.04, x, ground(x, z) + 0.06, z, EMBER);
  }
  const side = rnd() < 0.5 ? -1 : 1;
  // Fuel heaped against the drum on one side of the wicket.
  {
    const x = side * 1.55;
    const z = -1.75;
    for (let i = 0; i < 3; i++) {
      const lx = x + (rnd() - 0.5) * 0.4;
      const lz = z + (rnd() - 0.5) * 0.4;
      const h = 0.2 - i * 0.05;
      const m = b.cyl(h, 0.2 + rnd() * 0.15, 0.8 - i * 0.15, 7, lx, ground(lx, lz) + h / 2 - 0.02, lz, IRON, { y: rnd() * Math.PI });
      m.scaling.x = 1.1 + rnd() * 0.4;
    }
    for (let i = 0; i < 12; i++) {
      const a = rnd() * 2 * Math.PI;
      const r = 0.2 + rnd() * 0.35;
      const lx = x + Math.sin(a) * r;
      const lz = z + Math.cos(a) * r;
      const s = 0.08 + rnd() * 0.07;
      b.box(s, s * 0.7, s * 1.2, lx, ground(lx, lz) + 0.04 + (0.55 - r) * 0.2, lz, IRON, { x: rnd(), y: rnd() * 3, z: rnd() });
    }
  }
  // Spare brick for the next clamming, stacked on the other side.
  {
    const x = -side * 1.6;
    const z = -2.0;
    const g = ground(x, z);
    const yaw = side * 0.5;
    // Hacked as a brickmaker stacks them: each course of stretchers laid
    // across the one under it, the top course short.
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    for (let course = 0; course < 4; course++) {
      const across = course % 2 === 1;
      const n = course === 3 ? 2 : 3;
      for (let i = 0; i < n; i++) {
        for (const j of [-0.5, 0.5]) {
          const a = (i - 1) * 0.12 + (rnd() - 0.5) * 0.015;
          const bOff = j * 0.235;
          const [lu, lv] = across ? [bOff, a] : [a, bOff];
          b.box(0.22, 0.066, 0.11, x + lu * c + lv * sn, g + 0.034 + course * 0.07, z - lu * sn + lv * c, BRICK, {
            y: yaw + (across ? 0 : Math.PI / 2) + (rnd() - 0.5) * 0.06,
          });
        }
      }
    }
    for (let i = 0; i < 2; i++) {
      const lx = x + (rnd() - 0.5) * 1.0;
      const lz = z - 0.45 - rnd() * 0.3;
      b.box(0.22, 0.068, 0.11, lx, ground(lx, lz) + 0.034, lz, BRICK, { y: rnd() * 3 });
    }
    // The rake the ash was drawn with, dropped across the front.
    const x0 = x + side * 0.3;
    const z0 = z - 0.6;
    const x1 = x0 + side * 1.5;
    const z1 = z0 - 0.35;
    limb(b, [x0, ground(x0, z0) + 0.03, z0], [x1, ground(x1, z1) + 0.03, z1], 0.045, 0.04, TIMBER);
    const hx = x1 + side * 0.06;
    b.box(0.05, 0.05, 0.42, hx, ground(hx, z1) + 0.03, z1 - 0.01, IRON, { y: Math.atan2(side * 1.5, -0.35) + Math.PI / 2 });
  }

  // --- the masses, emitted last so the detail over them hides them ---------
  b.cyl(2.6, 2 * DRUM.r1, 2 * DRUM.r0, SIDES, 0, 1.3, 0, BRICK, turned);
  b.cyl(1.1, 2 * NECK.r1, 2 * NECK.r0, SIDES, 0, 3.15, 0, BRICK, turned);

  b.light(EMBER, 17, 1.9, 0.42, 0, 0.8, -2.0);
  b.sound("fire", 0, PLINTH + 0.2, -1.9);
  return b;
}
