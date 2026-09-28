/**
 * HeliModel.ts — The helicopter: a tandem-seat ATTACK helicopter on skids, with
 * a chin cannon and no main gun at all, drawn off the Bell AH-1Z Viper.
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
 * ## It is a VIPER, and the drawing was the one thing that was not
 *
 * Everything this aircraft does was already the AH-1Z's — two crew in tandem, a
 * four-bladed main rotor, a four-bladed tail rotor on the starboard side of the
 * fin, skids, a three-barrelled cannon in a chin turret, stub wings with a
 * rocket pod under each and a missile on each tip — and it was drawn as a stack
 * of dark boxes on a square pipe. So what changed is the drawing and nothing
 * else: every station the physics, the gun or the disc reads is where it was,
 * and the Viper is laid over them at about seven tenths of its real size, the
 * scale the collider already was.
 *
 * **The fuselage is LOFTED, not stacked.** A helicopter is a body of sections
 * that change along it — narrow at the nose, deepest under the crew, tapering
 * into the boom — and a box has no such thing, which is why the first version
 * needed a staircase to get from the nose to the tail. `facet.ts`'s
 * `loftAlongZ` draws it as one solid through thirteen chamfered sections, cut
 * DIFFERENTLY above and below: a rounded belly under square shoulders, because
 * the shoulders are what the canopy sits on. The canopy, the doghouse over the
 * transmission and the accent bands are lofts through the same kind of
 * sections, so they meet the body on its own lines rather than on guessed ones.
 *
 * What says VIPER from each bearing, which is what the parts were chosen by:
 *
 * - **Side-on**, the stepped canopy — the gunner low in front, the pilot's
 *   windscreen rising steeply over his head — the tall DOGHOUSE behind it that
 *   the mast stands out of, and the two engine nacelles each ending in a
 *   swept-up IR SUPPRESSOR, which is the Viper's own silhouette and nobody
 *   else's.
 * - **Head-on**, the round sensor ball on the nose (the TSS, pale face and
 *   dark window), the chin gun under it, and the honeycomb face of each rocket
 *   pod: nineteen tube mouths, which read as rockets where a blank disc reads
 *   as a fuel tank.
 * - **From above and behind**, the tapered stub wings with a Sidewinder hung
 *   under each tip, the swept fin with its accent cap, and the rotor HEAD — a
 *   hub, four yokes, four grips and the pitch links down to the swashplate,
 *   which is what makes a head read as a mechanism rather than a hub cap.
 *
 * ## The gun is in the CHIN, and that is the rule paying out rather than a
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
 * ## The stub wings OVERHANG the collider, and that is a decision, not a slip
 *
 * The stores are what says "attack helicopter" before the canopy or the turret
 * has landed, and the Viper's own span is several times its fuselage's width.
 * The rule every other vehicle keeps is that nothing drawn may promise mass
 * outside the collider box — a part past it is a part rounds pass through — and
 * this wing kept it until it was photographed: tips on the box's face left
 * 58 cm of wing a side, which read as stubs.
 *
 * **So the wing is the SECOND documented exception after the rotor disc**, and
 * it is bounded rather than open-ended: `WING_OVERHANG` past `hull.width / 2`,
 * and nothing else. The trade was chosen over the other one on offer, widening
 * the box: a wider box is a helicopter ~30% easier to hit from ahead, behind
 * and above for the sake of a thin wing, where the overhang costs only that a
 * round through the outer 40 cm of a wing — or the Sidewinder hung under its
 * tip — flies on. The pod stays INSIDE the box, which is the store a player
 * aims at, and the Sidewinder's fins are crossed in an X so that the missile is
 * no wider than the tip it hangs from. Do not let anything else out past the
 * box on the strength of this: the next thing that wants to is owed the same
 * argument.
 *
 * The fuselage narrowing from 2.32 m to 1.44 m is what makes the span read as
 * wings at all. It is also the correct shape twice over: a gunship is narrow
 * because it is two seats wide and no more, and the narrower the body the more
 * of the span is wing.
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
 * to anything long and thin here: the ink draws a line wherever depth steps, so
 * a 3 cm rim is very nearly all ink and comes back as a heavy black hoop — and
 * a hoop round a PARKED aircraft reads as a cage bolted to it rather than as a
 * disc that is turning. (It was worse before that: `Cyl` builds a SOLID, so the
 * first attempt drew a 10.4 m black plate over the whole machine and everything
 * under it.) The blades alone carry it, with pale swept tips in the head's own
 * `metal` — which cost nothing, and are what makes the disc read as four blades
 * rather than as a grey smear at the range this thing is fought from.
 *
 * ## Two whips, and they are the one part of it that is not rigid
 *
 * A parked aircraft with its rotor stopped is otherwise a statue. The two
 * aerials on the boom are what keeps it alive — they lean into the wind, lay
 * back as it pulls away and ring when it lands — and they are TWO rather than
 * one because a pair of different lengths answering at different rates (see
 * `Whip.rate`) is what makes the motion read as springs rather than as one
 * animation. Both are bounded by the DISC — see the first clearance.
 *
 * ## The budget
 *
 * **Twenty meshes, twelve of which move** — counted off `rig.meshes` in the
 * browser, not off the segments below. Cost is COLOURS PER SEGMENT and a part
 * in a colour its segment already carries is free, so the lofts, the wings,
 * the pylons, the nacelles, the suppressors, the sensor ball, the canopy
 * frames and the stabiliser are all free; the two meshes the Viper cost over
 * the eighteen before it are the second whip's two links, which is the one
 * thing here bought for MOVING. `ord` is the one colour on this aircraft a
 * player is meant to find, and it is spent on the rocket pods alone.
 *
 * **The inert `turret` node draws nothing at all.** `spec.gun` is null, so
 * `Vehicle` holds `turretYaw` equal to the hull's own yaw and that node is a
 * permanent local zero; the barbette the chin turret turns in is therefore
 * welded to the airframe, and a part that cannot move belongs in the body
 * segment where it is free. The node still exists because `mgMount` must have
 * the same parent it has on a tank — see `VehicleRig.turret`.
 *
 * ## Four clearances this drawing owes
 *
 * Re-measure every one of these if the station it names moves.
 *
 * - **Nothing on the fuselage inside the main disc above the blade line**, and
 *   nothing at all inside the tail rotor's. The blades sweep at y 3.06 out to
 *   radius 4.95 from the mast at z 0.2, which is what puts the FIN's leading
 *   edge where it is: it crosses the blade line at z -4.99, 5.19 from the mast
 *   and therefore 24 cm outside the tip, and the accent cap on its top starts
 *   further aft still. It is also what sets `TAIL_Z` and `TAIL_Y` — a tail
 *   rotor any higher or any further forward puts its own upper tip inside the
 *   main disc's radius. **The aerials are what this has caught.** The utility
 *   version stood a 1.15 m whip on the boom whose tip reached 3.15 — six
 *   centimetres THROUGH the blade path, four times a revolution. The long whip
 *   is 0.66 m on the boom top and its tip stands at 2.95, 8 cm under the
 *   blades; the short one is aft and lower; every bend either can take moves
 *   the tip DOWN.
 * - **Nothing under the belly within `MG_REACH` of the barbette**, which is
 *   this kind's version of the truck's bare roof. The keel therefore stops at
 *   z 2.90 and the landing light sits behind it — a light, a cutter or an
 *   aerial anywhere inside that circle is something a traversing gun drives
 *   through. There WAS a lower wire cutter under the nose in the first draft,
 *   and this rule is what took it out; the Viper has one, and this one does
 *   not.
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
 *   underside forward of z 3.80 is held at `CHIN_Y` 0.95 and the barrel passes
 *   4.6 cm under it. Traversed FORWARD it reaches z 5.38 at the same height,
 *   which is what bounds the nose above it: the nose's underside and the
 *   sensor ball's both stand at 1.10 there. At the belly's own 0.75 the gun
 *   drives through its own airframe at every aft bearing above about 12
 *   degrees.
 *
 * **The collider box EXCLUDES the disc.** A round must not stop on air, so the
 * box is the airframe and the disc's only presence in the world is
 * `drive.collideRadius`, which is what keeps a hull out of gaps.
 *
 * ## Four things the browser caught that reading would not have
 *
 * - **58 cm of exposed span reads as nothing at all**, from any bearing. The
 *   stub wings came back as a pair of tanks strapped to the fuselage, because a
 *   wing that short is inside its own body's silhouette from every angle a
 *   player is at. `WING_DROP` was the first fix and it is the DEPTH axis
 *   rather than the span: wing, gap, pylon, store hanging under it. It was not
 *   enough on its own — the Viper's wing still read as a stub — and
 *   `WING_OVERHANG` is the second. See the stub-wing section above.
 * - **`ord` was too near `frame`.** At #3f4038 against the running gear's
 *   #2b2a26 the pods read as more running gear rather than as stores, in every
 *   shot taken of the first draft — a colour bought for the one thing on this
 *   machine a player is meant to find, spent on nothing. It is lighter and
 *   greener now, and the pod's face is the pale `metal` with the tube mouths
 *   dark in it.
 * - **Two dark rectangles side by side are one dark rectangle.** The first
 *   draft put a 1 m avionics door on the flank beside the gunner's quarter
 *   pane, and the pair merged into a single black mass down the whole forward
 *   fuselage — the opposite of what a panel is for. The flank's panels are in
 *   the BODY's colour and stand proud of it, so the ink draws their edges; the
 *   only dark things below the glazing are small.
 * - **A glazed box is a dark box.** The first canopy was four dark slabs, and
 *   from anywhere outside a few metres it was one black shape on the fuselage.
 *   What makes the canopy read as glazing is its FRAME: the bows at the two
 *   windscreens and the blast barrier, the sills and the roof edges, all in
 *   the frame colour and standing proud of the glass so the ink finds them.
 */
