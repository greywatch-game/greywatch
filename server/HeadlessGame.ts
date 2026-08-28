/**
 * server/HeadlessGame.ts — The authoritative simulation: a NullEngine scene,
 * the three systems that decide a round, and the wiring between them.
 * Owns: the engine/scene lifetime, the map, and the per-tick order. It is the
 * server's answer to `core/Game.ts` and follows that file's rules — systems
 * never import each other, every cross-system behaviour is a callback installed
 * here, and `ConquestSystem.update` runs BEFORE `BattleSystem.update` so a
 * bot's think tick sees this frame's flag ownership.
 * Invariants: NOTHING here may render, and nothing may reach a canvas — see
 * `server/README.md`. `GrenadeSystem` is here under `{ dust: false }`, which is
 * that rule applied rather than bent: where a grenade goes and who it hurts is
 * a rule and belongs to the authority, while `BlastDust` builds a
 * `DynamicTexture` and a `GPUParticleSystem` and neither exists without GL.
 *
 * A slot index IS a bot index, by construction: `Roster` lays its slots out
 * team 0 then team 1, `BattleSystem` builds its pool the same way, and both are
 * sized from `CONFIG.bots.perTeam`. That is what makes benching a bot for a
 * human a single array index rather than a mapping that can disagree.
 *
 * A person enters the world through the reinforcement pass in `step` and
 * nowhere else, and only once they have both waited out the clock and ASKED:
 * `Match` records the ask on `NetPlayer.deployRequest` and this class is what
 * spends it, against `ConquestSystem.deployAt` rather than against the index
 * itself. That pair is the whole of spawn selection on this side — see
 * `docs/multiplayer.md`.
 */
import { Scene, Vector3 } from "@babylonjs/core";
// The `.js` is required and must stay: `@babylonjs/core` declares no `exports`
// map, and the null engine is not in the package barrel.
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { CONFIG } from "../src/config";
import { Bot } from "../src/entities/Bot";
import { OTHER_TEAM, type Combatant, type Team } from "../src/entities/Combatant";
import type { WeaponSetup } from "../src/entities/weapons";
import { BattleSystem } from "../src/systems/BattleSystem";
import {
  CombatSystem,
  type DamageKind,
  type Hittable,
  type ShotResult,
} from "../src/systems/CombatSystem";
import {
  ConquestSystem,
  type ControlPoint,
} from "../src/systems/ConquestSystem";
import { GlassSystem } from "../src/systems/GlassSystem";
import { GrenadeSystem } from "../src/systems/GrenadeSystem";
import { AntiTankSystem, type OrdnanceHit } from "../src/systems/AntiTankSystem";
import { ScoreBook, awardKill } from "../src/systems/ScoreBook";
import { TankCrew } from "../src/systems/TankCrew";
import {
  VehicleSystem,
  type RemoteHull,
  type VehicleOrders,
} from "../src/systems/VehicleSystem";
import {
  DRIVER,
  GUNNER,
  MG_SHOT,
  SHELL_SHOT,
  Tank,
  type CrewSeat,
  type GunAngles,
} from "../src/entities/Tank";
import { ordnanceEffect } from "../src/entities/equipment";
import { CelMaterialFactory } from "../src/shaders/CelShader";
import type { GameMap } from "../src/world/MapBuilder";
import type { MapDef } from "../src/world/maps";
import { LagComp } from "./lagComp";
import { NetPlayer } from "./NetPlayer";
import { buildServerWorld } from "./world";

export class HeadlessGame {
  readonly engine = new NullEngine();
  readonly scene: Scene;
  readonly combat: CombatSystem;
  readonly battle: BattleSystem;
  readonly conquest = new ConquestSystem();
  readonly grenades: GrenadeSystem;
  /**
   * Breakable glazing. The same system the client runs, on the same panes —
   * this side gets them off the collision bake instead of off a build, and
   * draws none of them (`paneGroups` is empty here, so the vertex collapse is a
   * no-op and the sweep and the collider are all that happen).
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
  readonly crew: TankCrew;

  /**
   * Rockets in the air and mines on the ground. Here for the reason the
   * grenades are: where a rocket goes and what it kills is a rule.
   *
   * The FLIGHT is on this side and the picture is not — a rocket's motor
   * flame, its smoke and its light are the client's, off the position this
   * broadcasts. That is `GrenadeSystem`'s `{ dust: false }` split applied to
   * the other thing in this game that flies, except that a rocket needs no
   * flag for it: nothing in `AntiTankSystem` reaches for a canvas.
   */
  readonly antiTank: AntiTankSystem;

  map: GameMap | null = null;

  /** Connected humans, by slot. Sparse — most slots are bots. */
  readonly players = new Map<number, NetPlayer>();

  /** Position history, so a shot resolves against what its shooter saw. */
  readonly lag = new LagComp();

  /** Server tick count since the round started. */
  tick = 0;

  private readonly mats: CelMaterialFactory;
  private readonly combatants: Combatant[] = [];

