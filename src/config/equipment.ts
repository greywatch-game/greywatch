/**
 * config/equipment.ts — the anti-tank slot: what a launcher throws and what a
 * mine catches.
 * Owns: the equipment table (its keys ARE `EquipmentId`), the carry half each
 * item is held by, and the bots' launcher band. Contract: `docs/antitank.md`.
 * Gotcha: an entry's `carry` block is resolved into an ordinary `WeaponSetup`
 * by `entities/equipment.ts`, so an AT item is carried, drawn, swapped to and
 * captioned by exactly the machinery a rifle is. What is NOT there is a
 * reload: `carried` is the whole of a life's ammunition, refilled by death and
 * by nothing else, the same economy `CONFIG.grenade.carried` runs on.
 * Gotcha: the ROCKET is the second thing in this game that is not hitscan, and
 * the only one besides the grenade. Everything about its flight is here.
 * Gotcha: `blast` is handed straight to `GrenadeSystem.blastAt`, so `power` is
 * a multiple of the GRENADE's picture exactly as the tank shell's is — see
 * `CONFIG.vehicles.tank.gun.blastPower`.
 */

/**
 * The two things that can go in the anti-tank slot, and everything that
 * differs between them.
 *
 * **They are one slot because they are one decision.** A launcher is armour
 * you can chase and a mine is armour you can refuse ground to, and a player
 * who could carry both would simply carry both — the choice, not the
 * hardware, is the feature. `entities/equipment.ts` derives `EquipmentId`
 * from these keys, so a third AT item is one entry here, one model builder
 * and one arm in `AntiTankSystem`.
 *
 * **Both are offered only where there is armour to use them on.** The slot
 * appears on a map whose layout states a `vehicles` entry, which today is
 * Coldharbour and offline only — the same gate `installMap` already applies
 * to the hulls themselves. A launcher on a map with no tank would be a
 * two-shot anti-infantry cannon and nothing else, and the kit screen would be
 * offering a trade against a threat that is not on the field.
 *
 * **What a hit is worth is TWO numbers on purpose**, and it is the split the
 * tank's own gun already makes: `damage` is what the thing does to the HULL it
 * strikes and `blast.damage` is what it does to everything else. One falloff
 * curve cannot serve both a seven-metre vehicle and a one-metre body — a curve
 * wide enough to reach a hull's centre from its nose is a curve that kills
 * infantry at eight metres, and a curve tuned for infantry does a third of its
 * damage to the tank it hit dead on. See `docs/antitank.md`.
 */