import { Scene, TransformNode } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { CelMaterialFactory } from "../shaders/CelShader";
import type { Team } from "./Combatant";
import { viewTeam } from "../core/teamView";
import {
  extrude,
  loftAlongZ,
  type Point3,
  type ProfilePoint,
  rodBetween,
  solidBetween,
  type Station,
  stationAt,
} from "./facet";
import {
  type Box,
  type Cyl,
  paintRig,
  segmentOf,
  setAntennaBend,
  type Shape,
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
 * it — a flash flush with a plate is drawn inside that plate's own outline and
 * is no marking at all, which is what the gun truck's flank cost before it was
 * photographed.
 *
 * Indexed by the VIEW rather than by `Team`, as every other kit table in the
 * game is — see `core/teamView.ts`.
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
// here is the BOTTOM of the box and the skids stand on it. +z is the nose and
// +x is starboard.

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

/** The mast's head: where the disc turns, just over the collider's roof. */
const HUB_Y = 3.02;
const HUB_Z = 0.2;
/**
 * The main disc's radius, and **the number the physics reads off this
 * drawing**: `drive.collideRadius` is this, so what the world keeps a
 * helicopter out of is its rotor and not its airframe.
 */
const ROTOR_R = 5.2;
/** Where the drawn blade ENDS — 25 cm inside the disc the physics keeps clear. */
const BLADE_END = ROTOR_R - 0.25;
/** How many blades, how wide each chord is, and where the pale swept tip starts. */
const BLADES = 4;
const BLADE_W = 0.3;
const BLADE_TIP_R = 4.58;
/** The tail rotor, which turns about x and is geared up off the same figure. */
const TAIL_R = 1.02;
const TAIL_GEAR = 5.1;
/** Its plane and its height, both set by the main disc — see the clearances. */
const TAIL_Z = -5.5;
const TAIL_Y = 2.3;
/** How far outboard of the fin's centreline the tail rotor turns — starboard. */
const TAIL_X = 0.34;

/**
 * The stub wings: where they sit, where the root is, and how far past the
 * collider the tip reaches — see the header. The TIP itself is derived.
 *
 * **`WING_DROP` is the number that makes a 58 cm stub read as a wing**, and it
 * is the one thing here that was photographed rather than reasoned about. The
 * first version hung the pod straight off the underside and it came back as a
 * tank strapped to the fuselage — the 58 cm of wing that stands clear of a
 * 1.44 m fuselage is not enough span to read as anything, from any bearing.
 * What reads is the DEPTH: a wing, a visible gap, a pylon dropping through it
 * and a store hanging under that. So the store hangs `WING_DROP` below the
 * wing rather than against it, and the aircraft gains the one silhouette the
 * span could not buy.
 */
const WING_Y = 1.7;
const WING_Z = 0.4;
const WING_ROOT_X = 0.62;
const WING_DROP = 0.7;
const WING_OVERHANG = 0.4;
/** Where the rocket pod's pylon stands, and therefore the pod's centreline. */
const PYLON_X = 1.0;

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

/** The two aerials' lengths, both off the boom top and both bounded by the DISC. */
const ANTENNA_LENGTH = 0.66;
const SHORT_ANTENNA = 0.5;

/**
 * The FUSELAGE, nose to tail, as the sections a loft is drawn through.
 *
 * **The shoulders are cut less than the belly** (`top` against `bot`): a
 * rounded belly is what an airframe is, and square shoulders are what gives the
 * canopy a flat sill to sit on. The underside holds `CHIN_Y` forward of 3.80
 * and `FLOOR_Y` from 2.70 aft — the gun's two clearances — and the body tapers
 * from 1.20 into the boom, whose last station is the fin's root.
 */
const FUSELAGE: readonly Station[] = [
  { z: 5.06, w: 0.62, lo: 1.1, hi: 1.6, top: 0.35, bot: 0.45 },
  { z: 4.8, w: 1.0, lo: 1.0, hi: 1.7, top: 0.3, bot: 0.45 },
  { z: 4.45, w: 1.18, lo: CHIN_Y, hi: 1.7, top: 0.22, bot: 0.4 },
  { z: 3.8, w: 1.34, lo: CHIN_Y, hi: 1.66, top: 0.2, bot: 0.4 },
  { z: 3.5, w: 1.4, lo: 0.77, hi: 1.66, top: 0.2, bot: 0.4 },
  { z: 2.7, w: BODY_HW * 2, lo: FLOOR_Y, hi: 1.68, top: 0.2, bot: 0.4 },
  { z: 1.3, w: BODY_HW * 2, lo: FLOOR_Y, hi: 1.78, top: 0.2, bot: 0.4 },
  { z: 0.0, w: BODY_HW * 2, lo: 0.78, hi: 1.92, top: 0.22, bot: 0.4 },
  { z: -1.2, w: 1.28, lo: 0.98, hi: 2.08, top: 0.25, bot: 0.42 },
  { z: -2.0, w: 0.84, lo: 1.54, hi: 2.32, top: 0.3, bot: 0.4 },
  { z: -3.4, w: 0.6, lo: 1.76, hi: 2.28, top: 0.3, bot: 0.4 },
  { z: -4.7, w: 0.46, lo: 1.86, hi: 2.24, top: 0.3, bot: 0.4 },
  { z: -5.4, w: 0.34, lo: 1.92, hi: 2.2, top: 0.3, bot: 0.4 },
];

/**
 * The CANOPY, sunk 6 cm into the fuselage's shoulders so it has no seam.
 *
 * **The step is between 2.80 and 2.52**: the gunner's roof at 2.12 and the
 * pilot's windscreen rising 30 cm in 28 cm of run to a roof at `ROOF_Y`, which
 * is the one line that says two men sit one behind the other.
 */
const CANOPY: readonly Station[] = [
  { z: 4.4, w: 0.7, lo: 1.62, hi: 1.72, top: 0.5, bot: 0.05 },
  { z: 3.95, w: 1.06, lo: 1.61, hi: 2.06, top: 0.5, bot: 0.05 },
  { z: 3.25, w: 1.12, lo: 1.61, hi: GUNNER_ROOF_Y + 0.03, top: 0.5, bot: 0.05 },
  { z: 2.8, w: 1.14, lo: 1.62, hi: GUNNER_ROOF_Y + 0.03, top: 0.5, bot: 0.05 },
  { z: 2.52, w: 1.16, lo: 1.62, hi: ROOF_Y - 0.03, top: 0.5, bot: 0.05 },
  { z: 1.75, w: 1.16, lo: 1.66, hi: ROOF_Y + 0.01, top: 0.5, bot: 0.05 },
  { z: 1.3, w: 0.96, lo: 1.7, hi: 2.3, top: 0.55, bot: 0.05 },
];

/**
 * The DOGHOUSE: the fairing over the transmission, rising steeply behind the
 * pilot to the mast and running out along the boom's back. Its top stays 30 cm
 * under the blades at the mast, where the swashplate turns over it.
 */
const DOGHOUSE: readonly Station[] = [
  { z: 1.28, w: 0.74, lo: 1.72, hi: 2.26, top: 0.35, bot: 0.1 },
  { z: 1.02, w: 0.9, lo: 1.72, hi: 2.68, top: 0.35, bot: 0.1 },
  { z: -0.4, w: 0.96, lo: 1.74, hi: 2.74, top: 0.35, bot: 0.1 },
  { z: -1.3, w: 0.78, lo: 1.84, hi: 2.52, top: 0.35, bot: 0.1 },
  { z: -2.1, w: 0.44, lo: 2.02, hi: 2.36, top: 0.35, bot: 0.1 },
];

/**
 * The fin, as a side profile: a raked leading edge, the flat top the accent
 * cap sits on, and a VENTRAL fin under the boom that the tail skid hangs off.
 * The leading edge crosses the blade line 24 cm outside the tip — see the
 * first clearance.
 */
const FIN: readonly ProfilePoint[] = [
  [-4.35, 2.12],
  [-5.18, 3.34],
  [-5.62, 3.34],
  [-5.64, 2.55],
  [-5.58, 1.66],
  [-5.2, 1.74],
  [-4.9, 1.95],
];

/**
 * A six-sided AEROFOIL section — rounded nose, thin tail — as `[along, up]`
 * pairs across a chord of `c` and a depth of `t`, the leading edge at +c/2.
 * Every wing, blade and stabiliser here is a solid between two of these.
 */
function aerofoil(c: number, t: number): [number, number][] {
  return [
    [c / 2, 0],
    [c / 2 - Math.min(0.1, c * 0.12), t * 0.5],
    [-c / 2 + Math.min(0.05, c * 0.1), t * 0.22],
    [-c / 2, 0],
    [-c / 2 + Math.min(0.05, c * 0.1), -t * 0.17],
    [c / 2 - Math.min(0.1, c * 0.12), -t * 0.45],
  ];
}

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
  // The kit is the VIEWER's read of this side rather than the authority's
  // index for it: the local player's own side wears amber whichever slot a
  // match seated them in. See `core/teamView.ts`.
  const kit = KITS[viewTeam(team)];
  const t = CONFIG.vehicles.heli;
  // **The span is the collider's plus a stated overhang**, read off it rather
  // than written down. See the stub-wing note in the header: the outer
  // `WING_OVERHANG` of each wing is mass a round passes through, by decision.
  const WING_TIP_X = t.hull.width / 2 + WING_OVERHANG;

  const root = new TransformNode("heli", scene);
  const hull = new TransformNode("heli-hull", scene);
  hull.parent = root;
  // Everything the springs carry, which here is everything except the skids.
  const sprung = new TransformNode("heli-sprung", scene);
  sprung.parent = hull;

  const { meshes, livery, segment } = segmentOf(scene, mats);

  /** A round member from `a` to `b`; `d` at `a` and `dTop` at `b`. */
  const rod = (a: Point3, b: Point3, d: number, color: string, tess = 8, dTop = d): Shape => [
    rodBetween("heli-rod", scene, a, b, d, tess, dTop),
    color,
  ];
  /**
   * A bent TUBE through `pts`, one rod per leg, each run half a diameter past
   * its ends so the outside of every bend is closed rather than notched.
   */
  const tube = (pts: readonly Point3[], d: number, color: string): Shape[] => {
    const out: Shape[] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [a, b] = [pts[i], pts[i + 1]];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const e = (d * 0.5) / len;
      const at = (s: number): Point3 => [
        a[0] + (b[0] - a[0]) * s,
        a[1] + (b[1] - a[1]) * s,
        a[2] + (b[2] - a[2]) * s,
      ];
      out.push(rod(at(i === 0 ? 0 : -e), at(i + 2 === pts.length ? 1 : 1 + e), d, color));
    }
    return out;
  };
  /** A solid between two matching faces — a wing, a blade, a fin plate. */
  const solid = (from: readonly Point3[], to: readonly Point3[], color: string): Shape => [
    solidBetween("heli-solid", scene, from, to),
    color,
  ];
  /** A side profile extruded across X — the fin, a pylon, a cap. */
  const slab = (
    profile: readonly ProfilePoint[],
    width: number,
    bevel: number,
    x: number,
    color: string,
  ): Shape => [extrude("heli-slab", scene, profile, width, bevel, x), color];
  /** A loft along Z through `stations`. */
  const body = (stations: readonly Station[], color: string): Shape => [
    loftAlongZ("heli-loft", scene, stations),
    color,
  ];
  /**
   * A BAND round a lofted body from `z0` to `z1`, `grow` proud of it all
   * round — a marking that faces every direction the body does, and stands
   * outside its outline rather than inside it.
   */
  const band = (
    stations: readonly Station[],
    z0: number,
    z1: number,
    grow: number,
    color: string,
  ): Shape => {
    const at = (z: number): Station => {
      const s = stationAt(stations, z);
      return { ...s, w: s.w + grow * 2, lo: s.lo - grow, hi: s.hi + grow };
    };
    return body([at(z0), at(z1)], color);
  };
  /** Where the top of a lofted body is at `z`, and how far across it is flat. */
  const topAt = (stations: readonly Station[], z: number) => {
    const s = stationAt(stations, z);
    return { y: s.hi, half: (s.w / 2) * (1 - s.top), s };
  };

  // --- the skids ------------------------------------------------------------
  //
  // On `hull` and not on `sprung`, which is the same split a tank's tracks and
  // a truck's wheels take: the running gear lies on the ground it found and the
  // body is what moves against it. On this kind that is what makes a landing
  // legible — the fuselage settles onto its skids and rebounds.
  //
  // The Viper's are two runners and two ARCHED cross tubes rather than struts:
  // the tube rises from the runner, rolls over and runs across under the belly,
  // which is what an energy-absorbing gear is — the arch is the spring.
  const skidBoxes: Box[] = [];
  const skidCyls: Cyl[] = [];
  const skidShapes: Shape[] = [];
  for (const sx of [-1, 1]) {
    const x = SKID_X * sx;
    skidCyls.push([SKID_R * 2, SKID_REACH * 2, x, SKID_R, 0.16, kit.frame, "z"]);
    // The toe curling up forward and a short kick at the heel, so the runner
    // does not end in a flat face at either end.
    skidShapes.push(
      rod([x, SKID_R, 2.04], [x, 0.36, 2.36], SKID_R * 2, kit.frame),
      rod([x, SKID_R, -1.72], [x, 0.16, -1.88], SKID_R * 2, kit.frame),
    );
    for (const sz of SKID_STATIONS) {
      // Wear shoes: the one place a skid is a different colour, and they are
      // what says this thing lands on them.
      skidBoxes.push([0.14, 0.06, 0.34, x, SKID_R - 0.02, sz, kit.metal]);
    }
    // The ground-handling wheel lugs on the runner's outboard face, aft.
    skidBoxes.push([0.06, 0.1, 0.18, x + sx * 0.1, SKID_R + 0.02, -1.2, kit.frame]);
  }
  for (const sz of SKID_STATIONS) {
    // Each arch rises to the BELLY over its own station, which is higher aft
    // where the body starts to taper — a tube that stopped short of it would
    // be a gear holding the aircraft up on nothing.
    const top = stationAt(FUSELAGE, sz).lo + 0.03;
    const arch = (sx: number): Point3[] => [
      [sx * SKID_X, SKID_R + 0.02, sz],
      [sx * (SKID_X - 0.02), top * 0.55, sz],
      [sx * (SKID_X - 0.12), top - 0.11, sz],
      [sx * (SKID_X - 0.34), top, sz],
    ];
    skidShapes.push(
      ...tube([...arch(1), ...arch(-1).reverse()], 0.12, kit.frame),
    );
    // The saddle clamping the tube to the belly.
    skidBoxes.push([0.5, 0.08, 0.2, 0, top + 0.03, sz, kit.metal]);
  }
  // A boarding step hung off the port end of the forward cross tube, in the
  // shoes' own metal. The one part of this aircraft a crew touches, and the only
  // thing on it that admits anybody ever gets in.
  skidBoxes.push([0.3, 0.04, 0.2, -0.98, 0.56, SKID_STATIONS[0], kit.metal]);
  segment("heli-skid", hull, skidBoxes, skidCyls, skidShapes);

  // --- the airframe ---------------------------------------------------------
  const bodyBoxes: Box[] = [];
  const bodyCyls: Cyl[] = [];
  const bodyShapes: Shape[] = [
    // The fuselage, the doghouse over the transmission and the keel under the
    // crew: three lofts, and between them the whole shape a player sees
    // side-on. The keel is ammunition and armour, and it STOPS at 2.90, which
    // is 1.15 m clear of the gun's own circle at `MG_Z - MG_REACH`.
    body(FUSELAGE, kit.body),
    body(DOGHOUSE, kit.body),
    body(
      [
        { z: 2.9, w: 0.6, lo: 0.64, hi: 0.8, top: 0.1, bot: 0.4 },
        { z: 2.6, w: 0.76, lo: 0.52, hi: 0.8, top: 0.1, bot: 0.4 },
        { z: 0.8, w: 0.76, lo: 0.52, hi: 0.8, top: 0.1, bot: 0.4 },
        { z: 0.4, w: 0.6, lo: 0.64, hi: 0.82, top: 0.1, bot: 0.4 },
      ],
      kit.body,
    ),
    // The fin and its ventral half, over the tail rotor's gearbox.
    slab(FIN, 0.14, 0.03, 0, kit.body),
  ];

  // The mast standing out of the doghouse, on a collar. Nothing above the
  // doghouse but these and the head: see the disc clearance.
  bodyCyls.push(
    [0.22, 0.32, 0, 2.84, HUB_Z, kit.frame, "y"],
    [0.4, 0.08, 0, 2.74, HUB_Z, kit.frame, "y", 0.3],
  );

  // --- the nose: the sensor ball and the chin ---------------------------------
  //
  // The TSS is the sight the gunner actually lays through and the one thing
  // after the turret that says this aircraft hunts: a BALL standing forward of
  // a nose that tapers in to meet it — wider than the nose it sits on, or it
  // is only the nose's own blunt end. Its face is the pale `metal` the barrel
  // is — the truck station's reason — with the window dark in it. It is welded
  // here rather than turning: a sensor that tracked nothing would be a mesh
  // bought to do nothing. Its underside at 1.10 is what the gun elevated
  // forward passes under — see the fourth clearance.
  bodyCyls.push(
    [0.64, 0.34, 0, 1.35, 5.3, kit.body, "y"],
    [0.64, 0.1, 0, 1.57, 5.3, kit.body, "y", 0.4],
    [0.44, 0.08, 0, 1.14, 5.3, kit.body, "y", 0.64],
  );
  bodyBoxes.push(
    [0.36, 0.26, 0.03, 0, 1.36, 5.63, kit.metal],
    [0.4, 0.05, 0.08, 0, 1.51, 5.6, kit.frame],
  );
  // The BARBETTE the chin turret turns in. Welded to the airframe, so it is
  // drawn here rather than on the inert `turret` node — where it would have
  // cost a mesh of its own to do nothing.
  bodyCyls.push([0.5, 0.3, 0, 0.86, MG_Z, kit.frame, "y"]);

  for (const sx of [-1, 1]) {
    // The pitots on the nose's flanks, running forward past the ball.
    bodyShapes.push(
      rod([sx * 0.36, 1.46, 4.7], [sx * 0.38, 1.46, 5.5], 0.035, kit.metal, 6),
    );
    // Missile-warning sensors: small dark eyes on the nose's cheeks and at the
    // root of the boom, which is where the real ones look out from.
    bodyCyls.push(
      [0.11, 0.05, sx * (stationAt(FUSELAGE, 4.75).w / 2), 1.4, 4.75, kit.frame, "x"],
      [0.1, 0.05, sx * (stationAt(FUSELAGE, -2.2).w / 2), 1.96, -2.2, kit.frame, "x"],
    );
  }

  // The air-data mast on the nose's starboard shoulder, cranked forward at the
  // top — a thing no box ever had, and a Viper always does.
  bodyShapes.push(
    ...tube(
      [
        [0.34, 1.64, 4.6],
        [0.36, 2.16, 4.62],
        [0.36, 2.18, 4.94],
      ],
      0.04,
      kit.metal,
    ),
  );
  bodyBoxes.push([0.02, 0.1, 0.1, 0.36, 2.18, 4.9, kit.frame]);

  // --- the canopy's frame -----------------------------------------------------
  //
  // **What makes glazing read as glazing is its FRAME** — see the header's last
  // lesson. Each rod stands 1.5 cm outside the glass, so the ink draws both of
  // its edges. Bows at the gunner's windscreen, the blast barrier between the
  // two crews, the pilot's windscreen and the rear; rails along the sills and
  // the two roof edges.
  const rim = (s: Station, grow: number) => {
    const hw = s.w / 2 + grow;
    const hh = (s.hi - s.lo) / 2 + grow;
    const cy = (s.hi + s.lo) / 2;
    const sill = topAt(FUSELAGE, s.z).y - 0.02;
    return {
      sill: (sx: number): Point3 => [sx * (hw - 0.01), sill, s.z],
      shoulder: (sx: number): Point3 => [sx * hw, cy + hh * (1 - s.top), s.z],
      roof: (sx: number): Point3 => [sx * hw * (1 - s.top), cy + hh, s.z],
    };
  };
  for (const i of [1, 3, 4, 6]) {
    const r = rim(CANOPY[i], 0.015);
    bodyShapes.push(
      ...tube(
        [r.sill(-1), r.shoulder(-1), r.roof(-1), r.roof(1), r.shoulder(1), r.sill(1)],
        0.05,
        kit.frame,
      ),
    );
  }
  for (const sx of [-1, 1]) {
    bodyShapes.push(
      ...tube(CANOPY.map((s) => rim(s, 0.015).sill(sx)), 0.05, kit.frame),
      ...tube(CANOPY.slice(1).map((s) => rim(s, 0.015).roof(sx)), 0.045, kit.frame),
    );
  }
  // The wire cutters: one over the gunner's screen and one over the pilot's.
  // There is no lower one: the chin belongs to the gun, and a cutter under it
  // is something the gun traverses through.
  bodyShapes.push(
    rod([0, 2.06, 3.97], [0, 2.3, 3.8], 0.05, kit.frame, 6, 0.02),
    rod([0, ROOF_Y - 0.02, 2.5], [0, 2.64, 2.36], 0.05, kit.frame, 6, 0.02),
  );

  // --- the flanks -------------------------------------------------------------
  //
  // Panels in the BODY's own colour standing 1.5 cm proud, so the ink draws
  // their outline without laying a dark shape on the fuselage; the only dark
  // things below the glazing are small. See the header's third lesson.
  for (const sx of [-1, 1]) {
    const side = (z: number) => sx * (stationAt(FUSELAGE, z).w / 2 + 0.008);
    bodyBoxes.push(
      // The ammunition bay door under the gunner, and the avionics bay under
      // the pilot.
      [0.03, 0.34, 0.86, side(3.1), 1.18, 3.1, kit.body],
      [0.03, 0.3, 0.7, side(2.0), 1.16, 2.0, kit.body],
      // A cooling grille and a pair of kick-in steps below the pilot's sill.
      [0.03, 0.14, 0.2, side(1.0), 1.36, 1.0, kit.frame],
      [0.03, 0.05, 0.14, side(2.3), 0.96, 2.3, kit.frame],
      [0.03, 0.05, 0.14, side(2.3), 1.42, 2.4, kit.frame],
      // The formation-light strip on the nose.
      [0.02, 0.03, 0.34, side(4.5), 1.52, 4.5, kit.metal],
      // The chaff and flare dispensers on the boom's root, and a formation
      // strip further aft where the boom is all a player sees.
      [0.05, 0.16, 0.34, sx * (stationAt(FUSELAGE, -2.6).w / 2 + 0.02), 1.96, -2.6, kit.frame],
      [0.02, 0.03, 0.3, sx * (stationAt(FUSELAGE, -3.8).w / 2 + 0.008), 2.06, -3.8, kit.metal],
    );
  }

  // The doghouse's own furniture: the oil cooler's grille on its back behind
  // the mast, and an access door on each flank above the nacelles.
  const deck = topAt(DOGHOUSE, -0.3);
  bodyBoxes.push([deck.half * 1.1, 0.03, 0.3, 0, deck.y + 0.005, -0.3, kit.frame]);
  for (const sx of [-1, 1]) {
    const s = stationAt(DOGHOUSE, 0.45);
    bodyBoxes.push([0.03, 0.1, 0.5, sx * (s.w / 2 + 0.008), 2.49, 0.45, kit.body]);
  }

  // --- the engines ------------------------------------------------------------
  //
  // Two nacelles on the shoulders either side of the doghouse, each opening in
  // an intake forward and ending in the Viper's IR SUPPRESSOR — a big tapering
  // duct swept up and outboard, which is the one shape side-on that is this
  // aircraft and no other. Both stay under the blade line and inside the box.
  //
  // **Each is a TALL OVAL, and one loft from the intake to the suppressor's
  // mouth.** A round pod read as a pipe bolted to the shoulder; an oval taller
  // than it is wide is a cowling faired onto one, and it keeps the gap between
  // pod and doghouse that a wider section would close. The sections are
  // `ENGINE_SIDES`-gons turned half a side, so the top and the flanks are flat
  // faces the light bands on rather than ridges.
  const ENGINE_SIDES = 12;
  const oval = (z: number, x: number, y: number, w: number, h: number): Station => ({
    z,
    w,
    lo: y - h / 2,
    hi: y + h / 2,
    top: 0,
    bot: 0,
    n: ENGINE_SIDES,
    x,
  });
  for (const sx of [-1, 1]) {
    const x = sx * 0.8;
    bodyShapes.push(
      // The cowling and the suppressor: the intake's lip, the full section,
      // the break where the duct turns, and the duct rising and splaying to
      // its mouth.
      body(
        [
          oval(1.0, x, 2.1, 0.44, 0.62),
          oval(0.84, x, 2.1, 0.5, 0.7),
          oval(-0.9, x, 2.1, 0.5, 0.7),
          oval(-1.15, sx * 0.82, 2.13, 0.48, 0.66),
          oval(-2.2, sx * 0.99, 2.32, 0.4, 0.54),
        ],
        kit.body,
      ),
      // The suppressor's mouth: a dark plug standing out of the duct's end.
      body(
        [
          oval(-2.18, sx * 0.99, 2.32, 0.36, 0.48),
          oval(-2.27, sx * 1.0, 2.335, 0.34, 0.46),
        ],
        kit.frame,
      ),
      // The intake: a pale lip round its face, and the dark mouth inside it.
      body([oval(1.04, x, 2.1, 0.48, 0.66), oval(0.96, x, 2.1, 0.5, 0.7)], kit.metal),
      body([oval(1.07, x, 2.1, 0.34, 0.5), oval(1.02, x, 2.1, 0.34, 0.5)], kit.frame),
      // A cowling seam half way along.
      body([oval(0.12, x, 2.1, 0.52, 0.72), oval(0.08, x, 2.1, 0.52, 0.72)], kit.body),
      // The access latch strip along the top of each cowling.
      rod([x, 2.45, 0.8], [x, 2.45, -0.8], 0.04, kit.frame, 6),
    );
  }

  // --- the stub wings and their stores -----------------------------------------
  for (const sx of [-1, 1]) {
    const tipX = sx * (WING_TIP_X - 0.06);
    const px = sx * PYLON_X;
    const foil = (x: number, zLe: number, zTe: number, y: number, depth: number) =>
      aerofoil(zLe - zTe, depth).map(
        ([u, v]): Point3 => [x, y + v, (zLe + zTe) / 2 + u],
      );
    bodyShapes.push(
      // The wing itself: a real section at the root, a smaller one swept back
      // and dropped a little at the tip — a flat wing that long reads as a
      // plank.
      solid(
        foil(sx * WING_ROOT_X, WING_Z + 0.75, WING_Z - 0.75, WING_Y, 0.22),
        foil(tipX, WING_Z + 0.5, WING_Z - 0.42, WING_Y - 0.05, 0.14),
        kit.body,
      ),
      // The pylon dropping through the gap to the pod — see `WING_DROP`. It is
      // the GAP either side of this that the wing is read off, so it is thin,
      // and it is swept because a square one is a post.
      slab(
        [
          [WING_Z + 0.55, WING_Y - 0.04],
          [WING_Z - 0.62, WING_Y - 0.04],
          [WING_Z - 0.4, WING_Y - WING_DROP + 0.2],
          [WING_Z + 0.4, WING_Y - WING_DROP + 0.2],
        ],
        0.1,
        0.02,
        px,
        kit.frame,
      ),
    );
    // The tip fairing — the launcher's shoe and a sensor eye at its nose.
    bodyBoxes.push([0.07, 0.15, 1.02, tipX, WING_Y - 0.02, WING_Z + 0.07, kit.body]);
    bodyCyls.push([0.09, 0.06, tipX, WING_Y - 0.02, WING_Z + 0.6, kit.frame, "z"]);

    // **The rocket pod.** Nineteen tubes, and the tube MOUTHS are what says
    // so: a pale face with the nineteen dark in it in a hex, where a blank disc
    // reads as a fuel tank. Held forward of the aft cross tube and short of
    // the forward one.
    const podY = WING_Y - WING_DROP;
    const podZ = WING_Z - 0.15;
    bodyCyls.push(
      [0.44, 1.6, px, podY, podZ, kit.ord, "z"],
      [0.46, 0.06, px, podY, podZ + 0.7, kit.metal, "z"],
      [0.46, 0.06, px, podY, podZ - 0.7, kit.metal, "z"],
      [0.4, 0.02, px, podY, podZ + 0.805, kit.metal, "z"],
      [0.4, 0.02, px, podY, podZ - 0.805, kit.frame, "z"],
    );
    const mouths: [number, number][] = [[0, 0]];
    for (let k = 0; k < 6; k++) mouths.push([0.08, (k / 6) * Math.PI * 2]);
    for (let k = 0; k < 12; k++) mouths.push([0.155, (k / 12) * Math.PI * 2 + 0.26]);
    for (const [r, a] of mouths) {
      bodyCyls.push([
        0.052,
        0.02,
        px + Math.cos(a) * r,
        podY + Math.sin(a) * r,
        podZ + 0.815,
        kit.frame,
        "z",
      ]);
    }
    // The sway braces bearing on the pod's shoulders either side of the pylon.
    for (const dz of [-0.35, 0.35]) {
      for (const dx of [-0.13, 0.13]) {
        bodyBoxes.push([0.05, 0.07, 0.05, px + dx, podY + 0.2, podZ + dz, kit.frame]);
      }
    }

    // **The Sidewinder under the tip**, on its rail, with its fins crossed in
    // an X so that nothing of it reaches past the wing tip it hangs from.
    const mx = sx * (WING_TIP_X - 0.12);
    const my = WING_Y - 0.21;
    bodyBoxes.push([0.05, 0.08, 1.3, mx, WING_Y - 0.12, WING_Z + 0.1, kit.frame]);
    bodyCyls.push(
      [0.1, 1.8, mx, my, WING_Z + 0.2, kit.metal, "z"],
      [0.1, 0.2, mx, my, WING_Z + 1.2, kit.metal, "z", 0.03],
    );
    for (const [zFore, zAft, reach] of [
      [WING_Z + 0.98, WING_Z + 0.86, 0.1],
      [WING_Z - 0.46, WING_Z - 0.7, 0.14],
    ] as const) {
      for (const a of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
        const ux = Math.cos(a);
        const uy = Math.sin(a);
        const plate = (off: number): Point3[] => {
          const at = (r: number, z: number): Point3 => [
            mx + ux * r - uy * off,
            my + uy * r + ux * off,
            z,
          ];
          return [at(0.04, zFore), at(reach, zFore - 0.05), at(reach, zAft), at(0.04, zAft)];
        };
        bodyShapes.push(solid(plate(-0.006), plate(0.006), kit.metal));
      }
    }
  }

  // --- the tail ---------------------------------------------------------------
  for (const sx of [-1, 1]) {
    // The elevator, tapered and swept, at the boom's end.
    bodyShapes.push(
      solid(
        aerofoil(0.72, 0.08).map(([u, v]): Point3 => [sx * 0.2, 2.02 + v, -3.98 + u]),
        aerofoil(0.44, 0.06).map(([u, v]): Point3 => [sx * 1.1, 2.02 + v, -4.08 + u]),
        kit.body,
      ),
    );
  }
  // The tail rotor's gearbox on the fin's starboard face, and the shaft
  // fairing along the boom's back that drives it.
  bodyCyls.push([0.34, 0.26, 0.2, TAIL_Y, TAIL_Z, kit.body, "x"]);
  bodyShapes.push(
    rod(
      [0, topAt(FUSELAGE, -2.1).y + 0.02, -2.1],
      [0, topAt(FUSELAGE, -4.6).y + 0.02, -4.6],
      0.12,
      kit.body,
      8,
    ),
    // The tail skid, sprung off the ventral fin's foot.
    rod([0, 1.72, -5.46], [0, 1.52, -5.06], 0.05, kit.frame, 6),
  );
  bodyBoxes.push([0.07, 0.03, 0.16, 0, 1.5, -5.05, kit.metal]);
  // The landing light in the keel, well behind the gun's circle.
  bodyCyls.push([0.18, 0.06, 0, 0.5, 2.2, kit.metal, "y"]);
  // The aerials' feet — drawn here because a foot does not bend.
  const whip1: Point3 = [0.2, topAt(FUSELAGE, -2.55).y - 0.01, -2.55];
  const whip2: Point3 = [-0.14, topAt(FUSELAGE, -3.9).y - 0.01, -3.9];
  for (const [x, y, z] of [whip1, whip2]) {
    bodyCyls.push([0.09, 0.05, x, y + 0.01, z, kit.frame, "y"]);
  }
  segment("heli-body", sprung, bodyBoxes, bodyCyls, bodyShapes);

  // --- the glazing ----------------------------------------------------------
  //
  // Dark, for the gun truck's reason: the crew are INSIDE, and a pane you could
  // resolve a shape through is a pane with no shape behind it. One loft,
  // stepped, is the whole of what says TANDEM, and the frame above is what says
  // it is glass. Drawn rather than built with `Build.pane` — a vehicle carries
  // no breakable glass and is in nobody's pane index.
  segment(
    "heli-glass",
    sprung,
    [
      // The sensor's window, proud of its pale face.
      [0.24, 0.16, 0.04, 0, 1.35, 5.65, kit.glass],
    ],
    [],
    [body(CANOPY, kit.glass)],
  );

  // --- the team's colour ----------------------------------------------------
  //
  // On the BOOM and the FIN, which are what is left of a helicopter's shape at
  // range, and standing proud of the panel — a flash flush with a plate is
  // drawn inside that plate's own outline and is no marking at all. Some of it
  // faces every direction, which is what the conventions require of an accent.
  const nose = topAt(FUSELAGE, 4.62);
  segment(
    "heli-mark",
    sprung,
    [
      // A chevron on the nose, for the one bearing the other three miss.
      [Math.min(0.5, nose.half * 2 - 0.04), 0.05, 0.26, 0, nose.y + 0.015, 4.62, kit.accent],
    ],
    [],
    [
      // A band round the boom: visible from both flanks and from below.
      band(FUSELAGE, -3.35, -2.85, 0.02, kit.accent),
      // A band over the engine deck, for the bearing a helicopter is read from
      // that no ground vehicle ever is: from ABOVE, by whatever is higher.
      band(DOGHOUSE, -0.95, -0.65, 0.02, kit.accent),
      // The fin's cap, the highest thing on the aircraft after the disc — aft
      // of where the fin crosses the blade line.
      slab(
        [
          [-5.14, 3.28],
          [-5.66, 3.28],
          [-5.66, 3.4],
          [-5.22, 3.4],
        ],
        0.18,
        0.02,
        0,
        kit.accent,
      ),
    ],
  );

  // --- the two discs --------------------------------------------------------
  //
  // Everything on the head is built about the node's own origin and turned into
  // place by where its blade points, so the closure has one number to write.
  // Blade `i` runs out along `(sin a, cos a)`, and a positive turn of the node
  // carries it toward `(cos a, -sin a)` — which is where each blade's LEADING
  // edge is drawn.
  const mainRotor = new TransformNode("heli-rotor", scene);
  mainRotor.parent = sprung;
  mainRotor.position.set(0, HUB_Y, HUB_Z);
  const rotorBoxes: Box[] = [];
  const rotorShapes: Shape[] = [];
  for (let i = 0; i < BLADES; i++) {
    const a = (i / BLADES) * Math.PI * 2;
    const s = Math.sin(a);
    const c = Math.cos(a);
    /** A point `r` out along the blade, `u` toward its leading edge, `v` up. */
    const P = (r: number, u: number, v: number): Point3 => [s * r + c * u, v, c * r - s * u];
    const section = (r: number, chord: number, depth: number, shift: number, y: number) =>
      aerofoil(chord, depth).map(([u, v]) => P(r, u + shift, y + v));
    rotorShapes.push(
      // The blade, root to where the pale tip begins…
      solid(
        section(0.92, BLADE_W, 0.06, 0, 0.04),
        section(BLADE_TIP_R, BLADE_W, 0.05, 0, 0.04),
        kit.frame,
      ),
      // …and the SWEPT tip, narrowing and raked back: the pale thing that
      // makes four blades read as four rather than as a smear.
      solid(
        section(BLADE_TIP_R, BLADE_W, 0.05, 0, 0.04),
        section(BLADE_END, BLADE_W * 0.45, 0.03, -BLADE_W * 0.3, 0.04),
        kit.metal,
      ),
      // The pitch link down from the grip's horn to the swashplate — four of
      // them, and what makes the head read as a mechanism.
      rod(P(0.44, 0.13, -0.02), P(0.3, 0.13, -0.24), 0.04, kit.frame, 6),
    );
    rotorBoxes.push(
      // The yoke arm out of the hub, and the grip the blade is pinned into.
      [0.2, 0.06, 0.9, s * 0.4, 0.02, c * 0.4, kit.frame, 0, a],
      [0.17, 0.13, 0.52, s * 0.72, 0.03, c * 0.72, kit.frame, 0, a],
      // The pitch horn off the grip's leading edge.
      [0.06, 0.05, 0.14, s * 0.44 + c * 0.1, -0.01, c * 0.44 - s * 0.1, kit.frame, 0, a],
    );
  }
  segment(
    "heli-rotor",
    mainRotor,
    rotorBoxes,
    [
      // The hub, the cap over it, and the swashplate under it.
      [0.36, 0.2, 0, 0, 0, kit.metal, "y"],
      [0.3, 0.1, 0, 0.15, 0, kit.metal, "y", 0.16],
      [0.62, 0.06, 0, -0.25, 0, kit.metal, "y"],
    ],
    rotorShapes,
  );

  const tailRotor = new TransformNode("heli-tail-rotor", scene);
  tailRotor.parent = sprung;
  tailRotor.position.set(TAIL_X, TAIL_Y, TAIL_Z);
  const tailBoxes: Box[] = [];
  for (let i = 0; i < 4; i++) {
    // A box's depth turned by `rotX` about the rotor's own axis lies along
    // `(0, -sin a, cos a)`, so each part is placed on that same line.
    const a = (i / 4) * Math.PI * 2;
    const along = (r: number): [number, number] => [-Math.sin(a) * r, Math.cos(a) * r];
    const blade = (TAIL_R - 0.12 + 0.1) / 2;
    tailBoxes.push(
      [0.035, 0.17, TAIL_R - 0.24, 0, ...along(blade), kit.frame, a],
      [0.04, 0.175, 0.14, 0, ...along(TAIL_R - 0.09), kit.metal, a],
      // The pitch change link out of the spider.
      [0.1, 0.04, 0.05, -0.06, ...along(0.12), kit.frame, a],
    );
  }
  segment("heli-tail-rotor", tailRotor, tailBoxes, [
    [0.22, 0.12, 0.02, 0, 0, kit.metal, "x"],
    [0.12, 0.1, -0.08, 0, 0, kit.frame, "x", 0.16],
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
  segment(
    "heli-mg-ring",
    mgMount,
    [
      // The cheeks the gun is trunnioned in.
      [0.09, 0.26, 0.26, -0.22, 0.04, 0.04, kit.frame],
      [0.09, 0.26, 0.26, 0.22, 0.04, 0.04, kit.frame],
      // The ammunition chute coming down the barbette into it.
      [0.22, 0.22, 0.24, 0, 0.16, -0.18, kit.frame],
      // **The OPTIC**, on the port cheek and in METAL, which is the pale thing
      // that says where the gun is looking — the truck station's one lesson
      // about what an eye tracks, on a mount the eye would otherwise lose
      // against the shadow under the nose.
      [0.16, 0.16, 0.2, -0.25, 0.13, 0.06, kit.metal],
    ],
    [
      // The turret's drum: the only part of the chin that turns with the
      // bearing.
      [0.46, 0.26, 0, -0.02, 0, kit.frame, "y"],
      [0.36, 0.06, 0, -0.17, 0, kit.frame, "y", 0.46],
    ],
  );

  const mgGun = new TransformNode("heli-mg-gun", scene);
  mgGun.parent = mgMount;
  segment(
    "heli-mg",
    mgGun,
    [
      // The breech and the feed under it.
      [0.2, 0.2, 0.36, 0, 0, 0.02, kit.frame],
      [0.16, 0.14, 0.2, 0, -0.12, -0.06, kit.frame],
    ],
    [
      // The rotor housing the barrels turn in, and the mid and muzzle clamps.
      [0.2, 0.14, 0, 0, 0.26, kit.frame, "z"],
      [0.15, 0.035, 0, 0, 0.43, kit.frame, "z"],
      [0.16, 0.05, 0, 0, 0.62, kit.frame, "z"],
      // **THREE barrels in a cluster**, which is the one detail that says this
      // is a gunship's cannon rather than a machine gun bolted under a nose.
      // The gun does not spin: there is no node for it, and a rotary that
      // turned would be a mesh bought for a thing seen from behind at fourteen
      // metres.
      [0.05, 0.46, 0, 0.048, 0.43, kit.metal, "z"],
      [0.05, 0.46, 0.042, -0.024, 0.43, kit.metal, "z"],
      [0.05, 0.46, -0.042, -0.024, 0.43, kit.metal, "z"],
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

  // **The gunner's eye, at the outer face of the optic head drawn on the port
  // cheek above** — the pale metal box two segments up, which exists to tell a
  // player from outside where this gun is looking and now tells the gunner the
  // same thing from in front of it.
  //
  // It is on `mgGun` rather than on the mount the head is drawn on, for the
  // reason `VehicleRig.mgSight` gives, and the three figures are the two
  // clearances that bound it:
  //
  // - **`z` clears the BARBETTE**, which is welded to the airframe and stands
  //   0.25 forward of the trunnion at its own front face. At `mg.pitchMax` the
  //   eye swings back to 0.213 and up to 0.848 over the pad, which is inside
  //   the barbette's own 0.71..1.01 band — so what keeps it out is `x`, at 0.07
  //   clear of that fitting's radius, and the edge it passes is well off the
  //   sight line and never in the picture.
  // - **`y` is the optic head's own centre and `x` its outer face**, so the
  //   barrel hangs below and to starboard exactly as it is drawn to.
  // - **And it is over the PAD at full depression**, which is the same
  //   clearance `MG_REACH` is measured against one line up: at `mg.pitchMin`
  //   this stands 0.460 over a pad the skids put at 0, where the muzzle beside
  //   it stands 0.074. Re-measure both if `MG_Y`, `MG_Z` or either pitch limit
  //   moves.
  const mgSight = new TransformNode("heli-mg-sight", scene);
  mgSight.parent = mgGun;
  mgSight.position.set(-0.32, 0.13, 0.3);

  // --- the aerials ------------------------------------------------------------
  //
  // Two whips on the boom's back, either side of the shaft fairing: the long
  // one forward and the short one aft, whose feet are drawn in the body. SHORT
  // both, because the main disc is overhead — the version before the gunship
  // stood 1.15 m of mast here and put its tip six centimetres through the blade
  // path. See the first clearance.
  const whips: Whip[] = [];
  for (const [i, [foot, length, phase]] of (
    [
      [whip1, ANTENNA_LENGTH, 0],
      [whip2, SHORT_ANTENNA, 2.1],
    ] as const
  ).entries()) {
    const base = new TransformNode(`heli-whip-base${i}`, scene);
    base.parent = sprung;
    base.position.set(foot[0], foot[1], foot[2]);
    const tip = new TransformNode(`heli-whip-tip${i}`, scene);
    tip.parent = base;
    tip.position.y = length / 2;
    const half = length / 2;
    segment(`heli-whip-lo${i}`, base, [], [
      [0.045, half, 0, half / 2, 0, kit.frame, "y", 0.036],
    ]);
    segment(`heli-whip-hi${i}`, tip, [], [
      [0.036, half, 0, half / 2, 0, kit.frame, "y", 0.024],
    ]);
    // A cantilever's natural frequency goes as 1/L^2 — see `Whip.rate`.
    whips.push({ base, tip, rate: (ANTENNA_LENGTH / length) ** 2, phase });
  }
  // Longest first, which is the order `rate` is measured against.
  const antennae: readonly Whip[] = whips;

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
    mgSight,
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
