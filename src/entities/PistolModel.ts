/**
 * PistolModel.ts — Builds the low-poly 1911-pattern sidearm from primitives,
 * along with the fixed notch-and-blade sight machined into its own slide.
 * Returns WeaponParts exactly as the three primaries do, so `ViewModel` carries
 * it with nothing re-tuned: the only thing that makes it a sidearm is that
 * `weapons.ts` keeps it out of `PRIMARY_WEAPON_IDS`.
 * Invariants: assembled at the origin with the root at identity and merged
 * before it is moved — `weaponKit.ts` owns that contract and the primitives.
 *
 * It is the ONE weapon that does not call `optics.ts`, and that is the whole
 * point of `WeaponSights`' `fixed` shape rather than an oversight: a 1911 has
 * no rail, and what stands on the back of the slide is a square notch rather
 * than the rear aperture every optic set here is built around. The one rule
 * that matters is still obeyed — the assembly reports a `sightCenter`, and
 * `ViewModel.applyFit` derives the aimed pose from it the same way it does for
 * a holo — so the reticle is the point of impact here for the same reason it is
 * everywhere else. Nothing about the eye reference is duplicated; only the
 * geometry in front of it is this weapon's own.
 *
 * Local +z is the barrel axis and the BORE is at y = 0, the same frame the long
 * guns are built in, so the shared helpers (`tube`, `shell`) lay rings around
 * the barrel without an offset and the viewmodel poses it with the same
 * numbers. Units are the models' throughout: ~1.4 per metre, which puts this
 * weapon at 0.30 long against the rifle's 1.27.
 */
