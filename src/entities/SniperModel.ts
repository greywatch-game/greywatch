/**
 * SniperModel.ts — Builds the low-poly bolt-action sniper rifle from
 * primitives, hangs the same optics off its rail, and hands back the one part
 * of a weapon in this kit that is worked by hand.
 * Returns WeaponParts exactly as RifleModel and DmrModel do: every builder is
 * interchangeable to everything above it, which is what lets `ViewModel` carry
 * any of them.
 * Invariants: assembled at the origin with the root at identity and merged
 * before it is moved — `weaponKit.ts` owns that contract and the primitives.
 * The optics are `optics.ts`'s, built against `MOUNT` rather than re-tuned.
 * Invariant: the BOLT is built about the bore and merged into a node of its
 * own — see `WeaponParts.bolt`, and `CONFIG.viewmodel.cycle` for what moves it.
 * Invariant: a colour group is a ROLE, not a material, and this is the weapon
 * that had to learn it. A chassis rifle is machined where the rest of the kit
 * is moulded, so its lower, its free-float handguard, its skeleton stock and
 * its magazine were all built in METAL — honest about the alloy and wrong
 * about the paint, because METAL is the ACCENT group and `POLYMER`'s own
 * comment in `weaponKit.ts` names those four parts by role. It put **49.9% of
 * the weapon's painted area in the accent group against a kit running
 * 11.5-16.3%**, and left the furniture group at **5.2% against 27.2-46.8%**.
 * **The gloss is the half that made it read as a different gun**: six of the
 * sixteen schemes put `rifleChrome` — the MIRROR rung — on METAL, so under
 * Voltage and Frostbite half this rifle was not merely the lightest colour in
 * the scheme but the only mirrored surface at that size in the kit, and
 * photographed on the turntable it clipped to white while the DMR beside it
 * stayed teal. They are POLYMER now, part for part as the DMR's
 * `lower`/`handguard`/`stockTop`/`stockBottom`/`buttPlate`/`mag` are. What is
 * machined about this rifle is said in its SHAPE — the skeleton stock, the
 * chassis flank, the bare tube — and a finish is not the place to say it
 * twice.
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
 * The magazine's rake — NEGATIVE for the reason every other box magazine here
 * is (see `magDropAxis`), and the shallowest in the kit at that. This is a
 * single-stack of a long cartridge sitting in a chassis: it is a straight
 * stick, and the couple of degrees is all the lean a fixed-taper column gets
 * before it reads as damaged rather than as raked.
 */
const MAG_RAKE = -0.04;

/**
 * Top face of the receiver's rail.
 *
 * Lower than the DMR's 0.09 even though this is the bigger weapon, and the
 * reason is the BOLT rather than a style. A bolt-action's raceway is in line
 * with the bore, so the action here is a body wrapped around y = 0 rather than
 * a receiver sitting on top of a barrel — half of its depth is under the bore
 * where the DMR has nothing at all. The rail is therefore the top of a section
 * centred on the axis, and the weapon carries more mass for less height.
 */
const RAIL_TOP = 0.086;

/**
 * Where the rifle offers its rail.
 *
 * `ironFrontZ` is the DMR's number for the DMR's reason, one weapon along: it
 * is where the holo's view cone reaches the folded front leaf's top, and past
 * that a longer rail buys sight radius the optics cannot use. The rail's far
 * end is 0.57 so `RAIL_REACH` in `optics.ts` — 0.55 past `mountZ` — is still
 * the honest bound every optic's rise is solved against. **A longer weapon does
 * not get a longer rail**; it gets a longer barrel in front of one.
 *
 * `ironRearZ` is the furthest back of any weapon here, which is the one thing
 * the long action does buy: the rear station sits behind the ejection port and
 * behind the bolt's own travel, where nothing is in its way.
 */
const MOUNT: OpticMount = {
  railTop: RAIL_TOP,
  mountZ: 0.02,
  ironRearZ: -0.245,
  ironFrontZ: 0.53,
};

