/**
 * src/sim/SimCore.ts — The authoritative simulation: the systems that
 * decide a round, and the wiring between them. No engine and no scene.
 * Owns: the map's lifetime and the per-tick order. It is the
 * server's answer to `core/Game.ts` and follows that file's rules — systems
 * never import each other, every cross-system behaviour is a callback installed
 * here, and `ConquestSystem.update` runs BEFORE `BattleSystem.update` so a
 * bot's think tick sees this frame's flag ownership.
 * Invariants: NOTHING here may render, and nothing may reach a canvas — see
 * `server/README.md`. **Nothing here imports `@babylonjs/core`, and every
 * vector is `src/math`'s**, as every system this file builds is — the last
 * scene, a NullEngine's that stood the server world's collider meshes up,
 * went at `BABYLON_EXIT.md` X2.3, and `scripts/check-babylon-free.mjs` fails
 * the build on any import path from `server/` or `src/sim/` that reaches
 * Babylon again.
 * `GrenadeSystem` and `AntiTankSystem` are here as the
 * SIMULATIONS they are — where a grenade or a rocket goes and whom it hurts
 * is a rule and belongs to the authority — and their pictures, `GrenadeFx`
 * and `AntiTankFx`, are never built on this side (`BABYLON_EXIT.md` X2.2).
 *
 * **It lives in `src/sim/` rather than `server/` because it is not the
 * server's** (`BABYLON_EXIT.md` X2.5a): the core reads no clock and draws no
 * seed of its own, so a host — `Match`, `simulate`, and from X2.5a C4a the
 * offline page — hands it the round's seed in `RoundSpec`, its world as the
 * data `buildSimWorld` takes, and its wall-clock anchor through `anchor` and
 * `drop`. Nothing in this directory may import from `server/`.
 *
 * **Everything it has to SAY leaves through one event ring and nothing else**
 * (`src/sim/events.ts`, `BABYLON_EXIT.md` X2.5a C2). There is no outward
 * callback on this class: every fact a host used to be called back with — a
 * death, an award, a flag, a blast, a seat, a person's damage — and every
 * presentation fact the page will draw from (a round's tracer, a footstep, a
 * hull's kick) is WRITTEN, as numbers captured at the moment it happened, in
 * the order it happened, and the host `drain`s after every call it makes on
 * the core. A writer here reads whatever it states off the live object inside
 * the call that raised it — the health after the blow, the respawn clock just
 * armed, the bearing of the killing round — so no reader ever has to go back
 * for it. The system callbacks the core installs on its own systems (below,
 * in `wire`) are the INWARD wiring and stay; they simply end in a ring write
 * where they used to end in a host's handler.
 *
 * **Every death is filed with the door that dealt it**, a person's as a
 * bot's: the victim's door counts it and the blow's own door audits it in
 * the same call (`fileDeath`, `KillLedger.personDown`). `simulate` seats no
 * person, so `server/corecheck.ts` is what holds this file's person paths —
 * the awards, the deaths, the seat — to the events they write, here and
 * through `Match`.
 *
 * A slot index IS a bot index, by construction: `Roster` lays its slots out
 * team 0 then team 1, `BattleSystem` builds its pool the same way, and both are
 * sized from `CONFIG.bots.maxPerTeam`. That is what makes benching a bot for a
 * human a single array index rather than a mapping that can disagree.
 *
 * **The POOL and the ROUND are two numbers the host states** (`RoundSpec`'s
 * `pool` and `fielded`, `BABYLON_EXIT.md` X2.5a D15). The authority asks for
 * the CEILING, `CONFIG.bots.maxPerTeam` a side, on every round — `setRoster`
 * builds it on the first and is a no-op after, because a match rotates maps
 * under one slot table and a table sized per map would renumber every player
 * on team 1 at every rotation — and fields the map's own `perTeamOf` out of
 * it, which is what makes Sarab twenty-four a side in a match and every other
 * map eight. See `server/Roster.ts` for the whole argument, including why
 * human capacity stays at sixteen whatever the map fields. A host whose pool
 * is the map's own (the offline page, from C4a-2) states it and fields all of
 * it. Either way `startRound` re-benches every seated person over the bot in
 * their slot itself, last.
 *
 * **A person reaches the simulation through ONE door: `submit`**
 * (`src/sim/commands.ts`), applied on arrival, its results written to the
 * ring. `Match` validates a client's claim (the rate buckets, the cones, the
 * slips, the movement and drive validators, the corrections) and submits
 * what it accepts; the page will submit its player's acts trusted. What
 * DECIDES is here, once, for both: whose body moves, which round is resolved
 * against what, the pouches, the seat policy (`mount`/`dismount` around
 * `seat`) and when a person comes back in. The `SimCoreOptions` say how the
 * hosts' roles differ — a rewind for remote shooters, a respawn clock the
 * host holds — and none of them changes a rule.
 *
 * A person enters the world through `deployPerson` and nowhere else, and only
 * once they have ASKED (`deploy`) — spent by the reinforcement pass in `step`
 * once the core's clock has run out, or at submit when the host holds that
 * clock (`hostHoldsRespawn`) — against `ConquestSystem.deployAt` rather than
 * against the index itself. That pair is the whole of spawn selection on this
 * side — see `docs/multiplayer.md`.
 */
import { CONFIG } from "../config";
import { Vector3, type Vector3Like } from "../math";
import { Bot } from "../entities/Bot";
import type { Combatant, Team } from "../entities/Combatant";
import { BattleSystem } from "../systems/BattleSystem";
import {
  CombatSystem,
  type Hittable,
  type ShotResult,
} from "../systems/CombatSystem";
import {
  ConquestSystem,
  scatterSpawn,
  type ControlPoint,
  type SpawnPick,
} from "../systems/ConquestSystem";
import { GlassSystem } from "../systems/GlassSystem";
import { RoundRandom, UNDRAWN } from "../systems/RoundRandom";
import { GrenadeSystem } from "../systems/GrenadeSystem";
import { AntiTankSystem } from "../systems/AntiTankSystem";
import {
  crewLost,
  crushSweep,
  fireHullGun,
  fireHullMg,
  type HullRules,
} from "../systems/hullRules";
import {
  settleKill,
  type DeathCause,
  type KillLedger,
} from "../systems/killRules";
import {
  ScoreBook,
  awardKill,
  awardZone,
  paysKiller,
} from "../systems/ScoreBook";
import { VehicleCrew } from "../systems/VehicleCrew";
import {
  VehicleSystem,
  type RemoteHull,
  type VehicleOrders,
} from "../systems/VehicleSystem";
import {
  Vehicle,
  type DriveInput,
  type GunAngles,
  type GunInput,
  type HullPicture,
} from "../entities/Vehicle";
import {
  DRIVER,
  GUNNER,
  chooseSeat,
  type CrewSeat,
  type SeatHolder,
} from "../entities/hullSeats";
import { resolveOrdnance } from "../entities/equipment";
import type { ThrowableId } from "../entities/throwables";
import type { GameMap } from "../world/MapBuilder";
import type { MapDef } from "../world/maps";
import type { MapCollision } from "../world/collision";
import type { Heightfield } from "../world/layout";
import { LagComp } from "./LagComp";
import { SimPlayer } from "./SimPlayer";
import { buildSimWorld } from "./simWorld";
import type { ShotCommand, SimCommand } from "./commands";
import {
  EV,
  EventRing,
  amendDeath,
  emitAward,
  emitBlast,
  emitBotDown,
  emitBurntOut,
  emitCrushed,
  emitDamaged,
  emitDeath,
  emitGlass,
  emitHit,
  emitIgnited,
  emitPair,
  emitRound,
  emitRoundOver,
  emitSeat,
  emitShot,
  emitSlot,
  emitSlotAt,
  emitSpawned,
  refusedCode,
  setRoundShooter,
  victimCode,
  type EventCursor,
} from "./events";

/**
 * Everything a round is, as its HOST hands it over: the map, its world as data
 * (the collider bake and the floor — `buildSimWorld`'s two inputs, already
 * loaded, so `startRound` is one synchronous turn), the tier, the bot POOL and
 * how much of it the round FIELDS, and the SEED. The seed is the host's
 * because drawing one is reading a source of entropy, and the core reads
 * none: `Match` passes `freshSeed()`, `simulate` the one it was given.
 *
 * **`pool` and `fielded` are two numbers because the two hosts spend them
 * differently** (`BABYLON_EXIT.md` X2.5a D15). A slot index is a bot index and
 * every outcome stream is keyed by slot, so the slot LAYOUT is the fight: the
 * authority builds the ceiling (`CONFIG.bots.maxPerTeam` a side, so a match
 * rotating maps under one slot table never renumbers team 1) and fields the
 * map's `perTeamOf` out of it — zero in a botless match — while the offline
 * page builds a per-map pool and fields all of it, which is what keeps the
 * bench's fight the one it has always been.
 */
export interface RoundSpec {
  def: MapDef;
  collision: MapCollision;
  /** `def.heights`' floor, or undefined for a flat map. */
  floor: Heightfield | undefined;
  difficulty: number;
  /** Bot slots a side — `BattleSystem.setRoster`; rebuilt only when it MOVES. */
  pool: number;
  /** Of those, how many a side this round puts in the fight — `setFielded`. */
  fielded: number;
  seed: number;
}

/**
 * The three ways the hosts' roles differ, as switches on the one core. Every
 * one defaults to OFF, and none changes a rule — each is a question about who
 * holds what.
 */
export interface SimCoreOptions {
  /**
   * Keep every body's position history (`LagComp`) and resolve a person's
   * round against the instant its `renderTime` names. The AUTHORITY's: a
   * remote shooter saw the world a round trip ago. Offline the shooter is in
   * this process and sees the world as it stands, so there is nothing to
   * rewind and no history worth recording.
   */
  rewind?: boolean;
  /**
   * The HOST holds a person's respawn clock, and a `deploy` is honoured the
   * moment it is submitted rather than once this core's clock has run out.
   * The offline page's: nothing steps under its deploy screen (the bots do
   * not fight while the player chooses), so the core's clock cannot be the
   * one that decides — the page owns the wait, as it always has. Either way
   * the spawn goes through `deployPerson`, the door the reinforcement pass
   * uses: one door, two triggers, the spawn stream drawn the same way.
   */
  hostHoldsRespawn?: boolean;
  /**
   * Time the step's phases for a host that files them (`BABYLON_EXIT.md`
   * X2.5a C6, the profiler's `sim` phase). Recorded by nothing yet: declared
   * so the option set is the one the hosts will pass.
   */
  timing?: boolean;
}

export class SimCore {
  /** Whether a person's round is rewound — `SimCoreOptions.rewind`. */
  readonly rewind: boolean;
  /** Whether the host holds the respawn clock — `SimCoreOptions.hostHoldsRespawn`. */
  readonly hostHoldsRespawn: boolean;
  /** `SimCoreOptions.timing`, held for C6. */
  readonly timing: boolean;

  readonly combat: CombatSystem;
  readonly battle: BattleSystem;
  /**
   * The round's seed and every outcome stream drawn from it
   * (`src/systems/RoundRandom.ts`) — the authority's, as `Game` holds the
   * offline round's. Declared before `conquest`, whose initialiser takes it.
   * Reseeded once per round by `startRound`; `seed` is what `Match` logs.
   */
  readonly random = new RoundRandom();
  readonly conquest = new ConquestSystem(this.random);
  readonly grenades: GrenadeSystem;
  /**
   * Breakable glazing. The same simulation the client runs, on the same panes
   * — this side gets them off the collision bake instead of off a build, and
   * builds no `GlassFx`: nothing collapses and no collider mesh is written, so
   * the sweep, the box and the nav graph are all that happen, and nothing
   * listens to `onBroken` or `onCleared`.
   */
  readonly glass = new GlassSystem();

  /**
   * The armour, and it is the authority's for the same reason the bots are.
   *
   * A hull is the one moving `solid` mesh in the game: it stops rounds, breaks
   * sightlines and is a target every AI in the round can acquire. That is a
   * RULE, and rules are decided here — so this process fleets the same
   * `VehicleSystem` a client does, off the same `GameMap.vehicleSpawns`, and
   * the clients draw what it says. See `docs/vehicles.md` on the one exception:
   * a hull with a PERSON in it is simulated by that person and reported, on the
   * bargain movement already makes.
   */
  readonly vehicles: VehicleSystem;

  /**
   * The bots that drive, exactly as they do offline: same FSM, same whisker
   * fan, same squad order. There is nothing about a crew that is presentation,
   * so nothing about it changes on this side.
   */
  readonly crew: VehicleCrew;

  /**
   * Rockets in the air and mines on the ground. Here for the reason the
   * grenades are: where a rocket goes and what it kills is a rule.
   *
   * The FLIGHT is on this side and the picture is not — a rocket's motor
   * flame, its smoke and its light are the client's (`AntiTankFx`), off the
   * position this broadcasts, exactly as a grenade's are `GrenadeFx`'s.
   */
  readonly antiTank: AntiTankSystem;

