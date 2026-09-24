/**
 * LmgModel.ts — Builds the belt-fed light machine gun, an FN M249 / Minimi
 * drawn from photographs, and hangs the same optics off its rail.
 * Returns WeaponParts, exactly as the other builders do: all of them are
 * interchangeable to everything above them, which is what lets `ViewModel`
 * carry any one.
 * Invariants: assembled at the origin with the root at identity and merged
 * before it is moved — `weaponKit.ts` owns that contract and the primitives.
 * The optics are `optics.ts`'s, built against `MOUNT` rather than re-tuned.
 * Invariant: THE RAIL IS SPLIT, and nothing between its two halves stands
 * above `RAIL_TOP`. The feed cover's rail stops with the cover, and the front
 * sight's base bridges to the front station at exactly the rail's height —
 * see `MOUNT`. The carry handle is FOLDED down the left flank for that reason.
 */
import { Scene, TransformNode, Vector3 } from "@babylonjs/core";
import type { CelMaterialFactory } from "../shaders/CelShader";
import { buildOptics, ironSightFloor, type OpticMount } from "./optics";
import {
  BODY,
  BRASS,
  METAL,
  POLYMER,
  RUBBER,
  spanRing,
  WeaponBuild,
  type WeaponParts,
} from "./weaponKit";

/**
 * Top face of the rail, and the highest in the kit. A belt-fed receiver is
 * deep for a reason no other weapon here has: the feed tray and the belt lying
 * in it sit ON TOP of the bolt, so the cover — which is what the rail is
 * bolted to — starts where another weapon's rail already is.
 */
const RAIL_TOP = 0.095;

/** The feed cover's top face: the rail's spine stands on it. */
const COVER_TOP = 0.078;

/**
 * Height of the bore above the origin: the middle of the receiver, just under
 * the feed tray, so a round stripped off the belt has no distance to fall to
 * the chamber. Everything concentric with the barrel is written against it.
 */
const BORE_Y = 0.02;

/**
 * Where the LMG offers its rail.
 *
 * The rail is not continuous here: it runs the length of the feed cover and
 * stops with it, because past the cover there is a barrel that comes off the
 * gun, and nothing that has to be lifted away twice a fight carries the optic.
 * What bridges the gap is the front sight's base standing on the barrel, its
 * own short rail at exactly `RAIL_TOP`, and that base is as far out as it can
 * be while the folded leaf still lands on it, which is what puts the front
 * station at 0.50. The rear station is on the cover, ahead of its latches.
 */
const MOUNT: OpticMount = {
  railTop: RAIL_TOP,
  mountZ: 0.02,
  ironRearZ: -0.2,
  ironFrontZ: 0.5,
};

/**
 * The stock's highest point, and the reason it is a `min` rather than a
 * number. The eye behind an aperture sits behind the butt, so everything on a
 * stock stands in the one part of the iron sight picture there is no looking
 * around — `ironSightFloor` is that line. The M249's comb sits well under the
 * receiver's top, so the clamp never bites today; it is here so that it bites
 * instead of the sight picture if the rail or the rear station is ever moved.
 */
const STOCK_FRONT_Z = -0.3;
const STOCK_TOP = Math.min(0.056, ironSightFloor(MOUNT, STOCK_FRONT_Z) - 0.006);
/** The comb, behind the wrist, and the butt's toe under it. */
const COMB = STOCK_TOP - 0.018;
const TOE = -0.152;
/** The butt's rear face. */
const BUTT_Z = -0.575;

/**
 * Where each hand grips, in weapon-local units. The firing hand rides back
 * down the raked grip; the support hand is under the deep handguard's middle,
 * behind the carry handle's grip and clear of everything that hangs lower.
 */
const GRIP_HAND = new Vector3(0.02, -0.14, -0.2);
const GRIP_ELBOW = new Vector3(0.26, -0.54, -0.57);
const SUPPORT_HAND = new Vector3(-0.02, -0.11 + BORE_Y, 0.32);
const SUPPORT_ELBOW = new Vector3(-0.3, -0.53 + BORE_Y, 0.04);

