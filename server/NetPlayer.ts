/**
 * server/NetPlayer.ts — A connected human, as the simulation sees one.
 * Owns: the authoritative position, stance, health and team of one player. NOT
 * the position history a shot is rewound against — that is `LagComp`'s, which
 * records every `Hittable` the same way and so cannot drift between a bot and a
 * person.
 * Invariants: this is the ONLY record of where a player is that anything on the
 * server trusts. A client reports a position; `validate` decides whether this
 * object accepts it. Nothing here reads a client message directly.
 *
 * It is a `Combatant`, so `BattleSystem.acquire`, `hittablesAgainst` and
 * `ConquestSystem`'s occupancy count take it exactly as they take a `Bot` — a
 * bot cannot tell a person from another bot, and does not need to.
 *
 * There is no movement simulation here and that is the design, not an omission:
 * clients simulate their own `Player` and report the result, and the server's
 * job is to reject what is impossible rather than to recompute what is
 * ordinary. See `docs/multiplayer.md` for the trade that was taken and why
 * input replay was not.
 */
import { Vector3 } from "@babylonjs/core";
import { CONFIG } from "../src/config";
import type { Combatant, Team } from "../src/entities/Combatant";
import { DRIVER, type CrewSeat } from "../src/entities/Vehicle";
import type { DamageKind } from "../src/systems/CombatSystem";
import { Leash } from "../src/world/leash";

export class NetPlayer implements Combatant {
  readonly position = new Vector3();
  readonly eyePos = new Vector3();
  readonly center = new Vector3();
  hitRadius = CONFIG.player.hitRadius;
  alive = false;
  health: number = CONFIG.player.maxHealth;

  yaw = 0;
  pitch = 0;
  crouching = false;
  sprinting = false;
  /**
   * The stance as a 0..1 blend, eased toward `crouching` exactly as
   * `Player.syncCombatant` eases its own. The eye and the hit sphere are
   * derived from THIS and never from the boolean, and it is what the snapshot
   * carries: a client draws the body from the authority's own blend rather than
   * running a second one of its own — see `EntityState.crouch`.
   */
  crouchBlend = 0;

  /**
   * How long this player has been outside the play square, on a map whose
   * boundary is open.
   *
   * Per body and not per match, because it is a fact about one person's walk;
   * `HeadlessGame` points it at the map and steps it, exactly as the client's
   * `Game` does with its own. **This is the one that decides**: the client runs
   * the same clock off its own predicted movement so the countdown is on screen
   * the instant the line is crossed, and it draws it rather than acting on it.
   */
  readonly leash = new Leash();

  /** Highest input sequence accepted. A correction names this. */
  seq = 0;
  /** Client clock reading of the last accepted sample, for rate limiting. */
  lastTime = 0;

  /** Seconds until this player may deploy again. */
  respawnT = 0;

  /**
   * The spawn this player has asked to come back at — an index into the map's
   * own spawn table — or null while they have asked for nothing.
   *
   * A person is deployed only once this is set, which is the whole of spawn
   * selection on this side: the reinforcement clock says WHEN and this says
   * WHERE, and neither is enough alone. It is a request and not a placement —
   * `HeadlessGame` resolves it against what the team may actually use at the
   * moment it acts, so an index naming a flag that fell while the message was
   * in flight costs the player nothing but the position they picked.
   *
   * Written by `Match` from a client message after the shape check, exactly as
   * `seq` and `lastTime` are, and read nowhere else in this class. Cleared when
   * it is spent and on `retire`, because a map rotation renumbers the table it
   * indexes into.
   */
  deployRequest: number | null = null;

  /**
   * How far through a death this body is, 0 while alive and 1 once it is done —
   * the same quantity `Bot.deathProgress` reports, riding the same snapshot
   * field, so a client draws a person going down exactly as it draws a bot and
   * still cannot tell which slots are people.
   *
   * Derived from the respawn clock rather than from a timer of its own: that
   * clock is already the only thing counting since the moment of death, and a
   * second one is a second thing to forget to advance. Sending a bare 1 instead
   * — which is what this replaced — makes a killed player VANISH on the tick
   * they die rather than fall, and it takes the ragdoll with them, because 1 is
   * what tells a client to stop drawing the body.
   *
   * A slot that has never been spawned reads 1, and that is right: it is not a
   * body falling, it is a body that was never there, and 1 is what tells a
   * client to draw nothing.
   */
  get deathProgress(): number {
    if (this.alive) return 0;
    const since = CONFIG.conquest.respawnDelay - this.respawnT;
    return Math.min(1, since / CONFIG.bots.death.hideTime);
  }

  /**
   * Grenades left. The SERVER's count, not the client's.
   *
   * There is no resupply in this game — the pouch is refilled by death and
   * nothing else — so this is the whole of the limit, and a client that kept
   * its own would throw as many as it liked.
   */
  grenades: number = CONFIG.grenade.carried;

