/**
 * hullRules.ts — what a hull DOES to the world, stated once for both
 * simulations: a round out of the main gun, a round out of the cupola gun,
 * what the tracks run over, and what a crew owes when its hull brews up.
 * Owns: `fireHullGun`, `fireHullMg`, `crushSweep`, `driverOf` and `crewLost`,
 * and `HullRules`, the context `Game` and `HeadlessGame` each build once to
 * run them against.
 * Invariants: a hull's round goes down the GUN's axis and never the camera's;
 * friendly fire is excluded by construction (every list is the hull's own
 * side's enemies); the direct hit and the splash are two resolutions that
 * cannot double-count a kill, because `blastAt` fetches its targets AFTER the
 * direct hit has been dealt; and every kill goes through `settleKill`, so
 * neither side may restate the credit.
 * Never: draw, sound or shake anything — the light pulse, the report, the
 * camera kick and the hitmarker are the CLIENT's and are driven off what these
 * return — and never import another system: everything below is reached
 * through the context, the `BattleSystem ← CombatSystem` precedent one level
 * along.
 *
 * **There is one of these because there were two**, `Game.resolveShell` and
 * `HeadlessGame.resolveShell` (and the cupola gun's and the tracks' pairs
 * beside them), each the other "with the presentation taken out" — which held
 * until it did not: the client's `creditKill` returned nothing while the
 * authority's said whether it paid, and the credit itself had once been
 * `instanceof Bot` on one side and `!armoured` on the other. A player's tank
 * and a bot's are the same vehicle, online and off, so a second copy of the
 * damage, the splash, the hearing or the crush gate is a second thing to keep
 * in step.
 *
 * **What the two sides still differ in is HANDED IN, never branched on.** In a
 * match the client's copy of a round is a PREDICTION: its targets refuse local
 * damage (`NetSoldier.takeDamage`, `Vehicle.predicted`), so `shot.killed` is
 * false and nothing here can credit a kill, and its `blastAt` declines to draw
 * a splash the authority's `explode` event will draw instead. Neither fact is
 * known in this file.
 */
import { Vector3 } from "@babylonjs/core";
import type { Bot } from "../entities/Bot";
import { OTHER_TEAM, type Combatant, type Team } from "../entities/Combatant";
import { DRIVER, type CrewSeat, type Vehicle } from "../entities/Vehicle";
import type { CombatSystem, Hittable, ShotResult } from "./CombatSystem";
import type { GrenadeSystem } from "./GrenadeSystem";
import { settleKill, type KillLedger } from "./killRules";
import { UNDRAWN } from "./RoundRandom";

/**
 * Everything a hull's rules ask of the rest of the game, built once per
 * simulation. Methods rather than captured values, because what they answer
 * with — the roster, the fleet, whether a match is live — changes under them.
 */
export interface HullRules {
  readonly ledger: KillLedger;
  readonly combat: CombatSystem;
  /** The fleet, as `VehicleSystem.hulls` holds it this round. */
  hulls(): readonly Vehicle[];
  /** What a hull of `team` may put a round into: its enemies, armour included. */
  gunTargets(team: Team): Hittable[];
  /**
   * What a hull of `team` may run over: its enemies' BODIES. `BattleSystem`'s
   * per-team scratch, read inside the sweep — nothing on the kill path asks
   * for another list, which is what makes iterating it safe.
   */
  bodies(team: Team): readonly Combatant[];
  /** The one implementation of a blast — `GrenadeSystem.blastAt`. */
  blastAt(...args: Parameters<GrenadeSystem["blastAt"]>): void;
  /** Bots hear it — `BattleSystem.hearGunshot`. */
  hearGunshot(at: Vector3, team: Team, dir: Vector3): void;
  /** The PERSON in `seat` of `tank`, or null. Asked before the bot crew. */
  personIn(tank: Vehicle, seat: CrewSeat): Combatant | null;
  /** The bot in `seat` of `tank`, or null — `VehicleCrew.crewOf`. */
  crewOf(tank: Vehicle, seat: CrewSeat): Bot | null;
  /**
   * The tracks just killed `victim` for `by`. Presentation only — the kill is
   * already settled — and absent on the authority, which draws nothing.
   */
  onCrushed?(by: Combatant, victim: Combatant): void;
}

/**
 * One round out of a hull's gun, as the caller is handed it. `muzzle` and
 * `dir` are module scratch, valid until the next round is fired — anything
 * that keeps either must copy it.
 */
export interface HullRound {
  muzzle: Vector3;
  dir: Vector3;
  shot: ShotResult;
}

const MUZZLE = new Vector3();
const DIR = new Vector3();
const ROUND: HullRound = { muzzle: MUZZLE, dir: DIR, shot: null! };