  map: GameMap | null = null;

  /**
   * How many BOTS a side the STANDING round fields — the host's
   * `RoundSpec.fielded`, set once per round by `startRound`: on the authority
   * the standing map's own `perTeamOf`, and ZERO in a match created without
   * bots.
   *
   * Read by `Match`, which spends it on the simulation's half of the round and
   * deliberately not on the wire's: what goes out is the slots that can hold a
   * BODY, and in a botless match those are the seats rather than this. See
   * `Match.fieldedSlots`. `CONFIG.bots.perTeam` before there is a map, which is
   * what a map stating nothing fields.
   */
  perTeam: number = CONFIG.bots.perTeam;

  /** Connected humans, by slot. Sparse — most slots are bots. */
  readonly players = new Map<number, SimPlayer>();

  /**
   * Position history, so a shot resolves against what its shooter saw —
   * tracked and recorded only on a core built with `rewind`, and empty
   * otherwise.
   */
  readonly lag = new LagComp();

  /** Server tick count since the round started. */
  tick = 0;

  /**
   * The instant the last completed tick ended, in `Date.now()`'s units.
   *
   * **The simulation's own clock, and it is not `Date.now()`** — that is the
   * whole point of it. A step advances the world by exactly `dt`, so the
   * simulated interval between two ticks is exact; `Date.now()` read inside
   * one is instead a picture of when the host's timer happened to fire, which
   * under a fixed-step accumulator is 0, 1 or 2 ticks' worth of wall time.
   * Every consumer of a server time is comparing it against a POSITION, and a
   * position that moved by an exact 50 ms stamped with a wall clock that moved
   * by 32 or 64 is a body whose speed changes with the host's scheduler. It is
   * what a client renders as a limp — the same failure `SNAPSHOT_HZ` not
   * dividing `TICK_HZ` produces, arriving through the timer instead of the
   * ratio (`src/net/Connection.ts` and `docs/multiplayer.md` for the client's
   * half).
   *
   * It is nonetheless anchored to the wall clock rather than free-running,
   * because a client estimates the offset to it as the MAXIMUM of a five-
   * second window of samples: a clock that silently fell behind would hold
   * that stale maximum for the whole window and drag every body to the end of
   * its buffer. `drop` is what keeps the anchor — see it.
   *
   * **The HOST anchors it and this class never reads a clock**: zero until the
   * first `anchor`, which `Match` and `simulate` call with `Date.now()` right
   * after `startRound` — see `anchor`.
   */
  now = 0;

  private readonly combatants: Combatant[] = [];

  /**
   * What the simulation has said since the host last drained it — see
   * `src/sim/events.ts`. Every writer below reads `tick` for its stamp, so a
   * fact raised between two steps (a person's round, resolved on arrival) is
   * stamped with the step it followed.
   */
  private readonly events = new EventRing();

  /**
   * Whose round `CombatSystem.fire` is resolving, for the `round` event, or
   * -1. Set around the three fires this class makes itself (`resolveShot`,
   * `resolveShell`, `resolveMg`); a bot's fire happens inside `BattleSystem`,
   * so its `round` is written with -1 and named by the `botFired` that
   * follows it in the same call (`pendingRound`).
   */
  private shooter = -1;
  /** The offset of a `round` still waiting for its shooter's name, or -1. */
  private pendingRound = -1;
  /** Whether `roundOver` has been written for the standing round. */
  private ended = false;
  /**
   * A person's `death` record still waiting for its AUDIT, by slot: the ring
   * offset `registerDeath` returned inside their `onDamaged`, which runs
   * inside `takeDamage` — before the blow's own door (`settleKill`, or the
   * hull burning) knows to say which door it was and whether anybody was
   * paid. Filed by `fileDeath` in the same call; cleared by every drain, so
   * an offset never outlives the ring it points into.
   */
  private readonly personDeaths = new Map<number, number>();

  constructor(options: SimCoreOptions = {}) {
    this.rewind = options.rewind ?? false;
    this.hostHoldsRespawn = options.hostHoldsRespawn ?? false;
    this.timing = options.timing ?? false;
    // No scene and no material factory: the last thing that wanted a factory
    // was the fleet's rigs, which are the client's `VehicleViews` since
    // `BABYLON_EXIT.md` X2.2 C9, and the last thing that wanted a scene was
    // `buildServerWorld`'s collider meshes, which went at X2.3.
    // The simulation half alone: the tracer, spark, disc and mark pools are
    // `CombatFx`'s, which only a client builds (`BABYLON_EXIT.md` X2.2), so
    // `onRound` is wired to a `round` EVENT and nothing more (X2.5a C2).
    this.combat = new CombatSystem();
    // …and the roster's simulation without a rig in it: the bodies, their
    // poses as numbers and the LOD are `BattleView`'s, which only a client
    // builds (`BABYLON_EXIT.md` X2.2 C7).
    this.battle = new BattleSystem(this.combat, this.random);
    // The pool is NOT built here: its size is the round's `RoundSpec.pool`,
    // and `startRound` builds it (`setRoster` is a no-op when the size has not
    // moved, so the authority's ceiling is built once, on its first round,
    // and never again). Nothing reaches the pool before the first round.
    // Ballistics without the picture. Where a grenade lands and who it hurts
    // is a rule and belongs here; what it looks like is `GrenadeFx`'s, which
    // needs a GPU device and is never built on this side, so `onBlast` is
    // left unwired — the `blast` event is written off `onExploded`, which
    // carries the same ground probe.
    this.grenades = new GrenadeSystem();
    this.vehicles = new VehicleSystem(this.random);
    this.antiTank = new AntiTankSystem();
    // The crew's context, and it is `Game`'s to the line — a crew asks the same
    // eight questions wherever it is running, because there is nothing about
    // driving a tank that is presentation. The one that reads differently here
    // is `targetsFor`, and only because `hittablesAgainst` on this side
    // includes the people: a crewed hull on the server shoots at humans, which
    // is the whole point of it being on the server.
    this.crew = new VehicleCrew({
      hulls: () => this.vehicles.hulls,
      roster: () => this.battle.bots,
      aside: (bot) => this.battle.aside(bot),
      setOccupied: (tank, seat, on) => this.vehicles.setOccupied(tank, seat, on),
      exitSpot: (tank) => this.vehicles.exitSpot(tank),
      targetsFor: (team) => this.battle.hittablesAgainst(team),
      // The hull is taken out of its own answer for the length of the ray —
      // the query's `skip`, as `Game` passes it and for the same reason: a
      // crew's eye is five centimetres above the top of its own collider box.
      visibleFrom: (tank, to) => this.battle.losBetween(tank.eyePos, to, tank),
      fireShell: (tank, by) => this.resolveShell(tank, by),
      fireMg: (tank, by) => this.resolveMg(tank, by),
    }, this.random);
    this.hullRules = {
      ledger: this.ledger,
      combat: this.combat,
      hulls: () => this.vehicles.hulls,
      gunTargets: (team) => this.battle.hittablesAgainst(team),
      bodies: (team) => this.battle.hittablesAgainst(team),
      blastAt: (at, team, by, spec) => this.grenades.blastAt(at, team, by, spec),
      hearGunshot: (at, team, dir) => this.battle.hearGunshot(at, team, dir),
      personIn: (tank, seat) => {
        const index = this.vehicles.hulls.indexOf(tank);
        for (const player of this.players.values()) {
          if (player.seat === index && player.crewSeat === seat) return player;
        }
        return null;
      },
      crewOf: (tank, seat) => this.crew.crewOf(tank, seat),
      // The tracks killed somebody: the kill is already settled, so this is
      // news and nothing else — the driver's hitmarker and the run-over line.
      onCrushed: (by, victim) => {
        const tank = this.hullDrivenBy(by);
        emitHit(this.events, this.tick, this.slotOf(by), this.victimIndex(victim),
          this.victimKind(victim), true, false, "tracks");
        emitCrushed(this.events, this.tick, tank, this.slotOf(by),
          this.victimIndex(victim), this.victimKind(victim));
      },
    };
    this.wire();
  }

  /**
   * Hands everything said since the last drain to `out`, in emission order.
   *
   * **A host drains after EVERY call it makes on the core** — each `step`,
   * each accepted message's call — and that is what keeps its outgoing order
   * the order the immediate callbacks this replaced used to produce: nothing
   * the host does between two calls can land in the middle of one call's
   * events. `out` holds them until the next drain into it.
   */
  drain(out: EventCursor): void {
    this.events.drainInto(out);
    this.pendingRound = -1;
    this.personDeaths.clear();
  }

  /**
   * Who is telling which hull what to do, and which hulls are being told from
   * somewhere else entirely.
   *
   * `Game.vehicleOrders`'s counterpart, and the two are mirror images: on a
   * client every hull but the player's own answers `remoteFor`, and here only
   * the hulls with a PERSON in them do. A bot crew is simulated on this side
   * exactly as it is offline, because there is nobody on the far end of a
   * socket to simulate it.
   *
   * `remoteFor` is asked first by `VehicleSystem.update`, which is what makes
   * the two answers unambiguous for a hull that has a driver: the crew map has
   * no entry for it either way, but nothing here has to rely on that.
   */
  private readonly vehicleOrders: VehicleOrders = {
    // A person's STICKS first (`driveInput`, C4a only), then the bot crew —
    // `Game.vehicleOrders`' player-first order, for its reason. The maps are
    // empty on the authority, so it asks the crew and nothing else.
    driveFor: (tank) =>
      (this.steered.size > 0 ? this.steered.get(this.vehicles.hulls.indexOf(tank)) : undefined) ??
      this.crew.driveFor(tank),
    gunFor: (tank) =>
      (this.ordered.size > 0 ? this.ordered.get(this.vehicles.hulls.indexOf(tank)) : undefined) ??
      this.crew.gunFor(tank),
    remoteFor: (tank) => this.driven.get(this.vehicles.hulls.indexOf(tank)) ?? null,
    /**
     * A PERSON's cupola gun, where he last said it was pointing.
     *
     * The seats are asked independently for the reason they are two fields on
     * the wire: one hull can hold a person driving and a bot on the gun, or a
     * bot driving and a person on the gun, and neither of those is unusual —
     * so `laid` is its own map rather than a pair of angles on `driven`, which
     * only exists while a person has the sticks.
     */
    remoteGunFor: (tank) => this.laid.get(this.vehicles.hulls.indexOf(tank)) ?? null,
  };

  /**
   * The last cupola-gun bearing each GUNNING player reported, by hardstanding
   * index. `driven`'s twin for the second seat — see `GunnerMessage` on why the
   * angle is what travels and `seat` for the one place both are written.
   */
  private readonly laid = new Map<number, GunAngles>();

  /**
   * The last hull state each DRIVING player reported, by hardstanding index.
   *
   * The hull's half of `SimPlayer`, and it is a map here rather than a field
   * there for the reason `seat` is an index rather than a `Vehicle`: what a
   * `SimPlayer` may know about is its own body, and which tank is under it is
   * a fact about the match. An entry exists for exactly as long as somebody is
   * in that hull — `seat` writes both ends — so `remoteFor` answering null is
   * the same statement as "nobody is driving this one".
   */
  private readonly driven = new Map<number, RemoteHull>();

  /**
   * **C4a only.** The STICKS of each person driving a hull this core steps
   * from raw input (`driveInput`), by hardstanding index — `Game.drive`, held
   * here. A hull is in `driven` (posed from a report) or in this (stepped
   * from input), never both: each command takes the hull out of the other
   * map, and `release` clears both. Empty on the authority. Goes at C4b.
   */
  private readonly steered = new Map<number, DriveInput>();

  /** **C4a only.** `steered`'s twin for a GUNNER's order (`gunOrder`), against `laid`. */
  private readonly ordered = new Map<number, GunInput>();

  /** Scratch a person's rocket or round is copied into on arrival. */
  private readonly cmdFrom = new Vector3();
  private readonly cmdDir = new Vector3();
  private readonly cmdMuzzle = new Vector3();

