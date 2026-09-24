/**
 * PistolModel.ts — Builds the sidearm, a Colt M45A1 — the Marine Corps' modern
 * 1911 — drawn from photographs, along with the fixed notch-and-blade sight
 * machined into its own slide.
 * Returns WeaponParts exactly as the primaries do, so `ViewModel` carries it
 * with nothing re-tuned: the only thing that makes it a sidearm is that
 * `weapons.ts` keeps it out of `PRIMARY_WEAPON_IDS`.
 * Invariants: assembled at the origin with the root at identity and merged
 * before it is moved — `weaponKit.ts` owns that contract and the primitives.
 *
 * It is the ONE weapon that does not call `optics.ts`, and that is the whole
 * point of `WeaponSights`' `fixed` shape rather than an oversight: what stands
 * on the back of the slide is a square notch rather than the rear aperture
 * every optic set here is built around. The one rule that matters is still
 * obeyed — the assembly reports a `sightCenter`, and `ViewModel.applyFit`
 * derives the aimed pose from it the same way it does for a holo — so the
 * reticle is the point of impact here for the same reason it is everywhere
 * else. Nothing about the eye reference is duplicated; only the geometry in
 * front of it is this weapon's own.
 *
 * Local +z is the barrel axis and the BORE is at y = 0, the same frame the long
 * guns are built in, so the shared helpers (`tube`, `shell`) lay rings around
 * the barrel without an offset and the viewmodel poses it with the same
 * numbers. Units are the models' throughout: ~1.4 per metre, which puts this
 * weapon at 0.33 long against the rifle's 1.27.
 */
