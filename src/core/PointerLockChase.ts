/**
 * PointerLockChase.ts — The timing around the pointer lock: whether a lock
 * just LOST is the player leaving, and when a resume that still owes the lock
 * should ask for it again.
 * Owns: whether the lock was held as of the last `pointerlockchange`, when it
 * was last taken, and a resume's owed lock — how long it has been owed and how
 * long until the next attempt. Pure timing over booleans `Game` hands in.
 * Owns NOTHING that acts: it never asks the browser for a lock, never pauses
 * and never reads the input — it answers "is this the player leaving?" and
 * "ask now?", and `Game` keeps `requestLock` and `pause` (`docs/states.md`,
 * "The pointer lock").
 * Invariants: only a TRANSITION out of the lock is a departure — a pad player
 * who never took one has none to lose. A loss inside `CONFIG.input.lockGrace`
 * of the lock being taken is the browser refusing, never the player leaving.
 * Nothing here can pause on its own failure: a refused retry is not a state
 * change.
 * Never: decide WHICH states a departure pauses, or know about touch beyond
 * the boolean it is handed — both are `Game`'s.
 */
import { CONFIG } from "../config";

export class PointerLockChase {
  /** Whether the pointer was locked as of the last `pointerlockchange`. */
  private had = false;
  /**
   * `performance.now()` of the last time the lock was TAKEN. A loss inside
   * `CONFIG.input.lockGrace` of it is the browser finishing an Escape it had
   * already started rather than the player leaving.
   */
  private takenAt = 0;
  /**
   * A resume that still owes the pointer lock: how long it has been owed, and
   * how long until the next attempt. See `step`.
   */
  private pending = false;
  private pendingT = 0;
  private retryT = 0;

  /**
   * A `pointerlockchange`. True when it is the lock being LOST by a player who
   * held it, to something other than the browser refusing.
   *
   * A lock granted and revoked in the same beat is the browser refusing, not
   * the player leaving: the request a resume makes lands while the UA still
   * owes an Escape-exit, and it takes back what it just gave. Pausing on that
   * is how a dismissed pause menu reappeared a split second later, with
   * nothing but the browser between the two. The retry in `step` is what
   * carries the resume from there.
   */
  changed(locked: boolean, now: number): boolean {
    if (locked) this.takenAt = now;
    const refused = now - this.takenAt < CONFIG.input.lockGrace * 1000;
    const lost = !locked && this.had && !refused;
    this.had = locked;
    return lost;
  }

  /**
   * A resume owes the lock. NOT a bare request: a resume driven by Escape is
   * asking for the lock with the browser's own release-the-lock key still
   * down. See `step`.
   */
  owe(): void {
    this.pending = true;
    this.pendingT = 0;
    this.retryT = 0;
  }

  /**
   * A pause outranks a resume that never got its lock: a second pause taken
   * while one was still being chased must not have the round grab the mouse
   * out from under the menu it just raised.
   */
  cancel(): void {
    this.pending = false;
  }

  /**
   * One live frame of a resume's owed lock. True when this frame should ask
   * the browser for it.
   *
   * A pause taken with Escape ends with Escape, and that one key is both the
   * resume and the UA's gesture for dropping a lock — so the request a resume
   * makes is the one request the browser is least willing to grant. Chrome
   * refuses outright for about a second after an Escape-exit, and a lock taken
   * while the key is still down is dropped again by its auto-repeat, which
   * `pointerlockchange` would read as a player leaving and pause on. Both look
   * to the player like the same thing: a menu that flickers off and back on,
   * and a round that eventually resumes with the mouse still loose.
   *
   * So the request waits for the key to come UP and is then retried on an
   * interval until the lock lands, or until the window runs out — at which
   * point the round is still running, the lock hint is on screen, and the next
   * click takes it through `Game`'s `pointerdown` handler. A finger has no
   * lock to chase at all, so a touch hand-over ends the chase.
   */
  step(dt: number, locked: boolean, keyHeld: boolean, touch: boolean): boolean {
    if (!this.pending) return false;
    if (locked) {
      this.pending = false;
      return false;
    }
    this.pendingT += dt;
    if (this.pendingT > CONFIG.input.lockRetryWindow) {
      this.pending = false;
      return false;
    }
    if (keyHeld) return false;
    if (touch) {
      this.pending = false;
      return false;
    }
    this.retryT -= dt;
    if (this.retryT > 0) return false;
    this.retryT = CONFIG.input.lockRetryInterval;
    return true;
  }
}
