/**
 * net/HitCredits.ts — Rounds this client has already cued a hitmarker for,
 * waiting on the authority to say whether it agrees.
 * Owns: the queue of predicted hits and their expiry, and the rule that a
 * landed round is announced ONCE. Owns no cue of its own — it never flashes a
 * marker, never plays a sound and never reads the wire; it answers WHETHER the
 * authority's verdict still owes the player something, and `Game` spends the
 * answer.
 * Invariants: the queue is ordered oldest-first and claimed first-in-first-out,
 * which is what pairs a verdict with the round that predicted it without the
 * protocol carrying a shot id. `claim` always spends a credit — this round's
 * answer has arrived, whatever it is — so a claim may never be made twice for
 * one event. Entries expire on their own, and `clear` is the boundary's version
 * of that rather than a second mechanism.
 * Never: hold anything but a bullet (`Match` raises `hit` from the shot path
 * and from nowhere else, so a blast can neither leave a credit nor claim one),
 * outlive a session, or decide what the marker looks like.
 */
import { CONFIG } from "../config";

/** One predicted hit: what it claimed, and when it stops being claimable. */
interface HitCredit {
  headshot: boolean;
  until: number;
}

export class HitCredits {
  /**
   * The credits still standing, oldest at the front.
   *
   * A queue rather than a counter because several rounds are in flight at
   * automatic rates, and each is claimed in the order it was fired: the server
   * re-resolves them in that order and reports them down one socket, so
   * first-in-first-out pairs them without the protocol carrying a shot id.
   * Entries expire on their own, which is what stops a round the authority
   * scored as a MISS — no event ever arrives for one — from leaving a credit
   * standing to swallow the next real correction.
   */
  private readonly credits: HitCredit[] = [];

  /** Drops credits the authority never claimed. Ordered, so the front is oldest. */
  private prune(now: number): void {
    while (this.credits.length > 0 && this.credits[0].until <= now) {
      this.credits.shift();
    }
  }

  /** A local resolve says this round landed, and the marker is already up. */
  note(headshot: boolean): void {
    const now = performance.now();
    this.prune(now);
    this.credits.push({
      headshot,
      until: now + CONFIG.net.hitCreditWindow * 1000,
    });
  }

  /**
   * The authority's verdict on a round. True when this client has already said
   * everything the verdict has to say, and the event owes no second cue.
   *
   * The credit is spent either way — this round's answer has arrived, whatever
   * it is. Two things override agreement:
   *
   * - **A kill.** The prediction cannot make that claim (`NetSoldier.takeDamage`
   *   returns false, so the local resolve never reports one), and the red marker
   *   is the one that means STOP SHOOTING — the most useful thing a hitmarker
   *   ever says, and never a repetition.
   * - **A headshot the prediction missed.** The bodies are drawn `interpDelay`
   *   behind, so the head zone the server found on its rewound copy is not
   *   always the one this client tested against.
   *
   * The other direction — this client called a headshot and the server scored a
   * body hit — is deliberately silent. It is a hit either way, the marker for it
   * is already on screen, and correcting the flavour downward is worth less than
   * the doubled cue it would cost.
   */
  claim(killed: boolean, headshot: boolean): boolean {
    this.prune(performance.now());
    const credit = this.credits.shift();
    if (!credit) return false;
    if (killed) return false;
    return !(headshot && !credit.headshot);
  }

  /**
   * Drops everything standing, for a session that has ended.
   *
   * They would time out on their own inside the second, and clearing them is
   * what makes that a property of the boundary rather than of the window's
   * length.
   */
  clear(): void {
    this.credits.length = 0;
  }
}
