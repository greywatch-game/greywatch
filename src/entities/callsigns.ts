/**
 * callsigns.ts — What to call a body that nobody named.
 * Owns: the one mapping from a roster index to a display name for an AI
 * combatant. Pure data and one function; no Babylon, no CONFIG, no state.
 * Invariants: the name is derived from the INDEX alone, so the same body reads
 * the same on every screen and in every round without anything being sent for
 * it. It must never be renumbered by who is in the match — a human joining
 * takes a slot's name off the board, it does not shuffle the fifteen others.
 *
 * A person's name is their own and comes from the roster (`SlotOccupant`); this
 * is only for the slots no person is in. Offline that is every bot but the one
 * the local player sits on (`BattleSystem.seatPlayer`), and the roster index is
 * the bot's index in `BattleSystem.bots`; in a match it is the slot, which is
 * the same number by construction — see `server/Roster.ts`.
 */

/**
 * Sixteen names for sixteen slots, which is the whole roster at
 * `CONFIG.bots.perTeam` of 8. Team 0 takes the first half and team 1 the
 * second, because that is the order both `BattleSystem` and `Roster` lay their
 * slots out in — so a side's callsigns are contiguous without anything here
 * knowing what a team is.
 */
const PHONETIC = [
  "ALPHA",
  "BRAVO",
  "CHARLIE",
  "DELTA",
  "ECHO",
  "FOXTROT",
  "GOLF",
  "HOTEL",
  "INDIA",
  "JULIET",
  "KILO",
  "LIMA",
  "MIKE",
  "NOVEMBER",
  "OSCAR",
  "PAPA",
] as const;

/**
 * The name for the AI in roster slot `index`.
 *
 * Past the sixteenth it repeats with a number rather than running out or
 * throwing — a bigger roster is a config change away (`bots.perTeam`), and a
 * scoreboard row reading `ALPHA-2` is a worse name than `ALPHA` but a better
 * outcome than `undefined`.
 */
export function callsign(index: number): string {
  const name = PHONETIC[index % PHONETIC.length];
  const lap = Math.floor(index / PHONETIC.length);
  return lap === 0 ? name : `${name}-${lap + 1}`;
}
