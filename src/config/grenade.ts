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
 * the fragments stop in, tested with the same round question every shot in
 * this game asks (`RayWorld.blocked`) — so a fence between the two is not one. `damage` is deliberately over the 100 HP pool, so
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
  /**
   * The loadout's name, and the HUD's caption over the pouch. The frag is one
   * of the two throwables (`entities/throwables.ts`); the other is
   * `CONFIG.molotov`, which is thrown on this file's arc.
   */
  name: "Frag Grenade",
  short: "FRAG",
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
   * **It is DRAWN, not composited** (`systems/BlastFx.ts`, `BlastShader`):
   * every shape in the air is a lumpy billow in one material that is fire
   * while it is hot and smoke once it is not, lit by the map's own key light,
   * edged by the frame's own ink, and broken into wisps at the end rather than
   * faded. It is EIGHT layers over about four seconds, with a mark that
   * outlives them by ten, listed here in the order the eye gets them —
   * because that ordering IS the effect:
   *
   * | layer | when | what it says |
   * | --- | --- | --- |
   * | `flash` | 0 – 0.14 s | something detonated HERE |
   * | `fireball` | 0 – 0.6 s | and it was this big — and then it is smoke |
   * | `surge` | 0 – 1.6 s | and it reached this far along the ground |
   * | `sparks` | 0 – 0.7 s | and it threw hot metal |
   * | `trails` | 0 – 1.7 s | some of which is still burning as it falls |
   * | `debris` | 0 – 6 s | out of THIS ground (`BlastDebrisSystem`) |
   * | `column` | 0 – 4.2 s | and is now a column you can see from the flag |
   * | `scorch` | 0 – 15 s | and this is where it happened |
   *
   * **The single most load-bearing thing about the list is that the FIRE is
   * SHORT.** The flash and the fireball's fire are over inside two-thirds of a
   * second between them; what makes a blast read as violent is not how long
   * the fire lasts but how fast it arrives and how much is still going on after
   * it has gone. Lengthening the fire is the first thing anybody reaches for
   * and it is the one change that makes the whole thing read as a special
   * effect rather than as an explosion. The fireball's billows LIVE on as
   * smoke, which is not the same thing: what outlasts the fire is its shape.
   *
   * Every figure below is metres, seconds or m/s at a `power` of 1. `power`
   * scales every size, reach and speed and every COUNT, and never a time.
   */

  /**
   * Concurrent blasts drawn at once. A slot is ONE mesh — a unit sphere
   * thin-instanced once per billow — so a blast is one draw call however many
   * billows it holds, and a slot's life is its longest billow's, about four
   * seconds.
   */
  blastSlots: 4,
  /**
   * Billows one slot can hold. A grenade uses about 30 and a tank shell (1.85)
   * about 50; the rest is headroom, since a billow that does not fit is simply
   * not drawn.
   */
  blastBillows: 64,

  /**
   * The white-hot core: the first frame and the two after it.
   *
   * One billow that arrives already large and is gone before the eye has
   * resolved it, which is what fixes the position of everything else — the
   * fireball's billows are deliberately scattered and the column is
   * deliberately lifted, so without this there is nothing at the detonation
   * point itself.
   *
   * `radius` is the DRAWN radius at full expansion and it is bigger than the
   * fireball's own billows on purpose: it is the part that overexposes.
   * `BlastDebrisSystem` reads it too, for where its chunks start.
   */
  flash: {
    radius: 3.4,
    life: 0.14,
  },

  /**
   * The fireball, which is a CLUSTER of billows and not a ball.
   *
   * One expanding sphere is a balloon; `billows` of them, each out along its
   * own bearing off the golden angle, each with its own size and its own start
   * inside `stagger`, churn instead — the outline changes shape while it grows.
   *
   * **Each is handed `heat` at birth and loses it over `life`**, and the
   * material does the rest: at full heat a billow is fire to its rim with a
   * white heart, and as the heat falls the smoke closes over it FROM THE
   * OUTLINE INWARD, an oxblood pen line where the two meet, until what is
   * left at `life` is a billow of soot. That billow then hangs on for `smoke`
   * more seconds, growing to `grow` times its fire size and climbing toward
   * `rise`, before it breaks into wisps — so the fireball's smoke is the
   * fireball's own shape, where it used to be a second effect laid over it.
   *
   * `spread` is how far a billow travels out of the detonation, most of it in
   * the first quarter of a second (`drag`); `rise` is its climb, and matters
   * more than it looks — a fireball that does not climb at all sits in the
   * ground like a light being switched on.
   */
  fireball: {
    billows: 9,
    radius: 1.55,
    spread: 1.6,
    drag: 7,
    stagger: 0.13,
    life: 0.6,
    heat: 1.6,
    rise: 2.4,
    smoke: 2.0,
    grow: 1.2,
  },

  /**
   * The COLUMN: the billows a blast throws straight up, and the layer that
   * makes a blast legible from the other end of the map.
   *
   * Born over the first `delay` seconds a little above the detonation
   * (`lift`), thrown up at `speed` and slowed by `drag` toward the climb their
   * own buoyancy holds (`rise`), so they arrive stacked rather than as one
   * ball. The first are still hot when they leave (`heat`), which is what
   * joins the column to the fire under it. They are soot, like the fireball's
   * smoke, and each dissolves over the last `1 - fade` of its life.
   */
  column: {
    billows: 10,
    delay: 0.45,
    lift: 0.9,
    speed: 9,
    drag: 1.6,
    rise: 1.7,
    from: 0.5,
    to: 1.35,
    life: 3.8,
    heat: 0.95,
    fade: 0.4,
  },

  /**
   * The SURGE: the ring of low dust the pressure wave rolls out along the
   * ground, and the one layer that says how far the blast REACHED.
   *
   * It is a ground-plane cue on purpose — the fireball and the column are both
   * read against the sky, so neither tells a player standing thirty metres
   * away whether they were inside it. The billows run out flat to whatever
   * the blast went off on, most of the way in the first third of a second
   * (`drag`), so the ring's edge arrives as a pressure wave does and then
   * hangs as a skirt of dust. They are the map's FLOOR, lit — see `BlastFx`.
   *
   * `reach` is deliberately under `blastRadius`: it is where the outermost
   * billow comes to rest, not where the damage stops, and a ring drawn at the
   * true 8.5 m would be a promise the falloff does not keep. `squash` is how
   * flat a billow is along the ground's normal, which is what keeps a skirt of
   * dust from reading as a ring of boulders.
   */
  surge: {
    billows: 14,
    reach: 6.2,
    drag: 4.5,
    rise: 0.9,
    from: 0.35,
    to: 1.25,
    squash: 0.7,
    life: 1.4,
    fade: 0.04,
  },

  /**
   * Hot metal: strokes flung out on an even-ish spread (a handful of random
   * directions clumps, and a clump reads as one lump of debris), each drawn
   * out along its own flight by `stretch` seconds of travel so it reads as a
   * streak rather than as a dot.
   */
  sparks: {
    count: 22,
    speed: 17,
    life: 0.7,
    gravity: 16,
    width: 0.05,
    stretch: 0.045,
  },

  /**
   * The few fragments that go on BURNING: `streamers` heavier pieces thrown
   * out and up, each laying a trail of small billows every `every` seconds for
   * `life` — hot at the head, soot a moment later — so a blast throws arcs of
   * smoke that hang where the metal went. The single most drawn-looking thing
   * about an explosion, and the cheapest: each puff is a billow in one shared
   * mesh.
   */
  trails: {
    streamers: 4,
    speed: 14,
    gravity: 13,
    drag: 0.8,
    life: 0.5,
    every: 0.03,
    from: 0.12,
    to: 0.55,
    puffLife: 1.2,
    heat: 1.35,
    hot: 0.14,
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
