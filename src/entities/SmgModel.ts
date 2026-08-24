/**
 * SmgModel.ts — Builds the low-poly compact submachine gun from primitives,
 * and hangs the same three optics off its rail.
 * Returns WeaponParts, exactly as RifleModel does: the two are interchangeable
 * to everything above them, which is what lets `ViewModel` carry either one.
 * Invariants: assembled at the origin with the root at identity and merged
 * before it is moved — `weaponKit.ts` owns that contract and the primitives.
 * The optics are `optics.ts`'s, and land correctly on this weapon's lower rail
 * without a number being re-tuned because they are built against `MOUNT`.
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

/**
 * The magazine's rake, which is also the line it drops out along. NEGATIVE for
 * the reason the rifle's is: a box magazine leans toward the MUZZLE, and a
 * pivot's positive `rotX` sends everything below it backwards (see
 * `magDropAxis`). This one stands ahead of the trigger group rather than under
 * the receiver, so the lean is what keeps it a stick standing in a weapon
 * instead of a block bolted on at right angles.
 */
const MAG_RAKE = -0.1;

/**
 * Top face of the receiver's rail. Lower than the rifle's, because the whole
 * weapon is: a pistol-calibre bolt does not need the receiver depth a rifle
 * cartridge does, and the shallower it is the more of it disappears under the
 * optic — which is the silhouette an SMG reads by.
 */
const RAIL_TOP = 0.075;

/**
 * Where the SMG offers its rail. The iron stations are 0.4 apart against the
 * rifle's 0.715: a short sight radius is exactly what makes irons on a
 * close-quarters weapon less precise, and it falls out of the receiver's
 * length rather than being asserted anywhere.
 */
const MOUNT: OpticMount = {
  railTop: RAIL_TOP,
  mountZ: 0,
  ironRearZ: -0.14,
  ironFrontZ: 0.26,
};

/** Where each hand grips, in weapon-local units. */
const GRIP_HAND = new Vector3(0.02, -0.13, -0.16);
const GRIP_ELBOW = new Vector3(0.26, -0.5, -0.5);
const SUPPORT_HAND = new Vector3(-0.02, -0.08, 0.235);
const SUPPORT_ELBOW = new Vector3(-0.3, -0.48, 0.0);

/**
 * Builds a low-poly cel-styled compact SMG. Local +z is the barrel axis,
 * origin at the receiver center — the same frame the rifle is built in, so the
 * viewmodel poses either one with the same numbers.
 *
 * The silhouette is a stubby squared receiver with a full-width top rail, a
 * straight box magazine standing ahead of the trigger group, a short vented
 * handguard with a stubby vertical foregrip, and a two-strut retractable stock
 * that ends where the rifle's cheek riser starts. Everything about it is
 * shorter: the point of the weapon is that it swings between two targets in a
 * doorway, and the model has to say that before the stats do.
 *
 * ~90 parts, merged to one mesh per colour like the rifle. The merge is what
 * makes the detail free and what keeps the outline pass drawing one border per
 * colour group instead of a black shell around every rib.
 */
