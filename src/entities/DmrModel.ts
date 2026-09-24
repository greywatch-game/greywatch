/**
 * DmrModel.ts — Builds the semi-automatic marksman rifle, an HK G28 / M110A1
 * drawn from photographs, and hangs the same optics off its rail.
 * Returns WeaponParts, exactly as RifleModel and SmgModel do: every builder is
 * interchangeable to everything above it, which is what lets `ViewModel` carry
 * any of them.
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
 * `magDropAxis`). Shallow, because HK's 20-round 7.62 box is straight — the
 * lean is all the curve it gets.
 */
const MAG_RAKE = -0.06;

/**
 * Top face of the receiver's rail. Higher than the rifle's: this receiver is
 * cut for a longer cartridge, and the extra depth is most of what makes the
 * weapon read as the heavier one before the barrel is even in frame.
 */
const RAIL_TOP = 0.09;

/** The upper's flat, and the handguard's: the rail's spine stands on it. */
const DECK = 0.076;

/**
 * Height of the bore above the origin: in the upper receiver, level with the
 * bottom of the ejection port. The handguard floats around the barrel, so its
 * heights are written against this.
 */
const BORE_Y = 0.03;

/**
 * Where the DMR offers its rail.
 *
 * The front iron station is the one number here that is not a styling choice.
 * A marksman rifle wants the longest sight radius the receiver will give, and
 * what stops it is `optics.ts`: with a holo fitted the FOLDED front leaf still
 * stands on the rail, and the holo's view cone spreads until it runs onto it.
 * At this rail height the cone reaches the leaf's top at z = 0.53, which is
 * therefore where the station goes. The rail itself stops at 0.57 for the same
 * reason one step up — past that its teeth are inside the SCOPE's cone — so
 * the M110A1's handguard runs on past the rail's end as a bare flat top.
 */
const MOUNT: OpticMount = {
  railTop: RAIL_TOP,
  mountZ: 0.02,
  ironRearZ: -0.22,
  ironFrontZ: 0.53,
};

/**
 * The comb's top: the rail's height, and never higher than the irons allow.
 *
 * The eye behind this weapon sits BEHIND its own butt — an aperture's eye
 * relief is over half a receiver's length — so the comb stands between the eye
 * and the rear sight, in the one part of the sight picture the shooter cannot
 * look around. `ironSightFloor` at the comb's front edge is the highest it may
 * stand (less a few millimetres of daylight); the M110A1's own cheek piece sits
 * about level with the rail, which comes in under that, so the rail is what
 * sets it and the floor is the ceiling it is checked against.
 */
const COMB_FRONT_Z = -0.352;
const COMB_TOP = Math.min(RAIL_TOP, ironSightFloor(MOUNT, COMB_FRONT_Z) - 0.006);
/** The stock body's own top, under the cheek flap that rides on it. */
const STOCK_TOP = COMB_TOP - 0.012;
/** The butt's toe, a stock's depth under the comb. */
const TOE = COMB_TOP - 0.21;

/**
 * Where each hand grips, in weapon-local units. The support hand sits well
 * out along the handguard, short of the bipod stowed under its far end.
 */
const GRIP_HAND = new Vector3(0.02, -0.164, -0.166);
const GRIP_ELBOW = new Vector3(0.26, -0.564, -0.541);
const SUPPORT_HAND = new Vector3(-0.02, -0.08 + BORE_Y, 0.38);
const SUPPORT_ELBOW = new Vector3(-0.3, -0.5 + BORE_Y, 0.1);

