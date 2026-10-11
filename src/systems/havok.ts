/**
 * havok.ts — Havok's raw `HP_*` API in the one dialect the physics code
 * speaks: the handle types, the `[Result, value]` unwrapping, the enums, and
 * every call spelled exactly as Babylon's `HavokPlugin` spelled it.
 * Owns: nothing that lives — no body, no shape, no world. It holds the module
 * and the world handle it was given and turns a call into the call the plugin
 * would have made.
 * Invariants:
 * - **Babylon-free.** Its one import is `@babylonjs/havok`, and that one is a
 *   TYPE: the module itself is what `loadHavok` fetched and `main.ts` awaited,
 *   handed down through `PhysicsWorld`. Vectors and quaternions cross as
 *   Havok's own tuples (`[x, y, z]`, `[x, y, z, w]`), never as a class.
 * - **Call for call the plugin's.** `BABYLON_EXIT.md` X2.4 ports
 *   `PhysicsWorld` and its three clients off the plugin, and the bar is bits:
 *   the oracles (`plans/physics-ref/`) hash Havok's own poses, and a port that
 *   makes the plugin's calls in the plugin's order with the plugin's values is
 *   the only port that passes them. So each method here names the plugin
 *   method it replaces, and where the plugin made a READ alongside a write
 *   (the mass properties rebuilt off the shape, the filter's other half read
 *   back before it is set) the read is made too — a read the engine never
 *   needed is cheaper than an argument about whether it changed anything.
 * - **Results are not checked**, because the plugin checked none but one:
 *   `HP_Body_GetShape` and `HP_Shape_BuildMassProperties` in the mass rebuild,
 *   which fall back to a unit inertia exactly as it did. A handle is
 *   `[bigint]` and is passed back as the same array it came in.
 * Must never: hold state between calls beyond the module and the world, or
 *   decide anything — what a body is for is its client's business.
 */
import type {
  HavokPhysicsWithBindings,
  HP_BodyId,
  HP_ShapeId,
  HP_WorldId,
  MassProperties,
  MaterialCombine,
  MotionType,
  QTransform,
  Quaternion as HpQuaternion,
  Vector3 as HpVector3,
} from "@babylonjs/havok";

/** The instantiated WASM module — what `loadHavok` resolves to. */
export type HavokInstance = HavokPhysicsWithBindings;

export type BodyId = HP_BodyId;
export type ShapeId = HP_ShapeId;
export type WorldId = HP_WorldId;
/** `[x, y, z]`, as every `HP_*` call takes a vector. */
export type Vec3 = HpVector3;
/** `[x, y, z, w]`, as every `HP_*` call takes a quaternion. */
export type Quat = HpQuaternion;
export type Pose = QTransform;

/** The two motion types anything here uses (no KINEMATIC body exists). */
export type Motion = "static" | "dynamic";

export class Havok {
  /** The module's own enum values — embind objects, so never a literal. */
  private readonly STATIC: MotionType;
  private readonly DYNAMIC: MotionType;
  private readonly MINIMUM: MaterialCombine;
  private readonly MAXIMUM: MaterialCombine;

  constructor(
    readonly hk: HavokInstance,
    readonly world: WorldId,
  ) {
    this.STATIC = hk.MotionType.STATIC;
    this.DYNAMIC = hk.MotionType.DYNAMIC;
    this.MINIMUM = hk.MaterialCombine.MINIMUM;
    this.MAXIMUM = hk.MaterialCombine.MAXIMUM;
  }

  // --- the world ------------------------------------------------------------

  /**
   * One step of `dt` — `executeStep`'s two calls for the default region, in
   * its order. The plugin's prestep before it and sync after it are the
   * caller's (`PhysicsWorld.substep`).
   */
  step(dt: number): void {
    this.hk.HP_World_SetIdealStepTime(this.world, dt);
    this.hk.HP_World_Step(this.world, dt);
  }

  // --- shapes ---------------------------------------------------------------