export function buildSmg(
  scene: Scene,
  mats: CelMaterialFactory,
  prefix: string,
): WeaponParts {
  const root = new TransformNode(`${prefix}_smg`, scene);
  const b = new WeaponBuild(scene, mats, prefix, root);

  // --- upper receiver: a squared shell from the stock block to the handguard,
  // with the rail running the whole way ---
  b.box("upper", BODY, 0.076, 0.052, 0.42, 0, 0.026, 0.06);
  b.box("upperDeck", BODY, 0.062, 0.012, 0.42, 0, 0.058, 0.06);
  b.box("rail", BODY, 0.052, 0.012, 0.42, 0, 0.069, 0.06);
  for (let i = 0; i < 7; i++) {
    b.box("railRib", METAL, 0.056, 0.011, 0.012, 0, 0.0735, -0.13 + i * 0.062);
  }
  // Ejection port and its deflector, right side. Small and high: a blowback
  // action throws its brass out of the top corner of the receiver.
  b.box("ejectPort", METAL, 0.008, 0.026, 0.088, 0.041, 0.036, 0.03);
  b.box("portCover", METAL, 0.007, 0.02, 0.084, 0.043, 0.016, 0.028);
  b.box("deflector", BODY, 0.016, 0.024, 0.04, 0.042, 0.048, -0.03);
  // Non-reciprocating charging handle, left side, on a short slot.
  b.box("chSlot", POLYMER, 0.007, 0.014, 0.16, -0.039, 0.042, 0.09);
  b.box("chArm", METAL, 0.046, 0.014, 0.03, -0.062, 0.042, 0.145);
  b.box("chKnob", METAL, 0.02, 0.022, 0.042, -0.08, 0.042, 0.15);
  // Sling loop on the receiver's shoulder — an SMG is carried, not shouldered.
  b.box("slingLoop", METAL, 0.026, 0.04, 0.014, 0.04, 0.02, -0.13);

  // --- lower receiver: trigger group, magwell, pistol grip ---
  b.box("lower", POLYMER, 0.072, 0.075, 0.3, 0, -0.04, -0.02);
  b.box("lowerStep", POLYMER, 0.066, 0.02, 0.28, 0, -0.082, -0.03);
  b.box("selector", METAL, 0.012, 0.026, 0.026, 0.04, -0.03, -0.115);
  for (const side of [-1, 1] as const) {
    b.box("pinBody", METAL, 0.008, 0.014, 0.014, side * 0.038, -0.02, 0.06);
  }
  b.box("guardFront", POLYMER, 0.046, 0.045, 0.016, 0, -0.1, -0.098);
  b.box("guardBottom", POLYMER, 0.046, 0.014, 0.085, 0, -0.122, -0.14);
  const trigPivot = b.pivot("trigPivot", 0, -0.085, -0.115, 0.35);
  b.box("trigger", METAL, 0.013, 0.03, 0.013, 0, -0.015, 0, trigPivot);
  b.box("triggerToe", METAL, 0.013, 0.022, 0.015, 0, -0.038, 0.007, trigPivot);

  // Pistol grip, raked back further than the rifle's: the weapon is held
  // rather than shouldered, and the wrist angle is what says so.
  const gripPivot = b.pivot("gripPivot", 0, -0.075, -0.17, -0.34);
  b.box("grip", POLYMER, 0.05, 0.13, 0.07, 0, -0.062, 0, gripPivot);
  b.box("gripSwell", POLYMER, 0.055, 0.045, 0.064, 0, -0.045, -0.005, gripPivot);
  for (let i = 0; i < 3; i++) {
    b.box("gripRib", BODY, 0.045, 0.01, 0.013, 0, -0.04 - i * 0.03, 0.032, gripPivot);
  }
  b.box("gripCap", RUBBER, 0.052, 0.016, 0.074, 0, -0.135, 0, gripPivot);

  // --- magazine: a straight stick standing ahead of the trigger group ---
  // This is the SMG's most legible line. A curved rifle magazine under the
  // receiver reads as a rifle however short you make the barrel; a straight
  // box in front of the hand reads as an SMG at a glance.
  b.box("magwell", POLYMER, 0.062, 0.06, 0.098, 0, -0.058, 0.042);
  b.box("magFlareF", POLYMER, 0.068, 0.018, 0.012, 0, -0.084, 0.086);
  b.box("magFlareR", POLYMER, 0.068, 0.018, 0.012, 0, -0.084, -0.002);
  b.box("magRelease", METAL, 0.012, 0.026, 0.026, 0.038, -0.048, -0.014);

  // --- handguard: a short vented sleeve with a stubby vertical foregrip ---
  b.box("handguard", POLYMER, 0.07, 0.05, 0.16, 0, -0.005, 0.2);
  b.box("hgTop", POLYMER, 0.056, 0.012, 0.16, 0, 0.026, 0.2);
  b.box("hgBottom", POLYMER, 0.056, 0.012, 0.16, 0, -0.036, 0.2);
  b.box("hgCap", BODY, 0.068, 0.058, 0.012, 0, -0.005, 0.276);
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < 3; i++) {
      b.box("vent", BODY, 0.005, 0.026, 0.032, side * 0.036, -0.005, 0.15 + i * 0.05);
    }
  }
  b.box("bottomRail", METAL, 0.044, 0.014, 0.12, 0, -0.046, 0.2);
  const foregripPivot = b.pivot("foregripPivot", 0, -0.04, 0.235, 0.38);
  b.box("foregrip", POLYMER, 0.042, 0.085, 0.05, 0, -0.044, 0, foregripPivot);
  b.box("foregripCap", RUBBER, 0.044, 0.014, 0.052, 0, -0.09, 0, foregripPivot);

  // --- retractable stock: two struts out of the receiver's back, a thin top
  // strap for a cheek, and a small butt plate ---
  b.box("stockBlock", BODY, 0.07, 0.07, 0.05, 0, 0.01, -0.175);
  for (const side of [-1, 1] as const) {
    b.tube("stockStrut", METAL, 0.018, 0.018, 0.16, side * 0.028, 0.005, -0.245);
  }
  b.box("stockStrap", POLYMER, 0.05, 0.014, 0.13, 0, 0.05, -0.25);
  b.box("stockLatch", METAL, 0.011, 0.026, 0.026, -0.04, 0.005, -0.2);
  b.box("buttPlate", POLYMER, 0.068, 0.088, 0.026, 0, 0.005, -0.33);
  b.box("buttPad", RUBBER, 0.07, 0.074, 0.016, 0, 0, -0.348);
  b.box("slingRear", METAL, 0.022, 0.026, 0.012, -0.034, -0.03, -0.318);

  // --- barrel: short, with a slotted flash hider ---
  b.tube("barrel", BODY, 0.03, 0.03, 0.14, 0, 0, 0.34);
  b.tube("barrelNut", METAL, 0.038, 0.038, 0.014, 0, 0, 0.283);
  // Same construction as the rifle's birdcage, three quarters the size: a
  // collar, four struts with the slots between them, a dark core behind them
  // so the slots are cut against something, and an open crown ring.
  b.tube("mzCollar", BODY, 0.042, 0.038, 0.018, 0, 0, 0.42);
  b.tube("mzCore", RUBBER, 0.026, 0.026, 0.05, 0, 0, 0.455);
  b.shell("mzStrut", BODY, 0.028, 0.008, 0.042, 0, 0.455, 4, Math.PI / 4, 0.5);
  b.box("mzWeb", BODY, 0.018, 0.01, 0.042, 0, -0.018, 0.455);
  b.shell("crown", METAL, 0.028, 0.009, 0.012, 0, 0.482, 10);

  const meshes = b.merge("smg", root);

  // The straight stick standing ahead of the trigger group, merged into a node
  // of its own so the reload can pull it out (see `WeaponParts.magazine`).
  const magazine = new TransformNode(`${prefix}_magazine`, scene);
  magazine.parent = root;
  const magPivot = b.pivot("magPivot", 0, -0.085, 0.045, MAG_RAKE);
  b.box("mag", POLYMER, 0.05, 0.2, 0.072, 0, -0.1, 0, magPivot);
  for (let i = 0; i < 3; i++) {
    b.box("magRib", BODY, 0.053, 0.007, 0.075, 0, -0.05 - i * 0.05, 0, magPivot);
  }
  b.box("magFloor", METAL, 0.054, 0.016, 0.076, 0, -0.198, 0, magPivot);
  b.box("magBase", RUBBER, 0.05, 0.012, 0.07, 0, -0.21, 0, magPivot);
  meshes.push(...b.merge("smgMag", magazine));

  // Every colour group the WEAPON itself merged, taken before the optics are
  // built so a finish can never reach one — see `WeaponBuild.takeFinish`.
  const finish = b.takeFinish();

  const optics = buildOptics(b, MOUNT, prefix);
  meshes.push(...optics.meshes);
  b.disposePivots();

  return {
    root,
    muzzle: new Vector3(0, 0, 0.5),
    ejectPort: new Vector3(0.046, 0.036, 0.03),
    grip: { hand: GRIP_HAND, elbow: GRIP_ELBOW },
    support: { hand: SUPPORT_HAND, elbow: SUPPORT_ELBOW },
    magazine,
    magDrop: magDropAxis(MAG_RAKE),
    finish,
    sights: { kind: "fitted", assemblies: optics.sights },
    meshes,
  };
}