/**
 * Builds a cel-styled FN M249 / Minimi. Local +z is the barrel axis, origin at
 * the receiver centre — the same frame the other weapons are built in, so the
 * viewmodel poses any of them with the same numbers — with the bore `BORE_Y`
 * above it.
 *
 * **The argument is the ammunition, and this is the one weapon here that shows
 * you its own.** Everything else about the silhouette is that belt being fed,
 * housed and paid for, and all of it is taken from photographs:
 *
 * - **The stamped receiver** — a long, flat-sided steel box, riveted, with the
 *   raised guide rib down each flank that is a Minimi's tell from the side,
 *   and the charging handle forward on the RIGHT, since the left flank is
 *   carrying the belt.
 * - **The feed cover and the split rail.** A belt is loaded from above, so the
 *   top of the receiver is a hinged lid latched at the back, carrying the rail.
 * - **The deep ribbed handguard** under the barrel, deeper than the receiver
 *   itself, with the heat shield over the barrel on top of it.
 * - **The fixed stock** — a slim wrist dropping from the receiver and rising
 *   into a comb, over a tall butt: the M249's own, and the thing that makes it
 *   read as a machine gun rather than a rifle from behind.
 * - **The 200-round box** under the receiver, taller at the back, with the belt
 *   climbing out of its corner up the LEFT flank to the feed tray — the flank
 *   the camera sees, since the weapon is held to the right of the lens.
 * - **The carry handle**, clamped to the barrel ahead of the receiver and
 *   folded down the left, where a Minimi's folds: on top of the barrel is
 *   precisely where `RAIL_REACH` forbids it.
 * - **The bipod**, hung from the gas block and folded forward under the
 *   barrel, legs telescoped and feet at the flash hider.
 *
 * Built as the rifle is — bevelled profile slabs and contoured lofts, detail at
 * its real scale, controls small and dark, machining as dark inlays — see
 * `docs/weapons.md`'s procedural-models section.
 */
