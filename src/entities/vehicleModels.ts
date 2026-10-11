/**
 * vehicleModels.ts — What each kind of vehicle LOOKS like: the client's table
 * from a `VehicleKind` to the function that builds its rig.
 * Owns: `VehicleModel` and the one `Record` of them. Owns NO numbers and NO
 * behaviour — a kind's spec and its joints are `entities/vehicleKinds.ts`'s,
 * which the authority reads; this is the half only a client has a scene for.
 * Invariants:
 * - **A `Record<VehicleKind, …>`**, exactly as `VEHICLE_KINDS` is, so a member
 *   of the union with a row in one table and not the other fails to compile.
 * - **A lookup keyed by the kind and never a branch on it**: `modelOf` resolves
 *   the hardstanding's kind through `resolveKind`, the one place the default
 *   is written, so a hull's numbers and its drawing are always the same kind.
 * Never: imported by anything the authority builds (`server/`), by `Vehicle`
 * or by `VehicleSystem` — `systems/VehicleViews.ts` is its one reader in the
 * game, and `scripts/kit-hash.mjs` hashes what it builds.
 */
import type { Scene } from "@babylonjs/core";
import type { CelMaterialFactory } from "../shaders/CelShader";
import type { Team } from "./Combatant";
import { buildHeli } from "./HeliModel";
import { buildTank } from "./TankModel";
import { buildTruck } from "./TruckModel";
import { resolveKind, type VehicleKind } from "./vehicleKinds";
import type { VehicleRig } from "./vehicleRig";

/** Builds one hull's rig in a team's colours. See `VehicleRig`. */
export type VehicleModel = (
  scene: Scene,
  mats: CelMaterialFactory,
  team: Team,
) => VehicleRig;

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
