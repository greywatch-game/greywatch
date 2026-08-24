/**
 * DmrModel.ts — Builds the low-poly semi-automatic marksman rifle from
 * primitives, and hangs the same three optics off its rail.
 * Returns WeaponParts, exactly as RifleModel and SmgModel do: all three are
 * interchangeable to everything above them, which is what lets `ViewModel`
 * carry any of them.
 * Invariants: assembled at the origin with the root at identity and merged
 * before it is moved — `weaponKit.ts` owns that contract and the primitives.
 * The optics are `optics.ts`'s, built against `MOUNT` rather than re-tuned.
 */
import { Scene, TransformNode, Vector3 } from "@babylonjs/core";
import type { CelMaterialFactory } from "../shaders/CelShader";
import { buildOptics, ironSightFloor, type OpticMount } from "./optics";
import {
  BODY,
  METAL,
  magDropAxis,
  POLYMER,
  RUBBER,
  WeaponBuild,
  type WeaponParts,
} from "./weaponKit";

/**
 * The magazine's rake, which is also the line it drops out along. NEGATIVE for
 * the reason the rifle's is: a box magazine leans toward the MUZZLE, and a
 * pivot's positive `rotX` sends everything below it backwards (see
 * `magDropAxis`). Shallower than the rifle's, because this one is a straight
 * box — the lean is all the curve it gets, and past a few degrees a straight
 * stick raked hard reads as a magazine that has been knocked out of true.
 */
const MAG_RAKE = -0.06;

/**
 * Top face of the receiver's rail. Higher than the rifle's: this receiver is
 * cut for a longer cartridge, and the extra depth is most of what makes the
 * weapon read as the heavier one before the barrel is even in frame.
 */
const RAIL_TOP = 0.09;

/**
 * Where the DMR offers its rail.
 *
 * The front iron station is the one number here that is not a styling choice.
 * A marksman rifle wants the longest sight radius the receiver will give, and
 * what stops it is `optics.ts`: with a holo fitted the FOLDED front leaf still
 * stands on the rail, and the holo's view cone spreads until it runs onto it.
 * At this rail height the cone reaches the leaf's top at z = 0.53, which is
 * therefore where the station goes — a longer receiver buys a longer sight
 * radius at the rear (-0.22 against the rifle's -0.185) and nothing at all at
 * the front. The rail itself stops at 0.57 for the same reason one step up:
 * past that its ribs are inside the SCOPE's cone.
 */
const MOUNT: OpticMount = {
  railTop: RAIL_TOP,
  mountZ: 0.02,
  ironRearZ: -0.22,
  ironFrontZ: 0.53,
};

/**
 * The stock's heights, and only the first of them is a choice.
 *
 * The eye behind this weapon sits BEHIND its own butt — an aperture's eye
 * relief is over half a receiver's length — so the comb, the butt plate and
 * everything else back here stands between the eye and the rear sight, in the
 * one part of the sight picture the shooter cannot look around. A comb over
 * the line simply fills the aperture, and a marksman rifle wearing a scope's
 * cheek riser does exactly that: this comb topped out ABOVE the sight axis
 * rather than under it, and the irons showed a wall of polymer and nothing
 * else.
 *
 * So the comb's top is not authored, it is `ironSightFloor` at the comb's own
 * front edge — the lowest point of the aperture's cone where the comb is
 * nearest to it — less a few millimetres of daylight. That is the honest
 * reading of the part as well as the workable one: a comb is adjustable
 * because irons and glass want the cheek at different heights, and this is it
 * at the bottom of its travel, which is the setting the back-up irons are for.
 * The posts, the gap under them and the locking knob all survive, so the
 * silhouette cue survives with it.
 *
 * Everything else follows from that one number, in this order: the comb's
 * underside sets where the stock's spine can run, and the butt is dropped to
 * just under the comb, because a butt standing proud of the cheek piece is a
 * stock nobody could get behind. Raise the rail or re-rise the irons and the
 * whole assembly comes with them.
 */
