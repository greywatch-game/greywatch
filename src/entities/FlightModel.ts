/**
 * FlightModel.ts — The part of a hull that hangs on a ROTOR: how far the disc
 * is spooled, which way it is tilted, and what that tilt and the collective
 * do to the machine.
 * Owns: the spool and the disc's run, the commanded attitude (`tiltPitch`,
 * `cyclicRoll`, the coordinated `bankRoll` and the drawn `tiltRoll`), and the
 * lagged velocity a hull on the wire reads its attitude back out of.
 * Owns NOTHING about where the hull is. `yaw`, `vel`, `velY`, `lift` and
 * `speed` are `Vehicle`'s, because the ground path writes them too and two
 * owners of one velocity is two answers about where a vehicle is. So every
 * method here is HANDED what it reads of the hull's motion and either writes
 * the velocity it was handed (`thrust`) or hands back a number for `Vehicle`
 * to spend (`collective`). The pedals stay in `Vehicle.flyStep` as well: they
 * are `steerTo` and `steerAuthority`, the same linkage a tracked hull turns on.
 *
 * **One of these exists for a hull whose spec states `flight` and none for one
 * that does not** — `Vehicle.flight` is that nullable block resolved once, the
 * same bargain `armed` and `flies` make, and nothing here or there asks what
 * KIND of hull it is.
 *
 * Every sign convention here is the DRAWN node's: positive `tiltPitch` is
 * nose-DOWN and a positive roll raises the hull's own right side. See
 * `docs/vehicles.md`.
 */
import type { Vector3 } from "@babylonjs/core";
import type { VehicleSpec } from "../config/vehicles";
import type { DriveInput } from "./Vehicle";

/** Everything a hull that flies states about flying. */
export type FlightSpec = NonNullable<VehicleSpec["flight"]>;

/**
 * How fast a remote hull's own velocity is chased to get an ACCELERATION out
 * of it, 1/s. `tiltFromMotion` is the only reader.
 *
 * **A lag rather than a difference, and that is the whole of why it works.**
 * `NetVehicles` lerps LINEARLY between samples, so the velocity measured on
 * this side is piecewise constant: differencing it frame to frame gives a
 * spike at every bracket boundary and a zero on every frame between them,
 * which is not an acceleration but a picture of when the snapshots landed.
 * Chasing a lagged copy instead makes the estimate an exponentially weighted
 * MEAN of that train, which is the acceleration — the spikes are what carry
 * it, and averaging them is exactly what recovers the figure they are a
 * sampling of.
 *
 * At 6 it averages over about a sixth of a second, which is two or three
 * snapshot intervals: enough for the mean to be the mean, and short against
 * the `drive.airTiltRate` filter the answer is drawn through anyway.
 */
const REMOTE_ACCEL_RATE = 6;

/**
 * The disc tilt that would be making `thrust` m/s^2 of horizontal push, given
 * `scale` m/s^2 per radian of tilt, bounded by what the cyclic can ask for.
 *
 * `thrust`'s own line read backwards, and both of its bounds are load-bearing
 * rather than defensive tidiness. The ratio is clamped because it is built out
 * of a velocity `Vehicle.updateRemote` MEASURED off the wire, and a hull the
 * interpolator is shoving can report a push no disc could produce — `asin` of
 * which is `NaN`, which would go straight onto a drawn node and take the hull
 * off the map. The ANGLE is clamped again because the stick has a limit: what
 * comes back must be an attitude a pilot could be holding, and a machine being
 * dragged sideways past a wall is evidence of a wall and not of a stick.
 */
function tiltFor(thrust: number, scale: number, limit: number): number {
  const ratio = Math.max(-1, Math.min(1, thrust / scale));
  return Math.max(-limit, Math.min(limit, Math.asin(ratio)));
}

