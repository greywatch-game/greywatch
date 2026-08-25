/**
 * SoldierModel.ts — The bot rig: ~40 boxes merged down to nineteen meshes, plus
 * procedural animation (animateSoldier: walk cycle, aim, upper-body twist,
 * crouch — posed TransformNode joints, never clips), plus the bone table
 * `RagdollSystem` builds a corpse's rigid bodies from.
 * Invariants: merging per colour is what keeps 16 bots affordable — the outline
 * pass draws every mesh twice, so the cost of this rig is COLOURS PER SEGMENT
 * and not boxes. A box in a colour a segment already carries is free; a fifth
 * colour on the torso is 32 draw calls across a full roster. Emissive parts
 * (visor) need metadata.noOutline. Rigs are built once by BattleSystem's pool
 * and re-posed on respawn, never disposed. `rig.rest` is the hierarchy as built
 * and is the ONLY thing a ragdoll may restore from — see JointRest.
 */
import {
  Mesh,
  MeshBuilder,
  Scene,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import { addOutline, type CelMaterialFactory } from "../shaders/CelShader";
import type { Team } from "./Combatant";
// Type-only, so no runtime edge is created — the same import `Tank` takes
// for the same reason. `DamageKind` lives with the shot that carries it.
import type { DamageKind } from "../systems/CombatSystem";

/**
 * The bot soldier rig: a humanoid built to be cheap enough to draw sixteen
 * of at once, and detailed enough to be read as a soldier at the range one is
 * usually shot at.
 *
 * Every limb is built from several boxes and then **merged into one mesh per
 * colour**, the same trick `RifleModel.buildRifle` uses to collapse ~50 boxes
 * into 3. The joints stay as `TransformNode`s above the merged meshes, so
 * procedural animation is unaffected — only the leaf geometry is batched.
 *
 * **What that merge means for anyone adding detail: geometry is nearly free and
 * PAINT is not.** Forty-odd boxes come out as nineteen meshes — torso (shell,
 * webbing, accent), head (shell, webbing, neck, accent, visor), two arms (suit,
 * accent), two legs (thigh, shin, boot) and the rifle — because a segment pays
 * per colour in it and not per box. The outline pass draws each of those twice
 * and a Conquest roster is sixteen bodies, so one more colour on a segment is
 * ~32 draw calls and one more box in a colour that segment already has is none.
 * Pouches, a bedroll, a kneepad and an antenna are all in the second category
 * on purpose; the helmet band is the only thing here that was worth paying a
 * mesh for, and it is paid because the head is what peeks over cover.
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
 * The other three are ART and live here for the reason `RAGDOLL_BONES` does —
 * they belong with the box lists they are painted onto.
 */
interface SoldierKit {
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
  /** Which head this side wears — see `faceBoxes`. */
  face: "brim" | "respirator";
}

/** One kit per team, indexed by `Team`. */
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

/** Which joint a ragdoll bone hangs off. Keys into `SoldierRig`. */
export type BoneJoint =
  | "torso"
  | "head"
  | "shoulderL"
  | "shoulderR"
  | "hipL"
  | "hipR"
  | "kneeL"
  | "kneeR"
  | "ankleL"
  | "ankleR";

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

/**
 * The leg, in segments, measured off the box lists in `buildSoldier`.
 *
 * The knee sits at the bottom of the thigh box and the ankle at the bottom of
 * the shin box, so at rest every one of these joints is at zero and the drawn
 * leg is exactly what it was before the joints existed. `LEG_SPAN` is the hip's
 * height above the ankle standing, which is what the crouch's inverse kinematics
 * solves against — it is not the leg's full length, because the boot hangs
 * below the ankle and is rigid.
 */
const THIGH = 0.34;
const SHIN = 0.32;
const LEG_SPAN = THIGH + SHIN;

/** The head joint's height above the torso joint. Moves with the box lists. */
const HEAD_ABOVE_TORSO = 0.52;

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

/**
 * One rigid body's box, in its joint's own frame.
 *
 * These are ART constants and live here rather than in `CONFIG` for the reason
 * the file header gives: they are measured off the box lists below and have to
 * move when those move. A mass is not quite art, but it is meaningless away
 * from the extents it goes with, so the pair stays together — what `CONFIG`
 * owns is the sim (impulse, gravity, corpse life), not the skeleton.
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
 * The ragdoll's ten bones, derived from the segment box lists below. Extents
 * are the union of a joint's boxes, trimmed inside the silhouette — see
 * `BoneSpec` for what that leaves out and why.
 *
 * **The legs are three bones apiece — thigh, shin and boot — because a body can
 * die crouched.** They were one rigid 0.72 m segment from hip to sole until
 * they had to be: a folded leg is that shape nowhere, so `RagdollSystem.spawn`
 * refused a body caught mid-crouch outright and the tween took it, which meant
 * the one stance a player holds while being shot at was also the one stance
 * that could not fall over. The three boxes here are the three the leg is
 * DRAWN from, hung off the same hip, knee and ankle the crouch bends, so the
 * collider now agrees with the mesh in every pose the rig can hold rather than
 * only in the standing one. There is still no elbow and no spine — a forearm
 * is baked into the merged upper-arm mesh.
 *
 * The three masses split the leg's old 15 where the leg's own weight is
 * (8/5/2), so the body still totals 80 kg and every number in
 * `CONFIG.bots.death.impulse` means what it did when it was tuned.
 *
 * **The rifle is deliberately NOT a bone.** It stays parented to `torso` and
 * rides that body for free. Giving it one would drop it out of hands that
 * cannot open — the arm is a single welded segment with no elbow, wrist or
 * finger — so the weapon would fall away while two fists stayed cupped around
 * nothing, which reads as a bug rather than as a dropped weapon.
 */
export const RAGDOLL_BONES: readonly BoneSpec[] = [
  // Chest: the carrier, the pack and the bandolier, y in [-0.03, 0.49]. The
  // collar reaches 0.54 and the antenna off the pack 0.79; neither is body.
  { joint: "torso", size: [0.42, 0.52, 0.3], center: [0, 0.23, -0.03], mass: 34 },
  // Helmet, neck and visor, y in [-0.025, 0.235]. Neither side's face — a
  // Valeguard peak, a Redline respirator and shroud — is inside this box.
  { joint: "head", size: [0.26, 0.26, 0.27], center: [0, 0.105, 0], mass: 6 },
  // Shoulder to hand in one piece, y in [-0.48, 0.07], the glove trimmed off
  // the end of it.
  {
    joint: "shoulderL",
    size: [0.16, 0.55, 0.18],
    center: [0, -0.205, 0.015],
    mass: 5,
  },
  {
    joint: "shoulderR",
    size: [0.16, 0.55, 0.18],
    center: [0, -0.205, 0.015],
    mass: 5,
  },
  // Thigh: hip to knee, y in [-THIGH, 0].
  { joint: "hipL", size: [0.17, 0.34, 0.18], center: [0, -0.17, 0], mass: 8 },
  { joint: "hipR", size: [0.17, 0.34, 0.18], center: [0, -0.17, 0], mass: 8 },
  // Shin: knee to ankle, y in [-SHIN, 0].
  { joint: "kneeL", size: [0.15, 0.32, 0.15], center: [0, -0.16, 0], mass: 5 },
  { joint: "kneeR", size: [0.15, 0.32, 0.15], center: [0, -0.16, 0], mass: 5 },
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
  shoulderL: {
    parent: "torso",
    pivot: [-0.28, 0.42, 0],
    x: [-1.6, 1.2],
    y: [-0.5, 0.5],
    z: [-0.2, 1.7],
  },
  shoulderR: {
    parent: "torso",
    pivot: [0.28, 0.42, 0],
    x: [-1.6, 1.2],
    y: [-0.5, 0.5],
    z: [-1.7, 0.2],
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
  // `poseLegs` dorsiflexes the foot to -1.39 rad — further than an ankle goes,
  // and exactly where a crouched body has to be thrown from.
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
 * nothing has run yet when it is taken.
 */
export interface JointRest {
  node: TransformNode;
  parent: TransformNode;
  position: Vector3;
}

export interface SoldierRig {
  /** Invisible transform the rig hangs from; positioned at the body centre. */
  root: Mesh;
  body: TransformNode;
  torso: TransformNode;
  head: TransformNode;
  shoulderL: TransformNode;
  shoulderR: TransformNode;
  hipL: TransformNode;
  hipR: TransformNode;
  /**
   * Knees and ankles. They exist for the crouch — every body that takes one is
   * posed through them and a standing body holds them all at zero — and the
   * ankle is what keeps a boot flat on the ground while the shin folds under a
   * squat; without it the sole tips up with the shin and the toe goes through
   * the floor. Both are ragdoll bones as well, which is what lets a body die
   * crouched: see `RAGDOLL_BONES`.
   */
  kneeL: TransformNode;
  kneeR: TransformNode;
  ankleL: TransformNode;
  ankleR: TransformNode;
  /** The rifle held across the chest. A ragdoll bone of its own. */
  gun: TransformNode;
  /**
   * The rocket launcher slung across the back — disabled on every rig until a
   * bot is told it carries one, which `BattleSystem` decides per squad.
   *
   * Deliberately NOT a ragdoll bone and deliberately not in `RAGDOLL_BONES`:
   * it is welded to the torso, so it falls with the body under Havok as part
   * of the chest and needs no joint of its own. See `Bot.launcher`.
   */
  launcher: TransformNode;
  /** Muzzle landmark, for tracer origins. */
  muzzle: TransformNode;
  /** Every drawn mesh, for LOD visibility and outline toggling. */
  meshes: Mesh[];
  /** Height of the body centre above the feet. */
  centerHeight: number;
  /** Where every ragdoll bone joint sits when alive — see `JointRest`. */
  rest: readonly JointRest[];
}

/**
 * Everything `RagdollSystem` needs of a body it is about to throw. `Bot`
 * satisfies it structurally and so does the player's corpse stand-in, which is
 * the whole point: the pool has no business knowing which of the two it holds.
 *
 * It lives HERE rather than in `RagdollSystem` because it is a fact about a
 * soldier rig, and because the alternative is `DeathCam` importing a type from
 * another system — the one thing the wiring rules in CLAUDE.md forbid. Nothing
 * implementing it has to import it either; TypeScript's structural typing is
 * what keeps `Bot` free of any knowledge that a physics engine exists.
 */
export interface RagdollSubject {
  readonly rig: SoldierRig;
  /** The body's feet, used once for the distance gate at the moment of death. */
  readonly position: Vector3;
  /** The body's centre of mass, which the killing impulse is aimed away from. */
  readonly center: Vector3;
  /** Where the killing blow came from: a shooter's eye, or a blast centre. */
  readonly deathFrom: Vector3;
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
   * has to leave it alone in that window, or two writers fight over one node.
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
 * A rotation is safe where a scale is not: `MergeMeshes` bakes world matrices,
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
 * The boxes that give one side's head a shape of its own.
 *
 * Paint is the read that dies first — at dusk, in mist, or against a bright
 * Coldharbour sky a body is a value and not a hue — and a helmet is the part of
 * a soldier a player sees before any of the rest of them. So the sides differ
 * in the OUTLINE of the head as well as in its colour: Valeguard wear a peaked
 * helmet with a short neck guard, Redline a respirator under a long shroud.
 * Both are drawn in `armor`, so a side pays no mesh for having a face.
 */
function faceBoxes(kit: SoldierKit): SegmentBox[] {
  return kit.face === "brim"
    ? [
        // A peak shading the visor, and the guard down the back of the neck.
        [0.27, 0.035, 0.1, 0, 0.155, 0.15, kit.armor],
        [0.25, 0.08, 0.07, 0, 0.06, -0.145, kit.armor],
      ]
    : [
        // A filter over the mouth, under a shroud that hangs past the collar.
        [0.16, 0.11, 0.09, 0, 0.05, 0.145, kit.armor],
        [0.26, 0.15, 0.07, 0, 0.045, -0.15, kit.armor],
      ];
}

/** Builds one soldier in the given team's kit. */
export function buildSoldier(
  scene: Scene,
  mats: CelMaterialFactory,
  team: Team,
): SoldierRig {
  const kit = KITS[team];
  const centerHeight = 0.9;
  const root = MeshBuilder.CreateCapsule(
    "bot",
    { height: 1.8, radius: 0.4 },
    scene,
  );
  root.isVisible = false;
  root.isPickable = false;

  const meshes: Mesh[] = [];
  const body = new TransformNode("bot-body", scene);
  body.parent = root;

  /**
   * Builds one limb from a list of boxes, merges it per colour, and parents the
   * results to a joint. Offsets are relative to the joint, so the merge can
   * happen at identity and the joint carries the animation.
   */
  const segment = (
    name: string,
    parent: TransformNode,
    boxes: SegmentBox[],
  ): void => {
    const parts: Mesh[] = [];
    for (let i = 0; i < boxes.length; i++) {
      const [w, h, d, x, y, z, color, rotZ = 0] = boxes[i];
      const m = MeshBuilder.CreateBox(
        `${name}${i}`,
        { width: w, height: h, depth: d },
        scene,
      );
      m.position.set(x, y, z);
      m.rotation.z = rotZ;
      m.material = mats.get(color);
      parts.push(m);
    }
    for (const merged of mergeByColor(parts, name)) {
      merged.parent = parent;
      merged.isPickable = false;
      meshes.push(merged);
    }
  };

  // --- torso: plate carrier, webbing, pack, and the team's bandolier ---
  const torso = new TransformNode("bot-torso", scene);
  torso.parent = body;
  torso.position.y = 0.1;
  segment("bot-torso-m", torso, [
    // The shell: chest, the plate over it, and a collar the neck stands out of.
    [0.44, 0.5, 0.26, 0, 0.24, 0, kit.armor],
    [0.36, 0.26, 0.07, 0, 0.31, 0.155, kit.armor],
    [0.32, 0.07, 0.24, 0, 0.505, 0, kit.armor],
    // Webbing: belt, two magazine pouches under the plate, a canteen on the
    // right hip, the pack, its bedroll, and the radio antenna off that. All one
    // mesh with the belt, so the whole load-out costs what the belt alone did.
    [0.44, 0.1, 0.28, 0, 0.02, 0, kit.webbing],
    [0.1, 0.13, 0.08, -0.12, 0.13, 0.15, kit.webbing],
    [0.1, 0.13, 0.08, 0.12, 0.13, 0.15, kit.webbing],
    [0.09, 0.11, 0.09, 0.21, 0.05, -0.06, kit.webbing],
    [0.3, 0.3, 0.14, 0, 0.26, -0.19, kit.webbing],
    [0.32, 0.08, 0.11, 0, 0.44, -0.185, kit.webbing],
    // The antenna tops out 3 cm above the helmet: a soldier's tell against the
    // sky, and short enough not to read as a mast.
    [0.03, 0.34, 0.03, 0.13, 0.62, -0.19, kit.webbing],
    // The bandolier crosses the chest and stands 1.5 cm proud of it front and
    // back, so the body's share of the team colour is on both faces. The sash
    // it replaces was a stripe down one side of the front, inset far enough in
    // x that the chest occluded it the moment a body turned side-on.
    [0.075, 0.58, 0.29, -0.02, 0.26, 0, kit.accent, 0.5],
  ]);

  // --- head: helmet, the side's own face, and a glowing visor slit ---
  const head = new TransformNode("bot-head", scene);
  head.parent = torso;
  head.position.y = 0.52;
  segment("bot-head-m", head, [
    [0.25, 0.2, 0.26, 0, 0.125, 0, kit.armor],
    ...faceBoxes(kit),
    [0.27, 0.05, 0.28, 0, 0.215, 0, kit.webbing],
    [0.26, 0.05, 0.2, 0, 0.045, -0.01, kit.webbing],
    [0.13, 0.07, 0.13, 0, 0.01, 0, kit.suit],
    // The helmet band, and the one mesh this rig pays for the team read. It
    // wraps the sides and the back and its front face stops 1 cm inside the
    // helmet's, so the helmet occludes it head-on and it can never cross the
    // visor. Worth a draw call because the head is what clears a wall first
    // and is often all there is to shoot at.
    [0.265, 0.065, 0.25, 0, 0.1625, -0.005, kit.accent],
  ]);
  // The visor protrudes past the helmet so the outline shell can't swallow it.
  const visor = MeshBuilder.CreateBox(
    "bot-visor",
    { width: 0.16, height: 0.045, depth: 0.05 },
    scene,
  );
  visor.parent = head;
  visor.position.set(0, 0.12, 0.145);
  visor.material = mats.getEmissive(kit.visor);
  visor.metadata = { noOutline: true };
  visor.isPickable = false;
  meshes.push(visor);

  // --- arms: shoulder to fist in one welded segment, with a team pauldron ---
  /**
   * The pauldron is `accent` rather than `armor`, which is what makes the
   * shoulders a team read from every angle for no draw call at all: the arm
   * carried two colours before and carries two now. It is also the highest
   * thing on the body after the helmet, so it is what shows over a wall and
   * what a rooftop looks down on.
   */
  const armBoxes = (): SegmentBox[] => [
    [0.17, 0.095, 0.17, 0, 0.025, 0, kit.accent],
    [0.14, 0.26, 0.14, 0, -0.13, 0, kit.suit],
    [0.145, 0.08, 0.145, 0, -0.265, 0.015, kit.suit],
    [0.13, 0.24, 0.13, 0, -0.36, 0.05, kit.suit],
    [0.125, 0.1, 0.14, 0, -0.475, 0.075, kit.suit],
  ];

  const shoulderL = new TransformNode("bot-shL", scene);
  shoulderL.parent = torso;
  shoulderL.position.set(-0.28, 0.42, 0);
  segment("bot-armL", shoulderL, armBoxes());

  const shoulderR = new TransformNode("bot-shR", scene);
  shoulderR.parent = torso;
  shoulderR.position.set(0.28, 0.42, 0);
  segment("bot-armR", shoulderR, armBoxes());

  // --- rifle: one merged block held across the chest ---
  const gun = new TransformNode("bot-gun", scene);
  gun.parent = torso;
  gun.position.set(0.2, 0.2, 0.2);
  // Eight boxes and still one mesh, because they are all one colour — the
  // cheapest detail on the whole model, on the part of it that is held out in
  // front of the body and read against the sky.
  segment("bot-rifle", gun, [
    [0.08, 0.12, 0.42, 0, 0, 0.03, GUN],
    [0.07, 0.11, 0.22, 0, -0.005, -0.24, GUN],
    [0.06, 0.16, 0.12, 0, -0.13, 0, GUN],
    [0.055, 0.12, 0.1, 0, -0.1, -0.11, GUN],
    [0.065, 0.075, 0.26, 0, 0.005, 0.35, GUN],
    [0.04, 0.04, 0.14, 0, 0.01, 0.49, GUN],
    [0.045, 0.055, 0.16, 0, 0.09, 0.06, GUN],
    [0.03, 0.05, 0.03, 0, 0.07, 0.44, GUN],
  ]);
  const muzzle = new TransformNode("bot-muzzle", scene);
  muzzle.parent = gun;
  muzzle.position.set(0, 0.01, 0.56);

  // --- the launcher, slung across the back. Off on every rig until a bot says
  // otherwise, and one bot in each squad does ---
  //
  // **It is worn rather than held**, and that is the honest shape as well as
  // the cheap one: an AT gunner carries a rifle and a tube, and the tube is
  // over their shoulder until there is armour to point it at. What it buys is
  // the thing a player actually needs, which is being able to tell WHICH body
  // in a squad is the one that can hurt the tank they are sitting in — from
  // the side, at range, in one silhouette. It is a `TransformNode` of its own
  // so that enabling it is one write and costs nothing on the fifteen rigs
  // that do not have one.
  const launcher = new TransformNode("bot-launcher", scene);
  launcher.parent = torso;
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
  launcher.setEnabled(false);

  // --- legs ---
  /**
   * Thigh, shin and boot, hung off a hip, a knee and an ankle.
   *
   * The three SEGMENTS are the three the leg has always been and they are drawn
   * in the same places: the knee is the bottom of the thigh box and the ankle
   * the bottom of the shin box, so every offset here is the old hip-frame one
   * minus the joint it now hangs from, and a rig at rest is unchanged to the
   * micrometre. Each carries a second box — the plate above the knee, the
   * kneepad, the toe of the boot — in the colour that segment was already
   * drawn in, so `mergeByColor` still returns three meshes for a leg and the
   * detail is silhouette that costs nothing.
   */
  const leg = (
    name: string,
    hip: TransformNode,
  ): [TransformNode, TransformNode] => {
    segment(name, hip, [
      [0.17, 0.34, 0.18, 0, -0.17, 0, kit.armor],
      [0.175, 0.08, 0.19, 0, -0.31, 0.005, kit.armor],
    ]);
    const knee = new TransformNode(`${name}-knee`, scene);
    knee.parent = hip;
    knee.position.y = -THIGH;
    segment(name, knee, [
      [0.15, 0.32, 0.15, 0, -0.16, 0, kit.suit],
      [0.16, 0.11, 0.17, 0, -0.055, 0.015, kit.suit],
    ]);
    const ankle = new TransformNode(`${name}-ankle`, scene);
    ankle.parent = knee;
    ankle.position.y = -SHIN;
    segment(name, ankle, [
      [0.17, 0.09, 0.22, 0, -0.025, 0.02, kit.webbing],
      [0.15, 0.055, 0.07, 0, -0.045, 0.125, kit.webbing],
    ]);
    return [knee, ankle];
  };

  const hipL = new TransformNode("bot-hipL", scene);
  hipL.parent = body;
  hipL.position.set(-0.12, -0.02, 0);
  const [kneeL, ankleL] = leg("bot-legL", hipL);

  const hipR = new TransformNode("bot-hipR", scene);
  hipR.parent = body;
  hipR.position.set(0.12, -0.02, 0);
  const [kneeR, ankleR] = leg("bot-legR", hipR);

  for (const m of meshes) {
    if (!m.metadata?.noOutline) addOutline(m, 0.012);
  }

  const rig: SoldierRig = {
    root,
    body,
    torso,
    head,
    shoulderL,
    shoulderR,
    hipL,
    hipR,
    kneeL,
    kneeR,
    ankleL,
    ankleR,
    gun,
    muzzle,
    launcher,
    meshes,
    centerHeight,
    rest: [],
  };
  // Taken here, at the end of the build, so it records the hierarchy as
  // authored above rather than whatever a previous life left behind.
  rig.rest = POSED_JOINTS.map((key: PosedJoint) => {
    const node = rig[key];
    return {
      node,
      parent: node.parent as TransformNode,
      position: node.position.clone(),
    };
  });
  return rig;
}

/**
 * Puts every joint back to the transform `buildSoldier` gave it.
 *
 * This is the ONLY correct reset after anything that re-parented or
 * quaternion-posed the rig, and `animateSoldier(rig, 0, 0, 0, 0)` is not a
 * substitute for it. That call writes fourteen Euler channels — `body.x`,
 * `body.position.y`, both hips' `x`, both knees' `x`, both ankles' `x`, both
 * shoulders' `x` and `z`, `torso.x`, `torso.y`, `head.x`, `head.y` — and the rig
 * has far more than fourteen. It never touches a `parent`, a
 * `rotationQuaternion`, a `scaling`, any `position.x/z`, or anything at all on
 * `gun`. A ragdoll leaves residue in every one of those.
 *
 * The quaternion is the load-bearing line. While one is set Babylon ignores
 * `rotation` entirely — the trap `ViewModel`'s inspect turntable documents from
 * the other side — so a quaternion left behind by a corpse freezes the
 * respawned bot in its death pose for the rest of the round, with its position
 * still updating correctly underneath.
 */
/**
 * Metres of ground covered per radian... more precisely, the divisor that turns
 * distance travelled into walk-cycle phase: `phase += distance / STRIDE`.
 *
 * It lives here, with the rig the phase poses, because two things advance it
 * and they must agree. `Bot` integrates it from its own speed; `NetSoldier`
 * integrates it from the distance an interpolated body actually moved. If the
 * two used different strides, a bot and a remote human walking side by side at
 * the same speed would swing their legs at different rates — which is precisely
 * the tell that would give away which bodies are AI, in a game whose whole
 * roster design rests on that being invisible.
 *
 * Advancing by DISTANCE rather than by time is what makes a footfall a point on
 * the cycle instead of a timer: something slowed to a walk steps more slowly for
 * free, and something stopped stops stepping.
 */
export const STRIDE = 0.9;

export function resetSoldierPose(rig: SoldierRig): void {
  for (const { node, parent, position } of rig.rest) {
    // A direct assignment, never setParent: setParent preserves the WORLD
    // transform, which is the opposite of what a reset wants.
    node.parent = parent;
    node.rotationQuaternion = null;
    node.rotation.setAll(0);
    node.position.copyFrom(position);
    node.scaling.setAll(1);
  }
  animateSoldier(rig, 0, 0, 0, 0);
}

/**
 * Poses the rig. Purely procedural, like every other animation in the game —
 * there are no clips, and a new behaviour means new numbers rather than new art.
 *
 * @param phase  walk cycle phase, advanced by distance travelled
 * @param moving 0..1 blend between the idle and walk poses
 * @param aim    aim pitch in radians, applied at the spine
 * @param twist  upper-body yaw relative to the feet, radians
 * @param dead   collapse blend, 0 alive .. 1 fully down
 * @param crouch 0..1 stance blend, 0 standing .. 1 fully crouched
 *
 * `crouch` defaults to zero, so a caller with no stance to pass gets a body
 * standing. Three things pass one, and they are the same stance with the same
 * geometry: a bot behind cover (`Bot.crouchBlend`), a remote body arriving from
 * the authority (`EntityState.crouch`), and the stand-in the death cam poses.
 * The local player has no body to pose — the camera is inside the head.
 *
 * `twist` is the only parameter that is not a pitch or a blend, and it is worth
 * saying why it exists. The rig's `root` carries one yaw, so before it a bot
 * pointed its whole body — feet included — at whatever it was looking at. A bot
 * strafing across a doorway while tracking you walked visibly sideways, legs
 * swinging along an axis it was not travelling on. Splitting the two lets the
 * feet follow the direction of travel and the torso (with the head, arms and
 * rifle hanging off it) turn to the target, which is most of what "soldier"
 * looks like. It costs one extra `rotation.y` write and no geometry at all —
 * `torso` was always a child of `body`, with the legs as its siblings.
 */
export function animateSoldier(
  rig: SoldierRig,
  phase: number,
  moving: number,
  aim: number,
  twist: number,
  crouch = 0,
): void {
  // This posed a DEATH too, on a `dead` progress argument every caller now
  // passes nothing for. It pitched the body forward about one joint and sank
  // it, unfolding a crouch on the way down — the collapse tween that stood in
  // wherever the ragdoll pool refused a body. Havok is required and the pool
  // refuses nothing the player can see, so the only bodies that reach a death
  // without a solver are ones already past the fog wall, and they are not
  // drawn. See `Bot.update`'s dead branch, which is what is left of it.
  rig.body.rotation.x = 0;

  const lean = CROUCH_LEAN * crouch;
  const drop = crouchDrop(crouch);

  // A deep squat cannot swing its legs through a stride, so the walk is damped
  // toward a shuffle as the body folds — which is also what the stance costs in
  // speed (`player.crouchMoveMult`), arrived at from the animation side.
  const swing = Math.sin(phase) * 0.7 * moving * (1 - 0.65 * crouch);
  poseLegs(rig, drop, swing);
  // Counter-swing on the left arm; the right holds the weapon steady.
  rig.shoulderL.rotation.x = -swing * 0.5 - 0.15;
  rig.shoulderR.rotation.x = 0.1;
  rig.shoulderR.rotation.z = -0.25;
  rig.shoulderL.rotation.z = 0.2;
  // Lean into the run, and pitch the spine to wherever the bot is aiming.
  rig.torso.rotation.x = aim * 0.5 + moving * 0.1 + lean;
  // Twist the upper body off the feet. The head takes a share of it on top, so
  // the helmet leads the shoulders rather than being welded square to them.
  rig.torso.rotation.y = twist;
  rig.head.rotation.y = twist * 0.35;
  // Most of the crouch's lean is taken back at the neck, so a hunkered body
  // still looks where it is aiming and its visor — the friend/foe read at
  // range — still faces the way it is shooting.
  rig.head.rotation.x = aim * 0.5 - lean * 0.6;
  rig.body.position.y = Math.abs(Math.sin(phase)) * 0.04 * moving - drop;
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
 * Folds both legs to carry the hips `drop` metres below where they stand, and
 * adds the walk's swing on top.
 *
 * Two-link inverse kinematics rather than authored angles, because the pose has
 * to hold at every point of the stance blend and not only at its ends: the
 * boots are planted, so the knee and the ankle are whatever the hip height says
 * they are, and a crouch caught halfway is as correct as one at rest. Angles
 * lerped between a standing and a squatting key instead would slide the feet
 * through the floor and back over the quarter-second the blend takes.
 *
 * The solve is the standard one for a two-link chain reaching straight down:
 * `psi` is the thigh's angle off vertical from the law of cosines, and the shin
 * takes whatever angle puts the ankle back under the hip. The ankle then
 * cancels the shin so the boot stays flat. At `drop === 0` every term is zero
 * by construction — the chain is straight — so a standing rig is posed exactly
 * as it was before any of this existed.
 */
function poseLegs(rig: SoldierRig, drop: number, swing: number): void {
  let thigh = 0;
  let knee = 0;
  let shin = 0;
  if (drop > 0) {
    // Hip height above the ankle. Clamped off the fully-folded end, where the
    // triangle degenerates and `acos` starts returning NaN rather than an
    // angle; at the crouch this game asks for it is 0.18 m against a floor of
    // 0.03, so the clamp is a guard and never a limit.
    const span = Math.max(LEG_SPAN - drop, Math.abs(THIGH - SHIN) + 0.01);
    const psi = Math.acos(
      clamp((THIGH * THIGH + span * span - SHIN * SHIN) / (2 * THIGH * span)),
    );
    shin = Math.asin(clamp((THIGH * Math.sin(psi)) / SHIN));
    thigh = -psi;
    knee = shin + psi;
  }
  rig.hipL.rotation.x = thigh + swing;
  rig.hipR.rotation.x = thigh - swing;
  rig.kneeL.rotation.x = knee;
  rig.kneeR.rotation.x = knee;
  rig.ankleL.rotation.x = -shin;
  rig.ankleR.rotation.x = -shin;
}

/** Keeps a cosine or a sine inside its domain against floating-point drift. */
function clamp(x: number): number {
  return x < -1 ? -1 : x > 1 ? 1 : x;
}

/** Merges a limb's boxes into one mesh per colour, at identity. */
function mergeByColor(parts: Mesh[], name: string): Mesh[] {
  const groups = new Map<unknown, Mesh[]>();
  for (const m of parts) {
    const key = m.material;
    const g = groups.get(key);
    if (g) g.push(m);
    else groups.set(key, [m]);
  }
  const out: Mesh[] = [];
  for (const group of groups.values()) {
    const mat = group[0].material;
    const merged =
      group.length === 1
        ? group[0]
        : Mesh.MergeMeshes(group, true, true, undefined, false, false);
    if (!merged) continue;
    merged.name = name;
    merged.material = mat;
    out.push(merged as Mesh);
  }
  return out;
}
