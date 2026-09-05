/**
 * config/weapons.ts — the round, and what differs between the guns.
 * Owns: the weapon table (its keys ARE `WeaponId`), the head zone (`combat`),
 * recoil, and the gunfeel dressing. Contract: `docs/weapons.md`.
 * Gotcha: every round in the game is hitscan through the same
 * `CombatSystem.fire`; a weapon's `recoilMult`/`recoilImpulse`/`bloomMult`/
 * `yawBias` SCALE `recoil` rather than restating it.
 * Gotcha: `recoilMult` and `recoilImpulse` are two different quantities and
 * were one field until the DMR and the bolt gun forced them apart. The first
 * is the MOMENT (how far the muzzle tips) and reaches `pitchPerShot` and
 * nothing else; the second is the SHOVE (how hard it arrives) and reaches the
 * settle spring, the post-shot unsteadiness, the view punch and the
 * viewmodel's own travel — never an angle.
 * Gotcha: a weapon's `report` is DEVIATIONS from the reference gunshot, which
 * `Sfx.shoot` owns and the rifle's all-ones row IS; nothing here is an
 * absolute level.
 * Gotcha: `damage` is what a round does CLOSE. Every time-to-kill quoted in
 * this file is the close one — `damageFar` and the two fall-off distances are
 * the rest of the weapon, and on the carbine they decide a 5x cliff whose
 * position has to be re-derived rather than assumed.
 */

/**
 * The weapons the player can carry, and everything that differs between
 * them. The keys ARE the weapon ids — `WeaponId` in `entities/weapons.ts`
 * is derived from this table, so adding a weapon here and a model builder
 * beside `RifleModel` is the whole job.
 *
 * They all fire the same hitscan round through the same `CombatSystem.fire`,
 * and each takes any of the optics below — an optic is bolted to a rail and
 * every weapon here has one. What separates them is the trade this table
 * spells out: the rifle hits hard enough to kill in four and holds a line
 * across the valley, the SMG empties a bigger magazine half again as fast and
 * cannot be trusted past the far side of a street, the DMR kills in two and
 * gives you one trigger pull at a time to do it with, the carbine spends three
 * rounds on every pull whether or not it needed them, the LMG is the one that
 * does not have to stop, and the sniper kills in ONE and then takes the sight
 * picture away for a second and a quarter while you find out whether it did.
 *
 * **Every time-to-kill quoted below is the CLOSE one**, and that is a change
 * of meaning rather than a caveat. `damage` is what a round does at or inside
 * `falloffNear`; past `falloffFar` it does `damageFar`, and between the two it
 * lerps. So a weapon is no longer one number and a cliff at `range` — it is a
 * shape, and the shape is where the choice between these five actually lives.
 * `range` is unchanged and still the hard reach; the ramp sits well inside it,
 * because a round that has stopped hurting is a more interesting fact than a
 * round that has stopped existing.
 *
 * Read down the `damageFar` column and the kit says something it could not say
 * before: the DMR and the sniper are exempt, the LMG loses damage per second
 * and never a round, the carbine's burst stops being a kill at a stated
 * distance, and the SMG falls off hardest and earliest. Three of those are
 * rewards and two are bills, which is the same balance the close figures
 * strike. The two exemptions are not the same exemption: on the DMR it is a
 * reward the weapon's rate and recoil have paid for, and on the sniper it is
 * the definition — a rifle that stopped killing in one at range would have
 * nothing left that the cycle was worth paying for.
 *
 * The time to kill is deliberately close for the three automatics (rifle 4
 * rounds at 8/s = 0.375 s, SMG 6 at 13/s = 0.385 s, LMG 5 at 10/s = 0.4 s).
 * What you are choosing between them is not damage per second — the rifle and
 * the LMG deliver the identical 240 — it is how much of the screen a burst
 * covers, how far away it still means anything, and how long you may keep
 * firing it. The other three step outside that at three different ends: the
 * DMR is 2 rounds at 3/s = 0.333 s, faster than any of them, and it pays for
 * it with the error budget — a missed rifle round costs 0.125 s and a missed
 * DMR round costs 0.333; the carbine's three rounds leave in 0.1 s and cost
 * 0.4 s of nothing at all afterwards; and the sniper's single round is 0 s,
 * which is not a time to kill at all — the whole of that weapon is what a MISS
 * costs, and a missed one is 1.25 s during which you cannot see the man you
 * missed.
 *
 * `semiAuto` and `burst` are two different questions and the carbine is what
 * proves it: `semiAuto` asks whether the trigger has to come UP between pulls
 * and `burst` asks what one pull SPENDS. Every weapon here but the carbine
 * answers only the first; the carbine answers both, and nothing here answers
 * `burst` without also answering `semiAuto`, because a burst weapon that fired
 * on a held trigger would be an automatic with a stutter. `boltCycle` is a
 * THIRD question over the same trigger and is asked of the frame rather than
 * of the rules — see the field on the rifle.
 *
 * `recoilMult`, `recoilImpulse` and `bloomMult` SCALE `CONFIG.recoil` rather
 * than restating it: the shape of recoil — how much springs back, how fast,
 * where it is capped — belongs to the game, not to the weapon. Bloom is
 * multiplied at its ceiling too, or a weapon that blooms faster would pay
 * nothing for it after the second shot.
 *
 * **The two recoil multipliers are the one place this table describes the same
 * event twice on purpose, and reading them as a PAIR is how the kit is meant
 * to be read.** Muzzle rise is a moment arm — recoil runs along the bore and
 * the hands hold the weapon below it — so it is decided by the shape of the
 * gun; the shove is decided by the cartridge. They are not correlated and in
 * this table they are frequently inverted: the pistol flips at 1.15 on a
 * shove of 0.55, the LMG shoves 0.9 and flips 0.7, and the bolt gun is the
 * only entry where both are the largest number in the column. A weapon added
 * here that sets one of them from the other has not said anything.
 */
