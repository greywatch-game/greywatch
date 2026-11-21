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
 * (`DriveCommand.time`) — **and on the authority that is the BOUNDED one**,
 * `Match`'s per-peer clock held to within `STAMP_SLACK` of when the reports
 * arrived, never a raw client stamp (see "The clock" below). A series the
 * authority BROKE with a correction is rebased rather than measured across
 * (`DriveCommand.resync`, "A broken series" below).
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
 *
 * ## The clock
 *
 * A rate is a height over an interval, so whoever owns the interval owns the
 * charge: a reporter that could stretch its stamps would measure every
 * descent over a second and land free, and one that could crowd two stamps a
 * millisecond apart would pin the next jolt at `joltLimit` — 910 points, a
 * helicopter and its gunner, on demand. So on the authority `time` is never a
 * raw `DriveMessage.time`: `Match` bounds each peer's stamps against the
 * clock their messages ARRIVE on (`Match.onStamp`, `STAMP_SLACK`), so a
 * stretched stamp is spent at the arrival rate once its slack is used, and
 * an honest client's stamps — which never drift from their arrivals by more
 * than the network's jitter — pass through to the bit. And no interval under
 * `gap` (`SimCoreOptions.reportGap`, half an upload interval on the authority)
 * is a rate at all: the sample is skipped and the next measured from the one
 * before, so a crowded stamp measures nothing. What stays the reporter's is
 * the TRAJECTORY — see `docs/multiplayer.md`, "What is NOT defended against".
 *
 * ## A broken series
 *
 * A `hullcorrect` that moves the hull vertically puts the client's machine
 * back where the authority holds it, and `Vehicle.correctTo` stops its
 * vertical motion there. The first report after that (`resync`) is measured
 * across the correction's jump and the stop it made — a descent at 8 m/s
 * followed by a sample that has not moved reads as a landing in mid-air, up
 * to ~130 points of the authority's own doing. So a resync sample is a
 * REBASE, not a rate. **And the break is not a pass**: a client that provokes
 * a refusal on the sample before touchdown must not land free, so the descent
 * rate the break cut is CARRIED to the first rate after it, and if that rate
 * stands on its plank — a touchdown — it is charged against the carried rate
 * as the landing it is. In the air the carried rate is dropped and the series
 * starts again, which is what an honest client, stopped by the correction,
 * then reports. `Match` honours a `resync` only while a correction that moved
 * the hull vertically is unanswered, so the break is the authority's to grant
 * and a client cannot rebase at will.
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
  /**
   * The shortest interval that is a rate, seconds — `MIN_INTERVAL` offline,
   * where every step is a sample, and `SimCoreOptions.reportGap` on the
   * authority (see "The clock").
   */
  private readonly gap: number;
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
   * The descent rate a break cut, m/s (<= 0), owed to the first rate after it
   * if that rate is a touchdown — NaN when nothing is carried. See "A broken
   * series".
   */
  private carried = NaN;

  constructor(gap = MIN_INTERVAL) {
    this.gap = gap;
  }

  /**
   * A new pilot: no history, so nothing is measured across the change of
   * hands. What the last one's reports already ran up is still OWED — the
   * step spends it on the hull whoever is in it now.
   */
  reset(): void {
    this.held = 0;
    this.carried = NaN;
  }

  /**
   * One ACCEPTED report of `tank` — its feet at `x, feet, z`, heading `yaw`,
   * at the reporter's clock `time` (seconds). Adds to `owed` what the arrival
   * it describes costs. Asked only of a hull that flies and is alive.
   *
   * `resync` is the authority's word that this is the first report since a
   * correction put the machine back (`DriveCommand.resync`): a rebase, the
   * rate before it carried — see "A broken series".
   */
  sample(
    tank: Vehicle,
    x: number,
    feet: number,
    z: number,
    yaw: number,
    time: number,
    resync = false,
  ): void {
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
    // A rebase, ahead of the interval test: a break must land whatever the
    // clock says, or a resync crowded onto the last sample would be skipped
    // and the next report measured across the very jump it marks. The rate
    // the break cut is kept unless one is already carried — a second break
    // before any rate after the first must not trade the real descent for
    // nothing.
    if (resync) {
      if (this.held === 2 && Number.isNaN(this.carried)) this.carried = Math.min(0, this.rise);
      this.store(time, feet, centre, target, 0);
      this.held = 1;
      return;
    }
    const dt = time - this.time;
    if (!(dt >= this.gap)) return;
    const standing = Math.abs(centre - target) <= REST;
    const rise = standing ? (target - this.target) / dt : (centre - this.centre) / dt;
    const jl = tank.spec.suspension.joltLimit;
    if (this.held === 2) {
      const jolt = Math.max(-jl, Math.min(jl, rise - this.rise));
      this.owed += tank.crashCost(jolt);
    } else if (!Number.isNaN(this.carried)) {
      // The first rate after a break: a TOUCHDOWN is charged against the
      // descent the break cut, and anything in the air starts the series
      // afresh — which is all an honest client the correction stopped can
      // report.
      if (standing) {
        this.owed += tank.crashCost(Math.max(-jl, Math.min(jl, rise - this.carried)));
      }
      this.carried = NaN;
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
