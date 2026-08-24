/**
 * config/camera.ts — the look, the FOV and the recoil the eye sees.
 * Owns: sensitivity, the aimed transition, view punch and shake.
 * Gotcha: recoil decay here uses true `Math.exp(-rate * dt)` rather than the
 * frame-lerp idiom, because it moves where bullets go and burst climb must
 * not vary with frame rate.
 */

export const camera = {
  /** Mouse sensitivity (radians per pixel). */
  sensX: 0.0022,
  sensY: 0.002,
  /** Gamepad look speed (radians per second at full deflection). */
  stickSensX: 2.8,
  stickSensY: 1.8,
  /**
   * The rungs a player's look-sensitivity setting sits on, as MULTIPLIERS over
   * the four rates above. One ladder, used by both the mouse and the stick
   * setting (`Settings.mouseSensitivity` / `stickSensitivity`), applied by
   * `CameraSystem.setLookScale`.
   *
   * A multiplier rather than a rate per device, and one number rather than one
   * per axis, because the pairs above are a TUNED RATIO — the vertical is
   * deliberately slower than the horizontal on both devices, and a player who
   * can set the two independently is a player who can lose that ratio without
   * ever meaning to. Scaling both by one number moves the speed and keeps the
   * feel; it also means the ADS rates, which are derived from these through the
   * fitted optic's magnification, follow for free.
   *
   * **The spacing is geometric, not linear, because sensitivity is felt as a
   * RATIO.** A 0.1 step is a tenth at 1.0 and a fortieth at 4.0 — the same
   * keypress does something at one end of a linear ladder and nothing at the
   * other. These rungs are ~10% apart through the band players actually settle
   * in (0.6-2.0) and open up outside it, so the useful part is fine enough to
   * tune and the whole 12x range still fits in sixteen steps.
   *
   * **Sixteen is also a slider's worth**, which is what the settings screen
   * draws this as: the rungs are its detents, laid one per equal share of the
   * track, so an inch of drag is the same RATIO of look speed wherever it is
   * taken and the thumb has room to land where it was aimed. It is already
   * finer than the 1-10 sliders console shooters ship. A longer ladder would
   * cost the arrow keys, which step it one rung at a time.
   *
   * 1 must be on the ladder: it is the default, and it is the rate every other
   * number in this file was tuned against.
   */
  lookScales: [
    0.25, 0.35, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6, 1.8, 2, 2.5, 3,
  ] as const,
  /**
   * Eye height, standing. The camera sits here (first person), Player.eyePos
   * reports it, and bot line-of-sight checks against the player use it — one
   * number for all three, so what a bot can see is what you can see.
   * Crouching interpolates all three toward `player.crouchEyeHeight`; it is
   * the same number doing the same three jobs, just lower.
   */
  eyeHeight: 1.55,
  /**
   * Hip-fire vertical FOV (radians). The AIMED field of view is not here —
   * it belongs to whichever optic is fitted, so it lives in `sights` below
   * and is derived from that sight's magnification against this number.
   */
  fovHip: 0.95,
  /**
   * How fast the hip<->ADS blend converges (per second), before the fitted
   * sight's own `adsSpeedMult` is applied.
   */
  adsBlendSpeed: 10,
  /**
   * Pitch limits. Wider than the third-person camera's, which had to stop
   * before the shoulder rig clipped the ground or the sky: ±1.45 is ~83°,
   * far enough to check your feet and the rooftops without ever inverting.
   */
  pitchMin: -1.45,
  pitchMax: 1.45,
  /**
   * Head bob. The phase advances with travel, not with time, so it stops
   * dead when you do; vertical runs at twice the lateral rate because a
   * stride dips the head once per FOOT and sways it once per PAIR.
   * Deliberately small — this is a shooter, and bob that reads as motion
   * on a walk reads as nausea over a round. It moves the rendered camera
   * only: aimPitch/aimYaw never see it, so bullets don't bob.
   */
  bobRate: 8.0,
  bobVertical: 0.026,
  bobLateral: 0.018,
  /**
   * ADS look sensitivity, as a multiplier on the hip-fire rates BEFORE the
   * fitted optic's magnification is divided out (see `sights`). Aiming
   * therefore moves the crosshair across the SCREEN at a near-constant rate
   * whatever is bolted to the rail — a 3.5x scope that kept the hip-fire
   * rates would be unusable, and one tuned by hand per optic would drift.
   * The shipped holo is 1.6x, so these reproduce the 0.6 / 0.5 the camera
   * used when the sight was not a choice.
   */
  adsLookMouse: 0.96,
  adsLookStick: 0.8,
  /** Bob multiplier while aimed — braced, so nearly still. */
  bobAdsMult: 0.2,
  /**
   * Bob multiplier while crouched. The bob drive is movement *intent*, not
   * speed, so without this a crouch-shuffle at half pace bobs the head as
   * hard as a jog — the stride reads at the wrong tempo for the distance
   * actually being covered.
   */
  bobCrouchMult: 0.45,
  /** How fast the bob amplitude follows the movement input (per second). */
  bobSmooth: 7,
  /**
   * The landing absorb: what the eye does when the feet arrive. A jump used
   * to end with the camera simply stopping — zero vertical speed on the
   * contact frame, nothing to show for the fall — which reads as a dropped
   * frame rather than as an arrival. This is the knees, and it is meant to
   * be felt: a hard landing is not supposed to be smooth, it is supposed to
   * be brief and deliberate.
   *
   * A damped spring, given a downward VELOCITY at the impact and left to
   * find its way back, so the motion has weight on the way in and a small
   * rebound on the way out. At these numbers a plain jump (8.5 m/s down)
   * sinks the eye 6 cm over 67 ms, comes back through neutral by ~1 cm and
   * is settled inside half a second; the worst drop the map offers is 8.5 cm.
   * Deep enough to punctuate the jump, short enough not to cost a fight.
   */
  land: {
    /**
     * Impact speeds (m/s) between which the absorb ramps from nothing to its
     * full depth. `minSpeed` is under the sound's own threshold on purpose:
     * a small hop bends the knees visibly before it makes any noise.
     */
    minSpeed: 2.5,
    fullSpeed: 11,
    /** Downward speed (m/s) handed to the eye by a full-speed landing. */
    dipSpeed: 2.4,
    /** Spring frequency (Hz) and damping ratio (<1 rebounds; 1 does not). */
    frequency: 2.0,
    damping: 0.5,
    /** Nod and roll per metre of dip (rad/m): the chin and the weight. */
    nod: 0.55,
    roll: 0.35,
    /**
     * Multiplier on the nod and the roll while aimed — the dip is left at
     * full, because bending your knees is not something a sight prevents.
     * The rotations are what swing the picture off the (un-nodded) rounds,
     * so they are the half worth suppressing when it matters.
     */
    adsMult: 0.35,
  },
  /**
   * Hold sway: the wander of an aimed weapon that nobody's arms can hold
   * still. Everything else the camera does for show — the bob, the punch,
   * the landing nod — is kept out of aimPitch/aimYaw so the bullets never
   * see it. This one is the opposite on purpose: it is part of the aim, so
   * the sight picture and the point of impact drift TOGETHER. The weapon is
   * parented to the camera, so what you see is the world sliding behind a
   * reticle that stays on the axis — which is what a hold actually looks
   * like, and the only version that does not make the reticle lie.
   *
   * It is scaled by the ADS blend, so hip fire is untouched: a drift the
   * player has to fight while running around is nausea, not texture.
   *
   * Angular, and deliberately NOT normalised by magnification the way the
   * look rates are (see `adsLookMouse`). A sight magnifies your unsteadiness
   * along with everything else — that is the trade a 3.5x optic is asking
   * you to make, and the answer to it is crouching, a heavier weapon, or
   * standing still.
   */
  aimSway: {
    /**
     * Peak offsets (rad) at full weight, before the state multipliers. The
     * pitch term breathes; the yaw term runs at half its rate, which is what
     * makes the pair trace a slow figure-eight rather than a diagonal line.
     * ~0.33 deg and ~0.42 deg — at 3.5x that reads as about a degree of
     * screen movement, and at 25 m it is ~15 cm of point of aim.
     */
    pitch: 0.0045,
    yaw: 0.006,
    /**
     * Breathing rate (Hz) — ~14 a minute. The secondary terms are fixed
     * half-integer multiples of it (see `CameraSystem.update`), which is
     * what lets the phase wrap at 4pi without a discontinuity.
     */
    rate: 0.23,
    /**
     * Aiming on the move: the drive is movement INTENT, like the bob's, so
     * a crouch-shuffle does not count as a jog. Aiming while walking is
     * meant to cost something.
     */
    moveMult: 1.9,
    /** Crouched, with the elbows somewhere: the steadiest a player gets. */
    crouchMult: 0.55,
    /** How fast the weight follows a change of state (per second). */
    smooth: 3,
  },
} as const;