/**
 * The comb, derived exactly as the DMR's is and for exactly the same failure:
 * the eye behind an aperture sits BEHIND the butt, so anything back here that
 * stands over the sight line simply fills the aperture, and a precision rifle's
 * cheek riser is the tallest candidate in the game for doing it.
 *
 * `ironSightFloor` at the comb's own front edge is the lowest point of the
 * cone where the comb is nearest to it; a few millimetres of daylight under
 * that is the comb at the bottom of its travel, which is the setting a shooter
 * would have it at with the back-up irons in use. Everything behind it follows:
 * the spine runs under the comb, and the butt plate is dropped to just under
 * the cheek piece, because a butt standing proud of the comb is a stock nobody
 * can get behind.
 */
const COMB_FRONT_Z = -0.365;
const COMB_TOP = ironSightFloor(MOUNT, COMB_FRONT_Z) - 0.006;
const COMB_PAD_H = 0.013;
const COMB_H = 0.036;
const COMB_BOTTOM = COMB_TOP - COMB_PAD_H - COMB_H;
/** Top of the chassis spine: the comb's underside, less the gap it rides on. */
const SPINE_TOP = COMB_BOTTOM - 0.024;
/** Centre line of the butt assembly — plate, pad, spacers, toe and sling. */
const BUTT_H = 0.21;
const BUTT_Y = COMB_TOP - 0.016 - BUTT_H / 2;

/**
 * The bolt, in the frame it is built and animated in.
 *
 * `BOLT_Z` is the handle's station along the barrel axis, and it is the one
 * number here that is boxed in from three sides: forward of it is the ejection
 * port, below it is the trigger housing, and behind it is the tang the thumb
 * goes over. It sits in the gap all three leave.
 *
 * `BOLT_REST` is the angle the handle hangs at, measured the way `shell` and
 * every other radial part in this kit measures one — from +y, turning toward
 * +x — so `(sin, cos)` is the direction and `rotZ = -angle` turns a part onto
 * it. At 1.92 rad the handle points out to the right and 20 deg down.
 *
 * **A real bolt handle hangs at nearer forty-five and this one was drawn there
 * first; it had to come up because it was INVISIBLE.** At 40 deg down the knob
 * sits between the action's underside and the chassis's flank, which from every
 * angle the weapon is actually seen at is inside one silhouette or the other —
 * so the one part of this rifle whose whole job is to be watched moving was a
 * tab that appeared and disappeared. Photographed on the kit stage, closed
 * against open was a two-pixel difference. At 20 deg it stands clear of both
 * outlines at rest and `cycle.liftTurn` swings it to 49 deg ABOVE horizontal,
 * beside the scope's rings and outboard of them, which is where a rifle rolled
 * right-flank-up for the cycle actually presents it to the eye.
 *
 * The lift is `CONFIG.viewmodel.cycle.liftTurn` and is deliberately not here:
 * this file owns where the part is and the viewmodel owns what is done to it,
 * which is the same split `magDrop` and `reload.dropDist` already make. The two
 * are a PAIR even so — this angle is chosen knowing what that one adds to it.
 */
const BOLT_Z = -0.075;
const BOLT_REST = 1.92;
const BOLT_DIR = { x: Math.sin(BOLT_REST), y: Math.cos(BOLT_REST) };

/**
 * Where each hand grips, in weapon-local units.
 *
 * The trigger hand is further BACK and lower than the DMR's: this is a
 * near-vertical chassis grip behind a trigger set well back in a long action,
 * and the wrist under it rather than behind it is most of what a precision
 * grip is. The support hand is further FORWARD than anything else in the kit
 * and back from the handguard's own end for the DMR's reason — the bipod is
 * stowed under that end, and a fist closed around folded legs reads as a hand
 * pushed through the weapon.
 */
const GRIP_HAND = new Vector3(0.02, -0.178, -0.195);
const GRIP_ELBOW = new Vector3(0.27, -0.585, -0.575);
const SUPPORT_HAND = new Vector3(-0.02, -0.086, 0.43);
const SUPPORT_ELBOW = new Vector3(-0.3, -0.51, 0.14);

