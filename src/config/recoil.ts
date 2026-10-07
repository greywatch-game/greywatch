/**
 * config/recoil.ts — What a shot does to the aim, and the shape a string of
 * them walks in.
 *
 * Its own subsystem rather than a corner of the weapon table: a weapon
 * contributes two multipliers (`recoilMult`, the muzzle rise, and
 * `recoilImpulse`, the shove) and one bias (`yawBias`), and everything here —
 * the per-shot kick, the first-shot multiplier, the pattern envelope, the two
 * recovery fractions, the stance multipliers, and the constants of the settle
 * and the kick — is about the ACT of firing rather than about any one gun.
 *
 * **The two weapon multipliers are the thing to understand before changing
 * anything here.** Muzzle rise is a MOMENT, and the shove is the CARTRIDGE. The
 * shove buys no angle: `settle` spends it on how long the sight takes to come
 * back, `shake` on how long the shooter takes to re-settle, `punchCompress` on
 * how hard the frame is hit and `kick.compress` on how far the weapon travels
 * on screen. **Nothing driven by the impulse may ever reach `pitchPerShot`.**
 *
 * `docs/weapons.md` ("Recoil has a shape, and the shape is learnable") holds
 * the argument for every block below, the reference footage each fitted number
 * was taken from, and what was tried first. The comments here say what a field
 * does and what it was measured against.
 *
 * **Two figures are DERIVED**: the rifle's permanent walk over its 24-round
 * magazine from the hip, **0.70 deg of climb** (`pitchPerShot * (1 -
 * recoverFraction) * 15.25`) and **0.15 deg of drift** (`yawPerShot * (1 -
 * yawRecoverFraction) * yawBias * 15.25`), 15.25 being the envelope summed over
 * the magazine (see `pattern`). Re-derive both rather than assuming they
 * followed whenever `pattern`, `pitchPerShot`, `yawPerShot`, `firstShotMult` or
 * either recovery fraction moves.
 */
/**
 * Recoil. Every shot kicks the aim up and slightly sideways and blooms the
 * spread; both settle back on their own between bursts, so tapping stays
 * accurate while holding the trigger walks the shots off target.
 */
