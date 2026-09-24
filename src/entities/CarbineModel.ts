/**
 * CarbineModel.ts — Builds the bullpup burst carbine, a FAMAS drawn from
 * photographs, and hangs the same optics off the rail on its carry handle.
 * Returns WeaponParts, exactly as the other builders do: all of them are
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
  spanRing,
  type WeaponParts,
} from "./weaponKit";

/**
 * Top face of the rail, and on this weapon the rail is on top of the CARRY
 * HANDLE — the FAMAS FÉLIN's arrangement, and the only way the handle survives
 * the optics' rule that nothing forward of the mount may stand above
 * `RAIL_TOP`: the handle's top bar IS the rail's base, so everything
 * structural is under the sight line and the window is under that.
 *
 * It is tall — 0.105 over the bore — because the FAMAS is. A sight carried
 * high over a bullpup's action is the weapon's whole profile, and lowered to
 * a rifle's height the handle is a slot rather than a window.
 */
const RAIL_TOP = 0.125;

/** The top of the handle's bar: the base the rail's spine stands on. */
const HANDLE_TOP = 0.115;

/**
 * **The BORE, and this is one of the two models here whose barrel axis is not
 * y = 0.** `SniperModel` is the precedent (`weaponKit.ts`'s `bolt` field states
 * the rule for it), and the reason is the same one: a barrel is screwed into a
 * CHAMBER, and the chamber is whatever the ejection port is cut into. The port,
 * the barrel, the grenade sleeve, the flash hider and both landmarks
 * `WeaponParts` hands back are written against this and nothing against zero.
 */
const BORE = 0.02;

/**
 * Where the carbine offers its rail: along the handle, from over the rear post
 * to over the front one. The irons stand on it rather than inside the handle
 * where the FAMAS keeps its own — the rail is the one place `optics.ts` can
 * put them — and the optic sits a little forward of the handle's middle, which
 * leaves the stock behind the sight where a face goes.
 */
const MOUNT: OpticMount = {
  railTop: RAIL_TOP,
  mountZ: 0.08,
  ironRearZ: -0.14,
  ironFrontZ: 0.33,
  // The handle's rail ends at 0.356 and nothing forward of it stands as high:
  // the barrel is a handle's depth under it.
  reach: 0.28,
};

/**
 * The magazine's rake, and it is the sign the table in `docs/weapons.md` gives
 * every magazine in the kit: NEGATIVE, so the floor plate stands forward of the
 * feed lips. A bullpup does not change that — the chamber is above the well
 * either way — it only moves the whole well behind the firing hand.
 * `magDropAxis` has to read the same number or the magazine shears through the
 * front wall of its own well on the way out.
 */
const MAG_RAKE = -0.11;

/**
 * Where each hand grips, in weapon-local units. The trigger hand sits well
 * forward of the magazine — that is what a bullpup IS — and the support hand
 * is under the handguard, among its finger scallops.
 *
 * **The DAYLIGHT between the firing hand and the magazine is the layout's only
 * evidence**, so the grip and the well are kept 0.057 apart: flush, the kit
 * stage showed a magazine growing out of the front of the grip, which is a
 * shape no bullpup has.
 */
const GRIP_HAND = new Vector3(0.02, -0.123, -0.103);
const GRIP_ELBOW = new Vector3(0.26, -0.518, -0.473);
const SUPPORT_HAND = new Vector3(-0.02, -0.068, 0.2);
const SUPPORT_ELBOW = new Vector3(-0.3, -0.49, -0.08);

/**
 * Where the support hand goes for the magazine swap: an OFFSET from its rest
 * (`ViewModel.poseReload` blends it in from zero), and further back than any
 * other weapon's because the well is behind the firing hand. -0.47 off a
 * support hand at z = 0.2 lands on the magazine at -0.268; the two are one
 * number written twice.
 */
const MAG_HAND = new Vector3(-0.02, -0.075, -0.47);

/** The magazine's centre along the bore, and its well's. */
const MAG_Z = -0.268;

