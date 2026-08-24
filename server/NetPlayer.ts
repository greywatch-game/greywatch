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
   * Counts down from `regenDelay` after each hit; regen resumes at zero. The
   * server's copy of `Player.regenLockT`, and it has to exist here because the
   * authority owns the health: regen is a rule about the number, and a rule
   * about the number belongs wherever the number is decided.
   */
  private regenLockT = 0;

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
  onDamaged: (amount: number, from: Vector3 | undefined, killed: boolean) => void =
    () => {};

  /**
   * Damage from a bot or another player. The server is the only thing that may
   * call this, and the client is told the outcome.
   *
   * `from` is where the round started, which the client turns into the
   * directional damage arc. Every damage path in the game already passes it.
   */
  takeDamage(amount: number, from?: Vector3): boolean {
    if (!this.alive) return false;
    this.health -= amount;
    this.regenLockT = CONFIG.player.regenDelay;
    const killed = this.health <= 0;
    if (killed) {
      this.health = 0;
      this.alive = false;
      this.respawnT = CONFIG.conquest.respawnDelay;
    }
    this.onDamaged(amount, from, killed);
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
    // Death is the only resupply. See the field's note.
    this.grenades = CONFIG.grenade.carried;
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
    // A rotation retires everybody and then builds a different map. The request
    // is an index into the OLD map's spawn table, so carrying it across would
    // deploy the player at whatever happens to be in that slot on the new one.
    this.deployRequest = null;
  }
}
