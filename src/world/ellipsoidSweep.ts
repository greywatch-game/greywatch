/**
 * ellipsoidSweep.ts — The swept ellipsoid a body moves by: Babylon 9.28's
 * `moveWithCollisions` — its `Collider` and its coordinator's retry loop —
 * operation for operation, tested against collider BOXES rather than meshes.
 * Owns: one sweep's collider state, the triangles of the boxes it was handed
 * (held in the ellipsoid's own scaled space), and the response loop.
 * Owns no world: what it is tested against is whatever `addBox` was given since
 * the last `begin`, and choosing that — and where a sweep starts from — is the
 * caller's job (`CollisionField`).
 * Imports nothing but `src/math/`, the box generator and a type — never
 * `@babylonjs/core`.
 *
 * ## Why a port and not a new sweep
 *
 * **The feel of moving is this algorithm's, quirks included**, and the feel is
 * the acceptance test (`PERF_PLAN.md` C2). Sliding along a wall, catching on
 * a corner, a hull climbing the plank, a body ejected from a rail it landed
 * in: all of it is what this response loop does, and every system built on top
 * (`Player.freeFromProps`, `Vehicle.freeFromWalls`, the hull's
 * `ellipsoidOffset` and its climb band) was tuned against it. A different
 * sweep, however correct, would be a different game to drive. So this is
 * Babylon's, and what changed is only WHERE THE TRIANGLES COME FROM.
 *
 * A collider was always a box. `MapBuilder.collider()` made each one with
 * `MeshBuilder.CreateBox` and the box's own `WorldBox`, so its twelve triangles
 * are a function of the box and nothing else. `addBox` builds them the way
 * Babylon did: the box generator's own vertices and index order
 * (`createBox`, already proven bit for bit by `geometry-check`), placed by the
 * world matrix `computeWorldMatrix` composed for that mesh and scaled into the
 * ellipsoid's space by the matrix `_checkCollision` multiplied onto it — all in
 * `src/math/`, which is Babylon's arithmetic bit for bit (`math-check`). A box
 * that was its own collider mesh therefore gives exactly the triangles Babylon
 * tested. One that was MERGED into a scatter cluster gives the same triangles
 * to the last bit or so: the merge baked the world matrix into the vertices
 * first and scaled them second, which rounds at the other end.
 *
 * ## What is tested, and what is not
 *
 * - **Back faces are TESTED.** Babylon skips a face turned away from the
 *   motion only for a mesh with no material, and asks `subMesh.getMaterial()`
 *   — which hands back the scene's DEFAULT material when the mesh has none and
 *   a default-material factory is registered. Importing the barrel registers
 *   `StandardMaterial`'s, so in this game every collider and every hull box
 *   answered with one and no face was ever culled. That is half of why a body
 *   that has ended up INSIDE a box crawls rather than walks out of it: the far
 *   faces are walls from the inside too (`Player.freeFromProps`).
 * - **Ties go to the FIRST triangle found**, Babylon's `<`. So the order boxes
 *   are handed in is part of the answer when two contacts land at the same
 *   distance, which between flush faces is common. The candidates come in
 *   COLLIDER order with the hulls last (`RayWorld.bodyNear`), and that is a
 *   deliberate change rather than a copy: under Babylon a box's place was its
 *   MESH's place in `scene.meshes`, a merged scatter cluster's place differed
 *   between the client (made after the other scatter colliders, in bucket
 *   order) and the authority (made before every single collider), and so the
 *   two sides already broke ties apart. Collider order is the one both sides
 *   hold.
 * - **Nothing here knows the floor.** The terrain's collider clone never had
 *   `checkCollisions` — vertical placement is the ground probe's job — so a
 *   sweep has never seen it, and does not now.
 * - **The cull changes no answer.** It drops a box only when its scaled-space
 *   bounding box misses the ball the unit sphere can reach this pass, and every
 *   contact a triangle can report lies inside that ball — so what it drops is
 *   a box that could produce no contact. (It is NOT Babylon's test, which was
 *   per mesh and in world space; the two keep different boxes and find the
 *   same contacts.)
 *
 * ## Licence
 *
 * Ported from Babylon.js 9.28 (`Collisions/collider.js`,
 * `Collisions/collisionCoordinator.pure.js`, and `moveWithCollisions` with
 * its position callback in `Meshes/abstractMesh.pure.js`), licensed under the
 * Apache License, Version 2.0 (`node_modules/@babylonjs/core/license.md`;
 * https://www.apache.org/licenses/LICENSE-2.0). "Babylon.js — Copyright 2023
 * The Babylon.js team" (its NOTICE). Changes from the original: plain numbers
 * in place of `Vector3` scratch, the recursion as a loop, triangles generated
 * from a box rather than read from a mesh, the per-mesh bounding test made per
 * box, and the path length measured (for a caller's superset check).
 */
