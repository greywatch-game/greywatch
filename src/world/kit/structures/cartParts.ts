/**
 * kit/structures/cartParts.ts — The cart's parts, each built round its own
 * frame and carried into place: `reframe` and `about` to carry them, and the
 * wheel, the sack, the fork and the cask. The stall carries a sack too, and
 * places its wares with `reframe`.
 * Invariants: parts only — never a collider, and never a quaternion on a mesh
 * (`reframe` writes Euler angles back, which is what `MapBuilder` composes
 * with).
 */
import { Matrix, Quaternion, Vector3, type Mesh } from "@babylonjs/core";
import {
  Build,
  IRON,
  PITCH,
  PLANK,
  SAILCLOTH,
  TIMBER,
} from "../core";

/**
 * Moves parts that have already been built as though the frame they were drawn
 * in had moved: `m` is applied AFTER each part's own transform, so a wheel is
 * built round its own nave and then carried to its axle, and a front carriage
 * is built square and then turned on its kingpin. The result is written back
 * as an ordinary position, rotation and scaling — never as a quaternion, which
 * `MapBuilder` would then have to know to compose its own `rotation.y` with.
 */
export function reframe(meshes: readonly Mesh[], m: Matrix): void {
  const s = new Vector3();
  const q = new Quaternion();
  const t = new Vector3();
  for (const mesh of meshes) {
    Matrix.Compose(mesh.scaling, Quaternion.FromEulerVector(mesh.rotation), mesh.position)
      .multiply(m)
      .decompose(s, q, t);
    mesh.scaling.copyFrom(s);
    mesh.rotation.copyFrom(q.toEulerAngles());
    mesh.position.copyFrom(t);
  }
}

/** A rotation `r` about the point (x, y, z) rather than about the origin. */
export function about(x: number, y: number, z: number, r: Matrix): Matrix {
  return Matrix.Translation(-x, -y, -z).multiply(r).multiply(Matrix.Translation(x, y, z));
}

/**
 * One cart wheel, built round its own nave with the axle along Z and the
 * linchpin side at +Z: an iron tyre shrunk onto a ring of felloes, spokes
 * morticed into a hooped nave, and the axle's end and pin standing out of it.
 *
 * **Every member is its own part, because the spokes ARE the wheel.** A disc is
 * what the cart was, and a disc reads as a millstone or a barrel end at any
 * range the ink can draw it; what says wheel is the light between the spokes,
 * and that only exists if they are separate.
 *
 * `broken` is a wheel that has come off: no pin, two spokes snapped out, one
 * felloe gone and the tyre sprung off over that quarter.
 */
export function cartWheel(
  b: Build,
  R: number,
  spokes: number,
  color: string,
  phase: number,
  broken = false,
): Mesh[] {
  const from = b.meshes.length;
  /** Tyre and felloe segments: enough that the rim reads round at arm's length. */
  const segs = spokes + 6;
  const step = (2 * Math.PI) / segs;
  const chord = (r: number): number => 2 * r * Math.sin(step / 2) + 0.012;
  const tyreT = 0.028;
  const felloeD = 0.08;
  const hubR = R * 0.22;
  const hubLen = R * 0.55;
  const hubZ = -0.04;
  /** Where each member sits on the circle: its own +Y points out along `a`. */
  const at = (r: number, a: number): [number, number] => [-Math.sin(a) * r, Math.cos(a) * r];
  for (let i = 0; i < segs; i++) {
    // The gap in a broken wheel is one felloe's worth, and the tyre that ran
    // over it has sprung clear of the three either side.
    const lost = broken && i >= 2 && i <= 4;
    const a = phase + i * step;
    if (!lost || i === 3) {
      if (!(broken && i === 3)) {
        const rf = R - tyreT - felloeD / 2;
        const [fx, fy] = at(rf, a);
        b.box(chord(rf), felloeD, 0.075, fx, fy, 0, color, { z: a });
      }
    }
    if (!lost) {
      const rt = R - tyreT / 2;
      const [tx, ty] = at(rt, a);
      b.box(chord(rt), tyreT, 0.088, tx, ty, 0, IRON, { z: a });
    }
  }
  const r0 = hubR * 0.9;
  const r1 = R - tyreT - felloeD + 0.02;
  for (let i = 0; i < spokes; i++) {
    if (broken && (i === 1 || i === 2)) continue;
    const a = phase + (i + 0.5) * ((2 * Math.PI) / spokes);
    const [sx, sy] = at((r0 + r1) / 2, a);
    b.box(0.048, r1 - r0, 0.038, sx, sy, 0, color, { z: a });
  }
  // The nave: fatter where the spokes go in, tapering to both ends, hooped at
  // each. `x: PI/2` stands a cylinder's top on +Z.
  const half = hubLen / 2;
  b.cyl(half, hubR * 1.7, hubR * 2, 10, 0, 0, hubZ + half / 2, color, { x: Math.PI / 2 });
  b.cyl(half, hubR * 2, hubR * 1.8, 10, 0, 0, hubZ - half / 2, color, { x: Math.PI / 2 });
  for (const k of [-1, 1]) {
    const d = k > 0 ? hubR * 1.78 : hubR * 1.88;
    b.cyl(0.03, d, d, 10, 0, 0, hubZ + k * (half - 0.03), IRON, { x: Math.PI / 2 });
  }
  if (!broken) {
    // The axle's end through the nave, and the linchpin through the axle.
    b.cyl(0.07, 0.075, 0.075, 8, 0, 0, hubZ + half + 0.03, IRON, { x: Math.PI / 2 });
    b.box(0.022, 0.13, 0.022, 0, 0.005, hubZ + half + 0.045, IRON);
  }
  return b.meshes.slice(from);
}

