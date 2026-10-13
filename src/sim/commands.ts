/**
 * src/sim/commands.ts — What a host may ASK the simulation to do on a
 * person's behalf: the `SimCommand` vocabulary `SimCore.submit` takes.
 * Owns: the command shapes, and nothing that acts on them — `SimCore.submit`
 * is the one reader.
 * Invariants: **a command is PLAIN DATA** — numbers, booleans, string ids and
 * `{x, y, z}` records, never a class the far side would need the prototype
 * of, a closure or a reference into the simulation — so a host can hand one
 * over in process. **A command is a
 * request the host has already VALIDATED**: `Match` runs every claim gate it
 * has (the rate buckets, the cones, the origin slips, `validateMove` and
 * `validateDrive`) and only then submits — a remote peer's and, offline, the
 * page's own player's alike; only a harness (`server/corecheck.ts`'s core
 * run) submits trusted. Either way the core still refuses what its own state makes
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
 * place of ids the core could not resolve for itself** — the five numbers of
 * the weapon a round leaves that resolving it reads (`ShotWeapon`) rather than
 * its id, the throwable and equipment the host's kit record names, the pouch
 * SIZES a kit fills. One kind has no wire
 * message: `kit` (the wire resolves a kit inside `join`/`deploy`).
 *
 * **A person's HULL is reported, never steered** (`BABYLON_EXIT.md` X2.5a
 * C4b): `drive` and `gun` carry where the host's own prediction put the hull
 * and the cupola gun, and the core poses its copy to them on its next step —
 * every person alike, the offline page's player being a peer of its own
 * `Match` (`BABYLON_EXIT.md` X2.5c). There is no command carrying a stick: raw
 * input is the predicting client's, which is what keeps the hull a person
 * drives the same machine offline and in a match.
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
 * What resolving a person's round reads of the weapon it left — the damage
 * slope and where the ray stops (`SimCore.resolveShot`), and nothing else.
 * A `WeaponSetup` is one (the authority hands its peer's whole loadout row);
 * the page's player's is resolved the same way, off the kit its deploy
 * names. Five numbers rather than the whole setup because that is all
 * resolving a round reads (`BABYLON_EXIT.md` X2.5b): the core had no use for
 * the other thirty.
 */
export type ShotWeapon = Pick<
  WeaponSetup,
  "damage" | "damageFar" | "falloffNear" | "falloffFar" | "range"
>;

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
  weapon: ShotWeapon;
  renderTime?: number;
}

/**
 * A throw: from `origin` along `dir` (unit), `kind` being what the host's
 * kit record says the pouch holds. Spent from the core's pouch only if the
 * pool takes it; any refusal — a full pool, or a body dead, seated or out of
 * grenades — raises `ordnanceRefused` (item `grenade`).
 */
export interface GrenadeCommand {
  t: "grenade";
  origin: Vector3Like;
  dir: Vector3Like;
  kind: ThrowableId;
}

/**
 * A rocket out of the tube (`dir` unit) or a mine at `origin` (`dir`
 * ignored). Spent from the core's pouch only if the pool takes it; any
 * refusal — the pool's, or the body's — raises `ordnanceRefused`.
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
 * measured against (`aimYaw`/`aimPitch`, onto the body). `y` is the hull's
 * FEET (`DriveMessage.pos`'s convention); the core's own probe owns the
 * height of a hull on the ground and the report owns a flying one's
 * (`Vehicle.updateRemote`). It is `validateDrive`'s verdict on a peer's
 * report — offline too, the page's own round being a `Match` — and, on
 * `corecheck`'s bare core, the trusted door, a predicted hull as it stands,
 * submitted straight.
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
  /**
   * The REPORTER's clock, seconds, at the moment the hull stood where this
   * says — any origin, monotonic. What the core reads it for is the interval
   * between two accepted samples: a person's crash is charged off the rate
   * their reports describe (`src/sim/reportedLanding.ts`). It is
   * `DriveMessage.time` — the reporting client's own clock, the offline
   * page's included — and **it is the peer's BOUNDED clock**
   * (`Match.onStamp`), never the raw stamp.
   */
  time: number;
  /**
   * The first report since the authority PUT THIS HULL BACK with a
   * correction that moved it vertically — so the motion between the last
   * sample and this one is the correction's, and the crash test rebases here
   * rather than measuring across it (`reportedLanding.ts`, "A broken
   * series"). The authority's word, never the client's: `Match` sets it only
   * for a `DriveMessage.resync` answering a correction it sent. Absent
   * offline, where nothing is ever corrected.
   */
  resync?: boolean;
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
  | MgCommand;
