/**
 * TruckModel.ts — The gun truck's mesh: a cab, an open bed, a ring with a
 * heavy machine gun on it, four wheels that TURN and two that STEER, and the
 * charred repaint a wreck takes.
 * Owns: the ART. Every extent in here is a drawing decision and belongs to
 * this file; the extents that are RULES — the collider box, the ring a bot
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
 * ## Fourteen meshes, and six of them move
 *
 * A tank is twenty-six because it has two belts, two masts and a cupola gun on
 * its own ring. This is the same accounting on a smaller machine: **four
 * wheels, the mount and the gun cannot merge with anything, because a mesh is
 * bought here for exactly one reason and it is never a colour — something that
 * MOVES differently from everything around it cannot merge with any of it.**
 * The other eight are one per colour per segment, exactly as over there.
 *
 * ## The wheels are the whole difference, and there are two halves to it
 *
 * A tank's running gear is a belt, which cannot be one mesh and is drawn as a
 * scrolling strip of links. A truck's is four discs, which CAN be one mesh
 * each — and a disc rotating about its own axis is famously indistinguishable
 * from a disc at rest, which is the argument that got the tank's road wheels
 * no nodes at all. So the tyre alone would be a wasted mesh, and what earns it
 * is what is drawn ON it: **a pale hub with four bolts standing proud of a
 * near-black tyre**, which is a pattern with an orientation, so its rotation
 * is legible from twelve metres back. Both are in the same mesh — a wheel is
 * one merge of two colours' worth of parts — because the hub does not move
 * against the tyre.
 *
 * The second half is the STEER, and it is the one thing this model does that
 * the tank's cannot: the front pair are hung under a yaw node each and turned
 * with the stick. A tank's steer is already visible as its two tracks running
 * opposite ways; a truck that cornered at 65 km/h with its wheels pointing
 * dead ahead is a vehicle sliding sideways. That is why `VehicleRig.setRun`
 * takes a third argument at all — see its note, and note that the tank ignores
 * it for a reason rather than by omission.
 *
 * ## What the model may not do
 *
 * The two prohibitions in `vehicleRig.ts` (nothing emissive, nothing pickable)
 * and one more this shape invites: **nothing may stand on the bed inside the
 * gun ring's sweep.** The ring turns a full circle and the gun on it reaches
 * 30 cm past its own pintle, so a jerry can or a stowage box within that
 * radius is something a traversing gun drives through. Everything on the bed
 * is against the sides or behind the tailgate, outside `RING_R + 0.4`.
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
  type VehicleRig,
  type Whip,
} from "./vehicleRig";

/**
 * What one side's truck is PAINTED in — the tank kit's three-way read with
 * the same third of it deleted, and for the same reason: a vehicle is one
 * shape whoever owns it, and what tells the sides apart is hue and a saturated
 * accent.
 *
 * **The palette is deliberately not the tank's.** A gun truck is a civilian
 * chassis with a gun bolted to it, and what says so at a glance is that it is
 * not painted like armour: the body is dusty and light rather than olive and
 * heavy, the panels are flat, and there is canvas on it. A player who cannot
 * tell the two kinds apart at range is a player who brings a rocket to the
 * wrong vehicle.
 */
interface TruckKit {
  /** The cab, the bonnet and the bed sides — most of what is seen. */
  body: string;
  /** The chassis, the bull bar, the gun ring and the gun: the dark structure. */
  frame: string;
  /** Tyres. The darkest thing on the vehicle. */
  tyre: string;
  /**
   * Wheel hubs and their bolts — several steps LIGHTER than the tyre, and that
   * contrast is load-bearing rather than decorative. It is the only thing on
   * this vehicle whose ROTATION can be read, and a hub in the tyre's own value
   * rotates invisibly. See the header.
   */
  hub: string;
  /** The cab's glazing. Drawn, not glazed: a model may not hang a `Build.pane`. */
  glass: string;
  /** Canvas, tools, jerry cans, the spare — what breaks the flat panels up. */
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
    // this read as a truck rather than as armour is the PALE canvas below and
    // the flat panels, not the body's own value.
    body: "#7b7053",
    frame: "#2b2a26",
    tyre: "#1c1b19",
    hub: "#6f6b60",
    glass: "#2f3a3c",
    stow: "#a1957a",
    accent: CONFIG.teams[0].color,
  },
  {
    body: "#5f6d79",
    frame: "#25282c",
    tyre: "#18191b",
    hub: "#616872",
    glass: "#2a3336",
    stow: "#8d97a1",
    accent: CONFIG.teams[1].color,
  },
];

