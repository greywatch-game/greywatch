/**
 * SmgModel.ts — Builds the submachine gun, a SIG MPX drawn from photographs,
 * and hangs the same optics off its rail.
 * Returns WeaponParts, exactly as RifleModel does: the builders are
 * interchangeable to everything above them, which is what lets `ViewModel`
 * carry any one.
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
  spanRing,
  WeaponBuild,
  type WeaponParts,
} from "./weaponKit";

/**
 * The magazine's rake, which is also the line it drops out along. NEGATIVE for
 * the reason the rifle's is: a box magazine leans toward the MUZZLE, and a
 * pivot's positive `rotX` sends everything below it backwards (see
 * `magDropAxis`). The MPX's 9mm magazine also curves gently forward along its
 * length, which the loft's sections carry on top of this.
 */
const MAG_RAKE = -0.1;

/**
 * Top face of the receiver's rail. Lower than the rifle's, because the whole
 * weapon is: a pistol-calibre bolt does not need the receiver depth a rifle
 * cartridge does, and the shallower it is the more of it disappears under the
 * optic — which is the silhouette an SMG reads by.
 */
const RAIL_TOP = 0.075;

/** Where the upper's flat top stops and the rail's spine starts. */
const DECK = 0.062;

/**
 * Height of the bore above the origin: the middle of the upper receiver, and
 * level with the bottom of the ejection port. The handguard is a sleeve over
 * the barrel, so it is written against this too.
 */
const BORE_Y = 0.026;

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
const GRIP_HAND = new Vector3(0.02, -0.124, -0.197);
const GRIP_ELBOW = new Vector3(0.26, -0.494, -0.537);
const SUPPORT_HAND = new Vector3(-0.02, -0.08 + BORE_Y, 0.235);
const SUPPORT_ELBOW = new Vector3(-0.3, -0.48 + BORE_Y, 0.0);

/**
 * Builds a cel-styled SIG MPX. Local +z is the barrel axis, origin at the
 * receiver centre — the same frame the rifle is built in, so the viewmodel
 * poses either one with the same numbers — with the bore `BORE_Y` above it.
 *
 * It is an AR-pattern 9mm, which is what the silhouette has to say before the
 * stats do: a flat-top aluminium upper whose rail runs unbroken onto a slim
 * M-LOK handguard, a lower with a long flared magwell standing AHEAD of an
 * integral trigger guard, a slim gently-curved pistol-calibre magazine, SIG's
 * minimalist folding stock — one long skeletonised arm to a tall raked butt,
 * drawn from `reference-media/smg.png` — an AR T-handle at the back of the
 * upper, and a three-prong flash hider on a short barrel. Everything about it is SLIMMER
 * than the rifle as well as shorter — a 9mm magazine is half the depth of a
 * 7.62 one, and drawn at a rifle magazine's size it was the part that made
 * this read as a toy.
 *
 * Built as the rifle is — bevelled profile slabs and contoured lofts, detail at
 * its real scale, controls small and dark, machining as dark inlays — see
 * `docs/weapons.md`'s procedural-models section.
 */