  /**
   * Builds a map and starts a round on it.
   *
   * The same sequence as `Game.buildRound`, minus everything about presentation:
   * skills are re-drawn for the tier, the world is rebuilt, the roster is reset
   * and conquest starts. The rig pool is never disposed, so this is the only
   * place the roster's difficulty can change — exactly as on the client.
   *
   * `spec.seed` is the round's seed (`RoundRandom`), and it is always the
   * HOST's: `npm run simulate` passes the one it was asked to play again, and a
   * match passes `freshSeed()` per round, which `Match` logs. Synchronous: the
   * bake and the floor arrive already loaded (`server/world.ts`'s
   * `loadSimWorld` on the authority), and the host anchors `now` once this
   * returns.
   */
  startRound(spec: RoundSpec): void {
    const { def, difficulty, seed } = spec;
    // **The pool, at the size the host asked for** — and rebuilt only when
    // that size MOVES (`setRoster` is a no-op otherwise). The authority asks
    // for the ceiling every round, so its slot table is built on the first
    // round and stands for the life of the match; the offline page asks for
    // the map's own roster. A rebuilt pool is new bodies, so the old ones'
    // history is let go first. First of all, because `setDifficulty` deals the
    // skills over whatever pool is standing.
    if (this.battle.bots.length !== spec.pool * 2) {
      for (const bot of this.battle.bots) this.lag.untrack(bot);
      this.battle.setRoster(spec.pool);
    }
    this.battle.setDifficulty(difficulty);
    this.map?.dispose();
    this.map = buildSimWorld(def, spec.collision, spec.floor);
    this.battle.setMap(this.map);
    this.battle.reset();
    // **How many bodies a side this map fields**, out of the pool built above
    // — on the authority, at the ceiling. This is the whole of a map's roster
    // reaching a match: the slot table does not move, nobody is re-seated, and
    // what changes is how many of each team's block are in the fight — Sarab's
    // twenty-four against every other map's eight.
    //
    // After `reset`, whose "everybody dead with a zero timer" is the state the
    // fielded half is picked back up from, and before the end of this method
    // re-benches the humans over the top of it. Bots the map does not field are set aside
    // exactly as a benched one is, so nothing downstream — the target lists,
    // the tickets, the squads, the board — has to be told twice.
    //
    // **A BOTLESS MATCH FIELDS ZERO OF IT, AND THAT IS THE WHOLE OF THE
    // FEATURE.** `bots: false` on the join that created this match arrives here
    // as a roster of nothing, and every bot in the pool is set aside by the
    // line below — dead, off the field, thought for by nobody, shootable by
    // nobody, holding neither a ticket nor a place in a squad. It is the same
    // sentence a map that fields eight out of a pool of twenty-four already
    // says, with the number taken to its end, which is why nothing downstream
    // had to be told: the target lists, the squads, the tickets, the crews a
    // hull would otherwise be handed and the board are all already written
    // against `aside`.
    //
    // What it does NOT touch is the SEATS. A botless match is one people fill
    // rather than one nobody can join — `Roster` is untouched, sixteen still
    // fit, and `Match` fields the seatable block on the wire so a slot a person
    // walks out of goes back to being a body nobody is drawing.
    //
    // The number is the HOST's (`RoundSpec.fielded`): `Match` passes the map's
    // `perTeamOf`, or zero for a botless match; a host whose pool is the map's
    // own passes the pool, and this takes nobody out.
    this.perTeam = spec.fielded;
    this.battle.setFielded(this.perTeam);
    // Where this map's edge is, for everybody already seated. A rotation can
    // put a rim-closed map up after an open one and back, and `setMap` is what
    // switches the leash off as well as on — a player left holding the last
    // map's half-extent would be counted out of bounds for standing in the
    // middle of this one.
    for (const player of this.players.values()) {
      player.leash.setMap(this.map.size, this.map.margin);
    }
    this.conquest.start(this.map);
    // **Everybody is put back on their feet before the fleet under them is
    // thrown away**, which is `Game.installMap`'s own first line — "the seat,
    // because the hull it belongs to is about to stop existing" — arriving on
    // the side that never had it. The comment below used to ASSERT this
    // instead, on the grounds that `Match` retires every peer across a
    // rotation, and `retire` is exactly the half that does not do it.
    //
    // **What it leaves behind is a player nothing in the round can see.**
    // Sitting in a hull takes a person OUT of `BattleSystem`'s human list —
    // that is what makes the armour rather than its driver the thing bots
    // shoot at — and `seat` is the only thing that ever puts them back.
    // `retire` clears the SEAT and not the list, so a rotation caught
    // somebody in a tank and left them out of `hittablesAgainst` and out of
    // `acquire` for the rest of the match: no bot ever fired at them again,
    // no round could land on them and no blast could reach them, and the only
    // way back in was to find another hull and get out of it. It is
    // `installMap`'s order as well as its reason — the seats are given up
    // before the crews are disbanded and the fleet disposed, so `release`
    // still has a live hull to hand the chair back to.
    for (const player of this.players.values()) {
      if (player.seat >= 0) this.seat(player, null);
    }
    // The armour, in `installMap`'s order and for `installMap`'s reasons: the
    // crews are disbanded before the fleet under them is disposed, and the
    // fleet is rebuilt before anything is told there are hulls on the field.
    // Nobody is left in a seat by the loop above, so there is no player to put
    // down beside a hull that is about to stop existing.
    this.crew.clear();
    this.driven.clear();
    this.laid.clear();
    this.steered.clear();
    this.ordered.clear();
    // **Last round's hulls come OUT of the fight before they are disposed.**
    // `BattleSystem.reset` deliberately does not touch the human list — the
    // people in it are still connected and still in their slots across a
    // rotation — so nothing else would ever take a tank out of it, and what
    // was left behind was a disposed mesh that `hittablesAgainst` still
    // handed to every bot on the other side. `Game` never had this problem
    // because `setPlayer` clears the list down to the one body; there is no
    // one body here.
    for (const tank of this.vehicles.hulls) this.battle.removeHuman(tank);
    this.vehicles.build(this.map);
    // Each hull's three told-not-polled moments, as events — the page's
    // `VehicleView` will be told them off the ring rather than off a hull it
    // holds. Attached after the build, so the round's own first placing is
    // not news; a respawn's is. A picture decides nothing (`HullPicture`), so
    // the hull runs the same arithmetic with this as without it.
    for (const [i, tank] of this.vehicles.hulls.entries()) {
      tank.picture = this.hullPicture(i, tank);
    }
    this.crew.setMap(this.vehicles.empty ? null : this.map);
    // A hull is in the fight for the two reasons `Game.buildRound` gives and
    // neither is optional: bots must be able to ACQUIRE one (nothing else
    // would make them fire at it) and `hittablesAgainst` must return one
    // (nothing else would let a round land on it). Deliberately NOT in
    // `combatants`, which is the list conquest counts occupancy from — armour
    // does not capture flags, and the crew inside it already counts for itself.
    for (const tank of this.vehicles.hulls) this.battle.addHuman(tank);
    // The floor is the backstop under the collider proxies — without it a
    // grenade that misses every box falls forever. The rockets take the same
    // one, for the same reason: both fly, and both would fall for ever past
    // the last box.
    this.grenades.setTerrain(this.map.terrain);
    this.grenades.reset();
    this.antiTank.setTerrain(this.map.terrain);
    this.antiTank.reset();
    // **The solid world as a segment query**, to the three systems here that
    // used to ask the scene for it — `installMap`'s line and for its reasons.
    // The authority resolves every shot in the match, so this is the process
    // the old `O(colliders in the scene)` pick cost most: see
    // `ENGINE_UPGRADE.md` wall 2. `BattleSystem` and `VehicleSystem` take it
    // off the `GameMap` they are already handed.
    this.combat.setWorld(this.map.rays);
    this.grenades.setWorld(this.map.rays);
    this.antiTank.setWorld(this.map.rays);
    // Every pane back, on this side too. A round is a fresh build on the
    // client, so anything else here would be an authority holding glass its
    // clients have just put back up.
    this.glass.setMap(this.map);
    if (this.rewind) for (const bot of this.battle.bots) this.lag.track(bot);
    // **The round's seed**, with every outcome stream rewound to it — `Game`'s
    // line in `buildRound`, after everything that draws is built (the pool at
    // construction, the fleet above) and before anything has spawned or fired.
    this.random.seedRound(seed);
    this.tick = 0;
    this.ended = false;
    // A new round is a new board. Sized here rather than at construction
    // because the pool is what says how many slots there are, and `reset`
    // bumping the version is what makes the cleared table go out to everybody
    // still seated — a rotation that left last round's kills on sixteen
    // screens is exactly the kind of stale state a client cannot detect.
    this.scores.reset(this.battle.bots.length);
    // **Everybody already seated comes into the new round DEAD WITH A ZERO
    // TIMER, and benched over the bot in their slot** — the state the
    // reinforcement pass deploys a person from, and the half of a rotation
    // that used to be `Match.rotate`'s. `reset` above put every bot in the
    // pool back in the fight and `setFielded` reshaped which of them this map
    // fields; a bot in a slot somebody is sitting in would otherwise walk
    // back into a fight its person is already standing in. `retire` also
    // drops a deploy request, which is an index into the OLD map's spawns.
    // Last, so it lands over everything the round's build decided.
    for (const player of this.players.values()) {
      player.retire();
      player.respawnT = 0;
    }
    for (const player of this.players.values()) {
      this.battle.setBenched(this.battle.bots[player.slot], true);
    }
    // The wall clock is NOT read here: the host calls `anchor` the moment this
    // returns, which is where the anchor has always been taken — LAST, after
    // the dispose, the build and the reset. See `anchor` for why that place.
  }

  /**
   * One simulation step.
   *
   * The order is `Game.updateWorld`'s, and for the same reasons: conquest
   * first so bots see this frame's ownership, bots second, then the rounds
   * already in the air. Returns false on the tick the round ended.
   */
  step(dt: number): boolean {
    if (!this.map) return false;
    this.tick++;
    // The clock moves with the world and by the same amount, which is the
    // whole of what makes a snapshot's stamp mean anything — see `now`.
    this.now += dt * 1000;

    // Reinforcements for people. Bots have their own inside `BattleSystem`;
    // this is the human half, and it runs before conquest counts occupancy so a
    // player who came back this tick is standing on the flag this tick.
    //
    // This is where the authority puts a person into the world — a fresh join
    // arrives here as `alive === false, respawnT === 0` and is deployed by the
    // same door (`deployPerson`) that redeploys a corpse. Spawning from
    // `Match.admit` as well would be a second door onto the same act, which is
    // how one of them comes to disagree with the other; the one other trigger,
    // `submit`'s under `hostHoldsRespawn`, calls the same door.
    //
    // It takes TWO facts, not one: the clock has to have run out (unless the
    // host holds it) and the player has to have asked. A person chooses where they come back in — that is the
    // deploy screen, and it is as much of the game in a match as it is offline
    // — so an unasked player is simply not deployed, however long they stand
    // there. Nothing here times them out into the world: a player looking at
    // the map is doing the thing the screen is for, and the alternative is
    // yanking them out of it mid-decision.
    for (const player of this.players.values()) {
      // A living one only ages its regen lock. Bots do not regenerate and never
      // have — the pool that has to refill is a person's, because a person is
      // the one combatant a round cannot afford to send back to a spawn queue
      // at half health.
      if (player.alive) {
        player.regen(dt);
        // The leash, on a map whose boundary is open — and this is the one that
        // counts. The client runs the same clock so the countdown is on screen
        // the moment the line is crossed, but a client is not asked whether it
        // is still inside the map any more than it is asked whether it was hit.
        //
        // Stepped against the last position this player REPORTED, which is
        // also what makes a player who walks out and then stops sending
        // anything die out there rather than wait it out.
        //
        // The kill goes through `takeDamage` for the same reason the client's
        // does: it is the door that charges the ticket, files the death and
        // tells this player's own screen. No `from` — nobody shot them, so
        // there is no bearing to draw an arc from.
        // **A driver is not leashed**, which is the rule armour already
        // follows offline — `Game.updateDriver` never steps the clock, because
        // a tank is not a body walking out of the world. It is a rule with
        // teeth on Harrowmead, the one map that has both an open boundary and
        // a hardstanding on it: without this, the first driver to take the
        // long way round a flank would be counted out and burned in his own
        // tank by a countdown he was never shown. Cleared rather than merely
        // paused, so a driver who dismounts out there starts the count from
        // the top instead of from wherever the drive left it.
        // …and the exemption is a GROUND hull's, because what holds a hull
        // in is the boundary rather than the clock, and the boundary is four
        // boxes twenty metres tall. A machine that can be forty metres up flies
        // over them into ground that has no floor, no nav cell and no terrain
        // — so a flying hull keeps the countdown, and its pilot is warned by
        // the same HUD a walking body is. `Vehicle.flies` and never a kind.
        if (player.seat >= 0 && !this.vehicles.hulls[player.seat]?.flies) {
          player.leash.clear();
          continue;
        }
        if (
          player.leash.update(player.position.x, player.position.z, dt) ===
          "expired"
        ) {
          player.takeDamage(player.health);
        }
        continue;
      }
      // The clock runs whoever holds it — it is what `deathProgress` reads —
      // but it GATES the deploy only when this core holds it. Under
      // `hostHoldsRespawn` the request was tried at submit, and one still
      // standing here is a pick the conquest could not place then.
      if (player.respawnT > 0) {
        player.respawnT -= dt;
        if (!this.hostHoldsRespawn) continue;
      }
      // A request that arrived before the clock ran out is KEPT and spent here,
      // rather than refused for being early. The two clocks are a round trip
      // apart and the client's is the one the player watches, so a confirm on
      // the frame it reaches zero legitimately lands a little ahead of this
      // one; refusing it would drop the deploy of every honest player whose
      // ping is worse than their patience.
      this.deployPerson(player);
    }

    // Both kinds of body, in one list. `ConquestSystem` counts occupancy off
    // this and cannot tell them apart, which is the point — a flag does not
    // care who is standing on it.
    this.combatants.length = 0;
    this.combatants.push(...this.battle.bots);
    for (const player of this.players.values()) this.combatants.push(player);
    this.conquest.update(dt, this.combatants);
    if (this.conquest.winner !== null) {
      // Once, on the tick it happened, and LAST of that tick's events — the
      // place `Match` used to queue it, after everything the deciding flag
      // paid.
      if (!this.ended) {
        this.ended = true;
        emitRoundOver(this.events, this.tick, this.conquest.winner);
      }
      return false;
    }

    // The armour, before the bots and after the flags, in `Game.updateWorld`'s
    // order and for its reasons: a bot's think tick tests line of sight
    // against the solid world and a hull is part of it, so a tank that has
    // just pulled across a street breaks the sightline on the same frame it
    // visibly blocked it. The crews go first because what they write is the
    // drive input the step below consumes.
    this.crew.update(dt);
    this.vehicles.update(dt, this.vehicleOrders);
    // What the tracks killed, in `Game.updateWorld`'s place and for its
    // reason: immediately after the hulls have moved and before the bots
    // think, so a body taken by a tank is not a target on the same frame's
    // acquisition. Before the loop below as well, which only rides bodies that
    // are still in a seat.
    crushSweep(this.hullRules);
    // A driver rides their hull, exactly as `Game.updateDriver` slaves the
    // player to it: the conquest count above, the rewind, the snapshot and
    // every bot's idea of where that person is all ask this object where it
    // is, and the honest answer is "in that tank". Done AFTER the hulls have
    // moved, so a body is never a frame behind the thing carrying it.
    for (const player of this.players.values()) {
      if (player.seat < 0) continue;
      const tank = this.vehicles.hulls[player.seat];
      if (tank) player.apply(dt, tank.position.x, tank.position.y, tank.position.z, player.yaw, player.pitch, false, false);
    }

    // No camera: the LOD is a drawing budget and belongs to `BattleView`,
    // which this side never builds. It used to be handed the map's centre
    // here, and what that decided about the fight was the last thing to go
    // (X2.2 C6, C7).
    this.battle.update(dt);
    // After the bots, so a grenade thrown on this frame's think tick flies on
    // this frame rather than sitting in the thrower's hand until the next —
    // the same order `Game.updateWorld` uses.
    this.grenades.update(dt);
    // Beside them, and after `vehicles.update` for the reason `Game` gives: a
    // mine's trigger is a distance test against where a hull IS, and running it
    // before the hull moved would arm the road a frame behind the tank.
    this.antiTank.update(dt);

    // AFTER everything has moved, so a frame records the end of a tick and not
    // the middle of one. Recording first would put every body's history half a
    // tick ahead of the positions the snapshot on that tick reports, and a
    // rewind would land between two states that never coexisted.
    if (this.rewind) this.lag.record(this.now);
    return true;
  }

