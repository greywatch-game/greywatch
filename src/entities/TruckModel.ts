/**
 * TruckModel.ts — The gun truck's mesh: an armoured 4x4 drawn off the Oshkosh
 * JLTV (the M1278 heavy guns carrier), with a REMOTE weapon station on its
 * roof, four wheels that turn and two that steer, two whips that bow, and the
 * charred repaint a wreck takes.
 * Owns: the ART. Every extent in here is a drawing decision and belongs to
 * this file; the extents that are RULES — the collider box, the height a bot
 * aims at — are `CONFIG.vehicles.truck` and are read, not restated. The one
 * number that has to agree with the config is the body's own height, and it is
 * asserted by construction: the drawn body is built to
 * `CONFIG.vehicles.truck.hull`, so the box a round stops on and the box you can
 * see are the same box.
 *
 * `+Z is forward`, matching the yaw convention everywhere else in the game
 * (`forward = (sin(yaw), 0, cos(yaw))`), and `y = 0` is the bottom of the
 * tyres — the point the ground probe puts on the floor. `TankModel.ts`'s
 * conventions throughout; `entities/vehicleRig.ts` is the contract both come
 * out in, and the budget rule and the two prohibitions live there.
 *
 * ## It is a CLOSED body, and that is a fix rather than a restyle
 *
 * This was an open-bedded pickup with a pintle gun standing on the bed, and
 * what was wrong with it is a thing no number could reach: **there is no
 * player model in this game, so a gun that visibly needs a man behind it is a
 * gun with nobody behind it.** A pintle, a shield and a pair of spade grips
 * are three separate promises that somebody is standing there, and the bed
 * under them is the empty floor that says nobody is — every frame, from every
 * angle, on a vehicle the player spends whole minutes looking at from twelve
 * metres back.
 *
 * A closed body makes the same absence read correctly instead. The crew are
 * INSIDE, behind small armoured windows too dark to see through, and what is
 * on the roof is a REMOTE station: a turntable, a sensor head, a cradle and a
 * barrel, with no pintle, no grips and nowhere for a body to stand. The gun
 * traverses because the man at the screen below it traversed it, which is
 * what an armoured car's weapon station actually is.
 *
 * ## It is a JLTV, and what reads as one is the SHAPE rather than the parts
 *
 * The first closed version was an armoured estate: a slab tub, a slab roof and
 * four boxes of arch flare, which is a shape every modern armoured car shares
 * with a removal van. What says "JLTV" before any detail resolves is three
 * things, and all three are silhouettes rather than greebles:
 *
 * - **The wheel ARCHES are cut out of the body**, not flares bolted over a
 *   body the tyres run through. `lower` is an extruded side PROFILE with the
 *   two arches in it (`facet.ts`'s `extrude` takes a concave outline), so the
 *   fender stands over the wheel with daylight under it, and the wells behind
 *   are dark — the two inner tubs, narrow enough for the front pair to steer.
 * - **The hood is a CLAMSHELL above the fenders**, a loft that rises toward
 *   the cowl with its top corners cut, sitting between two fender tops the
 *   body shows either side of it. A flat bonnet is the estate again.
 * - **The belly is a V**, and there is no ladder frame under it at all. The
 *   running gear is four independent corners — two A-arms, a knuckle, a
 *   coil-over and a half-shaft each — which is what a player nosed into a
 *   ditch sees, and what makes the gap under the body read as clearance.
 *
 * The greebles are then the ones a photograph of the vehicle is recognised
 * by: the mesh grille with the bracket standing proud of it, the angular
 * headlamp pods with two round lamps each, the tow bar and the winch, the
 * split raked windscreen with its wipers, the thick frames round small side
 * windows, the air-intake canister up the offside A-pillar, the big mirrors,
 * the door steps, and a tarped cargo bed behind the cab with its straps.
 *
 * ## Twenty-six meshes, and seventeen of them move
 *
 * A tank is twenty-five because it has two belts, two masts and a cupola gun on
 * its own ring. This is the same accounting on a smaller machine: **eight for
 * the four wheels, five for the station and four for the two masts cannot
 * merge with anything, because a mesh is bought here for exactly one reason
 * and it is never a colour — something that MOVES differently from everything
 * around it cannot merge with any of it.** The rest is one per colour per
 * segment, exactly as over there: the whole sprung body is ONE segment in six
 * colours, so every detail above that is in a colour the body already pays for
 * is free, and the suspension is two (its frame and its springs). It was 22
 * as an estate; the four more are the second whip's two and a colour each on
 * the suspension (the springs) and the station (the sensor head).
 *
 * ## The wheels are the whole difference, and there are two halves to it
 *
 * A tank's running gear is a belt, which cannot be one mesh and is drawn as a
 * scrolling strip of links. A truck's is four discs, which CAN be one mesh
 * each — and a disc rotating about its own axis is famously indistinguishable
 * from a disc at rest, which is the argument that got the tank's road wheels
 * no nodes at all. So the tyre alone would be a wasted mesh, and what earns it
 * is what is drawn ON it: **two staggered rows of tread blocks standing proud
 * of the carcass, and a pale rim inside a dark beadlock ring with a circle of
 * bolts on it and eight studs round the hub**, which is a pattern with an
 * orientation twice over — at the silhouette, where a wheel is an edge, and at
 * the face, where it is a disc. Both are in the same two meshes — a wheel is
 * one merge of two colours' worth of parts — because nothing on a wheel moves
 * against the rest of it, and the dark ring is the TYRE's colour rather than
 * the frame's for exactly that reason: a third colour would be a third mesh.
 *
 * The second half is the STEER, and it is the one thing this model does that
 * the tank's cannot: the front pair are hung under a yaw node each and turned
 * with the stick. A tank's steer is already visible as its two tracks running
 * opposite ways; a truck that cornered at 65 km/h with its wheels pointing
 * dead ahead is a vehicle sliding sideways. That is why `VehicleRig.setRun`
 * takes a third argument at all — see its note, and note that the tank ignores
 * it for a reason rather than by omission. **The front wells are narrower than
 * the rear ones for the same reason**: a steered tyre's inner corners swing
 * 20 cm further in than a straight one's face.
 *
 * **The three numbers the physics reads off this drawing did not move.**
 * `gauge`, `contactReach` and `wheelReach` are the pickup's to the centimetre,
 * because the wheels are where they were: the axles, the track and the tyre
 * are the one part of the vehicle a redesign of the BODY has no business
 * touching, and leaving them alone is what makes this a redrawing rather than
 * a retune of the suspension, the lean and the ten ground contacts. The JLTV's
 * own tyre is 0.94 m across and this one is 0.92, which is part of why it was
 * the vehicle to draw.
 *
 * ## What the model may not do
 *
 * The two prohibitions in `vehicleRig.ts` (nothing emissive, nothing pickable)
 * and one more this shape invites: **nothing may stand on the roof inside the
 * station's sweep.** The gun turns a full circle and its muzzle reaches 1.46 m
 * past the trunnion, so a rack, a light bar or a rolled tarp anywhere within
 * that radius of `RING_Z` and above the roof is something a traversing gun
 * drives through. The roof is therefore BARE; the cargo bed behind the cab is
 * inside the radius but LOWER — its canvas tops out at 1.87 where the brake's
 * underside is never below 1.96 — and the two whips stand on the bed's rear
 * posts, 1.7 m and more from the ring, which a mast bent as far as its spring
 * can reach still clears. See `ANTENNA_FEET`.
 */
