/**
 * leash.ts — What stops a player leaving a map whose boundary is OPEN.
 * Owns: one clock per body, and the verdict it reaches. Holds no scene, no
 * mesh, no system and no side effect: it is told where a body is and answers
 * what that means, and the caller does the killing.
 *
 * A map closed by the rim needs none of this. Four colliders stop a body and an
 * escarpment is what you see stopping it, which is the honest arrangement: the
 * edge of the world is a thing in the world. A map with a `MapLayout.borderland`
 * has given that up on purpose — the ground carries on into open country because
 * a wall around a farming vale is a lie about what a farming vale is — and the
 * edge has to become a RULE instead. The one thing it must never become is an
 * invisible wall, which is a rule pretending to be a shape and is worse than
 * either.
 *
 * So the rule is: you may cross, you may not stay. Ten seconds and a countdown
 * you cannot miss, which is long enough that a fight drifting over the line is
 * something you can correct and short enough that the borderland is never
 * anywhere to fight FROM.
 *
 * **The same class runs on both sides and only one of them is real.** The
 * authority holds one per `NetPlayer` and its verdict is what kills; the client
 * holds one for its own player and, in a netplay round, uses it for nothing but
 * the number on the HUD. That is the ordinary split — a client predicts its
 * movement, and this is a pure function of movement — and it is why the leash
 * costs the wire nothing at all. Offline the client's is the only one there is,
 * and it kills.
 *
 * Invariants:
 * - **Bots are not leashed and must never be.** They read `nav.steer()` and the
 *   graph stops at the play square, so a bot cannot reach the borderland to be
 *   warned about it. A leash on the AI would be a second, quieter answer to a
 *   question the nav grid already answers.
 * - **It measures in the MAX norm, not the Euclidean one**, because the play
 *   square is a square. A radius would kill a player standing well inside two
 *   of the four boundaries for the crime of being near a corner.
 */
import { CONFIG } from "../config";

/**
 * What the killfeed calls a leash death.
 *
 * It lives here rather than in either killfeed because both of them draw it and
 * the two must not drift: offline `Game` writes the line straight, and in a
 * match the authority sends `killer: -1` and every client writes it. A death
 * with no killer is the only kind in the game — friendly fire is excluded by
 * construction, so every other one is the other side — which is exactly why the
 * feed cannot be left to derive it.
 */
export const LEASH_KILLER = "OUT OF BOUNDS";

/** What one step of the clock came to. */
export type LeashVerdict =
  /** Inside the play square, or the map has no leash. Nothing to draw. */
  | "clear"
  /** Outside, counting down. `Leash.remaining` is what to put on the HUD. */
  | "warned"
  /**
   * The count has run out. The caller kills — and then stops stepping a dead
   * body, which is what makes this arrive once per life without a latch here
   * to arrange it. Step it anyway and it keeps saying `expired` until
   * `clear()`; what it will never do is start a fresh count under someone.
   */
  | "expired";

export class Leash {
  /**
   * Half the PLAY square, or null on a map closed by the rim — which is the
   * disabled state, and the reason the caller never has to ask whether this map
   * has a boundary of the open kind before stepping the clock.
   */
  private half: number | null = null;
  private t = 0;
  private out = false;

  /**
   * Points the leash at a map. `margin` is the map's, and zero is what turns
   * the whole thing off: a rim-closed map has boundary colliders at the play
   * square's edge, so a player is never outside it to be counted.
   */
  setMap(size: number, margin: number): void {
    this.half = margin > 0 ? size / 2 : null;
    this.clear();
  }

  /** Back inside, dead, respawned, or a round away. Forgets everything. */
  clear(): void {
    this.t = 0;
    this.out = false;
  }

  /** True while the body is outside the play square. */
  get outside(): boolean {
    return this.out;
  }

  /**
   * Seconds left before it kills. Meaningless unless `outside`, and deliberately
   * not clamped to whole seconds — the display rounds, and rounding here would
   * make the last second of the count a lie in whichever direction the caller
   * happened not to expect.
   */
  get remaining(): number {
    return this.t;
  }

  /**
   * One step, given where the body is now.
   *
   * Crossing back in clears the count outright rather than winding it back.
   * That is the version a player can hold in their head — "get inside and you
   * are fine" — and the alternative buys a player who ducks over the line every
   * nine seconds a place to stand that the map says is not one.
   */
  update(x: number, z: number, dt: number): LeashVerdict {
    const half = this.half;
    if (half === null) return "clear";
    // The max norm: the boundary is a square, and the distance to a square is
    // how far past the nearer of its two axes you are.
    const outside = Math.abs(x) > half || Math.abs(z) > half;
    if (!outside) {
      this.clear();
      return "clear";
    }
    if (!this.out) {
      this.out = true;
      this.t = CONFIG.map.leash.seconds;
    }
    this.t -= dt;
    if (this.t <= 0) {
      // Latched at zero rather than left to run negative, and NOT cleared: the
      // body is still outside, and clearing here would start a fresh ten
      // seconds under a player the caller has already killed.
      this.t = 0;
      return "expired";
    }
    return "warned";
  }
}
