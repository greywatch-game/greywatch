/**
 * tankFrame.ts — Where the TANK's joints are, as numbers: the running gear's
 * three extents the drive reads (`gauge`, `contactReach`, `wheelReach`) and the
 * offsets of every joint between the collider box and its two muzzles and the
 * sight, as `TANK_FRAME`, plus the drawing constants those are derived from.
 * Owns: those numbers and nothing else — no node, no mesh, no behaviour.
 * Invariants: **no `@babylonjs/core`** — `Vehicle` (the simulation, on both
 * sides of the wire) reads `TANK_FRAME` through `entities/vehicleKinds.ts`,
 * and `TankModel.ts` IMPORTS every constant here and places its nodes FROM
 * them, so the muzzle the simulation replays (`entities/hullFrame.ts`) and the
 * one drawn on the rig cannot drift apart. A number here is a DRAWING decision
 * the physics also needs; one only the drawing needs stays in the model file.
 * Never: imports a model file, or anything that draws.
 */
import { CONFIG } from "../config";
import type { HullFrame } from "./hullFrame";

/** The gun barrel's length, which the muzzle node sits at the end of. */
export const BARREL_LENGTH = 4.4;

/** How wide the band is. The wheels are proud of it; nothing else is. */
export const TRACK_W = 0.66;

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

/** Half the hull, less half a band, less the 6 cm the sponson overhangs by. */
export const TRACK_X = CONFIG.vehicles.tank.hull.width / 2 - TRACK_W / 2 - 0.06;
/** Where the sprocket and the idler stand, fore and aft of the hull's centre. */
export const END_Z = CONFIG.vehicles.tank.hull.length / 2 - 0.6;

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
 * The hull's top, and therefore where the turret ring sits. Derived from the
 * collider's own height rather than authored, so that raising the box raises
 * the vehicle drawn inside it: what is left above this is the 0.95 m the ring
 * and the turret need to reach the top of the box exactly.
 */
export const DECK_Y = CONFIG.vehicles.tank.hull.height - 0.95;
/** The turret ring, 6 cm proud of the deck. */
export const TURRET_Y = DECK_Y + 0.06;
/** Where the commander stands, in the turret's own frame. */
export const CUPOLA_Y = CONFIG.vehicles.tank.cupolaHeight - TURRET_Y;
/** Where the barrel ends, along the gun's own axis. */
export const BARREL_END = 0.45 + BARREL_LENGTH;

/** The main gun's trunnion on the turret, and its muzzle just past the barrel. */
export const TANK_GUN = {
  at: [0, 0.45, 1.25],
  muzzleAt: [0, 0, BARREL_END + 0.2],
} as const;

/**
 * This kind's joints as numbers (`entities/hullFrame.ts`), which `buildTank`
 * places its nodes FROM — so the muzzle the simulation replays off these and
 * the one drawn on the rig cannot drift apart. The three extents are the
 * drawing decisions `Vehicle` cannot get anywhere else: see `HullFrame`.
 */
export const TANK_FRAME: HullFrame = {
  gauge: TRACK_GAUGE,
  contactReach: TRACK_REACH,
  wheelReach: WHEEL_REACH,
  turretAt: [0, TURRET_Y, -0.3],
  gun: TANK_GUN,
  mgMountAt: [-0.62, CUPOLA_Y + 0.3, 0.15],
  mgGunAt: [0, 0.12, 0.16],
  mgMuzzleAt: [0, 0.02, 1.1],
  mgSightAt: [0, 0.22, 0.3],
};
