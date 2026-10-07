/**
 * crewPilot.ts — The PILOT: what a bot at the sticks of a hull that FLIES
 * asks of it. Where it is being taken, how high it has to be to get there,
 * and the one control a ground driver has not got.
 * Owns: `fly` and everything under it — the held heading, the air fan, the
 * collective and the cyclic — plus `route`, the flow-field bearing both seats
 * ask.
 * Owns NO state. What one pilot is in the middle of lives on its `Crew`
 * (`flyYaw`, `lostT`, and the detour, reverse and stuck clocks it shares
 * with the ground driver), and `VehicleCrew` holds the crews and the nav graph
 * and hands both in. Nothing here allocates per frame; the scratch is the
 * module's.
 * Never asks which KIND it is flying: `VehicleCrew.stepCrew` reaches `fly` on
 * `Vehicle.flies` and nothing else, and every number below is the hull's own
 * spec or `CONFIG.vehicles.crew`. Never LANDS — see `VehicleCrew`'s "What it
 * never does".
 *
 * ## The route through the AIR it does not need
 *
 * `VehicleCrew.ts` said, for as long as there was a helicopter to say it
 * about, that a bot may man the gun on anything and may drive only what the
 * flow field can describe — that both halves of its road-graph argument (a
 * bearing off the body's flow field, and `Vehicle.rideableAt` for what is a
 * wall; see its header) are answers about GROUND, and neither has anything to
 * say about the air. That was the road graph's mistake made a second time, and
 * it comes apart the same way: a pilot needs a bearing and a HEIGHT, and each
 * of those already had an answer.
 *
 * 1. **The bearing is the same bearing.** A body's flow field is a map-scale
 *    statement about which way the objective is, and a machine that flies over
 *    the buildings needs even less of its detail than a tank does. What it
 *    needs that a tank does not is a way to survive the field having nothing to
 *    say — a helicopter is regularly over water or over a roof, where no body
 *    could stand and no surface was ever grown — which is `airHold`.
 * 2. **The height is `Vehicle.aloftAt`**, which is `rideableAt` asked one axis
 *    up: how high the air over a column has to be flown, answered off the same
 *    two halves of the world (`ObstacleField` and `TerrainField`) and against
 *    the machine's own ceiling and climb gradient. A fan of those turns the
 *    body's bearing into an aircraft's exactly as the whiskers turn it into a
 *    hull's — and it hands back the altitude in the same walk, because "which
 *    way" and "how high" are one question up here.
 *
 * So `fly` is `VehicleCrew.steer` with those two substitutions and nothing
 * else: same three sources for the bearing, same fan in ascending deviation,
 * same commitment, same watchdog. What is genuinely new is one control
 * (`collective`) and one ordering — **the answer to something in the way is
 * UP, and a bearing is what is left when going over has been refused.**
 */
import { Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import { angleDelta } from "../core/math";
import type { Vehicle } from "../entities/Vehicle";
import type { NavGrid } from "../world/NavGrid";
import type { Crew } from "./VehicleCrew";

// Module scratch. This runs every frame for every crewed hull; nothing below
// allocates.
const _dir = new Vector3();
const _at = new Vector3();
/**
 * The PILOT's fan, in the same two axes as the driver's and with one difference
 * in each.
 *
 * **The first probe is AT the nose, and it is there for the driver's reason
 * rather than in spite of it.** The first version spread them evenly from a
 * tenth of the reach, on the argument that a machine which answers an obstacle
 * by climbing needs the run-up rather than the near field — and that opened a
 * nine-metre hole directly in front of a hull whose rotor disc is ten metres
 * across. Measured on Sarab: a pilot flew into the side of a building at
 * fifteen metres, `moveWithCollisions` refused every metre of the drive, and
 * `freeFromWalls` walked the machine sideways out of the wall at 3.1 m/s for
 * the rest of the round while the fan reported clear air and the engine note
 * said fifteen knots. That is `VehicleCrew`'s `WHISKER_DEPTHS`' own hour,
 * paid a second time one axis up: **the near field is what a turn swings a
 * bearing onto**, and it does not stop being that because the vehicle can
 * climb.
 *
 * **And five laterals rather than seven**, at `collideRadius` rather than at
 * the hull's half-width — see `aloftAlong`. The driver's spacing is set by a
 * 0.6 m shopfront pillar; nothing that slender stands high enough to reach a
 * machine flying twelve metres over the roofs, and what does — a tower, a
 * chimney, a hillside — is wider than the 2.6 m these leave between them.
 */
const AIR_DEPTHS = [0, 0.12, 0.3, 0.55, 0.8, 1] as const;
const AIR_LATERAL = [0, 0.5, -0.5, 1, -1] as const;
/**
 * A y below anything any map in the tree contains, which is how a PILOT asks
 * the nav graph about the STREET rather than about the roof it is over. See
 * `column`.
 */
const GROUND_COLUMN = -1e6;
/**
 * The altitude the bearing `pickAloft` chose demands, in metres of world Y.
 *
 * Module scratch for `_dir`'s reason — this runs every frame for every crewed
 * hull and nothing here allocates — and it is a second return value rather than
 * a field on the crew because that is all it is: it is written and read inside
 * one call of `fly` and means nothing between two of them.
 */
let _aloft = 0;

/**
 * `VehicleCrew.steer`'s counterpart for a hull that hangs on a rotor: where it
 * is being taken, how high it has to be to get there, and the one control the
 * ground driver has not got.
 *
 * **The shape is `steer`'s, line for line, and only the questions changed.**
 * The bearing comes from the same three places in the same order (a
 * commitment, a target, the crewman's squad objective), the fan is searched
 * in the same ascending deviation with the same bias toward the nose, the
 * same detour holds it, and the same watchdog backs it out. What is
 * different is that a whisker asks `Vehicle.rideableAt` and hands back yes or
 * no, while a probe up here asks `Vehicle.aloftAt` and hands back a HEIGHT —
 * so the fan produces the altitude as well as the bearing, and the two cannot
 * disagree because they came out of one walk.
 *
 * **The answer to something in the way is UP, and a bearing is the second
 * answer rather than the first.** That is not a preference: `aloftAt` refuses
 * a column only when the machine cannot get over it — too tall to hold the
 * clearance under the ceiling, or too near to climb to it — so a bearing that
 * comes back at all is one this pilot flies straight down while climbing, and
 * the fan is reached for only once going over has been ruled out. A tank's
 * fan is the whole of its answer; this one is the exception path.
 */
export function fly(dt: number, crew: Crew, nav: NavGrid | null): void {
  const c = CONFIG.vehicles.crew;
  const tank = crew.tank;
  const d = crew.drive;
  const p = tank.position;
  // The floor under every altitude decision below: whatever this machine is
  // over RIGHT NOW, plus the clearance. Nothing the fan says can take the
  // pilot under it — a bearing is about where to go, and this is about not
  // descending into what is already underneath.
  let want = tank.skylineAt(p.x, p.z) + c.airClearance;

  if (crew.reverseT > 0) {
    // Backing out, and on this kind that is the cyclic pushed the other way
    // and the disc tilted sideways — the same two fields spent on the same
    // two intentions they carry going forwards, which is why the recovery
    // needed no rewriting. No fan, for the ground driver's reason: the
    // machine is retracing air it has just flown through.
    crew.reverseT -= dt;
    d.throttle = -1;
    d.steer = crew.reverseSide * c.reverseSteer;
    // **The nose is HELD rather than left**, because `aimYaw` is a bearing on
    // this kind and not a stick: one left over from the bearing that got the
    // machine wedged would have it turning back into the thing it is backing
    // away from.
    d.aimYaw = tank.yaw;
    crew.flyYaw = tank.yaw;
    collective(crew, want);
    return;
  }

  // A commitment outranks both the route and the target and is dropped the
  // moment the air it committed to stops being flyable — `steer`'s rule, and
  // it also carries that bearing's own altitude demand while it lasts.
  if (crew.detourT > 0) {
    crew.detourT -= dt;
    const held = aloftAlong(tank, crew.detourYaw);
    if (held === Infinity) crew.detourT = 0;
    else if (held > want) want = held;
  }

  let wantYaw = tank.yaw;
  let closing = 0;
  const target = crew.target;
  if (crew.detourT > 0) {
    wantYaw = crew.detourYaw;
    closing = 1;
    crew.lostT = 0;
  } else if (target) {
    // Station-keeping, and it is the driver's to the letter — including the
    // standoff, which does a second job up here that it does not do on the
    // ground. With the fan idle inside the band, `want` falls back to the
    // clearance over whatever is under the machine, so a gunship that has
    // closed on infantry settles to twelve metres over them: which is what
    // keeps the target inside the chin gun's own depression limit. A pilot
    // holding its cruising height over a man at this range would be a gunner
    // who cannot look down far enough to shoot him.
    const dx = target.position.x - p.x;
    const dz = target.position.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 1e-3) wantYaw = Math.atan2(dx, dz);
    closing =
      dist > c.standoff * 1.2
        ? c.engageThrottle
        : dist < c.standoff * 0.7
          ? -c.engageThrottle
          : 0;
    crew.lostT = 0;
  } else if (route(nav, tank, crew.bot.objective, true, _dir)) {
    wantYaw = Math.atan2(_dir.x, _dir.z);
    closing = 1;
    crew.lostT = 0;
  } else if (!offGraph(nav, p)) {
    // A route that has run out over ground a body COULD stand on is a pilot
    // that has arrived. Hold station over it — which is how a gunship takes a
    // flag, since a crewed bot's position is the hull's and `pointAt` is a
    // plan test — and re-arm the clock below for the next crossing.
    crew.lostT = 0;
  } else if (crew.lostT < c.airHold) {
    // **A bearing is not lost by flying over ground nobody could stand on.**
    // See `CONFIG.vehicles.crew.airHold`: the flow field answers off the
    // walkable surface nearest the column, and a helicopter is regularly over
    // water, over a roof, or over anything else the graph was never grown
    // across. Holding the heading carries it to the far side.
    //
    // **The arm above is what distinguishes CROSSING from ARRIVING, and
    // without it this one is a bug.** A route also runs out when the field
    // has nothing better to offer, which is what a hull that has reached its
    // objective looks like — the natural way a tank stops driving and just
    // fights. Read as "lost", that flew a machine four seconds past the flag
    // it had come for, and measured on Sarab it put one 41 m outside the play
    // square with nothing to bring it back: bots are not leashed, and beyond
    // the nav graph there is no route to find either.
    //
    // Which is also why the clock is BOUNDED rather than a latch: outside the
    // play square is off the graph too, so four seconds is where a machine
    // that has left the map stops rather than keeps going.
    crew.lostT += dt;
    closing = 1;
  }

  // **What the pilot flies is a HELD heading eased onto the one it wants, and
  // everything below this line reads the held one.** The fan above all: it
  // clears the bearing the machine is actually on rather than one it was
  // never going to fly, and `_aloft` — the altitude that bearing demands —
  // stops swinging with it. See `holdYaw`.
  wantYaw = holdYaw(crew, wantYaw, dt);

  if (closing > 0 && crew.detourT <= 0) {
    const clear = pickAloft(tank, wantYaw);
    if (clear === null) {
      // Nowhere to go over and nowhere to go round. The watchdog's own
      // recovery, taken directly rather than ground against: back off and
      // come at it again.
      crew.stuckT = 0;
      crew.reverseT = c.reverseTime;
      d.throttle = 0;
      d.steer = 0;
      d.aimYaw = tank.yaw;
      crew.flyYaw = tank.yaw;
      collective(crew, want);
      return;
    }
    if (Math.abs(angleDelta(wantYaw, clear)) > c.detourAngle) {
      crew.detourYaw = clear;
      crew.detourT = c.detourTime;
    }
    // The fan OVERRIDES the hold rather than being eased onto, and the held
    // heading takes its answer: this is the one bearing on the list that is
    // not a preference — it is the only air the machine may fly through, and
    // easing onto it would spend the ease inside whatever it is avoiding. A
    // deviation worth the name has just been committed to two lines up, so
    // the frames after it come back through the branch at the top of `fly`
    // and are eased like everything else.
    wantYaw = clear;
    crew.flyYaw = clear;
    if (_aloft > want) want = _aloft;
  }

  collective(crew, want);
  flyOn(crew, wantYaw, closing, want);

  // The watchdog, unchanged and earning its place for a narrower reason than
  // the driver's: a helicopter asking for speed and not getting it has flown
  // into the one thing its own probes cannot see, which is a wall the buckets
  // do not hold — the map's own rim. See `Vehicle.skylineAt`.
  if (Math.abs(d.throttle) > 0.2 && tank.travel < c.stuckSpeed) {
    crew.stuckT += dt;
    if (crew.stuckT >= c.stuckTime) {
      crew.stuckT = 0;
      crew.detourT = 0;
      crew.reverseT = c.reverseTime;
    }
  } else {
    crew.stuckT = 0;
  }
}

