/**
 * rigJoints.ts — a rig's joints as OUR hierarchy: each joint's local
 * transform as plain numbers, and its world matrix composed off them into a
 * float32 matrix the rig owns (`Joint.world`), which is what our renderer
 * draws a body's segments from (`SoldierModel.writeRigDrawing`,
 * `BABYLON_EXIT.md` X4.1d) and what every reader of a joint reads (X4.1a) —
 * a soldier's, since X4.2a a hull's (`vehicleRig.ts`), and since X4.3b the
 * player's own VIEWMODEL (`viewTree.ts`, whose every segment our renderer
 * draws off these matrices: the opaque parts since X4.3c, the two glasses and
 * the kit card since X4.3d).
 * Owns: `Joint`, `JointTree` (the composition, and a fresh chain), the body's
 * one MEASURE (`measureBody`, the sphere the root's capsule used to answer),
 * and `RenderCache` — Babylon's render-id cache, reproduced for the one tree
 * whose readers must keep Babylon's answers (X4.3b).
 * Invariants:
 * - **No `@babylonjs/core`.** `src/math` only (`scripts/check-babylon-free.mjs`
 *   holds it as a root): these matrices are drawn with no node behind them
 *   (X4.1d).
 * - **A world matrix is what `TransformNode.computeWorldMatrix` gave for the
 *   same channels, bit for bit**: the local composed from its Euler through a
 *   yaw-pitch-roll QUATERNION into a float32 `Matrix` (`ComposeToRef`, scale
 *   and translation as stored), then `local.multiplyToRef(parentWorld)` — or a
 *   copy of the local for the root — with `src/math`'s copies of those classes
 *   (`math/vector.ts`, which compare bits). **Four things only the viewmodel
 *   has are modelled, and no rig sets them** (X4.3b): a QUATERNION that
 *   overrides the Euler while it is set (`rotationQuaternion`), a PIVOT
 *   (`setPivotPoint`, composed by Babylon's pivot path: pivot x scale x
 *   rotation x inverse pivot, the translation added after), an OUTSIDE root
 *   (the camera's world, read whenever the root is composed), and a FIXED
 *   local (a mesh's own transform, composed once). A billboard and a scaling
 *   determinant are not modelled: no joint has one.
 *   `soldierPose.ts`'s muzzle replay is the same arithmetic.
 * - **Every answer is FRESH, for a rig.** Nothing is cached between a write
 *   and a read: `compute` recomposes every joint, parents first, and
 *   `computeChain` one joint and its ancestors, which is what a forced
 *   `computeWorldMatrix(true)` was. Babylon's render-id cache is not
 *   reproduced there, and on purpose (the X4.1a note measures the one place it
 *   ever answered stale). **The viewmodel is the exception, and it is read
 *   through `RenderCache` instead**: two of its readers are COMMAND INPUTS (the
 *   grenade's release point and the rocket's start, `FINDINGS.md` 55), which
 *   Babylon answered off that cache, so a fresh answer there would move where
 *   a grenade leaves the hand (`BABYLON_EXIT.md` X4.3b, decided: bit for bit).
 * - **A POSED joint is the one way a joint leaves its tree, and it is a
 *   RAGDOLL's** (`BABYLON_EXIT.md` X4.1b): while `Joint.pose` holds a physics
 *   pose (`WorldBody.pose`'s seven numbers, or the pool's copy of them once a
 *   corpse has frozen) the joint's world IS that pose, composed at unit scale
 *   exactly as the pool's proxy node composed it before X4.1b, and its own
 *   channels and its parent are not read. Its children compose off it as off
 *   any parent. `RagdollSystem` sets it and `SoldierModel.resetSoldierPose`
 *   clears it — a pose left on a joint is the leak to fear, a respawned body
 *   drawn with that limb wherever the pose array says.
 * - **A viewmodel joint has ONE shape** (`viewJoint`): those four fields and
 *   the cache's `memo` are written, null, in one fixed order the moment
 *   `viewTree.ts` makes the joint, so the compose that every rig and hull
 *   also runs each frame meets two hidden classes, never one per order the
 *   fields happened to arrive in. A rig's joint never carries them (its shape
 *   is what `kit:hash` reads).
 * Never: imports Babylon, allocates per compute, or reads a node's matrix —
 * the one matrix it reads from outside is the camera's world, handed in as a
 * function by the viewmodel's root (`Joint.outside`), never fetched here.
 */
