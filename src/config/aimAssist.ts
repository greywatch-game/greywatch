/**
 * config/aimAssist.ts — controller aim assist, and its three invariants.
 * Owns: the slowdown bubble and the rotation bubble.
 * Gotcha: gamepad ONLY by construction — the mouse look path is never scaled.
 * The rotation is mostly adhesion (`track*`), not magnetism (`magnet*`); read
 * the block below before touching either, it records why.
 */

/**
 * Controller aim assist: two nested bubbles around an enemy — an outer one
 * that SLOWS the stick and an inner one that ROTATES the camera — modelled
 * on the console-shooter lineage (Halo's friction + magnetism, and Call of
 * Duty's rotational assist on top of it).
 *
 * Gamepad only by construction — it engages solely while the pad is the
 * active look device (last stick movement or any pad button; any mouse
 * movement disengages it the same frame), and the slowdown multiplies the
 * stick terms in CameraSystem exclusively. The mouse look path is never
 * scaled, so keyboard/mouse aim is bit-for-bit unaffected, even with a
 * pad plugged in.
 *
 * THE ROTATION IS MOSTLY ADHESION, NOT MAGNETISM, and that split is the
 * whole reason it reads as help rather than as auto-aim:
 *
 * - `track*` matches a share of the target's ANGULAR VELOCITY as seen from
 *   the eye. It does nothing at all to a stationary target — it cannot
 *   drag the reticle onto anything — and against a strafing one it simply
 *   drifts the reticle along with them, leaving the player to supply the
 *   rest. This is the term that does the work.
 * - `magnet*` is the corrective pull toward the target's centre, and it is
 *   deliberately small and *stops short*: it is zero inside
 *   `magnetDeadzone` of the inner bubble, so it nudges a near miss onto
 *   the body and then lets go. It never centres the reticle for you.
 *
 * The previous version was one flat 1.1 rad/s pull to centre, applied with
 * a resting stick, over a fixed 0.08 rad cone. That closed the widest
 * possible aim error in ~70 ms and out-turned the player's own slowed
 * stick at every optic — hence "locked on". Three invariants now stop that
 * by construction rather than by careful numbers:
 *
 * 1. **The assist can never out-turn the player.** Both rotation terms are
 *    capped at `maxRateFraction` of the player's OWN full-stick turn rate,
 *    which CameraSystem hands over per frame (`stickYawRate`) and which
 *    already carries the fitted optic's multiplier. A 3.5x scope slows the
 *    stick by 4.4x, and the assist slows with it.
 * 2. **No input, no rotation.** Rotation is gated on the player actually
 *    driving — either stick past `stickThreshold`, or the trigger held. A
 *    parked stick gets the slowdown and nothing else.
 * 3. **Opposing stick cancels it**, in proportion to deflection (see
 *    AimAssistSystem), so a committed push always walks out of the bubble.
 */
export const aimAssist = {
  /** No acquisition beyond this distance (metres). */
  maxDistance: 55,
  /**
   * The bubbles are SPHERES around the target (metres), not fixed screen
   * cones: the half-angle is `atan(radius / distance)`, so the assist is
   * generous point-blank and tight at range — the falloff every shooter in
   * this lineage has, and the opposite of what a fixed cone gives (a fixed
   * 0.08 rad covered 0.4 m at 5 m and 4 m at 50 m).
   *
   * The outer radius slows the stick; only inside the inner one does the
   * camera rotate at all. A bot is ~0.5 m across and ~1.8 m tall.
   */
  slowdownRadius: 1.35,
  rotateRadius: 0.8,
  /**
   * Ceiling on the OUTER bubble's half-angle (radians) — the inner one is
   * capped at the same ratio, so the nesting survives point-blank. Past
   * ~7 m the radii above already fit inside it; it exists so a target at
   * arm's length cannot own a third of the screen. 0.2 ≈ 11.5°.
   */
  maxAngle: 0.2,
  /**
   * Stick sensitivity multiplier at the very centre of the slowdown
   * bubble, easing back to 1 at its rim. A gradient rather than the flat
   * step it was: a hard sensitivity change at a bubble edge is felt as a
   * wall the reticle bumps over, which is half of what "sticky" means.
   */
  slowdownMult: 0.55,
  /**
   * Strength ramps in over `engageTime` and out over `releaseTime`
   * (seconds). The ramp-in is what stops a target flicking across the
   * reticle from yanking the camera; the slower ramp-out is what stops the
   * assist chattering on and off at the rim, and carries it across the
   * gap when one target is swapped for another.
   */
  engageTime: 0.08,
  releaseTime: 0.18,
  /**
   * Angular bonus (radians) the currently-held target gets when scoring
   * candidates, so two overlapping enemies don't trade the assist back and
   * forth — a swap resets the engage ramp and the tracking history, so
   * flicker would cost the assist entirely.
   */
  holdBias: 0.012,
  /**
   * Stick/movement deflection (0..1, post-deadzone) at which rotation
   * begins, reaching full strength at twice it. Holding the trigger counts
   * as full drive, so tracking a strafing target while you shoot does not
   * require the stick-jiggling that CoD's stricter gate is known for.
   */
  stickThreshold: 0.15,
  /**
   * Share of the target's angular velocity the camera matches (adhesion).
   * At 0.55 a bot strafing across you at 15 m hands you a little over half
   * the turn rate needed to stay on it, and you supply the rest.
   */
  trackAds: 0.55,
  trackHip: 0.35,
  /**
   * The tracking term is split by CAUSE, and the player's own movement is
   * scaled by this. Angular velocity comes from the target moving *and*
   * from the player strafing around it; compensating the second at full
   * strength is what makes a strafe feel like the game is aiming, so it is
   * halved while target motion is matched in full.
   */
  selfMotionMult: 0.5,
  /**
   * Corrective pull toward the target centre, as a fraction of the
   * player's own full-stick turn rate (see the note above). 0.16 of a holo
   * ADS rate is ~0.22 rad/s, against the 1.1 rad/s flat pull this
   * replaced.
   */
  magnetAds: 0.16,
  magnetHip: 0.06,
  /**
   * Fraction of the inner bubble within which the pull is zero. The pull
   * is strongest at the rim and fades to nothing here, so it carries a
   * near miss onto the body and then stops — it must never be able to sit
   * the reticle on a target's centre, which is the player's job.
   */
  magnetDeadzone: 0.35,
  /**
   * Rotation is at full strength inside `rotateFullRange` and fades to
   * nothing by `maxDistance` (metres). Close-quarters tracking is where a
   * stick genuinely cannot keep up; a duel at 50 m is aim, not tracking.
   */
  rotateFullRange: 20,
  /**
   * Hard ceiling on the assist's own rotation, as a fraction of the
   * player's full-stick turn rate. Invariant 1 above: a committed push
   * out-turns everything the assist can do, at every optic, before the
   * opposing-stick cancel is even counted. Kept strictly BELOW
   * `slowdownMult` so that holds even at the very centre of the bubble,
   * where the player's own stick is at its slowest.
   */
  maxRateFraction: 0.5,
  /** Vertical rotation scales by this — gentler than horizontal tracking. */
  verticalMult: 0.5,
} as const;
