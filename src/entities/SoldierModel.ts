/**
 * SoldierModel.ts — The bot rig: ~40 boxes and faceted lofts (`facet.ts` — the
 * body and the rifle; the slung launcher is still boxes) merged down to
 * fifteen SEGMENTS a kit — one a joint, and the visor — plus
 * the procedural poser (animateSoldier: a `SoldierPose` — gait in any
 * direction, aim, twist, crouch, the rifle's kick, carry and reload — solved by
 * `soldierPose.ts` and written onto the rig's joints by `poseSoldier`, with
 * both arms solved onto the rifle here; never clips), plus the pins between
 * the bones `RagdollSystem` builds a corpse's rigid bodies from
 * (`RAGDOLL_LINKS`; the bones themselves are `soldierBones.ts`', measured
 * off the box lists here and held Babylon-free there). What DRIVES a pose is
 * `SoldierMotion`'s; what a pose IS, as numbers, and the skeleton's measures
 * this rig is built from, are `soldierPose.ts`'s — so the simulation can ask
 * where a rifle is without a rig.
 * The geometry is built as `Part`s on `GeometryBuffer`s (`src/geometry/`,
 * `facet.ts`) and merged a segment at a time (`mergeParts`), ONCE A KIT — the
 * side a rig wears (`viewTeam`), never once a rig: every rig of one side is
 * the same drawing (`soldierKits`), and it is never a Babylon mesh.
 * **The JOINTS are ours** (`rigJoints.ts`, `BABYLON_EXIT.md` X4.1a) and so,
 * since X4.1d, is the DRAWING: OUR renderer draws every body as an INSTANCE
 * of its kit (`render/BodyDraw.ts`), a RANK at a time — every body's `r`th
 * segment nearest the eye, the matte ones in one draw and the visors in
 * another, so at most two draws a segment for the whole roster — off the
 * matrices `writeRigDrawing` writes once a frame (`Game.drawBodies`): each
 * segment's own local times its joint's world, what Babylon composed for the
 * mesh it was. Babylon is made no rig mesh.
 * The root is a joint and draws nothing: the body's one MEASURE
 * (`measureRig`, what `WorldCulling` drops a whole rig by) is the capsule it
 * was, composed off it, and the switch every roster writes is `rig.enabled`
 * (`setRigEnabled`).
 * Invariants: merging is what keeps a roster affordable, and since `KIT_PALETTE`
 * it is per SEGMENT rather than per colour — a segment is one geometry
 * whatever it is painted, and since X4.1d a segment is a RANK: up to two
 * draws (matte, visor) for every body of both sides, however many bodies —
 * and each rank's draw runs to the LONGEST segment any body draws at it,
 * times the bodies, so a long segment is paid at every rank it lands on (see
 * the merge note below). A box is free and a COLOUR is free
 * where the palette carries it — and a matte colour the palette does NOT
 * carry is REFUSED at the build (`paint`), there being no material of its
 * own left to give it. The emissive (the visor) stays outside the palette,
 * a segment of its own drawn by the emissive palette's program with the
 * visors' own table (`VISOR_COLORS`). Rigs are built by the roster's pool
 * and re-posed on respawn, never rebuilt inside a round. Posing and writing
 * the drawing allocate nothing: both run for every drawn body every frame. A
 * reader of a joint composes it FRESH (`jointPosition`,
 * `JointTree.computeChain`/`compute`) and never reads a matrix a previous
 * write left behind. Every joint a pose can reach must stay
 * inside `RAGDOLL_LINKS`, because a body can die at any point of it. `rig.rest` is the hierarchy as built
 * and is the ONLY thing a ragdoll may restore from — see JointRest.
 */