  /** `initShape(BOX)`: `extents` is the FULL size, not the half. */
  box(center: Vec3, rotation: Quat, extents: Vec3): ShapeId {
    return this.hk.HP_Shape_CreateBox(center, rotation, extents)[1];
  }

  /** `initShape(CONTAINER)`. */
  container(): ShapeId {
    return this.hk.HP_Shape_CreateContainer()[1];
  }

  /**
   * `initShape(MESH)` past the `MeshAccumulator`: `positions` are three floats
   * a vertex, already in the shape's space, and `triangles` three indices a
   * triangle, already in Havok's winding (the caller reverses Babylon's — see
   * `PhysicsWorld.meshShape`). Both are copied into the WASM heap — positions
   * as float32, indices as int32, positions first — and freed in the plugin's
   * order once the shape has been built from them.
   */
  mesh(positions: ArrayLike<number>, triangles: ArrayLike<number>): ShapeId {
    const hk = this.hk;
    const nFloats = positions.length;
    const vAt = hk._malloc(nFloats * 4);
    const v = new Float32Array(hk.HEAPU8.buffer, vAt, nFloats);
    for (let i = 0; i < nFloats; i++) v[i] = positions[i];
    const nIdx = triangles.length;
    const tAt = hk._malloc(nIdx * 4);
    const t = new Int32Array(hk.HEAPU8.buffer, tAt, nIdx);
    for (let i = 0; i < nIdx; i++) t[i] = triangles[i];
    const shape = hk.HP_Shape_CreateMesh(vAt, nFloats / 3, tAt, nIdx / 3)[1];
    hk._free(tAt);
    hk._free(vAt);
    return shape;
  }

  /** `addChild`: the child's transform within the container. */
  addChild(parent: ShapeId, child: ShapeId, translation: Vec3, rotation: Quat, scale: Vec3): void {
    this.hk.HP_Shape_AddChild(parent, child, [translation, rotation, scale]);
  }

  /**
   * `setMaterial` with `{ friction, restitution }` and nothing else: static
   * friction defaults to the dynamic, friction combines by MINIMUM and
   * restitution by MAXIMUM — the plugin's defaults, and the reason a world
   * shape given NO material (Havok's 0.5) wins every friction pairing
   * (`FINDINGS.md` 53).
   */
  setMaterial(shape: ShapeId, friction: number, restitution: number): void {
    this.hk.HP_Shape_SetMaterial(shape, [friction, friction, restitution, this.MINIMUM, this.MAXIMUM]);
  }

  /** `setShapeFilterMembershipMask`: the collide half read back and kept. */
  setFilterMembership(shape: ShapeId, mask: number): void {
    const collide = this.hk.HP_Shape_GetFilterInfo(shape)[1][1];
    this.hk.HP_Shape_SetFilterInfo(shape, [mask, collide]);
  }

  /** `setShapeFilterCollideMask`: the membership half read back and kept. */
  setFilterCollide(shape: ShapeId, mask: number): void {
    const membership = this.hk.HP_Shape_GetFilterInfo(shape)[1][0];
    this.hk.HP_Shape_SetFilterInfo(shape, [membership, mask]);
  }

  /** `disposeShape`. A container's children are not released with it. */
  releaseShape(shape: ShapeId): void {
    this.hk.HP_Shape_Release(shape);
  }

  // --- bodies ---------------------------------------------------------------

  /**
   * `initBody`: created, typed, placed, and added to the world, in that order.
   * `position` and `orientation` are the node's ABSOLUTE pose as the plugin
   * read it — the caller's to get bit-for-bit.
   */
  createBody(motion: Motion, position: Vec3, orientation: Quat, startAsleep = false): BodyId {
    const hk = this.hk;
    const id = hk.HP_Body_Create()[1];
    hk.HP_Body_SetMotionType(id, this.motionOf(motion));
    hk.HP_Body_SetQTransform(id, [position, orientation]);
    hk.HP_World_AddBody(this.world, id, startAsleep);
    return id;
  }

