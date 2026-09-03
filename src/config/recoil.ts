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
 * contributes two multipliers (`recoilMult`, the muzzle rise, and
 * `recoilImpulse`, the shove) and one bias (`yawBias`), and everything else —
 * the per-shot kick, the first-shot multiplier, the two pattern envelopes, the
 * recovery fraction, the stance multipliers and both springs' own constants —
 * is about the ACT of firing rather than about any particular gun.
 *
 * **The two weapon multipliers are the thing to understand before changing
 * anything here.** They were one field for most of this system's life, and
 * conflating them is why the two heaviest weapons in the kit stated their
 * weight by throwing the reticle four and five and a half degrees skyward on a
 * single frame. Muzzle rise is a MOMENT — the recoil force runs along the bore
 * and the shoulder holds the weapon below it, so what tips the muzzle is that
 * offset and a properly mounted heavy rifle tips remarkably little. The shove
 * is the CARTRIDGE, and what it buys is not angle: `settle` spends it on how
 * long the sight takes to come back, `shake` on how long the shooter takes to
 * re-settle afterwards, `punchCompress` on how hard the frame is hit, and
 * `kick.compress` on how far the weapon travels on screen. **Nothing driven by
 * the impulse may ever reach `pitchPerShot`.**
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
   * resolved in `Player.recoilRamp`. The DMR, the bolt gun and the pistol are
   * strings of one and every shot would be a first shot; their `recoilMult`
   * (1.35, 1.7 and 1.15) already carries the punch, and 1.6x on top of the
   * DMR's would put 3.7 deg on every deliberate scoped round.
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
   *
   * **The permanent share is HANDED OVER rather than applied at the shot**,
   * and it has to be now that `settle` gives the kick a rise: applied whole on
   * the frame the trigger broke, 30% of every kick would still be a step
   * function sitting underneath the spring, which is the exact thing the
   * spring exists to remove. `CameraSystem` owes it into `pitch`/`yaw` at the
   * spring's own envelope rate, so all of it is delivered by the time the
   * sight has settled and none of it before the sight has moved. **The total
   * is unchanged** — every walk figure quoted above still holds, because what
   * moved is when the shooter collects it and not how much.
   */
  recoverFraction: 0.7,
  /**
   * The SETTLE: how the aim comes back, and the one place a weapon's IMPULSE
   * (as against its muzzle rise) buys anything.
   *
   * **It is not a spring, and it was one twice before it was right.** The
   * first version was a first-order decay, which has no rise at all — the
   * whole kick landed on one frame and fell away from there, so every weapon
   * in the kit moved the sight as a step function. The second was a damped
   * spring given a velocity, which fixed the attack and introduced a worse
   * problem: a damped spring is symmetric about its peak and smooth in the
   * first derivative through it, so the sight eased out of the top of its
   * travel on the same curve it eased in, and the whole excursion read as
   * something ANIMATED rather than something hit. At the amplitudes a heavy
   * weapon needs, that reads as rubber.
   *
   * `core/recoilCurve.ts` carries the argument in full; the short version is
   * that **nothing about a gun wants to be where it started.** The charge
   * hands it an angular velocity, the shooter's grip ARRESTS that over tens of
   * milliseconds (and left alone it would stop wherever it got to), and then
   * the shooter HAULS it back — muscularly, at a rate, after a reaction. What
   * that produces is a fast flattening rise, a genuine CORNER at the top where
   * the arrest hands over to the haul, and a straight descent. **The corner is
   * the feature**: it is the point where the motion changes cause, and a curve
   * that is smooth through it is claiming the rise and the fall are one
   * motion.
   *
   * **The stance changes the TIMING and not merely the amplitude, and that is
   * the half of this the old model could not say at all.** Aimed, the weapon
   * is in a three-point lock — shoulder pocket, cheek weld, support hand — and
   * that is a stiff system a braced shooter drives back immediately. At the
   * hip it is held on two arms, which is a long, soft, slow lever with nothing
   * constraining it. They are not one system at a different volume, and
   * `adsMult` scaling one number could only ever say they were.
   */
  settle: {
    /**
     * How fast the grip arrests the rotation (1/s), braced and unbraced. The
     * rise's time constant is its reciprocal, and `riseTurns` of it is what
     * the whole attack takes: **20 ms aimed and 45 ms at the hip** on the
     * reference weapon, against a descent of 40 and 115. Roughly 2:1 either
     * way, which is what "it comes down about as fast as it went up" means
     * once the shooter rather than a spring is doing the coming down.
     */
    gripAds: 125,
    gripHip: 58,
    /**
     * How fast the shooter hauls it back, in REFERENCE KICKS (`pitchPerShot`)
     * per second. A rate rather than a proportion, so a bigger excursion takes
     * proportionally longer to come home — which is why the bolt gun's return
     * is slower than the SMG's without either of them saying so.
     */
    haulAds: 15,
    haulHip: 8,
    /**
     * Grip time constants the rise gets before the haul begins — the
     * shooter's reaction, and the flat at the top of the travel. At 2.7 the
     * rise is 93% complete at the handover, which is what keeps the peak
     * linear in the impulse (see `recoilGain`). **Do not take it below ~2.5**
     * without re-deriving the peak: under it the haul starts while the muzzle
     * is still climbing hard and the kick a weapon states stops being the kick
     * it delivers.
     */
    riseTurns: 2.7,
    /**
     * Below this many reference kicks the haul eases instead of hauling, so
     * the bottom of the travel is an arrival rather than a hard stop. The
     * corner at the TOP is two causes handing over and is meant to be sharp;
     * this one would be a stop with nothing stopping it.
     */
    easeBand: 0.1,
    /**
     * How much of the weapon's `recoilImpulse` slows both the arrest and the
     * haul, as an exponent. More mass in the system takes longer to stop and
     * longer to drive back — and note this is the ONLY thing the impulse does
     * to the settle: it moves no angle, so a heavier weapon is slower and
     * never higher.
     */
    massExp: 0.4,
  },
  /**
   * The post-shot UNSTEADINESS — what a heavy round actually costs, and the
   * half of it the muzzle rise had been standing in for.
   *
   * A shot does two things to a shooter: it moves the sight (`settle` above,
   * over a few hundred milliseconds) and it disturbs the POSITION they were
   * holding it in, which takes far longer to come back and is what a trained
   * shooter means by needing to re-settle. Nothing here modelled the second,
   * so the only language a big cartridge had was ANGLE — a bolt gun said "I am
   * a .338" by throwing the reticle five and a half degrees skyward, which is
   * neither what a mounted rifle does nor what it costs.
   *
   * **It is spent on the hold sway rather than as an offset of its own**, for
   * the reason the bolt cycle's wobble is: the sway is already an honest
   * disturbance of where the rifle POINTS, so widening it cannot make the
   * reticle lie. A shot both WIDENS the wander (`swayGain`) and QUICKENS it
   * (`rateGain`) — a disturbed position is restless as well as loose — and
   * both fade back into the breathing figure-eight the sway already draws. It
   * rides `swayW`, so aiming and crouching steady the disturbance exactly as
   * they steady the hold, and hip fire pays none of it (hip fire is charged in
   * bloom instead).
   */
  shake: {
    /** Raised per shot, times the weapon's `recoilImpulse`. */
    perShot: 0.3,
    /**
     * The ceiling, which SATURATES rather than accumulating — the argument is
     * `Player.suppress`'s: being disturbed is being disturbed, and a value
     * that climbed with the volume of fire would make a held trigger a hard
     * counter to aiming at all.
     *
     * It is a GUARD rather than a shape: at the shipped numbers nothing in the
     * kit reaches it (the LMG on a held trigger settles highest, at 1.41) and
     * that is deliberate. It was 1.3 for one revision, and at 1.3 all four
     * automatics saturated — so a submachine gun and a belt-fed machine gun
     * were equally unsteady on a held trigger and the field said nothing about
     * either of them. What separated them was `settleExp` below, not this.
     */
    max: 1.6,
    /**
     * Time constant of the fade, in seconds, at `recoilImpulse` 1 — and the
     * exponent by which the weapon's own impulse lengthens it
     * (`settle * impulse^settleExp`). A true exponential, for the reason the
     * spring's own step is exact: it is on the hold sway, which is on the aim.
     *
     * **A heavy round does not merely disturb more, it disturbs for LONGER**,
     * and that is what makes this field carry the automatics rather than the
     * ceiling above. At 0.5 s and 0.6 the SMG's disturbance is gone in a third
     * of a second and the bolt gun's takes 1.08 — so a held SMG trigger
     * settles at 0.72 where a held LMG's settles at 1.41, and the bolt gun's
     * single round opens the hold to 2.1x for **literally about a second**,
     * which is the thing a shooter means by needing to re-settle and the whole
     * reason this block exists.
     */
    settle: 0.5,
    settleExp: 0.6,
    /** How much of it widens the wander, and how much quickens it. */
    swayGain: 1,
    rateGain: 1.6,
  },
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
   * recoil growing with the frame rate, which is the failure `settle`'s own
   * closed-form step exists to prevent one field up. `Player` steps it in closed
   * form instead and every figure below holds at any frame rate.
   *
   * `Player` owns the spring and `ViewModel` reads it, the same split as the
   * bob phase and the landing dip, and for the same reason: two integrators on
   * one impact drift apart.
   */
  kick: {
    /**
     * How fast the shooter's grip arrests the WEAPON on screen (1/s), braced
     * and unbraced — the same model as `settle` above and deliberately the
     * same argument, because the gun in your hands and the sight on your
     * target are one object and cannot move on two different laws.
     *
     * It is stiffer than the aim's because it is a shorter lever: what
     * `settle` describes is the shooter's whole upper body rotating, and this
     * is the receiver moving in two hands. The rifle's whole attack is 17 ms
     * braced and 27 ms at the hip, against descents of 33 and 67.
     */
    gripAds: 150,
    grip: 95,
    /**
     * How fast it is driven home, in KICK UNITS per second (1 being one
     * round's peak). Nothing scales these by the weapon: `compress` below
     * already makes a heavy gun travel further, and a rate against a longer
     * travel is a longer return for free — which is the right answer and one
     * fewer exponent to keep honest.
     */
    haulAds: 30,
    haul: 15,
    /** As `settle.riseTurns` and `settle.easeBand`, in this model's units. */
    riseTurns: 2.6,
    easeBand: 0.1,
    /**
     * The ACTION, which is the thing that makes a self-loader read as a
     * MACHINE rather than as a catapult.
     *
     * A rifle's recoil is not one impulse and a shooter does not feel it as
     * one. There is the shot; then, some milliseconds later, the carrier
     * reaching the back of its travel and stopping against the buffer; then
     * the carrier returning and slamming into battery. Three distinct events,
     * and the second and third are what a shooter means when they describe a
     * gas gun as feeling "busy" against a bolt gun's single clean shove.
     * Without them the weapon on screen makes one smooth excursion per round
     * however sharp its attack, and one smooth excursion is a catapult.
     *
     * **They are on the WEAPON and the frame, never on the aim.** The carrier
     * is a fraction of the charge's momentum and the mount absorbs most of
     * what it does; what it costs is visible and not aimable, so putting it on
     * `aimPitch` would be jitter on where the bullets go in exchange for
     * nothing. `impulse` in `core/math.ts` is the shape — all attack and no
     * ease-in, which is what an arrival is.
     *
     * **A bolt gun states `boltCycle` and is exempt**, because its action is
     * worked by a hand rather than by the gas, and `CONFIG.viewmodel.cycle`
     * already plays that as a gesture over a second and a quarter. Two
     * accounts of one mechanism would be one too many.
     */
    action: {
      /** Seconds after the shot the carrier stops at the back of its travel. */
      back: 0.014,
      /** …and seconds after the shot it slams back into battery. */
      home: 0.043,
      /** Seconds each of those impacts dies away over. */
      fall: 0.03,
      /**
       * How hard each is, as a fraction of one round's kick — and they are
       * OPPOSITE in sign, which is the whole of why the pair reads as a
       * mechanism cycling. Mass travelling rearward drives the weapon back
       * into the shoulder; the same mass arriving in battery pulls it
       * forward, and the muzzle dips as it does. Same event, both ends of it.
       */
      backKick: 0.24,
      homeKick: -0.16,
      /**
       * What is left of it while fully aimed. **Not zero, and that is the
       * point**: a rifle in a three-point lock still buzzes, and the buzz is
       * most of what tells you the thing in your hands is a gas gun rather
       * than a catapult. But it is a fraction, because the action's impulse
       * is small against the charge's and a braced mount absorbs most of what
       * it does — and because the weapon carries the sight, so the whole of
       * it arriving on an aimed picture would be the model's reticle wandering
       * off the axis the rounds fly down.
       */
      adsMult: 0.45,
    },
    /**
     * How much of the weapon's `recoilImpulse` reaches the model, as an
     * exponent. **Never use it raw here**: 3.6 is a statement about a settle
     * time and applied to a pose in centimetres it throws the receiver across
     * the frame. At 0.6 the rifle is 1.00, the DMR 1.69, the bolt gun 2.16 and
     * the SMG 0.66 — and because `haul` above is a RATE, that spread is a
     * spread in DURATION as well as in distance for free.
     */
    compress: 0.6,
    /**
     * What is left of the OFF-AXIS terms while fully aimed. The z travel is
     * exempt and stays at full.
     *
     * **It went 0.3 -> 0.16 when `kickPitch` went 0.12 -> 0.22, and the two
     * moves are one change**: their product is what an aimed weapon takes and
     * it is unmoved, while the bare `kickPitch` is what hip fire takes and it
     * nearly doubled. Move either one alone and the aimed sight picture moves
     * with it.
     *
     * That split is geometry, not taste. The weapon carries the sight, so
     * anything that rotates or laterally shifts the model while aimed takes
     * the RETICLE off the axis the rounds fly down — which is the reticle
     * lying, the same failure the aimed hold sway is arranged to avoid from
     * the other side. Travel along z moves the sight closer to the eye and
     * leaves the picture centred, so it costs nothing. It is also what a
     * braced shoulder actually does with a rifle: absorbs it straight back and
     * lets it rotate very little.
     */
    adsMult: 0.16,
    /**
     * The closest the fitted sight may come to the camera while the weapon is
     * travelling, in metres. **A floor under the near plane, not a look.**
     *
     * The kick's travel is toward the eye and an aimed sight is already only
     * centimetres from it, so on a magnified optic the two collide: the DMR
     * with the scope drove 4.8 cm of travel into a 7.8 cm stand-off and put
     * the eyepiece 2 cm BEHIND `camera.minZ`, which reads exactly as the scope
     * going inside your head. `ViewModel` scales the aimed travel down to fit
     * `sightDist - this` rather than clamping at it, so the kick keeps its
     * shape and only loses amplitude.
     *
     * **It has to sit well above `CameraSystem`'s `minZ` of 0.05, and the gap
     * is not slack**: the bound is computed on the WEAPON NODE's travel while
     * what must clear the near plane is the SIGHT, a point the kick's pitch
     * and roll swing by another ~4 mm. It is set from measurement rather than
     * from the arithmetic — see `docs/weapons.md`, and **re-measure rather
     * than re-deriving** if any of it moves.
     */
    adsClearance: 0.068,
    /**
     * The largest displacement a STRING reaches, as a multiple of one round's
     * peak, and the figure `adsClearance` is derived against — a burst arrives
     * faster than the weapon comes home, so the travel to leave room for is
     * the biggest a string makes and never 1.
     *
     * **It is measured rather than reasoned about, and it moved when the
     * spring became an arrest and a haul**: under this model a round landing
     * mid-recovery also restarts the shooter's reaction, so a string stacks
     * higher than a spring's did. The worst in the kit is the carbine's three
     * rounds in 0.1 s, and what it reaches depends hard on the STANCE: 2.49x
     * at the hip against 1.22x aimed, because the haul is more than twice as
     * fast braced and has nearly come home before the next round lands.
     *
     * **The AIMED figure is the one this may be set from**, and that is not a
     * corner cut. What this bounds is the fitted sight coming through the near
     * plane, `ViewModel` blends the bound in with the ADS blend, and hip fire
     * has no sight on the eye to drive anywhere. 1.5 carries the aimed worst
     * case with margin for a round fired at the hip and then shouldered
     * mid-recovery, which is the only way the two can meet.
     */
    stackPeak: 1.5,
  },
  /**
   * The kick's reach on each axis, at a displacement of 1 (one round's peak).
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
  kickBack: 0.072,
  /**
   * The muzzle FLIP on the model, and the biggest single lever there is on
   * whether a gun reads as being fired.
   *
   * **It went 0.12 -> 0.22 and `kick.adsMult` went 0.3 -> 0.16 in the same
   * change, which is deliberate and is why this is not a nerf or a buff.**
   * The product of the two is what an AIMED weapon takes (0.035 rad, against
   * 0.036 before — the same picture to two decimal places), and the bare
   * number is what hip fire takes: 12.6 deg of model rotation against 6.9. So
   * the weapon now genuinely throws its muzzle skyward in the hands and
   * nothing about the aimed sight picture moved.
   *
   * That asymmetry is the whole trade this axis is for. A rotation of the
   * model while aimed takes the fitted sight's reticle off the axis the rounds
   * fly down, so it is the one term that has to stay small; at the hip there
   * is no sight on the eye, the crosshair is drawn by the HUD rather than
   * carried by the gun, and the flip costs nothing but is most of what you
   * see. **Spend recoil's visual budget here, not on the aim.**
   */
  kickPitch: 0.22,
  kickSide: 0.035,
  /**
   * The cant. `rot.z` is SUBTRACTED against the drift, because a positive roll
   * takes the weapon's right flank UP (see `viewmodel.reloadRot`) and a weapon
   * walking right should lean into the direction it is going, not away from it.
   * Flip this with that convention if it is ever flipped.
   */
  kickRoll: 0.09,
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
  /**
   * How much of the weapon's `recoilImpulse` reaches the punch, as an
   * exponent. **The punch is where the SHOCK is drawn**, and until this field
   * existed every weapon in the game shook the view by exactly the same
   * amount: a bolt gun and a submachine gun made the identical picture, which
   * is the clearest possible statement that the frame does not know what is in
   * the player's hands.
   *
   * It is compressed for the reason `kick.compress` is — 3.6 is a defensible
   * thing to do to a settle time and an indefensible thing to do to the FOV —
   * and at 0.5 the five terms below span 0.71x on the SMG to 1.90x on the bolt
   * gun. It scales the punch's AMPLITUDE only; how long it lasts is
   * `punchTime` for everything, because a shock is a SNAP and what takes a
   * second to fade is `shake`.
   */
  punchCompress: 0.5,
  fovPunch: 0.025,
  camPush: 0.035,
  shakePitch: 0.007,
  shakeYaw: 0.006,
  shakeRoll: 0.006,
} as const;
