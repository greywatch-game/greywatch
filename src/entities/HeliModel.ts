/**
 * HeliModel.ts — The helicopter: a light gunship on skids, with a REMOTE door
 * gun and no cannon at all.
 * Owns: this kind's geometry, its two palettes and the closure that turns its
 * two discs. Owns NO behaviour and no physics — `entities/Vehicle.ts` flies it
 * and has never heard of this file, `config/vehicles.ts` holds every number the
 * flight model reads, and `entities/vehicleRig.ts` is the shape this comes out
 * in.
 *
 * ## What it is, and what it is FOR
 *
 * Sarab is 900 m across and the ground between its flags is transit rather than
 * fighting — the problem both other kinds already answer, and the two halves of
 * it neither can reach are the WADI, whose three fords are the only places a
 * hull may cross and are therefore the only places worth watching, and the high
 * ground, which no hull reaches at all. This crosses both in a straight line
 * and puts a gun over a flag from a bearing nothing else has.
 *
 * What it pays is everything a fast thing pays and two things more. It has **no
 * main gun** — its only weapon is the door gun the second man lays, so a lone
 * pilot is a taxi — and its rotor disc is **10.4 m across**, which is
 * `drive.collideRadius` and is what closes the old town's seven-metre alleys to
 * it without a rule being written anywhere. It is also the one kind **no bot
 * will ever fly**: there is no route graph through the air, so `VehicleCrew`
 * refuses the pilot's chair and the pad sits idle until a player takes it.
 *
 * ## Nothing on this may promise a man, and here that rule bites twice
 *
 * `TruckModel`'s header states it: there is no player model in this game, so a
 * shape that visibly needs a body behind it is a shape with nobody behind it. A
 * door gunner is the exact failure that rule describes — a spade-gripped gun in
 * an open doorway with nothing in the doorway — so the answer is the truck's,
 * moved to the sill: a small REMOTE station on a stub pylon, with a cradle, a
 * shield and an optic head, no grips and nowhere to stand. The cabin glazing is
 * dark and shallow for the same reason the truck's is, and the crew are inside
 * it.
 *
 * ## The disc is drawn to be READ, which is not the same as drawn to be right
 *
 * Four blades at a real 26 rad/s alias into a stopped or backwards disc at
 * 60 Hz, which is the one thing this model cannot afford: the rotor IS the
 * silhouette. `flight.rotorRate` is therefore about two revolutions a second,
 * which is slow enough to track and fast enough to read as a rotor.
 *
 * **There is no tip-path ring, and that is a thing tried and photographed
 * rather than a thing not thought of.** A thin torus at blade radius is the
 * standard trick and it is wrong in THIS renderer for a reason that generalises
 * to anything long and thin here: `inkRig` gives every mesh a 2 cm outline
 * hull, so a 3 cm rim is very nearly all ink and comes back as a heavy black
 * hoop — and a hoop round a PARKED aircraft reads as a cage bolted to it rather
 * than as a disc that is turning. (It was worse before that: `Cyl` builds a
 * SOLID, so the first attempt drew a 10.4 m black plate over the whole machine
 * and everything under it.) The blades alone carry it.
 *
 * ## The budget
 *
 * Nineteen meshes, eleven of which move — under the truck's 22 and the tank's
 * 26, because a helicopter is mostly one smooth body with the motion
 * concentrated in two discs. The rule is `TankModel`'s: cost is COLOURS PER
 * SEGMENT and a part in a colour its segment already carries is free, so a mesh
 * is bought only for something that MOVES differently from everything around
 * it.
 *
 * ## Three clearances this drawing owes
 *
 * - **Nothing on the fuselage inside the main disc above cabin roof level**,
 *   and nothing at all inside the tail rotor's. This kind's version of the rule
 *   the tank's turret and the truck's station already have.
 * - **The collider box EXCLUDES the disc.** A round must not stop on air, so
 *   the box is the fuselage and the disc's only presence in the world is
 *   `drive.collideRadius`, which is what keeps a hull out of gaps.
 * - **`mgMuzzle` clears the skid at `mg.pitchMin`**, measured off
 *   `getAbsolutePosition()` with the gun laid abeam and fully depressed rather
 *   than derived — the number `TruckModel` calls its tightest.
 */
