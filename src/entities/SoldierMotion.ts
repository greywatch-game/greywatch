/**
 * SoldierMotion.ts — What a soldier body is DOING, turned into a pose.
 * Owns: one body's gait phase, its smoothed velocity in its own feet's frame,
 * the kick of its last round, its magazine change and how far its rifle is up,
 * and the `SoldierPose` all of that fills. Poses nothing itself —
 * `animateSoldier` does, from what this hands it.
 * Invariants: `Bot` and `NetSoldier` both own one and drive it through the SAME
 * three calls (`step`, `fire`, `reload`), off the same observables — ground
 * actually covered, a round leaving, a magazine going in — so a bot and a
 * person moving, shooting and reloading alike are drawn alike, and nothing on
 * screen says which slots are AI. Everything here is a function of distance or
 * of time since an event, or smoothed by an exact exponential, so a body looks
 * the same at 30 fps and 144.
 * Never: allocates per frame, or reads anything but what it is handed.
 */
import { REST_POSE, type SoldierPose } from "./SoldierModel";

/**
 * How long one STEP is, in metres, at a given speed — the replacement for the
 * old fixed `STRIDE`, and shared by both drivers for that constant's reason: a
 * bot and a person moving at the same speed must swing their legs at the same
 * rate, or the cadence is the tell.
 *
 * A step lengthens with speed but not in proportion to it — people run faster
 * mostly by stepping more often — so cadence rises too: ~1.7 steps a second at
 * a 1.5 m/s walk, ~3.1 at the 4.4 m/s a bot patrols at, ~3.6 at a 6.9 m/s
 * sprint. The old constant put one step every 2.8 m whatever the pace, which is
 * one and a half steps a second at a jog, and legs that could only have covered
 * a third of that ground skating under a body that did.
 *
 * Sideways steps are shorter (a sidestep cannot reach as far as a stride) and
 * so are backward ones.
 */
export function stepLength(speed: number, heading: number): number {
  const base = Math.min(2, Math.max(0.5, 0.55 + 0.2 * speed));
  const side = Math.abs(Math.sin(heading));
  const back = Math.max(0, -Math.cos(heading));
  return base * (1 - 0.3 * side) * (1 - 0.15 * back);
}

/**
 * Rates, per second, for the exact-exponential smoothing below. Art constants
 * rather than `CONFIG`, like every other number a pose is made of: they say how
 * a body reads, not how the fight plays.
 */
const VELOCITY_RATE = 10;
const READY_UP_RATE = 9;
const READY_DOWN_RATE = 1.6;
const CARRY_RATE = 7;
/** How fast a round's kick is taken back out of the body. */
const KICK_RATE = 13;
/**
 * How long after its last round a body keeps its rifle shouldered before it
 * comes down to low ready. Long enough that a burst-and-pause fight never
 * drops it, short enough that a patrol carries it low.
 */
const READY_HOLD = 3;
/** The speed band over which a run becomes a sprint carry — the player's sprint. */
const CARRY_FROM = 5.4;
const CARRY_TO = 6.3;