export function buildSmg(
  scene: Scene,
  mats: CelMaterialFactory,
  prefix: string,
): WeaponParts {
  const root = new TransformNode(`${prefix}_smg`, scene);
  const b = new WeaponBuild(scene, mats, prefix, root);

  // --- upper receiver: an AR flat-top, and the rail over it and the
  // handguard in one unbroken run ---
  b.slab("upper", BODY, [
    [-0.175, -0.004],
    [0.105, -0.004],
    [0.105, 0.056],
    [0.099, DECK],
    [-0.169, DECK],
    [-0.175, 0.056],
  ], 0.064, 0.004);
  b.picatinny("rail", 0, DECK, -0.16, 28, { width: 0.05, height: RAIL_TOP - DECK });
  // Ejection port on the right, with the dust cover swung down under it and
  // the brass deflector swept back behind it — the AR's own furniture.
  b.slab("ejectPort", RUBBER, [
    [-0.05, 0.02],
    [0.035, 0.02],
    [0.035, 0.045],
    [-0.05, 0.045],
  ], 0.003, 0, 0.0325);
  b.box("portCover", BODY, 0.003, 0.012, 0.08, 0.035, 0.012, -0.008);
  b.slab("deflector", BODY, [
    [-0.09, 0.024],
    [-0.056, 0.024],
    [-0.056, 0.03],
    [-0.068, 0.05],
    [-0.09, 0.05],
  ], 0.01, 0.002, 0.036);
  // The T-handle at the back of the upper, its latch on the left.
  b.slab("chHandle", POLYMER, [
    [-0.19, 0.036],
    [-0.175, 0.036],
    [-0.175, 0.056],
    [-0.19, 0.056],
  ], 0.058, 0.003);
  b.box("chLatch", POLYMER, 0.008, 0.012, 0.014, -0.032, 0.046, -0.186);
  // Takedown pins through the upper and lower, at both ends of the lower.
  b.pin("pinFront", METAL, 0.008, 0.07, 0, -0.008, 0.09);
  b.pin("pinRear", METAL, 0.008, 0.07, 0, -0.008, -0.158);

  // --- handguard: slim, free-floated, running almost to the flash hider the
  // way the MPX's does — a spindle of bare barrel was the old model's tell —
  // chamfered hard so its section reads as
  // the octagon it is from the front, with M-LOK slots down each flank ---
  b.slab("handguard", POLYMER, [
    [0.1, DECK],
    [0.4, DECK],
    [0.406, 0.054],
    [0.406, -0.014],
    [0.398, -0.022],
    [0.1, -0.022],
  ], 0.06, 0.011);
  for (let i = 0; i < 6; i++) {
    const zc = 0.135 + i * 0.047;
    b.slab("mlok", RUBBER, [
      [zc - 0.017, 0.02],
      [zc - 0.013, 0.015],
      [zc + 0.013, 0.015],
      [zc + 0.017, 0.02],
      [zc + 0.013, 0.025],
      [zc - 0.013, 0.025],
    ], 0.062, 0);
  }
  b.picatinny("bottomRail", 0, -0.022, 0.199, 5, {
    width: 0.036,
    height: 0.008,
    pitch: 0.018,
    facing: "down",
  });
  b.pin("hgScrew", METAL, 0.007, 0.062, 0, 0.004, 0.115);
  // Toe FORWARD — the support grip's sign, which is the firing grip's
  // inverted. See the rifle's foregrip for why the two lean apart. Slim and
  // ribbed, clamped to the short bottom rail.
  const foregripPivot = b.pivot("foregripPivot", 0, -0.03, 0.235, -0.2);
  b.box("foregripClamp", POLYMER, 0.042, 0.01, 0.042, 0, -0.002, 0, foregripPivot);
  b.upright("foregrip", POLYMER, [
    spanRing(-0.082, 0.034, 0.018, -0.018, 0.45),
    spanRing(0.0, 0.03, 0.016, -0.016, 0.45),
  ], foregripPivot);
  for (let i = 0; i < 3; i++) {
    const y = -0.022 - i * 0.017;
    b.upright("foregripRib", POLYMER, [
      spanRing(y - 0.0025, 0.035, 0.019, -0.019, 0.45),
      spanRing(y + 0.0025, 0.035, 0.019, -0.019, 0.45),
    ], foregripPivot);
  }
  b.upright("foregripCap", RUBBER, [
    spanRing(-0.093, 0.037, 0.02, -0.02, 0.45),
    spanRing(-0.08, 0.037, 0.02, -0.02, 0.45),
  ], foregripPivot);

  // --- lower receiver: the AR lower. The magwell stands AHEAD of the guard,
  // long and flared at its mouth, which is the one line that says this is a
  // carbine-pattern SMG rather than a pistol with a stock ---
  b.slab("lower", POLYMER, [
    [-0.172, -0.002],
    [0.1, -0.002],
    [0.1, -0.018],
    [0.094, -0.03],
    [0.097, -0.098],
    [0.09, -0.106],
    [0.0, -0.106],
    [-0.008, -0.098],
    [-0.012, -0.06],
    [-0.14, -0.06],
    [-0.16, -0.05],
    [-0.172, -0.03],
  ], 0.058, 0.005);
  b.slab("magwellLip", POLYMER, [
    [-0.004, -0.11],
    [0.098, -0.11],
    [0.094, -0.096],
    [-0.006, -0.096],
  ], 0.064, 0.003);
  // Small, dark controls: the release behind the well on the right, the bolt
  // catch on the left, and the ambidextrous selector over the grip.
  b.box("magRelease", POLYMER, 0.005, 0.012, 0.012, 0.031, -0.05, -0.02);
  b.box("boltCatch", POLYMER, 0.005, 0.012, 0.026, -0.031, -0.036, -0.03);
  b.pin("selPin", METAL, 0.009, 0.064, 0, -0.03, -0.13);
  for (const side of [-1, 1] as const) {
    b.box("selLever", METAL, 0.004, 0.02, 0.008, side * 0.033, -0.022, -0.13);
  }
  // The maker's roll mark on the left of the magwell.
  b.slab("plate", BODY, [
    [0.012, -0.05],
    [0.08, -0.05],
    [0.08, -0.07],
    [0.012, -0.07],
  ], 0.003, 0, -0.0295);
  for (const [y, len] of [[-0.056, 0.05], [-0.063, 0.034]] as const) {
    b.box("stamp", RUBBER, 0.002, 0.0026, len, -0.031, y, 0.018 + len / 2);
  }
  // The guard, integral and enlarged: a U from the back of the well, under
  // the trigger and into the grip's front face.
  b.slab("guard", POLYMER, [
    [-0.01, -0.058],
    [-0.01, -0.096],
    [-0.02, -0.106],
    [-0.152, -0.108],
    [-0.152, -0.098],
    [-0.024, -0.096],
    [-0.02, -0.092],
    [-0.02, -0.058],
  ], 0.02, 0.002);
  b.slab("trigger", METAL, [
    [-0.12, -0.058],
    [-0.111, -0.058],
    [-0.113, -0.074],
    [-0.113, -0.084],
    [-0.108, -0.092],
    [-0.106, -0.096],
    [-0.112, -0.094],
    [-0.118, -0.086],
    [-0.12, -0.074],
  ], 0.008, 0.001);

  // Pistol grip, raked back further than the rifle's: the weapon is held
  // rather than shouldered, and the wrist angle is what says so. The sign is
  // the rifle's — positive lays the toe BACK, which is the only way round a
  // grip goes. SIG's grip: a single finger swell and textured flanks.
  const gripPivot = b.pivot("gripPivot", 0, -0.075, -0.17, 0.34);
  b.upright("grip", POLYMER, [
    spanRing(-0.13, 0.046, 0.031, -0.034),
    spanRing(-0.1, 0.048, 0.029, -0.037),
    spanRing(-0.068, 0.05, 0.028, -0.039),
    spanRing(-0.05, 0.05, 0.034, -0.04),
    spanRing(-0.032, 0.05, 0.028, -0.041),
    spanRing(-0.005, 0.048, 0.031, -0.042),
    spanRing(0.018, 0.044, 0.032, -0.036),
  ], gripPivot);
  b.slab("gripPanel", POLYMER, [
    [-0.028, -0.118],
    [0.012, -0.118],
    [0.018, -0.11],
    [0.018, -0.024],
    [0.012, -0.016],
    [-0.028, -0.016],
    [-0.034, -0.024],
    [-0.034, -0.11],
  ], 0.053, 0.002, 0, gripPivot);
  for (let i = 0; i < 6; i++) {
    b.box("gripStipple", POLYMER, 0.055, 0.0026, 0.036, 0, -0.03 - i * 0.015, -0.008, gripPivot);
  }
  b.upright("gripCap", RUBBER, [
    spanRing(-0.142, 0.046, 0.031, -0.034),
    spanRing(-0.128, 0.047, 0.032, -0.035),
  ], gripPivot);

  // --- SIG's minimalist folding stock (`reference-media/smg.png`): a hinge
  // block on the back of the upper, one flat skeletonised arm running straight
  // back level with the upper's flat, and a tall raked butt plate ---
  // It is as long as the receiver and handguard together, which is what the
  // photograph shows and what a short stock of a rifle's proportions was not:
  // the arm is thin, so its LENGTH is the only way it has of reading as a stock.
  b.slab("stockHinge", BODY, [
    [-0.172, 0.05],
    [-0.21, 0.05],
    [-0.216, 0.042],
    [-0.216, -0.03],
    [-0.21, -0.038],
    [-0.172, -0.038],
  ], 0.05, 0.004);
  b.pin("hingePin", METAL, 0.01, 0.054, 0, 0.038, -0.206, "y");
  b.box("foldLatch", POLYMER, 0.012, 0.016, 0.012, -0.028, -0.02, -0.2);
  // The arm: a flat bar on edge, cut through with four long slots. Built as
  // two strips and the posts between them, so the slots are real holes the
  // world shows through rather than dark paint on a plank.
  const ARM_TOP = 0.034;
  const ARM_BOT = 0.006;
  const STRIP = 0.009;
  const ARM_W = 0.014;
  const armFront = -0.214;
  const armRear = -0.525;
  for (const [y0, y1] of [
    [ARM_TOP - STRIP, ARM_TOP],
    [ARM_BOT, ARM_BOT + STRIP],
  ] as const) {
    b.slab("stockArm", POLYMER, [
      [armFront, y0],
      [armRear, y0],
      [armRear, y1],
      [armFront, y1],
    ], ARM_W, 0.002);
  }
  const slots = [-0.238, -0.305, -0.372, -0.439];
  const slotLen = 0.055;
  const posts: Array<readonly [number, number]> = [[armFront, slots[0]]];
  for (let i = 0; i < slots.length; i++) {
    const end = slots[i] - slotLen;
    posts.push([end, i + 1 < slots.length ? slots[i + 1] : armRear]);
  }
  for (const [z0, z1] of posts) {
    b.slab("stockPost", POLYMER, [
      [z0, ARM_BOT + STRIP - 0.001],
      [z1, ARM_BOT + STRIP - 0.001],
      [z1, ARM_TOP - STRIP + 0.001],
      [z0, ARM_TOP - STRIP + 0.001],
    ], ARM_W, 0.001);
  }
  // The butt: a tall plate raked forward at the toe, the arm running into the
  // top of its front face.
  b.slab("buttPlate", POLYMER, [
    [-0.488, ARM_TOP + 0.002],
    [-0.566, ARM_TOP + 0.004],
    [-0.574, ARM_TOP - 0.004],
    [-0.556, -0.132],
    [-0.548, -0.14],
    [-0.53, -0.14],
    [-0.522, -0.132],
    [-0.504, -0.03],
    [-0.488, ARM_BOT - 0.004],
  ], 0.044, 0.004);
  // Its teardrop cut and the round sling hole above it, dark the way a void
  // is everywhere on these weapons but where the world can show through.
  b.slab("buttCut", RUBBER, [
    [-0.524, -0.026],
    [-0.552, -0.03],
    [-0.553, -0.112],
    [-0.545, -0.122],
    [-0.535, -0.116],
    [-0.517, -0.046],
  ], 0.046, 0);
  b.pin("buttQD", RUBBER, 0.012, 0.046, 0, -0.01, -0.504);
  b.slab("buttPad", RUBBER, [
    [-0.573, ARM_TOP + 0.002],
    [-0.583, ARM_TOP],
    [-0.566, -0.138],
    [-0.555, -0.141],
  ], 0.05, 0.003);

  // --- barrel: short, a thin 9mm tube, into a three-prong flash hider ---
  const f = BORE_Y;
  b.tube("barrel", BODY, 0.022, 0.024, 0.13, 0, f, 0.37);
  b.tube("mzCollar", BODY, 0.03, 0.028, 0.014, 0, f, 0.442);
  b.tube("mzCore", RUBBER, 0.018, 0.018, 0.05, 0, f, 0.474);
  b.shell("mzProng", BODY, 0.02, 0.006, 0.05, f, 0.474, 3, 0, 0.55);
  b.shell("mzProngRoot", BODY, 0.02, 0.006, 0.012, f, 0.455, 6);

  const meshes = b.merge("smg", root);

  // The magazine: a slim 9mm stick, gently curving forward, merged into a
  // node of its own so the reload can pull it out (see `WeaponParts.magazine`).
  const magazine = new TransformNode(`${prefix}_magazine`, scene);
  magazine.parent = root;
  const magPivot = b.pivot("magPivot", 0, -0.085, 0.045, MAG_RAKE);
  const magRing = (y: number, w: number, d: number, k = 0.2) => ({ y, w, d, z: 0.35 * y * y, k });
  b.upright("mag", POLYMER, [
    magRing(-0.196, 0.036, 0.05),
    magRing(-0.12, 0.036, 0.052),
    magRing(-0.05, 0.036, 0.053),
    magRing(0.04, 0.035, 0.053),
  ], magPivot);
  // Raised edges down the front and back, so each flank is a sunk panel.
  for (const [front, back] of [[0.027, 0.02], [-0.02, -0.027]] as const) {
    b.slab("magEdge", POLYMER, [
      [back, -0.19],
      [front, -0.19],
      [front, -0.03],
      [back, -0.03],
    ], 0.039, 0.0015, 0, magPivot);
  }
  b.upright("magFloor", POLYMER, [
    magRing(-0.21, 0.04, 0.058, 0.25),
    magRing(-0.194, 0.04, 0.058, 0.25),
  ], magPivot);
  meshes.push(...b.merge("smgMag", magazine));

  // Every colour group the WEAPON itself merged, taken before the optics are
  // built so a finish can never reach one — see `WeaponBuild.takeFinish`.
  const finish = b.takeFinish();

  const optics = buildOptics(b, MOUNT, prefix);
  meshes.push(...optics.meshes);
  b.disposePivots();

  return {
    root,
    muzzle: new Vector3(0, BORE_Y, 0.5),
    ejectPort: new Vector3(0.036, 0.032, -0.008),
    grip: { hand: GRIP_HAND, elbow: GRIP_ELBOW },
    support: { hand: SUPPORT_HAND, elbow: SUPPORT_ELBOW },
    magazine,
    magDrop: magDropAxis(MAG_RAKE),
    finish,
    sights: { kind: "fitted", assemblies: optics.sights },
    meshes,
  };
}