export class FlightModel {
  /**
   * `vel` chased at `REMOTE_ACCEL_RATE`, horizontal, and the difference
   * between the two IS the acceleration `tiltFromMotion` needs.
   *
   * Written on a hull posed from the wire and on no other, which is why it is
   * not next to the drive: a machine simulating itself knows what its own disc
   * is doing and never has to ask what the motion implies.
   */
  private readonly velLag = { x: 0, z: 0 };
  /**
   * How far spooled, 0..1. A rotor nobody is turning is a rotor at rest.
   *
   * Read by `Vehicle` (the voice, the wash, the `running` gate) and written
   * here alone, as are `rotorRun`, `tiltPitch` and `tiltRoll`.
   */
  rotor = 0;
  /** Radians of disc, accumulated mod 2pi. `trackRun`'s metres, for a rotor. */
  rotorRun = 0;
  /**
   * The attitude the CYCLIC is commanding, radians, in the DRAWN sense — so
   * positive `tiltPitch` is nose-DOWN and positive `cyclicRoll` raises the
   * hull's own RIGHT side. Both are held that way so that the picture and the
   * thrust taken off them cannot come apart; `cyclic` has the measurements.
   *
   * Written by `cyclic` on the machine somebody is flying and by
   * `tiltFromMotion` on the ones they are not — the same two angles either
   * way, the second worked out of the motion that arrived instead of out of a
   * stick, so a hull is drawn at one attitude on every screen in the match.
   *
   * (This said "nose-up positive" for as long as it existed and was wrong the
   * whole time — `Vehicle.standOnGround` writes `groundPitchTarget = -rise`
   * from a nose-up `rise`, and the flying branch assigns `tiltPitch` to that
   * same field with no negation.)
   */
  tiltPitch = 0;
  private cyclicRoll = 0;
  /**
   * The coordinated-turn bank, which is a PICTURE and has no thrust behind it
   * — see `cyclic`, where the reason is that this half is made of the pilot's
   * look rather than of anything they asked the machine to do.
   */
  private bankRoll = 0;
  /**
   * What is actually DRAWN: `cyclicRoll + bankRoll`, clamped. Held as a field
   * rather than recomputed because the airborne branch of `Vehicle.update`
   * hands it straight to `groundRollTarget`, and `updateRemote`'s hands it the
   * copy `tiltFromMotion` worked out.
   */
  tiltRoll = 0;

  constructor(
    /** This kind's flight block — `VehicleSpec.flight`, known to be there. */
    readonly spec: FlightSpec,
    /**
     * The drive block beside it, for the two figures a disc shares with a
     * hull on the ground: `gravity`, and `tiltLimit`, which is what a hull of
     * any kind may be drawn holding.
     */
    private readonly drive: VehicleSpec["drive"],
  ) {}

  /** A fresh hull: rotor at rest, disc level. Part of `Vehicle.placeAt`. */
  reset(): void {
    this.velLag.x = 0;
    this.velLag.z = 0;
    this.rotor = 0;
    this.rotorRun = 0;
    this.tiltPitch = 0;
    this.cyclicRoll = 0;
    this.bankRoll = 0;
    this.tiltRoll = 0;
  }

  /**
   * The disc has stopped, because the hull has burned. `Vehicle.wreck` says
   * why this is the whole of what makes a shot-down machine fall.
   *
   * The attitude is left where the shot found it, so a machine that died
   * banked falls banked. See `Vehicle.settle`.
   */
  stop(): void {
    this.rotor = 0;
  }

  /**
   * One frame of the rotor turning: toward full speed if somebody is at the
   * controls, toward rest if nobody is. Both copies of a hull step it, the one
   * being flown and the one posed off the wire, because the disc is the one
   * part of a helicopter that turns whether or not it is going anywhere.
   */
  spool(dt: number, manned: boolean): void {
    const f = this.spec;
    // Rate-limited exactly rather than lerped, for `Vehicle.steerTo`'s reason:
    // a spool is a mechanism and not a smoothing, so it must take the same time
    // on every machine. A hull nobody is in winds down, which is what makes a
    // parked helicopter cost the frame what a parked tank costs — with `lift`
    // back at 0 the ground probe's own skip re-arms and stops asking.
    const want = manned ? 1 : 0;
    this.rotor +=
      Math.sign(want - this.rotor) *
      Math.min(Math.abs(want - this.rotor), dt / f.spoolTime);
    this.rotorRun =
      (this.rotorRun + this.rotor * f.rotorRate * dt) % (Math.PI * 2);
  }

