/**
 * config/vehicles.ts — the one vehicle in the game: what it is made of, how it
 * drives, what its gun does, and how little of a rifle round it feels.
 * Owns: every tunable a tank reads. The BOXES it is drawn from are art and stay
 * in `entities/TankModel.ts`; the extents below are not art — `hull` is the
 * collider a body walks into and a round stops on, and `hitRadius` is the
 * sphere every shot is tested against, so both are rules.
 *
 * **`resist` is where "what a hull is afraid of" is WRITTEN DOWN rather than
 * left as a property of the numbers elsewhere.** A tank takes every kind of
 * damage through one door (`Tank.takeDamage`) and scales it by the kind that
 * arrived, which is what let the anti-tank kit arrive as `shell`-kind ordnance
 * (`CONFIG.equipment`) without a figure here moving. What the small-arms figure
 * buys is that the destruction and the respawn stay REACHABLE for a team with
 * no launcher in it — a squad emptying into a hull for a minute does kill it —
 * which is what makes the timer below something that can be watched rather than
 * reasoned about.
 *
 * Gotcha: `camera.distance` is measured from the hull's CENTRE, not its back,
 * so it has to clear half the hull's length before it clears the hull at all.
 */

export const vehicles = {
  /**
   * How close to a hull a player must stand to be offered a way in, measured
   * from the hull centre. Comfortably past the hull's own half-length (3.6),
   * because the offer has to survive walking around the thing: an entry radius
   * inside the geometry is one you can stand ON the vehicle and not get.
   */
  enterRadius: 6.5,
  /**
   * How far to the side of the hull a dismounting player is put down, from the
   * centre. Outside the collider's half-width (1.7) plus a body's own radius,
   * or the step out is a step into a box `moveWithCollisions` then has to push
   * them out of — which it does sideways, and which reads as the tank spitting
   * you across the street.
   */
  exitOffset: 3.4,
  /**
   * Seconds from a hull being destroyed to a fresh one at the team's own spawn.
   * Long enough that losing it is a loss — a Conquest round runs about eight
   * minutes, so this is a twentieth of one — and short enough that a team is
   * not without armour for the rest of the match.
   */
  respawnDelay: 45,
  /**
   * How long the burnt-out hull stays where it died before it is taken away.
   * It keeps its collider for all of it, so a wreck is cover: that is the whole
   * reason it is not simply hidden on the frame it dies. Must stay under
   * `respawnDelay`, or a team would field two hulls at once.
   */
  wreckTime: 16,
  /**
   * What the AI does with a hull, and the whole of what it is allowed to do
   * with one.
   *
   * **A bot crew is one bot doing both jobs**, exactly as the player is: it
   * drives, it lays the gun and it pulls the trigger. A separate gunner would
   * be a second roster slot spent on a body nobody can see, and the thing a
   * commander/gunner split actually buys — a turret that searches while the
   * hull drives somewhere else — is bought here instead by the turret simply
   * not being tied to the heading.
   *
   * The numbers below are all about being BEATABLE. A tank AI with the
   * player's reflexes and a 340 m gun is not a vehicle, it is a turret that
   * ends the round; `layTime` and `scatter` are what leave an infantryman with
   * a launcher something to do, and they are the two to move first if armour
   * feels unfair.
   */
  crew: {
    /**
     * How near a hardstanding a bot has to be to take the seat, from the hull
     * centre. Generous, and it is generous on purpose: a bot is never given
     * the tank as a DESTINATION — no flow field leads to one and a hull is not
     * an objective — so the crew is drawn from whoever happens to walk past.
     * Coldharbour puts its two hardstandings in the same corner yards as the
     * home spawns, which is what makes that work: every reinforcement walks
     * out through this circle.
     */
    boardRadius: 18,
    /**
     * Seconds between one hull's boarding attempts. A slow clock, because the
     * question is a sweep over the roster and the answer only changes when
     * somebody walks.
     */
    boardDelay: 1.5,
    /** Acquisitions a second, per crew. One ray each; two crews on the map. */
    thinkRate: 3,
    /**
     * How far a crew will shoot. Far shorter than the gun's own 340 m range,
     * which is what a shell can carry rather than what a crew can see: a tank
     * that opened fire across the whole map would be shooting at bodies three
     * pixels wide through fog the player cannot see through either.
     */
    engageRange: 95,
    /**
     * How near a target the crew tries to hold station, in metres. Inside it
     * the hull backs off — a tank pressed against infantry is a tank being
     * mined — and outside it the hull closes.
     */
    standoff: 26,
    /**
     * What the throttle is capped at while a target is being engaged. Not
     * zero: a stopped tank in the open is a rocket magnet, and the crew has to
     * keep the fight moving. Not one either — the turret is the thing doing
     * the work and dragging the hull round under it wastes traverse.
     */
    engageThrottle: 0.45,
    /**
     * How close the gun must be to the aim order before the crew will fire, in
     * radians. Tight, because the shell is hitscan and a degree at 90 m is a
     * metre and a half of miss.
     */
    fireCone: 0.02,
    /**
     * Seconds the gun must be settled inside `fireCone` before the trigger
     * goes. The crew's reaction time, and `Bot.aimT`'s exact counterpart: a
     * turret that fired on the frame it arrived would be indistinguishable
     * from one that had been laid there all along.
     */
    layTime: 0.55,
    /**
     * Metres of scatter on the aim point at `engageRange`, and pro rata below
     * it. `CONFIG.antiTankBots.scatter`'s counterpart from the other end of
     * the same duel — what keeps a hull from being a guided shell, exactly as
     * that keeps a launcher bot from being a guided rocket.
     */
    scatter: 2.2,
    /**
     * How many cells down the flow field the driver looks. Longer than a
     * body's, because a hull is four cells long and steering at the next cell
     * centre would be the 1.5 m zigzag `NavGrid.steerAhead` was written to
     * cure, at seven metres of vehicle.
     */
    lookahead: 8,
    /**
     * The fan of whiskers: how many bearings are probed, how far to each side
     * of the wanted one, and how far ahead each looks.
     *
     * The reach is what decides how early a hull turns, and it wants to be
     * about a hull-length-and-a-half: shorter and the tank commits to a wall
     * before it sees one, longer and it swerves around buildings it was going
     * to pass anyway.
     *
     * **The SPREAD is wide because it is the detour as well as the swerve.**
     * There is one route graph and it is a body's, so a driver following it
     * will regularly be aimed at a frontage a tank cannot use — and the answer
     * is almost always available at ninety degrees, which is the street the
     * building is on. At a narrow spread the fan finds nothing, the hull backs
     * out, drives forward on the same bearing and does it again: measured on
     * Coldharbour at 1.15 rad, a crew closed to 122 m of its objective and
     * then ground against the same colonnade for the rest of the run. The fan
     * is searched in ascending deviation, so a wide spread costs the common
     * case nothing — the straight-on bearing is still tried first, and a
     * blocked one is abandoned at its first failed probe.
     */
    whiskers: 13,
    whiskerSpread: 2,
    whiskerReach: 11,
    /**
     * How hard the hull turns onto the bearing it picked, as a multiple of the
     * heading error in radians. Saturates at full stick well inside a right
     * angle, which is what stops a driver feathering its way round a corner.
     */
    steerGain: 2.4,
    /**
     * How far off the wanted heading the hull will still drive at full
     * throttle, in radians. Past it the throttle falls away to nothing at a
     * right angle, so a tank facing the wrong way pivots instead of driving a
     * long arc into whatever is beside it.
     */
    driveCone: 0.6,
    /**
     * A bearing far enough off the wanted one to count as going ROUND
     * something rather than easing past it, in radians — and how long the hull
     * commits to one once it has picked it.
     *
     * **Commitment is what a fan on its own cannot give.** The whiskers are
     * re-evaluated every frame from a hull that has just turned, so the
     * bearings that were blocked a moment ago open as the nose swings and the
     * one being followed closes: measured on Coldharbour, a driver that
     * re-picked freely sat at one corner for fourteen seconds with the stick
     * flipping hard over every second and the hull going nowhere. Holding the
     * bearing for a few seconds is `Bot.detourT`'s answer to the identical
     * problem, and the time is set by what it has to get past — three seconds
     * at road speed is 33 m, against a 26 m tower footprint.
     *
     * The commitment is dropped early the moment the bearing itself stops
     * being clear, so it can never drive a hull into something new.
     */
    detourAngle: 0.5,
    detourTime: 3,
    /**
     * The stuck watchdog: how long the hull may ask for speed and not get it
     * before the driver gives up and backs out, how slow counts as not
     * getting it, and how long it reverses for.
     *
     * `Bot.stuckT`'s counterpart, and it is needed for the same reason — the
     * flow field is a BODY's route and a hull is not a body, so a driver
     * following one will eventually be aimed at a doorway. Backing out and
     * re-approaching is the whole recovery; there is no second route to pick.
     */
    stuckTime: 1.4,
    stuckSpeed: 0.8,
    reverseTime: 1.8,
    /**
     * How hard the hull steers while it backs out, as a fraction of full
     * stick. The SIDE is fixed per crew and split by team rather than drawn,
     * so a hull that has backed off a wall always shoulders the same way round
     * it instead of oscillating — and the two hulls on a map do not both pick
     * the same way out of the same street.
     */
    reverseSteer: 0.7,
  },
  tank: {
    maxHealth: 1200,
    /**
     * `Hittable.hitRadius`, which a hull has to declare and which **nothing
     * reads any more**.
     *
     * A round is tested against the hull's COLLIDER — see `CombatSystem.fire`
     * — because a sphere and a box in front of it cannot both answer and the
     * sphere always lost: at 3.2 against a half-length of 3.6, anything
     * arriving within ~32 deg of the nose or the tail met the box first and
     * was thrown away as a target standing behind a wall. Widening it to
     * swallow the box is the trap it was written to avoid, and is why the
     * answer was the box instead: three and a half metres of live air off each
     * end is where the infantry beside the tank are standing.
     *
     * Left at its old value rather than deleted, because the interface wants a
     * number and this is the honest one for a seven-metre hull.
     */
    hitRadius: 3.2,
    /**
     * The collider box, and therefore the tank's whole physical presence: what
     * a body walks into, what a round stops on, what a sightline is broken by,
     * and what a player can climb onto. There is no second, finer shape — see
     * `Tank`'s header on why a vehicle gets one box and not a hierarchy.
     */
    hull: {
      length: 7.2,
      width: 3.4,
      /**
       * Tracks to turret roof, not just the hull.
       *
       * **The turret is INSIDE the box on purpose**, and the alternative was
       * tried: a box that stopped at the hull deck let every round aimed at the
       * turret — which is most of them, because it is the tallest part and the
       * part with the gun on it — pass over the collider entirely. The hit
       * sphere still caught the damage, so the tank took the hit; what was
       * missing was the SPARK, and a round that damages a vehicle without
       * marking it reads as a miss that happened to work. The box is a little
       * generous around the turret's shoulders as a result, which is the
       * cheaper error.
       */
      height: 2.9,
    },
    /**
     * Where the commander stands, above the hull's floor. Bots test line of
     * sight to this point and aim at it, exactly as they do a soldier's eye —
     * so it has to be somewhere a round arriving at it would plausibly have
     * crossed the hull, which is why it is the cupola and not the roof line.
     */
    cupolaHeight: 2.95,
    drive: {
      /**
       * 11 m/s is 40 km/h — a main battle tank's road speed, and about 2.4x an
       * infantry jog. It has to beat a sprint (6.9) by enough that taking the
       * tank is a decision about crossing ground, or it is a gun emplacement
       * that happens to move.
       */
      maxSpeed: 11,
      /** Reverse is half of it, which is what makes backing out of a street a commitment. */
      reverseSpeed: 5.5,
      /** m/s^2. ~2.4 s to road speed: heavy, but not so heavy that a corner is a minute. */
      accel: 4.6,
      /** m/s^2 off the throttle, and the same figure braking. Tracks stop a tank fast. */
      brake: 9,
      /**
       * rad/s of hull yaw at full steer — about 51 deg/s, a neutral-steer turn.
       * Available at a standstill on purpose: tracks turn on the spot, and a
       * vehicle that needs forward motion to point somewhere is a car.
       */
      turnRate: 0.9,
      /**
       * How much of the turn survives at road speed, 0..1. A tank does not
       * pivot at 40 km/h, and steering that stayed full-rate at speed made the
       * chase camera swing far harder than the hull looked like it was turning.
       */
      turnAtSpeed: 0.45,
      /**
       * How fast the drawn hull leans onto the ground it is standing on
       * (per second, frame-lerp). The pitch and roll are cosmetic — the
       * collider box never tilts — so this is free to be slow enough to read
       * as suspension rather than as a mesh snapping to a normal.
       */
      tiltRate: 6,
      /**
       * The same rate for a hull that is IN THE AIR, and it is far slower for
       * a reason that is not a look: nothing off the ground can change which
       * way it is pointing.
       *
       * The attitude a hull is asked for is measured off its track contacts
       * against the ground BELOW it, which a falling tank is nowhere near —
       * so at the ground rate a hull that drove off a ledge nose-down would
       * level itself out on the way down and land flat, which is the tell that
       * the drop is a lift being lowered rather than a mass in free flight. At
       * this rate it keeps the attitude it left with, lands on it, and takes
       * the ground's own angle once the tracks are back on something.
       */
      airTiltRate: 1.1,
      /** How far the hull may lean, either axis, in radians. ~14 deg. */
      tiltLimit: 0.25,
      /**
       * The XZ radius of the sphere `moveWithCollisions` actually walks the
       * hull around with, and it is a COMPROMISE that deserves stating.
       *
       * Babylon's collision ellipsoid is axis-aligned in WORLD space and does
       * not turn with the mesh, so a 7.2 x 3.4 hull cannot be described by one:
       * an ellipsoid long enough for the hull nose-on is far too wide broadside
       * a quarter-turn later, and it would grow and shrink as the tank turned.
       * So the shape is a circle, and the only question is which radius — and
       * then WHERE ALONG THE HULL it sits, which is the half that was missing.
       *
       * **The sphere rides at the LEADING END, not at the middle**, offset by
       * `hull.length / 2 - collideRadius` along whichever way the hull is
       * travelling (`Tank.aimCollider`). A circle of this radius parked on the
       * hull's centre stops the tank when its CENTRE is 2.2 m off a wall, which
       * leaves 1.4 m of nose inside the shopfront — the single most-reported
       * thing about driving one. Moved forward by that same 1.4, the sphere's
       * leading edge is the hull's own nose and the tank stops where it looks
       * like it should. Reversing mirrors it, so the tail is what stops.
       *
       * What it costs is that the TRAILING half of the hull is not collided
       * while the hull is moving — the sphere spans -0.8 to +3.6 driving ahead.
       * That is affordable because the yaw is not collided either (a hull
       * pivots through whatever it is beside, and always has), so the tail was
       * never guarded during the only manoeuvre that swings it.
       *
       * The radius itself is a little over half the WIDTH (1.7), which errs
       * toward stopping early — the better of the two errors, because a hull
       * that stops short reads as a driver being careful and a hull inside a
       * shopfront reads as a bug. It also sets the narrowest gap a tank can
       * drive through (twice this). Coldharbour's avenues are 16 m, so nothing
       * on that map is close.
       */
      collideRadius: 2.2,
      /**
       * Gravity on a hull, m/s^2. The same figure the player falls at, restated
       * here rather than read from `CONFIG.player` because a vehicle reaching
       * into the infantry section for a number is how the two quietly become
       * one setting that cannot be tuned apart.
       */
      gravity: 22,
      /**
       * How tall a thing the tracks will ride OVER rather than stop against.
       *
       * **This is the one number that decides what a tank treats as ground and
       * what it treats as a wall, and it decides both at once**, which is the
       * whole reason it replaced a `stepHeight` that only ever meant the first:
       *
       * - Horizontally it is where the collision ellipsoid's floor sits, so
       *   anything shorter than this is simply not in the hull's way.
       *   `moveWithCollisions` has no notion of climbing and slides along a
       *   vertical face whatever its height, so without the lift a tank is
       *   stopped dead by a 0.3 m kerb.
       * - Vertically it is the ceiling of the band `Tank.supportAt` will accept
       *   a surface from. A top face inside the band is floor to stand on; one
       *   above it is not ground at all.
       *
       * Get the two out of step and the vehicle contradicts itself: a ceiling
       * below the ellipsoid's floor drives the hull through the bottom of
       * things it then refuses to stand on, and one above it stops the hull
       * against a box it has already decided is a step.
       *
       * 1.25 is chosen against the tallest thing on Coldharbour a tank should
       * plainly go over rather than round: a parked car, whose collider is the
       * BODY at 1.1 m (`buildCar`). A soldier's own step is 0.5 — tracks are
       * not legs, and a vehicle that had to be driven around a paving edge
       * would be unusable on the one map it exists on.
       */
      climbHeight: 1.25,
      /**
       * The steepest the hull's own floor may RISE, as a rise over the run it
       * is driving — so the climb is rate-limited by how fast the tank is
       * actually going, and 0.6 is about 31 degrees.
       *
       * **The rate limit is the whole of what makes a climb look like one.**
       * The support under a hull is sampled at six track contacts, and a
       * contact crossing the edge of a car steps from the street to the roof
       * between one frame and the next; taken literally that is a hull
       * teleporting 1.1 m into the air. Limiting the rise by the distance
       * travelled turns the same step into a slope the tank drives up, and it
       * is the physically honest limit rather than an eased one: a vehicle
       * moving at `v` up a grade of `s` rises at `v * s`, and nothing may rise
       * faster than the steepest grade it can hold.
       *
       * It is why terrain costs nothing here. A hill asks for exactly
       * `speed * grade`, which is inside this for every slope on any shipped
       * map, so the limiter never touches a tank driving over ground and only
       * ever bites on a STEP.
       */
      climbSlope: 0.6,
      /**
       * The rise a hull is allowed even at a standstill, m/s. Small, and it
       * exists so a stopped hull whose ground came up under it — a pane
       * breaking, the editor rebuilding, a fresh hull placed low — still
       * settles instead of hanging there for the rest of the round.
       */
      climbFloor: 0.5,
      /**
       * What climbing costs the drive, as a fraction of speed per second, for
       * as long as the ground is above the hull and the rise above is what is
       * holding it back.
       *
       * Without it a tank rides over a car at an unchanged 40 km/h, which reads
       * as the car being made of paper. With it there is a shove and then a
       * climb, and the driver feels the obstacle rather than watching it.
       *
       * Deliberately mild. It is spent through `speed`, so it reaches the
       * suspension as a DECELERATION and dives the nose — against the ~10 deg
       * of nose-up the ground lean is asking for at the same moment, and a
       * figure large enough to cancel that would have the hull nodding into
       * the thing it is climbing over.
       */
      climbDrag: 0.6,
      /**
       * The most upward velocity a hull may CARRY OFF the end of whatever
       * lifted it, m/s.
       *
       * A hull that is being ridden up over something is not falling, so the
       * rise above is a velocity like any other and the moment the support
       * runs out it is the velocity gravity takes over from — which is what
       * makes cresting a rise at speed go light, and driving off the lip of a
       * ramp a jump rather than a step down. Leave it uncarried and the tank
       * pauses at the top of everything it climbs before remembering to fall.
       *
       * **What is carried is the GROUND's own rate and never the limiter's** —
       * a hull still owing a climb is being shoved rather than moving, and a
       * constraint is not a momentum. This cap is the second guard on the same
       * mistake: the plank a tank stands on is sampled at ten places and steps
       * a quarter of a metre at a time as each contact arrives, so one frame of
       * it can read as 16 m/s of rise that nothing physical is doing. At 1.5
       * the worst a step can throw a hull is a 5 cm hop, and a genuine crest at
       * road speed still takes the weight off the tracks.
       */
      launchSpeed: 1.5,
      probeLength: 6,
    },
    /**
     * What the drawn hull does about its own MASS: the dive under the brake,
     * the squat under power, the lean out of a turn and the rock of the gun.
     *
     * **Every number here is cosmetic in the strict sense the rest of the file
     * is not.** `hull` is a collider and `maxSpeed` is a rule; this block only
     * ever reaches `TankRig.hull`'s pitch and roll, which the box a round stops
     * on never takes. So it may be tuned by eye, and being wrong costs a look
     * rather than a fight.
     *
     * The two gains are stated per m/s^2 rather than as an angle at full
     * throttle, because the input is the acceleration the drive ACHIEVED and
     * not the one it was asked for: a hull held against a wall, a hull that has
     * just rammed one, and a hull braking from road speed all feed the same
     * term, and only a gain per unit keeps their relative sizes honest. Against
     * `drive.brake` (9) the dive is 6 degrees and against `drive.accel` (4.6)
     * the squat is 3, which is the asymmetry a heavy vehicle has.
     */
    suspension: {
      /**
       * Radians of nose-down per m/s^2 of deceleration along the hull.
       *
       * **Sized so that the STOPS are reached by events and not by driving.**
       * The travel budget allows about 3.3 deg of tilt (see `heaveBump`), and
       * a full brake at `drive.brake` asks for 3.0 of it once the spring's own
       * overshoot is counted — so hard braking very nearly bottoms the front
       * stations and a RAM, which arrives clamped at `accelLimit`, goes
       * straight onto them. Sized to saturate on the brake instead, every
       * deceleration over about half throttle looks identical, which is the
       * one thing a weight-transfer picture must not do.
       */
      pitchPerAccel: 0.0055,
      /**
       * Radians of lean per m/s^2 sideways, and the sideways figure is
       * `speed * yawRate` — so a neutral-steer pivot at a standstill leans
       * NOTHING, which is correct: there is no lateral acceleration in it.
       */
      rollPerAccel: 0.013,
      /**
       * How much acceleration the springs will answer to, m/s^2.
       *
       * This is a CLAMP on the input and not a limit on the output, and it is
       * what makes the one-frame events survivable: a hull that rams a wall
       * loses two thirds of 11 m/s in a single frame, which is several hundred
       * m/s^2 and would ask for a somersault. Clamped, it asks for a full dive,
       * which is what hitting a building should look like.
       */
      accelLimit: 26,
      /**
       * The spring the hull hangs on, rad/s^2 per radian, and its damping.
       * ~1 Hz at a damping ratio of 0.68 — one visible overshoot and settled
       * inside a second, which is a tracked vehicle on torsion bars rather than
       * a saloon car (which would ring) or a mesh snapping to an angle (which
       * would not move at all).
       */
      stiffness: 40,
      damping: 8.6,
      /**
       * **There is no `pitchLimit` and no `rollLimit`, and their absence is
       * the rule.** How far the body may tilt is not a number anyone gets to
       * author: it is `heaveBump`/`heaveDroop` over the distance to the
       * outermost road wheel, because a tilt is one end of the suspension
       * compressing and the other end extending, and both ends run out of
       * travel at the stops the heave uses. `Tank.flexSuspension` spends what
       * `flexHeave` has left of ONE budget, so a hull already sitting on its
       * bump stops cannot also dive — which is what bottoming out is.
       *
       * What that works out to on the drawn tank is ~3.3 deg of pitch over
       * `TankModel.WHEEL_REACH` (2.11 m) and ~5.2 deg of roll over the narrower
       * half-gauge (1.31 m) — within a couple of tenths of the pair of authored
       * limits they replace, which is the point: the look was right and the
       * REASON was missing. Retuning the travel now retunes the tilt, as it
       * does on a real vehicle.
       */
      /**
       * The rock of the gun, in rad/s straight into the tilt springs'
       * VELOCITY — NOSE UP, which is the opposite of what the shove on
       * `gun.recoilSpeed` would produce through the acceleration term if it
       * were left to it.
       *
       * **Springs plural, because the direction of it is the GUN's and not the
       * hull's.** `fireGun` splits this one impulse onto the pitch and roll
       * springs by the turret's bearing, so a shot over the left track stands
       * the hull's right side up and a shot over the tail dips the nose. The
       * magnitude is the same whichever way the turret is traversed — one
       * force, resolved, never two authored numbers that could disagree.
       *
       * A tank firing does not brake: the force is a rearward one applied a
       * metre and a half ABOVE the hull's centre, and what that does to a body
       * standing on its tracks is lift the nose. The recoil is spent on
       * `speed` outside `Tank.update`, so it never reaches the acceleration
       * term at all, and this is stated in its own right.
       *
       * **It is the one input sized to reach the stop and it is the only one**,
       * which is what keeps the gun at the top of this vehicle's vocabulary now
       * that the tilt is bounded by real travel rather than by an authored
       * angle: the impulse asks for about 3.8 deg against a budget of 3.3, so
       * firing bottoms the rear stations for a moment and rings off them. A
       * brake stops just short of that and everything else is well inside it.
       *
       * There is no vertical term to go with it and there must not be. A
       * horizontal force above the centre of mass is a horizontal force at the
       * centre of mass plus a COUPLE, and the couple is the whole of what a
       * suspension sees — so the body pitches about its middle and does not
       * heave, which is why this is spent on the pitch spring alone.
       */
      gunKick: 0.42,
      /**
       * How much of a JOLT the sprung mass keeps, 0..1 — and the jolt is
       * whatever the ground did to the hull's own vertical velocity this
       * frame, which is the third thing a suspension answers to after the
       * brake and the corner.
       *
       * **A hull that stayed exactly as far off its tracks as it was parked at
       * was the last thing making a tank look weightless**, and the fix is the
       * arithmetic that is already there rather than an animation: when the
       * ground under a vehicle changes speed the body does not, and the
       * difference is the deflection. So a landing spends the closing speed
       * into `heaveVel`, mounting a kerb spends the rise, and the top of a car
       * spends the same rise back the other way — one term, four events, and
       * nothing anywhere that knows which of them is happening.
       *
       * Under 1 because the vertical velocities this vehicle deals in are the
       * RATE LIMITER's as often as they are gravity's, and `climbSlope` at
       * road speed is 6.6 m/s of rise that a real tank climbing a car would
       * never see. At 0.28 a 1.1 m drop off the back of one bottoms the springs
       * and rebounds, and a kerb is a nod.
       */
      heaveResponse: 0.28,
      /**
       * The spring the BODY hangs on above its running gear, rad/s^2 per
       * radian and its damping — or rather m/s^2 per metre, because this is
       * the one axis of the suspension measured in distance.
       *
       * Stiffer and less damped than the pitch spring next door (1.2 Hz at
       * 0.5 against 1 Hz at 0.68): a hull rocking fore and aft is a mass
       * turning about its own middle and a hull dropping onto its torsion bars
       * is the bars alone, which is the faster of the two on every tracked
       * vehicle. One clear rebound and settled inside a second.
       */
      heaveStiffness: 55,
      heaveDamping: 6.4,
      /**
       * The most a single frame of ground may hand the springs, m/s.
       *
       * `accelLimit`'s counterpart on the third axis, there for the identical
       * reason: the events this vehicle deals in are one frame long and the
       * arithmetic behind them is bounded by nothing physical. A contact
       * crossing the edge of a car steps a quarter of a metre between two
       * frames, which is 16 m/s of ground that nothing physical is doing.
       *
       * 9 is about the two-metre drop it takes to bottom the springs out of
       * full droop, and it is deliberately ABOVE the 6.6 the climb limiter
       * hands over: the two events this has to keep apart are a plank STEP and
       * a long fall, and a clamp tight enough to flatten the step flattens the
       * fall with it — measured at 4.5, a hull dropped three metres compressed
       * 3 cm where one driving off a car compressed 7, which is the wrong way
       * round. Over the top of this there is only arithmetic left.
       */
      joltLimit: 9,
      /**
       * How far the body may travel down onto its running gear and up off it,
       * in metres, and the two are NOT the same number because a real vehicle
       * is not symmetric about them either: a tank sits nearer its droop stop
       * than its bump stop, which is what leaves it room to absorb rather than
       * room to sag.
       *
       * **This pair is the WHOLE travel budget of the suspension and not just
       * the heave's**, which is the difference between this and what it
       * replaced. `flexSuspension` spends what is left of it on the tilt, at
       * the outermost road wheel, so no combination of dive, lean and landing
       * can put a station past a stop. Three clamps that could each be legal
       * and jointly put the hull through the road are what this is instead of.
       *
       * **`heaveBump` is sized so that it can actually be REACHED**, which is
       * the one thing a stop has to be. The most the ground can ever hand the
       * springs is `joltLimit * heaveResponse` — 2.5 m/s, by construction,
       * whether it came off the edge of a car or out of a three-metre fall —
       * and into this spring that is about 15 cm of travel. Set above that,
       * nothing in the game bottoms out and the number is dead space; set at
       * it, the hardest events this vehicle meets arrive on the stop and ring
       * off it, which is the heaviest thing it does.
       *
       * It is short of a real MBT's ~25 cm of bump and deliberately so: what
       * bounds it here is the impulse path rather than the geometry, and
       * `TankModel.BELLY` (34 cm) is sized to clear this plus the tilt the
       * same budget allows, with room over. It is still more than TWICE the
       * 7 cm it replaced, which was a belly clearance mistaken for a spring.
       *
       * `heaveDroop` is the other stop and nothing structural sets it: an
       * extending body simply lifts off its own running gear, which is what a
       * tank going light looks like. What it is sized against is the LOOK — at
       * 16 cm the road wheels stand clear above the fender line and the hull
       * reads as levitating rather than as unloaded — and against the deepest a
       * fall can pull anyway, which is `gravity * heaveResponse / heaveStiffness`
       * and is 17 cm — over the stop, so a hull in the air simply sits on it.
       * It is the SMALLER of the two, so it is also what bounds the TILT: a
       * nose-down dive is a tail-up extension, and the end going up runs out
       * of travel before the end coming down does.
       */
      heaveBump: 0.15,
      heaveDroop: 0.12,
    },
    /**
     * The two whip antennae off the turret's bustle — the only parts of this
     * vehicle that are not rigid, and the smallest thing on it that carries the
     * most information about what it is doing.
     *
     * **A whip is the suspension's argument one derivative further out.** The
     * hull leans because the drive knows the acceleration it achieved; a whip
     * bends because of that same acceleration AND because of how fast the thing
     * it is bolted to is turning — the mast trails a rotating base exactly as a
     * body thrown back in a seat trails an accelerating one. So there is no new
     * measurement here: `Tank.flexAntennae` reads the numbers `flexSuspension`
     * already has, plus the rate the hull node is leaning at, and everything
     * below is a gain on one of them.
     *
     * **Cosmetic in the same strict sense `suspension` is**: this block reaches
     * two `TransformNode`s per whip and nothing else. Nothing aims, walks,
     * collides or is picked against an antenna.
     *
     * The input clamp is deliberately NOT restated here — `flexAntennae` bounds
     * its accelerations with `suspension.accelLimit`, because a whip and a hull
     * that disagreed about how hard a hull just hit a building would come apart
     * in exactly the frame the picture matters most.
     */
    antenna: {
      /**
       * Radians of TIP deflection per m/s^2, both axes. The lateral figure is
       * `speed * yawRate` as the suspension's is, so a neutral-steer pivot
       * whips nothing sideways — correct for the same reason it leans nothing.
       *
       * About three times the hull's own `pitchPerAccel`, and that ratio is the
       * point: a mast is what a heavy vehicle has INSTEAD of visible body roll,
       * so a figure that read as "the same lean, higher up" would say nothing
       * the hull was not already saying. Against `drive.brake` (9) the tip asks
       * for 17 degrees and reaches 24 through the spring's own overshoot, which
       * is a whip laid back under a hard stop and still inside `bendLimit` —
       * the clamp is for the ram, not for the brake.
       */
      swayPerAccel: 0.032,
      /**
       * Radians of trail per rad/s the whip's own base is rotating at.
       *
       * This is the term that makes the gun visible from outside the tank. The
       * hull rocks nose-up ~6 degrees when the main gun fires and gets there in
       * about a fifth of a second, which is some 0.5 rad/s of base rotation —
       * so the whips bend a fifth of a radian the other way and then ring, and
       * a hull firing has two masts cracking behind the turret rather than a
       * box that jolted. It picks up kerbs and craters through the ground lean
       * for free, because both halves of the hull's attitude are summed before
       * the rate is read off it.
       */
      lagPerRate: 0.42,
      /**
       * The spring the LONG whip hangs on, rad/s^2 per radian, and its damping.
       * ~2.4 Hz at a damping ratio of ~0.24: four or five visible swings before
       * it settles, which is what separates a mast from a lever. The hull's own
       * spring is the opposite tuning (1 Hz, 0.68) and deliberately so — a hull
       * that rang would be a car, and a whip that did not would be a rod.
       *
       * **The SHORT whip is not given numbers of its own.** A cantilever's
       * natural frequency goes as 1/L^2, so `Tank` scales these by the square
       * of the length ratio it reads off `ANTENNA_LENGTHS` — the 1.2 m mast
       * comes out 1.6x faster than the 1.5 m one, which is why the pair never
       * beat in step. Retuning one retunes both, and that is the intent.
       */
      stiffness: 230,
      damping: 7.2,
      /**
       * How far the tip may bend, either axis. ~26 degrees, and a limit rather
       * than a target: the springs are underdamped on purpose and this is what
       * a ram — several hundred m/s^2 clamped to `accelLimit` and then rung
       * through an overshoot — is not allowed to fold the mast past.
       */
      bendLimit: 0.46,
      /**
       * How the bend is DISTRIBUTED between the two links a whip is drawn as.
       *
       * A cantilever's curvature is greatest at the root and zero at the tip,
       * so the lower link takes most of the angle and the upper link finishes
       * it — a straight rod pivoting at its base is a lever, and the whole read
       * being bought here is a CURVE.
       */
      baseShare: 0.62,
      /**
       * How fast the tip's angle catches the base's, 1/s.
       *
       * The second half of the curve, and the half that only exists while the
       * whip is moving: the tip is a lagged copy of the bend, so a fast event
       * leaves the upper link bent BACK against the lower one — an S — and a
       * settled whip has the two agreeing and reads as one smooth bow. 14/s is
       * about a fifth of the spring's own period, which is enough lag to see at
       * fifteen metres and not enough to look broken.
       */
      lagRate: 14,
      /**
       * The idle stir, because a parked hull with two dead-straight masts is
       * the same tell a perfectly level one was.
       *
       * The BEARING is `CONFIG.wind.dir` and is not restated — `CLAUDE.md`'s
       * rule is that there is one wind and everything leaning in it leans the
       * same way, and this is the third layer to key off it after the grass and
       * the foliage. What is per-layer is the amplitude and the speed, exactly
       * as `config/wind.ts` splits them: a mast answers a gust faster than a
       * crown of leaf and slower than a blade of grass.
       *
       * `sway` is radians at a full gust and is small enough to be motion
       * rather than a lean — the whips are never seen against anything but the
       * sky, where a couple of degrees of drift at the tip is plainly visible.
       */
      wind: { sway: 0.05, speed: 1.1 },
      /**
       * The gun, in rad/s straight into both whips' springs — out along the
       * GUN's axis, because the recoil shoves the hull back down that axis and
       * what that does to a mast standing on it is throw the tip out ahead of
       * the muzzle.
       *
       * It takes no bearing, and unlike `suspension.gunKick` it never did need
       * one: a mast hangs off the TURRET and so does the gun, so this is the
       * one term on the vehicle that traversing cannot turn.
       *
       * **Stated in its own right for exactly the reason `suspension.gunKick`
       * is, and it is the second half of the same argument.** The shove is
       * spent on `speed` outside `Tank.update`, so what the drive terms see of
       * a shot is only the QUARTER SECOND AFTERWARDS, where the tracks brake
       * the hull back to a stop — and that acceleration is forwards, which lays
       * the masts back. Measured, the two came out within a couple of degrees
       * of cancelling: the hull rocked six degrees nose-up and the antennae sat
       * still through the loudest event on the vehicle, then swung on the
       * REBOUND. So the impulse is said here, the drag that follows it is left
       * alone, and the pair read as one crack forward and back.
       *
       * Not scaled per mast, and that is the point of an impulse: a spring
       * answers `v / w`, so the short stiff whip takes less of it than the long
       * one on its own — which is what a shorter mast does.
       */
      gunKick: 5,
    },
    turret: {
      /**
       * rad/s. The whole reason the reticle can be honest in a third-person
       * view: the player's look moves a WANTED angle and the turret walks to
       * it at this rate, so the gun marker and the gun are the same fact. About
       * 40 deg/s — a full traverse takes nine seconds, which is what makes
       * being flanked matter.
       */
      traverseRate: 0.72,
      /** rad/s of gun elevation. Faster than the traverse; a gun is lighter than a turret. */
      elevationRate: 0.55,
      /**
       * rad/s^2. **How fast the traverse itself may change, which is the
       * difference between a turret with mass and a stepper motor**, and it is
       * the half of the answer a rate limit cannot give.
       *
       * A limit on the RATE says nothing about how a turret arrives at one, so
       * the old walk started and stopped inside a single frame: measured, the
       * last frame of every sweep went from full traverse to nothing at
       * 35 rad/s^2, sixty tonnes of turret arrested in a sixtieth of a second,
       * with the gun marker snapping onto the reticle rather than settling
       * onto it. With an acceleration nothing on the barrel can exceed this
       * figure by construction — it IS the ceiling on the gun's jerk — and
       * `Tank` decelerates INTO the order rather than at it, which is what puts
       * the last few degrees of every lay on a ramp instead of a wall.
       *
       * 0.3 s from rest to full traverse, and 6.2 deg of lead-out to stop from
       * it. Both are a fraction of the nine seconds a full traverse takes, so
       * this costs the flanking argument above nothing. What rejects the
       * per-frame WOBBLE in a hand's order is `settleTime` below; this is what
       * gives the movement weight.
       */
      traverseAccel: 2.4,
      /**
       * rad/s^2 of elevation. Higher than the traverse for the same reason
       * `elevationRate` is: a gun is lighter than a turret, and a hand nudging
       * the aim up onto a roofline is a smaller movement than a sweep and must
       * not feel damped. 0.17 s to full elevation, 2.7 deg of lead-out.
       */
      elevationAccel: 3.2,
      /**
       * Seconds. The time constant the last degree of a lay is closed on, and
       * it is there because a deceleration law alone is a lie at small angles.
       *
       * `Tank`'s slew asks for the fastest rate it could still stop from, which
       * near zero error is a rate falling as its square root — still exact at a
       * hundredth of a degree, where it wants a rate no frame can resolve and
       * the gun lands on the order one frame and steps off it the next. That is
       * the same chatter the acceleration exists to remove, one scale down. So
       * the error's own decay takes over below about a degree and the gun eases
       * onto the aim instead: there is then no error, at any size, where the
       * barrel is a copy of a noisy order again.
       *
       * **This is also the LAG a turret carries while it is tracking, and that
       * is not a defect to be tuned away — it is what filtering IS.** An axis
       * that follows a noisy order with no lag has not rejected the noise, it
       * has passed it on; the steady-state error while tracking at `v` is
       * exactly `v * settleTime`, and buying quiet costs that. What bounds it
       * is a number in another block: `crew.fireCone` (0.02 rad) is the gate an
       * AI crew's trigger is behind, and a turret whose lag exceeds it stops
       * firing at anything that MOVES rather than merely shooting behind it.
       * At 0.06 a target crossing at 0.3 rad/s — a tank at road speed inside
       * 40 m — leaves 0.014 and the crew still shoots. **Raising this past
       * about 0.1 disarms bot armour against moving targets**, silently and
       * from the other side of the config.
       *
       * Shared by both axes — it is a number about a HAND finishing a movement
       * rather than about what is being turned, and the two axes' masses are
       * already stated in their accelerations. Measured against the drag that
       * prompted all of this: 0.06 leaves a quarter of the barrel jitter the
       * old bare rate limit passed through, and 0.12 leaves an eighth and puts
       * the crew outside its own cone.
       */
      settleTime: 0.06,
      /** How far the gun depresses and elevates. -8 deg to +18 deg. */
      pitchMin: -0.14,
      pitchMax: 0.32,
    },
    gun: {
      /**
       * A direct hit, before the target's own resistance. Against infantry it
       * is academic — anything over 100 is a kill — and against another hull it
       * is the number that matters: 600 through `resist.shell` of 1 means two
       * clean hits and the blast finish a tank, which is the duel this is
       * tuned for.
       */
      damage: 600,
      /**
       * Where the round stops. Longer than the DMR's 180 because a tank on
       * Coldharbour is shooting down 320 m avenues and the whole point of the
       * map's sightlines is that a weapon's own range is the binding
       * constraint. There is no fall-off: a shell is a shell at any distance
       * this map contains.
       */
      range: 340,
      /** Seconds between rounds. A loader, not a trigger. */
      cooldown: 3.6,
      /** The splash at the impact point — full inside `blastInner`, nothing past `blastRadius`. */
      blastRadius: 7,
      blastInner: 2.6,
      blastDamage: 350,
      /**
       * How big that splash LOOKS, with the grenade as 1 — the `power` handed
       * to `GrenadeSystem.blastAt`, and the only thing a tank shell says about
       * its own explosion.
       *
       * **It is deliberately not derived from `blastRadius`**, which is 7
       * against the grenade's 8.5: a shell reaches less far and hurts far more
       * inside where it does, and a picture scaled off the radius would draw
       * the heavier weapon as the smaller bang. Every layer of the blast takes
       * this — the fireball, the shock ring, the smoke, the chunks it throws,
       * the light, the shake and the report — so raising it raises all eight
       * together, which is the point of there being one number.
       *
       * Just under twice the grenade: a 120 mm HE round against a hand-thrown
       * frag, drawn as a fireball six metres across rather than three and a
       * column of smoke you can see from the next flag.
       */
      blastPower: 1.85,
      /**
       * How hard the hull is shoved backwards by its own gun, in m/s off the
       * current speed. Small, and cosmetic in the sense that it is spent
       * against the drive within a second — but it is what makes a stationary
       * tank rock when it fires.
       *
       * Backwards along the GUN, so what reaches `speed` is the share of it on
       * the hull's own heading: a turret traversed abeam takes nothing off the
       * road speed and one over the tail pushes the hull along. The rest of
       * that force is not lost, it is the tilt — `suspension.gunKick`.
       */
      recoilSpeed: 2.4,
      /** How far the chase camera is kicked by the report, in radians. */
      cameraKick: 0.055,
    },
    /**
     * What a tank actually FEELS of each kind of damage, as a multiplier on the
     * amount that arrived. See this file's header: this is the one place the
     * "nothing we have yet hurts a tank" decision is written down.
     *
     * `bullet` at 0.05 means a full rifle magazine (30 x 26) does 39 of 1200 —
     * a whole team's sustained fire kills a hull in about a minute of nothing
     * else happening, which is ineffective without being a lie about the shot
     * landing. `blast` at 0.3 makes a grenade worth ~36, so a pouch of them is
     * a gesture. `shell` is 1 because it names the rounds built to do this and
     * nothing else: a tank's own gun, and the launcher and the mine in the
     * kit's third slot.
     */
    resist: {
      bullet: 0.05,
      blast: 0.3,
      shell: 1,
    },
    camera: {
      /**
       * How far behind the hull's centre the eye sits. Half the hull is 3.6, so
       * the first 3.6 of this buys nothing but clearing the tank itself.
       */
      distance: 12.5,
      /** How far above the hull's centre the camera is anchored and aims. */
      anchorHeight: 2.2,
      /** Where the view starts each time a player gets in: looking slightly down at it. */
      restPitch: -0.16,
      /**
       * Wider than the on-foot limits at the bottom and tighter at the top: a
       * chase camera looking straight up puts the eye under the tracks, and a
       * driver needs to see the ground in front of the hull far more than the
       * sky.
       */
      pitchMin: -0.62,
      pitchMax: 0.5,
      /**
       * How much of the player's own look speed the turret's aim takes. Under
       * 1 because the eye is twelve metres back — the same wrist movement
       * sweeps far more world from out there — and because the turret cannot
       * follow a flick anyway.
       */
      lookMult: 0.72,
      /** How far short of a wall the pulled-in camera stops. */
      wallMargin: 0.5,
      /** How close to the hull the pull-in may bring the eye before it gives up. */
      minDistance: 4.5,
    },
  },
} as const;
