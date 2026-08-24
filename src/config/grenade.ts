/**
 * config/grenade.ts — the one thing in the game that is not hitscan.
 * Owns: the throw, the bounce, the fuse and the blast. Contract:
 * `docs/grenades.md`.
 * Gotcha: `damage` is deliberately over the 100 HP pool — the falloff to
 * `blastRadius` is where all the play is.
 */

/**
 * Fragmentation grenades. Everyone — the player and every bot — spawns with
 * `carried` of them and there is no resupply: two a life is the whole
 * economy, which is what makes each one a decision rather than a second
 * trigger.
 *
 * This is the one weapon in the game that is NOT hitscan, and the numbers
 * below are what pay for that. A thrown grenade is a body with a fuse: it
 * flies, it bounces off the same collider proxies bullets stop on, and it
 * goes off `fuse` seconds after it leaves the hand whatever it has hit on
 * the way. Cooking is deliberately absent — the fuse starts on release —
 * because a cook needs a hold-to-charge input on a button that is also the
 * pad's only free bumper, and the arc is already the skill.
 *
 * The blast is `damage` inside `innerRadius`, falling linearly to nothing at
 * `blastRadius`, and it needs line of sight: a wall between the two is a wall
 * the fragments stop in, tested with the same `OPAQUE_ONLY` ray every round in
 * this game is — so a fence between the two is not one. `damage` is deliberately over the 100 HP pool, so
 * a grenade that lands ON someone kills, and one that lands near them
 * softens them up — the falloff is where all the play is.
 *
 * Friendly fire is excluded the same way `CombatSystem.fire` excludes it: by
 * the target list the thrower is handed, never by a team check at the point
 * of damage. A grenade cannot hurt its own side, including the thrower. That
 * is a game decision rather than a physical one, and the alternative — bots
 * routinely killing their own squad with a lobbed frag — is not a fight
 * anybody wants to be in.
 */
