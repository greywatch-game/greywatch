/**
 * TruckModel.ts — The gun truck's mesh: an armoured 4x4 estate with a REMOTE
 * weapon station on its roof, four wheels that turn and two that steer, and
 * the charred repaint a wreck takes.
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
 * INSIDE, behind glazing too shallow and too dark to see through, and what is
 * on the roof is a REMOTE station: a cradle, an armoured shield, an optic head
 * and a barrel, with no pintle, no grips and nowhere for a body to stand. The
 * gun traverses because the man at the screen below it traversed it, which is
 * what an armoured car's weapon station actually is — so the thing that used
 * to look broken now looks like the point.
 *
 * Two more things fell out of it and neither was the reason:
 *
 * - **The gun's arc is 360 degrees by construction.** The pintle's whole
 *   geometry problem was that it had to shoot over its own cab, which is what
 *   the 1.14 m pedestal under it existed for; a station on the ROOF is above
 *   everything the vehicle has. What is left is the one clearance below, and
 *   it is downward rather than forward.
 * - **A body riding on the hull stands 50 cm over the roof instead of 1.7 m
 *   over the bed.** `Vehicle.deckAt` answers with the COLLIDER's top face,
 *   which is 2.5 m up on both designs — so a rider on the pickup floated well
 *   clear of the floor he looked like he was standing on.
 *
 * ## Twenty-two meshes, and fourteen of them move
 *
 * A tank is twenty-six because it has two belts, two masts and a cupola gun on
 * its own ring. This is the same accounting on a smaller machine: **eight for
 * the four wheels, four for the station and two for the mast cannot merge with
 * anything, because a mesh is bought here for exactly one reason and it is
 * never a colour — something that MOVES differently from everything around it
 * cannot merge with any of it.** The other eight are one per colour per
 * segment, exactly as over there, and there are FEWER of them than the pickup
 * had (23) carrying about twice the parts: every greeble below is in a colour
 * its own segment already pays for.
 *
 * ## The wheels are the whole difference, and there are two halves to it
 *
 * A tank's running gear is a belt, which cannot be one mesh and is drawn as a
 * scrolling strip of links. A truck's is four discs, which CAN be one mesh
 * each — and a disc rotating about its own axis is famously indistinguishable
 * from a disc at rest, which is the argument that got the tank's road wheels
 * no nodes at all. So the tyre alone would be a wasted mesh, and what earns it
 * is what is drawn ON it: **eight tread lugs standing proud of the carcass and
 * a pale hub with six bolts in the middle of it**, which is a pattern with an
 * orientation twice over — at the silhouette, where a wheel is an edge, and at
 * the face, where it is a disc. Both are in the same two meshes — a wheel is
 * one merge of two colours' worth of parts — because nothing on a wheel moves
 * against the rest of it.
 *
 * The second half is the STEER, and it is the one thing this model does that
 * the tank's cannot: the front pair are hung under a yaw node each and turned
 * with the stick. A tank's steer is already visible as its two tracks running
 * opposite ways; a truck that cornered at 65 km/h with its wheels pointing
 * dead ahead is a vehicle sliding sideways. That is why `VehicleRig.setRun`
 * takes a third argument at all — see its note, and note that the tank ignores
 * it for a reason rather than by omission.
 *
 * **The three numbers the physics reads off this drawing did not move.**
 * `gauge`, `contactReach` and `wheelReach` are the pickup's to the centimetre,
 * because the wheels are where they were: the axles, the track and the tyre
 * are the one part of the vehicle a redesign of the BODY has no business
 * touching, and leaving them alone is what makes this a repaint rather than a
 * retune of the suspension, the lean and the ten ground contacts.
 *
 * ## What the model may not do
 *
 * The two prohibitions in `vehicleRig.ts` (nothing emissive, nothing pickable)
 * and one more this shape invites: **nothing may stand on the roof inside the
 * station's sweep.** The gun turns a full circle and its muzzle reaches 1.46 m
 * past the trunnion, so a rack, a light bar or a rolled tarp anywhere within
 * that radius of `RING_Z` is something a traversing gun drives through. The
 * roof is therefore BARE, and everything that would have gone on it is on the
 * rear door, on the flanks or forward of the windscreen instead — which is
 * where it is on the vehicles this is drawn from anyway.
 */
import { Scene, TransformNode } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { CelMaterialFactory } from "../shaders/CelShader";
import type { Team } from "./Combatant";
import {
  type Box,
  inkRig,
  paintRig,
  segmentOf,
  setAntennaBend,
  type VehicleRig,
  type Whip,
} from "./vehicleRig";

/**
 * What one side's truck is PAINTED in — the tank kit's three-way read with
 * the same third of it deleted, and for the same reason: a vehicle is one
 * shape whoever owns it, and what tells the sides apart is hue and a saturated
 * accent.
 *
 * **The palette is deliberately not the tank's.** This is a civilian 4x4 with
 * plate bolted onto it, and what says so at a glance is that it is not painted
 * like armour: the body is dusty and light rather than olive and heavy, the
 * panels are flat, and there is sand-coloured kit strapped to the outside of
 * it. A player who cannot tell the two kinds apart at range is a player who
 * brings a rocket to the wrong vehicle.
 */
