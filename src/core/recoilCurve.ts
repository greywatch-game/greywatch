/**
 * recoilCurve.ts — how a shot moves a thing, written once.
 * Owns: `RecoilShape`, `RecoilAxis` and `recoilGain` — the impulse response
 * the aim and the weapon on screen both run on.
 * Owns NO tunable and NO geometry: every number arrives as a `RecoilShape` the
 * caller assembles out of `CONFIG.recoil`. It imports nothing but `./math`,
 * which itself imports nothing, so the property that makes it safe to import
 * from both `core/` and `entities/` survives — an edge to it is an edge to a
 * leaf and never a path back to a system.
 *
 * ## Why a gun is not a spring
 *
 * Both recoils in this game used to be DAMPED SPRINGS given a velocity, and
 * that model is wrong in a way you can see. A damped spring is symmetric about
 * its peak, smooth in the first derivative everywhere, and returns because a
 * restoring force pulls it back — so the sight eases out of the top of its
 * travel on the same curve it eased into it, which reads as something being
 * ANIMATED rather than something being hit, and at any amplitude large enough
 * to feel it reads as rubber.
 *
 * **There is no restoring force on a rifle.** Nothing about a gun wants to be
 * where it started. What actually happens is three things, in order, and none
 * of them is a spring:
 *
 * 1. **The impulse.** The charge delivers essentially all of its momentum
 *    while the bullet is in the barrel and for a few milliseconds of gas jet
 *    after it — call it 2-5 ms, which at any frame rate is instant. The gun
 *    leaves that with an angular VELOCITY, not a displacement.
 * 2. **The grip arrests it.** The shooter's shoulder, cheek and support hand
 *    are what stop the rotation, and they do it over tens of milliseconds. The
 *    muzzle climbs fast and then FLATTENS OUT — and, left alone, stops there.
 *    A gun that is fired and then dropped does not come back down.
 * 3. **The shooter hauls it back.** The return is muscular and deliberate:
 *    the support hand pulls, the shoulder drives forward, and the shooter is
 *    re-acquiring. Muscle applies roughly constant force, so the return is a
 *    RATE — closer to a straight line in time than to an exponential — and it
 *    does not begin until the shooter has reacted to the gun having moved.
 *
 * The shape those three produce is the whole point: **a fast flattening rise,
 * a genuine CORNER where the arrest hands over to the haul, and a straight
 * descent.** The corner is the feature. It is where the motion changes CAUSE —
 * the gun stops going up because the grip stopped it, and starts coming down
 * because a person is pulling it — and a curve that is smooth through that
 * point is claiming the two are one motion, which is exactly the claim that
 * reads as fake.
 *
 * ## …but a corner in the POSITION is not a step in the VELOCITY
 *
 * The first cut of this switched the haul on at the handover, which put the
 * whole haul rate into the velocity in a single frame — an unbounded
 * acceleration, and one the eye reads as a dropped frame rather than as a
 * corner. `haulRamp` eases the haul in over a window CENTRED on the handover,
 * so the rate is at half strength exactly where the switch used to be: the
 * corner stays where it was and stays legible, and the acceleration through it
 * is finite. It is a smoothing of the CAUSE, not of the shape.
 *
 * **The other half of reading smooth is having enough frames to be resolved,
 * and that is a constraint the physics does not care about.** A 60 Hz display
 * samples every 16.7 ms; the first tuning of this put an aimed rifle's whole
 * excursion — up, corner, and back — inside 41 ms, which is two and a half
 * samples. Nothing that completes in two samples can read as motion, however
 * correct its curve: it reads as a strobe. The constants a caller passes are
 * therefore chosen against the FRAME as well as against the gun, and a change
 * here that shortens an excursion below ~5 frames has made it jerkier no
 * matter what it did to the arithmetic.
 *
 * ## The peak is linear in the impulse, and that is arranged rather than lucky
 *
 * `riseTurns` gives the rise a fixed number of grip time constants before the
 * haul begins. Set at 2.5-3 the rise is ~93% complete when the haul starts, so
 * the peak lands ON that handover for every impulse a weapon can produce, at
 * exactly `(v / grip) * (1 - exp(-riseTurns))`. That is what lets a caller go
 * on stating a kick in RADIANS OF PEAK (`recoilGain` inverts it) even though
 * the haul is a rate limit and the system is therefore not linear in general.
 *
 * **Where it stops being linear is a burst, and there the nonlinearity is the
 * behaviour you want.** Stack enough impulse and the residual velocity at the
 * handover still exceeds the haul rate, so the muzzle keeps climbing past it
 * and the peak arrives late and high: a string outruns the shooter's
 * correction. That is not a defect to be normalised away — it is why a held
 * trigger walks and a tap does not.
 */
import { smoothstep } from "./math";


