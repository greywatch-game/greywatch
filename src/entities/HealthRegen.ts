/**
 * HealthRegen.ts — a person's health coming back: none for `regenDelay`
 * seconds after a hit, then `regenRate` a second back to full.
 * Owns: the lock clock, and the one statement of the curve.
 * Invariants: held by exactly two things — `Player`, which PREDICTS the curve,
 * and `server/NetPlayer`, which is authoritative over it — and both step it
 * off the same two numbers to the same cap, `CONFIG.player.maxHealth`. A hit
 * re-arms the lock (`hit`); a fresh body clears it (`clear`).
 * Never: hold the health itself. The number is the body's, because the
 * client's arrives from the wire as well as from this curve
 * (`Player.applyServerHealth`), and a second copy of it here would be a third
 * opinion about how hurt somebody is.
 *
 * **One copy because the two sides predict each other.** The client heals
 * along the curve from the lock its own `damage` event armed, and the health
 * on the NEXT such event is the correction — so the two agree to within the
 * trip, and only for as long as they are running the same curve to the same
 * cap. Written out once each, the caps had already differed (the client's
 * included a roguelike max-health bonus the authority had never heard of), and
 * a client that heals past the authority's ceiling snaps back down on every
 * correction.
 */
import { CONFIG } from "../config";

export class HealthRegen {
  /** Counts down from `regenDelay` after each hit; healing resumes at zero. */
  private lockT = 0;

  /** A hit landed: hold the healing off for the full delay again. */
  hit(): void {
    this.lockT = CONFIG.player.regenDelay;
  }

  /** A fresh body: nothing to wait out. */
  clear(): void {
    this.lockT = 0;
  }

  /**
   * Ages the lock by `dt` and returns `health` healed by whatever the curve
   * owes this step — unchanged while the lock holds or at full.
   *
   * Without this, sixteen hostile bots and no medic turns a round into a
   * respawn queue for anyone who wins a fight at half health.
   */
  step(health: number, dt: number): number {
    const p = CONFIG.player;
    this.lockT = Math.max(0, this.lockT - dt);
    if (this.lockT > 0 || health >= p.maxHealth) return health;
    return Math.min(p.maxHealth, health + p.regenRate * dt);
  }
}
