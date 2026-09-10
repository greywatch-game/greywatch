/**
 * server/MapVote.ts — The ballot for the next map: who is offered what, who
 * voted for which, and which candidate that adds up to.
 * Owns: the candidate list, the per-slot tally and the tie-break. It owns no
 * transport (`Match` sends and receives) and no rotation (`Match.rotate`
 * reads `winner` and acts on it), and it deliberately holds no timer — the
 * window is the round-over pause `Match` was already waiting out, so a clock
 * here would be a second opinion about when the next map is built.
 * Invariants: a vote is an INDEX into `maps` and is refused if it is not one,
 * so nothing this class holds can name a map the server did not offer; and
 * `winner` always answers, on an empty ballot as readily as a full one.
 *
 * It is a class rather than three fields on `Match` because the rules below
 * are the feature — everything else about a vote is a message going out and a
 * message coming in — and because `Match` is already the longest file on this
 * side of the wire. Nothing in here touches a peer, a socket or a scene.
 *
 * **The ballot's FIRST candidate is the map the rotation would have picked
 * anyway, and that single decision is what makes the other two rules trivial.**
 * An empty vote — nobody pressed anything, which is most rounds on a quiet
 * server — resolves to it, so a match with the vote turned off by disuse
 * rotates exactly as it did before there was one. A TIE resolves to the
 * earliest candidate holding the top count, which is the same sentence: the
 * rotation order is the tie-break, rather than a coin toss whose result nobody
 * on the card could have predicted. And because the fallback and the tie-break
 * are one rule, there is no arrangement of votes in which the card shows a
 * winner it did not name.
 *
 * **A candidate is never the map just played.** A rotation that can land back
 * on the map everybody has spent the last ten minutes on is one where three
 * quarters of the ballot is a vote to stop playing it, and the one map that
 * cannot be voted for is the one nobody has to be asked about.
 */

/** How many maps a ballot offers, when there are that many to offer. */
export const BALLOT_SIZE = 3;

export class MapVote {
  /** The candidates, in ballot order — an index into this is a vote. */
  readonly maps: readonly string[];

  /**
   * Slot -> the candidate index that slot is voting for.
   *
   * Keyed by SLOT and not by peer id, which is the same identity every other
   * per-person table in the match uses and is what makes a vote survive the
   * only thing that can happen to a peer inside the window: a socket that
   * drops is a slot going back to a bot, and `Match.drop` clears the row
   * rather than leaving a vote cast by nobody.
   */
  private readonly cast = new Map<number, number>();

  /**
   * `order` is the whole rotation in rotation order, `current` the map that
   * has just been played, and `pick` a source of randomness — passed in so
   * this class is a pure function of its arguments and a test can pin it.
   *
   * The list is WALKED FROM `current` rather than read from its start, which
   * is what makes the first candidate the map the rotation would have picked
   * anyway — the whole of the header's argument rests on that, and taking
   * `order[0]` instead would make the fallback "the first map in the build" on
   * every round but one.
   *
   * The candidates after the first are drawn at RANDOM from what is left,
   * rather than being the next two in the rotation. A ballot of three
   * consecutive maps is the same three every time the rotation comes round,
   * which is a rotation with extra steps; drawing the rest means the map five
   * places away is reachable in one round while the fallback stays exactly
   * where it was.
   */
  constructor(
    order: readonly string[],
    current: string,
    pick: () => number = Math.random,
  ) {
    // A `current` this list does not contain cannot happen through `Match` —
    // the map id came out of `MAPS` — and the slice below is written so that
    // the -1 it would produce reads as "start at the beginning" rather than as
    // an empty rotation.
    const at = order.indexOf(current);
    const from = at < 0 ? order : [...order.slice(at + 1), ...order.slice(0, at + 1)];
    const rest = from.filter((id) => id !== current);
    // A rotation of one map — a build with a single map in `MAPS` — has
    // nothing to offer, and `rest` being empty is how that arrives here. The
    // ballot is then the current map, which is what the rotation does with one
    // map anyway, and the card draws a single candidate nobody needs to press.
    const first = rest.length > 0 ? rest[0] : current;
    const pool = rest.filter((id) => id !== first);
    const maps = [first];
    while (maps.length < BALLOT_SIZE && pool.length > 0) {
      maps.push(pool.splice(Math.floor(pick() * pool.length), 1)[0]);
    }
    this.maps = maps;
  }

  /**
   * Records one slot's pick, and says whether the tally actually moved.
   *
   * The return value is what `Match` broadcasts on, so a player pressing the
   * same button twice — or a client re-sending on a socket that bunched —
   * costs the other fifteen nothing. An index off the ballot is dropped rather
   * than clearing the slot's existing vote: a vote is a preference, and the
   * honest answer to a malformed one is to keep the last good one.
   */
  vote(slot: number, index: number): boolean {
    if (!Number.isInteger(index) || index < 0 || index >= this.maps.length) {
      return false;
    }
    if (this.cast.get(slot) === index) return false;
    this.cast.set(slot, index);
    return true;
  }

  /** Forgets a slot's vote — a peer that left inside the window. */
  clear(slot: number): boolean {
    return this.cast.delete(slot);
  }

  /** What this slot is voting for, or -1. */
  choiceOf(slot: number): number {
    return this.cast.get(slot) ?? -1;
  }

  /** Votes per candidate, in ballot order. */
  tally(): number[] {
    const counts = this.maps.map(() => 0);
    for (const index of this.cast.values()) counts[index]++;
    return counts;
  }

  /**
   * The map to build next — the most-voted candidate, earliest on the ballot
   * breaking a tie, and the first candidate when nobody voted at all. See the
   * header: those are one rule and not three.
   */
  winner(): string {
    const counts = this.tally();
    let best = 0;
    for (let i = 1; i < counts.length; i++) {
      if (counts[i] > counts[best]) best = i;
    }
    return this.maps[best];
  }
}