export const grenade = {
  /** Carried per life. There is no way to pick more up yet. */
  carried: 2,
  /** Seconds from leaving the hand to detonation. Not resettable, not cookable. */
  fuse: 2.6,
  /**
   * Launch speed (m/s) and the upward tilt added to the aim direction
   * (radians). The lift is what makes a throw at a flat horizon land out in
   * front of you instead of at your own feet; aiming up adds to it as it
   * should.
   *
   * The speed is bounded from below by the bots, not by the player: a
   * projectile's flat range is `v^2 / g`, so 24 against a gravity of 18 can
   * reach 32 m and `bot.maxRange` has to fit inside that or the ballistic
   * solve refuses every throw the AI ever asks for. Measured on flat ground,
   * a level throw from a standing eye first lands at 21 m and detonates at
   * 23; aiming 11 degrees up reaches 30 and 26 degrees reaches 35, so where
   * you are looking genuinely decides the throw.
   *
   * Against the exaggerated 18 m/s^2 gravity this is the same arc a 17.7 m/s
   * throw would take under real gravity — a strong overhand, not a mortar.
   */
  throwSpeed: 24,
  throwLift: 0.28,
  /**
   * Where the player's throw starts is the VIEWMODEL's throwing hand, not a
   * point measured off the eye: the grenade you watched the hand cock back
   * is the one that flies, which is the whole difference between a throw and
   * a muzzle. This is the one thing left of the old fixed offset — a FLOOR
   * on how far ahead of the eye the release may be, so a throw taken with a
   * wall at your shoulder cannot spawn the grenade inside the wall, where
   * its first act would be to bounce back into your face. The hand is
   * normally well past it (see `viewmodel.throw.handRelease`), so it only
   * bites if that pose is ever pulled in.
   */
  handAhead: 0.5,
  /**
   * Seconds between the player's throws — the arm, not the fuse. Long enough
   * to cover the whole of `viewmodel.throw` (wind-up plus recovery), so the
   * hand is out of frame before another throw can start it over.
   */
  throwInterval: 0.7,
  gravity: 18,
  /** Collision radius (m); also the drawn size. */
  radius: 0.11,
  /**
   * Bounce: the fraction of the normal speed kept across an impact, and the
   * fraction of the tangential speed friction leaves behind. A frag is a lump
   * of steel and does not bounce like a ball — low restitution is what keeps
   * a grenade thrown into a room in that room, which is the whole reason to
   * throw one through a doorway.
   *
   * The FRICTION is the one that decides how the AI plays, and it is tuned
   * against the roll rather than against the bounce: `throwAt` solves for the
   * grenade to *arrive* at a point, and everything after that is overshoot.
   * At 0.5 a bot's grenade skated 4-6 m past its target; at 0.3 it settles
   * 0.7-1.8 m past across the whole 11-30 m band, which is well inside the
   * scatter and reads as a throw rather than as a skim.
   */
  restitution: 0.25,
  friction: 0.3,
  /** Below this speed, resting on a floor, it stops rolling. */
  restSpeed: 1.1,
  /** Full damage inside this radius, falling linearly to nothing at the next. */
  innerRadius: 2.6,
  blastRadius: 8.5,
  damage: 130,
  /**
   * Pool size. Seventeen combatants with two each is 34 in theory and never
   * anything like it in practice — but an exhausted pool REFUSES the throw
   * rather than stealing a live grenade's slot, so the count is never spent
   * on something that does not arrive.
   */
  poolSize: 20,
  /**
   * The blast's kick on the camera, as a fall speed handed to
   * `CameraSystem.land` — the eye taking a concussion is the same damped
   * spring as the eye taking a landing, so there is one integrator for both.
   * Scaled by the same falloff the damage uses.
   */
  shakeSpeed: 13,
  /**
   * The throw's own follow-through on the eye, through the same spring and
   * for the same reason there is only one of them: a whole body goes into
   * an overhand throw, and a view that does not move at all while the arm
   * does reads as the arm being a decal. Small — this is a nod, not a
   * landing — and it fires on the release edge, so the eye dips as the
   * grenade leaves rather than when the button went down.
   */
  throwShake: 4.5,
  /** Fireball: how far it expands, and how long the whole flash lasts. */
  blastVisualRadius: 4.2,
  blastVisualTime: 0.42,
  /** Embers flung out of the blast: count, speed, lifetime, gravity. */
  emberCount: 14,
  emberSpeed: 13,
  emberLife: 0.75,
  emberGravity: 16,

  /**
   * The dust the blast throws up: a low cloud that expands out of the crater
   * and hangs on well after the light has gone. The embers read as debris
   * and are what a blast throws OUT; this is what it lifts off the ground,
   * and it is the half that makes a grenade in a cobbled square leave
   * something behind it.
   *
   * It is a GPU burst rather than a pooled mesh, which is affordable for
   * exactly the reason the blast light is exempt from the muzzle-light
   * budget: there are seconds between detonations. A per-shot effect could
   * not be built this way (see the note on muzzle smoke in
   * `spec_visuals.md`).
   *
   * Colour is NOT here. Dust is the ground and the air it hangs in, so it is
   * tinted from the map's own `mistColor` and key light — see
   * `GrenadeSystem.setEnvironment`.
   */
  dust: {
    /**
     * Concurrent clouds, and puffs in one. `clouds` is a count of GPU
     * systems rather than of slots in a pool, and it cannot be folded into
     * one system holding `clouds * puffs` — see `BlastDust`.
     */
    clouds: 4,
    puffs: 34,
    /**
     * Seconds from the blast to the last puff fading out. Long, and that is
     * the point of the whole effect: the fireball is 0.42 s, so anything
     * under about two seconds here is over while the light is still in the
     * frame and the blast leaves nothing behind it.
     */
    life: 2.4,
    /**
     * The disc the puffs are born in: about the fireball's own first radius,
     * and flat, so the cloud starts as something lying on the ground rather
     * than as a ball in the air.
     */
    radius: 1.1,
    height: 0.6,
    /**
     * How far above the detonation that disc sits. A puff is a BILLBOARD
     * metres across, so one centred where the grenade actually went off —
     * which is a radius above the floor — has its whole lower half under the
     * cobbles, and the cloud reads as a flat smear painted on the street
     * rather than as something standing in it. This lifts the disc to about
     * knee height, which is what a quad this size needs to clear the ground
     * it is rising off. It is not the blast's own height: the damage, the
     * light and the embers all still resolve where the grenade was.
     */
    lift: 0.75,
    /**
     * How fast a puff leaves the centre (m/s), and the fraction of that it
     * still has at the end of its life. Dust is thrown out hard and then
     * stops in the air — a cloud that expands at a constant rate reads as a
     * shockwave, and one that never slows walks off the map.
     */
    speed: 2.6,
    settle: 0.06,
    /**
     * Upward acceleration (m/s^2). Small: this is a cloud lifting as it
     * spreads, not a mushroom.
     */
    rise: 0.8,
    /** Puff diameter (m) at birth and at the end, and the spread over both. */
    sizeStart: 1.4,
    sizeEnd: 2.9,
    sizeSpread: 0.45,
    /**
     * Alpha of one puff at birth, falling linearly to nothing at the end of
     * its life. Dust occludes rather than glows (`BLENDMODE_STANDARD`), so
     * this is how much of the world behind it a single quad takes away, and
     * three dozen of them overlap.
     *
     * It is set for how the cloud reads at HALF life rather than at birth:
     * the fade is linear and cannot be curved (see `BlastDust`), so a
     * number chosen to look right on the first frame leaves nothing by the
     * time the fireball is out — which is the half this exists for.
     */
    opacity: 0.7,
    /**
     * How far the tint is lifted from the map's mist toward its key light.
     * At 0 the cloud is the colour of the air it hangs in, which on a night
     * map is very nearly black; at 1 it is the moon. Dust is lit by the
     * moon and made of the ground, so it sits between them.
     */
    lit: 0.5,
  },

  /**
   * When a bot throws one. Considered on its ordinary think tick rather than
   * on a timer of its own — it is a decision about a target it already has,
   * and a bot with no target has nothing to throw at.
   *
   * The range band is the whole safety model: a bot has no idea where its own
   * blast reaches, so it is simply never allowed to throw at something close
   * enough to catch itself. The far end is where the ballistic solve starts
   * dropping grenades short of anything.
   */
  bot: {
    minRange: 11,
    maxRange: 30,
    /**
     * Chance per think tick, scaled by the bot's skill. At the 5 Hz think
     * rate this is roughly one throw every few seconds of sustained contact
     * for an ace and rather less for a rookie — the point is that a grenade
     * arrives when you have been holding one position too long, not that it
     * arrives on a schedule.
     */
    chance: 0.06,
    /** Seconds before the same bot may throw again. */
    cooldown: 8,
    /** Aim scatter on the landing point (m). Bots are not mortars. */
    scatter: 2.4,
  },
} as const;
