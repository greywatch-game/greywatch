/**
 * TankCrew.ts — The bots that drive. Which body is inside which hull, where
 * that hull is being taken, and what its gun is laid on.
 * Owns: the (bot, hull) pairing, one small FSM per crew, and the drive input
 * every crewed hull is stepped with.
 * Owns NO hull and no body: `VehicleSystem` builds the armour and
 * `BattleSystem` holds the roster. This asks both of them questions through a
 * `CrewCtx` `Game` builds once, exactly as `BattleSystem` asks the world
 * through a `BattleCtx` — nothing in here reaches for another system, and
 * everything it announces goes out as a callback `Game` wires.
 *
 * ## What a bot in a tank IS
 *
 * It is not a soldier with a vehicle attached. Every part of `Bot`'s FSM —
 * cover, the peek cycle, the crouch, the separation, the flow field walked a
 * cell at a time — is about a body standing up, and none of it survives
 * contact with a seven-metre hull. So a crewed bot is taken OUT of the fight
 * for as long as it is inside, exactly as the player is (`Game.mount`
 * hides the body, makes it invulnerable and takes it out of
 * `BattleSystem`'s human list), and this file is the second brain that drives
 * in its place.
 *
 * The bot keeps three things while it is in there, and each is load-bearing:
 *
 * - **Its life.** It is still `alive`, still holds its roster slot, still owns
 *   its row on the scoreboard. Burning the hull kills the crew and charges the
 *   ticket, through the ordinary door.
 * - **Its position**, slaved to the hull every frame (`Bot.nudgeTo`). So the
 *   conquest occupancy count, the minimap blip and its squad's centroid all go
 *   on answering "where is that body" with "in that tank" — which means **a
 *   bot-crewed tank parked on a flag captures it**, exactly as the player's
 *   does and for the identical reason.
 * - **Its squad's objective.** `Bot.objective` is what `ConquestSystem.planSquads`
 *   wrote there, and the driver steers on that flag's flow field. The tank
 *   goes where its crewman's squad was going, so armour needs no objective
 *   planner of its own and can never disagree with the one the round already
 *   has.
 *
 * ## The road graph it does not need
 *
 * `docs/vehicles.md` listed an AI driver as not built, and gave the reason: a
 * hull cannot use `NavGrid`, whose node is a body's standing surface. That is
 * still true, and it turns out not to be the blocker — because a driver does
 * not need a route, it needs two much smaller things:
 *
 * 1. **A bearing**, which the body's flow field gives perfectly well at map
 *    scale. Coldharbour's avenues are 16 m wide and the field runs down the
 *    middle of them; what it gets wrong is the last few metres, where it
 *    offers a 1.6 m doorway.
 * 2. **"Is that way a wall?"**, which is `Tank.rideableAt` — the same
 *    analytic climb-band query the hull already answers ten times a frame to
 *    stand on its tracks, spent on where it is about to be instead of where it
 *    is. A fan of whiskers over it turns the body's bearing into a hull's.
 *
 * Between them they are a road graph evaluated locally and never baked, which
 * is the only kind a moving thing could be in anyway — the same argument that
 * keeps a hull out of `NavGrid`, `CoverMap` and `ObstacleField` in the first
 * place.
 *
 * What is left over is caught by the stuck watchdog, and that is deliberate
 * rather than a gap: there is one route graph and no second one to pick, so a
 * driver aimed at a doorway backs out and comes at it again — `Bot.stuckT`'s
 * answer to the identical problem one scale down.
 *
 * ## What it never does
 *
 * - **It never denies the player their own armour.** A bot crew is evicted the
 *   moment a player of the same side asks for the seat (`evict`), so armour is
 *   something the AI uses while nobody else wants it. Without that a single
 *   hull per side means a coin toss on whether the player ever drives.
 * - **It never steals the other side's.** `board` is team-locked for the same
 *   reason `VehicleSystem.enterable` is.
 * - **It never gets out on its own.** The crew leaves by being evicted or by
 *   the hull burning, and nothing else — a bot that could abandon a hull would
 *   need to know when a tank is a liability, which is a judgement no number
 *   here could make honestly.
 */
import { Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { Bot } from "../entities/Bot";
import type { Combatant, Team } from "../entities/Combatant";
import { angleDelta, type DriveInput, type Tank } from "../entities/Tank";
import type { GameMap } from "../world/MapBuilder";
import type { NavGrid } from "../world/NavGrid";

/** What a crew is allowed to know about the rest of the game. */
export interface CrewCtx {
  /**
   * Every hull on the field, live or wrecked, and the whole bot roster — dead
   * and benched included, because the crew filters both itself.
   *
   * Calls rather than fields: what `VehicleSystem` and `BattleSystem` hand out
   * are live lists whose contents are replaced every round, and a reference
   * captured when this context was built would be last round's.
   */
  hulls(): readonly Tank[];
  roster(): readonly Bot[];
  /**
   * Is this bot out of the fight for somebody else's reason — a human in its
   * slot, or a hull it is already inside? A bot that is aside may not be given
   * a seat.
   */
  aside(bot: Bot): boolean;
  /**
   * Takes or gives up a seat. Routed rather than written here because
   * `VehicleSystem.setOccupied` is the ONE writer of `Tank.occupied`, and two
   * writers is how a hull ends up offered to somebody already sitting in it.
   */
  setOccupied(tank: Tank, on: boolean): void;
  /** Where a body stepping out of this hull is put down. Scratch — consume it. */
  exitSpot(tank: Tank): Vector3;
  /** Living enemies of `team`. Scratch — consume it inside the call. */
  targetsFor(team: Team): readonly Combatant[];
  /**
   * Is `to` visible from this hull's cupola? One ray, budgeted by this
   * system's think clock.
   *
   * **The HULL is passed rather than a point, because the answer is wrong
   * without it.** A crew's eye is `Tank.eyePos`, five centimetres above the
   * top of its own collider box, and any target lower than the cupola puts the
   * sightline back down through that box within the hull's own length — so a
   * tank could see nothing at all in front of it. Measured on Coldharbour: no
   * line of sight to a body standing in the open at 20, 25, 30, 40 or 50 m
   * dead ahead. The fix is `docs/vehicles.md`'s own — take the hull out of the
   * pick for the length of the call — and it is the caller's to make, because
   * `world/solid.ts` forbids minting a predicate that closes over one.
   */
  visibleFrom(tank: Tank, to: Vector3): boolean;
  /**
   * Fires this hull's gun, resolved by `Game` exactly as the player's shell
   * is — same damage, same blast, same one implementation. `by` is who the
   * kill belongs to.
   *
   * The crew must have checked `Tank.gunReady` first: this spends the round in
   * the breech, and a caller that fires a gun that is not loaded gets nothing
   * and learns nothing, exactly as `GrenadeSystem.throwAlong`'s callers must.
   */
  fireShell(tank: Tank, by: Bot): void;
}

/** One body in one hull, and everything it is in the middle of doing. */
interface Crew {
  readonly bot: Bot;
  readonly tank: Tank;
  /** Rewritten in place every frame; `VehicleSystem` reads it through `driveFor`. */
  readonly drive: DriveInput;
  /** What the gun is laid on, held across think ticks exactly as `Bot.target` is. */
  target: Combatant | null;
  /**
   * This crew's ranging error, in metres, added to the target's eye to make
   * the point the gun is actually laid on. Drawn ONCE per acquisition and
   * after every round fired, never per frame — a scatter redrawn on the think
   * clock is wider than `fireCone` at any useful range, so the gun would never
   * settle and the trigger would never go.
   */
  readonly aimAt: Vector3;
  /** Seconds until the next acquisition. */
  thinkT: number;
  /** How long the gun has been settled inside `fireCone`. See `layTime`. */
  layT: number;
  /** How long the hull has been asking for speed it is not getting. */
  stuckT: number;
  /** While positive, the hull is backing out of whatever it walked into. */
  reverseT: number;
  /**
   * The world bearing the hull has committed to going round something on, and
   * how long is left on it. See `CONFIG.vehicles.crew.detourTime` — without
   * the commitment the fan re-picks from a hull that has just turned, and the
   * driver saws on the spot instead of getting past the building.
   */
  detourYaw: number;
  detourT: number;
  /** Which way it steers while doing that. Fixed per crew — see `reverseSteer`. */
  readonly reverseSide: number;
  /** Set by `remove`, so a crew disbanded mid-sweep is skipped rather than stepped. */
  left: boolean;
}

// Module scratch. This runs every frame for every crewed hull; nothing below
// allocates.
const _dir = new Vector3();
const _aim = new Vector3();
/**
 * Where across the hull's beam each whisker is sampled, as a fraction of the
 * half-width.
 *
 * **Seven, and the number is set by the narrowest thing a tank must not drive
 * into.** `NavGrid`'s whole sub-cell problem is that one column per 1.5 m cell
 * centre misses anything narrower than a cell, and this is the same failure at
 * vehicle scale: at three points the samples are 1.7 m apart and Coldharbour's
 * shopfront colonnades — 0.6 m pillars on a 3.3 m pitch — fall between them,
 * so a driver read a building frontage as open street and put its nose into
 * the stone. Seven puts them 0.57 m apart, which is inside the pillar.
 *
 * It costs nothing in the common case: `clearAlong` returns at its first
 * failed probe, so a blocked bearing is one or two lookups and only a CLEAR
 * one pays for the whole grid.
 */
const WHISKER_LATERAL = [0, 0.34, -0.34, 0.67, -0.67, 1, -1] as const;
/**
 * How far along a whisker each probe sits, as a fraction of `whiskerReach`
 * past the hull's own nose.
 *
 * **The first one is AT the nose for a reason that cost a measured hour.**
 * With the probes spread evenly the nearest sat a third of the reach past the
 * nose — nearly four metres — so anything closer than that was invisible to
 * the driver. On a straight approach that never showed, because the wall had been
 * seen further out on the way in; it showed the moment the hull TURNED, which
 * swings a bearing whose near field has never been probed onto a wall that is
 * already alongside. Measured on Coldharbour, a crew reached 129 m from its
 * objective and then spent the rest of the run grinding against the same
 * corner, backing out and driving straight back into it.
 *
 * Four rather than three because adding the near probe to three left a 5 m
 * gap in the middle, which is a parked car's worth of room to hide in.
 */
const WHISKER_DEPTHS = [0, 0.28, 0.6, 1] as const;

export class TankCrew {
  private readonly crews: Crew[] = [];
  /**
   * The sweep's own copy of the list. A crew can be disbanded from inside the
   * sweep — a shell fired on this tick destroys the other hull, whose crew
   * dies with it — and splicing the array being walked skips a neighbour.
   * Held rather than built, for the reason `VehicleSystem.fleet` is.
   */
  private readonly sweep: Crew[] = [];
  private nav: NavGrid | null = null;
  private boardT = 0;

  /**
   * Wired by `Game`: this bot is now inside a hull, or is no longer. Both are
   * one-way announcements — what being crewed COSTS a bot (its place in every
   * target list, every think tick and every movement pass) is
   * `BattleSystem`'s to apply, exactly as `Game.mount` applies it to the
   * player by hand.
   */
  onBoarded: (bot: Bot, tank: Tank) => void = () => {};
  onLeft: (bot: Bot, tank: Tank) => void = () => {};
  /**
   * Wired by `Game`: this crewman's hull burned and he is dead in it. Raised
   * with the body already put down beside the wreck and already back in the
   * fight, so the handler has nothing to do but kill it through the ordinary
   * door — the same shape `VehicleSystem.onDestroyed` hands the player's own
   * death to `wireVehicles`.
   */
  onCrewLost: (bot: Bot, tank: Tank) => void = () => {};

  constructor(private ctx: CrewCtx) {}

  /**
   * The map's nav graph, for the bearing half of the drive. Null on a map with
   * no armour and in the editor, where this system is asked nothing.
   */
  setMap(map: GameMap | null): void {
    this.nav = map?.nav ?? null;
  }

  /** The bot inside this hull, or null. What `Game` asks before offering a seat. */
  crewOf(tank: Tank): Bot | null {
    for (const crew of this.crews) if (crew.tank === tank) return crew.bot;
    return null;
  }

  /**
   * What this hull is being told to do, or null when nobody is in it.
   * `VehicleSystem` asks once per hull per frame through `Game`'s orders
   * object; the drive itself was written by `update` earlier in the same
   * frame, exactly as the player's is written by `updateDriver`.
   */
  driveFor(tank: Tank): DriveInput | null {
    for (const crew of this.crews) if (crew.tank === tank) return crew.drive;
    return null;
  }

  /**
   * Puts this hull's bot crew out beside it and hands the seat back. Returns
   * the bot, or null when nobody was in there.
   *
   * **This is what stops the AI taking a side's only tank for the round.** A
   * player walking up to their own crewed hull is offered it exactly as they
   * are offered an empty one, and pressing the key evicts whoever is inside —
   * armour is something the bots use while nobody else wants it.
   */
  evict(tank: Tank): Bot | null {
    const crew = this.crews.find((c) => c.tank === tank);
    if (!crew) return null;
    const bot = crew.bot;
    this.remove(crew);
    // Beside the hull and back on its feet, in that order: the rig has been
    // disabled for the whole drive and a body re-enabled at the middle of a
    // tank is standing inside a live collider.
    bot.nudgeTo(this.ctx.exitSpot(tank));
    // `alive` rather than `true`: the defensive sweep in `update` reaches here
    // with a body that is already dead, and a re-enabled corpse is a soldier
    // standing to attention beside the wreck he burned in.
    bot.setEnabled(bot.alive);
    return bot;
  }

  /**
   * This hull has been destroyed. Whoever was inside dies with it.
   *
   * The body is put down beside the wreck BEFORE it is killed, for the reason
   * `wireVehicles` puts the player down before killing them: the ragdoll is
   * built from where this rig stands, and a corpse dropped at the middle of a
   * hull that keeps its collider for the whole wreck clock falls through the
   * one solid thing in the street.
   */
  hullDestroyed(tank: Tank): void {
    const bot = this.evict(tank);
    if (bot) this.onCrewLost(bot, tank);
  }

  /**
   * Everybody out, without killing anybody. The round is ending or the map is
   * being rebuilt, and a crew left pointing at a disposed hull is the same
   * stale pointer `Game.installMap`'s `clearVehicle` exists to prevent.
   */
  clear(): void {
    for (let i = this.crews.length - 1; i >= 0; i--) {
      const crew = this.crews[i];
      this.remove(crew);
      crew.bot.setEnabled(crew.bot.alive);
    }
    this.boardT = 0;
  }

  /**
   * One frame of every crewed hull, plus the boarding sweep on its own slow
   * clock.
   *
   * Runs BEFORE `VehicleSystem.update` in `Game.updateWorld`, because what it
   * writes is the input that step consumes — the same ordering the player's
   * own drive has, where `updateDriver` fills `Game.drive` before the world
   * moves anything.
   */
  update(dt: number): void {
    this.boardT -= dt;
    if (this.boardT <= 0) {
      this.boardT = CONFIG.vehicles.crew.boardDelay;
      this.board();
    }
    if (this.crews.length === 0) return;

    this.sweep.length = 0;
    for (const crew of this.crews) this.sweep.push(crew);
    for (const crew of this.sweep) {
      if (crew.left) continue;
      // A hull that died some other way than through `hullDestroyed` — there
      // is no such path today, and this is what keeps a crew from steering a
      // wreck if one ever appears.
      if (!crew.tank.alive || !crew.bot.alive) {
        this.evict(crew.tank);
        continue;
      }
      this.stepCrew(dt, crew);
    }
  }

  // --- the seat ------------------------------------------------------------

  /**
   * Hands every empty hull the nearest body of its own side that is standing
   * close enough to climb in.
   *
   * **A tank is never a DESTINATION.** No flow field leads to one, no squad is
   * ordered to man it, and nothing pulls a bot off the fight to go and fetch
   * armour — the crew is simply whoever walks past, which on Coldharbour is
   * every reinforcement, because the hardstandings are in the same two corner
   * yards as the home spawns. Making it a destination instead would be the
   * contact call's mistake at a larger scale: a squad that walks to the tank
   * is a squad not walking to the flag, and the flag is what wins.
   */
  private board(): void {
    const c = CONFIG.vehicles.crew;
    const reach = c.boardRadius * c.boardRadius;
    for (const tank of this.ctx.hulls()) {
      if (!tank.alive || tank.occupied) continue;
      let best: Bot | null = null;
      let bestDist = reach;
      for (const bot of this.ctx.roster()) {
        if (!bot.alive || bot.team !== tank.team || this.ctx.aside(bot)) continue;
        const d = Vector3.DistanceSquared(bot.position, tank.center);
        if (d < bestDist) {
          bestDist = d;
          best = bot;
        }
      }
      if (best) this.take(best, tank);
    }
  }

  /** Puts `bot` in `tank`. The exact inverse of `remove`; read them as a pair. */
  private take(bot: Bot, tank: Tank): void {
    this.crews.push({
      bot,
      tank,
      // Started on the hull's own heading rather than at zero: a turret asked
      // for world yaw 0 on the frame the crew arrives traverses to due north
      // before it does anything useful.
      drive: { throttle: 0, steer: 0, aimYaw: tank.turretYaw, aimPitch: 0 },
      target: null,
      aimAt: new Vector3(),
      thinkT: 0,
      layT: 0,
      stuckT: 0,
      reverseT: 0,
      detourYaw: 0,
      detourT: 0,
      // Fixed per crew and split by side, so the two hulls on a map do not
      // both shoulder the same way out of the same street.
      reverseSide: tank.team === 0 ? 1 : -1,
      left: false,
    });
    this.ctx.setOccupied(tank, true);
    // The rig goes away for the same reason the player's viewmodel does: there
    // is no crewman modelled on this hull, and a soldier standing at the
    // middle of a moving tank is a body being dragged through the street.
    bot.setEnabled(false);
    bot.target = null;
    this.onBoarded(bot, tank);
  }

  /** Takes a crew off the books. `take`'s inverse, and it moves nothing. */
  private remove(crew: Crew): void {
    const at = this.crews.indexOf(crew);
    if (at < 0) return;
    this.crews.splice(at, 1);
    crew.left = true;
    this.ctx.setOccupied(crew.tank, false);
    this.onLeft(crew.bot, crew.tank);
  }

  // --- one crew's frame ----------------------------------------------------

  private stepCrew(dt: number, crew: Crew): void {
    // The body rides the hull, for the reasons `Game.updateDriver` slaves the
    // player's: every downstream reader asks where this body is, and the
    // honest answer is "in that tank".
    crew.bot.nudgeTo(crew.tank.position);

    crew.thinkT -= dt;
    if (crew.thinkT <= 0) {
      crew.thinkT = 1 / CONFIG.vehicles.crew.thinkRate;
      this.acquire(crew);
    }
    this.lay(dt, crew);
    this.steer(dt, crew);
    this.shoot(crew);
  }

  /**
   * What the gun is looking for, on the crew's own think clock.
   *
   * `BattleSystem.acquire`'s shape and its budget: a held target is kept while
   * it is still valid, and a fresh one costs the single ray that proves the
   * nearest candidate is actually visible. The hysteresis is worth exactly
   * what it is worth to a rifleman — `layTime` is a wind-up, and a target that
   * flips every tick is a gun that never finishes laying.
   *
   * **Armour outranks infantry**, which is the one rule here that is not the
   * infantry version of itself: a tank's gun is the only thing on the field
   * that reliably kills another tank, and a crew that shot at whichever body
   * was nearest while an enemy hull manoeuvred past it would be spending the
   * one weapon that mattered on the one target that did not.
   */
  private acquire(crew: Crew): void {
    const c = CONFIG.vehicles.crew;
    const tank = crew.tank;
    const range = c.engageRange;
    const held = crew.target;
    if (
      held &&
      held.alive &&
      Vector3.Distance(tank.center, held.position) < range &&
      this.ctx.visibleFrom(tank, held.eyePos)
    ) {
      return;
    }
    crew.target = null;

    // One pass, no sort and no allocation, and it keeps TWO candidates rather
    // than one: the nearest hull and the nearest body. Ray-testing every
    // candidate would be up to sixteen picks per think for a target the crew
    // is going to hold for seconds, and keeping only the winner would mean an
    // enemy hull behind a building blinding this crew to the infantry standing
    // beside it — the armour preference is worth a ray, not a whole think.
    let bestHull: Combatant | null = null;
    let hullDist = Infinity;
    let bestBody: Combatant | null = null;
    let bodyDist = Infinity;
    for (const t of this.ctx.targetsFor(tank.team)) {
      if (!t.alive) continue;
      const d = Vector3.Distance(tank.center, t.position);
      if (d >= range) continue;
      if (t.armoured) {
        if (d < hullDist) {
          hullDist = d;
          bestHull = t;
        }
      } else if (d < bodyDist) {
        bodyDist = d;
        bestBody = t;
      }
    }
    // Armour first at any range, then the nearest body. Two rays at the very
    // worst, and only when there is something of each kind in range.
    if (bestHull && this.ctx.visibleFrom(tank, bestHull.eyePos)) {
      crew.target = bestHull;
      this.drawLay(crew);
      return;
    }
    if (bestBody && this.ctx.visibleFrom(tank, bestBody.eyePos)) {
      crew.target = bestBody;
      this.drawLay(crew);
    }
  }

  /**
   * Redraws this crew's ranging error onto the target it has just acquired,
   * or has just fired at.
   *
   * `CONFIG.antiTankBots.scatter`'s counterpart from the other end of the same
   * duel, and it is held for the length of a lay rather than jittered per
   * frame for a mechanical reason as well as a feel one: the scatter at useful
   * range is wider than `fireCone`, so a point that moved every tick is a gun
   * that never settles and a trigger that never goes.
   */
  private drawLay(crew: Crew): void {
    const c = CONFIG.vehicles.crew;
    const target = crew.target;
    if (!target) return;
    const d = Vector3.Distance(crew.tank.center, target.position);
    const spread = c.scatter * Math.min(1, d / c.engageRange);
    crew.aimAt.set(
      (Math.random() * 2 - 1) * spread,
      (Math.random() * 2 - 1) * spread * 0.4,
      (Math.random() * 2 - 1) * spread,
    );
  }

  /**
   * Where the gun is ASKED to point. Never where it points — the turret walks
   * there at `traverseRate` and `Tank` is the only thing that moves it, which
   * is the whole of why a hull's reticle cannot lie.
   *
   * The angles are solved from the MUZZLE rather than from the hull's centre,
   * and it converges rather than chasing its own tail: the barrel tip is four
   * metres ahead of the trunnion and rises with elevation, so an order laid
   * from the hull puts the shell most of a metre low at close range. Taken
   * from where the muzzle actually is this frame, the order and the gun walk
   * toward each other and settle on the angle that puts the round on the
   * point.
   */
  private lay(dt: number, crew: Crew): void {
    const tank = crew.tank;
    const d = crew.drive;
    const target = crew.target;
    if (!target) {
      // Nothing to shoot: the gun rides the hull's heading, so a tank driving
      // into a street arrives with the barrel already pointing down it.
      d.aimYaw = tank.yaw;
      d.aimPitch = 0;
      crew.layT = 0;
      return;
    }
    _aim.copyFrom(target.eyePos).addInPlace(crew.aimAt);
    const from = tank.muzzleToRef(_dir);
    const dx = _aim.x - from.x;
    const dy = _aim.y - from.y;
    const dz = _aim.z - from.z;
    d.aimYaw = Math.atan2(dx, dz);
    d.aimPitch = Math.atan2(dy, Math.hypot(dx, dz));

    // How long the gun has been where it was asked to be. Both axes, because a
    // shell that is on the bearing and a degree high is a shell over the roof.
    const c = CONFIG.vehicles.crew;
    const off =
      Math.abs(angleDelta(tank.turretYaw, d.aimYaw)) +
      Math.abs(tank.gunPitch - d.aimPitch);
    crew.layT = off < c.fireCone ? crew.layT + dt : 0;
  }

  /** The trigger. `Tank.fireGun` is what refuses a round that is not loaded. */
  private shoot(crew: Crew): void {
    if (!crew.target || !crew.tank.gunReady) return;
    if (crew.layT < CONFIG.vehicles.crew.layTime) return;
    crew.layT = 0;
    this.ctx.fireShell(crew.tank, crew.bot);
    // A fresh lay for the next round: a crew that fired three shells at the
    // same wrong point would be a crew that cannot correct, which is worse
    // than one that cannot aim.
    this.drawLay(crew);
  }

  /**
   * The throttle and the stick: where the hull is being taken, and how it gets
   * round what is in the way.
   *
   * Two sources for the bearing and they are not blended. With a target the
   * hull faces it and holds `standoff` — front armour to the threat, and the
   * turret spared having to traverse against a hull turning under it. With no
   * target it follows its crewman's squad objective down the body flow field.
   * A tank that tried to do both at once drives sideways past the fight it is
   * in.
   */
  private steer(dt: number, crew: Crew): void {
    const c = CONFIG.vehicles.crew;
    const tank = crew.tank;
    const d = crew.drive;

    if (crew.reverseT > 0) {
      // Backing out of whatever the flow field walked us into. No whiskers:
      // the hull is retracing ground it has just covered, and the watchdog
      // below is the thing that decides when it has had enough.
      crew.reverseT -= dt;
      d.throttle = -1;
      d.steer = crew.reverseSide * c.reverseSteer;
      return;
    }

    // A detour already under way outranks both the route and the target, and
    // is dropped the moment the bearing it committed to stops being clear —
    // so a commitment can never drive the hull into something that was not
    // there when it was made.
    if (crew.detourT > 0) {
      crew.detourT -= dt;
      if (!this.clearAlong(tank, crew.detourYaw)) crew.detourT = 0;
    }
    let wantYaw = tank.yaw;
    let closing = 0;
    const target = crew.target;
    if (crew.detourT > 0) {
      // Held rather than returned on, so the watchdog at the bottom still
      // reads this frame's throttle: a hull that gets wedged while committed
      // to a detour has to be able to back out of it like any other.
      wantYaw = crew.detourYaw;
      closing = 1;
    } else if (target) {
      const dx = target.position.x - tank.position.x;
      const dz = target.position.z - tank.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 1e-3) wantYaw = Math.atan2(dx, dz);
      closing =
        dist > c.standoff * 1.2
          ? c.engageThrottle
          : dist < c.standoff * 0.7
            ? -c.engageThrottle
            : 0;
    } else if (this.route(tank, crew.bot.objective)) {
      wantYaw = Math.atan2(_dir.x, _dir.z);
      closing = 1;
    }

    // The whiskers turn a body's bearing into a hull's. Only ever asked while
    // driving FORWARD: they probe ahead of the nose, and a hull backing off a
    // target is covering ground it has just driven over.
    if (closing > 0 && crew.detourT <= 0) {
      const clear = this.pickBearing(tank, wantYaw);
      if (clear === null) {
        // Boxed in. Straight to the watchdog rather than grinding: there is no
        // second route to pick, so backing out and coming again IS the plan.
        crew.stuckT = 0;
        crew.reverseT = c.reverseTime;
        d.throttle = 0;
        d.steer = 0;
        return;
      }
      // Far enough off the route to be going ROUND something: commit to it,
      // or the next frame's fan — read from a hull that has begun to turn —
      // hands back the mirror bearing and the driver saws in place.
      if (Math.abs(angleDelta(wantYaw, clear)) > c.detourAngle) {
        crew.detourYaw = clear;
        crew.detourT = c.detourTime;
      }
      wantYaw = clear;
    }

    this.driveOn(crew, wantYaw, closing);

    // The watchdog. Asking for speed and not getting it is the one symptom of
    // every way a hull can be wrong about the world — a doorway it does not
    // fit through, a bollard the whiskers threaded, another tank in the way.
    if (Math.abs(d.throttle) > 0.2 && tank.travel < c.stuckSpeed) {
      crew.stuckT += dt;
      if (crew.stuckT >= c.stuckTime) {
        crew.stuckT = 0;
        crew.detourT = 0;
        crew.reverseT = c.reverseTime;
      }
    } else {
      crew.stuckT = 0;
    }
  }

  /**
   * The stick and the throttle for one bearing, written in the one place both
   * the routed drive and a committed detour go through.
   *
   * **The throttle falls away with the heading error rather than being held
   * flat**, so a hull facing the wrong way pivots on the spot — which this
   * vehicle can do at a standstill — instead of driving a long arc into
   * whatever is beside it. Inside `driveCone` it is full, and it reaches
   * nothing at a right angle.
   */
  private driveOn(crew: Crew, wantYaw: number, closing: number): void {
    const c = CONFIG.vehicles.crew;
    const err = angleDelta(crew.tank.yaw, wantYaw);
    crew.drive.steer = Math.max(-1, Math.min(1, err * c.steerGain));
    const slack = Math.abs(err) - c.driveCone;
    const fall =
      slack <= 0 ? 1 : Math.max(0, 1 - slack / (Math.PI / 2 - c.driveCone));
    crew.drive.throttle = closing * fall;
  }

  /**
   * The bearing the crewman's squad objective is in, into `_dir`. False when
   * there is no route — no map, no objective, or the hull has arrived and the
   * field has nothing better to offer, which is the natural way a tank stops
   * driving and just fights.
   *
   * `steerAhead` rather than `steer` for the reason bots use it, only more so:
   * `steer` aims at the next cell CENTRE, which is a 1.5 m zigzag under a body
   * and a 7.2 m hull sawing down a street.
   */
  private route(tank: Tank, objective: string): boolean {
    if (!this.nav || !objective) return false;
    const field = this.nav.field(objective);
    if (!field) return false;
    this.nav.steerAhead(field, tank.position, CONFIG.vehicles.crew.lookahead, _dir);
    return _dir.lengthSquared() > 1e-6;
  }

  /**
   * The whisker fan: the bearing nearest the one wanted that this hull can
   * actually drive down, or null when none of them is.
   *
   * Tried in order of deviation — straight on, then a step each side, then two
   * — so the answer is always the least detour that works, and the common case
   * costs one bearing's worth of probes.
   */
  private pickBearing(tank: Tank, wantYaw: number): number | null {
    const c = CONFIG.vehicles.crew;
    const steps = Math.max(1, Math.floor(c.whiskers / 2));
    // Which side of the fan is walked first: the one the hull is ALREADY
    // pointed at. It is the difference between a driver that commits to going
    // round a building and one that reconsiders every frame — a symmetric fan
    // hands back the mirror-image bearing the moment the hull's own turn makes
    // the other side a hair nearer, and the hull saws. It costs nothing: both
    // sides are tried at every deviation, only the order changes.
    const bias = angleDelta(wantYaw, tank.yaw) >= 0 ? 1 : -1;
    for (let i = 0; i < c.whiskers; i++) {
      // 0, +1, -1, +2, -2, ... : deviation ascending, sides alternating.
      const k = i === 0 ? 0 : (i & 1 ? bias : -bias) * Math.ceil(i / 2);
      const yaw = wantYaw + (k / steps) * c.whiskerSpread;
      if (this.clearAlong(tank, yaw)) return yaw;
    }
    return null;
  }

  /**
   * Can this hull drive `whiskerReach` metres along `yaw`?
   *
   * Three depths past the nose and three across the beam, all through
   * `Tank.rideableAt` — the hull's own climb band, which is what makes a kerb
   * a step and a shopfront a wall without either of them being in any baked
   * structure. Across the beam as well as along the bearing because a single
   * centre line threads gaps a 3.4 m hull does not fit through, which is
   * `NavGrid`'s one-column-per-cell-centre problem at vehicle scale.
   *
   * It starts at the NOSE rather than the centre: the first metres of any
   * bearing are inside the hull's own footprint, and a probe there answers
   * about the ground the tank is already standing on.
   */
  private clearAlong(tank: Tank, yaw: number): boolean {
    const c = CONFIG.vehicles.crew;
    const hull = CONFIG.vehicles.tank.hull;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    // The hull's own right, the same basis `VehicleSystem.exitSpot` builds.
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const beam = hull.width / 2;
    const nose = hull.length / 2;
    for (const depth of WHISKER_DEPTHS) {
      const along = c.whiskerReach * depth;
      const px = tank.position.x + fx * (nose + along);
      const pz = tank.position.z + fz * (nose + along);
      for (const lat of WHISKER_LATERAL) {
        if (!tank.rideableAt(px + rx * beam * lat, pz + rz * beam * lat, along)) {
          return false;
        }
      }
    }
    return true;
  }
}