  /**
   * Puts a dead person into the world at the spawn they asked for, if they
   * asked — **the ONE door a person is spawned through**, which the
   * reinforcement pass in `step` calls once the clock has run out and
   * `submit` calls at once under `hostHoldsRespawn` (`BABYLON_EXIT.md` X2.5a
   * D21). One door, two triggers: the request is resolved against what the
   * team may use NOW (`spawnPointFor`, the spawn stream drawn exactly as
   * before), and a pick the conquest cannot place keeps the request standing.
   */
  private deployPerson(player: SimPlayer): boolean {
    if (player.deployRequest === null) return false;
    const spawn = this.spawnPointFor(player.team, player.deployRequest);
    if (!spawn) return false;
    player.deployRequest = null;
    player.spawn(spawn.pos, spawn.yaw);
    emitSpawned(this.events, this.tick, player.slot, spawn.pos, spawn.yaw);
    return true;
  }

  /**
   * Puts `now` back onto the wall clock, at `ms` — the host's `Date.now()`,
   * taken the moment `startRound` returns.
   *
   * Back onto the wall clock, and LAST rather than first. Everything in
   * `startRound` is real time the simulation does not step — seconds of it,
   * nearly all of it inside `buildSimWorld` and the load in front of it — so
   * an anchor taken before the build leaves this clock exactly the build
   * behind the wall, which is the one thing the line exists to prevent. Taken
   * after it, it absorbs the dispose, the build and the reset together, and
   * the round's first tick is stamped on the wall.
   *
   * Which DIRECTION it is out by is what makes the placement load-bearing
   * rather than tidy. A client estimates the offset to this clock as the
   * MAXIMUM of a five-second window, so a clock that jumped FORWARD is
   * adopted on the next snapshot it stamps, while one that quietly fell
   * BEHIND is disbelieved for the whole of that window with every body
   * dragged to the end of its buffer. Anchoring first put the build on the
   * wrong side of that, and was only ever safe because `ROUND_OVER_MS` is
   * longer than a map takes to build — a coincidence between two unrelated
   * numbers, and the map that builds slowest is the biggest in the tree.
   *
   * A HOST's call rather than a `Date.now()` in here because the core reads
   * no clock (`BABYLON_EXIT.md` X2.5a, D18). See `now` for what this clock
   * is, and `drop` for the driver's half of the same anchor.
   */
  anchor(ms: number): void {
    this.now = ms;
  }

  /**
   * Wall time that passed without the world being stepped through it.
   *
   * The driver's half of `now`'s anchor. A fixed-step loop that has fallen
   * far enough behind DROPS the backlog rather than replaying it as a burst of
   * catch-up ticks, and that dropped time is real: the world did not move
   * through it and no client will ever be sent it. Telling them so is one
   * honest jump on the tick it happened — which they are getting anyway,
   * because the world jumped — instead of a clock quietly five seconds adrift
   * of the wall, which is the one thing the maximum filter on the far side
   * cannot ride out.
   */
  drop(ms: number): void {
    this.now += ms;
  }

  dispose(): void {
    this.vehicles.dispose();
    this.map?.dispose();
  }

  /**
   * Everything the systems need from each other, and everything they say.
   *
   * The client's `Game.wireBattle` installs sounds and minimap reveals here
   * too; none of those exist on this side, so what is left is the callbacks
   * that are actually about the fight — and, since X2.5a C2, a ring write at
   * the end of every one that has news in it. **Every system callback here is
   * this method's and none is a host's**: a callback has one owner, the owner
   * is the side that decides, and what the host hears it hears off the ring
   * (`drain`). `onBotFired`, `onBotReloaded`, `scores.onAward` and the
   * conquest pair used to be wired by `Match` directly, and are not any more.
   *
   * - **`onNearMiss` is half suppression** — which is the fight — and half a
   *   person's crack past the ear, which leaves as a `nearMiss` event for
   *   `Match` to address to them.
   * - **`conquest.onCaptured` and `onNeutralised` pay the bodies on the flag
   *   first** and then write the news, so `captured` follows its awards.
   * - **The presentation callbacks** — a round's tracer, a footstep, a fire
   *   going out, a hull's kick — decide nothing and cost a ring write each.
   *   They are written whether or not anybody draws them, so the page will
   *   read the same ring the authority's host does.
   */
  private wire(): void {
    // A death costs the dying side a reinforcement. This is the whole of what
    // `Game.registerBotKill` does that is about RULES rather than about feel —
    // the ragdoll, the sound and the killfeed line are all presentation, and
    // the board is this side's to keep and the clients' to draw. Without this
    // the only thing draining tickets is the flag bleed, and a round runs
    // several times too long in a way that looks like mistuned config rather
    // than a missing callback.
    //
    // The victim may be a person as easily as a bot — half a full roster is
    // people — so the two halves of a kill are taken separately: `creditKill`
    // for the bot that fired, whoever it hit, and the ticket-and-killfeed
    // bookkeeping only when what fell was a bot. A person's death arrives at
    // its own door (`SimPlayer.onDamaged`, wired in `addPlayer`), which is
    // where it is charged and announced.
    this.battle.onBotKill = (victim, by) =>
      settleKill(this.ledger, by, victim, by.team, "round");
    // A round that went past somebody without connecting, which is two
    // different pieces of news and neither of them reaches anyone otherwise.
    //
    // For a BOT it is suppression, and the client's `Game.wireBattle` has
    // always wired this — but a bot in a match is simulated here and nowhere
    // else, so without this line the sixteen bots on a server were the only
    // ones in the game that could be sprayed at all day and never flinch.
    //
    // For a PERSON it is the crack past the ear, and the authority is the only
    // thing that can report it: no client resolves anybody else's rounds, so a
    // networked player had no warning whatever that the fire was meant for
    // them. `at` is `CombatSystem`'s module scratch and must be read inside the
    // call, which is what the ring write does with it.
    this.combat.onNearMiss = (near, from, at) => {
      this.battle.suppress(near, from);
      if (near instanceof SimPlayer) {
        emitSlotAt(this.events, EV.nearMiss, this.tick, near.slot, at);
      }
    };
    // The picture of every round from every shooter — the tracer, the impact
    // and whether it may leave a mark. `normal` is the wall query's scratch,
    // copied by the write. A bot's round is fired inside `BattleSystem`, so it
    // is written unnamed and named by the `botFired` the same call raises.
    this.combat.onRound = (muzzle, to, kind, normal, mark) => {
      const at = emitRound(this.events, this.tick, this.shooter, muzzle, to, kind, normal, mark);
      this.pendingRound = this.shooter < 0 ? at : -1;
    };
    // Glass, and it is the authority's for one reason with teeth: the movement
    // validator rejects a client standing inside `map.obstacles`, so a player
    // who shot out a shopfront and walked through it would be snapped back
    // unless this side broke the same pane. Every round from every shooter
    // comes through here, the bots' included.
    //
    // Broken here and REPORTED by `Match`, which is what puts it on the wire —
    // this file owns the rules and knows nothing about a socket.
    //
    // The first crossing is caught off `onBreak` rather than recomputed,
    // because `shoot` has already worked out where every pane on the segment
    // was met and the nearest is the one it reports first.
    // `at` is fresh per pane (`GlassSystem.shoot`), which is what makes keeping
    // it past the call safe.
    let firstAt: Vector3Like | null = null;
    this.glass.onBreak = (_pane, at) => {
      firstAt ??= at;
    };
    this.combat.onShotPath = (origin, dir, dist) => {
      firstAt = null;
      const broke = this.glass.shoot(origin, dir, dist, true);
      if (broke.length > 0 && firstAt) {
        emitGlass(this.events, this.tick, broke, firstAt, dir);
      }
    };
    // A flag changing hands pays whoever was standing on it, which is a RULE
    // and so is taken here — the news the clients need is written to the
    // ring after the awards, exactly as a death's is. It used to be `Match`'s
    // callback outright; a callback has one owner, and the half that decides
    // something has to be the half that lives on this side.
    this.conquest.onCaptured = (point, by) => {
      this.awardZone(point, by, "capture");
      emitPair(this.events, EV.captured, this.tick, this.conquest.points.indexOf(point), by);
    };
    this.conquest.onNeutralised = (point, by) => {
      this.awardZone(point, by, "neutralise");
      emitPair(this.events, EV.neutralised, this.tick, this.conquest.points.indexOf(point), by);
    };
    // Somebody was paid — every slot, all round. `person` is captured here
    // because it is the one thing `Match` filters on (a feed line goes only to
    // a slot somebody is sitting in), and asking afterwards would be asking a
    // roster that may have changed.
    this.scores.onAward = (slot, kind, points) =>
      emitAward(this.events, this.tick, slot, kind, points, this.players.has(slot));
    // A bot pulled its trigger, worked its magazine, or put a foot down. News
    // for a screen and nothing else — no client runs the AI, so this is the
    // only way the fact reaches one. The trigger also NAMES the `round` it
    // just wrote, which `BattleSystem.botFire` raised a line earlier.
    this.battle.onBotFired = (bot, at) => {
      const slot = this.battle.bots.indexOf(bot);
      if (this.pendingRound >= 0) {
        setRoundShooter(this.events, this.pendingRound, slot);
        this.pendingRound = -1;
      }
      emitSlotAt(this.events, EV.botFired, this.tick, slot, at);
    };
    this.battle.onBotReloaded = (bot) =>
      emitSlot(this.events, EV.botReload, this.tick, this.battle.bots.indexOf(bot));
    this.battle.onBotStepped = (bot) =>
      emitSlot(this.events, EV.botStep, this.tick, this.battle.bots.indexOf(bot));
    this.battle.spawnPointFor = (bot) => this.spawnPointFor(bot.team);
    this.battle.planSquads = (team, centroids, previous) =>
      this.conquest.planSquads(team, centroids, previous);
    this.battle.zoneFor = (bot) => this.conquest.zoneFor(bot);
    // A bot asking for a grenade on a position. The arm has the last word: a
    // solve it cannot make returns false and the bot spends nothing.
    // What leaves the hand is the bot's own pouch, exactly as `Game` wires it.
    this.battle.throwGrenadeFor = (bot, from, at) =>
      this.grenades.throwAt(from, at, bot.team, bot, bot.throwable);
    // A blast resolves against the THROWER's target list, the same way a bullet
    // does, so friendly fire is excluded by construction here too and this
    // system never learns what a team is.
    this.grenades.hittablesFor = (team) => this.battle.hittablesAgainst(team);
    // `power` rides along now that more than one thing in this game explodes:
    // a grenade is 1 by definition, a tank shell is 1.85 and the AT kit has
    // its own, and it is the SIZE of the picture rather than anything a rule
    // reads. See the `explode` event.
    this.grenades.onExploded = (at, power, ground) =>
      emitBlast(this.events, this.tick, at, power, ground.surface, ground.normal);
    // The thrower's row, whoever the blast finished, and a bot's death charged
    // here — a person's already left through `SimPlayer.onDamaged`, which
    // `takeDamage` raised before this callback ran. `settleKill`, the door the
    // client's handler goes through too.
    // The `hit` first — the thrower's hitmarker, for every body the blast
    // reached, killed or not — then the kill.
    this.grenades.onBlastHit = (victim, thrower, by, killed) => {
      emitHit(this.events, this.tick, this.slotOf(by), this.victimIndex(victim),
        this.victimKind(victim), killed, false, "blast");
      if (killed) settleKill(this.ledger, by, victim, thrower, "blast");
    };
    // A molotov's burn, on the blast's terms exactly.
    this.grenades.onBurnHit = (victim, thrower, by, killed) => {
      emitHit(this.events, this.tick, this.slotOf(by), this.victimIndex(victim),
        this.victimKind(victim), killed, false, "fire");
      if (killed) settleKill(this.ledger, by, victim, thrower, "fire");
    };
    // A fire starting is news for every client, which draws it; where it burns
    // and whom it hurts stay here. `ground` is `GrenadeSystem`'s scratch,
    // copied by the write.
    this.grenades.onIgnited = (id, at, ground) =>
      emitIgnited(this.events, this.tick, id, at, ground.surface, ground.normal);
    this.grenades.onBurntOut = (id) => emitBurntOut(this.events, this.tick, id);
    // A launcher bot's rocket, flown toward the POINT it asked for
    // (`AntiTankSystem.launchToward`) exactly as `Game` wires it.
    // `considerRocket` has already decided the target is armour.
    this.battle.fireRocketFor = (bot, from, at) => {
      const dir = this.antiTank.launchToward(from, at, bot.team, bot);
      if (!dir) return false;
      this.battle.hearGunshot(from, bot.team, dir);
      emitShot(this.events, EV.rocket, this.tick, this.battle.bots.indexOf(bot), from, dir);
      return true;
    };
    // Hostile by construction: the team passed is the ordnance's own and
    // `hostileNear` answers with the OTHER side's hulls only, which is where
    // friendly fire is excluded on this path — the same bargain every target
    // list in this game makes.
    this.antiTank.hullNear = (at, radius, team) =>
      this.vehicles.hostileNear(at, radius, team);
    // The event the clients draw the fireball from is NOT raised here: the
    // splash below goes through `GrenadeSystem.blastAt`, which raises
    // `onExploded` with the same `power` it drew at — the one implementation
    // of a blast in the game reporting itself, exactly as it does for a
    // grenade and for a shell.
    this.antiTank.onDetonated = (hit) => resolveOrdnance(hit, this.grenades);
    // The hull burning, and what it costs whoever was inside it. The two
    // halves are `Game.wireVehicles`'s, with the toast taken out: a bot crew
    // dies through `onCrewLost` below, and a person dies here.
    this.vehicles.onDestroyed = (tank) => {
      emitPair(this.events, EV.hullDestroyed, this.tick, this.vehicles.hulls.indexOf(tank), tank.team);
      this.crew.hullDestroyed(tank);
      for (const player of this.players.values()) {
        if (player.seat < 0 || this.vehicles.hulls[player.seat] !== tank) continue;
        // Out of the seat BEFORE the blow lands, so the death takes the
        // ordinary door with an ordinary body on the other side of it — and
        // beside the wreck rather than inside it, which is where the client
        // will draw the corpse.
        const spot = this.vehicles.exitSpot(tank);
        this.seat(player, null);
        player.apply(0, spot.x, spot.y, spot.z, player.yaw, 0, false, false);
        this.seatAnswer(player, -1, spot, player.yaw);
        // **The hull BREWING UP is the blow**, and saying so is what gets the
        // corpse, the damage arc and the killfeed line right at once — the
        // same three things `Game.wireVehicles` argues at length. Nobody can
        // destroy their own side's armour, so the enemy team the feed derives
        // from `from` is right by the same derivation every other death uses.
        // Filed `crew` and uncredited, as a bot crewman's is by `crewLost`:
        // whatever burned the hull was paid at its own door, against the HULL,
        // which `paysKiller` refuses.
        if (player.takeDamage(player.health, tank.center, "shell")) {
          this.fileDeath(player.slot, "crew", false);
        }
      }
    };
    // …and what it costs a bot crew. The body has already been put down beside
    // the wreck and handed back to the fight by the time this runs, so there is
    // nothing to do but kill it through the door every other bot death takes.
    this.vehicles.onRespawned = (tank) =>
      emitPair(this.events, EV.hullRespawned, this.tick, this.vehicles.hulls.indexOf(tank), tank.team);
    this.crew.onBoarded = (bot) => this.battle.setCrewed(bot, true);
    this.crew.onLeft = (bot) => this.battle.setCrewed(bot, false);
    // `crewLost` is the ONE door that credits nobody, and the reason
    // `DeathCause` has a `crew`: the crew go down explained rather than
    // unaccounted for.
    this.crew.onCrewLost = (bot, tank) => crewLost(this.ledger, bot, tank);
  }