import { Scene, TransformNode } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { CelMaterialFactory } from "../shaders/CelShader";
import type { Team } from "./Combatant";
import { viewTeam } from "../core/teamView";
import {
  extrude,
  loftAlongZ,
  rodBetween,
  solidBetween,
  stationAt,
  type Point3,
  type ProfilePoint,
  type Station,
} from "./facet";
import {
  type Box,
  type Cyl,
  paintRig,
  resetRigPose,
  segmentOf,
  type Shape,
  type VehicleRig,
  whip,
  type Whip,
} from "./vehicleRig";

/**
 * What one side's truck is PAINTED in — the tank kit's three-way read with
 * the same third of it deleted, and for the same reason: a vehicle is one
 * shape whoever owns it, and what tells the sides apart is hue and a saturated
 * accent.
 *
 * **The palette is deliberately not the tank's.** The body is dusty and light
 * rather than olive and heavy, and there is sand-coloured kit strapped to the
 * outside of it. A player who cannot tell the two kinds apart at range is a
 * player who brings a rocket to the wrong vehicle.
 */
interface TruckKit {
  /** The body, the hood, the cab and the door plates: most of what is seen. */
  body: string;
  /**
   * The dark structure — the belly, the wells, the running gear, the grille,
   * the bumper, the steps, the mirrors, the weapon station and the gun. Nearly
   * everything that is not a panel, which is what makes it worth one mesh per
   * segment.
   */
  frame: string;
  /** Tyres, and the beadlock ring on each rim. The darkest thing on the vehicle. */
  tyre: string;
  /**
   * BARE METAL — the rims and their bolts, the springs, the winch drum, the
   * lamp bezels, the door handles, the whips' spring feet, and the station's
   * lens rims and barrel jacket.
   *
   * Its first job is still the rim, and there the contrast against the tyre is
   * load-bearing rather than decorative: a wheel is the only thing on this
   * vehicle whose ROTATION can be read, and a rim in the tyre's own value
   * rotates invisibly.
   */
  metal: string;
  /** The armoured glazing and the lamps. Drawn, not glazed: a model may not hang a `Build.pane`. */
  glass: string;
  /** The cargo tarp and the cans — what breaks the flat panels up. */
  stow: string;
  /** The friend/foe colour, from `CONFIG.teams`. */
  accent: string;
}

/**
 * One kit per SIDE, indexed by the VIEW and not by `Team` — see
 * `core/teamView.ts`, and `SoldierModel`'s `KITS`. Warm against cold, as the
 * tanks are.
 */
const KITS: readonly TruckKit[] = [
  {
    // **Darker than the first version, and the accent is why.** Team 0's colour
    // is `#c9a15e`, and a tan body at `#9a8a63` put a warm gold marking on a
    // warm gold panel — no marking at all at three pixels, which is exactly
    // what `CLAUDE.md`'s conventions say a team colour may never be.
    body: "#7b7053",
    frame: "#2b2a26",
    tyre: "#1c1b19",
    metal: "#6f6b60",
    glass: "#2f3a3c",
    stow: "#a1957a",
    accent: CONFIG.teams[0].color,
  },
  {
    body: "#5f6d79",
    frame: "#25282c",
    tyre: "#18191b",
    metal: "#616872",
    glass: "#2a3336",
    stow: "#8d97a1",
    accent: CONFIG.teams[1].color,
  },
];

// --- the running gear's frame, in the rig's coordinates ---------------------
//
// **Every constant in this block is the pickup's, unchanged.** See the header:
// the wheels are the part of the drawing the physics reads, and a redesign of
// the body above them is not a reason to move any of it.

/** Tyre radius. Everything about the ride height hangs off this. */
const WHEEL_R = 0.46;
/** How wide a tyre is. */
const WHEEL_W = 0.34;
/** Every wheel turns about this height, which is its own radius. */
const HUB_Y = WHEEL_R;
/**
 * Half the track — how far out from the centreline the wheels stand.
 *
 * The body is 2.36 wide over its panels and a tyre is 0.34, so the wheels are
 * proud of the sides at 1.05: a truck's wheels stick out and a tank's are
 * under its sponsons, which is one of the two silhouette cues that tell the
 * kinds apart from behind (the other is the station on the roof). The dark
 * arch lips are what make a wheel standing outside its own bodywork read as a
 * design rather than as a mistake.
 */
const TRACK_X = 1.05;
/**
 * How far fore and aft the axles stand — the wheelbase's half-length.
 *
 * Well inside the body's own half-length (2.7), which is what leaves an
 * overhang at each end: the nose and its bumper in front of the front wheels
 * and the cargo bed behind the back ones. A vehicle whose wheels are at its
 * corners is a go-kart.
 */
const AXLE_Z = 1.62;
/**
 * The gauge `Vehicle` splits one hull speed into two side speeds with. The
 * WHEEL track, because that is where the ground contacts are.
 */
const TRACK_GAUGE = TRACK_X * 2;
/**
 * How far fore and aft of the centre the ground contacts reach.
 *
 * The AXLES and not the bumpers: a truck touches the ground at its tyres, and
 * a contact sampled out at the tailgate is a vehicle rearing up on a kerb its
 * wheels have not reached. This is what `TRACK_REACH` is to a tank, and it is
 * shorter relative to the body for the same reason the overhangs exist.
 */
const CONTACT_REACH = AXLE_Z;
/** How far the front wheels turn at full lock. ~28 deg, which reads without looking broken. */
const STEER_LOCK = 0.49;
/**
 * Tread blocks per ROW round the carcass — there are two rows, staggered by
 * half a block, which is the chunky cross-country pattern the vehicle is
 * recognised by from the flank — and bolts round the beadlock ring and studs
 * round the hub.
 *
 * Patterns with an orientation on the one part of this vehicle whose rotation
 * has to be legible — the blocks from the flank, where a wheel is a
 * silhouette, and the bolts from three-quarters on, where it is a face. All
 * free: a block is the tyre's own colour and a bolt is the rim's, so none of
 * them buys a mesh. See the header.
 */
const TREAD_BLOCKS = 14;
const RING_BOLTS = 12;
const HUB_STUDS = 8;

// --- the body, from the belly up ------------------------------------------

/** The bottom of the body between the arches, and the cabin floor. */
const SILL_Y = 0.74;
/** The bottom of the body at the two ENDS, outside the arches — the fender tips. */
const END_Y = 0.8;
/**
 * The belt line: the top of the lower body and the bottom of the glazing.
 *
 * High, and the height is the whole read. A civilian estate is about half
 * glass; this is 70 cm of plate under windows barely 40 cm tall, which is the
 * proportion that says "armoured" before any other detail on the vehicle has
 * resolved — and it is also what makes the crew UNSEEABLE at the range this
 * is fought at.
 */
const WAIST_Y = 1.44;
/** The top of the cab roof. Everything above this is the weapon station. */
const ROOF_Y = 1.96;
/** Half the body's own width, inside the collider's 1.25 by an arch lip's thickness. */
const BODY_HW = (CONFIG.vehicles.truck.hull.width - 0.14) / 2;
/** Half the CAB's width: 5 cm inside the body each side, so the belt line is a ledge the ink finds. */
const CAB_HW = BODY_HW - 0.05;

/** The front face of the body, behind the bumper corners and the tow bar. */
const NOSE_Z = 2.42;
/** The back face of the body — the tailgate — inside the collider by the bumper and the cans. */
const TAIL_Z = -2.44;
/** Where the windscreen's foot meets the cowl. */
const SCUTTLE_Z = 0.97;
/** Where the windscreen's head meets the roof. */
const HEADER_Z = 0.66;
/** The back of the cab, and the front of the cargo bed. */
const CAB_TAIL_Z = -1.56;

