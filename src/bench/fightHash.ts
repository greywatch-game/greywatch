/**
 * bench/fightHash.ts — `FightHash`: one string that says whether two runs of
 * the benchmark's round fought the same fight.
 * Owns: the fold — every award and death, in order, with the step it landed
 * on — and nothing about where those come from: the page's local match folds
 * its round's events as it drains them (`server/localMatch.ts`), and
 * `server/corecheck.ts` folds a core's and a `Match`'s the same way to show
 * the round they play is the bench's.
 * Invariants: allocation-free per event, and a pure function of what it is
 * handed. Imports nothing, so the authority's bundle may hold it (the
 * babylon-free gate walks every server import).
 * Never: reads a clock, a seed or the core itself.
 */

/**
 * A hash of the fight as it happens — every award and every death, in order,
 * stamped with the fixed step it landed on — so two runs can be compared by
 * one string. `npm run simulate`'s `fight` is the same idea on the authority;
 * the two do not print the same hash — a different fold over a different
 * round (the server's pool is the ceiling, the bench's the map's own) — and
 * nothing compares across them.
 *
 * Two FNV-1a lanes with different bases, which is 64 bits of "same or not" for
 * a comparison between a handful of runs. Nothing here allocates: an event is
 * folded in as it is reported, a string by its char codes.
 *
 * **The step an event is stamped with is the EVENT's**: the fight is the
 * simulation core's, which says what happened
 * through its event ring with the tick it happened on, and the folder — the
 * local match, as it drains — hands that tick less the fight's first in. One
 * step is one tick, and folding the tick the event carries is what keeps the
 * hash a statement about the core's fight rather than about when anybody got
 * round to reading it.
 */
export class FightHash {
  /** Awards and deaths folded in. */
  events = 0;
  private a = 0x811c9dc5;
  private b = 0x9e3779b9;

  award(step: number, slot: number, kind: string, points: number): void {
    this.fold(step);
    this.fold(1);
    this.fold(slot);
    for (let i = 0; i < kind.length; i++) this.fold(kind.charCodeAt(i));
    this.fold(points);
    this.events++;
  }

  death(step: number, slot: number): void {
    this.fold(step);
    this.fold(2);
    this.fold(slot);
    this.events++;
  }

  get hex(): string {
    return hex8(this.a) + hex8(this.b);
  }

  private fold(v: number): void {
    // Integers in practice (a step, a slot, a char, points); a fraction is
    // folded as its thousandths rather than dropped.
    let x = Math.round(v * 1000) | 0;
    for (let k = 0; k < 4; k++) {
      const byte = x & 0xff;
      x >>>= 8;
      this.a = Math.imul(this.a ^ byte, 0x01000193);
      this.b = Math.imul(this.b ^ byte, 0x01000193);
    }
  }
}

function hex8(v: number): string {
  return (v >>> 0).toString(16).padStart(8, "0");
}
