/**
 * CarbineModel.ts — Builds the low-poly bullpup burst carbine from primitives,
 * and hangs the same optics off its rail.
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
import {
  BODY,
  METAL,
  POLYMER,
  RUBBER,
  WeaponBuild,
  magDropAxis,
  type WeaponParts,
} from "./weaponKit";

/**
 * Top face of the rail. Between the DMR's and the rifle's, and high for a
 * weapon this short — a bullpup's action is under the shooter's cheek, so the
 * receiver is at its deepest exactly where the eye is, and the rail has to
 * clear it rather than the barrel.
 */
const RAIL_TOP = 0.086;

/**
 * **The BORE, and this is the SECOND model here whose barrel axis is not
 * y = 0.** `SniperModel` is the precedent (`weaponKit.ts`'s `bolt` field states
 * the rule for it), and the reason is the same one: a barrel is screwed into a
 * CHAMBER, and the chamber is whatever the ejection port is cut into. Built on
 * the origin, this weapon's barrel ran 0.032 under the height its own
 * `ejectPort` landmark threw brass from — a bullpup ejecting out of somewhere
 * the rounds could never have been. **In a side view that is not a subtle
 * fault**: the port is the largest light-coloured thing on the flank and the
 * barrel is the longest straight line on the weapon, so the eye pairs them
 * whether or not it is told to.
 *
 * **Everything forward of the receiver is written against this and nothing is
 * written against zero** — the handguard, the gas block and regulator, the
 * barrel, every ring of the muzzle and the two landmarks `WeaponParts` hands
 * back. That is what keeps the port and the crown one decision.
 *
 * What it costs is sight height: `RAIL_TOP - BORE` is 0.066 now against 0.086,
 * which is the right direction anyway — every real weapon of this layout sits
 * between 0.055 and 0.070, and 0.086 was a rail on stilts.
 */
const BORE = 0.02;

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
 * The magazine's rake, and it is the sign the table in `docs/weapons.md` gives
 * every magazine in the kit: NEGATIVE, so the floor plate stands forward of the
 * feed lips. A bullpup does not change that — the chamber is above the well
 * either way — it only moves the whole well behind the firing hand.
 *
 * It is shallow because the well is short: this magazine is gripped by nothing
 * and indexed by the shell around it, where a rifle's is a handhold. Whatever
 * it is, `magDropAxis` has to read the same number or the magazine shears
 * through the front wall of its own well on the way out.
 */
const MAG_RAKE = -0.11;

/**
 * Where each hand grips, in weapon-local units. The trigger hand sits well
 * forward of the magazine — that is what a bullpup IS — and the support hand
 * is on the handguard, under the open bridge.
 *
 * **The DAYLIGHT between the firing hand and the magazine is the layout's only
 * evidence, so it is worth the 0.024 this grip was moved forward to get it.**
 * Photographed on the kit stage with the grip at -0.127 and the well at -0.235,
 * the two met flush at the bottom: what the turntable showed was a magazine
 * growing out of the front of the grip, which is a shape no rifle in the kit
 * has and no bullpup has either. The well went back 0.033 in the same pass —
 * the gap is 0.057 now, and it has to be spent from BOTH ends, because the
 * grip is bounded forward by the trigger reaching the guard's own floor and
 * the well is bounded aft by the butt plate.
 */
const GRIP_HAND = new Vector3(0.02, -0.123, -0.103);
const GRIP_ELBOW = new Vector3(0.26, -0.518, -0.473);
const SUPPORT_HAND = new Vector3(-0.02, -0.068, 0.2);
const SUPPORT_ELBOW = new Vector3(-0.3, -0.49, -0.08);

/**
 * Where the support hand goes for the magazine swap. Further BACK than any
 * other weapon here by a wide margin, and that is the layout again: the shared
 * `CONFIG.viewmodel.magHandOffset` takes the hand back and down to a magwell
 * under a receiver, and this weapon keeps its magazine behind the firing hand,
 * a full 0.47 back from where the support hand rests on the handguard. Applied
 * unchanged, the shared offset puts the hand on the trigger guard.
 *
 * It is an OFFSET from that rest and not a position (`ViewModel.poseReload`
 * blends it in from zero), so it has to move with the well: -0.47 off a support
 * hand at z = 0.2 lands on the magazine at -0.268, and the two are one number
 * written twice.
 */