  /**
   * How much of the rotor's song is worth anything, 0..1.
   *
   * Below `liftFloor` the disc turns and lifts nothing, which is what a
   * spool-up IS — and it takes the tail rotor's authority with it, so a
   * machine coming up to speed cannot pedal either.
   *
   * A method rather than a line inside `thrust` because the hull on the WIRE
   * asks it too: `tiltFromMotion` divides the push a machine is making by this
   * to get the angle its disc must be at, and a second copy of the fade would
   * be a way for the two screens to draw different attitudes for one spool.
   */
  rotorPower(): number {
    const f = this.spec;
    return this.rotor <= f.liftFloor
      ? 0
      : (this.rotor - f.liftFloor) / (1 - f.liftFloor);
  }

  /**
   * The attitude a hull on the WIRE must be at, worked out from the motion it
   * has just made, written onto the same four fields `cyclic` writes.
   *
   * **This is the one part of the picture a flying hull could not derive, and
   * on the two ground kinds it never had to.** `updateRemote`'s bargain is
   * that the wire carries where a hull ended up and every client works the
   * rest out for itself — the belts, the steer they are drawn at, the lean,
   * the heave and the whips are all local. A tank's drawn pitch and roll come
   * out of that bargain for free, because they are `standOnGround`'s: measured
   * off the ground it is standing on, which every client holds identically. A
   * helicopter in the air is standing on nothing, `groundPitchTarget` had
   * nothing to say about it, and so every hull anybody ELSE was flying was
   * drawn dead level — cruising flat and sliding through its turns without
   * banking, while the machine under its own pilot was doing neither.
   *
   * ## The disc's own equation, run backwards
   *
   * `thrust` spends `thrustPerTilt * sin(tilt) * power` along the hull's
   * forward, the same off `cyclicRoll` along its right, and both against a
   * drag of `drag * v`. So the push a disc is making is `a + drag * v` — what
   * the machine's velocity actually did, plus what the air was taking off it
   * meanwhile — and an `asin` hands back the angle the disc must be at to be
   * making it. That is the move `updateRemote` already makes one axis along
   * for the steer the tracks are drawn at: a yaw rate over the turn the drive
   * could have asked for IS the stick that produced it.
   *
   * **Both terms are needed and the ACCELERATION is the one that is not
   * obvious.** The drag term alone is the steady-state balance and is exact
   * whenever the machine is holding a speed, which is most of a cruise — but
   * this model has no aerodynamic side force at all, so a machine in a hard
   * turn is one whose velocity has not caught up with its heading, and the
   * drag term reads that lag as a pilot commanding a strafe. Measured on
   * Sarab: a hull at full cyclic through a sustained turn came out at 1.8
   * degrees nose-down against the 17.2 it was flying at, and banked half as
   * far as the machine under its own pilot. With the acceleration in, both
   * are within a degree.
   *
   * The estimate is `(vel - velLag) * REMOTE_ACCEL_RATE` rather than a
   * difference between frames, and the reason is the interpolator rather than
   * the physics — see that constant.
   *
   * The BANK is not derived at all: it is `cyclic`'s line with the MEASURED
   * yaw rate in place of the commanded one, eased at the same `cyclicRate` so
   * that both screens draw the same roll through the same turn. The two angles
   * either side of it are deliberately NOT eased again — what a velocity
   * carries is the attitude as it was after the pilot's own `cyclicRate`
   * filter, and a second pass would charge that lag twice.
   */
  tiltFromMotion(
    dt: number,
    vel: Vector3,
    yaw: number,
    yawRate: number,
  ): void {
    const f = this.spec;
    // The acceleration, as a lagged copy of the velocity chasing it. Stepped
    // whatever the rotor is doing, so that a machine coming back up to power
    // is not read against a lag left over from before it wound down.
    const ax = (vel.x - this.velLag.x) * REMOTE_ACCEL_RATE;
    const az = (vel.z - this.velLag.z) * REMOTE_ACCEL_RATE;
    const chase = Math.min(1, dt * REMOTE_ACCEL_RATE);
    this.velLag.x += (vel.x - this.velLag.x) * chase;
    this.velLag.z += (vel.z - this.velLag.z) * chase;
    const power = this.rotorPower();
    // A disc that is lifting nothing is tilting nothing either. This is the
    // hull whose pilot has just stepped out, drawn level as it winds down —
    // and it is also the guard that keeps the divide below off zero.
    if (power <= 0) {
      this.tiltPitch = 0;
      this.cyclicRoll = 0;
      this.bankRoll = 0;
      this.tiltRoll = 0;
      return;
    }
    // Forward is `(sin yaw, cos yaw)` and right is therefore
    // `(cos yaw, -sin yaw)` — the pair `thrust` spends its push on and
    // `standOnGround` lays its contacts out on. Both the velocity and the
    // acceleration are resolved onto the CURRENT heading, which is what keeps
    // a turning hull's own rotation out of the answer: what is wanted is the
    // world acceleration seen along the hull's axes, not the rate of change of
    // a quantity measured in a frame that is itself turning.
    const sn = Math.sin(yaw);
    const cs = Math.cos(yaw);
    const scale = f.thrustPerTilt * power;
    const pushX = ax + f.drag * vel.x;
    const pushZ = az + f.drag * vel.z;
    this.tiltPitch = tiltFor(pushX * sn + pushZ * cs, scale, f.cyclicPitch);
    // Negated exactly where `thrust` negates the push it takes OFF this
    // angle, and for that reason: `cyclicRoll` is held in the drawn sense and
    // a positive one raises the hull's own right side, so a machine being
    // pushed to its right is a machine rolled right-side-DOWN.
    this.cyclicRoll = -tiltFor(pushX * cs - pushZ * sn, scale, f.cyclicRoll);
    // …and the coordinated half, which is `cyclic`'s to the letter: the
    // airspeed rather than `speed`, because the two come apart in exactly the
    // turn this is drawing, and negated because a positive yaw rate sweeps the
    // nose right and a machine leans INTO its turn.
    const lateral = Math.hypot(vel.x, vel.z) * yawRate;
    const wantBank = Math.max(
      -f.bankLimit,
      Math.min(f.bankLimit, -lateral * f.bankPerLateral),
    );
    this.bankRoll +=
      (wantBank - this.bankRoll) * Math.min(1, dt * f.cyclicRate);
    // The sum, clamped where `cyclic` clamps it and to the same field: what
    // is drawn is one attitude and `drive.tiltLimit` is what a hull may hold.
    const limit = this.drive.tiltLimit;
    this.tiltRoll = Math.max(
      -limit,
      Math.min(limit, this.cyclicRoll + this.bankRoll),
    );
  }

