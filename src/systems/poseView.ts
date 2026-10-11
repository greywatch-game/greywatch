/**
 * poseView.ts — Where a physics body's pose meets the Babylon node it is drawn
 * as: the one read that places a new body where its node stands, and the
 * writes that carry a pose between a node's vectors and the body's array.
 * Owns: nothing — five functions, shared by the three physics clients' VIEWS
 * (`RagdollSystem`'s proxies, `DebrisSystem`'s shards, `BlastDebrisSystem`'s
 * chunks). `PhysicsWorld` keeps each body's pose as seven plain numbers
 * (`WorldBody.pose`, `BABYLON_EXIT.md` X2.4 C5) and never sees a node; this is
 * the client side of that line.
 * Invariants:
 * - **A posed node is UNPARENTED and carries a `rotationQuaternion`.** That is
 *   the Babylon plugin's simple branch, which every body here was on: it read
 *   a body's teleport off the node's raw `position` and `rotationQuaternion`
 *   and synced back into the same two, unnormalised — so `applyPose` is that
 *   sync's write, number for number, and a node drawn by it is the node the
 *   plugin left. A corpse's bone is drawn on a pool-owned PROXY for exactly
 *   this reason (the rig's joint hangs off it; see `RagdollSystem`).
 * - **`absolutePose` is the plugin's read at a body's CREATION, side effects
 *   and all**: `absolutePosition` computes the node's world matrix (a float32
 *   matrix, so the translation comes back rounded to float32) and
 *   `absoluteRotationQuaternion` decomposes it. A client hands the result to
 *   `PhysicsWorld.addBody`. On a mesh that computation also refreshes its
 *   bounding info, which the plugin's read did too — see `FINDINGS.md` on the
 *   rubble that never draws for why that is not a detail to tidy away.
 * Must never: decide anything — it copies numbers. (`PhysicsWorld` and
 *   `havok.ts` reach no node and do not import it, by CONVENTION: this file's
 *   Babylon imports are types, so `scripts/check-babylon-free.mjs` could not
 *   tell if they did.)
 */
import type { Quaternion, TransformNode, Vector3 } from "@babylonjs/core";

/**
 * The node's ABSOLUTE pose as `[px, py, pz, qx, qy, qz, qw]` — what the
 * plugin's `PhysicsBody` constructor read off the node it was built on.
 */
export function absolutePose(node: TransformNode): number[] {
  if (node.parent) node.computeWorldMatrix(true);
  const p = node.absolutePosition;
  const q = node.absoluteRotationQuaternion;
  return [p.x, p.y, p.z, q.x, q.y, q.z, q.w];
}

/**
 * Draws a body: its pose written onto the node's raw `position` and
 * `rotationQuaternion`, as the plugin's sync wrote them.
 */
export function applyPose(pose: ArrayLike<number>, node: TransformNode): void {
  node.position.set(pose[0], pose[1], pose[2]);
  node.rotationQuaternion!.set(pose[3], pose[4], pose[5], pose[6]);
}

/** Places a body: a position and an orientation written into its pose. */
export function storePose(pose: Float64Array, position: Vector3, rotation: Quaternion): void {
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
 * shard or a chunk keeps whatever turn it last wore, as it always has — and
 * draws it there at once. The engine half of a park is the caller's
 * (`PhysicsWorld.park`), after this.
 */
export function parkPose(pose: Float64Array, node: TransformNode, y: number): void {
  pose[0] = 0;
  pose[1] = y;
  pose[2] = 0;
  applyPose(pose, node);
}

/** A pooled piece of debris as its view sees it: a pose, and the mesh it is drawn on. */
export interface PosedPiece {
  readonly body: { readonly pose: ArrayLike<number> };
  readonly mesh: TransformNode;
}

/**
 * Draws a burst: the first `live` of its pieces, each from its body's pose
 * onto its mesh, in pool order — a debris pool's `drawLive`, once per burst.
 */
export function drawPieces(pieces: readonly PosedPiece[], live: number): void {
  for (let i = 0; i < live; i++) {
    const p = pieces[i];
    applyPose(p.body.pose, p.mesh);
  }
}