import { Matrix, Quaternion, Vector3, type MatrixLike, type Vector3Like } from "../math";

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
  /**
   * The quaternion that OVERRIDES `rotation` while it is set —
   * `TransformNode.rotationQuaternion`. The viewmodel's alone (both arms
   * always, the weapon on the turntable); null on every rig joint. Handing or
   * taking it is a SETTER in Babylon, which marks the node dirty: through a
   * `RenderCache`, say so (`RenderCache.markDirty`).
   */
  quaternion?: Quaternion | null;
  /**
   * The PIVOT, as `setPivotPoint` leaves it: the matrix `Translation(-p)` and
   * its inverse, or null. Set once, at build.
   */
  pivot?: Matrix | null;
  pivotInverse?: Matrix | null;
  /**
   * A local composed ONCE, read in place of the channels — a MESH's own
   * transform in the joint it hangs off, which never moves (`viewTree.ts`).
   */
  fixedLocal?: Matrix | null;
  /**
   * A root held off an OUTSIDE matrix — the camera's world, read every time
   * the root is composed, as Babylon's camera hands a child its world. Its own
   * channels are never read.
   */
  outside?: (() => MatrixLike) | null;
  /**
   * `RenderCache`'s bookkeeping for this joint, absent outside one. These six
   * are declared without initializers on purpose: a rig's joint never carries
   * them, so its shape — and what `kit:hash` reads off it — is unchanged; a
   * viewmodel joint is handed all six at once by `viewJoint`.
   */
  memo?: JointMemo | null;

  constructor(
    /** As the node was named, for a reader that digests a rig by name. */
    readonly name: string,
    parent: Joint | null,
  ) {
    this.parent = parent;
  }

  /**
   * A pivot at `p`, in the joint's own frame — `TransformNode.setPivotPoint`
   * in LOCAL space, operation for operation: `Translation(-p)` kept, used only
   * when it is not the identity, its inverse post-multiplied.
   */
  setPivotPoint(p: Vector3Like): void {
    const pivot = Matrix.TranslationToRef(-p.x, -p.y, -p.z, new Matrix());
    if (pivot.isIdentity()) {
      this.pivot = null;
      this.pivotInverse = null;
      return;
    }
    this.pivot = pivot;
    this.pivotInverse = pivot.invertToRef(new Matrix());
  }
}

// Scratch: the tree composes every drawn body every frame.
const _q = new Quaternion();
const _local = new Matrix();
const _pq = new Quaternion();
const _pt = new Vector3();
const UNIT = new Vector3(1, 1, 1);
const _scale = new Matrix();
const _rot = new Matrix();
const _pivoted = new Matrix();

/**
 * One joint's local matrix, composed as `computeWorldMatrix` composed it: the
 * quaternion if one is set and the Euler through yaw-pitch-roll if not, then
 * either `ComposeToRef` or, for a pivoted joint, Babylon's pivot path step for
 * step (scaling and rotation as matrices, pivot x scale x rotation, the
 * inverse pivot post-multiplied in place, the translation added last).
 */
function composeLocal(j: Joint, out: Matrix): Matrix {
  if (j.fixedLocal) return out.copyFrom(j.fixedLocal);
  const q = j.quaternion;
  if (!q) Quaternion.RotationYawPitchRollToRef(j.rotation.y, j.rotation.x, j.rotation.z, _q);
  const rotation = q ?? _q;
  if (!j.pivot) return Matrix.ComposeToRef(j.scaling, rotation, j.position, out);
  Matrix.ScalingToRef(j.scaling.x, j.scaling.y, j.scaling.z, _scale);
  rotation.toRotationMatrix(_rot);
  j.pivot.multiplyToRef(_scale, _pivoted);
  _pivoted.multiplyToRef(_rot, out);
  out.multiplyToRef(j.pivotInverse!, out);
  return out.addTranslationFromFloats(j.position.x, j.position.y, j.position.z);
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
  if (j.outside) {
    Matrix.FromArrayToRef(j.outside().m, 0, j.world);
    return;
  }
  composeLocal(j, _local);
  if (j.parent) _local.multiplyToRef(j.parent.world, j.world);
  else j.world.copyFrom(_local);
}

/**
 * Composes `j`'s own channels ONCE into its `fixedLocal` — a mesh's transform
 * in the joint it hangs off, which never moves after the build (`viewTree.ts`).
 */
export function fixLocal(j: Joint): void {
  j.fixedLocal = null;
  j.fixedLocal = composeLocal(j, new Matrix());
}

