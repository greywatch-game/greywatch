/**
 * heliFrame.ts — Where the HELICOPTER's joints are, as numbers: the skids'
 * three extents the drive reads (`gauge`, `contactReach`, `wheelReach`) and the
 * offsets of every joint between the collider box and the chin gun's muzzle and
 * the gunner's sight, as `HELI_FRAME`, plus the drawing constants those are
 * derived from.
 * Owns: those numbers and nothing else — no node, no mesh, no behaviour.
 * Invariants: **no `@babylonjs/core`** — `Vehicle` reads `HELI_FRAME` through
 * `entities/vehicleKinds.ts`, and `HeliModel.ts` IMPORTS every constant here
 * and places its nodes FROM them, so the simulation's replay
 * (`entities/hullFrame.ts`) and the drawn chin gun cannot drift apart. A
 * number here is a DRAWING decision the physics also needs; one only the
 * drawing needs stays in the model file.
 * Never: imports a model file, or anything that draws.
 */
import type { HullFrame } from "./hullFrame";

/** How far out the two skid runners stand. The gauge, and the roll stance. */
export const SKID_X = 1.16;
/** Half the skid's length — the contact patch, fore and aft. */
export const SKID_REACH = 1.9;

/** The gauge `Vehicle` splits one hull speed into two side speeds with. */
export const SKID_TRACK = SKID_X * 2;

/**
 * The chin turret's trunnion, and how far the muzzle reaches from it.
 *
 * `MG_REACH` is spent twice and they are the same number by construction: it is
 * where `mgMuzzle` sits, and it is therefore the RADIUS of the circle the
 * barrel sweeps under the nose. Nothing on the belly may be inside it.
 */
export const MG_Y = 0.6;
export const MG_Z = 4.75;
export const MG_REACH = 0.7;

/**
 * This kind's joints as numbers (`entities/hullFrame.ts`), which `buildHeli`
 * places its nodes FROM, so the simulation's replay and the drawn chin gun
 * cannot drift. The ring is INERT and at the sprung body's origin, the gun
 * hangs at its mount's own origin, and there is no main gun. The skids ARE
 * the suspension and the contact patch at once, exactly as a truck's axles
 * are, so the two reaches are the same number here — stated twice rather than
 * aliased, because the day one of them moves is the day that matters.
 */
export const HELI_FRAME: HullFrame = {
  gauge: SKID_TRACK,
  contactReach: SKID_REACH,
  wheelReach: SKID_REACH,
  turretAt: [0, 0, 0],
  gun: null,
  mgMountAt: [0, MG_Y, MG_Z],
  mgGunAt: [0, 0, 0],
  mgMuzzleAt: [0, 0, MG_REACH],
  // The gunner's eye — see `mgSight` for the three clearances that bound it.
  mgSightAt: [-0.32, 0.13, 0.3],
};
