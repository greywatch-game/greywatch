/**
 * killRules.ts — what a kill owes once something has put a body down: the
 * killer's row, and the victim's door when the victim was a bot.
 * Owns: `settleKill`, the one statement of that pairing; `KillLedger`, the two
 * doors the simulation core implements for it; and `DeathCause`, the vocabulary
 * those doors are filed under.
 * Invariants: the KILL is credited at the killer's door and the DEATH counted
 * at the victim's, once each (`ScoreBook`'s rule). The credit is asked FIRST,
 * whoever fell, and the death door is reached only for a `Bot` — a person's
 * death has already been COUNTED by its own `onDamaged` by the time anything
 * here runs, so what a person is owed here is only
 * the AUDIT of that death (`personDown`): which door, and whether anybody was
 * paid. A bot is told by `Hittable.isBot`, never by `instanceof`: this module
 * imports `Bot` as a TYPE only, so the kill path pulls no rig and no scene
 * into the core.
 * Never: decide WHETHER a body pays (`paysKiller`, inside `SimCore.creditKill`)
 * or what it pays (`awardKill`), and never hold state — the ledger is the
 * simulation's, handed in.
 *
 * **There is one of these for the reason there is one `ScoreBook`.** Every
 * door onto a kill — a bot's round, a person's, a blast, a burn, a shell, the
 * cupola gun, the tracks — used to write "credit the killer, then if it was a
 * bot charge its death" out by hand, on the client and again on the
 * authority, and the two had already disagreed about what `creditKill`
 * returned. A door that goes through `settleKill` cannot forget either half —
 * and since `BABYLON_EXIT.md` X2.5a C4a every door is the core's.
 */
import type { Bot } from "../entities/Bot";
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
 * working rather than a rule leaking. See `server/simulate.ts` and
 * `server/corecheck.ts`, the only readers; the client is handed it and files
 * nothing under it.
 *
 * `other` is a death no door SETTLED: nobody dealt it, so there is no cause
 * to name and nobody to pay — today the leash, which kills a person through
 * their own `takeDamage` with no killer on the far side of it. A person's
 * death by any of the doors above is filed under that door exactly as a bot's
 * is (`KillLedger.personDown`, `BABYLON_EXIT.md` X2.5a C3), and one going up
 * with the hull it rode is `crew` like a bot crewman's; `server/corecheck.ts`
 * is what holds both to it, since `simulate` seats nobody.
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
 * The two doors a kill reaches, as the simulation keeps them. `SimCore`
 * builds the one that pays, once, out of its `creditKill` and its bot-death
 * bookkeeping; a match client's predicted hull round hands in one that pays
 * nobody (`Game`'s `NO_LEDGER`).
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
  /**
   * A PERSON the blow killed: the AUDIT of a death their own `onDamaged`
   * already counted — which door it came through and whether `credit` found
   * anybody to pay — and nothing else. The ticket, the row and the feed are
   * all spent before this runs and none of them reads it.
   *
   * Optional because only the core's ledger keeps the audit: the other
   * ledger there is, a match client's `NO_LEDGER` for its predicted hull
   * round, pays and files nothing. Reached for every victim that is neither a bot nor armour,
   * so a ledger that keeps it checks for its own kind of person.
   */
  personDown?(victim: Hittable, cause: DeathCause, credited: boolean): void;
}

/**
 * A blow has killed `victim`: pay `by`, then charge the death if a bot fell.
 *
 * Call it only for a blow that KILLED — every caller already holds the
 * `takeDamage` result that says so — and never for a person's death alone:
 * that is announced and counted by the body's own damage callback, which ran
 * inside `takeDamage` before control came back here; what reaches the ledger
 * for a person is the audit (`personDown`), synchronously, in the same call.
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
  if (isBotVictim(victim)) {
    ledger.botDown(victim, killer, by, cause, credited, headshot);
  } else if (!victim.armoured) {
    // A person — a hull is no body and its crew are filed at their own doors
    // (`crewLost`, and `SimCore`'s `onDestroyed` for a person aboard).
    ledger.personDown?.(victim, cause, credited);
  }
}

/**
 * `victim` is a `Bot`: `Hittable.isBot`, which only that class declares. A
 * flag and not an `instanceof`, so this module imports `Bot` as a TYPE and
 * the server's kill path does not pull in the rig behind it.
 */
function isBotVictim(victim: Hittable): victim is Bot {
  return victim.isBot === true;
}
