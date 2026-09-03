/**
 * ScoreBook.ts — the round's board: kills, deaths and POINTS, one row per
 * roster slot, and the two rules that decide what a payout is worth.
 * Owns: the three arrays and the version stamp over them, plus `awardKill` and
 * `awardZone` — the one statement each of what a kill and what a flag pay.
 * The class is a ledger, not a system: it has no update, reaches nothing, and
 * imports nothing at runtime but the point table (the `Combatant` import is
 * type-only, and erased).
 * Invariants: a row is a SLOT and a slot is a bot index (the identity the
 * roster, the bot pool and the wire all already share), so the same index
 * names the same body offline, on the authority and on every client. Kills are
 * credited at the killer's door and deaths at the victim's, once each — see
 * `award` and `registerDeath`. Every write bumps `version`, which is what
 * `Match` compares to decide whether the board has to go out again.
 * Never: let the CLASS decide which award a body earned — `award` is told a
 * kind and writes it, and nothing else. The two functions below are where that
 * is decided, and they are free functions rather than methods for the reason
 * each states: what they need (a victim, the flag they fell on, who holds it,
 * what a slot means on this side) is three systems' worth of fact, gathered by
 * the wiring — `Game.creditKill`/`awardZone` and `HeadlessGame`'s pair — and
 * handed in.
 *
 * **There is one of these per simulation, and that is the point.** The offline
 * round and the authority used to keep a `slotKills`/`slotDeaths` pair each,
 * with a `creditKill` and a `registerDeath` each, written twice and documented
 * twice; adding a third column to that arrangement would have been a third
 * thing to keep in step across two files that can only be compared by reading
 * them. A client in a NETPLAY round still owns one and never writes to it —
 * the board there is the authority's and arrives whole (`NetSession`), because
 * a client adding up the events it happened to receive would show a different
 * board on every screen.
 */
import { CONFIG } from "../config";
import type { Combatant, Team } from "../entities/Combatant";

/**
 * What a body did to earn points.
 *
 * Derived from the table rather than declared beside it, so a new award is one
 * entry in `config/score.ts` and the compiler finds everything that owes it a
 * case — the label on the HUD's feed, and nothing else.
 */
export type ScoreKind = keyof typeof CONFIG.score;

/**
 * One round's scoring, indexed by roster slot.
 *
 * Sized by `reset` at the start of a round rather than at construction,
 * because the roster is what says how many rows there are.
 */
export class ScoreBook {
  readonly kills: number[] = [];
  readonly deaths: number[] = [];
  readonly points: number[] = [];

  /**
   * Bumped by every write. `Match` sends the board when this moves and not
   * otherwise — a few times a minute rather than twenty times a second.
   */
  version = 0;

  /**
   * Wired by whoever owns this book: somebody just earned something.
   *
   * The door the "+250 CAPTURE" feed comes out of, and it is raised for EVERY
   * slot — sixteen bodies earn points all round and the reader is what filters
   * to the one row it is drawing. Presentation only: nothing about the round
   * may be decided in here, and the arrays are already written when it fires.
   */
  onAward: (slot: number, kind: ScoreKind, points: number) => void = () => {};

  /** A new round is a new board: `slots` rows of zeros. */
  reset(slots: number): void {
    this.kills.length = 0;
    this.deaths.length = 0;
    this.points.length = 0;
    for (let i = 0; i < slots; i++) {
      this.kills.push(0);
      this.deaths.push(0);
      this.points.push(0);
    }
    this.version++;
  }

  /**
   * Pays `slot` for one award.
   *
   * `"kill"` is the one kind that also moves a column: it is what a kill IS,
   * so counting it anywhere else would be a second door onto one fact. The
   * bonuses (`headshot`, `attack`, `defend`) are separate awards on top of it
   * — one call each, which is what puts three lines in the feed for one shot
   * exactly as Battlefield does, and what keeps the kill column counting
   * bodies rather than merit.
   *
   * A slot outside the roster is silently ignored rather than an error: a
   * grenade with no owner and a body nobody is sitting in are both "nobody's
   * award", and the alternative is every caller checking first. `?? 0` for the
   * same reason the counters it replaced took that care — a row that is
   * somehow not there yet starts at its own value rather than at `NaN`, which
   * would spread through the team totals and onto sixteen screens before
   * anybody could tell where it came from.
   */
  award(slot: number, kind: ScoreKind): void {
    if (slot < 0 || slot >= this.points.length) return;
    const points = CONFIG.score[kind];
    this.points[slot] = (this.points[slot] ?? 0) + points;
    if (kind === "kill") this.kills[slot] = (this.kills[slot] ?? 0) + 1;
    this.version++;
    this.onAward(slot, kind, points);
  }

