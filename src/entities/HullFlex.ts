/**
 * HullFlex.ts — What a hull's own mass does to its DRAWING: the sprung body
 * rocking on its springs, the body heaving against its running gear, and the
 * two whip antennae.
 * Owns: the suspension's pitch and roll springs, the heave spring, the rate
 * the mast feet are turning at, both whips, and the wind's clock for them.
 * Writes `rig.sprung` (its rotation and its Y) and the antennae's bend, and
 * nothing else.
 * Owns NO rule. Nothing here moves the collider, the gun's aim or a body's
 * footing, so nothing that shoots, aims or walks can tell this class exists —
 * see `Vehicle`'s header, "What is a rule and what is a picture". It reads the
 * rig and the spec it was built with and the numbers `Vehicle` hands it each
 * frame, and it never asks what KIND of hull it is drawing: a hull with no
 * masts has an empty `rig.antennae`, and a hull whose rotor is carrying it is
 * handed a `load` of 0.
 *
 * ## The ground half of the attitude is not here
 *
 * Where the slope under the tracks puts the hull — `groundPitch`/`groundRoll`
 * on `rig.hull` — is `Vehicle`'s, because `standOnGround` measures it and the
 * flying branch overrides it. This class is the OTHER half, on `rig.sprung`,
 * and the one place the two are summed is `lean`, for the mast feet. See
 * `docs/vehicles.md`.
 */
import { CONFIG } from "../config";
import type { VehicleSpec } from "../config/vehicles";
import { setAntennaBend, type VehicleRig } from "./vehicleRig";

/**
 * The one wind's bearing, normalised once — `CONFIG.wind.dir` is documented as
 * un-normalised and every reader owes this.
 *
 * The masts are the third layer to lean on it, after the grass field and the
 * world's foliage, and they take the BEARING alone: what a gust does to a blade
 * of grass, to ten metres of canopy and to a steel whip are three different
 * answers to the same question, which is exactly the split `config/wind.ts`
 * makes. See `CONFIG.vehicles.tank.antenna.wind`.
 */
const WIND_HYP = Math.hypot(CONFIG.wind.dir[0], CONFIG.wind.dir[1]);
const WIND_X = CONFIG.wind.dir[0] / WIND_HYP;
const WIND_Z = CONFIG.wind.dir[1] / WIND_HYP;

export class HullFlex {
  /**
   * The suspension's half of the drawn attitude, and how fast each axis is
   * moving — the spring `flexSuspension` steps. See `Vehicle.groundPitch` for
   * the other half and why the two are never mixed.
   */
  private suspPitch = 0;
  private suspPitchVel = 0;
  private suspRoll = 0;
  private suspRollVel = 0;
  /**
   * The heave axis: how far the BODY has travelled against the running gear it
   * stands on, in metres, and how fast. Negative is compressed. The pitch and
   * roll above are the other two axes of the same travel and share its stops.
   *
   * The other two are angles because a hull rocking fore and aft turns about
   * its own middle; this one is a distance because a hull landing on its
   * tracks does not turn at all. It is drawn on `rig.sprung`, which is
   * everything the springs carry — see `flexHeave` for what drives it, and
   * `VehicleRig.sprung` for why the tracks are not on it.
   */
  private heave = 0;
  private heaveVel = 0;
  /**
   * The hull node's attitude as it was LAST frame, and how fast it is turning.
   *
   * Kept because the whips answer to it: a mast bolted to a rocking hull bends
   * because its foot is ROTATING, which is a rate and not an angle, and the
   * rate has to be read off the two halves SUMMED — a tank climbing a kerb
   * cracks its antennae exactly as one firing its gun does, and only one of
   * those is the suspension's.
   */
  private leanX = 0;
  private leanZ = 0;
  private leanRateX = 0;
  private leanRateZ = 0;
  /**
   * The two whips: the bow each spring is holding, its velocity, and the LAGGED
   * angle the tip has actually got to. Long mast first, `ANTENNA_LENGTHS`' own
   * order. Pictures, every one of them — see `flexAntennae`.
   */
  private readonly whipX: [number, number] = [0, 0];
  private readonly whipZ: [number, number] = [0, 0];
  private readonly whipVelX: [number, number] = [0, 0];
  private readonly whipVelZ: [number, number] = [0, 0];
  private readonly tipX: [number, number] = [0, 0];
  private readonly tipZ: [number, number] = [0, 0];
  /** The idle stir's own clock. Held by whatever holds the world, as the wind is. */
  private windT = 0;