import { createBox } from "../geometry/primitives.ts";
import { Matrix, Quaternion, Vector3 } from "../math/index.ts";
import type { WorldBox } from "./mapTypes.ts";

/**
 * `AbstractEngine.CollisionsEpsilon`. A move whose result differs from where it
 * started by no more than this is not written back at all (the position
 * callback's gate), and ten of it is the response's displacement off a contact
 * and the length below which a slide stops retrying — both in SCALED space.
 */
export const COLLISIONS_EPSILON = 0.001;

/** `AbstractMesh.collisionRetryCount`'s default, which nothing here changes. */
const COLLISION_RETRIES = 3;

/** Twelve triangles a box, three corners a triangle, three numbers a corner. */
const TRIS_PER_BOX = 12;
/** Per triangle: corners A, B, C (9), the plane's normal (3) and its `d` (1). */
const TRI_STRIDE = 13;
/** Per box: its scaled-space bounding box, min xyz then max xyz. */
const AABB_STRIDE = 6;

/**
 * Slack on the per-box cull, in scaled units: the cull may never drop a box
 * that could produce a contact, so it is padded against rounding rather than
 * trusted to the last bit.
 */
const CULL_PAD = 1e-6;

/**
 * The box generator's unit cube, read once: which of the eight corners each of
 * its 24 vertices is, and its 36 indices. A box's vertex `i` is
 * `±(w || 1) / 2` per axis — `createBox`'s own `base * hx`, which for a base
 * of ±1 is exact — so eight transformed corners stand in for all 24 without
 * changing a bit, and the triangles are wound and ordered as Babylon's mesh
 * had them.
 */
const CORNER_OF: Uint8Array = new Uint8Array(24);
/** The eight corners' signs, `(sx, sy, sz)` each ±1. */
const CORNER_SIGN: Float64Array = new Float64Array(24);
/**
 * Per triangle, the corners in the order `_testTriangle` receives them. Babylon
 * read `p1, p2, p3` off the index buffer and — the mesh not being right-handed
 * — passed them as `p3, p2, p1`; this is that order, resolved once.
 */
const TRI_CORNERS: Uint8Array = new Uint8Array(TRIS_PER_BOX * 3);
{
  const unit = createBox({ width: 2, height: 2, depth: 2 });
  const pos = unit.positions;
  let corners = 0;
  const key = new Map<number, number>();
  for (let v = 0; v < 24; v++) {
    const sx = pos[v * 3];
    const sy = pos[v * 3 + 1];
    const sz = pos[v * 3 + 2];
    const k = (sx > 0 ? 1 : 0) | (sy > 0 ? 2 : 0) | (sz > 0 ? 4 : 0);
    let c = key.get(k);
    if (c === undefined) {
      c = corners++;
      key.set(k, c);
      CORNER_SIGN[c * 3] = sx;
      CORNER_SIGN[c * 3 + 1] = sy;
      CORNER_SIGN[c * 3 + 2] = sz;
    }
    CORNER_OF[v] = c;
  }
  const idx = unit.indices;
  for (let t = 0; t < TRIS_PER_BOX; t++) {
    TRI_CORNERS[t * 3] = CORNER_OF[idx[t * 3 + 2]];
    TRI_CORNERS[t * 3 + 1] = CORNER_OF[idx[t * 3 + 1]];
    TRI_CORNERS[t * 3 + 2] = CORNER_OF[idx[t * 3]];
  }
}

