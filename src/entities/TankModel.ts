/**
 * TankModel.ts — The TANK's mesh, drawn as a Leopard 2A6: ~600 boxes,
 * cylinders, rods and faceted solids merged down to twenty-five meshes, with a
 * turret and a gun that turn, a cupola gun that turns independently of both,
 * tracks that RUN, two antennae that BEND, and the charred repaint a wreck
 * takes.
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
 * - **Merged per colour per NODE.** A mesh is a draw call, so this model's
 *   cost is COLOURS PER MOVING PART and not boxes: six hundred parts come out as
 *   twenty-five meshes, and a wheel that costs sixty triangles instead of
 *   twelve costs nothing at all — see `Cyl`. That is why the whole sprung hull
 *   is ONE segment and the whole turret another: split into several segments
 *   on one node, a colour pays once per segment it appears in. **Twelve of the
 *   twenty-five are there because a mesh that MOVES differently cannot merge
 *   with anything**, which is the one thing that buys a mesh here: six for the
 *   tracks, four for the two antennae, two for the commander's gun on its own
 *   ring, and nothing else in the model has earned one.
 * - **The joints are `TransformNode`s above the merged meshes**, so the turret
 *   traversing, the gun elevating and the tracks running are transforms and
 *   never a re-merge.
 * - **Nothing here is emissive.** The rule was written when the glow's `noGlow`
 *   exclusion was a one-shot scan at construction and a tank, built per round,
 *   could never be excluded; the bloom reads `noGlow` per mesh every frame now
 *   (`GlowPass`), so that reason is gone, but an emissive part on a hull is
 *   still a decision nobody has made. The rear lens `world/kit/core.ts` allows
 *   itself is exactly the thing this model may not have.
 *
 * `+Z is forward`, matching the yaw convention everywhere else in the game
 * (`forward = (sin(yaw), 0, cos(yaw))`), and `y = 0` is the bottom of the
 * tracks — the point the ground probe puts on the floor.
 *
 * ## Six of the twenty-five meshes move, and that is the whole of the tracks
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
import { viewTeam } from "../core/teamView";
import { extrude, rodBetween, solidBetween, type Point3, type ProfilePoint } from "./facet";
import {
  paintRig,
  segmentOf,
  setAntennaBend,
  type Box,
  type Cyl,
  type Shape,
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
  /**
   * The band, the tyres, the machine gun, the rails and the dark GLASS of
   * every sight and lamp: the darkest thing here, and what a grille or a
   * vision block is recessed into.
   */
  track: string;
  /**
   * Road wheels, drive sprocket and idler — in the HULL's paint, as a real
   * one's are, and therefore well lighter than the track they run in; that
   * contrast is load-bearing rather than decorative. It is its own field and
   * not `armor` read twice because the wheels are a mesh of their own on a
   * node of their own either way. See the running gear in `buildTank`.
   */
  wheel: string;
  /**
   * The raised links laid along the band, and the one colour on the model that
   * exists to be SEEN MOVING. A step lighter than the band under it for the
   * reason the wheels are a step lighter still: a scrolling strip in the band's
   * own value scrolls invisibly, which is a frame budget spent on nothing.
   */
  link: string;
  /**
   * Stowage, fittings, the smoke dischargers and the crew's kit in the
   * basket: the greebles that break the plate up.
   */
  stow: string;
  /** The friend/foe colour, from `CONFIG.teams`. */
  accent: string;
}

/**
 * One kit per SIDE, indexed by the VIEW and not by `Team` — see
 * `core/teamView.ts`, and `SoldierModel`'s `KITS`. Warm against cold, as the
 * soldiers are.
 */