  /**
   * The doors a kill reaches on the authority, as `settleKill` asks for them:
   * the killer's row, a bot's death — which is where a `cause` and a
   * `credited` are filed for `simulate` — and a person's AUDIT, filed into the
   * death their own door already counted. The client builds the first two out
   * of its own and keeps no audit (`KillLedger.personDown`).
   */
  private readonly ledger: KillLedger = {
    credit: (by, victim, headshot) => this.creditKill(by, victim, headshot),
    botDown: (bot, killer, by, cause, credited, headshot) =>
      this.onKill(bot, killer, by, cause, credited, headshot),
    // A person's death was COUNTED at their own door, inside `takeDamage`;
    // this is the door that knows what it was, filing it into that record.
    personDown: (victim, cause, credited) => {
      if (victim instanceof SimPlayer) this.fileDeath(victim.slot, cause, credited);
    },
  };

  /**
   * What `hullRules` asks of the authority: the guns, the tracks and the crew
   * run here exactly as they run offline. A person on the sticks is asked for
   * first, then the bot crew — `driverOf`'s order, and this side's
   * `vehicleOrders`'.
   *
   * **Every hull on the field is swept by `crushSweep`, including the ones a
   * PERSON is driving** — see that function. Its call stays in `step`, right
   * after `VehicleSystem.update`.
   */
  private readonly hullRules: HullRules;

  /**
   * One thing a person asked for, applied ON ARRIVAL — **the one door a
   * host's person reaches the simulation through** (`src/sim/commands.ts`).
   *
   * Everything a command causes is written to the event ring as it happens,
   * in the order it happens, and the host drains after this call as after any
   * other. The boolean says only whether the core ACTED on it — a round
   * fired, an item taken by its pool, a seat granted — for the authority's
   * rate buckets, which spend only on a round that left; it carries no
   * outcome.
   *
   * **The split with `Match` is validation against simulation.** A claim gate
   * — a rate bucket, a cone, an origin slip, `validateMove`, `validateDrive`,
   * a sequence number, a correction — is the authority's and stays there; it
   * runs first and submits only what it accepts. What is HERE is everything
   * that decides: which body moves, which round is resolved and against what,
   * the pouches (the count is this side's), who sits in which chair and
   * whether a hull may set a body down, and when a person comes back in. So
   * the refusals below are the ones the simulation's own state makes — a dead
   * body's round, a throw from a seat, an empty pouch — and a trusted host
   * meets exactly the rules a validated one does.
   *
   * Refused in silence for a slot nobody is sitting in, and for anything but
   * a `kit` or a `deploy` before there is a world.
   */
  submit(slot: number, cmd: SimCommand): boolean {
    const player = this.players.get(slot);
    if (!player) return false;
    switch (cmd.t) {
      // Between lives, so neither needs a world: a kit describes the next
      // body, and a deploy is a request a later moment spends.
      case "kit":
        // Refused for a living body: only death refills a pouch.
        if (player.alive) return false;
        player.grenadesCarried = cmd.grenades;
        player.grenades = cmd.grenades;
        player.ordnanceCarried = cmd.ordnance;
        player.ordnance = cmd.ordnance;
        return true;
      case "deploy":
        // A living player asking is a confused host — a request queued now
        // would deploy them out of a firefight the moment they next died —
        // and a second ask from a dead one replaces the first. No index is
        // -1, which `deployAt` refuses: "anywhere", the conquest's own pick.
        if (player.alive) return false;
        player.deployRequest = cmd.spawn ?? -1;
        // One door, two triggers (`deployPerson`): at once when the host
        // holds the clock, else by the reinforcement pass when this one runs
        // out.
        if (this.hostHoldsRespawn) this.deployPerson(player);
        return true;
      default:
        break;
    }
    if (!this.map) return false;
    switch (cmd.t) {
      case "move":
        // A dead body reports nothing worth keeping, and a seated one's is
        // the HULL's — written by the step off the tank every tick.
        if (!player.alive || player.seat >= 0) return false;
        player.apply(cmd.dt, cmd.x, cmd.y, cmd.z, cmd.yaw, cmd.pitch, cmd.crouch, cmd.sprint);
        return true;
      case "shot":
        // There is no rifle in a seat: the trigger there fires a hull's gun.
        if (!player.alive || player.seat >= 0) return false;
        this.resolveShot(player, cmd);
        return true;
      case "grenade":
        return this.throwGrenade(player, cmd.origin, cmd.dir, cmd.kind);
      case "ordnance": {
        // The third slot is carried by a body, never out of a hull.
        if (!player.alive || player.ordnance <= 0 || player.seat >= 0) return false;
        const placed =
          cmd.kind === "mine"
            ? this.layMine(cmd.origin, player)
            : this.launchRocket(cmd.origin, cmd.dir, player);
        // Debited only for an item that reached the world — the refusal
        // contract `AntiTankSystem` states.
        if (placed) player.ordnance -= 1;
        return placed;
      }
      case "mount":
        return this.mount(player, cmd.tank, cmd.seat);
      case "dismount":
        return this.dismount(player);
      case "drive":
        // The look first, onto the body it belongs to — the chase camera's
        // aim, which the shell's cone is measured against — then the hull,
        // which `applyDrive` takes only from the DRIVER's chair.
        if (!player.alive || player.seat < 0) return false;
        player.yaw = cmd.aimYaw;
        player.pitch = cmd.aimPitch;
        this.applyDrive(player, cmd.x, cmd.y, cmd.z, cmd.yaw, cmd.turretYaw, cmd.gunPitch);
        return true;
      case "gun":
        if (!player.alive || player.seat < 0 || player.crewSeat !== GUNNER) return false;
        player.yaw = cmd.yaw;
        player.pitch = cmd.pitch;
        this.applyGun(player, cmd.yaw, cmd.pitch);
        return true;
      case "shell": {
        // The main gun is the DRIVER's, and a hull with none refuses outright.
        if (!player.alive || player.crewSeat !== DRIVER) return false;
        const tank = this.hullOf(player);
        if (!tank || !tank.spec.gun) return false;
        return this.resolveShell(tank, player, cmd.early);
      }
      case "mg": {
        if (!player.alive || player.crewSeat !== GUNNER) return false;
        const tank = this.hullOf(player);
        if (!tank) return false;
        return this.resolveMg(tank, player, cmd.early);
      }
      case "driveInput":
        return this.steer(player, cmd);
      case "gunOrder":
        return this.orderGun(player, cmd.aimYaw, cmd.aimPitch);
      default: {
        const unhandled: never = cmd;
        void unhandled;
        return false;
      }
    }
  }