export const weapons = {
  rifle: {
    name: "Assault Rifle",
    /** For the magazine caption, where the full name will not fit. */
    short: "Rifle",
    /** 30 per hit against 100 HP = 4 shots to kill. */
    damage: 30,
    /**
     * 22 = 5 shots to kill. The rifle is meant to hold a line across the
     * valley and still does; the fifth round is what that costs.
     */
    damageFar: 22,
    falloffNear: 25,
    falloffFar: 70,
    /**
     * Rounds per second. 9.43 is 566 rpm, matched to the reference footage
     * `docs/weapons.md` records: 106 ms between rounds, measured off the shot
     * onsets of a 240 fps capture and steady to within 1 ms across 28 rounds.
     *
     * **It carries an 18% DPS rise with it** (240 to 283 at `damageNear`) and
     * `damage` was deliberately NOT dropped to pay for it — the cadence was
     * matched on purpose and the damage is a separate decision.
     */
    fireRate: 9.43,
    /**
     * Whether the trigger has to be released between pulls. Held fire is
     * the default; see `Player.tryShot`, which owns the latch.
     */
    semiAuto: false,
    /**
     * Rounds one trigger pull spends. 1 is a weapon that fires a round when
     * it is asked to, which is everything here but the carbine — see the
     * table's header for why this is a separate question from `semiAuto`.
     *
     * Above 1 the rounds leave at `fireRate` and the trigger has no say once
     * the first is gone: a burst finishes itself, which is the whole point of
     * one, and `Player.burstLeft` is where that is remembered.
     */
    burst: 1,
    /**
     * Seconds from a burst's LAST round to the earliest next one — the
     * weapon's own dwell, not the finger's. Read only when `burst` > 1, where
     * it replaces `shotInterval` at the end of the burst and is the entire
     * cost of the mode.
     */
    burstCycle: 0,
    /**
     * Whether this weapon's fire cooldown is a GESTURE — a bolt worked by hand
     * between rounds, rather than an action that cycles itself.
     *
     * **It declares nothing about the numbers and everything about the frame.**
     * `shotInterval` already stops the trigger; what this says is that the wait
     * is something the shooter DOES, so `ViewModel` plays `CONFIG.viewmodel
     * .cycle` over it, the handle travels, and the sight picture is taken away
     * and given back. That last part is the whole cost of a bolt gun and the
     * reason this is not simply a low `fireRate`: a weapon that kept its scope
     * on the target through the cycle would be a slow DMR, and what a
     * bolt-action actually trades is knowing where your target went.
     *
     * Read exactly as `equipment.muzzleLoad` is and for the same reason — both
     * AT items run a cooldown and only one of them is a gesture. See
     * `Player.cycleProgress`, which is this clock read as a phase.
     */
    boltCycle: false,
    magSize: 24,
    reloadTime: 1.4,
    /** Bullet spread half-angle (radians). */
    spreadHip: 0.045,
    spreadAds: 0.006,
    range: 120,
    /**
     * Scales `recoil.pitchPerShot`/`yawPerShot` — how far the MUZZLE RISES,
     * and nothing else. **The reference, and the whole of what this field
     * means since `recoilImpulse` was split out of it.**
     */
    recoilMult: 1,
    /**
     * How hard the shot SHOVES, as against how far it tips the muzzle. The
     * reference, at 1, exactly as `recoilMult` is.
     *
     * The two are genuinely different quantities and were one field until the
     * DMR and the bolt gun made it impossible to pretend otherwise. Muzzle
     * rise is a MOMENT: the recoil force runs along the bore and the shoulder
     * holds the weapon below it, so what tips the muzzle is that offset, and a
     * heavy rifle mounted properly tips remarkably little. What actually
     * doubles with the cartridge is the IMPULSE — the free recoil energy going
     * straight back into the shooter — and what that costs is not angle but
     * TIME and STEADINESS. See `recoil.settle`, `recoil.shake` and
     * `recoil.punchCompress`, which are the three things this drives; nothing
     * here reaches `pitchPerShot`.
     */
    recoilImpulse: 1,
    /**
     * Which way this weapon pulls, -1 (hard left) to +1 (hard right).
     *
     * The horizontal kick used to be symmetric noise, which meant every
     * weapon's spray was the same shape and NONE of it could be learned —
     * the only correct response to a random walk is to stop firing. A bias
     * makes the walk drift, so a burst has a direction you can pre-empt, and
     * the six weapons stop being one recoil pattern scaled six ways.
     *
     * It scales the noise rather than adding to it (`Player.tryShot` draws
     * `(rand * (1 - |bias|) + bias)` into `kickDrift`), so the total is still
     * bounded by `yawPerShot` and every ceiling documented for `maxYaw`
     * survives untouched. 0 is bit-for-bit the old behaviour.
     *
     * **The draw is made ONCE per round and read three times** — by the aim
     * (`recoilKick`), by the model's lean and roll (`recoil.kickSide`/
     * `kickRoll`/`kickYaw`) and by the view punch's direction. Drawing it again
     * anywhere would put the weapon leaning one way while the muzzle walked the
     * other, which is the one thing a bias exists to prevent.
     *
     * The rifle is the reference and gets the mildest real bias: a pattern
     * you notice over a magazine, not one you are fighting from round two.
     *
     * **The signs are paired, not scattered.** The rifle, the SMG and the
     * pistol pull right; the carbine and the LMG pull left. So a rifle with
     * the sidearm behind it is one hand to learn across the swap, and the
     * other family is a genuinely different weapon rather than the same one
     * at a different rate — which is the same thing the kit screen's stat
     * chart is trying to say, said in the hands instead.
     */
    yawBias: 0.35,
    /** Scales `recoil.bloomPerShot` AND `recoil.maxBloom`. */
    bloomMult: 1,
    /** Multiplies `camera.adsBlendSpeed` alongside the optic's own — a
     *  light weapon comes up faster whatever is bolted to it. */
    adsSpeedMult: 1,
    /**
     * Shifts the hip pose along the camera axis (m, before `viewmodel
     * .scale`). The authored pose in `viewmodel.hipPos` is framed for this
     * weapon's length, so a shorter one has to sit closer or it reads as
     * being held out at arm's length.
     */
    hipZ: 0,
    /**
     * And across it (m, before `viewmodel.scale`). The pose is authored
     * around the reference weapon's BORE, and every long gun here carries
     * most of its bulk above that line — a receiver, an optic, a stock — so
     * the frame is filled by what is over the axis. A pistol is the other
     * way up: almost all of it, and both hands with it, hang below the bore,
     * and at the shared height it falls off the bottom edge and reads as a
     * dark sliver in the corner rather than as something being held.
     */
    hipY: 0,
    /**
     * Not turned at all. Every gun here is framed by the shared
     * `viewmodel.hipRot`; the field exists for a weapon whose SHAPE the shared
     * pose cannot frame, which today is the launcher. See `WeaponSetup.hipYaw`.
     */
    hipYaw: 0,
    /**
     * Scales `camera.aimSway` — how steady this weapon is to hold. Mass and
     * where the hands sit, nothing else: a heavier weapon wanders less and
     * a light one carried high wanders more. The rifle is the reference.
     */
    swayMult: 1,
    /**
     * Seconds from the swap button to this weapon being usable — the whole
     * gesture, since the one being put away is gone by then (see
     * `viewmodel.swap.switchFrac`). It is the INCOMING weapon's number
     * because what the wait is actually about is getting this thing up and
     * on target: the sidearm's whole case is that its figure is the
     * smallest here.
     */
    drawTime: 0.55,
    /**
     * How this weapon is HEARD, as deviations from the reference report.
     *
     * `Sfx.shoot` owns the SHAPE — five layers in the order the ear resolves
     * them: the snap of the shock front, the body of the report, a low roll
     * under it, the chest thump, and the action cycling a beat later. What is
     * here is only what a different gun does to that shape, for the reason
     * `recoilMult` scales `CONFIG.recoil` rather than restating it: the
     * anatomy of a gunshot belongs to the game, and the charge, the barrel and
     * the mechanism belong to the weapon.
     *
     * **The rifle is the reference and every one of its numbers is 1**, which
     * is what makes the other five rows readable as statements about a weapon
     * rather than as absolute levels. A shooter with no weapon of its own —
     * every bot on the map fires one flat round off the same rig — is heard as
     * exactly this, so the identity voice and the bots' voice are one thing
     * rather than two that can drift.
     *
     * This replaced a single `sfxPitch`, and the six guns sounding alike was
     * that scalar's doing rather than a tuning failure: one multiplier over
     * every frequency can only make a big gun a small gun slowed down, and the
     * things that actually separate an SMG from a DMR — how much charge is
     * behind the round, how long the report rings, how hard it drives the
     * village, and how loud the mechanism is against it — had nowhere to be
     * said.
     *
     * - `pitch` — bore and charge, as a multiplier on every frequency in the
     *   report. The coarsest of the eight and the only one that used to exist.
     * - `level` — overall loudness. **Read this column against `fireRate`**:
     *   the SMG is quieter than the rifle because it arrives half again as
     *   often, and the DMR is louder because three a second can afford to be.
     *   It replaced a `1 / pitch` rule inside `Sfx.shoot` that tied the two
     *   together, and so could not say that a pistol is small AND quiet while
     *   a carbine is sharper than the rifle and nearly as loud.
     * - `snap` — the leading edge: the first seven milliseconds, all of it
     *   above 3.6 kHz. Barrel length and what is screwed to the end of it.
     *   This is the layer that reads as *violent* rather than as loud, and it
     *   is why the DMR is not merely the rifle an octave down.
     * - `weight` — how much charge is behind the round, scaling the low roll
     *   and the chest thump together. The heaviness knob, and the widest
     *   spread here: the DMR is four and a half times the SMG.
     * - `length` — how long the body, the roll and the thump ring on before
     *   the valley takes over. Bounded from below by the RATE: three carbine
     *   rounds leave in 0.1 s, so a long report would stack into one blur
     *   instead of a burst you can count.
     * - `tail` — how hard the shot drives the shared reverb. A big charge
     *   excites more of the village than a small one, and this is most of what
     *   separates a DMR heard across the valley from a rifle heard across it.
     * - `actionPitch` / `actionVol` — the mechanism: how high the bolt rings,
     *   how soon it cycles (the delay is divided by the pitch, so a light bolt
     *   comes back sooner) and how much of it you hear against the shot. It is
     *   the one place a small weapon is LOUDER than a big one — a blowback
     *   SMG's bolt is most of what an SMG sounds like — and the pair scales
     *   the reload too, which is what makes a magazine change name the weapon
     *   changing it. That is the pair's job in BOTH directions now: two of the
     *   reload's four beats are one shared recording, and `actionPitch` is the
     *   only thing that tells a belt going into an LMG from a magazine going
     *   into a pistol, since the file itself has said nothing about either.
     */
    report: {
      pitch: 1, level: 1, snap: 1, weight: 1,
      length: 1, tail: 1, actionPitch: 1, actionVol: 1,
      // Every row in this table names a sample now, and this one is still the
      // load-bearing one: it is the reference the other six are deviations
      // from, and it is also what a shooter with no weapon of its own is heard
      // as — `Sfx`'s `FLAT_REPORT` is this row, so every bot on the map fires
      // this recording. The other six can be deleted one at a time; deleting
      // this one silences the sampled kit down to whatever else still names a
      // file.
      //
      // A sample here replaces the REPORT only. The action and the bolt cycle
      // are still `actionPitch`/`actionVol` off the eight fields above,
      // because a recording of a SHOT is not a recording of a mechanism — and
      // the masters bear that out, since three of the eight arrived with their
      // own mechanism on the tape and `audio/manifest.json` cuts it off each
      // of them for exactly this reason. (The reload is the one mechanism that
      // IS recorded, and it is not named here: `magOut`/`magIn` belong to the
      // gesture rather than to any weapon, so `Sfx.reload` names them itself
      // and voices them through the pair above.) Delete the field and the
      // synthesized rifle is back with nothing else to undo.
      sample: "assaultRifle",
    },
  },
  /**
   * The carbine: a bullpup firing a mechanical three-round burst, and the one
   * weapon here whose trigger buys a decision rather than a round.
   *
   * Three rounds at 34 is 102 against 100 HP, so a burst that lands is a kill
   * — the whole of it, in the 0.1 s the three take to leave. Nothing else here
   * comes close to that number, and nothing else here is punished for missing
   * the way this is: `burstCycle` is 0.4 s of a weapon that will not fire,
   * whether the burst hit, missed, or hit twice out of three. A carbine that
   * dropped two of the three has done 68, and the 32 that is left costs the
   * full half second — against the rifle's 0.125 s for the same mistake.
   *
   * So the sustained figure is deliberately the worst of the automatics: 3
   * rounds per 0.5 s is 6/s and 204 damage per second, under the rifle's 240
   * and the SMG's 234. What is being sold is not throughput, it is that the
   * fight can be over on one trigger pull if the pull was right — and that
   * the pull is a commitment, because those three rounds are gone whatever
   * happens after the first.
   *
   * `recoilMult` is 0.8 rather than the rifle's 1, and the burst is why: at 20
   * rounds a second there is no recovery between them, so the three climb as
   * one motion — about 2 deg aimed from the first round to the third, which
   * is a chest that becomes a head at ~25 m and a miss well past it. That is
   * the range cap doing its work by hand before the range cap has to.
   */
  carbine: {
    name: "Burst Carbine",
    short: "Carbine",
    /** 34 x 3 = 102 against 100 HP: the burst is the kill, not the round. */
    damage: 34,
    /**
     * **The number that matters here is 40 m, and it is not in this table.**
     *
     * A burst kills while three rounds make 100, so the weapon's whole
     * proposition — the fight is over on one trigger pull — expires the
     * instant the round drops under 33.4, which on this ramp is **39.6 m**.
     * Past it a landed burst does 99 or less and the follow-up costs the full
     * `burstCycle`: 0.1 s to kill becomes 0.5 s, a 5x cliff crossed in one
     * step. That is the climb argument in this entry's header turned into a
     * distance, and it lands where the header already says the weapon runs
     * out ("a chest that becomes a head at ~25 m and a miss well past it").
     *
     * **Fall-off on a burst weapon quantises, and that is why the ramp is
     * placed rather than chosen.** Every other weapon here degrades a round
     * at a time; this one has all three rounds cross the threshold together,
     * so the ONLY thing these three numbers decide is where the cliff goes.
     * The drop from 34 to 33.4 is 8% of the ramp's fall, so the breakpoint
     * sits just past `falloffNear` almost regardless of `falloffFar` — which
     * means moving `falloffNear` is how you move the cliff, and `damageFar`
     * barely touches it. An earlier version of this entry ran 20 -> 55 and
     * put the cliff at 22.9 m while claiming 55 in this very comment.
     *
     * So: quote the BREAKPOINT when any of these three move, never
     * `falloffFar`, and re-derive it rather than assuming it followed.
     */
    damageFar: 26,
    falloffNear: 35,
    falloffFar: 90,
    /** WITHIN the burst — 0.05 s a round, so three take 0.1 s. */
    fireRate: 20,
    /** One pull, one burst: the trigger has to come up for the next. */
    semiAuto: true,
    burst: 3,
    /** The bill for the mode, and the only thing holding it in the kit. */
    burstCycle: 0.4,
    boltCycle: false,
    /** Seven bursts, so seven kills — one more than the rifle's magazine. */
    magSize: 21,
    reloadTime: 1.45,
    /**
     * The worst hip figure of the three automatics, and consistent with the
     * mode: an unaimed burst does not scatter one round, it scatters three.
     */
    spreadHip: 0.075,
    /**
     * Tighter than the rifle's 0.006 and still twice the DMR's. It has to be
     * tighter: three rounds have to land on one decision, so a group that
     * merely covers a torso is a group that drops one of them.
     */
    spreadAds: 0.0055,
    /**
     * Between the SMG's street and the rifle's valley. Past this the burst's
     * own climb has already taken the third round over the shoulder, so the
     * cap mostly names a limit the weapon reaches on its own.
     */
    range: 90,
    recoilMult: 0.8,
    /** The rifle's round out of a shorter barrel: the same shove, near enough. */
    recoilImpulse: 1.05,
    /**
     * Strong, and left — the opposite family to the rifle. Three rounds in
     * 0.1 s cannot be steered, only pre-aimed, so a weak bias would be
     * indistinguishable from the noise it replaces; the whole value of a
     * pattern on a burst weapon is that you can lead it before the pull.
     */
    yawBias: -0.5,
    /** Blooms through the burst and has the whole cycle to bleed it off. */
    bloomMult: 1.15,
    adsSpeedMult: 1.15,
    /** Short overall — a bullpup's barrel is inside its stock. */
    hipZ: -0.05,
    hipY: 0,
    hipYaw: 0,
    /** Mass sat back over the shoulder: steadier than its length suggests. */
    swayMult: 0.95,
    drawTime: 0.5,
    /**
     * A rifle round out of a bullpup's short barrel: sharper than the rifle,
     * nothing like as thin as the SMG. `length` and `weight` come down and
     * `snap` goes up for one reason, and it is the burst — three of these
     * leave in 0.1 s, and at the rifle's own length they would run together
     * into a single ugly shout instead of three rounds you can hear separately
     * and count.
     */
    report: {
      pitch: 1.14, level: 0.95, snap: 1.3, weight: 0.95,
      length: 0.75, tail: 0.85, actionPitch: 1.35, actionVol: 1.25,
      // Cut to the FIRST round of the burst. The master is a burst — the
      // second round is on it at 216 ms — and `Sfx.shoot` is called once per
      // ROUND, so shipping the master whole would fire nine shots for every
      // three. It is also the shortest cut in `audio/manifest.json` at 96 ms,
      // which is `length: 0.75` above made of a recording instead of a filter,
      // and for the same reason: three of these leave in 0.1 s.
      sample: "burstRifle",
    },
  },
  /**
   * The SMG: a pistol-calibre burst weapon. Higher rate, bigger magazine,
   * quicker to raise and quicker to reload; a third less damage per round,
   * spread half again as wide aimed and much wider from the hip, and a
   * range cap that runs out well inside the map.
   *
   * The recoil multiplier is the number that keeps it usable — at 13 rounds
   * a second the rifle's own per-shot kick would walk the muzzle off the
   * screen in half a magazine. Even at 0.55 it climbs faster than the rifle
   * does (0.19 rad/s against 0.21 — near enough the same), so the price of
   * the rate is paid in spread rather than in climb.
   */
  smg: {
    name: "Submachine Gun",
    short: "SMG",
    /** 18 against 100 HP = 6 shots to kill. */
    damage: 18,
    /**
     * The steepest and earliest fall-off in the kit, and the shortest run to
     * it: 10 is TEN shots to kill, which at 13/s is 0.69 s of a magazine of
     * 34 spent on one man. "Cannot be trusted past the far side of a street"
     * was previously true only of the spread; this is the same sentence said
     * in damage, where a lucky group can't argue with it.
     */
    damageFar: 10,
    falloffNear: 12,
    falloffFar: 40,
    fireRate: 13,
    semiAuto: false,
    burst: 1,
    burstCycle: 0,
    boltCycle: false,
    magSize: 34,
    reloadTime: 1.15,
    spreadHip: 0.07,
    spreadAds: 0.016,
    /** Past this a round simply stops; the optic on top cannot change it. */
    range: 70,
    recoilMult: 0.55,
    /**
     * Half the rifle's, and the lowest in the kit that fires anything: a
     * pistol round out of a light gun. Note that it is LOWER than
     * `recoilMult` — this weapon flips more per unit of shove than it shoves,
     * which is what a light receiver with a high bore line does, and is the
     * clearest case in the table that the two fields are not one.
     */
    recoilImpulse: 0.5,
    /**
     * The strongest in the kit, and the rate is why. Thirteen rounds a second
     * on the smallest per-shot kick is otherwise indistinguishable from
     * noise — the individual kicks are too small and too fast to read one at
     * a time, so only a consistent drift is legible at all. A hard pull is
     * what turns "spray the SMG" into "lead the SMG", which is the only way
     * a weapon at this rate can be skilful rather than lucky.
     */
    yawBias: 0.6,
    bloomMult: 1.3,
    adsSpeedMult: 1.3,
    hipZ: -0.07,
    hipY: 0,
    hipYaw: 0,
    /** Light, short, and held high — the liveliest thing in the kit. */
    swayMult: 1.2,
    drawTime: 0.48,
    /**
     * The thinnest report in the kit and the busiest mechanism in it. A
     * pistol-calibre charge is a fraction of the rifle's, so `weight` is 0.4
     * and the low roll all but disappears; what is left is a flat crack and a
     * bolt slamming about, and `actionVol` at 1.55 is the highest figure in
     * that column by design — a blowback SMG really is mostly the sound of its
     * own bolt, and that, far more than pitch, is what stops thirteen rounds a
     * second reading as a fast rifle. Dry with it (`tail` 0.5): a small charge
     * does not excite the village, and the near-silence between rounds is what
     * the rate is heard against.
     */
    report: {
      pitch: 1.42, level: 0.92, snap: 0.85, weight: 0.7,
      length: 0.6, tail: 0.5, actionPitch: 1.4, actionVol: 1.55,
      // The sample is the report and `actionVol` above is still the bolt — and
      // on this weapon that division is doing more work than anywhere else in
      // the table, because 1.55 is the highest figure in the column and a
      // blowback SMG is mostly the sound of its own bolt. The master carries a
      // bolt-shaped event of its own at 152 ms; the cut ends at 140 for that
      // reason, so the mechanism is played once and it is this one.
      sample: "smg",
    },
  },
  /**
   * The DMR: a semi-automatic marksman rifle. One round per trigger pull,
   * and the round is worth pulling for — 50 against 100 HP is two hits,
   * whatever the range and wherever they land.
   *
   * `semiAuto` is the whole design and not a detail on top of it. The other
   * two are held down and steered; this one is a sequence of decisions, and
   * every number here is chosen against that. The rate is a CEILING rather
   * than a cadence — nothing fires it faster than the trigger finger — so
   * `bloomMult` can be high without punishing the aimed shot it is meant to
   * reward: at any deliberate pace the bloom has bled off before the next
   * round leaves, and only trying to run it as an automatic finds the
   * ceiling. The recoil multiplier is the real cost of the two-shot kill.
   * At 2.2 a shot kicks 3.3 deg and only 70% of that springs back
   * (`recoverFraction`); a third of a second later ~1.4 deg of it is still
   * there, so a follow-up taken at the weapon's full rate goes high unless
   * it is pulled down by hand. Waiting is what makes the second shot land,
   * which is the same trade as the magazine: twelve rounds is six kills,
   * the rifle's, with none of the rifle's forgiveness.
   *
   * Hip spread is the worst on offer, deliberately: a long weapon on a sling
   * is not a close-quarters answer, and the way to say so is to make firing
   * it unaimed useless rather than merely worse.
   */
  dmr: {
    name: "Marksman Rifle",
    short: "DMR",
    /** 50 against 100 HP = 2 shots to kill, at any range it reaches. */
    damage: 50,
    /**
     * The one weapon here with no fall-off, and the exemption IS the weapon.
     * "Two shots to kill, whatever the range and wherever they land" is the
     * sentence the entry above opens with, and a curve that took the second
     * round to 49 somewhere down the valley would make it a three-shot rifle
     * at exactly the distances it exists to be used at.
     *
     * Stated as `damageFar` equal to `damage` rather than as an absent field,
     * so every weapon carries the same three numbers and the lerp needs no
     * special case: the ramp runs and resolves to 50 at both ends.
     */
    damageFar: 50,
    falloffNear: 40,
    falloffFar: 120,
    /** A ceiling on the trigger finger, not a cadence — see `semiAuto`. */
    fireRate: 3,
    /** One round per pull. `Player.tryShot` holds the latch. */
    semiAuto: true,
    burst: 1,
    burstCycle: 0,
    boltCycle: false,
    magSize: 12,
    reloadTime: 1.9,
    spreadHip: 0.09,
    /** 0.14 deg aimed: the tightest group in the kit, by a factor of two. */
    spreadAds: 0.0025,
    /**
     * Past the fog wall (78 m) there is nothing to shoot at that you can
     * see, so this mostly buys the open lanes down the valley and the line
     * on the stat chart. It is still the honest number for the round: the
     * other two stop short of what their optics can pick out, and this one
     * does not.
     */
    range: 180,
    /**
     * **Was 2.2, which was 3.8 deg of muzzle rise on every deliberate scoped
     * round** — more than twice the rifle's, from a heavy weapon fired off a
     * shoulder with a cheek on the comb, which is the one place a rifle tips
     * LEAST. That number was the only language this weapon had for being a
     * full-power cartridge, and it spent it on the one axis that reads as the
     * shooter losing control of the gun rather than as the gun being big.
     *
     * At 1.35 it is 2.3 deg — still half again the rifle's, because the bore
     * sits higher over a heavier stock and there is genuinely more moment
     * here. What the missing 1.5 deg bought is on the line below.
     */
    recoilMult: 1.35,
    /**
     * A full-power round out of a gas gun: near enough two and a half times
     * the rifle's shove, and this is where the weight of it is actually
     * spent. Measured in the client, one aimed round takes 28 ms to reach the
     * top of its travel and 62 ms to come back down it, against the rifle's 21
     * and 20 — and at the hip, 63 ms up and 202 down against 41 and 104. It
     * also opens the hold by 1.7x and quickens it 2.2-fold for 0.85 s
     * afterwards, and shakes the frame 1.55x as hard.
     * **None of that is an angle**, which is the point — a shot you have to
     * re-settle after costs the follow-up without making the first round
     * something to be pulled down.
     */
    recoilImpulse: 2.4,
    /**
     * Zero, and it is the one weapon here where that is a decision rather
     * than a default. One shot at a time is not a pattern — there is no
     * second round close enough behind the first for a drift to be learned
     * from — so a bias here would be a fixed error to dial out on every
     * pull, which is a tax and not a skill. `swayMult` 0.7 exists so this
     * weapon's single round goes where it is pointed; a bias would spend it.
     */
    yawBias: 0,
    bloomMult: 1.5,
    adsSpeedMult: 0.7,
    /** Longer than the rifle, so it sits further out or the muzzle fills the
     *  frame — the SMG's offset, in the other direction. */
    hipZ: 0.06,
    hipY: 0,
    hipYaw: 0,
    /**
     * The steadiest weapon here, and it has to be. Sway is angular, so the
     * scope this weapon exists to carry magnifies it 3.5x; at the rifle's
     * figure the shot the DMR is for — one deliberate round at range —
     * would be a matter of timing the wander rather than of aiming. Mass
     * and a cheek on the comb are the excuse, the two-shot kill is the
     * reason. Crouched with a scope this is ~0.13 deg.
     */
    swayMult: 0.7,
    /** The heaviest thing here, and the slowest into the shoulder. */
    drawTime: 0.72,
    /** A heavier charge in a longer barrel: lower, and (see `Sfx.shoot`,
     *  where level tracks 1/pitch) louder, because it fires far less often. */
    /**
     * The heaviest thing in the game, and the rate is what pays for it: three
     * rounds a second leaves room for a report still ringing when the next one
     * is being decided on, where the same sound at the rifle's eight would be
     * a wall. Everything is dropped and lengthened — `pitch` 0.7 puts the
     * chest thump near 37 Hz, `weight` 1.8 doubles the roll under it, `tail`
     * 1.8 hands most of the shot to the valley.
     *
     * `snap` is UP rather than down despite all of that, and that pairing is
     * the whole trick: a full-power round through a brake has the sharpest
     * edge here as well as the deepest body, and a DMR that was only deep
     * would sound like a rifle a long way off instead of a big one up close.
     */
    report: {
      pitch: 0.7, level: 1.2, snap: 1.5, weight: 1.65,
      length: 1.75, tail: 1.8, actionPitch: 0.8, actionVol: 1.15,
      // The longest cut in `audio/manifest.json` at 180 ms, and the only one
      // whose master rings that long in its own right rather than in a room:
      // the high band is still live at 156 ms and only then goes flat. Which
      // is `length: 1.75` above arriving from the recording — and at three
      // rounds a second there is room for it, exactly as this entry says.
      sample: "dmr",
    },
  },
  /**
   * The bolt-action sniper rifle: one round kills, and then you are out of the
   * fight for a second and a quarter.
   *
   * It is the only weapon here that does not need a second round, and the only
   * one that cannot have one. 100 against 100 HP is a kill anywhere on a man at
   * any range the round reaches — no fall-off, no head zone required, no second
   * shot to ride the recoil back down for — which is a bigger claim than
   * anything else in this table makes. What pays for it is `boltCycle`: the
   * 1.25 s between rounds is not a rate, it is a GESTURE, and `ViewModel` takes
   * the sight picture away for most of it. So the cost of a sniper rifle is not
   * the wait, it is that you do not see what your target did next.
   *
   * **Read it against the DMR, which is the weapon it is not.** Two rounds
   * anywhere at 3/s is 0.333 s and the scope stays on the target the whole
   * time — a marksman rifle is a weapon you CORRECT with. One round at 0.8/s is
   * a weapon you commit with: miss, and the man you missed has 1.25 s and your
   * muzzle flash. That is why this is 6x glass and 0.14 from the hip rather
   * than a DMR with the numbers turned up, and it is why `magSize` is 5 and the
   * reload is the second longest in the kit — every part of it is asking the
   * same question, which is whether you are sure.
   *
   * It has no answer at all inside a room. `spreadHip` 0.14 is over three times
   * the rifle's and the worst here by a distance, `drawTime` 1.0 and
   * `adsSpeedMult` 0.5 are both the slowest, and the cycle means a man who
   * survives the first round is on you before the second one exists. The
   * sidearm is the answer, exactly as it is for the LMG, and this is the weapon
   * that needs it most.
   */
  sniper: {
    name: "Sniper Rifle",
    short: "Sniper",
    /**
     * 100 against 100 HP = ONE shot to kill, and it is the only one in the
     * table. `combat.headshotMult` is therefore dead weight on this weapon —
     * there is nothing for a head hit to upgrade — which is deliberate: a
     * one-shot kill that had to be a head hit would be a weapon whose whole
     * case rests on a 22 cm sphere at 200 m, and the cycle below is a cost
     * that has to be worth paying on an ordinary shot at an ordinary body.
     */
    damage: 100,
    /**
     * Equal to `damage`, stated rather than absent exactly as the DMR's is —
     * and here the exemption is not a reward, it is the definition. A rifle
     * that stopped killing in one somewhere down the valley would be a rifle
     * whose one advantage evaporates at precisely the distances it exists to
     * be fired at, while nothing about its cost fell with it.
     */
    damageFar: 100,
    falloffNear: 60,
    falloffFar: 200,
    /**
     * 0.8/s — and this is the one row in the table where `fireRate` is not a
     * ceiling on the trigger finger but the length of a gesture. 1.25 s is the
     * bolt: lifted, drawn, pushed home and turned down. See `boltCycle`.
     */
    fireRate: 0.8,
    semiAuto: true,
    burst: 1,
    burstCycle: 0,
    /** The only true in this column, and see the rifle's entry for what it
     *  buys. Everything else here is a consequence of it. */
    boltCycle: true,
    /** Five in a single-stack box, and no sixth up the spout. It is the
     *  smallest magazine in the game by a factor of one and a half, and on a
     *  weapon that kills with every round it is still five kills. */
    magSize: 5,
    /**
     * 3 s — second only to the LMG's belt change, for a fifteenth of the
     * ammunition. What it is priced on is not the magazine, which is a short
     * single stack, but everything around it: coming off 6x glass, breaking a
     * position that took time to take up, and getting back behind the same
     * picture afterwards. It is also the number that says do not empty this —
     * five rounds and a reload is 9.25 s of a round in which you have fired
     * five times.
     */
    reloadTime: 3,
    /**
     * 0.14 — over three times the rifle's, and the worst here by half again on
     * the LMG. It is not a penalty bolted on; it is the same fact as
     * `spreadAds` below, which is that this weapon is a rest and a cheek and a
     * held breath, and none of those is available to a man swinging it round a
     * doorway.
     */
    spreadHip: 0.14,
    /** 0.09 deg aimed: the tightest group in the game, tighter than the DMR's
     *  by a third, because a round that kills wherever it lands has to land
     *  where it was sent. */
    spreadAds: 0.0016,
    /**
     * 300 m. Like the DMR's 180 this mostly buys the open lanes and the line on
     * the stat chart — on most maps the fog wall is well inside it — but Sarab
     * and Cinderhaven are 900 m and 1500 m across with 560 m of clear sight
     * down one of them, and this is the first weapon in the table written
     * knowing that.
     */
    range: 300,
    /**
     * **Was 3.2 — five and a half degrees, the largest single number in the
     * recoil system, applied in ONE FRAME.** The argument for it was that it
     * cost the weapon nothing (no second round is close enough behind the
     * first for a climb to compound), and that was true of the BUDGET and
     * false of the picture: a bolt gun that throws its own scope five degrees
     * off the target reads as a rifle nobody has hold of, and it is close to
     * the opposite of what a heavy rifle on a bipod or a proper mount does.
     *
     * 1.7 is 2.9 deg — the most muzzle rise in the kit, still, and by a
     * distance. Everything the other 2.6 deg used to say is said by
     * `recoilImpulse` instead, which says it in seconds.
     */
    recoilMult: 1.7,
    /**
     * The heaviest cartridge in the game, and now the heaviest SHOVE rather
     * than the steepest climb. It puts the settle spring at 2.9 Hz and 0.59
     * Measured in the client: an aimed round takes 35 ms to reach the top of
     * its travel and 84 ms to come back, and at the hip 84 ms up and 292 down
     * — the slowest lift in the kit at both ends, which is a heavy rifle
     * being brought back down rather than a reticle snapping home. It opens
     * the hold to 2.1x and quickens it 2.7-fold on a time constant of 1.08 s,
     * and that second is spent inside the 1.25 s `boltCycle` this weapon
     * already pays: **the wait and the re-settle are the same event**, where
     * before the wait was empty and the climb was instant.
     */
    recoilImpulse: 3.6,
    /** Zero, on the DMR's argument and more so: one round every 1.25 s is not
     *  a string, and a fixed drift would be an error to dial out on every pull. */
    yawBias: 0,
    bloomMult: 2.2,
    /** The slowest into the shoulder, a hair under the LMG's. */
    adsSpeedMult: 0.5,
    /** The longest weapon in the game — a heavy barrel behind a full-length
     *  stock — so it sits further out than anything else here. */
    hipZ: 0.11,
    hipY: 0,
    hipYaw: 0,
    /**
     * The steadiest weapon in the game, and the magnification is why rather
     * than the mass. Sway is angular, so the 6x glass this is built around
     * multiplies it by six where the DMR's scope multiplies by three and a
     * half: at the DMR's 0.7 the picture would wander half again as far across
     * the screen as the DMR's does, on the one weapon that cannot correct.
     * Crouched this is ~0.08 deg, which is the DMR's ~0.13 seen through the
     * bigger optic — the same wander on screen, bought back.
     */
    swayMult: 0.42,
    /** A second, flat. Nothing else here is slower to get into your hands, and
     *  a weapon you cannot bring up in a hurry is one you have to have been
     *  holding already. */
    drawTime: 1,
    /**
     * The biggest charge in the game, and every column says so. `pitch` 0.6
     * puts the chest thump near 32 Hz, `weight` and `tail` at 2 hand almost the
     * whole shot to the valley, and `length` 2.1 is affordable because 0.8
     * rounds a second is a report that has finished ringing long before the
     * next one is decided on — the DMR's argument at half the rate.
     *
     * `snap` at 1.9 is the highest here for the DMR's reason one size up: a
     * long heavy barrel behind a braked full-power round has the sharpest edge
     * in the game AND the deepest body, and a rifle that was only deep would
     * sound like something a long way off rather than the loudest thing on the
     * map. `actionVol` 1.35 is the other half of the identity — a bolt worked
     * by hand is heard, and it is the sound the player is waiting on.
     */
    report: {
      pitch: 0.6, level: 1.35, snap: 1.9, weight: 2,
      length: 2.1, tail: 2, actionPitch: 0.68, actionVol: 1.35,
      // The hardest master to cut and the shortest result relative to it: it
      // is one long boom with no cliff anywhere in it, so the trim's fade is a
      // third of its length instead of the 15 ms every other row needs. What
      // is left is 90 ms of direct crack, and `length: 2.1` and `tail: 2`
      // above are what put the rest of it back — the game's valley rather than
      // the recording's room, which is the whole rule. `actionVol` 1.35 is
      // still the bolt, and `boltCycle` still plays it as a gesture.
      sample: "sniperRifle",
    },
  },
  /**
   * The LMG: belt-fed, and the only weapon here that does not have to stop.
   *
   * Every other primary is built around its magazine running out. Twenty-four
   * rounds is three seconds of rifle fire, and the fight you are in is decided
   * by whether it ends before that does. This one carries seventy-five, which
   * is fifteen kills and seven and a half seconds of continuous fire, and that
   * is the entire weapon.
   *
   * The arithmetic is deliberately a wash, and it is the reason the magazine
   * can be this big without the weapon being the obvious pick. Sustained output
   * is 240 damage per second — exactly the rifle's, to the round — and the duty
   * cycle is the same to within a percent: the rifle fires 3.0 s and reloads
   * 1.4 (68%), this fires 7.5 s and reloads 3.4 (69%). What differs is not how
   * much it delivers but WHEN it has to stop, and that is worth paying for,
   * because the fight in the middle of a rifle's reload is the fight the rifle
   * loses. Against three men crossing a square, the rifle is a weapon that runs
   * out halfway through the second one.
   *
   * The bill is in the two things a support weapon is bad at, and both are the
   * worst figures in the kit by a distance. It cannot START a fight: 0.55 on
   * the ADS blend and 0.95 s to draw mean anything already aimed in gets its
   * burst off first, and `spreadHip` at 0.115 makes firing it unaimed a way of
   * announcing where you are. And it cannot RECOVER from being caught empty:
   * 3.4 s is more than twice any reload here, in a game with no reserve
   * ammunition and a sidearm that comes up in 0.34 — which is the answer, and
   * is what the second slot is for.
   *
   * `bloomMult` at 0.5 is the one number that is a reward rather than a cost,
   * and it is what makes a long burst worth firing: bloom tops out at 0.015
   * against the rifle's 0.03, so the fortieth round lands where the fourth did.
   * A weapon whose group opened up like the rifle's would have a seventy-five
   * round magazine and nothing to do with it past the first second.
   */
  lmg: {
    name: "Machine Gun",
    short: "LMG",
    /** 24 against 100 HP = 5 shots to kill — the most rounds of anything here. */
    damage: 24,
    /**
     * 21 x 5 = 105, so the belt gun loses damage per second across the valley
     * and never loses a ROUND: five hits kill at 85 m exactly as they do at
     * 5. That is the same reward `bloomMult` 0.5 is — the weapon that does
     * not have to stop is the weapon whose fortieth round still counts — and
     * it is the gentlest curve here on the longest run to it.
     */
    damageFar: 21,
    falloffNear: 30,
    falloffFar: 85,
    /** 5 rounds at 10/s is 0.4 s: the worst ideal TTK of the three automatics,
     *  by a hair, and on purpose. */
    fireRate: 10,
    semiAuto: false,
    burst: 1,
    burstCycle: 0,
    boltCycle: false,
    /** Fifteen kills on one belt, against the rifle's six. The weapon. */
    magSize: 75,
    /** A belt box is not a magazine, and this is where it says so. */
    reloadTime: 3.4,
    /** The worst on offer. A machine gun fired from the hip is theatre. */
    spreadHip: 0.115,
    /** Wider than the rifle's 0.006 — honest, not a marksman's. What it has
     *  over the rifle is that this figure barely moves; see `bloomMult`. */
    spreadAds: 0.008,
    /** A full-power round out of a long heavy barrel: further than the rifle,
     *  well short of the DMR's. */
    range: 130,
    /**
     * Mass, and it has to be: at 10 rounds a second the rifle's own kick would
     * be 0.24 rad/s of settled climb. At 0.7 it is 0.168 — the gentlest in the
     * kit, under both the rifle's 0.208 and the SMG's 0.187, which is what
     * makes a long burst a thing you steer rather than a thing you abandon.
     */
    recoilMult: 0.7,
    /**
     * A full-power belt round, most of it soaked by the weight of the gun and
     * the bipod under it. Below the rifle's despite the bigger cartridge,
     * which is what mass buys and the same trade `recoilMult` above spells
     * out — the difference is that this one buys a SHORT settle, so the sight
     * is back between rounds at ten a second.
     */
    recoilImpulse: 0.9,
    /**
     * The gentlest bias in the kit beside the DMR's nothing, and it is the
     * same reward `recoilMult` and `bloomMult` are: a burst you steer rather
     * than one you abandon has to be steerable on both axes, and seventy-five
     * rounds of a hard pull is a weapon that ends up pointing at a wall.
     * Left, so it is not simply the rifle held down for longer.
     */
    yawBias: -0.25,
    /** The heart of the weapon — see the header. Half the rifle's ceiling. */
    bloomMult: 0.5,
    /** The slowest thing here into the shoulder. */
    adsSpeedMult: 0.55,
    /** Long, and front-heavy with a box under the receiver: it sits further
     *  out than the rifle or the muzzle fills the frame. */
    hipZ: 0.05,
    hipY: 0,
    hipYaw: 0,
    /** Heavy, and carried low on a bipod's worth of nose weight. Steadier than
     *  anything but the DMR, which is the trade its own optic pays for. */
    swayMult: 0.75,
    /** Nothing here is slower to get up. Caught with it slung is caught. */
    drawTime: 0.95,
    /**
     * Deep and mechanical. Nearly the DMR's charge at ten rounds a second, so
     * `weight` is high while `length` sits only just above the rifle's — a
     * long report on a weapon that never has to stop smears its own burst.
     *
     * The mechanism is the character here rather than the dressing on it:
     * `actionPitch` 0.68 is the lowest in the table, a heavy reciprocating
     * group and a belt where everything else has a bolt and a magazine, and at
     * 1.4 it is most of what a sustained burst sounds like from the far side
     * of a wall.
     */
    report: {
      pitch: 0.8, level: 1.15, snap: 1.05, weight: 1.5,
      length: 1.05, tail: 1.35, actionPitch: 0.68, actionVol: 1.4,
      // Cut from 40 ms in: this master and the carbine's are the two that lead
      // with the mechanism, and 50 ms of it in front of the report is 50 ms of
      // latency on a weapon that fires every 100. What the trim throws off the
      // END is the low roll the room was holding after the crack had decayed,
      // which is `weight: 1.5` and `length: 1.05` above — those two are the
      // roll, and the shot is not owed it twice.
      sample: "lmg",
    },
  },
  /**
   * The sidearm. Not a kit choice — every loadout carries it, and `Q` (pad Y)
   * swaps to it — which is why it is last in this table and why
   * `PRIMARY_WEAPON_IDS` exists to keep it off the loadout screen.
   *
   * It is deliberately the worst weapon here at everything except getting
   * into your hands. Four rounds to kill at 5.5/s semi is a 0.545 s ideal
   * time to kill, half again the rifle's, and it runs out of range inside the
   * width of the village. What it buys is `drawTime` 0.34 against the rifle's
   * 0.55 and an `adsSpeedMult` of 1.6: a magazine that runs dry mid-fight is
   * a third of a second from a loaded weapon instead of the 1.4 s a reload
   * costs, and that trade — not damage — is the entire reason to pull it.
   *
   * `semiAuto` is what stops it competing with the SMG: eight rounds at the
   * trigger finger's pace is a weapon you finish a fight with, not one you
   * start one with.
   */
  pistol: {
    name: "Sidearm",
    short: "Pistol",
    /** 25 against 100 HP = 4 shots to kill. */
    damage: 25,
    /**
     * 15 is seven shots out of an eight-round magazine, which is the honest
     * end of "across a street, not down the valley" — the range cap says a
     * round stops at 45 m and this says it stopped meaning anything at 35.
     *
     * **`falloffNear` is 15 because 25 x 4 is exactly 100.** The sidearm sits
     * on a knife edge no other weapon here does: it has no headroom at all,
     * so the first centimetre past `falloffNear` costs a whole round and the
     * pistol becomes a five-shot weapon. At 10 that put the four-shot kill
     * inside a hallway; at 15 it covers a room, which is where the second
     * slot's whole case — a loaded weapon in 0.34 s — is actually spent.
     * Anything that moves `damage` off 25 moves this boundary by metres.
     */
    damageFar: 15,
    falloffNear: 15,
    falloffFar: 35,
    /** A ceiling on the trigger finger, as on the DMR. */
    fireRate: 5.5,
    semiAuto: true,
    burst: 1,
    burstCycle: 0,
    boltCycle: false,
    /** Seven in the magazine and one up the spout. */
    magSize: 8,
    reloadTime: 1.05,
    spreadHip: 0.055,
    spreadAds: 0.014,
    /** A pistol's honest reach: across a street, not down the valley. */
    range: 45,
    recoilMult: 1.15,
    /**
     * The SMG's round out of a smaller gun: almost no shove at all, and it
     * sits under `recoilMult` by more than anything else here. A pistol has
     * the worst bore-axis-to-hand offset in the kit and the least mass to
     * resist it, so it flips hard on a cartridge that barely pushes — the
     * textbook case for the two fields being separate.
     */
    recoilImpulse: 0.55,
    /**
     * Wrists rather than a shoulder, so a strong pull is honest — and at
     * 5.5/s semi it is trivially corrected between shots, which is what
     * makes a strong number safe here and not on the LMG. Right, with the
     * rifle: the two weapons most loadouts carry together pull the same way.
     */
    yawBias: 0.45,
    bloomMult: 1.7,
    /** Nothing else here comes up this fast. */
    adsSpeedMult: 1.6,
    /** The shortest weapon in the game, so it sits closest to the eye. */
    hipZ: -0.12,
    /** Held up into the frame — see the field's note on the rifle. */
    hipY: 0.09,
    hipYaw: 0,
    /** Light, and held out on the arms rather than braced on a shoulder. */
    swayMult: 1.45,
    /** The number the whole weapon exists for. */
    drawTime: 0.34,
    /**
     * A flat bark and a slide. Small charge, short barrel and nothing behind
     * it — `weight` and `length` are the SMG's order rather than the rifle's —
     * but `snap` sits above the rifle's, because a short barrel dumps its gas
     * as edge rather than as body. The slide is the loud part, and that is the
     * sidearm's one advantage in a mix full of automatic fire: whatever else
     * is being fired around you, this does not sound like any of it.
     */
    report: {
      pitch: 1.28, level: 0.98, snap: 1.15, weight: 0.8,
      length: 0.65, tail: 0.65, actionPitch: 1.25, actionVol: 1.3,
      // The one master that needed nothing but its own cliff found: a report
      // to 100 ms and then 20 dB gone over the next 25, which is the assault
      // rifle's shape at a smaller scale. The slide is audible inside the cut
      // at 84 ms and is kept, for the reason the rifle keeps the same event at
      // 126; `actionVol` 1.3 above is still what makes the slide the loud part
      // this entry's note claims it is, and still what the reload is pitched
      // from.
      sample: "pistol",
    },
  },
} as const;

