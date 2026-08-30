/**
 * HeliModel.ts — The helicopter: a tandem-seat ATTACK helicopter on skids, with
 * a chin cannon and no main gun at all.
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
 * main gun** — its only weapon is the chin cannon the second man lays, so a
 * lone pilot is a taxi — and its rotor disc is **10.4 m across**, which is
 * `drive.collideRadius` and is what closes the old town's seven-metre alleys to
 * it without a rule being written anywhere. It is also the one kind **no bot
 * will ever fly**: there is no route graph through the air, so `VehicleCrew`
 * refuses the pilot's chair and the pad sits idle until a player takes it.
 *
 * ## The gun moved to the CHIN, and that is the rule paying out rather than a
 * restyle
 *
 * `TruckModel`'s header states it: there is no player model in this game, so a
 * shape that visibly needs a body behind it is a shape with nobody behind it.
 * The first version of this aircraft was a light utility hull with a small
 * REMOTE station let into the port sill — the truck's answer, moved to a
 * doorway, and it was the right answer to the wrong drawing. **A doorway with a
 * gun in it is a promise of a man however remote the mount is**, because the
 * doorway is the part a player reads: it is an opening in the side of an
 * aircraft at chest height with a weapon on its lip, and the only thing that
 * fills one is somebody leaning out of it.
 *
 * An attack helicopter makes the same absence read correctly instead, exactly
 * as an armoured estate did for the pickup. There is no cabin and no doorway —
 * a narrow tandem fuselage, 1.44 m across, with the two crew one behind the
 * other under a stepped canopy too dark to resolve anything through — and the
 * gun is a TURRET under the nose, which is a fitting rather than a station and
 * needs nobody in any reading of it. The second seat is the same second seat:
 * `Vehicle.aimMg` holds the bearing in the world and did not move a line to
 * follow the gun down there.
 *
 * **What it also buys is a gun that clears its own airframe at nearly every
 * bearing.** A sill gun traversing to starboard swept the barrel through the
 * cabin it was bolted to; a chin turret hangs BELOW everything, so a full
 * traverse aft passes the barrel under the belly in clear air. The one place it
 * does not is stated in the clearances below.
 *
 * ## The stub wings are bounded by the COLLIDER, not by taste
 *
 * The stores are what says "attack helicopter" before the canopy or the turret
 * has landed, and the temptation is to hang them off a proper span. **A span
 * wider than `hull.width` is a wing rounds pass through**: the collider box is
 * the whole of this vehicle's physical presence and nothing may promise mass
 * outside it (the rotor disc is the one documented exception, and it is
 * exempted by MOVING). So `WING_TIP_X` is read off `t.hull.width / 2` rather
 * than written down, the tips land exactly on the box, and what fills the span
 * out is the DEPTH of what hangs under it — a rocket pod nearly two metres long
 * and a tip launcher beside it — rather than metres this hull does not own.
 *
 * The fuselage narrowing from 2.32 m to 1.44 m is what makes 2.6 m of span read
 * as wings at all. It is also the correct shape twice over: a gunship is narrow
 * because it is two seats wide and no more, and the narrower the body the more
 * of the collider is left for the thing bolted to it.
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
 * and everything under it.) The blades alone carry it, with pale tip caps in
 * the head's own `metal` — which cost nothing, and are what makes the disc read
 * as four blades rather than as a grey smear at the range this thing is fought
 * from.
 *
 * ## The budget
 *
 * **Eighteen meshes, ten of which move** — counted off `rig.meshes` in the
 * browser, not off the segments below — for about twice the parts the utility
 * version carried — under the truck's 22 and the tank's 26, and one FEWER than
 * the aircraft this replaces. That is the budget rule doing exactly what it is
 * for and it is `TruckModel`'s own story: cost is COLOURS PER SEGMENT and a
 * part in a colour its segment already carries is free, so the wings, the
 * pylons, the nacelles, the sensor, the keel, the stabiliser and the tail skid
 * are all free, and a mesh is bought only for something that MOVES differently
 * from everything around it.
 *
 * One colour changed hands rather than being added. `stow` is gone — a
 * gunship carries ordnance where a taxi carries cargo, and a rolled net on the
 * floor of an aircraft with no floor was a colour spent on nothing — and `ord`
 * replaces it, which is the one thing on this aircraft a player is meant to
 * find. It lives in the BODY segment, because a rocket pod does not move.
 *
 * **The inert `turret` node draws nothing at all**, which is where the
 * nineteenth mesh went. `spec.gun` is null, so `Vehicle` holds `turretYaw`
 * equal to the hull's own yaw and that node is a permanent local zero; the
 * barbette the chin turret turns in is therefore welded to the airframe, and a
 * part that cannot move belongs in the body segment where it is free. The node
 * still exists because `mgMount` must have the same parent it has on a tank —
 * see `VehicleRig.turret`.
 *
 * ## Four clearances this drawing owes
 *
 * Every figure below was MEASURED — off `getAbsolutePosition()` in the rig
 * root's own frame, on Sarab, with the gun posed to each limit — except the
 * FIN's, which is arithmetic: the fin is merged into a mesh whose bounding box
 * is the whole fuselage, so there is nothing to read it off.
 *
 * - **Nothing on the fuselage inside the main disc above the blade line**, and
 *   nothing at all inside the tail rotor's. The blades sweep at y 3.06 out to
 *   radius 4.95 from the mast at z 0.2 (this is the computed one), which is
 *   what puts the FIN's top edge where it is: it crosses the blade line at
 *   z -4.90, 5.10 from the mast and therefore 15 cm outside the tip, and it is
 *   what sets `TAIL_Z` and `TAIL_Y` — a tail rotor any higher or any further
 *   forward puts its own upper tip inside the main disc's radius. **The aerial
 *   is the one this caught.** The utility version stood a 1.15 m whip on the
 *   boom at z -1.2, whose tip reached 3.15 — six centimetres THROUGH the blade
 *   path, four times a revolution, for as long as that model existed.
 *   `ANTENNA_LENGTH` is 0.66 now and the mast is a blade aerial rather than a
 *   whip, which is what a gunship carries anyway; the tip measures **2.94**,
 *   9 cm under the blades, and every bend it can take moves the tip DOWN.
 * - **Nothing under the belly within `MG_REACH` of the barbette**, which is
 *   this kind's version of the truck's bare roof. The keel therefore stops at
 *   z 2.90 and the landing light sits behind it — a light, a cutter or an
 *   aerial anywhere inside that circle is something a traversing gun drives
 *   through. There WAS a lower wire cutter under the nose in the first draft,
 *   and this rule is what took it out.
 * - **The muzzle clears the PAD at `mg.pitchMin`, which is the tightest number
 *   in the file.** The trunnion is at 0.60 and full depression is -0.85 rad;
 *   the muzzle measures **y 0.074** over a pad the skids put at 0, having sat
 *   at 0.60 level. Unlike either other kind this limit is not measured against
 *   the vehicle's own bodywork — a chin turret is ahead of the skids and below
 *   everything — it is measured against the GROUND, and it has to be, because a
 *   bot gunner will lay this gun at full depression on a PARKED aircraft and a
 *   muzzle under the pad is a round spawned inside the terrain. Re-measure it
 *   if `MG_Y`, `MG_REACH` or `pitchMin` moves.
 * - **…and the FORWARD BELLY clears the barrel at `mg.pitchMax`**, which is the
 *   number that put the chin recess in the nose. Elevating while traversed AFT
 *   swings the muzzle up and back — measured at **y 0.904, z 4.120** — so the
 *   underside forward of z 3.80 is stepped up to `CHIN_Y` 0.95 and the barrel
 *   passes 4.6 cm under it. It is 20 cm of step and it is the whole reason the
 *   nose has a chin at all: at the belly's own 0.75 the gun drives through its
 *   own airframe at every aft bearing above about 12 degrees.
 *
 * **The collider box EXCLUDES the disc.** A round must not stop on air, so the
 * box is the airframe and the disc's only presence in the world is
 * `drive.collideRadius`, which is what keeps a hull out of gaps.
 *
 * ## Three things the browser caught that reading would not have
 *
 * - **58 cm of exposed span reads as nothing at all**, from any bearing. The
 *   stub wings
 *   came back as a pair of tanks strapped to the fuselage, because a wing that
 *   short is inside its own body's silhouette from every angle a player is at.
 *   `WING_DROP` is the fix and it is the DEPTH axis rather than the span:
 *   wing, gap, pylon, store hanging under it. See that constant.
 * - **`ord` was too near `frame`.** At #3f4038 against the running gear's
 *   #2b2a26 the pods read as more running gear rather than as stores, in every
 *   shot taken of the first draft — a colour bought for the one thing on this
 *   machine a player is meant to find, spent on nothing. It is lighter and
 *   greener now, and the pod wears a pale `metal` nose cap for the reason the
 *   station's optic is pale.
 * - **Two dark rectangles side by side are one dark rectangle.** The first
 *   draft put a 1 m avionics door on the flank beside the gunner's quarter
 *   pane, and the pair merged into a single black mass down the whole forward
 *   fuselage — the opposite of what a panel is for. Two smaller ones, BELOW the
 *   glazing line, break the flank instead of joining it.
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

/**
 * One team's palette.
 *
 * `TruckModel`'s seven roles less the tyre it has no use for, and with `stow`
 * traded for `ord`: what is strapped to a gunship is the stores, and they are
 * the one thing on it a player is meant to pick out. See the budget note above.
 */
