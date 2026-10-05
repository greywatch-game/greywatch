/**
 * killRules.ts — what a kill owes once something has put a body down: the
 * killer's row, and the victim's door when the victim was a bot.
 * Owns: `settleKill`, the one statement of that pairing; `KillLedger`, the two
 * doors each simulation implements for it; and `DeathCause`, the vocabulary
 * those doors are filed under.
 * Invariants: the KILL is credited at the killer's door and the DEATH counted
 * at the victim's, once each (`ScoreBook`'s rule). The credit is asked FIRST,
 * whoever fell, and the death door is reached only for a `Bot` — a person's
 * death has already left through its own `onDamaged` by the time anything
 * here runs, on both sides of the wire.
 * Never: decide WHETHER a body pays (`paysKiller`, inside each `creditKill`)
 * or what it pays (`awardKill`), and never hold state — the ledger is the
 * simulation's, handed in.
 *
 * **There is one of these for the reason there is one `ScoreBook`.** Every
 * door onto a kill — a bot's round, a person's, a blast, a burn, a shell, the
 * cupola gun, the tracks — used to write "credit the killer, then if it was a
 * bot charge its death" out by hand, on the client and again on the
 * authority, and the two had already disagreed about what `creditKill`
 * returned. A door that goes through `settleKill` cannot forget either half.
 */
import { Bot } from "../entities/Bot";
import type { Combatant, Team } from "../entities/Combatant";
import type { Hittable } from "./CombatSystem";

/**
 * What put a body down, named by the DOOR the death came through rather than
 * by what the wound was.
 *
 * It exists for one question, which is why it is a vocabulary of doors: a
 * round of the headless simulation ends with more deaths on the board than
 * kills, and without this the difference is an unexplained number in a report.
 * Six of the seven doors credit a killer and one — `crew`, a body going down
 * with the hull it was riding — cannot, so telling them apart is what turns
 * "six deaths nobody was paid for" into "six tank crews", which is a round
 * working rather than a rule leaking. See `server/simulate.ts`, the only
 * reader; the client is handed it and files nothing under it.
 *
 * `other` is the honest answer at the one door that does not know: a PERSON's
 * death arrives through `NetPlayer.onDamaged`, where whatever killed them was
 * credited at its own door and the authority cannot see which. `simulate`
 * never reaches it — there are no people in a headless round — so it is a gap
 * only a tool that grows synthetic players would have to close.
 */
export type DeathCause =
  | "round"
  | "blast"
  /** A molotov's burn — `GrenadeSystem.onBurnHit`. */
  | "fire"
  | "tracks"
  | "shell"
  | "mg"
  | "crew"
  | "other";

/**
 * The two doors a kill reaches, as one simulation keeps them. `Game` and
 * `HeadlessGame` each build one, once, out of their own `creditKill` and their
 * own bot-death bookkeeping.
 */
export interface KillLedger {
  /**
   * The killer's row: `creditKill`. Returns whether the blow was CREDITABLE —
   * it had a killer and the victim pays one (`paysKiller`).
   */
  credit(by: Combatant | null, victim: Hittable, headshot: boolean): boolean;
  /**
   * A bot's death door: the ticket, the death on its row, and whatever the
   * simulation draws or reports for it. Reached exactly once per bot death.
   *
   * `killer` is the side the blow came from, which is not always `by`'s — a
   * thrower may be dead, and a hull brewing up has nobody to credit at all.
   */
  botDown(
    bot: Bot,
    killer: Team,
    by: Combatant | null,
    cause: DeathCause,
    credited: boolean,
    headshot: boolean,
  ): void;
}

/**
 * A blow has killed `victim`: pay `by`, then charge the death if a bot fell.
 *
 * Call it only for a blow that KILLED — every caller already holds the
 * `takeDamage` result that says so — and never for a person's death alone:
 * that is announced by the body's own damage callback, which ran inside
 * `takeDamage` before control came back here.
 */
export function settleKill(
  ledger: KillLedger,
  by: Combatant | null,
  victim: Hittable,
  killer: Team,
  cause: DeathCause,
  headshot = false,
): void {
  const credited = ledger.credit(by, victim, headshot);
  if (victim instanceof Bot) {
    ledger.botDown(victim, killer, by, cause, credited, headshot);
  }
}
