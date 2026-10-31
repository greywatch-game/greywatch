/**
 * vehicleModels.ts — What each kind of vehicle LOOKS like: the client's table
 * from a `VehicleKind` to the function that builds its rig, and every kind's
 * drawing in both views' colours (`hullKits`).
 * Owns: `VehicleModel`, the one `Record` of them, and `hullKits`. Owns NO
 * numbers and NO behaviour — a kind's spec and its joints are
 * `entities/vehicleKinds.ts`'s, which the authority reads; this is the half
 * only a client draws.
 * Invariants:
 * - **A `Record<VehicleKind, …>`**, exactly as `VEHICLE_KINDS` is, so a member
 *   of the union with a row in one table and not the other fails to compile.
 * - **A lookup keyed by the kind and never a branch on it**: `modelOf` resolves
 *   the hardstanding's kind through `resolveKind`, the one place the default
 *   is written, so a hull's numbers and its drawing are always the same kind;
 *   `hullKits` walks the table's rows, never names one.
 * - **A DEV build GUARDS the gun-reach floor's measured term** (`BABYLON_EXIT.md`
 *   X4.2d's post-commit review): `hullKits` sweeps every kind's muzzles and
 *   gunner's sight through their whole traverse on the rig it built and
 *   THROWS if one stands farther from its hull's measure centre than
 *   `CONFIG.graphics.culling.hullFade.muzzle` (`checkMuzzleReach`) — the one
 *   term of `hullDrawFloor` that is measured off the DRAWING rather than read
 *   off the kinds' numbers, so a longer barrel or a fourth kind cannot slip
 *   past it silently. Folded out of a production build.
 * Never: imported by anything the authority builds (`server/`), by `Vehicle`
 * or by `VehicleSystem` — `systems/VehicleViews.ts` and `Game` (the kits, for
 * the drawing) are its readers in the game, and `scripts/kit-hash.mjs` hashes
 * what it builds.
 */
import { CONFIG } from "../config";
import { teamOfView } from "../core/teamView";
import type { Team } from "./Combatant";
import { buildHeli } from "./HeliModel";
import { buildTank } from "./TankModel";
import { buildTruck } from "./TruckModel";
import { kindOf, resolveKind, type VehicleKind } from "./vehicleKinds";
import { type HullKit, measureHull, type VehicleRig } from "./vehicleRig";

/**
 * Builds one hull's rig in a team's colours: its joints and its segments, its
 * DRAWING its kind's kit in that team's view (`VehicleRig.kit`). See
 * `VehicleRig`.
 */
export type VehicleModel = (team: Team) => VehicleRig;

/** Every kind's model. See the header for why it is a `Record`. */
const VEHICLE_MODELS: Record<VehicleKind, VehicleModel> = {
  tank: buildTank,
  truck: buildTruck,
  heli: buildHeli,
};

/** The model a hardstanding's hull is drawn with, its kind resolved. */
export function modelOf(kind: VehicleKind | undefined): VehicleModel {
  return VEHICLE_MODELS[resolveKind(kind)];
}

/**
 * Every kind's drawing in each VIEW's colours (`BABYLON_EXIT.md` X4.2b), in
 * the table's order, the views in order under each: what our renderer draws
 * every hull as an instance of (`render/HullDraw.ts`). Each is built by
 * building a rig of it — the first of its kind and view builds the kit
 * (`vehicleRig.segmentOf`), which every hull of that pair then hangs — and
 * the rig is dropped: a kit is module constants, the same objects for the
 * life of the page whatever team is on the field.
 */
export function hullKits(): readonly HullKit[] {
  const out: HullKit[] = [];
  for (const [kind, model] of Object.entries(VEHICLE_MODELS) as [VehicleKind, VehicleModel][]) {
    for (const view of [0, 1] as const) {
      const rig = model(teamOfView(view));
      // One view a kind: the joints are the model's, the views differ only in
      // paint. The rig is dropped after, so posing it here costs nothing.
      if (import.meta.env.DEV && view === 0) checkMuzzleReach(kind, rig);
      out.push(rig.kit);
    }
  }
  return out;
}

