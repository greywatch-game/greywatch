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
 * comment below are DERIVED (0.70 deg of climb and 0.21 deg of drift over the
 * rifle's magazine) and have to be re-derived rather than assumed whenever
 * `pattern`, `pitchPerShot`, `yawPerShot`, `firstShotMult` or either recovery
 * fraction moves — the climb off `recoverFraction` and the drift off
 * `yawRecoverFraction`, which are two numbers now and not one.
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
   *
   * **0.0109 is that fit carried across `recoverFraction` 0.93 -> 0.958**, not
   * a new one: a smaller permanent share takes lateral out of every round, and
   * the same Monte-Carlo puts the round-22 mean back where 0.0103 had it at the
   * old fraction. Re-run it rather than scaling if either moves again.
   *
   * **0.005 is a PRODUCT decision taken against that fit, and it is the one
   * place in this file where the footage lost an argument.** What the
   * reference measures is a lateral that is mostly SPRING: 0.40 deg of pull
   * built through 22 rounds and given back almost entirely when the string
   * ends. Played rather than measured, that reads as the reticle being thrown
   * sideways and hauled back — and it got worse, not better, when
   * `pattern.sweepShots` made the direction coherent, because five rounds
   * pulling the same way go somewhere five rounds arguing never did. Measured
   * in the client at the old figure, the rifle's springy lateral swung **0.67
   * deg aimed and 1.71 at the hip** and then came home.
   *
   * **What was cut is the SPRING and not the lateral**, which is what
   * `yawRecoverFraction` is for: this drops to 46% and the share of it that
   * never comes back rises to 9.5%, so the WALK — the part that turns your
   * aim and has to be put back by hand — is within 4% of what it was, while
   * the swing that bounces back is about a fifth of it. The horizontal is now
   * mostly something you correct and a little something you ride, where it
   * used to be the other way round.
   */
  pitchPerShot: 0.0192,
  yawPerShot: 0.005,
  /**
   * What the FIRST round of a string kicks, as a multiple of the rest.
   *
   * A weapon that has been sitting still and one that is mid-burst are not the
   * same weapon, and without this they were: shot 1 and shot 20 kicked
   * identically, so a burst had a flat ramp instead of a punch that settles.
   * The punch is also what makes the first round of a tap distinct from a held
   * trigger, which is the entire reason to tap.
   *
   * It applies only where a string means something — `!semiAuto || burst > 1`
   * of the SELECTED FIRE MODE, resolved in `Player.recoilRamp`. The DMR, the
   * bolt gun and the pistol are strings of one and every shot would be a first
   * shot; their `recoilMult` (1.35, 1.7 and 1.15) already carries the punch,
   * and stacking this on top of the DMR's would put the multiplier on every
   * deliberate scoped round. A rifle switched to `semi` leaves this the same
   * way and for the same reason, which is most of what that position buys.
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
   * `recoilMult` 1) the pitch multipliers sum to 15.25 and the yaw multipliers
   * to 21.27, so the permanent share is **0.70 deg** of climb and **0.21 deg**
   * of drift, against the 10.6 and 2.4 they were before. The drift is worked
   * against `yawRecoverFraction` and NOT `recoverFraction` — the two axes keep
   * different shares now, and using the vertical's would under-report it by a
   * factor of two and a quarter. Most of that is
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
     * **It is NOT what makes a string plateau any more, and for one revision it
     * was.** At 0.25 the taper was standing in for an equilibrium the haul did
     * not have: a pure-rate haul nets the same amount off every cycle wherever
     * the muzzle is, so a string plateaus only where the tapered kick happens
     * to equal it. It did for the aimed rifle, by fitting; for the aimed SMG it
     * came in under, and a held SMG's aim SANK for the rest of the magazine —
     * 0.8 deg down with the trigger still held, which reads as downward recoil.
     * `settle.reachAds` is the plateau now, and it holds for every weapon.
     *
     * **0.55 is what the reference's per-round kick is through a held string.**
     * Tracked frame by frame, every round of its plateau still lifts the aim
     * ~0.31 deg and the shooter takes ~0.25 back before the next one — a
     * sawtooth riding a flat floor. At 0.25 the rounds past the eighth made
     * 0.15 deg of it and the string read as a smear; at 0.55 it is 0.32. It was
     * grid-fitted with `patternShots` and `reachAds` against the reference's
     * floor through all 28 rounds, and lands 6x closer than 0.25 did.
     */
    pitchSettled: 0.55,
    /**
     * What the horizontal starts at. Low, because the first rounds of a string
     * going almost straight up is the half of this that makes tapping precise —
     * a tap is a first shot, and a first shot has nowhere sideways to go.
     */
    yawStart: 0.3,
    /**
     * Rounds in one full lateral SWEEP, and how much of each round's lateral is
     * fresh noise rather than the sweep — the shape of `Player.kickDrift`,
     * which is the signed lateral the aim kick, the model's lean and the view
     * punch are all built from.
     *
     * **A string used to draw it independently per round, and that is why the
     * aim read as jumping in random directions rather than walking.** An
     * automatic puts eight to thirteen of those draws a second on the same
     * axis, so the horizontal changed sign on roughly a third of the rounds and
     * nothing about it could be anticipated — which is the definition of
     * recoil you can only pull against. A muzzle does not do that: it walks,
     * and it walks somewhere, and the reference footage shows exactly that —
     * 0.40 deg of RIGHTWARD pull building through 22 rounds and springing back
     * when the string ends.
     *
     * So the lateral is a SINE over the string counter, its direction drawn
     * once per string, and it starts at ZERO — which is `yawStart`'s argument
     * made a second way: the opening rounds go up, then the muzzle peels one
     * way for five or six rounds and comes back through the middle the other
     * way. That is a hook, and a hook can be learned.
     *
     * **It is not a difficulty change, and that was checked rather than
     * assumed.** The weapon's `yawBias` scales the sweep and offsets it exactly
     * as it did the noise, so the MEAN lateral of every round is what it was;
     * over the rifle's 22 rounds the permanent drift is 0.176 deg under both
     * models. What moves is the spread across magazines — 0.11..0.24 deg where
     * the independent draw ran -0.01..0.37 — and the springy mid-string peak,
     * up about 8% (0.65 -> 0.72 deg aimed) because five rounds pulling the same
     * way go further than five rounds arguing. Re-run that pair rather than
     * scaling if `yawPerShot` or `recoverFraction` moves.
     *
     * **Seventeen rather than the eleven it opened at, and the reason is the
     * difference between a WALK and a JUMP.** At eleven a half cycle is five
     * and a half rounds — 0.58 s on the rifle — so the muzzle went out and came
     * back inside a single burst, which is a swing rather than a walk however
     * coherent it is. At seventeen a burst of six to ten rounds is most of one
     * way, and it is a whole magazine that sees the lateral come back: what a
     * player has to do about it is re-aim rather than wait. The noise share
     * keeps it off being a machine tracing the same figure, which is the same
     * job the hold sway's second sine does.
     */
    sweepShots: 17,
    sweepNoise: 0.3,
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
   * **0.958 rather than 0.93 holds the walk where it was when
   * `pattern.pitchSettled` went 0.25 -> 0.55.** Every round past the eighth
   * now kicks twice as hard, so at the old fraction the same magazine would
   * have kept half as much again — 1.10 deg of climb instead of 0.71, and
   * further from the reference's 0.15, not nearer. The walk is a claim this
   * file makes on purpose and a kick change should not move it by accident.
   *
   * **The walk is now ~0.70 deg of climb and ~0.21 deg of drift for the
   * rifle's 24 rounds from the hip**, and it is derived rather than set: the
   * vertical is `pitchPerShot * (1 - recoverFraction) * sum(firstShotMult-and-
   * taper over the magazine)`, which `pattern` works through, and the lateral
   * is the same product over `yawPerShot` and `yawRecoverFraction`. Re-derive both
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
  recoverFraction: 0.958,
  /**
   * The same fraction for the HORIZONTAL, which is a different question about
   * a shooter and used to be answered with the vertical's number.
   *
   * **A shooter hauls DOWN against a direction they knew before the trigger
   * broke.** Muzzle rise is what a gun does, every round, and bracing against
   * it is most of what a grip IS — so nearly all of it comes back on its own,
   * which is `recoverFraction` at 0.958. A lateral cannot be pre-loaded
   * against: it is not known until it has happened, so what a shooter does
   * about it is re-aim. More of it is therefore AIM rather than spring, and
   * at 0.905 nine and a half percent of every round's horizontal stays.
   *
   * **It is the lever that separates the two things a lateral does**, which
   * were one thing while the two axes shared a number: the SWING that goes out
   * and is hauled back — read in play as the reticle being thrown sideways —
   * and the WALK that turns your aim and stays turned. Raising this and
   * cutting `yawPerShot` together takes the first down by four fifths and
   * leaves the second where it was. **They move as a PAIR and their product is
   * the walk**: `yawPerShot * (1 - this)` is what a round permanently costs,
   * and moving either alone moves it.
   */
  yawRecoverFraction: 0.905,
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
     * rise's time constant is its reciprocal, and `riseTurns` of it is the
     * shooter's REACTION — how long before the haul begins: **59 ms aimed and
     * 79 ms at the hip** on the reference weapon. An isolated rifle round (a
     * first shot, so `firstShotMult` included) peaks at 65 and 90 ms and is
     * back to a tenth of its peak 266 and 434 ms after that.
     *
     * **The aimed pair is MEASURED and the hip pair is not.** The footage
     * `docs/weapons.md` records is all ADS, and it puts the muzzle at the top
     * of its travel 58 ms after the shot and half the way home 160 ms after
     * that. There is no usable hip reference, so the hip pair is set against
     * two constraints instead, and **both were violated by the scaled pair it
     * replaced** (24.1 and 1.48), which made a hip string take 3.7 s to settle
     * against 0.8 aimed:
     *
     * - **The reaction must fit inside an automatic's cycle.** `age` restarts
     *   on every round, so a reaction longer than the gap between rounds means
     *   the haul never engages through a held trigger and the string piles up
     *   unopposed. At 24.1 it was 112 ms against the rifle's 106 and the LMG's
     *   100; at 34 it is 79 and 76, and the SMG's is 60 against its 77. **Check
     *   it against the fastest automatic whenever `gripHip`, `riseTurns` or
     *   `massExp` moves** — the carbine's burst is exempt, three rounds in
     *   0.1 s being meant to climb as one motion.
     * - **The haul has to pay for `adsMult`.** It is a RATE, so a hip kick
     *   already 1/`adsMult` the size of an aimed one takes that much longer to
     *   come home at the same haul — and a slower haul on top of it compounds.
     *   That is why `haulHip` is ABOVE `haulAds` in kicks per second: the hip
     *   is still the softer system, peaking later and climbing higher through
     *   a string, but it is not charged for the size of its kick twice.
     *
     * **They are set against the FRAME as much as against the gun.** An
     * earlier tuning was 21 ms up and 20 down aimed, and at 60 Hz that is an
     * entire excursion inside two and a half samples, which cannot read as
     * motion however right its curve is. It read as a dropped frame. The floor
     * is roughly five samples for the whole travel; under it, making recoil
     * faster makes it JERKIER. These are nowhere near it.
     */
    gripAds: 45.5,
    gripHip: 34,
    /**
     * How fast the shooter hauls it back, in REFERENCE KICKS (`pitchPerShot`)
     * per second. A rate rather than a proportion, so a bigger excursion takes
     * proportionally longer to come home — which is why the bolt gun's return
     * is slower than the SMG's without either of them saying so — and why
     * `haulHip` sits above `haulAds` rather than below it (see `gripAds`).
     */
    haulAds: 2.46,
    haulHip: 2.7,
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
     * Above this many reference kicks of displacement the haul LEANS IN — its
     * rate multiplied by how many of these the muzzle is off — braced and
     * unbraced, **and only in a string**: the rounds behind a string's first
     * ask for it, and it lets go when the muzzle is back inside this.
     * `RecoilShape.reach` has the argument; the short version is that a pure
     * rate gives a held trigger no level to settle at, so a string either
     * climbs forever or, where the kick is small against the haul, SINKS with
     * the trigger still held. The aimed SMG did the second: 0.8 deg down
     * through a magazine. With this every string finds a plateau.
     *
     * **A lone round, a tap and a flinch never lean**, so each is the measured
     * shape to the number — the straight descent, the corner and every figure
     * `docs/weapons.md` measures off one — and a grenade's flinch is still the
     * two seconds it was. Applied to everything it would have halved both,
     * which is a balance change nobody asked this for.
     *
     * **The aimed number is FITTED and the hip one is set, as with the pairs
     * above.** 0.8 (0.88 deg) was grid-fitted with `pattern` against the
     * reference's floor through a 28-round string.
     *
     * The hip one is lower because the hip REACTION eats most of an
     * automatic's cycle (79 ms of the rifle's 106), so it has far less haul
     * per round to lean with. At 0.6 a hip string plateaus about twice as high
     * as an aimed one — the rifle at ~4.5 deg, where it used to climb past 9
     * with no end in sight — which keeps the hip the softer system and bounds
     * it. **Re-fit `reachAds` against the footage, not by feel**, if
     * `pattern`, `haulAds` or `gripAds` moves.
     */
    reachAds: 0.8,
    reachHip: 0.6,
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
   *
   * **A STRING disturbs the hold ONCE, on its opening round, and the rounds
   * behind it are the recoil's to charge.** It used to be raised by every
   * round, and on a held automatic trigger that piled up to ~1.5 — a sway
   * 2.6x as wide and 3.5x as fast, swinging the aim through a degree and a
   * half in the middle of a string. Half of every swing is DOWN, and a player
   * holding the trigger reads a muzzle going down under fire as recoil going
   * the wrong way — which is exactly what one did. The reference shows nothing
   * of it: tracked through 28 rounds, its floor holds flat to a tenth of a
   * degree. `Player.recoilKick` says which rounds disturb (`opensString`), off the
   * same `stringed`/`stringShots` pair `firstShotMult` reads, so a DMR, a
   * pistol and a bolt gun — strings of one — pay on every round exactly as
   * before, and every burst of the carbine's pays once.
   */
  shake: {
    /**
     * Raised per DISTURBING round (above), times the weapon's `recoilImpulse`.
     */
    perShot: 0.3,
    /**
     * The ceiling, which SATURATES rather than accumulating — the argument is
     * `Player.suppress`'s: being disturbed is being disturbed, and a value
     * that climbed with the volume of fire would make a held trigger a hard
     * counter to aiming at all.
     *
     * It is a GUARD rather than a shape, and since a string disturbs only on
     * its opening round the automatics are nowhere near it: the DMR fired as
     * fast as it cycles is the one thing in the kit that stacks rounds on it —
     * 0.72 a round every 0.286 s against a 0.84 s fade, which reaches it.
     */
    max: 1.6,
    /**
     * Time constant of the fade, in seconds, at `recoilImpulse` 1 — and the
     * exponent by which the weapon's own impulse lengthens it
     * (`settle * impulse^settleExp`). A true exponential, for the reason the
     * spring's own step is exact: it is on the hold sway, which is on the aim.
     *
     * **A heavy round does not merely disturb more, it disturbs for LONGER**,
     * At 0.5 s and 0.6 the SMG's disturbance is gone in a third of a second
     * and the bolt gun's takes 1.08 — so the bolt gun's single round opens the
     * hold to 2.1x for **literally about a second**, which is the thing a
     * shooter means by needing to re-settle and the whole reason this block
     * exists.
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
   * `maxYaw` at 0.09 bound after about seven of hard drift — and measured
   * through held triggers in the client the worst springy lateral in the kit
   * is now **1.0 deg at the hip and 0.20 aimed** against a ceiling of 5.16,
   * with the haul's own lean doing the bounding long before this could. The
   * vertical is the same story: a sustained string holds at 2.4 deg aimed and
   * 5.0 at the hip where `maxPitch` sits at 9.7.
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
     * is the receiver moving in two hands. As with `settle`, the floor under
     * all four numbers is the FRAME rather than the mechanism — and this pair
     * was the one still under it.
     *
     * **95/65 put the rifle's whole ATTACK at 27 ms braced and 40 at the hip,
     * which at 60 Hz is 1.6 frames and 2.4.** Measured in the client it was
     * worse than the arithmetic — **18 ms to the top aimed and 36 at the hip,
     * whole excursions of 66 and 96 ms**. `settle` states the rule this
     * breaks: nothing that completes in two samples can read as MOTION however
     * right its curve is, it reads as a strobe — and the weapon on screen is
     * the biggest moving thing in the frame, so it is where the rule matters
     * most. The report was that recoil felt jumpy and jerky rather than heavy;
     * this pair is most of it.
     *
     * At 56/40, measured the same way: **39 ms to the top aimed and 56 at the
     * hip, whole excursions of 101 and 145 ms** — two and a half to three and a
     * half frames of attack at 60 Hz, six to nine of travel. **Do not take
     * them back up to buy a snappier weapon**: what a snappier weapon buys at
     * this rate is a frame the eye reads as dropped.
     */
    gripAds: 56,
    grip: 40,
    /**
     * How fast it is driven home, in KICK UNITS per second (1 being one
     * round's peak). Nothing scales these by the weapon: `compress` below
     * already makes a heavy gun travel further, and a rate against a longer
     * travel is a longer return for free — which is the right answer and one
     * fewer exponent to keep honest.
     *
     * Slowed with the arrest above and for the same reason: a descent that
     * outpaces the display is not a descent. **What normally makes that
     * expensive is stacking** — a slower return means the next round lands on a
     * weapon that has not come home — and here it costs nothing, because
     * `stackCap` is a wall rather than a tuning coincidence. Before it, this
     * pair could not be moved at all: at `haul` 12 a submachine gun's held
     * trigger measured 5.15x one round's travel.
     */
    haulAds: 17,
    haul: 12,
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
      back: 0.034,
      home: 0.088,
      /** Seconds each of those impacts dies away over. */
      fall: 0.058,
      /**
       * …and seconds each takes to ARRIVE. `impulse` is all attack and no
       * ease-in, which is the right shape for something hitting and the wrong
       * one at this rate: an instantaneous jump to full is a step in the pose,
       * and two of them per round at 8 rounds a second is a buzz rather than a
       * mechanism. Twenty milliseconds is a little over one frame — enough to
       * be a move rather than a jump, and far short of anything that would
       * read as a swell.
       *
       * **32 ms rather than 20, which is the same correction `grip` above
       * took.** Two beats per round arriving in a little over one frame each
       * is a rattle laid over the kick rather than a mechanism inside it, and
       * at 8-13 rounds a second a rattle is what "too jerky" is made of.
       * Their amplitudes came down with it (`backKick`/`homeKick`): the
       * carrier is a fraction of the charge and was reading as a second
       * recoil.
       */
      rise: 0.032,
      /**
       * How hard each is, as a fraction of one round's kick — and they are
       * OPPOSITE in sign, which is the whole of why the pair reads as a
       * mechanism cycling. Mass travelling rearward drives the weapon back
       * into the shoulder; the same mass arriving in battery pulls it
       * forward, and the muzzle dips as it does. Same event, both ends of it.
       */
      backKick: 0.13,
      homeKick: -0.08,
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
     * The SHOULDER: the furthest back a string may drive the weapon, as a
     * multiple of what one of ITS OWN rounds travels (`RecoilShape.cap`, times
     * `kickWeight`). It is also what `adsClearance` is derived against, since
     * the travel to leave room for at the near plane is the biggest a string
     * makes and never one round's.
     *
     * **It replaced a MEASURED `stackPeak`, and that is the point rather than
     * a tidy-up.** That number described what a held trigger happened to reach
     * under the tuning of the day, so it carried a standing debt — re-measure
     * it whenever `grip`, `haul` or `riseTurns` moves — and it was never a
     * bound: it was a report. What it reported at the hip is why this exists.
     * On the shipped constants a held submachine gun reached **3.03x** one
     * round's travel measured in the client — 13.3 cm of receiver toward the
     * eye, the muzzle flip that rides the same number through 23 degrees, and
     * a residual at each shot frame that climbed monotonically from round 3 to
     * round 20 without ever coming home; an earlier, smoother `haul` was
     * measured past 5x. The stated figure was 2, and it was honest about the
     * ADS case it had been measured in: the rifle reads 0.000 at all twenty
     * shot frames in both stances, and it was the hip that was never taken.
     *
     * A wall makes it a bound instead: the string cannot pass it however fast
     * the weapon cycles, the near-plane fit is derived rather than measured,
     * and `haul` and `grip` can be set for how the motion READS without a
     * stacking budget to keep in step. 1.6 leaves a round and a half of travel
     * — the rifle's held plateau sawtooths between 3.7 and 5.8 cm, so what a
     * string looks like is still a weapon working and not a pose.
     *
     * **It is a multiple of the WEAPON's own travel and not an absolute**, or
     * it clips the two heaviest weapons on a single round: the bolt gun's one
     * shot is 2.10 kick units and nothing about it is a string.
     */
    stackCap: 1.6,
  },
  /**
   * The kick's reach on each axis, at a displacement of 1 (one round's peak).
   * Metres and radians in the CAMERA's frame, like every other viewmodel
   * offset, so they take the zoom compensation with the rest of the pose.
   *
   * `kickBack` carries the longitudinal travel and `kickLift` the rise that
   * goes with it. The lateral three all take the shot's own `kickDrift` — the
   * same signed number `yawBias` shapes and the aim kick is built from — so
   * what the model does and what the muzzle does are one motion rather than
   * two.
   *
   * **`kickBack` was 0.072 and that was half again too much of the wrong
   * axis.** The argument for making it the largest term was that in first
   * person the camera cannot move backwards to any visible degree, so the
   * weapon coming toward the eye IS what recoil travel looks like from inside
   * the head. True, and it still bought the wrong picture: 7.2 cm of receiver
   * per round on the rifle and 15 on the bolt gun, before any stacking, into
   * a weapon whose butt is against a shoulder. **A mounted rifle barely
   * translates** — the shoulder is what stops it — and what it does instead is
   * ROTATE about that mount, which is `kickPitch` and is already where this
   * file says to spend the budget. So the travel is 3.6 cm and the difference
   * went to `kickLift`, which is the same rotation seen as the receiver coming
   * UP rather than as the muzzle tipping.
   */
  kickBack: 0.036,
  /**
   * How far the weapon RISES on the same travel, in metres at a displacement
   * of 1 — the receiver climbing as the muzzle tips about a mount behind it.
   *
   * It was `kickBack * 0.25` written into `ViewModel`, which made it a quarter
   * of a term it has nothing to do with: one is a shoulder compressing and the
   * other is a weapon pivoting in it. Stated on its own it survived `kickBack`
   * halving, which is exactly why it is stated on its own.
   *
   * It rides the off-axis damping like the rotations rather than the z travel,
   * because lifting the model while aimed lifts the SIGHT off the axis the
   * rounds fly down. So it is hip fire's, which is where there is no reticle
   * to lie.
   */
  kickLift: 0.018,
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
   * is no sight on the eye and no mark on the screen either — nothing is
   * drawn that the muzzle could be seen to disagree with — so the flip costs
   * nothing and is most of what you see. **Spend recoil's visual budget here,
   * not on the aim.**
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
   * and a directed nudge on pitch, yaw and roll. Deliberately NOT part of
   * aimPitch/aimYaw: bullets, bots, the aim assist and the motion blur never
   * see it, and it only sells the impact to the eye. Because it comes and goes
   * inside the time the aim kick is still rising, it is also what lets the
   * VIEW snap harder than the AIM does.
   *
   * **It is a RISE and a FALL now, and it was a STEP — which is the single
   * jumpiest thing measurement found in this whole system.** `punchT` was set
   * to 1 on the frame the trigger broke and fell from there, so every term it
   * scales arrived WHOLE in one frame: measured in the client, the field of
   * view opened 1.2 degrees between two frames on every round, against a 95th
   * percentile of 0.19 for every other frame in the string. That is not a
   * snap, it is a cut, and at 8-13 rounds a second it is a cut repeated eight
   * to thirteen times a second. `punchRise`/`punchFall` are a two-pole impulse
   * response instead — `CameraSystem` normalises it so one round still peaks
   * at exactly the same amplitude — which puts the peak 46 ms after the shot,
   * the same moment the aim's own kick and the roll beat below reach theirs.
   * **One event should arrive once**: three terms peaking at three different
   * times were three events as far as the eye is concerned.
   *
   * It also ACCUMULATES rather than restarting, which a decaying timer cannot:
   * a round landing on a punch that has not faded adds to it, where `punchT =
   * 1` threw the remainder away. Restarting is invisible from a step and
   * glaring from a shape — the envelope would drop to zero on the frame of
   * every round, which is the same cut inverted.
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
  // The two must not be EQUAL: both the normaliser and the step divide by
  // their difference, and a pair set the same would take the field of view to
  // NaN on the first shot of the round. Anywhere from two to four times apart
  // is the shape this wants; at 3x the peak is 46 ms out.
  punchRise: 0.028,
  punchFall: 0.085,
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
   * `punchRise`/`punchFall` for everything, because a shock is a SNAP and what takes a
   * second to fade is `shake`.
   */
  punchCompress: 0.5,
  fovPunch: 0.025,
  camPush: 0.035,
  shakePitch: 0.007,
  /**
   * The punch's own sideways nudge — RENDERED only, so no round and no bot
   * ever sees it, and it is deliberately smaller than the pitch beside it.
   *
   * **0.0035 rather than 0.006, because it is the last thing in the picture
   * that throws the view sideways and comes straight back.** It was sized
   * against an aim whose own lateral swung four times further; with
   * `yawPerShot` cut to leave the WALK and not the swing, a cosmetic of the
   * old size would simply have become the swing, with the added insult of
   * being one no bullet agrees with. `shakePitch` is untouched: a gunshot
   * spends none of it (`punchLift` is 0) and a blast still wants all of it.
   */
  shakeYaw: 0.0035,
  /**
   * How much of `shakePitch` a GUNSHOT's punch lifts the view by — the blast
   * that shares `addPunch` lifts by all of it.
   *
   * **Zero, because the aim's own kick already IS the whole lift, measured.**
   * `settle` and `pattern` are fitted against what the reference's picture
   * does per round — a rise to the top at ~60 ms, and ~0.3 deg of it through a
   * held string — and that footage is the rendered view, so it has no second
   * term to add. The punch's nudge landed on top as a STEP: the full 0.24-0.40
   * deg on the frame the trigger broke, then 90 ms of fall. Through a held
   * string that put every round's peak on its first frame instead of at 60
   * ms, doubled the per-round travel, and made the dominant motion of each
   * cycle the view SINKING while the aim was still rising — the other half of
   * what a player described as downward recoil. The FOV spike, the shove, the
   * yaw nudge and the roll are untouched, and a grenade still snaps the head.
   */
  punchLift: 0,
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