/**
 * Builds a cel-styled HK G28 / M110A1. Local +z is the barrel axis, origin at
 * the receiver centre — the same frame the other weapons are built in, so the
 * viewmodel poses any of them with the same numbers — with the bore `BORE_Y`
 * above it.
 *
 * An HK417 at heart, and what makes it the marksman's version rather than a
 * big rifle is five things, all taken from photographs:
 *
 * - **The long slim handguard** — octagonal, slotted for M-LOK down its whole
 *   length, its top a continuation of the upper's rail.
 * - **The exposed buffer tube** between the lower and the stock, which is the
 *   AR-pattern's tell and the reason the stock is a separate thing that slides.
 * - **The stock**: a tall adjustable body with a cheek flap on top, a hooked
 *   underside falling to a deep toe, and a ribbed pad.
 * - **HK's lower**: a flared magwell, an oversized flared guard for a gloved
 *   finger, and a near-vertical grip with finger grooves.
 * - **HK's 20-round magazine**: straight, ribbed, and windowed, with the brass
 *   showing through it.
 *
 * Built as the rifle is — bevelled profile slabs and contoured lofts, detail at
 * its real scale, controls small and dark, machining as dark inlays — see
 * `docs/weapons.md`'s procedural-models section.
 */
export function buildDmr(
  scene: Scene,
  mats: CelMaterialFactory,
  prefix: string,
): WeaponParts {
  const root = new TransformNode(`${prefix}_dmr`, scene);
  const b = new WeaponBuild(scene, mats, prefix, root);

  // --- upper receiver: the HK417 upper, one size up from an AR's ---
  b.slab("upper", BODY, [
    [-0.27, -0.004],
    [0.142, -0.004],
    [0.142, 0.064],
    [-0.27, 0.064],
  ], 0.082, 0.005);
  b.slab("upperDeck", BODY, [
    [-0.262, 0.06],
    [0.142, 0.06],
    [0.142, DECK],
    [-0.256, DECK],
    [-0.262, 0.07],
  ], 0.068, 0.004);
  b.picatinny("rail", 0, DECK, -0.25, 42, { width: 0.06, height: RAIL_TOP - DECK });
  // A long-cartridge port with its cover swung down under it, and the big
  // swept deflector behind it.
  b.slab("ejectPort", RUBBER, [
    [0.02, 0.024],
    [0.14, 0.024],
    [0.14, 0.054],
    [0.02, 0.054],
  ], 0.003, 0, 0.0415);
  b.box("portCover", BODY, 0.003, 0.014, 0.12, 0.0425, 0.014, 0.08);
  b.slab("deflector", BODY, [
    [-0.04, 0.026],
    [0.016, 0.026],
    [0.016, 0.034],
    [-0.006, 0.06],
    [-0.04, 0.06],
  ], 0.012, 0.003, 0.046);
  // The markings flat on the left, and the pins through the receiver.
  b.slab("plate", BODY, [
    [-0.2, 0.02],
    [-0.06, 0.02],
    [-0.06, 0.05],
    [-0.2, 0.05],
  ], 0.003, 0, -0.0415);
  for (const [y, len] of [[0.042, 0.11], [0.034, 0.08], [0.026, 0.05]] as const) {
    b.box("stamp", RUBBER, 0.002, 0.0028, len, -0.043, y, -0.19 + len / 2);
  }
  b.pin("pinFront", METAL, 0.01, 0.086, 0, -0.012, 0.13);
  b.pin("pinRear", METAL, 0.01, 0.086, 0, -0.012, -0.24);
  // The T-handle at the back of the upper, its latch on the left.
  b.slab("chHandle", POLYMER, [
    [-0.288, 0.046],
    [-0.27, 0.046],
    [-0.27, 0.066],
    [-0.288, 0.066],
  ], 0.066, 0.003);
  b.box("chLatch", POLYMER, 0.01, 0.014, 0.016, -0.038, 0.056, -0.282);

  // --- handguard: long, slim and octagonal, slotted its whole length ---
  // Its top is the upper's flat carried on, so the rail runs unbroken from the
  // charging handle to where the scope's cone says it must stop, and the
  // handguard carries on past that bare.
  b.slab("handguard", POLYMER, [
    [0.14, DECK],
    [0.7, DECK],
    [0.708, 0.068],
    [0.708, -0.012],
    [0.7, -0.02],
    [0.14, -0.02],
  ], 0.07, 0.013);
  for (let i = 0; i < 6; i++) {
    const z0 = 0.19 + i * 0.083;
    b.slab("mlok", RUBBER, [
      [z0, 0.028],
      [z0 + 0.006, 0.022],
      [z0 + 0.058, 0.022],
      [z0 + 0.064, 0.028],
      [z0 + 0.058, 0.034],
      [z0 + 0.006, 0.034],
    ], 0.072, 0);
  }
  for (let i = 0; i < 5; i++) {
    b.box("mlokBottom", RUBBER, 0.012, 0.002, 0.05, 0, -0.0205, 0.22 + i * 0.09);
  }
  b.pin("hgScrew", METAL, 0.008, 0.072, 0, 0.004, 0.16);
  b.box("slingQd", METAL, 0.004, 0.014, 0.014, -0.036, 0.0, 0.66);
  // A hand stop on the underside rather than a vertical grip: the support
  // hand's job on this weapon is to hold a position, not to steer between two.
  b.slab("handStop", POLYMER, [
    [0.3, -0.018],
    [0.35, -0.018],
    [0.35, -0.03],
    [0.33, -0.042],
    [0.314, -0.042],
  ], 0.026, 0.003);

  // --- bipod, folded forward along the underside under the handguard's end ---
  // Deployed legs would be geometry the player can never use — nothing here
  // rests a weapon on anything — so it is stowed, which is also the only state
  // it would be in while the weapon is being carried.
  b.slab("bipodMount", BODY, [
    [0.6, -0.018],
    [0.66, -0.018],
    [0.66, -0.032],
    [0.652, -0.04],
    [0.608, -0.04],
    [0.6, -0.032],
  ], 0.04, 0.004);
  for (const side of [-1, 1] as const) {
    b.tube("bipodLeg", BODY, 0.01, 0.012, 0.17, side * 0.017, -0.046, 0.55);
    b.box("bipodFoot", RUBBER, 0.014, 0.014, 0.02, side * 0.017, -0.046, 0.46);
    b.tube("bipodSpring", METAL, 0.006, 0.006, 0.05, side * 0.017, -0.036, 0.62);
  }

  // --- barrel: a medium contour out of the handguard, into HK's hider ---
  const f = BORE_Y;
  b.tube("barrel", BODY, 0.032, 0.034, 0.2, 0, f, 0.8);
  b.tube("mzCollar", BODY, 0.042, 0.04, 0.016, 0, f, 0.908);
  b.tube("mzCore", RUBBER, 0.024, 0.024, 0.044, 0, f, 0.935);
  b.shell("mzProng", BODY, 0.026, 0.008, 0.04, f, 0.936, 4, Math.PI / 4, 0.55);
  b.shell("crown", BODY, 0.026, 0.009, 0.008, f, 0.956, 10);

  // --- lower receiver: HK's, with its flared magwell and guard ---
  b.slab("lower", POLYMER, [
    [-0.27, -0.002],
    [0.14, -0.002],
    [0.14, -0.03],
    [0.128, -0.048],
    [0.128, -0.128],
    [0.118, -0.14],
    [-0.018, -0.14],
    [-0.028, -0.128],
    [-0.03, -0.085],
    [-0.21, -0.085],
    [-0.245, -0.07],
    [-0.27, -0.04],
  ], 0.074, 0.005);
  b.slab("magwellLip", POLYMER, [
    [-0.022, -0.146],
    [0.124, -0.146],
    [0.132, -0.132],
    [-0.028, -0.132],
  ], 0.082, 0.003);
  // Small, dark controls.
  b.box("magRelease", POLYMER, 0.006, 0.014, 0.016, 0.04, -0.07, -0.014);
  b.box("boltCatch", POLYMER, 0.006, 0.014, 0.034, -0.04, -0.05, -0.04);
  b.pin("selPin", METAL, 0.011, 0.084, 0, -0.035, -0.13);
  for (const side of [-1, 1] as const) {
    b.box("selLever", METAL, 0.004, 0.026, 0.01, side * 0.043, -0.024, -0.13);
  }
  // The guard, oversized and flared for a gloved finger — HK's own.
  b.slab("guard", POLYMER, [
    [-0.03, -0.085],
    [-0.03, -0.14],
    [-0.042, -0.156],
    [-0.16, -0.158],
    [-0.16, -0.146],
    [-0.046, -0.144],
    [-0.042, -0.138],
    [-0.042, -0.085],
  ], 0.024, 0.002);
  // A single-stage trigger with a flat shoe: the one control on the weapon a
  // shooter thinks about between rounds.
  b.slab("trigger", METAL, [
    [-0.112, -0.086],
    [-0.102, -0.086],
    [-0.104, -0.104],
    [-0.101, -0.122],
    [-0.1, -0.134],
    [-0.108, -0.134],
    [-0.11, -0.122],
    [-0.112, -0.104],
  ], 0.012, 0.0015);

  // The grip stands closer to vertical than the rifle's. A precision grip puts
  // the wrist under the trigger rather than behind it, which is the difference
  // between squeezing a shot and holding a burst on target. HK's: finger
  // grooves down the front, a palm swell, a shelf under the web.
  const gripPivot = b.pivot("gripPivot", 0, -0.105, -0.165, 0.18);
  b.upright("grip", POLYMER, [
    spanRing(-0.15, 0.056, 0.036, -0.042),
    spanRing(-0.125, 0.056, 0.031, -0.043),
    spanRing(-0.108, 0.058, 0.038, -0.045),
    spanRing(-0.088, 0.058, 0.031, -0.046),
    spanRing(-0.068, 0.058, 0.038, -0.047),
    spanRing(-0.048, 0.057, 0.031, -0.047),
    spanRing(-0.028, 0.056, 0.036, -0.046),
    spanRing(-0.004, 0.056, 0.036, -0.058),
    spanRing(0.02, 0.052, 0.034, -0.05),
  ], gripPivot);
  b.upright("gripCap", RUBBER, [
    spanRing(-0.162, 0.056, 0.037, -0.043),
    spanRing(-0.148, 0.057, 0.037, -0.043),
  ], gripPivot);

  // --- the buffer tube and the stock that slides on it ---
  b.tube("bufferTube", BODY, 0.034, 0.034, 0.27, 0, 0.018, -0.405);
  b.tube("castleNut", METAL, 0.042, 0.042, 0.012, 0, 0.018, -0.278);
  b.slab("endPlate", BODY, [
    [-0.27, 0.05],
    [-0.286, 0.05],
    [-0.286, -0.012],
    [-0.27, -0.03],
  ], 0.05, 0.003);
  // The stock body: tall, flat on top under the cheek flap, its underside a
  // hook falling from the tube to a deep toe.
  b.slab("stockBody", POLYMER, [
    [-0.35, -0.004],
    [-0.35, STOCK_TOP - 0.01],
    [-0.36, STOCK_TOP],
    [-0.54, STOCK_TOP],
    [-0.548, STOCK_TOP - 0.008],
    [-0.548, TOE + 0.01],
    [-0.54, TOE],
    [-0.52, TOE],
    [-0.47, TOE + 0.07],
    [-0.44, -0.012],
    [-0.4, -0.012],
  ], 0.06, 0.006);
  // Sunk panels on each flank, the rifle's trick: a rim round a dark web.
  b.slab("stockRecess", RUBBER, [
    [-0.37, STOCK_TOP - 0.018],
    [-0.525, STOCK_TOP - 0.018],
    [-0.525, 0.004],
    [-0.37, 0.004],
  ], 0.062, 0);
  b.slab("stockRecessLow", RUBBER, [
    [-0.49, -0.02],
    [-0.528, -0.02],
    [-0.528, TOE + 0.02],
    [-0.51, TOE + 0.02],
  ], 0.062, 0);
  // The cheek flap, level with the rail, with the button that frees it.
  b.slab("cheekFlap", POLYMER, [
    [COMB_FRONT_Z, STOCK_TOP - 0.002],
    [COMB_FRONT_Z - 0.01, COMB_TOP],
    [-0.47, COMB_TOP],
    [-0.478, STOCK_TOP - 0.002],
  ], 0.054, 0.005);
  b.pin("flapButton", METAL, 0.01, 0.064, 0, STOCK_TOP - 0.01, -0.49);
  b.box("stockLever", POLYMER, 0.024, 0.008, 0.03, 0, -0.016, -0.37);
  b.slab("buttPad", RUBBER, [
    [-0.548, STOCK_TOP + 0.002],
    [-0.562, STOCK_TOP],
    [-0.566, STOCK_TOP - 0.014],
    [-0.566, TOE + 0.014],
    [-0.56, TOE],
    [-0.548, TOE - 0.002],
  ], 0.066, 0.004);
  for (let i = 0; i < 8; i++) {
    b.box("padRib", RUBBER, 0.068, 0.004, 0.006, 0, STOCK_TOP - 0.02 - i * 0.022, -0.566);
  }
  b.box("slingRear", METAL, 0.004, 0.016, 0.012, -0.031, -0.04, -0.44);

  // Merged before any optic is built, so a sight's parts can never end up
  // inside the weapon's colour groups.
  const meshes = b.merge("dmr", root);

  // --- magazine: HK's straight twenty-round box ---
  // Straight rather than curved, and it is the read: the rifle's banana under
  // the same receiver would say "same cartridge, longer barrel". Its window
  // shows the brass stacked inside, which is what HK's is for. Merged into a
  // node of its own so the reload can drop it (see `WeaponParts.magazine`).
  const magazine = new TransformNode(`${prefix}_magazine`, scene);
  magazine.parent = root;
  const magPivot = b.pivot("magPivot", 0, -0.125, 0.05, MAG_RAKE);
  b.upright("mag", POLYMER, [
    { y: -0.2, w: 0.05, d: 0.1, k: 0.15 },
    { y: 0.03, w: 0.05, d: 0.1, k: 0.15 },
  ], magPivot);
  // Ribs down the front and back edges, a band at the top.
  for (const [front, back] of [[0.052, 0.042], [-0.042, -0.052]] as const) {
    b.slab("magEdge", POLYMER, [
      [back, -0.2],
      [front, -0.2],
      [front, -0.02],
      [back, -0.02],
    ], 0.054, 0.0015, 0, magPivot);
  }
  // The window: a narrow slot down each flank, the width HK's actually is,
  // with a sliver of each round's case showing in it. Wider, the brass was a
  // bright ladder painted on the magazine rather than rounds seen through it.
  b.slab("magWindow", RUBBER, [
    [-0.006, -0.166],
    [0.006, -0.166],
    [0.008, -0.162],
    [0.008, -0.046],
    [0.006, -0.042],
    [-0.006, -0.042],
    [-0.008, -0.046],
    [-0.008, -0.162],
  ], 0.052, 0, 0, magPivot);
  for (let i = 0; i < 7; i++) {
    b.box("magRound", BRASS, 0.0525, 0.007, 0.012, 0, -0.052 - i * 0.017, 0, magPivot);
  }
  b.upright("magFloor", POLYMER, [
    { y: -0.216, w: 0.056, d: 0.108, k: 0.25 },
    { y: -0.198, w: 0.056, d: 0.108, k: 0.25 },
  ], magPivot);
  meshes.push(...b.merge("dmrMag", magazine));

  // Every colour group the WEAPON itself merged, taken before the optics are
  // built so a finish can never reach one — see `WeaponBuild.takeFinish`.
  const finish = b.takeFinish();

  const optics = buildOptics(b, MOUNT, prefix);
  meshes.push(...optics.meshes);
  b.disposePivots();

  return {
    root,
    muzzle: new Vector3(0, BORE_Y, 0.96),
    // The port on the right of the receiver.
    ejectPort: new Vector3(0.046, 0.04, 0.08),
    grip: { hand: GRIP_HAND, elbow: GRIP_ELBOW },
    support: { hand: SUPPORT_HAND, elbow: SUPPORT_ELBOW },
    magazine,
    magDrop: magDropAxis(MAG_RAKE),
    finish,
    sights: { kind: "fitted", assemblies: optics.sights },
    meshes,
  };
}
