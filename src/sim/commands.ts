/**
 * src/sim/commands.ts — What a host may ASK the simulation to do on a
 * person's behalf: the `SimCommand` vocabulary `SimCore.submit` takes.
 * Owns: the command shapes, and nothing that acts on them — `SimCore.submit`
 * is the one reader.
 * Invariants: **a command is PLAIN DATA** — numbers, booleans, string ids and
 * `{x, y, z}` records, never a class the far side would need the prototype
 * of, a closure or a reference into the simulation — so a host can hand one
 * over in process today and post one to a worker at X2.5b. **A command is a
 * request the host has already VALIDATED**: `Match` runs every claim gate it
 * has (the rate buckets, the cones, the origin slips, `validateMove` and
 * `validateDrive`) and only then submits; the offline page's commands are
 * trusted. Either way the core still refuses what its own state makes
 * impossible — a dead body's round, a throw from a seat, an empty pouch — so
 * the trusted door and the validated one land on the same rules.
 * Never: carry a RESULT. What a command did (a hit, a seat, a spawn, a
 * refusal) is written to the event ring (`src/sim/events.ts`) as it happens,
 * and `submit`'s boolean says only whether the core acted on it at all — a
 * courtesy for the authority's rate buckets, which spend only on a round that
 * actually left.
 *
 * **The vocabulary is the gameplay half of `ClientMessage`
 * (`src/net/protocol.ts`) after validation, with host-resolved data in
 * place of ids the core could not resolve for itself** — the weapon's whole
 * `WeaponSetup` rather than its id, the throwable and equipment the host's
 * kit record names, the pouch SIZES a kit fills. Two kinds have no wire
 * message: `kit` (the wire resolves a kit inside `join`/`deploy`) and the
 * C4a-only pair `driveInput`/`gunOrder`, which let a host step its person's
 * hull FROM RAW INPUT inside the core, as the offline `Game` steps it today;
 * `BABYLON_EXIT.md` X2.5a C4b replaces them with the page predicting the hull
 * and reporting it through `drive`/`gun`, exactly as a netplay client does.
 *
 * There is no `swapSeat`: on the wire and here a swap is a `mount` naming the
 * hull the person is already in, with the other chair — `SimCore`'s seat
 * policy tells the two apart. There is no `reload`: a reload decides nothing
 * the core resolves (a magazine is not simulated on this side), and the wire's
 * `reload` is a noise `Match` relays itself.
 */
import type { Vector3Like } from "../math";
import type { CrewSeat } from "../entities/hullSeats";
import type { EquipmentId } from "../entities/equipment";
import type { ThrowableId } from "../entities/throwables";
import type { WeaponSetup } from "../entities/weapons";

/**
 * A body's validated position and stance — `SimPlayer.apply`'s arguments.
 * `dt` is the interval the sample covers, which is what eases the stance
 * blend: the authority's is the client clock's gap, clamped; the page's its
 * own frame. Refused while dead or seated (a seat's body is the hull's).
 */
export interface MoveCommand {
  t: "move";
  dt: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  crouch: boolean;
  sprint: boolean;
}

/**
 * A person's round. `dir` is the direction it FLEW — a unit vector with the
 * spread already rolled by the host (the client's own stream online, the
 * page's offline), so the core fires it with a spread of zero. `origin` is
 * the eye the round left from, which is also where bots HEAR it. `muzzle` is
 * where the tracer is drawn from and nothing else (`round`'s muzzle), the eye
 * when absent. `renderTime` is the shooter's render clock, which the rewind
 * resolves against when the core was built with `rewind`; without it, or
 * without the option, the round meets the world as it stands.
 */
export interface ShotCommand {
  t: "shot";
  origin: Vector3Like;
  dir: Vector3Like;
  muzzle?: Vector3Like;
  weapon: WeaponSetup;
  renderTime?: number;
}

/**
 * A throw: from `origin` along `dir` (unit), `kind` being what the host's
 * kit record says the pouch holds. Spent from the core's pouch only if the
 * pool takes it; a full pool raises `ordnanceRefused` (item `grenade`).
 */
export interface GrenadeCommand {
  t: "grenade";
  origin: Vector3Like;
  dir: Vector3Like;
  kind: ThrowableId;
}

