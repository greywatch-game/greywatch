/**
 * HullWhips.ts — A hull's whip antennae, bending: the one part of a
 * vehicle's drawing that is a simulation of its own and has nothing downstream
 * of it.
 * Owns: every whip's springs (the bow each holds, its velocity and the lagged
 * tip), the rate the mast feet are turning at, and the wind's clock for them.
 * Writes the antennae's two links (`setAntennaBend`) and nothing else.
 * Owns NO rule and reads no hull: it is CLIENT-only (`entities/VehicleView.ts`
 * builds one per hull and is told by `Vehicle`'s `HullPicture` when the gun
 * fires and when the hull has been stepped, with the numbers this needs), the
 * authority builds none, and nothing aims, walks, collides or is picked
 * against a mast. The springs, which ARE on a muzzle's path, are the
 * simulation's (`entities/HullSprings.ts`).
 * It never asks what KIND of hull it is drawing: a hull with no masts has an
 * empty `antennae`, and every loop here is over that list — and so is every
 * spring array's length, sized off it once, so a kind with three masts is a
 * third spring rather than a write past the end of a pair.
 */
import { CONFIG } from "../config";
import type { VehicleSpec } from "../config/vehicles";
import { setAntennaBend, type Whip } from "./vehicleRig";

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

export class HullWhips {
  /**
   * The mast feet's attitude as it was LAST step, and how fast it is turning.
   *
   * Kept because the whips answer to it: a mast bolted to a rocking hull bends
   * because its foot is ROTATING, which is a rate and not an angle, and the
   * rate has to be read off the hull's two halves SUMMED — a tank climbing a
   * kerb cracks its antennae exactly as one firing its gun does, and only one
   * of those is the suspension's.
   */
  private leanX = 0;
  private leanZ = 0;
  private leanRateX = 0;
  private leanRateZ = 0;
  /**
   * The whips: the bow each spring is holding, its velocity, and the LAGGED
   * angle the tip has actually got to. One slot per mast, long mast first,
   * `VehicleRig.antennae`'s own order and length. Pictures, every one of them
   * — see `step`.
   */
  private readonly whipX: Float64Array;
  private readonly whipZ: Float64Array;
  private readonly whipVelX: Float64Array;
  private readonly whipVelZ: Float64Array;
  private readonly tipX: Float64Array;
  private readonly tipZ: Float64Array;
  /** The idle stir's own clock. Held by whatever holds the world, as the wind is. */
  private windT = 0;

  constructor(
    /** The rig's masts, longest first. May be empty. */
    private readonly antennae: readonly Whip[],
    private readonly spec: VehicleSpec,
  ) {
    const n = antennae.length;
    this.whipX = new Float64Array(n);
    this.whipZ = new Float64Array(n);
    this.whipVelX = new Float64Array(n);
    this.whipVelZ = new Float64Array(n);
    this.tipX = new Float64Array(n);
    this.tipZ = new Float64Array(n);
  }

  /**
   * A fresh hull's whips: straight and still, and the feet's attitude back at
   * level. On the placing that resets the rig, for `Vehicle.placeAt`'s reason
   * — the hull is pooled, so the only guarantee worth having is that what comes
   * back is clean. The wind's clock is left running, because the wind did not
   * stop.
   */
  reset(): void {
    this.leanX = 0;
    this.leanZ = 0;
    this.leanRateX = 0;
    this.leanRateZ = 0;
    this.whipX.fill(0);
    this.whipZ.fill(0);
    this.whipVelX.fill(0);
    this.whipVelZ.fill(0);
    this.tipX.fill(0);
    this.tipZ.fill(0);
  }

  /**
   * The main gun has fired, and the MASTS crack — a third fact off the same
   * shot, after the shove `Vehicle.fireGun` spends against the drive and the
   * rock `HullSprings.kick` puts into the springs. The hull is shoved back
   * along the GUN's axis, so both whips are thrown out along it; the only thing
   * the drive terms would ever see of a shot is the quarter second afterwards
   * where the tracks brake that shove out, which lays them BACK — so said here,
   * the pair come out as one crack and a lay-back after it. See
   * `antenna.gunKick`.
   *
   * No bearing on this one, and that is the whole point rather than an
   * omission: a whip's axes are the TURRET's and so is the gun's, so the
   * direction a shot throws a mast is the one thing on this vehicle that
   * traversing cannot change. A positive X bend tips a tip toward the
   * turret's +Z, which is where the gun points.
   */
  kick(): void {
    const kick = this.spec.antenna.gunKick;
    for (let i = 0; i < this.antennae.length; i++) this.whipVelX[i] += kick;
  }

  /**
   * One step of the whips — the hull has just been stepped, and these are
   * the numbers it hands its picture (`HullPicture.flexed`).
   *
   * **This is the suspension's own argument one derivative further out, and it
   * is why there is no physics engine anywhere near it.** A mast is a thin
   * cantilever bolted to the turret: it bends because of the acceleration the
   * drive achieved, because of how fast the thing it is bolted to is rotating,
   * and because there is a wind. All three of those numbers are already to
   * hand, and what a whip does with them is one damped spring per axis. A
   * Havok chain would need a kinematic body per link, a constraint per joint
   * and a transform read back per frame — for a picture, on a hull that is
   * moved by a sweep (`moveBody`) and SNAPPED up to `stepHeight` by the ground
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
  step(
    dt: number,
    accel: number,
    lateral: number,
    footPitch: number,
    footRoll: number,
    turretY: number,
  ): void {
    // How fast the MAST FEET are turning, which is what the antennae bend
    // against, and it is the SUM of the hull's two halves: a whip hangs off
    // the turret, which rides on the sprung body, which hangs off the hull, so
    // its foot carries both. A hull tipping onto a kerb rotates it exactly as
    // one rocking on its own springs does, and a whip cannot tell the two
    // apart. `footPitch`/`footRoll` are that sum as `Vehicle` holds it.
    if (dt > 0) {
      this.leanRateX = (footPitch - this.leanX) / dt;
      this.leanRateZ = (footRoll - this.leanZ) / dt;
    }
    this.leanX = footPitch;
    this.leanZ = footRoll;
    const a = this.spec.antenna;
    const lim = this.spec.suspension.accelLimit;
    const bound = (v: number, l: number) => Math.max(-l, Math.min(l, v));
    // Into the turret's own frame: its world yaw is `turretYaw`, so the local
    // one is what the drawn node carries — the pose's `turretY`, handed in.
    const phi = turretY;
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
    for (let i = 0; i < this.antennae.length; i++) {
      const whip = this.antennae[i];
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