/** `addBox`'s matrix scratch: rotation, world, ellipsoid scale, and their product. */
const ONE = new Vector3(1, 1, 1);
const AT = new Vector3();
const TURN = new Quaternion();
const WORLD = new Matrix();
const SCALE = new Matrix();
const TO_SCALED = new Matrix();
const CORNER = new Vector3();

/**
 * `GetLowestRoot`, which returned a shared `{ root, found }`; here the root, or
 * -1 for none — every root it can report is strictly positive.
 */
function lowestRoot(a: number, b: number, c: number, maxR: number): number {
  const determinant = b * b - 4.0 * a * c;
  if (determinant < 0) return -1;
  const sqrtD = Math.sqrt(determinant);
  let r1 = (-b - sqrtD) / (2.0 * a);
  let r2 = (-b + sqrtD) / (2.0 * a);
  if (r1 > r2) {
    const temp = r2;
    r2 = r1;
    r1 = temp;
  }
  if (r1 > 0 && r1 < maxR) return r1;
  if (r2 > 0 && r2 < maxR) return r2;
  return -1;
}

/** Where a sweep ended, in world space, and how far it travelled getting there. */
export interface SweepResult {
  x: number;
  y: number;
  z: number;
  /**
   * The length of the path the ellipsoid's centre took, in metres — every
   * segment, retries included. What a caller checks its candidate list
   * against: nothing farther than `max(rx, rz)` plus this, in the ground
   * plane, could have been touched.
   */
  path: number;
}

export class EllipsoidSweep {
  // The ellipsoid's radii — `Collider._radius`.
  private rx = 1;
  private ry = 1;
  private rz = 1;

  /** The eight corners of the box being added, scaled space. */
  private readonly corner = new Float64Array(24);

  /** The handed boxes' triangles, `TRI_STRIDE` each. Grown, never shrunk. */
  private tri = new Float64Array(TRIS_PER_BOX * TRI_STRIDE * 32);
  /** Their scaled-space bounding boxes, `AABB_STRIDE` each. */
  private aabb = new Float64Array(AABB_STRIDE * 32);
  private boxes = 0;

  // `Collider`'s per-pass state, as numbers. All of it in SCALED space.
  private bx = 0;
  private by = 0;
  private bz = 0;
  private vx = 0;
  private vy = 0;
  private vz = 0;
  private velSq = 0;
  private collisionFound = false;
  private nearestSq = 0;
  private nearest = 0;
  private ix = 0;
  private iy = 0;
  private iz = 0;
  // `_collisionPoint`, written by a test and kept only if it wins.
  private cpx = 0;
  private cpy = 0;
  private cpz = 0;

  /**
   * Starts a sweep for an ellipsoid of these radii, forgetting every box handed
   * to the last one. The radii are the ellipsoid's whole say in the triangles —
   * they ARE the space they are held in — so they are fixed before any box.
   */
  begin(rx: number, ry: number, rz: number): void {
    this.rx = rx;
    this.ry = ry;
    this.rz = rz;
    this.boxes = 0;
    // `Matrix.ScalingToRef`, which is this exact `FromValuesToRef`.
    Matrix.FromValuesToRef(
      1.0 / rx, 0.0, 0.0, 0.0,
      0.0, 1.0 / ry, 0.0, 0.0,
      0.0, 0.0, 1.0 / rz, 0.0,
      0.0, 0.0, 0.0, 1.0,
      SCALE,
    );
  }

