/**
 * vehicleKinds.ts — The list of vehicles that exist, and the ONE place a kind
 * is turned into what a hull is made of.
 * Owns: the `VehicleKind` union, the default kind (`resolveKind`), the
 * table pairing each kind's name with its `VehicleSpec` and its `HullFrame`,
 * and the two figures read over the whole table (`HULL_REACH`: how far a
 * hull's fire reaches, how far a viewer's eye stands from what it can hit).
 * Owns NO behaviour and NO drawing: **no `@babylonjs/core`**, because the
 * authority builds its fleet from this table and has no scene to build a rig
 * in. What a kind LOOKS like is the client's own table,
 * `entities/vehicleModels.ts`, keyed by the same union.
 * `entities/Vehicle.ts` is one hull of any kind and has never heard of either
 * file; `systems/VehicleSystem.ts` reads this one once per hardstanding at map
 * load, and the client's `systems/VehicleViews.ts` reads the other beside it.
 *
 * ## Why a table and not a branch
 *
 * A vehicle in this game is exactly two things — a block of numbers
 * (`CONFIG.vehicles.<kind>`, shaped by `VehicleSpec`, with the `HullFrame` its
 * model states beside it: where its joints are, which the simulation reads
 * instead of a rig) and a model that draws them, which hands over a
 * `VehicleRig` — and everything else about it, the collider and the drive and
 * the ten ground contacts and the two seats and the chase camera and the
 * crush, is machinery that reads those two and nothing else. So a fourth kind
 * is a member of `VehicleKind`, a row here, a block in `config/vehicles.ts`, a
 * frame file, a model file and a row in `vehicleModels.ts` — and both tables
 * are `Record<VehicleKind, …>`, so a kind with a row in one and not the other
 * does not compile. And NO `if` anywhere: the moment a system asks which kind
 * it is holding, that bargain is broken.
 *
 * **The helicopter was the test of that and it held.** It is the one kind so
 * far that needed anything the other two did not, and what it needed was a
 * second nullable block rather than a second code path — `VehicleSpec.flight`,
 * and `Vehicle.lift`, which is an addend to arithmetic that already existed and
 * is zero on everything that cannot fly.
 *
 * TWO things a kind genuinely differs by in code, and neither is asked here.
 * Each is one nullable block in the spec resolved once into one boolean:
 * `spec.gun` is null on a gunless kind and `Vehicle.armed` is the question, and
 * `spec.flight` is null on one that cannot leave the ground and `Vehicle.flies`
 * is the question. A reader that wants only the yes or no asks the boolean; one
 * that needs the block's NUMBERS (a gun's range, a rotor's ceiling) narrows on
 * the block, the same fact in the form TypeScript can carry. Both are
 * CAPABILITIES rather than identities, which is what keeps them inside the
 * bargain above — a reader asks what a hull can DO, and never what it is.
 *
 * ## A map names a kind and nothing else
 *
 * `VehicleSpawnDef.kind` is a string in a layout file, defaulting to `"tank"`
 * so that the maps written before there was a second kind say nothing and are
 * unaffected. That default is stated once, here (`resolveKind`), rather than
 * at each of the readers (the fleet, its views, `MapBuilder.keepClear`, the
 * editor) — copies of a default are places for a map to mean different things
 * to different halves of the game.
 */
import { CONFIG } from "../config";
import type { VehicleSpec } from "../config/vehicles";
import { HELI_FRAME } from "./heliFrame";
import type { HullFrame } from "./hullFrame";
import { TANK_FRAME } from "./tankFrame";
import { TRUCK_FRAME } from "./truckFrame";

/**
 * What kinds of vehicle exist. A map's hardstanding names one of these, and a
 * hardstanding that names nothing is a tank.
 */
export type VehicleKind = "tank" | "truck" | "heli";

/** One kind as the SIMULATION needs it: its name, its numbers and its joints. */
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
  /**
   * Where the joints on the way to each muzzle are, and the three extents the
   * drive reads off the drawing — the model's own numbers, which it builds its
   * nodes from (`entities/hullFrame.ts`). The simulation reads THESE and never
   * the rig.
   */
  readonly frame: HullFrame;
}

/**
 * Every kind, keyed by name. A `Record` rather than an array so that a new
 * member of `VehicleKind` fails to compile until it has a row.
 */
const VEHICLE_KINDS: Record<VehicleKind, VehicleType> = {
  tank: { name: "TANK", spec: CONFIG.vehicles.tank, frame: TANK_FRAME },
  truck: { name: "TRUCK", spec: CONFIG.vehicles.truck, frame: TRUCK_FRAME },
  heli: { name: "HELI", spec: CONFIG.vehicles.heli, frame: HELI_FRAME },
};

/**
 * The kind a hardstanding stands for, resolved. **The one place the default is
 * written down** — see the header. `vehicleModels.modelOf` resolves through
 * this too, so a hardstanding's numbers and its drawing cannot be of two kinds.
 */
export function resolveKind(kind: VehicleKind | undefined): VehicleKind {
  return kind ?? "tank";
}

/** The kind a hardstanding stands for, as the simulation needs it. */
export function kindOf(kind: VehicleKind | undefined): VehicleType {
  return VEHICLE_KINDS[resolveKind(kind)];
}

/**
 * How far a hull's fire REACHES, and how far a viewer's eye stands from what
 * of him it can hit — the two figures every kind's own numbers state, read
 * over the whole table (`BABYLON_EXIT.md` X4.2d), so a longer gun or a
 * further chase camera moves them by itself. What a map's
 * `EnvironmentSpec.hullDrawDistance` is floored by (`world/environment.ts`'
 * `hullDrawFloor`), so that no setting fades out a hull whose guns can still
 * reach the player looking for it.
 */
export interface HullReach {
  /**
   * Metres from a MUZZLE to the farthest point its fire can hurt: the main
   * gun's `range` plus its blast's `blastRadius` (the splash goes off where
   * the round stopped, a miss at full range included), or the machine gun's
   * `range` — the farthest of every kind's guns. The tank's shell today:
   * 340 + 7 m.
   */
  readonly fire: number;
  /**
   * Metres from a VIEWER's eye to the farthest point of what a round can hit
   * of him: a person on foot is his own body, and one in a hull is that
   * hull's whole box seen from its chase camera — `camera.anchorHeight` over
   * the centre, `camera.distance` back from that, and half the box's
   * diagonal to its far corner — the farthest of every kind's. The
   * helicopter's today: 2.4 + 14 + 6.0 m.
   */
  readonly eye: number;
}

/** See `HullReach`. Computed once; no kind is asked which it is. */
export const HULL_REACH: HullReach = (() => {
  let fire = 0;
  let eye = 0;
  for (const { spec } of Object.values(VEHICLE_KINDS)) {
    const gun = spec.gun;
    fire = Math.max(fire, spec.mg.range, gun ? gun.range + gun.blastRadius : 0);
    const h = spec.hull;
    const corner = 0.5 * Math.hypot(h.length, h.width, h.height);
    eye = Math.max(eye, spec.camera.anchorHeight + spec.camera.distance + corner);
  }
  return { fire, eye };
})();