export const equipment = {
  /**
   * A shoulder-fired launcher: two rockets, no resupply, and the only weapon
   * an infantryman has that a tank has to answer.
   *
   * The rocket FLIES, which is the whole balance of the thing. A hitscan
   * anti-tank round is a hull deleted from wherever the shooter is standing;
   * one at 45 m/s takes a second and a half to cross a Coldharbour avenue,
   * which is a second and a half of a driver seeing the smoke trail and
   * deciding what to do about it. It is also why the launcher is worth
   * carrying against a hull that is not moving and a poor answer to one that
   * is: leading a tank at 11 m/s across 60 m is a real shot to have to make.
   */
  rpg: {
    name: "Rocket Launcher",
    /** For the magazine caption, where the full name will not fit. */
    short: "RPG",
    /**
     * Rockets a life. Two, for the reason the pouch is two: it makes each one
     * a decision rather than a second trigger, and it means the launcher
     * alone does not kill a hull — see `damage`.
     */
    carried: 2,
    /**
     * **The gap between rounds is a LOAD, not a rate of fire**, and this is
     * where that is said rather than left to be inferred from `fireRate`.
     *
     * The two AT items both have a cooldown and they mean opposite things.
     * This one is a man putting a rocket down a tube: it is drawn as one (see
     * `CONFIG.viewmodel.load` and `RpgModel`'s round, which is the same fact
     * seen from the model's end) and it is PAID for as one — `Player.loading`
     * reads this, so a launcher cannot be loaded at a sprint any more than a
     * magazine can be changed at one. The mine's is a placement rate and says
     * so, which is why it does not carry this: a player backing away from a
     * hull must not be pinned for half a second by a gesture that is not
     * happening, and that is the same argument `layMine`'s "never refused for
     * want of somewhere to put it" already makes.
     */
    muzzleLoad: true,
    /**
     * What the rocket does to the HULL it strikes, before `resist.shell`
     * (which is 1, so this is the number that lands).
     *
     * **A hull hit squarely takes this and NOTHING ELSE**, which is the one
     * counter-intuitive thing about these figures and the reason this number
     * is as large as it is. The splash is resolved by `blastAt`, which needs
     * line of sight from the blast centre to the victim's centre — and a
     * rocket that stopped on a hull has that hull's own collider between the
     * two. So the splash below is what a NEAR MISS is worth and this is what a
     * hit is; measured, 1200 → 680 on a clean strike.
     *
     * Two rockets are 1240 of a hull's 1200, so **one player's whole launcher
     * is one dead tank** — provided both land. That is deliberately decisive:
     * a weapon that took three lives to matter would be a weapon nobody picked
     * up, and the cost is already paid in the two seconds a rocket spends in
     * the air with a driver watching it come.
     */
    damage: 620,
    /**
     * How close the detonation has to be to a hull's centre for that hit to
     * count as a strike on it rather than as splash beside it.
     *
     * Sized off the hull rather than off the blast: half a hull is 3.6 m and
     * the collider stands a metre and a half proud of the tracks, so a rocket
     * that stopped ON the tank is inside 5 and one that stopped on the wall
     * behind it is not.
     */
    contactRadius: 5,
    /** The rocket itself: how it flies and how long it may. */
    rocket: {
      /**
       * m/s. Fast enough to hit a stationary hull across an avenue without a
       * lead, slow enough that the flight is a thing that happens. At 60 m it
       * is 1.3 s in the air.
       */
      speed: 45,
      /**
       * m/s^2. A twelfth of the grenade's, because a rocket has a motor and a
       * frag does not: 0.4 m of drop at 40 m and 1.5 m at 80, which is
       * nothing inside a street and a real hold-over down an avenue.
       */
      gravity: 1.5,
      /**
       * Metres. The step ray runs this far past the step, so a rocket cannot
       * tunnel through a wall between two frames — the same guard, and the
       * same number's job, as `CONFIG.grenade.radius`.
       */
      radius: 0.18,
      /**
       * Seconds before a rocket that has hit nothing goes off on its own.
       * 3.5 at 45 m/s is 157 m, past the fog wall on every map that has
       * armour — so the self-destruct is a backstop against a rocket fired
       * at the sky, never a range limit a player can feel.
       */
      life: 3.5,
      /**
       * Metres of flight before the warhead is live. A rocket that armed at
       * the muzzle would kill its firer against a doorframe they never saw,
       * and the blast excludes their own side by construction but not the
       * world they are standing in.
       */
      armDistance: 3,
      /**
       * How far in front of the eye the rocket appears, in metres, when the
       * muzzle itself is inside geometry. The floor `Game` clamps the launch
       * point to, exactly as `CONFIG.grenade.handAhead` is for a throw.
       */
      launchAhead: 0.7,
    },
    /**
     * The splash, handed straight to `GrenadeSystem.blastAt`. Smaller and
     * harder than a frag's: 220 inside 2.4 m falling to nothing at 7, which
     * kills a body out to about 4.9 m.
     *
     * Against ARMOUR it is what a near miss is worth and never what a hit is —
     * see `damage`. A rocket into the road beside a hull is ~96 of it at five
     * metres, which is the chip damage a launcher bot firing at a moving tank
     * actually does.
     *
     * `power` is 1.5 — half again the grenade's picture and under the tank
     * shell's 1.85, which is the order the three of them actually stand in.
     */
    blast: {
      radius: 7,
      inner: 2.4,
      damage: 220,
      power: 1.5,
    },
    /**
     * How the launcher is CARRIED. Resolved into a `WeaponSetup` by
     * `equipmentSetup`, so every field here means exactly what the same field
     * means in `CONFIG.weapons` — and everything not here is a constant that
     * says "this is not a gun": no fall-off, no spread, no burst, no reload.
     */
    carry: {
      /**
       * Rounds per second, which on a two-shot weapon is the loader. 0.5 puts
       * two seconds between rockets — long enough that a miss is a miss, short
       * enough that a hull crossing a junction can still be hit twice.
       */
      fireRate: 0.5,
      /**
       * Where a rocket stops mattering. Read by nothing that resolves the
       * flight (`rocket.life` is what ends one), and by the HUD's range
       * caption and the bots' band.
       */
      range: 150,
      /**
       * The heaviest kick in the game, and it is the launcher's whole
       * drawback in the hands: a tube on a shoulder with a rocket motor
       * leaving it does not come back down inside two seconds, and the
       * player has two seconds anyway.
       */
      recoilMult: 2.4,
      /** Straight up and slightly right, like everything else in the kit. */
      yawBias: 0.2,
      /** Nothing blooms on a one-shot weapon; the number is here to be zero. */
      bloomMult: 0,
      /** Slow to the shoulder: it is a metre and a half of tube. */
      adsSpeedMult: 0.7,
      /** Heavy, held out on the arms and past the shoulder. */
      swayMult: 1.5,
      /**
       * **Pulled all the way IN, because a launcher is fired off the SHOULDER
       * and the shoulder is BEHIND the lens.**
       *
       * The model is built from its venturi rather than its middle (see
       * `RpgModel`), so the origin IS the shoulder — and this is the number
       * that puts the origin where the shoulder is. At the shared stand-off
       * the origin sits half a metre out in FRONT of the chest and the whole
       * 1.39 of it runs forward from there: the bell ends up broadside in the
       * middle of the frame with two forearms holding it level, which is a
       * plank being carried rather than a tube being shouldered. No yaw fixes
       * that, because what is wrong is the DEPTH.
       *
       * Measured at 1280x720 against the landmarks in `RpgModel`: the bell's
       * rear rim leaves the frame (px 1332) at 0.21 m from the eye, and the
       * tube crosses the lower right — chamber (994, 680), optic (723, 523),
       * warhead (659, 495), support hand (725, 634) and the trigger hand off
       * the bottom edge, which is where a hand on a launcher's grip actually
       * is. The muzzle is still 1.04 m out, past `rocket.launchAhead`, so a
       * rocket still leaves from the muzzle rather than from that clamp.
       */
      hipZ: -0.36,
      /** …and carried higher, because it rides a shoulder rather than a sling. */
      hipY: 0.03,
      /**
       * Turned INBOARD, and it is the only weapon in the game that needs a yaw
       * of its own. It is about READING the weapon, not about where the bell
       * is — the shoulder carry above is what got the bell out of the frame.
       *
       * A tube pointed straight down the line of sight foreshortens into
       * nothing: at a yaw of 0 the warhead and the optic land 40 px apart and
       * the whole launcher reads as a length of pipe with a sight on it, which
       * is the one thing a player must be able to tell apart from a rifle at a
       * glance. Turning it across the view opens the length out: -0.18 on
       * top of the shared `hipRot.y` is 15 degrees, and it spreads the chamber,
       * the shield, the optic and the warhead over 340 px of the lower right.
       *
       * **The sign is the counter-intuitive one.** The weapon is held to the
       * RIGHT of the eye (`hipPos.x` is 0.184), so turning the muzzle outboard
       * swings the bore ONTO the line of sight and collapses it further;
       * inboard opens it. It is the same sign, for the same reason, that
       * `viewmodel.sprintRot` documents.
       *
       * The AIMED pose is unaffected: that one is derived from the sight, and
       * it is where the reticle has to be honest.
       */
      hipYaw: -0.18,
      /**
       * Seconds to come up. The longest in the game — the LMG's is 0.8 — and
       * the reason the launcher is a weapon you decide to use rather than one
       * you snap to.
       */
      drawTime: 0.95,
      /**
       * A launch, as deviations from the reference gunshot. Everything about
       * it is under the rifle in pitch and over it in weight, length and
       * tail: a motor rather than a charge, and a village that answers.
       */
      report: {
        pitch: 0.52, level: 1.25, snap: 0.75, weight: 2.3,
        length: 2.4, tail: 2.6, actionPitch: 0.6, actionVol: 0.45,
      },
    },
  },

  /**
   * Two anti-tank mines: a thing you put on the ground and walk away from.
   *
   * **Only a hull sets one off.** That is the name of the weapon and it is
   * also the only rule in here a player has to be told, because it is the one
   * that makes a mine safe to lay across your own team's route. A body walking
   * over one is not enough pressure and nothing happens; the blast that
   * follows a hull, on the other hand, is a blast, and it hurts whoever is
   * standing beside the tank exactly as a rocket's would.
   *
   * **A mine outlives the man who laid it**, which is what makes it area
   * denial rather than a slow grenade — but a layer may only have `carried`
   * of them alive at once, and laying past that retires their oldest. Without
   * that cap a player who died twice would have six on the field, and the
   * pouch being refilled by death would be an ammunition supply rather than a
   * fresh start.
   */
  mine: {
    name: "Anti-Tank Mines",
    short: "Mines",
    /** Mines a life, and the number that may be live at once. */
    carried: 2,
    /**
     * **A mine is PLACED, not loaded**, so the gap between two of them is a
     * rate and not a gesture — see `rpg.muzzleLoad`, which is the same field
     * saying the opposite thing about the other item in this slot.
     *
     * Stated rather than left out, because the consequence is movement: this
     * is what keeps `Player.loading` false while the half-second runs down, and
     * a player backing away from a hull must not be pinned by it.
     */
    muzzleLoad: false,
    /**
     * What a mine does to the hull that runs over it. A tracked vehicle
     * driving onto a shaped charge is the worst thing that happens to it in
     * this game — one is 800 of 1200 and a second finishes it, which is what
     * makes a mined approach a road a driver may not take twice.
     */
    damage: 800,
    /**
     * How close a hull's centre has to come. Half a hull is 3.6 and a track
     * is 1.7 off the centreline, so 4 is "a tank drove over it" and not "a
     * tank passed near it" — the mine is under the vehicle at 4 m, which is
     * where a mine goes off.
     */
    contactRadius: 4,
    mine: {
      /**
       * Seconds between a mine being set down and being live. A mine that
       * armed instantly is a grenade you throw at your feet, and this is the
       * whole of what stops that.
       */
      armTime: 1.6,
      /** How far in front of the player's feet it is placed, in metres. */
      placeAhead: 2.2,
      /**
       * How far below the placement point the ground may be before the mine
       * refuses to go down. Stops one being laid off a rooftop and left
       * hanging in the air above the street.
       */
      dropMax: 2.5,
    },
    /**
     * The splash. Wider inside than a rocket's and shorter overall: a mine
     * goes off UNDER something, so what it throws goes up rather than out.
     */
    blast: {
      radius: 6,
      inner: 2.6,
      damage: 250,
      power: 2,
    },
    /**
     * How a mine is carried — held in both hands rather than shouldered, so
     * most of this is the opposite of the launcher's.
     */
    carry: {
      /** Two a second is as fast as a man can set one down and stand up. */
      fireRate: 2,
      /** Where one can be placed, which is arm's length. */
      range: 3,
      /** Nothing is fired, so nothing kicks. */
      recoilMult: 0,
      yawBias: 0,
      bloomMult: 0,
      /** Nothing to look through, so the blend is quick and means nothing. */
      adsSpeedMult: 1.2,
      swayMult: 0.9,
      /**
       * Held out in both hands and HIGH — the opposite of the launcher's
       * numbers, because the thing is a flat plate a third of a metre across
       * and the frame sees a plate edge-on as a bar. `hipPos.y` has already
       * spent 0.185 taking the weapon down out of the middle of the screen,
       * and most of that has to come back for a mine to be a mine.
       */
      hipZ: -0.02,
      hipY: 0.15,
      /** A plate held square in both hands has no reason to be turned. */
      hipYaw: 0,
      /** Quicker up than the launcher: it is a dinner plate, not a tube. */
      drawTime: 0.55,
      /**
       * Never played — `Sfx.mineSet` voices a mine going down, and nothing
       * about setting one down is a gunshot. It is here because a
       * `WeaponSetup` has a voice and the all-ones row is the honest way to
       * say "this one has nothing to say".
       */
      report: {
        pitch: 1, level: 1, snap: 1, weight: 1,
        length: 1, tail: 1, actionPitch: 1, actionVol: 1,
      },
    },
  },
} as const;