/**
 * One wheel arch, as the outline the body's side profile is cut round:
 * `z0`/`z1` its two feet, `top` the soffit. Squarish with its shoulders cut,
 * because that is the JLTV's, and a round arch at this size is eight facets
 * of pen line.
 *
 * **1.10 is 18 cm over the tyre**, which is the room the springs use: the
 * body heaves on `sprung` and the wheels do not, and an arch sized to the tyre
 * at rest is a body landing on its own wheels.
 */
const ARCH_TOP = 1.1;
const ARCH_HALF = 0.53;

/** The station's base ring: how big it is and how high it turns. */
const RING_R = 0.44;
const RING_Y = ROOF_Y + 0.04;
/**
 * …and where it stands, which is over the second row — where the man working
 * it is sitting.
 *
 * It is also about as far back as the sweep allows: the muzzle reaches 1.46 m
 * and the cab roof runs to -1.56, so a station much further aft would swing
 * its barrel down over the cargo bed.
 */
const RING_Z = -0.85;

/**
 * The two whips' lengths in metres, the long one first — the order
 * `VehicleRig.antennae` is measured against.
 *
 * LONG, because a JLTV's are, and because length is what makes a whip read at
 * all: at the chase camera's twelve metres a mast is a line of three pixels,
 * and a line has to be long for its BOW to be seen. A cantilever's frequency
 * goes as 1/L^2, so the pair ring at two rates off one config spring
 * (`CONFIG.vehicles.truck.antenna`), roughly 2 Hz and 3 Hz.
 */
const ANTENNA_LENGTHS = [2.2, 1.8] as const;
/** Where the two rear corner posts stand, just behind the canvas. */
const POST_Z = -2.37;
/**
 * The two mast feet, `[x, z]` — the long one on top of the port rear post
 * and the short one on an arm forward off the starboard one, which is where
 * the JLTV carries them and the only place on this vehicle both clear of the
 * station and high enough to be seen.
 *
 * **1.89 m and 1.77 m from the ring**, against a muzzle that reaches 1.46 m.
 * Staggered in Z as well as X, the tank's rule: two masts at the same station
 * are a pair of goalposts. A mast bent the whole of `bendLimit` toward the
 * ring comes about 0.15 m in at the barrel's height, so it clears a traversing
 * gun at every lay the gun can reach.
 */
const ANTENNA_FEET = [[-(BODY_HW - 0.06), POST_Z], [BODY_HW - 0.06, -2.22]] as const;
/** The mast foot's height — the top of the posts, level with the cab roof. */
const ANTENNA_FOOT_Y = ROOF_Y;

/**
 * One wheel: the yaw node that STEERS it (front only) and the node that SPINS.
 *
 * Two nodes and not one, because the two rotations are about different axes in
 * different frames — a wheel that steered and rolled on one node would roll
 * about an axis that had been turned by the steering, which is a tyre screwing
 * itself into the road.
 */
interface Wheel {
  /** Turns with the stick. Null on the rear pair, which do not steer. */
  steer: TransformNode | null;
  /** Turns at `run / WHEEL_R`. */
  spin: TransformNode;
}

/**
 * Builds one gun truck in a team's colours.
 *
 * Built once per hardstanding and never disposed inside a round — the rule
 * `buildTank` follows and for its reason. `VehicleRig.reset` is what a fresh
 * one goes through instead.
 */
