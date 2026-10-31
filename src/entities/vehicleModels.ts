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
 * Never: imported by anything the authority builds (`server/`), by `Vehicle`
 * or by `VehicleSystem` — `systems/VehicleViews.ts` and `Game` (the kits, for
 * the drawing) are its readers in the game, and `scripts/kit-hash.mjs` hashes
 * what it builds.
 */
import { teamOfView } from "../core/teamView";
import type { Team } from "./Combatant";
import { buildHeli } from "./HeliModel";
import { buildTank } from "./TankModel";
import { buildTruck } from "./TruckModel";
import { resolveKind, type VehicleKind } from "./vehicleKinds";
import type { HullKit, VehicleRig } from "./vehicleRig";

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
  for (const model of Object.values(VEHICLE_MODELS)) {
    for (const view of [0, 1] as const) out.push(model(teamOfView(view)).kit);
  }
  return out;
}