/**
 * DEV only (`hullKits`): the farthest a `kind`'s MUZZLES (the main gun's,
 * where it has one, and the machine gun's) and its gunner's SIGHT stand from
 * the hull's whole measure centre (`measureHull`) through their whole
 * traverse — the turret and the cupola mount each all the way round, every
 * gun across the larger of its two pitch limits either way — on `rig`'s own
 * joints at rest otherwise, and a THROW if that is past
 * `CONFIG.graphics.culling.hullFade.muzzle`, the term `hullDrawFloor`
 * (`world/environment.ts`) counts it as. The scratch sweep X4.2d measured
 * the term with, kept: the tank's main gun 7.683 m with the turret to the
 * rear, its cupola gun 3.535, the helicopter's chin gun 5.981, the truck's
 * station 2.374.
 *
 * **A sample is a bound, not a guess**: each sweep is a rotation, along
 * which a point's distance from a fixed centre is `sqrt(A + B cos θ)` with
 * `A >= B >= 0`, so the farthest point between two samples `h` apart is at
 * most the nearer sample's distance over `cos(h / 4)` — and the reach checked
 * is the sampled worst over that factor, once for each nested sweep. What it
 * does not sweep is the lean (the springs' pitch and heave, a flying hull's
 * attitude): a picture of a few degrees about a pivot inside the hull, which
 * the term's margin over the worst (0.32 m on the tank) is there to carry.
 * Once a kind at the session's first kit build, ~7,000 composes a kind.
 */
function checkMuzzleReach(kind: VehicleKind, rig: VehicleRig): void {
  const spec = kindOf(kind).spec;
  const limit = CONFIG.graphics.culling.hullFade.muzzle;
  const YAWS = 36;
  const PITCHES = 5;
  const gunPitch = spec.gun ? Math.max(-spec.gun.turret.pitchMin, spec.gun.turret.pitchMax, 0) : 0;
  const mgPitch = Math.max(-spec.mg.pitchMin, spec.mg.pitchMax, 0);
  // The bound over each nested sweep: two yaws and a pitch for the cupola's
  // joints; one yaw and a pitch for the main gun's (its pitch step the
  // larger of the two, which only loosens it).
  const yawStep = (Math.PI * 2) / YAWS;
  const pitchStep = (2 * Math.max(gunPitch, mgPitch)) / (PITCHES - 1);
  const slack = 1 / (Math.cos(yawStep / 4) * Math.cos(yawStep / 4) * Math.cos(pitchStep / 4));
  const m = { x: 0, y: 0, z: 0, radius: 0 };
  let worst = 0;
  let worstAt = "";
  const reach = (joint: { world: { m: ArrayLike<number> } } | null, label: string): void => {
    if (!joint) return;
    const w = joint.world.m;
    const d = Math.hypot(w[12] - m.x, w[13] - m.y, w[14] - m.z);
    if (d > worst) {
      worst = d;
      worstAt = label;
    }
  };
  for (let a = 0; a < YAWS; a++) {
    rig.turret.rotation.y = a * yawStep;
    for (let b = 0; b < YAWS; b++) {
      rig.mgMount.rotation.y = b * yawStep;
      for (let p = 0; p < PITCHES; p++) {
        const t = -1 + (2 * p) / (PITCHES - 1);
        if (rig.gun) rig.gun.rotation.x = t * gunPitch;
        rig.mgGun.rotation.x = t * mgPitch;
        rig.tree.compute();
        measureHull(rig, m);
        // The main gun turns with the turret alone: once per turret yaw.
        if (b === 0) reach(rig.muzzle, "main muzzle");
        reach(rig.mgMuzzle, "machine-gun muzzle");
        reach(rig.mgSight, "gunner's sight");
      }
    }
  }
  const bound = worst * slack;
  if (bound > limit) {
    throw new Error(
      `vehicleModels: the ${kind}'s ${worstAt} reaches ${worst.toFixed(3)} m from its hull's measure centre` +
        ` (${bound.toFixed(3)} m bounded between samples), past CONFIG.graphics.culling.hullFade.muzzle` +
        ` (${limit} m) — raise the term, or hullDrawFloor lets a hull fade out while that muzzle's fire still` +
        " reaches a viewer (BABYLON_EXIT.md X4.2d).",
    );
  }
}
