/**
 * poseView.ts — Where a physics body's pose meets what it is DRAWN as: the
 * debris pools' pieces (`DebrisSystem`'s shards, `BlastDebrisSystem`'s
 * chunks), which our renderer draws straight off their bodies' pose arrays
 * since `BABYLON_EXIT.md` X4.4c (`Game.drawDebris`, `render/PoolDraw.ts`) — as
 * a corpse's joints have been posed off them since X4.1b — and the writes
 * that carry a pose into a body's array.
 * Owns: `PosedPiece` (a body, the scale it is drawn at, its switch, its local
 * bounding sphere, and the GATE sphere the size gate reads — see below),
 * `writePosedDrawing`, `parkedPose`, `storePose` (shared with
 * `RagdollSystem`'s placing of a bone) and `parkPose`. `PhysicsWorld` keeps
 * each body's pose as seven plain numbers (`WorldBody.pose`) and never sees
 * a drawing; this is the client side of that line.
 * Invariants:
 * - **A piece's world is the MESH it replaced, number for number**: until
 *   X4.4c a body's pose was written onto an unparented mesh's raw `position`
 *   and `rotationQuaternion` (the Babylon plugin's simple branch, which every
 *   body here was on: its sync wrote the two, unnormalised) and Babylon
 *   composed its world from those and its `scaling` (`Matrix.ComposeToRef`);
 *   `writePosedDrawing` composes the same three the same way (`src/math`, bit
 *   for bit) off the pose as it stands when the frame is drawn — which is
 *   where the mesh was left, every write having followed the step that moved
 *   it, the sink that lowered it or the burst that placed it.
 * - **The size gate reads the GATE sphere, and it LATCHES as Babylon's did**
 *   (`docs/rendering.md`, "A WRONG DROP LATCHES"; `FINDINGS.md` 58, kept
 *   here byte for byte and the owner's to undo): the world bounding sphere as
 *   of the last frame the mesh's world was COMPUTED — which Babylon did only
 *   for a candidate the gate let through — and before that what its bounds
 *   were built at: a chunk's local sphere carried by the PARKED world its
 *   creation read computed (a kilometre under the map, where the gate drops a
 *   15 cm box at any range, so no chunk is ever drawn), and a shard's local
 *   sphere under the IDENTITY after every cut (`setLocal`: `updateVerticesData`
 *   rebuilt the bounds with no world matrix), so a shard is gated once per
 *   burst from the eye to the MAP'S ORIGIN. A piece the gate keeps is drawn
 *   with THIS frame's world, and its gate sphere becomes this frame's.
 * - **`parkedPose` is the plugin's creation read of a mesh standing parked**:
 *   an unparented node at `(0, y, 0)` with an identity quaternion and unit
 *   scale, whose world matrix's translation and decomposed rotation are
 *   exactly `[0, y, 0, 0, 0, 0, 1]` for any `y` a float32 holds (measured:
 *   both pools' bodies start as it).
 * Never: imports Babylon; decides anything — it copies and composes numbers.
 * (`PhysicsWorld` and `havok.ts` reach no drawing and do not import it.)
 * Contract: `docs/deaths.md`, "Havok, called directly", and
 * `docs/rendering.md`, "The pools, ours".
 */
import { worldSphere, type PieceGate } from "../entities/pieces";
import { Matrix, Quaternion, Vector3, type QuaternionLike, type Vector3Like } from "../math";

/** A sphere: its centre and its radius. */
interface Sphere {
  x: number;
  y: number;
  z: number;
  radius: number;
}

/** A pooled piece of debris as its drawing sees it: a pose, a scale, a switch and its bounds. */
export class PosedPiece {
  /** The mesh's `setEnabled`: drawn only while it is on. */
  enabled = false;
  /** The mesh's `scaling`, all three axes: a chunk's surface size, a shard's 1. */
  scale = 1;
  /** Its bounds as last built, in its own frame: the centre and the radius (`BoundingSphere.reConstruct`). */
  private readonly centre = new Vector3();
  private radius = 0;
  /** The world sphere the size gate reads — see the header. */
  readonly gate: Sphere = { x: 0, y: 0, z: 0, radius: 0 };
  /** This frame's world, and the world sphere it carries the bounds to (`writePosedDrawing`'s). */
  readonly world = new Matrix();
  readonly sphere: Sphere = { x: 0, y: 0, z: 0, radius: 0 };