  /**
   * One frame of the CYCLIC: the attitude the pilot's stick commands, and the
   * coordinated bank that the turn the machine is making adds on top of it.
   * Writes `tiltPitch`, `cyclicRoll`, `bankRoll` and `tiltRoll` and nothing
   * else. `thrust` is what takes a push off them.
   *
   * `yawRate` is the turn `Vehicle.flyStep` has just made off the pedals, and
   * `vel` is the hull's velocity BEFORE this frame's thrust, which is the
   * airspeed the bank reads.
   */
  cyclic(dt: number, d: DriveInput, yawRate: number, vel: Vector3): void {
    const f = this.spec;
    const c = this.drive;
    // --- the cyclic, and the auto-level is this line with the stick centred ---
    // What the fore/aft stick commands is an ATTITUDE and not a speed, which is
    // the whole difference between this and the throttle walk in
    // `Vehicle.update`: let go and the nose comes back level because level is
    // what a centred stick asks for, and the machine then coasts to a stop on
    // drag alone.
    //
    // **`tiltPitch` is the angle as the DRAWN node takes it**, which on this
    // rig means positive is nose-DOWN — `Vehicle.standOnGround` writes
    // `groundPitchTarget = -rise` for exactly that reason. Holding it in the
    // drawn sense is what keeps the sign honest: the first version negated here
    // and negated again at the thrust, which cancelled and flew forwards
    // correctly while drawing the machine 17 degrees nose-UP as it accelerated.
    // `thrust` reads the same field without a sign of its own, so the picture
    // and the direction of travel cannot come apart again.
    const wantTilt = d.throttle * f.cyclicPitch;
    this.tiltPitch +=
      (wantTilt - this.tiltPitch) * Math.min(1, dt * f.cyclicRate);
    // The BANK is drawn rather than flown: a helicopter in a coordinated turn
    // rolls into it, and how far is the lateral the turn is actually making. So
    // a pedal turn at a hover banks nothing, which is correct, and is why this
    // is not simply the stick.
    //
    // **It is the AIRSPEED and not `speed`**, which is the one place on this
    // vehicle the two genuinely come apart. `speed` is the along-heading
    // component every ground reader wants, and in a hard turn it collapses —
    // the heading sweeps round faster than the velocity follows it — so a
    // machine doing 6 m/s through a 77 deg/s turn reported 2 and banked three
    // degrees, which reads as a vehicle sliding flat round a corner. What a
    // turn actually pulls is `|v| * omega`, and that is what a wing is holding
    // up against.
    //
    // **It is NEGATED, and that is the DRAWN sense rather than a correction on
    // top of one** — the same statement `tiltPitch` makes above, got wrong here
    // in the mirror image. `DriveInput.steer` is positive to the RIGHT and
    // forward is `(sin yaw, cos yaw)`, so a positive `yawRate` sweeps the nose
    // toward the hull's own right and `lateral` comes out positive in a right
    // turn — but a positive Z rotation raises local +X, which IS that right
    // side, measured at +29.6 cm of right-side rise per 0.3 rad. So the
    // unnegated form rolled AWAY from the turn: 0.42 rad of left bank through a
    // hard right, which reads as a machine being thrown out of its own turn
    // rather than leaning into it. `Vehicle.standOnGround` gets the same
    // convention right by measuring `right - left` off the ground itself, which
    // is why a helicopter standing on a slope has always looked correct and
    // only a FLYING one did not. `bankPerLateral` stays a positive magnitude in
    // the spec exactly as `cyclicPitch` does; which way it is spent is this
    // file's to know.
    const airspeed = Math.hypot(vel.x, vel.z);
    const lateral = airspeed * yawRate;
    const wantBank = Math.max(
      -f.bankLimit,
      Math.min(f.bankLimit, -lateral * f.bankPerLateral),
    );
    this.bankRoll +=
      (wantBank - this.bankRoll) * Math.min(1, dt * f.cyclicRate);

    // --- the LATERAL cyclic, which is the other half of the same stick ---
    // With the nose bolted to the look there is no yaw left for `d.steer` to
    // mean, so it means what the other axis of a cyclic means: the disc tilts
    // sideways and the machine goes that way. This is `tiltPitch` again with
    // the axis changed — an ATTITUDE and not a speed, so letting go rolls back
    // to level and the machine coasts out of the strafe on drag alone — and it
    // is held in the DRAWN sense for the same reason and with the same sign
    // measured the same way: a positive Z rotation raises the hull's own right
    // side, so strafing RIGHT is a NEGATIVE roll.
    const wantRoll = -d.steer * f.cyclicRoll;
    this.cyclicRoll +=
      (wantRoll - this.cyclicRoll) * Math.min(1, dt * f.cyclicRate);

    // **The drawn roll is the sum and only the COMMANDED half has thrust
    // behind it**, which is a decision rather than an oversight and the one
    // place this model deliberately lets the picture carry more than the
    // physics. A disc tilted by theta really does push `T sin(theta)` that
    // way, so taking the thrust off the whole angle is the more physical
    // reading — and it is the wrong one HERE, because the coordinated half is
    // now made of the pilot's LOOK: `lateral` is `airspeed * yawRate` and
    // `yawRate` is how fast the view is sweeping, so a bank with thrust behind
    // it would mean turning your head translates the aircraft. A player
    // glancing at a flag would slide toward it. The commanded half is the
    // half somebody asked for, and it is the half that moves the machine.
    //
    // Clamped to `drive.tiltLimit`, which is what that field has always meant
    // on this kind and until now bounded nothing: the flying branch writes
    // `groundRollTarget` directly and skips `standOnGround`'s own clamp, so a
    // full strafe inside a hard turn was 0.71 rad — 41 degrees — of roll on a
    // machine whose stated bank limit is 34.
    this.tiltRoll = Math.max(
      -c.tiltLimit,
      Math.min(c.tiltLimit, this.cyclicRoll + this.bankRoll),
    );
  }

