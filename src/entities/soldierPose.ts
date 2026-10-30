/**
 * soldierPose.ts — What a soldier's pose IS, as numbers: the `SoldierPose` a
 * body's motion fills, the joint channels it solves to (`SoldierJoints`), the
 * skeleton's measures that solve stands on, and the rifle's MUZZLE replayed
 * off those channels.
 * Owns: `SoldierPose` and `REST_POSE`, `SoldierJoints` and `solveSoldier` (the
 * crouch, the gait's two legs, the spine, the head and the rifle — every joint
 * a pose moves except the two ARMS), the skeleton constants those read, and
 * `soldierMuzzleToRef`.
 * Invariants:
 * - **No `@babylonjs/core`.** It is `src/math` and `CONFIG` only, so the
 *   simulation can ask where a bot's rifle is without a rig, and the server
 *   without a scene. `SoldierModel` is the one place a solved pose becomes a
 *   joint transform (`poseSoldier`), and it reads the constants from HERE so the
 *   drawing and the arithmetic cannot drift.
 * - **`soldierMuzzleToRef` is the node chain, bit for bit.** It replays exactly
 *   what Babylon's `TransformNode.computeWorldMatrix(true)` does down root →
 *   body → torso → gun → muzzle — each node's local matrix composed from its
 *   Euler channels through a yaw-pitch-roll QUATERNION into a float32
 *   `Matrix`, then multiplied by its parent's world matrix — with `src/math`'s
 *   copies of those classes (`math/vector.ts`, which compare bits). A float64
 *   trig version of the same geometry is a different number and moves the
 *   fight hash. A joint moved on the muzzle's path, or an offset changed in
 *   `buildSoldier`, is a change HERE, since the rig builds from these. The
 *   rig's own joints are composed by the same arithmetic since X4.1a
 *   (`rigJoints.ts`), so the replay and the drawn muzzle are one number.
 * - The ARMS are not here: they are solved onto wherever this put the rifle,
 *   are on no path anything but the picture reads, and stay with the rig.
 * Never: allocates (the solve runs per body per frame), holds state beyond its
 * own scratch, or reads a node.
 */
import { CONFIG } from "../config";
import { clamp } from "../core/math";
import { Matrix, Quaternion, Vector3, type Vector3Ref } from "../math";

/** Height of the rig's root (the body centre) above the feet. */
export const CENTER_HEIGHT = 0.9;

/**
 * The leg, in segments, measured off the box lists in `buildSoldier`.
 *
 * The knee sits at the bottom of the thigh box and the ankle at the bottom of
 * the shin box, so at rest every one of these joints is at zero and the drawn
 * leg is exactly what it was before the joints existed. `LEG_SPAN` is the hip's
 * height above the ankle standing, which is what the crouch's inverse kinematics
 * solves against — it is not the leg's full length, because the boot hangs
 * below the ankle and is rigid.
 *
 * **The leg has to REACH THE GROUND, and nothing typed checks that it does.**
 * The rig's root stands `centerHeight` (0.9) over the feet and the hips hang
 * 0.02 below `body`, so a standing hip is 0.88 m up — and `LEG_SPAN` plus the
 * sole's 0.07 under the ankle has to be exactly that. It was 0.34 + 0.32 for
 * the whole life of the rig, and every soldier in the game stood 0.15 m off the
 * floor (measured in a round: the lowest vertex of every standing bot, 0.11 to
 * 0.18 above its feet). The head and the torso were right — they are where the
 * eye and the hit sphere are — so it is the legs that were short, not the body
 * that was high. Retune any of the four and re-measure.
 */
export const THIGH = 0.415;
export const SHIN = 0.395;
const LEG_SPAN = THIGH + SHIN;

/** The head joint's height above the torso joint. Moves with the box lists. */
export const HEAD_ABOVE_TORSO = 0.52;

/** The torso joint's height above `body`. */
export const TORSO_Y = 0.1;

