/**
 * CarbineModel.ts — Builds the low-poly bullpup burst carbine from primitives,
 * and hangs the same five optics off its rail.
 * Returns WeaponParts, exactly as the other three builders do: all of them are
 * interchangeable to everything above them, which is what lets `ViewModel`
 * carry any one.
 * Invariants: assembled at the origin with the root at identity and merged
 * before it is moved — `weaponKit.ts` owns that contract and the primitives.
 * The optics are `optics.ts`'s, built against `MOUNT` rather than re-tuned.
 */
import { Scene, TransformNode, Vector3 } from "@babylonjs/core";
import type { CelMaterialFactory } from "../shaders/CelShader";
import { buildOptics, type OpticMount } from "./optics";
import { BODY, METAL, POLYMER, RUBBER, WeaponBuild, type WeaponParts } from "./weaponKit";

/**
 * Top face of the rail. Between the DMR's and the rifle's, and high for a
 * weapon this short — a bullpup's action is under the shooter's cheek, so the
 * receiver is at its deepest exactly where the eye is, and the rail has to
 * clear it rather than the barrel.
 */
const RAIL_TOP = 0.086;

/**
 * Where the carbine offers its rail, and the one place the layout pays off in
 * numbers rather than in silhouette.
 *
 * The REAR station is what a bullpup buys: the receiver runs all the way to
 * the butt pad, so the aperture can sit at -0.28 where the rifle's stops at
 * -0.185 and there is still stock behind it. The front station is the one that
 * is bounded, and not by the optics for once — `optics.ts` would carry a
 * folded leaf out to about z = 0.51 here (the cone is kinder on this weapon
 * than on any other, since nothing forward of the mount stands as high as the
 * rail) — but by the rail itself, which stops at the gas block because past it
 * the barrel is exposed. That is the whole point of the layout: 0.60 of sight
 * radius out of a weapon 0.96 long, against the rifle's 0.715 out of 1.25.
 */
const MOUNT: OpticMount = {
  railTop: RAIL_TOP,
  mountZ: -0.02,
  ironRearZ: -0.28,
  ironFrontZ: 0.32,
};

/**
 * Where each hand grips, in weapon-local units. The trigger hand sits well
 * forward of the magazine — that is what a bullpup IS — and the support hand
 * is on the handguard, under the folded bipod.
 */
const GRIP_HAND = new Vector3(0.02, -0.123, -0.127);
const GRIP_ELBOW = new Vector3(0.26, -0.518, -0.497);
const SUPPORT_HAND = new Vector3(-0.02, -0.075, 0.2);
const SUPPORT_ELBOW = new Vector3(-0.3, -0.5, -0.08);

/**
 * Where the support hand goes for the magazine swap. Further BACK than any
 * other weapon here by a wide margin, and that is the layout again: the shared
 * `CONFIG.viewmodel.magHandOffset` takes the hand back and down to a magwell
 * under a receiver, and this weapon keeps its magazine behind the firing hand,
 * a full 0.45 back from where the support hand rests on the handguard. Applied
 * unchanged, the shared offset puts the hand on the trigger guard.
 */
const MAG_HAND = new Vector3(-0.02, -0.075, -0.45);