const COMB_FRONT_Z = -0.345;
const COMB_TOP = ironSightFloor(MOUNT, COMB_FRONT_Z) - 0.006;
const COMB_PAD_H = 0.012;
const COMB_H = 0.032;
const COMB_BOTTOM = COMB_TOP - COMB_PAD_H - COMB_H;
/** Top of the stock's spine: the comb's underside, less the gap it rides on. */
const SPINE_TOP = COMB_BOTTOM - 0.02;
/** Centre line of the butt assembly — plate, pad, grooves, toe and sling. */
const BUTT_H = 0.2;
const BUTT_Y = COMB_TOP - 0.014 - BUTT_H / 2;

/**
 * Where each hand grips, in weapon-local units. The support hand sits further
 * out than the rifle's and further BACK than the handguard's front, because
 * the bipod is stowed under that end — a fist closed around the folded legs
 * reads as a hand pushed through the weapon.
 */
const GRIP_HAND = new Vector3(0.02, -0.16, -0.145);
const GRIP_ELBOW = new Vector3(0.26, -0.56, -0.52);
const SUPPORT_HAND = new Vector3(-0.02, -0.08, 0.38);
const SUPPORT_ELBOW = new Vector3(-0.3, -0.5, 0.1);

/**
 * Builds a low-poly cel-styled semi-automatic marksman rifle. Local +z is the
 * barrel axis, origin at the receiver centre — the same frame the other two
 * weapons are built in, so the viewmodel poses any of them with the same
 * numbers.
 *
 * The silhouette is the argument for the weapon, and it is made of four things
 * the other two do not have: a long stepped heavy barrel ending in a chambered
 * brake rather than a birdcage, a bipod folded back along the underside of the
 * handguard, a fixed stock carrying an adjustable comb on posts, and a
 * straight twenty-round magazine deep enough to say the cartridge is bigger.
 * Everything else — receiver, rail, grip, trigger group — is the rifle's
 * vocabulary at a larger size, which is what makes those four read as
 * deliberate instead of as a different gun entirely.
 *
 * ~120 parts, merged to one mesh per colour. The merge is what makes the
 * detail free and what keeps the outline pass drawing one border per colour
 * group instead of a black shell around every rib.
 */