import { Scene, TransformNode } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { CelMaterialFactory } from "../shaders/CelShader";
import type { Team } from "./Combatant";
import {
  type Box,
  type Cyl,
  inkRig,
  paintRig,
  segmentOf,
  setAntennaBend,
  type VehicleRig,
  type Whip,
} from "./vehicleRig";

/** One team's palette. `TruckModel`'s seven roles less the tyre it has no use for. */
interface HeliKit {
  body: string;
  frame: string;
  metal: string;
  glass: string;
  stow: string;
  accent: string;
}

/**
 * The two liveries.
 *
 * Told apart the three ways `CLAUDE.md` requires — hue, accent and silhouette —
 * and the third is free here: the accent is on a TAILBOOM and a FIN, which are
 * the two parts of a helicopter still legible when the fuselage is four pixels
 * wide. The marking stands proud of the panel it sits on rather than flush with
 * it — a flash inside its own plate's 2 cm ink hull is no marking at all, which
 * is what the gun truck's flank cost before it was photographed.
 */
const KITS: readonly HeliKit[] = [
  {
    body: "#6f6647",
    frame: "#2b2a26",
    metal: "#6f6b60",
    glass: "#2b3537",
    stow: "#a1957a",
    accent: CONFIG.teams[0].color,
  },
  {
    body: "#55626d",
    frame: "#25282c",
    metal: "#616872",
    glass: "#27302f",
    stow: "#8d97a1",
    accent: CONFIG.teams[1].color,
  },
];

// --- the airframe, in the rig's coordinates --------------------------------
//
// `Vehicle` parents the rig half a hull below the collider's origin, so y = 0
// here is the BOTTOM of the box and the skids stand on it.

/** How far out the two skid runners stand. The gauge, and the roll stance. */
const SKID_X = 1.16;
/** Half the skid's length — the contact patch, fore and aft. */
const SKID_REACH = 1.9;
/** Skid tube radius, and therefore how high the fuselage floats over the pad. */
const SKID_R = 0.085;
/** The gauge `Vehicle` splits one hull speed into two side speeds with. */
const SKID_TRACK = SKID_X * 2;

/** The cabin floor, and the top of the cabin. */
const FLOOR_Y = 0.72;
const ROOF_Y = 2.42;
/** Half the fuselage's width over its panels — inside the collider's 2.6. */
const BODY_HW = 1.16;
/** The nose, and where the cabin gives way to the tailboom. */
const NOSE_Z = 4.4;
const CABIN_BACK_Z = -0.6;
/** The tail rotor's plane. Inside the collider's own half-length. */
const TAIL_Z = -5.42;

/** The mast's head: where the disc turns, just over the collider's roof. */
const HUB_Y = 3.02;
/**
 * The main disc's radius, and **the number the physics reads off this
 * drawing**: `drive.collideRadius` is this, so what the world keeps a
 * helicopter out of is its rotor and not its fuselage.
 */
const ROTOR_R = 5.2;
/** How many blades, and how wide each chord is. */
const BLADES = 4;
const BLADE_W = 0.3;
/** The tail rotor, which turns about x and is geared up off the same figure. */
const TAIL_R = 1.02;
const TAIL_GEAR = 5.1;

/** The door gun's ring, let into the port sill. */
const RING_Y = FLOOR_Y + 0.32;
const RING_Z = 0.34;

/** The one wire aerial's length, off the boom. */
const ANTENNA_LENGTH = 1.15;

/**
 * Builds one helicopter in a team's colours.
 *
 * Built once per hardstanding and never disposed inside a round — the rule both
 * other models follow and for their reason. `VehicleRig.reset` is what a fresh
 * one goes through instead.
 */