/**
 * Is this column one the flow field could never have described — no walkable
 * surface under it at all, or off the graph entirely?
 *
 * The one question `route` cannot answer for a pilot, and the whole of what
 * separates a machine crossing water from one that has arrived. `NavGrid`
 * answers -1 for both of those and for nothing else, which is why this is a
 * lookup rather than a rule: the graph already knows the difference between
 * "no surface here" and "a surface here that the field cannot improve on".
 *
 * Outside the grid is also -1 and is deliberately folded in with the rest: a
 * machine out there is one the hold above will carry a few more seconds and
 * then stop, which is the bounded version of a problem nothing else in this
 * layer can fix — the nav graph stops at the play square and bots are never
 * leashed.
 */
function offGraph(nav: NavGrid | null, at: Vector3): boolean {
  return !nav || nav.surfaceAt(at.x, GROUND_COLUMN, at.z) < 0;
}

/**
 * The bearing the crewman's squad objective is in, into `into`. False when
 * there is no route — no map, no objective, or the hull has arrived and the
 * field has nothing better to offer, which is the natural way a tank stops
 * driving and just fights.
 *
 * `steerAhead` rather than `steer` for the reason bots use it, only more so:
 * `steer` aims at the next cell CENTRE, which is a 1.5 m zigzag under a body
 * and a 7.2 m hull sawing down a street.
 *
 * **Both seats ask it, and it lives here rather than in `VehicleCrew` because
 * `onGround` is the pilot's question** — `column` is what it turns into — and
 * because the import then runs one way: `VehicleCrew` imports this file, and
 * this file imports nothing back from it but a type.
 */