const MAG_HAND = new Vector3(-0.02, -0.075, -0.47);

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
 * block with no cheek riser and no separate stock on it. A player who cannot
 * read a stat chart can tell it from the rifle in the dark.
 *
 * **The silhouette is a modern polymer bullpup's — `reference-media/bullpup.png`
 * — and three features carry it**, each of them something no other weapon in
 * the kit has any reason to grow:
 *
 * - **The open BRIDGE.** Forward of the receiver the rail is carried clear of
 *   the handguard on a spine a third of its width, with a long window of real
 *   daylight under it — the one hole through a weapon in this kit, and the
 *   thing that reads at any distance because what shows through it is the
 *   world rather than a darker shade of gun. It is also `RAIL_REACH` answered
 *   rather than paid for. The handle a bullpup wants is a TUNNEL with the
 *   sights inside it, and a tunnel is exactly what that rule forbids, since an
 *   optic's view cone spreads with distance and **nothing forward of the mount
 *   may stand above `RAIL_TOP`**. So the hole moves UNDER the sight line
 *   instead of around it: the rail is the bridge's top face, everything
 *   structural is below it, and the cone sees an unbroken flat deck.
 * - **The stock, which is the one butt in the kit with holes in it.** A rounded
 *   tube along the top — the comb, the buffer and the rear of the action in one
 *   moulding — over a skeletonised lower carrying a diamond void, and a hooked
 *   toe cut short of the magazine well so there is a notch under the butt as
 *   well as one through it. This is where a bullpup keeps all its volume, so it
 *   is the half worth spending parts on, and those two voids are what stop 0.23
 *   of unbroken polymer reading as a brick. Nothing back here may rise past
 *   `ironSightFloor`: the aperture's eye relief is over half a receiver's
 *   length, so the eye sits BEHIND the butt and the stock stands in the one
 *   part of the picture there is no looking around.
 * - **The stepped muzzle.** A knurled collar, then a slotted block wider than
 *   the barrel it is screwed to. The rifle and the SMG both end in a round
 *   slotted cage and the DMR in a chambered brake, so the fourth muzzle in the
 *   kit has to be a different PROPORTION rather than a fourth size — square
 *   against three round ones, and the only one that steps outward on its way to
 *   the crown.
 *
 * Three smaller things finish it: the receiver's own side window, a gas
 * regulator standing on the barrel where every other weapon here has a plain
 * block, and the ambidextrous ejection housing — fitted BOTH flanks, because a
 * bullpup has to be swappable to be shot off the other shoulder at all, and
 * because the flank the camera sees is the LEFT one (the weapon is held to the
 * right of the lens) and a blanking plate there would hide the most legible
 * thing on that side.
 *
 * **What is DARK is doing the work of a hole everywhere except the bridge**,
 * and the group ladder decides which colour that is: `BODY` is lighter than
 * `POLYMER` and `RUBBER` is darker than either, so a void in polymer is
 * `RUBBER` (the M-LOK slots, the stock's diamond, the receiver window, the
 * muzzle's bore) and a RAISED rib on polymer is `BODY` (the magazine's bands,
 * the grip's ribs). Get that the wrong way round and every slot on the weapon
 * reads as a strip of tape.
 *
 * ~140 parts, merged to one mesh per colour. The merge is what makes the
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

  // --- the top plane: one rail from over the stock to the gas block ---
  // A bullpup's defining line seen from the side, and the reason there is no
  // cheek riser anywhere on this weapon: the rail IS the comb, and the face
  // rests against the tube's own flanks below it. Its ribs are finer than any
  // other rail here (0.055 against the SMG's 0.062 and the rifle's 0.075),
  // which is the one way a short rail can still read as a long one.
  b.box("rail", BODY, 0.054, 0.01, 0.645, 0, 0.081, 0.0125);
  for (let i = 0; i < 12; i++) {
    b.box("railRib", METAL, 0.058, 0.012, 0.012, 0, 0.084, -0.28 + i * 0.055);
  }

  // --- the bridge: the rail carried on a spine, over open air ---
  // The signature, and the one place in the kit where a hole is a hole. The
  // bed is the rail's underside and the two posts are what stand it off the
  // handguard — the rear on the receiver, the front on the gas block — so the
  // window between them is bounded by geometry rather than drawn. Nothing here
  // may pass y = RAIL_TOP: the whole bridge lives in the space an optic's view
  // cone has already cleared, which is the entire reason it is under the rail
  // and not over it.
  //
  // **The bed and the rail together are 0.018 over the window where they were
  // 0.034**, which is the other half of raising the bore: a window loses from
  // the bottom whatever the barrel gains, so the only place to buy it back is
  // the lid. A spine deep enough to look structural closes the one hole the
  // weapon has.
  b.box("bridgeBed", BODY, 0.03, 0.008, 0.255, 0, 0.072, 0.2125);
  b.box("bridgePostR", BODY, 0.03, 0.032, 0.036, 0, 0.052, 0.115);
  b.box("bridgePostF", BODY, 0.03, 0.044, 0.032, 0, 0.05, 0.331);

  // --- upper receiver: the deck under the rail, and the window in its flank ---
  // Deep, because everything the rifle keeps in a receiver AND everything it
  // keeps in a stock is in here. The narrow top deck is the chamfer additive
  // geometry cannot cut, the same two-slab trick the rifle's upper uses.
  b.box("deck", BODY, 0.066, 0.02, 0.4, 0, 0.066, -0.1);
  b.box("upper", BODY, 0.072, 0.05, 0.4, 0, 0.031, -0.1);
  // The long cut in the receiver's side, above the bore where the reference
  // puts it. A void, so it is RUBBER rather than POLYMER — see the header's
  // ladder.
  b.box("upperWin", RUBBER, 0.078, 0.022, 0.165, 0, 0.04, -0.02);
  for (const side of [-1, 1] as const) {
    b.pin("recvScrew", METAL, 0.013, 0.008, side * 0.038, 0.038, -0.185);
    b.pin("recvScrewF", METAL, 0.013, 0.008, side * 0.038, 0.038, -0.095);
    b.box("badge", BODY, 0.006, 0.024, 0.048, side * 0.038, 0.03, -0.25);
  }
  // The takedown boss, forward of the stock where the shell splits.
  b.pin("takedown", METAL, 0.028, 0.01, -0.039, 0.028, -0.222);

  // --- lower receiver: the polymer half, from the stock to the handguard ---
  b.box("lower", POLYMER, 0.074, 0.058, 0.4, 0, -0.02, -0.1);
  b.box("lowerKeel", BODY, 0.03, 0.012, 0.34, 0, -0.052, -0.12);
  // The ambidextrous magazine paddle, raked forward off the well's front wall
  // and reachable from the grip. It hugs the well rather than reaching for the
  // grip: the gap between the two is the layout's evidence — see `GRIP_HAND` —
  // and a paddle spanning it would put the slab straight back.
  const paddlePivot = b.pivot("paddlePivot", 0, -0.045, -0.208, -0.5);
  for (const side of [-1, 1] as const) {
    b.box("magPaddle", POLYMER, 0.007, 0.036, 0.018, side * 0.039, -0.012, 0, paddlePivot);
  }

  // --- the stock: a rounded tube over a skeleton, and a hook for a toe ---
  // The tube's crown is only exposed BEHIND the rail (z < -0.30); forward of
  // that it ducks under the deck, which is what makes the top line read as one
  // unbroken plane from the butt pad to the gas block.
  b.box("stockTube", POLYMER, 0.068, 0.056, 0.192, 0, 0.036, -0.296);
  for (const side of [-1, 1] as const) {
    // Square chamfers turned 45 deg: a square is its own rotation, so the sign
    // does not matter and the part is never scaled non-uniformly.
    b.box("tubeCham", POLYMER, 0.018, 0.018, 0.192, side * 0.027, 0.06, -0.296, root, 0.785);
    b.box("cheekPad", RUBBER, 0.006, 0.026, 0.11, side * 0.035, 0.038, -0.3);
  }
  b.box("tubeCrown", POLYMER, 0.046, 0.014, 0.09, 0, 0.068, -0.347);
  b.box("tubeHole", RUBBER, 0.012, 0.008, 0.026, 0, 0.073, -0.34);
  b.pin("stockStud", METAL, 0.015, 0.012, -0.035, 0.046, -0.386);
  // The length-of-pull latch, under the tube on the flank the camera sees.
  b.box("lopLatch", METAL, 0.007, 0.018, 0.042, -0.033, 0, -0.31);

  // The skeleton under it, and the diamond that stops it reading as a brick. A
  // square turned 45 degrees about x — a pivot, because rotZ turns a part in
  // the plane the side view cannot see.
  //
  // **ONE hole, where the weapon it is drawn from has two.** The magazine well
  // takes the forward half of this frame, which leaves 0.09 of run behind it,
  // and two voids in 0.09 is a 7 mm strut between them — four pixels on the kit
  // stage and none at all in the hand. The reference's second cut is bought
  // back by the hook below, whose daylight is the same read from underneath.
  // It stops at the well's rear wall rather than running over it, which is what
  // leaves the magazine catch somewhere a thumb could reach: buried, the catch
  // and the release were two chips of the accent colour lying on the BUTT.
  b.box("stockFrame", POLYMER, 0.06, 0.08, 0.095, 0, -0.031, -0.3475);
  const cutPivot = b.pivot("cutPivot", 0, -0.031, -0.348, 0.785);
  b.box("stockCut", RUBBER, 0.064, 0.038, 0.038, 0, 0, 0, cutPivot);

  // --- butt: a padded plate with a rounded head, and a toe hung in open air ---
  // **The pad is as deep as everything in front of it and a hair deeper.** At
  // 0.126 against the tube-and-skeleton's 0.146 the weapon tapered to a sliver
  // at the shoulder, which is the one thing a bullpup's butt is not: all of its
  // mass is back here, and a pad that does not close the section says the
  // opposite of the whole layout.
  b.box("buttPlate", BODY, 0.062, 0.15, 0.016, 0, 0.002, -0.398);
  b.box("buttPad", RUBBER, 0.066, 0.144, 0.018, 0, 0.004, -0.415);
  const capPivot = b.pivot("capPivot", 0, 0.062, -0.412, -0.6);
  b.box("padCap", RUBBER, 0.066, 0.014, 0.028, 0, 0.006, 0, capPivot);
  for (let i = 0; i < 2; i++) {
    b.box("padRidge", BODY, 0.068, 0.007, 0.018, 0, 0.032 - i * 0.032, -0.416);
  }
  // The hook, and it is cut SHORT of the magazine well rather than run into it:
  // the notch between the two is the second void in the butt, and at full
  // length the toe simply closed the underside into one unbroken line from the
  // pad to the well.
  const toePivot = b.pivot("toePivot", 0, -0.066, -0.382, -0.5);
  b.box("stockToe", POLYMER, 0.052, 0.062, 0.03, 0, -0.028, 0, toePivot);
  b.box("stockHook", POLYMER, 0.052, 0.022, 0.038, 0, -0.05, 0.008, toePivot);

  // --- ejection housing: both flanks, at the cheek ---
  // Fitted either side because a bullpup that cannot be swapped cannot be
  // fired off the other shoulder; the brass leaves on the RIGHT, which is what
  // `ejectPort` below names. The deflector stands BEHIND the port rather than
  // in front of it, the one place on this weapon a part does the opposite of
  // its equivalent on the rifle — there is a face back there.
  // Two thin bars rather than one slab: the cover and the carrier's own track.
  // METAL is the kit's ACCENT group and the glossiest surface on any weapon
  // here, so a single panel this size photographed as a sticker — the sniper's
  // lesson in `docs/weapons.md`, at a tenth the area.
  // **The housing is centred on the BORE**, the cover just above it and the
  // carrier's track just below, because the chamber this is cut into is the
  // thing the barrel screws into. See `BORE`.
  for (const side of [-1, 1] as const) {
    b.box("portHousing", BODY, 0.01, 0.04, 0.125, side * 0.038, BORE + 0.002, -0.155);
    b.box("portCover", METAL, 0.008, 0.013, 0.102, side * 0.041, BORE + 0.008, -0.155);
    b.box("portTrack", METAL, 0.008, 0.008, 0.094, side * 0.041, BORE - 0.01, -0.157);
    b.pin("portCatch", METAL, 0.014, 0.008, side * 0.044, BORE + 0.008, -0.101);
    b.box("deflector", BODY, 0.016, 0.026, 0.04, side * 0.042, BORE + 0.016, -0.232);
  }

  // Non-reciprocating charging handle. The original's rides the top centreline
  // inside the carry handle, which is the one place nothing may stand here —
  // that channel is the sight line — so it is carried on the left flank
  // instead, forward of the port where a bullpup's bolt carrier can be reached
  // without taking the face off the stock.
  b.box("chSlot", RUBBER, 0.006, 0.014, 0.12, -0.037, BORE + 0.014, 0.03);
  b.box("chShoe", METAL, 0.013, 0.017, 0.05, -0.041, BORE + 0.014, 0.068);
  b.box("chWing", METAL, 0.03, 0.01, 0.032, -0.054, BORE + 0.014, 0.075);

  // --- trigger group, in a guard sized for a gloved finger ---
  // A plain loop: a front strap leaning forward off the receiver's underside,
  // a floor strap back into the grip's toe, and a knuckle where the strap turns
  // into the belly. Both straps are as thick as the grip is wide — a thin one
  // reads as wire bent round a hole rather than as the moulding this is part of.
  const guardPivot = b.pivot("guardPivot", 0, -0.1, 0.022, 0.14);
  b.box("guardFront", POLYMER, 0.044, 0.105, 0.02, 0, 0, 0, guardPivot);
  b.box("guardKnuckle", POLYMER, 0.046, 0.02, 0.04, 0, -0.047, 0.028);
  b.box("guardFloor", POLYMER, 0.044, 0.018, 0.1, 0, -0.152, -0.024);
  // The corner where the floor turns up into the front strap, raked so the
  // loop closes on an angle instead of a right angle.
  const guardBowPivot = b.pivot("guardBowPivot", 0, -0.148, 0.012, -0.7);
  b.box("guardBow", POLYMER, 0.044, 0.018, 0.034, 0, 0, 0, guardBowPivot);
  b.box("guardHeel", POLYMER, 0.044, 0.03, 0.03, 0, -0.145, -0.071);
  const trigPivot = b.pivot("trigPivot", 0, -0.062, -0.044, 0.35);
  b.box("trigger", METAL, 0.013, 0.03, 0.013, 0, -0.015, 0, trigPivot);
  b.box("triggerToe", METAL, 0.013, 0.022, 0.015, 0, -0.038, 0.007, trigPivot);
  // The linkage bar: the trigger is a hand's length in front of the mechanism
  // it works, and this is the rod that crosses the gap. Nothing else in the
  // kit needs one, it runs down the side the camera actually sees (the weapon
  // is held to the right of the lens, so its LEFT flank is the one on screen),
  // and it is half-buried in its own channel so it reads as a mechanism rather
  // than as a stick glued to the gun.
  b.box("linkBar", METAL, 0.005, 0.011, 0.15, -0.038, -0.042, -0.118);
  b.pin("linkPinF", METAL, 0.008, 0.086, 0, -0.042, -0.046);
  b.pin("linkPinR", METAL, 0.008, 0.086, 0, -0.042, -0.192);

  // Three-position selector, above the grip where the firing thumb lands: the
  // fire mode as a part rather than as a line on the loadout screen. A rotating
  // drum through the shell, so it is one part answering on both flanks.
  b.pin("selDrum", METAL, 0.026, 0.084, 0, -0.024, -0.094);
  b.box("selLever", METAL, 0.01, 0.03, 0.01, -0.046, -0.012, -0.094, root, 0.4);
  for (let i = 0; i < 3; i++) {
    b.box("selMark", BODY, 0.004, 0.009, 0.005, -0.041, -0.006 - i * 0.014, -0.119);
  }

  // Raked back, shallower than the rifle's: the bullpup's grip stands ahead
  // of the magazine rather than behind it, so there is less room to lay it
  // over before the toe is out under the trigger. The sign is the rifle's and
  // the pistol's — see either — and the guard's floor strap reaches the toe
  // where the rake now puts it, at the grip's FRONT face.
  const gripPivot = b.pivot("gripPivot", 0, -0.055, -0.096, 0.18);
  b.box("grip", POLYMER, 0.05, 0.138, 0.08, 0, -0.068, 0, gripPivot);
  b.box("gripSwell", POLYMER, 0.056, 0.046, 0.074, 0, -0.05, -0.002, gripPivot);
  // The beavertail: a tang swept back over the web of the hand, and the one
  // thing that stops the grip reading as a post stuck under the receiver.
  b.box("gripBeaver", POLYMER, 0.046, 0.03, 0.05, 0, -0.006, -0.04, gripPivot);
  for (let i = 0; i < 4; i++) {
    b.box("gripRibF", BODY, 0.044, 0.009, 0.012, 0, -0.048 - i * 0.026, 0.037, gripPivot);
    b.box("gripRibR", BODY, 0.044, 0.009, 0.012, 0, -0.056 - i * 0.026, -0.037, gripPivot);
  }
  b.box("gripToe", POLYMER, 0.052, 0.016, 0.026, 0, -0.132, 0.046, gripPivot);
  b.box("gripCap", RUBBER, 0.052, 0.014, 0.084, 0, -0.144, 0, gripPivot);

  // --- magazine well: standing in the shell BEHIND the grip ---
  // The single most legible line on the weapon, and the whole of what the
  // layout costs to read: a magazine the firing hand is in front of.
  b.box("magwell", POLYMER, 0.066, 0.052, 0.08, 0, -0.062, -0.268);
  b.box("magFlare", POLYMER, 0.07, 0.014, 0.092, 0, -0.086, -0.268);
  // The release is at the BACK of the well, worked by the firing thumb — the
  // hand nearest it is the one on the grip, not the one on the handguard.
  b.box("magRelease", BODY, 0.026, 0.022, 0.01, 0, -0.058, -0.297);
  for (const side of [-1, 1] as const) {
    b.box("magCatch", METAL, 0.01, 0.022, 0.012, side * 0.034, -0.06, -0.294);
  }

  // --- handguard: a slotted slab under the bridge ---
  // Narrower than the receiver behind it and hung off the same moulding, so the
  // shoulder where the two meet is the only step in the weapon's profile. The
  // slots are cut through the whole width, which is one part answering on both
  // flanks and is why they may be voids rather than painted-on channels.
  //
  // **It is DEEPER than the bore raise, not merely carried up with it.** A
  // handguard that keeps its distance under the barrel takes its belly up the
  // same 0.02, and the profile then steps a full two centimetres where it meets
  // the receiver — a shoulder the eye reads as a mistake rather than as the
  // width change the header claims. So the top follows the bore and the bottom
  // stays within 0.009 of the lower's.
  b.box("handguard", POLYMER, 0.06, 0.076, 0.25, 0, BORE - 0.022, 0.19);
  b.box("hgKeel", BODY, 0.03, 0.01, 0.23, 0, BORE - 0.063, 0.19);
  for (let i = 0; i < 3; i++) {
    b.box("hgSlot", RUBBER, 0.064, 0.011, 0.056, 0, BORE - 0.006, 0.105 + i * 0.072);
    b.box("hgTab", BODY, 0.062, 0.006, 0.026, 0, BORE - 0.021, 0.105 + i * 0.072);
  }
  for (let i = 0; i < 4; i++) {
    b.box("hgFoot", RUBBER, 0.02, 0.012, 0.012, 0, BORE - 0.058, 0.1 + i * 0.052);
  }
  // The nose: a block stepping down onto the barrel, with the raked face that
  // takes the handguard's depth out over about four centimetres.
  b.box("hgFront", POLYMER, 0.056, 0.066, 0.048, 0, BORE - 0.021, 0.335);
  const nosePivot = b.pivot("nosePivot", 0, BORE - 0.042, 0.32, -0.55);
  b.box("hgNose", POLYMER, 0.056, 0.016, 0.07, 0, 0, 0, nosePivot);
  b.pin("hgScrew", METAL, 0.016, 0.062, 0, BORE - 0.034, 0.3);
  b.box("slingFront", METAL, 0.02, 0.024, 0.012, -0.032, BORE - 0.048, 0.12);

  // --- barrel: short and exposed, with the regulator standing on the block ---
  b.box("gasBlock", BODY, 0.042, 0.048, 0.055, 0, BORE, 0.372);
  // The one weapon here that wears its gas system on the outside. It stands on
  // the barrel where every other model has a plain port, and its cap tops out
  // 0.021 under RAIL_TOP — a knob forward of the mount is exactly the shape the
  // scope's cone finds first, and raising the bore spent a third of the margin
  // this used to have.
  b.pin("gasReg", METAL, 0.026, 0.026, 0, BORE + 0.027, 0.362, "y");
  b.pin("gasRegCap", METAL, 0.031, 0.007, 0, BORE + 0.0415, 0.362, "y");
  b.tube("barrel", BODY, 0.024, 0.028, 0.115, 0, BORE, 0.457);
  b.tube("barrelNut", METAL, 0.034, 0.034, 0.01, 0, BORE, 0.405);

  // --- muzzle: a knurled collar into a slotted block ---
  // The fourth muzzle in the kit, and it is the one that is SQUARE: the rifle
  // and the SMG end in a round slotted cage and the DMR in a chambered brake,
  // so a fourth round cage would have been a fourth size rather than a fourth
  // weapon. It steps OUTWARD on the way to the crown, which is the other half
  // of the read — everything else here tapers in.
  b.tube("mzRingR", METAL, 0.032, 0.032, 0.008, 0, BORE, 0.52);
  b.tube("mzRingF", METAL, 0.032, 0.032, 0.008, 0, BORE, 0.532);
  b.tube("mzCollar", METAL, 0.036, 0.036, 0.022, 0, BORE, 0.552);
  for (let i = 0; i < 3; i++) {
    b.tube("mzKnurl", BODY, 0.038, 0.038, 0.004, 0, BORE, 0.545 + i * 0.007);
  }
  b.box("mzBody", METAL, 0.036, 0.034, 0.04, 0, BORE, 0.583);
  b.box("mzSlot", RUBBER, 0.04, 0.01, 0.03, 0, BORE - 0.007, 0.585);
  // The mouth: a slotted ring over a dark core, the same trick as the rifle's
  // birdcage — what reads as a cut is really something darker behind the gap.
  b.tube("mzCore", RUBBER, 0.022, 0.022, 0.03, 0, BORE, 0.588);
  b.shell("crown", METAL, 0.024, 0.006, 0.008, BORE, 0.601, 8, 0.39, 0.72);

  // The carbine itself is finished. Merge it before any optic is built, so a
  // sight's parts can never end up inside the weapon's colour groups.
  const meshes = b.merge("carbine", root);

  // The magazine itself, merged into a node of its own so the reload can pull
  // it out of the shell (see `WeaponParts.magazine`). Built on its own raking
  // pivot, so `magDrop` below has to read `MAG_RAKE` or it shears through the
  // front wall of the well on the way down.
  const magazine = new TransformNode(`${prefix}_magazine`, scene);
  magazine.parent = root;
  const magPivot = b.pivot("magPivot", 0, -0.078, -0.268, MAG_RAKE);
  b.box("mag", POLYMER, 0.048, 0.132, 0.072, 0, -0.072, 0, magPivot);
  // The panel ribs: RAISED rather than cut, so they are BODY — one step
  // LIGHTER than the polymer they stand on. See the header's ladder.
  //
  // **Bands only, and the vertical ribs that crossed them are gone.** They made
  // a GRID, and a grid of the accent colour on a part this size photographed as
  // netting laid over the magazine rather than as moulding in it — four bands
  // say the same thing about a polymer magazine and say it at arm's length.
  for (let i = 0; i < 4; i++) {
    b.box("magBand", BODY, 0.051, 0.007, 0.074, 0, -0.03 - i * 0.032, 0, magPivot);
  }
  b.box("magSpine", BODY, 0.05, 0.128, 0.008, 0, -0.072, -0.034, magPivot);
  b.box("magGrip", BODY, 0.052, 0.02, 0.03, 0, -0.128, -0.014, magPivot);
  // The floor plate is BODY and not METAL: a moulded magazine's base is part of
  // the magazine, and in the accent group it read as a white cap on a weapon
  // whose whole bottom edge the eye already follows.
  b.box("magFloor", BODY, 0.052, 0.012, 0.076, 0, -0.144, 0, magPivot);
  b.box("magBase", RUBBER, 0.048, 0.012, 0.07, 0, -0.154, 0, magPivot);
  meshes.push(...b.merge("carbineMag", magazine));

  // Every colour group the WEAPON itself merged, taken before the optics are
  // built so a finish can never reach one — see `WeaponBuild.takeFinish`.
  const finish = b.takeFinish();

  const optics = buildOptics(b, MOUNT, prefix);
  meshes.push(...optics.meshes);
  b.disposePivots();

  return {
    root,
    // Both landmarks are on the BORE, which is what makes the flash and the
    // brass one claim about where the chamber is — see `BORE`.
    muzzle: new Vector3(0, BORE, 0.6),
    // Matches the `portCover` boxes above: the right side of the shell, level
    // with the cheek. Brass past the ear is what a bullpup costs.
    ejectPort: new Vector3(0.046, BORE + 0.008, -0.155),
    grip: { hand: GRIP_HAND, elbow: GRIP_ELBOW },
    support: { hand: SUPPORT_HAND, elbow: SUPPORT_ELBOW },
    magHand: MAG_HAND,
    magazine,
    magDrop: magDropAxis(MAG_RAKE),
    finish,
    sights: { kind: "fitted", assemblies: optics.sights },
    meshes,
  };
}
