/**
 * soldierBones.ts — the ragdoll's BONE TABLE, no Babylon: which joint each of
 * a soldier's twelve rigid bodies hangs off (`BoneJoint`), and each one's box
 * and mass in that joint's frame (`BoneSpec`, `RAGDOLL_BONES`).
 * Owns: those three, and nothing that draws or composes. `RagdollSystem` builds
 * a corpse's bodies from it; `core/proxyBoxes.ts` is what a soldier is to a
 * shadow by it, under the moon and under every lamp.
 * Invariants:
 * - **No `@babylonjs/core`.** Plain numbers and `soldierPose.ts`' skeleton
 *   measures only, so a module that needs a body's SHAPE need not load the
 *   rig that is drawn (`scripts/check-babylon-free.mjs` holds `proxyBoxes.ts`,
 *   which reads it, as a root). It was `SoldierModel.ts`'s until X4.1c's
 *   review moved it here verbatim (`BABYLON_EXIT.md`).
 * - **It is measured off `SoldierModel.ts`' box lists and moves when they
 *   move** — the reason it is not `CONFIG`'s (`BoneSpec`). The pins between
 *   the bones (`RAGDOLL_LINKS`) stay there, beside the shoulder and arm
 *   measures they are written in.
 * Never: imports Babylon or the rig; holds a joint, a node or a mesh.
 */
import { SHIN, THIGH } from "./soldierPose";

/** Which joint a ragdoll bone hangs off. Keys into `SoldierRig`. */
export type BoneJoint =
  | "torso"
  | "head"
  | "shoulderL"
  | "shoulderR"
  | "elbowL"
  | "elbowR"
  | "hipL"
  | "hipR"
  | "kneeL"
  | "kneeR"
  | "ankleL"
  | "ankleR";

/**
 * One rigid body's box, in its joint's own frame.
 *
 * These are ART constants and live beside the rig rather than in `CONFIG` for
 * the reason the file header gives: they are measured off `SoldierModel.ts`'
 * box lists and have to move when those move. A mass is not quite art, but it
 * is meaningless away from the extents it goes with, so the pair stays
 * together — what `CONFIG` owns is the sim (impulse, gravity, corpse life),
 * not the skeleton.
 *
 * The extents are the union of each limb's STRUCTURAL boxes, not a fitted hull:
 * a bot is a stack of blocks and a box per limb is exactly the right fidelity
 * for one. What is left out is kit — a radio antenna, a helmet's peak, a
 * respirator, a shroud, a glove — because a collider fatter than the body makes
 * a corpse hover, which is the same tell `terrainSlab` documents from the other
 * side, and none of those is what a body lands on.
 */
export interface BoneSpec {
  joint: BoneJoint;
  /** Full extents (not half), in the joint's frame. */
  size: [number, number, number];
  /** Box centre in the joint's frame — a limb hangs BELOW its joint. */
  center: [number, number, number];
  mass: number;
}

/**
 * The ragdoll's twelve bones, derived from `SoldierModel.ts`' segment box
 * lists. Extents are the union of a joint's boxes, trimmed inside the
 * silhouette — see `BoneSpec` for what that leaves out and why.
 *
 * **The legs are three bones apiece — thigh, shin and boot — because a body can
 * die crouched.** They were one rigid 0.72 m segment from hip to sole until
 * they had to be: a folded leg is that shape nowhere, so `RagdollSystem.spawn`
 * refused a body caught mid-crouch outright and the tween took it, which meant
 * the one stance a player holds while being shot at was also the one stance
 * that could not fall over. The three boxes here are the three the leg is
 * DRAWN from, hung off the same hip, knee and ankle the crouch bends, so the
 * collider now agrees with the mesh in every pose the rig can hold rather than
 * only in the standing one. There is still no spine. The arm was one welded
 * bone until it was given an elbow to put both hands on the rifle, and it is
 * two now, upper arm and forearm, hung off the same shoulder and elbow.
 *
 * The three masses split the leg's old 15 where the leg's own weight is
 * (8/5/2), and the arm's old 5 splits 3/2, so the body still totals 80 kg and
 * every number in `CONFIG.bots.death.impulse` means what it did when it was
 * tuned.
 *
 * **The rifle is deliberately NOT a bone.** It stays parented to `torso` and
 * rides that body for free. Giving it one would drop it out of hands that
 * cannot open — a fist has no finger to let go with — so the weapon would fall
 * away while two fists stayed cupped around nothing, which reads as a bug
 * rather than as a dropped weapon. What a corpse does instead is let its arms
 * fall off the rifle, which is what a body does.
 */
export const RAGDOLL_BONES: readonly BoneSpec[] = [
  // Chest: the carrier, the pack and the bandolier, y in [-0.03, 0.49]. The
  // collar reaches 0.54 and the antenna off the pack 0.79; neither is body.
  { joint: "torso", size: [0.42, 0.52, 0.3], center: [0, 0.23, -0.03], mass: 34 },
  // Helmet, face and visor, y in [-0.025, 0.245] with the neck trimmed off
  // below. Neither side's face — a
  // Valeguard peak, a Redline respirator and shroud — is inside this box.
  { joint: "head", size: [0.26, 0.26, 0.27], center: [0, 0.105, 0], mass: 6 },
  // Upper arm: shoulder to elbow, the pauldron trimmed off the top of it.
  {
    joint: "shoulderL",
    size: [0.13, 0.33, 0.13],
    center: [0, -0.14, 0],
    mass: 3,
  },
  {
    joint: "shoulderR",
    size: [0.13, 0.33, 0.13],
    center: [0, -0.14, 0],
    mass: 3,
  },
  // Forearm and glove, y in [-0.35, 0.035], the fingertips trimmed.
  {
    joint: "elbowL",
    size: [0.1, 0.36, 0.1],
    center: [0, -0.16, 0],
    mass: 2,
  },
  {
    joint: "elbowR",
    size: [0.1, 0.36, 0.1],
    center: [0, -0.16, 0],
    mass: 2,
  },
  // Thigh: hip to knee, y in [-THIGH, 0].
  { joint: "hipL", size: [0.17, THIGH, 0.18], center: [0, -THIGH / 2, 0], mass: 8 },
  { joint: "hipR", size: [0.17, THIGH, 0.18], center: [0, -THIGH / 2, 0], mass: 8 },
  // Shin: knee to ankle, y in [-SHIN, 0].
  { joint: "kneeL", size: [0.15, SHIN, 0.15], center: [0, -SHIN / 2, 0], mass: 5 },
  { joint: "kneeR", size: [0.15, SHIN, 0.15], center: [0, -SHIN / 2, 0], mass: 5 },
  // Boot: the one bone that is mostly forward of its joint, not below it.
  {
    joint: "ankleL",
    size: [0.17, 0.08, 0.24],
    center: [0, -0.02, 0.03],
    mass: 2,
  },
  {
    joint: "ankleR",
    size: [0.17, 0.08, 0.24],
    center: [0, -0.02, 0.03],
    mass: 2,
  },
];
