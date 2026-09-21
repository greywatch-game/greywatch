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
 *
 * **…and on the WEAPON the same nonlinearity is a bug, which is what `cap`
 * is for.** A string outrunning the shooter's correction is the right account
 * of an AIM, which is a rotation with nowhere it has to stop. The thing in the
 * hands is travelling straight back into a shoulder that is already against
 * it, and under the same rule it walks into the eye: measured on the shipped
 * constants a submachine gun's held trigger reached 3.0x one round's travel
 * — 13.3 cm of receiver toward the eye, with the muzzle flip riding the same
 * number through 23 degrees — and the residual it started each round from
 * climbed monotonically for the whole magazine. The shoulder is a WALL rather
 * than a stronger haul, and it has to be, because the haul is gated on a
 * reaction that every round restarts: at an automatic's rate it is barely
 * running at the moment it is most needed.
 */
import { smoothstep } from "./math";


/**
 * The numbers a recoil response is made of: the arrest, the haul and the
 * reaction between them, then the three bounds — the ease at the bottom of the
 * travel, the lean past `reach`, and the wall at `cap`.
 */
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
  /**
   * Above this displacement the haul LEANS IN — its rate multiplied by how
   * many `reach`es off the muzzle is — but only once the shooter is IN a
   * string: a strike has to ask for it (`RecoilAxis.strike`'s `lean`), and it
   * lets go by itself when the muzzle comes back inside `reach`, where the
   * load is exactly 1 so the let-go is not a step in the velocity. A single
   * round, a tap and a flinch never ask, so every one of them is the straight
   * descent the rest of this file argues for, to the number.
   *
   * **Without it a held trigger has no equilibrium, and that is not a detail.**
   * A pure rate nets `kick - haul * (time the haul ran)` per cycle, and that
   * sum does not depend on where the muzzle already is: a string whose kick
   * beats it climbs without bound, and one whose kick loses to it SINKS for
   * the rest of the magazine while the trigger is still held — the SMG's aim
   * came down 0.8 deg through a held string, which a player reads as recoil
   * going the wrong way. A shooter pulls harder the further off they are, so
   * the haul grows with the displacement and every string finds a level where
   * the round's kick and the haul balance: a PLATEAU, for every weapon at
   * every fire rate, rather than one that holds for one weapon by tuning
   * coincidence. The reference footage shows exactly that: the recovery each
   * cycle is nothing at the start of a string and a quarter of a degree once it
   * has climbed. Pass `Infinity` to switch it off.
   */
  reach: number;
  /**
   * The furthest the displacement may get, whatever is still arriving — a HARD
   * STOP, and the one term here that is not a force.
   *
   * **It is the SHOULDER, and only a thing with a shoulder behind it has
   * one.** The rest of this model is a rotation being arrested and hauled, and
   * a rotation has nowhere it must stop: the aim passes `Infinity` and keeps
   * the ceilings it already has (`recoil.maxPitch`/`maxYaw`) for what a
   * crossfire's flinches could stack to. The weapon on screen is a different
   * object — it is travelling STRAIGHT BACK into a shoulder that is already
   * against it — and what it needs is not a stronger haul but a wall.
   *
   * **Why a wall rather than a bigger `reach`:** the reaction restarts on
   * every round (`age`), so through a held trigger at an automatic's rate the
   * haul barely runs at all, and a lean that is gated on the haul is a lean
   * that is gated off exactly when it is needed. Measured on the shipped
   * constants, a submachine gun's held trigger drove the weapon to 3.0x one
   * round's travel and an earlier, smoother pair was measured past 5x — 13.3
   * cm of receiver toward the eye at the first of those, and the muzzle flip
   * that rides the same number through 23 degrees. A cap costs one compare
   * and cannot be out-run.
   *
   * The velocity still arriving is dropped with it, or the weapon would stay
   * pinned for as long as the charge behind it took to decay and then let go
   * late. Below the cap nothing about the response changes, so a single round,
   * a tap and every weapon that does not stack are the model to the number.
   */
  cap: number;
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
   * Whether the haul is leaning in (`RecoilShape.reach`). Raised by a strike
   * that asks for it and dropped by `step` once the displacement is back
   * inside `reach`.
   */
  private leaning = false;

  /**
   * A shot. `peak` is the displacement this round is worth at the top of its
   * travel and `gain` is `recoilGain` for the shape it will be stepped on —
   * kept apart so a caller may state a kick in the units its table uses.
   * `lean` says the shooter is in a string and hauls against it harder the
   * further off it gets — see `RecoilShape.reach`.
   */
  strike(peak: number, gain: number, lean = false): void {
    this.vel += peak * gain;
    this.age = 0;
    if (lean) this.leaning = true;
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
        const rate = s.haul * ramp * eased;
        // Above `reach`, in a string, the haul leans in — a rate proportional
        // to the displacement, which is an exponential and is taken in closed
        // form, so where a held string settles cannot depend on the frame
        // rate. A frame that crosses `reach` spends the rest of itself on the
        // line, and the lean lets go there, at a load of exactly 1.
        let left = dt;
        let next = mag;
        if (this.leaning && next > s.reach) {
          const k = rate / s.reach;
          const after = next * Math.exp(-k * left);
          if (after >= s.reach) {
            next = after;
            left = 0;
          } else {
            left -= Math.log(next / s.reach) / k;
            next = s.reach;
          }
        }
        if (left > 0) next = Math.max(0, next - rate * left);
        if (next <= s.reach) this.leaning = false;
        this.value = this.value < 0 ? -next : next;
      }
    }
    // …and the shoulder, which is a wall and not a force. See `cap`: it is the
    // weapon on screen's and the aim passes `Infinity`, so this is one compare
    // on an axis that does not have one. The velocity goes with the
    // displacement, or the charge still arriving holds the weapon against the
    // stop after the string has stopped feeding it.
    if (this.value > s.cap) {
      this.value = s.cap;
      if (this.vel > 0) this.vel = 0;
    } else if (this.value < -s.cap) {
      this.value = -s.cap;
      if (this.vel < 0) this.vel = 0;
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
    this.leaning = false;
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
