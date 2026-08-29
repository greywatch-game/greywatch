/**
 * vehicleKinds.ts — The list of vehicles that exist, and the ONE place a kind
 * is turned into the two things a hull is made of.
 * Owns: the `VehicleKind` union and the table pairing each kind's
 * `VehicleSpec` with the function that builds its mesh.
 * Owns NO behaviour. `entities/Vehicle.ts` is one hull of any kind and has
 * never heard of this file; `systems/VehicleSystem.ts` is the only reader, and
 * it reads it once per hardstanding at map load.
 *
 * ## Why a table and not a branch
 *
 * A vehicle in this game is exactly two things — a block of numbers
 * (`CONFIG.vehicles.<kind>`, shaped by `VehicleSpec`) and a `VehicleRig` that
 * draws them — and everything else about it, the collider and the drive and
 * the ten ground contacts and the two seats and the chase camera and the
 * crush, is machinery that reads those two and nothing else. So a fourth kind
 * is a row here, a block in `config/vehicles.ts` and a model file, and NO
 * `if` anywhere: the moment a system asks which kind it is holding, that
 * bargain is broken.
 *
 * **The helicopter was the test of that and it held.** It is the one kind so
 * far that needed anything the other two did not, and what it needed was a
 * second nullable block rather than a second code path — `VehicleSpec.flight`,
 * and `Vehicle.lift`, which is an addend to arithmetic that already existed and
 * is zero on everything that cannot fly.
 *
 * TWO things a kind genuinely differs by in code, and neither is asked here.
 * Each is one nullable block in the spec resolved once into one boolean that
 * every reader puts instead: `spec.gun` is null on a gunless kind and
 * `Vehicle.armed` is the question, and `spec.flight` is null on one that cannot
 * leave the ground and `Vehicle.flies` is the question. Both are CAPABILITIES
 * rather than identities, which is what keeps them inside the bargain above — a
 * reader asks what a hull can DO, and never what it is.
 *
 * ## A map names a kind and nothing else
 *
 * `VehicleSpawnDef.kind` is a string in a layout file, defaulting to `"tank"`
 * so that the maps written before there was a second kind say nothing and are
 * unaffected. That default is stated once, here, rather than at each of the
 * three readers (the fleet, `MapBuilder.keepClear`, the editor) — three copies
 * of a default is three places for a map to mean different things to different
 * halves of the game.
 */
import { CONFIG } from "../config";
import type { VehicleSpec } from "../config/vehicles";
import type { Team } from "./Combatant";
import { buildHeli } from "./HeliModel";
import { buildTank } from "./TankModel";
import { buildTruck } from "./TruckModel";
import type { VehicleRig } from "./vehicleRig";
import type { CelMaterialFactory } from "../shaders/CelShader";
import type { Scene } from "@babylonjs/core";

/**
 * What kinds of vehicle exist. A map's hardstanding names one of these, and a
 * hardstanding that names nothing is a tank.
 */
export type VehicleKind = "tank" | "truck" | "heli";

/** The two halves of one kind, as `VehicleSystem` needs them, and its name. */
export interface VehicleType {
  /**
   * What the HUD calls it, upper case — `ENTER TANK`, `TAKE OVER TRUCK`,
   * `EXIT TRUCK`.
   *
   * **The prompts have to say which vehicle, and it is a fact about the KIND
   * rather than a string `Game` can pick**: a map with a tank and a truck on
   * one hardstanding apiece offers both to the same player from ten metres
   * apart, and `EXIT TANK` while sitting in a truck is the prompt telling
   * somebody they are in a vehicle they are not. `Game.offeredSeat` and
   * `Game.updateDriver` both read it off the hull they are talking about.
   */
  readonly name: string;
  readonly spec: VehicleSpec;
  readonly build: (
    scene: Scene,
    mats: CelMaterialFactory,
    team: Team,
  ) => VehicleRig;
}

/**
 * Every kind, keyed by name. A `Record` rather than an array so that a new
 * member of `VehicleKind` fails to compile until it has a row.
 */
export const VEHICLE_KINDS: Record<VehicleKind, VehicleType> = {
  tank: { name: "TANK", spec: CONFIG.vehicles.tank, build: buildTank },
  truck: { name: "TRUCK", spec: CONFIG.vehicles.truck, build: buildTruck },
  heli: { name: "HELI", spec: CONFIG.vehicles.heli, build: buildHeli },
};

/**
 * The kind a hardstanding stands for, resolved. **The one place the default is
 * written down** — see the header.
 */
export function kindOf(kind: VehicleKind | undefined): VehicleType {
  return VEHICLE_KINDS[kind ?? "tank"];
}