/**
 * How far a full crouch takes the body DOWN, and it is read from the eye rather
 * than authored here.
 *
 * This is the number that makes the pose honest. `Player.syncCombatant` drops
 * the eye and the hit sphere by the same half metre on the same blend, and the
 * sphere's top therefore keeps its standing relation to the eye — so a crouched
 * body drawn any shallower than the eye fell is a helmet standing above a sphere
 * that no longer reaches it, which is the visible-but-unhittable failure
 * `config/player.ts` spends its longest comment preventing. Deriving it here
 * means the two cannot drift: retune the crouch and the pose follows.
 *
 * `player.height / 2 - player.crouchCenterHeight` is the same 0.5 m from the
 * sphere's side, and the pair being equal is the invariant, not a coincidence.
 */
const CROUCH_DROP = CONFIG.camera.eyeHeight - CONFIG.player.crouchEyeHeight;

/**
 * Forward lean of the spine at full crouch, radians.
 *
 * Kept modest deliberately. A deeper lean would buy some of the drop for free —
 * the head hangs `HEAD_ABOVE_TORSO` off the spine, so pitching it lowers the
 * helmet without folding the legs — but it swings the head FORWARD by the same
 * geometry, and past ~30 degrees that carries it outside the very sphere it is
 * supposed to sit in. At 0.3 rad the head lands 0.15 m forward of the axis and
 * 0.64 m from the sphere's centre, inside a radius of 0.7 with room to spare.
 */
const CROUCH_LEAN = 0.3;

/** The rifle's joint in the torso's frame. */
export const GUN_AT: readonly [number, number, number] = [0.1, 0.22, 0.22];

/** The muzzle landmark in the rifle's frame — the end of the barrel. */
export const MUZZLE_AT: readonly [number, number, number] = [0, 0.01, 0.56];

/**
 * Which way `rotation.z` on a hip carries the foot: +1 if a positive roll moves
 * the boot toward +x. READ off the matrix — what `rotation.z` does to a limb
 * hanging down its own -y — rather than argued from a handedness that is easy
 * to get backwards. `src/math`'s matrix is Babylon's, so the answer is the
 * rig's.
 */
const ROLL_TO_X =
  Vector3.TransformCoordinates(new Vector3(0, -1, 0), Matrix.RotationZ(1)).x > 0 ? 1 : -1;

/**
 * Everything a pose is a function of. `SoldierMotion` fills one per body per
 * frame from the body's own motion; `REST_POSE` is a body standing still with
 * the rifle up.
 *
 * Every field is a number a remote client can arrive at from what it is sent,
 * which is what keeps a bot and a person drawn by the same rules: the gait from
 * ground actually covered, the kick and the reload from the `fire` and `reload`
 * events the authority already broadcasts. The one exception is `ready`'s
 * `alert` input, which only an offline bot passes — see `SoldierMotion`.
 */
export interface SoldierPose {
  /**
   * Gait phase, radians, advanced by distance. The LEFT boot's place along the
   * line of travel is `sin(phase)` — so it lands at pi/2 and the right one at
   * 3pi/2, which is the footfall test `SoldierMotion.step` makes.
   */
  phase: number;
  /** 0..1, how much of a gait to play. */
  moving: number;
  /** 0 walk .. 1 run: knee drive, lean, flight and cadence. */
  run: number;
  /**
   * The hip's swing either side of vertical along the line of travel, radians.
   * Sized from the step so a planted boot slides as little as a leg that is
   * not IK'd to the ground can manage.
   */
  stride: number;
  /**
   * Which way the body is travelling, relative to where its FEET point:
   * 0 forward, +pi/2 to its right, pi backward. What turns one gait into a
   * strafe and a backpedal.
   */
  heading: number;
  /** Aim pitch, radians, positive UP — `EntityState.pitch`'s sign. */
  aim: number;
  /** Upper-body yaw off the feet, radians. */
  twist: number;
  /** 0 standing .. 1 fully crouched. */
  crouch: number;
  /** 0 low ready .. 1 shouldered. */
  ready: number;
  /** 0..1, the rifle carried across the chest at a sprint. */
  carry: number;
  /** 0..1, how much of the last round's kick is still in the body. */
  kick: number;
  /** Progress through a magazine change, 0..1; exactly 0 when not changing one. */
  reload: number;
}

/** A body standing still, rifle shouldered — what a reset poses. */
export const REST_POSE: Readonly<SoldierPose> = {
  phase: 0,
  moving: 0,
  run: 0,
  stride: 0,
  heading: 0,
  aim: 0,
  twist: 0,
  crouch: 0,
  ready: 1,
  carry: 0,
  kick: 0,
  reload: 0,
};