/**
 * A full hessian sack lying along X, tied at +X, built on its own belly.
 *
 * **It is SOFT, and that is the whole of what separates it from a bottle**: a
 * straight prism with a neck on it is one, however it is coloured. So the belly
 * swells between a bottom end that is gathered rather than cut flat and a
 * shoulder that slumps down into the tie, and the whole of it is squashed
 * flatter than it is wide, the way a full sack settles on a floor.
 */
export function cartSack(b: Build): Mesh[] {
  const from = b.meshes.length;
  // Each piece is a cylinder laid along X (`z: PI/2` puts its top at -X, and
  // `-PI/2` at +X) and squashed upright, its own X being what stands after
  // the turn — so the squash is `scaling.x`, and the belly sits at `Y`.
  const Y = 0.14;
  const piece = (h: number, dTop: number, dBot: number, x: number, toward: 1 | -1): void => {
    b.cyl(h, dTop, dBot, 8, x, Y, 0, SAILCLOTH, { z: (-toward * Math.PI) / 2 }).scaling.x = 0.6;
  };
  piece(0.1, 0.28, 0.46, -0.32, -1);
  piece(0.4, 0.46, 0.42, -0.07, -1);
  piece(0.22, 0.2, 0.46, 0.24, 1);
  b.cyl(0.035, 0.1, 0.1, 6, 0.37, Y + 0.01, 0, PITCH, { z: -Math.PI / 2 });
  b.cyl(0.09, 0.16, 0.07, 6, 0.42, Y + 0.02, 0, SAILCLOTH, { z: -Math.PI / 2 + 0.25 });
  return b.meshes.slice(from);
}

/** A hay fork lying along X, tines at +X, on its own shaft. */
export function cartFork(b: Build): Mesh[] {
  const from = b.meshes.length;
  b.cyl(1.5, 0.035, 0.04, 6, 0, 0, 0, TIMBER, { z: Math.PI / 2 });
  b.box(0.1, 0.035, 0.035, 0.78, 0, 0, IRON);
  b.box(0.035, 0.03, 0.24, 0.84, 0, 0, IRON);
  for (const z of [-0.11, 0, 0.11]) b.box(0.34, 0.016, 0.016, 1.0, 0.01, z, IRON, { z: 0.08 });
  return b.meshes.slice(from);
}

/** A cask standing on end, its foot at y = 0. */
export function cartCask(b: Build, h: number, d: number): Mesh[] {
  const from = b.meshes.length;
  b.cyl(h / 2, d, d * 0.86, 10, 0, h / 4, 0, PLANK);
  b.cyl(h / 2, d * 0.86, d, 10, 0, (h * 3) / 4, 0, PLANK);
  for (const y of [0.08, 0.3, 0.7, 0.92]) {
    const k = 1 - Math.abs(y - 0.5) * 0.28;
    b.cyl(0.035, d * k + 0.02, d * k + 0.02, 10, 0, h * y, 0, IRON);
  }
  b.cyl(0.02, d * 0.8, d * 0.8, 10, 0, h - 0.005, 0, TIMBER);
  return b.meshes.slice(from);
}
