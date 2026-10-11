/**
 * reportedLanding.ts — The crash of a hull a PERSON flies, charged off what
 * they REPORTED (FINDINGS.md 60).
 * Owns: one hull's reported vertical history — the last accepted sample's
 * time, height and resting plank, and the rise rate of the interval before it
 * — and the crash cost those reports have run up since the core last spent it
 * (`owed`).
 * Invariants: the arithmetic is `Vehicle.standOnGround`'s `jolt` and
 * `Vehicle.crashCost`'s charge, asked of the report series instead of a
 * stepped hull, so that for the same flight the two agree — exactly when every
 * step is reported (offline), and within the reporter's clock at `INPUT_HZ`
 * (a match). Reads no clock of the core's: an interval is the REPORTER's
 * (`DriveCommand.time`).
 * Never: damages anything itself (`SimCore` spends `owed` through
 * `Vehicle.crash`, in the step, where a stepped hull's crash lands), or reads a
 * reported VELOCITY — nothing is reported but where the hull was and when,
 * which is the bargain `Vehicle.updateRemote` makes for `speed` and `velY`.
 *
 * ## Why it is a separate rule and not `updateRemote` running the old check
 *
 * The crash is one check in `Vehicle.update`'s flight branch, `jolt -
 * crashJolt`, and a person's hull never runs that `update` anywhere that may
 * be hurt: their page predicts it (and `predicted` refuses every blow), and
 * the simulation POSES its copy from the reports. The posed copy's own `jolt`
 * is no good either — the authority poses at 60 Hz off reports arriving at
 * ~20, so its measured vertical rate is a train of spikes and zeros, and
 * `standOnGround`'s airborne branch extrapolates a step past each report. A
 * `jolt` off that crashes helicopters in level flight.
 *
 * ## The rule
 *
 * `standOnGround`'s `jolt` is the change in RISE RATE across one step, and the
 * rise rate is one of two things: the PLANK's own rate (the ground under a
 * hull standing on it, caught up) or the hull's own vertical motion (in the
 * air, or still being shoved up a step). In report terms, sample `k`:
 *
 *     target_k = Vehicle.restAt(x_k, z_k, yaw_k, feet_{k-1})   // the plank, banded off the last sample's tracks
 *     rise_k   = |centre_k - target_k| <= REST
 *                  ? (target_k - target_{k-1}) / dt_k        // on its plank
 *                  : (centre_k - centre_{k-1}) / dt_k        // in the air, or climbing
 *     jolt_k   = clamp(rise_k - rise_{k-1}, ±suspension.joltLimit)
 *     owed    += Vehicle.crashCost(jolt_k)
 *
 * where `dt_k` is the reporter's interval between the two accepted samples.
 * When every step is a sample this IS `standOnGround`'s arithmetic — the band
 * is the tracks before the vertical step, the airborne rise is the step the
 * hull took, a landing's is the plank's — to float noise (measured 6e-11 of
 * 129 points). At `INPUT_HZ` a landing's jolt is the plank's rate less the
 * mean rise of the last airborne interval, which is:
 *
 *   - **exact for a steady descent** on an exact clock (128.9 against 129.1);
 *   - **HIGH for a descent whose rate changes inside its last interval** — a
 *     full-up flare at 0.6 m is 75 ms of the descent, and the wire sees the
 *     rate before it (122 against 70). It can only err that way: a descent
 *     cannot steepen past the collective's `descentRate`, so a late DIVE has
 *     nothing to hide;
 *   - **moved by the reporter's clock**: a match's client stamps with a
 *     whole-ms `Date.now()` (`NetSession`), and a stamp read a millisecond or
 *     so late moves a 50 ms interval's rate by a few percent — ±21 points at
 *     8 m/s over the corecheck's jittered wires.
 *
 * `npm run corecheck` (`sarab/crash`) holds all three to the bot path.
 */
import type { Vehicle } from "../entities/Vehicle";

/**
 * How close, in metres, a reported centre must be to its plank to be STANDING
 * on it — `standOnGround`'s "caught up", which on a stepped hull is equality
 * to the bit. Wide enough for a feet height that has crossed a socket and back
 * and for two worlds built apart; under anything a hull moves in a step.
 */
const REST = 1e-4;

/**
 * The shortest interval two accepted samples may be apart and still be a
 * RATE, seconds. Two stamps closer than this (a repeated clock, a reporter
 * sending twice in one frame) are no interval at all; the second is dropped
 * and the next measured from the first.
 */
const MIN_INTERVAL = 1e-3;

export class ReportedLanding {
  /** Samples held: 0 (none), 1 (a position, no rate yet), 2 (both). */
  private held = 0;
  private time = 0;
  private feet = 0;
  private centre = 0;
  private target = 0;
  private rise = 0;
  /**
   * Crash cost run up since `SimCore` last spent it, hull points before
   * `resist`. Spent and zeroed by the step, and by nothing else.
   */
  owed = 0;

  /**
   * A new pilot: no history, so nothing is measured across the change of
   * hands. What the last one's reports already ran up is still OWED — the
   * step spends it on the hull whoever is in it now.
   */
  reset(): void {
    this.held = 0;
  }

  /**
   * One ACCEPTED report of `tank` — its feet at `x, feet, z`, heading `yaw`,
   * at the reporter's clock `time` (seconds). Adds to `owed` what the arrival
   * it describes costs. Asked only of a hull that flies and is alive.
   */
  sample(tank: Vehicle, x: number, feet: number, z: number, yaw: number, time: number): void {
    const half = tank.spec.hull.height / 2;
    const centre = feet + half;
    // Banded off the tracks as they stood at the LAST sample — the height
    // `standOnGround` probes from, which is the hull before its vertical step.
    const target = tank.restAt(x, z, yaw, this.held > 0 ? this.feet : feet);
    if (this.held === 0) {
      this.store(time, feet, centre, target, 0);
      this.held = 1;
      return;
    }
    const dt = time - this.time;
    if (!(dt >= MIN_INTERVAL)) return;
    const rise =
      Math.abs(centre - target) <= REST
        ? (target - this.target) / dt
        : (centre - this.centre) / dt;
    if (this.held === 2) {
      const jl = tank.spec.suspension.joltLimit;
      const jolt = Math.max(-jl, Math.min(jl, rise - this.rise));
      this.owed += tank.crashCost(jolt);
    }
    this.store(time, feet, centre, target, rise);
    this.held = 2;
  }

  private store(time: number, feet: number, centre: number, target: number, rise: number): void {
    this.time = time;
    this.feet = feet;
    this.centre = centre;
    this.target = target;
    this.rise = rise;
  }
}
