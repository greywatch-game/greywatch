/**
 * rigJoints.ts — a soldier rig's joints as OUR hierarchy: each joint's local
 * transform as plain numbers, and its world matrix composed off them into a
 * float32 matrix the rig owns (`Joint.world`), which is what Babylon draws the
 * rig's meshes from and what every reader of a joint reads (`BABYLON_EXIT.md`
 * X4.1a).
 * Owns: `Joint`, `JointTree` (the composition, a fresh chain, and the two
 * hand-offs to and from a HOLDER), `JointHolder`, and the body's one MEASURE
 * (`measureBody`, the sphere the root's capsule used to answer).
 * Invariants:
 * - **No `@babylonjs/core`.** `src/math` only (`scripts/check-babylon-free.mjs`
 *   holds it as a root), so X4.1d can draw these matrices with no node behind
 *   them.
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
 * - **A HOLDER is the one way a joint leaves its tree**, and it is a RAGDOLL's:
 *   `RagdollSystem` hangs a corpse's bones on its pool's proxies (`hold`) and
 *   takes them back (`release`), each a replay of Babylon's
 *   `TransformNode.setParent` — the world kept, the local re-derived through
 *   an inverse and a `decompose`, Euler written back — operation for
 *   operation, since a corpse's frozen pose is those locals.
 *   `BABYLON_EXIT.md` X4.1b deletes both: a corpse's joints are then written
 *   off its bodies' poses.
 * Never: imports Babylon, allocates per compute, or reads a node's matrix.
 */
import { Matrix, Quaternion, Vector3, type QuaternionLike, type Vector3Like } from "../math";

/**
 * A pose a joint can be HELD in from outside its tree: a ragdoll bone's proxy
 * (`RagdollSystem`), read exactly as Babylon read an UNPARENTED
 * `TransformNode` — its position, its quaternion (or, absent one, its Euler)
 * and its scaling. A Babylon node satisfies it structurally.
 */
export interface JointHolder {
  readonly name: string;
  readonly position: Vector3Like;
  readonly rotation: Vector3Like;
  readonly rotationQuaternion: QuaternionLike | null;
  readonly scaling: Vector3Like;
}

/** One joint: its local channels, the parent it was built under, and its world. */
export class Joint {
  /** Where it hangs, as built. Never changes; a holder stands in for it. */
  readonly parent: Joint | null;
  /**
   * What holds it instead of `parent` while a ragdoll owns it — see the
   * header. Null for every living body.
   */
  holder: JointHolder | null = null;
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
const _held = new Matrix();
const _composed = new Matrix();
const _inverse = new Matrix();
const _parentWorld = new Matrix();
const _s = new Vector3();
const _t = new Vector3();
const _rq = new Quaternion();

/** One joint's local matrix, composed as `computeWorldMatrix` composed it. */
function composeLocal(j: Joint, out: Matrix): Matrix {
  Quaternion.RotationYawPitchRollToRef(j.rotation.y, j.rotation.x, j.rotation.z, _q);
  return Matrix.ComposeToRef(j.scaling, _q, j.position, out);
}

/** A holder's world: an unparented node's, a copy of its own local. */
function holderWorld(h: JointHolder, out: Matrix): Matrix {
  const q = h.rotationQuaternion;
  if (q) _rq.copyFrom(q);
  else Quaternion.RotationYawPitchRollToRef(h.rotation.y, h.rotation.x, h.rotation.z, _rq);
  return Matrix.ComposeToRef(h.scaling, _rq, h.position, out);
}

/** One joint's world off its parent's (or holder's), which must be current. */
function composeWorld(j: Joint): void {
  composeLocal(j, _local);
  if (j.holder) _local.multiplyToRef(holderWorld(j.holder, _held), j.world);
  else if (j.parent) _local.multiplyToRef(j.parent.world, j.world);
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
   * too. A held joint's chain stops at its holder.
   */
  computeChain(j: Joint): Matrix {
    if (!j.holder && j.parent) this.computeChain(j.parent);
    composeWorld(j);
    return j.world;
  }

  /**
   * Hangs `j` on `holder`, keeping its world: Babylon's `setParent(holder)`,
   * replayed.
   */
  hold(j: Joint, holder: JointHolder): void {
    this.reparent(j, holderWorld(holder, _parentWorld));
    j.holder = holder;
  }

  /** Hands `j` back to the parent it was built under, keeping its world. */
  release(j: Joint): void {
    if (!j.holder) return;
    const into = j.parent ? _parentWorld.copyFrom(this.computeChain(j.parent)) : null;
    this.reparent(j, into);
    j.holder = null;
  }

  /**
   * `TransformNode.setParent`'s arithmetic (Babylon 9.28,
   * `transformNode.pure.js`), with `newParentWorld` the new parent's FRESH
   * world (null for none): the joint's current world, rebuilt as setParent
   * rebuilds it — its local composed again, times its current parent's (or
   * holder's) fresh world, in place — times the inverse of the new parent's,
   * decomposed, the rotation written back as Euler since a joint never holds
   * a quaternion.
   */
  private reparent(j: Joint, newParentWorld: Matrix | null): void {
    composeLocal(j, _composed);
    if (j.holder) _composed.multiplyToRef(holderWorld(j.holder, _held), _composed);
    else if (j.parent) _composed.multiplyToRef(this.computeChain(j.parent), _composed);
    if (newParentWorld) {
      newParentWorld.invertToRef(_inverse);
      _composed.multiplyToRef(_inverse, _composed);
    }
    _composed.decompose(_s, _rq, _t);
    _rq.toEulerAnglesToRef(j.rotation);
    j.scaling.copyFrom(_s);
    j.position.copyFrom(_t);
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