/**
 * A rocket out of the tube (`dir` unit) or a mine at `origin` (`dir`
 * ignored). Spent from the core's pouch only if the pool takes it; a refusal
 * raises `ordnanceRefused`.
 */
export interface OrdnanceCommand {
  t: "ordnance";
  kind: EquipmentId;
  origin: Vector3Like;
  dir: Vector3Like;
}

/**
 * "Bring me back in", at spawn index `spawn` — a REQUEST, resolved against
 * what the team may use when it is spent (`ConquestSystem.deployAt`), and
 * the conquest's own pick when absent or refused. Spent by the reinforcement
 * pass once the respawn clock has run out, or AT SUBMIT on a core built with
 * `hostHoldsRespawn` — see `SimCoreOptions`. A second ask replaces the
 * first; a living body's is refused.
 */
export interface DeployCommand {
  t: "deploy";
  spawn?: number;
}

/**
 * What a full pouch is, for the kit the host resolved: `grenades` throwables
 * and `ordnance` anti-tank items. Written as the carried size AND the count
 * now held — a kit is chosen between lives, so the body it describes is the
 * next one — and refused for a living body, whose pouch only death refills.
 */
export interface KitCommand {
  t: "kit";
  grenades: number;
  ordnance: number;
}

/**
 * "Put me in that hull, in that chair" — the chair a PREFERENCE, the hull's
 * hardstanding index the person's own pick. Naming the hull they are already
 * in with the other chair is the swap. Always answered with a `seat` event.
 */
export interface MountCommand {
  t: "mount";
  tank: number;
  seat: CrewSeat;
}

/** "Let me out." Refused in silence where the hull cannot set a body down. */
export interface DismountCommand {
  t: "dismount";
}

/**
 * A DRIVER's validated hull state, which the core poses the hull to on its
 * next step (`VehicleOrders.remoteFor`), and the look the shell's cone is
 * measured against (`aimYaw`/`aimPitch`, onto the body).
 */
export interface DriveCommand {
  t: "drive";
  x: number;
  y: number;
  z: number;
  yaw: number;
  turretYaw: number;
  gunPitch: number;
  aimYaw: number;
  aimPitch: number;
}

/** A GUNNER's cupola-gun bearing (`remoteGunFor`), which is also their look. */
export interface GunCommand {
  t: "gun";
  yaw: number;
  pitch: number;
}

/**
 * The driver's main gun, fired down the core's own gun from its own muzzle
 * at its own reload — nothing of a claim but the trigger. `early` is
 * `Vehicle.fireGun`'s tolerance: the authority's `HULL_EARLY`, 0 offline.
 */
export interface ShellCommand {
  t: "shell";
  early: number;
}

/** The gunner's cupola gun, one round — `ShellCommand`'s terms. */
export interface MgCommand {
  t: "mg";
  early: number;
}

/**
 * **C4a only.** The DRIVER's sticks, as the offline `Game` feeds
 * `VehicleSystem.update` today (`Game.drive`, written in `updateDriver`):
 * the hull is then STEPPED by the core from this rather than posed from a
 * report, until the person reports a `drive` or leaves the chair. The look
 * rides onto the body, as `drive`'s does. Removed at C4b.
 */
export interface DriveInputCommand {
  t: "driveInput";
  throttle: number;
  steer: number;
  lift: number;
  aimYaw: number;
  aimPitch: number;
}

/**
 * **C4a only.** The GUNNER's order to the cupola gun (`Game.gunOrder`): the
 * ring is then WALKED by the core toward it rather than set to a reported
 * bearing, until a `gun` arrives or the chair is left. Removed at C4b.
 */
export interface GunOrderCommand {
  t: "gunOrder";
  aimYaw: number;
  aimPitch: number;
}

/** Everything `SimCore.submit` takes. */
export type SimCommand =
  | MoveCommand
  | ShotCommand
  | GrenadeCommand
  | OrdnanceCommand
  | DeployCommand
  | KitCommand
  | MountCommand
  | DismountCommand
  | DriveCommand
  | GunCommand
  | ShellCommand
  | MgCommand
  | DriveInputCommand
  | GunOrderCommand;