  /**
   * Hands the sweep one box to be tested against: its twelve triangles placed
   * as the collider mesh placed them, in scaled space.
   *
   * The matrix is `computeWorldMatrix`'s for a mesh at the box's centre turned
   * by `rotation.set(rotX, rotY, 0)` — yaw, then pitch, through the
   * quaternion, composed with unit scale — times `_checkCollision`'s scaling.
   * Both in `src/math/`, so both are Babylon's floats.
   */
  addBox(box: WorldBox): void {
    if (this.boxes * TRIS_PER_BOX * TRI_STRIDE >= this.tri.length) this.grow();
    Quaternion.RotationYawPitchRollToRef(box.rotY, box.rotX, 0, TURN);
    AT.set(box.cx, box.cy, box.cz);
    Matrix.ComposeToRef(ONE, TURN, AT, WORLD);
    WORLD.multiplyToRef(SCALE, TO_SCALED);
    // `createBox`'s defaulting, `||` and all: a zero extent is 1.
    const hx = (box.w || 1) / 2;
    const hy = (box.h || 1) / 2;
    const hz = (box.d || 1) / 2;
    const at = this.boxes * TRIS_PER_BOX * TRI_STRIDE;
    const tri = this.tri;
    let x0 = Infinity;
    let y0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let z1 = -Infinity;
    for (let c = 0; c < 8; c++) {
      Vector3.TransformCoordinatesFromFloatsToRef(
        CORNER_SIGN[c * 3] * hx,
        CORNER_SIGN[c * 3 + 1] * hy,
        CORNER_SIGN[c * 3 + 2] * hz,
        TO_SCALED,
        CORNER,
      );
      const x = CORNER.x;
      const y = CORNER.y;
      const z = CORNER.z;
      this.corner[c * 3] = x;
      this.corner[c * 3 + 1] = y;
      this.corner[c * 3 + 2] = z;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (z < z0) z0 = z;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
      if (z > z1) z1 = z;
    }
    const k = this.corner;
    for (let t = 0; t < TRIS_PER_BOX; t++) {
      const o = at + t * TRI_STRIDE;
      const a = TRI_CORNERS[t * 3] * 3;
      const b = TRI_CORNERS[t * 3 + 1] * 3;
      const c = TRI_CORNERS[t * 3 + 2] * 3;
      const ax = k[a];
      const ay = k[a + 1];
      const az = k[a + 2];
      const bx = k[b];
      const by = k[b + 1];
      const bz = k[b + 2];
      const cx = k[c];
      const cy = k[c + 1];
      const cz = k[c + 2];
      tri[o] = ax;
      tri[o + 1] = ay;
      tri[o + 2] = az;
      tri[o + 3] = bx;
      tri[o + 4] = by;
      tri[o + 5] = bz;
      tri[o + 6] = cx;
      tri[o + 7] = cy;
      tri[o + 8] = cz;
      // `Plane.copyFromPoints(p1, p2, p3)`.
      const ex1 = bx - ax;
      const ey1 = by - ay;
      const ez1 = bz - az;
      const ex2 = cx - ax;
      const ey2 = cy - ay;
      const ez2 = cz - az;
      const yz = ey1 * ez2 - ez1 * ey2;
      const xz = ez1 * ex2 - ex1 * ez2;
      const xy = ex1 * ey2 - ey1 * ex2;
      const pyth = Math.sqrt(yz * yz + xz * xz + xy * xy);
      const invPyth = pyth !== 0 ? 1.0 / pyth : 0.0;
      const nx = yz * invPyth;
      const ny = xz * invPyth;
      const nz = xy * invPyth;
      tri[o + 9] = nx;
      tri[o + 10] = ny;
      tri[o + 11] = nz;
      tri[o + 12] = -(nx * ax + ny * ay + nz * az);
    }
    const bb = this.boxes * AABB_STRIDE;
    this.aabb[bb] = x0;
    this.aabb[bb + 1] = y0;
    this.aabb[bb + 2] = z0;
    this.aabb[bb + 3] = x1;
    this.aabb[bb + 4] = y1;
    this.aabb[bb + 5] = z1;
    this.boxes++;
  }

  private grow(): void {
    const tri = new Float64Array(this.tri.length * 2);
    tri.set(this.tri);
    this.tri = tri;
    const aabb = new Float64Array(this.aabb.length * 2);
    aabb.set(this.aabb);
    this.aabb = aabb;
  }

