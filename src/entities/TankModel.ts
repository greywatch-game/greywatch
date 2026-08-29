/**
 * TankModel.ts — The TANK's mesh: ~180 boxes and cylinders merged down
 * to twenty-six, with a turret and a gun that turn, a cupola gun that turns
 * independently of both, tracks that RUN, two antennae that BEND, and the
 * charred repaint a wreck takes.
 * Owns: the ART. Every extent in here is a drawing decision and belongs to this
 * file; the extents that are RULES — the collider box, the hit sphere, the
 * cupola a bot aims at — are `CONFIG.vehicles.tank` and are read, not restated.
 * The one number that has to agree with the config is the hull's own height,
 * and it is asserted by construction: the drawn hull is built to
 * `CONFIG.vehicles.tank.hull`, so the box a round stops on and the box you can
 * see are the same box.
 *
 * Invariants, all three inherited from `SoldierModel` and all three for its
 * reasons:
 * - **Merged per colour per segment.** The outline pass draws every mesh twice,
 *   so this model's cost is COLOURS PER SEGMENT and not boxes. A hundred and
 *   eighty parts come out as twenty-four meshes, and a wheel that costs sixty
 *   triangles instead of twelve costs nothing at all — see `Cyl`. **Four of the
 *   twenty-six are there because a mesh that MOVES differently cannot merge
 *   with anything**, which is the one thing that buys a mesh here: six for the
 *   tracks, four for the two antennae, two for the commander's gun on its own
 *   ring, and nothing else in the model has earned one.
 * - **The joints are `TransformNode`s above the merged meshes**, so the turret
 *   traversing, the gun elevating and the tracks running are transforms and
 *   never a re-merge.
 * - **Nothing here is emissive.** `Game`'s GlowLayer scan is construction-time
 *   and a tank is built per round, so a bloom-eligible material on one would
 *   never be excluded by the `noGlow` contract and would glow for the rest of
 *   the round. The rear lens `world/kit/core.ts` allows itself is exactly the
 *   thing this model may not have.
 *
 * `+Z is forward`, matching the yaw convention everywhere else in the game
 * (`forward = (sin(yaw), 0, cos(yaw))`), and `y = 0` is the bottom of the
 * tracks — the point the ground probe puts on the floor.
 *
 * ## Six of the twenty meshes move, and that is the whole of the tracks
 *
 * A track is a belt: it cannot be drawn as one mesh and animated, because the
 * links go round a loop and a rigid mesh only slides. What it is drawn as is a
 * static BAND with a strip of raised links laid along it, and the strip is
 * slid by how far that track has run, modulo the link pitch — which is exactly
 * a scroll, because the pattern repeats at the pitch. Two strips a side (the
 * ground run goes backwards under a hull driving forwards, the return run goes
 * forwards) and the drive sprocket, whose TEETH are the one thing on the
 * running gear whose rotation can be seen at all: a plain road wheel is a disc,
 * and a disc turning about its own axis is indistinguishable from a disc.
 *
 * The seam is where the strip wraps, and it is hidden rather than solved. A
 * strip is built one link PAST each end of its run and slid at most one pitch,
 * so the link that overshoots is inside the sprocket's or the idler's own
 * silhouette — which is why those two are exactly loop-sized (`END_R`) and the
 * road wheels are not. Widen the pitch or shrink an end wheel and links appear
 * out of the air at the ends of the tracks.
 *
 * `Vehicle` owns how far each track has run and this file owns what that looks
 * like; `TRACK_GAUGE` is exported because splitting one hull speed into two
 * track speeds needs the distance between them, and that distance is a drawing
 * decision made here.
 *
 * ## Four more move, and they are the two antennae
 *
 * A whip is the one part of a tank that is not a rigid body, and it is drawn as
 * two links so that it can BOW: the lower turns at the mast foot and the upper
 * hangs off its top, taking the leftover angle. `Vehicle` owns the bend for the
 * same reason it owns the track run — it is a consequence of the drive, and of
 * how fast the hull the mast is bolted to is leaning — and this file owns what
 * it looks like. `ANTENNA_LENGTHS` is exported on `TRACK_GAUGE`'s precedent:
 * the two lengths are a drawing decision, and the spring that bends them is
 * scaled by their ratio rather than tuned twice.
 */
import { Scene, TransformNode } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { CelMaterialFactory } from "../shaders/CelShader";
import type { Team } from "./Combatant";
import {
  inkRig,
  paintRig,
  segmentOf,
  setAntennaBend,
  type Box,
  type Cyl,
  type VehicleRig,
  type Whip,
} from "./vehicleRig";

/**
 * What one side's armour is PAINTED in — the same three-way read the soldier
 * kit uses, for the same reason and with one of the three deleted.
 *
 * **Hue and accent carry it; silhouette cannot.** A tank is one shape whoever
 * owns it, because the alternative is two vehicle models and a player learning
 * which hull is which before they learn which way it is pointing. What replaces
 * it is SIZE: a tank is the only thing on the map at this scale, so the
 * question a player asks about one is never "what is that" and always "whose is
 * it" — which is exactly the question a saturated accent answers and a
 * silhouette answers slowly.
 *
 * The accent is `CONFIG.teams[].color`, read rather than written here for the
 * reason `SoldierModel`'s is: it is the friend/foe colour the deploy map, the
 * flag markers and the killfeed all share, and a vehicle wearing a fifth colour
 * of its own would be the one thing on the field carrying the wrong marker.
 */