// --- the running gear's frame, in the rig's coordinates ---------------------

/** Tyre radius. Everything about the ride height hangs off this. */
const WHEEL_R = 0.46;
/** How wide a tyre is. */
const WHEEL_W = 0.34;
/** Every wheel turns about this height, which is its own radius. */
const HUB_Y = WHEEL_R;
/**
 * Half the track — how far out from the centreline the wheels stand.
 *
 * The body is 2.5 wide and a tyre is 0.34, so the wheels are just proud of the
 * sides at 1.05: a truck's wheels stick out and a tank's are under its
 * sponsons, which is one of the two silhouette cues that tell the kinds apart
 * from behind (the other is the ring).
 */
const TRACK_X = 1.05;
/**
 * How far fore and aft the axles stand — the wheelbase's half-length.
 *
 * Well inside the body's own half-length (2.7), which is what leaves an
 * overhang at each end: a bonnet in front of the front wheels and a tailgate
 * behind the rear ones. A vehicle whose wheels are at its corners is a go-kart.
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

/** Where the chassis rail's top sits — the floor everything above is built on. */
const FRAME_Y = 0.62;
/** The bed's floor, a little above the rails. */
const BED_Y = 0.78;
/** The gun ring's radius. Nothing may stand on the bed inside this plus 0.4 — see the header. */
const RING_R = 0.46;
/**
 * How high the ring turns, and it is set by the CAB rather than by the bed.
 *
 * **A gun that cannot shoot over its own cab is a gun with a 180-degree arc**,
 * and the first version of this had exactly that: the ring stood half a metre
 * off the bed and the barrel swept into the back of the cab. The pedestal is
 * 1.14 m instead, which puts the trunnion at 2.18 and the barrel's tip at 1.96
 * at full DEPRESSION — one centimetre over the cab roof at 1.95, which is the
 * tightest number in this file and the one to re-derive if either the cab or
 * `mg.pitchMin` moves.
 *
 * It is also where a man would actually hold it: a gunner standing on a bed
 * floor 0.78 up has his shoulders at about 2.2.
 */
const RING_Y = BED_Y + 1.14;
/**
 * …and how far back it stands, which is set by the cab as well.
 *
 * The ring's front edge is at `RING_Z + RING_R` and the cab's rear face is at
 * -0.4, so anything forward of about -0.9 is a ring drawn inside the cab. This
 * leaves 14 cm.
 */