/**
 * A pose SOLVED: the value every joint channel `solveSoldier` decides takes,
 * which is exactly what `SoldierModel.poseSoldier` writes onto the nodes (the
 * arms aside, which it solves itself off the rifle). A channel not named here
 * is zero on a posed rig — `body.rotation`, a hip's yaw, the knees' and
 * ankles' yaw and roll — and `resetSoldierPose` puts the rest back.
 */
export interface SoldierJoints {
  /** `body.position.y`: where the hips stand for the planted boot. */
  bodyY: number;
  torsoX: number;
  torsoY: number;
  torsoZ: number;
  headX: number;
  headY: number;
  headZ: number;
  /** The rifle's Euler in the torso's frame. */
  gunX: number;
  gunY: number;
  gunZ: number;
  /** The rifle's joint in the torso's frame. */
  gunPX: number;
  gunPY: number;
  gunPZ: number;
  hipLX: number;
  hipLZ: number;
  hipRX: number;
  hipRZ: number;
  kneeL: number;
  kneeR: number;
  ankleL: number;
  ankleR: number;
  /**
   * The magazine change's progress, carried through unsolved: it moves no
   * joint here and is what the rig's left HAND plays (`poseSoldier`).
   */
  reload: number;
}

/** A fresh set of channels, solved at `REST_POSE`. */
export function newSoldierJoints(): SoldierJoints {
  const j: SoldierJoints = {
    bodyY: 0,
    torsoX: 0,
    torsoY: 0,
    torsoZ: 0,
    headX: 0,
    headY: 0,
    headZ: 0,
    gunX: 0,
    gunY: 0,
    gunZ: 0,
    gunPX: GUN_AT[0],
    gunPY: GUN_AT[1],
    gunPZ: GUN_AT[2],
    hipLX: 0,
    hipLZ: 0,
    hipRX: 0,
    hipRZ: 0,
    kneeL: 0,
    kneeR: 0,
    ankleL: 0,
    ankleR: 0,
    reload: 0,
  };
  return solveSoldier(REST_POSE, j);
}

/** How far into a reload the rifle is canted and the head is down, 0..1. */
function reloadEnvelope(p: number): number {
  if (p <= 0 || p >= 1) return 0;
  return smooth(p / 0.1) * (1 - smooth((p - 0.82) / 0.16));
}