  constructor() {
    this.scene = new Scene(this.engine);
    this.mats = new CelMaterialFactory(this.scene);
    // Order matters on the client because `Game`'s GlowLayer scan runs at
    // construction; here it does not, but the pair is kept in the same order so
    // the two files read the same way.
    this.combat = new CombatSystem(this.scene, this.mats);
    this.battle = new BattleSystem(this.scene, this.mats, this.combat);
    // Ballistics without the picture. Where a grenade lands and who it hurts
    // is a rule and belongs here; the dust needs a canvas and a GPU device and
    // does not exist on this side — see `GrenadeOptions`.
    this.grenades = new GrenadeSystem(this.scene, this.mats, { dust: false });
    this.vehicles = new VehicleSystem(this.scene, this.mats);
    this.antiTank = new AntiTankSystem(this.scene, this.mats);
    // The crew's context, and it is `Game`'s to the line — a crew asks the same
    // eight questions wherever it is running, because there is nothing about
    // driving a tank that is presentation. The one that reads differently here
    // is `targetsFor`, and only because `hittablesAgainst` on this side
    // includes the people: a crewed hull on the server shoots at humans, which
    // is the whole point of it being on the server.
    this.crew = new TankCrew({
      hulls: () => this.vehicles.tanks,
      roster: () => this.battle.bots,
      aside: (bot) => this.battle.aside(bot),
      setOccupied: (tank, seat, on) => this.vehicles.setOccupied(tank, seat, on),
      exitSpot: (tank) => this.vehicles.exitSpot(tank),
      targetsFor: (team) => this.battle.hittablesAgainst(team),
      // The hull is taken out of its own pick for the length of the ray, the
      // two property writes `Game` spends here and for the same reason: a
      // crew's eye is five centimetres above the top of its own collider box.
      visibleFrom: (tank, to) => {
        const was = tank.body.isPickable;
        tank.body.isPickable = false;
        const seen = this.battle.losBetween(tank.eyePos, to);
        tank.body.isPickable = was;
        return seen;
      },
      fireShell: (tank, by) => this.resolveShell(tank, by),
      fireMg: (tank, by) => this.resolveMg(tank, by),
    });
    this.wire();
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
    driveFor: (tank) => this.crew.driveFor(tank),
    gunFor: (tank) => this.crew.gunFor(tank),
    remoteFor: (tank) => this.driven.get(this.vehicles.tanks.indexOf(tank)) ?? null,
    /**
     * A PERSON's cupola gun, where he last said it was pointing.
     *
     * The seats are asked independently for the reason they are two fields on
     * the wire: one hull can hold a person driving and a bot on the gun, or a
     * bot driving and a person on the gun, and neither of those is unusual —
     * so `laid` is its own map rather than a pair of angles on `driven`, which
     * only exists while a person has the sticks.
     */
    remoteGunFor: (tank) => this.laid.get(this.vehicles.tanks.indexOf(tank)) ?? null,
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
   * The hull's half of `NetPlayer`, and it is a map here rather than a field
   * there for the reason `seat` is an index rather than a `Tank`: what a
   * `NetPlayer` may know about is its own body, and which tank is under it is
   * a fact about the match. An entry exists for exactly as long as somebody is
   * in that hull — `seat` writes both ends — so `remoteFor` answering null is
   * the same statement as "nobody is driving this one".
   */
  private readonly driven = new Map<number, RemoteHull>();

  /**
   * Builds a map and starts a round on it.
   *
   * The same sequence as `Game.buildRound`, minus everything about presentation:
   * skills are re-drawn for the tier, the world is rebuilt, the roster is reset
   * and conquest starts. The rig pool is never disposed, so this is the only
   * place the roster's difficulty can change — exactly as on the client.
   */
  async startRound(def: MapDef, difficulty: number): Promise<void> {
    this.battle.setDifficulty(difficulty);
    this.map?.dispose();
    this.map = await buildServerWorld(this.scene, def);
    this.battle.setMap(this.map);
    this.battle.reset();
    // Where this map's edge is, for everybody already seated. A rotation can
    // put a rim-closed map up after an open one and back, and `setMap` is what
    // switches the leash off as well as on — a player left holding the last
    // map's half-extent would be counted out of bounds for standing in the
    // middle of this one.
    for (const player of this.players.values()) {
      player.leash.setMap(this.map.size, this.map.margin);
    }
    this.conquest.start(this.map);
    // The armour, in `installMap`'s order and for `installMap`'s reasons: the
    // crews are disbanded before the fleet under them is disposed, and the
    // fleet is rebuilt before anything is told there are hulls on the field.
    // Everybody is out of a seat by now — `Match` retires every peer across a
    // rotation — so there is no player to put down beside a hull that is
    // about to stop existing.
    this.crew.clear();
    this.driven.clear();
    this.laid.clear();
    // **Last round's hulls come OUT of the fight before they are disposed.**
    // `BattleSystem.reset` deliberately does not touch the human list — the
    // people in it are still connected and still in their slots across a
    // rotation — so nothing else would ever take a tank out of it, and what
    // was left behind was a disposed mesh that `hittablesAgainst` still
    // handed to every bot on the other side. `Game` never had this problem
    // because `setPlayer` clears the list down to the one body; there is no
    // one body here.
    for (const tank of this.vehicles.tanks) this.battle.removeHuman(tank);
    this.vehicles.build(this.map);
    this.crew.setMap(this.vehicles.empty ? null : this.map);
    // A hull is in the fight for the two reasons `Game.buildRound` gives and
    // neither is optional: bots must be able to ACQUIRE one (nothing else
    // would make them fire at it) and `hittablesAgainst` must return one
    // (nothing else would let a round land on it). Deliberately NOT in
    // `combatants`, which is the list conquest counts occupancy from — armour
    // does not capture flags, and the crew inside it already counts for itself.
    for (const tank of this.vehicles.tanks) this.battle.addHuman(tank);
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
    for (const bot of this.battle.bots) this.lag.track(bot);
    this.tick = 0;
    // A new round is a new board. Sized here rather than at construction
    // because the pool is what says how many slots there are, and `reset`
    // bumping the version is what makes the cleared table go out to everybody
    // still seated — a rotation that left last round's kills on sixteen
    // screens is exactly the kind of stale state a client cannot detect.
    this.scores.reset(this.battle.bots.length);
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

    // Reinforcements for people. Bots have their own inside `BattleSystem`;
    // this is the human half, and it runs before conquest counts occupancy so a
    // player who came back this tick is standing on the flag this tick.
    //
    // This is the ONE place a person is put into the world — a fresh join
    // arrives here as `alive === false, respawnT === 0` and is deployed by the
    // same line that redeploys a corpse. Spawning from `Match.admit` as well
    // would be a second door onto the same act, which is how one of them comes
    // to disagree with the other.
    //
    // It takes TWO facts, not one: the clock has to have run out and the player
    // has to have asked. A person chooses where they come back in — that is the
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
        if (player.seat >= 0) {
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
      if (player.respawnT > 0) {
        player.respawnT -= dt;
        continue;
      }
      // A request that arrived before the clock ran out is KEPT and spent here,
      // rather than refused for being early. The two clocks are a round trip
      // apart and the client's is the one the player watches, so a confirm on
      // the frame it reaches zero legitimately lands a little ahead of this
      // one; refusing it would drop the deploy of every honest player whose
      // ping is worse than their patience.
      if (player.deployRequest === null) continue;
      const spawn = this.spawnPointFor(player.team, player.deployRequest);
      if (!spawn) continue;
      player.deployRequest = null;
      player.spawn(spawn.pos, spawn.yaw);
      this.onPlayerSpawned(player, spawn.pos, spawn.yaw);
    }

    // Both kinds of body, in one list. `ConquestSystem` counts occupancy off
    // this and cannot tell them apart, which is the point — a flag does not
    // care who is standing on it.
    this.combatants.length = 0;
    this.combatants.push(...this.battle.bots);
    for (const player of this.players.values()) this.combatants.push(player);
    this.conquest.update(dt, this.combatants);
    if (this.conquest.winner !== null) return false;

    // The armour, before the bots and after the flags, in `Game.updateWorld`'s
    // order and for its reasons: a bot's think tick tests line of sight
    // against the solid world and a hull is part of it, so a tank that has
    // just pulled across a street breaks the sightline on the same frame it
    // visibly blocked it. The crews go first because what they write is the
    // drive input the step below consumes.
    this.crew.update(dt);
    this.vehicles.update(dt, this.vehicleOrders);
    // A driver rides their hull, exactly as `Game.updateDriver` slaves the
    // player to it: the conquest count above, the rewind, the snapshot and
    // every bot's idea of where that person is all ask this object where it
    // is, and the honest answer is "in that tank". Done AFTER the hulls have
    // moved, so a body is never a frame behind the thing carrying it.
    for (const player of this.players.values()) {
      if (player.seat < 0) continue;
      const tank = this.vehicles.tanks[player.seat];
      if (tank) player.apply(dt, tank.position.x, tank.position.y, tank.position.z, player.yaw, player.pitch, false, false);
    }

    // The camera position every LOD test keys off. There is no camera here, so
    // it is the map centre — which puts every bot inside `lodDisableDistance`
    // and keeps them all fully simulated. That is what the server wants: LOD is
    // a drawing budget, and skipping a bot's pose to save a draw call it was
    // never going to make would only make the authority disagree with the
    // clients about where that bot is.
    this.battle.update(dt, ORIGIN);
    this.combat.update(dt);
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
    this.lag.record(Date.now());
    return true;
  }

  dispose(): void {
    this.vehicles.dispose();
    this.map?.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }

  /**
   * Everything the bots need from the rest of the game.
   *
   * The client's `Game.wireBattle` installs sounds and minimap reveals here
   * too; none of those exist on a server, so what is left is the callbacks
   * that are actually about the fight. Their absence is the point — a server
   * that had to stub `Sfx` would be a server that had imported it.
   *
   * Two of those presentation callbacks are nonetheless taken, because the
   * FACT under each of them belongs to the authority and to nothing else — no
   * client runs the AI that pulled a trigger, and none of them resolves
   * anybody else's rounds. They are taken at different doors, and the
   * difference is whether the fight cares:
   *
   * - **`onBotFired` and `onBotReloaded` are `Match`'s**, wired straight to the
   *   event queue. Nothing here decides anything on them, so nothing here has
   *   to see them.
   * - **`onNearMiss` is this method's**, because half of it is suppression —
   *   which is the fight, and which had no caller on this side at all until it
   *   was wired. The other half is a person's crack past the ear, and that
   *   leaves through `onNearMiss` below for `Match` to address to them.
   * - **`conquest.onCaptured` and `onNeutralised` are this method's**, and they
   *   were `Match`'s until a flag started paying the bodies standing on it.
   *   That is a rule, a callback has one owner, and the owner has to be the
   *   side that decides: the news goes back out through `onCapturedEvent` /
   *   `onNeutralisedEvent` for `Match` to put on the wire.
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
    // its own door (`NetPlayer.onDamaged`, wired in `addPlayer`), which is
    // where it is charged and announced.
    this.battle.onBotKill = (victim, by) => {
      this.creditKill(by, victim);
      if (victim instanceof Bot) this.onKill(victim, by.team);
    };
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
    // call, which is what `Match` does with it.
    this.combat.onNearMiss = (near, from, at) => {
      this.battle.suppress(near, from);
      if (near instanceof NetPlayer) this.onNearMiss(near, at);
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
    let firstAt: Vector3 | null = null;
    this.glass.onBreak = (_pane, at) => {
      firstAt ??= at;
    };
    this.combat.onShotPath = (origin, dir, dist) => {
      firstAt = null;
      const broke = this.glass.shoot(origin, dir, dist, true);
      if (broke.length > 0 && firstAt) this.onGlassBroken(broke, firstAt, dir);
    };
    // A flag changing hands pays whoever was standing on it, which is a RULE
    // and so is taken here — the events the clients need are raised back out
    // for `Match` to queue, exactly as `onKillEvent` is. It used to be
    // `Match`'s callback outright; a callback has one owner, and the half that
    // decides something has to be the half that lives on this side.
    this.conquest.onCaptured = (point, by) => {
      this.awardZone(point, by, "capture");
      this.onCapturedEvent(point, by);
    };
    this.conquest.onNeutralised = (point, by) => {
      this.awardZone(point, by, "neutralise");
      this.onNeutralisedEvent(point);
    };
    this.battle.spawnPointFor = (bot) => this.spawnPointFor(bot.team);
    this.battle.planSquads = (team, centroids, previous) =>
      this.conquest.planSquads(team, centroids, previous);
    this.battle.zoneFor = (bot) => {
      const p = this.conquest.pointAt(bot.position);
      if (!p || p.def.id !== bot.objective) return "none";
      return bot.defending && p.owner === bot.team ? "hold" : "contest";
    };
    // A bot asking for a grenade on a position. The arm has the last word: a
    // solve it cannot make returns false and the bot spends nothing.
    this.battle.throwGrenadeFor = (bot, from, at) =>
      this.grenades.throwAt(from, at, bot.team, bot);
    // A blast resolves against the THROWER's target list, the same way a bullet
    // does, so friendly fire is excluded by construction here too and this
    // system never learns what a team is.
    this.grenades.hittablesFor = (team) => this.battle.hittablesAgainst(team);
    // `power` rides along now that more than one thing in this game explodes:
    // a grenade is 1 by definition, a tank shell is 1.85 and the AT kit has
    // its own, and it is the SIZE of the picture rather than anything a rule
    // reads. See the `explode` event.
    this.grenades.onExploded = (at, power) => this.onExplosion(at, power);
    this.grenades.onBlastHit = (victim, thrower, by, killed) => {
      if (!killed) return;
      // The thrower's row, whoever the blast finished — the same rule the
      // rifle path above follows, and the reason a bot's grenade is worth
      // something on the board rather than being the one kill in the game
      // nobody is credited with.
      this.creditKill(by, victim);
      // A person's damage already left through `NetPlayer.onDamaged`, which
      // `takeDamage` raised before this callback ran — the same split the
      // client makes, where `onPlayerDamaged` has already handled the player by
      // the time this fires. Only bots are this handler's business.
      if (victim instanceof Bot) this.onKill(victim, thrower);
    };
    // A launcher bot's rocket, wired exactly as `Game` wires it: the ask is a
    // POINT and a rocket flies straight, so there is no solve to refuse and the
    // pool has the only word. `considerRocket` has already decided the target
    // is armour.
    this.battle.fireRocketFor = (bot, from, at) => {
      this.rocketAim.copyFrom(at).subtractInPlace(from);
      if (this.rocketAim.lengthSquared() < 1e-4) return false;
      this.rocketAim.normalize();
      if (!this.antiTank.launch(from, this.rocketAim, bot.team, bot)) return false;
      this.battle.hearGunshot(from, bot.team);
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
    this.antiTank.onDetonated = (hit) => this.resolveOrdnance(hit);
    // The hull burning, and what it costs whoever was inside it. The two
    // halves are `Game.wireVehicles`'s, with the toast taken out: a bot crew
    // dies through `onCrewLost` below, and a person dies here.
    this.vehicles.onDestroyed = (tank) => {
      this.crew.hullDestroyed(tank);
      for (const player of this.players.values()) {
        if (player.seat < 0 || this.vehicles.tanks[player.seat] !== tank) continue;
        // Out of the seat BEFORE the blow lands, so the death takes the
        // ordinary door with an ordinary body on the other side of it — and
        // beside the wreck rather than inside it, which is where the client
        // will draw the corpse.
        const spot = this.vehicles.exitSpot(tank);
        this.seat(player, null);
        player.apply(0, spot.x, spot.y, spot.z, player.yaw, 0, false, false);
        this.onSeatChanged(player, -1, spot, player.yaw);
        // **The hull BREWING UP is the blow**, and saying so is what gets the
        // corpse, the damage arc and the killfeed line right at once — the
        // same three things `Game.wireVehicles` argues at length. Nobody can
        // destroy their own side's armour, so the enemy team the feed derives
        // from `from` is right by the same derivation every other death uses.
        player.takeDamage(player.health, tank.center, "shell");
      }
    };
    // …and what it costs a bot crew. The body has already been put down beside
    // the wreck and handed back to the fight by the time this runs, so there is
    // nothing to do but kill it through the door every other bot death takes.
    this.crew.onBoarded = (bot) => this.battle.setCrewed(bot, true);
    this.crew.onLeft = (bot) => this.battle.setCrewed(bot, false);
    this.crew.onCrewLost = (bot, tank) => {
      if (bot.takeDamage(bot.hp, tank.center, "shell")) {
        this.onKill(bot, OTHER_TEAM[bot.team]);
      }
    };
  }

  /** Scratch for the line a launcher bot's rocket goes down. */
  private readonly rocketAim = new Vector3();

  /**
   * A player's round, resolved by the authority.
   *
   * The client already fired this locally and flashed a hitmarker at whatever
   * its own ray found. That marker is a GUESS. This is where it becomes true or
   * doesn't: the ray is re-run here, against every target rewound to the instant
   * the shooter was actually looking at, and only this result deals damage.
   *
   * `dir` is the direction the round actually flew, spread already applied by
   * the client — so this fires with a spread of zero. `CombatSystem.fire`
   * jitters internally, and jittering again here would resolve a different
   * bullet from the one the player saw leave the barrel. The cost of trusting
   * the direction is bounded by the cone check in `Match`, which is what stops
   * a client claiming a shot fired backwards.
   */
  resolveShot(
    shooter: NetPlayer,
    origin: Vector3,
    dir: Vector3,
    renderTime: number,
    weapon: WeaponSetup,
  ): ShotResult | null {
    if (!this.map || !shooter.alive) return null;
    const targets = this.battle.hittablesAgainst(shooter.team);

    // Bots hear a person's rifle exactly as they hear each other's. This is the
    // only place a person's gunfire enters the world on this side, so it is the
    // only place that can say so — `BattleSystem.botFire` calls the same method
    // for a bot's round, and a match without this line is one where half the
    // roster can shoot at a squad from behind and never be looked for.
    this.battle.hearGunshot(origin, shooter.team);

    const result = this.lag.resolve(renderTime, shooter, () =>
      this.combat.fire(
        origin,
        dir,
        // Zero: the client's direction already carries its own spread.
        0,
        weapon.damage,
        origin,
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
      ),
    );

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
    if (result?.killed) {
      // The shooter's row first, whoever fell — a person killing a person
      // reaches this line and nothing else on the server would ever credit it,
      // since the victim's own door only knows it was the other side.
      this.creditKill(shooter, result.target, result.headshot);
      if (result.target instanceof Bot) {
        this.onKill(result.target, shooter.team, result.headshot);
      }
    }
    return result;
  }

  /**
   * Puts a person into a hull, or takes them out of one. `Game.mount` and
   * `Game.clearVehicle` as one method, and it must be read the way that pair
   * is: everything that changes while somebody is in a seat is here, and the
   * `null` branch undoes every line of it.
   *
   * **It is the ONE writer of `NetPlayer.seat` and of `driven`**, which is
   * what keeps the two from disagreeing about who is in what — a `driven`
   * entry without a seat is a hull nobody can steer and nothing can free, and
   * a seat without one is a driver whose reports go nowhere.
   *
   * Returns the hull that was taken, or null for a refusal or a dismount. A
   * refusal is SILENT beyond the answer: `Match` tells the asker where they
   * are either way, and a player who pressed the key a metre too far from
   * their own tank has lost nothing but the press.
   */
  seat(player: NetPlayer, tank: Tank | null, want: CrewSeat = DRIVER): Tank | null {
    const held = player.seat >= 0 ? this.vehicles.tanks[player.seat] : null;
    // **The old chair is given up whenever it is not the one being asked for,
    // and that is what makes a SWAP the same call as a mount.** A peer already
    // in this hull naming the other seat lands here with `held === tank`: the
    // chair under it is released, the new one is taken on the same frame, and
    // everything a body owes while it is aboard — the invulnerability, the
    // absence from every bot's target list — is left standing, because none of
    // it was ever about which chair.
    const crossing = held === tank && player.crewSeat !== want;
    // Asked for the chair they are already in: nothing to do, and saying so
    // here rather than letting it fall through matters — below, a seat that is
    // taken is answered with the OTHER one, and this player is what is making
    // it taken.
    if (held === tank && !crossing) return tank;
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

    const index = this.vehicles.tanks.indexOf(tank);
    if (index < 0 || !tank.alive || tank.team !== player.team) return null;
    // Which chair, decided against the authority's own copy of the fleet — the
    // client's `seat` field is a preference and never a claim. Asked for one
    // that is taken, the other is granted if it is free; asked for nothing,
    // the driver's comes first, which is `VehicleSystem.seatOn`'s rule stated
    // once for both processes.
    let use: CrewSeat = want;
    if (tank.seats[use]) use = use === DRIVER ? GUNNER : DRIVER;
    if (tank.seats[use]) {
      // Both taken. A BOT is turned out rather than keeping the seat — the
      // whole of "a bot crew never denies the player their own armour" — and
      // it lands on the same frame as the mount for `Game`'s reason: a hull
      // given up and not taken is one the boarding sweep can re-crew before
      // anybody else gets a word in. A PERSON is never evicted, which is why
      // the chair asked for is tried first and then the other one.
      use = want;
      if (!this.crew.evict(tank, use)) {
        use = use === DRIVER ? GUNNER : DRIVER;
        if (!this.crew.evict(tank, use)) return null;
      }
      if (tank.seats[use]) return null;
    }

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
  private release(player: NetPlayer, held: Tank): void {
    if (player.crewSeat === DRIVER) this.driven.delete(player.seat);
    else this.laid.delete(player.seat);
    this.vehicles.setOccupied(held, player.crewSeat, false);
    player.seat = -1;
    player.crewSeat = DRIVER;
  }

  /**
   * A driving player's reported hull state, accepted.
   *
   * Written into the same object `remoteFor` hands out rather than a fresh one,
   * so the path that runs at `INPUT_HZ` per driver allocates nothing — the
   * rule `LagComp` and the snapshot scratch already follow.
   */
  applyDrive(
    player: NetPlayer,
    x: number,
    y: number,
    z: number,
    yaw: number,
    turretYaw: number,
    gunPitch: number,
  ): void {
    if (player.crewSeat !== DRIVER) return;
    const state = this.driven.get(player.seat);
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
  applyGun(player: NetPlayer, yaw: number, pitch: number): void {
    if (player.crewSeat !== GUNNER) return;
    const laid = this.laid.get(player.seat);
    if (!laid) return;
    laid.yaw = yaw;
    laid.pitch = pitch;
  }

  /** The hull this player is in, or null on foot. */
  hullOf(player: NetPlayer): Tank | null {
    return player.seat >= 0 ? (this.vehicles.tanks[player.seat] ?? null) : null;
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
  seatOffered(player: NetPlayer): Tank | null {
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
   * One round out of a tank gun, whoever pulled the trigger.
   *
   * `Game.resolveShell` with the presentation taken out, and it is the same
   * ONE implementation for the same reason: the player's tank and a bot's are
   * the same vehicle, so a second copy of the damage, the splash and the
   * hearing would be a second thing to keep in step. `by` is whose kill it is.
   *
   * There is deliberately no rewind here and none is owed. A shell is
   * `blastRadius` wide and slow to reload; the metre a rewind would recover is
   * inside its own splash, and a driver is aiming at a seven-metre hull rather
   * than at a head. What the client's own copy bought was the tracer and the
   * noise, and both of those were free.
   */
  resolveShell(tank: Tank, by: Combatant): boolean {
    if (!tank.fireGun()) return false;
    const g = CONFIG.vehicles.tank.gun;
    const muzzle = tank.muzzleToRef(this.shellFrom);
    const dir = tank.gunDirToRef(this.shellDir);
    const shot = this.combat.fire(
      muzzle,
      dir,
      // No spread: a tank gun is a rifled barrel with a fire-control system,
      // and no `headMult` — the head zone is the player's alone and a shell
      // that landed on a body has already spent more than a headshot's worth.
      0,
      g.damage,
      muzzle,
      this.battle.hittablesAgainst(tank.team),
      g.range,
      SHELL_SHOT,
    );
    this.grenades.blastAt(shot.hitPoint, tank.team, by, {
      radius: g.blastRadius,
      inner: g.blastInner,
      damage: g.blastDamage,
      kind: "shell",
      power: g.blastPower,
    });
    // The direct hit's own bookkeeping. The splash's victims come through
    // `onBlastHit`, which `wire` already handles.
    //
    // **A HULL is not a row on the scoreboard**, and it can be `shot.target`
    // now that armour is answered by its collider rather than by a sphere it
    // lost to — see `CombatSystem.fire`. What a burning tank pays is its
    // CREW, through `onCrewLost` and the driver's own death, exactly as it
    // does when a rocket takes it; paying the gunner again for the chassis
    // would price one shell at two kills on this side of the wire and one on
    // `Game`'s, which guards the same case with its `instanceof Bot`.
    if (shot.killed && !shot.target?.armoured) {
      this.creditKill(by, shot.target);
      if (shot.target instanceof Bot) this.onKill(shot.target, tank.team);
    }
    // Bots hear a tank gun the way they hear a rifle, and it is the TANK's
    // side rather than the crewman's — a hull the AI is driving is heard by
    // the other team exactly as one a person is driving is.
    this.battle.hearGunshot(muzzle, tank.team);
    this.onCannon(tank);
    return true;
  }

  /**
   * One round out of a hull's CUPOLA gun, whoever pulled the trigger.
   *
   * `Game.resolveMg` with the presentation taken out, and it is the same one
   * implementation for `resolveShell`'s reason: the person on that seat and a
   * bot on it fire the same weapon.
   *
   * There is no rewind here and none is owed, for a different reason than the
   * shell's. A machine gun round is small and fast, but it is one of nine a
   * second down a cone `mg.spread` wide — the metre a rewind would recover is
   * inside the cone the same burst is already spraying, and the shooter is
   * holding the trigger down rather than taking one shot at a head.
   *
   * **A HULL is not a row on the scoreboard**, and a machine gun could not
   * kill one anyway (`resist.bullet` is 0.05) — the guard is `resolveShell`'s
   * and is kept for the same reason its is: `shot.target` can be a tank now
   * that armour is answered by its collider.
   */
  resolveMg(tank: Tank, by: Combatant): boolean {
    if (!tank.fireMg()) return false;
    const m = CONFIG.vehicles.tank.mg;
    const muzzle = tank.mgMuzzleToRef(this.shellFrom);
    const dir = tank.mgDirToRef(this.shellDir);
    const shot = this.combat.fire(
      muzzle,
      dir,
      m.spread,
      m.damage,
      muzzle,
      this.battle.hittablesAgainst(tank.team),
      m.range,
      MG_SHOT,
    );
    if (shot.killed && !shot.target?.armoured) {
      this.creditKill(by, shot.target);
      if (shot.target instanceof Bot) this.onKill(shot.target, tank.team);
    }
    this.battle.hearGunshot(muzzle, tank.team);
    return true;
  }

  /**
   * A rocket or a mine going off: the hull it struck, then the blast.
   *
   * `Game.resolveOrdnance` to the line, and it has to be — what an AT item is
   * worth is `ordnanceEffect`'s, read by both sides off one table, so the day
   * a number moves it moves for the match as well as for the offline round.
   */
  private resolveOrdnance(hit: OrdnanceHit): void {
    const e = ordnanceEffect(hit.kind);
    // The direct hit, which is the thing a falloff cannot express. `shell` is
    // what gets through `CONFIG.vehicles.tank.resist` and is the whole reason
    // this kit exists.
    if (hit.hull) hit.hull.takeDamage(e.damage, hit.at, "shell");
    // …and the splash, through the one implementation of a blast in the game.
    // `by` is whoever fired it, so a kill lands on their row exactly as a
    // grenade's does — `wire`'s `onBlastHit` is already wired for it.
    this.grenades.blastAt(hit.at, hit.team, hit.by, {
      radius: e.blast.radius,
      inner: e.blast.inner,
      damage: e.blast.damage,
      kind: "shell",
      power: e.blast.power,
    });
  }

  /**
   * A person's rocket, launched by the authority on their behalf.
   *
   * Returns false when the pool refused it, and a caller that gets a false must
   * not debit the pouch — `AntiTankSystem.launch`'s contract, unchanged by
   * being reached over a socket.
   */
  launchRocket(from: Vector3, dir: Vector3, by: NetPlayer): boolean {
    if (!this.antiTank.launch(from, dir, by.team, by)) return false;
    // Heard exactly as a rifle is, and by the same door: a rocket leaving is
    // the loudest thing on the map after a tank gun, and the side that fired
    // it has just told everybody where it is.
    this.battle.hearGunshot(from, by.team);
    return true;
  }

  /** A person's mine, laid by the authority on their behalf. */
  layMine(at: Vector3, by: NetPlayer): boolean {
    return this.antiTank.place(at, by.team, by);
  }

  /** Wired by `Match`: a tank gun went off, for the fifteen other screens. */
  onCannon: (tank: Tank) => void = () => {};

  /** Scratch for the shell's muzzle and the gun's axis. Never per frame. */
  private readonly shellFrom = new Vector3();
  private readonly shellDir = new Vector3();

  /**
   * Seats a human in a slot, and takes the bot that was there off the field.
   *
   * The bot is benched rather than killed: killing it would charge its team a
   * reinforcement for somebody joining the game, which is a ticket the round
   * should never lose. `BattleSystem.setBenched` owns what that means.
   */
  addPlayer(slot: number, team: Team): NetPlayer {
    const player = new NetPlayer(slot, team);
    // A hit taken by a person needs a ticket charged and an event sent, and
    // neither is `CombatSystem`'s business — it calls `takeDamage` and reads
    // only whether that killed. Routed here for the same reason every other
    // cross-system effect in this file is: the systems never reach each other.
    player.onDamaged = (amount, from, killed, kind) => {
      if (killed) {
        this.conquest.registerDeath(player.team);
        // The victim's door for a person, and the counterpart of the line in
        // `onKill` that counts a bot's. Whoever killed them was credited at
        // their own door, wherever the round or the blast came from.
        this.registerDeath(player.slot);
      }
      this.onPlayerDamaged(player, amount, from, killed, kind);
    };
    if (this.map) player.leash.setMap(this.map.size, this.map.margin);
    this.players.set(slot, player);
    this.lag.track(player);
    this.battle.addHuman(player);
    this.battle.setBenched(this.battle.bots[slot], true);
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
    // `Tank.occupied` for the rest of the round and nobody — no player, no bot
    // crew — is ever offered it again. It is the same "getting out is the
    // exact inverse of getting in" rule `Game.clearVehicle` rests on, and a
    // disconnect is one of the four ways out of a seat.
    this.seat(player, null);
    player.retire();
    this.players.delete(slot);
    this.lag.untrack(player);
    this.battle.removeHuman(player);
    this.battle.setBenched(this.battle.bots[slot], false);
  }

  /** Where a human of `team` should deploy — the same picker the bots use. */
  spawnFor(team: Team): { pos: Vector3; yaw: number } | null {
    return this.spawnPointFor(team);
  }

  /**
   * A bot went down. Charges the ticket, counts the death and reports it
   * upward.
   *
   * `Match` wires `onKill` to turn this into a killfeed event for the clients;
   * this class does not know what a client is.
   *
   * The DEATH is counted here and the kill is not — see `creditKill`. This is
   * the victim's door and there is exactly one of it per bot death, which is
   * the same "exactly once" the ticket above has always rested on.
   */
  private onKill(bot: Bot, killer: Team, headshot = false): void {
    this.conquest.registerDeath(bot.team);
    this.registerDeath(this.battle.bots.indexOf(bot));
    this.onKillEvent(bot, killer, headshot);
  }

  /**
   * A combatant put somebody down: the kill, and everything it earned, on
   * their own row.
   *
   * **The kill is counted at the KILLER's door and the death at the victim's,
   * once each.** They are separate doors because they are separate facts with
   * separate witnesses — every death in the game already arrives somewhere
   * (`onKill` for a bot, `NetPlayer.onDamaged` for a person, whatever dealt it)
   * while the killer is known only to whatever fired, and pairing them would
   * mean one of the two paths inventing the half it cannot see. It is also what
   * lets a kill be credited when the victim is a person, which the old
   * bot-shaped callback simply dropped.
   *
   * Silent on a thrower this class cannot place. A grenade with no owner and a
   * body that is not on the roster are both "nobody's kill" rather than an
   * error: the death is counted regardless, so the board still balances at the
   * team level even when a row cannot be found for the credit.
   */
  private creditKill(
    by: Combatant | null,
    victim: Hittable | null,
    headshot = false,
  ): void {
    if (!by) return;
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
  }

  /**
   * Pays everyone of `by` standing in `point` for what the flag just did.
   *
   * The authority's half of `Game.awardZone`, and the same rule: presence at
   * the moment the meter moved, tested with the same `pointAt` that moved it,
   * not split between the bodies that earned it. The dead and the benched fall
   * out through `alive`, which is what stops a benched bot being paid for a
   * capture the person in its slot is standing somewhere else for.
   */
  private awardZone(
    point: ControlPoint,
    by: Team,
    kind: "capture" | "neutralise",
  ): void {
    for (const unit of this.combatants) {
      if (!unit.alive || unit.team !== by) continue;
      if (this.conquest.pointAt(unit.position) !== point) continue;
      this.scores.award(this.slotOf(unit), kind);
    }
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

  /** One death on `slot`'s row. Called once per body that goes down. */
  registerDeath(slot: number): void {
    this.scores.registerDeath(slot);
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
    return c instanceof NetPlayer ? c.slot : -1;
  }

  /**
   * Wired by `Match`: a body went down, for the killfeed and for the corpse.
   *
   * `headshot` defaults false and is true only where the resolving path knows
   * it — a person's round through `resolveShot`. A bot's rifle never tests the
   * head zone at all (see the `headMult` note there), so false is the answer
   * rather than a missing one, and a blast has no such zone to hit.
   */
  onKillEvent: (bot: Bot, killer: Team, headshot: boolean) => void = () => {};

  /**
   * Wired by `Match`: a flag was taken, or driven to neutral, for the clients
   * to hear about.
   *
   * The presentation half of the two conquest callbacks this class now takes
   * for the scoring in `wire`. `Match` queues an event on each and decides
   * nothing, which is why they are shaped as the events rather than as the
   * points that were paid a line earlier.
   */
  onCapturedEvent: (point: ControlPoint, by: Team) => void = () => {};
  onNeutralisedEvent: (point: ControlPoint) => void = () => {};

  /** Wired by `Match`: a person has been placed in the world. */
  onPlayerSpawned: (player: NetPlayer, at: Vector3, yaw: number) => void = () => {};

  /**
   * Wired by `Match`: a blast went off here, and how big it LOOKS.
   *
   * `power` is `BlastSpec.power` — the grenade is 1 and everything else is a
   * multiple of it. It is on the callback rather than derived at the far end
   * because the far end is a socket: a client cannot know whether the thing
   * that just went off was a frag, a shell or a rocket, and the difference is
   * the whole size of the fireball.
   */
  onExplosion: (at: Vector3, power: number) => void = () => {};

  /**
   * Wired by `Match`: this person got into a hull or was put out of one, and
   * this is the answer their own client is waiting for.
   *
   * `at`/`yaw` are where the body was put down and are meaningful only on the
   * way out — the caller's vector, read inside the call.
   */
  onSeatChanged: (
    player: NetPlayer,
    tank: number,
    at: Vector3,
    yaw: number,
  ) => void = () => {};

  /**
   * Wired by `Match`: one or more panes just went in.
   *
   * `origin`/`dir`/`dist` describe the round that crossed them rather than the
   * panes themselves, because `Match` puts the FIRST crossing on the wire and
   * the direction with it — see the `glass` event. Both vectors are the
   * caller's and are read inside the call.
   */
  onGlassBroken: (panes: number[], at: Vector3, dir: Vector3) => void = () => {};

  /**
   * Wired by `Match`: a round passed close to this person without hitting them.
   *
   * `at` is the point of closest approach and is `CombatSystem`'s module
   * scratch vector — read it inside the call or copy it; it is overwritten by
   * the next near miss, which in a firefight is the next round.
   */
  onNearMiss: (player: NetPlayer, at: Vector3) => void = () => {};

  /** Wired by `Match`: a person took a hit. */
  onPlayerDamaged: (
    player: NetPlayer,
    amount: number,
    from: Vector3 | undefined,
    killed: boolean,
    kind: DamageKind,
  ) => void = () => {};

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
   * `Game.spawnPointFor`'s logic, including the scatter — a whole squad landing
   * on one point is as bad here as it is on the client. `Math.random()` is
   * correct on this side of the wire: the server decides where people appear
   * and tells them, so there is nothing for a client to reproduce.
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
  ): { pos: Vector3; yaw: number } | null {
    const pick =
      (requested != null ? this.conquest.deployAt(team, requested) : null) ??
      this.conquest.spawnFor(team);
    if (!pick) return null;
    return {
      pos: pick.pos.add(
        new Vector3((Math.random() - 0.5) * 6, 0, (Math.random() - 0.5) * 6),
      ),
      yaw: pick.yaw,
    };
  }
}

/** The LOD reference point — see `step`. */
const ORIGIN = new Vector3(0, 0, 0);
