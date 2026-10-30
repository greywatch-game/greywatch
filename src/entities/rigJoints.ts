/**
 * rigJoints.ts — a soldier rig's joints as OUR hierarchy: each joint's local
 * transform as plain numbers, and its world matrix composed off them into a
 * float32 matrix the rig owns (`Joint.world`), which is what our renderer
 * draws the body's segments from (`SoldierModel.writeRigDrawing`,
 * `BABYLON_EXIT.md` X4.1d) and what every reader of a joint reads (X4.1a).
 * Owns: `Joint`, `JointTree` (the composition, and a fresh chain), and the
 * body's one MEASURE (`measureBody`, the sphere the root's capsule used to
 * answer).
 * Invariants:
 * - **No `@babylonjs/core`.** `src/math` only (`scripts/check-babylon-free.mjs`
 *   holds it as a root): these matrices are drawn with no node behind them
 *   (X4.1d).
 * - **A world matrix is what `TransformNode.computeWorldMatrix(true)` gave for
 *   the same channels, bit for bit**: the local composed from its Euler through
 *   a yaw-pitch-roll QUATERNION into a float32 `Matrix` (`ComposeToRef`, scale
 *   and translation as stored), then `local.multiplyToRef(parentWorld)` — or a
 *   copy of the local for the root — with `src/math`'s copies of those classes
 *   (`math/vector.ts`, which compare bits). No joint here has a pivot, a
 *   billboard, a quaternion of its own or a scaling determinant, so none is
 *   modelled. `soldierPose.ts`'s muzzle replay is the same arithmetic.
 * - **Every answer is FRESH.** Nothing is cached between a write and a read:
 *   `compute` recomposes every joint, parents first, and `computeChain` one
 *   joint and its ancestors, which is what a forced `computeWorldMatrix(true)`
 *   was. Babylon's render-id cache is not reproduced, and on purpose (the
 *   X4.1a note measures the one place it ever answered stale).
 * - **A POSED joint is the one way a joint leaves its tree, and it is a
 *   RAGDOLL's** (`BABYLON_EXIT.md` X4.1b): while `Joint.pose` holds a physics
 *   pose (`WorldBody.pose`'s seven numbers, or the pool's copy of them once a
 *   corpse has frozen) the joint's world IS that pose, composed at unit scale
 *   exactly as the pool's proxy node composed it before X4.1b, and its own
 *   channels and its parent are not read. Its children compose off it as off
 *   any parent. `RagdollSystem` sets it and `SoldierModel.resetSoldierPose`
 *   clears it — a pose left on a joint is the leak to fear, a respawned body
 *   drawn with that limb wherever the pose array says.
 * Never: imports Babylon, allocates per compute, or reads a node's matrix.
 */
import { Matrix, Quaternion, Vector3 } from "../math";

/** One joint: its local channels, the parent it was built under, and its world. */
export class Joint {
  /** Where it hangs, as built. Never changes; a pose stands in for it. */
  readonly parent: Joint | null;
  /**
   * The physics pose it is drawn off instead of `parent` and its own channels
   * while a ragdoll owns it, `[px, py, pz, qx, qy, qz, qw]` — see the header.
   * Read at every compose, never copied. Null for every living body.
   */
  pose: ArrayLike<number> | null = null;
  /** The local channels, as `TransformNode` kept them: Euler, never a quaternion. */
  readonly position = new Vector3();
  readonly rotation = new Vector3();
  readonly scaling = new Vector3(1, 1, 1);
  /**
   * Its own switch: a joint switched off takes every mesh hung under it with
   * it (the slung launcher, `SoldierModel.setLauncher`).
   */
  enabled = true;
  /** Its world matrix, as last composed. Read it after `compute`/`computeChain`. */
  readonly world = new Matrix();

  constructor(
    /** As the node was named, for a reader that digests a rig by name. */
    readonly name: string,
    parent: Joint | null,
  ) {
    this.parent = parent;
  }
}

