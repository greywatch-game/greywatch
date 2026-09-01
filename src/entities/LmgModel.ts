/**
 * LmgModel.ts — Builds the low-poly belt-fed light machine gun from
 * primitives, and hangs the same five optics off its rail.
 * Returns WeaponParts, exactly as the other four builders do: all of them are
 * interchangeable to everything above them, which is what lets `ViewModel`
 * carry any one.
 * Invariants: assembled at the origin with the root at identity and merged
 * before it is moved — `weaponKit.ts` owns that contract and the primitives.
 * The optics are `optics.ts`'s, built against `MOUNT` rather than re-tuned.
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

/**
 * Where the LMG offers its rail.
 *
 * The front station is the one number that is not free, and on this weapon it
 * is short of the 0.53 the rifle and the DMR both reach. The rail is not
 * continuous here: it runs the length of the feed cover and stops with it,
 * because past the cover there is a barrel that comes off the gun, and nothing
 * that has to be lifted away twice a fight carries the optic. What bridges the
 * gap is the front sight tower standing on the barrel — see `fsRail` — and
 * that tower is as far out as it can be while the folded leaf still lands on
 * it, which is what puts the station at 0.50.
 *
 * The rear station is the receiver's, and it is ordinary: -0.20 is where the
 * cover's own rear latch leaves room for it.
 */
const MOUNT: OpticMount = {
  railTop: RAIL_TOP,
  mountZ: 0.02,
  ironRearZ: -0.2,
  ironFrontZ: 0.5,
};

/**
 * The stock's top, and the reason it is a `min` rather than a number.
 *
 * The eye behind an aperture sits well behind the butt, so everything on a
 * stock stands in the one part of the iron sight picture there is no looking
 * around — `ironSightFloor` is that line, and the DMR is the weapon that
 * shipped with a comb over it. This stock is authored LOW (a machine gunner's
 * cheek is on the stock's side as often as its top, and the weapon's own
 * silhouette wants the long flat receiver to be the top line), so the clamp
 * never bites today. It is here so that it bites instead of the sight picture
 * if the rail or the rear station is ever moved.
 */
const STOCK_TOP = Math.min(0.058, ironSightFloor(MOUNT, -0.3) - 0.006);

/**
 * Where each hand grips, in weapon-local units. The support hand is on the
 * handguard's REAR half, behind the folded bipod for the DMR's reason: a fist
 * closed around two stowed legs reads as a hand pushed through the weapon.
 */
const GRIP_HAND = new Vector3(0.02, -0.135, -0.185);
const GRIP_ELBOW = new Vector3(0.26, -0.535, -0.555);
const SUPPORT_HAND = new Vector3(-0.02, -0.1, 0.34);
const SUPPORT_ELBOW = new Vector3(-0.3, -0.52, 0.06);