/** Frame-rate independent blend factor for a rate over `dt`. */
function ease(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export class SoldierMotion {
  /** The pose `fill` writes. One object per body, reused every frame. */
  readonly pose: SoldierPose = { ...REST_POSE };

  /** Seconds this body has been driven — the clock every event is stamped on. */
  private clock = 0;
  private phase = 0;
  /** Smoothed velocity in the FEET's frame, m/s: x right, z forward. */
  private vx = 0;
  private vz = 0;
  private heading = 0;
  /** The last burst: when its first round went, how many, how far apart. */
  private shotAt = -1e9;
  private shots = 0;
  private spacing = 0;
  private reloadAt = -1e9;
  private reloadFor = 1;
  private ready = 1;
  private carry = 0;

  /** Back to a body standing still with nothing in flight. Called on (re)spawn. */
  reset(): void {
    this.clock = 0;
    this.phase = 0;
    this.vx = 0;
    this.vz = 0;
    this.heading = 0;
    this.shotAt = -1e9;
    this.shots = 0;
    this.reloadAt = -1e9;
    this.ready = 1;
    this.carry = 0;
  }

  /** Metres per second over the ground, smoothed. */
  get speed(): number {
    return Math.hypot(this.vx, this.vz);
  }

  /** True while a magazine change is being drawn. */
  get reloading(): boolean {
    const t = this.clock - this.reloadAt;
    return t >= 0 && t < this.reloadFor;
  }

  /**
   * Advances the body by one frame: `dt` seconds, over which it moved `dx, dz`
   * metres on the ground with its feet pointing along `feetYaw`. Returns true
   * when a boot went down, which both drivers turn into a footstep.
   *
   * The gait is advanced by DISTANCE rather than by time, so a footfall is a
   * point on the cycle and never a timer: a body slowed to a walk steps more
   * slowly for free, and one that is stopped (or grinding on a wall) stops
   * stepping. The left boot's place along the line of travel is `sin(phase)`,
   * so it lands at pi/2 and the right at 3pi/2 — every pi, offset by pi/2.
   */
  step(dt: number, dx: number, dz: number, feetYaw: number): boolean {
    if (dt > 0) {
      this.clock += dt;
      // Into the feet's frame: z along where they point, x to their right.
      const s = Math.sin(feetYaw);
      const c = Math.cos(feetYaw);
      const k = ease(VELOCITY_RATE, dt);
      this.vx += ((dx * c - dz * s) / dt - this.vx) * k;
      this.vz += ((dx * s + dz * c) / dt - this.vz) * k;
      // Heading is held through a stop rather than snapping to forward, so a
      // body easing out of a strafe finishes it sideways.
      if (this.speed > 0.2) this.heading = Math.atan2(this.vx, this.vz);
    }
    const dist = Math.hypot(dx, dz);
    if (dist <= 0) return false;
    const was = Math.floor((this.phase - Math.PI / 2) / Math.PI);
    this.phase += (Math.PI * dist) / stepLength(this.speed, this.heading);
    return Math.floor((this.phase - Math.PI / 2) / Math.PI) !== was;
  }

  /**
   * A burst left the rifle: `rounds` of them, `spacing` seconds apart, the
   * first now. Offline that is one round at a time; a client is told a
   * snapshot interval's worth at once and lays them back out across it
   * exactly as it does their reports and tracers, so the kicks keep the rate.
   * A round fired cancels a magazine change, which is what it would take.
   */
  fire(rounds = 1, spacing = 0): void {
    this.shotAt = this.clock;
    this.shots = Math.max(1, rounds);
    this.spacing = Math.max(0, spacing);
    this.reloadAt = -1e9;
  }

  /** A magazine change starts now and takes `seconds`. */
  reload(seconds: number): void {
    this.reloadAt = this.clock;
    this.reloadFor = Math.max(0.3, seconds);
  }

  /**
   * Fills `pose` for this frame and returns it. `moving` is the driver's gait
   * weight; `aim`, `twist` and `crouch` are what they always were.
   *
   * `alert` raises the rifle to the shoulder before a round is fired and
   * keeps it out of a sprint carry, and only an offline bot passes it (it has
   * a target, or is searching for one). A client has nothing to read it
   * off, so over the wire a rifle comes up with the first round of a fight —
   * the same rule for a bot and a person, which is the invariant that matters.
   */
  fill(
    dt: number,
    moving: number,
    aim: number,
    twist: number,
    crouch: number,
    alert = false,
  ): SoldierPose {
    const p = this.pose;
    const speed = this.speed;
    const run = smooth(2.2, 6.2, speed);
    const step = stepLength(speed, this.heading);
    // The hip swing that covers a step with a planted boot: half the step
    // either side, over a leg of ~0.78 m, shortened at a run where the stance
    // is a smaller share of the cycle, and scaled down for a shuffle.
    const reach = Math.min(0.95, (step * (1 - 0.3 * run)) / 1.56);
    const shuffle = Math.min(1, Math.max(0.35, speed / 1.2));

    // Kick: the most recent round of the burst that has actually gone.
    let kick = 0;
    if (this.shots > 0) {
      const since = this.clock - this.shotAt;
      const i =
        this.spacing > 0
          ? Math.min(this.shots - 1, Math.max(0, Math.floor(since / this.spacing)))
          : 0;
      const t = since - i * this.spacing;
      if (t >= 0) kick = Math.exp(-t * KICK_RATE);
    }
    const lastRound = this.shotAt + (this.shots - 1) * this.spacing;
    const r = this.reloading ? (this.clock - this.reloadAt) / this.reloadFor : 0;

    // Up at the first sign of a fight, down slowly once it has gone quiet.
    const want = alert || this.clock - lastRound < READY_HOLD || r > 0 ? 1 : 0;
    this.ready += (want - this.ready) * ease(want > this.ready ? READY_UP_RATE : READY_DOWN_RATE, dt);

    p.phase = this.phase;
    p.moving = moving;
    p.run = run;
    p.stride = Math.min(0.62, Math.asin(reach)) * shuffle;
    p.heading = this.heading;
    p.aim = aim;
    p.twist = twist;
    p.crouch = crouch;
    p.ready = this.ready;
    // Nobody sprints through a reload, with rounds going or with somebody to
    // shoot at, and a crouch is not a sprint however fast the numbers say it
    // is. Eased, so a rifle brought up out of a carry is brought up rather
    // than teleported.
    const carry = alert || r > 0 || kick > 0.05 ? 0 : smooth(CARRY_FROM, CARRY_TO, speed) * (1 - crouch);
    this.carry += (carry - this.carry) * ease(CARRY_RATE, dt);
    p.carry = this.carry;
    p.kick = kick;
    p.reload = r;
    return p;
  }
}