  /**
   * A person's throw, from the pouch this side counts. Spent only if the arm
   * accepts it — the pool refuses rather than stealing a live slot, and a
   * refused throw costs nothing but says so (`ordnanceRefused`, so a host
   * that predicted the pouch can take its throw back).
   */
  private throwGrenade(
    player: SimPlayer,
    origin: Vector3Like,
    dir: Vector3Like,
    kind: ThrowableId,
  ): boolean {
    // Nothing is thrown from inside a hull, for the rifle's reason exactly.
    if (!player.alive || player.seat >= 0 || player.grenades <= 0) return false;
    if (this.grenades.throwAlong(origin, dir, player.team, player, kind)) {
      player.grenades--;
      return true;
    }
    emitPair(this.events, EV.ordnanceRefused, this.tick, player.slot, refusedCode("grenade"));
    return false;
  }

  /**
   * "Put me in that hull" — the POLICY around `seat`'s mechanism, answered
   * with a `seat` event either way: the asker mounted nothing on their own
   * side and is waiting to be told what they are in, and the answer to a
   * refusal is "on foot", which is true.
   *
   * **A person already in this hull naming its other chair is a SWAP**, and
   * it is granted here rather than through the offer below because
   * `seatOffered` refuses a body that is already seated — right for the
   * question it answers (may this body climb aboard) and wrong for this one.
   * `seat` is still the one door: it releases the old chair, turns a BOT out
   * of the new one, and leaves everything about the BODY standing. The gate
   * is a PERSON in the other chair, never the chair being taken — `chooseSeat`
   * with `only` set, inside `seat`, the call `Game.canSwapSeat` offers the key
   * with. Gated on `seats[want]` it refused every crossing against a bot, so
   * TAKE OVER GUN / TAKE OVER TANK did nothing in a match.
   *
   * Otherwise the named hull and the OFFERED hull must be the same hull: the
   * person picked one, `seatOffered` is this side's own answer to the same
   * question, and granting whatever is nearest instead would seat somebody
   * in a tank they did not choose on the day a map states two.
   */
  private mount(player: SimPlayer, tank: number, want: CrewSeat): boolean {
    if (!player.alive) return false;
    if (player.seat === tank && player.seat >= 0) {
      const hull = this.hullOf(player);
      if (hull && want !== player.crewSeat) this.seat(player, hull, want);
      this.seatAnswer(player, player.seat, player.position, player.yaw);
      return true;
    }
    const offered = this.seatOffered(player);
    const hull = offered && this.vehicles.hulls.indexOf(offered) === tank ? offered : null;
    const taken = hull ? this.seat(player, hull, want) : null;
    this.seatAnswer(player, taken ? tank : -1, player.position, player.yaw);
    return taken !== null;
  }

  /**
   * "Let me out." Where the body lands is this side's, and it is refused in
   * SILENCE where the hull cannot set a body down (`dismountable`): a client
   * whose own prompt reads LAND TO GET OUT never asks, and what is held back
   * is the whole of the hole — there is no fall damage anywhere in this game,
   * so a dismount at altitude is a free ride to any roof on the map.
   */
  private dismount(player: SimPlayer): boolean {
    const tank = this.hullOf(player);
    if (!tank) return false;
    if (!this.vehicles.dismountable(tank)) return false;
    // Read BEFORE the seat is given up: `exitSpot` measures from the hull, and
    // `seat` is what stops this player being on it.
    const spot = this.vehicles.exitSpot(tank);
    const x = spot.x;
    const y = spot.y;
    const z = spot.z;
    this.seat(player, null);
    // Placed as a spawn is, with `dt` of 0 so the stance blend is written
    // rather than eased from whatever the drive left it at.
    player.apply(0, x, y, z, player.yaw, 0, false, false);
    this.seatAnswer(player, -1, player.position, player.yaw);
    return true;
  }

  /**
   * **C4a only.** A DRIVER's sticks, stepped by this core: the hull leaves
   * `driven` (posed from reports) for `steered`, and `vehicleOrders.driveFor`
   * hands `VehicleSystem` these numbers exactly as `Game.vehicleOrders` hands
   * it `Game.drive`. Written into one held object per hull.
   */
  private steer(player: SimPlayer, input: DriveInput): boolean {
    if (!player.alive || player.seat < 0 || player.crewSeat !== DRIVER) return false;
    let held = this.steered.get(player.seat);
    if (!held) {
      held = { throttle: 0, steer: 0, lift: 0, aimYaw: 0, aimPitch: 0 };
      this.steered.set(player.seat, held);
      this.driven.delete(player.seat);
    }
    held.throttle = input.throttle;
    held.steer = input.steer;
    held.lift = input.lift;
    held.aimYaw = input.aimYaw;
    held.aimPitch = input.aimPitch;
    player.yaw = input.aimYaw;
    player.pitch = input.aimPitch;
    return true;
  }

  /** **C4a only.** `steer`'s twin for a GUNNER's order, against `laid`. */
  private orderGun(player: SimPlayer, aimYaw: number, aimPitch: number): boolean {
    if (!player.alive || player.seat < 0 || player.crewSeat !== GUNNER) return false;
    let held = this.ordered.get(player.seat);
    if (!held) {
      held = { aimYaw: 0, aimPitch: 0 };
      this.ordered.set(player.seat, held);
      this.laid.delete(player.seat);
    }
    held.aimYaw = aimYaw;
    held.aimPitch = aimPitch;
    player.yaw = aimYaw;
    player.pitch = aimPitch;
    return true;
  }

  /**
   * The first slot of `team`'s block — where a host seats its one person
   * (`addPlayer(firstSlotOf(team), team)`). The pool is laid out team 0 then
   * team 1 in two equal blocks, so team 1's begins at the pool's half.
   */
  firstSlotOf(team: Team): number {
    return team === 0 ? 0 : this.battle.bots.length / 2;
  }

  /**
   * A player's round, resolved by the authority.
   *
   * The client already fired this locally and flashed a hitmarker at whatever
   * its own ray found. That marker is a GUESS. This is where it becomes true or
   * doesn't: the ray is re-run here — against every target rewound to the
   * instant the shooter was actually looking at, on a core built with
   * `rewind` — and only this result deals damage.
   *
   * `dir` is the direction the round actually flew, spread already applied by
   * the host — so this fires with a spread of zero. `CombatSystem.fire`
   * jitters internally, and jittering again here would resolve a different
   * bullet from the one the player saw leave the barrel. The cost of trusting
   * the direction is bounded by the cone check in `Match`, which is what stops
   * a client claiming a shot fired backwards. Reached through `submit`'s
   * `shot` and nowhere else.
   */
  private resolveShot(shooter: SimPlayer, cmd: ShotCommand): ShotResult | null {
    if (!this.map || !shooter.alive) return null;
    const origin = this.cmdFrom.copyFrom(cmd.origin);
    const dir = this.cmdDir.copyFrom(cmd.dir);
    // The tracer's start and nothing else — `round`'s muzzle; the eye when
    // the host names none, which is what the authority has always drawn from.
    const muzzle = cmd.muzzle ? this.cmdMuzzle.copyFrom(cmd.muzzle) : origin;
    const weapon = cmd.weapon;
    const targets = this.battle.hittablesAgainst(shooter.team);

    // Bots hear a person's rifle exactly as they hear each other's. This is the
    // only place a person's gunfire enters the world on this side, so it is the
    // only place that can say so — `BattleSystem.botFire` calls the same method
    // for a bot's round, and a match without this line is one where half the
    // roster can shoot at a squad from behind and never be looked for.
    this.battle.hearGunshot(origin, shooter.team, dir);

    this.shooter = shooter.slot;
    const fire = () =>
      this.combat.fire(
        origin,
        dir,
        // Zero: the host's direction already carries its own spread, drawn
        // from the shooter's own stream — so there is nothing here to draw.
        0,
        UNDRAWN,
        weapon.damage,
        muzzle,
        targets,
        weapon.range,
        {
          damageFar: weapon.damageFar,
          falloffNear: weapon.falloffNear,
          falloffFar: weapon.falloffFar,
          // The head zone is the PLAYER's, by construction and not by a check
          // — see the header of `CombatSystem`. This method only ever resolves
          // a person's round, so passing it here keeps that true: bots fire
          // through `BOT_SHOT`, which omits the field, and their rounds never
          // test the sphere at all. Handing bots a head zone would make every
          // accurate bot shot a headshot, since they aim at `eyePos`.
          headMult: CONFIG.combat.headshotMult,
        },
      );
    const result =
      this.rewind && cmd.renderTime !== undefined
        ? this.lag.resolve(cmd.renderTime, this.now, shooter, fire)
        : fire();
    this.shooter = -1;

    // A bot this round put down is charged HERE, and it is the only path that
    // could. `BattleSystem.onBotKill` fires for a bot shot by another bot and
    // the grenade handler fires for a blast; a person's rifle reaches
    // `CombatSystem.fire` through this method and touches neither, so without
    // this line the eight bots a human kills in a round cost their team nothing
    // and the only thing draining tickets is the flag bleed — the same failure
    // `wire` describes one door along, arriving through the one door it does
    // not cover. It is also what raises the `kill` event those deaths need, so
    // a bot a person shoots gets a killfeed line and a corpse to throw.
    //
    // The client's `Game` charges the same kill in the same place for the same
    // reason, one line after its own `combat.fire` — see `registerBotKill`.
    if (result?.killed && result.target) {
      // The shooter's row first, whoever fell — a person killing a person
      // reaches this line and nothing else on the server would ever credit it,
      // since the victim's own door only knows it was the other side.
      settleKill(
        this.ledger,
        shooter,
        result.target,
        shooter.team,
        "round",
        result.headshot,
      );
    }
    // The shooter's own verdict, LAST — after every death, award and piece of
    // news the round caused, which is where `Match.onShot` used to queue its
    // `hit` and where the shooter's client still expects it (the hit credits
    // `Game.claimPredictedHit` pairs off are FIFO with no shot id).
    if (result?.target) {
      emitHit(this.events, this.tick, shooter.slot, this.victimIndex(result.target),
        this.victimKind(result.target), result.killed, result.headshot, "round");
    }
    return result;
  }

  /**
   * Puts a person into a hull, or takes them out of one. `Game.mount` and
   * `Game.clearVehicle` as one method, and it must be read the way that pair
   * is: everything that changes while somebody is in a seat is here, and the
   * `null` branch undoes every line of it.
   *
   * **It is the ONE writer of `SimPlayer.seat` and of `driven`**, which is
   * what keeps the two from disagreeing about who is in what — a `driven`
   * entry without a seat is a hull nobody can steer and nothing can free, and
   * a seat without one is a driver whose reports go nowhere.
   *
   * Returns the hull the player is in afterwards: the one taken, or null for a
   * refused mount or a dismount — and for a refused CROSSING the hull they are
   * still sitting in, since refusing a swap moves nobody. A refusal is SILENT
   * beyond the answer: `mount` tells the asker where they are either way, and
   * a player who pressed the key a metre too far from their own tank has lost
   * nothing but the press. The MECHANISM; the policy around it — which hull
   * may be asked for, when a body may get out — is `mount` and `dismount`.
   */
  private seat(player: SimPlayer, tank: Vehicle | null, want: CrewSeat = DRIVER): Vehicle | null {
    const held = player.seat >= 0 ? this.vehicles.hulls[player.seat] : null;
    // **The old chair is given up whenever it is not the one being asked for,
    // and that is what makes a SWAP the same call as a mount.** A peer already
    // in this hull naming the other seat lands here with `held === tank`: the
    // chair under it is released, the new one is taken on the same frame, and
    // everything a body owes while it is aboard — the invulnerability, the
    // absence from every bot's target list — is left standing, because none of
    // it was ever about which chair.
    const crossing = held !== null && held === tank && player.crewSeat !== want;
    // Asked for the chair they are already in: nothing to do, and saying so
    // here rather than letting it fall through matters — below, a seat that is
    // taken is answered with the OTHER one, and this player is what is making
    // it taken.
    if (held === tank && !crossing) return tank;
    // **A CROSSING is decided BEFORE the release**, or a refusal would have
    // spent the chair the player is sitting in. It is `chooseSeat` with `only`
    // set — the chair named or nothing — because the fall-back would be the
    // chair just left, and a swap against a bot gunner silently put the player
    // back where they started. Who holds the chair being asked for does not
    // change when this player's own is given up, so the answer stands.
    let crossTo: CrewSeat | -1 = -1;
    if (crossing && held) {
      crossTo = this.pickSeat(held, want, true);
      if (crossTo === -1) return held;
    }
    if (held && (held !== tank || crossing)) {
      this.release(player, held);
      if (held !== tank) {
        // Back into the fight as a body. Both lines are `clearVehicle`'s and
        // both are needed: the first makes rounds land again, the second makes
        // bots aim. Not spent on a swap — the body never left the hull.
        player.invulnerable = false;
        this.battle.addHuman(player);
      }
    }
    if (!tank) return null;

    const index = this.vehicles.hulls.indexOf(tank);
    if (index < 0 || !tank.alive || tank.team !== player.team) return null;
    // **Which chair is `chooseSeat`'s, the call the client words its prompt
    // with**, decided against the authority's own copy of the fleet — the
    // client's `seat` field is a preference and never a claim. Asked for one
    // that is taken, the other is granted if it is free; failing both, a BOT
    // is turned out of the one asked for and then out of the other — the whole
    // of "a bot crew never denies the player their own armour" — and a PERSON
    // never is.
    const use = crossing ? crossTo : this.pickSeat(tank, want, false);
    if (use === -1) return null;
    // The eviction lands on the same frame as the mount for `Game`'s reason:
    // a hull given up and not taken is one the boarding sweep can re-crew
    // before anybody else gets a word in. `chooseSeat` only names a held chair
    // when a bot holds it, so the second line is a guard rather than a branch.
    if (tank.seats[use]) this.crew.evict(tank, use);
    if (tank.seats[use]) return null;

    player.seat = index;
    player.crewSeat = use;
    player.invulnerable = true;
    this.vehicles.setOccupied(tank, use, true);
    // Nothing may hurt the body and nothing may aim at it: the hull is what is
    // being shot at. `invulnerable` above stops the rounds, and this stops a
    // bot standing in the street firing at an unkillable target for the rest
    // of the round.
    this.battle.removeHuman(player);
    // The hull starts where it stands, so the first frame before this player's
    // first report is one the tank spends exactly where it already is rather
    // than at the origin. **Only a DRIVER puts a hull in `driven`**, which is
    // read as "this one is not mine to simulate": a gunner who set it would
    // freeze a tank a bot was still driving.
    if (use === DRIVER) {
      this.driven.set(index, {
        x: tank.position.x,
        y: tank.position.y,
        z: tank.position.z,
        yaw: tank.yaw,
        turretYaw: tank.turretYaw,
        gunPitch: tank.gunPitch,
      });
    } else {
      this.laid.set(index, { yaw: tank.mgYaw, pitch: tank.mgPitch });
    }
    return tank;
  }

