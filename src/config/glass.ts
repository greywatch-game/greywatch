/**
 * config/glass.ts — Breakable glazing: what a pane costs to notice, what
 * breaking one throws, and how far a shard is worth simulating.
 * Owns the `glass` key of `CONFIG`. See `systems/GlassSystem.ts` for the sweep
 * and the break, and `systems/DebrisSystem.ts` for the shards.
 */
export const glass = {
  /**
   * How many panes one shot may break.
   *
   * A round crosses everything in its path — a window on the way in and the one
   * opposite on the way out is two, and a curtain-wall tower at a shallow angle
   * can be four — and it SHOULD break all of them. The cap is a bound on the
   * pathological case rather than a rule about glass: a shot down the long axis
   * of a glazed street would otherwise queue a break event per pane, and on the
   * wire that is one message per pane per shot.
   *
   * Six is comfortably past anything a real line of fire crosses (measured on
   * Coldharbour's densest block: three) and small enough that the worst case is
   * bounded.
   */
  maxPerShot: 6,

  /**
   * How far a piece of `shardMax` is worth drawing, in metres. A smaller piece
   * gates proportionally nearer, because the question is how big it looks
   * rather than how far away it is: this number over `shardMax` is the one
   * apparent size the gate is really made of, and a 0.35 m piece still stops
   * at ~44 m against the flat 60 m gate this replaced.
   *
   * Deliberately NOT the fog wall, which is what `RagdollSystem` gates on. That
   * number is "how far can anything be seen at all", and on Coldharbour it is
   * 480 m. A corpse is a body-sized thing worth tumbling wherever it can be
   * seen; a chip of glass is not.
   *
   * The break itself is not gated: the pane vanishes at any distance, because
   * that is the world changing rather than an effect playing.
   */
  shardDistance: 150,

  /**
   * Pieces thrown per pane, and how many panes' worth may be in the air at
   * once.
   *
   * A ragdoll is ten bodies and eight of them measured 0.121 ms/frame against
   * the whole roster's AI at 0.39–0.42 ms in the same run, so four panes of
   * twelve is forty-eight bodies — about five corpses. Raising either raises
   * that in proportion; they are two halves of one budget and want reading
   * together.
   *
   * Twelve is also what decides the SHAPE of a burst, because the crack
   * pattern is cut to fit it: `glassFracture` spends it on radials crossed by
   * rings, and twelve is six spokes crossed twice — the spider a sheet
   * actually makes. Six would be a rosette and twenty-four a mosaic. See
   * `DebrisSystem.burst`.
   */
  shards: 12,
  maxConcurrent: 4,

  /** Seconds a settled shard lies there before it starts sinking, and for how long. */
  shardLife: 3.5,
  shardSink: 1.2,

  /**
   * How old a burst must be before a new pane may take its slot, in seconds.
   *
   * The pool used to refuse outright, on `GrenadeSystem`'s rule — but a refused
   * burst is a window that came out of a building with no glass in it, which is
   * the one thing this whole system exists to stop. It evicts instead, and this
   * is what keeps the eviction from being its own artefact: a burst still in the
   * air is never stolen (glass that vanishes mid-fall is worse than glass that
   * never flew), while one already on the ground is fair game.
   */
  shardSteal: 1.6,

  /**
   * The size band a burst is cut at, in metres.
   *
   * A shard is NOT a fixed chip: it is a fraction of the pane it came out of,
   * because a hand of gravel under a shopfront that has just vanished is the
   * mismatch the player actually sees. `DebrisSystem` takes the pane's own
   * area over the budget — `sqrt(area / shards)` — and clamps that PITCH here,
   * so a 1.3 m window is cracked at 0.35 m where a shopfront bay is cracked at
   * 0.95 m.
   *
   * **It is the pattern's pitch and no longer any one piece's size**, which is
   * what a cut costs over a grid: the pieces between two radials and two rings
   * are a spread about it, roughly a third of it at the hole and twice it at
   * the rim. The band still decides how coarse a sheet fails, and the distance
   * gate and the mass are still quoted against it.
   *
   * The floor keeps Havok from being asked about a speck, and it is the end of
   * the band nothing on the shipped maps reaches: every pane that breaks today
   * is a shopfront bay, because that is where the glass has a room behind it
   * (see `PaneSpec.breakable`). **The ceiling is the number to move if a burst
   * stops covering its pane**: those bays run 7.8–12.5 m², which is a pattern
   * cut at about a metre, and a ceiling under that turns the burst into a patch
   * around the hole instead of most of the sheet. That is the graceful failure rather
   * than the intent — the glass that IS drawn stays where the player is looking
   * — and it is what any pane much larger than these gets.
   */
  shardMin: 0.12,
  shardMax: 1.2,
  /**
   * How much of its own outline a piece keeps, shrunk about its centroid.
   * Under 1 because that is what OPENS the cracks: the pattern tiles the sheet
   * exactly, and a burst drawn at 1 is a pane with lines on it rather than one
   * that has just failed.
   */
  shardPack: 0.88,
  /** Metres. A sheet, not a slab — and thin enough that its edge never reads. */
  shardThickness: 0.02,
  /**
   * Metres, and deliberately THICKER than the piece it stands for.
   *
   * The floor is a mesh shape per terrain block (see `PhysicsWorld.buildWorld`)
   * and a 2 cm body slips through the seams between them: measured on
   * Coldharbour, one or two pieces of every twelve landed, slid, and then sank
   * through the road for the rest of the burst's life. A body the solver can
   * actually see stops that, and the cost is that a piece lies ~3 cm proud of
   * what it landed on, which nothing about a dark plate on a dark road shows.
   */
  shardCollide: 0.09,

  /** Kilograms for a piece of `shardMax` square; every piece scales by area. */
  shardMass: 1.4,

  /**
   * How hard a break throws its pieces, in metres per second.
   *
   * **The sheet leaves its frame along the pane's own NORMAL, and the round
   * drags glass along its own path only WITHIN the plane.** That split is what
   * makes a break read as a sheet failing rather than a puff punched through —
   * and it is also what keeps the pieces out of the wall behind them, because
   * most panes on the map are decoration hanging 4 cm off something solid. See
   * `DebrisSystem.burst`, which picks the side to leave by.
   *
   * `shardAlongShot` is the in-plane share, `shardSpread` the random scatter,
   * and `shardDrop` what a piece far from the hole does instead of being thrown:
   * it simply lets go.
   */
  shardSpeed: 2.6,
  shardAlongShot: 0.5,
  shardSpread: 0.9,
  shardDrop: 0.7,
  /**
   * Metres. How far from the crossing point a piece still counts as blown out
   * rather than dropped — the falloff every throw term is scaled by.
   */
  shardBlast: 1.3,
  /** Radians per second at the hole, drawn per shard. Glass tumbles fast and flat. */
  shardSpin: 5,
} as const;