/**
 * Builds a low-poly cel-styled bullpup burst carbine. Local +z is the barrel
 * axis, origin at the receiver centre — the same frame the other three weapons
 * are built in, so the viewmodel poses any of them with the same numbers.
 *
 * **The layout is the argument, and it is the one thing the other three cannot
 * say.** They are all the same weapon at three sizes: a receiver, a magazine
 * under it, a grip behind that, a stock behind that. This one folds the action
 * into the stock and puts the magazine BEHIND the firing hand, which changes
 * every line on it at once — the grip stands alone at the front with nothing
 * under the barrel, the magazine is a block against the shoulder, the trigger
 * reaches its own mechanism through a linkage bar down the side, the brass
 * leaves at the cheek, and the top is one flat plane from butt pad to gas
 * block with no cheek riser, no folding hinge and no separate stock on it.
 * A player who cannot read a stat chart can tell it from the rifle in the dark.
 *
 * **The silhouette is the FAMAS's, and three features carry it**, each of them
 * something no other weapon in the kit has any reason to grow:
 *
 * - **The carry-handle blade.** A slab standing the full depth from the barrel
 *   to the underside of the rail, running from the receiver to a raked strut
 *   that drops onto the gas block — so the weapon is solid where every other
 *   one here is open, and the triangle of daylight under that strut is the one
 *   hole in it. It is also the whole of what the real handle can be: an optic's
 *   view cone spreads with distance and `RAIL_REACH` in `optics.ts` is the rule
 *   that falls out of it, so **nothing forward of the mount may stand above
 *   `RAIL_TOP`** — a bridge over the top would sit squarely in the middle of
 *   the scope's picture. The handle is therefore cut off at the sight line and
 *   the rail is its top face, which is exactly what the modern flat-top variant
 *   of this weapon did for the same reason.
 * - **The full-hand trigger guard.** A polymer loop from the grip's toe forward
 *   and up into the handguard, big enough for a gloved fist rather than a
 *   finger, and open at the sides so the hand shows through it. It is the one
 *   part of any weapon here that is drawn AROUND the viewmodel's own glove.
 * - **The folded bipod.** Two legs lying in a recess down the flanks of the
 *   handguard, hinged forward with the feet pointing back — which is what this
 *   weapon carries instead of the vertical foregrip a fourth model would
 *   otherwise have grown, and instead of the accessory rails the other three
 *   already wear.
 *
 * Three smaller things finish it: a long ringed muzzle with a bayonet lug under
 * it (against the round cages the rifle and SMG end in and the chambered brake
 * on the DMR), a butt whose underside rakes up to a short pad, and the
 * three-position selector standing where the thumb falls, which is the fire
 * mode itself made visible.
 *
 * ~120 parts, merged to one mesh per colour. The merge is what makes the
 * detail free and what keeps the outline pass drawing one border per colour
 * group instead of a black shell around every rib.
 */
