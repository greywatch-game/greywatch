/**
 * config/grenade.ts — the one thing in the game that is not hitscan.
 * Owns: the throw, the bounce, the fuse, the blast, and the eight layers the
 * blast is DRAWN as — which the tank's shell scales off rather than restating.
 * Contract: `docs/grenades.md`.
 * Gotcha: `damage` is deliberately over the 100 HP pool — the falloff to
 * `blastRadius` is where all the play is.
 * Gotcha: everything under "The blast, as a picture" is quoted for the GRENADE.
 * `blastAt` takes a `power` and the grenade passes 1; nothing else in the game
 * describes a blast, so a number moved here moves the tank gun with it.
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
  /**
   * ## The blast, as a picture
   *
   * Everything from here to `scorch` is what a detonation LOOKS like, and it is
   * written for the grenade because the grenade is the reference: `blastAt`
   * takes a `power` and the grenade passes 1, exactly as every number in the
   * rifle's `report` is 1 and every other weapon is a deviation from it. A tank
   * shell is `CONFIG.vehicles.tank.gun.blastPower` of this and nothing else —
   * there is one blast in this game and one set of numbers describing it.
   *
   * It is EIGHT layers over about four seconds, with a mark that outlives them
   * by ten, listed here in the order the eye gets them — because that ordering
   * IS the effect:
   *
   * | layer | when | what it says |
   * | --- | --- | --- |
   * | `flash` | 0 – 0.14 s | something detonated HERE |
   * | `fireball` | 0 – 0.6 s | and it was this big |
   * | `shock` | 0 – 0.34 s | and it reached this far along the ground |
   * | embers | 0 – 0.8 s | and it threw hot metal |
   * | `debris` | 0 – 6 s | out of THIS ground (`BlastDebrisSystem`) |
   * | `dust` | 0 – 2.4 s | which is still hanging in the air |
   * | `smoke` | 0 – 4 s | and is now a column you can see from the flag |
   * | `scorch` | 0 – 15 s | and this is where it happened |
   *
   * **The single most load-bearing thing about the list is that the top of it
   * is SHORT.** The flash and the fireball are over inside two-thirds of a
   * second between them; what makes a blast read as violent is not how long the
   * fire lasts but how fast it arrives and how much is still going on after it
   * has gone. Lengthening the fireball is the first thing anybody reaches for
   * and it is the one change that makes the whole thing read as a special
   * effect rather than as an explosion.
   */

  /**
   * Concurrent blasts drawn at once. Each slot is a flash, `fireball.lobes`
   * lobes and a shock ring — 4 x 7 = 28 meshes, built once and invisible
   * between detonations, exactly as the fireball's six spheres always were.
   *
   * Four rather than six because a blast is now three layers of mesh instead of
   * one, and because it is the same number as `dust.clouds`: the two pools are
   * claimed together and a fifth fireball over four clouds would be a bang with
   * nothing hanging in the air after it.
   */
  blastSlots: 4,

  /**
   * The white-hot core: the first frame and the two after it.
   *
   * A sphere that arrives already large and is gone before the eye has resolved
   * it, which is what fixes the position of everything else — the fireball's
   * lobes are deliberately scattered and the dust is deliberately lifted, so
   * without this there is nothing at the detonation point itself.
   *
   * `radius` is the DRAWN radius at full expansion and it is bigger than the
   * fireball's own lobes on purpose: it is the part that overexposes.
   */
  flash: {
    radius: 3.4,
    life: 0.14,
  },

  /**
   * The fireball, which is a CLUSTER and not a ball.
   *
   * One expanding sphere is a balloon: it is perfectly round, it grows at one
   * rate, and the eye reads the silhouette as a primitive because that is what
   * it is. `lobes` spheres, each born at its own offset inside `spread`, each
   * with its own size and its own start delay inside `stagger`, churn instead —
   * the outline changes shape while it grows, which is the whole of what
   * separates fire from a sphere.
   *
   * **Colour is a LADDER of four shared materials rather than an animated
   * one**, and that is `CelMaterialFactory.getEmissive`'s doing rather than a
   * saving: it hands out one material per colour to the whole game, so a lobe
   * that animated its own `emissiveColor` would repaint every brazier flame and
   * tracer that happened to share the hex. A lobe swaps material as it ages
   * instead, which is four steps down `FIRE_LADDER` and costs nothing.
   *
   * `rise` is small and matters more than it looks: a fireball that does not
   * climb at all sits in the ground like a light being switched on, and one
   * that climbs like the smoke does turns into a mushroom two seconds early.
   */
  fireball: {
    lobes: 5,
    radius: 2.9,
    spread: 0.9,
    stagger: 0.13,
    life: 0.6,
    rise: 2.4,
  },

  /**
   * The ring the pressure wave drives out along the ground: born at the
   * detonation, flat to whatever the blast went off ON, out to `radius` inside
   * `life` and gone.
   *
   * It is the only layer that says how far the blast REACHED, and it is a
   * ground-plane cue on purpose — the fireball and the smoke are both read
   * against the sky, so neither of them tells a player standing thirty metres
   * away whether they were inside it. This does, in a third of a second,
   * without a number on the HUD.
   *
   * `radius` is deliberately under `blastRadius`: it is where the ring has
   * faded to nothing rather than where the damage stops, and a ring drawn at
   * the true 8.5 m would be a promise the falloff does not keep.
   */
  shock: {
    radius: 6.2,
    life: 0.34,
    /** How flat the ring lies. 1 is a torus; this is a wave, not a doughnut. */
    squash: 0.35,
    /**
     * Alpha at birth. Capped well under 1 because the ring is unlit emissive
     * and inside the glow layer — at full alpha it blooms into a solid band of
     * light lying on the street, which reads as a magic circle rather than as
     * a pressure wave. See `GrenadeSystem.poseRing`.
     */
    peak: 0.5,
  },

  /** Embers flung out of the blast: count, speed, lifetime, gravity. */
  emberCount: 18,
  emberSpeed: 15,
  emberLife: 0.8,
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
   * `BlastDust.setEnvironment`.
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
     * the point of the whole effect: the fireball is 0.6 s, so anything
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
    speed: 3.4,
    settle: 0.06,
    /**
     * Upward acceleration (m/s^2). Small: this is a cloud lifting as it
     * spreads, not a mushroom.
     */
    rise: 0.8,
    /** Puff diameter (m) at birth and at the end, and the spread over both. */
    sizeStart: 1.4,
    sizeEnd: 3.1,
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
   * The column that goes UP, and the layer that makes a blast legible from the
   * other end of the map.
   *
   * The same `BlastDust` class and the same eighteen keys — a cloud is a cloud,
   * and a second implementation of one would be a second place the GPU burst's
   * four Babylon constraints have to be remembered. What makes it smoke rather
   * than dust is entirely in the numbers: fewer puffs, much bigger, much
   * longer-lived, a real `rise` instead of a nudge, and a `lit` near zero so it
   * reads as the dark side of the fire rather than as more of the ground.
   *
   * **It is drawn as well as the dust and not instead of it**, and the pair is
   * the whole point: the dust is what a body standing next to the blast sees
   * and the smoke is what everybody else does. Costed as fill — 14 puffs at up
   * to 6 m against the dust's 34 at up to 3.1 — this is the cheaper of the two.
   */
  smoke: {
    clouds: 4,
    puffs: 14,
    life: 4,
    radius: 0.8,
    height: 1,
    lift: 1.6,
    speed: 1.7,
    settle: 0.05,
    /** The one number that makes this a column: it climbs the whole time. */
    rise: 2.9,
    sizeStart: 2.2,
    sizeEnd: 6,
    sizeSpread: 0.5,
    opacity: 0.4,
    /** Near zero — smoke is the fire's shadow, not the ground's colour. */
    lit: 0.12,
  },

  /**
   * What the blast tears out of the ground and throws: `BlastDebrisSystem`,
   * under Havok, and the one layer here that is neither a billboard nor a
   * primitive on a clock.
   *
   * **It is keyed on the SURFACE** — one downward ray at the detonation,
   * reading the same `metadata.surface` a bullet's impact reads, so a grenade
   * in a field throws clods of the map's own earth and one in a stairwell
   * throws pale rubble. That is the whole reason it is worth having: an
   * explosion that throws identical grey chips everywhere is an explosion that
   * has not noticed where it went off.
   *
   * Everything else about it is `DebrisSystem`'s contract restated, because it
   * is the same deal with the same engine: pooled bodies built once, a burst
   * that evicts only what has already landed, an apparent-size distance gate,
   * and nothing under it deciding anything.
   */
  debris: {
    /** Concurrent bursts, and chunks in one. 3x10 = 30 bodies; see the header. */
    bursts: 3,
    chunks: 10,
    /**
     * Chunk half-extents (m), the band a piece's three axes are drawn from at
     * CONSTRUCTION rather than at the burst — the variety is baked into the
     * pool, so a burst never builds a collision shape. See `BlastDebrisSystem`.
     */
    sizeMin: 0.045,
    sizeMax: 0.15,
    /** Mass (kg) of a chunk at `sizeMax`; everything smaller scales by volume. */
    mass: 1.6,
    /**
     * How hard a chunk leaves (m/s), how much of that is UP rather than out,
     * and the spin on it (rad/s).
     *
     * The lift is high and has to be: a chunk thrown flat out of a blast on
     * flat ground travels a long way at knee height and is read as a bouncing
     * ball, while one thrown up comes back down inside the crater, which is
     * where a player is looking.
     */
    speed: 11,
    lift: 0.85,
    spin: 16,
    /** Seconds a chunk lies where it landed, then how long it takes to sink. */
    life: 6,
    sink: 1.2,
    /**
     * Metres. Past this the burst is refused outright — a 15 cm chunk is a
     * pixel at eighty metres, and the blast has six other layers that carry at
     * that range. Quoted for `sizeMax` and scaled by the chunk pitch exactly
     * as `glass.shardDistance` is.
     */
    distance: 80,
  },

  /**
   * The mark left on the ground, and the only layer that is still there when
   * you walk back through a minute later.
   *
   * A flat disc laid on whatever the blast went off on, oriented to that
   * surface's own normal, dark in the middle and ragged at the edge. It is
   * alpha-blended with `disableDepthWrite` and a negative `zOffset` — a decal
   * has to lose the depth fight with the floor it is lying on, and those two
   * are what stop it z-fighting on a heightfield instead of a lift big enough
   * to make it hover on a slope.
   *
   * `radius` is well inside the fireball's, because a scorch is what the ground
   * KEPT: the fire reached much further than the mark it left.
   */
  scorch: {
    /** Concurrent marks. The oldest is reused, so a mark can be cut short. */
    marks: 8,
    radius: 2.1,
    /** Seconds it holds full strength, then how long it takes to fade out. */
    life: 10,
    fade: 5,
    /**
     * How far the mark darkens what it lies on at full strength — the alpha of
     * a MULTIPLY, so the ground under the middle of it keeps `1 - opacity` of
     * itself and the rim keeps all of it.
     *
     * **A stain, not a hole**, and the number is what decides which. At 0.62
     * the cobbles under a grenade crater are down to a third of themselves,
     * which takes their pattern out entirely and reads as a shaft cut in the
     * street; at 0.4 the stone still comes through the soot, which is what a
     * scorch is. Anything that removes the surface's own detail has gone too
     * far, whatever it looks like in isolation.
     */
    opacity: 0.4,
    /** Metres it stands off the surface, before `zOffset` does the real work. */
    lift: 0.035,
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