import { Mesh, MeshBuilder, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import type { CelMaterialFactory } from "../shaders/CelShader";
import {
  BODY,
  METAL,
  magDropAxis,
  POLYMER,
  RUBBER,
  spanRing,
  WeaponBuild,
  type SightAssembly,
  type WeaponParts,
} from "./weaponKit";

/**
 * The grip's rake — the 1911's signature ~18° off vertical, measured off the
 * front strap in a photograph, and the line the magazine inside it both stands
 * and drops along.
 */
const GRIP_RAKE = 0.31;

/** The slide's flat top, and the frame's rails under it. */
const SLIDE_TOP = 0.021;
const SLIDE_BOTTOM = -0.02;

/**
 * The line of sight: the top of the rear posts and of the front blade, which
 * are the same height by construction. This is where `sightCenter` goes, so it
 * is the height ADS puts on the camera axis — everything behind it on this
 * weapon (the hammer, the beavertail) has to stay UNDER it, or the gun stands
 * in its own sight picture. A notch is open-topped, so unlike an aperture there
 * is no cone to clear forward of the rear sight; the slide's own top deck runs
 * along below the line and is exactly what you are meant to see.
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
 * Hung LOWER, it is a fist under the gun rather than round it: the point is on
 * the grip's own centre line, halfway down, and the support hand and both
 * elbows moved with it so the forearms keep their angles.
 */
const GRIP_HAND = new Vector3(0.002, -0.118, -0.127);
const GRIP_ELBOW = new Vector3(0.237, -0.498, -0.504);
/**
 * The support hand does not hold a handguard here — there is nothing to hold.
 * It wraps the firing hand instead, which is why it sits inboard of and barely
 * ahead of the trigger hand rather than half a weapon further out. Staggered
 * from it in all three axes on purpose: level with it, the two fists read as
 * one wide slab under the weapon rather than as two hands.
 */
const SUPPORT_HAND = new Vector3(-0.05, -0.13, -0.086);
const SUPPORT_ELBOW = new Vector3(-0.302, -0.478, -0.344);

/**
 * Where the support hand goes for the magazine swap. Straight DOWN off the
 * grip, because that is where this weapon's magazine lives — the shared offset
 * in `CONFIG.viewmodel.magHandOffset` takes the hand back to a magwell under a
 * receiver, and applied here it throws the arm out behind the gun.
 */
const MAG_HAND = new Vector3(-0.02, -0.14, -0.03);

/**
 * How far the eye is held behind the notch when aimed (m) — this weapon's own,
 * since the table's "iron" figure is a rifle's. The notch, the blade and the
 * fists were all fitted against this distance.
 */
const PISTOL_EYE_RELIEF = 0.33;

/**
 * Builds a cel-styled Colt M45A1.
 *
 * The silhouette is the one everybody already knows, and what makes it this
 * 1911 rather than the 1911 is taken from photographs:
 *
 * - **The slide**: flat-topped with bevelled shoulders, the nose dropping over
 *   the recoil spring, and wide cocking serrations at BOTH ends.
 * - **The railed dust cover** under the nose, three slots long.
 * - **The frame's back end**: an upswept beavertail over the web of the hand
 *   and a ring hammer standing in front of it, both kept under the sight line.
 * - **The controls**, small and dark: the slide stop, an ambidextrous thumb
 *   safety and the round magazine catch, all where a thumb finds them.
 * - **The grip**: raked at 18°, a checkered front strap and a flat checkered
 *   mainspring housing, and panels with two screws each.
 * - **The sights**: a ramped rear with a square notch and a blade up front, with
 *   the three dots that make it usable at night.
 *
 * Built as the rifle is — bevelled profile slabs and contoured lofts, detail at
 * its real scale, controls small and dark, machining as dark inlays — see
 * `docs/weapons.md`'s procedural-models section.
 */
export function buildPistol(
  scene: Scene,
  mats: CelMaterialFactory,
  prefix: string,
): WeaponParts {
  const root = new TransformNode(`${prefix}_pistol`, scene);
  const b = new WeaponBuild(scene, mats, prefix, root);

  // --- slide: flat-topped, its nose dropping over the recoil spring ---
  b.slab("slide", BODY, [
    [0.143, -0.032],
    [0.143, SLIDE_TOP - 0.004],
    [0.139, SLIDE_TOP],
    [-0.134, SLIDE_TOP],
    [-0.138, SLIDE_TOP - 0.004],
    [-0.138, SLIDE_BOTTOM],
    [0.072, SLIDE_BOTTOM],
    [0.08, -0.025],
    [0.09, -0.032],
  ], 0.032, 0.005);
  // Cocking serrations at both ends, cut as dark grooves at their real pitch
  // and raked forward the way M45A1's are.
  const serrations = (name: string, z0: number, n: number): void => {
    for (let i = 0; i < n; i++) {
      const z = z0 + i * 0.0062;
      b.slab(name, RUBBER, [
        [z, -0.014],
        [z + 0.0026, -0.014],
        [z + 0.0046, SLIDE_TOP - 0.007],
        [z + 0.002, SLIDE_TOP - 0.007],
      ], 0.0326, 0);
    }
  };
  serrations("serrRear", -0.131, 8);
  serrations("serrFront", 0.086, 5);
  // Ejection port, right side, with the barrel's hood showing in it.
  b.slab("ejectPort", RUBBER, [
    [-0.006, 0.0],
    [0.054, 0.0],
    [0.054, 0.016],
    [-0.006, 0.016],
  ], 0.002, 0, 0.0158);
  b.slab("barrelHood", METAL, [
    [-0.002, 0.004],
    [0.048, 0.004],
    [0.048, 0.012],
    [-0.002, 0.012],
  ], 0.002, 0, 0.0162);
  // The markings flat on the left, as a few fine dark lines.
  for (const [y, len] of [[0.01, 0.07], [0.002, 0.05]] as const) {
    b.box("stamp", RUBBER, 0.002, 0.0026, len, -0.0162, y, 0.0 + len / 2);
  }

  // --- muzzle end: barrel bushing over the bore, recoil spring plug under it.
  // The dark core behind the bushing is what the bore reads against; without
  // something inside it the ring opens onto the skybox and the muzzle looks
  // like a hole in the model. ---
  b.tube("bore", RUBBER, 0.018, 0.018, 0.04, 0, 0, 0.126);
  b.shell("bushing", METAL, 0.019, 0.006, 0.014, 0, 0.146, 12);
  b.shell("plug", METAL, 0.008, 0.004, 0.01, -0.021, 0.146, 10);

  // --- frame: rails under the slide, the railed dust cover, the beavertail ---
  // The frame stands a millimetre inside the slide's flanks, which is the seam
  // between the two a slide is read by.
  b.slab("frame", POLYMER, [
    [0.076, SLIDE_BOTTOM],
    [-0.14, SLIDE_BOTTOM],
    [-0.15, -0.021],
    [-0.162, -0.022],
    [-0.171, -0.024],
    [-0.176, -0.029],
    [-0.174, -0.035],
    [-0.164, -0.04],
    [-0.154, -0.05],
    [-0.15, -0.064],
    [-0.066, -0.058],
    [-0.058, -0.04],
    [0.076, -0.04],
  ], 0.03, 0.003);
  b.picatinny("rail", 0, -0.04, 0.028, 3, { width: 0.024, height: 0.008, facing: "down" });
  // A grip safety's hinge line under the beavertail, and the pin through it.
  b.pin("tangPin", METAL, 0.006, 0.031, 0, -0.028, -0.146);

  // --- trigger guard and the flat sliding trigger inside it ---
  b.slab("guard", POLYMER, [
    [0.004, -0.04],
    [0.004, -0.066],
    [-0.006, -0.08],
    [-0.02, -0.084],
    [-0.074, -0.084],
    [-0.074, -0.077],
    [-0.022, -0.077],
    [-0.008, -0.074],
    [-0.003, -0.064],
    [-0.003, -0.04],
  ], 0.012, 0.002);
  b.slab("trigger", METAL, [
    [-0.036, -0.04],
    [-0.044, -0.04],
    [-0.046, -0.058],
    [-0.045, -0.071],
    [-0.039, -0.071],
    [-0.037, -0.058],
  ], 0.01, 0.0015);

  // --- controls, small and dark, all where a right thumb finds them ---
  // Slide stop on the left, its thumb piece rising at the back.
  b.slab("slideStop", BODY, [
    [-0.012, -0.024],
    [-0.048, -0.022],
    [-0.06, -0.017],
    [-0.066, -0.021],
    [-0.058, -0.033],
    [-0.012, -0.031],
  ], 0.003, 0.0008, -0.0165);
  b.pin("slideStopPin", METAL, 0.007, 0.032, 0, -0.027, -0.012);
  // The thumb safety, ambidextrous, its paddle over the top of the grip panel.
  for (const side of [-1, 1] as const) {
    b.slab("safety", BODY, [
      [-0.1, -0.021],
      [-0.128, -0.021],
      [-0.134, -0.026],
      [-0.12, -0.032],
      [-0.1, -0.028],
    ], 0.003, 0.0008, side * 0.0165);
  }
  b.pin("magRelease", POLYMER, 0.011, 0.008, -0.018, -0.062, -0.075);

  // --- the hammer: a ring hammer, leaned back off the frame ---
  // Negative `rotX` is what leans the hammer BACK: a point above the pivot
  // takes `-sin(rotX)` along z (see the rake on the grip below, which is the
  // same rotation in the other direction and the other sign). Its top stays
  // under SIGHT_Y, since it sits between the eye and the rear notch.
  const hammerPivot = b.pivot("hammerPivot", 0, -0.014, -0.141, -0.5);
  b.slab("hammer", METAL, [
    [0.005, -0.004],
    [0.006, 0.014],
    [0.005, 0.022],
    [0.0, 0.029],
    [-0.008, 0.03],
    [-0.013, 0.025],
    [-0.013, 0.018],
    [-0.008, 0.01],
    [-0.007, -0.004],
  ], 0.01, 0.0015, 0, hammerPivot);
  // The ring: a dark hole through the head, both faces.
  // `pin` hangs off the root, so it is placed where the pivot puts the
  // head: (0.022, -0.005) in the hammer's frame, leaned back with it.
  b.pin("hammerRing", RUBBER, 0.007, 0.0105, 0, 0.0029, -0.1558);
  b.pin("hammerPin", METAL, 0.007, 0.031, 0, -0.014, -0.141);

  // --- grip: raked back off the frame ---
  // The rake is the 1911's signature and the sign is load-bearing: positive
  // `rotX` sends everything BELOW the pivot backwards. Negative would stand it
  // out over the trigger guard, which is a Luger.
  const gripPivot = b.pivot("gripPivot", 0, -0.046, -0.1, GRIP_RAKE);
  // `pin` hangs off the root rather than a pivot, so a pin on the grip is
  // placed through this: the grip's own (y, z) turned into the weapon's.
  const onGrip = (y: number, z: number): [number, number] => [
    -0.046 + y * Math.cos(GRIP_RAKE) - z * Math.sin(GRIP_RAKE),
    -0.1 + y * Math.sin(GRIP_RAKE) + z * Math.cos(GRIP_RAKE),
  ];
  b.upright("grip", POLYMER, [
    spanRing(-0.14, 0.03, 0.028, -0.042, 0.3),
    spanRing(-0.13, 0.032, 0.031, -0.044, 0.3),
    spanRing(-0.06, 0.032, 0.034, -0.044, 0.3),
    spanRing(-0.01, 0.032, 0.036, -0.043, 0.3),
    spanRing(0.012, 0.03, 0.036, -0.043, 0.3),
  ], gripPivot);
  // Checkering down the front strap and the flat mainspring housing, as dark
  // grooves at their real pitch.
  for (let i = 0; i < 12; i++) {
    const y = -0.03 - i * 0.008;
    b.box("strapCheck", RUBBER, 0.02, 0.0026, 0.004, 0, y, 0.0345 + (y + 0.01) * 0.042, gripPivot);
  }
  for (let i = 0; i < 11; i++) {
    b.box("mainspringCheck", RUBBER, 0.02, 0.0026, 0.004, 0, -0.05 - i * 0.008, -0.0425, gripPivot);
  }
  // The mainspring housing's pin, low across the heel.
  b.pin("housingPin", METAL, 0.005, 0.0326, 0, ...onGrip(-0.128, -0.036));
  // Panels, proud of the frame on both sides, each with its two screws and a
  // few diagonal cuts across the G10 — the grip's only texture at this
  // distance, and the only thing a closed fist leaves in view.
  for (const side of [-1, 1] as const) {
    b.slab("gripPanel", RUBBER, [
      [0.026, -0.018],
      [0.026, -0.124],
      [0.02, -0.13],
      [-0.03, -0.13],
      [-0.036, -0.124],
      [-0.036, -0.03],
      [-0.03, -0.018],
    ], 0.006, 0.0015, side * 0.0175, gripPivot);
    for (let i = 0; i < 5; i++) {
      const y = -0.04 - i * 0.018;
      b.slab("panelRidge", POLYMER, [
        [0.018, y],
        [0.022, y + 0.003],
        [-0.028, y + 0.012],
        [-0.03, y + 0.008],
      ], 0.0014, 0, side * 0.0208, gripPivot);
    }
    for (const y of [-0.03, -0.116] as const) {
      b.pin("gripScrew", METAL, 0.007, 0.0016, side * 0.0213, ...onGrip(y, -0.004));
    }
  }

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
  b.upright("magBody", METAL, [
    { y: -0.136, w: 0.022, d: 0.05, z: -0.004, k: 0.2 },
    { y: -0.02, w: 0.022, d: 0.05, z: -0.004, k: 0.2 },
  ], gripPivot);
  b.upright("magFloor", METAL, [
    { y: -0.145, w: 0.03, d: 0.07, z: -0.006, k: 0.3 },
    { y: -0.14, w: 0.03, d: 0.07, z: -0.006, k: 0.3 },
  ], gripPivot);
  b.upright("magPad", RUBBER, [
    { y: -0.155, w: 0.028, d: 0.066, z: -0.007, k: 0.35 },
    { y: -0.145, w: 0.03, d: 0.07, z: -0.006, k: 0.3 },
  ], gripPivot);
  meshes.push(...b.merge("pistolMag", magazine));

  // Every colour group the weapon itself merged, taken before the sight is
  // built. The sidearm is offered no finishes — it is not on the kit screen —
  // so nothing ever repaints these; the list is handed back because
  // `WeaponParts` is one shape for every weapon, not several.
  const finish = b.takeFinish();

  const sight = buildFixedIrons(b, prefix, root);
  meshes.push(...sight.meshes);
  b.disposePivots();

  return {
    root,
    muzzle: new Vector3(0, 0, 0.16),
    // Matches the `ejectPort` inlay above: the right side of the slide.
    ejectPort: new Vector3(0.024, 0.01, 0.024),
    grip: { hand: GRIP_HAND, elbow: GRIP_ELBOW },
    support: { hand: SUPPORT_HAND, elbow: SUPPORT_ELBOW },
    magHand: MAG_HAND,
    magazine,
    magDrop: magDropAxis(GRIP_RAKE),
    finish,
    // Held at arm's length rather than at a cheek weld: the rifle irons' eye
    // relief would put the notch a hand's width from the face.
    sights: { kind: "fixed", sight: "iron", assembly: sight, eyeRelief: PISTOL_EYE_RELIEF },
    meshes,
  };
}

/**
 * The slide's own sights: a ramped rear with a square notch, a blade up front
 * on its dovetail, and three tritium dots.
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

  // Rear: a low dovetailed body ramped up from the front — snag-free, the way
  // a carry sight is — and two posts, the notch being the gap between them.
  // A rear face that is square to the eye is what the notch is read against.
  b.slab("rearBase", METAL, [
    [-0.1215, SLIDE_TOP - 0.002],
    [-0.096, SLIDE_TOP - 0.002],
    [-0.1, SLIDE_TOP + 0.004],
    [-0.1215, SIGHT_Y - 0.01],
  ], 0.028, 0.0015);
  for (const side of [-1, 1] as const) {
    b.slab("rearPost", METAL, [
      [-0.1215, SLIDE_TOP],
      [-0.1, SLIDE_TOP + 0.004],
      [-0.112, SIGHT_Y],
      [-0.1215, SIGHT_Y],
    ], 0.0078, 0.001, side * 0.0085);
  }
  // Front: a blade on its own dovetailed base, its tip on the same line.
  b.slab("frontBase", METAL, [
    [FRONT_SIGHT_Z - 0.008, SLIDE_TOP - 0.002],
    [FRONT_SIGHT_Z + 0.008, SLIDE_TOP - 0.002],
    [FRONT_SIGHT_Z + 0.006, SLIDE_TOP + 0.005],
    [FRONT_SIGHT_Z - 0.006, SLIDE_TOP + 0.005],
  ], 0.014, 0.0015);
  b.slab("frontBlade", METAL, [
    [FRONT_SIGHT_Z - 0.0055, SLIDE_TOP],
    [FRONT_SIGHT_Z + 0.007, SLIDE_TOP],
    [FRONT_SIGHT_Z + 0.002, SIGHT_Y],
    [FRONT_SIGHT_Z - 0.0055, SIGHT_Y],
  ], 0.006, 0.001);
  b.merge("iron", node);

  // Three dots — two flanking the notch, one on the blade. The only thing on
  // this weapon visible against a dark treeline, and the reason the sidearm is
  // usable at night at all.
  //
  // Each stands well PROUD of the face it is set into, and that is not styling:
  // a dot sunk flush with its own post is swallowed by the post's ink and the
  // sight goes dark exactly when it is needed.
  for (const dot of [
    { x: -0.0085, z: REAR_SIGHT_Z - 0.011 },
    { x: 0.0085, z: REAR_SIGHT_Z - 0.011 },
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
