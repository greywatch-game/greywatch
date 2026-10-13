/**
 * HullSprings.ts — What a hull's own mass does to its sprung body: the body
 * rocking on its springs and heaving against its running gear.
 * Owns: the suspension's pitch and roll springs and the heave spring. Writes
 * the three `sprung` channels of the hull's `HullPose` — behind the guards the
 * node writes always had — and nothing else.
 * Owns NO rule, and no node: **no `@babylonjs/core`**. Nothing here moves the
 * collider, the gun's aim or a body's footing — but it is on a MUZZLE's path:
 * the turret and both guns hang off `sprung`, so where a round leaves is read
 * off the springs AS DRAWN, guard and all (`entities/hullFrame.ts`). So the
 * springs are SIMULATION — stepped on the authority too — the pose record is
 * written exactly where and when the node used to be, a view copies the record
 * onto the node and never the other way (`entities/VehicleView.ts`), and a
 * change to either guard moves the fight hash. It reads the spec and the frame
 * it was built with and the numbers `Vehicle` hands it each frame, and it never
 * asks what KIND of hull it is: a hull whose rotor is carrying it is handed a
 * `load` of 0.
 *
 * ## The ground half of the attitude is not here, and neither are the whips
 *
 * Where the slope under the tracks puts the hull — `groundPitch`/`groundRoll`
 * on `rig.hull` — is `Vehicle`'s, because `standOnGround` measures it and the
 * flying branch overrides it. This class is the OTHER half, on `rig.sprung`.
 * The two whip antennae are a picture with nothing downstream of them, so
 * they are the client's
 * (`entities/HullWhips.ts`), told the two halves SUMMED — the mast feet's
 * attitude — by `Vehicle`'s `HullPicture`. See `docs/vehicles.md`.
 */
import type { VehicleSpec } from "../config/vehicles";
import type { HullFrame, HullPose } from "./hullFrame";

export class HullSprings {
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
  constructor(
    private readonly spec: VehicleSpec,
    /** The kind's extents — `wheelReach` and `gauge` bound the travel. */
    private readonly frame: HullFrame,
    /**
     * The hull's drawn pose, `Vehicle`'s record: this class writes the three
     * `sprung` channels, each behind its guard. See `HullPose`.
     */
    private readonly pose: HullPose,
  ) {}

  /**
   * A fresh hull's springs: at rest and level. Part of `Vehicle.placeAt`, and
   * for its reason — the hull is pooled, so the only guarantee worth having is
   * that what comes back is clean.
   *
   * The pose's `sprung` channels are not zeroed here: `Vehicle.placeAt` zeroes
   * the whole record, and the view resets the rig on the same placing.
   */
  reset(): void {
    this.suspPitch = 0;
    this.suspPitchVel = 0;
    this.suspRoll = 0;
    this.suspRollVel = 0;
    this.heave = 0;
    this.heaveVel = 0;
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
    // ...and the MASTS crack, which is a third fact off the same shot and a
    // picture's alone — `Vehicle.fireGun` tells the view (`HullWhips.kick`).
  }

  /**
   * The suspension's half of the attitude, stepped and written into the pose's
   * `sprung` channels. `load` is `Vehicle.gearLoad`.
   *
   * The write is guarded rather than unconditional, and the guard is on the
   * muzzle's path: it was there because two of these are parked on
   * hardstandings doing nothing for most of a round, and an assignment to a
   * `TransformNode`'s rotation is a world matrix to recompute whether or not
   * the number changed — and a muzzle has always been read off the node AS
   * DRAWN, so the record keeps the guard the node had.
   */
  lean(dt: number, accel: number, lateral: number, load: number): void {
    this.flexSuspension(dt, accel, lateral, load);
    // Compared against what is DRAWN, which the pose record holds — the view
    // copies the record onto `rig.sprung` and nothing else writes either.
    const shown = this.pose;
    if (
      Math.abs(this.suspPitch - shown.sprungX) > 1e-5 ||
      Math.abs(this.suspRoll - shown.sprungZ) > 1e-5
    ) {
      shown.sprungX = this.suspPitch;
      shown.sprungZ = this.suspRoll;
    }
  }

  /**
   * The suspension's half of the attitude as the springs HOLD it — not as
   * drawn — for the one sum `Vehicle` makes of the two halves: the mast feet's
   * attitude, which the whips bend against.
   */
  get pitch(): number {
    return this.suspPitch;
  }
  get roll(): number {
    return this.suspRoll;
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
      this.frame.wheelReach * Math.abs(Math.sin(pitch)) +
      (this.frame.gauge / 2) * Math.abs(Math.sin(roll))
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
    if (Math.abs(this.heave - this.pose.sprungY) > 1e-5) {
      this.pose.sprungY = this.heave;
    }
  }
}