  /**
   * `PhysicsBody.dispose`'s two engine calls: out of the world, then released.
   */
  destroyBody(id: BodyId): void {
    this.hk.HP_World_RemoveBody(this.world, id);
    this.hk.HP_Body_Release(id);
  }

  /**
   * `body.shape = shape`: the shape set, then the mass properties rebuilt off
   * it with the body's USER mass laid over them. `userMass` is the last mass
   * the client set on this body (`setMass`), or undefined if it never set one
   * — the plugin remembered it per body and re-applied it here, so a re-shaped
   * body takes its PREVIOUS mass first, and a client that sets a new one
   * straight after makes a second call (`DebrisSystem.cut`).
   */
  setShape(id: BodyId, shape: ShapeId, userMass?: number): void {
    this.hk.HP_Body_SetShape(id, shape);
    this.setMass(id, userMass);
  }

  /**
   * `setMassProperties({ mass })` — `_internalUpdateMassProperties`: the
   * shape's own properties, rebuilt, with only the mass replaced. The inertia
   * stays the shape's density-derived one. Undefined replaces nothing.
   */
  setMass(id: BodyId, mass?: number): void {
    const hk = this.hk;
    let props: MassProperties | null = null;
    const shape = hk.HP_Body_GetShape(id);
    if (shape[0] == hk.Result.RESULT_OK) {
      const built = hk.HP_Shape_BuildMassProperties(shape[1]);
      if (built[0] == hk.Result.RESULT_OK) props = built[1];
    }
    // The plugin's fallback when there is no shape to build from: unit inertia.
    props ??= [[0, 0, 0], 1, [1, 1, 1], [0, 0, 0, 1]];
    if (mass != undefined) props[1] = mass;
    hk.HP_Body_SetMassProperties(id, props);
  }

  setMotion(id: BodyId, motion: Motion): void {
    this.hk.HP_Body_SetMotionType(id, this.motionOf(motion));
  }

  setLinearDamping(id: BodyId, damping: number): void {
    this.hk.HP_Body_SetLinearDamping(id, damping);
  }

  setAngularDamping(id: BodyId, damping: number): void {
    this.hk.HP_Body_SetAngularDamping(id, damping);
  }

  setLinearVelocity(id: BodyId, v: Vec3): void {
    this.hk.HP_Body_SetLinearVelocity(id, v);
  }

  setAngularVelocity(id: BodyId, w: Vec3): void {
    this.hk.HP_Body_SetAngularVelocity(id, w);
  }

  linearVelocity(id: BodyId): Vec3 {
    return this.hk.HP_Body_GetLinearVelocity(id)[1];
  }

  angularVelocity(id: BodyId): Vec3 {
    return this.hk.HP_Body_GetAngularVelocity(id)[1];
  }

  /** `applyImpulse(impulse, location)` — Havok takes the LOCATION first. */
  applyImpulse(id: BodyId, impulse: Vec3, location: Vec3): void {
    this.hk.HP_Body_ApplyImpulse(id, location, impulse);
  }

  applyAngularImpulse(id: BodyId, impulse: Vec3): void {
    this.hk.HP_Body_ApplyAngularImpulse(id, impulse);
  }

  /**
   * A TELEPORT — `setPhysicsBodyTransformation`'s one engine call, which the
   * plugin's prestep made for every body whose prestep was on.
   */
  setPose(id: BodyId, position: Vec3, orientation: Quat): void {
    this.hk.HP_Body_SetQTransform(id, [position, orientation]);
  }

  /** Where Havok holds the body: `[[x, y, z], [x, y, z, w]]`, unnormalised. */
  pose(id: BodyId): Pose {
    return this.hk.HP_Body_GetQTransform(id)[1];
  }

  private motionOf(motion: Motion): MotionType {
    return motion === "dynamic" ? this.DYNAMIC : this.STATIC;
  }
}