export function route(
  nav: NavGrid | null,
  tank: Vehicle,
  objective: string,
  onGround: boolean,
  into: Vector3,
): boolean {
  if (!nav || !objective) return false;
  const field = nav.field(objective);
  if (!field) return false;
  nav.steerAhead(
    field,
    column(tank, onGround),
    CONFIG.vehicles.crew.lookahead,
    into,
  );
  return into.lengthSquared() > 1e-6;
}

/**
 * The point the flow field is asked about — the hull's own for a DRIVER, and
 * the STREET UNDER IT for a pilot.
 *
 * **A helicopter navigates by the town's plan and not by the parapet it
 * happens to be over**, and without this it did the second. `NavGrid` stacks
 * several walkable surfaces in one cell and `surfaceAt` picks whichever is
 * nearest in HEIGHT to the point it is handed — the right answer for a body,
 * whose feet are on one of them, and the wrong one for a machine flying
 * twelve metres over the roofs: the surface it was "on" was routinely a roof,
 * and a roof's step count in the field has nothing to do with the street's,
 * so crossing a parapet swapped the whole route for an unrelated one.
 *
 * `GROUND_COLUMN` is what asks for the street: `surfaceAt` minimises
 * `|height - y|`, so a y below anything a map contains selects the LOWEST
 * walkable surface in the column and never a roof over it. Where a footprint
 * has no street under it at all the roof is still the only candidate and the
 * answer is what it always was.
 *
 * **It is a correctness fix and NOT the cure for the weave**, which is worth
 * knowing before it is reached for as one: measured on Sarab it took the
 * commanded bearing's reversals from 12.0 a second to 10.9, inside the
 * variation between two rounds. What it buys is that a gunship crossing a
 * town has a route at all — see `airHold`, whose whole existence is the pilot
 * losing one.
 */
function column(tank: Vehicle, onGround: boolean): Vector3 {
  if (!onGround) return tank.position;
  return _at.set(tank.position.x, GROUND_COLUMN, tank.position.z);
}