/**
 * What every round does regardless of what fired it: the head zone.
 *
 * **The head zone is on the PLAYER's rounds only, and that gate is load-bearing
 * rather than a difficulty setting.** Bots aim at `t.eyePos` — the same point
 * this zone is centred on — so a head sphere their rounds could find would make
 * every accurate bot shot a headshot and halve a tuned time to kill overnight.
 * `CombatSystem.fire` takes the multiplier from its caller and skips the sphere
 * test entirely below 1, which is also why sixteen bots pay nothing for a
 * feature they do not have.
 */
export const combat = {
  /**
   * Metres about `eyePos`. A bot's eye is 1.55 up, so this spans roughly chin
   * to crown — the head as a ball, which is all a sphere can honestly be.
   *
   * It sits INSIDE the body sphere (`hitRadius` 0.75 about `center`), so it is
   * never a separate candidate in the nearest-hit search — it could not win
   * one. It is an upgrade applied to a body hit that already landed, which is
   * also what makes it one extra sphere test per LANDED round rather than one
   * per target per shot.
   */
  headRadius: 0.22,
  /**
   * What a head hit is worth. At 2 the payoffs are legible without being
   * silly: the rifle and the pistol kill in two, the SMG in three, and the DMR
   * kills in ONE at any range — which is the reward its `semiAuto`, its 2.2
   * recoil multiplier and its exemption from fall-off have all been asking for.
   * It costs a scope, a 3/s ceiling and a 22 cm target.
   *
   * **The sniper is the one weapon this column does nothing for**, and that is
   * a decision rather than an oversight. It already kills in one on the body,
   * so there is nothing for a head hit to upgrade and the sphere is never
   * tested — but the two one-shot kills are still different weapons, and the
   * difference is exactly what the multiplier is: the DMR's is a 22 cm target
   * you may take three times a second, and the sniper's is a man-sized one you
   * may take once every second and a quarter. A one-shot kill that had to be a
   * head hit AND cost a bolt cycle would be a weapon nobody could justify
   * carrying.
   */
  headshotMult: 2,
} as const;


/**
 * `recoil` used to live here and is now `config/recoil.ts` — it had outgrown
 * this file. `CONFIG.recoil` is unchanged; nothing that reads it moved.
 */

/**
 * Gunfeel dressing: the visible muzzle flash mesh and ejected brass.
 * Player-only — bots get neither (their flashes are the budgeted light
 * pulses, and 16 bots' worth of casing meshes is draw-call noise nobody
 * can see anyway).
 */
export const gunfeel = {
  /** Seconds the muzzle flash mesh stays visible per shot. */
  flashTime: 0.05,
  /**
   * Ejected brass: pool size, lifetime (s), launch speeds (m/s), gravity.
   *
   * The pool has to cover the fastest weapon's rate over one casing's
   * lifetime — 13/s x 0.9 s is 11.7 — or a held trigger runs it dry and the
   * brass simply stops coming out halfway through the magazine.
   */
  casingPool: 16,
  casingLife: 0.9,
  casingGravity: 12,
  casingEject: 1.8,
  casingUp: 2.6,
} as const;