/**
 * Builds a low-poly cel-styled belt-fed light machine gun. Local +z is the
 * barrel axis, origin at the receiver centre — the same frame the other four
 * weapons are built in, so the viewmodel poses any of them with the same
 * numbers.
 *
 * **The argument is the ammunition, and this is the one weapon here that shows
 * you its own.** The other four keep every round they have inside a box you
 * cannot see into; this one carries a belt up the outside of the receiver in
 * plain sight, which is why `weaponKit` grew a brass colour group that is
 * empty on all four of them. Everything else about the silhouette is that belt
 * being fed, housed and paid for:
 *
 * - **The feed cover and the split rail.** A belt is loaded from above, so the
 *   whole top of the receiver is a hinged lid — long, flat, latched at the
 *   back, and carrying the rail on its own top face. It stops where the cover
 *   stops, and the gap between it and the front sight tower is the honest read
 *   of a weapon whose barrel comes off: nothing that is lifted away mid-fight
 *   is allowed to carry the optic. The tower bridges it at exactly `RAIL_TOP`
 *   and no higher, which is `RAIL_REACH` in `optics.ts` — nothing forward of
 *   the mount may stand above the rail without sitting in the middle of the
 *   scope's picture.
 * - **The box under the receiver.** Where every other weapon here has a
 *   magazine, this has a square container as wide as the receiver and half its
 *   depth again, which is what makes the weapon bottom-heavy from any angle —
 *   the fastest way to tell it from the rifle at a glance is that the mass is
 *   under the bore rather than over it.
 * - **The belt itself.** Six rounds and their links, standing proud of the
 *   LEFT flank between the box's chute and the feed tray's lip — the flank the
 *   camera actually sees, since the weapon is held to the right of the lens.
 *   The rounds are pins ACROSS the weapon, so what shows is a stack of case
 *   heads, which is what a belt looks like from the side it is fed from.
 * - **The side-folding carry handle.** A machine gun's handle is on top of the
 *   barrel, and on top of the barrel is precisely where `RAIL_REACH` forbids
 *   it — the same rule that cost the carbine its handle bridge. So it is
 *   hinged at the front and folded back down the barrel's left flank, under
 *   the sight line, where it doubles as the second horizontal line the eye
 *   reads the weapon's length along.
 * - **The bipod, folded back under the barrel.** Legs along the underside with
 *   the feet trailing, rather than the carbine's pair lying in flank recesses:
 *   this is a weapon that is MEANT to be put down, and the legs are stowed the
 *   way something used every time it stops is stowed.
 *
 * Three smaller things finish it: a heavy fluted barrel with a gas regulator
 * under the block (the one part of any weapon here that exists to be turned
 * mid-fight), a charging handle on the RIGHT — every other long gun charges on
 * the left, and the left flank of this one is already carrying a belt and a
 * handle — and a flared conical flash hider against the rifle's birdcage, the
 * carbine's rings and the DMR's chambered brake.
 *
 * ~140 parts, merged to one mesh per colour. The merge is what makes the
 * detail free and what keeps the outline pass drawing one border per colour
 * group instead of a black shell around every rib.
 */