/**
 * One round out of a hull's MAIN gun, whoever pulled the trigger. Null when
 * the gun was not loaded — or the hull has none — and a caller handed a null
 * has fired nothing.
 *
 * `by` is whose kill it is: a person, or the crewman inside the hull. It is
 * the ONLY thing that differs between the callers below the trigger. `early`
 * is `Vehicle.fireGun`'s: none for a bot crew, which fires off the hull's own
 * reload on the tick it is ready, and the authority's tolerance for a person's
 * claimed round, which arrives on the network's schedule.
 *
 * No spread: a tank gun is a rifled barrel with a fire-control system, and
 * the thing that makes it hard to hit with is the traverse rate, not a cone.
 * (A bot crew's error is on the AIM POINT instead — see
 * `CONFIG.vehicles.crew.scatter` — which is a ranging mistake rather than a
 * loose barrel, and unlike a cone it is something the driver being shot at can
 * watch the gun make.) No `headMult` either — the head zone is the player's
 * alone and an upgrade to a body hit, and a shell that landed on a body has
 * already spent more than a headshot's worth on it.
 *
 * There is deliberately no rewind on the authority and none is owed. A shell
 * is `blastRadius` wide and slow to reload; the metre a rewind would recover is
 * inside its own splash, and a driver is aiming at a seven-metre hull rather
 * than at a head.
 */
export function fireHullGun(
  ctx: HullRules,
  tank: Vehicle,
  by: Combatant,
  early = 0,
): HullRound | null {
  // `fireGun` refuses on a hull that HAS no gun as well as on one still
  // loading — `Vehicle.gunReady` — so this pair is what keeps every caller of a
  // shell out of a turretless vehicle, offline and on the authority alike.
  const g = tank.spec.gun;
  if (!g || !tank.fireGun(early)) return null;
  const muzzle = tank.muzzleToRef(MUZZLE);
  const dir = tank.gunDirToRef(DIR);
  const shot = ctx.combat.fire(
    muzzle,
    dir,
    0,
    UNDRAWN,
    g.damage,
    muzzle,
    ctx.gunTargets(tank.team),
    g.range,
    tank.shellShot!,
  );
  // The splash, through the one implementation of a blast in the game. `by` is
  // whoever fired, so a kill lands on their row exactly as a grenade's does —
  // the simulation's `onBlastHit` is already wired for it and needed no arm.
  ctx.blastAt(shot.hitPoint, tank.team, by, {
    radius: g.blastRadius,
    inner: g.blastInner,
    damage: g.blastDamage,
    kind: "shell",
    // How big it LOOKS, with the grenade as 1. Deliberately not derived from
    // `blastRadius`, which is SMALLER than a frag's — see `blastPower`.
    power: g.blastPower,
  });
  // The direct hit's own kill. The splash's victims come through `onBlastHit`.
  //
  // **A HULL is not a row on the scoreboard** — `shot.target` can be one, armour
  // being answered by its collider rather than by a sphere (`CombatSystem.fire`),
  // and what a burning tank pays is its CREW, through `crewLost` and the
  // driver's own death. That guard is `paysKiller`'s, inside each side's
  // `creditKill`, so this site says only WHEN.
  if (shot.killed && shot.target) {
    settleKill(ctx.ledger, by, shot.target, tank.team, "shell");
  }
  // Bots hear a tank gun the way they hear a rifle — this is the only place
  // armour enters the world as a noise. The TANK's side rather than the
  // crewman's: a hull the AI is driving is heard by the other team exactly as
  // one a person is driving is.
  ctx.hearGunshot(muzzle, tank.team, dir);
  ROUND.shot = shot;
  return ROUND;
}

/**
 * One round out of a hull's CUPOLA gun, whoever pulled the trigger. Null when
 * the rate limit has not come round.
 *
 * **`fireHullGun`'s shape with the two halves of a shell taken out**, and what
 * is left is nearly a rifleman's shot: a SPREAD (which the main gun
 * deliberately has none of), fall-off (likewise), and no blast at all. What it
 * keeps from the gun beside it is the world frame: the round goes down the
 * GUN's axis, which is why a second marker is drawn for it.
 *
 * No rewind on the authority, for a different reason than the shell's: one of
 * nine rounds a second down a cone `mg.spread` wide, so the metre a rewind
 * would recover is inside the cone the same burst is already spraying. A
 * machine gun could not kill a hull anyway (`resist.bullet` is 0.05), and the
 * credit is refused inside `creditKill` regardless.
 */
export function fireHullMg(
  ctx: HullRules,
  tank: Vehicle,
  by: Combatant,
  early = 0,
): HullRound | null {
  if (!tank.fireMg(early)) return null;
  const m = tank.spec.mg;
  const muzzle = tank.mgMuzzleToRef(MUZZLE);
  const dir = tank.mgDirToRef(DIR);
  const shot = ctx.combat.fire(
    muzzle,
    dir,
    m.spread,
    tank.mgRand,
    m.damage,
    muzzle,
    ctx.gunTargets(tank.team),
    m.range,
    tank.mgShot,
  );
  if (shot.killed && shot.target) {
    settleKill(ctx.ledger, by, shot.target, tank.team, "mg");
  }
  ctx.hearGunshot(muzzle, tank.team, dir);
  ROUND.shot = shot;
  return ROUND;
}

