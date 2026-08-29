/**
 * config/vehicles.ts — the KINDS of vehicle in the game: what each is made of,
 * how it drives, what its guns do, and how much of a rifle round it feels.
 * Owns: `VehicleSpec` (the shape of one kind) and every tunable a hull reads,
 * plus the fleet-wide figures above both — the enter radius, the exit offset,
 * the respawn and wreck clocks, and what an AI crew is allowed to do.
 * The BOXES a vehicle is drawn from are art and stay in its own model file
 * (`entities/TankModel.ts`, `entities/TruckModel.ts`); the extents below are
 * not art — `hull` is the collider a body walks into and a round stops on, and
 * `hitRadius` is the sphere every shot is tested against, so both are rules.
 *
 * **The two kinds are married to their models in `entities/vehicleKinds.ts`**,
 * which is the only place that knows both halves. Nothing here decides which
 * kind a hardstanding holds and nothing here has heard of a mesh.
 *
 * **`resist` is where "what a hull is afraid of" is WRITTEN DOWN rather than
 * left as a property of the numbers elsewhere.** A tank takes every kind of
 * damage through one door (`Vehicle.takeDamage`) and scales it by the kind that
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

/**
 * The shape of ONE KIND of vehicle, and the reason there is an interface here
 * at all rather than a `typeof vehicles.tank`.
 *
 * **`CONFIG` is `as const`, so every number in it has a LITERAL type** — a
 * second kind whose top speed is 18 is not assignable to a shape that says
 * `11`. This is what `entities/Vehicle.ts` is actually parameterised by, and
 * both blocks below satisfy it; a kind is married to the model that draws it
 * in `entities/vehicleKinds.ts`, which is the only place the pair meet.
 *
 * **A vehicle with no main gun is `gun: null`, and that is the ONE optional
 * thing about a kind.** It is one nullable field rather than two because the
 * mount and the round are one weapon: `turret` nests inside it, so a hull with
 * nothing to traverse cannot be handed a traverse rate by accident. Nothing
 * downstream reads the field — `Vehicle.armed` is the question, and it is what
 * the loader row on the HUD, the crew's lay-and-fire, the gun marker and the
 * authority's rate gate all ask.
 */
export interface VehicleSpec {
  readonly maxHealth: number;
  /**
   * `Hittable.hitRadius`, which a hull has to declare and which nothing reads
   * any more — a round is tested against the COLLIDER. See the tank's own note.
   */
  readonly hitRadius: number;
  /** The collider box, and therefore the vehicle's whole physical presence. */
  readonly hull: {
    readonly length: number;
    readonly width: number;
    readonly height: number;
  };
  /** Where the commander stands: what bots test LOS to and aim at. */
  readonly cupolaHeight: number;
  readonly drive: {
    readonly maxSpeed: number;
    readonly reverseSpeed: number;
    readonly accel: number;
    readonly brake: number;
    readonly turnRate: number;
    readonly turnAtSpeed: number;
    readonly steerAtRest: number;
    readonly steerRate: number;
    readonly steerRollSpeed: number;
    readonly tiltRate: number;
    readonly airTiltRate: number;
    readonly tiltLimit: number;
    readonly collideRadius: number;
    readonly gravity: number;
    readonly climbHeight: number;
    readonly climbSlope: number;
    readonly climbFloor: number;
    readonly climbDrag: number;
    readonly launchSpeed: number;
    readonly probeLength: number;
    readonly freeRate: number;
  };
  readonly suspension: {
    readonly pitchPerAccel: number;
    readonly rollPerAccel: number;
    readonly accelLimit: number;
    readonly stiffness: number;
    readonly damping: number;
    readonly progression: number;
    readonly gunKick: number;
    readonly heaveResponse: number;
    readonly heaveStiffness: number;
    readonly heaveDamping: number;
    readonly joltLimit: number;
    readonly heaveBump: number;
    readonly heaveDroop: number;
  };
  readonly antenna: {
    readonly swayPerAccel: number;
    readonly lagPerRate: number;
    readonly stiffness: number;
    readonly damping: number;
    readonly bendLimit: number;
    readonly baseShare: number;
    readonly lagRate: number;
    readonly wind: { readonly sway: number; readonly speed: number };
    readonly gunKick: number;
  };
  /** The main gun, its mount and its round — or null on a vehicle that has none. */
  readonly gun: {
    readonly turret: AxisSpec;
    readonly damage: number;
    readonly range: number;
    readonly cooldown: number;
    readonly blastRadius: number;
    readonly blastInner: number;
    readonly blastDamage: number;
    readonly blastPower: number;
    readonly recoilSpeed: number;
    readonly cameraKick: number;
  } | null;
  /**
   * The machine gun the SECOND seat lays. Every kind has one, because that is
   * what the second seat IS.
   */
  readonly mg: AxisSpec & {
    readonly damage: number;
    readonly damageFar: number;
    readonly falloffNear: number;
    readonly falloffFar: number;
    readonly range: number;
    readonly fireRate: number;
    readonly spread: number;
    readonly cameraKick: number;
    /** `ReportVoice`, stated structurally: `config/` may not import an entity. */
    readonly report: {
      readonly pitch: number;
      readonly level: number;
      readonly snap: number;
      readonly weight: number;
      readonly length: number;
      readonly tail: number;
      readonly actionPitch: number;
      readonly actionVol: number;
    };
  };
  readonly resist: {
    readonly bullet: number;
    readonly blast: number;
    readonly shell: number;
  };
  readonly crush: { readonly damage: number; readonly minSpeed: number };
  readonly camera: {
    readonly distance: number;
    readonly anchorHeight: number;
    readonly restPitch: number;
    readonly pitchMin: number;
    readonly pitchMax: number;
    readonly lookMult: number;
    readonly wallMargin: number;
    readonly minDistance: number;
  };
  /**
   * What this kind SOUNDS like, as two numbers against the tank's own voice.
   *
   * `Sfx.buildEngine` is one graph and one description of what a diesel is, and
   * these are the only two things about it that belong to a KIND rather than to
   * an engine. Stated the way a weapon's `report` is: a field per way this
   * differs, with the reference at 1.
   */
  readonly engine: {
    /**
     * A multiplier on the firing rate every pitched layer is a multiple of, so
     * a lighter engine revs higher as one machine rather than as four layers
     * each nudged separately.
     */
    readonly revMult: number;
    /**
     * How much LINK CLATTER the voice carries — the tank as 1, a wheeled
     * vehicle as 0. Not a level to be balanced by ear: it is whether this
     * thing runs on belts, and a truck with track noise under it is a tank
     * you cannot see.
     */
    readonly clatter: number;
  };
}