  /**
   * Anti-tank items left in the third slot — rockets or mines, whichever this
   * player brought.
   *
   * The SERVER's count, for `grenades`' reason exactly: there is no resupply,
   * the pouch is refilled by death and nothing else, and a client keeping its
   * own would fire as many as it liked. What the number MEANS is the
   * loadout's; `Match` holds that and debits this.
   */
  ordnance = 0;

  /**
   * The hardstanding this player is sitting in, or -1 on foot.
   *
   * **The authority's copy of `Game.driving`, and the single fact the feature
   * turns on over here as well.** It decides which validator a reported
   * position goes through (`validateDrive` rather than `validateMove`), whether
   * a `shell` may be resolved at all, and whether this body is a target: a
   * driver is inside the hull, so `invulnerable` goes up for exactly as long as
   * this is set, and what is being shot at is the tank.
   *
   * Written only through `HeadlessGame.seat`, which is the pair of
   * `Game.mount`/`clearVehicle` on this side and must be read as one thing with
   * them.
   */
  seat = -1;

  /**
   * …and WHICH of that hull's two jobs — `DRIVER` or `GUNNER`. Meaningless
   * while `seat` is -1, and written only through `HeadlessGame.seat` beside
   * it.
   *
   * It is what decides whether a reported hull (`drive`) is believed or
   * dropped, which of the hull's two guns a claimed round may have come out
   * of, and which slot this player fills in the snapshot's `by`/`by2` pair.
   * A second field rather than a richer `seat` because every existing reader
   * of `seat` asks "is this player in that hull" and none of them cares which
   * chair — see `Game.drivingSeat`, which makes the same split for the same
   * reason.
   */
  crewSeat: CrewSeat = DRIVER;

  /**
   * True while this body is riding in a hull: nothing may hurt it, because the
   * armour around it is what is being shot at.
   *
   * `Player.invulnerable`'s twin and the same three words of justification —
   * without it a driver is a soft target sitting at the hull's own position,
   * killable through six inches of plate by anybody who aims at the tank. What
   * kills a driver is the hull burning, and that arrives through
   * `VehicleSystem.onDestroyed` like it does offline.
   */
  invulnerable = false;

  /**
   * Counts down from `regenDelay` after each hit; regen resumes at zero. The
   * server's copy of `Player.regenLockT`, and it has to exist here because the
   * authority owns the health: regen is a rule about the number, and a rule
   * about the number belongs wherever the number is decided.
   */
  private regenLockT = 0;

  /**
   * How many AT items a full pouch is for the item this player brought, which
   * `Match` writes off the resolved loadout.
   *
   * Here rather than looked up at each respawn because this class must not
   * import the equipment table to find out: what is in the third slot is the
   * loadout's, and this object's business is only that death refills whatever
   * it was.
   */
  ordnanceCarried = 0;

  constructor(
    readonly slot: number,
    public team: Team,
  ) {}

  /**
   * Accepts a validated position and stance.
   *
   * Crouch moves BOTH the eye and the centre, the same half metre, for the
   * reason `config/player.ts` spells out at length: bots aim at `eyePos`, so an
   * eye that drops while the hit sphere stays put makes crouching make you
   * easier to kill rather than harder. Getting that wrong here would invert the
   * mechanic for every networked player while leaving it correct offline.
   *
   * Both ride `crouchBlend` rather than the boolean, and `dt` is what advances
   * it. A snapped stance would put a head somewhere no client ever drew it for
   * the quarter-second the blend takes at either end, and the rewind would
   * happily resolve shots against that phantom — the history `LagComp` records
   * is only ever as honest as the pose it samples.
   */
  apply(
    dt: number,
    x: number,
    y: number,
    z: number,
    yaw: number,
    pitch: number,
    crouching: boolean,
    sprinting: boolean,
  ): void {
    const p = CONFIG.player;
    this.position.set(x, y, z);
    this.yaw = yaw;
    this.pitch = pitch;
    this.crouching = crouching;
    this.sprinting = sprinting;
    this.crouchBlend +=
      ((crouching ? 1 : 0) - this.crouchBlend) *
      Math.min(1, dt * p.crouchBlendSpeed);

    const eyeY =
      CONFIG.camera.eyeHeight +
      (p.crouchEyeHeight - CONFIG.camera.eyeHeight) * this.crouchBlend;
    // `height / 2` standing, exactly as `Player.syncCombatant` resolves it —
    // and NOT `eyeHeight - 0.05`, which is the trap this line was in. The 0.05
    // in `config/player.ts` is where the sphere's TOP sits relative to the eye
    // (0.9 + 0.7 = 1.60, against an eye at 1.55), not where its centre does;
    // read as a centre it puts a standing player's body sphere 0.6 m up their
    // own chest, so the authority disagrees with both the client that drew the
    // body and the shooter that aimed at it.
    const centerY =
      p.height / 2 + (p.crouchCenterHeight - p.height / 2) * this.crouchBlend;
    this.eyePos.set(x, y + eyeY, z);
    this.center.set(x, y + centerY, z);
  }