export function buildLmg(
  scene: Scene,
  mats: CelMaterialFactory,
  prefix: string,
): WeaponParts {
  const root = new TransformNode(`${prefix}_lmg`, scene);
  const b = new WeaponBuild(scene, mats, prefix, root);
  const f = BORE_Y;

  // --- receiver: a stamped steel box, riveted, the bore through its middle ---
  b.slab("receiver", BODY, [
    [-0.3, -0.036],
    [0.142, -0.036],
    [0.142, 0.064],
    [-0.286, 0.064],
    [-0.3, 0.05],
  ], 0.084, 0.004);
  // The guide rib down each flank, where the bolt carrier's rails are pressed
  // into the sheet: the one long line a Minimi is read by from the side.
  for (const side of [-1, 1] as const) {
    b.slab("guideRib", BODY, [
      [-0.288, 0.016],
      [0.128, 0.016],
      [0.134, 0.021],
      [0.128, 0.026],
      [-0.288, 0.026],
      [-0.292, 0.021],
    ], 0.004, 0, side * 0.043);
    // A second, lower pressing, stopping short of the trigger group's plates.
    b.slab("lowerRib", BODY, [
      [-0.06, -0.016],
      [0.128, -0.016],
      [0.128, -0.01],
      [-0.06, -0.01],
    ], 0.003, 0, side * 0.0425);
  }
  // Rivets at the sheet's pitch: heads proud on both flanks.
  for (const [y, z] of [
    [0.046, -0.27], [0.046, -0.16], [0.046, -0.05], [0.046, 0.06],
    [-0.026, -0.27], [-0.026, 0.02], [-0.026, 0.11], [0.004, 0.125],
  ] as const) {
    b.pin("rivet", METAL, 0.007, 0.089, 0, y, z);
  }
  // The rear plate the stock is bolted into, and the takedown pin through it.
  b.slab("rearPlate", BODY, [
    [-0.296, 0.05],
    [-0.312, 0.046],
    [-0.312, -0.036],
    [-0.296, -0.04],
  ], 0.08, 0.004);
  b.pin("pinRear", METAL, 0.01, 0.09, 0, -0.02, -0.29);

  // --- feed cover: the lid the belt is laid under, and the rail on top ---
  // Hinged at the front and latched at the back, which is the way round a
  // cover thrown open toward the shooter has to be.
  b.slab("feedCover", BODY, [
    [-0.262, 0.06],
    [0.14, 0.06],
    [0.14, 0.07],
    [0.132, COVER_TOP],
    [-0.25, COVER_TOP],
    [-0.262, 0.07],
  ], 0.08, 0.003);
  b.picatinny("rail", 0, COVER_TOP, -0.238, 19, { width: 0.056, height: RAIL_TOP - COVER_TOP });
  b.pin("coverHinge", METAL, 0.012, 0.084, 0, 0.066, 0.13);
  // The two latch buttons at the back, one each side, a thumb's width apart.
  for (const side of [-1, 1] as const) {
    b.box("coverLatch", METAL, 0.005, 0.012, 0.016, side * 0.042, 0.068, -0.25);
  }
  // The cover's seam: a dark line down each flank, just under its lip.
  b.slab("coverSeam", RUBBER, [
    [-0.26, 0.057],
    [0.138, 0.057],
    [0.138, 0.06],
    [-0.26, 0.06],
  ], 0.0852, 0);

  // --- feed tray: where the belt goes in, left flank ---
  // The lip stands PROUD of the receiver because the belt has to ride onto
  // something; a slot cut flush reads as a panel line and the belt as a decal.
  b.slab("feedMouth", RUBBER, [
    [-0.03, 0.028],
    [0.1, 0.028],
    [0.1, 0.054],
    [-0.03, 0.054],
  ], 0.004, 0, -0.0425);
  b.slab("feedLip", METAL, [
    [-0.036, 0.054],
    [0.106, 0.054],
    [0.106, 0.06],
    [-0.036, 0.06],
  ], 0.012, 0.002, -0.046);
  b.slab("feedLipBase", METAL, [
    [-0.036, 0.022],
    [0.106, 0.022],
    [0.1, 0.028],
    [-0.03, 0.028],
  ], 0.012, 0.002, -0.046);
  // The magazine well's dust cover, shut, behind the belt: a Minimi takes a
  // rifle magazine as well, and the closed flap is how it says so.
  b.slab("magwellCover", BODY, [
    [-0.075, -0.006],
    [-0.035, -0.006],
    [-0.035, 0.018],
    [-0.075, 0.018],
  ], 0.008, 0.002, -0.046);

  // --- right flank: the link port and the charging handle ---
  // Empties out of the right: the port with its cover swung down under it.
  b.slab("linkPort", RUBBER, [
    [-0.02, 0.0],
    [0.08, 0.0],
    [0.08, 0.03],
    [-0.02, 0.03],
  ], 0.003, 0, 0.0425);
  b.box("portCover", BODY, 0.003, 0.012, 0.098, 0.044, -0.008, 0.03);
  // Charging handle, forward on the RIGHT: every other long gun in the kit
  // charges on the left, and this one's left is carrying the belt.
  b.slab("chSlot", RUBBER, [
    [0.0, 0.034],
    [0.13, 0.034],
    [0.13, 0.044],
    [0.0, 0.044],
  ], 0.003, 0, 0.0425);
  b.slab("chArm", METAL, [
    [0.098, 0.034],
    [0.116, 0.034],
    [0.116, 0.044],
    [0.098, 0.044],
  ], 0.022, 0.002, 0.052);
  b.pin("chKnob", POLYMER, 0.016, 0.018, 0.068, 0.039, 0.107);

  // --- trigger group: hung under the receiver's rear ---
  b.slab("trigHousing", POLYMER, [
    [-0.292, -0.03],
    [-0.066, -0.03],
    [-0.066, -0.058],
    [-0.074, -0.068],
    [-0.082, -0.068],
    [-0.082, -0.05],
    [-0.14, -0.05],
    [-0.152, -0.076],
    [-0.25, -0.076],
    [-0.272, -0.064],
    [-0.292, -0.048],
  ], 0.07, 0.005);
  b.pin("trigPin", METAL, 0.008, 0.072, 0, -0.04, -0.12);
  b.pin("hammerPin", METAL, 0.008, 0.072, 0, -0.056, -0.2);
  // The guard: big, for a gloved finger, closing onto the grip's front.
  b.slab("guard", POLYMER, [
    [-0.068, -0.066],
    [-0.068, -0.1],
    [-0.08, -0.114],
    [-0.152, -0.114],
    [-0.152, -0.103],
    [-0.084, -0.102],
    [-0.08, -0.097],
    [-0.08, -0.066],
  ], 0.022, 0.002);
  b.slab("trigger", METAL, [
    [-0.11, -0.05],
    [-0.1, -0.05],
    [-0.101, -0.068],
    [-0.097, -0.086],
    [-0.096, -0.094],
    [-0.104, -0.094],
    [-0.107, -0.084],
    [-0.11, -0.068],
  ], 0.01, 0.0015);
  // The push-through safety over the trigger, a dark button each side.
  b.pin("safety", RUBBER, 0.011, 0.076, 0, -0.056, -0.09);

  // The grip, raked well back: an A2-pattern grip with a finger nub, ribbed
  // down its back strap. Rake 0.35 is a machine gunner's wrist, behind the
  // trigger rather than under it — a burst is held, not squeezed.
  const gripPivot = b.pivot("gripPivot", 0, -0.075, -0.175, 0.35);
  b.upright("grip", POLYMER, [
    spanRing(-0.15, 0.054, 0.032, -0.04),
    spanRing(-0.13, 0.056, 0.03, -0.043),
    spanRing(-0.1, 0.057, 0.028, -0.045),
    spanRing(-0.082, 0.057, 0.038, -0.045),
    spanRing(-0.066, 0.057, 0.028, -0.045),
    spanRing(-0.03, 0.055, 0.03, -0.043),
    spanRing(-0.006, 0.054, 0.034, -0.052),
    spanRing(0.014, 0.05, 0.034, -0.046),
  ], gripPivot);
  for (let i = 0; i < 5; i++) {
    b.box("gripRib", RUBBER, 0.04, 0.004, 0.004, 0, -0.136 + i * 0.022, -0.045, gripPivot);
  }
  b.upright("gripCap", RUBBER, [
    spanRing(-0.162, 0.054, 0.033, -0.041),
    spanRing(-0.148, 0.055, 0.033, -0.041),
  ], gripPivot);

  // --- stock: the M249's fixed stock, wrist, comb and a tall butt ---
  // A slim wrist dropping out of the receiver's rear plate, rising again into
  // the comb, over a butt nearly twice the receiver's depth.
  b.slab("stock", POLYMER, [
    [-0.308, STOCK_TOP],
    [-0.35, STOCK_TOP - 0.01],
    [-0.4, COMB - 0.014],
    [-0.43, COMB - 0.004],
    [-0.46, COMB],
    [BUTT_Z + 0.006, COMB],
    [BUTT_Z + 0.006, TOE],
    [-0.545, TOE],
    [-0.46, -0.1],
    [-0.4, -0.066],
    [-0.35, -0.052],
    [-0.308, -0.042],
  ], 0.056, 0.008);
  // The butt swells wider than the wrist: a second slab over the rear half.
  b.slab("stockButt", POLYMER, [
    [-0.47, COMB - 0.004],
    [BUTT_Z + 0.004, COMB - 0.004],
    [BUTT_Z + 0.004, TOE + 0.004],
    [-0.54, TOE + 0.004],
    [-0.47, -0.108],
  ], 0.064, 0.008);
  // A sunk panel down each flank of the butt, the rim built round a dark web.
  b.slab("buttPanel", RUBBER, [
    [-0.49, COMB - 0.02],
    [-0.558, COMB - 0.02],
    [-0.558, TOE + 0.024],
    [-0.54, TOE + 0.024],
    [-0.49, -0.1],
  ], 0.066, 0);
  // The butt plate, with the folding strap across its heel.
  b.slab("buttPlate", RUBBER, [
    [BUTT_Z + 0.008, COMB + 0.002],
    [BUTT_Z - 0.008, COMB],
    [BUTT_Z - 0.012, COMB - 0.012],
    [BUTT_Z - 0.012, TOE + 0.012],
    [BUTT_Z - 0.006, TOE],
    [BUTT_Z + 0.008, TOE - 0.002],
  ], 0.068, 0.004);
  for (let i = 0; i < 7; i++) {
    b.box("padRib", RUBBER, 0.07, 0.004, 0.006, 0, COMB - 0.022 - i * 0.022, BUTT_Z - 0.012);
  }
  b.slab("buttStrap", METAL, [
    [BUTT_Z - 0.01, COMB + 0.004],
    [-0.54, COMB + 0.004],
    [-0.535, COMB],
    [BUTT_Z - 0.01, COMB],
  ], 0.04, 0.001);
  b.pin("strapHinge", METAL, 0.008, 0.044, 0, COMB + 0.002, -0.54);
  // The buffer's cap in the wrist, and a sling loop under the toe.
  b.pin("bufferCap", METAL, 0.016, 0.058, 0, 0.006, -0.33);
  b.slab("slingRear", METAL, [
    [-0.51, TOE + 0.02],
    [-0.49, TOE + 0.028],
    [-0.494, TOE + 0.014],
    [-0.512, TOE + 0.008],
  ], 0.012, 0.001);

  // --- handguard: deep, ribbed, under the barrel ---
  // Deeper than the receiver: it wraps the gas cylinder under the barrel as
  // well, and it is where the support hand lives on a gun too hot to hold.
  b.slab("handguard", POLYMER, [
    [0.14, 0.046],
    [0.43, 0.046],
    [0.432, 0.038],
    [0.432, -0.02],
    [0.414, -0.052],
    [0.39, -0.064],
    [0.17, -0.064],
    [0.152, -0.078],
    [0.14, -0.078],
  ], 0.074, 0.008);
  // The grip panel: sunk into the handguard's flank, with its vertical ribs
  // standing in the recess. What makes the recess read is the dark web between
  // the ribs; a panel line alone is a decal.
  b.slab("hgPanel", RUBBER, [
    [0.18, 0.032],
    [0.39, 0.032],
    [0.39, -0.046],
    [0.18, -0.046],
  ], 0.0752, 0);
  for (let i = 0; i < 10; i++) {
    const z = 0.19 + i * 0.021;
    b.slab("hgRib", POLYMER, [
      [z, 0.028],
      [z + 0.008, 0.028],
      [z + 0.008, -0.042],
      [z, -0.042],
    ], 0.0766, 0.0015);
  }
  b.box("slingFront", METAL, 0.004, 0.014, 0.014, -0.039, -0.06, 0.2);

  // --- barrel: quick-change, under a heat shield, into a closed-bottom hider ---
  b.tube("barrel", BODY, 0.03, 0.036, 0.66, 0, f, 0.45);
  // The heat shield over the barrel, on top of the handguard: a long flat
  // strip with its vent slots, well under the rail line.
  b.slab("heatShield", BODY, [
    [0.2, 0.04],
    [0.42, 0.04],
    [0.428, 0.048],
    [0.422, 0.058],
    [0.2, 0.058],
  ], 0.046, 0.004);
  for (let i = 0; i < 5; i++) {
    b.box("shieldVent", RUBBER, 0.048, 0.006, 0.018, 0, 0.05, 0.23 + i * 0.04);
  }
  // The barrel's lock and the carry handle's clamp, one collar ahead of the
  // receiver.
  b.slab("barrelClamp", BODY, [
    [0.15, -0.0],
    [0.198, -0.0],
    [0.198, 0.058],
    [0.19, 0.066],
    [0.158, 0.066],
    [0.15, 0.058],
  ], 0.054, 0.004);
  b.pin("clampPin", METAL, 0.01, 0.058, 0, 0.05, 0.174);

  // --- carry handle, folded down the left flank ---
  // Clamped at the barrel, swung down and back to lie along the handguard's
  // top edge: its grip is under the sight line and still in the support
  // hand's reach.
  b.slab("carryArm", METAL, [
    [0.166, 0.034],
    [0.36, 0.034],
    [0.366, 0.04],
    [0.36, 0.046],
    [0.166, 0.046],
  ], 0.01, 0.002, -0.034);
  b.box("carryKnuckle", METAL, 0.024, 0.014, 0.016, -0.042, 0.04, 0.174);
  b.tube("carryGrip", RUBBER, 0.022, 0.022, 0.12, -0.048, 0.04, 0.29);
  for (let i = 0; i < 4; i++) {
    b.tube("carryRing", POLYMER, 0.024, 0.024, 0.006, -0.048, 0.04, 0.245 + i * 0.03);
  }

  // --- gas block, regulator and the front sight's base ---
  b.slab("gasBlock", BODY, [
    [0.43, 0.034],
    [0.5, 0.034],
    [0.508, 0.026],
    [0.508, -0.03],
    [0.5, -0.038],
    [0.43, -0.038],
  ], 0.046, 0.005);
  // The regulator, on the gas cylinder's nose: the one part on any weapon here
  // meant to be turned during a fight.
  b.tube("gasReg", METAL, 0.026, 0.03, 0.022, 0, f - 0.036, 0.52);
  b.tube("gasRegCap", RUBBER, 0.014, 0.014, 0.004, 0, f - 0.036, 0.532);
  b.pin("regLever", METAL, 0.006, 0.036, 0, f - 0.036, 0.518);
  // The front sight base: stands on the barrel and carries a short rail whose
  // top is exactly RAIL_TOP and no higher — see `MOUNT`.
  b.slab("fsBase", BODY, [
    [0.47, 0.034],
    [0.56, 0.034],
    [0.556, 0.052],
    [0.548, COVER_TOP],
    [0.474, COVER_TOP],
    [0.466, 0.056],
  ], 0.03, 0.004);
  b.picatinny("fsRail", 0, COVER_TOP, 0.476, 4, { width: 0.05, height: RAIL_TOP - COVER_TOP });

  // --- bipod: hung from the gas block, folded forward under the barrel ---
  b.slab("bipodYoke", METAL, [
    [0.505, -0.038],
    [0.54, -0.038],
    [0.544, -0.046],
    [0.54, -0.054],
    [0.505, -0.054],
  ], 0.044, 0.003);
  b.pin("bipodPin", METAL, 0.01, 0.05, 0, -0.046, 0.526);
  for (const side of [-1, 1] as const) {
    b.tube("bipodLeg", BODY, 0.012, 0.014, 0.12, side * 0.016, -0.046, 0.6);
    b.tube("bipodLegLower", METAL, 0.009, 0.009, 0.1, side * 0.016, -0.046, 0.71);
    b.tube("bipodCollar", METAL, 0.016, 0.016, 0.008, side * 0.016, -0.046, 0.657);
    b.box("bipodFoot", RUBBER, 0.016, 0.02, 0.018, side * 0.016, -0.048, 0.765);
  }

  // --- muzzle: the Minimi's closed-bottom hider ---
  // Slotted round the top and sides, solid underneath so the gun does not kick
  // dust up off the ground it is lying on.
  b.tube("mzCollar", BODY, 0.04, 0.038, 0.016, 0, f, 0.728);
  b.tube("mzCore", RUBBER, 0.024, 0.024, 0.066, 0, f, 0.77);
  b.shell("mzCage", BODY, 0.026, 0.008, 0.062, f, 0.771, 8, Math.PI / 8, 0.62);
  b.box("mzFloor", BODY, 0.016, 0.009, 0.062, 0, f - 0.0165, 0.771);
  b.shell("crown", BODY, 0.026, 0.009, 0.008, f, 0.799, 10);

  // The shelf the box hangs off stays on the WEAPON: a reload that took it
  // away would leave nothing for the fresh box to hang from.
  b.slab("boxMount", METAL, [
    [-0.044, -0.036],
    [0.126, -0.036],
    [0.12, -0.044],
    [-0.038, -0.044],
  ], 0.07, 0.002);

  // The LMG itself is finished. Merge it before any optic is built, so a
  // sight's parts can never end up inside the weapon's colour groups.
  const meshes = b.merge("lmg", root);

  // --- the box and its belt: a container, not a magazine ---
  // The M249's 200-round box: taller at the back than the front, the lid
  // clipped over the top and the belt leaving by the top left corner.
  //
  // It is this weapon's `magazine`, merged into a node of its own so the
  // reload can drop it — and the BELT goes with it rather than staying behind,
  // because a belt is fed from the box it is coiled in. Swapping the container
  // and leaving a run of brass hanging out of the feed would be a reload that
  // loaded nothing.
  const magazine = new TransformNode(`${prefix}_magazine`, scene);
  magazine.parent = root;
  const BX = -0.006;
  b.slab("boxBody", POLYMER, [
    [-0.036, -0.046],
    [0.12, -0.046],
    [0.12, -0.056],
    [0.108, -0.168],
    [0.1, -0.176],
    [-0.028, -0.19],
    [-0.036, -0.182],
  ], 0.094, 0.006, BX);
  b.slab("boxLid", POLYMER, [
    [-0.04, -0.044],
    [0.124, -0.044],
    [0.124, -0.062],
    [-0.04, -0.062],
  ], 0.098, 0.004, BX);
  // Moulded ribs down each flank, the dark webs between them.
  b.slab("boxPanel", RUBBER, [
    [-0.02, -0.074],
    [0.1, -0.074],
    [0.092, -0.158],
    [-0.02, -0.172],
  ], 0.0955, 0, BX);
  for (let i = 0; i < 5; i++) {
    const z = -0.012 + i * 0.024;
    const bottom = -0.172 + (z + 0.02) * 0.12;
    b.slab("boxRib", POLYMER, [
      [z, -0.076],
      [z + 0.01, -0.076],
      [z + 0.01, bottom + 0.004],
      [z, bottom + 0.004],
    ], 0.097, 0.0015, BX);
  }
  b.slab("boxLatch", METAL, [
    [0.12, -0.058],
    [0.128, -0.058],
    [0.128, -0.09],
    [0.12, -0.094],
  ], 0.03, 0.002, BX);
  // The chute the belt climbs out of, on the lid's left corner: wide enough
  // that the belt is seen LEAVING something.
  b.slab("boxChute", POLYMER, [
    [0.0, -0.062],
    [0.07, -0.062],
    [0.07, -0.036],
    [0.064, -0.03],
    [0.006, -0.03],
    [0.0, -0.036],
  ], 0.026, 0.003, -0.052);

  // --- the belt: rounds and their links, up the outside of the gun ---
  // Pins ACROSS the weapon, so the flank the camera sees shows a stack of case
  // heads rather than a row of bullets. Drawn nearer a rifle round's
  // proportions and a full case-length PROUD of the flank: flush and to scale,
  // the one feature this weapon is built around reads as a scratch in the
  // paint.
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    const y = -0.03 + t * 0.07;
    const z = 0.036 - t * 0.004;
    b.pin("beltRound", BRASS, 0.014, 0.05, -0.058, y, z, "x");
    b.pin("beltRim", BRASS, 0.017, 0.006, -0.084, y, z, "x");
    if (i < 5) {
      // The link between this round and the next, dark against the brass,
      // outboard of the chute's own flank so the two never share a face.
      b.box("beltLink", METAL, 0.036, 0.008, 0.02, -0.058, y + 0.007, z);
    }
  }
  meshes.push(...b.merge("lmgBox", magazine));

  // Every colour group the WEAPON itself merged, taken before the optics are
  // built so a finish can never reach one — see `WeaponBuild.takeFinish`.
  const finish = b.takeFinish();

  const optics = buildOptics(b, MOUNT, prefix);
  meshes.push(...optics.meshes);
  b.disposePivots();

  return {
    root,
    muzzle: new Vector3(0, BORE_Y, 0.8),
    // The port on the right of the receiver. The links and the brass leave
    // there together as far as the eye is concerned: there is one brass pool
    // and it throws casings.
    ejectPort: new Vector3(0.046, 0.015, 0.03),
    grip: { hand: GRIP_HAND, elbow: GRIP_ELBOW },
    support: { hand: SUPPORT_HAND, elbow: SUPPORT_ELBOW },
    // No `magHand`: the shared offset takes the support hand back and down to
    // a magwell under the receiver, and this weapon's box is exactly there.
    magazine,
    finish,
    sights: { kind: "fitted", assemblies: optics.sights },
    meshes,
  };
}