export const recoil = {
  /**
   * Aim kick per shot (radians): upward, and sideways about the weapon's
   * `yawBias`. Both are the value on the round that OPENS a string, before
   * `firstShotMult`; `pattern` tapers both across the rounds that follow, so
   * neither is what any particular shot actually kicks.
   *
   * `pitchPerShot` is fitted to the reference's isolated peak (0.735 deg at
   * 58 ms). `yawPerShot` is a PRODUCT decision taken against the footage,
   * which is the one place in this file the footage lost: the fit was 0.0109,
   * which reproduced the reference's 0.40 deg of lateral pull and read in play
   * as the reticle being thrown sideways and hauled back. **It moves as a PAIR
   * with `yawRecoverFraction`**: their product is what a round permanently
   * costs, and 0.005 at 0.905 holds that within 4% of the fit's while the
   * swing that comes back fell from 0.67 to 0.20 deg aimed and from 1.71 to
   * 1.00 at the hip, measured.
   */
  pitchPerShot: 0.0192,
  yawPerShot: 0.005,
  /**
   * What the FIRST round of a string kicks, as a multiple of the rest — the
   * punch that makes a tap distinct from a held trigger, which is the entire
   * reason to tap. Set against the reference's opening round, 1.3x the mean of
   * rounds 2-4 of a 28-round string.
   *
   * It applies only where the SELECTED FIRE MODE has a string
   * (`recoilVector.hasString`, `!semiAuto || burst > 1`). The DMR, the bolt
   * gun, the pistol and a rifle switched to `semi` are strings of one, where
   * every shot would be a first shot and their `recoilMult` already carries
   * the punch.
   */
  firstShotMult: 1.25,
  /**
   * Seconds without firing before the string resets and the next round is a
   * first one again. Longer than any automatic's gap (the LMG's is 0.1 s) and
   * shorter than the carbine's `burstCycle` of 0.4, so every burst opens with
   * the punch. The DMR's 0.286 s at full rate sits inside it, which is why a
   * string of one is excluded rather than left to collect the taper.
   */
  stringResetTime: 0.35,
  /**
   * The SHAPE of a string: ONE envelope over the shot counter
   * (`Player.stringShots`), spent on BOTH axes, so **a string changes how HARD
   * a weapon kicks and never which WAY** — the direction is the weapon's
   * `yawBias`. A muzzle climbs hardest at the start and then binds, so the
   * envelope runs from 1 on the opening round down to `pitchSettled` at
   * `patternShots` and holds there.
   *
   * Summed for the rifle's 24 rounds from the hip (`recoilMult` 1): 1.25 on
   * round one, 5.2 over rounds 2-8 and 0.55 a round after that, **15.25** on
   * both axes. That is the factor in the header's walk figures. Measured per
   * round in the client, the aimed rifle's kick holds 3-6 deg off vertical
   * across a magazine with no trend and no cycle.
   */
  pattern: {
    /**
     * Rounds over which the envelope travels from its opening value to its
     * settled one — a third of the rifle's magazine, so the shape is legible
     * inside one burst. Set where the reference's own climb stops: its
     * per-round step is gone by round 8-10 and flat for the eighteen after.
     */
    patternShots: 8,
    /**
     * What the kick falls to once the muzzle has bound: the reference's
     * per-round kick through a held string, where every round of its plateau
     * lifts the aim ~0.31 deg and gives ~0.25 back before the next. Grid-fitted
     * with `patternShots` and `settle.reachAds` against its floor through all
     * 28 rounds. **It is not what makes a string plateau** — `settle.reachAds`
     * is.
     */
    pitchSettled: 0.55,
    /**
     * Rounds in one full lateral SWEEP. `Player.kickDrift`, the signed lateral
     * the aim kick, the model's lean and the view punch are all built from, is
     * a sine over the string counter with its direction drawn once per string
     * — not an independent draw per round, which on an automatic's eight to
     * thirteen rounds a second reads as an aim jumping rather than walking.
     * At seventeen a burst of six to ten rounds is most of one way, so the
     * lateral is something to re-aim against rather than wait out.
     */
    sweepShots: 17,
    /**
     * How much of each round's lateral is fresh noise rather than the sweep.
     * Half and half keeps what is left of a narrow sweep from reading as a
     * cycle.
     */
    sweepNoise: 0.5,
    /**
     * How far the sweep and its noise may carry a round off the weapon's
     * `yawBias` — the SPREAD of the lateral, where the bias is its centre.
     * A span is also an ANGLE, the lateral being the short side of the kick
     * vector, so at 0.15 the rifle's rounds run 0.20..0.50 about its 0.35:
     * every round pulls the weapon's way, and the spread is texture on how
     * hard. The total is clamped to -1..+1, so every ceiling documented for
     * `maxYaw` survives whatever a weapon states for a bias.
     */
    sweepSpan: 0.15,
  },
  /** Multiplier while fully aimed down sights — a braced stance kicks less. */
  adsMult: 0.55,
  /**
   * The rest of the stance, on the same footing as `adsMult` and blended the
   * same way: recoil is absorbed by a body braced against it, and a body that
   * is walking or in the air is not braced. Crouching also buys a tighter
   * group (`player.crouchSpreadMult`) and a steadier hold
   * (`camera.aimSway.crouchMult`). `airMult` is the harshest because a jump is
   * the one stance a player chooses freely and there is nothing under it.
   */
  crouchMult: 0.8,
  moveMult: 1.25,
  airMult: 1.5,
  /**
   * Fraction of each VERTICAL kick that comes back on its own. The remainder
   * goes into the player's own aim and stays, so a held magazine walks the
   * muzzle off target and has to be pulled back by hand. At 1.0 recoil is
   * decoration.
   *
   * Measured against the reference, where an isolated round is ~90% recovered
   * 300 ms later; 0.958 holds the rifle's climb at the header's 0.70 deg under
   * the plateau `pattern.pitchSettled` gives. **If the rifle proves too easy
   * to hold, this is the first number to move back** — it is worth about
   * eight times as much of the walk as anything in `pattern`.
   *
   * The permanent share is HANDED OVER at the haul's rate
   * (`CameraSystem.owedPitch`) rather than applied at the shot, which changes
   * when it arrives and never how much.
   */
  recoverFraction: 0.958,
  /**
   * The same fraction for the HORIZONTAL. A shooter braces against a climb
   * they knew about before the trigger broke, but a lateral is not known until
   * it has happened, and what a shooter does about it is re-aim — so more of
   * it is AIM and less is spring, and at 0.905 nine and a half percent of every
   * round's horizontal stays. **It moves as a PAIR with `yawPerShot`**:
   * `yawPerShot * (1 - this)` is what a round permanently costs.
   */
  yawRecoverFraction: 0.905,
  /**
   * The SETTLE: how the aim comes back, and the one place a weapon's IMPULSE
   * (as against its muzzle rise) buys anything.
   *
   * **It is not a spring.** The charge throws the gun, the grip ARRESTS it,
   * and the shooter HAULS it back at a rate: a flattening rise, a CORNER where
   * the motion changes cause, and a straight descent. `core/recoilCurve.ts`
   * is the model. Aimed and hip are two sets of constants rather than one at
   * two amplitudes, because a three-point lock and a weapon on two arms are
   * different mechanical systems, and **the stance changes the TIMING**.
   */
  settle: {
    /**
     * How fast the grip arrests the rotation (1/s), braced and unbraced. The
     * rise's time constant is its reciprocal, and `riseTurns` of it is the
     * shooter's REACTION before the haul begins: **59 ms aimed and 79 ms at the
     * hip** on the reference weapon. An isolated rifle round (a first shot, so
     * `firstShotMult` included) peaks at 65 and 90 ms and is back to a tenth
     * of its peak about 270 and 440 ms after that.
     *
     * The aimed pair is MEASURED: the reference's muzzle tops out 58 ms after
     * the shot and is half home 160 ms after that. The footage is all ADS, so
     * the hip pair is SET, against two constraints:
     *
     * - **The reaction must fit inside an automatic's cycle**, or the haul
     *   never engages through a held trigger and the string piles up
     *   unopposed. At 34 it is 79 ms against the rifle's 106, 78 against the
     *   LMG's 100 and 60 against the SMG's 77. **Check it against the fastest
     *   automatic whenever `gripHip`, `riseTurns` or `massExp` moves**; the
     *   carbine's burst is exempt, three rounds in 0.1 s being meant to climb
     *   as one motion.
     * - **The haul has to pay for `adsMult`** — see `haulAds`.
     *
     * Both are set against the FRAME as well as the gun: an excursion that
     * completes in under ~5 samples at 60 Hz reads as a dropped frame rather
     * than as motion, and these are well clear of it.
     */
    gripAds: 45.5,
    gripHip: 34,
    /**
     * How fast the shooter hauls it back, in REFERENCE KICKS (`pitchPerShot`)
     * per second. A rate rather than a proportion, so a bigger excursion takes
     * proportionally longer to come home — which is why the bolt gun's return
     * is slower than the SMG's without either of them saying so. `haulHip` is
     * ABOVE `haulAds` because a hip kick is already 1/`adsMult` the size of an
     * aimed one and takes that much longer at the same rate; a slower hip haul
     * would charge it for the size of its kick twice.
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
     * rate multiplied by how many of these the muzzle is off — **only in a
     * string**, letting go once the muzzle is back inside this. A pure rate
     * gives a held trigger no level to settle at (`RecoilShape.reach`), so this
     * is what makes every string plateau. **A lone round, a tap and a flinch
     * never lean**, so each keeps the measured single-round shape and a
     * grenade's flinch is still two seconds.
     *
     * The aimed 0.8 (0.88 deg) is grid-fitted with `pattern` against the
     * reference's floor through a 28-round string; **re-fit it against the
     * footage, not by feel**, if `pattern`, `haulAds` or `gripAds` moves. The
     * hip's 0.6 is set: the hip reaction eats 79 ms of the rifle's 106, leaving
     * far less haul per round to lean with, and at 0.6 a hip string levels at
     * about twice the aimed one (~4.9 deg on the rifle, measured).
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
   * The post-shot UNSTEADINESS. A shot moves the sight (`settle`, over a few
   * hundred milliseconds), and it also disturbs the POSITION the shooter was
   * holding it in, which takes far longer to come back — the cost of a heavy
   * round, for which muzzle rise must not stand in.
   *
   * **Spent on the hold sway rather than as an offset of its own**, so it
   * cannot make the reticle lie: a shot WIDENS the wander (`swayGain`) and
   * QUICKENS it (`rateGain`), and both fade back into the figure-eight the sway
   * already draws. It rides `swayW`, so aiming and crouching steady the
   * disturbance exactly as they steady the hold, and hip fire pays none of it
   * (hip fire is charged in bloom instead).
   *
   * **A STRING disturbs the hold ONCE, on its opening round**
   * (`AimKick.opensString`), and the rounds behind it are the recoil's to
   * charge. A string of one — the DMR, the pistol, the bolt gun — pays on every
   * round. Raised by every round, a held automatic piled it up into a sway that
   * swung the aim downward mid-string, which is recoil going the wrong way.
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
     * (`settle * impulse^settleExp`). A true exponential, because it is on the
     * hold sway and the hold sway is on the aim.
     *
     * **A heavy round disturbs for LONGER, not merely more.** The SMG's is gone
     * in a third of a second and the bolt gun's takes 1.08, so the bolt gun's
     * single round opens the hold to 2.1x for about a second, which is what a
     * shooter means by needing to re-settle.
     */
    settle: 0.5,
    settleExp: 0.6,
    /** How much of it widens the wander, and how much quickens it. */
    swayGain: 1,
    rateGain: 1.6,
  },
  /**
   * Ceilings on the springy part of the two recoil AXES, so neither sustained
   * fire nor a crossfire's flinches can walk the aim off the screen.
   *
   * **Neither binds on any weapon in the kit**: measured through held triggers
   * in the client, the worst springy lateral is 1.0 deg at the hip and 0.20
   * aimed against `maxYaw`'s 5.16, and a sustained string holds at 2.4 deg
   * aimed and 5.0 at the hip against `maxPitch`'s 9.7, the haul's lean doing
   * the bounding first.
   *
   * They stay for `addFlinch`, which queues onto the same two axes: a grenade
   * survived at 90 damage asks for 0.099 rad on its own
   * (`player.flinchPitchPerDamage`) and several hits close together must not
   * stack off the screen. **Do not size `maxPitch` to the rifle's climb**: it
   * would silently clamp a blast's flinch to a fifth of what it is worth, and
   * the failure would show up in grenades rather than anywhere near this file.
   */
  maxPitch: 0.17,
  maxYaw: 0.09,
  /**
   * Spread bloom: added per shot, its ceiling, and its bleed-off per second.
   * The bleed-off has to be well under `bloomPerShot * fireRate` (0.057/s on
   * the rifle) or holding the trigger never actually blooms.
   */
  bloomPerShot: 0.006,
  maxBloom: 0.03,
  bloomRecovery: 0.02,
  /**
   * The weapon on screen: the same ARREST-AND-HAUL model as `settle`
   * (`core/recoilCurve.ts`) at its own constants, because the gun in your
   * hands and the sight on your target are one object and cannot move on two
   * different laws. A shot gives it VELOCITY, so a round arriving on a weapon
   * still coming home ADDS to what is there — which is why a held trigger
   * reads as a weapon that never quite settles. Stepped exactly at any frame
   * rate: the arrest in closed form, the haul as a rate.
   *
   * `Player` owns the motion and `ViewModel` reads it, the same split as the
   * bob phase and the landing dip, and for the same reason: two integrators on
   * one impact drift apart.
   */
  kick: {
    /**
     * How fast the grip arrests the WEAPON (1/s), braced and unbraced. Stiffer
     * than `settle`'s, because it is a shorter lever: a receiver in two hands
     * rather than an upper body rotating.
     *
     * **Set against the FRAME.** Measured in the client: **39 ms to the top
     * aimed and 56 at the hip, whole excursions of 101 and 145 ms** — two and
     * a half to three and a half frames of attack at 60 Hz, six to nine of
     * travel. **Do not take them back up to buy a snappier weapon**: what a
     * snappier weapon buys at this rate is a frame the eye reads as dropped.
     */
    gripAds: 56,
    grip: 40,
    /**
     * How fast it is driven home, in KICK UNITS per second (1 being one
     * round's peak). Nothing scales these by the weapon: `compress` below
     * already makes a heavy gun travel further, and a rate against a longer
     * travel is a longer return for free. Slow for the frame's sake as the
     * arrest is, which costs nothing in stacking because `stackCap` is a wall.
     */
    haulAds: 17,
    haul: 12,
    /** As `settle.riseTurns` and `settle.easeBand`, in this model's units. */
    riseTurns: 2.6,
    /** As `settle.haulRamp`. */
    haulRamp: 0.35,
    easeBand: 0.1,
    /**
     * The ACTION: the carrier stopping at the back of its travel and then
     * slamming into battery, two beats per round after the shot. It is what
     * makes a self-loader read as a MACHINE; one smooth excursion per round,
     * however sharp its attack, is a catapult.
     *
     * **On the WEAPON and the frame, never on the aim**: what the carrier costs
     * is visible and not aimable, so on `aimPitch` it would be jitter on where
     * the bullets go. `impulse` in `core/math.ts` is the shape. **A bolt gun
     * states `boltCycle` and is exempt** — its action is worked by a hand, and
     * `CONFIG.viewmodel.cycle` already plays it as a gesture.
     */
    action: {
      /**
       * Seconds after the shot the carrier stops at the back of its travel,
       * and seconds after it that it slams back into battery. **LEGIBLE rather
       * than literal**: a real carrier's ~10 and ~35 ms put two
       * opposite-signed peaks 1.7 samples apart at 60 Hz, which aliases into
       * jitter. **A mechanism the frame cannot resolve is noise.**
       */
      back: 0.034,
      home: 0.088,
      /** Seconds each of those impacts dies away over. */
      fall: 0.058,
      /**
       * …and seconds each takes to ARRIVE. `impulse` is all attack, and two
       * instantaneous jumps a round at eight to thirteen rounds a second is a
       * rattle laid over the kick rather than a mechanism inside it. 32 ms is
       * about two frames: a move rather than a jump, and short of a swell.
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
       * What is left of it while fully aimed. **Not zero**: a rifle in a
       * three-point lock still buzzes, and the buzz is most of what tells you
       * the thing in your hands is a gas gun. A fraction, because a braced
       * mount absorbs most of it and the weapon carries the sight.
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
     * What is left of the OFF-AXIS terms while fully aimed; the z travel is
     * exempt and stays at full. **It moves as a PAIR with `kickPitch`**: their
     * product (0.035 rad) is what an aimed weapon takes, and the bare
     * `kickPitch` is what hip fire takes.
     *
     * Geometry, not taste. The weapon carries the sight, so anything that
     * rotates or laterally shifts the model while aimed takes the RETICLE off
     * the axis the rounds fly down. Travel along z moves the sight toward the
     * eye and leaves the picture centred, which is also what a braced shoulder
     * does with a rifle.
     */
    adsMult: 0.16,
    /**
     * The closest the fitted sight may come to the camera while the weapon is
     * travelling, in metres. **A floor under the near plane, not a look.**
     *
     * The kick's travel is toward the eye and an aimed sight is already only
     * centimetres from it, so on a magnified optic the two collide. `ViewModel`
     * scales the aimed travel down to fit `sightDist - this` rather than
     * clamping at it, so the kick keeps its shape and only loses amplitude.
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
     * `kickWeight`). A wall rather than a measured peak, so the travel
     * `adsClearance` is derived against is the biggest a string makes and is
     * exact. Without it a held SMG at the hip reached 3.03x one round's travel,
     * 13.3 cm of receiver toward the eye.
     *
     * 1.6 leaves a round and a half of travel: the rifle's held plateau
     * sawtooths between 3.7 and 5.8 cm, still a weapon working and not a pose.
     * **A multiple of the WEAPON's own travel and not an absolute**, or it
     * clips the bolt gun's single shot (2.16 kick units), which is no string.
     */
    stackCap: 1.6,
  },
  /**
   * How far the weapon travels back along the bore, in metres at a
   * displacement of 1 (one round's peak) — in the CAMERA's frame, like every
   * other viewmodel offset, so it takes the zoom compensation with the rest of
   * the pose. Small on purpose: **a mounted rifle barely translates**, because
   * the shoulder stops it, and it ROTATES about that mount instead, which is
   * `kickPitch` and `kickLift`.
   *
   * The lateral three all take the shot's own `kickDrift` — the same signed
   * number `yawBias` shapes and the aim kick is built from — so what the model
   * does and what the muzzle does are one motion rather than two.
   */
  kickBack: 0.036,
  /**
   * How far the weapon RISES on the same travel, in metres at a displacement
   * of 1 — the receiver climbing as the muzzle tips about a mount behind it.
   * Stated on its own rather than as a share of `kickBack`, which is a shoulder
   * compressing and nothing to do with it.
   *
   * It rides the off-axis damping like the rotations rather than the z travel,
   * because lifting the model while aimed lifts the SIGHT off the axis the
   * rounds fly down. So it is hip fire's, which is where there is no reticle
   * to lie.
   */
  kickLift: 0.018,
  /**
   * The muzzle FLIP on the model, and the biggest single lever there is on
   * whether a gun reads as being fired. **Spend recoil's visual budget here,
   * not on the aim**: at the hip there is no sight on the eye and nothing drawn
   * that the muzzle could be seen to disagree with, so 0.22 rad (12.6 deg) is
   * free and most of what you see, while `kick.adsMult` takes the aimed
   * picture down to 0.035 rad. Move the two as a pair.
   */
  kickPitch: 0.22,
  kickSide: 0.035,
  /**
   * The cant. `rot.z` is SUBTRACTED against the drift, because a positive roll
   * takes the weapon's right flank UP (see `viewmodel.reload.styles`) and a weapon
   * walking right should lean into the direction it is going, not away from it.
   * Flip this with that convention if it is ever flipped.
   */
  kickRoll: 0.09,
  kickYaw: 0.018,
  /**
   * The cosmetic view punch per shot: an FOV spike, a backward camera shove,
   * and a directed nudge on pitch and yaw. NOT part of aimPitch/aimYaw:
   * bullets, bots, the aim assist and the motion blur never see it. Because it
   * comes and goes inside the time the aim kick is still rising, it is also
   * what lets the VIEW snap harder than the AIM does.
   *
   * It RISES and FALLS on `punchRise`/`punchFall`, a two-pole impulse
   * `CameraSystem` normalises so one round peaks at exactly these amplitudes,
   * 46 ms after the shot — within a dozen milliseconds of the roll beat and of
   * each round's own peak through a string. **One event should arrive
   * once.** It ACCUMULATES rather than restarting, and its angles are ONE
   * direction drawn per shot and held (`CameraSystem.addPunch`), never noise
   * re-rolled per frame.
   * `docs/weapons.md` has the measurement each of those answers.
   *
   * The ROLL is `rollBeat` and opposes the weapon's `kickRoll` on purpose:
   * opposed, the weapon reads as twisting in the hands; matched, the two
   * cancel and the whole picture tips instead.
   */
  // The two must not be EQUAL: both the normaliser and the step divide by
  // their difference, and a pair set the same would take the field of view to
  // NaN on the first shot of the round. Anywhere from two to four times apart
  // is the shape this wants; at 3x the peak is 46 ms out.
  punchRise: 0.028,
  punchFall: 0.085,
  /**
   * How much of the weapon's `recoilImpulse` reaches the punch, as an
   * exponent. **The punch is where the SHOCK is drawn**, so a bolt gun and a
   * submachine gun must not shake the frame alike.
   *
   * Compressed for the reason `kick.compress` is: at 0.5 the five terms below
   * span 0.71x on the SMG to 1.90x on the bolt gun. AMPLITUDE only — how long
   * it lasts is `punchRise`/`punchFall` for everything, because a shock is a
   * SNAP and what takes a second to fade is `shake`.
   */
  punchCompress: 0.5,
  fovPunch: 0.025,
  camPush: 0.035,
  shakePitch: 0.007,
  shakeYaw: 0.006,
  /**
   * How much of `shakePitch` a GUNSHOT's punch lifts the view by — a blast,
   * which shares `addPunch`, lifts by all of it.
   *
   * **Zero, because the aim's own kick already IS the whole lift.** `settle`
   * and `pattern` are fitted to the reference's RENDERED view, so a nudge on
   * top was a second copy of it, and it landed as a step: every round of a
   * string peaked on its first frame and then sank while the aim under it was
   * still rising.
   */
  punchLift: 0,
  /**
   * `punchLift`'s twin for `shakeYaw`. **Zero, and read the two together:
   * a GUNSHOT'S PUNCH HAS NO DIRECTION.** Every angle in a round is already
   * stated where the bullets can see it — the climb in `pitchPerShot`, the
   * pull in `yawPerShot` and `yawBias`, the twist in `rollBeat`'s fixed torque
   * — so a cosmetic angle on top can only disagree with one of them. With a
   * share here the punch's yaw peaked at 0.201 deg against the aim's own 0.035
   * of lateral, and the 45-degree diagonal players saw was that. What still
   * sells a shot is the FOV, the shove and the roll.
   *
   * **A BLAST keeps all of it**, which is why this is per-event like
   * `punchLift` rather than a smaller `shakeYaw`: a grenade HAS a bearing, and
   * throwing the view off it is the whole point.
   */
  punchSwing: 0,
  /**
   * The camera's ROLL after a shot: the weapon twisting in the hands, as two
   * opposite-signed beats on one clock — `core/math.ts`'s `impulse`, the idiom
   * `kick.action` uses one layer down.
   *
   * **A fixed torque, not a roll drawn against the round's drift.** A rifle's
   * bore sits above and off the axis of the shoulder pocket, so every round
   * twists it the same way, and a roll drawn against a random number is camera
   * shake wearing a gun's clothes.
   *
   * Measured off 240 fps reference footage (`docs/weapons.md`), by tracking
   * the left and right thirds of the frame separately — what roll IS, to a
   * camera, is the two sides moving vertically against each other. Nine shots
   * across two clips, all the same sign, against a noise floor of 0.001 deg.
   *
   * **`amp` carries the SIGN**, and flipping the twist is negating it and
   * nothing else. It is scaled by the punch's `shock` like every other term,
   * so what a weapon rolls follows its `recoilImpulse`.
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