  /**
   * Wired by `Match`: this player took a hit, for the vignette and the arc.
   *
   * A callback rather than a return value because `CombatSystem` calls
   * `takeDamage` and cares only whether it killed — the whole event, with the
   * bearing and the remaining health on it, has to leave by another door.
   */
  onDamaged: (
    amount: number,
    from: Vector3 | undefined,
    killed: boolean,
    kind: DamageKind,
  ) => void = () => {};

  /**
   * Damage from a bot or another player. The server is the only thing that may
   * call this, and the client is told the outcome.
   *
   * `from` is where the round started, which the client turns into the
   * directional damage arc. Every damage path in the game already passes it,
   * and `kind` rides beside it for the same reason `Player.takeDamage` forwards
   * one: the corpse a client throws is a different corpse for a blast.
   */
  takeDamage(
    amount: number,
    from?: Vector3,
    kind: DamageKind = "bullet",
  ): boolean {
    if (!this.alive) return false;
    // In a hull. The tank is the target — see `invulnerable`. Refused rather
    // than absorbed, so `CombatSystem.fire` reads "nothing happened" and no
    // hitmarker is sent back for a round that hit six inches of plate.
    if (this.invulnerable) return false;
    this.health -= amount;
    this.regenLockT = CONFIG.player.regenDelay;
    const killed = this.health <= 0;
    if (killed) {
      this.health = 0;
      this.alive = false;
      this.respawnT = CONFIG.conquest.respawnDelay;
    }
    this.onDamaged(amount, from, killed, kind);
    return killed;
  }

  /**
   * Heals back toward full once the lock a hit armed has run out — the same
   * Battlefield-style rule `Player.update` runs offline, off the same two
   * numbers, because a networked round that never refilled a health pool
   * would be the respawn queue `config/player.ts` calls the rule load-bearing
   * against, with the added twist that only the multiplayer half of the game
   * had it.
   *
   * Nothing on the wire announces it. The client predicts the identical curve
   * from the lock its own `damage` event armed, and the health on the NEXT
   * such event is the correction — so the two agree to within whatever regen
   * the trip took, and the client is the one that is behind. That direction is
   * the safe one: a player may briefly believe they have less health than the
   * authority says, never more.
   */
  regen(dt: number): void {
    if (!this.alive) return;
    this.regenLockT = Math.max(0, this.regenLockT - dt);
    if (this.regenLockT > 0 || this.health >= CONFIG.player.maxHealth) return;
    this.health = Math.min(
      CONFIG.player.maxHealth,
      this.health + CONFIG.player.regenRate * dt,
    );
  }

  spawn(at: Vector3, yaw: number): void {
    this.health = CONFIG.player.maxHealth;
    this.regenLockT = 0;
    // Death is the only resupply. See the fields' notes — the AT pouch follows
    // the same rule, and `Match` is what knows how many that is.
    this.grenades = CONFIG.grenade.carried;
    this.ordnance = this.ordnanceCarried;
    // A fresh body is on foot. A driver who died inside a hull was put out of
    // it by `HeadlessGame.seat` on the frame it burned, so this is belt and
    // braces — and it is the belt that matters: a seat left set across a death
    // would send every one of this player's reported walks through the hull
    // validator.
    this.seat = -1;
    this.crewSeat = DRIVER;
    this.invulnerable = false;
    this.alive = true;
    this.crouching = false;
    this.sprinting = false;
    // A fresh body stands, and `dt` of 0 is what says so: the blend is written
    // here rather than eased toward zero from whatever the last life ended in.
    this.crouchBlend = 0;
    // And it has never left the map. Forgotten rather than merely stopped: a
    // player killed by the leash out in the borderland would otherwise come
    // back inside a flag with most of the count already spent.
    this.leash.clear();
    this.apply(0, at.x, at.y, at.z, yaw, 0, false, false);
  }

  /** Takes this player out of the fight without killing them — a disconnect. */
  retire(): void {
    this.alive = false;
    // Out of whatever they were in. `HeadlessGame.removePlayer` gives the hull
    // up through `seat` before this runs, so this is the same belt `spawn`
    // fastens: a retired player holding a seat index is one whose hull can
    // never be offered to anybody again.
    this.seat = -1;
    this.crewSeat = DRIVER;
    this.invulnerable = false;
    // A rotation retires everybody and then builds a different map. The request
    // is an index into the OLD map's spawn table, so carrying it across would
    // deploy the player at whatever happens to be in that slot on the new one.
    this.deployRequest = null;
  }
}