import { Color3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import { clamp } from "../core/math";
import { writePaletteIndex } from "../shaders/CelShader";
import type { GeometryBuffer } from "../geometry/buffer";
import type { Team } from "./Combatant";
import { viewTeam } from "../core/teamView";
import { loft, type Ring } from "./facet";
import { createBox } from "../geometry/primitives";
import { Matrix, Quaternion, Vector3, type Vector3Like } from "../math";
import { Joint, JointTree, measureBody, type BodySphere } from "./rigJoints";
import type { BoneJoint } from "./soldierBones";
import { mergeParts, Part, PartNode, worldMatrixOf } from "../world/parts";
import {
  CENTER_HEIGHT,
  GUN_AT,
  HEAD_ABOVE_TORSO,
  MUZZLE_AT,
  newSoldierJoints,
  REST_POSE,
  SHIN,
  smooth,
  solveSoldier,
  THIGH,
  TORSO_Y,
  type SoldierJoints,
  type SoldierPose,
} from "./soldierPose";
// Type-only, so no runtime edge is created — the same import `Vehicle` takes
// for the same reason. `DamageKind` lives with the shot that carries it.
import type { DamageKind } from "../systems/CombatSystem";

/**
 * The bot soldier rig: a humanoid built to be cheap enough to draw sixteen
 * of at once, and detailed enough to be read as a soldier at the range one is
 * usually shot at.
 *
 * Every limb is built from several boxes and then **merged into one geometry
 * per SEGMENT**, the same trick `RifleModel.buildRifle` uses to collapse ~50
 * boxes into 3. The joints stay above the merged segments — our own hierarchy
 * (`rigJoints.ts`) — so procedural animation is unaffected; only the leaf
 * geometry is batched.
 *
 * **What that merge means for anyone adding detail: geometry is free and so
 * is PAINT.** Forty-odd parts come out as fifteen segments — torso, head, the
 * visor, two upper arms, two forearms, two legs of three, the rifle and the
 * slung launcher — one per JOINT, because `KIT_PALETTE` moved the albedo into
 * `uv2.x` and every matte part of a segment wears one material. It used to be
 * twenty-one meshes, a segment splitting once per colour in it. **Since
 * `BABYLON_EXIT.md` X4.1d a segment is a RANK, not a mesh a body**: our
 * renderer draws the whole roster a rank at a time (each body's segments
 * sorted nearest the eye, as Babylon's queue drew a rig's meshes; rank `r` is
 * every body's `r`th), the matte segments of a rank in one draw and the
 * visors in another — so a frame is at most two draws a segment however many
 * bodies, and a NEW JOINT or a new segment is a new rank: up to two more draws
 * every frame. And a rank's draw runs to the longest segment ANY body has at
 * that rank, times the bodies, the rest of each instance's corners drawn as
 * nothing — and since every segment can land at every rank, a segment's
 * corners are paid at every rank some body draws it: GROWING THE LONGEST
 * segment (the torso's 1,056 corners, against a body's 5,352) multiplies
 * across the ranks, up to ~14.8k vertex invocations a body where 5,352 are
 * real. The only paint that is not free is an EMISSIVE, which cannot join the
 * palette and is a segment of its own (the visor), drawn by its own program —
 * a matte colour missing from `KIT_PALETTE` is refused at the build. Pouches, a
 * bedroll, a kneepad, an antenna and the helmet band are all free. The two
 * forearms are paid for by a JOINT rather than a colour, which is the one axis
 * the palette does not touch: the elbow is what puts both hands on the rifle,
 * and a part hung off its own joint cannot merge with one that is not.
 *
 * The player has no rig at all — the camera is inside the head, and there is no
 * own-body to draw. The one thing that stands a player's body up is the death
 * cam, and it builds one of these.
 */

/**
 * A weapon is a weapon whoever is holding it — the one colour on this model
 * that is not the team's. It is `weaponKit`'s `BODY`, so a bot's rifle and the
 * one in the player's hands are cut from the same steel.
 */
const GUN = "#2b2b33";

/**
 * What one side is DRAWN in: three cel colours of its own, the two the team
 * palette owns, and which head it wears.
 *
 * Both sides used to be the same three greys with a single sash to tell them
 * apart, and that sash is a stripe inset in the LEFT of the chest — so it is
 * gone from either side of a body, and gone from every side of one far enough
 * away for a 0.1 m stripe to fall under a pixel. What was left telling the
 * sides apart in both cases was the visor's glow and nothing else. The three
 * answers here are stacked deliberately, because each covers where the one
 * before it fails:
 *
 * - **Hue.** A whole kit that is warm (Valeguard: khaki plate, brown canvas)
 *   or cold (Redline: slate plate, blue-black suit). It costs NOTHING — the
 *   same boxes in different paint — and it is the only one of the three that
 *   still works on a body three pixels wide, because it is the average of every
 *   one of those pixels rather than a feature inside them.
 * - **Accent.** `CONFIG.teams[].color` on the pauldrons, the bandolier and the
 *   helmet band — the one saturated colour on the model, placed so that some of
 *   it faces every direction: the shoulders from the sides and from above, the
 *   bandolier from front and back, the band on the head that clears cover
 *   first.
 * - **Silhouette.** `face` gives each side its own head against the sky, which
 *   is what is left when a body is backlit, in Greyfen's mist or in a night
 *   village where the whole model is one value. It is the only read that
 *   survives with no colour at all.
 *
 * **The accent and the visor are READ from `CONFIG.teams` rather than written
 * here**, because the friend/foe colour is a rule the deploy map, the flag
 * markers and the killfeed all share: a soldier painted in a fifth colour of
 * its own would be the one body on the field wearing the wrong side's marker.
 * The other three are ART and live here — they belong with the box lists they
 * are painted onto, which `RAGDOLL_BONES` (`soldierBones.ts`) is measured
 * off.
 */
export interface SoldierKit {
  /** Plate carrier, helmet and thighs: the hard shell, and most of the body. */
  armor: string;
  /** Undersuit — sleeves, gloves, shins, neck. The darkest of the three. */
  suit: string;
  /** Webbing: belt, pouches, pack, bedroll, antenna, boots. */
  webbing: string;
  /** The friend/foe colour, from `CONFIG.teams`. */
  accent: string;
  /** The visor's emissive, from `CONFIG.teams`. */
  visor: string;
  /** Which head this side wears — see `faceParts`. */
  face: "brim" | "respirator";
}

/**
 * One kit per SIDE, indexed by the VIEW rather than by `Team` — 0 is whoever
 * is looking and 1 is whoever they are fighting, so a player's own side wears
 * the amber brim whichever slot a match seated them in. See
 * `core/teamView.ts`.
 */
const KITS: readonly SoldierKit[] = [
  {
    armor: "#474436",
    suit: "#272521",
    webbing: "#3a3126",
    accent: CONFIG.teams[0].color,
    visor: CONFIG.teams[0].eyeColor,
    face: "brim",
  },
  {
    armor: "#3a4250",
    suit: "#1d2129",
    webbing: "#2b303a",
    accent: CONFIG.teams[1].color,
    visor: CONFIG.teams[1].eyeColor,
    face: "respirator",
  },
];

/**
 * The kit the VIEWER's own side wears — always view 0, whichever slot a match
 * seated them in. Exported for the one body in the game that is not a rig: the
 * first-person arms (`ViewModel`), which are the player's own sleeves and
 * gloves and so have to be cut from the same cloth as their squadmates'.
 */
export const OWN_KIT: SoldierKit = KITS[0];

/**
 * Every MATTE colour a rig is painted in, in slot order — the kit palette.
 *
 * **This is what makes a segment one geometry instead of one per colour.**
 * A segment merges by MATERIAL, so a torso carrying a shell, webbing and an
 * accent was three meshes and a head was four; with the albedo moved into
 * `uv2.x` and read out of `celPalette` every matte part of a segment wears the
 * one kit material and merges into one. The rig went from **21 meshes and 11
 * materials to 14 and 2** — the paint-palette measurement
 * (`docs/rendering.md`) put a draw that reuses a bound material at ~2.3 us
 * against ~6.3 for one that switches — and since `BABYLON_EXIT.md` X4.1d to
 * draws a RANK for every body of both sides, at most two a segment however
 * many bodies (the rig's note above has what a segment costs). It is exactly
 * the trick that took the village from 416 meshes to 90, which is where the
 * whole argument is written down.
 *
 * It is DECLARED rather than discovered, unlike the map's, because a kit is a
 * fixed handful of hexes the material is born holding
 * (`CelMaterialFactory.bodyCelRecipe`). **A new colour on the model belongs
 * here as well as on the part**, or the build REFUSES it (`paint`): a matte
 * colour off the palette had its own per-hex material until X4.1d, and a rig
 * has no material of its own to give it any more.
 *
 * The visor is absent on purpose: it is EMISSIVE, which is shader behaviour
 * rather than a uniform, and the palette may no more enrol it than
 * `MapBuilder`'s may enrol gloss or glazing. It has a table of its own
 * (`VISOR_COLORS`).
 */
const KIT_PALETTE: readonly string[] = [
  GUN,
  ...KITS.flatMap((kit) => [kit.armor, kit.suit, kit.webbing, kit.accent]),
];

/** Hex to its 1-based slot in `KIT_PALETTE`. Absent is a colour the build refuses. */
const KIT_SLOT: ReadonlyMap<string, number> = new Map(
  KIT_PALETTE.map((hex, i) => [hex.toLowerCase(), i + 1]),
);

/**
 * `KIT_PALETTE` as the factory takes it (`bodyCelRecipe`). Built once: the
 * kit never moves.
 */
export const KIT_COLORS: readonly Color3[] = KIT_PALETTE.map((hex) =>
  Color3.FromHexString(hex),
);

/**
 * Each side's visor colour, by the VIEW (`KITS`' order): the visors' own
 * emissive table (`bodyEmissiveRecipe`), a kit's visor's `uv2.x` its 1-based
 * slot here — what `getEmissive(kit.visor)`'s `emissiveColor` held until
 * `BABYLON_EXIT.md` X4.1d, and what `GlowRules` reads a visor's bloom off.
 */
export const VISOR_COLORS: readonly Color3[] = KITS.map((kit) => Color3.FromHexString(kit.visor));

/**
 * Every joint the rig poses, bone or not.
 *
 * `resetSoldierPose` restores all of them, which is why this is a wider list
 * than `RAGDOLL_BONES`: the rifle and the muzzle are carried by a bone rather
 * than being one, and `body` is the node the crouch drops.
 */
const POSED_JOINTS = [
  "body",
  "torso",
  "head",
  "shoulderL",
  "shoulderR",
  "elbowL",
  "elbowR",
  "hipL",
  "hipR",
  "kneeL",
  "kneeR",
  "ankleL",
  "ankleR",
  "gun",
  "muzzle",
] as const;

type PosedJoint = (typeof POSED_JOINTS)[number];

// The leg's segments, the head's place on the spine, the crouch's drop and
// lean, the torso's and the rifle's joints and the muzzle are `soldierPose.ts`'s:
// the pose is solved there, off the same numbers this rig is built from.

/** Where the shoulder joints hang off the torso joint. */
const SHOULDER_X = 0.28;
const SHOULDER_Y = 0.42;

/**
 * The arm, in segments: shoulder to elbow, elbow to wrist, and wrist to the
 * middle of the fist, which is the point the solve puts on the rifle.
 */
const UPPER_ARM = 0.29;
const FOREARM = 0.26;
const HAND = 0.05;

/**
 * Where each fist closes, in the RIFLE's frame: the right on the pistol grip,
 * the left under the receiver just ahead of the magazine. The left is not on
 * the handguard, and that is a reach rather than a style: the handguard is
 * 0.68 m from the left shoulder and the arm is 0.60, so a hand there is a
 * straight arm at best and an arm that cannot arrive at worst.
 */
const GRIP_R: [number, number, number] = [0, -0.1, -0.11];
const GRIP_L: [number, number, number] = [0, -0.07, 0.1];

/**
 * The sign that turns an elbow's bend into `rotation.x`, READ off the matrix
 * arithmetic (`src/math`, Babylon's bits) — what `rotation.x` does to a limb hanging down its own -y — rather
 * than argued from a handedness that is easy to get backwards.
 */
const ELBOW_SIGN =
  Vector3.TransformCoordinates(new Vector3(0, -1, 0), Matrix.RotationX(1)).z > 0 ? 1 : -1;

/**
 * The elbow poles, in the torso's frame: the right elbow back and out, tucked
 * behind a hand on the pistol grip, and the left one down and out under a hand
 * supporting the receiver.
 */
const POLE_L = new Vector3(-0.6, -1, 0);
const POLE_R = new Vector3(0.5, -0.5, -1);

// Scratch for the per-frame solve. `solveArm` runs twice per posed body per
// frame, so it allocates nothing — see `docs/profiling.md` on why a per-frame
// allocation is the one thing a hitch hunt cannot afford.
const _reach = new Vector3();
const _dn = new Vector3();
const _side = new Vector3();
const _u = new Vector3();
const _f = new Vector3();
const _ax = new Vector3();
const _ay = new Vector3();
const _az = new Vector3();
const _q = new Quaternion();

/**
 * Two-link inverse kinematics for one arm, in the torso's frame: writes the
 * shoulder's Euler into `shoulder` and returns the elbow's `rotation.x`.
 *
 * **It is solved EVERY POSE, because the rifle moves now** — it kicks, it is
 * lowered, it is carried across the chest at a sprint, and it is canted for a
 * magazine change while the left hand leaves it. The shoulders and the rifle
 * both hang off the torso, so the spine's lean and twist still carry arms and
 * rifle together for free, and what the solve has to follow is only the
 * rifle's motion inside the torso's frame. The same solve at the carried pose
 * is the one this used to run once at module load, which put each fist within
 * a micron of its grip.
 *
 * The solve: the law of cosines gives the shoulder's angle off the line to the
 * target, `pole` says which side of that line the elbow goes, and the frame is
 * built so the upper arm lies along the joint's local -y and the forearm bends
 * in its local y-z plane, the plane `elbow.rotation.x` hinges in exactly as a
 * knee does. A target out of reach is clamped to a nearly straight arm pointing
 * at it rather than failing.
 */
function solveArm(
  x: number,
  target: Vector3,
  pole: Vector3,
  shoulder: Vector3,
): number {
  _reach.set(target.x - x, target.y - SHOULDER_Y, target.z);
  const upper = UPPER_ARM;
  const lower = FOREARM + HAND;
  const len = Math.max(_reach.length(), 1e-6);
  const d = clamp(len, Math.abs(upper - lower) + 0.01, upper + lower - 0.001);
  _dn.copyFrom(_reach).scaleInPlace(1 / len);
  const pd = Vector3.Dot(pole, _dn);
  _side.set(pole.x - _dn.x * pd, pole.y - _dn.y * pd, pole.z - _dn.z * pd).normalize();
  const alpha = Math.acos(clamp((upper * upper + d * d - lower * lower) / (2 * upper * d), -1, 1));
  const ca = Math.cos(alpha);
  const sa = Math.sin(alpha);
  _u.set(
    _dn.x * ca + _side.x * sa,
    _dn.y * ca + _side.y * sa,
    _dn.z * ca + _side.z * sa,
  );
  _f.set(
    _dn.x * d - _u.x * upper,
    _dn.y * d - _u.y * upper,
    _dn.z * d - _u.z * upper,
  ).normalize();
  // The joint's frame: -y down the upper arm, z toward the side the forearm
  // folds to, and x the hinge between them.
  _ay.copyFrom(_u).scaleInPlace(-1);
  const fu = Vector3.Dot(_f, _u);
  _az.set(_f.x - _u.x * fu, _f.y - _u.y * fu, _f.z - _u.z * fu).normalize();
  Vector3.CrossToRef(_ay, _az, _ax);
  _ax.normalize();
  Quaternion.RotationQuaternionFromAxisToRef(_ax, _ay, _az, _q);
  _q.toEulerAnglesToRef(shoulder);
  return ELBOW_SIGN * Math.acos(clamp(fu, -1, 1));
}

/**
 * One bone's pin to the bone it hangs off: which one that is, where it hangs in
 * THAT bone's frame, and how far it may swing there.
 *
 * Limits are radians, per axis, symmetric about the carried pose. They are
 * loose enough to look boneless in flight and tight enough that a settled body
 * does not end up with its head on backwards. The table below is where the
 * numbers and the reasoning for them live.
 */
export interface BoneLink {
  /** The bone this one hangs off. `torso` is the root and pins nothing. */
  parent: BoneJoint;
  /** Pivot in the PARENT bone's frame. */
  pivot: [number, number, number];
  /** Angular range about x (pitch), as [min, max]. */
  x: [number, number];
  /** About y (yaw). */
  y: [number, number];
  /** About z (roll). */
  z: [number, number];
}

/**
 * Where each bone is pinned and how far it may swing there. `torso` is the root
 * body and is absent — nothing pins it.
 *
 * Every joint is at identity relative to its parent in the carried pose, so
 * **the standing pose is the zero of all three angular axes** and these read as
 * plain ranges rather than as offsets from some authored rest angle. That is
 * also why a limit must CONTAIN the pose a body is thrown in: the knee below
 * reaches 2.58 rad at a full crouch, and a range that stopped short of it would
 * have the solver snapping a leg straight on the frame of death — the pop this
 * whole feature exists to remove, arriving through the fix for it.
 *
 * The ROLL ranges are asymmetric per side on purpose: a symmetric one lets an
 * arm or a leg fold in through the body it hangs off.
 *
 * The hips are the trap. `hipL`/`hipR` are children of `body`, NOT of `torso`
 * (see the leg section below), so the pivot in chest space is their own local
 * y of -0.02 MINUS the torso's +0.1 — the -0.12 here. Reading the hip's local
 * position straight off the node instead puts both legs 0.1 m up inside the
 * chest, which reads as a body folded in half. The knee and the ankle have no
 * such trap and must not be given one: each hangs off the segment directly
 * above it, so its pivot is that segment's own length and is written as
 * `-THIGH` / `-SHIN` rather than as a number, which is what keeps the pin on
 * the joint when the leg's boxes move.
 */
export const RAGDOLL_LINKS: Readonly<Partial<Record<BoneJoint, BoneLink>>> = {
  head: {
    parent: "torso",
    pivot: [0, 0.52, 0],
    x: [-0.5, 0.5],
    y: [-0.7, 0.7],
    z: [-0.5, 0.5],
  },
  // The shoulders are the one pair NOT posed near zero: both hands are on the
  // rifle, so each carries `solveArm`'s answer (a twist of up to 1.3 rad), and
  // every range here has to contain every pose that solve reaches — the aim,
  // the sprint carry, the kick and each beat of the reload — with room to
  // spare, or the arm snaps on the frame of death. The twist is where most of
  // it goes.
  shoulderL: {
    parent: "torso",
    pivot: [-SHOULDER_X, SHOULDER_Y, 0],
    x: [-1.8, 1.4],
    y: [-1.7, 1.7],
    z: [-0.8, 1.7],
  },
  shoulderR: {
    parent: "torso",
    pivot: [SHOULDER_X, SHOULDER_Y, 0],
    x: [-1.8, 1.4],
    y: [-1.7, 1.7],
    z: [-1.7, 0.8],
  },
  // The elbow is a hinge like the knee, folding the OTHER way: `rotation.x`
  // bends a forearm forward on the negative side, and the carried pose sits at
  // -0.7 (left) and -1.8 (right), both well inside.
  elbowL: {
    parent: "shoulderL",
    pivot: [0, -UPPER_ARM, 0],
    x: [-2.6, 0.05],
    y: [-0.1, 0.1],
    z: [-0.1, 0.1],
  },
  elbowR: {
    parent: "shoulderR",
    pivot: [0, -UPPER_ARM, 0],
    x: [-2.6, 0.05],
    y: [-0.1, 0.1],
    z: [-0.1, 0.1],
  },
  hipL: {
    parent: "torso",
    pivot: [-0.12, -0.12, 0],
    x: [-0.9, 1.4],
    y: [-0.3, 0.3],
    z: [-0.15, 0.8],
  },
  hipR: {
    parent: "torso",
    pivot: [0.12, -0.12, 0],
    x: [-0.9, 1.4],
    y: [-0.3, 0.3],
    z: [-0.8, 0.15],
  },
  // The knee is a HINGE and the only joint here with a one-way range: it folds
  // to 2.7 and is allowed a few hundredths the other way for numerical slack,
  // because a knee that opens backwards is the leg version of a head on
  // backwards. The yaw and roll are pinched to a tenth for the same reason —
  // enough to keep the solver from fighting itself, not enough to read as a
  // twisted shin.
  kneeL: {
    parent: "hipL",
    pivot: [0, -THIGH, 0],
    x: [-0.05, 2.7],
    y: [-0.1, 0.1],
    z: [-0.1, 0.1],
  },
  kneeR: {
    parent: "hipR",
    pivot: [0, -THIGH, 0],
    x: [-0.05, 2.7],
    y: [-0.1, 0.1],
    z: [-0.1, 0.1],
  },
  // The ankle's range is set by the DRAWN crouch rather than by anatomy. The
  // squat this rig holds puts the shin near horizontal with the boot flat, so
  // `solveSoldier`'s legs dorsiflex the foot to -1.39 rad — further than an
  // ankle goes, and exactly where a crouched body has to be thrown from.
  ankleL: {
    parent: "kneeL",
    pivot: [0, -SHIN, 0],
    x: [-1.5, 0.6],
    y: [-0.15, 0.15],
    z: [-0.15, 0.15],
  },
  ankleR: {
    parent: "kneeR",
    pivot: [0, -SHIN, 0],
    x: [-1.5, 0.6],
    y: [-0.15, 0.15],
    z: [-0.15, 0.15],
  },
};

/**
 * One joint's place in the hierarchy as BUILT, captured before anything has a
 * chance to move it.
 *
 * The ragdoll detaches these joints and hands them to the physics engine, and
 * putting them back has to be exact — a bot whose rig is restored even
 * slightly wrong is one that walks around subtly broken for the rest of the
 * session. Snapshotting at construction rather than at death is what makes
 * that impossible to get wrong: the rest pose can never have drifted, because
 * nothing has run yet when it is taken. The PARENT needs no snapshot: a
 * joint's parent is fixed at build (`Joint.parent`), and what a ragdoll moves
 * is its POSE (`Joint.pose`), which `resetSoldierPose` clears.
 */
export interface JointRest {
  node: Joint;
  position: Vector3;
}

/**
 * One SEGMENT of a rig and the joint it hangs off: what a mesh of it was
 * until `BABYLON_EXIT.md` X4.1d, its geometry now its KIT's
 * (`soldierKits`) and drawn by our renderer at `local` times the joint's
 * world (`writeRigDrawing`).
 */
export interface RigSegment {
  readonly joint: Joint;
  /** The segment's own transform in its joint's frame — its kit's, composed once. */
  readonly local: Matrix;
}

/**
 * One segment of a kit's DRAWING: its geometry in its own frame, its local
 * transform in its joint's frame, and whether it is the visor (emissive).
 * Every rig of one side draws these, in this order (`RigSegment`).
 */
export interface KitSegment {
  readonly name: string;
  readonly geometry: GeometryBuffer;
  readonly local: Matrix;
  readonly emissive: boolean;
}

/**
 * One side's drawing, built ONCE (`soldierKits`): its segments in a rig's
 * order, each one's bounding-sphere centre in its own frame — the midpoint of
 * its vertices' extent, as Babylon's `BoundingSphere` made it of the mesh it
 * was, which is what a body's segments are ORDERED by (Babylon's
 * front-to-back queue, `Game.bodyPull`) and a visor's bloom is faded by
 * (`GlowRules`) — and which segment the visor is.
 */
export interface KitDrawing {
  readonly segments: readonly KitSegment[];
  readonly centres: readonly Vector3[];
  readonly visor: number;
}

export interface SoldierRig {
  /**
   * Every joint below, parents first: OUR hierarchy (`rigJoints.ts`), each
   * world matrix a float32 array the rig owns. Babylon draws the meshes off
   * them and has no node of this rig (`BABYLON_EXIT.md` X4.1a).
   */
  tree: JointTree;
  /**
   * The joint the rig hangs from: the body centre. Positioned and turned by
   * whoever places the body (`NetSoldier`, `DeathCam`); never drawn. Its own
   * `enabled` is NOT the body's switch: `rig.enabled` (`setRigEnabled`) is.
   */
  root: Joint;
  body: Joint;
  torso: Joint;
  head: Joint;
  shoulderL: Joint;
  shoulderR: Joint;
  /**
   * Elbows. The arm is two segments hung off the shoulder, and both are solved
   * onto the rifle — see `solveArm` — so the hands are ON the weapon rather
   * than beside it. Both are ragdoll bones.
   */
  elbowL: Joint;
  elbowR: Joint;
  hipL: Joint;
  hipR: Joint;
  /**
   * Knees and ankles. They exist for the crouch — every body that takes one is
   * posed through them and a standing body holds them all at zero — and the
   * ankle is what keeps a boot flat on the ground while the shin folds under a
   * squat; without it the sole tips up with the shin and the toe goes through
   * the floor. Both are ragdoll bones as well, which is what lets a body die
   * crouched: see `RAGDOLL_BONES`.
   */
  kneeL: Joint;
  kneeR: Joint;
  ankleL: Joint;
  ankleR: Joint;
  /** The rifle held across the chest. Carried by the torso, not a bone. */
  gun: Joint;
  /**
   * The rocket launcher slung across the back — switched off on every rig
   * until a body is told it carries one: `BattleSystem` decides per squad
   * (`Bot.launcher`), the authority says so on the roster
   * (`SlotOccupant.launcher`), and `NetSession` switches it on through
   * `NetSoldier.setLauncher` (`setLauncher` here).
   *
   * Deliberately NOT a ragdoll bone and deliberately not in `RAGDOLL_BONES`:
   * it is welded to the torso, so it falls with the body under Havok as part
   * of the chest and needs no joint of its own.
   */
  launcher: Joint;
  /** Muzzle landmark, for tracer origins. */
  muzzle: Joint;
  /**
   * The side it was painted for: its KIT, by the VIEW (`viewTeam` at the
   * build) — which drawing it is an instance of (`soldierKits`). Never moves:
   * a change of side is a rebuild (`NetRoster.setFielded`, `DeathCam.prepare`).
   */
  readonly kit: number;
  /** Every segment, in its kit's order, with the joint each hangs off — see `RigSegment`. */
  readonly segments: readonly RigSegment[];
  /**
   * Whether the body is in the world: the one switch every roster, the death
   * cam and the culling read (`setRigEnabled`). It was the root MESH's own
   * enabled flag until the root stopped being a mesh.
   */
  enabled: boolean;
  /** Height of the body centre above the feet. */
  centerHeight: number;
  /** Where every ragdoll bone joint sits when alive — see `JointRest`. */
  rest: readonly JointRest[];
}

/**
 * Everything `RagdollSystem` needs of a body it is about to throw. A body off
 * the wire (`NetSoldier`) satisfies it structurally (a `Bot` itself has no rig
 * to throw), and so does the player's corpse stand-in, which is the
 * whole point: the pool has no business knowing which of them it holds. The
 * three vectors are `Vector3Like`, so either library's satisfies them.
 *
 * It lives HERE rather than in `RagdollSystem` because it is a fact about a
 * soldier rig, and because the alternative is `DeathCam` importing a type from
 * another system — the one thing the wiring rules in CLAUDE.md forbid. Nothing
 * implementing it has to import it either; TypeScript's structural typing is
 * what keeps `NetSoldier` free of any knowledge that a physics engine exists.
 */
export interface RagdollSubject {
  readonly rig: SoldierRig;
  /** The body's feet, used once for the distance gate at the moment of death. */
  readonly position: Vector3Like;
  /** The body's centre of mass, which the killing impulse is aimed away from. */
  readonly center: Vector3Like;
  /** Where the killing blow came from: a shooter's eye, or a blast centre. */
  readonly deathFrom: Vector3Like;
  /** How much of it there was, which scales the throw. */
  readonly deathDamage: number;
  /**
   * What delivered it, which chooses WHICH throw.
   *
   * A round is a blow on the chest and an explosion is a velocity given to the
   * whole body — two different rows of `CONFIG.bots.death.impulse`, and this is
   * all that picks between them. It is the same `DamageKind` the damage path
   * has carried since the tank went in, captured beside `deathFrom` by whoever
   * took the blow, so nothing new travels to get here.
   */
  readonly deathKind: DamageKind;
  /**
   * Set by the pool for as long as it owns the joints. Whoever poses this rig
   * has to leave it alone in that window, or two writers fight over one joint.
   */
  ragdolling: boolean;
  /** A live body is released immediately — the pool's self-defence guard. */
  readonly alive: boolean;
  setEnabled(on: boolean): void;
}

/**
 * One box in a segment: extents, its offset from the joint, its colour, and an
 * optional cant in the xy plane.
 *
 * `rotZ` is `weaponKit.box`'s parameter under its own name and exists for one
 * part — the bandolier, which has to cross the chest rather than hang down it.
 * A rotation is safe where a scale is not: the merge (`mergeParts`, which is
 * `MergeMeshes`' arithmetic) bakes world matrices,
 * and a rotation carries normals across unit-length while a non-uniform scale
 * hands `renderOutline` a shell that is fat on the squashed axis.
 */
type SegmentBox = [
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  color: string,
  rotZ?: number,
];

/**
 * One faceted part in a segment: a `loft` through `rings` in the joint's own
 * frame, optionally moved and turned as a whole. It merges beside the boxes as
 * one more piece of its colour, so a loft costs what a box costs — nothing, in
 * a colour the segment already carries.
 */
interface SegmentLoft {
  rings: readonly Ring[];
  color: string;
  at?: [number, number, number];
  rot?: [number, number, number];
}

type SegmentPart = SegmentBox | SegmentLoft;

/**
 * The rotation that lays a loft's own +y along +z — the bore — and the sign
 * that carries a ring's `z` offset onto the part's height once it is laid
 * down. Both are READ off Babylon's own matrix rather than argued from
 * handedness, the same way `solveArm` signs the elbow.
 */
const ALONG_Z = (() => {
  const p = Vector3.TransformCoordinates(new Vector3(0, 1, 0), Matrix.RotationX(Math.PI / 2));
  return p.z > 0 ? Math.PI / 2 : -Math.PI / 2;
})();
const Z_TO_Y = Math.sign(
  Vector3.TransformCoordinates(new Vector3(0, 0, 1), Matrix.RotationX(ALONG_Z)).y,
);

/**
 * A part lofted ALONG the bore: each section is at `z` with a width `w`, a
 * height `h` and a vertical offset `dy`, and the whole part sits at height
 * `y`. It is `loft` turned on its side, which is what the long parts of a
 * weapon are.
 */
function lengthwise(
  color: string,
  sections: readonly { z: number; w: number; h: number; k?: number; dy?: number }[],
  y = 0,
): SegmentLoft {
  return {
    color,
    rings: sections.map((r) => ({ y: r.z, w: r.w, d: r.h, k: r.k, z: (r.dy ?? 0) * Z_TO_Y })),
    at: [0, y, 0],
    rot: [ALONG_Z, 0, 0],
  };
}

/**
 * The parts that give one side's head a shape of its own.
 *
 * Paint is the read that dies first — at dusk, in mist, or against a bright
 * Coldharbour sky a body is a value and not a hue — and a helmet is the part of
 * a soldier a player sees before any of the rest of them. So the sides differ
 * in the OUTLINE of the head as well as in its colour: Valeguard wear a peaked
 * helmet with a short neck guard, Redline a respirator under a long shroud.
 * Both are drawn in `armor`, so a side pays no mesh for having a face.
 */
function faceParts(kit: SoldierKit): SegmentLoft[] {
  const part = (rings: Ring[]): SegmentLoft => ({ color: kit.armor, rings });
  return kit.face === "brim"
    ? [
        // A peak off the rim shading the visor, and a guard flaring out down
        // the back of the neck.
        part([
          { y: 0.08, w: 0.25, d: 0.09, k: 0.35, z: 0.175 },
          { y: 0.1, w: 0.27, d: 0.09, k: 0.35, z: 0.165 },
        ]),
        part([
          { y: 0.03, w: 0.24, d: 0.05, k: 0.3, z: -0.175 },
          { y: 0.1, w: 0.27, d: 0.06, k: 0.3, z: -0.15 },
        ]),
      ]
    : [
        // A filter over the mouth, under a shroud that hangs past the collar.
        part([
          { y: -0.04, w: 0.11, d: 0.1, k: 0.5, z: 0.13 },
          { y: 0.035, w: 0.13, d: 0.12, k: 0.5, z: 0.12 },
        ]),
        part([
          { y: -0.04, w: 0.28, d: 0.06, k: 0.3, z: -0.165 },
          { y: 0.1, w: 0.27, d: 0.07, k: 0.3, z: -0.15 },
        ]),
      ];
}

/**
 * Builds one soldier in the given team's kit: its joints, and its segments
 * hung off them — the DRAWING is its kit's, built once a side
 * (`soldierKits`), so a rig after the first of its side builds joints and
 * nothing else.
 */
export function buildSoldier(team: Team): SoldierRig {
  // The kit is the VIEWER's read of this side rather than the authority's
  // index for it: the local player's own side wears amber whichever slot a
  // match seated them in. See `core/teamView.ts`.
  return buildRig(viewTeam(team));
}

/** `buildSoldier` in the kit of `view` — the one `soldierKits` asks a drawing of. */
function buildRig(view: number): SoldierRig {
  const kit = KITS[view];
  const centerHeight = CENTER_HEIGHT;
  // The joints are OURS (`rigJoints.ts`, X4.1a): a tree of local channels
  // whose world matrices the rig owns, named as the nodes were. The root is
  // never drawn; what `WorldCulling` measures a whole body by is the capsule
  // it used to be (`measureRig`).
  const tree = new JointTree();
  const root = tree.add("bot", null);

  // The side's drawing, if an earlier rig of it built it; else this build
  // builds it, segment by segment, as it hangs them.
  const drawing = kitDrawings[view];
  const building: KitSegment[] | null = drawing ? null : [];
  const segments: RigSegment[] = [];
  const body = tree.add("bot-body", root);

  /**
   * Hangs the next segment of the kit off `joint`: the kit's own, or — while
   * this build builds the kit — the one `make` builds, its geometry and its
   * local transform in the joint's frame, composed once.
   */
  const hang = (joint: Joint, make: () => KitSegment): void => {
    const i = segments.length;
    const seg = building ? make() : drawing!.segments[i];
    if (building) building.push(seg);
    segments.push({ joint, local: seg.local });
  };

  /**
   * Paints one part through the kit palette: its slot into `uv2.x`, which the
   * kit material reads (`celPalette`, its own). **A matte colour the palette
   * does not carry is REFUSED** — until `BABYLON_EXIT.md` X4.1d such a part
   * kept a per-hex material of its own and cost its segment a mesh, and our
   * renderer draws every body with the ONE kit material, so there is nothing
   * left to give it. It cannot reach a player: the kit is module constants,
   * so the first rig any build makes throws, in every build.
   */
  const paint = (p: Part, color: string): void => {
    const slot = KIT_SLOT.get(color.toLowerCase());
    if (slot === undefined) {
      throw new Error(
        `[soldier] ${color} is painted on a rig but is not in KIT_PALETTE: add it to the palette ` +
          "(an emissive cannot join one, and is a segment of its own, as the visor is)",
      );
    }
    writePaletteIndex(p.geometry, slot);
  };

  /**
   * Builds one limb from a list of boxes, merges it, and hangs it off a joint.
   * Offsets are relative to the joint, so the merge can happen at identity and
   * the joint carries the animation. The pieces are `Part`s — geometry, a
   * transform in the joint's frame and a paint — and what the merge makes of
   * them is the segment (`mergeSegment`): built only while this build builds
   * the kit.
   */
  const segment = (
    name: string,
    parent: Joint,
    boxes: SegmentPart[],
  ): void => {
    hang(parent, () => {
      const parts: Part[] = [];
      for (let i = 0; i < boxes.length; i++) {
        const part = boxes[i];
        if (!Array.isArray(part)) {
          const p = loft(`${name}${i}`, part.rings);
          if (part.at) p.position.set(...part.at);
          if (part.rot) p.rotation.set(...part.rot);
          paint(p, part.color);
          parts.push(p);
          continue;
        }
        const [w, h, d, x, y, z, color, rotZ = 0] = part;
        const p = new Part(`${name}${i}`, createBox({ width: w, height: h, depth: d }));
        p.position.set(x, y, z);
        p.rotation.z = rotZ;
        paint(p, color);
        parts.push(p);
      }
      return mergeSegment(parts, name);
    });
  };

  // --- torso: plate carrier, webbing, pack, and the team's bandolier ---
  //
  // Lofted rather than boxed: the carrier is a V from the shoulders to a
  // narrower waist, and every corner is cut, which is what stops a body reading
  // as a stack of cubes beside a world of faceted trees and gabled roofs. It
  // carries three colours — armor, webbing, accent — and is ONE mesh however
  // many parts it is cut from and however many of them it is painted in.
  const torso = tree.add("bot-torso", body);
  torso.position.y = TORSO_Y;
  segment("bot-torso-m", torso, [
    // The shell: waist, ribs, the broad chest, and the slope into the collar.
    {
      color: kit.armor,
      rings: [
        { y: -0.02, w: 0.34, d: 0.22, k: 0.35 },
        { y: 0.14, w: 0.38, d: 0.25, k: 0.35 },
        { y: 0.36, w: 0.46, d: 0.28, k: 0.35 },
        { y: 0.46, w: 0.44, d: 0.26, k: 0.45 },
        { y: 0.51, w: 0.3, d: 0.2, k: 0.5 },
      ],
    },
    // The plate, a trapezoid standing proud of the chest and leaning with it.
    {
      color: kit.armor,
      rings: [
        { y: 0.17, w: 0.3, d: 0.05, k: 0.3, z: 0.135 },
        { y: 0.43, w: 0.36, d: 0.05, k: 0.3, z: 0.15 },
      ],
    },
    // The collar the neck stands out of.
    {
      color: kit.armor,
      rings: [
        { y: 0.47, w: 0.3, d: 0.22, k: 0.5 },
        { y: 0.55, w: 0.25, d: 0.19, k: 0.5 },
      ],
    },
    // Webbing: the hips under the belt (which close the gap the old chest left
    // above the thighs), the belt, two magazine pouches under the plate, a
    // canteen on the right hip, the pack, its bedroll, and the antenna off
    // that. All one mesh with the belt, so the load-out costs what the belt did.
    {
      color: kit.webbing,
      rings: [
        { y: -0.15, w: 0.32, d: 0.2, k: 0.3 },
        { y: -0.04, w: 0.36, d: 0.24, k: 0.35 },
      ],
    },
    {
      color: kit.webbing,
      rings: [
        { y: -0.05, w: 0.37, d: 0.25, k: 0.35 },
        { y: 0.06, w: 0.385, d: 0.265, k: 0.35 },
      ],
    },
    ...[-0.11, 0.11].map(
      (x): SegmentLoft => ({
        color: kit.webbing,
        rings: [
          { y: 0.07, w: 0.1, d: 0.07, k: 0.25, x, z: 0.15 },
          { y: 0.2, w: 0.1, d: 0.08, k: 0.25, x, z: 0.155 },
        ],
      }),
    ),
    {
      color: kit.webbing,
      rings: [
        { y: 0.0, w: 0.09, d: 0.09, k: 0.5, x: 0.2, z: -0.06 },
        { y: 0.11, w: 0.09, d: 0.09, k: 0.5, x: 0.2, z: -0.06 },
      ],
    },
    {
      color: kit.webbing,
      rings: [
        { y: 0.1, w: 0.28, d: 0.12, k: 0.3, z: -0.18 },
        { y: 0.4, w: 0.3, d: 0.14, k: 0.3, z: -0.19 },
      ],
    },
    // The bedroll is a roll: an octagon laid along x across the top of the pack.
    {
      color: kit.webbing,
      rings: [
        { y: -0.16, w: 0.1, d: 0.1, k: 0.5 },
        { y: 0.16, w: 0.1, d: 0.1, k: 0.5 },
      ],
      at: [0, 0.45, -0.19],
      rot: [0, 0, Math.PI / 2],
    },
    // The antenna tops out 3 cm above the helmet: a soldier's tell against the
    // sky, and short enough not to read as a mast.
    [0.03, 0.34, 0.03, 0.13, 0.62, -0.19, kit.webbing],
    // The bandolier crosses the chest and stands proud of it front and back,
    // so the body's share of the team colour is on both faces.
    [0.075, 0.58, 0.31, -0.02, 0.26, 0, kit.accent, 0.5],
  ]);

  // --- head: a domed helmet, the side's own face, and a glowing visor ---
  //
  // The helmet is a dome of five rings rather than a cube, flared at the rim,
  // and the visor now sits UNDER that rim on a face of its own rather than
  // being painted across the helmet's front — which is the one change that
  // turns the head from a block into a helmet on somebody.
  const head = tree.add("bot-head", torso);
  head.position.y = HEAD_ABOVE_TORSO;
  segment("bot-head-m", head, [
    {
      color: kit.armor,
      rings: [
        { y: 0.085, w: 0.285, d: 0.305, k: 0.4, z: -0.005 },
        { y: 0.12, w: 0.29, d: 0.31, k: 0.4 },
        { y: 0.185, w: 0.27, d: 0.29, k: 0.45 },
        { y: 0.225, w: 0.21, d: 0.23, k: 0.5 },
        { y: 0.245, w: 0.12, d: 0.13, k: 0.5 },
      ],
    },
    ...faceParts(kit),
    // Neck, and the face under the rim: the dark undersuit's balaclava.
    {
      color: kit.suit,
      rings: [
        { y: -0.07, w: 0.12, d: 0.12, k: 0.4 },
        { y: 0.03, w: 0.12, d: 0.12, k: 0.4 },
      ],
    },
    {
      color: kit.suit,
      rings: [
        { y: 0.0, w: 0.15, d: 0.16, k: 0.35, z: 0.015 },
        { y: 0.1, w: 0.19, d: 0.2, k: 0.35, z: 0.01 },
      ],
    },
    // Chin straps down both cheeks.
    [0.015, 0.09, 0.02, -0.095, 0.05, 0.02, kit.webbing],
    [0.015, 0.09, 0.02, 0.095, 0.05, 0.02, kit.webbing],
    // The helmet band, and the one mesh this rig pays for the team read — the
    // head is what clears a wall first and is often all there is to shoot at.
    // It wraps the whole dome now that the visor sits below the rim and there
    // is nothing on the helmet's front for it to cross.
    {
      color: kit.accent,
      rings: [
        { y: 0.115, w: 0.296, d: 0.316, k: 0.4 },
        { y: 0.16, w: 0.288, d: 0.308, k: 0.42 },
      ],
    },
  ]);
  // The visor protrudes past the face so the ink cannot swallow it. EMISSIVE,
  // so a segment of its own outside the kit palette: its colour is a slot in
  // the visors' table (`VISOR_COLORS`, by the view), and it carries no ink
  // by the glow's mask, which it is drawn into (`noInk`'s intent).
  hang(head, () => {
    const p = new Part("bot-visor", createBox({ width: 0.15, height: 0.04, depth: 0.05 }));
    p.position.set(0, 0.058, 0.118);
    writePaletteIndex(p.geometry, view + 1);
    return { name: "bot-visor", geometry: p.geometry, local: worldMatrixOf(p, new Matrix()), emissive: true };
  });

  // --- arms: an upper arm under a team pauldron, an elbow, a forearm and a
  // gloved hand, both hands solved onto the rifle ---
  /**
   * The pauldron is `accent` rather than `armor`, which is what makes the
   * shoulders a team read from every angle for no draw call at all. It is also
   * the highest thing on the body after the helmet, so it is what shows over a
   * wall and what a rooftop looks down on.
   *
   * **The forearm is a segment of its own, and that is the one mesh per arm
   * the elbow costs**: it hangs off a joint the upper arm does not, so it cannot
   * merge with it. It is drawn in `suit` alone, glove included, so the elbow
   * is exactly one mesh and not two.
   */
  const upperArm = (out: number): SegmentPart[] => [
    {
      // A PLATE over the shoulder rather than a knob on it: shallow, wider
      // than it is tall, and shifted outboard so its lower edge flares off the
      // arm. The arm is carried raised, so a tall cap here reads as a ball
      // tipped forward at the rifle.
      color: kit.accent,
      rings: [
        { y: -0.045, w: 0.2, d: 0.19, k: 0.3, x: 0.018 * out },
        { y: 0.02, w: 0.19, d: 0.18, k: 0.35, x: 0.01 * out },
        { y: 0.05, w: 0.12, d: 0.13, k: 0.5 },
      ],
    },
    {
      color: kit.suit,
      rings: [
        { y: 0.02, w: 0.13, d: 0.13, k: 0.4 },
        { y: -0.16, w: 0.12, d: 0.125, k: 0.4 },
        { y: -UPPER_ARM - 0.02, w: 0.1, d: 0.105, k: 0.4 },
      ],
    },
  ];
  const foreArm = (): SegmentPart[] => [
    {
      // The elbow pad, standing proud of the joint, into a tapering forearm.
      color: kit.suit,
      rings: [
        { y: 0.035, w: 0.105, d: 0.1, k: 0.45, z: -0.005 },
        { y: -0.05, w: 0.115, d: 0.115, k: 0.4 },
        { y: -FOREARM, w: 0.085, d: 0.08, k: 0.4 },
      ],
    },
    {
      // The glove: wider across the knuckles than at the wrist.
      color: kit.suit,
      rings: [
        { y: -FOREARM + 0.01, w: 0.085, d: 0.075, k: 0.3 },
        { y: -FOREARM - HAND, w: 0.075, d: 0.1, k: 0.35, z: 0.005 },
        { y: -FOREARM - HAND - 0.04, w: 0.06, d: 0.075, k: 0.4 },
      ],
    },
  ];

  const arm = (side: "L" | "R", x: number): [Joint, Joint] => {
    const shoulder = tree.add(`bot-sh${side}`, torso);
    shoulder.position.set(x, SHOULDER_Y, 0);
    segment(`bot-arm${side}`, shoulder, upperArm(Math.sign(x)));
    const elbow = tree.add(`bot-el${side}`, shoulder);
    elbow.position.y = -UPPER_ARM;
    segment(`bot-fore${side}`, elbow, foreArm());
    return [shoulder, elbow];
  };
  const [shoulderL, elbowL] = arm("L", -SHOULDER_X);
  const [shoulderR, elbowR] = arm("R", SHOULDER_X);

  // --- rifle: one merged block held across the chest ---
  const gun = tree.add("bot-gun", torso);
  gun.position.set(...GUN_AT);
  // Nine parts and still one mesh, because they are all one colour — the
  // cheapest detail on the whole model, on the part of it that is held out in
  // front of the body and read against the sky. The long parts are lofted
  // along the bore (`lengthwise`); the magazine and the grip stand vertical,
  // raked the way a real one is, and the grip sits where `GRIP_R` closes a
  // fist and the magazine's front edge where `GRIP_L` does.
  segment("bot-rifle", gun, [
    // Receiver, tapering slightly into the handguard.
    lengthwise(GUN, [
      { z: -0.17, w: 0.07, h: 0.11, k: 0.2 },
      { z: 0.2, w: 0.075, h: 0.12, k: 0.2 },
      { z: 0.235, w: 0.065, h: 0.1, k: 0.3 },
    ]),
    // Stock: drops a little and deepens toward the butt.
    lengthwise(GUN, [
      { z: -0.14, w: 0.055, h: 0.08, k: 0.3, dy: 0.005 },
      { z: -0.3, w: 0.06, h: 0.1, k: 0.3, dy: -0.01 },
      { z: -0.35, w: 0.065, h: 0.12, k: 0.25, dy: -0.015 },
    ]),
    // Handguard, octagonal, and the barrel and brake out of it.
    lengthwise(GUN, [
      { z: 0.22, w: 0.07, h: 0.075, k: 0.45 },
      { z: 0.47, w: 0.06, h: 0.065, k: 0.45 },
    ], 0.005),
    lengthwise(GUN, [
      { z: 0.46, w: 0.03, h: 0.03, k: 0.5 },
      { z: 0.52, w: 0.028, h: 0.028, k: 0.5 },
    ], 0.01),
    lengthwise(GUN, [
      { z: 0.515, w: 0.042, h: 0.042, k: 0.5 },
      { z: 0.565, w: 0.038, h: 0.038, k: 0.5 },
    ], 0.01),
    // Magazine, curving forward as it drops.
    {
      color: GUN,
      rings: [
        { y: -0.04, w: 0.05, d: 0.09, k: 0.2 },
        { y: -0.13, w: 0.05, d: 0.09, k: 0.2, z: 0.02 },
        { y: -0.21, w: 0.05, d: 0.085, k: 0.2, z: 0.05 },
      ],
    },
    // Pistol grip, raked back.
    {
      color: GUN,
      rings: [
        { y: -0.05, w: 0.045, d: 0.07, k: 0.35, z: -0.1 },
        { y: -0.165, w: 0.045, d: 0.065, k: 0.35, z: -0.135 },
      ],
    },
    // Optic on the top of the receiver, and the front sight post.
    {
      color: GUN,
      rings: [
        { y: 0.055, w: 0.045, d: 0.11, k: 0.3, z: 0.05 },
        { y: 0.105, w: 0.038, d: 0.09, k: 0.4, z: 0.05 },
      ],
    },
    [0.02, 0.05, 0.02, 0, 0.065, 0.44, GUN],
  ]);
  const muzzle = tree.add("bot-muzzle", gun);
  muzzle.position.set(...MUZZLE_AT);

  // --- the launcher, slung across the back. Off on every rig until the
  // roster says otherwise, and it does for one bot in each squad ---
  //
  // **It is worn rather than held**, and that is the honest shape as well as
  // the cheap one: an AT gunner carries a rifle and a tube, and the tube is
  // over their shoulder until there is armour to point it at. What it buys is
  // the thing a player actually needs, which is being able to tell WHICH body
  // in a squad is the one that can hurt the tank they are sitting in — from
  // the side, at range, in one silhouette. It is a joint of its own so that
  // enabling it is one switch and costs nothing on the fifteen rigs that do
  // not have one.
  const launcher = tree.add("bot-launcher", torso);
  launcher.position.set(-0.08, 0.26, -0.2);
  // Canted across the back: down to the left and tipped out from the spine, so
  // it reads as slung rather than as a plank bolted on.
  launcher.rotation.set(0.22, 0, 0.75);
  segment("bot-launcher-m", launcher, [
    [0.11, 0.11, 0.86, 0, 0, 0, GUN],
    [0.16, 0.16, 0.1, 0, 0, -0.44, GUN],
    [0.2, 0.2, 0.16, 0, 0, 0.46, GUN],
    [0.09, 0.13, 0.14, 0, -0.1, -0.12, GUN],
  ]);
  launcher.enabled = false;

  // --- legs ---
  /**
   * Thigh, shin and boot, hung off a hip, a knee and an ankle.
   *
   * Lofted like the rest of the body: a thigh that narrows from the hip to the
   * knee, a shin that swells at the calf and pinches at the ankle, and a boot
   * whose instep slopes from the toe up into the shaft rather than a brick
   * with a smaller brick in front of it. The joints are where they always were
   * — the knee at the bottom of the thigh, the ankle at the bottom of the shin,
   * the sole at the ankle's -0.07 — so the crouch's solve and the bone table
   * are unchanged. Each segment still carries ONE colour (armor, suit,
   * webbing), so the plate on the thigh, the kneepad and the toe cap are
   * silhouette that costs nothing and a leg is still three meshes.
   */
  const leg = (name: string, hip: Joint): [Joint, Joint] => {
    segment(name, hip, [
      {
        color: kit.armor,
        rings: [
          { y: 0.03, w: 0.19, d: 0.2, k: 0.35 },
          { y: -0.12, w: 0.185, d: 0.2, k: 0.35, z: 0.005 },
          { y: -0.33, w: 0.15, d: 0.16, k: 0.35, z: 0.01 },
          { y: -THIGH - 0.01, w: 0.135, d: 0.145, k: 0.4 },
        ],
      },
      // The thigh plate, a tapered slab standing proud of the front.
      {
        color: kit.armor,
        rings: [
          { y: -0.06, w: 0.15, d: 0.04, k: 0.3, z: 0.1 },
          { y: -0.29, w: 0.125, d: 0.04, k: 0.3, z: 0.09 },
        ],
      },
    ]);
    const knee = tree.add(`${name}-knee`, hip);
    knee.position.y = -THIGH;
    segment(name, knee, [
      {
        color: kit.suit,
        rings: [
          { y: 0.02, w: 0.13, d: 0.14, k: 0.4 },
          { y: -0.12, w: 0.135, d: 0.15, k: 0.4, z: -0.01 },
          { y: -SHIN, w: 0.1, d: 0.11, k: 0.4 },
        ],
      },
      // The kneepad, over the joint so it rides the fold.
      {
        color: kit.suit,
        rings: [
          { y: 0.06, w: 0.15, d: 0.07, k: 0.4, z: 0.055 },
          { y: -0.06, w: 0.14, d: 0.08, k: 0.4, z: 0.06 },
        ],
      },
    ]);
    const ankle = tree.add(`${name}-ankle`, knee);
    ankle.position.y = -SHIN;
    segment(name, ankle, [
      {
        // Sole to shaft in one loft: the rings slide back and shorten as they
        // rise, which is the instep.
        color: kit.webbing,
        rings: [
          { y: -0.07, w: 0.14, d: 0.26, k: 0.3, z: 0.035 },
          { y: -0.035, w: 0.135, d: 0.24, k: 0.3, z: 0.03 },
          { y: 0.0, w: 0.125, d: 0.15, k: 0.35 },
          { y: 0.07, w: 0.115, d: 0.125, k: 0.35, z: -0.005 },
        ],
      },
      // The toe cap.
      {
        color: kit.webbing,
        rings: [
          { y: -0.07, w: 0.13, d: 0.08, k: 0.45, z: 0.125 },
          { y: -0.03, w: 0.11, d: 0.06, k: 0.45, z: 0.12 },
        ],
      },
    ]);
    return [knee, ankle];
  };

  const hipL = tree.add("bot-hipL", body);
  hipL.position.set(-0.12, -0.02, 0);
  const [kneeL, ankleL] = leg("bot-legL", hipL);

  const hipR = tree.add("bot-hipR", body);
  hipR.position.set(0.12, -0.02, 0);
  const [kneeR, ankleR] = leg("bot-legR", hipR);


  const rig: SoldierRig = {
    tree,
    root,
    body,
    torso,
    head,
    shoulderL,
    shoulderR,
    elbowL,
    elbowR,
    hipL,
    hipR,
    kneeL,
    kneeR,
    ankleL,
    ankleR,
    gun,
    muzzle,
    launcher,
    kit: view,
    segments,
    // On, as a node is built — every owner switches it at once.
    enabled: true,
    centerHeight,
    rest: [],
  };
  // Taken here, at the end of the build, so it records the hierarchy as
  // authored above rather than whatever a previous life left behind.
  rig.rest = POSED_JOINTS.map((key: PosedJoint) => {
    const node = rig[key];
    return { node, position: node.position.clone() };
  });
  if (building) kitDrawings[view] = kitDrawingOf(building);
  return rig;
}

/**
 * Puts every joint back to the transform `buildSoldier` gave it.
 *
 * This is the ONLY correct reset after anything that took the rig out of its
 * own hands, and `animateSoldier(rig, REST_POSE)` is not a substitute for it.
 * That call writes Euler channels and the rifle's place in the torso — and
 * nothing else. It never touches a POSE, a `scaling`, or the position of any
 * joint but `body` and `gun`. A ragdoll leaves its residue in the first of
 * those: it draws the bones off its bodies' poses (`Joint.pose`), and the rest
 * is restored too because anything that ever wrote them is worth undoing on
 * the one path every reuse goes through.
 *
 * The pose is the load-bearing line. While one is set the joint takes its
 * world from the pose array and not from the rig, so a pose left behind by a
 * corpse draws the respawned bot's limbs where the corpse lay — or, once the
 * pool parks that body, a kilometre under the map — for the rest of the
 * round, with its root still updating correctly underneath. (Until X4.1b it
 * was a HOLDER, the pool's proxy node the joint hung on, and when the joints
 * were nodes it was a leaked `rotationQuaternion`, which Babylon let win over
 * `rotation`; a joint has no quaternion to leak.)
 */
export function resetSoldierPose(rig: SoldierRig): void {
  for (const { node, position } of rig.rest) {
    node.pose = null;
    node.rotation.setAll(0);
    node.position.copyFrom(position);
    node.scaling.setAll(1);
  }
  animateSoldier(rig, REST_POSE);
}

/**
 * Switches a body in or out of the world: the rig's own switch, the one every
 * roster, the death cam, the culling and the drawing read. A segment hung
 * under a joint that is itself switched off (the launcher) stays undrawn
 * while it is on (`writeRigDrawing`).
 */
export function setRigEnabled(rig: SoldierRig, on: boolean): void {
  rig.enabled = on;
}

/** Whether the rig carries its slung launcher — see `SoldierRig.launcher`. */
export function setLauncher(rig: SoldierRig, on: boolean): void {
  rig.launcher.enabled = on;
}

/** Whether every joint from `j` up its tree is switched on. */
function jointOn(j: Joint): boolean {
  for (let at: Joint | null = j; at; at = at.parent) if (!at.enabled) return false;
  return true;
}

// Scratch for `writeRigDrawing` and `writeRigCentres`.
const _meshWorld = new Matrix();

/**
 * Composes the rig's joints and writes its DRAWING into `out` from `at`: each
 * segment's world matrix, sixteen floats in its kit's order — the segment's
 * own local times its joint's world, what Babylon composed for the mesh it
 * was (`BABYLON_EXIT.md` X4.1d; X4.1a for the arithmetic) — and sixteen
 * zeros for a segment under a joint switched off (the launcher), which the
 * drawing draws as nothing.
 *
 * **Called once a frame for every body the frame draws, after every write
 * and before the render** (`Game.drawBodies`, inside the render span, where
 * Babylon composed these until X4.1a). The rig's own switch is the caller's
 * to have asked. Allocates nothing.
 */
export function writeRigDrawing(rig: SoldierRig, out: Float32Array, at: number): void {
  rig.tree.compute();
  const segments = rig.segments;
  for (let s = 0; s < segments.length; s++) {
    const seg = segments[s];
    const o = at + s * 16;
    if (!jointOn(seg.joint)) {
      out.fill(0, o, o + 16);
      continue;
    }
    seg.local.multiplyToRef(seg.joint.world, _meshWorld);
    out.set(_meshWorld.m, o);
  }
}

/**
 * Where each of the rig's segments stands, off the drawing `writeRigDrawing`
 * just wrote at `at`: its bounding sphere's centre in the world, three
 * doubles a segment into `out` from `outAt` — what Babylon's
 * `boundingSphere.centerWorld` held for the segment's mesh, which its
 * front-to-back queue sorted the mesh by and `GlowRules` faded the visor's
 * bloom by. NaN for a segment switched off (a zero matrix), which nothing
 * draws.
 */
export function writeRigCentres(rig: SoldierRig, drawing: Float32Array, at: number, out: Float64Array, outAt: number): void {
  const centres = kitDrawings[rig.kit]!.centres;
  for (let s = 0; s < centres.length; s++) {
    const o = outAt + s * 3;
    if (drawing[at + s * 16 + 15] === 0) {
      out[o] = out[o + 1] = out[o + 2] = Number.NaN;
      continue;
    }
    Matrix.FromArrayToRef(drawing, at + s * 16, _meshWorld);
    Vector3.TransformCoordinatesToRef(centres[s], _meshWorld, _centre);
    out[o] = _centre.x;
    out[o + 1] = _centre.y;
    out[o + 2] = _centre.z;
  }
}

const _centre = new Vector3();

/**
 * A joint's world position, fresh — what `computeWorldMatrix(true)` then
 * `getAbsolutePosition()` read off a node: the float32 translation row.
 */
export function jointPosition<T extends { set(x: number, y: number, z: number): unknown }>(
  rig: SoldierRig,
  joint: Joint,
  out: T,
): T {
  const m = rig.tree.computeChain(joint).m;
  out.set(m[12], m[13], m[14]);
  return out;
}

/**
 * The body's one MEASURE, this frame: the world sphere of the capsule its root
 * stood for (`rigJoints.measureBody`) — what `WorldCulling` drops a whole body
 * by, off a fresh compose of the root, as the capsule's forced matrix was.
 */
export function measureRig(rig: SoldierRig, out: BodySphere): BodySphere {
  return measureBody(rig.tree.computeChain(rig.root), out);
}

/**
 * The rig as `WorldCulling` files a pooled body (its `PooledBody`, met
 * structurally so neither file names the other): the switch and the measure.
 * Made once per rig per install, never per frame.
 */
export function pooledBody(rig: SoldierRig): {
  readonly enabled: boolean;
  measure(out: BodySphere): void;
} {
  return {
    get enabled() {
      return rig.enabled;
    },
    measure: (out) => {
      measureRig(rig, out);
    },
  };
}

/**
 * Each side's DRAWING, by the view, once a rig of that side has been built —
 * see `soldierKits`.
 */
const kitDrawings: (KitDrawing | null)[] = KITS.map(() => null);

/**
 * Every side's drawing, by the VIEW (`KITS`' order): what our renderer draws
 * every body as an instance of (`render/BodyDraw.ts`). Built here, once, the
 * first time a side is asked for — building a rig of it — and the same
 * objects for the life of the page: a kit is module constants.
 */
export function soldierKits(): readonly KitDrawing[] {
  return KITS.map((_, view) => {
    if (!kitDrawings[view]) buildRig(view);
    return kitDrawings[view]!;
  });
}

/** A segment's drawing out of its merged parts: the merge at identity, or one part in its own frame. */
function mergeSegment(parts: Part[], name: string): KitSegment {
  // A group of ONE was never merged — it kept its own transform, as the mesh
  // `drawnMesh` made of the part did; a merge stands at identity, composed as
  // a node at rest composes (the same bits `Matrix.Identity` holds).
  if (parts.length === 1) {
    return { name, geometry: parts[0].geometry, local: worldMatrixOf(parts[0], new Matrix()), emissive: false };
  }
  return { name, geometry: mergeParts(parts), local: worldMatrixOf(new PartNode(name), new Matrix()), emissive: false };
}

/**
 * A kit's drawing out of the segments its first rig built: where the visor
 * is, and its bounding sphere's centre in its own frame — the midpoint of its
 * vertices' extent, as Babylon's `BoundingSphere` made it of the mesh's.
 */
function kitDrawingOf(segments: readonly KitSegment[]): KitDrawing {
  const visor = segments.findIndex((s) => s.emissive);
  if (visor < 0) throw new Error("[soldier] a kit with no visor");
  const centres = segments.map((seg) => {
    // `extractMinAndMax` over the positions as the mesh was handed them,
    // then `BoundingSphere.reConstruct`'s `max.addToRef(min).scale(0.5)`.
    const p = seg.geometry.positions;
    const min = new Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
    const max = new Vector3(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE);
    for (let i = 0; i < p.length; i += 3) {
      min.minimizeInPlaceFromFloats(p[i], p[i + 1], p[i + 2]);
      max.maximizeInPlaceFromFloats(p[i], p[i + 1], p[i + 2]);
    }
    return max.addToRef(min, new Vector3()).scaleInPlace(0.5);
  });
  return { segments, centres, visor };
}

/**
 * Where the left hand goes through a magazine change: `[progress, frame, x, y,
 * z]`, with `frame` 0 for the rifle's own frame (it rides the rifle) and 1 for
 * the torso's (it has left it). Played as one smoothstepped leg per pair.
 *
 * Out to the magazine's base, strip it, down and away to the left pouch on the
 * carrier, a beat there, back up to the well, seated with a push, and home to
 * the receiver. The right hand never leaves the grip, and the rifle is canted
 * toward the left hand for the length of it (`animateSoldier`), which is the
 * read at range: a body that is changing a magazine is one whose rifle has
 * tipped over and whose left arm is working. The magazine itself is part of the
 * rifle's one merged mesh and does not come out — at the distance a reload is
 * worth reading, the hand and the cant are the whole of it.
 */
const RELOAD_KEYS: readonly (readonly [number, 0 | 1, number, number, number])[] = [
  [0, 0, ...GRIP_L],
  [0.12, 0, 0, -0.22, 0.12],
  [0.24, 1, -0.06, -0.02, 0.36],
  [0.36, 1, -0.13, 0.12, 0.25],
  [0.48, 1, -0.13, 0.1, 0.25],
  [0.63, 0, 0, -0.25, 0.13],
  [0.72, 0, 0, -0.16, 0.11],
  [0.84, 0, ...GRIP_L],
  [1, 0, ...GRIP_L],
];

const _solved = newSoldierJoints();
const _gunM = new Matrix();
const _handL = new Vector3();
const _handR = new Vector3();
const _keyA = new Vector3();
const _keyB = new Vector3();

/** A point in the rifle's frame, carried into the torso's by the pose just written. */
function onRifle(rig: SoldierRig, x: number, y: number, z: number, out: Vector3): Vector3 {
  Vector3.TransformCoordinatesFromFloatsToRef(x, y, z, _gunM, out);
  return out.addInPlace(rig.gun.position);
}

/** A reload key, in the torso's frame. */
function reloadKey(
  rig: SoldierRig,
  k: readonly [number, 0 | 1, number, number, number],
  out: Vector3,
): Vector3 {
  return k[1] === 0 ? onRifle(rig, k[2], k[3], k[4], out) : out.set(k[2], k[3], k[4]);
}

/**
 * Poses the rig: solves `p` (`soldierPose.ts`'s `solveSoldier`) and writes it
 * onto the joints (`poseSoldier`). What each field means is `SoldierPose`'s;
 * what drives them is `SoldierMotion`'s.
 */
export function animateSoldier(rig: SoldierRig, p: Readonly<SoldierPose>): void {
  poseSoldier(rig, solveSoldier(p, _solved));
}

/**
 * Writes a SOLVED pose onto the rig's joints, and solves the arms onto it.
 *
 * Every channel `solveSoldier` decides is written here and nothing else is,
 * so a rig posed from `j` holds exactly the numbers `soldierMuzzleToRef`
 * replays — which is what lets the simulation ask where the rifle is without
 * asking the rig.
 *
 * **The rifle is posed first and the hands follow it** — `solveArm` runs against
 * wherever this pose put the grips — so a kick, a lowered carry and a canted
 * reload all keep both fists where they belong without either being authored
 * per case.
 */
function poseSoldier(rig: SoldierRig, j: Readonly<SoldierJoints>): void {
  // This posed a DEATH too, on a `dead` progress argument no caller passes any
  // more: the collapse tween that stood in wherever the ragdoll pool refused a
  // body. Havok is required and the pool refuses nothing the player can see, so
  // the only bodies that reach a death without a solver are ones already past
  // the fog wall, and they are not drawn. See `Bot.update`'s dead branch.
  rig.body.rotation.x = 0;
  rig.hipL.rotation.set(j.hipLX, 0, j.hipLZ);
  rig.hipR.rotation.set(j.hipRX, 0, j.hipRZ);
  rig.kneeL.rotation.x = j.kneeL;
  rig.kneeR.rotation.x = j.kneeR;
  rig.ankleL.rotation.x = j.ankleL;
  rig.ankleR.rotation.x = j.ankleR;
  rig.body.position.y = j.bodyY;
  rig.torso.rotation.set(j.torsoX, j.torsoY, j.torsoZ);
  rig.head.rotation.set(j.headX, j.headY, j.headZ);
  rig.gun.rotation.set(j.gunX, j.gunY, j.gunZ);
  rig.gun.position.set(j.gunPX, j.gunPY, j.gunPZ);
  // A joint composes its Euler as yaw-pitch-roll (as `TransformNode` did),
  // and so does this.
  Matrix.RotationYawPitchRollToRef(j.gunY, j.gunX, j.gunZ, _gunM);

  // --- hands ---
  onRifle(rig, GRIP_R[0], GRIP_R[1], GRIP_R[2], _handR);
  const reload = j.reload;
  if (reload > 0 && reload < 1) {
    let i = 0;
    while (i < RELOAD_KEYS.length - 2 && reload > RELOAD_KEYS[i + 1][0]) i++;
    const a = RELOAD_KEYS[i];
    const b = RELOAD_KEYS[i + 1];
    const t = smooth((reload - a[0]) / (b[0] - a[0]));
    reloadKey(rig, a, _keyA);
    reloadKey(rig, b, _keyB);
    Vector3.LerpToRef(_keyA, _keyB, t, _handL);
  } else {
    onRifle(rig, GRIP_L[0], GRIP_L[1], GRIP_L[2], _handL);
  }
  rig.elbowL.rotation.x = solveArm(-SHOULDER_X, _handL, POLE_L, rig.shoulderL.rotation);
  rig.elbowR.rotation.x = solveArm(SHOULDER_X, _handR, POLE_R, rig.shoulderR.rotation);
}
