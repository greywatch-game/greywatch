/**
 * config/recoil.ts — What a shot does to the aim, and the shape a string of
 * them walks in.
 *
 * Split out of `config/weapons.ts` under the spine's own rule: at 334 lines it
 * was larger than fifteen of the nineteen config modules and was the section
 * CLAUDE.md spends the most rules on, which is the definition of having
 * outgrown the file it was lodged in. Nothing here changed in the move.
 *
 * It is its own subsystem rather than a corner of the weapon table: the weapon
 * contributes one multiplier (`recoilMult`) and one bias (`yawBias`), and
 * everything else — the per-shot kick, the first-shot multiplier, the two
 * pattern envelopes, the recovery fraction, the stance multipliers and the
 * viewmodel spring's own constants — is about the ACT of firing rather than
 * about any particular gun.
 *
 * Read `docs/weapons.md` before changing any of it. Two figures in the pattern
 * comment below are DERIVED (10.6 deg of climb and 2.4 deg of drift over the
 * rifle's magazine) and have to be re-derived rather than assumed whenever
 * `pattern`, `pitchPerShot`, `yawPerShot` or `firstShotMult` moves.
 */
/**
 * Recoil. Every shot kicks the aim up and slightly sideways and blooms the
 * spread; both settle back on their own between bursts, so tapping stays
 * accurate while holding the trigger walks the shots off target.
 */