  /**
   * One death on `slot`'s row. Called once per body that goes down, at the
   * victim's door.
   *
   * Deliberately not a kind and worth no points: a death is a fact about the
   * round rather than something anybody earned, and the ticket it costs is
   * `ConquestSystem`'s business.
   */
  registerDeath(slot: number): void {
    if (slot < 0 || slot >= this.deaths.length) return;
    this.deaths[slot] = (this.deaths[slot] ?? 0) + 1;
    this.version++;
  }

  /** One row, for a reader that has a slot and wants all three numbers. */
  row(slot: number): { kills: number; deaths: number; points: number } {
    return {
      kills: this.kills[slot] ?? 0,
      deaths: this.deaths[slot] ?? 0,
      points: this.points[slot] ?? 0,
    };
  }
}

/**
 * As much of a control point as scoring a kill on it needs: who holds it, or
 * null while it is neutral.
 *
 * Structural rather than `ControlPoint`, which is what keeps this file free of
 * `ConquestSystem` — a live point satisfies it by construction, and so does a
 * client's mirrored copy of one.
 */
export interface ZoneOwnership {
  owner: Team | null;
}

/**
 * Everything one kill pays, in the order it is paid.
 *
 * **The one place the shape of a payout is decided.** The offline round and
 * the authority both reach it with the same facts, so a kill is worth the same
 * on a single-player board as it is on sixteen networked ones — the
 * failure this replaces is not a crash but a quiet disagreement, where a
 * player learns a scoring rule in practice that the match they take it into
 * does not run.
 *
 * `zone` is the point the VICTIM was standing in, not the killer. That is the
 * whole of the attack/defend rule and it is deliberate: killing an enemy on a
 * flag your side holds is a defence however far off you were standing, and
 * killing one on a flag you do not hold is an attack even if you never set
 * foot in the ring. Keyed on the killer instead, a marksman clearing attackers
 * off their own flag from the next street would earn nothing for the one job
 * they were doing. `null` — a body that fell nowhere near a flag — pays the
 * kill and no bonus, which is what makes a Conquest board reward fighting
 * where the round is being decided.
 */
export function awardKill(
  book: ScoreBook,
  slot: number,
  killerTeam: Team,
  zone: ZoneOwnership | null,
  headshot: boolean,
): void {
  book.award(slot, "kill");
  if (headshot) book.award(slot, "headshot");
  if (zone) book.award(slot, zone.owner === killerTeam ? "defend" : "attack");
}

/**
 * Pays everyone of `by` standing in `point` for what the flag just did.
 *
 * **`awardKill`'s sibling, and here for the same reason.** The offline round
 * and the authority both run this pass over their own bodies, and it was
 * written out twice — identically, and documented twice — while the payout it
 * pays through was already stated once, one function up. A capture is worth
 * the same on a single-player board as it is on sixteen networked ones, and
 * that is a property of there being one copy rather than of two copies having
 * agreed so far.
 *
 * The rule is PRESENCE at the moment the meter moved, tested with the same
 * `pointAt` that moved it, and not split between the bodies that earned it.
 * The dead and the benched fall out through `alive` — a benched bot is
 * `alive = false` (`BattleSystem.setBenched`), which matters here for a
 * sharper reason than tidiness: its slot is a PLAYER's, so counting it would
 * pay that row twice for one capture.
 *
 * Generic in the point so this file stays free of `ConquestSystem`, exactly as
 * `ZoneOwnership` keeps it free of `ControlPoint`: what is compared is
 * IDENTITY, and the caller says what a point is and how a body is found in
 * one. `slotOf` is handed in for the same reason it is not a method here — a
 * slot is a bot index on one side and a `NetPlayer`'s own number on the other,
 * and that is the one thing about this pass the two simulations genuinely
 * disagree about.
 */
export function awardZone<P>(
  book: ScoreBook,
  units: readonly Combatant[],
  point: P,
  by: Team,
  kind: "capture" | "neutralise",
  pointAt: (unit: Combatant) => P | null,
  slotOf: (unit: Combatant) => number,
): void {
  for (const unit of units) {
    if (!unit.alive || unit.team !== by) continue;
    if (pointAt(unit) !== point) continue;
    book.award(slotOf(unit), kind);
  }
}
