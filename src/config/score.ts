/**
 * config/score.ts — what each thing a player does is worth on the board.
 * Owns: the point table and nothing else. Which award a kill EARNS is a rule
 * about the round and lives in the wiring that can see both the body and the
 * flag it fell on (`Game.creditKill`, `HeadlessGame.creditKill`); this file
 * only says what each one pays.
 *
 * Read `systems/ScoreBook.ts` before changing a number: the same table is
 * spent by the offline round and by the authority, so a value here moves both
 * boards at once and cannot be tuned for one of them.
 */

/**
 * The point table, Battlefield-shaped: a kill is the unit, and everything a
 * flag is worth is quoted against it.
 *
 * The whole design is in the ratios rather than in any one number. A kill pays
 * 100 and a capture pays two and a half of them, so a player who takes three
 * flags and shoots five people (1250) finishes above one who shoots twelve and
 * takes none (1200) — which is the point of having a score at all beside the
 * kill column, and is the sentence to re-derive after moving any of these.
 */
export const score = {
  /** A body put down, whoever it was and however it happened. */
  kill: 100,
  /**
   * On top of the kill, for the round that found the head zone.
   *
   * Small on purpose: it is a flourish on a kill that already paid, and the
   * zone is the PLAYER's by construction (see `ShotOptions.headMult`), so a
   * number big enough to chase would be a number sixteen bots cannot earn.
   */
  headshot: 25,
  /**
   * On top of the kill, for one taken inside a zone the killer's side does NOT
   * hold — the enemy standing on their own flag, or on a neutral one.
   */
  attack: 50,
  /**
   * On top of the kill, for one taken inside a zone the killer's side DOES
   * hold — an attacker cut down on your flag.
   *
   * The same as `attack` deliberately. They are one rule seen from two sides
   * (the fight happened over a flag and you won it), and a board that paid
   * more for one than the other would be telling players which half of a
   * Conquest round to play.
   */
  defend: 50,
  /**
   * A flag taken, to everyone of the capturing side standing in the ring when
   * the meter hit the end — not split between them.
   *
   * Two and a half kills, which is what makes an objective player competitive
   * with a good shot. Not split, because splitting it would pay a squad LESS
   * for doing the thing the mode is about faster than one body can.
   */
  capture: 250,
  /**
   * A flag driven to neutral, to everyone of the pushing side in the ring as
   * the meter crossed zero.
   *
   * Less than the capture and paid on the way to it, so taking a held flag is
   * worth 350 in two instalments — the first of which is banked even if the
   * push is thrown off the point before it finishes.
   */
  neutralise: 100,
} as const;