/**
 * What the AI does with a launcher, and the whole of what it is allowed to do
 * with one.
 *
 * **A bot's launcher is for ARMOUR and nothing else.** It is never fired at a
 * body, at any range, for any reason — a rocket is a one-shot kill on
 * infantry with a blast radius five metres across, and sixteen bots that
 * could reach for one would turn every firefight into indirect fire. The
 * rule lives in `Bot.considerRocket` as a test on the target and here as the
 * reason for it.
 *
 * The band is the same shape as `CONFIG.grenade.bot`'s and exists for a
 * different reason: a grenade's band protects the thrower from their own
 * blast, and this one is about a shot being worth taking. Inside `minRange` a
 * bot standing next to a tank should be running away from it, and past
 * `maxRange` a rocket spends two and a half seconds in the air against a hull
 * that is probably somewhere else by the time it arrives.
 */
export const antiTankBots = {
  /**
   * One bot in every squad of this many carries a launcher. Squads are four
   * (`CONFIG.bots.squadSize`), so a team of eight fields two — enough that a
   * tank in the open is under fire from somewhere, few enough that the crew
   * can find them.
   */
  perSquad: 1,
  /** Rockets a launcher bot carries per life. */
  carried: 2,
  /**
   * Seconds between one bot's rockets. Long: a launcher bot that could fire
   * every two seconds like the player is two thirds of a hull on its own.
   */
  cooldown: 9,
  /** Nearer than this and the bot has no business firing a rocket at all. */
  minRange: 14,
  /** Further and the flight time makes it a waste of a rocket. */
  maxRange: 75,
  /**
   * Chance per think tick, before skill. Scaled by `0.4 + skill` exactly as
   * the grenade's is, so an ace reaches for the launcher sooner rather than
   * aiming it better.
   */
  chance: 0.35,
  /**
   * Metres of scatter on the aim point, at `maxRange` and pro rata below it.
   * A launcher bot that hit a moving hull every time would be a guided
   * missile; this is what leaves a driver something to do about it.
   */
  scatter: 3.5,
} as const;