export function buildDmr(
  scene: Scene,
  mats: CelMaterialFactory,
  prefix: string,
): WeaponParts {
  const root = new TransformNode(`${prefix}_dmr`, scene);
  const b = new WeaponBuild(scene, mats, prefix, root);

  // --- upper receiver: one long run under a continuous ribbed rail ---
  // Same two-slab construction as the rifle (the narrow top deck is the
  // chamfer additive geometry cannot cut), one size up in every direction.
  b.box("upper", BODY, 0.086, 0.062, 0.82, 0, 0.028, 0.15);
  b.box("upperDeck", BODY, 0.072, 0.014, 0.82, 0, 0.066, 0.15);
  b.box("rail", BODY, 0.06, 0.014, 0.86, 0, 0.083, 0.14);
  for (let i = 0; i < 11; i++) {
    b.box("railRib", METAL, 0.064, 0.012, 0.014, 0, 0.088, -0.25 + i * 0.07);
  }
  b.pin("pinFront", METAL, 0.016, 0.092, 0, 0.014, 0.13);
  b.pin("pinRear", METAL, 0.016, 0.092, 0, 0.014, -0.2);
  // A long-cartridge port: taller than the rifle's, and further forward.
  b.box("ejectPort", METAL, 0.01, 0.036, 0.125, 0.046, 0.042, 0.08);
  b.box("portCover", METAL, 0.008, 0.028, 0.118, 0.048, 0.014, 0.078);
  b.box("deflector", BODY, 0.018, 0.032, 0.055, 0.047, 0.056, -0.02);

  // Charging handle, left side, on its own slot — non-reciprocating here, so
  // it sits well forward and stays put while the action runs under the optic.
  b.box("chSlot", POLYMER, 0.008, 0.016, 0.2, -0.045, 0.05, 0.2);
  b.box("chArm", METAL, 0.056, 0.016, 0.034, -0.074, 0.05, 0.27);
  b.box("chKnob", METAL, 0.022, 0.028, 0.05, -0.098, 0.05, 0.275);
  b.box("chLatch", METAL, 0.014, 0.014, 0.016, -0.098, 0.067, 0.262);
  b.box("slingQd", METAL, 0.024, 0.03, 0.016, 0.046, 0.0, -0.24);

  // --- lower receiver: trigger group, magwell, near-vertical grip ---
  b.box("lower", POLYMER, 0.078, 0.1, 0.44, 0, -0.05, -0.06);
  b.box("magwell", POLYMER, 0.086, 0.09, 0.15, 0, -0.086, 0.05);
  b.box("magFlareF", POLYMER, 0.092, 0.022, 0.014, 0, -0.124, 0.118);
  b.box("magFlareR", POLYMER, 0.092, 0.022, 0.014, 0, -0.124, -0.018);
  for (const side of [-1, 1] as const) {
    b.box("magFlareS", POLYMER, 0.008, 0.022, 0.15, side * 0.044, -0.124, 0.05);
  }
  b.box("magRelease", METAL, 0.012, 0.03, 0.03, 0.046, -0.058, -0.03);
  b.box("boltRelease", METAL, 0.012, 0.022, 0.05, -0.046, -0.052, -0.06);
  b.pin("safetyPin", METAL, 0.013, 0.092, 0, -0.032, -0.13);
  for (const side of [-1, 1] as const) {
    b.box("safetyLever", METAL, 0.012, 0.04, 0.014, side * 0.05, -0.05, -0.13);
  }
  b.box("guardFront", POLYMER, 0.05, 0.058, 0.018, 0, -0.13, -0.085);
  b.box("guardBottom", POLYMER, 0.05, 0.016, 0.1, 0, -0.157, -0.135);
  // A single-stage trigger with a wide flat shoe: the one control on the
  // weapon a shooter thinks about between rounds, so it gets its own face.
  const trigPivot = b.pivot("trigPivot", 0, -0.11, -0.106, 0.3);
  b.box("trigger", METAL, 0.016, 0.034, 0.014, 0, -0.017, 0, trigPivot);
  b.box("triggerShoe", METAL, 0.018, 0.02, 0.02, 0, -0.042, 0.004, trigPivot);

  // The grip stands closer to vertical than the rifle's. A precision grip puts
  // the wrist under the trigger rather than behind it, which is the difference
  // between squeezing a shot and holding a burst on target.
  const gripPivot = b.pivot("gripPivot", 0, -0.105, -0.165, -0.18);
  b.box("grip", POLYMER, 0.056, 0.15, 0.082, 0, -0.075, 0, gripPivot);
  b.box("gripSwell", POLYMER, 0.062, 0.05, 0.074, 0, -0.05, -0.008, gripPivot);
  b.box("gripShelf", POLYMER, 0.06, 0.016, 0.05, 0, 0.006, -0.03, gripPivot);
  for (let i = 0; i < 3; i++) {
    b.box("gripRib", BODY, 0.05, 0.011, 0.014, 0, -0.05 - i * 0.032, 0.038, gripPivot);
  }
  b.box("gripCap", RUBBER, 0.058, 0.018, 0.086, 0, -0.155, 0, gripPivot);

  // --- handguard: a long free-float tube, slotted, running past the receiver
  // to carry the bipod at its far end ---
  b.box("handguard", POLYMER, 0.088, 0.062, 0.42, 0, -0.015, 0.42);
  b.box("hgTop", POLYMER, 0.07, 0.014, 0.42, 0, 0.019, 0.42);
  b.box("hgBottom", POLYMER, 0.07, 0.014, 0.42, 0, -0.049, 0.42);
  b.box("hgCap", BODY, 0.084, 0.07, 0.014, 0, -0.015, 0.623);
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < 4; i++) {
      b.box("vent", BODY, 0.006, 0.03, 0.05, side * 0.045, -0.015, 0.27 + i * 0.08);
    }
    b.box("sideRail", METAL, 0.014, 0.026, 0.24, side * 0.047, -0.04, 0.42);
  }
  for (let i = 0; i < 4; i++) {
    b.box("mlok", BODY, 0.03, 0.006, 0.05, 0, -0.054, 0.27 + i * 0.08);
  }
  b.box("bottomRail", METAL, 0.05, 0.016, 0.26, 0, -0.06, 0.42);
  // Hand stop rather than a vertical foregrip: the support hand's job on this
  // weapon is to hold a position, not to steer between two of them.
  b.box("handStop", POLYMER, 0.044, 0.028, 0.028, 0, -0.078, 0.315);

  // --- bipod, folded back along the underside ---
  // Deployed legs would be geometry the player can never use — nothing here
  // rests a weapon on anything — so it is stowed, which is also the only state
  // it would be in while the weapon is being carried.
  b.box("bipodMount", BODY, 0.036, 0.03, 0.05, 0, -0.058, 0.6);
  b.pin("bipodPin", METAL, 0.012, 0.044, 0, -0.062, 0.6);
  const bipodPivot = b.pivot("bipodPivot", 0, -0.07, 0.6, -0.12);
  for (const side of [-1, 1] as const) {
    b.box("bipodLeg", METAL, 0.014, 0.014, 0.14, side * 0.024, 0, -0.07, bipodPivot);
    b.box("bipodFoot", RUBBER, 0.018, 0.016, 0.026, side * 0.024, -0.002, -0.145, bipodPivot);
  }
  b.box("bipodCatch", METAL, 0.05, 0.012, 0.016, 0, -0.076, 0.47);

  // --- barrel: heavy, stepped, and long ---
  b.box("gasBlock", BODY, 0.05, 0.05, 0.06, 0, 0, 0.665);
  b.box("gasPort", METAL, 0.022, 0.014, 0.026, 0, 0.03, 0.665);
  b.tube("gasTube", METAL, 0.012, 0.012, 0.05, 0, 0.022, 0.645);
  b.tube("barrel", BODY, 0.046, 0.046, 0.2, 0, 0, 0.72);
  b.tube("barrelNut", METAL, 0.054, 0.054, 0.016, 0, 0, 0.638);
  // Steps, not flutes. A flute is a groove and this vocabulary is additive —
  // the same reason the rifle's receiver chamfer is a narrower slab on top —
  // so the heavy profile is said with proud bands instead of cut ones.
  for (let i = 0; i < 2; i++) {
    b.tube("barrelStep", METAL, 0.052, 0.052, 0.012, 0, 0, 0.7 + i * 0.06);
  }

  // --- muzzle brake: three chambers, ported sideways and up ---
  // Built as rings threaded on a dark core rather than as a block: the ports
  // ARE the gaps between the rings, so the bore stays open all the way through
  // and the device reads as chambered instead of as a can. The bottom is
  // webbed shut for the same reason the rifle's birdcage is — a brake that
  // vents downward lifts the muzzle it is fitted to fight.
  b.tube("mzCollar", BODY, 0.056, 0.05, 0.018, 0, 0, 0.828);
  b.tube("mzCore", RUBBER, 0.028, 0.028, 0.1, 0, 0, 0.885);
  for (let i = 0; i < 3; i++) {
    b.shell("mzBaffle", BODY, 0.03, 0.014, 0.012, 0, 0.845 + i * 0.04, 10);
  }
  b.box("mzStrap", BODY, 0.05, 0.012, 0.095, 0, 0.029, 0.885);
  b.box("mzWeb", BODY, 0.04, 0.012, 0.095, 0, -0.029, 0.885);
  b.shell("crown", METAL, 0.03, 0.011, 0.012, 0, 0.944, 10);

  // --- fixed stock: adjustable comb on posts, adjustable pad on rails ---
  // Fixed rather than folding, and that is the point of it: the two things a
  // marksman rifle adjusts are where the cheek sits and how far back the pad
  // is, and both are visible from inside the weapon's own silhouette. Every
  // height here is derived — see COMB_TOP, which is the sight picture's floor
  // rather than a number anybody liked the look of.
  b.box("stockBlock", BODY, 0.08, 0.105, 0.07, 0, 0.012, -0.31);
  b.box("stockTop", POLYMER, 0.06, 0.04, 0.24, 0, SPINE_TOP - 0.02, -0.42);
  b.box("stockBottom", POLYMER, 0.058, 0.04, 0.22, 0, BUTT_Y - 0.065, -0.41);
  // The posts stand in the daylight between the spine and the comb, which is
  // the whole read: a cheek piece carried ON something, not moulded into the
  // stock. Long enough at each end to be housed rather than balanced.
  for (const dz of [-0.385, -0.49] as const) {
    b.pin(
      "combPost",
      METAL,
      0.012,
      COMB_BOTTOM - SPINE_TOP + 0.028,
      0,
      (SPINE_TOP + COMB_BOTTOM) / 2,
      dz,
      "y",
    );
  }
  b.box("comb", POLYMER, 0.056, COMB_H, 0.175, 0, COMB_TOP - COMB_PAD_H - COMB_H / 2, -0.4325);
  b.box("combPad", RUBBER, 0.058, COMB_PAD_H, 0.175, 0, COMB_TOP - COMB_PAD_H / 2, -0.4325);
  b.box("combKnob", METAL, 0.014, 0.016, 0.016, 0.03, COMB_BOTTOM + 0.014, -0.385);
  for (const side of [-1, 1] as const) {
    b.tube("padRail", METAL, 0.014, 0.014, 0.1, side * 0.026, BUTT_Y - 0.025, -0.48);
  }
  b.box("buttPlate", POLYMER, 0.072, BUTT_H, 0.04, 0, BUTT_Y, -0.53);
  b.box("buttPad", RUBBER, 0.074, 0.185, 0.022, 0, BUTT_Y, -0.558);
  for (let i = 0; i < 2; i++) {
    b.box("padGroove", BODY, 0.076, 0.008, 0.02, 0, BUTT_Y - 0.05 - i * 0.03, -0.56);
  }
  // Toe hook under the butt — where the off hand goes on a supported shot, and
  // the last silhouette cue that this weapon expects to be shot from prone.
  b.box("toeHook", METAL, 0.02, 0.052, 0.032, 0, BUTT_Y - 0.101, -0.5);
  b.box("slingRear", METAL, 0.026, 0.03, 0.014, -0.042, BUTT_Y - 0.037, -0.45);

  // Merged before any optic is built, so a sight's parts can never end up
  // inside the weapon's colour groups.
  const meshes = b.merge("dmr", root);

  // --- magazine: a deep straight twenty-round box ---
  // Straight rather than curved, and it is the read: the rifle's banana under
  // the same receiver would say "same cartridge, longer barrel". Merged into a
  // node of its own so the reload can drop it (see `WeaponParts.magazine`).
  const magazine = new TransformNode(`${prefix}_magazine`, scene);
  magazine.parent = root;
  const magPivot = b.pivot("magPivot", 0, -0.125, 0.05, MAG_RAKE);
  b.box("mag", POLYMER, 0.06, 0.215, 0.108, 0, -0.108, 0, magPivot);
  for (let i = 0; i < 4; i++) {
    b.box("magRib", BODY, 0.063, 0.008, 0.11, 0, -0.05 - i * 0.05, 0, magPivot);
  }
  b.box("magFloor", METAL, 0.064, 0.02, 0.112, 0, -0.225, 0, magPivot);
  b.box("magBase", RUBBER, 0.06, 0.014, 0.104, 0, -0.242, 0, magPivot);
  meshes.push(...b.merge("dmrMag", magazine));

  // Every colour group the WEAPON itself merged, taken before the optics are
  // built so a finish can never reach one — see `WeaponBuild.takeFinish`.
  const finish = b.takeFinish();

  const optics = buildOptics(b, MOUNT, prefix);
  meshes.push(...optics.meshes);
  b.disposePivots();

  return {
    root,
    muzzle: new Vector3(0, 0, 0.96),
    // Matches the `ejectPort` box above — the right side of the receiver.
    ejectPort: new Vector3(0.05, 0.044, 0.08),
    grip: { hand: GRIP_HAND, elbow: GRIP_ELBOW },
    support: { hand: SUPPORT_HAND, elbow: SUPPORT_ELBOW },
    magazine,
    magDrop: magDropAxis(MAG_RAKE),
    finish,
    sights: { kind: "fitted", assemblies: optics.sights },
    meshes,
  };
}
