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
import type { Combatant, Team } from "../src/entities/Combatant";
import type { WeaponSetup } from "../src/entities/weapons";
import { BattleSystem } from "../src/systems/BattleSystem";
import {
  CombatSystem,
  type Hittable,
  type ShotResult,
} from "../src/systems/CombatSystem";
import {
  ConquestSystem,
  type ControlPoint,
} from "../src/systems/ConquestSystem";
import { GlassSystem } from "../src/systems/GlassSystem";
import { GrenadeSystem } from "../src/systems/GrenadeSystem";
import { ScoreBook, awardKill } from "../src/systems/ScoreBook";
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
    // is a rule and belongs here; the dust needs a canvas and WebGL2 and does
    // not exist on this side — see `GrenadeOptions`.
    this.grenades = new GrenadeSystem(this.scene, this.mats, { dust: false });
    this.wire();
  }

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
    // The floor is the backstop under the collider proxies — without it a
    // grenade that misses every box falls forever.
    this.grenades.setTerrain(this.map.terrain);
    this.grenades.reset();
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

    // AFTER everything has moved, so a frame records the end of a tick and not
    // the middle of one. Recording first would put every body's history half a
    // tick ahead of the positions the snapshot on that tick reports, and a
    // rewind would land between two states that never coexisted.
    this.lag.record(Date.now());
    return true;
  }

  dispose(): void {
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
    this.grenades.onExploded = (at) => this.onExplosion(at);
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
  }

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
    player.onDamaged = (amount, from, killed) => {
      if (killed) {
        this.conquest.registerDeath(player.team);
        // The victim's door for a person, and the counterpart of the line in
        // `onKill` that counts a bot's. Whoever killed them was credited at
        // their own door, wherever the round or the blast came from.
        this.registerDeath(player.slot);
      }
      this.onPlayerDamaged(player, amount, from, killed);
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

  /** Wired by `Match`: a grenade went off here. */
  onExplosion: (at: Vector3) => void = () => {};

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