interface TankKit {
  /** The hull and turret plate — most of the vehicle. */
  armor: string;
  /** The band, the gun barrel and the machine guns: the darkest thing here. */
  track: string;
  /**
   * Road wheels, drive sprocket and idler — a step LIGHTER than the track they
   * run in, and that contrast is load-bearing rather than decorative. See the
   * running gear in `buildTank`.
   */
  wheel: string;
  /**
   * The raised links laid along the band, and the one colour on the model that
   * exists to be SEEN MOVING. A step lighter than the band under it for the
   * reason the wheels are a step lighter still: a scrolling strip in the band's
   * own value scrolls invisibly, which is a frame budget spent on nothing.
   */
  link: string;
  /** Stowage, tools, the exhaust: the greebles that break the plate up. */
  stow: string;
  /** The friend/foe colour, from `CONFIG.teams`. */
  accent: string;
}

/** One kit per team, indexed by `Team`. Warm against cold, as the soldiers are. */
const KITS: readonly TankKit[] = [
  {
    armor: "#5a5844",
    track: "#232220",
    wheel: "#3f3d38",
    link: "#34322d",
    stow: "#6d6a55",
    accent: CONFIG.teams[0].color,
  },
  {
    armor: "#464b52",
    track: "#1e2023",
    wheel: "#383c41",
    link: "#2d3035",
    stow: "#585d64",
    accent: CONFIG.teams[1].color,
  },
];

/** The gun barrel's length, which the muzzle node sits at the end of. */
const BARREL_LENGTH = 4.4;

// --- the running gear's own frame, in the rig's coordinates ----------------
//
// Everything about a track hangs off these five numbers, and three of them are
// tied to each other rather than chosen: the loop is as tall as the end wheels
// are wide, the belt is thin enough that a road wheel fits between its runs,
// and the link pitch is short enough that a strip slid by one of them is still
// behind an end wheel. See the header on the seam.

/** How thick the band is — the ground run and the return run both. */
const BELT = 0.16;
/** The top of the return run, above the ground face the hull stands on. */
const LOOP = 1.0;
/** How wide the band is. The wheels are proud of it; nothing else is. */
const TRACK_W = 0.66;
/** Sprocket and idler: exactly loop-sized, which is what hides the strips' seam. */
const END_R = LOOP / 2;
/** Every wheel on the vehicle turns about this height. */
const HUB_Y = LOOP / 2;
/** Road wheels, which are smaller than the two that close the loop. */
const ROAD_R = 0.34;
/**
 * How far the road wheels reach fore and aft of the hull's centre.
 *
 * Exported on `TRACK_GAUGE`'s precedent, and it is NOT `TRACK_REACH`: the
 * suspension's travel is bounded at the wheel STATIONS rather than at the ends
 * of the belt, because a bump stop is something a road-wheel arm reaches and
 * the sprocket and the idler have no arms at all. `Vehicle` cannot say how far
 * the body may tilt without knowing where the outermost wheel is, and where it
 * is is a drawing decision made here.
 */
export const WHEEL_REACH = 2.11;
/**
 * How far the tub's floor stands above the face the tracks stand on — this
 * vehicle's ground clearance, and therefore the ceiling on how far its body
 * may travel DOWN onto its running gear.
 *
 * **It is a suspension number as much as a drawing one, and it was the reason
 * the suspension had nowhere to work.** Drawn at 8 cm, this tank had a sixth
 * of a real MBT's clearance (an M1 sits on 0.48 m of it) and any body travel
 * worth seeing put the belly through the road — so the travel was clamped down
 * to where it could not be seen, and what was left over was spent tilting the
 * whole vehicle, tracks and all, into the ground. `CONFIG`'s `heaveBump` is
 * sized against this and the ratio between them is what the stop MEANS: a hull
 * at full compression is one whose belly is nearly on the road.
 *
 * Seen from nowhere a player stands — the tracks hide it from the side and the
 * chase camera is two metres up — which is exactly why it was free to be wrong.
 */
const BELLY = 0.34;
/** How far apart the raised links are laid. The scroll's period, exactly. */
const LINK_PITCH = 0.22;

/** Half the hull, less half a band, less the 6 cm the sponson overhangs by. */
const TRACK_X = CONFIG.vehicles.tank.hull.width / 2 - TRACK_W / 2 - 0.06;
/** Where the sprocket and the idler stand, fore and aft of the hull's centre. */
const END_Z = CONFIG.vehicles.tank.hull.length / 2 - 0.6;

/**
 * How far fore and aft of the hull's centre the ground run actually reaches —
 * the sprocket at one end and the idler at the other, which is where a track
 * stops touching anything.
 *
 * Exported on `TRACK_GAUGE`'s precedent and for the same reason: `Vehicle` stands
 * the hull on six TRACK CONTACTS and cannot place them without knowing where
 * the tracks are, and where they are is a drawing decision made here. Using
 * the collider's own half-length instead would sample 0.6 m past the end of
 * the belt at each end, which is a hull rearing up on a kerb its tracks have
 * not reached yet.
 */