  constructor(
    private readonly rig: VehicleRig,
    private readonly spec: VehicleSpec,
  ) {}

  /**
   * A fresh hull's springs: at rest, level, and both whips straight. Part of
   * `Vehicle.placeAt`, and for its reason — the rig is pooled, so the only
   * guarantee worth having is that what comes back is clean.
   *
   * The wind's clock is left running, because the wind did not stop.
   */
  reset(): void {
    this.suspPitch = 0;
    this.suspPitchVel = 0;
    this.suspRoll = 0;
    this.suspRollVel = 0;
    this.heave = 0;
    this.heaveVel = 0;
    this.leanX = 0;
    this.leanZ = 0;
    this.leanRateX = 0;
    this.leanRateZ = 0;
    for (let i = 0; i < 2; i++) {
      this.whipX[i] = 0;
      this.whipZ[i] = 0;
      this.whipVelX[i] = 0;
      this.whipVelZ[i] = 0;
      this.tipX[i] = 0;
      this.tipZ[i] = 0;
    }
  }

  /**
   * The main gun has fired. `along` and `across` are its LOCAL bearing resolved
   * onto the hull's own two axes, which `Vehicle.fireGun` works out once and
   * spends on the drive as well.
   */
  kick(along: number, across: number): void {
    // The hull ROCKS, which is a second fact and not the same one as the shove
    // `fireGun` spends against the drive over the next second; this is a
    // velocity straight into the suspension's springs, NOSE UP, because a gun's
    // recoil is a rearward force well above the tracks and what that does to a
    // body standing on them is lift the front. Left to the acceleration term
    // the shove would read as a brake and dive the nose — the opposite of every
    // tank that has ever fired. See `CONFIG.vehicles.tank.suspension.gunKick`.
    //
    // The same couple over a TRAVERSED turret is a roll and not a pitch, and
    // the two are the one impulse split by the bearing, so the hull is rocked
    // exactly as hard whichever way the gun is laid. A positive Z stands the
    // hull's RIGHT side up (`flexSuspension` says so), and a shot to the right
    // shoves the hull left — which lifts the right side, hence the sign.
    const s = this.spec.suspension;
    this.suspPitchVel -= s.gunKick * along;
    this.suspRollVel += s.gunKick * across;
    // ...and the MASTS crack, which is a third fact and belongs here for the
    // same reason the second one does. The hull is shoved back along the GUN's
    // axis, so both whips are thrown out along it; the only thing the drive
    // terms would ever see of a shot is the quarter second afterwards where the
    // tracks brake that shove out, which lays them BACK — so said here, the
    // pair come out as one crack and a lay-back after it. See `antenna.gunKick`.
    //
    // No bearing on this one, and that is the whole point rather than an
    // omission: a whip's axes are the TURRET's and so is the gun's, so the
    // direction a shot throws a mast is the one thing on this vehicle that
    // traversing cannot change. A positive X bend tips a tip toward the
    // turret's +Z, which is where the gun points.
    const kick = this.spec.antenna.gunKick;
    for (let i = 0; i < this.rig.antennae.length; i++) this.whipVelX[i] += kick;
  }