export function buildTruck(
  scene: Scene,
  mats: CelMaterialFactory,
  team: Team,
): VehicleRig {
  // The kit is the VIEWER's read of this side rather than the authority's
  // index for it: the local player's own side wears amber whichever slot a
  // match seated them in. See `core/teamView.ts`.
  const kit = KITS[viewTeam(team)];

  const root = new TransformNode("truck", scene);
  const hull = new TransformNode("truck-hull", scene);
  hull.parent = root;
  // Everything the springs carry, which is everything except the wheels and
  // the arms they hang on. See `VehicleRig.sprung`.
  const sprung = new TransformNode("truck-sprung", scene);
  sprung.parent = hull;

  const { meshes, livery, segment } = segmentOf(scene, mats);

  /** A round member from `a` to `b` — an arm, a spring, a wiper, a strap, a chute. */
  const rod = (a: Point3, b: Point3, d: number, color: string, tess = 6, dTop = d): Shape => [
    rodBetween("truck-rod", scene, a, b, d, tess, dTop),
    color,
  ];
  /** A side profile extruded across X — the body. */
  const slab = (
    profile: readonly ProfilePoint[],
    width: number,
    bevel: number,
    x: number,
    color: string,
  ): Shape => [extrude("truck-slab", scene, profile, width, bevel, x), color];
  /** A convex solid between two end faces — the V under the cab. */
  const solid = (from: readonly Point3[], to: readonly Point3[], color: string): Shape =>
    [solidBetween("truck-solid", scene, from, to), color];
  /** A loft lying along Z — the hood, the tarp and its straps. */
  const lofted = (stations: readonly Station[], color: string): Shape =>
    [loftAlongZ("truck-loft", scene, stations), color];

  // ==========================================================================
  // THE WHEELS: four discs with two patterns on them
  // ==========================================================================
  //
  // Each is its own mesh because it moves differently from everything around
  // it, and each is TWO colours in one merge — a near-black blocky tyre with a
  // dark beadlock ring, and a pale rim with its bolts, which is what makes the
  // rotation legible from the flank and from three-quarters on. See the header
  // on why the tank's road wheels get none of this.
  const wheels: Wheel[] = [];
  const wheel = (i: number, x: number, z: number, steers: boolean): Wheel => {
    let steer: TransformNode | null = null;
    let parent = hull;
    if (steers) {
      steer = new TransformNode(`truck-steer${i}`, scene);
      steer.parent = hull;
      steer.position.set(x, HUB_Y, z);
      parent = steer;
    }
    const spin = new TransformNode(`truck-wheel${i}`, scene);
    spin.parent = parent;
    // A steered wheel hangs at its steering node's own origin; an unsteered
    // one carries the position itself.
    spin.position.set(steers ? 0 : x, steers ? 0 : HUB_Y, steers ? 0 : z);
    const sign = x < 0 ? -1 : 1;
    const parts: Box[] = [];
    // The tread: two rows of blocks, each standing 3.5 cm proud of the
    // carcass, the outer row turned half a block on from the inner. `rotX` is
    // the same angle as the position, which is what puts each block's own
    // up-axis along the radius.
    for (let row = 0; row < 2; row++) {
      const ox = (row === 0 ? -1 : 1) * (WHEEL_W / 4 + 0.005);
      for (let k = 0; k < TREAD_BLOCKS; k++) {
        const a = ((k + row * 0.5) * Math.PI * 2) / TREAD_BLOCKS;
        parts.push([
          WHEEL_W / 2 + 0.01,
          0.07,
          0.15,
          ox,
          WHEEL_R * Math.cos(a),
          WHEEL_R * Math.sin(a),
          kit.tyre,
          a,
        ]);
      }
    }
    // The bolts round the beadlock ring and the studs round the hub, on the
    // OUTBOARD face only — the inboard one is never seen and a pattern there
    // is parts paying for nothing. Boxes rather than cylinders because at 4 cm
    // the facets are not a thing an eye can find.
    for (let k = 0; k < RING_BOLTS; k++) {
      const a = (k * Math.PI * 2) / RING_BOLTS;
      parts.push([0.03, 0.045, 0.045, sign * 0.19, 0.3 * Math.cos(a), 0.3 * Math.sin(a), kit.metal]);
    }
    for (let k = 0; k < HUB_STUDS; k++) {
      const a = (k * Math.PI * 2) / HUB_STUDS;
      parts.push([0.03, 0.035, 0.035, sign * 0.195, 0.14 * Math.cos(a), 0.14 * Math.sin(a), kit.metal]);
    }
    segment(`truck-wheel${i}-m`, spin, parts, [
      [WHEEL_R * 2, WHEEL_W, 0, 0, 0, kit.tyre, "x"],
      // The beadlock ring — the dark band between the sidewall and the rim —
      // then the rim inside it and a dark hub cap in the middle of that. Three
      // discs stepping OUT toward the hub, so the ink draws two circles on
      // the face and the bolts sit on the step between them.
      [0.68, 0.04, sign * 0.16, 0, 0, kit.tyre, "x"],
      [0.5, 0.04, sign * 0.175, 0, 0, kit.metal, "x"],
      [0.2, 0.03, sign * 0.195, 0, 0, kit.tyre, "x"],
    ]);
    const w: Wheel = { steer, spin };
    wheels.push(w);
    return w;
  };
  // Front pair first, and the -x side of each pair first — the order
  // `VehicleRig.setRun`'s `left` argument is in.
  wheel(0, -TRACK_X, AXLE_Z, true);
  wheel(1, TRACK_X, AXLE_Z, true);
  wheel(2, -TRACK_X, -AXLE_Z, false);
  wheel(3, TRACK_X, -AXLE_Z, false);

  // ==========================================================================
  // THE RUNNING GEAR: four independent corners, on `hull`
  // ==========================================================================
  //
  // On `hull` rather than `sprung`, because the arms are what the springs push
  // AGAINST: this is the running gear's half of the vehicle, and keeping it
  // here is what stops the wheels' mounts rising with the body when it
  // settles. It is also the only part of the drawing a player sees from BELOW
  // — a hull nosed into a ditch shows its underside — and four corners with
  // daylight between them are what say "independent suspension" where the
  // pickup's two beam axles said "farm truck".
  //
  // Two colours: the frame's near-black for the arms, the knuckles, the
  // shafts and the differentials, and the METAL for the four coil springs,
  // which are the one part of it bright enough to find in a wheel well.
  const gear: Box[] = [];
  const gearShapes: Shape[] = [];
  for (const az of [AXLE_Z, -AXLE_Z]) {
    // The differential on the centreline, and the half-shafts out of it to
    // each hub — one tube across, because the two halves are colinear.
    gear.push([0.36, 0.28, 0.32, 0, HUB_Y, az, kit.frame]);
    gearShapes.push(rod([-0.86, HUB_Y, az], [0.86, HUB_Y, az], 0.08, kit.frame));
    for (const s of [-1, 1]) {
      // The knuckle the wheel hangs from, just inboard of the tyre's face.
      gear.push([0.08, 0.46, 0.14, s * 0.83, HUB_Y + 0.02, az, kit.frame]);
      // Two A-arms: each a pair of tubes from two pivots on the body, 40 cm
      // apart, to one ball joint on the knuckle — which is the V that makes
      // an arm read as an arm and not as a strut.
      const lo: Point3 = [s * 0.82, 0.28, az];
      const hi: Point3 = [s * 0.82, 0.7, az];
      for (const dz of [-0.2, 0.2]) {
        gearShapes.push(rod([s * 0.34, 0.3, az + dz], lo, 0.06, kit.frame));
        gearShapes.push(rod([s * 0.42, 0.68, az + dz], hi, 0.05, kit.frame));
      }
      // The coil-over, leaning in from the lower arm to the body: a spring in
      // metal over a thinner damper body in the frame's colour.
      gearShapes.push(rod([s * 0.66, 0.32, az + 0.1], [s * 0.5, 1.0, az + 0.1], 0.13, kit.metal, 8));
      gearShapes.push(rod([s * 0.68, 0.26, az + 0.1], [s * 0.48, 1.08, az + 0.1], 0.06, kit.frame));
    }
  }
  // The steering track rod across the front, which is what the stick moves.
  gearShapes.push(rod([-0.84, 0.5, AXLE_Z + 0.16], [0.84, 0.5, AXLE_Z + 0.16], 0.045, kit.frame));
  segment("truck-gear", hull, gear, [], gearShapes);

  // ==========================================================================
  // THE BODY: one segment, every colour it wears, on `sprung`
  // ==========================================================================
  //
  // Everything the springs carry that does not move against the springs is
  // ONE segment — the tank's rule — so a colour is paid for once, however many
  // parts wear it. What follows is organised by where it is on the vehicle,
  // not by colour, because the merge does not care.
  const body: Box[] = [];
  const bodyCyls: Cyl[] = [];
  const bodyShapes: Shape[] = [];

  // --- the lower body: a side profile with the two arches cut out of it -----
  //
  // The whole of what makes the fenders fenders: the profile runs along the
  // sill and hops up over each wheel, so there is daylight under a fender and
  // a soffit over the tyre rather than a slab the tyre runs through. Full
  // width, so the arches are tunnels across the vehicle — which is what the
  // dark WELLS below close off.
  const arch = (c: number): ProfilePoint[] => {
    // Written front to back, so a caller walking the sill from the nose to
    // the tail can splice it in as it comes.
    const f = c + ARCH_HALF;
    const r = c - ARCH_HALF;
    return [
      [f, c > 0 ? END_Y : SILL_Y],
      [f - 0.08, 1.0],
      [f - 0.26, ARCH_TOP],
      [r + 0.26, ARCH_TOP],
      [r + 0.08, 1.0],
      [r, c > 0 ? SILL_Y : END_Y],
    ];
  };
  bodyShapes.push(
    slab(
      [
        [NOSE_Z, END_Y],
        [NOSE_Z, 1.24],
        [NOSE_Z - 0.08, 1.3],
        [SCUTTLE_Z, WAIST_Y],
        [TAIL_Z, WAIST_Y],
        [TAIL_Z, END_Y],
        ...arch(-AXLE_Z).reverse(),
        ...arch(AXLE_Z).reverse(),
      ],
      BODY_HW * 2,
      0.035,
      0,
      kit.body,
    ),
  );
  // The WELLS behind the arches, in the frame's colour so a wheel well reads as
  // shadow. The front pair's is narrower than the tyres' inner faces by 26 cm
  // a side, which is what the steer spends; the rear's by only 3.
  body.push([1.24, 0.5, 1.2, 0, 0.86, AXLE_Z, kit.frame]);
  body.push([1.7, 0.4, 1.2, 0, 0.92, -AXLE_Z, kit.frame]);
  // The V under the cab, from well to well. It is what a mine-protected hull
  // IS, and from the flank it is the dark wedge between the wheels that says
  // this body is not sitting on a chassis rail.
  const vee = (z: number): Point3[] => [
    [-0.96, SILL_Y + 0.02, z],
    [0.96, SILL_Y + 0.02, z],
    [0.55, 0.56, z],
    [0, 0.48, z],
    [-0.55, 0.56, z],
  ];
  bodyShapes.push(solid(vee(AXLE_Z - 0.6), vee(-AXLE_Z + 0.6), kit.frame));
  // A skid plate under the nose, between the front wheels.
  body.push([1.2, 0.07, 0.62, 0, 0.6, 2.18, kit.frame]);

  // --- the hood: a clamshell above the fenders ------------------------------
  //
  // A loft rising toward the cowl, its top corners cut, and 17 cm narrower a
  // side than the body — so the fender tops show beside it and the hood reads
  // as a separate panel standing on them. Its back station is tucked under
  // the windscreen, which is the cowl.
  const HOOD: readonly Station[] = [
    { z: NOSE_Z - 0.02, w: 1.86, lo: 1.16, hi: 1.34, top: 0.45, bot: 0.05 },
    { z: 2.0, w: 1.98, lo: 1.2, hi: 1.43, top: 0.38, bot: 0.05 },
    { z: 1.2, w: 2.02, lo: 1.28, hi: 1.52, top: 0.34, bot: 0.05 },
    { z: 0.9, w: 2.02, lo: 1.3, hi: 1.53, top: 0.34, bot: 0.05 },
  ];
  bodyShapes.push(lofted(HOOD, kit.body));
  /** The hood's top at station `z`, for seating a part ON it. */
  const hoodTop = (z: number): number => stationAt(HOOD, z).hi;
  /** …and the rake of that top, for laying a part along it. Negative is nose-down. */
  const hoodRake = (z: number): number => Math.atan2(hoodTop(z + 0.05) - hoodTop(z - 0.05), 0.1);
  // The two louvred vents on the back of the hood, either side of the crown:
  // five dark slats each, laid along the hood's own rake. At range they are
  // two grey patches, which is exactly what the vehicle's own are.
  for (const s of [-1, 1]) {
    for (let k = 0; k < 5; k++) {
      const z = 1.2 + k * 0.075;
      body.push([0.46, 0.025, 0.035, s * 0.33, hoodTop(z) + 0.008, z, kit.frame, -hoodRake(z)]);
    }
  }
  // The two lifting eyes, forward of the vents.
  for (const s of [-1, 1]) {
    body.push([0.03, 0.1, 0.12, s * 0.52, hoodTop(1.7) + 0.04, 1.7, kit.frame]);
  }

  // --- the nose: grille, lamp pods, bumper corners, tow bar, winch ---------
  //
  // Everything here stands PROUD of the body's front face by a few
  // centimetres, which is the depth step the ink draws a line at — a grille
  // painted flush on the face is a grille nobody can see. Nothing reaches past
  // the collider's 2.70.
  //
  // The mesh grille, and the bracket standing proud of it: two uprights, a
  // plate across their tops and a bar across the bottom of the grille.
  body.push([1.12, 0.42, 0.03, 0, 1.05, NOSE_Z + 0.01, kit.frame]);
  body.push([0.07, 0.42, 0.04, -0.17, 1.05, NOSE_Z + 0.035, kit.body]);
  body.push([0.07, 0.42, 0.04, 0.17, 1.05, NOSE_Z + 0.035, kit.body]);
  body.push([0.46, 0.09, 0.04, 0, 1.22, NOSE_Z + 0.035, kit.body]);
  body.push([1.16, 0.06, 0.04, 0, 0.86, NOSE_Z + 0.035, kit.body]);
  for (const s of [-1, 1]) {
    // The lamp pod: a dark recess with two round lamps in bezels, the
    // outboard one smaller — which is the face of the vehicle from the front.
    body.push([0.42, 0.2, 0.05, s * 0.86, 1.12, NOSE_Z + 0.02, kit.frame]);
    bodyCyls.push([0.15, 0.02, s * 0.76, 1.12, NOSE_Z + 0.05, kit.metal, "z"]);
    bodyCyls.push([0.11, 0.03, s * 0.76, 1.12, NOSE_Z + 0.06, kit.glass, "z"]);
    bodyCyls.push([0.12, 0.02, s * 0.96, 1.12, NOSE_Z + 0.05, kit.metal, "z"]);
    bodyCyls.push([0.08, 0.03, s * 0.96, 1.12, NOSE_Z + 0.06, kit.glass, "z"]);
    // The bumper corner under it, standing out from the fender tip.
    body.push([0.34, 0.24, 0.16, s * 0.98, 0.9, NOSE_Z + 0.07, kit.body]);
    // The tow bar's bracket back to the body.
    body.push([0.1, 0.12, 0.24, s * 0.46, 0.72, NOSE_Z + 0.1, kit.frame]);
  }
  // The tubular tow bar, the winch above it and its drum, and the hook.
  bodyCyls.push([0.12, 2.2, 0, 0.72, 2.6, kit.frame, "x"]);
  body.push([0.46, 0.24, 0.16, 0, 0.93, NOSE_Z + 0.1, kit.frame]);
  bodyCyls.push([0.13, 0.28, 0, 0.93, 2.6, kit.metal, "x"]);
  body.push([0.08, 0.1, 0.06, 0.08, 0.63, 2.66, kit.stow]);

  // --- the arch lips: a dark rubber edge round each arch -------------------
  //
  // The widest thing on the vehicle, out to 1.24 of the collider's 1.25, and
  // deliberately: it is what covers the 4 cm of tread standing outside the
  // bodywork, and a lip that stops short of the tyre is a lip that looks bent.
  for (const c of [AXLE_Z, -AXLE_Z]) {
    const pts = arch(c);
    for (const s of [-1, 1]) {
      for (let k = 0; k + 1 < pts.length; k++) {
        const [za, ya] = pts[k];
        const [zb, yb] = pts[k + 1];
        bodyShapes.push(rod([s * 1.2, ya, za], [s * 1.2, yb, zb], 0.08, kit.frame));
      }
    }
  }

  // --- the cab: a profile from the belt line to the roof --------------------
  //
  // Its front face IS the windscreen's rake, so the greenhouse is one shape
  // rather than a raked pane between two uprights; its edges are bevelled 5 cm,
  // which is the chamfer round the roof that the JLTV's own cab has and the
  // estate's did not.
  bodyShapes.push(
    slab(
      [
        [SCUTTLE_Z, WAIST_Y - 0.04],
        [HEADER_Z, ROOF_Y],
        [CAB_TAIL_Z, ROOF_Y],
        [CAB_TAIL_Z, WAIST_Y - 0.04],
      ],
      CAB_HW * 2,
      0.05,
      0,
      kit.body,
    ),
  );

  // --- the windscreen: two panes on the rake, a post, a frame, two wipers ---
  //
  // Everything here is placed ON the raked face by `onScreen`, which is the
  // face's own coordinates — `up` metres up it from its foot, `out` off it —
  // so the panes and their frame cannot drift off the cab they are bolted to.
  const faceLen = Math.hypot(SCUTTLE_Z - HEADER_Z, ROOF_Y - (WAIST_Y - 0.04));
  const upZ = (HEADER_Z - SCUTTLE_Z) / faceLen;
  const upY = (ROOF_Y - (WAIST_Y - 0.04)) / faceLen;
  /** The rake as a box rotation: the face leans back by this from vertical. */
  const rake = -Math.atan2(SCUTTLE_Z - HEADER_Z, ROOF_Y - (WAIST_Y - 0.04));
  const onScreen = (x: number, up: number, out: number): Point3 => [
    x,
    WAIST_Y - 0.04 + upY * up + upZ * -out,
    SCUTTLE_Z + upZ * up + upY * out,
  ];
  const screenBox = (w: number, h: number, d: number, x: number, up: number, out: number, color: string): Box => {
    const [, y, z] = onScreen(x, up, out);
    return [w, h, d, x, y, z, color, rake];
  };
  // The panes, from just above the cowl to just under the header.
  body.push(screenBox(0.9, 0.4, 0.03, -0.51, 0.38, 0.012, kit.glass));
  body.push(screenBox(0.9, 0.4, 0.03, 0.51, 0.38, 0.012, kit.glass));
  // The centre post and the frame round both: what makes it TWO windscreens,
  // which is the JLTV's face as much as the grille is.
  body.push(screenBox(0.12, 0.46, 0.04, 0, 0.38, 0.02, kit.body));
  body.push(screenBox(0.1, 0.46, 0.04, -(CAB_HW - 0.06), 0.38, 0.02, kit.body));
  body.push(screenBox(0.1, 0.46, 0.04, CAB_HW - 0.06, 0.38, 0.02, kit.body));
  body.push(screenBox(CAB_HW * 2 - 0.04, 0.07, 0.04, 0, 0.6, 0.02, kit.body));
  // The wipers, hung from the header as the JLTV's are and parked slanting in
  // toward the post.
  for (const s of [-1, 1]) {
    bodyShapes.push(rod(onScreen(s * 0.62, 0.56, 0.035), onScreen(s * 0.2, 0.24, 0.035), 0.022, kit.frame, 4));
  }

  // --- the side windows: small, and framed thick ---------------------------
  //
  // Two a side, one per door, in the top of the door under the roof — and
  // each with a frame of four bars standing 3 cm off the cab, which is how
  // armoured glazing reads from outside: the glass is the least of it.
  const sideWindow = (s: number, z0: number, z1: number): void => {
    const x = s * (CAB_HW + 0.006);
    const zc = (z0 + z1) / 2;
    const len = z0 - z1;
    body.push([0.02, 0.34, len, x, 1.7, zc, kit.glass]);
    const fx = s * (CAB_HW + 0.015);
    body.push([0.03, 0.06, len + 0.12, fx, 1.9, zc, kit.body]);
    body.push([0.03, 0.06, len + 0.12, fx, 1.5, zc, kit.body]);
    body.push([0.03, 0.46, 0.06, fx, 1.7, z0 + 0.03, kit.body]);
    body.push([0.03, 0.46, 0.06, fx, 1.7, z1 - 0.03, kit.body]);
  };
  for (const s of [-1, 1]) {
    sideWindow(s, 0.56, 0.02);
    sideWindow(s, -0.5, -1.02);
  }
  // A small window in the back of the cab, looking out over the bed.
  body.push([0.8, 0.26, 0.02, 0, 1.72, CAB_TAIL_Z - 0.006, kit.glass]);

  // --- the doors: four plates, their hinges, handles and steps --------------
  //
  // Each door's lower half is a plate standing 2.5 cm off the body, and the
  // gaps between plates are the door lines — the ink draws each plate's edge,
  // so a vehicle with four doors in it rather than a slab with lines painted
  // on. The team flash sits ON the front plate, so the two depths have to
  // stack — see the markings below.
  const DOORS: readonly [number, number][] = [[0.94, -0.2], [-0.28, -1.04]];
  for (const s of [-1, 1]) {
    for (const [z0, z1] of DOORS) {
      body.push([0.025, 0.54, z0 - z1, s * (BODY_HW + 0.0125), 1.11, (z0 + z1) / 2, kit.body]);
      // Two hinges on the leading edge, and a latch handle on the trailing
      // one — metal, because a handle is the one fitting a player's eye is
      // drawn to on a door, and the difference between a door and a panel.
      body.push([0.04, 0.1, 0.07, s * (BODY_HW + 0.035), 0.96, z0 - 0.03, kit.frame]);
      body.push([0.04, 0.1, 0.07, s * (BODY_HW + 0.035), 1.28, z0 - 0.03, kit.frame]);
      body.push([0.04, 0.05, 0.2, s * (BODY_HW + 0.045), 1.3, z1 + 0.16, kit.metal]);
    }
    // The step under the doors, on two hangers.
    body.push([0.2, 0.04, 1.8, s * (BODY_HW - 0.1), 0.6, -0.05, kit.frame]);
    body.push([0.04, 0.16, 0.04, s * (BODY_HW - 0.12), 0.68, 0.6, kit.frame]);
    body.push([0.04, 0.16, 0.04, s * (BODY_HW - 0.12), 0.68, -0.7, kit.frame]);
    // The mirror: a big dark head held out on two arms off the A-pillar,
    // the last thing on the vehicle drawn at a person's scale rather than a
    // vehicle's, which is most of why it is worth the parts.
    body.push([0.05, 0.3, 0.2, s * 1.215, 1.66, 1.04, kit.frame]);
    bodyShapes.push(rod([s * CAB_HW, 1.52, 0.9], [s * 1.2, 1.56, 1.02], 0.035, kit.frame, 4));
    bodyShapes.push(rod([s * CAB_HW, 1.62, 0.84], [s * 1.2, 1.76, 1.02], 0.035, kit.frame, 4));
  }

  // --- the air intake: the canister up the offside A-pillar ----------------
  //
  // The single most recognisable fitting on the vehicle from three-quarters
  // on, and the one dark thing standing against the sky beside the cab — a
  // near-black can on a dome, over a round filter housing on the fender. It
  // is 1.9 m from the ring, clear of the sweep.
  bodyCyls.push([0.3, 0.3, 1.08, 1.82, 0.86, kit.frame, "y"]);
  bodyCyls.push([0.3, 0.08, 1.08, 2.01, 0.86, kit.frame, "y", 0.2]);
  body.push([0.16, 0.36, 0.16, 1.1, 1.5, 0.86, kit.frame]);
  bodyCyls.push([0.34, 0.06, BODY_HW + 0.02, 1.26, 1.0, kit.frame, "x"]);
  bodyCyls.push([0.14, 0.02, BODY_HW + 0.06, 1.26, 1.0, kit.metal, "x"]);

  // --- the cargo bed: a canvas top, its straps, and the two corner posts ----
  //
  // Behind the cab and lower than its roof, which is the only way a bed this
  // close to the station can have anything in it — see the header. The canvas
  // rises straight off the belt line with its top corners cut, and it SAGS
  // between the bows, because a tarp stretched flat is a lid and the first
  // version of this read from behind as a white box on a tan one.
  const tarp = (z: number, hi: number): Station => ({ z, w: CAB_HW * 2, lo: WAIST_Y, hi, top: 0.4, bot: 0.05 });
  const BOWS = [CAB_TAIL_Z - 0.02, -1.95, -2.3];
  const TARP: readonly Station[] = [
    tarp(BOWS[0], 1.84),
    tarp((BOWS[0] + BOWS[1]) / 2, 1.79),
    tarp(BOWS[1], 1.86),
    tarp((BOWS[1] + BOWS[2]) / 2, 1.79),
    tarp(BOWS[2], 1.83),
  ];
  bodyShapes.push(lofted(TARP, kit.stow));
  // Three straps across it: the canvas's own section, a centimetre proud of
  // it and five wide — a band the ink outlines rather than a stripe.
  for (const z of [BOWS[0] - 0.14, BOWS[1], BOWS[2] + 0.14]) {
    const hi = stationAt(TARP, z).hi;
    bodyShapes.push(
      lofted(
        [
          { z: z - 0.025, w: CAB_HW * 2 + 0.02, lo: WAIST_Y - 0.01, hi: hi + 0.012, top: 0.4, bot: 0.05 },
          { z: z + 0.025, w: CAB_HW * 2 + 0.02, lo: WAIST_Y - 0.01, hi: hi + 0.012, top: 0.4, bot: 0.05 },
        ],
        kit.frame,
      ),
    );
  }
  // The back flap, rolled up under the last bow, and the two ties hanging down
  // the canvas's rear face below it — without which the end of the load is one
  // flat pale panel filling the whole view from the chase camera.
  bodyCyls.push([0.11, CAB_HW * 2 - 0.3, 0, stationAt(TARP, BOWS[2]).hi - 0.1, BOWS[2] - 0.03, kit.stow, "x"]);
  for (const s of [-1, 1]) {
    body.push([0.04, 0.28, 0.02, s * 0.5, WAIST_Y + 0.2, BOWS[2] - 0.01, kit.frame]);
  }
  // The two tall posts at the bed's back corners, up to the cab's own roof
  // line — the JLTV's rear silhouette, and what its whips are carried on. They
  // are 1.9 m from the ring, outside the sweep.
  for (const s of [-1, 1]) {
    body.push([0.1, ROOF_Y - WAIST_Y, 0.1, s * (CAB_HW - 0.01), (ROOF_Y + WAIST_Y) / 2, POST_Z, kit.frame]);
  }
  // The long whip's foot is on its post's top; the short one's is on an arm
  // forward off the other, so the two masts are staggered in Z as well as X.
  // A spring foot on each — metal, and 16 cm tall, with the whip's pivot
  // inside it so the mast never bends out of its own foot.
  body.push([0.1, 0.06, ANTENNA_FEET[1][1] - POST_Z + 0.06, ANTENNA_FEET[1][0], ROOF_Y - 0.03, (ANTENNA_FEET[1][1] + POST_Z) / 2 + 0.03, kit.frame]);
  for (const [x, z] of ANTENNA_FEET) {
    bodyCyls.push([0.08, 0.16, x, ANTENNA_FOOT_Y + 0.08, z, kit.metal, "y"]);
  }

  // --- the tail -------------------------------------------------------------
  //
  // The tailgate, ribbed and latched; the lamps in dark housings; the bumper,
  // the pintle and the tow eyes; and the two cans in their brackets either
  // side — the rear is the angle most of the map sees this vehicle from, it
  // being the thing that drives away.
  body.push([1.6, 0.46, 0.03, 0, 1.12, TAIL_Z - 0.015, kit.body]);
  body.push([1.5, 0.05, 0.03, 0, 0.97, TAIL_Z - 0.04, kit.body]);
  body.push([1.5, 0.05, 0.03, 0, 1.19, TAIL_Z - 0.04, kit.body]);
  for (const s of [-1, 1]) {
    body.push([0.2, 0.34, 0.05, s * 0.99, 1.2, TAIL_Z - 0.02, kit.frame]);
    body.push([0.13, 0.11, 0.03, s * 0.99, 1.29, TAIL_Z - 0.05, kit.glass]);
    body.push([0.13, 0.11, 0.03, s * 0.99, 1.12, TAIL_Z - 0.05, kit.glass]);
    body.push([0.1, 0.05, 0.04, s * 0.3, 1.08, TAIL_Z - 0.05, kit.metal]);
    body.push([0.3, 0.42, 0.16, s * 0.6, 1.0, TAIL_Z - 0.11, kit.stow]);
    body.push([0.32, 0.04, 0.02, s * 0.6, 1.08, TAIL_Z - 0.2, kit.frame]);
    body.push([0.34, 0.04, 0.2, s * 0.6, 0.78, TAIL_Z - 0.1, kit.frame]);
    body.push([0.12, 0.2, 0.2, s * 0.62, 0.66, TAIL_Z - 0.14, kit.frame]);
  }
  body.push([2.2, 0.16, 0.14, 0, 0.74, TAIL_Z - 0.08, kit.frame]);
  body.push([0.14, 0.14, 0.14, 0, 0.64, TAIL_Z - 0.18, kit.frame]);

  // --- the markings: `CONFIG.teams`' colour, facing every direction ---------
  //
  // The same three-way read `SoldierModel`'s kits make, minus the silhouette:
  // a flash on each front door, one across the hood and one across the
  // tailgate, so a marking is visible from wherever the vehicle is being
  // looked at. A marking that only reads from the flank is no marking at all
  // on a thing that is mostly seen coming or going.
  //
  // **The door pair have to clear the door plate's INK and not merely its
  // face.** `inkRig` gives every mesh a 2 cm outline hull, so a flash standing
  // 2 cm off a plate is a flash drawn entirely inside that plate's own ink and
  // the vehicle has no flank marking at all — measured on a photograph of the
  // first closed version, where the door read as a dark rectangle. They stand
  // 4 cm proud instead (1.205 to 1.245 against the plate's 1.18 to 1.205),
  // inside the collider's 1.25 and the ink's width twice over.
  body.push([0.04, 0.22, 0.46, -(BODY_HW + 0.045), 1.14, 0.46, kit.accent]);
  body.push([0.04, 0.22, 0.46, BODY_HW + 0.045, 1.14, 0.46, kit.accent]);
  // A stripe across the hood rather than a panel on it: the hood is the
  // biggest flat surface the vehicle has and a marking sized to it reads as a
  // hazard placard rather than as a side's colour.
  body.push([0.8, 0.02, 0.3, 0, hoodTop(1.95) + 0.01, 1.95, kit.accent, -hoodRake(1.95)]);
  body.push([1.0, 0.1, 0.04, 0, 1.3, TAIL_Z - 0.05, kit.accent]);

  segment("truck-body", sprung, body, bodyCyls, bodyShapes);

  // ==========================================================================
  // THE STATION: a remote weapon station, and what it deliberately has not got
  // ==========================================================================
  //
  // **`VehicleRig.turret` is here and is deliberately inert.** `Vehicle` keeps
  // `turretYaw` equal to the hull's own yaw on a gunless kind, so the local
  // angle written on this node is always zero — which is exactly what a ring
  // BOLTED to a roof should do. It exists so that the mount below has the same
  // parent it has on a tank and `aimMg` needs no branch.
  const turret = new TransformNode("truck-ring", scene);
  turret.parent = sprung;
  segment("truck-ring-m", turret, [], [
    // The ring itself, and the armoured collar it is let into — which is what
    // stops a station standing on a roof reading as a thing dropped onto one.
    [RING_R * 2, 0.1, 0, RING_Y - 0.05, RING_Z, kit.frame, "y"],
    [RING_R * 2 + 0.16, 0.06, 0, ROOF_Y + 0.02, RING_Z, kit.frame, "y"],
  ]);

  // Two nodes, the same pair the tank's cupola gun gets and for the same
  // reason: they move differently from everything around them. The mount
  // TRAVERSES on the ring and the gun ELEVATES in it.
  //
  // **There is no pintle, no spade grip, no shield and nowhere to stand**, and
  // each of those absences is the point rather than an economy — see the
  // header. What is here instead is the station the JLTV actually carries: a
  // turntable, a yoke, and on the GUN's side of the trunnion a sensor head
  // with two lenses in it and an ammunition chute arching over into the feed —
  // which between them say that the thing aiming this gun is downstairs.
  const mgMount = new TransformNode("truck-mg", scene);
  mgMount.parent = turret;
  mgMount.position.set(0, RING_Y + 0.06, RING_Z);
  segment("truck-mg-ring", mgMount, [
    // The yoke arm on the right, the drive housing outboard of it, and the
    // smaller cheek on the left between the gun and the sensor head. Nothing
    // BEHIND the trunnion: the buffer swings down through there at full
    // elevation.
    [0.1, 0.34, 0.3, 0.33, 0.17, 0.02, kit.frame],
    [0.12, 0.18, 0.26, 0.44, 0.09, -0.02, kit.frame],
    [0.07, 0.24, 0.22, -0.2, 0.14, 0.05, kit.frame],
  ], [
    // The turntable drum on the ring, and the trunnion axle through both arms —
    // metal, and the one line across the station that says where it pivots.
    [0.66, 0.12, 0, 0, 0, kit.frame, "y"],
    [0.07, 0.62, 0.06, 0.18, 0.06, kit.metal, "x"],
  ]);
  const mgGun = new TransformNode("truck-mg-gun", scene);
  mgGun.parent = mgMount;
  mgGun.position.set(0, 0.18, 0.06);
  segment("truck-mg-m", mgGun, [
    // The receiver, the buffer behind it, the charging handle and the feed
    // cover — the shapes that make a heavy machine gun read as one at ten
    // metres — and the cradle it lies in.
    [0.2, 0.2, 0.66, 0, 0, 0.04, kit.frame],
    [0.16, 0.14, 0.16, 0, 0.01, -0.34, kit.frame],
    [0.06, 0.06, 0.16, -0.14, 0.02, -0.1, kit.frame],
    [0.18, 0.05, 0.3, 0, 0.12, -0.02, kit.frame],
    [0.24, 0.06, 0.5, 0, -0.13, 0.1, kit.frame],
    // The ammunition can on the right flank, on the gun so it elevates with it.
    [0.14, 0.2, 0.3, 0.18, 0, -0.08, kit.frame],
    // **The sensor head**, on the gun's left, in the BODY's colour: the one
    // big pale shape above the roof line, so the eye finds it — and finding
    // it is what tells a player where this gun is looking. Its two lenses are
    // the station's face.
    [0.24, 0.26, 0.4, -0.36, 0.1, 0.08, kit.body],
    [0.2, 0.04, 0.12, -0.36, 0.245, 0.24, kit.body],
  ], [
    // A ROUND barrel with a jacket at its root and a brake on its nose, for
    // the reason every barrel in this game is round: a square pipe is a
    // girder.
    [0.17, 0.34, 0, 0.02, 0.46, kit.metal, "z"],
    [0.095, 0.8, 0, 0.02, 0.92, kit.frame, "z", 0.08],
    [0.14, 0.14, 0, 0.02, 1.36, kit.metal, "z"],
    // The two lenses in their bezels: a big day camera over a smaller
    // thermal, dark faces in pale rims. The faces are the FRAME's colour
    // rather than the glazing's — at this size the two are one value, and the
    // glazing's would be a mesh bought for two discs.
    [0.15, 0.03, -0.36, 0.14, 0.29, kit.metal, "z"],
    [0.12, 0.04, -0.36, 0.14, 0.3, kit.frame, "z"],
    [0.1, 0.03, -0.36, 0.03, 0.29, kit.metal, "z"],
    [0.075, 0.04, -0.36, 0.03, 0.3, kit.frame, "z"],
  ], [
    // The chute, from the top of the can up and over into the feed — the arch
    // over the station that is the most recognisable line on it in outline.
    rod([0.2, 0.09, -0.12], [0.23, 0.2, -0.1], 0.06, kit.frame, 6),
    rod([0.23, 0.2, -0.1], [0.15, 0.27, -0.08], 0.06, kit.frame, 6),
    rod([0.15, 0.27, -0.08], [0.05, 0.22, -0.06], 0.06, kit.frame, 6),
    rod([0.05, 0.22, -0.06], [0.02, 0.14, -0.04], 0.06, kit.frame, 6),
  ]);
  const mgMuzzle = new TransformNode("truck-mg-muzzle", scene);
  mgMuzzle.parent = mgGun;
  // Just past the brake, so a flash lit here is outside the barrel and a round
  // fired from here starts outside the vehicle's own collider box.
  //
  // **This 1.46 is the tightest number in the file.** The trunnion is at 2.24
  // and `mg.pitchMin` is -0.16 rad, so at full depression the muzzle stands at
  // 2.03 above the tyres — MEASURED off `mgMuzzle.getAbsolutePosition()` on
  // Sarab with the gun laid abeam and fully depressed, which is 6.7 cm over a
  // roof at 1.96, through every bearing of the traverse. Re-derive it if the
  // roof, the ring height, the barrel's length or `pitchMin` moves: a station
  // that depresses into its own roof is the pickup's pedestal problem in a new
  // place. **The sensor head and the chute are inside that envelope at every
  // lay**: the head's lowest corner is 9 cm over the turntable at `pitchMax`
  // and 10 cm over it at `pitchMin`.
  mgMuzzle.position.set(0, 0.02, 1.46);

  // **The gunner's eye, in front of the sensor head's upper lens** — the head
  // that is the only big pale thing above this roof line, and now where the
  // station looks FROM.
  //
  // On `mgGun` rather than on the mount (`VehicleRig.mgSight` says why), and
  // the head is on the gun too, so the eye and the lens it stands at elevate
  // together. **The `z` is the clearance that matters**: the lens bezels stand
  // out to 0.32 on this node, and 0.4 puts the eye 8 cm clear of them, past
  // the near plane at every lay.
  const mgSight = new TransformNode("truck-mg-sight", scene);
  mgSight.parent = mgGun;
  mgSight.position.set(-0.36, 0.12, 0.4);

  // ==========================================================================
  // THE WHIPS: two, on the bed's back corners
  // ==========================================================================
  //
  // Two meshes each, and they are the one place the budget rule is knowingly
  // spent: a whip cannot merge with anything, because the whole point of it is
  // that it moves differently from every other part, and it needs TWO of its
  // own because one link pivoting at its foot is a lever and what a mast does
  // is bow. What they buy is the only moving parts on this vehicle that report
  // on the DRIVE the way the tank's tracks do — the wheels say it is moving
  // and the masts say how hard — and, parked, the one thing on it that is
  // never quite still: `antenna.wind` stirs them with a slow sway and a
  // quicker flutter, so a truck at its hardstanding is not a photograph. The
  // phases are arbitrary and exist so the one gust does not stir both in step.
  const mast = (i: number): Whip => {
    const [x, z] = ANTENNA_FEET[i];
    return whip(scene, segment, {
      name: `truck-whip${i}`,
      parent: sprung,
      foot: [x, ANTENNA_FOOT_Y + 0.1, z],
      length: ANTENNA_LENGTHS[i],
      longest: ANTENNA_LENGTHS[0],
      phase: i * 2.1,
      color: kit.frame,
      taper: [0.045, 0.036, 0.022],
      cap: [0.05, 0.05],
    });
  };
  const antennae: readonly [Whip, Whip] = [mast(0), mast(1)];

  const rig: VehicleRig = {
    root,
    hull,
    sprung,
    turret,
    // **No main gun, and these two nulls are what the rest of the game reads
    // it as** — through `Vehicle.armed`, which is what every caller of
    // `muzzleToRef`, `gunDirToRef` and `fireGun` is already behind.
    gun: null,
    muzzle: null,
    mgMount,
    mgGun,
    mgMuzzle,
    mgSight,
    antennae,
    meshes,
    livery,
    gauge: TRACK_GAUGE,
    contactReach: CONTACT_REACH,
    // The suspension's travel is bounded at the wheel STATIONS, which on this
    // vehicle are the axles — the same place the ground contacts are, because
    // a truck's wheels are its suspension and its contact patch at once. On a
    // tank the two differ, which is the whole reason `VehicleRig` states both.
    wheelReach: AXLE_Z,
    setRun: (left, right, steer, _rotor) => setWheelRun(wheels, left, right, steer),
    reset: () => resetRigPose(rig, mats, CONFIG.vehicles.truck),
    paint: (wrecked) => paintRig(meshes, livery, mats, wrecked),
  };
  return rig;
}

