/**
 * config/bots.ts — bot AI, and the nav grid it steers on.
 * Owns: squad sizes, skill tiers, perception, cover, the think budget and the
 * LOD/ragdoll gates. Contract: `docs/bots.md`.
 * Gotcha: three numbers here carry the frame budget — `thinkRate`, the rig
 * pool size and `lodDisableDistance`. Loosening any of them costs ~10x draw
 * calls or a permanent hitch.
 */

import { FOG_WALL } from "./fogWall";

/** Bot roster, AI cadence, and the render LOD that makes 16 of them viable. */
export const bots = {
  /**
   * Per team, and the DEFAULT rather than the number: a map states its own
   * (`MapLayout.perTeam`, resolved by `perTeamOf`) and the rig pool is sized to
   * exactly whatever that resolves to, twice.
   *
   * **This is still the figure the rest of this file is written against**, and
   * it is what four other things are: how many PEOPLE a match seats a side,
   * which is fixed at this number on every map it rotates onto because it is
   * the smallest roster any of them fields and a rotation may never evict
   * anybody (`Roster.HUMANS_PER_TEAM`), the pool `BattleSystem` is constructed
   * with before any map is installed, the `NetRoster` mirror on a client before
   * a `roundstart` has named a map, and the number a map that says nothing
   * fields — which is four of the five shipped maps, unchanged to the bit.
   */
  perTeam: 8,
  /**
   * The most a map may field a side, and the only thing this number IS is a
   * bound on `MapLayout.perTeam`.
   *
   * It exists because a roster is spent in RIGS: a bot is nineteen merged
   * meshes that Babylon's active-mesh pass walks every frame whether the body
   * is enabled or not (`WorldCulling` — a disabled mesh is skipped cheaply, not
   * skipped), so the pool is a per-frame cost on every map that carries it and
   * a map's roster has to be a number somebody chose rather than one a layout
   * can run away with. 24 is Sarab's, which is what it was raised to.
   *
   * It is NOT a pool size on a CLIENT and nothing there is built to it: the
   * pool is the map's own roster and is rebuilt when that changes
   * (`BattleSystem.setRoster`, `NetRoster.setFielded`), which is what keeps a
   * 240 m village paying for sixteen bodies rather than forty-eight.
   *
   * **The AUTHORITY is the exception and builds exactly this, once.** It draws
   * no rigs and walks no meshes, and it needs team 1's block to begin at the
   * same slot index on every map a match rotates onto — so its pool is the
   * ceiling and `BattleSystem.setFielded` takes the surplus out of each round.
   * See `server/Roster.ts`.
   */
  maxPerTeam: 24,
  squadSize: 4,
  maxHealth: 100,
  /**
   * The body sphere a round is tested against, about `Bot.center`. This is the
   * number `bots.cover.height` is derived from — the top of the sphere is
   * `centerHeight + hitRadius` = 0.9 + 0.75 = 1.65 m, and cover baked any lower
   * leaves a bot visible but unhittable.
   *
   * Here rather than as a literal on `Bot` because three separate pieces of
   * reasoning in this file and in `weapons.ts` are written against its value,
   * and none of them could read it.
   */
  hitRadius: 0.75,
  /** Roughly the player's jog; the advancing sprint stays under theirs. */
  moveSpeed: 4.4,
  /** Sprint multiplier while advancing with no target. */
  advanceSprintMult: 1.35,
  /**
   * Full AI (target selection, LOS raycast, objective re-evaluation) runs at
   * this rate per bot, round-robin across frames. Movement still integrates
   * every frame. At 5 Hz with 16 bots that is ~1.3 ray picks per frame.
   */
  thinkRate: 5,
  /** 25 per hit against 100 HP = 4 shots to kill, matching the player. */
  damage: 25,
  /**
   * The far end of the bot round's fall-off, and the run to it. Bots carry no
   * weapon from `CONFIG.weapons` — they fire one flat round — so these three
   * numbers are the whole of their damage curve, the same shape every weapon
   * in that table now has.
   *
   * The run is deliberately fitted to the band bots actually shoot in rather
   * than to `range`: they will not open fire past `engageRange` (55) and back
   * off inside `minEngageRange` (6), so a ramp ending at 70 would spend most
   * of itself where nothing is ever fired. 18 to 50 puts the whole curve
   * inside the fight, and 17 is a six-shot kill at the far edge of one.
   *
   * **This makes the game easier and that is the point.** Sixteen bots that
   * hit for 25 at any distance mean a crossed square is a coin toss no
   * movement can improve; the same bots falling to 17 at 50 m mean closing,
   * breaking a sightline and holding an angle are all worth something.
   * `damageFar: 25` restores the old behaviour exactly.
   *
   * Note the knife edge, which the sidearm shares: 25 x 4 is exactly 100, so
   * there is no headroom and the first centimetre past `falloffNear` costs a
   * whole round. Bots are a four-shot kill inside 18 m, five to 38, six
   * beyond — a clean staircase, but it means anything that moves `damage`
   * off 25 moves all three treads by metres.
   */
  damageFar: 17,
  falloffNear: 18,
  falloffFar: 50,
  fireRate: 5.5,
  /**
   * Aim error half-angle (radians), lerped by distance / `engageRange`.
   *
   * These read as very loose, but the miss radius is `angle * distance`
   * against a 0.75 m target sphere, so the hit rate falls off quadratically:
   * near-certain inside 20 m, about half at 30 m, roughly one in ten at 55 m.
   * Tightening them makes bots snipe across the square with no counterplay.
   */
  spreadNear: 0.02,
  spreadFar: 0.045,
  /**
   * Most line-of-sight rays one target-acquisition tick may spend.
   *
   * Candidates are ray-tested nearest-first and the first visible one wins,
   * so the common case is a single ray. But a bot in the middle of a crowded
   * fight can have nine enemies in range with the nearest few behind cover,
   * and testing all of them is exactly the "thousands of picks a second"
   * blow-up the acquisition code was written to avoid. Missing a distant
   * enemy for one 200 ms tick is not a behaviour anyone can see.
   */
  acquireRayBudget: 3,
  /** Bots will not open fire beyond this distance. */
  engageRange: 55,
  /**
   * How far a bot's round carries. NOT `engageRange` — that is when a bot
   * decides to shoot, this is where the ray stops, and it also bounds the
   * wall pick behind `losBrokenShots` and the near-miss sweep that
   * suppresses whoever the round went past. Was the player's own range back
   * when there was one rifle in the game and `CombatSystem` could read it
   * out of the config; now every shooter brings its own.
   */
  range: 120,
  /** Below this, a bot backs off toward cover instead of closing. */
  minEngageRange: 6,
  /** Separation distance for the crowd-avoidance pass. */
  separation: 1.5,
  /**
   * Seconds of scatter added to a reinforcement, so a squad that was wiped
   * together does not come back together.
   *
   * `conquest.respawnDelay` is one number for everybody, and four bots killed
   * inside a second of each other therefore walked out of the gatehouse as one
   * body, on one flow field, for the whole trip back — which is where a good
   * half of the herding a player actually sees is made. Drawn from the bot's
   * own seeded stream, so a round still replays identically.
   *
   * It only ever ADDS, which is what keeps `death.sinkStart + sinkTime` (6 s)
   * clear of the respawn: the margin the corpse needs grows rather than
   * shrinking.
   */
  spawnJitter: 1.5,
  /**
   * Unstick watchdog. A bot that wants to move but covers less than
   * `stuckFraction` of its intended step for `stuckTime` seconds is grinding
   * on something its flow field cannot see — a scattered tree, a squadmate
   * pinning it to a wall — so it sidesteps for `detourTime` before trying the
   * direct line again. Without this a bot whose objective lies dead behind a
   * tree trunk pushes into the trunk forever: the push-out is exactly
   * opposite its steering, so there is no tangential motion to break the tie.
   */
  stuckTime: 0.5,
  stuckFraction: 0.35,
  detourTime: 1.0,
  /** How far to the side the watchdog looks when choosing a way round. */
  detourProbe: 1.6,
  /** Distance past which the pose is frozen (still translates). */
  lodFreezeDistance: 35,
  /** Distance past which outlines are dropped. */
  lodOutlineDistance: 20,
  /**
   * Distance past which the rig is not drawn at all — the fog wall, where
   * there is nothing to see. The bot keeps integrating, so the battle line
   * still moves out there; only the drawing and posing stop.
   *
   * **What runs is the MAP's** (`BattleSystem.viewDistance`, pushed by
   * `Game.installMap`): its `fogEnd`, or its `EnvironmentSpec.bodyDrawDistance`
   * where it states one. This value is what the system carries before any map
   * is installed — and it is also, by arithmetic rather than by wiring, what
   * the two valleys get, since both state a `fogEnd` of 78.
   */
  lodDisableDistance: FOG_WALL,

  /**
   * Fire discipline. Everything here is the same for every bot; anything that
   * should separate an ace from a rookie lives in `skill` below.
   */
  combat: {
    /**
     * Rounds before a reload. Matched to the RIFLE's magazine so the rhythm
     * of a firefight is symmetrical — and so the gap is a window the player
     * can learn to push into, which is the whole point of bots reloading at
     * all. Before this they had infinite ammo and only the burst pause.
     * Bots carry one weapon whatever the player picked; the loadout is the
     * player's choice to make, not a thing the roster answers.
     */
    magSize: 24,
    /**
     * Consecutive shots that hit geometry with no target found before the bot
     * concludes it has lost line of sight and drops the target.
     *
     * Not one: at these spread angles a wide round hitting the wall behind a
     * live target is ordinary, so a single blocked shot proves nothing. Three
     * in a row does, and it costs no rays at all — `CombatSystem.fire` already
     * pays for a wall pick per shot and the result was being thrown away.
     * This is what stops a bot shooting through a wall for a whole think
     * interval after the player breaks contact.
     */
    losBrokenShots: 3,
    /**
     * How long a hit disrupts a bot's aim, and how far off target it throws
     * the aim point (metres, at the target). There is no flinch *pose* — the
     * rig has no spine to fold and no AI parameter that would drive one — so
     * "got hit" reads as a
     * yaw snap toward the shooter plus a brief aim disruption, and that is
     * the whole honest vocabulary for it.
     */
    flinchTime: 0.35,
    flinchKick: 1.2,
    /**
     * Yaw slew multiplier while turning toward a shot the bot did not see
     * coming. Fast, but not instant: snapping is what makes an aimbot read as
     * an aimbot.
     */
    flinchTurnMult: 2.5,
    /**
     * Seconds a damage bearing stays worth acting on. Longer than a firefight
     * exchange, shorter than a walk across the map.
     */
    threatMemory: 6,
    /**
     * Widening of the vision cone (radians, added to the half-angle) while a
     * threat cue is live. A soldier who has just been shot at is looking
     * harder than one on a quiet street.
     */
    alertFovBonus: 0.35,
  },

  /**
   * What a bot notices without seeing it. All of this is free of raycasts by
   * construction — hearing is a distance compare, damage direction and near
   * misses ride results the combat system already computes. A bot that has to
   * *look* to perceive is a bot that costs rays, and the LOS budget is the
   * one thing that does not scale here.
   */
  perception: {
    /**
     * How far a gunshot is noticed. Deliberately under `audio.maxDistance`
     * (70) so bots do not hear everything the player can — a bot reacting to
     * a firefight it has no business knowing about reads as cheating, and
     * the whole point of this is to make their knowledge legible.
     */
    hearRange: 45,
    /**
     * Metres of error on a heard position, so bots converge on the *sound*
     * rather than teleport their attention onto the exact shooter. Without
     * it, hearing is indistinguishable from wallhacks.
     */
    hearJitter: 4,
    /**
     * A friendly's gunfire is a weaker cue than an enemy's — it says "the
     * fight is over there", not "someone is shooting at me". This is quietly
     * how a squad converges on contact without any explicit coordination.
     */
    friendlyHearMult: 0.45,
    /**
     * Perpendicular distance within which a passing round counts as a near
     * miss. Roughly an arm's length: close enough to hear crack past.
     */
    suppressRadius: 1.2,
    /** Arousal added per near miss, and how fast both scalars bleed off. */
    suppressPerMiss: 0.4,
    suppressDecay: 0.5,
    alertDecay: 0.3,
    /**
     * How close a hunting bot has to get to a remembered position before it
     * counts as searched, and how long it sweeps there before giving up.
     */
    huntArriveRadius: 3.5,
    huntSweepTime: 2.5,
    /** Speed multiplier while hunting — a search is a walk, not a charge. */
    huntSpeedMult: 0.75,
  },

  /**
   * Movement texture. All of this is heading, speed and facing only — there is
   * no lean or vault to reach for, and the one stance an AI does decide is the
   * crouch, which lives with the cover it is taken behind (`cover` below)
   * rather than here. What is achievable is *where* and *how fast*, and that
   * turns out to carry most of it.
   */
  movement: {
    /**
     * How many cells down the flow field a bot aims. `steer` returns the next
     * cell centre, which is why bots walked a visible 1.5 m zigzag; looking
     * ahead points at where the route actually goes.
     */
    lookaheadCells: 3,
    /**
     * Heading smoothing, per second. The flow field's direction snaps between
     * eight compass points, and a body that turns instantly between them
     * reads as a machine following a grid — which is exactly what it was.
     *
     * Applied only to the flow-field states, and *before* the stuck
     * watchdog's sidestep, so smoothing can never blunt the thing that gets a
     * wedged bot out.
     */
    headingRate: 5,
    /**
     * Amplitude and period of the per-bot lateral weave. Four bots on one
     * flow field otherwise walk in single file down the exact same line,
     * which no squad has ever done.
     *
     * The period is long for a measured reason: the weave is itself a source
     * of curvature, and at 5 s it put back exactly as much path wobble as the
     * smoothing above had taken out (mean turn 7.25 deg against a 7.41 deg
     * baseline, for +60% squad spread). Slowing it to 11 s keeps the same
     * lateral displacement while changing direction half as fast — 5.13 deg
     * and +95% spread, better than the baseline on both counts instead of
     * trading one for the other.
     */
    laneOffset: 0.55,
    lanePeriod: 11,
    /** Per-bot speed variation, as a fraction. Nobody marches in lockstep. */
    speedJitter: 0.12,
    /**
     * How much air a bot tries to keep between itself and the nearest
     * friendly, and how hard it steers to keep it.
     *
     * This is NOT `bots.separation` (1.5), which is a de-penetration radius —
     * roughly two bodies' width, enough to stop squadmates walking through
     * each other and nothing more. Four bots on one flow field therefore
     * marched down a single line two metres apart, which is the herd a player
     * sees. Spacing is the same pairwise pass at a distance where a formation
     * is legible instead: it spreads a squad across a street rather than
     * queueing it down the middle of one.
     *
     * Weak on purpose, and weakest of the three steering preferences here —
     * the flow field still decides where the squad is going, and a corridor
     * narrower than the spacing simply wins, because `tryMove`'s axis sliding
     * resolves the push against the wall. Team-wide rather than per squad:
     * two squads stacking on the flag that decides the round is correct
     * (see `squad.claimPenalty`), and they should still arrive as a line
     * rather than a column.
     */
    spacing: 5,
    spacingWeight: 0.7,
    /**
     * A heading swing larger than this (radians, per think) means the route
     * just turned a corner — so pause and look before committing to it.
     */
    cornerAngle: 1.0,
    cornerPause: 0.45,
    /**
     * How strongly openness pulls a bot toward walls. A preference only: the
     * flow field still decides where it is going, this just biases which side
     * of the street it walks down.
     */
    wallHug: 0.35,
    /**
     * How far the upper body may turn off the feet, radians (~66 deg).
     *
     * The rig's root carries one yaw, so before the split a bot pointed its
     * whole body at whatever it was looking at and a strafing bot walked
     * visibly sideways. Now the feet follow travel and the torso twists to
     * the look direction — but only so far. Past this the hips have to come
     * round, which is both what a body does and what stops the shoulders
     * ending up on backwards.
     */
    maxTorsoTwist: 1.15,
    /**
     * How fast the feet swing to a new heading, per second. Slower than the
     * look slew (`skill.turnRate`) on purpose: the whole point is that the
     * head and torso lead and the feet follow.
     */
    bodyTurnRate: 6,
  },

  /**
   * Squad coordination. Squads are planned as a group, on their own slow
   * timer — this is four objects at 2 Hz, so it deliberately does not steal
   * from the per-bot think budget, where it would silently slow every bot's
   * reaction time.
   */
  squad: {
    /** How often a team's squad orders are re-planned. */
    updateRate: 2,
    /**
     * Score a flag loses per squad already heading there. A penalty, not an
     * exclusion: when the round hinges on one flag, two squads stacking on
     * it is correct, and the old `squad % flags` forced spreading is what
     * sent bots wandering away from the fight that decided the game.
     */
    claimPenalty: 45,
    /**
     * Bonus a squad's current objective keeps. Held on the squad rather than
     * the bot, so two flags' scores crossing cannot turn a squad round
     * halfway through its approach.
     */
    switchMargin: 30,
    /**
     * Bonus for a flag you own with enemies standing on it, scaled by how far
     * the meter has already slipped. This is the whole defence behaviour:
     * without it an owned flag scores a flat penalty however close it is to
     * being lost, so nobody ever goes home.
     */
    defendUnderAttack: 110,
    /**
     * What crossing the whole map costs a flag's score — measured over the play
     * square's DIAGONAL, not per metre.
     *
     * 85 is what the retired flat 0.25/m was worth across a 240 m map's 340 m
     * diagonal, so the two maps it was tuned on are unchanged. Written this way
     * because a rate per metre is a statement about a map size, and the four
     * scores it is weighed against (a neutral flag's +40, an enemy's +70, a
     * contest's +50, `switchMargin`'s +30) are not: at 900 m the flat rate was
     * worth 300 across the map and no tactical term could outvote it, so every
     * squad took the nearest flag and — since `defend` follows from owning what
     * you picked — stood on it for the rest of the round.
     *
     * Keep it under the ~110 the ownership terms span. Above that, distance is
     * the only term again, at every scale rather than just the big ones.
     */
    distancePenalty: 85,
    /**
     * How far outside the capture radius a defender will look for a covered
     * vantage. Holding a flag from the geometric centre of an open circle is
     * how you lose it; holding it from the doorway across the street is not.
     */
    defendStandoff: 6,
  },

  /**
   * The squad radio: the short list of things a team's bots tell each other,
   * and the one thing a team remembers between lives.
   *
   * Everything here is a CUE and never knowledge, and neither of the two is
   * allowed into `BotMemory` — a bearing in there feeds `hasCue` and would make
   * every sighting anywhere in a squad into a search. A called contact is a
   * LOOK: it widens the listener's cone and turns its head, which against a
   * directional acquisition cone is most of what being warned is worth, and it
   * can never put a target in anybody's hands. The hazard marks are a memory of
   * where this team has been dying, which is a fact about the team's own bodies
   * rather than about where the enemy is.
   *
   * All of it is ray-free and allocation-free, like the rest of perception:
   * two small structures per team, read on the ordinary think tick.
   */
  radio: {
    /**
     * Seconds a contact call stays worth acting on.
     *
     * A call is overwritten rather than queued and is only ever a heading for
     * the head, so this is how long a squadmate keeps watching a bearing
     * nothing has come down. Long enough to cover the walk out of a doorway,
     * short enough that a squad is not still staring at where somebody was
     * standing ten seconds ago.
     *
     * A listener acts on a call only when it has nothing of its OWN to look at
     * and only inside `engageRange` — see `Bot.think`.
     */
    contactMemory: 5,
    /**
     * Metres of error each LISTENER puts on a called position.
     *
     * Per listener and not per call, which is the whole difference between a
     * squad converging on a fight and a squad stacking on one grid reference.
     * It is the same fix `hearGunshot`'s jitter needed for the same reason —
     * see `BattleSystem.hearGunshot`.
     */
    contactJitter: 5,
    /** How many places a team remembers dying at once. */
    hazardMax: 6,
    /** Seconds one death's mark takes to fade to nothing. */
    hazardMemory: 60,
    /**
     * Deaths inside this reinforce the mark that is already there instead of
     * adding another. That is what turns four bodies on one street corner
     * into one strong mark rather than four weak ones, and it is what keeps
     * `hazardMax` from being spent by a single firefight.
     */
    hazardMerge: 10,
    /**
     * How far from a mark ground counts as hot.
     *
     * Wide enough that a bot has somewhere to go by the time it matters:
     * inside it the approach slows to a walk, the bot looks at the bearing
     * the marks were made from, and the route is bent around the spot rather
     * than through it.
     */
    hazardRadius: 16,
    /**
     * How hard a hot spot pushes an approach off its line, and what the walk
     * across one costs in speed.
     *
     * The swerve is a lateral preference exactly like `movement.wallHug` —
     * the flow field still owns where the bot is going, this decides which
     * way round the place its squad died it gets there. That is the whole of
     * "a different way in": there is one route graph and no second one to
     * pick, so the alternative is made by bending the only route there is.
     */
    hazardSwerve: 0.9,
    hazardCaution: 0.8,
  },

  /**
   * Dying: the ragdoll.
   *
   * The ragdoll is Havok-powered and strictly cosmetic — nothing here feeds
   * navigation, cover or hit detection. It is not OPTIONAL, though: the engine
   * is awaited at boot and a failure is the boot screen's, so there is no
   * second way for a body to go down and no `ragdoll` switch to pick between
   * them. What used to be here — `collapseTime`, and the master toggle the
   * settings screen wrote — went with the collapse tween.
   *
   * The ragdoll's SHAPE — which joints are bones, how big they are, where
   * they pin and how far they may swing — is NOT here. That is measured off
   * the rig's own boxes and lives with them in `SoldierModel.ts`, the same
   * split the header draws between gameplay tunables and art.
   */
  death: {
    /**
     * When a body the pool did NOT take is hidden.
     *
     * That is only ever a death past `maxDistance` — the fog wall, where the
     * rig has already stopped being drawn — so this is a bookkeeping clock and
     * not a piece of timing anybody watches. It is still on the wire: netplay
     * sends `deathProgress` as `since / hideTime` and a client hides a body it
     * did not ragdoll when that reaches 1.
     */
    hideTime: 0.9,
    /**
     * Bodies simulating at once. Past this the next death EVICTS the oldest
     * corpse rather than being refused — the pool has nothing to refuse into
     * since the tween went, and a body standing to attention in the middle of
     * a firefight is worse than one cut short on its way out. A free slot goes
     * first and a sinking one second; see `RagdollSystem.takeSlot`.
     *
     * Eight is two squads, and it is now MEASURED rather than reasoned about.
     * Four was a guess made against FINDINGS.md #8's 1.37 ms for four falling
     * bodies — 5-6x the whole roster's AI — which does not reproduce. Timing
     * `ragdolls.update(1/60)` over 1,600 frames inside the fall, headless,
     * against `battle.update` for all 16 bots in the same run:
     *
     *   0 corpses 0.000 ms | 1: 0.033 | 2: 0.033 | 4: 0.062 | 6: 0.095
     *   8: 0.121 ms, against the roster's 0.39-0.42 ms
     *
     * So a falling corpse is ~0.015 ms and eight of them is under a third of
     * the AI, not several times it. Three things bound it: the fall is ~1.1 s
     * and a settled corpse costs 0.0004 ms/frame (the engine is not stepped at
     * all), the count is capped here, and the unused slots are free — four
     * corpses cost 0.061 ms in a pool of four and 0.062 ms in a pool of eight,
     * so raising this only ever costs when the bodies are actually falling.
     *
     * Headless absolutes are inflated the same way FINDINGS #6's are, and
     * `update(1/60)` is exactly one substep — a 30 fps frame takes two. Treat
     * the RATIO to the roster as the trustworthy part.
     */
    maxConcurrent: 8,
    /**
     * No ragdoll past this, measured ONCE at the moment of death — a corpse
     * does not move, and re-testing per frame would switch a tumble off
     * halfway through because the player backed away.
     *
     * **It is the pool's ONE remaining refusal**, and that is why it has to be
     * exactly where a body stops being drawn rather than merely near it: a
     * body refused inside the fog would stand where it died until `hideTime`,
     * with nothing left to pose it.
     *
     * It is the FOG WALL, and it is the same number as `lodDisableDistance`
     * BY CONSTRUCTION rather than by coincidence: that is where the rig stops
     * being drawn, so one metre further is a solver tumbling something the
     * player cannot see. Every death inside the fog is eligible, which is
     * what a marksman rifle needs — its own range is bounded by the same wall.
     *
     * The construction now has something to survive: a map may state a
     * `bodyDrawDistance` shorter than its fog, and when it does the rig LOD and
     * this move together because `Game.installMap` resolves ONE number
     * (`bodyDrawDistanceOf`) and pushes it to both. This value is what a map
     * with no opinion gets.
     *
     * It is deliberately NOT `lodFreezeDistance` (35), which is what this was
     * pinned to and why nothing dying across the square ever fell over. That
     * LOD only skips `animateSoldier`, and `Bot.update`'s dead branch already
     * skips it while `ragdolling` — a ragdoll poses through the proxy nodes
     * its joints are parented to, which the solver writes whatever the LOD
     * says. Verified: a corpse at 50 m driven through the real
     * `BattleSystem.update` tumbles from a 0.64 m standing joint spread to
     * 0.002 m face-down on the floor, rig still enabled.
     *
     * This costs nothing per frame on its own — `maxConcurrent` is what
     * bounds the solver — but it does keep the pool busier, which is the
     * other half of why that went up with it.
     */
    maxDistance: FOG_WALL,
    /** Matches the grenade's exaggerated fall, not the player's. */
    gravity: -18,
    /**
     * Fixed simulation step, and the most catch-up allowed in one frame.
     *
     * Fixed rather than the frame's own `dt`, which is what makes a tumble
     * identical at 30, 60 and 144 fps — and reproducible headless, where the
     * clamp at 0.05 would otherwise make every recorded death a different
     * one. `maxSteps` bounds the spiral when a frame runs long.
     */
    substep: 1 / 60,
    maxSteps: 2,
    linearDamping: 0.15,
    /** High: a corpse that spins like a top is the funniest failure here. */
    angularDamping: 0.6,
    friction: 0.8,
    /** Near zero. A bouncing body is the second funniest. */
    restitution: 0.02,
    /**
     * The throw, and there are TWO of them — one for a round and one for an
     * explosion, chosen by the `DamageKind` the corpse was killed with.
     *
     * `from` is the shooter's eye or the blast centre, so the direction comes
     * free in both cases; what differs is what arrives. Everything at this
     * level is the ROUND: a newton-second on the chest, scaling with the blow,
     * which is what makes a 40-damage rifle round drop a body where it stood.
     * Applied `lift` above the centre of mass, so the tumble falls out of the
     * off-centre application rather than needing an authored spin.
     *
     * `spin` is a seeded angular kick that breaks the symmetry of two
     * identical deaths. It is drawn from the ragdoll pool's own generator —
     * never Math.random, which would make a death impossible to reproduce,
     * and deliberately not the dying body's, which would put a bot's own
     * behaviour stream downstream of whether its corpse was accepted.
     *
     * `blast` is the other one and is documented on itself.
     */
    impulse: {
      base: 6,
      perDamage: 0.06,
      max: 22,
      lift: 0.25,
      spin: 1.2,
      /**
       * ## What an EXPLOSION does instead, and the units are different
       *
       * Everything above is a newton-second on the CHEST, which is what a
       * round is: a small blow landing at a point, and the body folding round
       * it. A blast is not that — it arrives everywhere on a body at once —
       * and the difference is the whole of why this is a second row rather
       * than a multiplier on the first. Two things follow from it:
       *
       * - **These figures are METRES PER SECOND of the whole body**, not
       *   impulses. `RagdollSystem.applyImpulse` spends `speed * mass` on
       *   every bone at its own origin, so all ten leave at the same velocity
       *   and nothing is sheared through a joint. The alternative — the same
       *   throw applied to the 34 kg chest alone — is nine limbs being caught
       *   up by their constraints, which is a body coming apart rather than a
       *   body being thrown.
       * - **`base` is small and `perDamage` carries it**, because the blast
       *   already told us how hard it hit: `blastAt` scales its damage by the
       *   falloff before `takeDamage` ever sees it, so `deathDamage` IS the
       *   strength of the explosion where this body was standing. A frag at
       *   the feet (130) leaves at 9.8 m/s, a rocket (220) at 15, a tank
       *   shell's splash (350) at the cap, and a body caught at the fringe
       *   of the same radius is shoved rather than thrown. There is nothing
       *   here that has to be kept in step with `power` — one number, and the
       *   picture is the other's business.
       *
       * `rise` is added to the (normalised) direction before it is re-normalised,
       * so a blast at the same height as the body still throws it up and away
       * rather than sliding it along the floor: 0.5 is about 27 degrees of
       * elevation, which against `gravity` (-18) and `linearDamping` is roughly
       * four metres of flight for a frag and ten for a shell.
       *
       * `spin` is the same seeded angular kick, larger because a body that is
       * off the ground has the room to use it — a corpse merely knocked over
       * spends its tumble against the floor within the first step.
       */
      blast: { base: 2, perDamage: 0.04, max: 12, rise: 0.5, spin: 4 },
    },
    /**
     * Hard stop on simulating, and the early-out for a body that stopped
     * moving on its own. Once every bone is under `sleepSpeed` AND
     * `sleepSpin` for `sleepTime` the corpse is frozen into its pose and
     * costs nothing.
     *
     * Both thresholds, because freezing commits to a POSE: a body settled on
     * its back and still turning has almost no linear velocity, and the
     * speed test alone would bake whichever angle it was passing through.
     * `angularDamping` (0.6) is what makes the spin term cheap — it is
     * usually the first of the two to go quiet.
     */
    settleTime: 2.5,
    sleepSpeed: 0.12,
    sleepSpin: 0.5,
    sleepTime: 0.4,
    /**
     * Seconds after death that the body starts to go, how long that takes,
     * and how far it drops.
     *
     * It SINKS rather than fading, and that is forced rather than chosen: the
     * cel shader writes alpha 1.0 outright, and its materials are shared per
     * COLOUR by `CelMaterialFactory`, so an alpha write would dim every bot
     * on the map along with this one. Sinking through the floor is what the
     * collapse tween always did.
     *
     * 5 + 1 = gone at 6 s against `conquest.respawnDelay` of 8. Keep the two
     * seconds of margin: the rig is recycled at `respawnDelay`, and a corpse
     * still standing when `Bot.spawn` runs is a body that teleports.
     */
    sinkStart: 5,
    sinkTime: 1,
    sinkDepth: 1.2,
  },

  /**
   * Cover. Baked once at map load into a per-surface direction mask; see
   * `src/world/CoverMap.ts` for why it is baked rather than probed.
   */
  cover: {
    /**
     * How far along a bearing the bake looks for something to hide behind.
     * Roughly three nav cells: far enough to find the wall of the building
     * you are standing beside, short enough that "cover" still means cover
     * *here* rather than somewhere down the street.
     */
    probeDistance: 4.5,
    /**
     * Height that actually stops a round — and this is the number people get
     * wrong. Line of sight is tested from the eyes at 1.55 m, but hits are
     * tested against the body sphere, whose top is `center.y + hitRadius` =
     * 0.9 + 0.75 = 1.65 m. Bake cover at eye height and a bot behind a 1.6 m
     * wall is *visible but unhittable*: the player sees a head, fires, and
     * the rounds vanish into the wall pick. 1.7 clears the sphere.
     */
    hardHeight: 1.7,
    /**
     * What stops a round aimed at a CROUCHED body, and the reason waist-high
     * geometry is now worth something.
     *
     * It starts where `hardHeight` does, off the stance the body actually
     * takes: `player.crouchCenterHeight` (0.4) + `hitRadius` (0.75) = 1.15 m is
     * the top of a crouched bot's hit sphere. **But 1.15 is not enough, and
     * measuring is what said so.** A shooter's eye stands at 1.55, which is
     * ABOVE a waist-high wall — so the round comes DOWN over it and can still
     * reach a crouched body behind it, where hard cover works because both eye
     * and target sit below the wall's top and no line between them clears it.
     * Ray-tested against the map's real geometry at 1.15: cover the mask
     * claimed left the crouched sphere exposed on 20% of Hollowmere's bearings
     * and 48% of Coldharbour's, against ~0% for `hardHeight`.
     *
     * The margin is the sightline's own arithmetic, not a fudge. Over
     * `crouchProbe`, that descending line drops by
     * `(eyeHeight - 1.15) * crouchProbe / range`, and the worst case is the
     * closest shot a bot takes (`minEngageRange`, 6 m): 0.4 * 2 / 6 = 0.13 m.
     * 1.3 clears it, and therefore clears every longer shot as well.
     *
     * It is a THIRD mask rather than a re-reading of `softHeight`, because knee
     * height and crouch height are two different claims: 0.9 m says "walk along
     * this", 1.3 m says "you are safe behind this if you get down". Baking the
     * second at the first would put bots behind low walls a round goes straight
     * over — the `visible but unhittable` failure `hardHeight` exists to avoid,
     * pointed at the bot instead.
     */
    crouchHeight: 1.3,
    /**
     * How far along a bearing the CROUCH bake looks, against `probeDistance`
     * (4.5) for the other two.
     *
     * **Crouch cover is close cover, and that is geometry rather than
     * taste.** The margin above is proportional to how far the covering wall
     * stands from the body: a low wall you are pressed against covers you, and
     * the same wall four metres back is one the round clears on its way in.
     * Two metres keeps the required margin small enough that ordinary
     * waist-high geometry qualifies; stretching it to `probeDistance` would
     * need 1.45 m of wall to be honest at 6 m, which is most of the way to
     * hard cover and would leave almost nothing in this mask.
     *
     * It also matches what a bot does with it: `findCover` sends it to the
     * cell, and the peek cycle then keeps it there rather than stepping out —
     * a crouched bot is hugging the thing it is behind.
     */
    crouchProbe: 2,
    /**
     * Speed and spread while crouched. The stance costs mobility and buys
     * steadiness, exactly as it does for the player — a bot that ducks behind
     * a wall shoots a little tighter and can barely reposition, which is what
     * makes taking the stance a decision rather than a free upgrade.
     */
    crouchMoveMult: 0.55,
    crouchSpreadMult: 0.8,
    /**
     * How close two bots' cover anchors may be before the second one is made
     * to look elsewhere.
     *
     * The cover bake is a lookup over a static map, so every bot under fire
     * from the same bearing gets handed the SAME corner — four of them stacked
     * behind one wall, which is both a herd and a grenade waiting to happen.
     * A spot inside this radius of a squadmate's anchor is skipped by
     * `findCover`; the claim is the anchor itself rather than a reservation,
     * so it cannot go stale and nothing has to be released.
     */
    claimRadius: 2.5,
    /**
     * Knee height. Marks geometry worth walking along rather than across open
     * ground — and nothing more. It is NOT the crouch line: `crouchHeight`
     * above is what protects a ducked body, and a bot behind something between
     * the two heights is exactly as shootable as one in the open however low
     * it gets. Never treat this as protection.
     */
    softHeight: 0.9,
    /**
     * How far above a standing surface a box may be footed and still count.
     * Above this it is a lintel or a hayloft and the round passes underneath.
     */
    footTolerance: 0.4,
    /** How far a bot will go looking for a covered spot. */
    searchRadius: 7,
    /** Close enough to a chosen cover spot to count as arrived. */
    arriveRadius: 1.2,
    /**
     * How far a bot leans out from its anchor to shoot, and how long each
     * half of the peek cycle lasts.
     *
     * The peek is what makes cover *readable*: a bot that reaches a corner
     * and stays there is simply harder to kill, which is the wrong kind of
     * difficulty. Stepping out to fire and pulling back gives the player a
     * rhythm to shoot into. `outTime` is skill-scaled — aces expose
     * themselves briefly, rookies stand there too long and get shot for it.
     */
    peekOffset: 1.3,
    peekInTime: 0.9,
    /**
     * Suppression above this pins a bot at its cover instead of letting it
     * keep trading, and below this it stops being pinned. Two thresholds
     * rather than one, or a bot on the boundary flickers.
     */
    suppressEnter: 0.7,
    suppressExit: 0.35,
    /**
     * How long the stuck watchdog may fire before a bot gives up on a cover
     * spot it cannot reach and goes back to fighting where it stands.
     */
    abandonTime: 1.5,
    /**
     * After giving up on a spot, how long before the bot considers cover
     * again. Without this the abandon is pointless: the next think re-runs
     * the search, gets the same unreachable corner back, and the bot spends
     * the round walking into a wall instead of fighting.
     */
    retryDelay: 4,
  },

  /**
   * Minimum seconds in a state before the bot is allowed to drop to a
   * lower-priority one. Transitions *up* the priority order are always
   * allowed, so nothing here can delay a reaction to being shot at.
   *
   * This exists because the transition table is stateless and re-derived at
   * `thinkRate`: without a floor, a bot on the edge of two conditions flips
   * between them every 200 ms and vibrates in place instead of committing.
   */
  stateDwell: {
    advance: 0,
    capture: 0.4,
    engage: 0.3,
    hunt: 1.2,
    retreat: 1.5,
    /**
     * Long enough to actually commit to reaching the corner. This is the
     * difference between a bot that peeked deliberately and one that twitched
     * back the instant line of sight reopened.
     */
    takeCover: 0.8,
    suppressed: 0.6,
  },

  /**
   * Per-bot skill. Every bot carries a `skill` in 0..1 and reads its concrete
   * numbers from a lerp between these two ends, so a firefight has aces and
   * rookies rather than sixteen identical shooters.
   *
   * Ends, not a single value plus a variance, because the interesting tuning
   * question is always "what does the worst one do" and "what does the best
   * one do" — a mean tells you neither.
   */
  skill: {
    /**
     * What every bot uses until per-squad assignment lands.
     *
     * Not 0.5: the bands are centred on "a spread of soldiers", not on the
     * old flat constants, and a mid-table draw lands measurably *worse* than
     * the pre-skill bot (a wider cone, a slower trigger, a shorter burst).
     * 0.65 puts reaction, spread and burst back on the old numbers, so the
     * only deliberate lethality changes are the ones with counterplay
     * attached — the reload window and the lagging aim point.
     */
    defaultSkill: 0.65,
    /**
     * Difficulty tiers. Each slides the centre of the skill distribution;
     * `spread` is the half-width of the band a squad is drawn from and stays
     * constant, so **every** tier still contains aces and rookies. That is
     * deliberate — a difficulty that only moves a mean produces sixteen
     * identical shooters who are all slightly better, which is exactly the
     * uniformity this whole system exists to break.
     *
     * Skill is drawn per *squad*, with a small jitter inside it: an elite
     * squad and a green squad is something a player can read and respond to,
     * where salt-and-pepper skill inside a squad just reads as noise.
     *
     * `blurb` is what the menu's panel says a tier means, and it is here
     * beside the number it describes rather than in the UI: `centre` is the
     * only thing that decides how these bots actually behave, so a line about
     * them written anywhere else is a line that goes stale the next time this
     * number is tuned.
     */
    difficulties: [
      {
        name: "Recruit",
        centre: 0.25,
        blurb: "Slow to react and quick to lose you. A tier to learn a map in.",
      },
      {
        name: "Regular",
        centre: 0.5,
        blurb: "Takes cover, calls contacts, and misses often enough to be pushed.",
      },
      {
        name: "Veteran",
        centre: 0.75,
        blurb: "Holds angles, punishes a second peek, and rarely wastes a flank.",
      },
      {
        name: "Elite",
        centre: 0.95,
        blurb: "Fires before you have finished leaning out. Bring the squad.",
      },
    ],
    /** Default tier index — `Regular`. */
    defaultDifficulty: 1,
    /** Half-width of the band a squad's centre is drawn from. */
    squadSpread: 0.2,
    /** Half-width of the per-bot jitter inside its squad's centre. */
    botSpread: 0.12,
    /**
     * Seed for the skill draw. Seeded rather than `Math.random()` for the
     * same reason world-building is: a round has to be reproducible, or
     * tuning seven stages of new behaviour against it is guesswork.
     */
    seed: 0x5eed,
    /** Seconds between acquiring a target and the first shot. */
    reactionTime: { rookie: 0.55, ace: 0.18 },
    /**
     * Fraction of the reaction time still owed when a bot re-acquires an
     * enemy it was already tracking.
     *
     * This exists because losing sight of a target has to null it, and a
     * null-then-reacquire reads as a target *change*, which resets the
     * wind-up — the exact failure that once made bots never fire at all. An
     * ace keeps most of its wind-up across a lost second and punishes your
     * second peek much faster than your first; a rookie starts over.
     */
    reacquireCredit: { rookie: 0.85, ace: 0.3 },
    /** Multiplies `spreadNear`/`spreadFar`. */
    spreadMult: { rookie: 1.6, ace: 0.7 },
    /**
     * How fast the aim point chases the target, per second.
     *
     * The most important number here. Bots used to aim at the target's exact
     * eye position on every shot, so a strafing player was hit at the same
     * rate as a stationary one and lateral movement bought nothing. A lagging
     * aim point makes movement work, and makes an ace feel *different* from a
     * rookie rather than merely luckier.
     */
    trackRate: { rookie: 4, ace: 14 },
    /** Yaw slew, per second. Replaces a hardcoded `dt * 8`. */
    turnRate: { rookie: 4.5, ace: 11 },
    /** Rounds per burst, and the pause between bursts. */
    burstSize: { rookie: 3, ace: 6 },
    burstPause: { rookie: 1.3, ace: 0.6 },
    /** Seconds spent reloading, once the magazine runs dry. */
    reloadTime: { rookie: 2.8, ace: 1.7 },
    /**
     * Half-angle of the vision cone, radians. 0.85 is a ~97 deg cone, 1.15 a
     * ~132 deg one — a useful human field of view, against the 360 deg
     * omniscience bots had before, where one with its back turned acquired
     * you the instant you rounded a corner.
     *
     * This only gates *initial* acquisition: a bot faces its target once it
     * has one, so a tracked enemy never falls out of the cone. That is the
     * intended behaviour — you can flank an unaware bot, not a fighting one.
     */
    fov: { rookie: 0.85, ace: 1.15 },
    /**
     * Inside this, an enemy is noticed regardless of facing. Nobody misses
     * someone at arm's length, and without it a bot can be knifed by an enemy
     * standing on its toes.
     */
    peripheralRange: { rookie: 5, ace: 9 },
    /**
     * Health fraction below which a bot under fire breaks contact instead of
     * trading. Aces disengage while they still can; rookies die in place.
     */
    retreatHealthFrac: { rookie: 0.2, ace: 0.45 },
    /**
     * How readily a bot breaks for cover rather than standing and trading.
     * Below `coverUseThreshold` it simply never does — which is the most
     * legible skill tell available: rookies fight in the open and die there,
     * where an ace is behind the corner before the second burst lands.
     */
    coverUse: { rookie: 0.1, ace: 1.0 },
    /**
     * Below this `coverUse`, a bot never breaks for cover at all. A hard
     * floor rather than a probability so the difference is *legible*: the
     * worst bots visibly fight in the open, every time, instead of doing it
     * a bit less often than the good ones.
     */
    coverUseThreshold: 0.3,
    /** Seconds a bot stays leaned out shooting before pulling back in. */
    peekOutTime: { rookie: 1.5, ace: 0.55 },
  },
} as const;

/** Navigation grid covering the whole map. */
export const nav = {
  /** Cell size in metres. 1.5 over a 240 m map gives a 160x160 grid. */
  cellSize: 1.5,
  /**
   * Half-width of a bot's body, used by `ObstacleField` to hold it off
   * collider faces. The rig's shoulders span ~0.35 m either side, so this is
   * a body plus a little air. Raising it past ~0.7 makes the narrowest
   * authored doorway (1.6 m, the cottages) impassable.
   */
  bodyRadius: 0.4,
  /** Max step-up a bot can walk over without a ramp. */
  stepHeight: 0.6,
  /**
   * Standable surfaces `NavGrid` tracks per cell, where a map does not say
   * otherwise (`MapLayout.surfaces`).
   *
   * Three is a VILLAGE's worst case — creek floor, bank top, bridge deck in
   * one column — and it is a default rather than a limit because the number a
   * map needs is a property of how that map stacks. A downtown block is
   * pavement plus two upper floors plus a roof and needs more; raising it for
   * every map would spend the memory (see `MapLayout.surfaces`) on valleys
   * that stack nothing.
   */
  maxSurfaces: 3,
} as const;