  /**
   * Gives up one chair: the seat flag, and whichever of the two "somebody else
   * is deciding this" maps that chair owns.
   *
   * Split out of `seat` because it is spent twice by it — once when a player
   * leaves a hull and once when they cross inside one — and the pair of maps
   * is exactly the thing a second copy would get wrong.
   */
  private release(player: SimPlayer, held: Vehicle): void {
    if (player.crewSeat === DRIVER) {
      this.driven.delete(player.seat);
      this.steered.delete(player.seat);
    } else {
      this.laid.delete(player.seat);
      this.ordered.delete(player.seat);
    }
    this.vehicles.setOccupied(held, player.crewSeat, false);
    player.seat = -1;
    player.crewSeat = DRIVER;
  }

  /**
   * `chooseSeat` asked against this hull's crew as the authority holds it —
   * the half of the client's `Game.seatHeldBy` that reads the crew table a
   * client cannot.
   */
  private pickSeat(tank: Vehicle, want: CrewSeat, only: boolean): CrewSeat | -1 {
    return chooseSeat(this.seatHolder(tank, DRIVER), this.seatHolder(tank, GUNNER), want, only);
  }

  /** Who is in one chair: nobody, a bot of `VehicleCrew`'s, or a person. */
  private seatHolder(tank: Vehicle, seat: CrewSeat): SeatHolder {
    if (!tank.seats[seat]) return "open";
    return this.crew.crewOf(tank, seat) ? "bot" : "player";
  }

  /**
   * A driving player's reported hull state, accepted.
   *
   * Written into the same object `remoteFor` hands out rather than a fresh one,
   * so the path that runs at `INPUT_HZ` per driver allocates nothing — the
   * rule `LagComp` and the snapshot scratch already follow. A hull that was
   * being STEPPED from a `driveInput` (C4a only) goes back to being posed from
   * reports on the first one, which is the one allocation.
   */
  private applyDrive(
    player: SimPlayer,
    x: number,
    y: number,
    z: number,
    yaw: number,
    turretYaw: number,
    gunPitch: number,
  ): void {
    if (player.crewSeat !== DRIVER) return;
    let state = this.driven.get(player.seat);
    if (!state && this.steered.delete(player.seat)) {
      state = { x, y, z, yaw, turretYaw, gunPitch };
      this.driven.set(player.seat, state);
    }
    if (!state) return;
    state.x = x;
    state.y = y;
    state.z = z;
    state.yaw = yaw;
    state.turretYaw = turretYaw;
    state.gunPitch = gunPitch;
  }

  /**
   * A gunning player's reported cupola-gun bearing, accepted.
   *
   * `applyDrive`'s twin, written into the same object `remoteGunFor` hands out
   * and for the same reason. There is nothing to validate: a bearing claims
   * nothing about the world — see `GunnerMessage`.
   */
  private applyGun(player: SimPlayer, yaw: number, pitch: number): void {
    if (player.crewSeat !== GUNNER) return;
    let laid = this.laid.get(player.seat);
    if (!laid && this.ordered.delete(player.seat)) {
      laid = { yaw, pitch };
      this.laid.set(player.seat, laid);
    }
    if (!laid) return;
    laid.yaw = yaw;
    laid.pitch = pitch;
  }

  /** The hull this player is in, or null on foot. */
  hullOf(player: SimPlayer): Vehicle | null {
    return player.seat >= 0 ? (this.vehicles.hulls[player.seat] ?? null) : null;
  }

  /**
   * The last hull state this player reported and the authority ACCEPTED, or
   * null for anybody who is not driving one.
   *
   * `hullOf`'s counterpart for the validator, and the whole point of it being
   * a second question is that the two answers are written at different
   * MOMENTS. This is written the instant a sample is accepted; the hull is
   * moved to it on the next TICK, by `updateRemote`. A check measured against
   * the hull therefore measures a second sample arriving before that tick
   * against the position of the one before it — two steps of ground over one
   * step of time, which is exactly what the speed bound is there to refuse.
   *
   * The seat is asked as well as the index because `driven` is keyed by
   * HARDSTANDING: a gunner riding in a hull somebody else is driving would
   * otherwise be handed the driver's own sample.
   */
  reportedHull(player: SimPlayer): RemoteHull | null {
    if (player.seat < 0 || player.crewSeat !== DRIVER) return null;
    return this.driven.get(player.seat) ?? null;
  }

  /**
   * The hull a person standing at `at` could get into, by hardstanding index —
   * their own side's, alive, within reach, and either empty or holding a crew
   * that may be turned out.
   *
   * `Game.offeredSeat`'s question re-asked on the authority's own copy of every
   * term in it, which is the whole point: the client asks for a hull by index
   * and this is what decides whether that was true. Empty first, for the
   * reason that method gives — given the choice, take the tank nobody is using.
   */
  seatOffered(player: SimPlayer): Vehicle | null {
    if (this.vehicles.empty || !player.alive || player.seat >= 0) return null;
    // A hull with a CHAIR left, which with two seats is the ordinary case: the
    // player climbs on beside whoever is already aboard and nobody is turned
    // out. Only a FULL hull reaches the eviction below.
    const free = this.vehicles.enterable(player.position, player.team);
    if (free) return free;
    const held = this.vehicles.occupiedNear(player.position, player.team);
    return held && this.crew.anyCrewIn(held) ? held : null;
  }

  /**
   * One round out of a tank gun, whoever pulled the trigger — `fireHullGun`,
   * the rule the client runs too, plus the event `Match` puts on the wire.
   * `by` is whose kill it is.
   *
   * `early` is `Vehicle.fireGun`'s: none for a bot crew, which fires off the
   * hull's own reload in the same tick it is ready, and `Match`'s tolerance for
   * a person's claimed round, which arrives on the network's schedule.
   */
  private resolveShell(tank: Vehicle, by: Combatant, early = 0): boolean {
    this.shooter = this.slotOf(by);
    const round = fireHullGun(this.hullRules, tank, by, early);
    this.shooter = -1;
    if (!round) return false;
    this.hullRound(EV.cannon, tank, by, round.shot, round.muzzle, round.dir, "shell");
    return true;
  }

  /**
   * One round out of a hull's CUPOLA gun, whoever pulled the trigger —
   * `fireHullMg`, shared with the client. `early` is `resolveShell`'s.
   */
  private resolveMg(tank: Vehicle, by: Combatant, early = 0): boolean {
    this.shooter = this.slotOf(by);
    const round = fireHullMg(this.hullRules, tank, by, early);
    this.shooter = -1;
    if (!round) return false;
    this.hullRound(EV.mg, tank, by, round.shot, round.muzzle, round.dir, "mg");
    return true;
  }

  /**
   * What one hull round SAYS, after everything it did: the firer's `hit` if
   * it found somebody, then the gun going off — `cannon` or `mg`, the event
   * `Match` used to be called back with at this exact point. `muzzle` and
   * `dir` are `hullRules`' module scratch, copied by the write.
   */
  private hullRound(
    kind: typeof EV.cannon | typeof EV.mg,
    tank: Vehicle,
    by: Combatant,
    shot: ShotResult,
    muzzle: Vector3Like,
    dir: Vector3Like,
    cause: "shell" | "mg",
  ): void {
    if (shot.target) {
      emitHit(this.events, this.tick, this.slotOf(by), this.victimIndex(shot.target),
        this.victimKind(shot.target), shot.killed, shot.headshot, cause);
    }
    emitShot(this.events, kind, this.tick, this.vehicles.hulls.indexOf(tank), muzzle, dir);
  }

  /**
   * A person's rocket, launched by the authority on their behalf.
   *
   * Returns false when the pool refused it, and a caller that gets a false must
   * not debit the pouch — `AntiTankSystem.launch`'s contract, unchanged by
   * being reached over a socket. `submit`'s `ordnance` is the caller.
   */
  private launchRocket(from: Vector3Like, dir: Vector3Like, by: SimPlayer): boolean {
    if (!this.antiTank.launch(from, dir, by.team, by)) {
      emitPair(this.events, EV.ordnanceRefused, this.tick, by.slot, refusedCode("rocket"));
      return false;
    }
    emitShot(this.events, EV.rocket, this.tick, by.slot, from, dir);
    // Heard exactly as a rifle is, and by the same door: a rocket leaving is
    // the loudest thing on the map after a tank gun, and the side that fired
    // it has just told everybody where it is.
    this.battle.hearGunshot(from, by.team, dir);
    return true;
  }

  /** A person's mine, laid by the authority on their behalf. */
  private layMine(at: Vector3Like, by: SimPlayer): boolean {
    if (this.antiTank.place(at, by.team, by)) return true;
    emitPair(this.events, EV.ordnanceRefused, this.tick, by.slot, refusedCode("mine"));
    return false;
  }

  /**
   * The answer to a person's mount or dismount, as a `seat` event — and the
   * hull burning under them, which is the one seat change nobody asked for.
   * `tank` is the hardstanding they are in afterwards, or -1 on foot; `at`
   * and `yaw` are where the body was put down, and mean something only on
   * the way out. Every number is read here, so `at` may be scratch.
   *
   * Written by `mount` (a refusal is answered too), `dismount` and the hull
   * burning — the three moments an answer is owed.
   */
  private seatAnswer(player: SimPlayer, tank: number, at: Vector3Like, yaw: number): void {
    emitSeat(this.events, this.tick, player.slot, tank, player.crewSeat, at, yaw);
  }

  /**
   * Seats a human in a slot, and takes the bot that was there off the field.
   *
   * The bot is benched rather than killed: killing it would charge its team a
   * reinforcement for somebody joining the game, which is a ticket the round
   * should never lose. `BattleSystem.setBenched` owns what that means.
   */
  addPlayer(slot: number, team: Team): SimPlayer {
    const player = new SimPlayer(slot, team);
    // A hit taken by a person needs a ticket charged and an event sent, and
    // neither is `CombatSystem`'s business — it calls `takeDamage` and reads
    // only whether that killed. Routed here for the same reason every other
    // cross-system effect in this file is: the systems never reach each other.
    player.onDamaged = (amount, from, killed, kind) => {
      if (killed) {
        this.conquest.registerDeath(player.team);
        // The victim's door for a person, and the counterpart of the line in
        // `onKill` that counts a bot's. Whoever killed them is credited at
        // their own door, wherever the round or the blast came from.
        //
        // **Counted here and AUDITED there.** This door is handed a body and
        // a number and cannot see which door dealt the blow, so the death is
        // written as `other`, uncredited — and the blow's own door, which runs
        // in this same call once `takeDamage` returns, files the cause and
        // whether anybody was paid into this very record (`personDown`, or
        // the hull burning's `crew`). A death no door settles keeps `other`:
        // the leash, which nobody dealt. The record is filed in place rather
        // than written late so the event ORDER — the death before the
        // `damaged`, both before the killer's awards — is the order `Match`
        // has always relayed. Nothing on the wire reads the audit.
        this.personDeaths.set(player.slot, this.registerDeath(player.slot));
      }
      // Everything the victim's own screen is owed, read NOW: the health the
      // blow left and the respawn clock it armed, which regen and the step
      // would otherwise have moved by the time anybody looked.
      emitDamaged(this.events, this.tick, player.slot, player.team, amount, from,
        killed, kind, player.health, player.respawnT);
    };
    if (this.map) player.leash.setMap(this.map.size, this.map.margin);
    this.players.set(slot, player);
    if (this.rewind) this.lag.track(player);
    this.battle.addHuman(player);
    // Before the first round there is no pool to bench in (`startRound` builds
    // it); the round's own re-bench, last of `startRound`, covers that person.
    const bot = this.battle.bots[slot];
    if (bot) this.battle.setBenched(bot, true);
    return player;
  }