export function buildLmg(
  scene: Scene,
  mats: CelMaterialFactory,
  prefix: string,
): WeaponParts {
  const root = new TransformNode(`${prefix}_lmg`, scene);
  const b = new WeaponBuild(scene, mats, prefix, root);

  // --- receiver: one long deep box, bore at y = 0 as on every weapon here ---
  // Deep because the bolt, the feed mechanism and the belt are stacked, not
  // side by side. The narrow upper deck is the chamfer additive geometry
  // cannot cut, the same two-slab trick the rifle's upper uses.
  b.box("receiver", BODY, 0.086, 0.1, 0.6, 0, 0.02, 0);
  b.box("receiverDeck", BODY, 0.072, 0.016, 0.6, 0, 0.062, 0);
  b.box("receiverFoot", POLYMER, 0.08, 0.016, 0.56, 0, -0.034, -0.02);
  // Two takedown pins, proud on both flanks — a machine gun comes apart.
  b.pin("pinFront", METAL, 0.016, 0.092, 0, 0.005, 0.235);
  b.pin("pinRear", METAL, 0.016, 0.092, 0, 0.005, -0.245);

  // --- feed cover: the lid the belt is laid under, and the rail on top ---
  // Hinged at the FRONT and latched at the back, which is the way round a
  // cover that is thrown open toward the shooter has to be.
  b.box("feedCover", BODY, 0.078, 0.018, 0.56, 0, 0.077, 0);
  b.box("coverRail", BODY, 0.056, 0.014, 0.54, 0, 0.088, 0);
  for (let i = 0; i < 7; i++) {
    b.box("railRib", METAL, 0.06, 0.012, 0.014, 0, 0.093, -0.24 + i * 0.08);
  }
  b.pin("coverHinge", METAL, 0.014, 0.082, 0, 0.079, 0.272);
  b.box("coverLatch", METAL, 0.032, 0.026, 0.028, 0, 0.072, -0.293);
  b.box("coverLatchTab", METAL, 0.012, 0.03, 0.014, 0, 0.062, -0.308);
  // The cover's own seam down each flank: a lid that meets the receiver in a
  // line is a lid, and one that does not is a thicker receiver.
  for (const side of [-1, 1] as const) {
    b.box("coverSeam", POLYMER, 0.006, 0.006, 0.54, side * 0.04, 0.067, 0);
  }

  // --- feed tray: where the belt goes in, left flank ---
  // The lip stands PROUD of the receiver because the belt has to ride onto
  // something; a slot cut flush reads as a panel line and the belt as a decal.
  b.box("feedSlot", POLYMER, 0.006, 0.03, 0.115, -0.045, 0.028, 0.02);
  b.box("feedLipTop", METAL, 0.008, 0.008, 0.125, -0.046, 0.047, 0.02);
  b.box("feedLipBase", METAL, 0.01, 0.01, 0.125, -0.047, 0.011, 0.02);
  b.box("feedPawl", METAL, 0.012, 0.014, 0.03, -0.048, 0.03, -0.045);

  // --- ejection port and link chute: right flank and under it ---
  // Brass out of the side and the emptied links out of the bottom, which is
  // the one thing about a belt-fed the other weapons have no equivalent of.
  b.box("ejectPort", METAL, 0.008, 0.03, 0.1, 0.045, 0.035, 0.06);
  b.box("portCover", METAL, 0.007, 0.022, 0.096, 0.047, 0.014, 0.058);
  b.box("deflector", BODY, 0.016, 0.026, 0.042, 0.046, 0.056, 0);
  b.box("linkChute", BODY, 0.034, 0.036, 0.1, 0.028, -0.046, 0.21);
  b.box("linkChuteLip", POLYMER, 0.03, 0.01, 0.09, 0.028, -0.064, 0.212);

  // Charging handle, RIGHT side. Every other long gun in the kit charges on
  // the left; this one cannot, because the left flank is carrying a belt and
  // a folded handle and a third thing there would be a thicket.
  b.box("chSlot", BODY, 0.006, 0.014, 0.18, 0.044, 0.058, 0.1);
  b.box("chArm", METAL, 0.04, 0.013, 0.026, 0.062, 0.058, 0.16);
  b.box("chKnob", METAL, 0.018, 0.022, 0.04, 0.078, 0.058, 0.165);

  // --- trigger group: hung under the receiver's rear ---
  b.box("trigHousing", POLYMER, 0.072, 0.06, 0.22, 0, -0.05, -0.16);
  b.box("guardFront", POLYMER, 0.05, 0.05, 0.018, 0, -0.1, -0.09);
  b.box("guardBottom", POLYMER, 0.05, 0.016, 0.09, 0, -0.122, -0.13);
  const trigPivot = b.pivot("trigPivot", 0, -0.082, -0.11, 0.4);
  b.box("trigger", METAL, 0.014, 0.032, 0.014, 0, -0.016, 0, trigPivot);
  b.box("triggerToe", METAL, 0.014, 0.024, 0.017, 0, -0.042, 0.008, trigPivot);
  // Two-position safety only: this weapon has one fire mode and the part says
  // so — against the carbine's three-position selector, which is its mode made
  // visible in exactly the same way.
  b.pin("safetyPin", METAL, 0.013, 0.09, 0, -0.048, -0.135);
  for (const side of [-1, 1] as const) {
    b.box("safetyLever", METAL, 0.012, 0.036, 0.014, side * 0.049, -0.062, -0.135);
  }

  const gripPivot = b.pivot("gripPivot", 0, -0.075, -0.175, 0.3);
  b.box("grip", POLYMER, 0.056, 0.145, 0.078, 0, -0.07, 0, gripPivot);
  b.box("gripSwell", POLYMER, 0.061, 0.05, 0.07, 0, -0.052, -0.006, gripPivot);
  for (let i = 0; i < 3; i++) {
    b.box("gripRib", BODY, 0.05, 0.011, 0.014, 0, -0.042 - i * 0.032, 0.036, gripPivot);
  }
  b.box("gripCap", RUBBER, 0.058, 0.018, 0.082, 0, -0.15, 0, gripPivot);

  // The box's mount stays on the WEAPON: it is the shelf the container hangs
  // off, and a reload that took it away would leave nothing for the fresh one
  // to hang from. Everything else the box is made of goes below, after the
  // weapon's own merge.
  b.box("boxMount", METAL, 0.062, 0.022, 0.06, 0, -0.036, 0.02);

  // --- stock: solid, hollowed, with the shoulder rest under the butt ---
  b.box("stockNeck", POLYMER, 0.072, 0.09, 0.07, 0, 0.008, -0.325);
  b.box("stockBody", POLYMER, 0.066, STOCK_TOP + 0.03, 0.16, 0, (STOCK_TOP - 0.03) / 2, -0.4);
  // The lightening cut, which reads as a hollow because it is darker and a
  // hair proud — the same trick as the carbine's handle window.
  b.box("stockCut", BODY, 0.07, 0.05, 0.075, 0, 0.012, -0.395);
  b.box("stockCutBar", POLYMER, 0.072, 0.012, 0.016, 0, 0.012, -0.395);
  b.box("comb", RUBBER, 0.05, 0.012, 0.12, 0, STOCK_TOP - 0.006, -0.39);
  b.box("buttPlate", BODY, 0.072, 0.1, 0.02, 0, 0.005, -0.468);
  b.box("buttPad", RUBBER, 0.074, 0.094, 0.018, 0, 0.003, -0.485);
  for (let i = 0; i < 2; i++) {
    b.box("buttGroove", BODY, 0.076, 0.008, 0.02, 0, 0.03 - i * 0.03, -0.488);
  }
  // The folding shoulder rest, hanging under the butt — the part a gunner
  // clamps over the shoulder to hold the gun down through a long burst, and
  // one more thing on this weapon that only exists because it is fired in
  // bursts nobody else here can fire.
  b.pin("restPin", METAL, 0.012, 0.05, 0, -0.036, -0.44);
  b.box("shoulderRest", POLYMER, 0.048, 0.055, 0.016, 0, -0.062, -0.462);
  b.box("restPad", RUBBER, 0.05, 0.05, 0.008, 0, -0.062, -0.474);
  b.box("slingRear", METAL, 0.024, 0.03, 0.014, -0.04, -0.028, -0.43);

  // --- barrel: heavy, fluted, and quick-change ---
  // The latch is on the cover's left shoulder, where a hand that has just
  // thrown the cover open finds it. Well under RAIL_TOP: nothing forward of
  // the mount may stand above the rail.
  b.box("barrelLatch", METAL, 0.024, 0.05, 0.042, -0.03, 0.052, 0.3);
  b.box("barrelLatchTab", METAL, 0.03, 0.014, 0.016, -0.036, 0.07, 0.3);
  b.box("barrelCollar", BODY, 0.062, 0.062, 0.05, 0, 0.005, 0.325);
  b.tube("barrelRear", BODY, 0.048, 0.054, 0.08, 0, 0, 0.35);
  // Cooling flutes: rings a hair proud of the barrel, in the fittings tone, so
  // the heavy section reads as machined rather than as a thicker pipe.
  for (let i = 0; i < 6; i++) {
    b.tube("barrelFlute", METAL, 0.052, 0.052, 0.008, 0, 0, 0.33 + i * 0.028);
  }
  b.tube("barrel", BODY, 0.038, 0.046, 0.32, 0, 0, 0.5);
  b.tube("gasTube", METAL, 0.014, 0.014, 0.24, 0, 0.03, 0.43);
  b.box("gasBlock", BODY, 0.05, 0.054, 0.062, 0, 0.004, 0.55);
  // The regulator, under the block: the one part on any weapon here meant to
  // be turned during a fight, and a machine gun's answer to a fouled action.
  b.tube("gasReg", METAL, 0.028, 0.032, 0.052, 0, -0.03, 0.572);
  b.tube("gasRegCap", METAL, 0.02, 0.022, 0.012, 0, -0.03, 0.602);

  // Front sight tower: the bridge the cover's rail cannot make. Its top face
  // IS the rail — exactly RAIL_TOP, never above it (see the header).
  b.box("fsTower", BODY, 0.032, 0.078, 0.05, 0, 0.048, 0.5);
  b.box("fsTowerBrace", BODY, 0.028, 0.03, 0.09, 0, 0.02, 0.478);
  b.box("fsRail", BODY, 0.05, 0.014, 0.11, 0, 0.088, 0.49);
  for (let i = 0; i < 2; i++) {
    b.box("fsRailRib", METAL, 0.054, 0.012, 0.014, 0, 0.093, 0.455 + i * 0.07);
  }

  // --- handguard: a short heat shield under the barrel ---
  b.box("handguard", POLYMER, 0.058, 0.05, 0.2, 0, -0.045, 0.39);
  b.box("hgKeel", BODY, 0.032, 0.012, 0.18, 0, -0.072, 0.39);
  b.box("hgCap", BODY, 0.06, 0.052, 0.014, 0, -0.045, 0.297);
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < 4; i++) {
      b.box("vent", BODY, 0.005, 0.024, 0.016, side * 0.03, -0.045, 0.325 + i * 0.042);
    }
  }
  b.box("slingFront", METAL, 0.022, 0.026, 0.012, -0.034, -0.066, 0.31);

  // --- carry handle, folded down the barrel's left flank ---
  // On top of the barrel is where this belongs and where it may not go; see
  // the header. Hinged at the front so it folds BACK, which is also what keeps
  // its catch within reach of the hand already on the handguard.
  b.box("carryHinge", METAL, 0.03, 0.028, 0.032, -0.036, 0.018, 0.472);
  b.pin("carryPin", METAL, 0.012, 0.03, -0.036, 0.018, 0.472);
  b.box("carryBar", METAL, 0.014, 0.018, 0.2, -0.049, 0.018, 0.375);
  b.box("carryGrip", RUBBER, 0.02, 0.022, 0.11, -0.05, 0.018, 0.375);
  b.box("carryCatch", METAL, 0.018, 0.016, 0.022, -0.047, 0.018, 0.282);

  // --- bipod: folded back along the underside, feet trailing ---
  b.box("bipodYoke", METAL, 0.05, 0.032, 0.042, 0, -0.032, 0.6);
  b.pin("bipodPin", METAL, 0.012, 0.062, 0, -0.052, 0.6);
  for (const side of [-1, 1] as const) {
    b.box("bipodLeg", METAL, 0.013, 0.015, 0.175, side * 0.02, -0.078, 0.515);
    b.box("bipodFoot", RUBBER, 0.017, 0.019, 0.03, side * 0.02, -0.078, 0.418);
  }

  // --- muzzle: a flared cone, against three cages and a brake ---
  // The fourth muzzle device in the kit has to be a different SHAPE rather
  // than a fourth size, and a cone is the one the primitives give honestly:
  // `tube` takes a front and a rear diameter, so the flare is the part itself
  // rather than a stack of rings pretending to be one.
  b.tube("mzCollar", BODY, 0.05, 0.048, 0.022, 0, 0, 0.668);
  b.tube("mzCone", BODY, 0.058, 0.038, 0.1, 0, 0, 0.728);
  // Four slots down the cone, dark against it — what reads as a cut is
  // something darker in front of the gap, the same trick as the rifle's cage.
  for (const side of [-1, 1] as const) {
    b.box("mzSlot", RUBBER, 0.006, 0.03, 0.07, side * 0.024, 0, 0.725);
    b.box("mzSlotV", RUBBER, 0.03, 0.006, 0.07, 0, side * 0.024, 0.725);
  }
  b.shell("crown", METAL, 0.046, 0.007, 0.014, 0, 0.774, 12);
  // The bore: a dark disc proud of the cone's front face, so the muzzle is a
  // hole rather than a cap.
  b.tube("mzBore", RUBBER, 0.028, 0.028, 0.008, 0, 0, 0.779);

  // The LMG itself is finished. Merge it before any optic is built, so a
  // sight's parts can never end up inside the weapon's colour groups.
  const meshes = b.merge("lmg", root);

  // --- the box and its belt: a container, not a magazine ---
  // Wider than the receiver and half its depth again. This is the part that
  // makes the weapon read as bottom-heavy, and the reason the hip pose pushes
  // it further out than the rifle's.
  //
  // It is this weapon's `magazine`, merged into a node of its own so the
  // reload can drop it — and the BELT goes with it rather than staying behind,
  // because a belt is fed from the box it is coiled in. Swapping the container
  // and leaving a run of brass hanging out of the feed would be a reload that
  // loaded nothing.
  const magazine = new TransformNode(`${prefix}_magazine`, scene);
  magazine.parent = root;
  b.box("boxBody", POLYMER, 0.1, 0.145, 0.22, 0, -0.105, 0.09);
  b.box("boxLid", BODY, 0.104, 0.016, 0.2, 0, -0.038, 0.085);
  for (let i = 0; i < 3; i++) {
    b.box("boxRib", BODY, 0.104, 0.008, 0.212, 0, -0.068 - i * 0.036, 0.09);
  }
  b.box("boxLatch", METAL, 0.03, 0.032, 0.014, 0, -0.062, 0.198);
  b.box("boxHinge", METAL, 0.03, 0.012, 0.014, 0, -0.046, -0.018);
  b.box("boxFloor", METAL, 0.098, 0.012, 0.2, 0, -0.179, 0.09);
  // The chute the belt climbs out of, on the box's top left corner. Wide
  // enough that the belt is seen LEAVING something: a run of brass that starts
  // in mid-air beside the box is a decal on the receiver, not a feed.
  b.box("boxChute", BODY, 0.03, 0.042, 0.06, -0.05, -0.052, 0.034);
  b.box("boxChuteLip", METAL, 0.034, 0.009, 0.062, -0.051, -0.028, 0.034);
  // --- the belt: seven rounds and their links, up the outside of the gun ---
  // Pins ACROSS the weapon, so the flank the camera sees shows a stack of case
  // heads rather than a row of bullets. Two things are deliberately oversized
  // and both are legibility rather than calibre: the rounds are drawn nearer a
  // rifle round's proportions against a receiver half a real one's depth, and
  // they stand a full case-length PROUD of the flank. Flush and to scale, the
  // one feature this weapon is built around reads as a scratch in the paint.
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const y = -0.058 + t * 0.084;
    const z = 0.036 - t * 0.016;
    b.pin("beltRound", BRASS, 0.015, 0.056, -0.05, y, z, "x");
    b.pin("beltRim", BRASS, 0.019, 0.007, -0.076, y, z, "x");
    // The link between this round and the next, dark against the brass.
    if (i < 6) {
      b.box("beltLink", METAL, 0.034, 0.009, 0.017, -0.048, y + 0.007, z - 0.0013);
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
    muzzle: new Vector3(0, 0, 0.8),
    // Matches the `ejectPort` box above — the right side of the receiver. The
    // links leave underneath and are not modelled leaving: there is one brass
    // pool and it throws casings, which is what the eye reads at this range.
    ejectPort: new Vector3(0.05, 0.035, 0.06),
    grip: { hand: GRIP_HAND, elbow: GRIP_ELBOW },
    support: { hand: SUPPORT_HAND, elbow: SUPPORT_ELBOW },
    // No `magHand`: the shared offset takes the support hand back and down to
    // a magwell under the receiver, and this weapon's box is exactly there —
    // the hand lands on its rear underside, which is where you take hold of a
    // container you are about to unlatch and swing off.
    magazine,
    finish,
    sights: { kind: "fitted", assemblies: optics.sights },
    meshes,
  };
}