import { Mesh, MeshBuilder, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import type { CelMaterialFactory } from "../shaders/CelShader";
import {
  BODY,
  METAL,
  magDropAxis,
  POLYMER,
  RUBBER,
  WeaponBuild,
  type SightAssembly,
  type WeaponParts,
} from "./weaponKit";

/**
 * The grip's rake — the 1911's signature ~18° off vertical, and the line the
 * magazine inside it both stands and drops along.
 */
const GRIP_RAKE = 0.32;

/**
 * The line of sight: the top of the rear posts and of the front blade, which
 * are the same height by construction. This is where `sightCenter` goes, so it
 * is the height ADS puts on the camera axis — everything behind it on this
 * weapon (the hammer spur, the grip safety's tang) has to stay UNDER it, or the
 * gun stands in its own sight picture. A notch is open-topped, so unlike an
 * aperture there is no cone to clear forward of the rear sight; the slide's own
 * top deck runs along below the line and is exactly what you are meant to see.
 */
const SIGHT_Y = 0.047;
const REAR_SIGHT_Z = -0.116;
const FRONT_SIGHT_Z = 0.118;

/**
 * Where each hand grips, in weapon-local units.
 *
 * The fists are a fixed size across every weapon (`buildArm`), and on a weapon
 * this small that size is most of the grip — which is correct, since a hand
 * does swallow a pistol's grip, but it means the placement is bounded by what
 * the SIGHT PICTURE can afford rather than by anatomy. Hung any higher, the
 * fist's top face is a flat lit plane sitting in the bottom of the notch.
 */
const GRIP_HAND = new Vector3(0.005, -0.14, -0.103);
const GRIP_ELBOW = new Vector3(0.24, -0.52, -0.48);
/**
 * The support hand does not hold a handguard here — there is nothing to hold.
 * It wraps the firing hand instead, which is why it sits inboard of and barely
 * ahead of the trigger hand rather than half a weapon further out. Staggered
 * from it in all three axes on purpose: level with it, the two fists read as
 * one wide slab under the weapon rather than as two hands.
 */
const SUPPORT_HAND = new Vector3(-0.048, -0.152, -0.062);
const SUPPORT_ELBOW = new Vector3(-0.3, -0.5, -0.32);

/**
 * Where the support hand goes for the magazine swap. Straight DOWN off the
 * grip, because that is where this weapon's magazine lives — the shared offset
 * in `CONFIG.viewmodel.magHandOffset` takes the hand back to a magwell under a
 * receiver, and applied here it throws the arm out behind the gun.
 */
const MAG_HAND = new Vector3(-0.02, -0.14, -0.03);

/**
 * Builds a low-poly cel-styled 1911-pattern pistol.
 *
 * The silhouette is the one everybody already knows and it is carried by five
 * lines: a slab slide with a flat top and cocking serrations at each end, a
 * short dust cover leaving the last of the barrel and the bushing exposed, a
 * squared trigger guard, a grip raked well back off the frame, and — the two
 * details that say 1911 rather than "pistol" — the spur hammer and the
 * beavertail tang standing off the back of the frame.
 *
 * ~70 parts, merged to one mesh per colour like every other weapon here.
 */
export function buildPistol(
  scene: Scene,
  mats: CelMaterialFactory,
  prefix: string,
): WeaponParts {
  const root = new TransformNode(`${prefix}_pistol`, scene);
  const b = new WeaponBuild(scene, mats, prefix, root);

  // --- slide: a flat-topped slab around the bore, from the breech face to the
  // muzzle, with the top deck stepped in to read as the flat's edge ---
  b.box("slide", BODY, 0.034, 0.042, 0.27, 0, 0, 0.005);
  b.box("slideTop", BODY, 0.024, 0.009, 0.27, 0, 0.0245, 0.005);
  // Cocking serrations, rear and front. Proud of the slide rather than cut into
  // it, the same trick the rifle's grip ribs use: additive geometry can add a
  // ridge and never a groove.
  for (let i = 0; i < 7; i++) {
    b.box("serrRear", METAL, 0.036, 0.03, 0.005, 0, 0, -0.118 + i * 0.012);
  }
  for (let i = 0; i < 4; i++) {
    b.box("serrFront", METAL, 0.036, 0.03, 0.005, 0, 0, 0.078 + i * 0.012);
  }
  // Ejection port and its lowered rear wall, right side.
  b.box("ejectPort", METAL, 0.008, 0.022, 0.062, 0.019, 0.012, 0.022);
  b.box("portRamp", METAL, 0.007, 0.012, 0.02, 0.02, -0.002, -0.014);
  // Breech face and extractor, the flat back end of the slide.
  b.box("breech", METAL, 0.03, 0.036, 0.008, 0, 0, -0.136);
  b.box("extractor", METAL, 0.006, 0.01, 0.03, 0.012, 0.013, -0.118);

  // --- muzzle end: barrel bushing over the bore, recoil spring plug under it.
  // The dark core behind the bushing is what the bore reads against; without
  // something inside it the ring opens onto the skybox and the muzzle looks
  // like a hole in the model, which is the same trick the rifle's birdcage
  // plays with `mzCore`. ---
  b.tube("bore", RUBBER, 0.018, 0.018, 0.04, 0, 0, 0.126);
  b.shell("bushing", METAL, 0.02, 0.006, 0.016, 0, 0.144, 12);
  b.shell("plug", METAL, 0.011, 0.005, 0.012, -0.0155, 0.144, 10);
  b.box("slideFace", BODY, 0.034, 0.042, 0.006, 0, 0, 0.137);

  // --- frame: the rail the slide runs on, a short dust cover under the barrel,
  // and the trigger housing behind it ---
  b.box("frameRail", POLYMER, 0.031, 0.02, 0.265, 0, -0.031, 0.0);
  b.box("dustCover", POLYMER, 0.029, 0.016, 0.16, 0, -0.045, 0.055);
  b.box("dustNose", METAL, 0.03, 0.018, 0.008, 0, -0.044, 0.132);
  b.box("frameBlock", POLYMER, 0.032, 0.05, 0.115, 0, -0.066, -0.075);
  // Slide stop (left) and thumb safety (left, higher and further back) — the
  // two levers a 1911 is recognised by from the side it is carried on.
  b.box("slideStop", METAL, 0.008, 0.014, 0.034, -0.018, -0.03, -0.008);
  b.pin("slideStopPin", METAL, 0.009, 0.036, 0, -0.03, -0.008);
  b.box("safetyLever", METAL, 0.009, 0.011, 0.03, -0.019, -0.028, -0.104);
  b.box("safetyPaddle", METAL, 0.008, 0.02, 0.014, -0.02, -0.034, -0.116);
  // Magazine catch. Left side, like the levers above it: this is the side a
  // right-handed shooter's thumb lives on, which is why every control on a
  // 1911 is over there.
  b.pin("magRelease", METAL, 0.012, 0.03, -0.014, -0.056, -0.088);

  // --- trigger guard and the flat sliding trigger inside it ---
  b.box("guardFront", POLYMER, 0.026, 0.038, 0.012, 0, -0.104, -0.026);
  b.box("guardBottom", POLYMER, 0.026, 0.011, 0.056, 0, -0.128, -0.055);
  b.box("guardRear", POLYMER, 0.026, 0.02, 0.012, 0, -0.113, -0.083);
  b.box("trigger", METAL, 0.013, 0.028, 0.011, 0, -0.104, -0.046);
  b.box("triggerFace", METAL, 0.013, 0.026, 0.005, 0, -0.104, -0.053);

  // --- the back of the frame: beavertail tang over the web of the hand, and
  // the spur hammer standing behind the slide ---
  // Both are bounded by SIGHT_Y rather than by looks: they sit between the eye
  // and the rear notch, so anything of either that rises past the line of sight
  // is a bite out of the sight picture.
  b.box("tang", POLYMER, 0.028, 0.014, 0.042, 0, -0.026, -0.152);
  b.box("tangHump", POLYMER, 0.026, 0.016, 0.02, 0, -0.014, -0.162);
  // Negative `rotX` is what leans the hammer BACK: a point above the pivot
  // takes `-sin(rotX)` along z (see the rake on the grip below, which is the
  // same rotation in the other direction and the other sign).
  const hammerPivot = b.pivot("hammerPivot", 0, -0.012, -0.148, -0.55);
  b.box("hammerBody", METAL, 0.009, 0.03, 0.011, 0, 0.015, 0, hammerPivot);
  b.box("hammerSpur", METAL, 0.009, 0.011, 0.022, 0, 0.03, -0.008, hammerPivot);
  b.pin("hammerPin", METAL, 0.008, 0.026, 0, -0.012, -0.148);

  // --- grip: raked back off the frame, panelled, with the mainspring housing
  // down the back strap and the magazine's floorplate under it ---
  // The rake is the 1911's signature and the sign is load-bearing: positive
  // `rotX` sends everything BELOW the pivot backwards, which is the ~18° off
  // vertical the grip is famous for. Negative would stand it out over the
  // trigger guard, which is a Luger.
  const gripPivot = b.pivot("gripPivot", 0, -0.078, -0.108, GRIP_RAKE);
  b.box("grip", POLYMER, 0.03, 0.094, 0.05, 0, -0.047, 0, gripPivot);
  for (const side of [-1, 1] as const) {
    b.box("gripPanel", RUBBER, 0.006, 0.078, 0.046, side * 0.017, -0.046, 0, gripPivot);
    b.box("gripScrew", METAL, 0.005, 0.007, 0.007, side * 0.019, -0.046, 0.008, gripPivot);
  }
  // Front strap checkering and the flat mainspring housing behind it, as bands
  // in the lighter receiver tone — the grip's only texture at this distance.
  for (let i = 0; i < 4; i++) {
    b.box("strapRib", BODY, 0.026, 0.007, 0.008, 0, -0.024 - i * 0.019, 0.025, gripPivot);
  }
  b.box("mainspring", BODY, 0.028, 0.088, 0.011, 0, -0.047, -0.026, gripPivot);
  b.box("lanyard", METAL, 0.012, 0.012, 0.008, 0, -0.092, -0.024, gripPivot);

  // The pistol itself is finished. Merged before the sight is built, so the
  // sight's parts land in their own colour groups exactly as an optic's do.
  const meshes = b.merge("pistol", root);

  // --- the magazine, in a node of its own so the reload can drop it ---
  // The only magazine in the kit that is INSIDE the weapon: all a seated one
  // shows is the floorplate under the grip. So the body is built too, sized to
  // sit wholly within the grip's walls — invisible while it is home, and the
  // whole point of the animation the moment it slides out. It leaves along the
  // grip's own rake (`magDrop`), which at 18° off vertical is the difference
  // between a magazine coming out and one passing through the front strap.
  const magazine = new TransformNode(`${prefix}_magazine`, scene);
  magazine.parent = root;
  // Held clear of the grip's own walls on every face — a body sized flush with
  // the cavity would share its bottom plane with the grip and z-fight along it
  // the moment the floorplate below stopped covering the seam.
  b.box("magBody", METAL, 0.022, 0.08, 0.04, 0, -0.05, 0.002, gripPivot);
  b.box("magFloor", METAL, 0.032, 0.008, 0.056, 0, -0.096, 0.002, gripPivot);
  b.box("magPad", RUBBER, 0.03, 0.008, 0.05, 0, -0.103, 0.002, gripPivot);
  meshes.push(...b.merge("pistolMag", magazine));

  // Every colour group the weapon itself merged, taken before the sight is
  // built. The sidearm is offered no finishes — it is not on the kit screen —
  // so nothing ever repaints these; the list is handed back because
  // `WeaponParts` is one shape for every weapon, not five.
  const finish = b.takeFinish();

  const sight = buildFixedIrons(b, prefix, root);
  meshes.push(...sight.meshes);
  b.disposePivots();

  return {
    root,
    muzzle: new Vector3(0, 0, 0.16),
    // Matches the `ejectPort` box above: the right side of the slide, high up.
    ejectPort: new Vector3(0.024, 0.014, 0.022),
    grip: { hand: GRIP_HAND, elbow: GRIP_ELBOW },
    support: { hand: SUPPORT_HAND, elbow: SUPPORT_ELBOW },
    magHand: MAG_HAND,
    magazine,
    magDrop: magDropAxis(GRIP_RAKE),
    finish,
    sights: { kind: "fixed", sight: "iron", assembly: sight },
    meshes,
  };
}

/**
 * The slide's own sights: a square notch on a dovetailed rear block, a blade up
 * front, and three tritium dots.
 *
 * Both stand to exactly `SIGHT_Y`, so lining the blade up in the notch lines
 * both up with the point ADS puts on the camera axis — the picture is right by
 * construction rather than by tuning, which is the same guarantee `optics.ts`
 * gets by putting its post tip and aperture centre on one height.
 *
 * The eye reference is the NOTCH, for the reason the aperture is on the irons:
 * it is the thing you look through, and the blade lands on the axis behind it
 * for free.
 */
function buildFixedIrons(
  b: WeaponBuild,
  prefix: string,
  parent: TransformNode,
): SightAssembly {
  const node = new TransformNode(`${prefix}_sight_iron`, b.scene);
  node.parent = parent;

  // Rear: a dovetail block with two posts, the notch being the gap between
  // them. Two boxes rather than one with a cut, for the reason everything here
  // is additive — there is no way to take a square out of a box.
  b.box("rearBase", METAL, 0.026, 0.007, 0.014, 0, 0.0325, REAR_SIGHT_Z);
  for (const side of [-1, 1] as const) {
    b.box("rearPost", METAL, 0.0075, 0.012, 0.011, side * 0.0083, 0.041, REAR_SIGHT_Z);
  }
  // Front: a dovetailed blade on its own base, its tip on the same line.
  b.box("frontBase", METAL, 0.014, 0.007, 0.014, 0, 0.0325, FRONT_SIGHT_Z);
  b.box("frontBlade", METAL, 0.006, 0.012, 0.009, 0, 0.041, FRONT_SIGHT_Z);
  b.merge("iron", node);

  // Three dots — two flanking the notch, one on the blade. The only thing on
  // this weapon visible against a dark treeline, and the reason the sidearm is
  // usable at night at all.
  //
  // Each stands well PROUD of the face it is set into, and that is not styling:
  // the outline pass draws a black shell 0.004 out along every normal, so a dot
  // sunk flush with its own post is swallowed by the post's ink and the sight
  // goes dark exactly when it is needed. Same rule as the player's visor slit
  // and the lamp lens.
  for (const dot of [
    { x: -0.0083, z: REAR_SIGHT_Z - 0.011 },
    { x: 0.0083, z: REAR_SIGHT_Z - 0.011 },
    { x: 0, z: FRONT_SIGHT_Z - 0.011 },
  ]) {
    const bead = b.lit(
      MeshBuilder.CreateSphere(
        `${prefix}_sightDot`,
        { diameter: 0.005, segments: 6 },
        b.scene,
      ),
      node,
    );
    bead.position.set(dot.x, SIGHT_Y - 0.004, dot.z);
  }

  const sightCenter = new TransformNode(`${prefix}_iron_sightCenter`, b.scene);
  sightCenter.parent = node;
  sightCenter.position = new Vector3(0, SIGHT_Y, REAR_SIGHT_Z);
  // The builder has already parented its merged colour groups and its dots to
  // `node`, so the node itself is the list — the same bookkeeping-free rule
  // `buildOptics` follows.
  return { root: node, sightCenter, meshes: node.getChildMeshes(true) as Mesh[] };
}