/**
 * Gives `j` the viewmodel's fields, all null, in one fixed order — the one
 * shape every viewmodel joint has (see the header). `viewTree.ts` calls it on
 * every joint it makes, before anything else is written to it.
 */
export function viewJoint(j: Joint): Joint {
  j.quaternion = null;
  j.pivot = null;
  j.pivotInverse = null;
  j.fixedLocal = null;
  j.outside = null;
  j.memo = null;
  return j;
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

/**
 * What `RenderCache` keeps of one joint — Babylon's `_currentRenderId`
 * (`stamp`), `_isDirty` (`dirty`, which only a SETTER raises: the quaternion
 * handed or taken), `_childUpdateId` and `_parentUpdateId`, and whether a
 * channel was WRITTEN since the last compose (each Babylon `Vector3`'s own
 * `_isDirty`, raised by any write, the same value included). Beside it, the
 * channels as they were last composed, so a write nobody reported is still
 * seen as soon as it changed a number.
 */
export interface JointMemo {
  stamp: number;
  dirty: boolean;
  written: boolean;
  childUpdate: number;
  parentUpdate: number;
  /** position, rotation, scaling, quaternion (NaN for none): thirteen numbers. */
  readonly snap: Float64Array;
}

// Scratch for `RenderCache`: a compose there recurses into the parent FIRST,
// so this is free again by the time the local is built.
const _cacheLocal = new Matrix();

function memoOf(j: Joint): JointMemo {
  return (j.memo ??= {
    stamp: -1,
    dirty: false,
    // A node never composed is never synchronized: a fresh Babylon `Vector3`
    // starts dirty.
    written: true,
    childUpdate: -1,
    parentUpdate: -1,
    snap: new Float64Array(13),
  });
}

function snapshot(j: Joint, s: Float64Array): void {
  s[0] = j.position.x;
  s[1] = j.position.y;
  s[2] = j.position.z;
  s[3] = j.rotation.x;
  s[4] = j.rotation.y;
  s[5] = j.rotation.z;
  s[6] = j.scaling.x;
  s[7] = j.scaling.y;
  s[8] = j.scaling.z;
  const q = j.quaternion;
  s[9] = q ? q.x : NaN;
  s[10] = q ? q.y : NaN;
  s[11] = q ? q.z : NaN;
  s[12] = q ? q.w : NaN;
}

function unmoved(j: Joint, s: Float64Array): boolean {
  const q = j.quaternion;
  if (!q !== Number.isNaN(s[12])) return false;
  return (
    s[0] === j.position.x &&
    s[1] === j.position.y &&
    s[2] === j.position.z &&
    s[3] === j.rotation.x &&
    s[4] === j.rotation.y &&
    s[5] === j.rotation.z &&
    s[6] === j.scaling.x &&
    s[7] === j.scaling.y &&
    s[8] === j.scaling.z &&
    (!q || (s[9] === q.x && s[10] === q.y && s[11] === q.z && s[12] === q.w))
  );
}

/**
 * **Babylon's render-id cache, reproduced over one tree** — the viewmodel's
 * (`viewTree.ts`, `BABYLON_EXIT.md` X4.3b), whose readers must keep the
 * answers Babylon gave when the joints were `TransformNode`s, because two of
 * them are command inputs (`FINDINGS.md` 55; the owner's decision: bit for
 * bit).
 *
 * The rule it reproduces is `TransformNode.computeWorldMatrix` unforced
 * (`read`, which is what `getAbsolutePosition` called) and
 * `Node.getWorldMatrix` (`world`): a joint already composed at the CURRENT
 * render id answers that composition — however its channels have moved since
 * — unless a setter dirtied it; one composed at an older id answers its
 * cached world if it and every ancestor are SYNCHRONIZED (nothing written,
 * no ancestor recomposed since), and is recomposed off its parent's
 * `getWorldMatrix` otherwise. Both branches stamp the joint with the current
 * id, and only a recompose touches the parent. The render id is BABYLON's
 * (`scene.getRenderId()`, handed in), because Babylon moves it in places this
 * file cannot see.
 *
 * **The render's own evaluation is the other half**: `evaluate` is what
 * `_evaluateActiveMeshes` did to each mesh it took, run by `viewTree.ts`
 * before the render at a PROVISIONAL id (negative and never repeated, so
 * nothing can answer to it), and `settle` hands every joint it stamped the real id from
 * inside the render, once Babylon has incremented it — so the next frame's
 * readers meet exactly the stamps Babylon's own evaluation left.
 *
 * Synchronization is the one approximation, and it is on the camera alone:
 * an outside root is synchronized while its matrix is unchanged, where
 * Babylon's camera also counts a change of PROJECTION. A synchronized answer
 * is always the answer a recompose would give, so all it can change is which
 * ANCESTORS a read stamps — and a stamp changes a later number only when, in
 * the same render id, the camera's projection has changed but not its world,
 * a chain the last render did not stamp is read, an ancestor on it is then
 * written, and a joint under that ancestor is read again. X4.3b's oracle met
 * none.
 */
export class RenderCache {
  /** The joints the current evaluation stamped provisionally. */
  private readonly pending: Joint[] = [];
  private provisional = Number.NaN;
  /**
   * The provisional ids, counting DOWN from -2 (a never-composed joint holds
   * -1, a real render id is never negative): one per evaluation, never
   * repeated, whether or not a render took the last one.
   */
  private seq = -1;

  constructor(private readonly renderId: () => number) {}

  /** A channel was written (any write: Babylon flags the same value too). */
  touch(j: Joint): void {
    memoOf(j).written = true;
  }

  /** A setter ran — the quaternion handed or taken (`_markAsDirtyInternal`). */
  markDirty(j: Joint): void {
    memoOf(j).dirty = true;
  }

  /** `computeWorldMatrix()` unforced, at the current render id: what `getAbsolutePosition` read. */
  read(j: Joint): Matrix {
    return this.compute(j, this.renderId());
  }

  /** `getWorldMatrix()`, at the current render id. */
  world(j: Joint): Matrix {
    return this.worldAt(j, this.renderId());
  }

  /** Opens an evaluation: the render about to run, at a provisional id. */
  beginEvaluation(): void {
    this.pending.length = 0;
    this.provisional = --this.seq;
  }

  /**
   * One mesh the render will take, evaluated as `_evaluateActiveMeshes`
   * computed it: true if its world was recomposed, false if the cache
   * answered.
   */
  evaluate(j: Joint): boolean {
    const before = memoOf(j).childUpdate;
    this.compute(j, this.provisional);
    return memoOf(j).childUpdate !== before;
  }

  /** Hands every joint the evaluation stamped the id the render really took. */
  settle(id: number): void {
    for (const j of this.pending) {
      const m = j.memo!;
      if (m.stamp === this.provisional) m.stamp = id;
    }
    this.pending.length = 0;
  }

  private stamp(j: Joint, m: JointMemo, id: number): void {
    if (m.stamp === id) return;
    m.stamp = id;
    if (id === this.provisional) this.pending.push(j);
  }

  private worldAt(j: Joint, id: number): Matrix {
    if (j.outside) return this.outsideWorld(j);
    if (memoOf(j).stamp !== id) this.compute(j, id);
    return j.world;
  }

  private compute(j: Joint, id: number): Matrix {
    if (j.outside) return this.outsideWorld(j);
    const m = memoOf(j);
    if (!m.dirty && (m.stamp === id || this.synced(j))) {
      this.stamp(j, m, id);
      return j.world;
    }
    this.stamp(j, m, id);
    m.childUpdate++;
    m.dirty = false;
    m.written = false;
    snapshot(j, m.snap);
    if (j.pose) {
      composePose(j.pose, j.world);
      return j.world;
    }
    const p = j.parent;
    if (p) {
      const parentWorld = this.worldAt(p, id);
      composeLocal(j, _cacheLocal);
      _cacheLocal.multiplyToRef(parentWorld, j.world);
      m.parentUpdate = memoOf(p).childUpdate;
    } else {
      composeLocal(j, j.world);
    }
    return j.world;
  }

  private synced(j: Joint): boolean {
    if (j.outside) return this.outsideSynced(j);
    const m = memoOf(j);
    const p = j.parent;
    if (p) {
      const pm = memoOf(p);
      if (pm.dirty || m.parentUpdate !== pm.childUpdate || !this.synced(p)) return false;
    }
    return !m.written && unmoved(j, m.snap);
  }

  /** A camera's world: always its current one, re-read on every ask. */
  private outsideWorld(j: Joint): Matrix {
    const m = memoOf(j);
    if (!this.outsideSynced(j)) {
      Matrix.FromArrayToRef(j.outside!().m, 0, j.world);
      m.childUpdate++;
      m.written = false;
    }
    return j.world;
  }

  private outsideSynced(j: Joint): boolean {
    const m = memoOf(j);
    if (m.written) return false;
    const src = j.outside!().m;
    const w = j.world.m;
    for (let i = 0; i < 16; i++) if (w[i] !== src[i]) return false;
    return true;
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