interface TruckKit {
  /** The body, the bonnet, the roof and the appliqué plate: most of what is seen. */
  body: string;
  /**
   * The dark structure — the chassis, the bar work, the arch flares, the
   * sliders, the snorkel, the weapon station and the gun. Nearly everything
   * that is not a panel, which is what makes it worth one mesh per segment.
   */
  frame: string;
  /** Tyres. The darkest thing on the vehicle. */
  tyre: string;
  /**
   * BARE METAL — the wheel hubs and their bolts, the winch drum, the snorkel
   * head, the exhaust tip, the barrel's jacket and the station's optic.
   *
   * Its first job is still the hub, and there the contrast against the tyre is
   * load-bearing rather than decorative: a wheel is the only thing on this
   * vehicle whose ROTATION can be read, and a hub in the tyre's own value
   * rotates invisibly. Everywhere else it is the colour that picks the four or
   * five FITTINGS out of a vehicle that is otherwise two flat panels and a lot
   * of near-black, and it is spent in exactly two segments beyond the wheels.
   */
  metal: string;
  /** The armoured glazing. Drawn, not glazed: a model may not hang a `Build.pane`. */
  glass: string;
  /** The spare, the cans, the sand ladders — what breaks the flat panels up. */
  stow: string;
  /** The friend/foe colour, from `CONFIG.teams`. */
  accent: string;
}

