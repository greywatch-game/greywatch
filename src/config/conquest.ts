/**
 * config/conquest.ts — flags, the capture meter, tickets and bleed.
 * Owns: the round's win condition and its clock. Read `docs/../CLAUDE.md`'s
 * Conquest rules section before changing the meter: ownership flips only by
 * crossing 0, and these numbers are what make that readable in play.
 */

/** Conquest round rules. */
export const conquest = {
  /**
   * Starting reinforcements per team. Sized against the drain below for a
   * round of roughly 12-15 minutes; deaths dominate the rate, so this is the
   * number most worth revisiting after real playtesting.
   */
  tickets: 400,
  /** Cost of one death. */
  ticketsPerDeath: 1,
  /** How often the flag-deficit bleed is applied (seconds). */
  bleedInterval: 3,
  /**
   * Tickets lost per interval, per flag the losing team is behind by: 20/min
   * when one flag down, 60/min when three down. Steep enough that ignoring
   * objectives loses the round, shallow enough that one bad push doesn't.
   */
  bleedPerFlagDeficit: 1,
  /** Radius of a control point's capture zone (metres). */
  captureRadius: 12,
  /**
   * Capture meter runs -1 (team 0 owns) .. +1 (team 1 owns) and moves at
   * this rate per second with one attacker present. Crossing 0 neutralizes,
   * so a flag must be swept through neutral before it flips.
   */
  captureRate: 0.07,
  /**
   * Extra capture rate per additional body, with diminishing returns — the
   * Nth attacker adds `captureRate * crowdFalloff^(N-1)`.
   */
  crowdFalloff: 0.55,
  /** Cap on the crowd bonus, so a whole squad can't instantly flip a flag. */
  maxCaptureMult: 2.6,
  /** Seconds between death and being allowed to redeploy. */
  respawnDelay: 8,
} as const;