/** The three numbers a recoil response is made of, plus its ease-out. */
export interface RecoilShape {
  /**
   * How fast the grip ARRESTS the rotation, in reciprocal seconds. The rise's
   * time constant is `1 / grip`, and the whole excursion is `v / grip` — so
   * this sets both how quick the attack is and, with the impulse, how far it
   * goes.
   */
  grip: number;
  /**
   * How fast the shooter HAULS it back, in units per second — a RATE, not a
   * proportion, because muscle applies force rather than obeying a spring
   * constant. It is what makes the descent straight and the corner at the top
   * sharp, and it means a bigger excursion takes proportionally longer to come
   * home rather than the same fraction of forever.
   */
  haul: number;
  /**
   * Grip time constants the rise is given before the haul starts — the
   * shooter's reaction, and the flat at the top of the travel.
   *
   * **It is stated in time constants rather than in seconds on purpose.** The
   * peak is only linear in the impulse while the rise is essentially over when
   * the haul begins, so this number and `grip` cannot drift apart; expressed
   * in seconds they could, and the failure would be a weapon whose kick
   * quietly stopped matching the table.
   */
  riseTurns: number;
  /**
   * How much of the handover the haul is eased in over, as a fraction of the
   * time to it — so `0.35` ramps from `0.65 t` to `1.35 t`, centred.
   *
   * **It smooths the ACCELERATION and deliberately not the shape.** Switching
   * the haul on puts its whole rate into the velocity in one frame, which is
   * an unbounded acceleration and reads as a dropped frame; centring the ramp
   * on the handover leaves the corner where it was, at half rate, and makes
   * the change through it finite. Set to 0 it is the hard switch again.
   */
  haulRamp: number;
  /**
   * Below this displacement the haul EASES rather than hauling at its rate.
   *
   * A pure rate limit stops dead at zero, and a hard stop at the bottom of the
   * travel reads as a clunk in exactly the way the corner at the TOP does not
   * — that corner is two causes handing over, this one would be an arrival
   * with nothing arriving. Inside the band the rate is scaled by how far is
   * left, which is a first-order ease at `haul / easeBand` per second.
   */
  easeBand: number;
}

/**
 * One axis of recoil: the displacement, the impulse still being delivered, and
 * the clock the shooter's reaction runs on.
 *
 * A mutable holder rather than a value type because it is stepped every frame
 * on at least three axes and nothing here may allocate per frame. `CameraSystem`
 * holds two (the aim's pitch and yaw) and `Player` holds one (the weapon on
 * screen); they run the same model on different constants, which is the reason
 * this file exists rather than the model being written twice.
 */
export class RecoilAxis {
  /** The displacement — what a reader adds to an angle or a pose. */
  value = 0;
  /** The impulse still being delivered, in units per second. */
  private vel = 0;
  /**
   * Seconds since the last impulse. The haul is gated on it, so **a round
   * arriving mid-recovery restarts the reaction** — which is most of why a
   * held trigger climbs where a tap does not, and needs no separate rule.
   */
  private age = 0;

  /**
   * A shot. `peak` is the displacement this round is worth at the top of its
   * travel and `gain` is `recoilGain` for the shape it will be stepped on —
   * kept apart so a caller may state a kick in the units its table uses.
   */
  strike(peak: number, gain: number): void {
    this.vel += peak * gain;
    this.age = 0;
  }

  /**
   * One frame. **Exact at any `dt` for the rise** — the arrest integrates in
   * closed form, so how high a burst climbs cannot depend on the frame rate,
   * which is the invariant every aim-side integrator in this game owes. The
   * haul is a rate and so is exact by construction.
   */
  step(dt: number, s: RecoilShape): void {
    if (this.value === 0 && this.vel === 0) return;
    this.age += dt;
    // The gun rotates and the grip stops it. There is no restoring term here
    // and there must not be one: left alone this settles at wherever it got
    // to, which is what a gun actually does.
    const e = Math.exp(-s.grip * dt);
    this.value += (this.vel * (1 - e)) / s.grip;
    this.vel *= e;
    // …and then the shooter brings it back, once they have reacted to it —
    // easing the force in about that moment rather than switching it on, so
    // the corner keeps its position and loses its infinite acceleration.
    const over = s.riseTurns / s.grip;
    const w = over * s.haulRamp;
    const ramp =
      w > 0 ? smoothstep(over - w, over + w, this.age) : this.age >= over ? 1 : 0;
    if (ramp > 0) {
      const mag = this.value < 0 ? -this.value : this.value;
      if (mag > 0) {
        const eased = s.easeBand > 0 ? Math.min(1, mag / s.easeBand) : 1;
        const step = Math.min(mag, s.haul * ramp * eased * dt);
        this.value += this.value < 0 ? step : -step;
      }
    }
    // Parked exactly. This is an additive offset on an aim and on a pose, and
    // a residue left running puts every sight picture in the game that far off
    // the axis the rounds fly down for the rest of the round.
    if (this.value < 1e-7 && this.value > -1e-7 && this.vel < 1e-5 && this.vel > -1e-5) {
      this.value = 0;
      this.vel = 0;
    }
  }

  /** Everything, including the reaction clock. Owed by a death and a swap. */
  reset(): void {
    this.value = 0;
    this.vel = 0;
    this.age = 0;
  }
}

/**
 * The velocity one unit of intended PEAK is worth on a given shape.
 *
 * Analytic, not fitted: the rise integrates to `v / grip` in total and is
 * `(1 - exp(-riseTurns))` of the way there when the haul takes over, and the
 * peak is at that handover. Inverting it is what lets `CONFIG.recoil`'s
 * `pitchPerShot` and the viewmodel's `kickBack` keep meaning radians and metres
 * at full kick rather than becoming numbers that have to be re-measured every
 * time a constant moves.
 *
 * `bleed` is anything else that is arriving over the same window and adds to
 * the peak — on the aim it is the permanent share being handed into the
 * player's own angle, which is a first-order lag rather than part of this
 * model. Pass 0 where nothing does.
 */
export function recoilGain(s: RecoilShape, bleed = 0): number {
  const reach = 1 - Math.exp(-s.riseTurns);
  return s.grip / (reach * (1 + bleed));
}