/**
 * Builds a cel-styled FAMAS. Local +z is the barrel axis, origin at the
 * receiver centre — the same frame every weapon here is built in, so the
 * viewmodel poses any of them with the same numbers.
 *
 * **The layout is the argument**: the action folded into the stock and the
 * magazine BEHIND the firing hand, which changes every line at once. What makes
 * it a FAMAS rather than any bullpup is four things, all taken from photographs
 * of the F1 and the G2:
 *
 * - **The carry handle.** A long loop from over the ejection port to the front
 *   of the handguard, standing high over the action with a window under it
 *   that shows the world through the weapon — and the charging handle inside
 *   it, where the FAMAS keeps it.
 * - **The deep, boxy butt.** All of a bullpup's volume is back here: a stock
 *   whose top steps down in front of the cheek, whose underside falls away
 *   behind the magazine to a deep toe, and a ribbed pad as tall as the stock.
 * - **The scalloped handguard.** Its underside is a row of pointed finger
 *   grooves, with the bipod's legs folded flat along its flanks.
 * - **The muzzle.** A short plain barrel, the ribbed sleeve rifle grenades are
 *   launched off, and a slotted flash hider.
 *
 * Built as the rifle is — bevelled profile slabs and contoured lofts, detail at
 * its real scale, controls small and dark, machining as dark inlays — see
 * `docs/weapons.md`'s procedural-models section.
 */