/**
 * Builds a low-poly cel-styled bolt-action sniper rifle. Local +z is the barrel
 * axis, origin at the action's centre AND on the bore — the same frame the
 * other weapons are built in, so the viewmodel poses any of them with the same
 * numbers, with the one extra promise the bolt needs.
 *
 * The silhouette has to say "one round at a time" from across the kit screen,
 * and it says it with five things nothing else here has: a round-bodied action
 * with a bolt handle hanging off the side of it, a barrel heavy enough to be
 * the widest thing on the weapon for its whole length, a skeletonised chassis
 * stock with daylight through it, a magazine that is deep and NARROW rather
 * than deep and wide, and a brake long enough to read as a device rather than
 * as a crown. Everything else is the DMR's vocabulary one size up, which is
 * what makes those five read as deliberate rather than as a different game.
 *
 * Merged to one mesh per colour, plus a set for the magazine and a set for the
 * bolt — which are the two things that have to move independently. Measured
 * against the rest of the kit: **31 meshes and 11,218 triangles**, against the
 * LMG's 30 and 11,210 and the DMR's 30 and 10,602. The bolt costs exactly ONE
 * mesh over every other primary, and that is the whole price of the animation.
 */
export function buildSniper(
  scene: Scene,
  mats: CelMaterialFactory,
  prefix: string,
): WeaponParts {
  const root = new TransformNode(`${prefix}_sniper`, scene);
  const b = new WeaponBuild(scene, mats, prefix, root);

  // --- action: a body wrapped around the BORE, not a receiver sitting on one ---
  // This is the one structural difference from every other weapon in the kit
  // and the reason the rail is lower than the DMR's despite the bigger gun:
  // half of this section is under the axis, where the others have air.
  b.box("action", BODY, 0.076, 0.09, 0.47, 0, 0.012, 0.035);
  b.box("actionTop", BODY, 0.062, 0.014, 0.47, 0, 0.064, 0.035);
  b.box("recoilLug", METAL, 0.086, 0.026, 0.03, 0, -0.02, 0.22);
  b.box("rail", BODY, 0.058, 0.014, 0.86, 0, 0.079, 0.14);
  for (let i = 0; i < 12; i++) {
    b.box("railRib", METAL, 0.062, 0.012, 0.014, 0, 0.084, -0.28 + i * 0.07);
  }
  // A long ejection port: this cartridge is longer than anything else here and
  // the port has to be long enough to turn one out of, which is a silhouette
  // cue as much as a detail — a bolt gun's port is a hole in a tube.
  b.box("ejectPort", METAL, 0.01, 0.042, 0.15, 0.041, 0.022, 0.075);
  b.box("portRail", METAL, 0.008, 0.01, 0.15, 0.043, 0.046, 0.075);
  b.box("portRailLow", METAL, 0.008, 0.01, 0.15, 0.043, -0.002, 0.075);
  // The tang, and it is UNDER the bolt line rather than around it — which is
  // the one place this model is laid out for the animation rather than for the
  // part.
  //
  // A tang wrapped around the raceway is what a bolt gun has and it hides the
  // whole of the bolt at rest: the shroud lives inside it and emerges 18 mm at
  // full draw, which at viewmodel distance is nothing. Dropped below the line,
  // the shroud and the cocking piece stand in OPEN AIR behind the action and
  // the draw is 113 mm of bright metal sliding straight at the eye — and it is
  // the cue that survives where the handle does not, because the handle is on
  // the weapon's far flank from a camera carried to its left while this is
  // behind everything and can be hidden by nothing.
  b.box("tang", BODY, 0.05, 0.032, 0.1, 0, -0.024, -0.245);
  b.box("tangShelf", BODY, 0.044, 0.014, 0.06, 0, -0.001, -0.262);
  b.box("safetyShelf", METAL, 0.03, 0.016, 0.05, 0.03, -0.038, -0.232);
  b.pin("safetyPin", METAL, 0.012, 0.06, 0, -0.042, -0.212);
  b.box("slingQdF", METAL, 0.022, 0.028, 0.016, 0.042, -0.038, 0.24);

  // --- chassis: trigger housing, magwell, near-vertical grip ---
  // Deliberately narrower than the action above it (0.07 against 0.076), which
  // is what leaves the bolt knob somewhere to hang: see BOLT_REST.
  b.box("chassis", POLYMER, 0.07, 0.086, 0.42, 0, -0.075, -0.04);
  b.box("magwell", POLYMER, 0.062, 0.078, 0.135, 0, -0.098, 0.055);
  b.box("magFlareF", POLYMER, 0.07, 0.02, 0.014, 0, -0.132, 0.116);
  b.box("magFlareR", POLYMER, 0.07, 0.02, 0.014, 0, -0.132, -0.006);
  for (const side of [-1, 1] as const) {
    b.box("magFlareS", POLYMER, 0.008, 0.02, 0.135, side * 0.032, -0.132, 0.055);
  }
  b.box("magLatch", METAL, 0.026, 0.024, 0.018, 0, -0.118, -0.02);
  b.box("guardFront", POLYMER, 0.044, 0.062, 0.016, 0, -0.148, -0.095);
  b.box("guardBottom", POLYMER, 0.044, 0.014, 0.11, 0, -0.176, -0.148);
  // A two-stage trigger with a flat shoe. It gets its own face for the DMR's
  // reason and more so: on a weapon fired once every second and a quarter, the
  // trigger is the only control the shooter thinks about at all.
  const trigPivot = b.pivot("trigPivot", 0, -0.126, -0.118, 0.28);
  b.box("trigger", METAL, 0.014, 0.036, 0.013, 0, -0.018, 0, trigPivot);
  b.box("triggerShoe", METAL, 0.02, 0.02, 0.024, 0, -0.045, 0.003, trigPivot);
  b.box("trigAdjust", METAL, 0.01, 0.012, 0.012, 0.024, -0.096, -0.085);

  const gripPivot = b.pivot("gripPivot", 0, -0.118, -0.198, 0.13);
  b.box("grip", POLYMER, 0.054, 0.155, 0.078, 0, -0.078, 0, gripPivot);
  b.box("gripSwell", POLYMER, 0.062, 0.052, 0.072, 0, -0.052, -0.01, gripPivot);
  b.box("gripShelf", POLYMER, 0.058, 0.016, 0.05, 0, 0.005, -0.032, gripPivot);
  for (let i = 0; i < 4; i++) {
    b.box("gripRib", BODY, 0.048, 0.011, 0.013, 0, -0.048 - i * 0.03, 0.036, gripPivot);
  }
  b.box("gripCap", RUBBER, 0.056, 0.018, 0.082, 0, -0.162, 0, gripPivot);

  // --- handguard: a long free-float tube, slotted, carrying the bipod ---
  b.box("handguard", POLYMER, 0.082, 0.07, 0.5, 0, -0.012, 0.5);
  b.box("hgTop", POLYMER, 0.066, 0.014, 0.5, 0, 0.026, 0.5);
  b.box("hgBottom", POLYMER, 0.066, 0.014, 0.5, 0, -0.05, 0.5);
  b.box("hgCap", BODY, 0.078, 0.078, 0.014, 0, -0.012, 0.743);
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < 5; i++) {
      b.box("vent", BODY, 0.006, 0.032, 0.052, side * 0.042, -0.012, 0.3 + i * 0.082);
    }
    b.box("sideRail", METAL, 0.014, 0.026, 0.28, side * 0.044, -0.038, 0.5);
  }
  for (let i = 0; i < 5; i++) {
    b.box("mlok", BODY, 0.03, 0.006, 0.05, 0, -0.056, 0.3 + i * 0.082);
  }
  b.box("bottomRail", METAL, 0.048, 0.016, 0.32, 0, -0.062, 0.5);
  b.box("handStop", POLYMER, 0.042, 0.028, 0.028, 0, -0.08, 0.36);
  b.box("slingQdM", METAL, 0.022, 0.026, 0.016, -0.044, -0.05, 0.6);

  // --- bipod, folded back along the underside ---
  // Stowed for the DMR's reason: nothing in this game rests a weapon on
  // anything, so deployed legs would be geometry the player can never use, and
  // folded is the state it would be in while being carried anyway.
  b.box("bipodMount", BODY, 0.036, 0.032, 0.056, 0, -0.062, 0.71);
  b.pin("bipodPin", METAL, 0.012, 0.046, 0, -0.066, 0.71);
  const bipodPivot = b.pivot("bipodPivot", 0, -0.074, 0.71, -0.1);
  for (const side of [-1, 1] as const) {
    b.box("bipodLeg", METAL, 0.014, 0.014, 0.16, side * 0.024, 0, -0.08, bipodPivot);
    b.box("bipodFoot", RUBBER, 0.018, 0.016, 0.028, side * 0.024, -0.002, -0.166, bipodPivot);
  }
  b.box("bipodCatch", METAL, 0.05, 0.012, 0.016, 0, -0.08, 0.56);

  // --- barrel: the heaviest in the kit, and the widest thing on the weapon ---
  // Straight-taper heavy profile said with proud bands rather than cut flutes,
  // for the reason the DMR's is: the vocabulary here is additive, and a groove
  // is the one shape it cannot make.
  b.tube("barrelShank", BODY, 0.056, 0.058, 0.1, 0, 0, 0.3);
  b.tube("barrelNut", METAL, 0.066, 0.066, 0.018, 0, 0, 0.263);
  b.tube("barrel", BODY, 0.048, 0.056, 0.34, 0, 0, 0.52);
  b.tube("barrelFwd", BODY, 0.046, 0.048, 0.13, 0, 0, 0.755);
  for (let i = 0; i < 3; i++) {
    b.tube("barrelStep", METAL, 0.052, 0.052, 0.012, 0, 0, 0.76 + i * 0.05);
  }
  b.tube("threadCollar", METAL, 0.05, 0.05, 0.02, 0, 0, 0.828);

  // --- muzzle brake: four chambers, ported sideways and up ---
  // Rings threaded on a dark core, so the ports ARE the gaps and the bore is
  // open all the way through. The underside is webbed shut for the reason the
  // rifle's birdcage is: a brake that vents downward lifts the muzzle it was
  // fitted to hold down. Longer than the DMR's by a chamber, because on the
  // one weapon here whose whole cost is the second shot, the device that makes
  // the first one settle is worth putting on screen.
  b.tube("mzCollar", BODY, 0.058, 0.052, 0.02, 0, 0, 0.848);
  b.tube("mzCore", RUBBER, 0.028, 0.028, 0.13, 0, 0, 0.925);
  for (let i = 0; i < 4; i++) {
    b.shell("mzBaffle", BODY, 0.03, 0.015, 0.013, 0, 0.868 + i * 0.04, 10);
  }
  b.box("mzStrap", BODY, 0.052, 0.012, 0.125, 0, 0.03, 0.925);
  b.box("mzWeb", BODY, 0.042, 0.012, 0.125, 0, -0.03, 0.925);
  b.shell("crown", METAL, 0.03, 0.012, 0.014, 0, 0.996, 10);

  // --- chassis stock: skeletonised, with an adjustable comb and pad ---
  // The daylight is the point. Every other stock in the kit is a solid block
  // with details on it; this is a frame with holes through it, which is the one
  // silhouette cue that survives being three pixels wide against a skyline.
  // Every height is derived — see COMB_TOP, which is the sight picture's floor
  // rather than a number anybody liked the look of.
  b.box("stockBlock", BODY, 0.07, 0.115, 0.075, 0, 0.006, -0.335);
  b.box("stockSpine", POLYMER, 0.05, 0.036, 0.26, 0, SPINE_TOP - 0.018, -0.455);
  b.box("stockKeel", POLYMER, 0.048, 0.032, 0.24, 0, BUTT_Y - 0.07, -0.445);
  // Two struts between spine and keel, leaving three windows between them.
  for (const dz of [-0.4, -0.55] as const) {
    b.box(
      "stockStrut",
      POLYMER,
      0.042,
      SPINE_TOP - 0.036 - (BUTT_Y - 0.054),
      0.026,
      0,
      (SPINE_TOP - 0.036 + BUTT_Y - 0.054) / 2,
      dz,
    );
  }
  // The comb, carried ON posts in the daylight above the spine — a cheek piece
  // that is a part rather than a moulding, which is the read the DMR's has and
  // this one needs more, being the taller of the two.
  for (const dz of [-0.4, -0.51] as const) {
    b.pin(
      "combPost",
      METAL,
      0.013,
      COMB_BOTTOM - SPINE_TOP + 0.03,
      0,
      (SPINE_TOP + COMB_BOTTOM) / 2,
      dz,
      "y",
    );
  }
  b.box("comb", POLYMER, 0.056, COMB_H, 0.19, 0, COMB_TOP - COMB_PAD_H - COMB_H / 2, -0.455);
  b.box("combPad", RUBBER, 0.058, COMB_PAD_H, 0.19, 0, COMB_TOP - COMB_PAD_H / 2, -0.455);
  b.box("combKnob", METAL, 0.014, 0.017, 0.017, 0.03, COMB_BOTTOM + 0.015, -0.4);
  // The pad on its own rails, with a spacer stack: length of pull is the second
  // thing a precision stock adjusts and the second thing visible from inside
  // the weapon's own silhouette.
  for (const side of [-1, 1] as const) {
    b.tube("padRail", METAL, 0.014, 0.014, 0.11, side * 0.024, BUTT_Y - 0.03, -0.51);
  }
  b.box("buttPlate", POLYMER, 0.066, BUTT_H, 0.03, 0, BUTT_Y, -0.567);
  for (let i = 0; i < 2; i++) {
    b.box("padSpacer", BODY, 0.068, BUTT_H * 0.94, 0.008, 0, BUTT_Y, -0.585 - i * 0.009);
  }
  b.box("buttPad", RUBBER, 0.07, 0.196, 0.024, 0, BUTT_Y, -0.606);
  for (let i = 0; i < 2; i++) {
    b.box("padGroove", BODY, 0.072, 0.008, 0.02, 0, BUTT_Y - 0.052 - i * 0.032, -0.608);
  }
  // The monopod under the toe — where the off hand goes on a supported shot,
  // and the last cue that this weapon expects to be fired from the ground.
  b.box("monopodBlock", METAL, 0.026, 0.05, 0.036, 0, BUTT_Y - 0.106, -0.54);
  b.pin("monopodWheel", METAL, 0.03, 0.014, 0, BUTT_Y - 0.128, -0.54, "x");
  b.box("slingRear", METAL, 0.024, 0.03, 0.014, -0.038, BUTT_Y - 0.042, -0.475);

  // Merged before the magazine, the bolt and any optic, so none of their parts
  // can end up inside the weapon's own colour groups.
  const meshes = b.merge("sniper", root);

  // --- magazine: a deep, NARROW single-stack box ---
  // Narrow is the whole read. A double-stack of the same depth says "more
  // rounds"; a stick this thin says the cartridge is long and there are five of
  // them. Merged into a node of its own so the reload can drop it.
  const magazine = new TransformNode(`${prefix}_magazine`, scene);
  magazine.parent = root;
  const magPivot = b.pivot("magPivot", 0, -0.135, 0.055, MAG_RAKE);
  b.box("mag", POLYMER, 0.04, 0.2, 0.1, 0, -0.1, 0, magPivot);
  b.box("magSpine", BODY, 0.044, 0.19, 0.016, 0, -0.1, -0.044, magPivot);
  for (let i = 0; i < 3; i++) {
    b.box("magWitness", BODY, 0.043, 0.008, 0.05, 0, -0.06 - i * 0.045, 0.01, magPivot);
  }
  b.box("magFloor", METAL, 0.046, 0.018, 0.104, 0, -0.209, 0, magPivot);
  b.box("magBase", RUBBER, 0.044, 0.014, 0.098, 0, -0.225, 0, magPivot);
  meshes.push(...b.merge("sniperMag", magazine));

  // --- the bolt, about the bore, in a node of its own ---
  // Everything here is built at the weapon's origin and on the axis, because
  // `ViewModel` turns this node about z to lift the handle: a raceway built
  // anywhere else would swing the bolt through the receiver instead of turning
  // it in one. See `WeaponParts.bolt`.
  const bolt = new TransformNode(`${prefix}_bolt`, scene);
  bolt.parent = root;
  b.tube("boltBody", METAL, 0.03, 0.03, 0.18, 0, 0, -0.1);
  b.tube("boltHead", METAL, 0.034, 0.03, 0.024, 0, 0, -0.006);
  // The shroud and the cocking piece — the two parts standing in the open air
  // behind the action, and therefore what the eye actually watches travel. See
  // the tang above, which was moved out from around them to make that true.
  b.tube("boltShroud", BODY, 0.042, 0.038, 0.042, 0, 0, -0.208);
  b.tube("boltCollarR", METAL, 0.03, 0.03, 0.012, 0, 0, -0.233);
  b.tube("boltPin", METAL, 0.018, 0.018, 0.026, 0, 0, -0.248);
  // Two locking-lug ribs on the body, so the travel reads as a part sliding in
  // a tube rather than as a tube changing length.
  for (let i = 0; i < 2; i++) {
    b.tube("boltRib", BODY, 0.034, 0.034, 0.014, 0, 0, -0.04 - i * 0.05);
  }
  // The handle: a stem out along BOLT_DIR and a knob on the end of it, both
  // turned onto that direction with `rotZ = -BOLT_REST` the way every radial
  // part in this kit is (see `WeaponBuild.shell`).
  // **Sized to be READ, not to be right.** A bolt handle on a real rifle is a
  // stub; this one is nearly as long as the action is deep, because the whole
  // of what the cycle has to say is said by this part moving, and at viewmodel
  // distance through a weapon carried below and right of the eye a correctly
  // proportioned handle is four pixels that change place. It is the same
  // argument the reticles are scaled by and the tracers are drawn by: what is
  // authored is the ANGLE it subtends where it is actually looked at.
  b.box(
    "boltStem",
    METAL,
    0.022,
    0.082,
    0.026,
    BOLT_DIR.x * 0.05,
    BOLT_DIR.y * 0.05,
    BOLT_Z,
    root,
    -BOLT_REST,
  );
  b.pin("boltKnob", METAL, 0.036, 0.03, BOLT_DIR.x * 0.094, BOLT_DIR.y * 0.094, BOLT_Z, "x");
  b.box(
    "boltCollar",
    BODY,
    0.026,
    0.016,
    0.03,
    BOLT_DIR.x * 0.02,
    BOLT_DIR.y * 0.02,
    BOLT_Z,
    root,
    -BOLT_REST,
  );
  meshes.push(...b.merge("sniperBolt", bolt));

  // Every colour group the WEAPON itself merged — the magazine and the bolt
  // included, and the optics deliberately not. A bolt gun repainted in a
  // scheme with a black bolt would read as a different weapon underneath.
  const finish = b.takeFinish();

  const optics = buildOptics(b, MOUNT, prefix);
  meshes.push(...optics.meshes);
  b.disposePivots();

  return {
    root,
    muzzle: new Vector3(0, 0, 1.01),
    // Matches the `ejectPort` box above — the right side of the action.
    ejectPort: new Vector3(0.045, 0.022, 0.075),
    grip: { hand: GRIP_HAND, elbow: GRIP_ELBOW },
    support: { hand: SUPPORT_HAND, elbow: SUPPORT_ELBOW },
    magazine,
    magDrop: magDropAxis(MAG_RAKE),
    bolt,
    finish,
    sights: { kind: "fitted", assemblies: optics.sights },
    meshes,
  };
}