  constructor(readonly body: { readonly pose: ArrayLike<number> }) {}

  /**
   * Its bounds built off the extent of its positions (`extractMinAndMax`,
   * then `BoundingSphere.reConstruct`), under the IDENTITY — a mesh's
   * `updateVerticesData(…, true)`, which a shard's cut is — so the gate
   * sphere is the local one.
   */
  setLocal(positions: ArrayLike<number>): void {
    const min = _min.setAll(Number.MAX_VALUE);
    const max = _max.setAll(-Number.MAX_VALUE);
    for (let k = 0; k < positions.length; k += 3) {
      min.minimizeInPlaceFromFloats(positions[k], positions[k + 1], positions[k + 2]);
      max.maximizeInPlaceFromFloats(positions[k], positions[k + 1], positions[k + 2]);
    }
    this.radius = Vector3.Distance(min, max) * 0.5;
    max.addToRef(min, this.centre).scaleInPlace(0.5);
    this.gate.x = this.centre.x;
    this.gate.y = this.centre.y;
    this.gate.z = this.centre.z;
    this.gate.radius = this.radius;
  }

  /**
   * Its bounds built off its positions, and COMPUTED once at its creation
   * pose — what a mesh built with them, parked and read for its body
   * (`parkedPose`), held: the gate sphere the local one carried by that
   * world.
   */
  build(positions: ArrayLike<number>, at: ArrayLike<number>): void {
    this.setLocal(positions);
    this.compose(at);
    worldSphere(this.centre, this.radius, this.world, this.gate);
  }

  /** Its world off `pose` (position, quaternion) and its scale: `computeWorldMatrix`'s arithmetic. */
  compose(pose: ArrayLike<number>): void {
    _position.set(pose[0], pose[1], pose[2]);
    _turn.set(pose[3], pose[4], pose[5], pose[6]);
    _scaling.setAll(this.scale);
    Matrix.ComposeToRef(_scaling, _turn, _position, this.world);
  }

  /** This frame's world sphere, after `compose`. */
  measure(): void {
    worldSphere(this.centre, this.radius, this.world, this.sphere);
  }
}

// Scratch: every live piece is composed every frame.
const _min = new Vector3();
const _max = new Vector3();
const _position = new Vector3();
const _scaling = new Vector3();
const _turn = new Quaternion();

/**
 * One piece's drawing, if it has one this frame: switched on, its world
 * (`p.world`) composed off its body's pose as it stands and its world sphere
 * (`p.sphere`) measured, then asked of the size gate on its GATE sphere —
 * kept, its gate sphere becomes this frame's (the mesh COMPUTED as a
 * candidate). Returns whether it is drawn; `p.world` and `p.sphere` are
 * this frame's either way, and the caller writes the world into its draw
 * once it has ordered the pieces (`Game.debrisPull`).
 */
export function writePosedDrawing(p: PosedPiece, keeps: PieceGate): boolean {
  if (!p.enabled) return false;
  p.compose(p.body.pose);
  p.measure();
  const g = p.gate;
  if (!keeps(g.x, g.y, g.z, g.radius)) return false;
  g.x = p.sphere.x;
  g.y = p.sphere.y;
  g.z = p.sphere.z;
  g.radius = p.sphere.radius;
  return true;
}

/**
 * Where a parked body is created: `[px, py, pz, qx, qy, qz, qw]` as the
 * plugin's `PhysicsBody` constructor read it off a mesh standing at
 * `(0, y, 0)` — see the header.
 */
export function parkedPose(y: number): number[] {
  return [0, y, 0, 0, 0, 0, 1];
}

/** Places a body: a position and an orientation written into its pose. */
export function storePose(pose: Float64Array, position: Vector3Like, rotation: QuaternionLike): void {
  pose[0] = position.x;
  pose[1] = position.y;
  pose[2] = position.z;
  pose[3] = rotation.x;
  pose[4] = rotation.y;
  pose[5] = rotation.z;
  pose[6] = rotation.w;
}

/**
 * Parks a debris body's pose at `(0, y, 0)` with its orientation KEPT — a
 * shard or a chunk keeps whatever turn it last wore, as it always has. The
 * engine half of a park is the caller's (`PhysicsWorld.park`), after this.
 */
export function parkPose(pose: Float64Array, y: number): void {
  pose[0] = 0;
  pose[1] = y;
  pose[2] = 0;
}