export const TRACK_REACH = END_Z;

/**
 * The distance between the two tracks' centrelines.
 *
 * Exported because `Vehicle` splits one hull speed into two track speeds and
 * cannot do it without this — a hull turning at `w` rad/s runs its outer track
 * `w * TRACK_GAUGE / 2` faster than its inner one, which is the whole of why a
 * tank pivoting on the spot has its tracks going opposite ways. It is a
 * DRAWING decision (the bands could be anywhere across the hull), so it is
 * decided here and read there rather than restated in `CONFIG`.
 */
export const TRACK_GAUGE = TRACK_X * 2;

/**
 * The two whip antennae's lengths in metres, the long one first.
 *
 * Exported for the same reason `TRACK_GAUGE` is: it is a DRAWING decision made
 * here (the masts could be any length), and `Vehicle` cannot bend them without it.
 * A cantilever's natural frequency goes as 1/L^2, so the ratio between these
 * two numbers is the whole of why the pair never swing in step — one config
 * spring is scaled by it rather than the short mast being given figures of its
 * own. See `CONFIG.vehicles.tank.antenna`.
 */
export const ANTENNA_LENGTHS = [1.5, 1.2] as const;

/** One side's moving parts: the two link strips and the toothed sprocket. */
interface TrackSide {
  /** The ground run's links. Slides backwards under a hull driving forwards. */
  lower: TransformNode;
  /** The return run's links, which go the other way. */
  upper: TransformNode;
  /** Turns at `run / END_R`. The one wheel whose rotation can be seen. */
  sprocket: TransformNode;
}

/**
 * Builds one tank in a team's colours.
 *
 * Built once per hardstanding and never disposed inside a round — the same rule
 * the bot rig pool follows, and for the same reason: this is ~180 parts, twenty
 * merges and their GL buffers, which is not a cost to pay on the frame a hull
 * respawns. `resetTankPose` is what a fresh one goes through instead.
 */
