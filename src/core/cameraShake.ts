/**
 * cameraShake.ts — the concussion rattle, written once for both cameras.
 * Owns: `CameraShake`, a decaying envelope over smooth noise that yields three
 * angles (pitch, yaw, roll) for a camera to add to the picture it renders.
 * Invariants: COSMETIC. The angles are for the rendered view only — a caller
 * that adds them to an aim, a turret order or anything a round reads has made
 * the reticle lie. The envelope is the view punch's two poles, solved over the
 * whole step, so the shake's size does not change with the frame rate; the
 * noise is a pure function of the shake's own clock, so there is nothing in it
 * to integrate or drift.
 * Must never: hold a camera, import a system, or restart on a new event — an
 * event ADDS to the drive, so a blast landing in the tail of another one
 * swells it rather than cutting it to the start of a fresh one (the rule
 * `CameraSystem.punchDrive` documents from the gun's side).
 *
 * Two instances exist — `CameraSystem`'s for a body on foot and
 * `VehicleCamera`'s for a seat in a hull — because exactly one of those two
 * cameras runs on any frame, and a shake raised on the one that is not running
 * is a shake deferred until the player next changes places. Game's `shakeFrom`
 * picks the live one.
 */
import { CONFIG } from "../config";

/** Two partials per axis, as ratios of `shake.frequency`, and their phases. */
const PARTIALS = {
  pitch: [1.0, 1.73, 0.3, 2.1],
  yaw: [0.83, 1.41, 1.7, 0.4],
  roll: [0.67, 1.19, 2.6, 4.2],
} as const;
/** The second partial's weight, and the sum's normaliser. */
const SECOND = 0.5;
const NORM = 1 / (1 + SECOND);

function noise(p: readonly number[], w: number): number {
  return (Math.sin(w * p[0] + p[2]) + SECOND * Math.sin(w * p[1] + p[3])) * NORM;
}

export class CameraShake {
  /** This frame's offsets (rad). Zero whenever the shake is at rest. */
  pitch = 0;
  yaw = 0;
  roll = 0;

  private drive = 0;
  private level = 0;
  /**
   * The noise's own clock. It advances only while shaking and is never reset,
   * so each event starts from wherever the last one left the pattern rather
   * than replaying the same rattle.
   */
  private clock = 0;

  /**
   * What one event's impulse must be worth so that the cascade peaks at the
   * amount it was asked for — `CameraSystem.punchGain`'s derivation, for the
   * same two poles.
   */
  private static readonly gain = (() => {
    const tr = CONFIG.camera.shake.rise;
    const tf = CONFIG.camera.shake.fall;
    const at = ((tr * tf) / (tf - tr)) * Math.log(tf / tr);
    const peak = (tf / (tf - tr)) * (Math.exp(-at / tf) - Math.exp(-at / tr));
    return 1 / peak;
  })();

  get active(): boolean {
    return this.drive !== 0 || this.level !== 0;
  }

  /** An event, worth `amount` at its peak with 1 a grenade at point blank. */
  add(amount: number): void {
    if (!(amount > 0)) return;
    const s = CONFIG.camera.shake;
    this.drive = Math.min(
      s.max * CameraShake.gain,
      this.drive + amount * CameraShake.gain,
    );
  }

  step(dt: number): void {
    if (!this.active) return;
    const s = CONFIG.camera.shake;
    const a = Math.exp(-dt / s.fall);
    const b = Math.exp(-dt / s.rise);
    this.level =
      this.level * b + this.drive * (s.fall / (s.fall - s.rise)) * (a - b);
    this.drive *= a;
    if (this.drive < 1e-4 && this.level < 1e-4) {
      this.reset();
      return;
    }
    this.clock += dt;
    const w = Math.PI * 2 * s.frequency * this.clock;
    const l = Math.min(s.max, this.level);
    this.pitch = noise(PARTIALS.pitch, w) * s.pitch * l;
    this.yaw = noise(PARTIALS.yaw, w) * s.yaw * l;
    this.roll = noise(PARTIALS.roll, w) * s.roll * l;
  }

  /** Stops it dead — a respawn, a seat taken — leaving the clock where it is. */
  reset(): void {
    this.drive = 0;
    this.level = 0;
    this.pitch = 0;
    this.yaw = 0;
    this.roll = 0;
  }
}