  /**
   * The suspension's half of the attitude, stepped and drawn on `rig.sprung`,
   * and then how fast the MAST FEET are turning — which is the one place the
   * two halves are summed.
   *
   * `groundPitch`/`groundRoll` are the other half as `Vehicle.leanHull` has
   * just drawn it on `rig.hull`, and `load` is `Vehicle.gearLoad`.
   *
   * The write is guarded rather than unconditional because two of these are
   * parked on hardstandings doing nothing for most of a round, and an
   * assignment to a `TransformNode`'s rotation is a world matrix to recompute
   * whether or not the number changed.
   */
  lean(
    dt: number,
    accel: number,
    lateral: number,
    load: number,
    groundPitch: number,
    groundRoll: number,
  ): void {
    this.flexSuspension(dt, accel, lateral, load);
    const b = this.rig.sprung.rotation;
    if (
      Math.abs(this.suspPitch - b.x) > 1e-5 ||
      Math.abs(this.suspRoll - b.z) > 1e-5
    ) {
      b.x = this.suspPitch;
      b.z = this.suspRoll;
    }
    // How fast the MAST FEET are turning, which is what the antennae bend
    // against, and it is still the SUM: a whip hangs off the turret, which
    // rides on the sprung body, which hangs off the hull, so its foot carries
    // both halves. A hull tipping onto a kerb rotates it exactly as one
    // rocking on its own springs does, and a whip cannot tell the two apart.
    const pitch = groundPitch + this.suspPitch;
    const roll = groundRoll + this.suspRoll;
    if (dt > 0) {
      this.leanRateX = (pitch - this.leanX) / dt;
      this.leanRateZ = (roll - this.leanZ) / dt;
    }
    this.leanX = pitch;
    this.leanZ = roll;
  }

  /**
   * How much travel a tilt is asking of its outermost station, in metres.
   *
   * `WHEEL_REACH` and not `TRACK_REACH`: a bump stop is something a road-wheel
   * ARM reaches, and the sprocket and the idler hang off the hull with no arms
   * at all. The two axes SUM because one station is the corner both of them
   * reach — a hull diving and leaning at once puts the same wheel nearest its
   * stop twice over.
   */
  private stationTravel(pitch: number, roll: number): number {
    return (
      this.rig.wheelReach * Math.abs(Math.sin(pitch)) +
      (this.rig.gauge / 2) * Math.abs(Math.sin(roll))
    );
  }

  /**
   * What a spring's rate is multiplied by once `f` of its travel is spent.
   *
   * **A PROGRESSIVE spring is the difference between a suspension that runs
   * out and a suspension that resists**, and it is one number:
   * `1 + progression * f^2`. Squared, so the first part of the travel is
   * within a few per cent of the plain rate and the last part is where the
   * pack goes solid — a spring that hardened linearly from rest would be a
   * stiffer spring rather than a progressive one, and would take the small
   * movements away along with the flop.
   *
   * **It changes where a spring SETTLES and not just how fast it gets there**,
   * which is the whole of what it is for: the drive term is untouched, so a
   * steady acceleration now solves `x * rate(x) = want` instead of `x = want`
   * and the answer is inside the travel where the old one was on the stop.
   *
   * **The stops are not what this replaces.** They are still there and still
   * spend one budget — this is the ramp up to a wall that used to be a wall on
   * its own, and a hull that has spent its travel on one axis still has none
   * left for the other. What it does change is who arrives at them: on a
   * progressive hull the tilt reaches a stop on turn-in and comes off it,
   * where it used to lie against one, and the heave stops arriving at all —
   * see `truck.suspension.heaveBump` for why that is a reserve and not dead
   * space.
   *
   * At `progression: 0` it returns 1 and every spring in the file is the exact
   * arithmetic it was, which is what a tank gets.
   */
  private springRate(f: number): number {
    const p = this.spec.suspension.progression;
    if (p <= 0) return 1;
    const spent = Math.min(1, Math.max(0, f));
    return 1 + p * spent * spent;
  }