  /**
   * A human left. The bot in that slot goes back into the fight.
   *
   * Also does not charge a ticket, for the mirror of the reason joining does
   * not: leaving is not dying. The bot rejoins through the ordinary respawn
   * queue with its skill and squad intact, because benching never tore any of
   * that down.
   */
  removePlayer(slot: number): void {
    const player = this.players.get(slot);
    if (!player) return;
    // Out of whatever they were driving FIRST, or the hull keeps
    // `Vehicle.occupied` for the rest of the round and nobody — no player, no bot
    // crew — is ever offered it again. It is the same "getting out is the
    // exact inverse of getting in" rule `Game.clearVehicle` rests on, and a
    // disconnect is one of the four ways out of a seat.
    this.seat(player, null);
    player.retire();
    this.players.delete(slot);
    this.lag.untrack(player);
    this.battle.removeHuman(player);
    const bot = this.battle.bots[slot];
    if (bot) this.battle.setBenched(bot, false);
  }

  /** Where a human of `team` should deploy — the same picker the bots use. */
  spawnFor(team: Team): SpawnPick | null {
    return this.spawnPointFor(team);
  }

  /**
   * A bot went down. Charges the ticket, counts the death and reports it
   * upward, as a `death` and then a `botDown` — which `Match` turns into a
   * killfeed event for the clients; this class does not know what a client
   * is.
   *
   * The DEATH is counted here and the kill is not — see `creditKill`. This is
   * the victim's door and there is exactly one of it per bot death, which is
   * the same "exactly once" the ticket above has always rested on.
   *
   * `cause` and `credited` are what the caller knows and this door cannot
   * work out: which door the blow came through, and whether `creditKill`
   * found anybody to pay for it. They decide nothing — the ticket, the feed
   * and the row are all unchanged by them — and exist so `simulate` can
   * reconcile a round's deaths against its kills instead of printing two
   * numbers that do not add up and leaving the reader to guess why.
   */
  private onKill(
    bot: Bot,
    killer: Team,
    by: Combatant | null,
    cause: DeathCause,
    credited: boolean,
    headshot = false,
  ): void {
    this.conquest.registerDeath(bot.team);
    const slot = this.battle.bots.indexOf(bot);
    this.registerDeath(slot, cause, credited);
    // The killfeed line and the corpse's throw. The bearing, the size and the
    // KIND of the killing blow are `Bot.takeDamage`'s, captured before this
    // ran — the triple a client throws the body with.
    emitBotDown(this.events, this.tick, slot, killer, this.slotOf(by), cause, credited,
      headshot, bot.deathFrom, bot.deathDamage, bot.deathKind);
  }

  /**
   * A combatant put somebody down: the kill, and everything it earned, on
   * their own row.
   *
   * **The kill is counted at the KILLER's door and the death at the victim's,
   * once each.** They are separate doors because they are separate facts with
   * separate witnesses — every death in the game already arrives somewhere
   * (`onKill` for a bot, `SimPlayer.onDamaged` for a person, whatever dealt it)
   * while the killer is known only to whatever fired, and pairing them would
   * mean one of the two paths inventing the half it cannot see. It is also what
   * lets a kill be credited when the victim is a person, which the old
   * bot-shaped callback simply dropped.
   *
   * Silent on a thrower this class cannot place. A grenade with no owner and a
   * body that is not on the roster are both "nobody's kill" rather than an
   * error: the death is counted regardless, so the board still balances at the
   * team level even when a row cannot be found for the credit.
   *
   * Returns whether the blow was CREDITABLE — it had a killer and the victim
   * pays one. Not whether the award landed on a row a team can see, which is a
   * different question and `slotOf`'s: an award paid to a slot outside the pool
   * is dropped by `ScoreBook.award` on purpose, and what catches THAT is
   * `simulate`'s first assertion rather than a return value here. The caller
   * that wants this is the death door one line down, which files an
   * uncredited death under the cause that produced it.
   */
  private creditKill(
    by: Combatant | null,
    victim: Hittable | null,
    headshot = false,
  ): boolean {
    // WHETHER it pays at all is `paysKiller`'s — a hull is not a row on the
    // scoreboard — and it is applied here rather than at the four doors below
    // so this side and the client refuse the same bodies. Guarded by hand at
    // each site, the two reached for two different tests and disagreed about
    // the player; see `paysKiller`.
    if (!by || !paysKiller(victim)) return false;
    // What the kill is WORTH is `awardKill`'s, and it is shared with the
    // client rather than restated here: the flag the victim fell on decides
    // whether this was an attack or a defence, and a server that answered that
    // question its own way would pay a player differently from the round they
    // learned the rule in. `eyePos` because that is what every path resolving
    // a kill has in its hand, and `pointAt` is a radius test on x and z.
    awardKill(
      this.scores,
      this.slotOf(by),
      by.team,
      victim ? this.conquest.pointAt(victim.eyePos) : null,
      headshot,
    );
    return true;
  }

  /**
   * Pays everyone of `by` standing in `point` for what the flag just did.
   *
   * The authority's half of `Game.awardZone`, and it is the same code rather
   * than the same rule written twice: both hand `ScoreBook`'s `awardZone` the
   * three things the two simulations disagree about — whose bodies, what a
   * point is, and what a slot means — and the rule itself (presence at the
   * moment the meter moved, tested with the same `pointAt` that moved it, not
   * split between the bodies that earned it, the dead and the benched out
   * through `alive`) is stated once, there.
   *
   * `slotOf` is the disagreement worth naming: here a body is a `Bot` or a
   * `SimPlayer` with its own slot, and on a client it is a bot or the player.
   */
  private awardZone(
    point: ControlPoint,
    by: Team,
    kind: "capture" | "neutralise",
  ): void {
    awardZone(
      this.scores,
      this.combatants,
      point,
      by,
      kind,
      (unit) => this.conquest.pointAt(unit.position),
      (unit) => this.slotOf(unit),
    );
  }

  /**
   * A team's totals, which are the sum of its rows and are not stored.
   *
   * Derived rather than counted alongside, because two counters for one fact
   * is two counters that can disagree — and the one that would be wrong is the
   * one nothing on screen could check. A slot's side is the pool's, not the
   * roster's: they agree by construction (a human is seated into the slot whose
   * bot they bench, and that bot keeps its team while it sits out), and reading
   * it from the pool means this answers the same for a bot and for the person
   * standing in its place.
   */
  teamScore(team: Team): { kills: number; deaths: number; points: number } {
    let kills = 0;
    let deaths = 0;
    let points = 0;
    for (let i = 0; i < this.battle.bots.length; i++) {
      if (this.battle.bots[i].team !== team) continue;
      const row = this.scores.row(i);
      kills += row.kills;
      deaths += row.deaths;
      points += row.points;
    }
    return { kills, deaths, points };
  }

  /**
   * One death on `slot`'s row. Called once per body that goes down, and the
   * one funnel both doors take — a bot's through `onKill`, a person's through
   * `SimPlayer.onDamaged`.
   *
   * The `death` event is written from here rather than from the two doors
   * for that reason: it is the place where "exactly once per body" is already
   * true, so an audit hung on it (`simulate`'s reconciliation, its fight hash)
   * counts what the board counts by construction instead of by two callers
   * agreeing to fire it. `cause` and `credited` are the AUDIT: nothing on the
   * wire is derived from them. Returns the record's offset, which a person's
   * door keeps so the blow's own door can file the audit into it
   * (`fileDeath`).
   */
  registerDeath(slot: number, cause: DeathCause = "other", credited = false): number {
    this.scores.registerDeath(slot);
    return emitDeath(this.events, this.tick, slot, cause, credited);
  }

  /**
   * A person's death, AUDITED: `cause` and `credited` written into the
   * `death` record their own door wrote a moment earlier in the same call
   * (`personDeaths`). Once per death — a second filing finds nothing waiting.
   */
  private fileDeath(slot: number, cause: DeathCause, credited: boolean): void {
    const offset = this.personDeaths.get(slot);
    if (offset === undefined) return;
    this.personDeaths.delete(slot);
    amendDeath(this.events, offset, cause, credited);
  }

  /**
   * Which roster slot a combatant occupies, or -1 for one that holds none.
   *
   * A person carries their slot and a bot IS its index in the pool, which is
   * the same number by construction — the identity this whole file rests on.
   */
  private slotOf(c: Combatant | null): number {
    if (!c) return -1;
    if (c instanceof Bot) return this.battle.bots.indexOf(c);
    return c instanceof SimPlayer ? c.slot : -1;
  }

  /**
   * What a `hit` or `crushed` says it landed on — `victimCode`'s kind — and
   * which one: a slot for a bot or a person, a hardstanding for a hull, -1
   * for anything that is neither.
   */
  private victimKind(h: Hittable): number {
    if (h instanceof Bot) return victimCode("bot");
    if (h instanceof SimPlayer) return victimCode("person");
    if (h instanceof Vehicle) return victimCode("hull");
    return victimCode("none");
  }

  private victimIndex(h: Hittable): number {
    if (h instanceof Vehicle) return this.vehicles.hulls.indexOf(h);
    return this.slotOf(h as Combatant);
  }

  /**
   * The hull `by` is driving, as a hardstanding index, or -1 — the tank a
   * `crushed` names. `driverOf`'s question asked backwards: a person on the
   * sticks first, then the bot crew.
   */
  private hullDrivenBy(by: Combatant): number {
    if (by instanceof SimPlayer) return by.crewSeat === DRIVER ? by.seat : -1;
    const hulls = this.vehicles.hulls;
    for (let i = 0; i < hulls.length; i++) {
      if (this.crew.crewOf(hulls[i], DRIVER) === by) return i;
    }
    return -1;
  }

  /**
   * One hull's `HullPicture`, on this side: the three moments a view must be
   * TOLD about (`placed`, `kicked`, `wrecked`) written as events, and the two
   * integrators a view steps every frame (`rolled`, `flexed`) left to the
   * page, which reads them off the hull's state.
   */
  private hullPicture(i: number, tank: Vehicle): HullPicture {
    return {
      placed: () => emitPair(this.events, EV.hullPlaced, this.tick, i, tank.team),
      kicked: () => emitPair(this.events, EV.hullKicked, this.tick, i, tank.team),
      wrecked: () => emitPair(this.events, EV.hullWrecked, this.tick, i, tank.team),
      rolled: () => {},
      flexed: () => {},
    };
  }

  /**
   * The round's board: points, kills and deaths per SLOT, in slot order.
   *
   * Per slot rather than per team because a team's totals are the sum of its
   * eight rows and can be added up wherever they are wanted, whereas the rows
   * cannot be recovered from the totals. It is also the only place any of it
   * exists: the clients hold no simulation, so a board they added up from the
   * `kill` events they happened to receive would be a different board on every
   * screen.
   *
   * A slot is a bot or a person and this makes no distinction — the number is
   * about the BODY in that slot, which is what makes benching invisible here
   * exactly as it is everywhere else. Sized to the roster in `startRound`.
   *
   * The same class the offline round keeps, holding the same three columns and
   * spending the same point table, which is what makes a kill worth what a
   * player learned it was worth wherever they learned it. `Match` watches its
   * `version` to decide when the table has to go out again.
   */
  readonly scores = new ScoreBook();

  /**
   * Where a combatant of `team` deploys.
   *
   * `Game.spawnPointFor`'s logic, including the scatter (`scatterSpawn`) — a
   * whole squad landing on one point is as bad here as it is on the client.
   * The server decides where people appear and tells them, so there is
   * nothing for a client to reproduce.
   *
   * `requested` is a person's pick off their deploy screen, and it is the only
   * thing here a client has any say in. It is not trusted: `deployAt` answers
   * with the spawn only if it is one this team may use at this instant, so a
   * request naming the enemy gatehouse, a flag lost while the message was in
   * flight, or an index that is not a spawn at all falls through to the pick
   * the bots get. A refusal is silent and costs the player their position
   * rather than their reinforcement — they asked to come back, and coming back
   * is not the part a client is asking permission for.
   */
  private spawnPointFor(
    team: Team,
    requested?: number | null,
  ): SpawnPick | null {
    const pick =
      (requested != null ? this.conquest.deployAt(team, requested) : null) ??
      this.conquest.spawnFor(team);
    return pick ? scatterSpawn(pick, this.conquest.spawnRand) : null;
  }
}

