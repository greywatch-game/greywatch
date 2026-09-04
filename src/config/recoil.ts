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
   * **Both were set against reference footage** (`docs/weapons.md`): 0.03 to
   * 0.0192 on the vertical, 0.018 to 0.0103 on the horizontal.
   *
   * **The horizontal was briefly taken to 0.002 and that was a measurement
   * error, not a decision.** The first clip's dark range gave 0.6 px of net
   * lateral across 28 rounds and read as a weapon with no sideways component
   * at all. A later clip aimed at a distant vertical edge — which is what
   * makes a horizontal drift legible — shows the pull plainly: **0.40 deg to
   * the RIGHT by round 22, building through the string and springing back
   * almost entirely when it ends.** The lesson is about the FOOTAGE and not
   * the gun: a lateral drift measured against a wall of horizontal panelling
   * is a drift measured against nothing.
   *
   * 0.0103 is higher than the 0.018 it replaced would suggest because
   * `recoverFraction` moved with it: the haul is a RATE, so a smaller
   * per-shot yaw is annihilated between rounds rather than accumulating, and
   * the axis is sharply nonlinear about that threshold. It was fitted by
   * Monte-Carlo over the real `kickDrift` draw rather than by algebra —
   * mean 0.41 deg at round 22, and a single magazine lands anywhere from
   * 0.12 to 0.83. The reference's own drift is comparably noisy.
   */
  pitchPerShot: 0.0192,
  yawPerShot: 0.0103,
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
   * (1.35, 1.7 and 1.15) already carries the punch, and stacking this on top
   * of the DMR's would put the multiplier on every deliberate scoped round.
   *
   * 1.25 rather than the 1.6 it was, because the reference's opening round is
   * 1.3x the ones behind it — measured as the first step of a 28-round string
   * against the mean of rounds 2-4.
   */
  firstShotMult: 1.25,
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
   * **The pair no longer leaves the total walk alone, because the walk itself
   * was what the reference match cut.** For the rifle at the hip (24 rounds,
   * `recoilMult` 1) the pitch multipliers sum to 9.25 and the yaw multipliers
   * to 21.27, so the permanent share is **0.71 deg** of climb and **0.31 deg**
   * of drift, against the 10.6 and 2.4 they were before. Most of that is
   * `recoverFraction`, not this block: the footage shows a weapon that gives
   * back nearly everything it takes. Re-derive both figures if any of these
   * four numbers moves — the walk is quoted in `recoverFraction` and in
   * `docs/weapons.md`, and it does not follow on its own.
   */
  pattern: {
    /**
     * Rounds over which both envelopes travel from their first-shot value to
     * their settled one. Eight is a third of the rifle's magazine, so the
     * shape is legible inside one burst rather than being a property of a
     * whole magazine — and it is eight rather than seven because that is
     * where the reference's own climb stops: its per-round step is gone by
     * round 8-10 and flat for the eighteen after it.
     */
    patternShots: 8,
    /**
     * What the vertical falls to once the muzzle has bound.
     *
     * **This was 0.8, and the comment here used to warn that 0.65 was already
     * too far** — that a late string which barely climbs stops being something
     * you pull down, which is the control the recoil is FOR. 0.25 is well past
     * that line and it is deliberate: the reference weapon genuinely does stop
     * climbing, holding a flat **2.56 deg** from round 8 to round 22, and a
     * milder taper cannot produce a plateau at all. What the old warning was
     * protecting is real, and it is now spent — the rifle after round 8 is
     * held by its BLOOM and its cadence rather than by muzzle climb.
     *
     * Measured in the client at this value: plateau 2.557 deg against the
     * footage's 2.562.
     */
    pitchSettled: 0.25,
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
   * **0.93 was measured, not chosen, and it reverses a product decision that
   * was once made the other way.** This was 0.7 — 30% of every kick kept, an
   * explicit call that a fully-recovering recoil was decoration and that a
   * held magazine ought to genuinely walk off target. The reference footage
   * does not do that: an isolated round is ~90% recovered 300 ms later, and a
   * 28-round string leaves 0.37 deg behind against the 2.6 deg it was holding
   * mid-string. Matching it means most of the walk goes. **If the rifle turns
   * out to be too easy to hold, this is the first number to move back**, and
   * it is worth about eight times as much of the walk as anything in
   * `pattern`.
   *
   * **The walk is now ~0.71 deg of climb and ~0.31 deg of drift for the
   * rifle's 24 rounds from the hip**, and it is derived rather than set: the
   * vertical is `pitchPerShot * (1 - recoverFraction) * sum(firstShotMult-and-
   * taper over the magazine)`, which `pattern` works through. Re-derive both
   * when anything in `pattern`, `pitchPerShot`, `yawPerShot` or
   * `firstShotMult` moves; neither figure follows on its own.
   *
   * **The permanent share is HANDED OVER rather than applied at the shot**,
   * and it has to be now that `settle` gives the kick a rise: applied whole on
   * the frame the trigger broke, 30% of every kick would still be a step
   * function sitting underneath the spring, which is the exact thing the
   * spring exists to remove. `CameraSystem` owes it into `pitch`/`yaw` at the
   * spring's own envelope rate, so all of it is delivered by the time the
   * sight has settled and none of it before the sight has moved. **The
   * handover does not change the total** — the walk figures above are what
   * they are because of the fraction, not because of when it is collected.
   */
  recoverFraction: 0.93,
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
     * the whole attack takes: **59 ms aimed and 112 ms at the hip** on the
     * reference weapon, against descents (peak back to a tenth of it) of
     * 254 and 471.
     *
     * **The aimed pair is MEASURED and the hip pair is scaled from it.** The
     * footage `docs/weapons.md` records is all ADS, and it puts the muzzle at
     * the top of its travel 58 ms after the shot and half the way home 160 ms
     * after that. There is no hip reference at all, so `gripHip`/`haulHip`
     * were moved by the same factors the aimed pair took (x0.54 and x0.25)
     * rather than fitted — which keeps the two stances in the relation the
     * block below argues for, and is the honest place to look first if hip
     * fire feels wrong.
     *
     * **They are set against the FRAME as much as against the gun.** An
     * earlier tuning was 21 ms up and 20 down aimed, and at 60 Hz that is an
     * entire excursion inside two and a half samples, which cannot read as
     * motion however right its curve is. It read as a dropped frame. The floor
     * is roughly five samples for the whole travel; under it, making recoil
     * faster makes it JERKIER. These are nowhere near it.
     */
    gripAds: 45.5,
    gripHip: 24.1,
    /**
     * How fast the shooter hauls it back, in REFERENCE KICKS (`pitchPerShot`)
     * per second. A rate rather than a proportion, so a bigger excursion takes
     * proportionally longer to come home — which is why the bolt gun's return
     * is slower than the SMG's without either of them saying so.
     */
    haulAds: 2.46,
    haulHip: 1.48,
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
     * How much of the handover the haul is eased in over — see `RecoilShape`.
     * It is the ACCELERATION through the corner that this bounds, not the
     * corner itself, which stays exactly where it was.
     */
    haulRamp: 0.35,
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
   * **Neither of these binds on any weapon in the kit any more, and both are
   * kept for what else they catch.** They were sized as a number of ROUNDS —
   * `maxYaw` at 0.09 bound after about seven of hard drift — and against a
   * `yawPerShot` of 0.002 that is now some forty-five rounds, which is past
   * every magazine here. The vertical is the same story: the reference match
   * holds a sustained string at ~2.6 deg where `maxPitch` sits at 9.7.
   *
   * They stay because **the ceilings are on the shared recoil AXES, not on
   * the weapon**: `addFlinch` queues onto the same two, so what these actually
   * defend now is a crossfire — a grenade asks for 0.099 rad on its own
   * (`player.flinchPitchPerDamage`) and several hits close together must not
   * stack off the screen. **That is the reason `maxPitch` was NOT dropped to
   * suit the new climb**: sized to the rifle it would silently clamp flinch to
   * a fifth of what a blast is supposed to be worth, and the failure would
   * show up in grenades rather than anywhere near this file.
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
     * is the receiver moving in two hands. The rifle's whole attack is 27 ms
     * braced and 40 ms at the hip, against descents of 67 and 111 — and, as
     * with `settle`, the floor under all four is the FRAME rather than the
     * mechanism. See that block; the same tuning pass slowed both.
     */
    gripAds: 95,
    grip: 65,
    /**
     * How fast it is driven home, in KICK UNITS per second (1 being one
     * round's peak). Nothing scales these by the weapon: `compress` below
     * already makes a heavy gun travel further, and a rate against a longer
     * travel is a longer return for free — which is the right answer and one
     * fewer exponent to keep honest.
     */
    haulAds: 22,
    haul: 16,
    /** As `settle.riseTurns` and `settle.easeBand`, in this model's units. */
    riseTurns: 2.6,
    /** As `settle.haulRamp`. */
    haulRamp: 0.35,
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
      /**
       * Seconds after the shot the carrier stops at the back of its travel,
       * and seconds after it that it slams back into battery.
       *
       * **These are LEGIBLE rather than literal, and the difference is the
       * display.** A real carrier is at the back of its travel around 10 ms
       * and in battery around 35 ms, and those were the first numbers here.
       * At 60 Hz that put two OPPOSITE-SIGNED peaks 1.7 samples apart, which
       * does not resolve as two events — it aliases, and what aliasing looks
       * like is the jitter this whole block was added to avoid. Stretched to
       * 30 and 82 ms the pair is three samples apart inside a seven-sample
       * window, which reads as what it is: a mass going back, stopping, and
       * coming home. **A mechanism the frame cannot resolve is noise, and
       * noise is not more faithful for having the right timing.**
       */
      back: 0.03,
      home: 0.082,
      /** Seconds each of those impacts dies away over. */
      fall: 0.05,
      /**
       * …and seconds each takes to ARRIVE. `impulse` is all attack and no
       * ease-in, which is the right shape for something hitting and the wrong
       * one at this rate: an instantaneous jump to full is a step in the pose,
       * and two of them per round at 8 rounds a second is a buzz rather than a
       * mechanism. Twenty milliseconds is a little over one frame — enough to
       * be a move rather than a jump, and far short of anything that would
       * read as a swell.
       */
      rise: 0.02,
      /**
       * How hard each is, as a fraction of one round's kick — and they are
       * OPPOSITE in sign, which is the whole of why the pair reads as a
       * mechanism cycling. Mass travelling rearward drives the weapon back
       * into the shoulder; the same mass arriving in battery pulls it
       * forward, and the muzzle dips as it does. Same event, both ends of it.
       */
      backKick: 0.2,
      homeKick: -0.13,
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
     * — one PULL, three rounds inside 0.1 s — and measured in the client
     * through a real held trigger it reaches **1.73x one round aimed**. It is
     * the only weapon that stacks at all now: at the shipped `haul` every
     * other weapon in the kit is home before the next round lands, and a
     * sustained trigger measures 1.00x on all twelve of the other rows.
     *
     * **That is a tuning outcome and not a guarantee, which is why this stays
     * a measured number with margin rather than a derived one.** Slowing
     * `haul` to buy a longer, smoother descent is exactly what moves it: at
     * `haul` 12 the SMG's held trigger stacked to **5.15x** at the hip, and
     * the number here would have been describing a weapon that no longer
     * existed. **Re-measure it whenever `grip`, `haul` or `riseTurns` moves**
     * — the probe is a held trigger in the real client, not arithmetic.
     */
    stackPeak: 2,
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
  /**
   * The camera's ROLL after a shot: the weapon twisting in the hands, as two
   * opposite-signed beats on one clock — `core/math.ts`'s `impulse`, the same
   * idiom and the same argument as `kick.action`'s carrier beats one layer
   * down.
   *
   * **It replaced a roll drawn against the shot's own lateral drift, and the
   * reason is that the drift is RANDOM per round and a weapon's torque is
   * not.** A rifle's bore sits above and off the axis of the shoulder pocket,
   * so every round twists it the same way; tying the roll to `kickDrift` made
   * the sign flip shot to shot, which reads as camera shake rather than as a
   * gun, and made the roll vanish altogether on the rounds whose drift came
   * out near zero — which, with `pattern.yawStart` at 0.3, is most of the
   * opening of every string.
   *
   * Measured off 240 fps reference footage (`docs/weapons.md`), by tracking
   * the left and right thirds of the frame separately: what roll IS, to a
   * camera, is the two sides moving vertically against each other. Nine shots
   * across two clips, all nine the same sign, against a noise floor of 0.001
   * deg — 0.86 deg at the shot, back through zero at ~33 ms, a counter-swing
   * to +0.52 deg at ~50 ms, and home by ~85 ms.
   *
   * **`amp` carries the SIGN, and flipping the twist is negating it and
   * nothing else.** It is scaled by the punch's `shock` like every other
   * term, so what a weapon rolls follows its `recoilImpulse`.
   */
  rollBeat: {
    /** Radians at the top of the travel. 0.015 is the 0.86 deg measured. */
    amp: 0.015,
    /**
     * Seconds to the top. **The same clock as the pitch's own rise**, and
     * measured that way: the burst footage averages a roll that leaves zero at
     * the shot, peaks at 58 ms and is home by ~100. It is one motion resolved
     * on two axes, so a roll that peaked anywhere else would be claiming the
     * charge arrives twice.
     */
    peakAt: 0.058,
    /** Seconds from the top back to nothing. */
    fall: 0.055,
  },
} as const;