// Scratch: the tree composes every drawn body every frame.
const _q = new Quaternion();
const _local = new Matrix();
const _pq = new Quaternion();
const _pt = new Vector3();
const UNIT = new Vector3(1, 1, 1);

/** One joint's local matrix, composed as `computeWorldMatrix` composed it. */
function composeLocal(j: Joint, out: Matrix): Matrix {
  Quaternion.RotationYawPitchRollToRef(j.rotation.y, j.rotation.x, j.rotation.z, _q);
  return Matrix.ComposeToRef(j.scaling, _q, j.position, out);
}

/**
 * A physics pose as a world matrix: the unparented node the pool drew a bone
 * on until X4.1b, composed — its position and its quaternion as the pose holds
 * them (unnormalised, as Havok's sync wrote them), at unit scale.
 */
function composePose(p: ArrayLike<number>, out: Matrix): Matrix {
  _pq.set(p[3], p[4], p[5], p[6]);
  _pt.set(p[0], p[1], p[2]);
  return Matrix.ComposeToRef(UNIT, _pq, _pt, out);
}

/** One joint's world off its parent's, which must be current — or off its pose. */
function composeWorld(j: Joint): void {
  if (j.pose) {
    composePose(j.pose, j.world);
    return;
  }
  composeLocal(j, _local);
  if (j.parent) _local.multiplyToRef(j.parent.world, j.world);
  else j.world.copyFrom(_local);
}

/** A rig's joints, parents before children, as built. */
export class JointTree {
  readonly joints: Joint[] = [];

  /** A joint under `parent`, which must already be in this tree. */
  add(name: string, parent: Joint | null): Joint {
    const j = new Joint(name, parent);
    this.joints.push(j);
    return j;
  }

  /** Every joint's world, parents first. */
  compute(): void {
    for (let i = 0; i < this.joints.length; i++) composeWorld(this.joints[i]);
  }

  /**
   * One joint's world and every ancestor's on its way up, fresh — what
   * `computeWorldMatrix(true)` on the node was, which forced its ancestors
   * too. A posed joint's chain stops at it.
   */
  computeChain(j: Joint): Matrix {
    if (!j.pose && j.parent) this.computeChain(j.parent);
    composeWorld(j);
    return j.world;
  }
}

/** A body's world bounding sphere — `BoundingSphere`'s `centerWorld` and `radiusWorld`. */
export interface BodySphere {
  x: number;
  y: number;
  z: number;
  radius: number;
}

/**
 * The extents the rig ROOT's capsule had — `MeshBuilder.CreateCapsule({
 * height: 1.8, radius: 0.4 })`, whose vertex bounds read back as exactly
 * these — and the local sphere Babylon's `BoundingSphere.reConstruct` built
 * off them (centre the midpoint, radius half the diagonal).
 */
const BODY_MIN = new Vector3(-0.4, -0.9, -0.4);
const BODY_MAX = new Vector3(0.4, 0.9, 0.4);
const BODY_CENTER = BODY_MAX.add(BODY_MIN).scaleInPlace(0.5);
const BODY_RADIUS = Vector3.Distance(BODY_MIN, BODY_MAX) * 0.5;
const _c = new Vector3();
const _n = new Vector3();

/**
 * A body's one MEASURE: the world sphere of that capsule hung on the root's
 * world matrix — `BoundingSphere._update`, operation for operation (the
 * identity branch it takes for an identity matrix gives the same numbers for
 * a sphere centred at the origin, so it is not modelled). What `WorldCulling`
 * gates a whole body by (X1.3 left the capsule for X4.1a to take off).
 */
export function measureBody(rootWorld: Matrix, out: BodySphere): BodySphere {
  Vector3.TransformCoordinatesToRef(BODY_CENTER, rootWorld, _c);
  Vector3.TransformNormalFromFloatsToRef(1.0, 1.0, 1.0, rootWorld, _n);
  out.x = _c.x;
  out.y = _c.y;
  out.z = _c.z;
  out.radius = Math.max(Math.abs(_n.x), Math.abs(_n.y), Math.abs(_n.z)) * BODY_RADIUS;
  return out;
}