/**
 * Ease the heading this pilot is FLYING onto the one it wants, and hand back
 * the held one. `VehicleCrew.driveOn`'s `steerGain` has no counterpart here
 * on purpose: that one turns a heading error into a STICK, and this turns an
 * order into an order a pilot would have given.
 *
 * **A flow field is sampled per frame and a helicopter crosses a nav cell
 * five times a second, so what it answers with is noise on top of a route.**
 * `NavGrid.steerAhead` blends the direction of the NEXT cell centre with the
 * one `lookahead` cells on, and the near half of that blend is a sub-cell
 * correction meant for something walking on the grid — a vector whose length
 * collapses to nothing as the machine passes over the cell it points at, and
 * which jumps between the eight link directions every time the cell under the
 * machine changes. A body at 4 m/s absorbs it. Measured on Sarab, a gunship
 * was handed a bearing whose direction of change REVERSED 12.0 times a second
 * at a median rate of 1.88 rad/s — against an airframe that yaws at 1.35, so
 * it was not an order that could have been followed even had it been meant.
 * `flyOn` spent it as full pedal, and the machine wagged its nose two and a
 * half times a second and banked with every wag, the bank being
 * `airspeed * yawRate`.
 *
 * **A rate limit is the whole of the filter, and it is a manner rather than a
 * smoothing.** It says a pilot turns at the rate he has chosen to turn at,
 * which is a claim about a person; what it does to the noise is arithmetic
 * and independent of how wild the excursions are, since a bearing reversing
 * every 1/24 s can only move the held one by `airTurn * turnRate / 24` — a
 * degree. The mean is tracked at full rate, so a REAL turn costs nothing but
 * the time it ought to take. Measured on the same map: yaw acceleration rms
 * 5.12 rad/s^2 to 1.73, roll rate rms 0.325 rad/s to 0.166, and turn
 * reversals above 0.05 rad/s 0.43 a second to 0.002.
 *
 * **It is not a lag on the fan**, which is the one thing a filter here could
 * have cost: `fly` runs the whiskers on the held bearing rather than on the
 * raw one, so what is cleared is what is flown.
 */
function holdYaw(crew: Crew, wantYaw: number, dt: number): number {
  const c = CONFIG.vehicles.crew;
  const step = c.airTurn * crew.tank.spec.drive.turnRate * dt;
  const err = angleDelta(crew.flyYaw, wantYaw);
  // `angleDelta` from zero IS the wrap to [-PI, PI], and the bearing is held
  // in it rather than left to wind: every reader goes through `angleDelta`
  // and could not tell, but a heading that has quietly reached 600 radians is
  // one nothing can read in a probe.
  crew.flyYaw = angleDelta(
    0,
    crew.flyYaw + Math.max(-step, Math.min(step, err)),
  );
  return crew.flyYaw;
}

/**
 * The collective: fly to `wantY`, which is a belly altitude in the WORLD and
 * never a height over the ground.
 *
 * One proportional term and no clamp on what it may ask for, and the second
 * half of that is `FlightModel.collective`'s to make rather than this file's:
 * the collective commands a RATE and the ceiling fades the rate, so a pilot
 * ordering a climb into air the machine cannot hold is answered with zero and
 * stops there. A limit here would be that limit stated twice, and two of them
 * drift.
 *
 * **The height is deliberately NOT held the way the heading is**, which is
 * worth knowing before it is added. The demand is a step function — `wantY`
 * is the top of whatever is under the machine plus the clearance, so a
 * gunship at 17 m/s crossing a parapet moves it eight metres in one frame,
 * and it reversed direction 3.6 times a second on Sarab. A rationed descent
 * to filter that was written and then taken back out, because the machine
 * never showed it: the vertical dynamics already low-pass the collective hard
 * (`liftResponse` chases a RATE, through `climbAccel`), so the step does not
 * reach the airframe. 943 s of flying, climb-to-sink reversals 0.57 a second
 * with the ration and 0.57 without. **The weave was in the YAW.**
 */
function collective(crew: Crew, wantY: number): void {
  const err = wantY - crew.tank.position.y;
  crew.drive.lift = Math.max(
    -1,
    Math.min(1, err * CONFIG.vehicles.crew.airLift),
  );
}

/**
 * The cyclic and the pedals for one bearing — `VehicleCrew.driveOn`'s
 * counterpart, and the three fields it writes mean three different things
 * from the three that one writes.
 *
 * **The nose is POINTED and not steered.** `aimYaw` is a bearing on a hull
 * that flies: `flyStep` derives from it the pedal that would have produced
 * the turn the look is asking for, which is the same line the player's chase
 * camera drives. So this hands over the bearing itself, and the linkage, the
 * authority, the yaw rate and the coordinated bank downstream are the lines
 * they have always been.
 *
 * **`steer` is left at nothing on purpose.** On this kind it is the lateral
 * cyclic — the machine slides sideways without turning — and it is a control
 * this pilot has no use for: the nose comes round at a flat 1.35 rad/s at
 * every speed, so anything a sidestep could reach is somewhere the whole
 * airframe is pointed a fraction of a second later. It is left to the
 * recovery in `fly`, which is the one place a bearing is not the answer.
 *
 * Two fall-offs on the cyclic and they multiply. The first is `driveOn`'s
 * heading fall-off unchanged. The second is this kind's alone: **climb before
 * you close** — see `airClimbGate`, and note that it has no floor under it
 * where the ground one does, because a helicopter with the cyclic centred is
 * still going up.
 */
