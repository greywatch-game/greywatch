/**
 * RifleModel.ts — Builds the low-poly SCAR-pattern battle rifle from
 * primitives, and hangs the three fittable optics off its rail.
 * Returns WeaponParts: pose root, alignment landmarks (muzzle, ejection port,
 * the two grips) and the sight assemblies, of which exactly one is enabled.
 * Invariants: everything is assembled at the origin with the root at identity
 * and merged before it is moved — see `weaponKit.ts`, which owns that contract
 * along with the primitives this is written in. The optics are `optics.ts`'s,
 * shared with the SMG rather than duplicated here.
 */
import { Scene, TransformNode, Vector3 } from "@babylonjs/core";
import type { CelMaterialFactory } from "../shaders/CelShader";
import { buildOptics, type OpticMount } from "./optics";
import {
  BODY,
  METAL,
  magDropAxis,
  POLYMER,
  RUBBER,
  WeaponBuild,
  type WeaponParts,
} from "./weaponKit";

/** Top face of the receiver's rail — what every sight base stands on. */
const RAIL_TOP = 0.084;

/**
 * The magazine's rake, which is also the line it drops out along, and it is
 * NEGATIVE because a rifle magazine leans and curves toward the MUZZLE. The
 * cartridges in it are tapered, so the column they stack into bends away from
 * their bases — which is why every curved box magazine in service, STANAG and
 * AK alike, hangs forward of its well rather than back toward the stock. A
 * pivot's positive `rotX` sends everything below it backwards (see
 * `magDropAxis`), so forward is the minus sign here, and the same sign takes
 * the magazine out of the well down and FORWARD along its own body.
 */
const MAG_RAKE = -0.14;

/**
 * Where the rifle offers its rail. The iron stations are as far apart as the
 * receiver allows: the sight radius is what makes irons shootable, and the
 * front station rides the gas block at the far end of the top rail.
 */
const MOUNT: OpticMount = {
  railTop: RAIL_TOP,
  mountZ: 0.02,
  ironRearZ: -0.185,
  ironFrontZ: 0.53,
};

/** Where each hand grips, in rifle-local units. */
const GRIP_HAND = new Vector3(0.02, -0.16, -0.165);
const GRIP_ELBOW = new Vector3(0.26, -0.555, -0.535);
const SUPPORT_HAND = new Vector3(-0.02, -0.075, 0.4);
const SUPPORT_ELBOW = new Vector3(-0.3, -0.5, 0.12);

/**
 * Builds a low-poly cel-styled SCAR-pattern battle rifle with a rail optic.
 * Local +z is the barrel axis, origin at the receiver center.
 *
 * The silhouette follows the FN SCAR: one long stepped upper receiver carrying
 * a full-length top rail, an angular polymer lower with a flared magwell, a
 * vented handguard, a side-folding skeleton stock with a rounded cheek riser,
 * and a reciprocating charging handle on the left.
 *
 * All of it is static, so the ~150 parts are merged down to one mesh per color
 * once built. That keeps draw calls flat and — more importantly — keeps the
 * outline pass drawing one clean border per color group instead of wrapping
 * every screw and rail rib in its own black shell. Detail here is nearly free
 * for that reason: this is the one model always on screen, half a metre from
 * the lens, and it costs four draws however many boxes go into it.
 */