export function buildCarbine(
  scene: Scene,
  mats: CelMaterialFactory,
  prefix: string,
): WeaponParts {
  const root = new TransformNode(`${prefix}_carbine`, scene);
  const b = new WeaponBuild(scene, mats, prefix, root);

  // --- the carry handle, with the rail on its top face ---
  // One profile: rear post up off the action, the bar forward, the front post
  // down into the handguard, and the window cut out of the middle of it. It is
  // concave, which is what the slab primitive is for.
  // The bar is as deep as the window under it, and the rear post is broad and
  // raked forward — it is the housing the FAMAS keeps its rear sight in.
  b.slab("handle", BODY, [
    [-0.205, 0.05],
    [-0.192, 0.1],
    [-0.172, HANDLE_TOP],
    [0.358, HANDLE_TOP],
    [0.375, 0.1],
    [0.375, 0.04],
    [0.334, 0.04],
    [0.334, 0.082],
    [0.322, 0.094],
    [-0.1, 0.094],
    [-0.116, 0.085],
    [-0.13, 0.05],
  ], 0.044, 0.005);
  b.picatinny("rail", 0, HANDLE_TOP, -0.15, 26, {
    width: 0.046,
    height: RAIL_TOP - HANDLE_TOP,
  });
  // The pins the handle hangs on, both flanks.
  b.pin("handlePin", METAL, 0.012, 0.05, 0, 0.078, -0.158);
  b.pin("handlePin", METAL, 0.012, 0.05, 0, 0.062, 0.352);

  // --- the action: a narrower steel core, seen only through the window ---
  b.slab("receiver", BODY, [
    [-0.18, 0.0],
    [0.38, 0.0],
    [0.38, 0.058],
    [-0.18, 0.058],
  ], 0.05, 0.004);
  // The charging handle: a lever lying on top of the action inside the
  // handle, its knob turned up at the front where a thumb reaches it.
  b.slab("chLever", METAL, [
    [0.19, 0.056],
    [0.285, 0.056],
    [0.3, 0.07],
    [0.29, 0.078],
    [0.272, 0.068],
    [0.19, 0.064],
  ], 0.014, 0.002);
  b.pin("chPivot", METAL, 0.01, 0.054, 0, 0.06, 0.195);

  // --- the stock shell: the whole back half of the weapon ---
  // Deep and boxy. The top steps DOWN in front of the cheek, to where the
  // handle's rear post rises out of it; the underside runs flat back from the
  // grip to the well, then falls away behind it to a deep toe.
  b.slab("stock", POLYMER, [
    [-0.402, -0.117],
    [-0.386, -0.118],
    [-0.312, -0.048],
    [-0.12, -0.036],
    [-0.12, 0.05],
    [-0.175, 0.066],
    [-0.286, 0.066],
    [-0.298, 0.077],
    [-0.392, 0.078],
    [-0.402, 0.07],
  ], 0.072, 0.006);
  // A moulded rib down each flank of the butt, following its top line — the
  // shell's own stiffener, and what breaks the biggest flat on the weapon.
  b.slab("stockRib", POLYMER, [
    [-0.39, 0.018],
    [-0.31, 0.018],
    [-0.305, 0.024],
    [-0.39, 0.024],
  ], 0.076, 0.002);
  // The magazine well, hung under the shell and flared at its mouth.
  b.slab("magwell", POLYMER, [
    [MAG_Z - 0.044, -0.03],
    [MAG_Z + 0.044, -0.03],
    [MAG_Z + 0.044, -0.064],
    [MAG_Z + 0.04, -0.074],
    [MAG_Z - 0.04, -0.074],
    [MAG_Z - 0.044, -0.064],
  ], 0.064, 0.004);
  // The release at the BACK of the well, worked by the firing thumb.
  b.box("magRelease", POLYMER, 0.022, 0.018, 0.008, 0, -0.056, MAG_Z - 0.047);
  for (const side of [-1, 1] as const) {
    b.box("magCatch", METAL, 0.004, 0.016, 0.01, side * 0.033, -0.058, MAG_Z - 0.04);
  }
  // The burst selector, under the butt behind the well — where the FAMAS
  // keeps the choice between three and unlimited.
  b.pin("burstSel", METAL, 0.016, 0.008, 0, -0.056, -0.33, "y");
  // The maker's plate on the left flank, over the well, with its stamping.
  b.slab("plate", BODY, [
    [-0.3, -0.006],
    [-0.22, -0.006],
    [-0.22, -0.026],
    [-0.3, -0.026],
  ], 0.003, 0, -0.0365);
  for (const [y, len] of [[-0.012, 0.06], [-0.019, 0.044]] as const) {
    b.box("stamp", RUBBER, 0.002, 0.0026, len, -0.038, y, -0.292 + len / 2);
  }
  // The big takedown pins through the shell, and two screws in the butt.
  b.pin("takedown", METAL, 0.016, 0.076, 0, -0.008, -0.18);
  b.pin("takedown", METAL, 0.014, 0.076, 0, 0.03, -0.35);
  b.pin("buttScrew", METAL, 0.008, 0.074, 0, 0.066, -0.375);
  b.pin("buttScrew", METAL, 0.008, 0.074, 0, 0.066, -0.34);
  // Sling loop on the flank of the butt: a dark D-ring lying flat in a recess.
  b.slab("slingRecess", RUBBER, [
    [-0.392, -0.012],
    [-0.366, -0.012],
    [-0.366, 0.012],
    [-0.392, 0.012],
  ], 0.003, 0, -0.0365);
  b.slab("slingRing", BODY, [
    [-0.388, -0.009],
    [-0.372, -0.009],
    [-0.368, -0.004],
    [-0.368, 0.004],
    [-0.372, 0.009],
    [-0.388, 0.009],
  ], 0.004, 0.001, -0.038);

  // --- ejection ports at the cheek, both flanks ---
  // The FAMAS ejects to either side by swapping the extractor, so both flanks
  // carry a port; the brass leaves on the RIGHT, which is what `ejectPort`
  // below names. Each is a dark opening with the bolt's face showing in it and
  // a thin frame round it, centred on the BORE because the chamber this is cut
  // into is what the barrel screws into.
  for (const side of [-1, 1] as const) {
    b.slab("port", RUBBER, [
      [-0.27, BORE + 0.01],
      [-0.18, BORE + 0.01],
      [-0.18, BORE + 0.036],
      [-0.27, BORE + 0.036],
    ], 0.003, 0, side * 0.0365);
    b.box("bolt", METAL, 0.003, 0.012, 0.05, side * 0.0375, BORE + 0.023, -0.215);
    b.box("portRim", POLYMER, 0.003, 0.004, 0.096, side * 0.037, BORE + 0.038, -0.225);
    b.box("portRim", POLYMER, 0.003, 0.004, 0.096, side * 0.037, BORE + 0.008, -0.225);
  }

  // --- the handguard: the front half, scalloped underneath ---
  // Its top stops under the window, so the action shows as a narrower step
  // above it; its underside is the FAMAS's row of pointed finger grooves.
  b.slab("handguard", POLYMER, [
    [-0.13, 0.045],
    [0.37, 0.045],
    [0.386, 0.03],
    [0.386, -0.014],
    [0.372, -0.028],
    [0.345, -0.046],
    [0.312, -0.03],
    [0.28, -0.046],
    [0.247, -0.03],
    [0.215, -0.046],
    [0.182, -0.03],
    [0.15, -0.046],
    [0.118, -0.03],
    [-0.02, -0.03],
    [-0.13, -0.036],
  ], 0.066, 0.005);
  // Cooling slots along the upper flank, cut through both sides at once.
  for (let i = 0; i < 4; i++) {
    const zc = 0.05 + i * 0.07;
    b.slab("hgSlot", RUBBER, [
      [zc - 0.022, 0.022],
      [zc - 0.017, 0.017],
      [zc + 0.017, 0.017],
      [zc + 0.022, 0.022],
      [zc + 0.017, 0.027],
      [zc - 0.017, 0.027],
    ], 0.069, 0);
  }
  // The bipod, folded: a leg along each flank at the top of the handguard,
  // hinged at a block under the handle's front post, with its foot at the back.
  for (const side of [-1, 1] as const) {
    b.tube("bipodLeg", BODY, 0.009, 0.009, 0.36, side * 0.037, 0.05, 0.16);
    b.box("bipodFoot", BODY, 0.008, 0.012, 0.02, side * 0.037, 0.05, -0.028);
  }
  b.box("bipodHinge", BODY, 0.084, 0.014, 0.02, 0, 0.05, 0.345);
  b.box("slingFront", METAL, 0.004, 0.02, 0.012, -0.035, -0.01, 0.36);

  // --- trigger group, in front of the grip ---
  // A small loop, the F1's, drawn from the side: down from the handguard, along
  // under the trigger and back into the grip's front face.
  b.slab("guard", POLYMER, [
    [0.004, -0.03],
    [0.004, -0.088],
    [-0.006, -0.1],
    [-0.075, -0.104],
    [-0.075, -0.094],
    [-0.01, -0.09],
    [-0.006, -0.085],
    [-0.006, -0.03],
  ], 0.018, 0.002);
  b.slab("trigger", METAL, [
    [-0.05, -0.036],
    [-0.041, -0.036],
    [-0.043, -0.052],
    [-0.043, -0.064],
    [-0.038, -0.074],
    [-0.036, -0.079],
    [-0.042, -0.076],
    [-0.048, -0.066],
    [-0.05, -0.052],
  ], 0.008, 0.001);
  // The fire selector, at the back of the guard where the FAMAS keeps it.
  b.box("selector", METAL, 0.006, 0.014, 0.008, 0, -0.084, -0.064);

  // Raked back, shallower than the rifle's: the bullpup's grip stands ahead of
  // the magazine, so there is less room to lay it over before the toe is out
  // under the trigger. The sign is the rifle's and the pistol's. Finger
  // grooves in the front face, a swell in the back, a flared heel.
  const gripPivot = b.pivot("gripPivot", 0, -0.055, -0.096, 0.18);
  b.upright("grip", POLYMER, [
    spanRing(-0.135, 0.058, 0.04, -0.045),
    spanRing(-0.118, 0.054, 0.031, -0.041),
    spanRing(-0.1, 0.054, 0.037, -0.042),
    spanRing(-0.08, 0.055, 0.03, -0.043),
    spanRing(-0.06, 0.055, 0.037, -0.044),
    spanRing(-0.04, 0.054, 0.03, -0.044),
    spanRing(-0.02, 0.054, 0.035, -0.043),
    spanRing(0.02, 0.05, 0.034, -0.04),
  ], gripPivot);
  b.upright("gripCap", RUBBER, [
    spanRing(-0.148, 0.056, 0.04, -0.045),
    spanRing(-0.133, 0.058, 0.041, -0.046),
  ], gripPivot);

  // --- the butt pad: as tall as the stock, curved, and ribbed ---
  b.slab("buttPad", RUBBER, [
    [-0.4, 0.075],
    [-0.413, 0.073],
    [-0.418, 0.06],
    [-0.419, -0.104],
    [-0.414, -0.118],
    [-0.4, -0.119],
  ], 0.074, 0.004);
  for (let i = 0; i < 7; i++) {
    b.box("padRib", RUBBER, 0.076, 0.004, 0.006, 0, 0.04 - i * 0.022, -0.419);
  }

  // --- barrel: short and plain, then the grenade sleeve, then the hider ---
  b.tube("barrel", BODY, 0.024, 0.026, 0.05, 0, BORE, 0.41);
  b.box("frontLug", BODY, 0.018, 0.02, 0.022, 0, BORE - 0.016, 0.398);
  // The sleeve rifle grenades are launched off: a run of rings round a
  // collar, which is the FAMAS muzzle's whole silhouette.
  b.tube("sleeve", BODY, 0.03, 0.03, 0.09, 0, BORE, 0.478);
  for (let i = 0; i < 10; i++) {
    b.tube("sleeveRing", BODY, 0.037, 0.037, 0.004, 0, BORE, 0.439 + i * 0.009);
  }
  // Flash hider: a collar, open slots over a dark core, and the crown. The
  // slots are cut where a muzzle device vents, clear of top dead centre.
  b.tube("mzCollar", BODY, 0.036, 0.034, 0.012, 0, BORE, 0.529);
  b.tube("mzCore", RUBBER, 0.022, 0.022, 0.06, 0, BORE, 0.566);
  b.shell("mzStrut", BODY, 0.026, 0.006, 0.054, BORE, 0.563, 6, Math.PI / 6, 0.55);
  b.shell("crown", BODY, 0.026, 0.007, 0.01, BORE, 0.595, 10);

  // The carbine itself is finished. Merge it before any optic is built, so a
  // sight's parts can never end up inside the weapon's colour groups.
  const meshes = b.merge("carbine", root);

  // The magazine: the F1's straight box, fluted down each flank, merged into a
  // node of its own so the reload can pull it out of the well (see
  // `WeaponParts.magazine`). Built on its own raking pivot, so `magDrop` below
  // has to read `MAG_RAKE`.
  const magazine = new TransformNode(`${prefix}_magazine`, scene);
  magazine.parent = root;
  const magPivot = b.pivot("magPivot", 0, -0.078, MAG_Z, MAG_RAKE);
  b.upright("mag", POLYMER, [
    { y: -0.138, w: 0.046, d: 0.07, k: 0.18 },
    { y: 0.03, w: 0.046, d: 0.07, k: 0.18 },
  ], magPivot);
  for (const z of [-0.012, 0.012]) {
    b.slab("magFlute", RUBBER, [
      [z - 0.003, -0.126],
      [z + 0.003, -0.126],
      [z + 0.003, -0.012],
      [z - 0.003, -0.012],
    ], 0.048, 0, 0, magPivot);
  }
  b.upright("magFloor", POLYMER, [
    { y: -0.152, w: 0.05, d: 0.078, k: 0.25 },
    { y: -0.136, w: 0.05, d: 0.078, k: 0.25 },
  ], magPivot);
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
    // The right-hand port: brass past the ear is what a bullpup costs.
    ejectPort: new Vector3(0.042, BORE + 0.023, -0.225),
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
