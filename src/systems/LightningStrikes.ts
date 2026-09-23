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
 * - A clock that goes BACKWARDS (a reconnect, a new round's anchor) rewinds
 *   the schedule to the start rather than skipping forward — the sequence is
 *   replayed from its seed and lands where the clock says.
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
/** Past this after its last pulse a strike has nothing left to give. */
const TAIL = 0.4;

export class LightningStrikes {
  private spec: LightningSpec | null = null;
  private seed = 1;
  private rand: () => number = mulberry32(1);
  /** The strike being played or next to play, and the one after it. */
  private current: Strike | null = null;
  private clock = -Infinity;
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
    this.restart();
    this.flash = 0;
    this.active = false;
  }

  private restart(): void {
    this.rand = mulberry32(this.seed);
    this.current = this.spec ? this.next(0) : null;
  }

  /** The strike after one ending at `after`. */
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
    if (!this.spec || !this.current) {
      this.flash = 0;
      this.active = false;
      return;
    }
    if (now < this.clock) this.restart();
    this.clock = now;
    let strike = this.current;
    // Catch up past every strike already over — a clock that jumped forward
    // by minutes replays no flashes, it only advances the sequence.
    for (;;) {
      const end = strike.at + strike.pulses[strike.pulses.length - 1].t + TAIL;
      if (now < end) break;
      strike = this.next(strike.at);
      this.current = strike;
    }
    const since = now - strike.at;
    if (since < 0) {
      this.flash = 0;
      this.active = false;
      return;
    }
    if (!this.active) {
      this.active = true;
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