/**
 * Whose kill a hull's tracks make, or null for a hull nobody is driving.
 *
 * The DRIVER's and never the gunner's: the man on the cupola gun moves
 * nothing, and a hull's two seats can be held by two different kinds of thing
 * at once — which is why this is asked the two ways `VehicleSystem`'s orders
 * are, a person on the sticks first and the bot crew after.
 */
function driverOf(ctx: HullRules, tank: Vehicle): Combatant | null {
  return ctx.personIn(tank, DRIVER) ?? ctx.crewOf(tank, DRIVER);
}

/**
 * What the TRACKS killed this frame: every enemy body a moving hull is
 * standing in, put down and credited to whoever is driving. Run right after
 * `VehicleSystem.update` on both sides.
 *
 * **This is the one thing armour does that is not a weapon**, and it exists
 * because of a rule this game cannot bend: a tank is in no baked structure, so
 * `NavGrid`, `CoverMap` and `ObstacleField` have never heard of one and bots
 * walk through a hull exactly as they walk through a corpse.
 * `moveWithCollisions` is no answer either — it sweeps the HULL out of the
 * world's boxes, and a body is not one of them, so a driver could put eleven
 * metres a second through a squad and the squad would stand in the street
 * unmoved.
 *
 * **On the authority every hull is swept, including the ones a PERSON is
 * driving.** A driven hull is posed there from the wire, but `updateRemote`
 * measures `speed` out of the ground it covered precisely so that everything
 * downstream reads a remote hull the way it reads a local one. Nothing about
 * it is predicted on a client: in a match `updateWorld` never runs there, and
 * the driver sees the kill when the authority's killfeed says so.
 *
 * The three gates are each doing a job. `alive` keeps a WRECK from mowing down
 * whatever it was rolling toward when it died — `speed` is not zeroed by
 * dying. `minSpeed` is what makes this running somebody over rather than
 * standing on them, and the reason it is not optional is in `CONFIG…crush`:
 * bots walk into parked armour all round. And a hull with nobody driving it
 * crushes nobody, which is less a rule than an arithmetic fact given `by` is
 * what a kill is credited to.
 */
export function crushSweep(ctx: HullRules): void {
  for (const tank of ctx.hulls()) {
    // The gates are the HULL's own — a truck has to be moving faster than a
    // tank does before its wheels are a run-over rather than a shove, which is
    // `VehicleSpec.crush` and is why this is read inside the loop.
    const c = tank.spec.crush;
    if (!tank.alive || Math.abs(tank.speed) < c.minSpeed) continue;
    const by = driverOf(ctx, tank);
    if (!by) continue;
    for (const target of ctx.bodies(tank.team)) {
      // A hull is skipped because armour does not run armour over — two hulls
      // have colliders and stop each other — and because `takeDamage` on one
      // would spend `resist.bullet` on a body-shaped blow. A body riding in one
      // is skipped for `GrenadeSystem.blastAt`'s reason: while a person is
      // inside armour the ARMOUR is what is being hit, and this path reaches
      // `takeDamage` directly rather than through the one door
      // (`CombatSystem.fire`) that already asks. Without it, two hulls shoving
      // each other would kill the driver inside the one that got shoved.
      if (target.armoured || target.invulnerable) continue;
      // `position` is the feet and `center` the chest — see `Vehicle.crushes`,
      // which asks the two heights different questions.
      if (!tank.crushes(target.center, target.position.y, target.hitRadius)) {
        continue;
      }
      // `tank.center` is the bearing the blow came from, which throws the
      // corpse clear of the hull instead of leaving it folded under the
      // tracks, and is what the killfeed derives an enemy team from when the
      // victim is a person. `"crush"` is what it was, and all it decides is
      // that the body LEAVES — see `RagdollSystem.applyImpulse`.
      if (!target.takeDamage(c.damage, tank.center, "crush")) continue;
      // The driver's row, whoever went under the tracks — a person is in this
      // list too, so a bot crew running one down is a credited kill.
      settleKill(ctx.ledger, by, target, tank.team, "tracks");
      ctx.onCrushed?.(by, target);
    }
  }
}

/**
 * What a bot crewman owes when the hull he rode brews up. The body has
 * already been put down beside the wreck and handed back to the fight by
 * `VehicleCrew`, so there is nothing to do but kill it through the door every
 * other bot death takes.
 *
 * `tank.center` as the bearing and `"shell"` as what it was: a crewman is
 * thrown clear of his own hull, which is the only reading of a burning tank
 * that is not a man lying down beside one, and it takes BOTH — a round drops a
 * body where an explosion throws it. A person inside the same hull dies of the
 * same pair, through each simulation's own `onDestroyed`.
 *
 * **The ONE door that credits nobody**, and the reason `DeathCause` has a
 * `crew`: the rocket or the shell that destroyed the hull was paid at its own
 * door, against the HULL, which `paysKiller` refuses.
 */
export function crewLost(ledger: KillLedger, bot: Bot, tank: Vehicle): void {
  if (bot.takeDamage(bot.hp, tank.center, "shell")) {
    ledger.botDown(bot, OTHER_TEAM[bot.team], null, "crew", false, false);
  }
}