export function buildCarbine(
  scene: Scene,
  mats: CelMaterialFactory,
  prefix: string,
): WeaponParts {
  const root = new TransformNode(`${prefix}_carbine`, scene);
  const b = new WeaponBuild(scene, mats, prefix, root);

  // --- the top plane: one rail from over the butt pad to the gas block ---
  // A bullpup's defining line seen from the side, and the reason there is no
  // cheek riser anywhere on this weapon: the rail IS the comb, and the face
  // rests against the pads on the shell below it. It is also the top face of
  // the carry handle below — see the header for why that handle has no bridge.
  b.box("rail", BODY, 0.056, 0.014, 0.67, 0, 0.079, 0.005);
  for (let i = 0; i < 8; i++) {
    b.box("railRib", METAL, 0.06, 0.012, 0.014, 0, 0.084, -0.28 + i * 0.075);
  }

  // --- the carry handle: a blade under the rail, from the receiver forward ---
  // Full depth from the barrel to the rail's underside, which is what makes the
  // weapon read as solid from the side. Nothing here may pass y = RAIL_TOP: the
  // whole blade lives in the space an optic's view cone has already cleared.
  b.box("handleBlade", BODY, 0.032, 0.086, 0.2, 0, 0.029, 0.16);
  // The lightening cut. It reads as a window because it is darker and a
  // hair proud, not because anything is hollow — the same trick as the
  // magazine's witness slots and the rifle's birdcage core.
  b.box("handleCut", POLYMER, 0.036, 0.046, 0.128, 0, 0.028, 0.156);
  b.box("handleCutBar", BODY, 0.038, 0.01, 0.014, 0, 0.028, 0.156);
  // The raked strut down onto the gas block, and the triangle of daylight it
  // leaves under the rail. The pivot is at the blade's front top corner, so the
  // strut's rear end tucks under the rail rather than through it.
  const rakePivot = b.pivot("rakePivot", 0, 0.024, 0.3, 0.6);
  b.box("handleRake", BODY, 0.032, 0.05, 0.135, 0, 0, 0, rakePivot);
  b.box("handleRakeCut", POLYMER, 0.036, 0.022, 0.08, 0, 0, 0, rakePivot);
  // The front sling loop, through the blade where the handle's own is.
  b.box("slingHandle", METAL, 0.026, 0.024, 0.012, -0.006, 0.03, 0.075);
  b.box("slingHandleEye", POLYMER, 0.03, 0.01, 0.014, -0.008, 0.03, 0.075);

  // --- the shell: one polymer clamshell from the butt to the handguard, with
  // the action inside it ---
  // Deep, because everything the rifle keeps in a receiver AND everything it
  // keeps in a stock is in here. The narrow top deck is the chamfer additive
  // geometry cannot cut, the same two-slab trick the rifle's upper uses.
  b.box("shell", POLYMER, 0.08, 0.115, 0.42, 0, 0.015, -0.1);
  b.box("shellDeck", BODY, 0.068, 0.014, 0.44, 0, 0.065, -0.11);
  // The clamshell seam, standing proud down both sides — a moulded weapon's
  // one honest line, and what stops the shell reading as a solid billet.
  for (const side of [-1, 1] as const) {
    b.box("seam", BODY, 0.006, 0.055, 0.4, side * 0.042, 0.01, -0.11);
    // Cheek pads: ambidextrous, because a bullpup's face is on the side of the
    // stock rather than on top of it. Kept well under the rail — anything
    // higher back here stands in the iron sight picture, which is the trap
    // `ironSightFloor` documents from the DMR's side.
    b.box("cheekPad", RUBBER, 0.006, 0.026, 0.14, side * 0.044, 0.03, -0.23);
  }

  // --- butt: the shell's own rear, with the underside raked up to a short pad ---
  // The toe rises rather than running square to the floor, which is what keeps
  // the back of the weapon from reading as a brick: the top line stays dead
  // flat all the way to the pad and the bottom line closes on it.
  b.box("shellRear", POLYMER, 0.08, 0.1025, 0.115, 0, 0.021, -0.3475);
  const toePivot = b.pivot("toePivot", 0, -0.0234, -0.35, 0.236);
  b.box("buttToe", POLYMER, 0.08, 0.014, 0.105, 0, 0, 0, toePivot);
  b.box("buttPlate", BODY, 0.078, 0.095, 0.02, 0, 0.026, -0.398);
  b.box("buttPad", RUBBER, 0.08, 0.088, 0.018, 0, 0.024, -0.415);
  for (let i = 0; i < 2; i++) {
    b.box("buttGroove", BODY, 0.082, 0.008, 0.02, 0, 0.05 - i * 0.03, -0.418);
  }
  b.box("slingRear", METAL, 0.024, 0.03, 0.014, -0.038, 0, -0.362);

  // --- ejection port: right side, at the cheek ---
  // Where a bullpup's brass has to leave, and half of why the other half of
  // the receiver is a blanking plate: the port is swapped for the plate to
  // shoot it left-handed. The deflector stands BEHIND the port rather than in
  // front of it, which is the one place on this weapon a part is doing the
  // opposite of its equivalent on the rifle — there is a face back there.
  b.box("ejectPort", METAL, 0.008, 0.03, 0.1, 0.042, 0.03, -0.16);
  b.box("portCover", METAL, 0.007, 0.022, 0.096, 0.044, 0.008, -0.162);
  b.box("deflector", BODY, 0.018, 0.028, 0.045, 0.043, 0.042, -0.225);
  b.box("portBlank", BODY, 0.006, 0.028, 0.096, -0.042, 0.03, -0.16);

  // Non-reciprocating charging handle. The original's rides the top centreline
  // inside the carry handle, which is the one place nothing may stand here —
  // that channel is the sight line — so it is carried on the left flank
  // instead, forward of the port where a bullpup's bolt carrier can be reached
  // without taking the face off the stock.
  b.box("chSlot", BODY, 0.006, 0.014, 0.16, -0.042, 0.045, 0.02);
  b.box("chArm", METAL, 0.04, 0.013, 0.026, -0.06, 0.045, 0.08);
  b.box("chKnob", METAL, 0.018, 0.02, 0.038, -0.076, 0.045, 0.085);

  // --- trigger group, inside a loop sized for the whole hand ---
  // The full-hand guard is the second of the three silhouette features, and it
  // is a BAND rather than a box: a front strap standing off the receiver, a
  // floor strap back into the grip's toe, and open flanks, so the viewmodel's
  // glove sits inside the loop with its knuckles showing through both sides.
  // Both straps are as thick as the grip is wide — a thin one reads as wire
  // bent round a hole rather than as the moulding this is part of, which is
  // the whole difference between a full-hand guard and a missing one.
  const guardPivot = b.pivot("guardPivot", 0, -0.12, 0.036, -0.06);
  b.box("guardFront", POLYMER, 0.05, 0.155, 0.026, 0, 0, 0, guardPivot);
  // The knuckle where the strap turns into the receiver's underside. Without
  // it the loop stops dead against a flat belly and reads as bolted on.
  b.box("guardKnuckle", POLYMER, 0.05, 0.034, 0.056, 0, -0.052, 0.042);
  b.box("guardFloor", POLYMER, 0.05, 0.022, 0.175, 0, -0.197, -0.0425);
  b.box("guardToe", POLYMER, 0.05, 0.03, 0.03, 0, -0.19, 0.036);
  const trigPivot = b.pivot("trigPivot", 0, -0.062, -0.075, 0.35);
  b.box("trigger", METAL, 0.013, 0.03, 0.013, 0, -0.015, 0, trigPivot);
  b.box("triggerToe", METAL, 0.013, 0.022, 0.015, 0, -0.038, 0.007, trigPivot);
  // The linkage bar: the trigger is a hand's length in front of the mechanism
  // it works, and this is the rod that crosses the gap. Nothing else in the
  // kit needs one, it runs down the side the camera actually sees (the weapon
  // is held to the right of the lens, so its LEFT flank is the one on screen),
  // and it is half-buried in its own channel so it reads as a mechanism rather
  // than as a stick glued to the gun.
  b.box("linkBar", METAL, 0.005, 0.012, 0.19, -0.041, -0.028, -0.16);
  b.pin("linkPinF", METAL, 0.008, 0.086, 0, -0.028, -0.07);
  b.pin("linkPinR", METAL, 0.008, 0.086, 0, -0.028, -0.25);

  // Three-position selector, above the grip where the firing thumb lands: the
  // fire mode as a part rather than as a line on the loadout screen.
  b.pin("selectorPin", METAL, 0.014, 0.086, 0, -0.03, -0.145);
  b.box("selectorLever", METAL, 0.01, 0.034, 0.012, -0.048, -0.02, -0.145, root, 0.5);
  for (let i = 0; i < 3; i++) {
    b.box("selectorMark", BODY, 0.004, 0.01, 0.006, -0.041, -0.008 - i * 0.014, -0.163);
  }

  // Raked back, shallower than the rifle's: the bullpup's grip stands ahead
  // of the magazine rather than behind it, so there is less room to lay it
  // over before the toe is out under the trigger. The sign is the rifle's and
  // the pistol's — see either — and the guard's floor strap is lengthened to
  // reach the toe where the rake now puts it, at the grip's FRONT face.
  const gripPivot = b.pivot("gripPivot", 0, -0.055, -0.12, 0.2);
  b.box("grip", POLYMER, 0.052, 0.132, 0.084, 0, -0.066, 0.002, gripPivot);
  b.box("gripSwell", POLYMER, 0.058, 0.05, 0.076, 0, -0.05, -0.002, gripPivot);
  for (let i = 0; i < 3; i++) {
    b.box("gripRib", BODY, 0.046, 0.01, 0.013, 0, -0.044 - i * 0.03, 0.04, gripPivot);
  }
  b.box("gripCap", RUBBER, 0.054, 0.016, 0.088, 0, -0.138, 0.002, gripPivot);

  // --- magazine: standing in the shell BEHIND the grip ---
  // The single most legible line on the weapon. Straight and vertical, with no
  // rake at all: a magazine that leans is a magazine feeding a receiver ahead
  // of it, and this one feeds straight up into the stock.
  b.box("magwell", POLYMER, 0.068, 0.06, 0.1, 0, -0.06, -0.235);
  b.box("magFlareF", POLYMER, 0.072, 0.016, 0.012, 0, -0.086, -0.19);
  b.box("magFlareR", POLYMER, 0.072, 0.016, 0.012, 0, -0.086, -0.28);
  // The release is at the BACK of the well, worked by the firing thumb — the
  // hand nearest it is the one on the grip, not the one on the handguard.
  b.box("magRelease", METAL, 0.03, 0.028, 0.012, 0, -0.05, -0.293);
  b.box("magLatch", METAL, 0.012, 0.02, 0.02, 0.032, -0.058, -0.288);

  // --- handguard: a narrow slab under the handle, slotted down both flanks ---
  // Narrower than the receiver behind it and hung off the same moulding, so the
  // shoulder where the two meet is the only step in the weapon's profile.
  b.box("handguard", POLYMER, 0.062, 0.06, 0.285, 0, -0.012, 0.2025);
  b.box("hgKeel", BODY, 0.032, 0.01, 0.25, 0, -0.045, 0.2);
  // The bipod recess: a darker channel down each flank, which is what the legs
  // lie in when they are folded and what makes them read as stowed rather than
  // as two rods taped to the gun.
  b.box("hgGroove", BODY, 0.07, 0.02, 0.25, 0, -0.004, 0.2);
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < 5; i++) {
      b.box("vent", BODY, 0.005, 0.026, 0.012, side * 0.032, -0.026, 0.115 + i * 0.045);
    }
    // The legs themselves, hinged FORWARD with the feet pointing back — folded,
    // that is the way round that keeps the toes clear of the support hand. They
    // stand proud of the recess rather than flush in it: flush, two rods the
    // colour of the rail read as one more accessory rail down the side.
    b.box("bipodHinge", METAL, 0.017, 0.026, 0.032, side * 0.036, -0.004, 0.318);
    b.box("bipodLeg", METAL, 0.011, 0.013, 0.195, side * 0.038, -0.004, 0.208);
    b.box("bipodFoot", RUBBER, 0.014, 0.017, 0.026, side * 0.038, -0.004, 0.102);
  }
  b.box("hgCap", BODY, 0.06, 0.056, 0.014, 0, -0.012, 0.348);
  b.box("slingFront", METAL, 0.022, 0.026, 0.012, -0.036, -0.032, 0.13);

  // --- barrel: short and exposed, ending in a long ringed muzzle ---
  b.box("gasBlock", BODY, 0.046, 0.05, 0.06, 0, 0, 0.378);
  b.box("gasPort", METAL, 0.02, 0.012, 0.024, 0, 0.03, 0.378);
  b.tube("barrel", BODY, 0.026, 0.03, 0.12, 0, 0, 0.462);
  b.tube("barrelNut", METAL, 0.036, 0.036, 0.012, 0, 0, 0.412);
  // The muzzle is LONG rather than square, and that is the point: the rifle and
  // the SMG both end in a round slotted cage and the DMR in a chambered brake,
  // so the fourth muzzle in the kit has to be a different proportion rather
  // than a fourth size. Two heavy rings around a slim body is the shape a
  // rifle-grenade spigot has, and the lug under it is the other half of that
  // story — the one weapon here that ends in something meant to carry a load.
  b.tube("mzBody", METAL, 0.03, 0.032, 0.07, 0, 0, 0.556);
  b.tube("mzRingR", METAL, 0.042, 0.042, 0.011, 0, 0, 0.528);
  b.tube("mzRingF", METAL, 0.04, 0.04, 0.011, 0, 0, 0.578);
  b.box("bayonetLug", METAL, 0.012, 0.018, 0.034, 0, -0.026, 0.512);
  // The mouth: a slotted ring over a dark core, the same trick as the rifle's
  // birdcage — what reads as a cut is really something darker behind the gap.
  b.tube("mzCore", RUBBER, 0.024, 0.024, 0.034, 0, 0, 0.588);
  b.shell("crown", METAL, 0.026, 0.007, 0.026, 0, 0.591, 8, 0, 0.72);

  // The carbine itself is finished. Merge it before any optic is built, so a
  // sight's parts can never end up inside the weapon's colour groups.
  const meshes = b.merge("carbine", root);

  // The magazine itself, merged into a node of its own so the reload can pull
  // it out of the shell (see `WeaponParts.magazine`). No rake, so it also
  // needs no `magDrop`: it leaves straight down, which is the way it stands.
  const magazine = new TransformNode(`${prefix}_magazine`, scene);
  magazine.parent = root;
  b.box("mag", POLYMER, 0.05, 0.13, 0.076, 0, -0.145, -0.235);
  for (let i = 0; i < 3; i++) {
    b.box("magRib", BODY, 0.053, 0.007, 0.078, 0, -0.11 - i * 0.04, -0.235);
    // Witness slots down the flank, so the block is a magazine rather than a
    // handle. They read as cuts because they are darker, not because they are.
    b.box("magSlot", BODY, 0.052, 0.014, 0.01, 0, -0.115 - i * 0.04, -0.198);
  }
  b.box("magFloor", METAL, 0.054, 0.014, 0.08, 0, -0.217, -0.235);
  b.box("magBase", RUBBER, 0.05, 0.012, 0.074, 0, -0.229, -0.235);
  meshes.push(...b.merge("carbineMag", magazine));

  // Every colour group the WEAPON itself merged, taken before the optics are
  // built so a finish can never reach one — see `WeaponBuild.takeFinish`.
  const finish = b.takeFinish();

  const optics = buildOptics(b, MOUNT, prefix);
  meshes.push(...optics.meshes);
  b.disposePivots();

  return {
    root,
    muzzle: new Vector3(0, 0, 0.6),
    // Matches the `ejectPort` box above: the right side of the shell, level
    // with the cheek. Brass past the ear is what a bullpup costs.
    ejectPort: new Vector3(0.046, 0.03, -0.16),
    grip: { hand: GRIP_HAND, elbow: GRIP_ELBOW },
    support: { hand: SUPPORT_HAND, elbow: SUPPORT_ELBOW },
    magHand: MAG_HAND,
    magazine,
    finish,
    sights: { kind: "fitted", assemblies: optics.sights },
    meshes,
  };
}