export function buildRifle(
  scene: Scene,
  mats: CelMaterialFactory,
  prefix: string,
): WeaponParts {
  const root = new TransformNode(`${prefix}_rifle`, scene);
  const b = new WeaponBuild(scene, mats, prefix, root);

  // --- upper receiver: one run from the stock hinge to the muzzle end, topped
  // by a continuous ribbed rail (the SCAR's defining line) ---
  // Two stacked slabs rather than one: the narrower top deck reads as the
  // receiver's chamfer, which a chamfer-shaped part could not do — additive
  // geometry can add a corner but never cut one off.
  b.box("upper", BODY, 0.082, 0.056, 0.8, 0, 0.028, 0.14);
  b.box("upperDeck", BODY, 0.068, 0.014, 0.8, 0, 0.063, 0.14);
  // Rail base stays receiver-dark so only the ribs catch light; an all-metal
  // rail reads as a bright stripe down the top of the gun at distance.
  b.box("rail", BODY, 0.058, 0.014, 0.8, 0, 0.077, 0.14);
  for (let i = 0; i < 10; i++) {
    b.box("railRib", METAL, 0.062, 0.012, 0.014, 0, 0.082, -0.22 + i * 0.075);
  }
  // Takedown pins, through the receiver and proud of it on both sides.
  b.pin("pinFront", METAL, 0.015, 0.088, 0, 0.014, 0.115);
  b.pin("pinRear", METAL, 0.015, 0.088, 0, 0.014, -0.185);
  b.box("ejectPort", METAL, 0.01, 0.032, 0.11, 0.045, 0.042, 0.06);
  // Dust cover hanging under the port, and the brass deflector behind it.
  b.box("portCover", METAL, 0.008, 0.026, 0.104, 0.047, 0.018, 0.058);
  b.box("deflector", BODY, 0.018, 0.03, 0.05, 0.046, 0.055, -0.03);

  // Reciprocating charging handle, left side, riding in its own slot.
  b.box("chSlot", POLYMER, 0.008, 0.016, 0.22, -0.043, 0.05, 0.16);
  b.box("chArm", METAL, 0.055, 0.016, 0.035, -0.072, 0.05, 0.22);
  b.box("chKnob", METAL, 0.022, 0.026, 0.05, -0.095, 0.05, 0.225);
  b.box("chLatch", METAL, 0.014, 0.014, 0.016, -0.095, 0.066, 0.213);

  // --- lower receiver: flared magwell, enlarged trigger guard, raked grip ---
  b.box("lower", POLYMER, 0.076, 0.095, 0.42, 0, -0.045, -0.06);
  b.box("magwell", POLYMER, 0.082, 0.085, 0.16, 0, -0.08, 0.06);
  // Flared lip at the mouth: the funnel is what a magwell is for, and without
  // it the well is a plain box the magazine happens to end inside.
  b.box("magFlareF", POLYMER, 0.088, 0.022, 0.014, 0, -0.114, 0.132);
  b.box("magFlareR", POLYMER, 0.088, 0.022, 0.014, 0, -0.114, -0.012);
  for (const side of [-1, 1] as const) {
    b.box("magFlareS", POLYMER, 0.008, 0.022, 0.152, side * 0.042, -0.114, 0.06);
  }
  b.box("magRelease", METAL, 0.012, 0.03, 0.03, 0.044, -0.055, -0.02);
  b.box("boltRelease", METAL, 0.012, 0.022, 0.05, -0.044, -0.05, -0.05);
  // Ambidextrous safety: a through-pin with a lever tab on each side.
  b.pin("safetyPin", METAL, 0.013, 0.088, 0, -0.03, -0.118);
  for (const side of [-1, 1] as const) {
    b.box("safetyLever", METAL, 0.012, 0.038, 0.014, side * 0.048, -0.046, -0.118);
  }
  b.box("guardFront", POLYMER, 0.05, 0.055, 0.018, 0, -0.125, -0.075);
  b.box("guardBottom", POLYMER, 0.05, 0.016, 0.1, 0, -0.15, -0.125);
  // Trigger, curved back toward the shooter across two raked segments.
  const trigPivot = b.pivot("trigPivot", 0, -0.105, -0.096, 0.4);
  b.box("trigger", METAL, 0.014, 0.032, 0.014, 0, -0.016, 0, trigPivot);
  b.box("triggerToe", METAL, 0.014, 0.024, 0.017, 0, -0.042, 0.008, trigPivot);

  // Raked back, and the SIGN is the whole of it: positive `rotX` sends
  // everything below the pivot BACKWARDS, which is the ~17 deg off vertical a
  // pistol grip stands at. Negative lays the toe out over the trigger guard,
  // which is not a rake at all — it is the grip on backwards. `PistolModel`'s
  // `GRIP_RAKE` carries the same note; every FIRING grip in the kit is this
  // sign, and every foregrip is its mirror — see the foregrip below.
  const gripPivot = b.pivot("gripPivot", 0, -0.1, -0.155, 0.3);
  b.box("grip", POLYMER, 0.056, 0.145, 0.078, 0, -0.07, 0, gripPivot);
  b.box("gripSwell", POLYMER, 0.061, 0.05, 0.07, 0, -0.052, -0.006, gripPivot);
  // Finger grooves, as proud ridges rather than cuts: three thin bands in the
  // lighter receiver tone, standing just past the grip's front face.
  for (let i = 0; i < 3; i++) {
    b.box("gripRib", BODY, 0.05, 0.011, 0.014, 0, -0.042 - i * 0.032, 0.036, gripPivot);
  }
  // Dark cap: a light one reads as a second magazine floorplate at a glance.
  b.box("gripCap", RUBBER, 0.058, 0.018, 0.082, 0, -0.15, 0, gripPivot);

  // --- side-folding skeleton stock: hinge block, split struts, cheek riser ---
  b.box("stockHinge", BODY, 0.078, 0.1, 0.07, 0, 0.015, -0.3);
  b.pin("hingePin", METAL, 0.02, 0.086, 0, 0.045, -0.3);
  b.box("stockLatch", METAL, 0.012, 0.03, 0.03, -0.046, -0.01, -0.3);
  b.box("slingLoop", METAL, 0.03, 0.05, 0.016, 0.045, 0.02, -0.3);
  b.box("stockTop", POLYMER, 0.058, 0.045, 0.22, 0, 0.055, -0.4);
  // Rounded cheek riser — the one part of the weapon a face actually rests on,
  // and the last place a square edge belongs.
  b.box("cheekBase", POLYMER, 0.05, 0.018, 0.15, 0, 0.079, -0.395);
  b.tube("cheekRiser", POLYMER, 0.046, 0.048, 0.15, 0, 0.092, -0.395);
  b.box("stockBottom", POLYMER, 0.055, 0.035, 0.2, 0, -0.055, -0.39);
  b.box("stockRear", POLYMER, 0.07, 0.2, 0.045, 0, 0.005, -0.495);
  b.box("slingRear", METAL, 0.026, 0.03, 0.014, -0.04, -0.03, -0.472);
  b.box("buttPad", RUBBER, 0.072, 0.075, 0.028, 0, -0.06, -0.505);
  for (let i = 0; i < 2; i++) {
    b.box("buttGroove", BODY, 0.074, 0.008, 0.02, 0, -0.042 - i * 0.03, -0.508);
  }

  // --- handguard: stepped tube with side vents and three-side rails ---
  b.box("handguard", POLYMER, 0.09, 0.056, 0.28, 0, -0.012, 0.4);
  b.box("hgTop", POLYMER, 0.07, 0.014, 0.28, 0, 0.023, 0.4);
  b.box("hgBottom", POLYMER, 0.07, 0.014, 0.28, 0, -0.047, 0.4);
  b.box("hgCap", BODY, 0.086, 0.07, 0.014, 0, -0.012, 0.533);
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < 3; i++) {
      b.box("vent", BODY, 0.006, 0.03, 0.045, side * 0.046, -0.012, 0.31 + i * 0.07);
    }
    b.box("sideRail", METAL, 0.014, 0.026, 0.2, side * 0.048, -0.038, 0.4);
  }
  // M-LOK slots along the underside, between the bottom rail and the vents.
  for (let i = 0; i < 3; i++) {
    b.box("mlok", BODY, 0.03, 0.006, 0.05, 0, -0.052, 0.31 + i * 0.07);
  }
  b.box("bottomRail", METAL, 0.05, 0.016, 0.2, 0, -0.058, 0.4);
  // Raked the OTHER way from the pistol grip, and that is the rule rather
  // than an inconsistency: a rake leans away from the wrist that holds it, so
  // the firing hand's grip puts its toe BACK and the support hand's puts its
  // toe FORWARD. That is what an angled foregrip is, and two grips leaning
  // apart is the silhouette; two leaning the same way reads as a mistake in
  // one of them.
  const foregripPivot = b.pivot("foregripPivot", 0, -0.046, 0.44, -0.45);
  b.box("foregrip", POLYMER, 0.048, 0.1, 0.055, 0, -0.05, 0, foregripPivot);
  b.box("foregripCap", RUBBER, 0.05, 0.016, 0.057, 0, -0.104, 0, foregripPivot);

  // --- barrel: gas block, exposed barrel, birdcage flash hider ---
  b.box("gasBlock", BODY, 0.052, 0.055, 0.07, 0, 0, 0.575);
  b.box("gasPort", METAL, 0.022, 0.014, 0.026, 0, 0.032, 0.575);
  b.tube("gasTube", METAL, 0.012, 0.012, 0.055, 0, 0.024, 0.552);
  b.tube("barrel", BODY, 0.036, 0.036, 0.13, 0, 0, 0.6);
  b.tube("barrelNut", METAL, 0.042, 0.042, 0.014, 0, 0, 0.652);
  // Birdcage: rear collar, four struts with the slots between them, open front
  // ring. `a0` is a half facet, so a slot rather than a strut sits at top dead
  // centre — which is where a muzzle device vents, to hold the barrel down.
  // The dark core is what the slots are cut against: without something behind
  // them they open onto the skybox and the cage reads as a smooth tube. Its
  // front face doubles as the bore, seen through the ring.
  b.tube("mzCollar", BODY, 0.05, 0.046, 0.022, 0, 0, 0.674);
  b.tube("mzCore", RUBBER, 0.03, 0.03, 0.058, 0, 0, 0.711);
  b.shell("mzStrut", BODY, 0.032, 0.009, 0.048, 0, 0.711, 4, Math.PI / 4, 0.5);
  // The bottom slot is webbed shut, the way a device that fights muzzle rise
  // vents everywhere but down.
  b.box("mzWeb", BODY, 0.021, 0.011, 0.048, 0, -0.0205, 0.711);
  b.shell("crown", METAL, 0.032, 0.011, 0.013, 0, 0.742, 10);

  // The rifle itself is finished. Merge it before any optic is built, so a
  // sight's parts can never end up inside the weapon's colour groups.
  const meshes = b.merge("rifle", root);

  // Curved STANAG magazine: two segments, the lower one kicked further out.
  // Both kicks carry `MAG_RAKE`'s sign, so the curve deepens the way the
  // magazine already leans — toward the muzzle — instead of doubling back on
  // itself. Built AFTER the weapon's own merge and merged into a node of its
  // own, so the reload can drop it out of the well — see `WeaponParts.magazine`.
  const magazine = new TransformNode(`${prefix}_magazine`, scene);
  magazine.parent = root;
  const magPivot = b.pivot("magPivot", 0, -0.115, 0.055, MAG_RAKE);
  b.box("magUpper", POLYMER, 0.058, 0.1, 0.105, 0, -0.05, 0, magPivot);
  b.box("magRibU", BODY, 0.061, 0.008, 0.108, 0, -0.04, 0, magPivot);
  const magLower = b.pivot("magLowerPivot", 0, -0.1, 0, -0.13, magPivot);
  b.box("magLower", POLYMER, 0.056, 0.085, 0.1, 0, -0.0425, 0, magLower);
  b.box("magRibL", BODY, 0.059, 0.008, 0.103, 0, -0.04, 0, magLower);
  b.box("magFloor", METAL, 0.062, 0.02, 0.108, 0, -0.095, 0, magLower);
  b.box("magBase", RUBBER, 0.058, 0.014, 0.1, 0, -0.11, 0, magLower);
  meshes.push(...b.merge("rifleMag", magazine));

  // Every colour group the WEAPON itself merged, taken before the optics are
  // built so a finish can never reach one — see `WeaponBuild.takeFinish`.
  const finish = b.takeFinish();

  const optics = buildOptics(b, MOUNT, prefix);
  meshes.push(...optics.meshes);
  b.disposePivots();

  return {
    root,
    muzzle: new Vector3(0, 0, 0.75),
    // Matches the `ejectPort` box above: brass leaves the right side of the
    // receiver, not the middle of the gun.
    ejectPort: new Vector3(0.05, 0.04, 0.06),
    grip: { hand: GRIP_HAND, elbow: GRIP_ELBOW },
    support: { hand: SUPPORT_HAND, elbow: SUPPORT_ELBOW },
    magazine,
    magDrop: magDropAxis(MAG_RAKE),
    finish,
    sights: { kind: "fitted", assemblies: optics.sights },
    meshes,
  };
}