/**
 * Turns the wheels to where they have RUN to, in metres, and points the front
 * pair where the stick is.
 *
 * The two run figures are per SIDE, exactly as a tank's are per track: a
 * vehicle turning has one of them longer than the other, and `Vehicle` derives
 * both from one speed and one yaw rate. What is different here is that the
 * difference is spent on the STEER as well — a truck's wheels visibly point
 * into a corner, and without that a hull cornering at 65 km/h is one sliding
 * sideways on locked wheels.
 *
 * **The spin is taken modulo a revolution** for `setTrackRun`'s reason: the
 * alternative is a coordinate that grows without bound for the length of a
 * round. The remainder is taken the long way because `%` keeps the sign of its
 * left operand in JS.
 */
function setWheelRun(
  wheels: readonly Wheel[],
  left: number,
  right: number,
  steer: number,
): void {
  const lock = Math.max(-1, Math.min(1, steer)) * STEER_LOCK;
  for (let i = 0; i < wheels.length; i++) {
    const w = wheels[i];
    // Wheels are built front pair first, -x side of each pair first, so the
    // even indices are the left side — the same order `left` is.
    const run = (i & 1) === 0 ? left : right;
    const turns = run / WHEEL_R;
    w.spin.rotation.x = ((turns % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    if (w.steer) w.steer.rotation.y = lock;
  }
}