  /**
   * The disc's push, spent on the hull's horizontal velocity `vel`, which this
   * WRITES: thrust off the commanded attitude along the hull's own axes at
   * `yaw`, then the drag, then the terminal.
   */
  thrust(dt: number, yaw: number, vel: Vector3): void {
    const f = this.spec;
    const power = this.rotorPower();
    // The disc's thrust is along the hull's own UP, so tilting it by theta puts
    // `T sin(theta)` along the tilt. The vertical share is the collective's and
    // is spent by `collective`; what is taken here is the horizontal alone, on
    // BOTH axes of the stick and off the same constant, because a disc has no
    // opinion about which way it has been tipped.
    //
    // Forward is `(sin yaw, cos yaw)` and right is therefore
    // `(cos yaw, -sin yaw)` — the same pair `Vehicle.standOnGround` lays its
    // contacts out on. The lateral term is negated because `cyclicRoll` is the
    // DRAWN angle and a positive one raises the right side, so a
    // right-side-down roll has to come out as thrust to the right.
    const thrust = f.thrustPerTilt * Math.sin(this.tiltPitch) * power;
    const side = f.thrustPerTilt * Math.sin(-this.cyclicRoll) * power;
    vel.x += (Math.sin(yaw) * thrust + Math.cos(yaw) * side) * dt;
    vel.z += (Math.cos(yaw) * thrust - Math.sin(yaw) * side) * dt;

    // Drag, stepped EXACTLY and not with the frame-lerp idiom: this velocity
    // moves the hull a gunner is laying a gun from, so it is somewhere bullets
    // go, and the convention is explicit about which of the two those need.
    const keep = Math.exp(-f.drag * dt);
    vel.x *= keep;
    vel.z *= keep;
    // The terminal is separate from the drag so that top speed stays a FACT
    // rather than a consequence — the same statement `drive.maxSpeed` makes for
    // a hull on the ground.
    const air = Math.hypot(vel.x, vel.z);
    if (air > f.maxAirspeed) {
      const k = f.maxAirspeed / air;
      vel.x *= k;
      vel.z *= k;
    }
  }