/** Smoothstep on [0, 1], clamped. */
export function smooth(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/**
 * Solves a pose to its joint channels. Purely procedural, like every other
 * animation in the game — there are no clips, and a new behaviour means new
 * numbers rather than new art. What each field means is `SoldierPose`'s; what
 * drives them is `SoldierMotion`'s; what DRAWS them is
 * `SoldierModel.animateSoldier`.
 *
 * **The feet point along `root`'s yaw, the torso along that plus `twist`**, and
 * the legs step along `heading` relative to the feet, so a body can look one
 * way, face its hips another and travel a third without any of the three being
 * drawn wrong. That split is the whole of strafing and backpedalling: a person's
 * feet point where they look (`Match` sends their `bodyYaw` as their yaw), so
 * the legs are what has to step sideways and backwards.
 *
 * **The AIM is split so the bore points where the body looks**: the spine takes
 * 55% of it and the rifle the rest inside the torso's frame, and the rifle
 * cancels the lean the spine takes for the crouch and the gait, which it used
 * to inherit — a crouched body pointed its rifle 17 degrees into the floor, and
 * a positive aim pitched the spine DOWN.
 */
export function solveSoldier(p: Readonly<SoldierPose>, out: SoldierJoints): SoldierJoints {
  const lean = CROUCH_LEAN * p.crouch;
  const drop = crouchDrop(p.crouch);
  // A deep squat cannot swing its legs through a stride, so the gait is damped
  // toward a shuffle as the body folds — which is also what the stance costs in
  // speed (`player.crouchMoveMult`), arrived at from the animation side.
  const gait = p.moving * (1 - 0.45 * p.crouch);
  out.bodyY = solveLegs(drop, p, gait, out);

  const fwd = Math.cos(p.heading);
  const side = Math.sin(p.heading);
  const u = Math.sin(p.phase);
  const reload = reloadEnvelope(p.reload);
  const carry = p.carry;
  const low = (1 - p.ready) * (1 - carry);
  const aim = clamp(p.aim, -1.2, 1.2);

  // --- spine ---
  // Lean into the pace (forward only: nobody leans into a backpedal), take the
  // kick back through the chest, and pitch 55% of the aim here. Positive
  // `rotation.x` tips the spine FORWARD — it is the crouch's lean — so an aim
  // UP is a negative one.
  const gaitLean = gait * (0.03 + 0.2 * p.run * Math.max(0, fwd)) + carry * 0.06;
  out.torsoX = -aim * 0.55 + gaitLean + lean - 0.05 * p.kick;
  // The shoulders counter-rotate against the leading leg, and roll into a
  // sideways step, both more at a run.
  const counter = -0.06 * gait * (0.35 + p.run) * u * fwd;
  out.torsoY = p.twist + counter;
  out.torsoZ = -side * 0.08 * gait * (0.3 + p.run);
  // The head takes a share of the twist on top, so the helmet leads the
  // shoulders; it holds the horizon against the gait's counter-rotation; and it
  // takes back most of the leans, so a hunkered or running body's visor — the
  // friend/foe read at range — still faces where it is going. It drops to look
  // at the rifle through a reload.
  out.headY = p.twist * 0.35 - counter;
  out.headZ = -out.torsoZ * 0.7;
  // Clamped inside the ragdoll's neck range, which a body can die at any
  // point of (`RAGDOLL_LINKS`).
  out.headX = clamp(-aim * 0.45 - lean * 0.6 - gaitLean * 0.8 + 0.35 * reload, -0.48, 0.48);

  // --- rifle, in the torso's frame ---
  // Rest is `GUN_AT` with the bore along the torso's +z. Then: the aim's
  // remainder and the spine's leans cancelled, so the bore holds the look;
  // muzzle down at low ready; slung across the chest at a sprint; the kick
  // straight back down the stock with the muzzle climbing; and canted over
  // toward the left hand for a reload.
  out.gunX = -aim * 0.45 - lean - gaitLean + 0.05 * p.kick
    + low * 0.4 + carry * 0.55 - p.kick * 0.2 + reload * 0.5;
  out.gunY = -low * 0.15 - carry * 0.75 - reload * 0.25;
  out.gunZ = carry * 0.35 + reload * 0.55;
  out.gunPX = GUN_AT[0] - carry * 0.06 - reload * 0.04;
  out.gunPY = GUN_AT[1] - low * 0.02 - carry * 0.06 + reload * 0.02;
  out.gunPZ = GUN_AT[2] - p.kick * 0.05 - carry * 0.06 - low * 0.02 - reload * 0.05;
  out.reload = p.reload;
  return out;
}

/**
 * How far the HIPS drop for a given stance blend.
 *
 * Not the same as how far the eye drops, and the difference is the spine: the
 * head hangs `HEAD_ABOVE_TORSO` off the torso joint, so pitching that joint by
 * `CROUCH_LEAN * crouch` already lowers the helmet by
 * `HEAD_ABOVE_TORSO * (1 - cos lean)` before a knee bends at all. Take that off
 * and the head lands exactly `CROUCH_DROP * crouch` down — which is exactly
 * where the eye and the centre of the hit sphere went.
 */
function crouchDrop(crouch: number): number {
  const lean = CROUCH_LEAN * crouch;
  return CROUCH_DROP * crouch - HEAD_ABOVE_TORSO * (1 - Math.cos(lean));
}

/**
 * Folds both legs to the stance, steps them through the gait on top, and
 * returns where `body` has to stand for the planted boot to stay on the ground.
 *
 * **The stance is two-link inverse kinematics**, because it has to hold at
 * every point of the blend and not only at its ends: the boots are planted, so
 * the knee and the ankle are whatever the hip height says they are, and a
 * crouch caught halfway is as correct as one at rest. `psi` is the thigh's angle
 * off vertical from the law of cosines, the shin takes whatever angle puts the
 * ankle back under the hip, and the ankle cancels the shin so the boot stays
 * flat. At `drop === 0` every term is zero — the chain is straight.
 *
 * **The gait is per leg, off the one phase, half a turn apart** — see
 * `stepLeg`.
 *
 * **The HEIGHT is read off whichever leg reaches further**, which is the
 * planted one: `body` is set so that leg's ankle is exactly where a standing
 * ankle is. That is the whole of the bob and no number of its own — a walk rises
 * over the straight leg at mid-stance and dips at the double support where both
 * legs are spread, a run sinks into the loaded knee — and on top of it a run
 * floats a little through the flight before each strike. With no gait this is
 * `-drop` exactly, so the crouch's head height is untouched.
 */
function solveLegs(drop: number, p: Readonly<SoldierPose>, gait: number, out: SoldierJoints): number {
  let thigh = 0;
  let knee = 0;
  let shin = 0;
  if (drop > 0) {
    // Hip height above the ankle. Clamped off the fully-folded end, where the
    // triangle degenerates and `acos` starts returning NaN rather than an
    // angle; at the crouch this game asks for it is 0.33 m against a floor of
    // 0.03, so the clamp is a guard and never a limit.
    const span = Math.max(LEG_SPAN - drop, Math.abs(THIGH - SHIN) + 0.01);
    const psi = Math.acos(
      clamp((THIGH * THIGH + span * span - SHIN * SHIN) / (2 * THIGH * span), -1, 1),
    );
    shin = Math.asin(clamp((THIGH * Math.sin(psi)) / SHIN, -1, 1));
    thigh = -psi;
    knee = shin + psi;
  }
  if (gait < 1e-3) {
    out.hipLX = thigh;
    out.hipLZ = 0;
    out.hipRX = thigh;
    out.hipRZ = 0;
    out.kneeL = knee;
    out.kneeR = knee;
    out.ankleL = -shin;
    out.ankleR = -shin;
    return -drop;
  }
  const fwd = Math.cos(p.heading);
  const side = Math.sin(p.heading);
  const reachL = stepLeg(-1, p.phase, thigh, knee, fwd, side, p, gait, out);
  const reachR = stepLeg(1, p.phase + Math.PI, thigh, knee, fwd, side, p, gait, out);
  const u = Math.sin(p.phase);
  return -(LEG_SPAN - Math.max(reachL, reachR)) + gait * p.run * 0.04 * u * u;
}

/**
 * One leg through the gait at `phi`. `outboard` is -1 for the left leg and +1
 * for the right — which way is OUTBOARD, and which leg's channels are written.
 * Returns the hip's height above the ankle this pose leaves, for `solveLegs`'
 * planted-leg test.
 *
 * `u = sin(phi)` is the boot's place along the line of travel and
 * `cos(phi) > 0` is its swing, when it is travelling forward through the air.
 * Along travel the hip swings by `stride`, decomposed onto the feet's frame by
 * `heading` — pitch for the part of the step that is forward or back, roll for
 * the part that is sideways, and a sideways step that would cross one boot
 * through the other is cut to a third, which is how a sidestep is taken. The
 * knee folds through the swing to clear the ground (much further at a run,
 * which also drives the thigh up) and gives a little under the load of the
 * stance, and the ankle keeps a planted boot flat and pushes off the toe at the
 * end of the stance.
 */
function stepLeg(
  outboard: number,
  phi: number,
  thigh0: number,
  knee0: number,
  fwd: number,
  side: number,
  p: Readonly<SoldierPose>,
  gait: number,
  out: SoldierJoints,
): number {
  const u = Math.sin(phi);
  const c = Math.cos(phi);
  const swing = Math.max(0, c);
  const stance = Math.max(0, -c);
  const run = p.run;
  // Along travel: the stride, plus a run's knee drive carrying the thigh up
  // through the middle of the swing. The drive is a forward thing only.
  const along = gait * (p.stride * u + run * 0.5 * swing * swing * Math.max(0, fwd));
  // Negative `rotation.x` carries a boot forward (it is the crouch's `-psi`).
  const hx = thigh0 - along * fwd;
  // Sideways: the part that would carry this boot inboard, across the other
  // one, is cut to a third.
  let lat = along * side;
  if (lat * outboard < 0) lat *= 0.35;
  const hz = ROLL_TO_X * clamp(lat, -0.4, 0.4);
  // The knee and the ankle are clamped inside their ragdoll ranges
  // (`RAGDOLL_LINKS`): a body can die at any point of a stride, and a crouch
  // already takes both most of the way there before the gait adds its fold.
  const kx = Math.min(2.65, knee0 + gait * (
    (0.95 + 1.05 * run) * Math.pow(swing, 1.4) + (0.08 + 0.32 * run) * stance
  ));
  // Flat while planted, dangling a little through the swing, and pushing off
  // the toe as the boot leaves the ground behind the body.
  const toe = Math.max(0, -u);
  const ax = clamp(
    -(hx + kx) * (1 - 0.35 * swing) + gait * (0.25 + 0.25 * run) * toe * toe,
    -1.45,
    0.55,
  );
  if (outboard < 0) {
    out.hipLX = hx;
    out.hipLZ = hz;
    out.kneeL = kx;
    out.ankleL = ax;
  } else {
    out.hipRX = hx;
    out.hipRZ = hz;
    out.kneeR = kx;
    out.ankleR = ax;
  }
  return (THIGH * Math.cos(hx) + SHIN * Math.cos(hx + kx)) * Math.cos(hz);
}

// Scratch for the muzzle's replay. One quaternion and one matrix per link, so
// no product is ever written into one of its own operands.
const ONE = new Vector3(1, 1, 1);
const _q = new Quaternion();
const _at = new Vector3();
const _local = new Matrix();
const _root = new Matrix();
const _body = new Matrix();
const _torso = new Matrix();
const _gun = new Matrix();
const _muzzle = new Matrix();

/** One link: `local(euler, at) * parent` into `world`, Babylon's order. */
function link(
  yaw: number,
  pitch: number,
  roll: number,
  x: number,
  y: number,
  z: number,
  parent: Matrix,
  world: Matrix,
): void {
  Quaternion.RotationYawPitchRollToRef(yaw, pitch, roll, _q);
  Matrix.ComposeToRef(ONE, _q, _at.copyFromFloats(x, y, z), _local);
  _local.multiplyToRef(parent, world);
}

/**
 * The rifle's muzzle in world space, for a rig whose ROOT stands at
 * `(x, y, z)` turned `yaw` (the body centre, as `Bot.syncTransform` places
 * it) and whose joints hold `j`.
 *
 * It is what `rig.muzzle.computeWorldMatrix(true)` returned — that call forces
 * every ancestor too (`parent.computeWorldMatrix(force)` inside Babylon's), so
 * it was always the FRESH chain off the nodes' current values, never a cached
 * parent — replayed off numbers: per node, `Quaternion.RotationYawPitchRoll`
 * of its Euler (`rotation.y, .x, .z`), `Matrix.ComposeToRef` with unit scale,
 * then `local.multiplyToRef(parentWorld)`; the answer is the float32
 * translation row. No node in the chain has a pivot, a billboard, a
 * quaternion or a scale, and the ones whose channels no pose writes
 * (`body`'s rotation and x/z, `torso`'s x/z, the muzzle's rotation) are the
 * zeros and offsets `buildSoldier` gave them.
 */
export function soldierMuzzleToRef<T extends Vector3Ref>(
  x: number,
  y: number,
  z: number,
  yaw: number,
  j: Readonly<SoldierJoints>,
  out: T,
): T {
  Quaternion.RotationYawPitchRollToRef(yaw, 0, 0, _q);
  Matrix.ComposeToRef(ONE, _q, _at.copyFromFloats(x, y, z), _root);
  link(0, 0, 0, 0, j.bodyY, 0, _root, _body);
  link(j.torsoY, j.torsoX, j.torsoZ, 0, TORSO_Y, 0, _body, _torso);
  link(j.gunY, j.gunX, j.gunZ, j.gunPX, j.gunPY, j.gunPZ, _torso, _gun);
  link(0, 0, 0, MUZZLE_AT[0], MUZZLE_AT[1], MUZZLE_AT[2], _gun, _muzzle);
  const m = _muzzle.m;
  out.set(m[12], m[13], m[14]);
  return out;
}
