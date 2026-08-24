/**
 * AimAssistSystem.ts — Aim assist for the two devices that need it, the pad and
 * the glass: an outer bubble that slows the input over a target and an inner
 * one that rotates the camera, the rotation being mostly ADHESION (matching the
 * target's angular velocity) rather than magnetism (pulling toward its centre).
 * Invariants: NEVER affects mouse/keyboard — it disengages the moment the
 * mouse moves and leaves mouse sensitivity untouched. A THUMB gets it for the
 * same reason a stick does and no other: it is a coarse pointing device with no
 * wrist behind it, and every shipped mobile shooter has this. What makes that
 * safe is that the three invariants below are written in terms of the player's
 * OWN input, so they hold for a drag as soon as a drag can be expressed in
 * them — `CONFIG.touch.swipeReference` is the full deflection a swipe does not
 * have, and `CONFIG.touch.cancelDrag` is the committed push. Its rotation is capped
 * at a fraction of the player's OWN full-stick turn rate, is gated on the
 * player actually driving, and is cancelled by opposing stick deflection — so
 * a committed push always wins. LOS ray filters OPAQUE_ONLY (walls block
 * assist; a fence the round would pass through does not). Called by Game before CameraSystem.update.
 */
import { Ray, Scene, Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { InputManager } from "../core/InputManager";
import { OPAQUE_ONLY } from "../world/solid";

/**
 * Structural subset of `Hittable` (CombatSystem), declared here so this
 * system doesn't import another system. Anything hitscan can target works.
 */
export interface AimTarget {
  readonly center: Vector3;
  readonly invulnerable?: boolean;
}

/** One frame of aim assist, consumed by `CameraSystem.update`. */
export interface AssistFrame {
  /** Multiplier applied to the stick look terms only — never the mouse. */
  stickMult: number;
  /** Camera rotation to add this frame (radians, already dt-scaled). */
  yaw: number;
  pitch: number;
}

/**
 * Gamepad aim assist, in the console-shooter lineage: target friction plus a
 * rotational term. See `CONFIG.aimAssist` for what each number means and for
 * the three invariants that keep it from reading as auto-aim.
 *
 * The rotation is two terms with very different jobs:
 *
 * - **Tracking (adhesion)** follows motion. Each frame the target's direction
 *   from the eye has moved by some angle; the assist gives back a share of
 *   it, so a strafing enemy drags the reticle along instead of sliding out
 *   from under it. It is a *delta*, not a rate, so it is frame rate
 *   independent by construction and needs no dt. Crucially it is zero
 *   against a stationary target — it can help you hold an aim, never take
 *   one.
 * - **Magnetism** recovers error. A pull toward the target's centre,
 *   strongest at the rim of the inner bubble and zero inside
 *   `magnetDeadzone` of it, so it closes a near miss onto the body and lets
 *   go.
 *
 * They divide the work by where the reticle is rather than by size: near the
 * centre tracking is all there is, and near the rim magnetism is deliberately
 * the larger of the two, because that is the term whose job is to get back.
 * Measured against a bot strafing at 4 m/s across 15 m with the trigger held,
 * the pair settles ~0.035 rad off its centre and holds there — the reticle
 * stays with the target, roughly two body-widths behind the middle of it. The
 * assist keeps you in the fight; the last correction is still the player's.
 *
 * Tracking is split by cause — the target moving versus the player strafing
 * around it — because compensating the player's own motion is the half that
 * feels like the game is playing for you, so it is scaled down separately
 * (`selfMotionMult`).
 *
 * Keyboard/mouse is unaffected by construction: the whole system returns null
 * unless a gamepad is connected AND the pad produced the most recent input
 * activity, so a single mouse movement disengages it the same frame — and
 * even while engaged, the slowdown is only ever multiplied into the stick
 * terms of the camera update.
 *
 * Costs at most one ray pick per frame: candidates are filtered by angle
 * first, and only the winner is tested against `solid` colliders — the same
 * pick hitscan uses, so the assist never pulls through a wall.
 */
export class AimAssistSystem {
  /** The device that produced the most recent look input. */
  private lastDevice: "mouse" | "stick" | "touch" = "mouse";

  /** The target being assisted, held across frames for hysteresis. */
  private held: AimTarget | null = null;
  /** Engage ramp, 0..1 — scales everything the assist does. */
  private engage = 0;
  /** Last frame's slowdown depth, so a lost target eases out of it. */
  private depth = 0;

  /**
   * Last frame's target centre and eye position, for the angular-velocity
   * term. Invalid whenever the held target changed or was missing, in which
   * case tracking sits out a frame rather than differencing two unrelated
   * positions.
   */
  private prevCenter = new Vector3();
  private prevOrigin = new Vector3();
  private haveHistory = false;

  /** Scratch for the line-of-sight cast — no per-frame allocation. */
  private readonly losRay = new Ray(new Vector3(), new Vector3(0, 0, 1), 1);
  private readonly losDir = new Vector3();

  constructor(private scene: Scene) {}

  /**
   * Computes this frame's assist, or null when inactive. Call immediately
   * before `CameraSystem.update`, with the camera's current pose.
   *
   * `origin` is the player's EYE, not the rendered camera: the tracking term
   * differences the target's direction across frames, and the camera's bob
   * and landing dip would arrive in that difference as several centimetres of
   * per-frame jitter — a shake, at bob frequency, on an otherwise smooth
   * track. The two are centimetres apart, which is nothing to a cone test or
   * a line-of-sight ray over metres.
   *
   * `lookRate` is the yaw rate a full stick deflection currently produces
   * (`CameraSystem.stickYawRate`), carrying the fitted optic's multiplier.
   * Both rotation terms are bounded as fractions of it, which is what makes
   * "the player always out-turns the assist" true at every magnification
   * instead of true at the one it was tuned against.
   *
   * `targets` is the shooter's enemy list (the same one hitscan fires at);
   * it is read synchronously and never retained, so a reused scratch array
   * is safe to pass.
   */
  update(
    dt: number,
    input: InputManager,
    origin: Vector3,
    forward: Vector3,
    aimYaw: number,
    aimPitch: number,
    lookRate: number,
    targets: readonly AimTarget[],
  ): AssistFrame | null {
    // Device arbitration. Any mouse movement disengages instantly; any real
    // pad activity (stick past the deadzone, or any pad button — e.g. holding
    // LT to ADS) claims it back, and so does a phone in the player's hands. An
    // idle pad next to a mouse player engages nothing, and with neither a pad
    // nor a touch device there is no assist at all.
    //
    // Touch is asked FIRST because it is the only one of the three that is
    // sticky: `touchActive` says which device the player is holding, not what
    // it did this frame, so a thumb resting between bursts still owns the
    // assist — where a resting stick has to keep proving it is there, next to a
    // mouse that might be the real input.
    if (input.touchActive) {
      this.lastDevice = "touch";
    } else if (input.mouseLookX !== 0 || input.mouseLookY !== 0) {
      this.lastDevice = "mouse";
    } else if (input.padActive) {
      this.lastDevice = "stick";
    }
    const engaged =
      (this.lastDevice === "stick" && input.gamepadConnected) ||
      (this.lastDevice === "touch" && input.touchActive);
    if (!engaged) {
      this.clear();
      return null;
    }

    const a = CONFIG.aimAssist;

    // --- acquire: the live enemy nearest the crosshair, inside its own
    // slowdown bubble. The bubble is a sphere around the target, so its
    // half-angle shrinks with distance instead of fanning out. ---
    let best: AimTarget | null = null;
    let bestScore = Infinity;
    let bestAngle = 0;
    let bestDist = 0;
    for (const t of targets) {
      if (t.invulnerable) continue;
      const to = t.center.subtract(origin);
      const distSq = to.lengthSquared();
      if (distSq > a.maxDistance * a.maxDistance || distSq < 0.25) continue;
      const dist = Math.sqrt(distSq);
      const dot = clamp(Vector3.Dot(forward, to.scale(1 / dist)), -1, 1);
      const angle = Math.acos(dot);
      if (angle > bubbleAngle(a.slowdownRadius, dist)) continue;
      // Hysteresis: the held target is worth a small angular head start, so
      // two overlapping enemies don't trade the assist frame by frame — a
      // swap costs the engage ramp and the tracking history both.
      const score = t === this.held ? angle - a.holdBias : angle;
      if (score < bestScore) {
        best = t;
        bestScore = score;
        bestAngle = angle;
        bestDist = dist;
      }
    }

    // --- LOS: the same solid-collider pick hitscan uses, so walls win ---
    if (best) {
      // Ray and direction both reused. Every peer that casts per frame —
      // `DeathCam`, `GrenadeSystem`, `BattleSystem` — keeps a scratch `Ray` for
      // this; this one was minting a Ray, two Vector3s and a predicate closure
      // on every frame a pad player held a target.
      best.center.subtractToRef(origin, this.losDir);
      this.losDir.scaleInPlace(1 / bestDist);
      this.losRay.origin.copyFrom(origin);
      this.losRay.direction.copyFrom(this.losDir);
      this.losRay.length = bestDist;
      const wall = this.scene.pickWithRay(this.losRay, OPAQUE_ONLY);
      if (wall && wall.hit) best = null;
    }

    // --- ramps. Losing the target decays the engagement rather than
    // dropping it, so the slowdown eases off and a re-acquire inside the
    // release window resumes instead of restarting. ---
    if (!best) {
      this.haveHistory = false;
      this.engage = Math.max(0, this.engage - dt / a.releaseTime);
      if (this.engage === 0) this.held = null;
      return this.engage > 0 ? { stickMult: this.slow(), yaw: 0, pitch: 0 } : null;
    }
    if (best !== this.held) {
      this.held = best;
      this.haveHistory = false;
      this.engage = 0;
    }
    this.engage = Math.min(1, this.engage + dt / a.engageTime);

    // --- friction: full at the centre of the bubble, gone at its rim. A
    // gradient, so there is no sensitivity step to feel at the boundary. ---
    this.depth = 1 - smoothstep01(bestAngle / bubbleAngle(a.slowdownRadius, bestDist));
    const stickMult = this.slow();

    // --- rotation. Gated three ways: it happens only inside the tighter
    // inner bubble, only while the player is driving (stick past the
    // threshold, or the trigger held), and it fades out with distance. ---
    const rotAngle = bubbleAngle(a.rotateRadius, bestDist);
    // This frame's drag, in the units a stick deflection is in: a full
    // committed push is `CONFIG.touch.cancelDrag` pixels. Expressing it this
    // way is what lets the two gates below stay one expression each rather
    // than forking per device — and it is zero on a pad, where the fields are.
    const dragX = clamp(input.touchLookX / CONFIG.touch.cancelDrag, -1, 1);
    const dragY = clamp(input.touchLookY / CONFIG.touch.cancelDrag, -1, 1);
    const drive = Math.max(
      input.fire ? 1 : 0,
      smoothstep01(
        (Math.max(
          Math.hypot(input.stickLookX, input.stickLookY),
          Math.hypot(input.moveX, input.moveY),
          Math.hypot(dragX, dragY),
        ) -
          a.stickThreshold) /
          a.stickThreshold,
      ),
    );
    const falloff =
      1 -
      smoothstep01(
        (bestDist - a.rotateFullRange) / (a.maxDistance - a.rotateFullRange),
      );
    const gain = bestAngle <= rotAngle ? this.engage * drive * falloff : 0;

    let yaw = 0;
    let pitch = 0;
    if (gain > 0) {
      // Tracking (adhesion). The target's direction has moved since last
      // frame; hand back a share of that movement. Splitting it by cause is
      // three angle solves rather than two: hold the eye still to isolate
      // what the TARGET did, then hold the target still to isolate what the
      // PLAYER did. To first order the two sum to the whole delta.
      if (this.haveHistory) {
        const wasYaw = dirYaw(this.prevCenter, this.prevOrigin);
        const wasPitch = dirPitch(this.prevCenter, this.prevOrigin);
        const tgtYaw = wrapPi(dirYaw(best.center, this.prevOrigin) - wasYaw);
        const tgtPitch = dirPitch(best.center, this.prevOrigin) - wasPitch;
        const selfYaw = wrapPi(dirYaw(this.prevCenter, origin) - wasYaw);
        const selfPitch = dirPitch(this.prevCenter, origin) - wasPitch;
        const f = input.ads ? a.trackAds : a.trackHip;
        yaw = f * (tgtYaw + a.selfMotionMult * selfYaw);
        pitch = f * (tgtPitch + a.selfMotionMult * selfPitch);
      }

      // Magnetism: strongest at the rim of the inner bubble, zero inside the
      // deadzone. It walks a near miss onto the body and stops there — it can
      // never seat the reticle on the centre.
      const t = clamp(
        (bestAngle / rotAngle - a.magnetDeadzone) / (1 - a.magnetDeadzone),
        0,
        1,
      );
      const pull =
        (input.ads ? a.magnetAds : a.magnetHip) *
        lookRate *
        smoothstep01(t) *
        dt;
      const dir = best.center.subtract(origin).normalize();
      yaw += clamp(wrapPi(Math.atan2(dir.x, dir.z) - aimYaw), -pull, pull);
      pitch += clamp(Math.asin(clamp(dir.y, -1, 1)) - aimPitch, -pull, pull);

      pitch *= a.verticalMult;
      yaw *= gain;
      pitch *= gain;

      // Invariant 1: the assist can never out-turn the player. The cap is a
      // fraction of the rate a full stick produces THROUGH THE FITTED OPTIC,
      // so a 3.5x scope's slower look slows the assist with it.
      const cap = a.maxRateFraction * lookRate * dt;
      yaw = clamp(yaw, -cap, cap);
      pitch = clamp(pitch, -cap, cap);

      // Invariant 3: input AGAINST the rotation cancels it in proportion —
      // full deflection away means none at all, so a committed push always
      // walks the crosshair out of the bubble and drops the target, while a
      // resting stick keeps the track. (Signs match CameraSystem for both
      // devices: +lookX turns +yaw, +lookY turns -pitch.)
      yaw *= 1 - clamp(-Math.sign(yaw) * (input.stickLookX + dragX), 0, 1);
      pitch *= 1 - clamp(Math.sign(pitch) * (input.stickLookY + dragY), 0, 1);
    }

    this.prevCenter.copyFrom(best.center);
    this.prevOrigin.copyFrom(origin);
    this.haveHistory = true;
    return { stickMult, yaw, pitch };
  }

  /** The stick multiplier for the current engagement and bubble depth. */
  private slow(): number {
    return 1 - this.engage * this.depth * (1 - CONFIG.aimAssist.slowdownMult);
  }

  /** Drops everything held across frames — used when the mouse takes over. */
  private clear(): void {
    this.held = null;
    this.engage = 0;
    this.depth = 0;
    this.haveHistory = false;
  }
}

/**
 * Half-angle subtended by a sphere of `radius` at `dist`, capped so a target
 * at arm's length cannot own a third of the screen. The cap is stated for the
 * outer bubble and scaled by radius, so the inner one stays strictly inside it
 * at every distance — a flat cap on both makes them identical inside ~4 m,
 * which silently turns the whole slowdown bubble into a rotation bubble at
 * exactly the range where rotation is strongest.
 */
function bubbleAngle(radius: number, dist: number): number {
  const a = CONFIG.aimAssist;
  return Math.min(
    Math.atan(radius / dist),
    (a.maxAngle * radius) / a.slowdownRadius,
  );
}

function dirYaw(to: Vector3, from: Vector3): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

function dirPitch(to: Vector3, from: Vector3): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  return Math.atan2(dy, Math.hypot(dx, dz));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Hermite ease over [0,1], clamped — the shape every ramp here uses. */
function smoothstep01(x: number): number {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

/** Wraps an angle to [-PI, PI] so the pull takes the short way around. */
function wrapPi(v: number): number {
  return Math.atan2(Math.sin(v), Math.cos(v));
}