const RING_Z = -1.05;
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
  const W = t.hull.width;

  const root = new TransformNode("truck", scene);
  const hull = new TransformNode("truck-hull", scene);
  hull.parent = root;
  // Everything the springs carry, which is everything except the wheels.
  // See `VehicleRig.sprung`.
  const sprung = new TransformNode("truck-sprung", scene);
  sprung.parent = hull;

  const { meshes, livery, segment } = segmentOf(scene, mats);

  // --- the wheels: four discs with a pattern on them ------------------------
  //
  // Each is its own mesh because it moves differently from everything around
  // it, and each is TWO colours in one merge — a near-black tyre and a pale
  // hub with four bolts, which is what makes the rotation legible. See the
  // header on why the tank's road wheels get none of this.
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
    segment(
      `truck-wheel${i}-m`,
      spin,
      [
        // The four bolts. Boxes rather than cylinders because at 6 cm the
        // facets are not a thing an eye can find, and a box merges into the
        // same mesh the hub does.
        [0.06, 0.06, 0.16, sign * (WHEEL_W / 2 - 0.02), 0, 0.17, kit.hub],
        [0.06, 0.06, 0.16, sign * (WHEEL_W / 2 - 0.02), 0, -0.17, kit.hub],
        [0.06, 0.16, 0.06, sign * (WHEEL_W / 2 - 0.02), 0.17, 0, kit.hub],
        [0.06, 0.16, 0.06, sign * (WHEEL_W / 2 - 0.02), -0.17, 0, kit.hub],
      ],
      [
        [WHEEL_R * 2, WHEEL_W, 0, 0, 0, kit.tyre, "x"],
        // The rim, proud of the tyre on the outboard face only — the inboard
        // one is never seen and a disc there is a mesh paying for nothing.
        [WHEEL_R * 1.15, 0.08, sign * (WHEEL_W / 2 - 0.03), 0, 0, kit.hub, "x"],
      ],
    );
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

  // --- the chassis: two rails and the axles between them --------------------
  //
  // On `hull` rather than `sprung`, because a ladder frame is what the springs
  // push AGAINST — it is not much of a distinction on a vehicle this size, but
  // it is what stops the axles rising with the body when it settles.
  segment("truck-frame", hull, [
    [0.16, 0.2, L - 0.9, -0.72, FRAME_Y - 0.12, 0, kit.frame],
    [0.16, 0.2, L - 0.9, 0.72, FRAME_Y - 0.12, 0, kit.frame],
    // The two axle beams, which are what make the gap under the body read as
    // ground clearance rather than as a body floating over four discs.
    [TRACK_X * 2, 0.16, 0.2, 0, HUB_Y, AXLE_Z, kit.frame],
    [TRACK_X * 2, 0.18, 0.24, 0, HUB_Y, -AXLE_Z, kit.frame],
    // The differential on the rear axle: one lump off the centreline, which is
    // the cue that says "live axle" and costs nothing, being the frame's own
    // colour.
    [0.34, 0.32, 0.34, 0.12, HUB_Y, -AXLE_Z, kit.frame],
  ]);

  // --- the nose: a bonnet, a bull bar and the lights ------------------------
  segment("truck-nose", sprung, [
    // The bonnet, sloping very slightly down toward the grille. `rotX` rather
    // than a stack of boxes: this is the one panel on the vehicle whose angle
    // is read against the windscreen behind it, and two parallel flat plates
    // are a shipping container.
    [W - 0.24, 0.42, 1.5, 0, FRAME_Y + 0.5, 1.72, kit.body, -0.05],
    // The wings over the front wheels, which is what a bonnet 24 cm narrower
    // than the body leaves room for.
    [0.3, 0.24, 1.24, -(W / 2 - 0.15), FRAME_Y + 0.56, 1.7, kit.body],
    [0.3, 0.24, 1.24, W / 2 - 0.15, FRAME_Y + 0.56, 1.7, kit.body],
    // The grille and the bull bar in front of it. The bar stands proud of the
    // nose by 12 cm, which is inside the collider — nothing here may reach
    // past `L / 2`.
    [W - 0.5, 0.44, 0.14, 0, FRAME_Y + 0.34, L / 2 - 0.24, kit.frame],
    [W - 0.3, 0.1, 0.12, 0, FRAME_Y + 0.56, L / 2 - 0.1, kit.frame],
    [W - 0.3, 0.1, 0.12, 0, FRAME_Y + 0.1, L / 2 - 0.1, kit.frame],
    [0.1, 0.56, 0.12, -(W / 2 - 0.35), FRAME_Y + 0.33, L / 2 - 0.1, kit.frame],
    [0.1, 0.56, 0.12, W / 2 - 0.35, FRAME_Y + 0.33, L / 2 - 0.1, kit.frame],
    // The headlights. BOXES and not lamps — nothing on a vehicle may be
    // emissive, because `Game`'s GlowLayer scan is construction-time and a
    // hull is built per round.
    [0.22, 0.18, 0.08, -(W / 2 - 0.42), FRAME_Y + 0.6, L / 2 - 0.3, kit.glass],
    [0.22, 0.18, 0.08, W / 2 - 0.42, FRAME_Y + 0.6, L / 2 - 0.3, kit.glass],
  ]);

  // --- the cab: a box with glass in it, and the team's colour on its door ---
  segment("truck-cab", sprung, [
    // The tub, open at the top — three walls and a roof, drawn as slabs
    // because a cab IS a box and the shape that keeps it from reading as a
    // crate is the glass in it rather than a facet on it.
    [W - 0.14, 1.05, 1.36, 0, FRAME_Y + 0.72, 0.28, kit.body],
    // The roof, overhanging the windscreen a little.
    [W - 0.2, 0.1, 1.5, 0, FRAME_Y + 1.28, 0.34, kit.body],
    // The A-pillars and the roof's front rail, which is what the windscreen
    // sits inside rather than on.
    [0.12, 0.52, 0.12, -(W / 2 - 0.16), FRAME_Y + 1, 0.94, kit.body],
    [0.12, 0.52, 0.12, W / 2 - 0.16, FRAME_Y + 1, 0.94, kit.body],
    // The doors' team flash — a panel each side, which is `CONFIG.teams`'
    // colour and is placed so some of it faces every direction. The same
    // three-way read `SoldierModel`'s kits make, minus the silhouette.
    [0.04, 0.3, 0.66, -(W / 2 - 0.05), FRAME_Y + 0.74, 0.24, kit.accent],
    [0.04, 0.3, 0.66, W / 2 - 0.05, FRAME_Y + 0.74, 0.24, kit.accent],
    // …one across the tailgate and one across the nose, so the accent faces
    // every direction. A marking that only reads from the flank is no marking
    // at all on a vehicle that is mostly seen coming or going — which is the
    // same three-way rule `CONFIG.teams[].color` is written under.
    [W - 0.5, 0.16, 0.05, 0, BED_Y + 0.42, -(L / 2 - 0.08), kit.accent],
    [W - 0.9, 0.1, 0.06, 0, FRAME_Y + 0.71, L / 2 - 0.44, kit.accent, -0.05],
  ], [
    // The exhaust stack up the back of the cab, which is the one part of this
    // silhouette that says TRUCK from any angle at all.
    [0.11, 1.5, W / 2 - 0.22, FRAME_Y + 1.1, -0.3, kit.frame, "y", 0.09],
  ]);

  segment("truck-glass", sprung, [
    // The windscreen, raked back. Drawn and opaque: the world's only
    // see-through glass is `getGlass` over a baked probe or a `Build.pane`,
    // and a model may hang neither.
    [W - 0.44, 0.56, 0.08, 0, FRAME_Y + 1.02, 0.96, kit.glass, -0.34],
    // The side windows, sunk into the doors.
    [0.05, 0.42, 0.64, -(W / 2 - 0.09), FRAME_Y + 1.04, 0.24, kit.glass],
    [0.05, 0.42, 0.64, W / 2 - 0.09, FRAME_Y + 1.04, 0.24, kit.glass],
    // The rear window, which is what makes the cab read as a cab from behind
    // rather than as the front of the bed.
    [W - 0.6, 0.34, 0.06, 0, FRAME_Y + 1.02, -0.38, kit.glass],
  ]);

  // --- the bed: a floor, four sides and what is lashed to them --------------
  segment("truck-bed", sprung, [
    [W - 0.14, 0.1, 2.5, 0, BED_Y, -1.15, kit.body],
    // The sides and the tailgate. Low enough that a gunner standing in the
    // ring is visible over them, which matters: a second man aboard who cannot
    // be seen is a vehicle that reads as empty.
    [0.1, 0.5, 2.5, -(W / 2 - 0.07), BED_Y + 0.3, -1.15, kit.body],
    [0.1, 0.5, 2.5, W / 2 - 0.07, BED_Y + 0.3, -1.15, kit.body],
    [W - 0.14, 0.5, 0.1, 0, BED_Y + 0.3, -(L / 2 - 0.1), kit.body],
    // The wings over the rear wheels, matching the front pair.
    [0.3, 0.22, 1.3, -(W / 2 - 0.15), BED_Y + 0.02, -AXLE_Z, kit.body],
    [0.3, 0.22, 1.3, W / 2 - 0.15, BED_Y + 0.02, -AXLE_Z, kit.body],
  ]);

  // Stowage, all of it OUTSIDE the ring's sweep — see the header. Against the
  // sides and behind the tailgate, which is also where it is on a real one.
  segment("truck-stow", sprung, [
    // Two ammunition boxes wedged against the near side, which is what feeds
    // the gun and is the one greeble that explains the vehicle.
    [0.34, 0.26, 0.5, -(W / 2 - 0.32), BED_Y + 0.18, -1.5, kit.stow],
    [0.34, 0.26, 0.44, -(W / 2 - 0.32), BED_Y + 0.18, -1.98, kit.stow],
    // A rolled tarpaulin along the far side.
    [0.3, 0.28, 1.5, W / 2 - 0.3, BED_Y + 0.2, -1.6, kit.stow],
    // A tool box on the flank, under the bed line.
    [0.22, 0.3, 0.7, -(W / 2 - 0.02), BED_Y - 0.18, -0.5, kit.stow],
  ], [
    // The spare wheel, flat against the tailgate. A cylinder in the stow
    // colour rather than the tyre's, because it merges here for free and a
    // spare is canvas-wrapped on most of the vehicles this is drawn from.
    [WHEEL_R * 1.8, 0.2, 0.62, BED_Y + 0.36, -(L / 2 - 0.2), kit.stow, "z"],
    // Two jerry cans on the far side, behind the tarpaulin.
    [0.3, 0.44, W / 2 - 0.34, BED_Y + 0.28, -2.4, kit.stow, "y"],
  ]);

  // --- the turret ring: the node that never moves --------------------------
  //
  // **`VehicleRig.turret` is here and is deliberately inert.** `Vehicle` keeps
  // `turretYaw` equal to the hull's own yaw on a gunless kind, so the local
  // angle written on this node is always zero — which is exactly what a ring
  // WELDED to the bed should do. It exists so that the mount below has the
  // same parent it has on a tank and `aimMg` needs no branch: the machine gun
  // is held in WORLD angles either way, and what it hangs off is the only
  // thing that differs.
  const turret = new TransformNode("truck-ring", scene);
  turret.parent = sprung;
  segment("truck-ring-m", turret, [], [
    // The ring and the pedestal under it.
    [RING_R * 2, 0.12, 0, RING_Y, RING_Z, kit.frame, "y"],
    [0.3, RING_Y - BED_Y, 0, BED_Y + (RING_Y - BED_Y) / 2, RING_Z, kit.frame, "y"],
    // A base plate where the post meets the bed, which is what stops a metre
    // of pipe reading as a pole somebody has stood in a hole.
    [0.62, 0.1, 0, BED_Y + 0.05, RING_Z, kit.frame, "y"],
  ]);

  // --- the gun on it: the whole of what this vehicle is for -----------------
  //
  // Two nodes and two meshes, the same pair the tank's cupola gun gets and for
  // the same reason: they move differently from everything around them. The
  // mount TRAVERSES on the ring and the gun ELEVATES on the mount.
  const mgMount = new TransformNode("truck-mg", scene);
  mgMount.parent = turret;
  mgMount.position.set(0, RING_Y + 0.06, RING_Z);
  segment("truck-mg-ring", mgMount, [
    // The pintle and the shield behind it. The shield is what makes the
    // traverse legible from outside — it is a flat plate with an orientation,
    // where a bare gun is a stick.
    [0.1, 0.2, 0.1, 0, 0.06, 0.14, kit.frame],
    [0.62, 0.34, 0.05, 0, 0.28, 0.28, kit.frame],
    [0.16, 0.24, 0.05, -0.31, 0.24, 0.24, kit.frame, 0, 0.5],
    [0.16, 0.24, 0.05, 0.31, 0.24, 0.24, kit.frame, 0, -0.5],
  ]);
  const mgGun = new TransformNode("truck-mg-gun", scene);
  mgGun.parent = mgMount;
  mgGun.position.set(0, 0.2, 0.14);
  segment("truck-mg-m", mgGun, [
    // The receiver, the ammunition box on its side and the spade grips behind
    // — the three shapes that make a heavy machine gun read as one at ten
    // metres. Bigger than the tank's cupola gun, because it is a bigger gun:
    // this is the only weapon the vehicle has.
    [0.19, 0.19, 0.62, 0, 0, 0.02, kit.frame],
    [0.18, 0.24, 0.26, 0.18, -0.02, -0.04, kit.frame],
    [0.32, 0.06, 0.17, 0, 0.03, -0.32, kit.frame],
  ], [
    // A ROUND barrel with a jacket at its root, for the reason every barrel in
    // this game is round: a square pipe is a girder.
    [0.16, 0.32, 0, 0.02, 0.46, kit.frame, "z"],
    [0.09, 0.78, 0, 0.02, 0.9, kit.frame, "z", 0.08],
  ]);
  const mgMuzzle = new TransformNode("truck-mg-muzzle", scene);
  mgMuzzle.parent = mgGun;
  // Just past the barrel, so a flash lit here is outside it and a round fired
  // from here starts outside the vehicle's own collider box.
  mgMuzzle.position.set(0, 0.02, 1.36);

  // --- one whip, off the cab's rear corner ---------------------------------
  //
  // ONE and not the tank's two, and the difference is what a mast is for on
  // each: a tank carries a pair because a command vehicle runs two nets, and
  // this is a truck with a radio in it. It costs two meshes rather than four,
  // and it is the only part of this vehicle that reports on the DRIVE the way
  // the tank's tracks do — the wheels say it is moving and the mast says how
  // hard.
  //
  // **On the front WING and not the cab's rear corner**, which is where it
  // started and is a mast the gun sweeps through: the barrel reaches 1.36 m
  // past its own pintle, and a whip standing 1.27 m from the ring at the
  // trunnion's own height is something a gunner laying abeam drives the muzzle
  // into. Out here it is 2.4 m away, which nothing on the ring can reach.
  const whipBase = new TransformNode("truck-whip", scene);
  whipBase.parent = sprung;
  whipBase.position.set(-(W / 2 - 0.18), FRAME_Y + 0.72, 1.05);
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