export function buildHeli(
  scene: Scene,
  mats: CelMaterialFactory,
  team: Team,
): VehicleRig {
  const kit = KITS[team];
  const t = CONFIG.vehicles.heli;
  // Built to the collider's own extents rather than to numbers of its own, so
  // the shape a round stops on and the shape a player aims at cannot drift.
  const L = t.hull.length;
  const tailTipZ = -(L / 2 - 0.28);
  const ringX = -BODY_HW;

  const root = new TransformNode("heli", scene);
  const hull = new TransformNode("heli-hull", scene);
  hull.parent = root;
  // Everything the springs carry, which here is everything except the skids.
  const sprung = new TransformNode("heli-sprung", scene);
  sprung.parent = hull;

  const { meshes, livery, segment } = segmentOf(scene, mats);

  // --- the skids ------------------------------------------------------------
  //
  // On `hull` and not on `sprung`, which is the same split a tank's tracks and
  // a truck's wheels take: the running gear lies on the ground it found and the
  // body is what moves against it. On this kind that is what makes a landing
  // legible — the fuselage settles onto its skids and rebounds.
  const skidBoxes: Box[] = [];
  const skidCyls: Cyl[] = [];
  for (const sx of [-1, 1]) {
    const x = SKID_X * sx;
    skidCyls.push([SKID_R * 2, SKID_REACH * 2, x, SKID_R, 0.16, kit.frame, "z"]);
    // The forward curl, so the runner does not end in a flat face.
    skidCyls.push([
      SKID_R * 2,
      0.5,
      x,
      SKID_R + 0.09,
      SKID_REACH + 0.06,
      kit.frame,
      "z",
    ]);
    for (const sz of [1.16, -0.92]) {
      // The struts up to the floor.
      skidBoxes.push([
        0.1,
        FLOOR_Y - SKID_R,
        0.16,
        x * 0.94,
        (FLOOR_Y + SKID_R) / 2,
        sz,
        kit.frame,
      ]);
      // Wear shoes: the one place a skid is a different colour, and they are
      // what says this thing lands on them.
      skidBoxes.push([0.14, 0.06, 0.34, x, SKID_R - 0.02, sz, kit.metal]);
    }
  }
  // The cross tubes, which are what makes a pair of runners one undercarriage.
  for (const sz of [1.16, -0.92]) {
    skidCyls.push([
      SKID_R * 1.7,
      SKID_TRACK,
      0,
      FLOOR_Y - 0.06,
      sz,
      kit.frame,
      "x",
    ]);
  }
  segment("heli-skid", hull, skidBoxes, skidCyls);

  // --- the fuselage ---------------------------------------------------------
  //
  // One smooth body, so almost all of it merges to one mesh. The nose is built
  // as a short staircase for `TankModel`'s glacis reason — a box cannot have a
  // corner taken off it — and the boom is a taper rather than a tube, which is
  // the one line that says "helicopter" from a kilometre away.
  const bodyBoxes: Box[] = [
    // The cabin: floor, sides and roof as one mass.
    [
      BODY_HW * 2,
      ROOF_Y - FLOOR_Y,
      3.6,
      0,
      (ROOF_Y + FLOOR_Y) / 2,
      1.3,
      kit.body,
    ],
    // The nose, dropping and narrowing in three steps.
    [BODY_HW * 1.86, 1.34, 0.9, 0, FLOOR_Y + 0.72, 3.42, kit.body],
    [BODY_HW * 1.6, 1.06, 0.72, 0, FLOOR_Y + 0.56, 4.0, kit.body],
    [BODY_HW * 1.2, 0.7, 0.42, 0, FLOOR_Y + 0.4, NOSE_Z, kit.body],
    // The chin, under the screen — where the avionics live on the real thing.
    [BODY_HW * 1.5, 0.36, 1.5, 0, FLOOR_Y - 0.05, 3.5, kit.body],
    // The transition into the boom, and the boom itself in two tapering steps.
    [BODY_HW * 1.5, 1.2, 0.9, 0, FLOOR_Y + 0.92, CABIN_BACK_Z, kit.body],
    [0.72, 0.6, 2.4, 0, 1.68, -1.9, kit.body],
    [0.5, 0.44, 2.4, 0, 1.74, -4.0, kit.body],
    // The fin, raked, with the tail rotor's gearbox on it.
    [0.22, 1.5, 1.5, 0, 2.28, TAIL_Z + 0.22, kit.body, 0.22],
    [0.42, 0.5, 0.5, 0, 2.12, TAIL_Z, kit.frame],
    // The horizontal stabiliser, which stops the boom reading as a pipe.
    [2.5, 0.1, 0.66, 0, 1.8, -3.5, kit.body],
    [0.1, 0.42, 0.6, 1.2, 1.94, -3.5, kit.body],
    [0.1, 0.42, 0.6, -1.2, 1.94, -3.5, kit.body],
    // The engine deck behind the mast, and the exhaust turned outboard.
    [1.5, 0.44, 1.7, 0, ROOF_Y + 0.2, 0.2, kit.frame],
    [0.5, 0.36, 0.36, 0.86, ROOF_Y + 0.22, -0.5, kit.metal, 0, 0.3],
    // The intake, facing forward over the cabin.
    [0.9, 0.3, 0.24, 0, ROOF_Y + 0.24, 1.16, kit.metal],
    // The mast, standing out of the deck.
    [0.34, 0.62, 0.34, 0, ROOF_Y + 0.42, 0.2, kit.frame],
    // The step under each door, which is the part of a helicopter a crew uses.
    [0.5, 0.06, 0.7, BODY_HW, FLOOR_Y - 0.16, 0.9, kit.frame],
    [0.5, 0.06, 0.7, -BODY_HW, FLOOR_Y - 0.16, 0.9, kit.frame],
  ];
  const bodyCyls: Cyl[] = [
    // The boom's tail cone, closing the taper.
    [0.5, 0.5, 0, 1.76, tailTipZ, kit.body, "z", 0.3],
    // A landing light in the chin, and the pitot on the nose.
    [0.16, 0.1, 0, FLOOR_Y - 0.16, 3.9, kit.metal, "y"],
    [0.05, 0.5, 0, FLOOR_Y + 0.62, NOSE_Z + 0.2, kit.metal, "z"],
  ];
  segment("heli-body", sprung, bodyBoxes, bodyCyls);

  // --- the glazing ----------------------------------------------------------
  //
  // Dark and shallow, for the gun truck's reason: the crew are INSIDE, and a
  // pane you could resolve a shape through is a pane with no shape behind it.
  // Drawn rather than built with `Build.pane` — a vehicle carries no breakable
  // glass and is in nobody's pane index.
  segment("heli-glass", sprung, [
    // The windscreen, raked over the nose.
    [BODY_HW * 1.7, 1.15, 0.16, 0, FLOOR_Y + 0.95, 3.06, kit.glass, -0.42],
    // The chin bubbles either side of it — the shape that says "cockpit".
    [0.66, 0.5, 0.5, 0.52, FLOOR_Y + 0.3, 3.5, kit.glass, -0.3],
    [0.66, 0.5, 0.5, -0.52, FLOOR_Y + 0.3, 3.5, kit.glass, -0.3],
    // The cabin windows, a shallow slot each side.
    [0.1, 0.55, 1.5, BODY_HW, FLOOR_Y + 1.15, 1.9, kit.glass],
    [0.1, 0.55, 1.5, -BODY_HW, FLOOR_Y + 1.15, 1.9, kit.glass],
    // …and the door on the starboard side, which is the one without the gun.
    [0.1, 0.5, 1.0, BODY_HW, FLOOR_Y + 0.5, 0.4, kit.glass],
  ]);

  // --- the team's colour ----------------------------------------------------
  //
  // On the BOOM and the FIN, which are what is left of a helicopter's shape at
  // range, and standing proud of the panel — a flash flush with a plate is
  // drawn inside that plate's own outline and is no marking at all. Some of it
  // faces every direction, which is what the conventions require of an accent.
  segment("heli-mark", sprung, [
    // A band round the boom: visible from both flanks and from below.
    [0.86, 0.7, 0.7, 0, 1.68, -2.6, kit.accent],
    // The fin's cap, the highest thing on the aircraft after the disc.
    [0.34, 0.5, 0.9, 0, 2.94, TAIL_Z + 0.34, kit.accent, 0.22],
    // …and a chevron on the nose, for the one bearing the other two miss.
    [0.66, 0.16, 0.24, 0, FLOOR_Y + 0.86, NOSE_Z - 0.06, kit.accent],
  ]);

  // --- what is strapped to it ----------------------------------------------
  segment("heli-stow", sprung, [
    // A rolled cargo net and two cans on the cabin floor, seen through the door.
    [0.7, 0.3, 0.3, 0.3, FLOOR_Y + 0.2, 0.2, kit.stow],
    [0.28, 0.36, 0.24, -0.2, FLOOR_Y + 0.22, 1.5, kit.stow],
    [0.28, 0.36, 0.24, 0.15, FLOOR_Y + 0.22, 1.8, kit.stow],
    // …and a fairing on the boom's spine.
    [0.28, 0.12, 0.9, 0, 2.06, -1.5, kit.stow],
  ]);

  // --- the two discs --------------------------------------------------------
  const mainRotor = new TransformNode("heli-rotor", scene);
  mainRotor.parent = sprung;
  mainRotor.position.set(0, HUB_Y, 0.2);
  const rotorBoxes: Box[] = [];
  for (let i = 0; i < BLADES; i++) {
    // Built about the node's own origin and rotated into place, so the closure
    // has one number to write.
    const a = (i / BLADES) * Math.PI * 2;
    rotorBoxes.push([
      BLADE_W,
      0.055,
      ROTOR_R - 0.5,
      (Math.sin(a) * ROTOR_R) / 2,
      0.04,
      (Math.cos(a) * ROTOR_R) / 2,
      kit.frame,
      0,
      a,
    ]);
  }
  segment("heli-rotor", mainRotor, rotorBoxes, [
    // The head, and the swash under it.
    [0.44, 0.26, 0, 0, 0, kit.metal, "y"],
    [0.62, 0.1, 0, -0.16, 0, kit.metal, "y"],
  ]);

  const tailRotor = new TransformNode("heli-tail-rotor", scene);
  tailRotor.parent = sprung;
  tailRotor.position.set(0.3, 2.12, TAIL_Z);
  const tailBoxes: Box[] = [];
  for (let i = 0; i < 2; i++) {
    const a = (i / 2) * Math.PI;
    tailBoxes.push([0.05, 0.2, TAIL_R * 2 - 0.18, 0, 0, 0, kit.frame, a]);
  }
  segment("heli-tail-rotor", tailRotor, tailBoxes, [
    [0.24, 0.14, 0, 0, 0, kit.metal, "x"],
  ]);

  // --- the door gun ---------------------------------------------------------
  //
  // **`turret` is INERT, and that is `TruckModel`'s arrangement verbatim.**
  // `spec.gun` is null, so `Vehicle` holds `turretYaw` equal to the hull's own
  // yaw and the local angle written here is a permanent zero. It exists so that
  // `mgMount` has the same parent it has on a tank and `aimMg` needs no branch
  // of its own. Drawn as the collar the station is let into.
  const turret = new TransformNode("heli-ring", scene);
  turret.parent = sprung;
  segment("heli-ring", turret, [
    [0.3, 0.24, 0.7, ringX - 0.06, RING_Y, RING_Z, kit.frame],
  ]);

  const mgMount = new TransformNode("heli-mg-mount", scene);
  mgMount.parent = turret;
  mgMount.position.set(ringX - 0.24, RING_Y, RING_Z);
  segment("heli-mg-ring", mgMount, [
    // The pylon and the cradle it carries. No grips, nowhere to stand.
    [0.16, 0.3, 0.16, 0, -0.16, 0, kit.frame],
    [0.34, 0.2, 0.4, 0, 0.02, 0, kit.frame],
    // The shield, outboard of the trunnion.
    [0.06, 0.42, 0.44, -0.2, 0.06, 0, kit.metal],
  ]);

  const mgGun = new TransformNode("heli-mg-gun", scene);
  mgGun.parent = mgMount;
  segment(
    "heli-mg",
    mgGun,
    [
      // The receiver, the ammo can under it and the buffer behind.
      [0.16, 0.18, 0.62, 0, 0.05, 0.04, kit.frame],
      [0.2, 0.22, 0.3, 0, -0.14, -0.06, kit.frame],
      [0.12, 0.12, 0.22, 0, 0.05, -0.36, kit.frame],
      // **The OPTIC**, which is the pale thing that says where the gun is
      // looking — the truck station's one lesson about what an eye tracks.
      [0.12, 0.12, 0.2, 0, 0.2, 0.1, kit.metal],
    ],
    [
      // The barrel and its jacket.
      [0.06, 0.9, 0, 0.05, 0.72, kit.metal, "z"],
      [0.1, 0.34, 0, 0.05, 0.46, kit.frame, "z"],
    ],
  );

  const mgMuzzle = new TransformNode("heli-mg-muzzle", scene);
  mgMuzzle.parent = mgGun;
  mgMuzzle.position.set(0, 0.05, 1.18);

  // --- the aerial -----------------------------------------------------------
  const whipBase = new TransformNode("heli-whip-base", scene);
  whipBase.parent = sprung;
  whipBase.position.set(-0.24, 2.0, -1.2);
  const whipTip = new TransformNode("heli-whip-tip", scene);
  whipTip.parent = whipBase;
  whipTip.position.y = ANTENNA_LENGTH / 2;
  segment("heli-whip-lo", whipBase, [
    [0.03, ANTENNA_LENGTH / 2, 0.03, 0, ANTENNA_LENGTH / 4, 0, kit.frame],
  ]);
  segment("heli-whip-hi", whipTip, [
    [0.025, ANTENNA_LENGTH / 2, 0.025, 0, ANTENNA_LENGTH / 4, 0, kit.frame],
  ]);
  // One mast, so it IS the longest and answers at the reference rate. See
  // `Whip.rate`.
  const antennae: readonly Whip[] = [
    { base: whipBase, tip: whipTip, rate: 1, phase: 0 },
  ];

  inkRig(meshes);

  const rig: VehicleRig = {
    root,
    hull,
    sprung,
    turret,
    // **No main gun, and these two nulls are what the rest of the game reads it
    // as** — through `Vehicle.armed`. A pilot has no trigger, the HUD's loader
    // row is absent rather than dimmed, and the gun marker follows the door gun
    // in both seats.
    gun: null,
    muzzle: null,
    mgMount,
    mgGun,
    mgMuzzle,
    antennae,
    meshes,
    livery,
    gauge: SKID_TRACK,
    contactReach: SKID_REACH,
    // The skids ARE the suspension and the contact patch at once, exactly as a
    // truck's axles are, so the two figures `VehicleRig` insists on stating
    // separately are the same number here — and it is stated twice rather than
    // aliased, because the day one of them moves is the day that matters.
    wheelReach: SKID_REACH,
    setRun: (_left, _right, _steer, rotor) =>
      setRotorRun(mainRotor, tailRotor, rotor),
    reset: () => resetHeliPose(rig, mats),
    paint: (wrecked) => paintRig(meshes, livery, mats, wrecked),
  };
  return rig;
}