  /**
   * Sweeps the ellipsoid centred at `(px, py, pz)` along `(dx, dy, dz)`, world
   * space, against every box handed in since `begin`, and writes where it
   * ended into `out` — `DefaultCollisionCoordinator.getNewPosition` and its
   * `_collideWithWorld`, with the recursion unrolled into the loop it always
   * was.
   *
   * The centre is the ELLIPSOID's: a body's position plus its
   * `ellipsoidOffset`, which is what `moveWithCollisions` opened with — though
   * Babylon read that position out of the FLOAT32 world matrix
   * (`getAbsolutePosition`), so a start bit-identical to its sweep is
   * `Math.fround(position) + offset`. Which start to use is the caller's
   * choice (`scripts/sweep-check.mjs` takes Babylon's to prove the port;
   * production takes the body's own float64 position), and so is what becomes
   * of the answer — the callback's millimetre gate and the write back — because
   * those are facts about a body and not about a sweep.
   */
  run(
    px: number,
    py: number,
    pz: number,
    dx: number,
    dy: number,
    dz: number,
    out: SweepResult,
  ): void {
    const rx = this.rx;
    const ry = this.ry;
    const rz = this.rz;
    const closeDistance = COLLISIONS_EPSILON * 10.0;
    // `divideToRef`, not a multiply by the reciprocal: that is how Babylon
    // took both into scaled space, and it rounds differently.
    let bx = px / rx;
    let by = py / ry;
    let bz = pz / rz;
    let vx = dx / rx;
    let vy = dy / ry;
    let vz = dz / rz;
    let path = 0;
    let fx: number;
    let fy: number;
    let fz: number;
    for (let retry = 0; ; retry++) {
      if (retry >= COLLISION_RETRIES) {
        fx = bx;
        fy = by;
        fz = bz;
        break;
      }
      this.initialize(bx, by, bz, vx, vy, vz);
      this.collideAll();
      if (!this.collisionFound) {
        fx = bx + vx;
        fy = by + vy;
        fz = bz + vz;
        path += Math.hypot(vx * rx, vy * ry, vz * rz);
        break;
      }
      if (vx !== 0 || vy !== 0 || vz !== 0) {
        // `_getResponse(pos, vel, true)`. `pos` IS the base point — the
        // coordinator hands the same vector to both — so writing one writes
        // the other, which is why the two are one variable here.
        const destX = bx + vx;
        const destY = by + vy;
        const destZ = bz + vz;
        const s = this.nearest / Math.sqrt(vx * vx + vy * vy + vz * vz);
        vx *= s;
        vy *= s;
        vz *= s;
        bx = bx + vx;
        by = by + vy;
        bz = bz + vz;
        // Two straight pieces — up to the contact, then off it — and counted
        // as two, so `path` bounds the reach even when they fold back.
        path += Math.hypot(vx * rx, vy * ry, vz * rz);
        let nx = bx - this.ix;
        let ny = by - this.iy;
        let nz = bz - this.iz;
        const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (nLen !== 0 && nLen !== 1.0) {
          const inv = 1.0 / nLen;
          nx *= inv;
          ny *= inv;
          nz *= inv;
        }
        // `closeDistance` is the collider's `_epsilon` too: the coordinator
        // initialises it with that.
        const ddx = nx * closeDistance;
        const ddy = ny * closeDistance;
        const ddz = nz * closeDistance;
        bx += ddx;
        by += ddy;
        bz += ddz;
        path += Math.hypot(ddx * rx, ddy * ry, ddz * rz);
        // Babylon moves the intersection point in place; nothing reads it again
        // before the next pass overwrites it, so here it is a local.
        const ipx = this.ix + ddx;
        const ipy = this.iy + ddy;
        const ipz = this.iz + ddz;
        // `Plane.SignedDistanceToPlaneFromPositionAndNormal(ip, n, dest)`.
        const d = -(nx * ipx + ny * ipy + nz * ipz);
        const sd = destX * nx + destY * ny + destZ * nz + d;
        nx *= sd;
        ny *= sd;
        nz *= sd;
        vx = destX - nx - ipx;
        vy = destY - ny - ipy;
        vz = destZ - nz - ipz;
      }
      if (Math.sqrt(vx * vx + vy * vy + vz * vz) <= closeDistance) {
        fx = bx;
        fy = by;
        fz = bz;
        break;
      }
    }
    // `_finalPosition.multiplyInPlace(collider._radius)`.
    out.x = fx * rx;
    out.y = fy * ry;
    out.z = fz * rz;
    out.path = path;
  }

  /**
   * `Collider._initialize`, less what only Babylon's own tests read: the
   * normalised velocity was for the back-face cull that never ran here, the
   * world-space velocity for a bounding test `collideAll` makes in scaled
   * space instead, and the epsilon is `run`'s `closeDistance` throughout.
   */
  private initialize(
    bx: number,
    by: number,
    bz: number,
    vx: number,
    vy: number,
    vz: number,
  ): void {
    this.bx = bx;
    this.by = by;
    this.bz = bz;
    this.vx = vx;
    this.vy = vy;
    this.vz = vz;
    this.velSq = vx * vx + vy * vy + vz * vz;
    this.collisionFound = false;
  }

