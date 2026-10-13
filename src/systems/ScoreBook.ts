/**
 * ScoreBook.ts — the round's board: kills, deaths and POINTS, one row per
 * roster slot, and the two rules that decide what a payout is worth.
 * Owns: the three arrays and the version stamp over them, plus `awardKill`,
 * `awardZone` and `paysKiller` — the one statement each of what a kill pays,
 * what a flag pays, and which bodies pay anything at all.
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
 * what a slot means) is three systems' worth of fact, gathered by the wiring
 * — `SimCore.creditKill`/`awardZone` — and handed in.
 *
 * **There is ONE of these, the simulation core's, and that is the point**
 * (`SimCore.scores`, offline and on the authority alike since `BABYLON_EXIT.md`
 * X2.5a C4a). The offline round and the authority used to keep a
 * `slotKills`/`slotDeaths` pair each, with a `creditKill` and a
 * `registerDeath` each, written twice and documented twice, and later one of
 * these each. The page draws the authority's — a remote match's, or offline
 * its own local match's — which arrives whole (`NetSession`), because a client adding up the events it happened to
 * receive would show a different board on every screen.
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
 * As much of a victim as deciding whether its death pays anybody needs.
 *
 * Structural for `ZoneOwnership`'s reason — it keeps this file free of
 * `CombatSystem`, and every `Hittable` and every `Combatant` satisfies it by
 * construction, which is what lets every door hand in whatever it has in its
 * hand.
 */
export interface KillVictim {
  readonly armoured?: boolean;
}

/**
 * Whether this body's death pays the thing that killed it.
 *
 * **A HULL IS NOT A ROW ON THE SCOREBOARD**, and that is the whole of the rule.
 * A destroyed tank already pays its CREW — the driver and the gunner each die
 * their own death at their own door — so crediting the chassis on top would
 * price one shell at two kills. It became a question that has to be ASKED
 * rather than one the target lists answered when armour started being resolved
 * by its collider instead of by a hit sphere it always lost: `shot.target` can
 * be a hull now, on both sides of the wire.
 *
 * **Stated here because it was stated at six doors and had already drifted at
 * three of them.** Every site guarded its own credit by hand, and the two
 * simulations there were then reached for two different tests — `instanceof Bot` on the client,
 * `!armoured` on the authority — which are not the same question: the first
 * also excludes a PERSON, so a bot crew running the player over or putting a
 * shell into them scored on the authority and scored nothing offline. That is
 * the failure `awardKill` exists to prevent, arriving one level up from it:
 * not a crash, but a player learning in practice a scoring rule the match they
 * take it into does not run. It is applied inside `SimCore.creditKill` — the one
 * `creditKill` there is now — rather than at the call sites, so a new door
 * onto a kill inherits it instead of having to remember it.
 *
 * A `null` victim pays the kill and no zone bonus, which is what the authority
 * has always done with one: every path that resolves a kill has a body in hand
 * and the null is defensive, so refusing it here would silently drop a credit
 * rather than catch a bug.
 */
export function paysKiller(victim: KillVictim | null | undefined): boolean {
  return !victim?.armoured;
}

/**
 * Everything one kill pays, in the order it is paid.
 *
 * **The one place the shape of a payout is decided.** The one core reaches
 * it offline and on the authority with the same facts, so a kill is worth the same
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
 * **`awardKill`'s sibling, and here for the same reason.** The core runs this
 * pass over its bodies, offline and on the authority; it was once
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
 * slot is a bot index for a bot and a `SimPlayer`'s own number for a person,
 * which is the core's to know and not the board's.
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