function flyOn(
  crew: Crew,
  wantYaw: number,
  closing: number,
  wantY: number,
): void {
  const c = CONFIG.vehicles.crew;
  const tank = crew.tank;
  const d = crew.drive;
  d.aimYaw = wantYaw;
  d.steer = 0;
  const slack = Math.abs(angleDelta(tank.yaw, wantYaw)) - c.driveCone;
  const fall =
    slack <= 0 ? 1 : Math.max(0, 1 - slack / (Math.PI / 2 - c.driveCone));
  const owed = wantY - tank.position.y;
  const rise = owed <= 0 ? 1 : Math.max(0, 1 - owed / c.airClimbGate);
  d.throttle = closing * fall * rise;
}

/**
 * `VehicleCrew.pickBearing`'s counterpart: the bearing nearest the one wanted
 * whose air this hull can actually fly through, or null when none of them is.
 * The altitude that bearing demands is left in `_aloft`.
 *
 * The fan itself is the driver's — the same count, the same spread, the same
 * ascending deviation with the same bias toward the side the nose is already
 * on, for the same reason: a symmetric fan hands back the mirror bearing the
 * moment the machine's own turn makes the other side a hair nearer, and it
 * saws. The bias costs nothing, because every deviation is tried on both
 * sides and only the order changes.
 */
function pickAloft(tank: Vehicle, wantYaw: number): number | null {
  const c = CONFIG.vehicles.crew;
  const steps = Math.max(1, Math.floor(c.whiskers / 2));
  const bias = angleDelta(wantYaw, tank.yaw) >= 0 ? 1 : -1;
  for (let i = 0; i < c.whiskers; i++) {
    // 0, +1, -1, +2, -2, ... : deviation ascending, sides alternating.
    const k = i === 0 ? 0 : (i & 1 ? bias : -bias) * Math.ceil(i / 2);
    const yaw = wantYaw + (k / steps) * c.whiskerSpread;
    const need = aloftAlong(tank, yaw);
    if (need !== Infinity) {
      _aloft = need;
      return yaw;
    }
  }
  return null;
}

/**
 * How high this hull would have to be to fly `airReach` metres along `yaw`,
 * or `Infinity` when that is a height it cannot make.
 *
 * `VehicleCrew.clearAlong`'s counterpart, and the two differ in exactly the
 * way their vehicles do: that one returns at its first failed probe because a
 * wall is a wall, and this one has to walk the whole grid of a bearing it
 * accepts, because the answer is the TALLEST thing on it. A refused column still
 * returns early, so the common case of a blocked bearing is as cheap here as
 * it is there.
 *
 * **The beam is the ROTOR and not the fuselage**, which is the one dimension
 * in this file that is not the hull box. `collideRadius` is what the world
 * keeps this machine out of — 5.2 m, a 10.4 m disc — so probing at
 * `hull.width / 2` would be asking about a corridor a quarter of the width of
 * the thing being flown down it. It is also why five laterals are enough
 * where the ground fan needs seven: the driver's spacing is set by a 0.6 m
 * shopfront pillar, and nothing that narrow has a top face high enough to
 * matter to a machine twelve metres over the roofs.
 */
function aloftAlong(tank: Vehicle, yaw: number): number {
  const c = CONFIG.vehicles.crew;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  // The hull's own right, the same basis `VehicleCrew.clearAlong` and
  // `VehicleSystem.exitSpot` both build.
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  const beam = tank.spec.drive.collideRadius;
  const nose = tank.spec.hull.length / 2;
  let need = -Infinity;
  for (const depth of AIR_DEPTHS) {
    const along = c.airReach * depth;
    const px = tank.position.x + fx * (nose + along);
    const pz = tank.position.z + fz * (nose + along);
    for (const lat of AIR_LATERAL) {
      const at = tank.aloftAt(
        px + rx * beam * lat,
        pz + rz * beam * lat,
        along,
        c.airClearance,
      );
      if (at === Infinity) return Infinity;
      if (at > need) need = at;
    }
  }
  return need;
}