interface HeliKit {
  body: string;
  frame: string;
  metal: string;
  glass: string;
  ord: string;
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
    ord: "#525345",
    accent: CONFIG.teams[0].color,
  },
  {
    body: "#55626d",
    frame: "#25282c",
    metal: "#616872",
    glass: "#27302f",
    ord: "#464f58",
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
/** Where each cross tube meets the runners, fore and aft. */
const SKID_STATIONS = [1.16, -0.92] as const;

/** The belly, the pilot's canopy roof, and the gunner's — 36 cm of STEP. */
const FLOOR_Y = 0.75;
const ROOF_Y = 2.45;
const GUNNER_ROOF_Y = 2.09;
/**
 * The forward belly, which is 20 cm higher than the rest of it.
 *
 * A chin RECESS rather than a styling line: it is what an elevating gun
 * traversed aft passes under. See the clearances in the header.
 */
const CHIN_Y = 0.95;
/** Half the fuselage's width — 1.44 m of beam, which is two seats and no more. */
const BODY_HW = 0.72;
/** The nose, and where the boom's centreline runs. */
const NOSE_Z = 5.05;
const BOOM_Y = 2.02;

/** The mast's head: where the disc turns, just over the collider's roof. */
const HUB_Y = 3.02;
const HUB_Z = 0.2;
/**
 * The main disc's radius, and **the number the physics reads off this
 * drawing**: `drive.collideRadius` is this, so what the world keeps a
 * helicopter out of is its rotor and not its airframe.
 */
const ROTOR_R = 5.2;
/** How many blades, how wide each chord is, and where the pale tip cap sits. */
const BLADES = 4;
const BLADE_W = 0.3;
const BLADE_TIP_R = 4.78;
/** The tail rotor, which turns about x and is geared up off the same figure. */
const TAIL_R = 1.02;
const TAIL_GEAR = 5.1;
/** Its plane and its height, both set by the main disc — see the clearances. */
const TAIL_Z = -5.5;
const TAIL_Y = 2.3;

/**
 * The stub wings: where they sit, and where the root is. The TIP is derived.
 *
 * **`WING_DROP` is the number that makes a 58 cm stub read as a wing**, and it
 * is the one thing here that was photographed rather than reasoned about. The
 * first version hung the pod straight off the underside and it came back as a
 * tank strapped to the fuselage — the 58 cm of wing that stands clear of a
 * 1.44 m fuselage is not enough span to read as anything, from any bearing. What reads is the DEPTH: a wing, a visible gap,
 * a pylon dropping through it and a store hanging under that. So the store
 * hangs `WING_DROP` below the wing rather than against it, and the aircraft
 * gains the one silhouette the span could not buy.
 */
const WING_Y = 1.7;
const WING_Z = 0.4;
const WING_ROOT_X = 0.66;
const WING_DROP = 0.7;

/**
 * The chin turret's trunnion, and how far the muzzle reaches from it.
 *
 * `MG_REACH` is spent twice and they are the same number by construction: it is
 * where `mgMuzzle` sits, and it is therefore the RADIUS of the circle the
 * barrel sweeps under the nose. Nothing on the belly may be inside it.
 */
const MG_Y = 0.6;
const MG_Z = 4.75;
const MG_REACH = 0.7;

/** The one blade aerial's length, off the boom. Bounded by the DISC. */
const ANTENNA_LENGTH = 0.66;

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
  // **The span IS the collider**, read off it rather than written down. See the
  // stub-wing note in the header: a tip outside this box is mass a round would
  // pass through.
  const WING_TIP_X = t.hull.width / 2;

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
    for (const sz of SKID_STATIONS) {
      // The struts up to the floor, each with a fairing on its outboard face —
      // free, and what stops a strut reading as a piece of scaffolding.
      skidBoxes.push([
        0.1,
        FLOOR_Y - SKID_R,
        0.16,
        x * 0.94,
        (FLOOR_Y + SKID_R) / 2,
        sz,
        kit.frame,
      ]);
      skidBoxes.push([
        0.05,
        FLOOR_Y - SKID_R - 0.12,
        0.3,
        x * 1.02,
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
  for (const sz of SKID_STATIONS) {
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
  // A boarding step on the port end of the forward cross tube, in the shoes'
  // own metal. The one
  // part of this aircraft a crew touches, and the only thing on it that admits
  // anybody ever gets in.
  skidBoxes.push([
    0.34,
    0.05,
    0.22,
    -0.86,
    FLOOR_Y - 0.12,
    SKID_STATIONS[0],
    kit.metal,
  ]);
  segment("heli-skid", hull, skidBoxes, skidCyls);

  // --- the airframe ---------------------------------------------------------
  //
  // A deep, narrow tandem body that STEPS DOWN to the nose. Built as a
  // staircase for `TankModel`'s glacis reason — a box cannot have a corner
  // taken off it — and the boom is a taper rather than a tube, which is the one
  // line that says "helicopter" from a kilometre away.
  const bodyBoxes: Box[] = [
    // The transmission and engine bay under the mast: the tallest section, and
    // the mass everything else hangs off.
    [
      BODY_HW * 2,
      ROOF_Y - FLOOR_Y,
      1.8,
      0,
      (ROOF_Y + FLOOR_Y) / 2,
      -0.1,
      kit.body,
    ],
    // The pilot's bay, sharing that roof — one unbroken spine from mast to
    // canopy.
    [
      BODY_HW * 2,
      ROOF_Y - FLOOR_Y,
      1.7,
      0,
      (ROOF_Y + FLOOR_Y) / 2,
      1.65,
      kit.body,
    ],
    // The gunner's bay: 36 cm lower and 10 cm narrower. **THE STEP**, and the
    // one line that says two men sit one behind the other.
    [
      BODY_HW * 1.86,
      GUNNER_ROOF_Y - FLOOR_Y,
      1.3,
      0,
      (GUNNER_ROOF_Y + FLOOR_Y) / 2,
      3.15,
      kit.body,
    ],
    // The nose, in two more steps down to the sensor. Its underside is the CHIN
    // — 20 cm higher than the belly behind it, which is what an elevating gun
    // traversed aft passes under.
    [BODY_HW * 1.61, 1.85 - CHIN_Y, 0.8, 0, (1.85 + CHIN_Y) / 2, 4.2, kit.body],
    [BODY_HW * 1.28, 0.68, 0.45, 0, 1.36, NOSE_Z - 0.225, kit.body],
    // The keel under the crew: ammunition, avionics, and the shape that makes
    // the belly read as armoured rather than as a floor. It STOPS at 2.90,
    // which is 1.15 m clear of the gun's own circle at `MG_Z - MG_REACH`.
    [BODY_HW * 1.8, 0.3, 2.3, 0, 0.62, 1.75, kit.body],
    // The wing box carried through the fuselage, standing slightly proud of it.
    [BODY_HW * 2 + 0.06, 0.34, 1.4, 0, WING_Y, WING_Z, kit.body],
    // The transmission hump and the mast standing out of it. Nothing above the
    // hump but the mast: see the disc clearance.
    [0.6, 0.36, 0.9, 0, 2.6, HUB_Z, kit.frame],
    [0.34, 0.3, 0.34, 0, 2.9, HUB_Z, kit.frame],
    // The boom, in two tapering steps, and the fin raked over the tail rotor's
    // gearbox.
    [0.66, 0.62, 2.2, 0, BOOM_Y, -2.1, kit.body],
    [0.5, 0.48, 2.3, 0, BOOM_Y, -4.15, kit.body],
    [0.2, 1.15, 1.3, 0, 2.5, -5.12, kit.body, 0.3],
    [0.42, 0.46, 0.46, 0.24, TAIL_Y, TAIL_Z, kit.frame],
    // The stabiliser and its endplates, which stop the boom reading as a pipe.
    [2.3, 0.1, 0.7, 0, 2.0, -3.7, kit.body],
    // The tail skid, and the shoe that says it is one.
    [0.12, 0.4, 0.3, 0, 1.62, -4.8, kit.body],
    [0.16, 0.08, 0.34, 0, 1.42, -4.8, kit.metal],
    // The wire cutter over the gunner's screen. There is no lower one: the
    // chin belongs to the gun, and a cutter under it is something the gun
    // traverses through.
    [0.14, 0.3, 0.42, 0, 2.18, 3.3, kit.frame, 0.35],
    // The nose sensor — the sight the gunner actually lays through, and the
    // second thing after the turret that says this aircraft hunts. Its faces
    // are the pale `metal` the barrel is, for the truck station's own reason.
    [0.62, 0.52, 0.5, 0, 1.42, NOSE_Z + 0.1, kit.frame],
    [0.26, 0.24, 0.06, -0.14, 1.44, NOSE_Z + 0.36, kit.metal],
    // The BARBETTE the chin turret turns in. Welded to the airframe, so it is
    // drawn here rather than on the inert `turret` node — where it would have
    // cost a mesh of its own to do nothing.
    [0.48, 0.3, 0.52, 0, 0.86, MG_Z, kit.frame],
  ];
  const bodyCyls: Cyl[] = [
    // The boom's tail cone, closing the taper.
    [0.48, 0.5, 0, BOOM_Y, tailTipZ, kit.body, "z", 0.3],
    // A landing light in the keel, well behind the gun's circle.
    [0.18, 0.12, 0, 0.52, 2.6, kit.metal, "y"],
  ];
  for (const sx of [-1, 1]) {
    const wingMidX = (sx * (WING_ROOT_X + WING_TIP_X)) / 2;
    const pylonX = sx * 0.98;
    const tipX = sx * (WING_TIP_X - 0.1);
    bodyBoxes.push(
      // The stub wing itself: root to tip, and the tip is the collider's face.
      [WING_TIP_X - WING_ROOT_X, 0.16, 1.6, wingMidX, WING_Y, WING_Z, kit.body],
      // The pylon dropping through it to the pod — see `WING_DROP`. It is the
      // GAP either side of this box that the wing is read off, so it is thin.
      [0.18, WING_DROP, 0.8, pylonX, WING_Y - WING_DROP / 2, WING_Z, kit.frame],
      // **The tip launcher**, and the four tube mouths in its face — the one
      // greeble on this aircraft worth the four cylinders, because a blank
      // block reads as a fuel tank and four holes read as missiles. It
      // STRADDLES the wing rather than hanging under it, which is what gives
      // the tip a shape from above as well as from ahead.
      [0.2, 0.42, 1.25, tipX, WING_Y, WING_Z - 0.05, kit.ord],
      // The two engine nacelles flanking the mast: the mass an attack
      // helicopter carries where a utility one carries a cabin. Deep enough to
      // MEET the wing root — an 11 cm slot between the two read as a gap in the
      // side of the aircraft.
      [0.5, 0.8, 2.0, sx * 0.8, 2.07, -0.2, kit.frame],
      // Its intake forward, and its exhaust turned outboard behind.
      [0.4, 0.46, 0.1, sx * 0.8, 2.22, 0.98, kit.frame],
      [0.34, 0.4, 0.22, sx * 0.8, 2.22, 0.9, kit.metal],
      [0.46, 0.46, 0.5, sx * 0.86, 2.12, -1.3, kit.metal, 0, sx * 0.3],
      // The stabiliser's endplate.
      [0.1, 0.4, 0.6, sx * 1.1, 2.14, -3.7, kit.body],
      // A handhold on the flank, and a formation light on the boom. Both free,
      // and between them they are what stops six metres of panel reading as a
      // shipping container.
      [0.1, 0.06, 0.26, sx * 0.74, 1.06, 2.2, kit.frame],
      [0.06, 0.1, 0.18, sx * 0.34, BOOM_Y + 0.28, -3.1, kit.metal],
      // …and two avionics panels under the glazing, which break four metres of
      // flank without ADDING to it: the first version was one big door beside
      // the gunner's quarter pane, and the two dark rectangles merged into a
      // single black mass down the whole forward fuselage.
      [0.08, 0.34, 0.7, sx * BODY_HW, 1.12, 3.1, kit.frame],
      [0.08, 0.34, 0.6, sx * BODY_HW, 1.12, 1.5, kit.frame],
    );
    bodyCyls.push(
      // **The rocket pod.** Nineteen tubes' worth of it, drawn as one body with
      // a tapered cap — the depth the span could not have.
      [0.44, 1.9, pylonX, WING_Y - WING_DROP, WING_Z - 0.05, kit.ord, "z"],
      [0.4, 0.1, pylonX, WING_Y - WING_DROP, WING_Z + 0.98, kit.metal, "z", 0.3],
      [0.42, 0.08, pylonX, WING_Y - WING_DROP, WING_Z - 1.0, kit.frame, "z"],
      // The pitot on the nose's flank.
      [0.05, 0.55, sx * 0.34, 1.52, NOSE_Z - 0.1, kit.metal, "z"],
    );
    for (const ox of [-0.04, 0.04]) {
      for (const oy of [-0.1, 0.1]) {
        bodyCyls.push([
          0.12,
          0.06,
          tipX + ox,
          WING_Y + oy,
          WING_Z + 0.6,
          kit.metal,
          "z",
        ]);
      }
    }
  }
  segment("heli-body", sprung, bodyBoxes, bodyCyls);

  // --- the glazing ----------------------------------------------------------
  //
  // Dark and shallow, for the gun truck's reason: the crew are INSIDE, and a
  // pane you could resolve a shape through is a pane with no shape behind it.
  // Two screens rather than one, stepped, is the whole of what says TANDEM.
  // Drawn rather than built with `Build.pane` — a vehicle carries no breakable
  // glass and is in nobody's pane index.
  const glassBoxes: Box[] = [
    // The gunner's screen, raked over the nose, and the pilot's stepped up
    // behind and over the gunner's roof.
    [1.22, 0.95, 0.14, 0, 1.66, 3.66, kit.glass, -0.48],
    [1.32, 0.54, 0.14, 0, 2.24, 2.58, kit.glass, -0.5],
    // The roof panel over the pilot's head.
    [0.9, 0.1, 0.8, 0, ROOF_Y - 0.01, 1.85, kit.glass],
    // The sensor's own window, beside its pale face.
    [0.24, 0.22, 0.06, 0.14, 1.44, 5.41, kit.glass],
  ];
  for (const sx of [-1, 1]) {
    glassBoxes.push(
      // The gunner's quarter pane and the pilot's side glazing. Each stands
      // 5 cm proud of the panel it is let into, which is what keeps it outside
      // that panel's own 2 cm ink hull.
      [0.1, 0.72, 1.0, sx * (BODY_HW * 0.93), 1.52, 3.2, kit.glass],
      [0.1, 0.82, 1.4, sx * BODY_HW, 1.94, 1.7, kit.glass],
    );
  }
  segment("heli-glass", sprung, glassBoxes);

  // --- the team's colour ----------------------------------------------------
  //
  // On the BOOM and the FIN, which are what is left of a helicopter's shape at
  // range, and standing proud of the panel — a flash flush with a plate is
  // drawn inside that plate's own outline and is no marking at all. Some of it
  // faces every direction, which is what the conventions require of an accent.
  const markBoxes: Box[] = [
    // A band round the boom: visible from both flanks and from below.
    [0.72, 0.68, 0.62, 0, BOOM_Y, -2.95, kit.accent],
    // The fin's cap, the highest thing on the aircraft after the disc, laid
    // along the fin's own rake.
    [0.28, 0.28, 0.8, 0, 3.28, -5.44, kit.accent, 0.3],
    // A band across the engine deck, for the bearing a helicopter is read from
    // that no ground vehicle ever is: from ABOVE, by whatever is higher.
    [0.9, 0.1, 0.34, 0, ROOF_Y + 0.04, -0.6, kit.accent],
    // …and a chevron on the nose, for the one bearing the other three miss.
    [0.56, 0.2, 0.3, 0, 1.88, 4.25, kit.accent],
  ];
  segment("heli-mark", sprung, markBoxes);

  // --- the two discs --------------------------------------------------------
  const mainRotor = new TransformNode("heli-rotor", scene);
  mainRotor.parent = sprung;
  mainRotor.position.set(0, HUB_Y, HUB_Z);
  const rotorBoxes: Box[] = [];
  for (let i = 0; i < BLADES; i++) {
    // Built about the node's own origin and rotated into place, so the closure
    // has one number to write.
    const a = (i / BLADES) * Math.PI * 2;
    const s = Math.sin(a);
    const c = Math.cos(a);
    rotorBoxes.push(
      [BLADE_W, 0.055, ROTOR_R - 0.5, (s * ROTOR_R) / 2, 0.04, (c * ROTOR_R) / 2, kit.frame, 0, a],
      // The root cuff, and the pale TIP CAP that makes four blades read as four
      // rather than as a smear. Both are the head's own metal and both are free.
      [0.16, 0.14, 0.5, s * 0.55, 0.02, c * 0.55, kit.metal, 0, a],
      [BLADE_W, 0.06, 0.34, s * BLADE_TIP_R, 0.04, c * BLADE_TIP_R, kit.metal, 0, a],
      // The pitch link down to the swash — four of them, and what makes the
      // head read as a mechanism rather than as a hub cap.
      [0.05, 0.2, 0.05, s * 0.34, -0.08, c * 0.34, kit.frame, 0, a],
    );
  }
  segment("heli-rotor", mainRotor, rotorBoxes, [
    // The head, and the swash under it.
    [0.44, 0.26, 0, 0, 0, kit.metal, "y"],
    [0.62, 0.1, 0, -0.16, 0, kit.metal, "y"],
  ]);

  const tailRotor = new TransformNode("heli-tail-rotor", scene);
  tailRotor.parent = sprung;
  tailRotor.position.set(0.34, TAIL_Y, TAIL_Z);
  const tailBoxes: Box[] = [];
  for (let i = 0; i < 2; i++) {
    // Each box is a full DIAMETER, so two of them are four blades.
    const a = (i / 2) * Math.PI;
    tailBoxes.push([0.05, 0.2, TAIL_R * 2 - 0.18, 0, 0, 0, kit.frame, a]);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    tailBoxes.push([
      0.06,
      0.22,
      0.16,
      0,
      Math.sin(a) * (TAIL_R - 0.1),
      Math.cos(a) * (TAIL_R - 0.1),
      kit.metal,
      a,
    ]);
  }
  segment("heli-tail-rotor", tailRotor, tailBoxes, [
    [0.24, 0.14, 0, 0, 0, kit.metal, "x"],
  ]);

  // --- the chin turret ------------------------------------------------------
  //
  // **`turret` is INERT and DRAWS NOTHING**, which is `TruckModel`'s
  // arrangement with the one mesh taken back out of it. `spec.gun` is null, so
  // `Vehicle` holds `turretYaw` equal to the hull's own yaw and the local angle
  // written here is a permanent zero; the barbette this turns in is therefore
  // welded to the airframe and is drawn in the body segment, where it is free.
  // The node exists so that `mgMount` has the same parent it has on a tank and
  // `aimMg` needs no branch of its own.
  const turret = new TransformNode("heli-ring", scene);
  turret.parent = sprung;

  const mgMount = new TransformNode("heli-mg-mount", scene);
  mgMount.parent = turret;
  mgMount.position.set(0, MG_Y, MG_Z);
  segment("heli-mg-ring", mgMount, [
    // The yoke the gun hangs in, and the only part of the chin that turns with
    // the bearing.
    [0.44, 0.28, 0.46, 0, -0.02, 0, kit.frame],
    [0.09, 0.26, 0.26, -0.22, 0.04, 0.04, kit.frame],
    [0.09, 0.26, 0.26, 0.22, 0.04, 0.04, kit.frame],
    // The ammunition chute coming down the barbette into it.
    [0.22, 0.22, 0.24, 0, 0.16, -0.18, kit.frame],
    // **The OPTIC**, on the port cheek and in METAL, which is the pale thing
    // that says where the gun is looking — the truck station's one lesson about
    // what an eye tracks, on a mount the eye would otherwise lose against the
    // shadow under the nose.
    [0.16, 0.16, 0.2, -0.25, 0.13, 0.06, kit.metal],
  ]);

  const mgGun = new TransformNode("heli-mg-gun", scene);
  mgGun.parent = mgMount;
  segment(
    "heli-mg",
    mgGun,
    [
      // The breech, the feed under it, and the clamp round the barrels' nose.
      [0.2, 0.2, 0.4, 0, 0, 0.04, kit.frame],
      [0.16, 0.14, 0.2, 0, -0.12, -0.06, kit.frame],
      [0.17, 0.17, 0.06, 0, 0, 0.6, kit.frame],
    ],
    [
      // **THREE barrels in a cluster**, which is the one detail that says this
      // is a gunship's cannon rather than a machine gun bolted under a nose —
      // and it is three cylinders in a colour the segment already carries, so
      // it costs nothing at all. The gun does not spin: there is no node for
      // it, and a rotary that turned would be a mesh bought for a thing seen
      // from behind at fourteen metres.
      [0.06, 0.44, 0, 0.05, 0.42, kit.metal, "z"],
      [0.06, 0.44, 0.043, -0.025, 0.42, kit.metal, "z"],
      [0.06, 0.44, -0.043, -0.025, 0.42, kit.metal, "z"],
    ],
  );

  const mgMuzzle = new TransformNode("heli-mg-muzzle", scene);
  mgMuzzle.parent = mgGun;
  // Just past the clamp, so a flash lit here is outside the barrels and a round
  // fired from here starts outside the vehicle's own collider box.
  //
  // **`MG_REACH` is the tightest number in the file**, and unlike either other
  // kind it is measured against the GROUND rather than against the vehicle's
  // own bodywork — see the third clearance in the header. It is the same figure
  // the belly's keep-out circle is drawn with, and deliberately so: what the
  // muzzle reaches IS what the barrel sweeps.
  mgMuzzle.position.set(0, 0, MG_REACH);

  // --- the aerial -----------------------------------------------------------
  //
  // A blade aerial rather than a whip, and SHORT, because the main disc is
  // overhead: the version this replaces stood 1.15 m of mast on the boom and
  // put its tip six centimetres through the blade path. See the first
  // clearance.
  const whipBase = new TransformNode("heli-whip-base", scene);
  whipBase.parent = sprung;
  whipBase.position.set(0.22, BOOM_Y + 0.26, -2.7);
  const whipTip = new TransformNode("heli-whip-tip", scene);
  whipTip.parent = whipBase;
  whipTip.position.y = ANTENNA_LENGTH / 2;
  segment("heli-whip-lo", whipBase, [
    [0.05, ANTENNA_LENGTH / 2, 0.03, 0, ANTENNA_LENGTH / 4, 0, kit.frame],
  ]);
  segment("heli-whip-hi", whipTip, [
    [0.04, ANTENNA_LENGTH / 2, 0.025, 0, ANTENNA_LENGTH / 4, 0, kit.frame],
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
    // row is absent rather than dimmed, and the gun marker follows the chin
    // cannon in both seats.
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