  /**
   * One pass over every box: the coordinator's loop over `surroundingMeshes`,
   * each box standing for a mesh of one submesh. The bounding test is
   * Babylon's `IntersectBoxAaSphere` against the ball the sweep can reach —
   * which in scaled space is the unit sphere's radius plus the velocity's
   * length, around the base point.
   */
  private collideAll(): void {
    const reach = Math.sqrt(this.velSq) + 1 + CULL_PAD;
    const bx = this.bx;
    const by = this.by;
    const bz = this.bz;
    const aabb = this.aabb;
    for (let i = 0; i < this.boxes; i++) {
      const o = i * AABB_STRIDE;
      if (aabb[o] > bx + reach || bx - reach > aabb[o + 3]) continue;
      if (aabb[o + 1] > by + reach || by - reach > aabb[o + 4]) continue;
      if (aabb[o + 2] > bz + reach || bz - reach > aabb[o + 5]) continue;
      const first = i * TRIS_PER_BOX * TRI_STRIDE;
      for (let t = 0; t < TRIS_PER_BOX; t++) this.testTriangle(first + t * TRI_STRIDE);
    }
  }

  /**
   * `Collider._testTriangle` against triangle `o`, as it ran on every collider
   * in this game: with `hasMaterial` TRUE, so no face is skipped for facing
   * away from the motion. See the header on back faces.
   */
  private testTriangle(o: number): void {
    const tri = this.tri;
    const nx = tri[o + 9];
    const ny = tri[o + 10];
    const nz = tri[o + 11];
    const bx = this.bx;
    const by = this.by;
    const bz = this.bz;
    const vx = this.vx;
    const vy = this.vy;
    const vz = this.vz;
    const signedDist = bx * nx + by * ny + bz * nz + tri[o + 12];
    const normalDotVelocity = nx * vx + ny * vy + nz * vz;
    let t0: number;
    let embeddedInPlane = false;
    if (normalDotVelocity == 0) {
      if (Math.abs(signedDist) >= 1.0) return;
      embeddedInPlane = true;
      t0 = 0;
    } else {
      t0 = (-1.0 - signedDist) / normalDotVelocity;
      let t1 = (1.0 - signedDist) / normalDotVelocity;
      if (t0 > t1) {
        const temp = t1;
        t1 = t0;
        t0 = temp;
      }
      if (t0 > 1.0 || t1 < 0.0) return;
      if (t0 < 0) t0 = 0;
      if (t0 > 1.0) t0 = 1.0;
    }
    const ax = tri[o];
    const ay = tri[o + 1];
    const az = tri[o + 2];
    const bxx = tri[o + 3];
    const byy = tri[o + 4];
    const bzz = tri[o + 5];
    const cx = tri[o + 6];
    const cy = tri[o + 7];
    const cz = tri[o + 8];
    let found = false;
    let t = 1.0;
    if (!embeddedInPlane) {
      const px = bx - nx + vx * t0;
      const py = by - ny + vy * t0;
      const pz = bz - nz + vz * t0;
      if (pointInTriangle(px, py, pz, ax, ay, az, bxx, byy, bzz, cx, cy, cz, nx, ny, nz)) {
        found = true;
        t = t0;
        this.cpx = px;
        this.cpy = py;
        this.cpz = pz;
      }
    }
    if (!found) {
      const velSq = this.velSq;
      let a = velSq;
      // The three corners.
      let tx = bx - ax;
      let ty = by - ay;
      let tz = bz - az;
      let b = 2.0 * (vx * tx + vy * ty + vz * tz);
      let c = tx * tx + ty * ty + tz * tz - 1.0;
      let root = lowestRoot(a, b, c, t);
      if (root >= 0) {
        t = root;
        found = true;
        this.cpx = ax;
        this.cpy = ay;
        this.cpz = az;
      }
      tx = bx - bxx;
      ty = by - byy;
      tz = bz - bzz;
      b = 2.0 * (vx * tx + vy * ty + vz * tz);
      c = tx * tx + ty * ty + tz * tz - 1.0;
      root = lowestRoot(a, b, c, t);
      if (root >= 0) {
        t = root;
        found = true;
        this.cpx = bxx;
        this.cpy = byy;
        this.cpz = bzz;
      }
      tx = bx - cx;
      ty = by - cy;
      tz = bz - cz;
      b = 2.0 * (vx * tx + vy * ty + vz * tz);
      c = tx * tx + ty * ty + tz * tz - 1.0;
      root = lowestRoot(a, b, c, t);
      if (root >= 0) {
        t = root;
        found = true;
        this.cpx = cx;
        this.cpy = cy;
        this.cpz = cz;
      }
      // The three edges, each from its first corner: p1→p2, p2→p3, p3→p1.
      for (let e = 0; e < 3; e++) {
        let sx: number, sy: number, sz: number, ex: number, ey: number, ez: number;
        if (e === 0) {
          sx = ax; sy = ay; sz = az;
          ex = bxx - ax; ey = byy - ay; ez = bzz - az;
        } else if (e === 1) {
          sx = bxx; sy = byy; sz = bzz;
          ex = cx - bxx; ey = cy - byy; ez = cz - bzz;
        } else {
          sx = cx; sy = cy; sz = cz;
          ex = ax - cx; ey = ay - cy; ez = az - cz;
        }
        const btvx = sx - bx;
        const btvy = sy - by;
        const btvz = sz - bz;
        const edgeSq = ex * ex + ey * ey + ez * ez;
        const edgeDotVelocity = ex * vx + ey * vy + ez * vz;
        const edgeDotBaseToVertex = ex * btvx + ey * btvy + ez * btvz;
        a = edgeSq * -velSq + edgeDotVelocity * edgeDotVelocity;
        b =
          2 *
          (edgeSq * (vx * btvx + vy * btvy + vz * btvz) -
            edgeDotVelocity * edgeDotBaseToVertex);
        c =
          edgeSq * (1.0 - (btvx * btvx + btvy * btvy + btvz * btvz)) +
          edgeDotBaseToVertex * edgeDotBaseToVertex;
        root = lowestRoot(a, b, c, t);
        if (root >= 0) {
          const f = (edgeDotVelocity * root - edgeDotBaseToVertex) / edgeSq;
          if (f >= 0.0 && f <= 1.0) {
            t = root;
            found = true;
            this.cpx = sx + ex * f;
            this.cpy = sy + ey * f;
            this.cpz = sz + ez * f;
          }
        }
      }
    }
    if (!found) return;
    const distSq = t * t * this.velSq;
    if (!this.collisionFound || distSq < this.nearestSq) {
      this.ix = this.cpx;
      this.iy = this.cpy;
      this.iz = this.cpz;
      this.nearestSq = distSq;
      this.nearest = Math.sqrt(distSq);
      this.collisionFound = true;
    }
  }
}

/**
 * `Collider._checkPointInTriangle(point, pa, pb, pc, n)`: the three edge
 * crosses against the normal, in Babylon's order and with its strictness.
 */
function pointInTriangle(
  px: number,
  py: number,
  pz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  nx: number,
  ny: number,
  nz: number,
): boolean {
  const t1x = ax - px;
  const t1y = ay - py;
  const t1z = az - pz;
  const t2x = bx - px;
  const t2y = by - py;
  const t2z = bz - pz;
  let x = t1y * t2z - t1z * t2y;
  let y = t1z * t2x - t1x * t2z;
  let z = t1x * t2y - t1y * t2x;
  if (x * nx + y * ny + z * nz < 0) return false;
  const t3x = cx - px;
  const t3y = cy - py;
  const t3z = cz - pz;
  x = t2y * t3z - t2z * t3y;
  y = t2z * t3x - t2x * t3z;
  z = t2x * t3y - t2y * t3x;
  if (x * nx + y * ny + z * nz < 0) return false;
  x = t3y * t1z - t3z * t1y;
  y = t3z * t1x - t3x * t1z;
  z = t3x * t1y - t3y * t1x;
  return x * nx + y * ny + z * nz >= 0;
}