const KITS: readonly TankKit[] = [
  {
    armor: "#5a5844",
    track: "#232220",
    wheel: "#5a5844",
    link: "#34322d",
    stow: "#6d6a55",
    accent: CONFIG.teams[0].color,
  },
  {
    armor: "#464b52",
    track: "#1e2023",
    wheel: "#464b52",
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
/** Road wheels a side — seven, close-pitched, as a Leopard 2 runs on. */
const ROAD_WHEELS = 7;
/**
 * Where the return rollers stand, fore and aft: in the GAPS between road-wheel
 * tops (the midpoints of the 70 cm pitch), because a roller over a wheel's
 * crown would stand inside the wheel.
 */
const RETURN_ROLLERS = [-1.758, -0.352, 1.055] as const;
/** The turret's width across its flat sides, the add-on armour not counted. */
const TURRET_W = 2.56;
/**
 * The two antenna feet on the turret roof, `[x, z]` — the back corners,
 * staggered, and clear of everything else the roof carries.
 */
const ANTENNA_FEET = [[1.08, -1.5], [-1.08, -1.7]] as const;

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
 * the bot rig pool follows, and for the same reason: this is ~600 parts and
 * their merges, which is not a cost to pay on the frame a hull respawns.
 * `resetTankPose` is what a fresh one goes through instead.
 *
 * **What it is drawn AS is a Leopard 2A6**, and everything below follows from
 * how that vehicle is built: a long low hull with a shallow upper glacis, seven
 * rubber-tyred road wheels behind armoured skirts, a flat-sided turret with a
 * long bustle and an arrowhead of spaced armour bolted over its face, a long
 * smoothbore with a bore evacuator and no brake, the commander's panoramic
 * sight on a pedestal and the gunner's in a doghouse at the front of the roof.
 * No insignia and no national detail: it is a real type's CONSTRUCTION, worn by
 * both sides, which is the read the kit colours rest on.
 */
export function buildTank(
  scene: Scene,
  mats: CelMaterialFactory,
  team: Team,
): VehicleRig {
  // The kit is the VIEWER's read of this side rather than the authority's
  // index for it: the local player's own side wears amber whichever slot a
  // match seated them in. See `core/teamView.ts`.
  const kit = KITS[viewTeam(team)];
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

  /**
   * A round member from `a` to `b` — a rail, a cable, a discharger tube, a
   * bolt standing off a sloped face. Built along +Z and turned onto its bearing
   * the way `world/kit/core.ts`'s `orient` turns a member, because neither the
   * box's two rotations nor a cylinder's three axes can lay a tube at an angle.
   */
  const rod = (a: Point3, b: Point3, d: number, color: string, tess = 8, dTop = d): Shape => [
    rodBetween("tank-rod", scene, a, b, d, tess, dTop),
    color,
  ];
  /** A side profile extruded across X — a hull, a skirt plate, a sight head. */
  const slab = (
    profile: readonly ProfilePoint[],
    width: number,
    bevel: number,
    x: number,
    color: string,
  ): Shape => [extrude("tank-slab", scene, profile, width, bevel, x), color];
  /** A convex solid between two end faces — the turret's wedge. */
  const solid = (from: readonly Point3[], to: readonly Point3[], color: string): Shape =>
    [solidBetween("tank-solid", scene, from, to), color];

  // ==========================================================================
  // THE RUNNING GEAR — on `hull`, because a track lies on the ground its
  // contacts found and the body is what moves against it.
  // ==========================================================================

  // --- the band: two flat runs, closed at each end by a wheel ---------------
  //
  // The loop is drawn as what a side view of one IS — a run on the ground, a
  // run over the wheels, and a circle at each end — rather than as the solid
  // slab the first version used. The slab was what made the vehicle read as an
  // APC: a tracked hull is mostly HOLE between its runs, and the road wheels
  // filling that hole are the whole silhouette.
  //
  // The TYRES go in this segment and not in the wheels', because they are the
  // band's own colour: a road wheel is a pale pressed disc in a black rubber
  // rim, and a rim in the track's value costs no mesh here where it would cost
  // one on every hull in the wheel segment.
  const belt: Box[] = [];
  const tyres: Cyl[] = [];
  const wheels: Cyl[] = [];
  // Proud of the band by 7 cm a side: flush, the wheels are inside its
  // silhouette and cannot be seen at all.
  const WHEEL_W = TRACK_W + 0.14;
  for (const side of [-1, 1]) {
    const x = side * TRACK_X;
    belt.push([TRACK_W, BELT, END_Z * 2, x, BELT / 2, 0, kit.track]);
    belt.push([TRACK_W, BELT, END_Z * 2, x, LOOP - BELT / 2, 0, kit.track]);

    // --- seven road wheels, the idler and three return rollers -------------
    //
    // **The wheels are their own COLOUR and that is the whole reason the tank
    // reads as tracked.** Built in the track's own dark grey they were
    // invisible: a wheel inside a band of the same value has no edge to see.
    // Seven a side, 70 cm apart, which leaves the two-centimetre gap between
    // tyres that the real vehicle's close-pitched wheels have — the row of
    // discs nearly touching is the single most Leopard thing about it.
    //
    // Each is the rubber rim, the pressed disc a step proud of it, a raised
    // boss and the hub cap, and **all four are rotationally symmetric on
    // purpose**: nothing here turns but the sprocket (see the header), and a
    // wheel with a spoke on it would be a wheel visibly standing still under a
    // moving tank.
    for (let i = 0; i < ROAD_WHEELS; i++) {
      const z = -WHEEL_REACH + (i * (WHEEL_REACH * 2)) / (ROAD_WHEELS - 1);
      tyres.push([ROAD_R * 2, WHEEL_W, x, HUB_Y, z, kit.track, "x"]);
      wheels.push([0.56, WHEEL_W + 0.02, x, HUB_Y, z, kit.wheel, "x"]);
      wheels.push([0.34, WHEEL_W + 0.06, x, HUB_Y, z, kit.wheel, "x"]);
      wheels.push([0.16, WHEEL_W + 0.1, x, HUB_Y, z, kit.stow, "x"]);
    }
    // The idler closes the front of the loop. Loop-sized, and 2 cm under it so
    // the disc never dips below the face the hull stands on; all metal, so no
    // rim — a dished face and a hub.
    wheels.push([END_R * 2 - 0.02, WHEEL_W, x, HUB_Y, END_Z, kit.wheel, "x"]);
    wheels.push([0.72, WHEEL_W + 0.04, x, HUB_Y, END_Z, kit.wheel, "x"]);
    wheels.push([0.26, WHEEL_W + 0.1, x, HUB_Y, END_Z, kit.stow, "x"]);
    // Return rollers under the top run, in the gaps between wheel tops — the
    // band has to be carried on SOMETHING, and from the front, under the
    // skirts, these are what it visibly rides on.
    for (const z of RETURN_ROLLERS) {
      wheels.push([0.2, 0.26, side * (TRACK_X - 0.14), LOOP - BELT - 0.1, z, kit.wheel, "x"]);
    }
  }
  segment("tank-belt", hull, belt, tyres);
  segment("tank-wheel", hull, [], wheels);

  // --- the parts that run: two link strips a side, and the sprocket ---------
  const tracks = [] as unknown as [TrackSide, TrackSide];
  for (const side of [-1, 1]) {
    const x = side * TRACK_X;
    // One link past each end of the run, so the strip can be slid a whole
    // pitch and still have a link where the belt ends. See the header. A link
    // is a SHOE and the two END CONNECTORS clamping it to its neighbours, which
    // stand a little proud at either edge: the connectors are what make a
    // track read as a chain of parts rather than a corrugated strip.
    // The connectors sit BETWEEN shoes, so the strip still ends on a shoe and
    // overshoots its run by no more than it always did.
    const links: Box[] = [];
    for (let z = -END_Z - LINK_PITCH; z <= END_Z + LINK_PITCH; z += LINK_PITCH) {
      links.push([TRACK_W - 0.08, BELT + 0.05, 0.15, 0, 0, z, kit.link]);
      if (z <= -END_Z - LINK_PITCH / 2) continue;
      for (const e of [-1, 1]) {
        links.push([0.07, BELT + 0.1, 0.075, e * (TRACK_W / 2 - 0.005), 0, z - LINK_PITCH / 2, kit.link]);
      }
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
    // simply turn. Two toothed rings with the track's guide horns running
    // between them, a hub, and five raised SPOKES on its face — the teeth say
    // it is turning where they show under the skirt, and the spokes say so in
    // the one place a skirt never covers.
    const sprocket = new TransformNode("tank-sprocket", scene);
    sprocket.parent = hull;
    sprocket.position.set(x, HUB_Y, -END_Z);
    const teeth: Box[] = [];
    for (const ring of [-0.2, 0.2]) {
      for (let i = 0; i < 11; i++) {
        const a = (i / 11) * Math.PI * 2;
        // A box's local +Y turned by `rotX = a` points along (0, cos a, sin a),
        // which is the radius it is standing on — so the tooth stands out of
        // the rim rather than lying across it.
        teeth.push([0.16, 0.2, 0.14, ring, Math.cos(a) * 0.4, Math.sin(a) * 0.4, kit.wheel, a]);
      }
    }
    for (const face of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        teeth.push([0.04, 0.1, 0.07, face * (WHEEL_W / 2 + 0.015), Math.cos(a) * 0.2, Math.sin(a) * 0.2, kit.wheel, a]);
      }
    }
    segment("tank-sprocket", sprocket, teeth, [
      [0.72, 0.18, -0.2, 0, 0, kit.wheel, "x"],
      [0.72, 0.18, 0.2, 0, 0, kit.wheel, "x"],
      [0.5, WHEEL_W, 0, 0, 0, kit.wheel, "x"],
      [0.3, WHEEL_W + 0.06, 0, 0, 0, kit.wheel, "x"],
    ]);
    tracks.push({ lower, upper, sprocket });
  }

  // ==========================================================================
  // THE HULL — on `sprung`, one segment: every colour on it is one mesh.
  // ==========================================================================
  //
  // The hull's top, and therefore where the turret ring sits. Derived from the
  // collider's own height rather than authored, so that raising the box raises
  // the vehicle drawn inside it: what is left above this is the 0.95 m the
  // ring and the turret need to reach the top of the box exactly.
  const deckY = H - 0.95;
  /** The nose and the tail plate stand at the collider's own ends. */
  const NOSE = L / 2;
  const TAIL = -NOSE + 0.04;
  /** The underside of the upper hull, which overhangs both tracks. */
  const SPONSON = LOOP + 0.02;
  // The upper glacis: long and SHALLOW, running from the driver's position
  // down to a short nose — the reverse of the steep plate a WWII hull has, and
  // half of why the first version read as one.
  const GLACIS_Z = 2.1;
  const GLACIS_LO = 1.42;
  const GLACIS_SLOPE = (deckY - GLACIS_LO) / (NOSE - 0.14 - GLACIS_Z);
  const GLACIS_RAKE = Math.atan(GLACIS_SLOPE);
  /** The glacis surface's height at `z`, for the parts that lie on it. */
  const glacisY = (z: number): number => deckY - (z - GLACIS_Z) * GLACIS_SLOPE;

  const body: Box[] = [];
  const bodyCyls: Cyl[] = [];
  const bodyShapes: Shape[] = [];

  // **The hull is two PROFILES extruded, not boxes stacked**, and that is the
  // fix for the staircase nose the box version needed: a box cannot have a
  // corner taken off it, so the glacis was a thick plate overlapping a step
  // and the tail another. The upper hull is full width and overhangs both
  // tracks in one unbroken side; nothing of it reaches below `LOOP`, where
  // the tracks are, and armour through a road wheel is worse than any hole.
  bodyShapes.push(
    slab(
      [
        [TAIL + 0.08, SPONSON],
        [NOSE - 0.26, SPONSON],
        [NOSE, 1.2],
        [NOSE, 1.34],
        [NOSE - 0.14, GLACIS_LO],
        [GLACIS_Z, deckY],
        [TAIL + 0.12, deckY],
        [TAIL, deckY - 0.09],
        [TAIL, SPONSON + 0.08],
      ],
      W,
      0.03,
      0,
      kit.armor,
    ),
  );
  // The tub, between the tracks and down to the belly, with the steep LOWER
  // front plate the idlers stand either side of. Its floor is `BELLY` and not
  // a drawing choice — see there.
  bodyShapes.push(
    slab(
      [
        [-3.2, BELLY],
        [2.75, BELLY],
        [3.36, SPONSON + 0.02],
        [TAIL + 0.06, SPONSON + 0.02],
        [TAIL + 0.06, 0.62],
      ],
      W - TRACK_W * 2 - 0.12,
      0.02,
      0,
      kit.armor,
    ),
  );

  for (const side of [-1, 1]) {
    // The fender the skirts hang from, stopping at the skirts' inner face.
    body.push([0.83, 0.12, L - 0.5, side * 1.315, LOOP + 0.06, 0, kit.armor]);
    // The front mudguard, angled down over the idler as the real one pivots.
    body.push([0.78, 0.04, 0.38, side * 1.34, 0.99, NOSE - 0.16, kit.armor, 0.35]);
    // The rear mudflap: rubber, and hung clear behind the sprocket.
    body.push([0.74, 0.3, 0.03, side * TRACK_X, 0.91, -3.52, kit.track]);
  }

  // --- the SKIRTS: what a modern tank's flank IS -----------------------------
  //
  // **They replace the flank bins, and they do the bins' job better.** Six
  // metres of unbroken plate down each side read as a shipping container, and
  // the bins were what broke it up; a modern MBT's flank is broken up by its
  // skirts instead — three thick bolted ARMOUR panels at the front, where
  // the hull is shot at, and five thin ones behind. They hang outboard of the
  // wheels' hubs and stop above them, so everything that says "tracked" — the
  // row of discs, the running links, the sprocket's teeth — is still in view
  // below. What they cost is the eight centimetres of width the collider does
  // not have, the same kind of overhang the bins had.
  //
  // **They are a TAPERED band and not a rectangle, and they stop well short of
  // the deck.** Run full height and square-ended they were a second hull
  // standing in front of the first: the upper hull's side, its raked nose and
  // its chamfered tail — the shape of the vehicle — were all behind a
  // six-metre board. So a band of the hull's own side shows above them, their
  // two ends are raked back as the nose and the tail are, and their foot rises
  // toward both ends as the track does over the idler and the sprocket, which
  // is what puts the running gear's curve back into the silhouette.
  const SKIRT_X = 1.735;
  const SKIRT_TOP = 1.5;
  /** Where a skirt's lower edge stands at `z`: level amidships, rising at each end. */
  const skirtFoot = (z: number): number =>
    z > 2.2 ? 0.74 + ((z - 2.2) / 1.1) * 0.3 : z < -2.4 ? 0.74 + ((-2.4 - z) / 1.0) * 0.22 : 0.74;
  /** One panel from `z0` to `z1`: its top, then its foot, walked through each bend. */
  const skirt = (
    side: number,
    z0: number,
    z1: number,
    thick: number,
    top: number,
    zTop0 = z0,
    zTop1 = z1,
  ): void => {
    const foot = [z1, ...[2.2, -2.4].filter((b) => b < z1 && b > z0), z0].map(
      (z): ProfilePoint => [z, skirtFoot(z)],
    );
    const p: ProfilePoint[] = [[zTop0, top], [zTop1, top], ...foot];
    // A heavy plate gets a heavy chamfer: its lit rim is what says thick.
    bodyShapes.push(slab(p, thick, thick > 0.06 ? 0.03 : 0.012, side * (SKIRT_X + thick / 2), kit.armor));
  };
  const HEAVY = 0.09;
  const LIGHT = 0.045;
  for (const side of [-1, 1]) {
    // The front panel's leading edge is raked back like the nose above it —
    // 16 cm over its height — and ends short of the nose, so the hull's own
    // chamfered corner is what stands furthest forward.
    const heavy: [number, number][] = [[2.75, 3.2], [2.03, 2.73], [1.31, 2.01]];
    heavy.forEach(([z0, z1], i) => {
      skirt(side, z0, z1, HEAVY, SKIRT_TOP, z0, i === 0 ? z1 + 0.16 : z1);
      // Bolt heads, which are what say a panel is ARMOUR rather than sheet.
      for (const z of [z0 + 0.12, z1 - 0.14]) {
        for (const y of [skirtFoot(z) + 0.13, SKIRT_TOP - 0.12]) {
          bodyCyls.push([0.07, HEAVY + 0.03, side * (SKIRT_X + HEAVY / 2), y, z, kit.armor, "x"]);
        }
      }
    });
    // The light panels, 2 cm apart so the ink finds every joint, and a step
    // shallower than the heavy ones so the change of panel reads from the
    // side as the change of armour it is. The last is raked like the tail.
    const n = 5;
    const z0 = -3.3;
    const len = (1.29 - z0 - (n - 1) * 0.02) / n;
    for (let i = 0; i < n; i++) {
      const a = z0 + i * (len + 0.02);
      skirt(side, a, a + len, LIGHT, SKIRT_TOP - 0.03, i === 0 ? a - 0.14 : a, a + len);
    }
    // The rail they hang from, along the top of all eight.
    body.push([0.07, 0.04, 6.66, side * (SKIRT_X + 0.03), SKIRT_TOP + 0.02, -0.05, kit.armor]);
  }

  // --- the front: glacis, lights, spare shoes, tow eyes ----------------------
  //
  // The driver's hatch, flat on the roof at the head of the glacis. Flat,
  // because it is inside the turret's sweep: everything drawn above the deck
  // within reach of the ring is something a traversing turret drives through,
  // and the turret's underside is 11 cm above the deck.
  bodyCyls.push([0.62, 0.05, 0.72, deckY + 0.025, 1.78, kit.armor, "y"]);
  body.push([0.2, 0.06, 0.12, 0.72, deckY + 0.03, 1.42, kit.armor]);
  // His three periscopes, lying on the glacis just ahead of it.
  for (const [dx, ry] of [[-0.19, -0.3], [0, 0], [0.19, 0.3]] as const) {
    body.push([0.16, 0.08, 0.1, 0.72 + dx, glacisY(2.22) + 0.03, 2.22, kit.track, GLACIS_RAKE, ry]);
  }
  // The fuel fillers on the left of the front deck.
  for (const z of [1.55, 1.85]) bodyCyls.push([0.16, 0.03, -0.9, deckY + 0.015, z, kit.stow, "y"]);
  // A row of spare track SHOES along the nose, where crews carry them — a
  // band of dark, jointed pads across the front that is the most legible
  // single piece of kit on a Leopard's face.
  for (let i = 0; i < 8; i++) {
    const x = -0.91 + i * 0.26;
    const z = NOSE - 0.36;
    body.push([0.2, 0.07, 0.3, x, glacisY(z) + 0.04, z, kit.track, GLACIS_RAKE]);
    if (i < 7) body.push([0.06, 0.09, 0.1, x + 0.13, glacisY(z) + 0.04, z, kit.stow, GLACIS_RAKE]);
  }
  for (const side of [-1, 1]) {
    const x = side * 1.3;
    // Headlights in round housings at the corners of the nose, each behind a
    // brush guard. Housings and not lenses: nothing on this model may be
    // emissive — see the header — so the glass is the dark colour.
    bodyCyls.push([0.2, 0.18, x, 1.57, NOSE - 0.24, kit.stow, "z"]);
    bodyCyls.push([0.14, 0.02, x, 1.57, NOSE - 0.145, kit.track, "z"]);
    body.push([0.08, 0.1, 0.12, x, 1.47, NOSE - 0.2, kit.stow]);
    body.push([0.1, 0.08, 0.06, side * 1.1, glacisY(NOSE - 0.2) + 0.06, NOSE - 0.2, kit.stow, GLACIS_RAKE]);
    for (const e of [-1, 1]) {
      bodyShapes.push(rod([x + e * 0.14, 1.47, NOSE - 0.32], [x + e * 0.14, 1.72, NOSE - 0.1], 0.03, kit.armor, 6));
    }
    bodyShapes.push(rod([x - 0.15, 1.72, NOSE - 0.1], [x + 0.15, 1.72, NOSE - 0.1], 0.03, kit.armor, 6));
    // Towing eyes on the lower front plate, a shackle pin through each.
    body.push([0.16, 0.22, 0.2, side * 0.62, 0.78, 3.18, kit.stow]);
    bodyShapes.push(rod([side * 0.62 - 0.1, 0.74, 3.3], [side * 0.62 + 0.1, 0.74, 3.3], 0.05, kit.track, 6));
    // Lifting eyes at the corners of the deck.
    body.push([0.05, 0.1, 0.14, side * 1.5, deckY + 0.05, GLACIS_Z - 0.2, kit.armor]);
    body.push([0.05, 0.1, 0.14, side * 1.5, deckY + 0.05, -2.7, kit.armor]);
  }

  // --- the engine deck and the tail ----------------------------------------
  //
  // Everything here is under the bustle's sweep as well — its underside
  // stands 26 cm over the deck — so the deck is drawn as grilles and panels a
  // few centimetres deep, and what gives it relief is VALUE: a dark grille
  // under pale slats.
  for (const side of [-1, 1]) {
    const x = side * 0.8;
    // The two air intakes, side by side over the engine.
    body.push([1.25, 0.02, 0.7, x, deckY + 0.01, -3.02, kit.track]);
    for (let i = 0; i < 6; i++) {
      body.push([1.15, 0.03, 0.05, x, deckY + 0.035, -3.3 + i * 0.11, kit.armor]);
    }
    // The access panels ahead of them, hinged along their leading edge.
    body.push([1.3, 0.02, 0.62, x, deckY + 0.01, -2.3, kit.armor]);
    bodyShapes.push(rod([x - 0.55, deckY + 0.03, -1.98], [x + 0.55, deckY + 0.03, -1.98], 0.04, kit.track, 6));
    // Fuel fillers at the back corners.
    bodyCyls.push([0.18, 0.04, side * 1.45, deckY + 0.02, -3.3, kit.stow, "y"]);

    // The tail plate: two exhaust grilles, louvred, the tail lights, and the
    // tow hooks on the lower plate under them.
    body.push([1.0, 0.5, 0.04, x, 1.47, TAIL - 0.015, kit.track]);
    for (let i = 0; i < 5; i++) {
      body.push([0.94, 0.04, 0.07, x, 1.29 + i * 0.09, TAIL - 0.04, kit.armor, -0.5]);
    }
    body.push([0.16, 0.12, 0.05, side * 1.45, 1.78, TAIL - 0.02, kit.stow]);
    body.push([0.1, 0.06, 0.01, side * 1.45, 1.78, TAIL - 0.05, kit.track]);
    body.push([0.2, 0.22, 0.18, side * 0.7, 0.86, TAIL + 0.03, kit.stow]);
  }
  // The tow cable, stowed across the tail under the grilles on three clips.
  bodyShapes.push(rod([-1.35, 1.16, TAIL - 0.045], [1.35, 1.16, TAIL - 0.045], 0.06, kit.track, 6));
  for (const x of [-0.95, 0, 0.95]) body.push([0.06, 0.1, 0.06, x, 1.16, TAIL - 0.03, kit.stow]);

  // --- the friend/foe marking ------------------------------------------------
  //
  // A PATCH and not a panel: at 0.42 m tall and six metres down each flank the
  // team colour was most of the vehicle from the side — a school bus, not a
  // marking — and the read a marking needs is "some of it faces every
  // direction", not "as much of it as will fit". See `TankKit`. On the flank
  // it rides a light skirt panel, and at the front it is the tactical sign
  // plates on the mudguards, which is where a real one carries its unit.
  for (const side of [-1, 1]) {
    body.push([0.03, 0.36, 0.6, side * (SKIRT_X + LIGHT + 0.012), 1.11, -2.0, kit.accent]);
    body.push([0.3, 0.16, 0.02, side * 1.34, 1.02, NOSE + 0.03, kit.accent]);
  }
  body.push([0.44, 0.34, 0.03, 0, 1.47, TAIL - 0.015, kit.accent]);

  segment("tank-body", sprung, body, bodyCyls, bodyShapes);

  // ==========================================================================
  // THE TURRET — traverses on the deck, a little behind centre.
  // ==========================================================================
  const turret = new TransformNode("tank-turret", scene);
  turret.parent = sprung;
  turret.position.set(0, deckY + 0.06, -0.3);
  /** Where the commander stands, in the turret's own frame. */
  const cupolaY = t.cupolaHeight - (deckY + 0.06);
  /** The roof, in the turret's frame: the top of the collider box exactly. */
  const ROOF = H - (deckY + 0.06);

  const tur: Box[] = [];
  const turCyls: Cyl[] = [];
  const turShapes: Shape[] = [];

  // The ring, then the turret itself: FLAT SIDES and a flat roof, a long
  // bustle whose underside steps up clear of the engine deck, and every long
  // edge chamfered so the lit roof has a rim. A profile rather than boxes for
  // the reason the hull is one — the bustle's undercut is a shape, and a box
  // under a box is two things.
  turCyls.push([2.36, 0.12, 0, 0, 0, kit.track, "y"]);
  turShapes.push(
    slab(
      [
        [0.95, 0.05],
        [0.95, ROOF],
        [-2.2, ROOF],
        [-2.36, ROOF - 0.11],
        [-2.36, 0.3],
        [-2.1, 0.2],
        [-1.35, 0.2],
        [-1.2, 0.05],
      ],
      TURRET_W,
      0.035,
      0,
      kit.armor,
    ),
  );

  // **The wedge: the one shape nobody mistakes for any other tank.** Spaced
  // armour bolted over the turret face as two halves of an arrowhead, each a
  // solid whose top falls away and whose outer face turns in toward the gun,
  // leaving the mantlet in a deep slot between them. The cheeks the box
  // version turned in with `rotY` were the right instinct and the wrong
  // primitive: a box cannot slope two ways at once.
  for (const s of [-1, 1]) {
    turShapes.push(
      solid(
        [
          [s * 0.42, 0.05, 0.95],
          [s * 1.33, 0.05, 0.95],
          [s * 1.33, ROOF, 0.95],
          [s * 0.42, ROOF, 0.95],
        ],
        [
          [s * 0.42, 0.33, 2.02],
          [s * 0.64, 0.33, 2.02],
          [s * 0.64, 0.58, 2.02],
          [s * 0.42, 0.58, 2.02],
        ],
        kit.armor,
      ),
    );
    // A row of bolt heads down the wedge's outer face, standing off it along
    // the face's own normal.
    const nx = 1.07 / Math.hypot(1.07, 0.69);
    const nz = 0.69 / Math.hypot(1.07, 0.69);
    for (const f of [0.25, 0.5, 0.75]) {
      const px = s * (1.33 - 0.69 * f);
      const pz = 0.95 + 1.07 * f;
      for (const y of [0.3 + 0.1 * f, 0.62 - 0.1 * f]) {
        turShapes.push(rod([px - s * nx * 0.01, y, pz - nz * 0.01], [px + s * nx * 0.02, y, pz + nz * 0.02], 0.06, kit.armor, 6));
      }
    }
    // The add-on side armour over the crew compartment, a plate 5 cm proud of
    // the turret side and bolted on — the vertical joint where it stops is
    // the panel line every photograph of one shows.
    turShapes.push(
      slab([[-0.35, 0.1], [0.95, 0.1], [0.95, ROOF - 0.04], [-0.35, ROOF - 0.04]], 0.05, 0.012, s * (TURRET_W / 2 + 0.025), kit.armor),
    );
    for (const z of [-0.2, 0.3, 0.8]) {
      for (const y of [0.22, 0.73]) turCyls.push([0.05, 0.02, s * 1.335, y, z, kit.armor, "x"]);
    }
    // Four smoke dischargers a side on a bracket towards the rear, fired
    // forward, up and out — each a tube with its dark bore at the mouth.
    tur.push([0.1, 0.16, 0.66, s * 1.33, 0.66, -1.55, kit.stow]);
    for (let i = 0; i < 4; i++) {
      const base: Point3 = [s * 1.37, 0.66, -1.8 + i * 0.17];
      const dir: Point3 = [s * 0.35, 0.55, 0.76];
      const end: Point3 = [base[0] + dir[0] * 0.28, base[1] + dir[1] * 0.28, base[2] + dir[2] * 0.28];
      turShapes.push(rod(base, end, 0.1, kit.stow));
      turShapes.push(rod(end, [end[0] + dir[0] * 0.006, end[1] + dir[1] * 0.006, end[2] + dir[2] * 0.006], 0.075, kit.track));
    }
    // A grab handle on stand-offs above the marking.
    turShapes.push(rod([s * 1.33, 0.8, -1.15], [s * 1.33, 0.8, -0.55], 0.03, kit.armor, 6));
    for (const z of [-1.1, -0.6]) turShapes.push(rod([s * 1.28, 0.8, z], [s * 1.34, 0.8, z], 0.03, kit.armor, 6));
    // Lifting eyes at the four corners of the roof.
    tur.push([0.05, 0.09, 0.14, s * 1.12, ROOF + 0.045, 0.62, kit.armor]);
    tur.push([0.05, 0.09, 0.14, s * 1.12, ROOF + 0.045, -2.1, kit.armor]);
  }

  // --- the roof --------------------------------------------------------------
  //
  // The LOADER's hatch on the left, ringed for his machine gun — which is the
  // commander's gun in this game's terms, laid by the second man. `cupolaHeight`
  // is measured from the tracks, so this sits at whatever is left after the
  // deck and the ring, and the mount above it hangs off the same number.
  turCyls.push([0.86, 0.42, -0.62, cupolaY, 0.15, kit.armor, "y"]);
  turCyls.push([0.78, 0.1, -0.62, cupolaY + 0.26, 0.15, kit.armor, "y"]);
  tur.push([0.16, 0.08, 0.1, -0.62, ROOF + 0.04, 0.64, kit.track]);
  // The COMMANDER's cupola on the right: a low ring of eight vision blocks
  // under a flat hatch.
  const CX = 0.62;
  const CZ = -0.62;
  turCyls.push([0.8, 0.18, CX, ROOF + 0.09, CZ, kit.armor, "y"]);
  turCyls.push([0.62, 0.07, CX, ROOF + 0.215, CZ, kit.armor, "y"]);
  tur.push([0.18, 0.08, 0.12, CX, ROOF + 0.2, CZ - 0.36, kit.armor]);
  for (let k = 0; k < 8; k++) {
    const a = ((k + 0.5) / 8) * Math.PI * 2;
    tur.push([0.14, 0.08, 0.05, CX + Math.sin(a) * 0.4, ROOF + 0.11, CZ + Math.cos(a) * 0.4, kit.track, 0, a]);
  }
  // His panoramic sight: a head on a pedestal, window forward, standing
  // clear of the machine gun's whole sweep.
  turCyls.push([0.3, 0.26, 1.0, ROOF + 0.13, 0.0, kit.armor, "y"]);
  turShapes.push(
    slab(
      [[-0.22, ROOF + 0.26], [0.2, ROOF + 0.26], [0.24, ROOF + 0.36], [0.2, ROOF + 0.52], [-0.22, ROOF + 0.56]],
      0.36,
      0.02,
      1.0,
      kit.armor,
    ),
  );
  tur.push([0.26, 0.12, 0.03, 1.0, ROOF + 0.44, 0.222, kit.track, -0.245]);
  // The GUNNER's sight in its doghouse at the front of the roof, window to
  // the front and an armoured lid over it.
  turShapes.push(
    slab(
      [[0.28, ROOF - 0.02], [0.93, ROOF - 0.02], [0.93, ROOF + 0.12], [0.82, ROOF + 0.25], [0.28, ROOF + 0.25]],
      0.46,
      0.02,
      0.76,
      kit.armor,
    ),
  );
  tur.push([0.3, 0.1, 0.02, 0.76, ROOF + 0.05, 0.935, kit.track]);
  tur.push([0.34, 0.03, 0.16, 0.76, ROOF + 0.17, 0.99, kit.armor, -0.6]);
  // The bustle roof: two blow-off panels over the ammunition, a ventilator,
  // and the crosswind sensor on its mast.
  for (const s of [-1, 1]) tur.push([0.9, 0.02, 0.62, s * 0.52, ROOF + 0.01, -1.85, kit.armor]);
  turCyls.push([0.3, 0.08, 0.15, ROOF + 0.04, -1.3, kit.armor, "y"]);
  turCyls.push([0.36, 0.03, 0.15, ROOF + 0.09, -1.3, kit.armor, "y"]);
  turShapes.push(rod([0, ROOF, -2.2], [0, ROOF + 0.36, -2.2], 0.04, kit.track, 6));
  tur.push([0.08, 0.1, 0.2, 0, ROOF + 0.4, -2.2, kit.track]);
  // The two antenna bases: a plate and a spring foot, and what bends is above
  // them — see the antennae below.
  for (const [x, z] of ANTENNA_FEET) {
    tur.push([0.18, 0.04, 0.18, x, ROOF + 0.02, z, kit.stow]);
    turCyls.push([0.1, 0.16, x, ROOF + 0.12, z, kit.stow, "y"]);
  }

  // --- the bustle basket -----------------------------------------------------
  //
  // A rack of rails round the back of the turret and a short way down each
  // side, with the crew's kit in it — the biggest thing on a modern tank that
  // is not armour, and what makes the turret's rear read as LIVED IN rather
  // than as the back of a block. Its floor is 28 cm up the turret, so it
  // sweeps over the engine deck with room to spare.
  const BASKET: [number, number][] = [
    [1.28, -1.95], [1.58, -1.95], [1.58, -2.52], [1.26, -2.82],
    [-1.26, -2.82], [-1.58, -2.52], [-1.58, -1.95], [-1.28, -1.95],
  ];
  for (let i = 0; i + 1 < BASKET.length; i++) {
    const [ax, az] = BASKET[i];
    const [bx, bz] = BASKET[i + 1];
    for (const y of [0.3, 0.55, 0.8]) turShapes.push(rod([ax, y, az], [bx, y, bz], 0.035, kit.track, 6));
  }
  for (const [x, z] of [...BASKET, [-0.63, -2.82], [0, -2.82], [0.63, -2.82]] as [number, number][]) {
    turShapes.push(rod([x, 0.28, z], [x, 0.82, z], 0.035, kit.track, 6));
  }
  tur.push([2.52, 0.03, 0.46, 0, 0.285, -2.59, kit.track]);
  for (const s of [-1, 1]) {
    tur.push([0.3, 0.03, 0.57, s * 1.43, 0.285, -2.235, kit.track]);
    tur.push([0.26, 0.34, 0.44, s * 1.43, 0.47, -2.22, kit.stow, 0, s * 0.05]);
  }
  turCyls.push([0.32, 1.0, -0.62, 0.46, -2.58, kit.stow, "x"]);
  turCyls.push([0.28, 0.6, 0.83, 0.44, -2.6, kit.stow, "x"]);
  tur.push([0.44, 0.3, 0.34, 0.2, 0.45, -2.6, kit.stow]);
  for (const x of [-0.9, -0.35]) tur.push([0.04, 0.34, 0.35, x, 0.46, -2.58, kit.track]);

  // Placed so some of the team colour faces every direction: the flanks from
  // the sides, a panel on the basket from behind, and the roof from the air.
  for (const s of [-1, 1]) tur.push([0.03, 0.2, 0.52, s * (TURRET_W / 2 + 0.015), 0.6, -0.85, kit.accent]);
  tur.push([0.8, 0.16, 0.02, 0, 0.6, -2.835, kit.accent]);
  tur.push([0.4, 0.02, 0.4, -0.38, ROOF + 0.01, -0.85, kit.accent]);

  segment("tank-turret", turret, tur, turCyls, turShapes);

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
  //
  // **Nothing else on the roof may stand in its sweep**: the gun reaches 1.1 m
  // from this axis, level with the roof items' tops, which is why the
  // commander's sight stands at the far corner of the roof rather than in
  // front of his hatch where the real one does.
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
    // shapes that make a machine gun read as one at ten metres.
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

  // **The commander's eye over the receiver, and this is the one of the three
  // that the drawing does NOT already answer.** The truck's station and the
  // gunship's chin turret both carry an optic head in pale metal — a fitting on
  // a powered mount, drawn so that the eye can find where the gun is looking —
  // and a pintle gun with spade grips has no such thing on it, because the man
  // holding it is the sight. There is no man to draw, so nothing is added here
  // either: the node stands where his head would be and no mesh comes with it.
  //
  // On the bore's own vertical plane rather than off to one side, which is what
  // the other two cannot have and this can: with no head to sit behind, the
  // only offset the picture needs is UP, and a sight with no lateral offset has
  // no lateral parallax to explain. 0.20 over the bore puts the barrel's far
  // end 15.3 deg below the sight line at 2.2x — the very bottom edge of the
  // picture, so the weapon frames the shot without standing in it.
  const mgSight = new TransformNode("tank-mg-sight", scene);
  mgSight.parent = mgGun;
  mgSight.position.set(0, 0.22, 0.3);

  // --- the antennae: the only parts of this vehicle that BEND ---------------
  //
  // Four meshes for two masts, and they are the one place this model's budget
  // rule is knowingly spent rather than obeyed. Everything else here merges by
  // colour because a mesh costs a draw call and a greeble in a colour its
  // segment already carries is free; a whip cannot merge with anything at all,
  // because the whole point of it is that it moves differently from every other
  // part — and it needs TWO of its own, because one link pivoting at its foot
  // is a lever and what a mast does is bow. What it buys is the only moving
  // part on the vehicle that reports on the DRIVE: the tracks say it is moving
  // and the masts say how hard.
  const whip = (i: number, x: number, z: number): Whip => {
    const len = ANTENNA_LENGTHS[i];
    const base = new TransformNode(`tank-whip${i}`, scene);
    base.parent = turret;
    // The spring foot on the roof is 16 cm tall and this is inside it, so the
    // pivot is inside the foot at every bend the springs can reach.
    base.position.set(x, ROOF + 0.13, z);
    const tip = new TransformNode(`tank-whip${i}-tip`, scene);
    tip.parent = base;
    tip.position.set(0, len / 2, 0);
    // Each link is drawn from its own node's origin UP, and each tapers into
    // the next: a whip is thinner at the top, and the taper is what stops two
    // straight rods reading as one straight rod with a joint in it. The cap on
    // the tip is the ball a real whip ends in, so it is not an eye-poker.
    segment(`tank-whip${i}-lo`, base, [], [
      [0.05, len / 2, 0, len / 4, 0, kit.stow, "y", 0.042],
    ]);
    segment(`tank-whip${i}-hi`, tip, [], [
      [0.042, len / 2, 0, len / 4, 0, kit.stow, "y", 0.028],
      [0.055, 0.05, 0, len / 2, 0, kit.stow, "y"],
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
  // At the two back corners of the roof, and staggered in Z as well as X: two
  // masts at the same station are a pair of goalposts.
  const antennae: readonly [Whip, Whip] = [
    whip(0, ANTENNA_FEET[0][0], ANTENNA_FEET[0][1]),
    whip(1, ANTENNA_FEET[1][0], ANTENNA_FEET[1][1]),
  ];

  // --- the gun: elevates in the mantlet, in the slot between the wedges -----
  const gun = new TransformNode("tank-gun", scene);
  gun.parent = turret;
  gun.position.set(0, 0.45, 1.25);

  /** Where the barrel ends, along the gun's own axis. */
  const BARREL_END = 0.45 + BARREL_LENGTH;
  segment("tank-gun-m", gun, [
    // The muzzle reference sensor, a small box on its stalk over the muzzle.
    [0.05, 0.04, 0.05, 0, 0.14, BARREL_END - 0.12, kit.track],
    [0.1, 0.07, 0.14, 0, 0.18, BARREL_END - 0.12, kit.track],
  ], [
    // The trunnion, hidden in the wedges' slot, and the collar the barrel
    // leaves the shield by.
    [0.5, 0.82, 0, 0, 0, kit.armor, "x"],
    [0.44, 0.32, 0, 0, 0.46, kit.armor, "z"],
    // A ROUND barrel, for the reason a square pipe on a square block is a
    // girder; and in the hull's own paint, because a modern gun wears a
    // thermal sleeve in the vehicle's colours. What says "smoothbore" is the
    // BORE EVACUATOR a metre out — a swelling, tapered both ends — and the
    // absence of any brake at the muzzle. The two dark bands are the sleeve's
    // joints, which is what stops four metres of barrel reading as a pole.
    [0.3, 0.66, 0, 0, 0.93, kit.armor, "z"],
    [0.3, 0.16, 0, 0, 1.33, kit.armor, "z", 0.42],
    [0.42, 0.6, 0, 0, 1.71, kit.armor, "z"],
    [0.42, 0.14, 0, 0, 2.08, kit.armor, "z", 0.28],
    [0.28, BARREL_END - 2.15, 0, 0, (BARREL_END + 2.15) / 2, kit.armor, "z", 0.25],
    [0.3, 0.05, 0, 0, 2.95, kit.track, "z"],
    [0.29, 0.05, 0, 0, 3.75, kit.track, "z"],
    [0.29, 0.12, 0, 0, BARREL_END - 0.06, kit.track, "z"],
    // The coaxial's port in the shield, left of the gun.
    [0.08, 0.06, -0.26, 0.05, 0.31, kit.track, "z"],
  ], [
    // The gun shield: a block with its top and bottom front edges taken off,
    // narrow enough to elevate in the slot between the wedges.
    slab([[-0.05, -0.3], [0.22, -0.3], [0.3, -0.2], [0.3, 0.2], [0.22, 0.3], [-0.05, 0.3]], 0.8, 0.02, 0, kit.armor),
  ]);

  const muzzle = new TransformNode("tank-muzzle", scene);
  muzzle.parent = gun;
  // Just past the barrel, so a flash lit here is outside it and a shell fired
  // from here starts outside the hull's own collider box.
  muzzle.position.set(0, 0, BARREL_END + 0.2);

  const rig: VehicleRig = {
    root, hull, sprung, turret, gun, muzzle,
    mgMount, mgGun, mgMuzzle, mgSight,
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
