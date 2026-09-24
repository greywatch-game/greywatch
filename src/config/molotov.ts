/**
 * config/molotov.ts — the other thing in the throwable slot: a bottle that
 * breaks where it lands and leaves the ground burning.
 * Owns: what a molotov carries, how it breaks, how big and how long the fire
 * it leaves is, what standing in it costs, and how it is drawn, lit and heard.
 * Contract: `docs/grenades.md` ("The molotov").
 * Gotcha: it is THROWN on the frag's numbers — `CONFIG.grenade.throwSpeed`,
 * `throwLift` and `gravity` — and deliberately states none of its own. The
 * bots' ballistic solve and its measured 8-30 m band were tuned against those
 * three, so a bottle that flew on its own would need that whole band
 * re-measured, and a player would have two arcs to learn for one gesture.
 */

/**
 * A MOLOTOV: the throwable a player picks INSTEAD of the frag, never beside
 * it — the pouch is one pick, which is what makes it a choice.
 *
 * **Where the frag is a moment, this is a place.** The frag's whole case is
 * the falloff at the instant of the blast; this does almost nothing at the
 * instant it lands and everything over the seconds after — a doorway, a
 * stairwell or a capture point a body cannot stand in for `fire.life`. That
 * is the trade and every number below is written for it: a burn that killed
 * as fast as a frag would be a frag with a longer fuse, and one that could be
 * stood in would be a picture.
 *
 * **It breaks on the first thing it touches**, with no fuse: a bottle does not
 * bounce, and a molotov that could roll through a doorway is a frag. So there
 * is no rest, no restitution and no pip — `maxFlight` is only a backstop for a
 * bottle thrown at nothing.
 *
 * **Friendly fire is excluded by construction**, for the frag's reason: the
 * fire resolves against the THROWER's target list, fetched on every tick of
 * the burn rather than at the throw, so a fire cannot burn its own side
 * including the thrower. **A hull does not burn** — a sixty-tonne tank parked
 * in a puddle of petrol is the one target this cannot touch, and the anti-tank
 * slot is where that question is answered.
 */