export const recoil = {
  /**
   * Aim kick per shot (radians): upward, and left/right about the weapon's
   * bias. Both are the value at the TOP of a string — `pattern` below tapers
   * the first and ramps the second across the rounds that follow, so neither
   * of these numbers is what any particular shot actually kicks.
   *
   * They were 0.026 / 0.011 before the pattern existed, and both moved to keep
   * a magazine's total walk where it was while changing its SHAPE. The
   * vertical is up because the taper takes 20% off every round past the sixth
   * (the arithmetic is in `pattern`); the horizontal is up because a weapon
   * whose kick is 30% sideways at the end of a string is the whole point of
   * the exercise, and 0.011 could not carry that against a bias below 1.
   */
  pitchPerShot: 0.03,
  yawPerShot: 0.018,
  /**
   * What the FIRST round of a string kicks, as a multiple of the rest.
   *
   * A weapon that has been sitting still and one that is mid-burst are not the
   * same weapon, and without this they were: shot 1 and shot 20 kicked
   * identically, so a burst had a flat ramp instead of a punch that settles.
   * The punch is also what makes the first round of a tap distinct from a held
   * trigger, which is the entire reason to tap.
   *
   * It applies only where a string means something — `!semiAuto || burst > 1`,
   * resolved in `Player.recoilRamp`. The DMR and the pistol are strings of one
   * and every shot would be a first shot; their `recoilMult` (2.2 and 1.15)
   * already carries the punch, and 1.6x on top of the DMR's would put 6.0 deg
   * on every deliberate scoped round.
   */
  firstShotMult: 1.6,
  /**
   * Seconds without firing before the string resets and the next round is a
   * first one again. Comfortably longer than any automatic's gap (the LMG's
   * is 0.1 s) and shorter than the carbine's `burstCycle` of 0.4, so a burst
   * weapon gets the punch on the first round of EVERY burst — which is right
   * for three rounds that climb as one motion. The DMR's 0.333 s at full rate
   * sits just inside it, but the DMR is excluded anyway.
   */
  stringResetTime: 0.35,
  /**
   * The SHAPE of a string, as two envelopes over the same shot counter
   * `firstShotMult` reads (`Player.stringShots`). This is what stops a spray
   * being a straight line with jitter on it: the kick's DIRECTION rotates as
   * the string runs, so the pattern is a hook that can be learned rather than
   * a magnitude that can only be pulled against.
   *
   * A muzzle climbs hardest at the start and then binds — the shooter is
   * already leaning into it, and the weapon has nowhere further to rotate — so
   * the vertical tapers off. What replaces it is horizontal: the further into a
   * string, the more of the kick goes sideways about `yawBias`. Both envelopes
   * are 1 and `yawStart` respectively on the FIRST round, so this composes with
   * `firstShotMult` rather than relitigating it — shot one is still the punch
   * that argument describes, and it is now also the straightest round in the
   * magazine.
   *
   * **The two are tuned as a pair to leave the total walk alone**, which is
   * what makes this a change of shape rather than a nerf. For the rifle at the
   * hip (24 rounds, `recoilMult` 1) the per-shot multipliers sum to 20.5 against
   * the 24.6 they summed to when every round kicked the same, and
   * `pitchPerShot` went from 0.026 to 0.03 to pay for exactly that: the
   * permanent share is 0.03 x 0.3 x 20.5 = 0.1845 rad = **10.6 deg**, against
   * the 11.0 deg the flat version walked. Re-derive both figures if any of
   * these four numbers moves — the walk is quoted in `recoverFraction` and in
   * `docs/weapons.md`, and it does not follow on its own.
   */
  pattern: {
    /**
     * Rounds over which both envelopes travel from their first-shot value to
     * their settled one. Seven is a little under a third of the rifle's
     * magazine and a third of the SMG's first second, so the shape is legible
     * inside one burst rather than being a property of a whole magazine.
     */
    patternShots: 7,
    /**
     * What the vertical falls to once the muzzle has bound. Deliberately mild:
     * at 0.65 the late string barely climbs at all and the weapon stops being
     * something you pull down, which is the control the recoil is FOR. 0.8 is
     * enough to be felt as a settle under the horizontal arriving.
     */
    pitchSettled: 0.8,
    /**
     * What the horizontal starts at. Low, because the first rounds of a string
     * going almost straight up is the half of this that makes tapping precise —
     * a tap is a first shot, and a first shot has nowhere sideways to go.
     */
    yawStart: 0.3,
  },
  /** Multiplier while fully aimed down sights — a braced stance kicks less. */
  adsMult: 0.55,
  /**
   * The rest of the stance, on the same footing as `adsMult` and blended the
   * same way. Crouching already bought a tighter group (`player.crouchSpreadMult`)
   * and a steadier hold (`camera.aimSway.crouchMult`) and did nothing at all
   * about the kick, which made kneeling behind a wall a decision about the
   * first round and not about the eighth.
   *
   * The two penalties are the same fact from the other side: recoil is absorbed
   * by a body braced against it, and a body that is walking or in the air is
   * not braced. `airMult` is the harshest number here because a jump is the one
   * stance a player chooses freely and there is nothing under it at all.
   */
  crouchMult: 0.8,
  moveMult: 1.25,
  airMult: 1.5,
  /**
   * Fraction of each kick that springs back on its own. The remainder is
   * pushed into the player's own aim and stays there, so a magazine held
   * down walks the muzzle off target and has to be pulled back by hand. At
   * 1.0 recoil is pure decoration.
   *
   * **The walk is ~10.6 deg of climb and ~2.4 deg of drift for the rifle's 24
   * rounds from the hip**, and it is derived rather than set: the vertical is
   * `pitchPerShot * (1 - recoverFraction) * sum(firstShotMult-and-taper over
   * the magazine)`, which `pattern` works through. It was 11.0 deg and 1.6 deg
   * when every round in a string kicked the same, so what the pattern bought is
   * half again as much sideways for a twentieth less climb. Re-derive both when
   * anything in `pattern`, `pitchPerShot`, `yawPerShot` or `firstShotMult`
   * moves; neither figure follows on its own.
   */
  recoverFraction: 0.7,
  /** How fast the springy part settles back (per second). */
  recovery: 6.5,
  /**
   * Ceilings on the SPRINGY part, so sustained fire can't walk the aim off the
   * screen and a crossfire's flinches can't stack off it either.
   *
   * `maxYaw` moved with `yawPerShot` and had to: a ceiling is only meaningful
   * as a number of rounds, and 0.06 against the new per-shot term would have
   * bound after four rounds of hard drift where it used to take eight. 0.09
   * puts it back at about seven, which is where `pattern.patternShots` has the
   * horizontal reaching full strength anyway. `maxPitch` is untouched — the
   * vertical per-shot term barely moved once the taper is in it, and this
   * ceiling is also what catches a grenade's flinch (`player.flinchPitchPerDamage`).
   */
  maxPitch: 0.17,
  maxYaw: 0.09,
  /**
   * Spread bloom: added per shot, its ceiling, and its bleed-off per second.
   * The bleed-off has to be well under `bloomPerShot * fireRate` (0.048/s
   * here) or holding the trigger never actually blooms.
   */
  bloomPerShot: 0.006,
  maxBloom: 0.03,
  bloomRecovery: 0.02,
  /**
   * The weapon punch on the viewmodel: a DAMPED SPRING the shot gives a
   * velocity to, not a level the shot sets and then fades.
   *
   * It used to be the second thing: `weaponKickT` snapped to 1 and fell
   * linearly, squared on the way out. That has an instant attack and a monotone
   * return with nothing on the other side of neutral — a fade rather than a
   * recoil, and two rounds 77 ms apart simply re-set it to 1, so an automatic
   * looked like one long shot instead of a mechanism cycling. The spring is the
   * same idiom and the same argument as `camera.land` — an impact hands it a
   * VELOCITY and it finds its own way back, which is what puts a rise, an
   * overshoot past neutral and a settle in it. It also accumulates for free: a
   * second round arriving on a weapon that has not come home adds to what is
   * already there, exactly as a second landing does, which is why a held
   * trigger now reads as a weapon that never quite settles, and why the
   * carbine's three rounds in 0.1 s stack to 1.35 where one makes 1.00.
   *
   * **It is NOT the same integrator, and that is the one thing here that must
   * not be copied back from `land`.** That spring is 2 Hz and semi-implicit
   * Euler is fine for it; this one is 6 Hz, where `omega * dt` reaches 1.26 at
   * 30 fps and Euler falls apart. Measured on the Euler version, a single
   * round peaked at 0.08 of its travel at 30 fps, 0.54 at 60 and 0.78 at 120 —
   * recoil growing with the frame rate, which is the failure `recovery`'s true
   * exponential exists to prevent one field up. `Player` steps it in closed
   * form instead and every figure below holds at any frame rate.
   *
   * `Player` owns the spring and `ViewModel` reads it, the same split as the
   * bob phase and the landing dip, and for the same reason: two integrators on
   * one impact drift apart.
   */
  kick: {
    /**
     * The velocity one round hands the spring, in units of `kickBack` per
     * second. The number is large because it is a velocity into a 6 Hz spring
     * and most of it is spent inside 30 ms.
     *
     * **The peak displacement is DERIVED from all three of these, not from this
     * one**: `speed * exp(-z/sqrt(1-z^2) * atan(sqrt(1-z^2)/z)) / (2*PI*frequency)`,
     * which at these numbers is 79 x 0.478 / 37.7 = **1.00**. That is why the
     * distances below can still be read as metres-at-full-kick, exactly as they
     * were under the old envelope. Change the frequency or the damping and the
     * peak moves with them — re-derive it rather than assuming the distances
     * still mean what they say. It went 64 -> 79 when the damping was raised,
     * for that reason and no other: a stiffer return eats more of the impulse
     * before the weapon has got anywhere.
     */
    speed: 79,
    /**
     * Spring frequency (Hz) and damping ratio. 6 Hz puts the peak at 30 ms and
     * takes the visible motion out inside ~120 ms, so a single round is a
     * travel-and-return rather than a strobe, and a rifle at 8/s is nearly home
     * between rounds while an SMG at 13/s is not.
     *
     * **Damping is the bounce, and 0.42 was too much of it.** The ratio of each
     * swing to the last is `exp(-z*PI/sqrt(1-z^2))`, so 0.42 came back THROUGH
     * the carry to -0.22 and then rang again from there — a weapon on a spring
     * rather than a weapon absorbing a shot, and legible as bounce at every
     * fire rate in the kit. 0.65 puts the overshoot at -0.07: enough to settle
     * from the front, which is the half of the cycle the old linear fade could
     * not show at all, and not enough to read as a wobble. Raising the frequency
     * shortens everything and lowers the peak; raising the damping only lowers
     * the peak. Either way `speed` has to follow.
     */
    frequency: 6,
    damping: 0.65,
    /**
     * How much of the weapon's own `recoilMult` reaches the model, as an
     * exponent. **Never use `recoilMult` raw here**: the DMR's 2.2 is a
     * statement about the aim, and applied to a pose in metres it throws the
     * receiver across the frame. At 0.6 the rifle (1.0) is untouched, the DMR
     * moves 1.6x it and the SMG 0.7x — a spread wide enough that the five
     * weapons stop kicking the model identically, which is what they did.
     */
    compress: 0.6,
    /**
     * What is left of the OFF-AXIS terms while fully aimed. The z travel is
     * exempt and stays at full.
     *
     * That split is geometry, not taste. The weapon carries the sight, so
     * anything that rotates or laterally shifts the model while aimed takes the
     * RETICLE off the axis the rounds fly down — which is the reticle lying, the
     * same failure the aimed hold sway is arranged to avoid from the other
     * side. Travel along z moves the sight closer to the eye and leaves the
     * picture centred, so it costs nothing. It is also what a braced shoulder
     * actually does with a rifle: absorbs it straight back and lets it rotate
     * very little.
     */
    adsMult: 0.3,
    /**
     * The closest the fitted sight may come to the camera while the weapon is
     * travelling, in metres. **A floor under the near plane, not a look.**
     *
     * The kick's travel is toward the eye and an aimed sight is already only
     * centimetres from it, so on a magnified optic the two collide: the DMR
     * with the scope drove 4.8 cm of travel into a 7.8 cm stand-off and put the
     * eyepiece 2 cm BEHIND `camera.minZ`, which reads exactly as the scope
     * going inside your head. `ViewModel` scales the aimed travel down to fit
     * `sightDist - this` rather than clamping at it, so the spring keeps its
     * shape and only loses amplitude.
     *
     * **It has to sit well above `CameraSystem`'s `minZ` of 0.05, and the gap
     * is not slack.** The bound is computed on the WEAPON NODE's travel, while
     * what must clear the near plane is the SIGHT — a point offset from that
     * node, which the kick's pitch and roll swing by another ~4 mm. Derived
     * against `minZ` directly, the DMR with the prism still measured 3.8 cm.
     * So this is set from measurement rather than from the arithmetic: at
     * 68 mm the worst combination in the kit (the DMR on the prism, with a
     * burst stacked on it) measures 6.2 cm, and the ten magnified combinations
     * span 6.2-7.4. **Re-measure rather than re-deriving if any of it moves** —
     * the arithmetic under-predicts by about 4 mm.
     *
     * Only the prism and the scope are ever bound by it — the three unmagnified
     * sights stand off far enough that the travel never reaches the limit, so
     * this costs them nothing at all.
     */
    adsClearance: 0.068,
    /**
     * The largest displacement a STRING reaches, as a multiple of one round's
     * peak. The spring accumulates on a weapon that has not come home, so the
     * bound above has to be derived against this rather than against 1 — the
     * carbine's three rounds in 0.1 s reach 1.35, which is the worst in the kit
     * and is where this comes from. Derived for a single round instead, the DMR
     * with the prism cleared at a single shot and clipped through a burst.
     *
     * It only affects the aimed clearance. Nothing scales by it.
     */
    stackPeak: 1.35,
  },
  /**
   * The kick's reach on each axis, at a displacement of 1 (see `kick.speed`).
   * Metres and radians in the CAMERA's frame, like every other viewmodel
   * offset, so they take the zoom compensation with the rest of the pose.
   *
   * `kickBack` carries the longitudinal travel, and it is deliberately the
   * largest of them: in first person the camera cannot move backwards to any
   * visible degree (`camPush` is 3.5 cm along the view axis and reads as a
   * flicker of FOV), so the weapon coming toward the eye and settling IS what
   * recoil travel looks like from inside the head. The lateral three all take
   * the shot's own `kickDrift` — the same signed number `yawBias` shapes and
   * the aim kick is built from — so what the model does and what the muzzle
   * does are one motion rather than two.
   */
  kickBack: 0.065,
  kickPitch: 0.12,
  kickSide: 0.022,
  /**
   * The cant. `rot.z` is SUBTRACTED against the drift, because a positive roll
   * takes the weapon's right flank UP (see `viewmodel.reloadRot`) and a weapon
   * walking right should lean into the direction it is going, not away from it.
   * Flip this with that convention if it is ever flipped.
   */
  kickRoll: 0.05,
  kickYaw: 0.018,
  /**
   * The cosmetic view punch per shot: an FOV spike, a backward camera shove,
   * and a directed nudge on pitch, yaw and roll — all decaying over
   * `punchTime`. Deliberately NOT part of aimPitch/aimYaw: bullets, bots, the
   * aim assist and the motion blur never see it, and it only sells the impact
   * to the eye. Because it decays roughly seven times faster than the aim kick
   * does, it is also what lets the VIEW snap harder than the AIM does.
   *
   * **The three angles are one direction drawn per shot and held, not fresh
   * noise per frame.** They used to be re-rolled every frame, and that is why
   * they had to be tiny: white noise at 8-13 rounds a second overlaps into a
   * buzz that reads as a dirty lens rather than as a weapon going off, and the
   * only defence against it was turning it down until it could not be seen. A
   * single coherent nudge per shot reads as an impact at roughly twice the
   * amplitude, which is where these now sit. `CameraSystem.addPunch` draws the
   * direction — biased upward and toward the shot's own drift, with noise on
   * top, so the punch is visibly the same event as the kick and not a second
   * one happening at the same time.
   *
   * The roll opposes the weapon's `kickRoll` on purpose. Rolling the camera the
   * same way the model rolls cancels the two against each other and tips the
   * whole picture instead; opposed, the weapon reads as twisting in the hands.
   */
  punchTime: 0.09,
  fovPunch: 0.025,
  camPush: 0.035,
  shakePitch: 0.007,
  shakeYaw: 0.006,
  shakeRoll: 0.006,
} as const;