  /**
   * The COLLECTIVE: the vertical acceleration the disc makes this frame, which
   * `Vehicle` spends as `lift`.
   *
   * `ask` is the stick, -1..1. `above` is how high the skids are over the
   * floor, which is what the ceiling is measured against. `velY` is how fast
   * the hull is climbing now.
   */
  collective(ask: number, above: number, velY: number): number {
    const f = this.spec;
    const c = this.drive;
    const power = this.rotorPower();
    // The ceiling fades rather than clamps, so the machine runs out of air
    // instead of hitting a lid. `Vehicle.flyStep` says what it is measured
    // over.
    const fade = Math.max(
      0,
      Math.min(1, (f.ceiling - above) / f.ceilingBand),
    );
    // **The collective asks for a RATE, and `lift` is whatever acceleration
    // chases it.** That is the one thing here that is not simply "a force on a
    // mass", and it is deliberate twice over.
    //
    // It is what a HOVER is. An acceleration-commanding collective holds
    // VELOCITY when it is centred rather than height — Newton's first law — so
    // a machine that had been climbing went on climbing with the stick let go,
    // measured at 237 m over a 40 m ceiling with nothing in the model asking it
    // to stop. What a pilot means by letting go is "stay where you are", and a
    // target rate of zero says exactly that with no altitude-holder anywhere.
    //
    // And it is what makes the CEILING work. The fade is on the asked rate and
    // only when it asks to go UP, so at the ceiling full stick asks for zero
    // and the correction actively arrests a climb already in hand — where
    // fading `lift` itself would put the machine under gravity and drop it out
    // of the sky, which was the first version and cost a 35 m fall from a
    // centred stick. Coming DOWN is never something the air refuses.
    const wantY =
      ask >= 0 ? ask * f.climbRate * fade : ask * f.descentRate;
    const need = (wantY - velY) * f.liftResponse;
    return (
      (c.gravity +
        Math.max(-f.climbAccel, Math.min(f.climbAccel, need))) *
      power
    );
  }
}
