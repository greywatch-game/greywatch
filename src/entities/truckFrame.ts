/**
 * truckFrame.ts — Where the TRUCK's joints are, as numbers: the wheels' three
 * extents the drive reads (`gauge`, `contactReach`, `wheelReach`) and the
 * offsets of every joint between the collider box and the roof station's gun
 * and sight, as `TRUCK_FRAME`, plus the drawing constants those are derived
 * from.
 * Owns: those numbers and nothing else — no node, no mesh, no behaviour.
 * Invariants: **no `@babylonjs/core`** — `Vehicle` reads `TRUCK_FRAME` through
 * `entities/vehicleKinds.ts`, and `TruckModel.ts` IMPORTS every constant here
 * and places its nodes FROM them, so the simulation's replay
 * (`entities/hullFrame.ts`) and the drawn station cannot drift apart. A number
 * here is a DRAWING decision the physics also needs; one only the drawing
 * needs stays in the model file.
 * Never: imports a model file, or anything that draws.
 */
import type { HullFrame } from "./hullFrame";

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
export const TRACK_X = 1.05;
/**
 * How far fore and aft the axles stand — the wheelbase's half-length.
 *
 * Well inside the body's own half-length (2.7), which is what leaves an
 * overhang at each end: the nose and its bumper in front of the front wheels
 * and the cargo bed behind the back ones. A vehicle whose wheels are at its
 * corners is a go-kart.
 */
export const AXLE_Z = 1.62;
/**
 * The gauge `Vehicle` splits one hull speed into two side speeds with. The
 * WHEEL track, because that is where the ground contacts are.
 */
export const TRACK_GAUGE = TRACK_X * 2;
/**
 * How far fore and aft of the centre the ground contacts reach.
 *
 * The AXLES and not the bumpers: a truck touches the ground at its tyres, and
 * a contact sampled out at the tailgate is a vehicle rearing up on a kerb its
 * wheels have not reached. This is what `TRACK_REACH` is to a tank, and it is
 * shorter relative to the body for the same reason the overhangs exist.
 */
export const CONTACT_REACH = AXLE_Z;

/** The top of the cab roof. Everything above this is the weapon station. */
export const ROOF_Y = 1.96;

/** The station's base ring: how big it is and how high it turns. */
export const RING_R = 0.44;
export const RING_Y = ROOF_Y + 0.04;
/**
 * …and where it stands, which is over the second row — where the man working
 * it is sitting.
 *
 * It is also about as far back as the sweep allows: the muzzle reaches 1.46 m
 * and the cab roof runs to -1.56, so a station much further aft would swing
 * its barrel down over the cargo bed.
 */
export const RING_Z = -0.85;

/**
 * This kind's joints as numbers (`entities/hullFrame.ts`), which `buildTruck`
 * places its nodes FROM, so the simulation's replay and the drawn station
 * cannot drift. The ring is INERT and at the sprung body's origin, and there
 * is no main gun. The suspension's travel is bounded at the wheel STATIONS,
 * which on this vehicle are the axles — the same place the ground contacts
 * are, because a truck's wheels are its suspension and its contact patch at
 * once. On a tank the two differ, which is the whole reason the frame states
 * both.
 */
export const TRUCK_FRAME: HullFrame = {
  gauge: TRACK_GAUGE,
  contactReach: CONTACT_REACH,
  wheelReach: AXLE_Z,
  turretAt: [0, 0, 0],
  gun: null,
  mgMountAt: [0, RING_Y + 0.06, RING_Z],
  mgGunAt: [0, 0.18, 0.06],
  // **This 1.46 is the tightest number in the file** — see `mgMuzzle`.
  mgMuzzleAt: [0, 0.02, 1.46],
  mgSightAt: [-0.36, 0.12, 0.4],
};
