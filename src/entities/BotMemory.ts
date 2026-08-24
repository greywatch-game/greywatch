/**
 * BotMemory.ts — One bot's decaying picture of the fight, and nothing else.
 * Owns: the last-known enemy position, the bearing danger came from, the
 * arousal and suppression scalars, and the target kept alive past `target`
 * going null.
 * Invariants: allocation-free after construction — one per pooled Bot, cleared
 * on respawn, never reallocated. Never raycasts and never touches the scene: a
 * cue is a *bearing*, not an enemy, and promoting one to a target would let a
 * bot shoot at a noise. Everything here decays; nothing is permanent knowledge.
 */
import { Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { Combatant } from "./Combatant";

/**
 * What a bot remembers.
 *
 * Before this existed the entire model was a single `pressure` float set to 1
 * on any damage: a bot knew it was being hurt and nothing about by whom, from
 * where, or where the enemy had gone. Losing sight of a target dropped straight
 * back to walking at the objective.
 *
 * The two scalars pull in opposite directions on purpose. `alert` is arousal —
 * it widens the view cone and makes a bot look harder. `suppression` is
 * pressure — it degrades what the bot can do. A rookie who has been shot at is
 * both alert and suppressed; an ace is mostly the former.
 */
export class BotMemory {
  /** Where danger last came from. Meaningful only while `threatT > 0`. */
  readonly threat = new Vector3();
  threatT = 0;

  /** Where an enemy was last actually seen. Drives the `hunt` state. */
  readonly lastKnown = new Vector3();
  lastKnownT = 0;

  /** 0..1 arousal: widens the cone, quickens the search. */
  alert = 0;
  /** 0..1 near-miss pressure. */
  suppression = 0;

  /**
   * The enemy this bot was last aiming at, kept past `target` going null.
   *
   * Load-bearing: dropping a target on a lost line of sight reads as a target
   * *change* on the next think, which would reset the reaction wind-up — the
   * failure that once made bots never fire at all. This is what lets a
   * re-acquisition cost `reacquireDelay` instead of starting over.
   */
  lastAimed: Combatant | null = null;
  lastAimedT = 0;

  /** Wipes everything. Called on respawn — a fresh body knows nothing. */
  reset(): void {
    this.threatT = 0;
    this.lastKnownT = 0;
    this.alert = 0;
    this.suppression = 0;
    this.lastAimed = null;
    this.lastAimedT = 0;
  }

  /**
   * Per-frame bleed-off. Cheap enough to run every frame rather than per think,
   * which keeps the cone width and search urgency smooth instead of stepping at
   * 5 Hz.
   */
  decay(dt: number): void {
    const p = CONFIG.bots.perception;
    this.threatT = Math.max(0, this.threatT - dt);
    this.lastKnownT = Math.max(0, this.lastKnownT - dt);
    this.lastAimedT = Math.max(0, this.lastAimedT - dt);
    if (this.lastAimedT <= 0) this.lastAimed = null;
    this.alert = Math.max(0, this.alert - dt * p.alertDecay);
    this.suppression = Math.max(0, this.suppression - dt * p.suppressDecay);
  }

  /** Currently looking at an enemy: the strongest cue there is. */
  sawEnemy(at: Vector3): void {
    this.lastKnown.copyFrom(at);
    this.lastKnownT = CONFIG.bots.combat.threatMemory;
    this.threat.copyFrom(at);
    this.threatT = CONFIG.bots.combat.threatMemory;
    this.alert = 1;
  }

  /**
   * Took a round. `from` is the shooter's origin, which the combat system has
   * always passed and `Bot` used to discard.
   */
  tookHit(from: Vector3): void {
    this.threat.copyFrom(from);
    this.threatT = CONFIG.bots.combat.threatMemory;
    this.alert = 1;
    // A hit is not a sighting — the bot knows a direction, not a position it
    // could walk to and expect to find someone. But it is worth investigating,
    // so seed the search with it at full staleness rather than not at all.
    if (this.lastKnownT <= 0) {
      this.lastKnown.copyFrom(from);
      this.lastKnownT = CONFIG.bots.combat.threatMemory * 0.5;
    }
  }

  /** A round cracked past without connecting. */
  nearMiss(from: Vector3): void {
    const p = CONFIG.bots.perception;
    this.threat.copyFrom(from);
    this.threatT = CONFIG.bots.combat.threatMemory;
    this.alert = Math.min(1, this.alert + p.suppressPerMiss);
    this.suppression = Math.min(1, this.suppression + p.suppressPerMiss);
  }

  /**
   * Heard a gunshot at `at`. `hostile` separates "someone is shooting at my
   * side over there" from "one of ours is in a fight over there" — the second
   * is a much weaker pull, and is what makes a squad drift toward contact.
   */
  heardShot(at: Vector3, hostile: boolean, jitterX: number, jitterZ: number): void {
    const p = CONFIG.bots.perception;
    const weight = hostile ? 1 : p.friendlyHearMult;
    // Never overwrite something the bot actually saw with something it heard.
    if (this.lastKnownT > 0 && !hostile) return;
    this.threat.set(at.x + jitterX, at.y, at.z + jitterZ);
    this.threatT = Math.max(this.threatT, CONFIG.bots.combat.threatMemory * weight);
    this.alert = Math.min(1, this.alert + 0.5 * weight);
    if (this.lastKnownT <= 0) {
      this.lastKnown.copyFrom(this.threat);
      this.lastKnownT = CONFIG.bots.combat.threatMemory * weight;
    }
  }

  /** Is there anything worth reacting to? Drives the `hunt` transition. */
  get hasCue(): boolean {
    return this.lastKnownT > 0 || this.threatT > 0;
  }

  /** True while a threat cue is live; widens the view cone. */
  get alerted(): boolean {
    return this.threatT > 0;
  }
}