export const molotov = {
  /** The loadout's name, and the HUD's caption over the pouch. */
  name: "Molotov",
  short: "MOLOTOV",
  /** Carried per life. Refilled by death and by nothing else, as the frag is. */
  carried: 2,
  /**
   * Collision radius (m) of the bottle in flight. Only the flight reads it —
   * the drawn bottle is `MolotovModel`'s — and it is smaller than the frag's
   * because a bottle turned end over end is a narrower thing to catch a rail
   * with than a ball.
   */
  radius: 0.08,
  /**
   * Seconds a bottle may fly before it is broken where it is. A backstop, not
   * a fuse: everything a player can throw at lands long before this, and the
   * terrain under the colliders catches anything that slips a seam.
   */
  maxFlight: 5,
  /**
   * How far down from where the bottle broke the fire looks for a floor to
   * burn on (m). A bottle thrown into a wall breaks at head height, and the
   * petrol runs DOWN it: the fire is on the ground under the impact, not
   * stuck to the wall in mid-air. Past this, nothing is found and the terrain
   * answers — which is what a bottle broken on a rooftop parapet wants.
   */
  dropReach: 8,

  /**
   * The fire itself: a disc on the ground at the break, `radius` across, for
   * `life` seconds.
   */
  fire: {
    /**
     * Metres. Wide enough to fill a doorway and the room just inside it, and
     * well under a street — a fire that closed a road would stop being a
     * choice about WHERE and become a wall.
     */
    radius: 3.4,
    /** Seconds from the break to the last flame out, `fade` included. */
    life: 8,
    /** Seconds the flames take to reach full size — the whoosh. */
    grow: 0.35,
    /** Seconds at the end over which the fire dies down and stops hurting. */
    fade: 1.4,
    /**
     * Damage a second to anybody standing in it — resolved in `tick`-second
     * steps so the cost is a handful of line-of-sight rays a second rather
     * than one a frame.
     *
     * **Set against the 100 HP pool so that CROSSING it is survivable and
     * STANDING in it is not**: a sprint across 6.8 m at a run is under a
     * second, which is about a third of a body; three seconds in it is dead.
     * That is the denial the item is for — somebody has to go round, or wait.
     */
    dps: 36,
    tick: 0.25,
    /**
     * The vertical band a victim's centre has to be in to be burning, as metres
     * below and above the fire's floor. A body standing in it has its centre a
     * metre up; a body on the floor ABOVE a fire in a stairwell is not in it,
     * and the line-of-sight ray is what stops one standing behind the wall
     * beside it.
     */
    below: 0.7,
    above: 2.2,
    /**
     * How far above the floor the fire's own point of view is, for that
     * line-of-sight ray — a burn is from the flames, not from the pavement, and
     * a ray cast along the ground grazes every kerb it crosses.
     */
    losLift: 0.5,
  },

  /**
   * Concurrent fires. An exhausted pool puts out the OLDEST rather than
   * refusing, which is the dust's rule and not the grenade pool's: the bottle
   * is already spent and broken by the time a slot is wanted, so there is no
   * count left to protect, and a bottle that broke and burned nothing is the
   * worse lie.
   */
  fires: 6,

  /**
   * How the fire is DRAWN: `flames` of the world's one fire material
   * (`FlameMaterial`, over `world/flame.ts`'s geometry) spread over the disc,
   * each a fire in its own right and sized off `flameRadius`/`flameHeight`
   * with a per-flame spread. Ten is what it took for the EDGE of the disc to
   * read as burning — at seven, photographed from twenty metres, the patch
   * was a cluster in the middle and the rim that decides where a player may
   * walk was not drawn at all.
   */
  flames: 10,
  flameRadius: 0.6,
  flameHeight: 1.15,

  /**
   * The ignition, as a share of the one blast in the game (`blastAt`'s
   * `power`, the frag being 1) — the flash and the fireball's lobes and the
   * embers, without the shock ring: petrol going up is a WHOOSH, not a
   * pressure wave, and the ring is the one layer that says "this far and no
   * further", which here is the fire's own edge.
   */
  ignition: 0.45,
  /** The smoke column it sends up, on the same scale. Darker and longer is the fire. */
  smoke: 0.8,
  /**
   * The mark it leaves, as a share of `CONFIG.grenade.scorch.radius`. Bigger
   * than a frag's: the frag's scorch is where a charge went off, this is where
   * the ground burned for eight seconds.
   */
  scorch: 1.55,

  /**
   * Its light: a fixture that appears at the break and is taken away when the
   * fire goes out (`LightingSystem.add`/`remove`, the "thrown fire" those two
   * were written for), eased in and out with the flames. Warmer and wider than
   * a fire drum's — this is a street on fire, not a barrel.
   */
  light: {
    color: "#ff8a32",
    range: 16,
    intensity: 2.6,
    flicker: 0.5,
    /** Metres above the fire's floor — the middle of the flames, not the petrol. */
    y: 0.9,
  },

  /**
   * Its sound once it is burning: the burning drum's graph
   * (`CONFIG.audio.ambience.fire`) with these three terms restated, because a
   * patch of burning road is a bigger, louder fire heard from further off —
   * and a second graph for it would be a second place a fire's spectrum is
   * argued. The break itself is `Sfx.molotov`.
   */
  sound: {
    range: 34,
    refDistance: 3,
    level: 0.15,
  },

  /**
   * Which bots carry one instead of a frag: the LAST `perSquad` bodies of each
   * squad — a fixed slot rather than a roll, the launcher's rule from the other
   * end of the squad (the launcher is its FIRST body), so a squad fields the
   * same kit every round on both sides of the wire.
   *
   * They throw on the frag's decision (`CONFIG.grenade.bot`) — the same range
   * band, the same chance, the same cooldown — and only the scatter is theirs:
   * a fire three metres across is worth nothing two and a half metres from
   * where it was meant to be.
   */
  bot: {
    perSquad: 1,
    scatter: 1.2,
    /**
     * Seconds a bot runs straight away from a fire after each burn. A bot has
     * no idea where a fire's edge is, so this is refreshed on every tick it is
     * still burning and runs out a beat after it has cleared the disc — at a
     * run that is two metres of margin, which is what stops it stepping back
     * in on the next think tick. This is the reflex every bot has, whatever it
     * carries: it is about being ON fire, not about throwing one.
     */
    escape: 0.6,
  },
} as const;