/**
 * One powered MOUNT — how fast it traverses and elevates, how fast those rates
 * may change, how the last degree of a lay is closed, and where the gun stops.
 *
 * Shared by the turret and the cupola ring because they are the same seven
 * questions asked of two masses; the ANSWERS are an order of magnitude apart
 * and that gap is the whole of the difference between them.
 */
export interface AxisSpec {
  readonly traverseRate: number;
  readonly elevationRate: number;
  readonly traverseAccel: number;
  readonly elevationAccel: number;
  readonly settleTime: number;
  readonly pitchMin: number;
  readonly pitchMax: number;
}

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
   * **A hull holds TWO bodies and they are two different bots**, exactly as it
   * holds two people: the DRIVER drives, lays the main gun and pulls its
   * trigger, and the GUNNER lays the cupola machine gun and nothing else. They
   * share every number in this block except the three the gun in the second
   * man's hands makes different — see `mgRange`, and see `docs/vehicles.md`
   * for why a second seat is not a second brain.
   *
   * The seats are filled in order and neither waits for the other: a hull with
   * one bot in it drives and shoots its cannon exactly as it always did, and a
   * hull with only a gunner sits still and rakes the street.
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
     * centre. Generous, and it is generous on purpose: a bot is never given a
     * vehicle as a DESTINATION — no flow field leads to one and a hull is not
     * an objective — so the crew is drawn from whoever happens to walk past.
     * Coldharbour puts its two hardstandings in the same corner yards as the
     * home spawns, which is what makes that work: every reinforcement walks
     * out through this circle.
     *
     * **It was 18 and a second hardstanding per yard is what moved it.** Three
     * infantry spawns twelve metres apart with a tank sitting among them leave
     * nowhere for a SECOND pad that is both eight metres clear of every spawn
     * and inside eighteen of more than one of them — so Sarab's trucks stood
     * on their pads for a whole round while the tanks drove two hundred metres,
     * measured, with the sweep catching a passing bot about once in five
     * attempts. At 24 a yard with two vehicles in it is one circle again.
     *
     * What it costs is that a crewman can be taken from further away, and the
     * sweep has never had a sightline test — a bot 24 m off behind a wall is a
     * bot that vanishes into a hull. That was already true at 18 and is the
     * accepted shape of "whoever walks past"; six more metres makes it a
     * little more visible and buys a vehicle that is actually used.
     */
    boardRadius: 24,
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
     * The throttle a hull that CANNOT pivot keeps on while it is turning onto
     * a bearing — scaled by `1 - VehicleSpec.drive.steerAtRest`, so it is dead
     * on a tank and the whole of what makes an AI truck driver possible.
     *
     * The line above it falls to nothing at a right angle, which is right for
     * a vehicle that pivots and is a DEADLOCK for one that steers: no throttle
     * is no steering, no steering is no way to lose the heading error, and the
     * watchdog never fires because it only counts a hull that is ASKING for
     * speed. Measured on the first truck given a bearing behind it: parked,
     * stick hard over, indefinitely.
     *
     * 0.35 is a crawl — enough to be well past `steerRollSpeed`, so the hull
     * has its full lock and turns in the tightest circle it owns, and slow
     * enough that the arc it makes of a U-turn is one the whiskers can still
     * see the end of.
     */
    turnCrawl: 0.35,
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
     * it instead of oscillating — and two hulls meeting in the same street do
     * not both pick the same way out of it.
     */
    reverseSteer: 0.7,
    /**
     * The SECOND crewman's numbers, and there are only three of them because
     * everything else about him is the driver's already: the same think clock,
     * the same one ray per acquisition, the same held target.
     *
     * **He is a different bot with a different weapon and therefore a
     * different set of targets**, which is the whole reason this block is not
     * empty. A machine gun cannot hurt a hull (`resist.bullet` is 0.05), so a
     * gunner who acquired armour the way the driver does would spend the
     * fight rattling rounds off a tank while the squad that came with it
     * walked past — so his acquisition is infantry-only, by construction, and
     * `mgRange` is what he can see rather than what the belt can reach.
     */
    mgRange: 70,
    /**
     * How close the gun must be to the aim order before he fires, in radians.
     * Far looser than `fireCone`: the shell is a single hitscan round against
     * a point and this is a stream against a man, so the volume is what
     * carries it and a cone tight enough for a cannon would be a gun that
     * never opened up on anything moving.
     */
    mgCone: 0.06,
    /**
     * Seconds the gun must be settled inside `mgCone` before the belt runs,
     * and how long it runs for once it does. **A machine gun fires in BURSTS
     * and this pair is the whole of what says so** — held down it is a
     * hosepipe that never stops, which is both unfair and unreadable, and the
     * gap is what lets a man cross the street between two of them.
     */
    mgLayTime: 0.3,
    mgBurst: 0.9,
    mgPause: 0.7,
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
     * `Vehicle`'s header on why a vehicle gets one box and not a hierarchy.
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
       * How much of the turn a hull has at a STANDSTILL, 0..1 — the other end
       * of `turnAtSpeed`'s taper, and the one number that says whether this
       * vehicle steers with tracks or with wheels.
       *
       * **1 is the reference and means a neutral-steer pivot**, exactly as the
       * rifle is 1 in every `report` field: a tank turns on the spot because
       * one belt runs forward while the other runs back, and no part of that
       * needs the vehicle to be going anywhere. A kind that states less than 1
       * is a kind that has to be ROLLING to point somewhere, and it reaches the
       * whole of the drive through one multiplier rather than through a branch
       * — see `steerRollSpeed`, and the truck's own note for what it costs.
       */
      steerAtRest: 1,
      /**
       * How fast this has to be going before it has ALL of its steering, in
       * m/s. Read only by a kind that states `steerAtRest` below 1, and dead
       * here for that reason rather than by omission: at 1 the ramp is already
       * full at every speed and this number can say nothing.
       */
      steerRollSpeed: 0,
      /**
       * How fast the STEERING itself may be moved, in stick per second — the
       * linkage between what the driver is asking for and what the hull turns
       * on (`Vehicle.steerTo`).
       *
       * **It exists because a key is not a steering wheel.** `moveX` is +-1
       * the instant `A` or `D` goes down, which on foot is right and in a hull
       * is a driver reaching full lock inside one frame; what comes out is a
       * step function of yaw rate, and a step into a heavy body reads as
       * exactly the jerk it is.
       *
       * 8 is a tenth of a second from centre to full lock, which is a hand
       * pulling a tiller — near enough instant to leave this vehicle's
       * handling where it was, far enough from instant to take the corner off
       * the step. A tank's is fast because its steering IS: a lever with a
       * brake on the end of it goes over as fast as an arm moves, where the
       * truck next door has a wheel with turns in it and says so.
       */
      steerRate: 8,
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
       * travelling (`Vehicle.aimCollider`). A circle of this radius parked on the
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
       * - Vertically it is the ceiling of the band `Vehicle.supportAt` will accept
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
      /**
       * How fast the hull is pushed back out of a collider it has ended up
       * INSIDE, m/s. The horizontal twin of `climbFloor`, and it exists for
       * the same kind of reason: a rule the drive cannot state for itself.
       *
       * **A hull gets inside a wall by TURNING, and turning is not collided.**
       * `moveWithCollisions` sweeps the translation and nothing else, while
       * the collision sphere rides `hull.length / 2 - collideRadius` (1.4 m)
       * off the hull's centre — so a yaw swings that sphere on a 1.4 m arm
       * through whatever the tank is parked beside, at up to `turnRate * 1.4`
       * (1.26 m/s), with no test of any kind. Measured on Coldharbour: 29 deg
       * of neutral-steer pivot with the hull not moving at all put the sphere
       * 0.85 m inside a tower, and a second episode reached the sphere's whole
       * radius — its centre inside the box.
       *
       * **And Babylon cannot get out of that.** Its swept-ellipsoid response
       * ejects an embedded collider by `CollisionsEpsilon * 10` per frame in
       * the space it has SCALED by the ellipsoid, which for this radius is
       * 0.022 m of world — measured as exactly that constant on every frame of
       * every hang, whatever displacement was asked of it. Against a drive
       * pushing back in, the hull sits there: a stick held for 1.5 s moved it
       * 0.02 m, and letting go and pressing again moved it 0.00. What freed it
       * was firing the gun, because `fireGun` writes a velocity straight into
       * `speed` and beats the 0.022 in one frame.
       *
       * So the ejection is this game's rather than the engine's. 4 m/s is
       * three times the fastest a pivot can drive the sphere in, which is what
       * makes the state unreachable rather than merely survivable, and it is
       * spent as a RATE for `climbSlope`'s reason: a seven-metre hull snapped
       * sideways is a teleport, and this is a metre in a quarter of a second.
       */
      freeRate: 4,
    },
    /**
     * What the drawn hull does about its own MASS: the dive under the brake,
     * the squat under power, the lean out of a turn and the rock of the gun.
     *
     * **Every number here is cosmetic in the strict sense the rest of the file
     * is not.** `hull` is a collider and `maxSpeed` is a rule; this block only
     * ever reaches `VehicleRig.hull`'s pitch and roll, which the box a round stops
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
       * How much STIFFER a spring stands when its travel is spent: the rate is
       * `1 + progression * f^2`, where `f` is the fraction of the station's
       * remaining travel the springs have already used. At 0 the spring is the
       * plain linear one it was and every number around it is untouched.
       *
       * **Zero here, and that is a statement about torsion bars rather than a
       * default.** A tank's suspension is a bar in torsion: it is very nearly
       * linear right up to the point a road-wheel arm meets its rubber, and
       * what happens there is the STOP below and not a rate that has been
       * climbing all the way to it. The truck's leaf packs are the opposite
       * kind of spring and say so.
       *
       * It is also load-bearing for `gunKick` that this is zero: the gun is
       * sized to be the one input that reaches the stop, and a spring that
       * hardened on the way there would take that away from it.
       */
      progression: 0,
      /**
       * **There is no `pitchLimit` and no `rollLimit`, and their absence is
       * the rule.** How far the body may tilt is not a number anyone gets to
       * author: it is `heaveBump`/`heaveDroop` over the distance to the
       * outermost road wheel, because a tilt is one end of the suspension
       * compressing and the other end extending, and both ends run out of
       * travel at the stops the heave uses. `Vehicle.flexSuspension` spends what
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
       * `speed` outside `Vehicle.update`, so it never reaches the acceleration
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
     * measurement here: `Vehicle.flexAntennae` reads the numbers `flexSuspension`
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
       * natural frequency goes as 1/L^2, so `Vehicle` scales these by the square
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
       * spent on `speed` outside `Vehicle.update`, so what the drive terms see of
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
    gun: {
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
         * `Vehicle` decelerates INTO the order rather than at it, which is what puts
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
         * `Vehicle`'s slew asks for the fastest rate it could still stop from, which
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
     * The COMMANDER's gun: the cupola machine gun the second crewman lays.
     *
     * **It is the whole of what the second seat is for**, and every number
     * below is chosen against the main gun rather than against a rifle,
     * because what this weapon has to be is the answer to the thing armour
     * could not touch before: infantry inside the reload. A shell every 3.6
     * seconds against a squad crossing a street is one dead man and a crater;
     * the same seat with a belt-fed gun on it is a tank that can be a tank
     * while it is loading.
     *
     * The mount is a RING on the cupola, so it traverses independently of the
     * turret under it and of the hull under that — see `Vehicle.aimMg`. What it
     * cannot do is hurt the thing the main gun exists for: the round is a
     * `bullet`, so `resist.bullet` (0.05) applies and a full belt into another
     * hull is worth about as much as a rifle magazine. That is the point
     * rather than a limitation — a second gun that could kill armour would
     * make the first one decoration.
     */
    mg: {
      /**
       * Per round, close in. Above the rifle's 26 because this is a heavier
       * calibre on a mount rather than a shoulder, and below anything that
       * would make it a one-round kill: three hits at the near band, four
       * across the falloff.
       */
      damage: 42,
      /** …and at `falloffFar`. A belt-fed gun loses more than a rifle does. */
      damageFar: 20,
      falloffNear: 60,
      falloffFar: 170,
      /** Where the round stops, and what bounds the near-miss sweep with it. */
      range: 190,
      /**
       * Rounds a second. Fast enough to read as automatic and slow enough that
       * the eight-round burst a gunner actually squeezes is countable — and
       * deliberately under the rifle's rate, because this is the gun that
       * never has to reload.
       */
      fireRate: 9,
      /**
       * The cone, in radians at the muzzle. **Wider than any carried weapon's
       * hip spread on purpose**: the gunner is laying a gun on a ring from
       * twelve metres behind it and has no ADS to tighten it with, so the
       * accuracy has to come from the volume rather than from the shot. About
       * 1.4 deg — a metre and a half at 60 m.
       */
      spread: 0.024,
      /**
       * rad/s of traverse and elevation, and the acceleration behind each.
       * Roughly five times the turret's, because what is being swung is a gun
       * on a ring rather than sixty tonnes of casting — a gunner tracking a
       * running man has to be able to keep up with one.
       */
      traverseRate: 3.4,
      elevationRate: 2.8,
      traverseAccel: 16,
      elevationAccel: 14,
      /**
       * The same time constant the turret closes its last degree on, and it is
       * here rather than shared for the reason the rates are: this axis is an
       * order of magnitude lighter, and a lag sized for a turret would be a
       * gun that visibly trails the reticle. See `turret.settleTime` for what
       * the number IS.
       */
      settleTime: 0.03,
      /**
       * How far the gun depresses and elevates. -11 deg to +42 deg — far more
       * elevation than the main gun, which is what a cupola mount is for: the
       * upper floors and the rooflines the turret cannot reach.
       */
      pitchMin: -0.19,
      pitchMax: 0.73,
      /** How far the chase camera is kicked per round. A twentieth of the shell's. */
      cameraKick: 0.0028,
      /**
       * What it SOUNDS like, as `ReportVoice` states it — a field per way this
       * differs from the rifle, which is the reference with every number 1.
       * Deeper and heavier than a rifle and much shorter than the cannon: a
       * heavy machine gun is a series of flat cracks with a lot of chest in
       * them and almost no ring, because the next one is 110 ms away.
       */
      report: {
        pitch: 0.78,
        level: 1.15,
        snap: 1.25,
        weight: 1.5,
        length: 0.72,
        tail: 0.9,
        actionPitch: 0.8,
        actionVol: 1.2,
      },
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
    /**
     * What the TRACKS are worth to a man standing in front of them.
     *
     * A hull is thirty-odd tonnes and there is no amount of it a body absorbs,
     * so `damage` is a figure large enough to be lethal through anything the
     * game can put on a person rather than a number balanced against health —
     * the same statement `onCrewLost` makes by passing a victim's whole
     * remaining health, made here as a constant because the sweep is handed
     * `Combatant`s and a `Combatant` does not publish how much life is left in
     * it. The only other thing reading it is the throw: `deathDamage` scales
     * the corpse's departure and is clamped at `bots.death.impulse.blast.max`
     * long before this figure, so raising it further changes nothing at all.
     *
     * `minSpeed` is what makes it RUNNING somebody over rather than standing
     * on them. A hull that is stopped, or crawling into a wall with the stick
     * held, kills nobody: bots are in no baked structure a tank appears in
     * (see `VehicleSystem`), so they walk into parked armour all round and a
     * hardstanding with no speed gate would be a mincer that filled its own
     * team's ticket count. 1.5 m/s is a seventh of road speed and about a
     * walking pace — under it the collision ellipsoid is shoving the body
     * clear at a speed a person can walk out of, and over it they cannot.
     */
    crush: {
      damage: 400,
      minSpeed: 1.5,
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
    /**
     * What a tank sounds like, and the reference every other kind's engine is
     * stated against — so both numbers are 1 here by definition.
     */
    engine: { revMult: 1, clatter: 1 },
  },
  /**
   * The GUN TRUCK: the second kind, and the trade it is.
   *
   * **It is the tank with the cannon taken off and the speed put back**, and
   * that sentence is the whole design. Everything expensive about armour —
   * the collider that stops a round, the ten ground contacts, the crew of two,
   * the chase camera, the crush — is the same machinery, because a vehicle in
   * this game is a `VehicleSpec` and a model and nothing else. What differs is
   * four things, and each of them is the same trade seen from a different side:
   *
   * - **`gun` is null.** The driver has no weapon at all. He drives, and the
   *   only thing this vehicle can shoot is the machine gun the second man
   *   lays — which is a `bullet` against `resist.bullet`, and therefore nothing
   *   at all against armour. A truck cannot kill a tank and is not meant to be
   *   able to: what it kills is infantry, and what it does about a tank is
   *   leave.
   * - **It is FAST.** 18 m/s is 65 km/h, two thirds again the tank's road
   *   speed and 2.6x a sprint, and it accelerates and stops nearly twice as
   *   hard. On a 900 m map that is the point of it — the ground between the
   *   flags is transit, and this is the thing that crosses it.
   * - **It is SOFT.** 520 points against the tank's 1200, and `resist.bullet`
   *   is 0.45 rather than 0.05 — nine times as much of every rifle round gets
   *   through. A squad with no launcher in it kills a truck in seconds, which
   *   is the half of the trade that makes the speed affordable: the tank's
   *   small-arms figure exists to make a hull something only the AT kit
   *   answers, and a soft-skinned vehicle is exactly the thing that must not
   *   be. A rocket or a mine still ends it outright.
   * - **It is WHEELED**, which is a rule and not a look: `climbHeight` is 0.55
   *   against the tank's 1.25, so the kerb a tank rides over is a kerb this
   *   stops against and the parked car it drives across is a car this drives
   *   AROUND. That is what keeps the faster vehicle out of the places armour is
   *   supposed to be kept out of, without a single line of code knowing which
   *   kind it is steering.
   *
   * Every figure below that is NOT one of those four is the tank's own, and
   * deliberately: the suspension shape, the antenna spring and the camera are
   * about what a chase view of a road vehicle feels like rather than about
   * what this particular one is, and two unrelated sets of them would be two
   * things to tune for one answer.
   */
  truck: {
    /**
     * Under half the tank's, and read together with `resist` below rather than
     * on its own: a rifle magazine is worth `30 * 26 * 0.45 = 351` of 520, so
     * two riflemen with line of sight end this inside a magazine each. That is
     * the intended answer to a truck standing still in the open.
     */
    maxHealth: 520,
    /** Declared for the interface's sake and read by nothing — see the tank's note. */
    hitRadius: 2.4,
    /**
     * A little over half the tank's volume: 5.4 m of wheelbase and body, 2.5
     * wide, and 2.5 to the top of the gun ring. The height is the same kind of
     * over-statement the tank's is and for the same reason — the ring and the
     * gun on it are INSIDE the box, so a round aimed at the gunner marks the
     * vehicle rather than passing over a collider that stopped at the roof.
     */
    hull: { length: 5.4, width: 2.5, height: 2.5 },
    /**
     * Where the gunner's head is: standing on the bed floor behind a ring whose
     * trunnion is at 2.18 (`TruckModel`'s `RING_Y`), which puts it just inside
     * the top of the collider box rather than just above it as the tank's is.
     *
     * It matters more here than it does on a tank, because it is what bots test
     * line of sight to and aim at — and on this vehicle the man they are aiming
     * at is genuinely standing in the open, where the tank's commander is a
     * hatch.
     */
    cupolaHeight: 2.35,
    drive: {
      /**
       * 18 m/s is 65 km/h, and the number this vehicle exists for. Against the
       * tank's 11 and a sprint's 6.9 it is the difference between armour that
       * decides a street and a vehicle that decides which street.
       */
      maxSpeed: 18,
      /** Nearly half again the tank's: a truck backs out of what a tank drives through. */
      reverseSpeed: 8,
      /** m/s^2. ~2.2 s to its own top speed, which is a lighter machine doing more work. */
      accel: 8.2,
      /** m/s^2. Brakes rather than tracks — harder than the drive, but by less than a tank's. */
      brake: 12,
      /**
       * rad/s at full lock — about 66 deg/s, and it is FASTER than the tank's
       * while being far less useful, which is the wheeled half of the trade.
       * See `turnAtSpeed`.
       */
      turnRate: 1.15,
      /**
       * How much of the turn survives at road speed. Well above the tank's
       * 0.45, because a truck steers with its wheels rather than dragging a
       * belt sideways: this is a vehicle that corners, where the tank is one
       * that pivots.
       */
      turnAtSpeed: 0.78,
      /**
       * **0: this cannot pivot on the spot, and that is the wheeled half of
       * the trade stated as a number.** A parked truck with the stick hard over
       * has its front wheels turned and goes nowhere, because a steered wheel
       * standing still is a wheel pointing somewhere rather than a machine
       * turning — where the tank drags one belt backwards and does not care
       * whether it is going anywhere at all.
       *
       * It was 1 by omission until the field existed, and what that looked like
       * was a five-tonne truck spinning on its own axis in the road. Nothing in
       * `Vehicle` learned a kind to fix it: the multiplier is on the drive for
       * both, and the tank states the value that leaves its own arithmetic
       * exactly where it was.
       */
      steerAtRest: 0,
      /**
       * m/s at which the steering is fully there, the ramp up from
       * `steerAtRest` being linear in the hull's own speed.
       *
       * 4 m/s is below a jog, so this is a truck that has its full lock as soon
       * as it is genuinely rolling rather than one that has to reach road speed
       * to corner: at 4 it turns at 1.09 rad/s, which is a 3.7 m circle, and at
       * its own 18 the taper above has it at 0.9 for a 20 m one. The band under
       * 4 is the manoeuvring one — a driver easing out of a hardstanding turns
       * about as sharply as the throttle they are giving it, which is the read
       * a wheeled vehicle owes.
       *
       * **The ramp is SIGNED, and that is not a detail**: it is taken from the
       * hull's velocity rather than its speed, so backing up steers the way
       * backing up does — the stick left swings the nose right. A tank is
       * exempt by construction (`steerAtRest: 1` leaves the multiplier at a
       * flat 1 whichever way it is going) rather than by a check.
       */
      steerRollSpeed: 4,
      /**
       * **A WHEEL, where the tank has a pair of levers, and this is the number
       * that is the difference.** Three tenths of a second from centre to full
       * lock and six from lock to lock, which is a driver winding a wheel with
       * turns in it rather than a hand flicking a tiller — the tank's 8 is
       * there to take the corner off a step and this is there to be felt.
       *
       * What it fixes is that `A` and `D` are a switch: the hull went from no
       * yaw rate to 0.897 rad/s between two frames, and back to nothing just
       * as fast, which is the jerk. Wound on over 0.3 s the same key gives a
       * turn-in the body has time to answer — and it is worth about 8 degrees
       * of heading against an instant stick over the first half-second of a
       * corner, which is the price and is meant to be paid.
       *
       * **It is also half of why the springs below stopped touching their
       * stop.** `flexSuspension` answers to `speed * yawRate`, so an instant
       * stick was a step input into a spring, and a step into a spring is an
       * overshoot — turn-in reached the stop for a frame on the strength of
       * that alone. Ramped, the same corner settles to the same lean without
       * ever arriving on it. The two changes are independent and neither one
       * is a substitute for the other: this one shapes what the springs are
       * ASKED for, `suspension.progression` shapes what they do with it.
       */
      steerRate: 3.2,
      /** Onto the ground faster than the tank: less mass, shorter wheelbase. */
      tiltRate: 7.5,
      airTiltRate: 1.1,
      /** A little more lean than the tank allows, for the same reason. ~16 deg. */
      tiltLimit: 0.28,
      /**
       * The XZ radius of the sphere `moveWithCollisions` walks it around with —
       * the tank's whole argument, at this vehicle's size: a little over half
       * the width (1.25), riding at the LEADING end on an arm of
       * `hull.length / 2 - collideRadius` = 1.1 m.
       *
       * It is also what sets the narrowest gap this can drive through, at
       * 3.2 m against the tank's 4.4 — so a truck fits down Sarab's
       * seven-metre alleys where a tank does not, which is most of what the
       * second kind is FOR on that map.
       */
      collideRadius: 1.6,
      /** The same figure the tank falls at, for its reason. */
      gravity: 22,
      /**
       * **The rule that keeps a fast vehicle honest**, and the one number here
       * that is not about speed at all.
       *
       * 0.55 against the tank's 1.25 means the parked car (`buildCar`'s body
       * collider, 1.1 m) a tank rides straight over is a wall to this: it has
       * to go round. Kerbs, low walls and rubble stay passable — 0.55 is just
       * above a soldier's own 0.5 step, which is the right statement about a
       * wheeled vehicle — but the whole class of "drive through the scenery"
       * that armour is allowed is closed off here.
       *
       * Both halves move together, as the tank's note insists: this is the
       * collision ellipsoid's floor AND the ceiling of the band a wheel
       * accepts a surface from, and a pair out of step is a vehicle that
       * drives through the bottom of things it then refuses to stand on.
       */
      climbHeight: 0.55,
      /** Steeper than the tank's: a tyre on the ground has more grip than a belt. */
      climbSlope: 0.7,
      climbFloor: 0.5,
      /** Costs it more than the tank, because there is less engine behind less weight. */
      climbDrag: 0.9,
      /** Lighter, so it goes lighter over a crest. */
      launchSpeed: 2,
      probeLength: 6,
      freeRate: 4,
    },
    /**
     * The tank's springs, softened and quickened.
     *
     * A truck's body moves MORE than a tank's for the same acceleration and
     * settles sooner — less mass on softer springs — so the two gains are up
     * and the frequency with them. Everything else is the tank's, because it
     * is about what a chase camera behind a road vehicle should see rather
     * than about this vehicle.
     */
    suspension: {
      /** Half again the tank's: a truck's nose dives, visibly. */
      pitchPerAccel: 0.0085,
      /** …and it rolls harder still, being narrow and tall for its weight. */
      rollPerAccel: 0.021,
      accelLimit: 26,
      /** A lighter body on softer springs: quicker, and a little less damped. */
      stiffness: 52,
      damping: 8,
      /**
       * **Three and a half times its own rate on the stop, and this is the
       * number that stops a truck lying on its side through a corner.**
       *
       * Leaf packs on rubbers are a progressive spring in a way torsion bars
       * are not (the tank's `progression` is 0 and says why), and this hull
       * needed one: full lock at road speed is `18 * 0.897` = 16 m/s^2 across
       * the hull, which at `rollPerAccel` asks the springs for 19.4 degrees of
       * lean against a travel budget worth 8.2 — so the body went over, sat on
       * its stops for as long as the wheel was turned, and had its velocity
       * killed there. That is a hull with no suspension left in it in exactly
       * the moment it is being driven hardest, and it broke the rule the gains
       * next door are sized by: **the stops are for EVENTS and not for
       * driving**.
       *
       * Squared rather than linear because that is what progressive means: the
       * rate is barely off 1 while the travel is barely spent and climbs where
       * a pack goes solid, so what it costs is taken from the end of the range
       * that had nothing left to say. Measured across the steer, in degrees of
       * settled lean at road speed:
       *
       * ```
       *   lock:    10%   20%   30%   40%   50%   70%  100%
       *   linear:  1.94  3.89  5.83  7.77  8.21  8.21  8.21   <- on the stop
       *   at 2.5:  1.74  2.94  3.79  4.46  5.02  5.91  6.95
       * ```
       *
       * **The old curve stopped answering at half lock**, which is the whole
       * complaint written down: the top half of the steer produced one lean,
       * so the difference between a corner taken briskly and one taken
       * flat-out was nothing the body could show. The new one is monotone the
       * whole way, at the price of about a fifth of the lean in the middle of
       * the range — a trade in the direction that has more to say.
       *
       * Turn-in still overshoots far enough to touch the stop for a frame and
       * come off it, which is a truck cornering hard rather than a truck that
       * has run out of suspension.
       *
       * A hard brake was over its stop too (12 m/s^2 asks 5.9 degrees of dive
       * against 5.3) and is now ~3.1, and the heave takes the same hardening on
       * its own two stops — one suspension, one rate. What that costs on that
       * axis is stated on `heaveBump`.
       */
      progression: 2.5,
      /**
       * There is no gun to kick it, so this is the one figure here that is
       * simply not reachable. Zero rather than deleted, because the field
       * belongs to the SPRING and not to the gun — `Vehicle.fireGun` is what
       * spends it, and on this kind nothing does.
       */
      gunKick: 0,
      heaveResponse: 0.28,
      /** Softer and slower to settle than the tank's, which is what a leaf spring is. */
      heaveStiffness: 46,
      heaveDamping: 5.8,
      joltLimit: 9,
      /**
       * More travel than the tank has, both ways: it is a taller ride on less
       * weight.
       *
       * **The tank's rule that a stop is sized to be REACHED is a rule about a
       * LINEAR spring, and this hull is the exception that says so.** The
       * hardest jolt there is — `joltLimit * heaveResponse`, 2.5 m/s, whether
       * it came off a three-metre fall or the edge of a car — puts a linear
       * body of this rate on the stop and puts a progressive one 15.3 cm down
       * of the 19. Converting a stop into a spring that gets there is what
       * `progression` IS, so the last four centimetres are a reserve rather
       * than dead space, and the pictures are the same picture: four fifths of
       * the bump travel spent in one frame.
       *
       * **And that reserve is load-bearing every frame the body is compressed**,
       * because this pair is the TILT's budget as well as the heave's: `room`
       * is `heaveBump + heave` on a hull that is down on its springs, so a
       * truck landing mid-corner has 3.7 cm of station travel for its lean
       * rather than 15, and goes flat under itself. The number is spent there
       * even though this axis alone no longer reaches it.
       *
       * The tank next door is linear and still bottoms out on the same jolt,
       * which is the heaviest thing it does and stays that way.
       */
      heaveBump: 0.19,
      heaveDroop: 0.15,
    },
    /** One mast, and the tank's spring for it — see `TruckModel`'s single whip. */
    antenna: {
      swayPerAccel: 0.032,
      lagPerRate: 0.42,
      stiffness: 230,
      damping: 7.2,
      bendLimit: 0.46,
      baseShare: 0.62,
      lagRate: 14,
      wind: { sway: 0.05, speed: 1.1 },
      /** Nothing to be kicked BY. See `suspension.gunKick`. */
      gunKick: 0,
    },
    /**
     * **No main gun, and this null is the whole of what says so.**
     *
     * It reaches every part of the game through `Vehicle.armed`: the turret
     * node never traverses (`turretYaw` is held equal to the hull's own yaw, so
     * the difference drawn on it is always zero), `fireGun` refuses, the HUD's
     * loader row is absent rather than dimmed, the gun marker follows the
     * machine gun in both seats, a bot driver never lays or fires anything, and
     * the authority's `onShell` gate refuses a claim from this hull outright.
     */
    gun: null,
    /**
     * The turret gun — and on this vehicle it is the ONLY gun, which is what
     * makes the numbers different from the tank's cupola even though the mount
     * is the same idea.
     *
     * It is a heavier weapon than a commander's gun, because it is not a
     * supplement to a cannon: it is what the vehicle is for. More damage per
     * round, a longer reach, a tighter cone and a proper powered ring under it.
     * The same `bullet` kind, though, so it is still worth about a rifle
     * magazine against a hull — which is the line this vehicle may not cross.
     */
    mg: {
      damage: 55,
      damageFar: 26,
      falloffNear: 70,
      falloffFar: 190,
      range: 210,
      /** Slower than the tank's cupola gun: a heavier round out of a bigger receiver. */
      fireRate: 7.5,
      /** Tighter than the cupola's 0.024, being on a proper mount. About 1 deg. */
      spread: 0.018,
      /**
       * A shade slower than the cupola gun's ring, because there is more gun on
       * this one — but still an order of magnitude above the tank's turret,
       * which is what a mount rather than a casting means.
       */
      traverseRate: 3,
      elevationRate: 2.5,
      traverseAccel: 14,
      elevationAccel: 12,
      settleTime: 0.035,
      /** Depresses less and elevates nearly as far: a ring on a flat bed, aimed down streets. */
      pitchMin: -0.16,
      pitchMax: 0.7,
      /** More per round than the cupola's — a heavier gun on a much lighter vehicle. */
      cameraKick: 0.0046,
      /**
       * Heavier and slower than the tank's cupola gun and far deeper than a
       * rifle: fewer, bigger cracks with a lot of chest in them.
       */
      report: {
        pitch: 0.7,
        level: 1.25,
        snap: 1.15,
        weight: 1.75,
        length: 0.85,
        tail: 1.05,
        actionPitch: 0.72,
        actionVol: 1.3,
      },
    },
    /**
     * **What makes it soft, and the other half of the speed's price.**
     *
     * `bullet` at 0.45 is nine times the tank's: a rifle magazine is worth 351
     * of 520 rather than 39 of 1200, so infantry genuinely kill this and do not
     * need the third slot to do it. `blast` at 0.7 makes a hand grenade worth
     * ~25 and a pouch of them a real threat. `shell` stays 1, which against 520
     * points means one tank round or one rocket is the end of it — a truck does
     * not survive being noticed by armour, which is exactly why it should not
     * be somewhere armour can see it.
     */
    resist: {
      bullet: 0.45,
      blast: 0.7,
      shell: 1,
    },
    /**
     * The wheels are worth what the tracks are — there is no amount of a
     * five-tonne vehicle at 65 km/h that a body absorbs — but it takes MORE
     * SPEED to be a run-over rather than a shove, because a truck that is
     * merely rolling is a thing a man steps out of the way of.
     */
    crush: {
      damage: 400,
      minSpeed: 2.4,
    },
    /**
     * Closer in than the tank's, because the vehicle is smaller and moving
     * faster: 9.5 m from a centre with 2.7 m of hull in front of it leaves the
     * clearance the tank's 12.5 does over 3.6, and the tighter frame is what
     * makes 65 km/h read as 65 km/h.
     */
    camera: {
      distance: 9.5,
      anchorHeight: 1.9,
      restPitch: -0.16,
      pitchMin: -0.62,
      pitchMax: 0.5,
      /** A little more than the tank's, because the eye is three metres nearer. */
      lookMult: 0.8,
      wallMargin: 0.5,
      minDistance: 3.6,
    },
    /**
     * A petrol engine in a light vehicle: it revs half again as high as the
     * tank's diesel, and it runs on TYRES — `clatter` is 0 here, because link
     * noise under a wheeled vehicle is a tank arriving that nobody can see.
     */
    engine: { revMult: 1.55, clatter: 0 },
  },
} as const;