  /**
   * What the hull's own mass does to it: the nose dives under the brake, squats
   * under power, and the body leans out of a turn.
   *
   * **A hull that stayed perfectly level was the tell that a tank was a box
   * being slid rather than a mass being driven**, and the fix is not more
   * animation but the arithmetic that was already there: the drive knows the
   * acceleration it achieved and the yaw rate it turned at, and weight transfer
   * is those two numbers and a spring.
   *
   * Two springs, one per axis, driven toward an angle proportional to the
   * acceleration along that axis:
   *
   * - **Pitch** answers to `accel` along the hull's own forward, which is a
   *   DIFFERENCE and not the throttle — coasting, braking and driving into a
   *   building all decelerate, and only the last of them is unasked for. The
   *   input is clamped (`accelLimit`) because a collision spends most of road
   *   speed in a single frame, and the output is bounded by the STOPS below.
   * - **Roll** answers to `speed * yawRate`, the lateral acceleration of the
   *   turn. That is zero for a neutral-steer pivot on the spot, which is
   *   correct: the hull is rotating, not cornering, and there is nothing for it
   *   to lean against.
   *
   * **Both are scaled by `load` — `Vehicle.gearLoad` — which is the same
   * argument one step
   * further back**: a hull whose ROTOR is carrying it is not cornering
   * against its skids either, and there is nothing for that to lean against
   * either. It is 1 on anything that cannot fly, so neither line moved on the
   * ground kinds.
   *
   * **What bounds the answer is a TRAVEL and not an angle, and that is the
   * second half of the fix the node split is the first half of.** A real
   * tracked suspension runs out where a road-wheel arm meets its bump stop, so
   * how far the body may tilt is how much travel is left at the outermost
   * station divided by how far out that station is — and the heave draws on
   * the same stops, so the two are spent from ONE budget rather than clamped
   * separately at limits that could each be legal and jointly put the belly
   * through the road. It falls out at ~3.3 deg of pitch and ~5.2 deg of roll
   * on the tank, and nothing in `CONFIG` states either number.
   *
   * **The springs get STIFFER the more of that budget they have spent
   * (`suspension.progression`), and that is what keeps a stop an event rather
   * than a driving position.** A linear spring pointed at a target angle
   * outside its travel has nowhere to go but the stop, and it sits there for
   * as long as the input holds with its velocity killed — measured on the
   * truck, where full lock at road speed asks for 19.4 deg against a budget
   * worth 8.2, the body lay on its side through every corner, and **half the
   * steering range produced the same lean as the other half**. What hardens is
   * the RESTORE and never the drive, so the angle a steady acceleration
   * settles at solves `x * rate(x) = want` and lands inside the travel with
   * the curve monotone the whole way out. The tank states 0 and its arithmetic
   * is untouched, exactly and not approximately.
   *
   * Stepped semi-implicit Euler rather than in closed form. `CLAUDE.md`'s rule
   * is that anything that moves where bullets go or reads as recoil is stepped
   * exactly; this moves neither — the gun sits on the turret, which hangs off
   * this node and is aimed in WORLD angles, so a leaning hull does not carry
   * the gun off the aim — and at ~1 Hz Euler holds it comfortably. Same
   * treatment as the camera's landing absorb, and for the same reason.
   */
  private flexSuspension(
    dt: number,
    accel: number,
    lateral: number,
    load: number,
  ): void {
    const s = this.spec.suspension;
    const bound = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));
    const felt = bound(accel, s.accelLimit);
    // **Weight transfer needs WEIGHT**, and `load` is how much of it this
    // hull's running gear is holding. It is exactly 1 on anything without a
    // rotor, so the two lines below are the lines they always were on both
    // ground kinds — see `Vehicle.gearLoad`.
    // Accelerating lifts the nose and a positive X rotation puts it down, so
    // the pitch target is the negative of the acceleration. Turning right is a
    // positive yaw rate, and a body thrown left by it stands its RIGHT side up,
    // which is a positive Z.
    const wantPitch = -s.pitchPerAccel * felt * load;
    const wantRoll = s.rollPerAccel * bound(lateral, s.accelLimit) * load;
    // How much travel a corner station has left, in metres, AFTER `flexHeave`
    // has spent what it spent. A tilt spends both stops at once — one end down
    // is the other end up — so what is left is the smaller of the two
    // remainders, which is why the tilt is bounded by `heaveDroop` rather than
    // by the larger `heaveBump`.
    const room = Math.min(s.heaveDroop - this.heave, s.heaveBump + this.heave);
    // The RATE the two springs are standing at, off the travel they have
    // already spent — ONE number for both axes, because they spend one budget,
    // which is the same argument the stop below makes one step later. Read off
    // where the tilt IS rather than off where this frame is taking it, which
    // is the semi-implicit step the rest of this method takes.
    const rate = this.springRate(
      room > 1e-6 ? this.stationTravel(this.suspPitch, this.suspRoll) / room : 1,
    );
    // **The drive term is the acceleration's and the rate never touches it; it
    // is the RESTORE that hardens.** `stiffness * (want - rate * x)` is the
    // plain `stiffness * (want - x)` at rate 1, which is what a hull with no
    // `progression` gets, exactly and not approximately.
    //
    // The DAMPER hardens with it, as the square root of the rate, so that the
    // damping ratio the two figures were tuned to is the ratio at every point
    // of the travel: a suspension that rang at full lean and not at rest would
    // be two different vehicles. What is left over — the spring's TANGENT rate
    // climbs faster than the secant one the restore is written in — leaves a
    // hull a little livelier the harder it is leaning, which is the direction
    // a truck should err in.
    const damp = s.damping * Math.sqrt(rate);
    this.suspPitchVel +=
      (s.stiffness * (wantPitch - rate * this.suspPitch) - damp * this.suspPitchVel) * dt;
    this.suspRollVel +=
      (s.stiffness * (wantRoll - rate * this.suspRoll) - damp * this.suspRollVel) * dt;
    let pitch = this.suspPitch + this.suspPitchVel * dt;
    let roll = this.suspRoll + this.suspRollVel * dt;
    // --- the stops, which are at the WHEEL STATIONS and not on the angles ---
    //
    // What the springs are asking for now, at the outermost road wheel and the
    // outer edge of a track.
    const asked = this.stationTravel(pitch, roll);
    if (asked > room) {
      // Scaled rather than clamped per axis, because the two are drawing on
      // ONE budget: a hull already leaning hard has less dive left in it, and
      // a hull that has just landed on its bump stops has none at all and goes
      // flat, which is what bottoming out does to a body.
      const scale = room / asked;
      pitch *= scale;
      roll *= scale;
      // A stop absorbs rather than bounces, exactly as `flexHeave`'s does.
      this.suspPitchVel = 0;
      this.suspRollVel = 0;
    }
    this.suspPitch = pitch;
    this.suspRoll = roll;
  }

  /**
   * Settles the hull's BODY onto its running gear, which is the third axis of
   * the suspension and the only one measured in metres.
   *
   * **A hull that stayed exactly as far off its tracks as it was parked at was
   * the last thing making a tank look weightless.** The other two springs
   * answer to the drive, so a tank that was neither accelerating nor cornering
   * had nothing to say — and driving over a car is exactly that: the hull went
   * up, came back down and never once looked like it weighed sixty tonnes,
   * because the only thing that had moved was the whole vehicle, rigidly,
   * exactly as far as the ground told it to.
   *
   * What it answers to is one number and it is not a new measurement:
   * `Vehicle.standOnGround` already knows what the ground did to the hull's own
   * vertical velocity, and **when the ground under a vehicle changes speed the
   * body does not** — the difference IS the deflection. So a landing spends
   * the closing speed into the spring, mounting a kerb spends the rise, the
   * top of a car spends that same rise back the other way, and a hull in the
   * air spends gravity itself and droops onto its stops. One term, four
   * events, and nothing anywhere that knows which of them is happening.
   *
   * **The jolt is spent on the spring's VELOCITY and never on its position**,
   * for the reason `kick` kicks the pitch spring's: it is an impulse, so it
   * is frame-rate free — the sum of what a fall hands over does not depend on
   * how many frames the fall took — where an acceleration read off it and
   * clamped would hand a 30 Hz frame twice the landing of a 60 Hz one.
   *
   * **The spring is the progressive one `flexSuspension` describes**, on this
   * axis' own two stops: one suspension has one rate, and a body that has
   * crushed most of its bump rubber is not on the rate it was parked at. What
   * it does NOT do is take the stop away — the most the ground can hand these
   * springs still carries more energy than the hardened spring absorbs inside
   * `heaveBump`, so a real landing still arrives on the stop and rings off it.
   *
   * **The two stops are not the same number, they are not this axis' alone,
   * and `heaveBump` is not a taste**: it is two thirds of `TankModel.BELLY`,
   * so a body compressing much further would put the hull through the road it
   * is driving on — and the third that is left over is what `flexSuspension`
   * is allowed to tilt into. Reaching a stop kills the travel dead and the
   * spring pushes back out, which is what bottoming out is, and a hull that
   * has reached one has no dive left in it either.
   *
   * Cosmetic in `flexSuspension`'s strict sense — this reaches one
   * `TransformNode`'s Y and nothing else. The collider does not move, the gun
   * is aimed in world angles off a turret that rides on this node, and the
   * reticle still cannot lie.
   */
  flexHeave(dt: number, jolt: number): void {
    const s = this.spec.suspension;
    this.heaveVel -= jolt * s.heaveResponse;
    // The hardening the tilt takes, on this axis' own pair of stops — one
    // suspension, one rate, and a body two thirds of the way onto its bump
    // rubber is not standing on the rate it left the ride height at. The two
    // directions normalise against DIFFERENT stops because they ARE different
    // stops: `heaveBump` is a rubber being crushed and `heaveDroop` is a body
    // lifting off its own running gear.
    const rate = this.springRate(
      this.heave < 0 ? -this.heave / s.heaveBump : this.heave / s.heaveDroop,
    );
    this.heaveVel +=
      (-s.heaveStiffness * rate * this.heave -
        s.heaveDamping * Math.sqrt(rate) * this.heaveVel) *
      dt;
    const want = this.heave + this.heaveVel * dt;
    this.heave = Math.max(-s.heaveBump, Math.min(s.heaveDroop, want));
    // A stop absorbs rather than bounces: what is left of the travel is spent
    // in the rubber, and what comes back out is the spring's own doing.
    if (this.heave !== want) this.heaveVel = 0;
    // Guarded for `lean`'s reason: two of these are parked doing nothing
    // for most of a round, and a write is a world matrix whether the number
    // moved or not.
    if (Math.abs(this.heave - this.rig.sprung.position.y) > 1e-5) {
      this.rig.sprung.position.y = this.heave;
    }
  }

  /**
   * Bends the two whip antennae.
   *
   * **This is the suspension's own argument one derivative further out, and it
   * is why there is no physics engine anywhere near it.** A mast is a thin
   * cantilever bolted to the turret: it bends because of the acceleration the
   * drive achieved, because of how fast the thing it is bolted to is rotating,
   * and because there is a wind. All three of those numbers are already to
   * hand, and what a whip does with them is one damped spring per axis. A
   * Havok chain would need a kinematic body per link, a constraint per joint
   * and a transform read back per frame — for a picture, on a hull that is
   * moved by `moveWithCollisions` and SNAPPED up to `stepHeight` by the ground
   * probe, which is a teleport as far as a solver is concerned and cracks a
   * jointed chain every time a tank climbs a kerb. See `docs/vehicles.md`.
   *
   * Four terms, and every one of them is in the TURRET's frame rather than the
   * hull's, because that is what the masts hang off: a hull diving under a
   * turret traversed ninety degrees bends its whips SIDEWAYS, and terms written
   * in the hull's axes would lay them back along a tank that was stopping
   * beside them.
   *
   * - **The drive's acceleration**, clamped by `suspension.accelLimit` — the
   *   same clamp for the same one-frame reason, deliberately not restated in
   *   the antenna block. A whip trails what is thrown at it, so the tip goes
   *   the OPPOSITE way to the acceleration: a hull pulling away lays its masts
   *   back, and one that has just hit a building throws them forward.
   * - **Sideways is `speed * yawRate`**, as the hull's roll is, so a
   *   neutral-steer pivot whips nothing sideways. There is no lateral
   *   acceleration in one to whip against.
   * - **The base's own rotation RATE**, which is the term that makes the gun
   *   visible from outside the tank: `fireGun` rocks the hull nose-up in a
   *   fifth of a second, the mast feet go with it and the tips do not, so both
   *   whips bend back and ring. It costs nothing extra and it arrives through
   *   the ground lean too, so kerbs and shell craters crack them for free.
   * - **The wind**, so a parked hull is not two steel rods. Bearing from
   *   `CONFIG.wind.dir` because there is one wind; amplitude and speed its own,
   *   because a mast is not a blade of grass.
   *
   * Then the bow is handed on in two pieces. The spring's angle is the whip's,
   * and the TIP's angle is a lagged copy of it — so during a fast event the
   * upper link is bent back against the lower one and the mast is an S, and
   * once it settles the two agree and it is a smooth bow. See
   * `setAntennaBend`.
   *
   * Stepped semi-implicit Euler like the suspension, and it holds for the same
   * reason: the frame's `dt` is clamped at 0.05 and the faster of the two masts
   * runs at 3.8 Hz, which is `w * dt` of 1.2 against Euler's ceiling of 2. What
   * would break it is a stiffer spring, not a slower frame.
   */
  flexAntennae(dt: number, accel: number, lateral: number): void {
    const a = this.spec.antenna;
    const lim = this.spec.suspension.accelLimit;
    const bound = (v: number, l: number) => Math.max(-l, Math.min(l, v));
    // Into the turret's own frame: its world yaw is `turretYaw`, so the local
    // one is what the drawn node already carries.
    const phi = this.rig.turret.rotation.y;
    const cs = Math.cos(phi);
    const sn = Math.sin(phi);
    const ax = bound(lateral, lim);
    const az = bound(accel, lim);
    const localAX = ax * cs - az * sn;
    const localAZ = ax * sn + az * cs;
    const rateX = this.leanRateX * cs - this.leanRateZ * sn;
    const rateZ = this.leanRateX * sn + this.leanRateZ * cs;
    const windX = WIND_X * cs - WIND_Z * sn;
    const windZ = WIND_X * sn + WIND_Z * cs;
    // Wrapped at the two sines' COMMON period rather than at either one's, so
    // the gust is continuous across the wrap and the clock does not grow for
    // the length of a round. Same rule as `setTrackRun`'s modulo.
    this.windT = (this.windT + dt) % (200 * Math.PI / a.wind.speed);
    for (let i = 0; i < this.rig.antennae.length; i++) {
      const whip = this.rig.antennae[i];
      // Two sines well off a whole ratio, so the gust does not come round on a
      // metronome — the same trick the grass shader plays, at a mast's rate.
      const t = this.windT * a.wind.speed + whip.phase;
      // The flutter rides on top of the drift: a quicker beat, about a second
      // at the speed every kind states, swelling and fading on a slower
      // envelope so it comes in gusts rather than on a metronome. Mostly along
      // the wind and partly across it — a whip in a steady wind is shaken
      // sideways by its own wake — and both ride the same whip's phase, so a
      // pair are shaken out of step. 0 on a kind that states none, where this
      // is the drift exactly as it always was.
      const beat = a.wind.flutter * (0.6 + 0.4 * Math.sin(t * 0.73));
      const along = a.wind.sway * (Math.sin(t) * 0.7 + Math.sin(t * 0.41) * 0.3)
        + beat * Math.sin(t * 5.3 + whip.phase);
      const across = beat * 0.5 * Math.sin(t * 4.1 + whip.phase * 1.7);
      // A positive X rotation tips the mast's top toward +Z and a positive Z
      // rotation tips it toward -X, which is where both signs below come from.
      // `across` is the wind's bearing turned a quarter, (-windZ, windX).
      const wantX = -localAZ * a.swayPerAccel - rateX * a.lagPerRate + windZ * along + windX * across;
      const wantZ = localAX * a.swayPerAccel - rateZ * a.lagPerRate - windX * along + windZ * across;
      // One spring per mast, scaled off the long one by its length — see
      // `Whip.rate`. Stiffness goes as the square of the rate and damping as
      // the rate itself, which is what keeps both at the same damping RATIO:
      // scaling only the stiffness would leave the short mast ringing.
      const rate = whip.rate;
      const k = a.stiffness * rate * rate;
      const c = a.damping * rate;
      this.whipVelX[i] += (k * (wantX - this.whipX[i]) - c * this.whipVelX[i]) * dt;
      this.whipX[i] = bound(this.whipX[i] + this.whipVelX[i] * dt, a.bendLimit);
      this.whipVelZ[i] += (k * (wantZ - this.whipZ[i]) - c * this.whipVelZ[i]) * dt;
      this.whipZ[i] = bound(this.whipZ[i] + this.whipVelZ[i] * dt, a.bendLimit);
      // The tip chases the bow and never leads it. This is the only reason the
      // mast is drawn as two links rather than one.
      const follow = Math.min(1, dt * a.lagRate);
      this.tipX[i] += (this.whipX[i] - this.tipX[i]) * follow;
      this.tipZ[i] += (this.whipZ[i] - this.tipZ[i]) * follow;
      setAntennaBend(whip, a.baseShare, this.whipX[i], this.whipZ[i], this.tipX[i], this.tipZ[i]);
    }
  }
}