export function buildTank(
  scene: Scene,
  mats: CelMaterialFactory,
  team: Team,
): VehicleRig {
  const kit = KITS[team];
  const t = CONFIG.vehicles.tank;
  // The drawn hull is built to the collider's own extents rather than to
  // numbers of its own, so the shape a round stops on and the shape a player
  // aims at cannot drift apart. Everything below is expressed against these.
  const L = t.hull.length;
  const W = t.hull.width;
  const H = t.hull.height;

  const root = new TransformNode("tank", scene);
  const hull = new TransformNode("tank-hull", scene);
  hull.parent = root;
  // Everything the springs carry, which is everything except the running gear.
  // See `VehicleRig.sprung`.
  const sprung = new TransformNode("tank-sprung", scene);
  sprung.parent = hull;

  const { meshes, livery, segment } = segmentOf(scene, mats);

  // --- the band: two flat runs, closed at each end by a wheel ---------------
  //
  // The loop is drawn as what a side view of one IS — a run on the ground, a
  // run over the wheels, and a circle at each end — rather than as the solid
  // slab the first version used. The slab was what made the vehicle read as an
  // APC: a tracked hull is mostly HOLE between its runs, and the road wheels
  // filling that hole are the whole silhouette.
  const belt: Box[] = [];
  for (const side of [-1, 1]) {
    const x = side * TRACK_X;
    belt.push([TRACK_W, BELT, END_Z * 2, x, BELT / 2, 0, kit.track]);
    belt.push([TRACK_W, BELT, END_Z * 2, x, LOOP - BELT / 2, 0, kit.track]);
  }
  segment("tank-belt", hull, belt);

  // --- the wheels that do not move: six road wheels a side, and the idler ---
  //
  // **The wheels are their own COLOUR and that is the whole reason the tank
  // reads as tracked.** Built in the track's own dark grey they were invisible:
  // a wheel inside a band of the same value has no edge to see, and the
  // vehicle came out with a black slab where its running gear should be. One
  // extra colour on this segment is one more mesh and one more outline pass per
  // hull on the field, which is the cheapest thing in this file.
  //
  // Proud of the band by 7 cm a side, for the same reason: flush, they are
  // inside its silhouette and cannot be seen at all.
  const WHEEL_W = TRACK_W + 0.14;
  const wheels: Cyl[] = [];
  for (const side of [-1, 1]) {
    const x = side * TRACK_X;
    for (let i = 0; i < 6; i++) {
      const z = -WHEEL_REACH + (i * (WHEEL_REACH * 2)) / 5;
      wheels.push([ROAD_R * 2, WHEEL_W, x, HUB_Y, z, kit.wheel, "x"]);
      // The hub cap: a lighter disc at the centre of a wheel, which is what
      // stops six flat circles reading as six holes. Rotationally symmetric on
      // purpose — see the header on why only the sprocket turns.
      wheels.push([0.24, WHEEL_W + 0.06, x, HUB_Y, z, kit.stow, "x"]);
    }
    // The idler closes the front of the loop. Loop-sized, and 2 cm under it so
    // the disc never dips below the face the hull stands on.
    wheels.push([END_R * 2 - 0.02, WHEEL_W, x, HUB_Y, END_Z, kit.wheel, "x"]);
    wheels.push([0.3, WHEEL_W + 0.06, x, HUB_Y, END_Z, kit.stow, "x"]);
  }
  segment("tank-wheel", hull, [], wheels);

  // --- the parts that run: two link strips a side, and the sprocket ---------
  const tracks = [] as unknown as [TrackSide, TrackSide];
  for (const side of [-1, 1]) {
    const x = side * TRACK_X;
    // One link past each end of the run, so the strip can be slid a whole
    // pitch and still have a link where the belt ends. See the header.
    const links: Box[] = [];
    for (let z = -END_Z - LINK_PITCH; z <= END_Z + LINK_PITCH; z += LINK_PITCH) {
      links.push([TRACK_W + 0.07, BELT + 0.06, 0.12, 0, 0, z, kit.link]);
    }
    const lower = new TransformNode("tank-link-lo", scene);
    lower.parent = hull;
    lower.position.set(x, BELT / 2, 0);
    segment("tank-link-lo", lower, links);

    const upper = new TransformNode("tank-link-hi", scene);
    upper.parent = hull;
    upper.position.set(x, LOOP - BELT / 2, 0);
    segment("tank-link-hi", upper, links);

    // The sprocket, at the back and built about its own axle so the node can
    // simply turn. Its teeth are what makes that turn visible at all.
    const sprocket = new TransformNode("tank-sprocket", scene);
    sprocket.parent = hull;
    sprocket.position.set(x, HUB_Y, -END_Z);
    const teeth: Box[] = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      // A box's local +Y turned by `rotX = a` points along (0, cos a, sin a),
      // which is the radius it is standing on — so the tooth stands out of the
      // rim rather than lying across it.
      teeth.push([
        TRACK_W + 0.1,
        0.2,
        0.14,
        0,
        Math.cos(a) * 0.4,
        Math.sin(a) * 0.4,
        kit.wheel,
        a,
      ]);
    }
    segment("tank-sprocket", sprocket, teeth, [
      [0.68, WHEEL_W, 0, 0, 0, kit.wheel, "x"],
    ]);
    tracks.push({ lower, upper, sprocket });
  }

  // --- hull: the tub, the sponson over the tracks, the glacis and the deck ---
  //
  // **The sponson is the fix for a hull that read as three stacked slabs.** The
  // first version had a narrow tub between the tracks, a fender strip over each
  // one and then a full-width deck floating above both, which left an open
  // recess down each flank — the tiers were what the eye picked up instead of
  // the vehicle. A tank's hull OVERHANGS its tracks in one unbroken side, so
  // that is what this is: one full-width box from just above the track to the
  // turret ring, with everything else laid onto it.
  //
  // The hull's top, and therefore where the turret ring sits. Derived from the
  // collider's own height rather than authored, so that raising the box raises
  // the vehicle drawn inside it: what is left above this is the 0.95 m the
  // ring, the turret box and its rake need to reach the top of the box exactly.
  const deckY = H - 0.95;
  // **The nose is a STAIRCASE and not a chamfer, because a box cannot have a
  // corner taken off it.** The first version laid a thin raked plate over a
  // square hull, which left a wedge of open air between the plate's back and
  // the hull's front face — from three-quarters on it read as a triangular
  // hole punched in the front of the tank. What closes it is building the nose
  // UP to the slope instead: the sponson stops short, a step carries the hull
  // out to the nose, and the glacis is a plate thick enough to overlap the
  // sponson's front face at every height it crosses. Nothing here may reach
  // below `LOOP`: the tracks are there, and armour drawn through a road wheel
  // is worse than the hole this replaced.
  const GLACIS_RAKE = Math.PI / 4;
  /** Where the sponson stops and the nose begins. */
  const NOSE_Z = 2.55;
  /** The tail's rake, which is shallower than the nose's, as a tank's is. */
  const TAIL_RAKE = -1.166;
  segment("tank-body", sprung, [
    // The tub, between the tracks and down to the belly, stopping under the
    // step so that the only thing forward of the nose is the idler. Its floor
    // is `BELLY` and not a drawing choice — see there.
    [W - TRACK_W * 2 - 0.12, 1.02 - BELLY, 6.1, 0, (1.02 + BELLY) / 2, 0, kit.armor],
    // The sponson: the hull proper, full width, overhanging both tracks, and
    // stopping where the glacis and the tail plate take over.
    [
      W,
      deckY - 1.02,
      NOSE_Z + 3.3,
      0,
      (deckY + 1.02) / 2,
      (NOSE_Z - 3.3) / 2,
      kit.armor,
    ],
    // The step out to the nose, and the glacis over it. The step is sized to
    // OVERLAP the plate's inner face rather than to meet it: leave a
    // centimetre between them and what shows through is a dark slot at the
    // base of the glacis, which is the same hole in miniature.
    [W, 0.36, 0.62, 0, 1.2, 2.74, kit.armor],
    [W, 0.4, 0.92, 0, 1.484, 2.734, kit.armor, GLACIS_RAKE],
    // The tail plate, raked the other way and shallower.
    [W, 0.4, 1.01, 0, 1.406, -3.166, kit.armor, TAIL_RAKE],
    // The engine deck, a step above the fighting compartment's roof — and
    // BEHIND the turret's own sweep. Everything drawn above the deck within
    // reach of the ring is something a traversing turret drives through.
    [W - 0.5, 0.14, 0.75, 0, deckY + 0.07, -2.87, kit.armor],
    // Two panels on the front deck, which is otherwise a metre of bare plate
    // between the driver and the turret ring. Flat, for the same reason.
    [1.1, 0.07, 0.5, -0.75, deckY + 0.03, 1.95, kit.armor],
    [0.7, 0.07, 0.4, 0.85, deckY + 0.03, 2.0, kit.armor],
    // The fenders: a lip along the top of each track, which is what stops the
    // sponson's underside reading as a floating shelf.
    [TRACK_W + 0.34, 0.14, L - 0.5, TRACK_X, LOOP + 0.07, 0, kit.armor],
    [TRACK_W + 0.34, 0.14, L - 0.5, -TRACK_X, LOOP + 0.07, 0, kit.armor],
    // The driver's hatch, lying on the glacis at the glacis' own angle.
    [0.6, 0.1, 0.5, -0.7, 1.74, 2.84, kit.armor, GLACIS_RAKE],
  ]);

  segment("tank-stow", sprung, [
    // **Bins hang off the FLANK and not off the fender**, which is where they
    // were first drawn and where they were invisible: the sponson overhangs
    // the tracks, so the fender's whole depth is under a metre of armour and
    // anything standing on it is inside the hull. What a flank bin costs is
    // 30 cm of width the collider does not have, and what it buys is the six
    // metres of unbroken plate down each side reading as a vehicle rather than
    // as a shipping container.
    [0.3, 0.52, 1.6, W / 2 + 0.14, 1.48, -1.3, kit.stow],
    [0.28, 0.4, 0.9, W / 2 + 0.13, 1.45, 0.6, kit.stow],
    [0.3, 0.46, 2.2, -(W / 2 + 0.14), 1.5, -1.0, kit.stow],
    // The exhaust, on the left flank behind the bins.
    [0.26, 0.5, 0.7, -(W / 2 + 0.12), 1.45, -2.6, kit.stow],
    // Mud flaps, fore and aft of both fenders. Short: they hang in front of
    // the tracks, so every centimetre of them is in the nose's silhouette.
    [TRACK_W + 0.3, 0.26, 0.07, TRACK_X, 0.94, 3.34, kit.stow],
    [TRACK_W + 0.3, 0.26, 0.07, -TRACK_X, 0.94, 3.34, kit.stow],
    [TRACK_W + 0.3, 0.26, 0.07, TRACK_X, 0.94, -3.34, kit.stow],
    [TRACK_W + 0.3, 0.26, 0.07, -TRACK_X, 0.94, -3.34, kit.stow],
    // Headlights, on the glacis and lying along it. Boxes and not lenses:
    // nothing on this model may be emissive — see the header.
    [0.22, 0.12, 0.18, 1.26, 1.59, 2.99, kit.stow, GLACIS_RAKE],
    [0.22, 0.12, 0.18, -1.26, 1.59, 2.99, kit.stow, GLACIS_RAKE],
    // The engine deck's louvres, on the deck the turret cannot reach.
    [W - 0.78, 0.05, 0.14, 0, deckY + 0.16, -2.62, kit.stow],
    [W - 0.78, 0.05, 0.14, 0, deckY + 0.16, -2.87, kit.stow],
    [W - 0.78, 0.05, 0.14, 0, deckY + 0.16, -3.12, kit.stow],
    // Tow hooks on the step, and the pintle at the tail.
    [0.24, 0.24, 0.4, -0.95, 1.14, 3.05, kit.stow],
    [0.24, 0.24, 0.4, 0.95, 1.14, 3.05, kit.stow],
    [0.3, 0.24, 0.3, 0, 1.15, -3.47, kit.stow],
    // The tow cable, run along the top of each flank under the deck edge —
    // thin, because at 10 cm it read as a slot cut in the side of the hull.
    [0.07, 0.07, 2.2, W / 2 + 0.02, 1.72, 0.9, kit.track],
    [0.07, 0.07, 2.2, -(W / 2 + 0.02), 1.72, 0.9, kit.track],
    // Spare track links, stowed on the glacis where a crew would weld them.
    [0.5, 0.09, 0.18, 0.55, 1.62, 2.94, kit.track, GLACIS_RAKE],
    [0.5, 0.09, 0.18, 0.55, 1.8, 2.76, kit.track, GLACIS_RAKE],
    // The driver's periscopes, at the top of the plate in front of his hatch.
    [0.16, 0.07, 0.12, -0.92, 1.93, 2.62, kit.track, GLACIS_RAKE],
    [0.16, 0.07, 0.12, -0.7, 1.93, 2.62, kit.track, GLACIS_RAKE],
    [0.16, 0.07, 0.12, -0.48, 1.93, 2.62, kit.track, GLACIS_RAKE],
  ]);

  // The friend/foe marking, and it is a PATCH now rather than the skirt-sized
  // panel it started as. At 0.42 m tall and six metres long down each flank the
  // team colour was most of the vehicle from the side — a school bus, not a
  // marking — and the read a marking needs is "some of it faces every
  // direction", not "as much of it as will fit". See `TankKit`.
  segment("tank-mark", sprung, [
    [0.09, 0.4, 0.55, W / 2 - 0.01, 1.35, -2.6, kit.accent],
    [0.09, 0.4, 0.55, -(W / 2 - 0.01), 1.35, -2.6, kit.accent],
    [0.9, 0.1, 0.24, 0, 1.62, -3.35, kit.accent, TAIL_RAKE],
  ]);

  // --- turret: traverses on the deck, a little behind centre ---------------
  const turret = new TransformNode("tank-turret", scene);
  turret.parent = sprung;
  turret.position.set(0, deckY + 0.06, -0.3);
  /** Where the commander stands, in the turret's own frame. */
  const cupolaY = t.cupolaHeight - (deckY + 0.06);

  segment("tank-turret-m", turret, [
    // The ring it sits on, then the turret itself: a box for the crew space, a
    // bustle behind it, and two cheeks turned in to a wedge at the mantlet.
    // The cheeks are the whole difference between a turret and a crate — see
    // `Box` on `rotY`.
    [2.5, 0.12, 2.5, 0, 0, 0, kit.track],
    [2.55, 0.84, 2.35, 0, 0.47, -0.5, kit.armor],
    [2.3, 0.5, 0.75, 0, 0.42, -1.95, kit.armor],
    [0.7, 0.84, 1.7, 0.985, 0.47, 0.6, kit.armor, 0, -0.34],
    [0.7, 0.84, 1.7, -0.985, 0.47, 0.6, kit.armor, 0, 0.34],
    [1.45, 0.84, 0.55, 0, 0.47, 1.2, kit.armor],
    // The roof plate over the wedge, raked back like the glacis under it.
    [1.5, 0.16, 0.85, 0, 0.66, 1.32, kit.armor, 0.62],
  ], [
    // The commander's cupola and its lid, and the loader's hatch beside it.
    // Round, because the two hatches are the only thing on the roof and a
    // square one is a crate lid. `cupolaHeight` is measured from the tracks,
    // so this sits at whatever is left after the deck and the ring.
    [0.86, 0.42, -0.62, cupolaY, 0.15, kit.armor, "y"],
    [0.78, 0.1, -0.62, cupolaY + 0.26, 0.15, kit.armor, "y"],
    [0.66, 0.12, 0.66, 0.93, 0.05, kit.armor, "y"],
  ]);

  segment("tank-turret-stow", turret, [
    // The bin along the bustle roof, the smoke dischargers' brackets and the
    // two antenna mounts. The MASTS themselves are not in here and cannot be —
    // see the antennae below — and neither is the commander's GUN, for the
    // identical reason one scale down: it traverses on its own ring.
    [1.9, 0.42, 0.62, 0, 0.72, -1.92, kit.stow],
    [0.52, 0.3, 0.22, 1.12, 0.62, 0.32, kit.stow, 0, -0.34],
    [0.52, 0.3, 0.22, -1.12, 0.62, 0.32, kit.stow, 0, 0.34],
    // The commander's gun is NOT in here any more and cannot be: it is laid by
    // a second crewman on a ring of its own, which is a joint. See `mgMount`.
  ], [
    // Three smoke dischargers a side, all in the colour the brackets above
    // already carry, so the lot is free.
    [0.15, 0.3, 0.95, 0.62, 0.46, kit.stow, "z"],
    [0.15, 0.3, 1.11, 0.62, 0.52, kit.stow, "z"],
    [0.15, 0.3, 1.27, 0.62, 0.58, kit.stow, "z"],
    [0.15, 0.3, -0.95, 0.62, 0.46, kit.stow, "z"],
    [0.15, 0.3, -1.11, 0.62, 0.52, kit.stow, "z"],
    [0.15, 0.3, -1.27, 0.62, 0.58, kit.stow, "z"],
    // The two mast feet, which stay in the merge: what bends is above them.
    [0.09, 0.14, 1.08, 0.72, -1.5, kit.stow, "y"],
    [0.09, 0.14, -1.08, 0.72, -1.7, kit.stow, "y"],
  ]);

  segment("tank-turret-mark", turret, [
    // Placed so some of the team colour faces every direction: the flanks from
    // the sides, the band from behind, and the roof panel from the air.
    [0.08, 0.2, 0.95, 1.3, 0.58, -0.5, kit.accent],
    [0.08, 0.2, 0.95, -1.3, 0.58, -0.5, kit.accent],
    [1.1, 0.12, 0.14, 0, 0.5, -2.33, kit.accent],
    [0.44, 0.06, 0.44, 0.55, 0.9, -1.1, kit.accent],
  ]);

  // --- the commander's gun: a ring on the cupola, laid by the SECOND man ----
  //
  // Three more nodes and two more meshes, and they buy the only thing on this
  // vehicle that can be pointed somewhere the main gun is not. The mount YAWS
  // on the cupola ring and the gun ELEVATES in its trunnion, exactly as the
  // turret and the barrel do one scale up — and for the same reason they are
  // nodes rather than boxes in the stow merge: a part that moves differently
  // from the thing it is bolted to cannot share a mesh with it.
  //
  // **The pivot is the CUPOLA's own axis and not where the gun is drawn.** A
  // ring turns about the hatch it rings; hung off the gun's own station it
  // would swing the whole weapon round the commander's head on a half-metre
  // arm, which reads as a gun on a boom rather than one on a mount.
  const mgMount = new TransformNode("tank-mg", scene);
  mgMount.parent = turret;
  mgMount.position.set(-0.62, cupolaY + 0.3, 0.15);
  segment("tank-mg-ring", mgMount, [
    // The ring itself and the pintle standing out of its front. Both turn with
    // the mount, which is what makes the traverse legible from outside: the
    // post is off-centre, so a gun laid abeam is visibly a gun that has been
    // laid rather than one that happens to point that way.
    [0.34, 0.08, 0.34, 0, -0.06, 0, kit.track],
    [0.1, 0.18, 0.1, 0, 0.04, 0.16, kit.track],
  ]);
  const mgGun = new TransformNode("tank-mg-gun", scene);
  mgGun.parent = mgMount;
  mgGun.position.set(0, 0.12, 0.16);
  segment("tank-mg-m", mgGun, [
    // The receiver, its box magazine and the spade grips behind it — the three
    // shapes that make a heavy machine gun read as one at ten metres.
    [0.16, 0.16, 0.5, 0, 0, 0.02, kit.track],
    [0.13, 0.2, 0.2, 0.14, -0.02, -0.02, kit.track],
    [0.26, 0.05, 0.14, 0, 0.02, -0.26, kit.track],
  ], [
    // A ROUND barrel with a jacket at its root, for the reason the main gun's
    // is round: a square pipe is a girder. It reaches 0.86 forward of the
    // trunnion, which is where `mgMuzzle` sits.
    [0.13, 0.26, 0, 0.02, 0.38, kit.track, "z"],
    [0.08, 0.62, 0, 0.02, 0.72, kit.track, "z", 0.07],
  ]);
  const mgMuzzle = new TransformNode("tank-mg-muzzle", scene);
  mgMuzzle.parent = mgGun;
  // Just past the barrel, so a flash lit here is outside it and a round fired
  // from here starts outside the turret's own geometry.
  mgMuzzle.position.set(0, 0.02, 1.1);

  // --- the antennae: the only parts of this vehicle that BEND ---------------
  //
  // Four meshes for two masts, and they are the one place this model's budget
  // rule is knowingly spent rather than obeyed. Everything else here merges by
  // colour because a mesh costs two draw calls and a greeble in a colour its
  // segment already carries is free; a whip cannot merge with anything at all,
  // because the whole point of it is that it moves differently from every other
  // part — and it needs TWO of its own, because one link pivoting at its foot
  // is a lever and what a mast does is bow. Twenty meshes became twenty-four,
  // which on Coldharbour is 96 draw calls for both hulls against the map's
  // 2,262. What it buys is the only moving part on the vehicle that reports on
  // the DRIVE: the tracks say it is moving and the masts say how hard.
  const whip = (i: number, x: number, z: number): Whip => {
    const len = ANTENNA_LENGTHS[i];
    const base = new TransformNode(`tank-whip${i}`, scene);
    base.parent = turret;
    // The mast foot in the stow merge is 14 cm tall and centred here, so the
    // pivot is inside it at every bend the springs can reach.
    base.position.set(x, 0.75, z);
    const tip = new TransformNode(`tank-whip${i}-tip`, scene);
    tip.parent = base;
    tip.position.set(0, len / 2, 0);
    // Each link is drawn from its own node's origin UP, and each tapers into
    // the next: a whip is thinner at the top, and the taper is what stops two
    // straight rods reading as one straight rod with a joint in it.
    segment(`tank-whip${i}-lo`, base, [], [
      [0.05, len / 2, 0, len / 4, 0, kit.stow, "y", 0.042],
    ]);
    segment(`tank-whip${i}-hi`, tip, [], [
      [0.042, len / 2, 0, len / 4, 0, kit.stow, "y", 0.028],
    ]);
    // A cantilever's natural frequency goes as 1/L^2, so the short mast is
    // stiffer than the long one by the square of the length ratio and nothing
    // about it is tuned separately: one config spring is scaled by this. The
    // pair come out 2.4 Hz and 3.8 Hz, which is why two masts on one turret
    // never swing in step — and a pair that DID would read as one animation
    // playing twice. The phases are arbitrary and exist for the same reason,
    // one layer down: the gust is one gust.
    return {
      base,
      tip,
      rate: (ANTENNA_LENGTHS[0] / len) ** 2,
      phase: i * 2.1,
    };
  };
  // Set against the mast feet above, and staggered in Z as well as X: two masts
  // at the same station are a pair of goalposts.
  const antennae: readonly [Whip, Whip] = [whip(0, 1.08, -1.5), whip(1, -1.08, -1.7)];

  // --- the gun: elevates in the mantlet, at the turret's front face ---------
  const gun = new TransformNode("tank-gun", scene);
  gun.parent = turret;
  gun.position.set(0, 0.45, 1.25);

  segment("tank-gun-m", gun, [
    // The two vents on the muzzle brake, which are what make it read as a
    // brake rather than as a collar.
    [0.1, 0.32, 0.3, 0.25, 0, 0.45 + BARREL_LENGTH - 0.15, kit.track],
    [0.1, 0.32, 0.3, -0.25, 0, 0.45 + BARREL_LENGTH - 0.15, kit.track],
  ], [
    // A ROUND mantlet and a ROUND barrel, which is the other half of what the
    // first version got wrong: a gun is the one part of a tank nobody mistakes,
    // and a square pipe on a square block is a girder. The taper is 2 cm over
    // four metres and is not visible as a taper — what it does is stop the
    // barrel reading as exactly parallel, which is what makes it read as long.
    [0.86, 1.3, 0, 0, 0.1, kit.armor, "x"],
    [0.5, 0.3, 0, 0, 0.42, kit.track, "z"],
    [0.28, BARREL_LENGTH, 0, 0, 0.45 + BARREL_LENGTH / 2, kit.track, "z", 0.24],
    [0.42, 0.8, 0, 0, 0.45 + BARREL_LENGTH * 0.5, kit.track, "z"],
    [0.44, 0.5, 0, 0, 0.45 + BARREL_LENGTH - 0.15, kit.track, "z"],
    // The coaxial, alongside the mantlet.
    [0.14, 1.0, 0.5, -0.06, 0.8, kit.track, "z"],
  ]);

  const muzzle = new TransformNode("tank-muzzle", scene);
  muzzle.parent = gun;
  // Just past the brake, so a flash lit here is outside the barrel and a shell
  // fired from here starts outside the hull's own collider box.
  muzzle.position.set(0, 0, 0.45 + BARREL_LENGTH + 0.2);

  inkRig(meshes);

  const rig: VehicleRig = {
    root, hull, sprung, turret, gun, muzzle,
    mgMount, mgGun, mgMuzzle,
    antennae, meshes, livery,
    // The three extents `Vehicle` cannot get anywhere else — see
    // `VehicleRig.gauge`. All three are drawing decisions made in this file,
    // which is why they are stated here rather than exported as constants a
    // physics file would have to import from a model.
    gauge: TRACK_GAUGE,
    contactReach: TRACK_REACH,
    wheelReach: WHEEL_REACH,
    setRun: (left, right, _steer, _rotor) => setTrackRun(tracks, left, right),
    reset: () => resetTankPose(rig, mats),
    paint: (wrecked) => paintRig(meshes, livery, mats, wrecked),
  };
  return rig;
}