/** One kit per team, indexed by `Team`. Warm against cold, as the tanks are. */
const KITS: readonly TruckKit[] = [
  {
    // **Darker than the first version, and the accent is why.** Team 0's colour
    // is `#c9a15e`, and a tan body at `#9a8a63` put a warm gold marking on a
    // warm gold panel — no marking at all at three pixels, which is exactly
    // what `CLAUDE.md`'s conventions say a team colour may never be. What makes
    // this read as a civilian body rather than as armour is the PALE kit
    // strapped to it and the flat panels, not the body's own value.
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
 * kinds apart from behind (the other is the station on the roof). The arch
 * FLARES are what cover the gap, and they are what makes a wheel standing
 * outside its own bodywork read as a design rather than as a mistake.
 */
const TRACK_X = 1.05;
/**
 * How far fore and aft the axles stand — the wheelbase's half-length.
 *
 * Well inside the body's own half-length (2.7), which is what leaves an
 * overhang at each end: a bonnet in front of the front wheels and a rear door
 * behind the back ones. A vehicle whose wheels are at its corners is a go-kart.
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
 * a contact sampled out at the rear door is a vehicle rearing up on a kerb its
 * wheels have not reached. This is what `TRACK_REACH` is to a tank, and it is
 * shorter relative to the body for the same reason the overhangs exist.
 */
const CONTACT_REACH = AXLE_Z;
/** How far the front wheels turn at full lock. ~28 deg, which reads without looking broken. */
const STEER_LOCK = 0.49;
/**
 * Tread lugs round the carcass, and bolts round the hub.
 *
 * Two patterns with an orientation on the one part of this vehicle whose
 * rotation has to be legible — the lugs from the flank, where a wheel is a
 * silhouette, and the bolts from three-quarters on, where it is a face. Both
 * are free: a lug is the tyre's own colour and a bolt is the hub's, so neither
 * buys a mesh. See the header.
 */
const TREAD_LUGS = 8;
const HUB_BOLTS = 6;

// --- the body, from the chassis rail up ------------------------------------

/** Where the chassis rail's top sits — what the springs push against. */
const FRAME_Y = 0.62;
/** The cabin floor, and the bottom of the body sides. */
const SILL_Y = 0.74;
/**
 * The belt line: the top of the armoured lower body and the bottom of the
 * glazing.
 *
 * High, and the height is the whole read. A civilian estate is about half
 * glass; this is 70 cm of plate under a 40 cm slot, which is the proportion
 * that says "armoured" before any other detail on the vehicle has resolved —
 * and it is also what makes the crew UNSEEABLE at the range this is fought at,
 * which is the point of the whole redesign.
 */
const WAIST_Y = 1.44;
/** The top of the roof panel. Everything above this is the weapon station. */
const ROOF_Y = 1.96;
/** Half the body's own width, inside the collider's 1.25 by a flare's thickness. */
const BODY_HW = (CONFIG.vehicles.truck.hull.width - 0.14) / 2;

/** Where the bonnet stops and the windscreen starts. */
const SCUTTLE_Z = 0.98;
/** …and the rake it stands at, shared by the screen and the A-pillars beside it. */
const SCREEN_RAKE = -0.55;

/** The station's base ring: how big it is and how high it turns. */
const RING_R = 0.44;
const RING_Y = ROOF_Y + 0.04;
/**
 * …and where it stands, which is over the second row — where the man working
 * it is sitting.
 *
 * It is also about as far back as the sweep allows: the muzzle reaches 1.46 m
 * and the roof runs to -2.42, so a station much further aft would swing its
 * barrel off the back of the vehicle rather than over it.
 */
const RING_Z = -0.85;

/** The one whip's length. */
const ANTENNA_LENGTH = 1.35;

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
  const kit = KITS[team];
  const t = CONFIG.vehicles.truck;
  // Built to the collider's own extents rather than to numbers of its own, so
  // the shape a round stops on and the shape a player aims at cannot drift
  // apart. Everything below is expressed against these.
  const L = t.hull.length;
  /** The front of the bonnet, inside the collider by the bar work in front of it. */
  const noseZ = L / 2 - 0.22;
  /** The rear door's face, inside the collider by the spare bolted to it. */
  const tailZ = -(L / 2 - 0.26);

  const root = new TransformNode("truck", scene);
  const hull = new TransformNode("truck-hull", scene);
  hull.parent = root;
  // Everything the springs carry, which is everything except the wheels.
  // See `VehicleRig.sprung`.
  const sprung = new TransformNode("truck-sprung", scene);
  sprung.parent = hull;

  const { meshes, livery, segment } = segmentOf(scene, mats);

  // --- the wheels: four discs with two patterns on them ---------------------
  //
  // Each is its own mesh because it moves differently from everything around
  // it, and each is TWO colours in one merge — a near-black lugged tyre and a
  // pale bolted hub, which is what makes the rotation legible from the flank
  // and from three-quarters on. See the header on why the tank's road wheels
  // get none of this.
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
    // The tread: a block standing 4 cm proud of the carcass and 1 cm proud of
    // it each side, laid round the circumference in the y-z plane the wheel
    // turns in. `rotX` is the same angle as the position, which is what puts
    // each lug's own up-axis along the radius.
    for (let k = 0; k < TREAD_LUGS; k++) {
      const a = (k * Math.PI * 2) / TREAD_LUGS;
      parts.push([
        WHEEL_W + 0.02,
        0.08,
        0.2,
        0,
        WHEEL_R * Math.cos(a),
        WHEEL_R * Math.sin(a),
        kit.tyre,
        a,
      ]);
    }
    // The bolts, on the OUTBOARD face only — the inboard one is never seen and
    // a pattern there is parts paying for nothing. Boxes rather than cylinders
    // because at 6 cm the facets are not a thing an eye can find.
    for (let k = 0; k < HUB_BOLTS; k++) {
      const a = (k * Math.PI * 2) / HUB_BOLTS;
      parts.push([
        0.06,
        0.07,
        0.07,
        sign * (WHEEL_W / 2 - 0.01),
        0.17 * Math.cos(a),
        0.17 * Math.sin(a),
        kit.metal,
      ]);
    }
    segment(`truck-wheel${i}-m`, spin, parts, [
      [WHEEL_R * 2, WHEEL_W, 0, 0, 0, kit.tyre, "x"],
      // The rim and the centre cap over it, both outboard for the bolts'
      // reason.
      [WHEEL_R * 1.15, 0.08, sign * (WHEEL_W / 2 - 0.03), 0, 0, kit.metal, "x"],
      [0.2, 0.06, sign * (WHEEL_W / 2 + 0.02), 0, 0, kit.metal, "x"],
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

  // --- the chassis: two rails, two live axles and the gear between them -----
  //
  // On `hull` rather than `sprung`, because a ladder frame is what the springs
  // push AGAINST: this is the running gear's half of the vehicle, and keeping
  // it here is what stops the axles rising with the body when it settles. It
  // is also the only part of the drawing a player sees from BELOW — a hull
  // nosed into a ditch shows its underside, and a flat plate down there is a
  // vehicle with no mechanism in it.
  segment(
    "truck-frame",
    hull,
    [
      [0.16, 0.2, L - 0.9, -0.72, FRAME_Y - 0.12, 0, kit.frame],
      [0.16, 0.2, L - 0.9, 0.72, FRAME_Y - 0.12, 0, kit.frame],
      // The two axle beams, which are what make the gap under the body read as
      // ground clearance rather than as a body floating over four discs.
      [TRACK_X * 2, 0.16, 0.2, 0, HUB_Y, AXLE_Z, kit.frame],
      [TRACK_X * 2, 0.18, 0.24, 0, HUB_Y, -AXLE_Z, kit.frame],
      // A differential on EACH axle, off the centreline and on the same side —
      // the cue that says "live axles, driven at both ends", which is the one
      // mechanical claim this vehicle's handling actually makes.
      [0.34, 0.32, 0.34, 0.12, HUB_Y, -AXLE_Z, kit.frame],
      [0.3, 0.28, 0.3, 0.12, HUB_Y, AXLE_Z, kit.frame],
      // The transfer case between them, and the fuel tank slung off the far
      // rail.
      [0.3, 0.26, 0.44, 0.1, FRAME_Y - 0.2, 0.24, kit.frame],
      [0.68, 0.26, 0.9, -0.4, FRAME_Y - 0.2, -0.85, kit.frame],
    ],
    [
      // Two propeller shafts out of the transfer case, which is what joins the
      // three lumps above into one drivetrain.
      [0.1, 1.3, 0.11, FRAME_Y - 0.22, -0.68, kit.frame, "z"],
      [0.09, 0.95, 0.11, FRAME_Y - 0.22, 0.93, kit.frame, "z"],
      // Four shock cans, standing off the axle beams at the wheel stations.
      [0.12, 0.36, -0.8, HUB_Y + 0.2, AXLE_Z, kit.frame, "y"],
      [0.12, 0.36, 0.8, HUB_Y + 0.2, AXLE_Z, kit.frame, "y"],
      [0.12, 0.36, -0.8, HUB_Y + 0.2, -AXLE_Z, kit.frame, "y"],
      [0.12, 0.36, 0.8, HUB_Y + 0.2, -AXLE_Z, kit.frame, "y"],
    ],
  );

  // --- the body: one closed shell, from the nose to the rear door -----------
  segment("truck-body", sprung, [
    // The tub — the armoured lower body, floor to belt line, rear door to
    // scuttle. One slab, because that is what it is: what keeps it from
    // reading as a crate is the glazing slot above it and the bar work hung
    // off it, not a facet on it.
    [
      BODY_HW * 2,
      WAIST_Y - SILL_Y,
      SCUTTLE_Z + 0.12 - tailZ,
      0,
      (SILL_Y + WAIST_Y) / 2,
      (SCUTTLE_Z + 0.12 + tailZ) / 2,
      kit.body,
    ],
    // The bonnet, sloping very slightly down toward the grille. `rotX` rather
    // than a stack of boxes: this is the one panel on the vehicle whose angle
    // is read against the windscreen behind it, and two parallel flat plates
    // are a shipping container.
    [BODY_HW * 2 - 0.12, 0.3, 1.46, 0, 1.3, 1.75, kit.body, -0.045],
    // The engine bay's front, and the two wings beside the bonnet — which is
    // what a bonnet 12 cm narrower than the body leaves room for.
    [BODY_HW * 2 - 0.04, 0.52, 1.4, 0, 0.94, 1.78, kit.body],
    [0.22, 0.44, 1.44, -(BODY_HW - 0.11), 1.22, 1.74, kit.body],
    [0.22, 0.44, 1.44, BODY_HW - 0.11, 1.22, 1.74, kit.body],
    // Four pillars a side. The A-pair take the windscreen's own rake, so the
    // greenhouse is one shape rather than a raked pane between two uprights.
    [0.14, 0.56, 0.14, -(BODY_HW - 0.08), 1.68, 0.83, kit.body, SCREEN_RAKE],
    [0.14, 0.56, 0.14, BODY_HW - 0.08, 1.68, 0.83, kit.body, SCREEN_RAKE],
    [0.14, 0.48, 0.16, -(BODY_HW - 0.08), 1.68, -0.3, kit.body],
    [0.14, 0.48, 0.16, BODY_HW - 0.08, 1.68, -0.3, kit.body],
    [0.14, 0.48, 0.16, -(BODY_HW - 0.08), 1.68, -1.5, kit.body],
    [0.14, 0.48, 0.16, BODY_HW - 0.08, 1.68, -1.5, kit.body],
    [0.14, 0.48, 0.16, -(BODY_HW - 0.08), 1.68, -2.36, kit.body],
    [0.14, 0.48, 0.16, BODY_HW - 0.08, 1.68, -2.36, kit.body],
    // The roof, and the header rail the windscreen stops against. Nothing else
    // is up here and nothing else may be — see the header.
    [BODY_HW * 2 - 0.04, 0.1, 3.0, 0, ROOF_Y - 0.05, -0.92, kit.body],
    [BODY_HW * 2 - 0.04, 0.14, 0.18, 0, 1.89, 0.62, kit.body],
    // The rear door, raised out of the tub's back face so the vehicle has a
    // way in that reads from behind — which is the angle most of the map sees
    // it from, this being the thing that drives away.
    [BODY_HW * 2 - 0.24, 0.62, 0.1, 0, 1.1, tailZ - 0.06, kit.body],
    // Appliqué plate over both doors each side: a panel standing 2 cm off the
    // body, which is the single detail that says the tub is not merely a tall
    // body but a plated one. The team flash sits ON these, so the two depths
    // have to stack — see `truck-mark`.
    [0.05, 0.46, 1.1, -(BODY_HW - 0.005), 1.12, 0.3, kit.body],
    [0.05, 0.46, 1.1, BODY_HW - 0.005, 1.12, 0.3, kit.body],
    [0.05, 0.46, 1.2, -(BODY_HW - 0.005), 1.12, -0.95, kit.body],
    [0.05, 0.46, 1.2, BODY_HW - 0.005, 1.12, -0.95, kit.body],
  ]);

  // --- the bar work, the flares and the fittings: everything dark -----------
  //
  // One segment and two colours, which is what the whole of this costs. A
  // vehicle like this is mostly bar and bracket over two flat panels, and
  // every part below is either the frame's near-black or the metal fittings'
  // grey — so the twenty-odd shapes here are two meshes between them.
  segment(
    "truck-kit",
    sprung,
    [
      // Arch flares over all four wheels, covering the 4 cm of tread that
      // stands outside the bodywork. Out to 1.24 of the collider's 1.25 — the
      // widest anything on this vehicle gets, and deliberately so: a flare
      // that stops short of the tyre is a flare that looks bent.
      [0.16, 0.18, 1.34, -1.16, 1.1, AXLE_Z, kit.frame],
      [0.16, 0.18, 1.34, 1.16, 1.1, AXLE_Z, kit.frame],
      [0.16, 0.18, 1.34, -1.16, 1.1, -AXLE_Z, kit.frame],
      [0.16, 0.18, 1.34, 1.16, 1.1, -AXLE_Z, kit.frame],
      // The grille, sunk between the wings.
      [BODY_HW * 2 - 0.44, 0.34, 0.1, 0, 1.16, noseZ + 0.03, kit.frame],
      // The bull bar: two uprights, two rails and a wing turned in at each
      // corner. It stands 14 cm proud of the nose, which is inside the
      // collider — nothing here may reach past `L / 2`.
      [0.12, 0.66, 0.14, -0.78, FRAME_Y + 0.4, noseZ + 0.14, kit.frame],
      [0.12, 0.66, 0.14, 0.78, FRAME_Y + 0.4, noseZ + 0.14, kit.frame],
      [1.86, 0.12, 0.14, 0, FRAME_Y + 0.68, noseZ + 0.14, kit.frame],
      [1.86, 0.12, 0.14, 0, FRAME_Y + 0.12, noseZ + 0.14, kit.frame],
      [0.5, 0.6, 0.12, -0.98, FRAME_Y + 0.4, noseZ - 0.06, kit.frame, 0, 0.5],
      [0.5, 0.6, 0.12, 0.98, FRAME_Y + 0.4, noseZ - 0.06, kit.frame, 0, -0.5],
      // The rear bumper, and a tow eye each side of it.
      [2.0, 0.24, 0.16, 0, FRAME_Y + 0.04, tailZ - 0.12, kit.frame],
      [0.12, 0.2, 0.24, -0.62, FRAME_Y + 0.02, tailZ - 0.2, kit.frame],
      [0.12, 0.2, 0.24, 0.62, FRAME_Y + 0.02, tailZ - 0.2, kit.frame],
      // Mirror arms and heads: the last thing on the vehicle drawn at a
      // person's scale rather than a vehicle's, which is most of why they are
      // worth eight boxes.
      [0.12, 0.05, 0.05, -1.14, 1.56, 0.9, kit.frame],
      [0.12, 0.05, 0.05, 1.14, 1.56, 0.9, kit.frame],
      [0.06, 0.2, 0.12, -1.21, 1.54, 0.86, kit.frame],
      [0.06, 0.2, 0.12, 1.21, 1.54, 0.86, kit.frame],
      // The snorkel's elbow into the wing. The stack itself is a cylinder
      // below.
      [0.15, 0.16, 0.4, 1.15, 1.16, 1.32, kit.frame],
      // The snorkel HEAD, facing forward off the top of the stack. Metal,
      // because it is the one fitting on this vehicle that stands against the
      // sky, and a near-black one is a hole in the silhouette.
      [0.18, 0.22, 0.28, 1.15, 2.18, 1.06, kit.metal],
      // Door handles, which cost nothing and are the difference between a body
      // with doors in it and a body with lines drawn on it.
      [0.05, 0.06, 0.24, -(BODY_HW + 0.06), 1.3, 0.62, kit.metal],
      [0.05, 0.06, 0.24, BODY_HW + 0.06, 1.3, 0.62, kit.metal],
      [0.05, 0.06, 0.24, -(BODY_HW + 0.06), 1.3, -0.58, kit.metal],
      [0.05, 0.06, 0.24, BODY_HW + 0.06, 1.3, -0.58, kit.metal],
    ],
    [
      // Rock sliders under the doors. A tube rather than a box because it is
      // 12 cm of pipe seen against the ground and a square one is a girder —
      // the barrel's argument, one metre lower down.
      [0.12, 2.0, -1.16, SILL_Y - 0.16, -0.1, kit.frame, "z"],
      [0.12, 2.0, 1.16, SILL_Y - 0.16, -0.1, kit.frame, "z"],
      // The snorkel stack, up the off-side A-pillar and clear of the station's
      // sweep by well over a metre.
      [0.14, 1.1, 1.15, 1.62, 1.06, kit.frame, "y"],
      // The exhaust, out behind the rear wheel with a metal tip on it.
      [0.11, 0.8, -1.12, 0.5, -2.05, kit.frame, "z"],
      [0.13, 0.14, -1.12, 0.5, -2.5, kit.metal, "z"],
      // The winch drum in the bull bar — the fitting that explains the bar.
      [0.24, 0.46, 0, FRAME_Y + 0.4, noseZ + 0.08, kit.metal, "x"],
    ],
  );

  // --- the glazing and the lamps -------------------------------------------
  //
  // A 40 cm slot between 70 cm of plate and the roof, and that proportion is
  // the whole point of it: what is behind this glass is a crew nobody can
  // resolve, on a vehicle whose gun is on the OUTSIDE. See the header.
  segment("truck-glass", sprung, [
    // The windscreen, at the A-pillars' own rake.
    [BODY_HW * 2 - 0.32, 0.56, 0.07, 0, 1.68, 0.83, kit.glass, SCREEN_RAKE],
    // Front and rear side windows, and a quarter light behind each.
    [0.06, 0.4, 1.0, -(BODY_HW + 0.01), 1.68, 0.28, kit.glass],
    [0.06, 0.4, 1.0, BODY_HW + 0.01, 1.68, 0.28, kit.glass],
    [0.06, 0.4, 1.04, -(BODY_HW + 0.01), 1.68, -0.9, kit.glass],
    [0.06, 0.4, 1.04, BODY_HW + 0.01, 1.68, -0.9, kit.glass],
    [0.06, 0.36, 0.7, -(BODY_HW + 0.01), 1.68, -1.93, kit.glass],
    [0.06, 0.36, 0.7, BODY_HW + 0.01, 1.68, -1.93, kit.glass],
    // The rear window, which is what makes the back of this a back rather than
    // a wall.
    [BODY_HW * 2 - 0.44, 0.38, 0.06, 0, 1.66, tailZ + 0.02, kit.glass],
    // The lamps. BOXES and not lights — nothing on a vehicle may be emissive,
    // because `Game`'s GlowLayer scan is construction-time and a hull is built
    // per round.
    [0.26, 0.2, 0.08, -(BODY_HW - 0.34), 1.16, noseZ + 0.06, kit.glass],
    [0.26, 0.2, 0.08, BODY_HW - 0.34, 1.16, noseZ + 0.06, kit.glass],
    [0.16, 0.32, 0.07, -(BODY_HW - 0.2), 1.24, tailZ - 0.12, kit.glass],
    [0.16, 0.32, 0.07, BODY_HW - 0.2, 1.24, tailZ - 0.12, kit.glass],
  ]);

  // --- the markings: `CONFIG.teams`' colour, facing every direction ---------
  //
  // The same three-way read `SoldierModel`'s kits make, minus the silhouette:
  // a flash on each flank, one across the bonnet and one across the rear door,
  // so a marking is visible from wherever the vehicle is being looked at. A
  // marking that only reads from the flank is no marking at all on a thing
  // that is mostly seen coming or going.
  //
  // **The flank pair have to clear the appliqué plate's INK and not merely its
  // face**, which is the one thing this arrangement got wrong first time out.
  // `inkRig` gives every mesh a 2 cm outline hull, so a flash standing 2 cm
  // off a plate is a flash drawn entirely inside that plate's own ink and the
  // vehicle has no flank marking at all — measured on a photograph, where the
  // door read as a dark rectangle. They stand 4 cm proud instead (1.17 to 1.24
  // against the plate's 1.15 to 1.20), which is inside the collider's 1.25
  // with a centimetre to spare and is the ink's width twice over.
  segment("truck-mark", sprung, [
    [0.07, 0.26, 0.66, -(BODY_HW + 0.025), 1.12, 0.3, kit.accent],
    [0.07, 0.26, 0.66, BODY_HW + 0.025, 1.12, 0.3, kit.accent],
    // A stripe across the bonnet rather than a panel on it: the bonnet is the
    // biggest flat surface the vehicle has and a marking sized to it reads as
    // a hazard placard rather than as a side's colour.
    [BODY_HW * 2 - 1.1, 0.06, 0.34, 0, 1.46, 1.86, kit.accent, -0.045],
    [BODY_HW * 2 - 0.7, 0.14, 0.05, 0, 0.94, tailZ - 0.12, kit.accent],
  ]);

  // --- what is strapped to the outside -------------------------------------
  //
  // All of it on the REAR DOOR or the flanks, because the roof belongs to the
  // gun — see the header. That is also where it is on the vehicles this is
  // drawn from: the spare goes on the door because there is no bed to put it
  // in, which is the same reason this vehicle has a door at all.
  segment(
    "truck-stow",
    sprung,
    [
      // Two jerry cans low on the rear door, either side of the spare.
      [0.18, 0.42, 0.3, -0.82, 0.98, tailZ - 0.18, kit.stow],
      [0.18, 0.42, 0.3, 0.82, 0.98, tailZ - 0.18, kit.stow],
      // Sand ladders lashed along each flank, sitting on top of the appliqué
      // plate exactly as they would be strapped to it.
      [0.06, 0.1, 2.2, -(BODY_HW + 0.04), 1.38, -0.35, kit.stow],
      [0.06, 0.1, 2.2, BODY_HW + 0.04, 1.38, -0.35, kit.stow],
      // A tool box under the rear quarter, in the gap between the slider and
      // the plate.
      [0.2, 0.28, 0.5, -(BODY_HW - 0.06), 0.88, -1.9, kit.stow],
    ],
    [
      // The spare, flat on the rear door. In the stow colour rather than the
      // tyre's because it merges here for free and a spare on a vehicle like
      // this is under a cover.
      //
      // Low on the door rather than centred on it: at the belt line it stood
      // across the middle of the rear window, which reads as a wheel hung over
      // a hole rather than bolted to a door. Down here it laps the window's
      // bottom edge by 18 cm, which is where one actually sits.
      [WHEEL_R * 1.95, 0.22, 0, 1.2, tailZ - 0.2, kit.stow, "z"],
    ],
  );

  // --- the station's base ring: the node that never moves -------------------
  //
  // **`VehicleRig.turret` is here and is deliberately inert.** `Vehicle` keeps
  // `turretYaw` equal to the hull's own yaw on a gunless kind, so the local
  // angle written on this node is always zero — which is exactly what a ring
  // BOLTED to a roof should do. It exists so that the mount below has the same
  // parent it has on a tank and `aimMg` needs no branch: the machine gun is
  // held in WORLD angles either way, and what it hangs off is the only thing
  // that differs.
  const turret = new TransformNode("truck-ring", scene);
  turret.parent = sprung;
  segment("truck-ring-m", turret, [], [
    // The ring itself, and the armoured collar it is let into — which is what
    // stops a station standing on a roof reading as a thing dropped onto one.
    [RING_R * 2, 0.1, 0, RING_Y - 0.05, RING_Z, kit.frame, "y"],
    [RING_R * 2 + 0.16, 0.06, 0, ROOF_Y + 0.02, RING_Z, kit.frame, "y"],
  ]);

  // --- the REMOTE weapon station, and what it deliberately has not got ------
  //
  // Two nodes and four meshes, the same pair the tank's cupola gun gets and
  // for the same reason: they move differently from everything around them.
  // The cradle TRAVERSES on the ring and the gun ELEVATES in the cradle.
  //
  // **There is no pintle, no spade grip and nowhere to stand**, and each of
  // those absences is the point rather than an economy — see the header. What
  // is here instead is an armoured shield, a traverse actuator and an OPTIC,
  // which between them say that the thing aiming this gun is downstairs.
  const mgMount = new TransformNode("truck-mg", scene);
  mgMount.parent = turret;
  mgMount.position.set(0, RING_Y + 0.06, RING_Z);
  segment("truck-mg-ring", mgMount, [
    // The cradle's base, sitting on the ring.
    [0.56, 0.16, 0.62, 0, 0.02, -0.02, kit.frame],
    // The two trunnion cheeks the gun hangs between.
    [0.1, 0.26, 0.24, -0.26, 0.16, 0.06, kit.frame],
    [0.1, 0.26, 0.24, 0.26, 0.16, 0.06, kit.frame],
    // The shield, and a wing turned in at each edge. It is what makes the
    // traverse legible from outside — a flat plate has an orientation where a
    // bare gun is a stick — and it is the one part of the station that reads
    // at the range this vehicle is usually seen at.
    [0.66, 0.36, 0.06, 0, 0.28, 0.3, kit.frame],
    [0.18, 0.32, 0.05, -0.36, 0.26, 0.26, kit.frame, 0, 0.5],
    [0.18, 0.32, 0.05, 0.36, 0.26, 0.26, kit.frame, 0, -0.5],
    // The traverse actuator behind the cradle.
    [0.16, 0.18, 0.22, -0.28, 0, -0.24, kit.frame],
    // The optic head on the near cheek, with a dark face in it. METAL, which
    // is the whole of what makes it read as a sight rather than as another
    // bracket: it is the only pale thing above the roof line, so the eye finds
    // it — and finding it is what tells a player where this gun is looking.
    [0.2, 0.18, 0.26, -0.36, 0.3, 0.02, kit.metal],
    [0.14, 0.1, 0.05, -0.36, 0.3, 0.16, kit.frame],
  ]);
  const mgGun = new TransformNode("truck-mg-gun", scene);
  mgGun.parent = mgMount;
  mgGun.position.set(0, 0.18, 0.06);
  segment("truck-mg-m", mgGun, [
    // The receiver, the ammunition can on its flank, the buffer behind it and
    // the charging handle — the shapes that make a heavy machine gun read as
    // one at ten metres. Bigger than the tank's cupola gun, because it is a
    // bigger gun: this is the only weapon the vehicle has.
    [0.2, 0.2, 0.66, 0, 0, 0.04, kit.frame],
    [0.22, 0.26, 0.3, 0.22, -0.01, -0.06, kit.frame],
    [0.16, 0.14, 0.16, 0, 0.01, -0.34, kit.frame],
    [0.06, 0.06, 0.16, -0.14, 0.02, -0.1, kit.frame],
    // The elevation actuator, running down to the cradle. It is what a gun
    // with no hands on it is moved BY, and it is one box.
    [0.1, 0.1, 0.28, -0.24, -0.13, -0.14, kit.frame],
  ], [
    // A ROUND barrel with a jacket at its root and a brake on its nose, for
    // the reason every barrel in this game is round: a square pipe is a
    // girder. The two metal parts are the fitting colour the optic is.
    [0.17, 0.34, 0, 0.02, 0.46, kit.metal, "z"],
    [0.095, 0.8, 0, 0.02, 0.92, kit.frame, "z", 0.08],
    [0.14, 0.14, 0, 0.02, 1.36, kit.metal, "z"],
  ]);
  const mgMuzzle = new TransformNode("truck-mg-muzzle", scene);
  mgMuzzle.parent = mgGun;
  // Just past the brake, so a flash lit here is outside the barrel and a round
  // fired from here starts outside the vehicle's own collider box.
  //
  // **This 1.46 is the tightest number in the file.** The trunnion is at 2.24
  // and `mg.pitchMin` is -0.16 rad, so at full depression the muzzle stands at
  // 2.03 above the tracks — MEASURED off `mgMuzzle.getAbsolutePosition()` on
  // Sarab with the gun laid abeam and fully depressed, which is 6.7 cm over a
  // roof at 1.96, through every bearing of the traverse. Re-derive it if the
  // roof, the ring height, the barrel's length or `pitchMin` moves: a station
  // that depresses into its own roof is the pickup's pedestal problem in a new
  // place.
  mgMuzzle.position.set(0, 0.02, 1.46);

  // --- one whip, off the front wing ----------------------------------------
  //
  // ONE and not the tank's two, and the difference is what a mast is for on
  // each: a tank carries a pair because a command vehicle runs two nets, and
  // this is a truck with a radio in it. It costs two meshes rather than four,
  // and it is the only part of this vehicle that reports on the DRIVE the way
  // the tank's tracks do — the wheels say it is moving and the mast says how
  // hard.
  //
  // **On the front WING**, which on the pickup was a fix for a mast the gun
  // swept through and here is simply the only place left: the roof belongs to
  // the station, and a whip stood anywhere on it is 1.46 m of barrel's worth
  // of trouble. Out here it is 2.5 m from the ring, which nothing on it can
  // reach.
  const whipBase = new TransformNode("truck-whip", scene);
  whipBase.parent = sprung;
  whipBase.position.set(-(BODY_HW - 0.06), WAIST_Y, 1.4);
  const whipTip = new TransformNode("truck-whip-tip", scene);
  whipTip.parent = whipBase;
  whipTip.position.set(0, ANTENNA_LENGTH / 2, 0);
  segment("truck-whip-lo", whipBase, [], [
    [0.05, ANTENNA_LENGTH / 2, 0, ANTENNA_LENGTH / 4, 0, kit.frame, "y", 0.042],
  ]);
  segment("truck-whip-hi", whipTip, [], [
    [0.042, ANTENNA_LENGTH / 2, 0, ANTENNA_LENGTH / 4, 0, kit.frame, "y", 0.028],
  ]);
  // `rate` is 1 because this is the model's only mast and therefore its
  // longest — the config spring is stated for exactly that one. `phase` is 0
  // for the same reason: there is nothing for it to be out of step with.
  const antennae: readonly Whip[] = [
    { base: whipBase, tip: whipTip, rate: 1, phase: 0 },
  ];

  inkRig(meshes);

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
    setRun: (left, right, steer) => setWheelRun(wheels, left, right, steer),
    reset: () => resetTruckPose(rig, mats),
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

/**
 * Puts a rig back to how it was built — every joint at rest, the wheels back
 * at the start of their turn and the paint back on. What a hull goes through
 * on the respawn timer, and the whole reason a destroyed truck is repainted
 * rather than replaced.
 */
function resetTruckPose(rig: VehicleRig, mats: CelMaterialFactory): void {
  rig.hull.rotation.set(0, 0, 0);
  rig.sprung.position.y = 0;
  rig.sprung.rotation.set(0, 0, 0);
  rig.turret.rotation.set(0, 0, 0);
  rig.mgMount.rotation.set(0, 0, 0);
  rig.mgGun.rotation.set(0, 0, 0);
  rig.setRun(0, 0, 0);
  const share = CONFIG.vehicles.truck.antenna.baseShare;
  for (const w of rig.antennae) setAntennaBend(w, share, 0, 0, 0, 0);
  paintRig(rig.meshes, rig.livery, mats, false);
}
