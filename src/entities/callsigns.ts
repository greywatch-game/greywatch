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
 * is only for the slots no person is in. Offline the index is the bot's index
 * in `BattleSystem.bots`, and every bot but the one the local player sits on
 * (`BattleSystem.seatPlayer`) gets a name from it.
 *
 * **In a match it is the row's place on the BOARD and not the roster slot**,
 * which used to be the same number and stopped being one when the authority's
 * slot table became the ceiling any map may field: on a map fielding eight a
 * side team 1 sits at slots 24-31, and naming from those would put every
 * unsuffixed name on one team and every suffixed one on the other — the exact
 * reading `callsign` refuses below. The board is the roster in slot order and
 * the roster is only the slots the round fields (`Roster.fielded`), so its own
 * index is dense, team-blocked and identical to the offline one. See
 * `Game.scoreRows` and `server/Roster.ts`.
 */

/**
 * Sixteen names for sixteen slots, which is the whole roster at
 * `CONFIG.bots.perTeam` of 8. Team 0 takes the first half and team 1 the
 * second, because that is the order both `BattleSystem` and `Roster` lay their
 * slots out in — so a side's callsigns are contiguous without anything here
 * knowing what a team is.
 *
 * A map may field more than that offline (`MapLayout.perTeam`), and the list
 * deliberately did not grow with it: see `callsign` for what the lap suffix
 * reads as on a forty-eight-slot board, and why sixteen names that repeat
 * beats twenty-six that leave one side entirely suffixed.
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
 * throwing, and that fallback is LOAD-BEARING now rather than defensive: a map
 * states its own roster (`MapLayout.perTeam`) and Sarab's twenty-four a side is
 * forty-eight slots, so team 0 reads ALPHA..PAPA then ALPHA-2..HOTEL-2 and team
 * 1 carries on from INDIA-2. Every name is still unique and still derived from
 * the index alone, which is the whole of what this file promises.
 *
 * The list was NOT extended to twenty-six to cover it, which would have been
 * the obvious move and is the wrong one: the alphabet does not divide into a
 * side either, so all it buys is a different slot for the first suffix — and at
 * twenty-four a side it would put every unsuffixed name on team 0 and every
 * suffixed one on team 1, which reads as one real team and one spare.
 */
export function callsign(index: number): string {
  const name = PHONETIC[index % PHONETIC.length];
  const lap = Math.floor(index / PHONETIC.length);
  return lap === 0 ? name : `${name}-${lap + 1}`;
}