/**
 * Slides both tracks to where they have RUN to, in metres.
 *
 * The two figures are per TRACK and not per hull: a tank pivoting on the spot
 * has one of them positive and the other negative, which is the read that says
 * "tracks" rather than "wheels". `Vehicle` owns them — how far a track has run is
 * a consequence of the drive — and everything below is the picture.
 *
 * **The strips are slid modulo the pitch and the sprocket is turned modulo a
 * revolution**, both because the alternative is a coordinate that grows without
 * bound for the length of a round. The remainder is taken the long way because
 * `%` keeps the sign of its left operand in JS, and a track that has run
 * backwards would otherwise slide the strip the wrong side of zero — a seam
 * in the open on every hull that has reversed.
 */
function setTrackRun(
  tracks: readonly [TrackSide, TrackSide],
  left: number,
  right: number,
): void {
  for (let i = 0; i < 2; i++) {
    const run = i === 0 ? left : right;
    const side = tracks[i];
    const phase = ((run % LINK_PITCH) + LINK_PITCH) % LINK_PITCH;
    // Under a hull going forwards the ground run goes backwards and the return
    // run goes forwards, at the same speed. That opposition is most of why a
    // moving track reads as a belt and not as a texture sliding along a box.
    side.lower.position.z = -phase;
    side.upper.position.z = phase;
    side.sprocket.rotation.x = (run / END_R) % (Math.PI * 2);
  }
}

/**
 * Puts a rig back to how it was built — every joint at rest, the tracks back at
 * the start of their loop and the paint back on. What a hull goes through on
 * the respawn timer, and the whole reason a destroyed tank is repainted rather
 * than replaced.
 */
function resetTankPose(rig: VehicleRig, mats: CelMaterialFactory): void {
  rig.hull.rotation.set(0, 0, 0);
  rig.sprung.position.y = 0;
  rig.sprung.rotation.set(0, 0, 0);
  rig.turret.rotation.set(0, 0, 0);
  rig.gun?.rotation.set(0, 0, 0);
  rig.mgMount.rotation.set(0, 0, 0);
  rig.mgGun.rotation.set(0, 0, 0);
  rig.setRun(0, 0, 0, 0);
  const share = CONFIG.vehicles.tank.antenna.baseShare;
  for (const w of rig.antennae) setAntennaBend(w, share, 0, 0, 0, 0);
  paintRig(rig.meshes, rig.livery, mats, false);
}
