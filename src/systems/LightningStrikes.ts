/**
 * LightningStrikes.ts — when lightning strikes, from where, and how bright the
 * sky is at any instant: a SCHEDULE, read off a clock.
 * Owns the seeded strike sequence and the flash envelope; owns no light, no
 * shadow, no sound and no mesh — `Game` reads `flash`/`direction` and spends
 * them on the flash's own key and map, the sky and the volume, and hears
 * `onStrike` for the thunder.
 * Invariants:
 * - The schedule is a pure function of the map's seed and the CLOCK it is
 *   handed. Online that clock is the authority's (`Connection.now`), so every
 *   client in a match sees the same strike at the same instant and nothing
 *   crosses the wire; offline it is the game's own. Never `Math.random()`.
 * - The sequence is cut into EPOCHS, each seeded from the map's seed and its
 *   own index, so the schedule at any clock is found by seeding the epoch
 *   that clock is in — never by replaying from zero. Online the clock is
 *   epoch time in seconds (~1.8e9), and a replay from zero was fifty million
 *   strikes on the first frame of a match. A clock that jumps either way
 *   costs at most one epoch's strikes.
 * - Nothing here is scheduled on a timer. `update` is pushed from `tick` in
 *   every state, the ambience's rule: weather does not stop for a menu.
 * Contract: `docs/rendering.md` (lightning).
 */
import { Vector3 } from "@babylonjs/core";
import { mulberry32 } from "../world/rng";
import type { LightningSpec } from "../world/environment";

/** One strike: when, from where, how far, and its sub-flashes. */
interface Strike {
  at: number;
  /** Unit, the way the light TRAVELS — from the flash toward the ground. */
  dir: Vector3;
  distance: number;
  /** Each pulse's start (seconds after `at`) and peak, 0..1. */
  pulses: { t: number; peak: number }[];
}

/**
 * How long a pulse takes to die, in seconds. A real return stroke is tens of
 * milliseconds; this is stretched to three frames at 60 Hz so a flash is SEEN
 * rather than being one frame the eye may drop.
 */
const PULSE_DECAY = 0.055;

/**
 * The schedule's epoch, in seconds, at least: long against any interval, so
 * the catch-up inside one is a few dozen strikes, and short against a round.
 * `setSpec` stretches it for a map whose interval would not fit several.
 */
const EPOCH = 600;
/** Past this after its last pulse a strike has nothing left to give. */
const TAIL = 0.4;

export class LightningStrikes {
  private spec: LightningSpec | null = null;
  private seed = 1;
  private rand: () => number = mulberry32(1);
  /** The strike being played or next to play. */
  private current: Strike | null = null;
  /** The epoch `rand` was seeded for, and its length. */
  private epoch = 0;
  private epochLen = EPOCH;
  private clock = -Infinity;
  /** `at` of the strike `onStrike` was last raised for — a strike's identity. */
  private raisedAt = NaN;
  /** 0..~1.2: how bright the flash is right now. */
  flash = 0;
  /** Where the flash is coming from, while `flash > 0`. */
  readonly direction = new Vector3(0, -1, 0);
  /** Whether a strike is in progress; its map is drawn the frame this turns true. */
  active = false;
  /**
   * Raised once per strike, the frame it starts: its distance in metres, for
   * the thunder's delay. Wired by `Game`.
   */
  onStrike: (distance: number) => void = () => {};

  /** A map's weather, or none. The seed makes the schedule the map's own. */
  setSpec(spec: LightningSpec | null, seed: number): void {
    this.spec = spec;
    this.seed = seed;
    this.epochLen = spec ? Math.max(EPOCH, spec.interval[1] * 8) : EPOCH;
    this.current = null;
    this.clock = -Infinity;
    this.raisedAt = NaN;
    this.flash = 0;
    this.active = false;
  }

  /** Seeds epoch `e` and returns its first strike. */
  private enter(e: number): Strike {
    this.epoch = e;
    this.rand = mulberry32((this.seed ^ Math.imul(e | 0, 0x9e3779b1)) >>> 0);
    return this.next(e * this.epochLen);
  }

  /** Where the schedule stands at `now`: the epoch it is in, from its start. */
  private seek(now: number): Strike {
    const e = Math.floor(now / this.epochLen);
    // The epoch before, too, so a strike straddling the boundary still plays.
    return this.advance(this.enter(e - 1), now);
  }

  /** Steps past every strike already over at `now`, crossing epochs. */
  private advance(strike: Strike, now: number): Strike {
    for (;;) {
      const end = strike.at + strike.pulses[strike.pulses.length - 1].t + TAIL;
      if (now < end) return strike;
      strike = this.next(strike.at);
      // A strike past its epoch's end is not one: the next epoch's own
      // sequence owns that stretch, so every client seeks to the same one.
      if (strike.at >= (this.epoch + 1) * this.epochLen) {
        strike = this.enter(this.epoch + 1);
      }
    }
  }

  /** The strike after one starting at `after`. */
  private next(after: number): Strike {
    const s = this.spec!;
    const r = this.rand;
    const between = s.interval[0] + r() * (s.interval[1] - s.interval[0]);
    const bearing = r() * Math.PI * 2;
    const elev =
      ((s.elevation[0] + r() * (s.elevation[1] - s.elevation[0])) * Math.PI) / 180;
    // The light travels from the flash down toward the valley.
    const dir = new Vector3(
      -Math.cos(elev) * Math.cos(bearing),
      -Math.sin(elev),
      -Math.cos(elev) * Math.sin(bearing),
    ).normalize();
    const distance = s.distance[0] + r() * (s.distance[1] - s.distance[0]);
    // Two to four return strokes, the first the brightest more often than
    // not, spaced like the real thing: tens of milliseconds to a quarter
    // second apart, which is what makes a strike FLICKER rather than blink.
    const count = 2 + Math.floor(r() * 3);
    const pulses: { t: number; peak: number }[] = [];
    let t = 0;
    for (let i = 0; i < count; i++) {
      pulses.push({ t, peak: i === 0 ? 1 : 0.45 + r() * 0.55 });
      t += 0.06 + r() * 0.18;
    }
    return { at: after + between, dir, distance, pulses };
  }

  /** The flash at clock `now`, in seconds. */
  update(now: number): void {
    if (!this.spec) {
      this.flash = 0;
      this.active = false;
      return;
    }
    // A first read, or a clock that went back or leapt a whole epoch, SEEKS;
    // anything else steps on from where the last frame left the sequence.
    const seek =
      !this.current || now < this.clock || now - this.clock > this.epochLen;
    this.clock = now;
    const strike = seek ? this.seek(now) : this.advance(this.current!, now);
    this.current = strike;
    const since = now - strike.at;
    if (since < 0) {
      this.flash = 0;
      this.active = false;
      return;
    }
    this.active = true;
    if (strike.at !== this.raisedAt) {
      this.raisedAt = strike.at;
      this.direction.copyFrom(strike.dir);
      this.onStrike(strike.distance);
    }
    let f = 0;
    for (const p of strike.pulses) {
      const dt = since - p.t;
      if (dt < 0) continue;
      f = Math.max(f, p.peak * Math.exp(-dt / PULSE_DECAY));
    }
    this.flash = f * this.spec.intensity;
  }
}