/**
 * Turns both discs to where the rotor has RUN to, in radians.
 *
 * The first three arguments are the ground kinds' and are ignored here for the
 * reason a tank ignores the steer: a helicopter's powerplant does not drive its
 * skids, so how far each side has "covered" says nothing about it. See
 * `VehicleRig.setRun`.
 *
 * **The gear ratio between the two is a DRAWING decision and lives here**, not
 * in the config: what `Vehicle` holds is one rotor angle, and how much faster
 * the tail turns than the main is a fact about this aircraft's transmission and
 * about nothing else. The remainder is taken the long way for `setWheelRun`'s
 * reason — `%` keeps the sign of its left operand in JS.
 */
function setRotorRun(
  main: TransformNode,
  tail: TransformNode,
  rotor: number,
): void {
  const two = Math.PI * 2;
  main.rotation.y = ((rotor % two) + two) % two;
  tail.rotation.x = (((rotor * TAIL_GEAR) % two) + two) % two;
}

/**
 * Puts a rig back to how it was built — every joint at rest, both discs back at
 * the start of their turn and the paint back on. What a hull goes through on
 * the respawn timer, and the whole reason a destroyed helicopter is repainted
 * rather than replaced.
 */
function resetHeliPose(rig: VehicleRig, mats: CelMaterialFactory): void {
  rig.hull.rotation.set(0, 0, 0);
  rig.sprung.position.y = 0;
  rig.sprung.rotation.set(0, 0, 0);
  rig.turret.rotation.set(0, 0, 0);
  rig.mgMount.rotation.set(0, 0, 0);
  rig.mgGun.rotation.set(0, 0, 0);
  rig.setRun(0, 0, 0, 0);
  const share = CONFIG.vehicles.heli.antenna.baseShare;
  for (const w of rig.antennae) setAntennaBend(w, share, 0, 0, 0, 0);
  paintRig(rig.meshes, rig.livery, mats, false);
}
