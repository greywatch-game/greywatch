/**
 * GyroInput.ts — the phone's rotation as aim: the motion sensor, its
 * permission, and turning an angular velocity in the DEVICE's frame into a
 * yaw and a pitch of the VIEW.
 * Owns: the `devicemotion` listener (attached only while the setting wants
 * it), the iOS permission request and the gesture it has to wait for, the
 * gravity estimate, and the rotation accumulated since the last `consume()`.
 * Owns no setting and applies nothing: `Game.applySettings` turns it on and
 * off, `InputManager` polls it once a frame exactly as it polls the touch
 * layer, and `CameraSystem`/`VehicleCamera` decide whether and how much of it
 * turns the view.
 * Invariants: `consume()` is spend-on-read and called exactly once per frame
 * (`InputManager.update`). The status it reports is the truth about the sensor
 * and never the setting restated — "on" with nothing listening is the state a
 * player cannot debug. Nothing here is scheduled per frame and nothing is
 * allocated per event.
 *
 * WHY IT IS BUILT THE WAY IT IS.
 *
 * - **A RATE, integrated, never an orientation differenced.** `devicemotion`'s
 *   `rotationRate` is the gyroscope itself; `deviceorientation` is a fused
 *   attitude that re-anchors to the compass and snaps near its poles, which is
 *   a view that twitches on its own. The spec's unit is degrees a second, and
 *   Chrome has honoured it since 66 (it was radians before). Its three names
 *   are the device's X, Y and Z in that order — not the orientation event's
 *   Euler order, which is the mistake this file first shipped with.
 * - **The device's axes are not the screen's.** The sensor reports about the
 *   phone held upright (x right, y up, z out of the glass), and this game is
 *   played sideways in either direction. `screen.orientation.angle` rotates
 *   the two in-plane axes into the screen's right and up, which is what makes
 *   turning the phone turn the view the same way at 90 and at 270.
 * - **PLAYER SPACE** (GyroWiki's term, and its recommendation for anything
 *   held in two hands): yaw is the turn about the world's VERTICAL, taken from
 *   gravity, and pitch is the tilt about the screen's own horizontal. A phone
 *   is held tilted back, so the phone's own vertical axis is not the world's —
 *   yaw read off that axis alone ("local space") turns at the cosine of the
 *   grip angle and bleeds a roll into every turn. Projecting onto gravity
 *   fixes both; `CONFIG.touch.gyro.yawRelax` gives a wrist twist back what the
 *   projection takes from it.
 * - **Gravity's SIGN is not trusted.** `accelerationIncludingGravity` has
 *   pointed up on some browsers and down on others, and the spec's own examples
 *   disagree. What is certain is that the screen faces the PLAYER, never the
 *   floor, so the estimate is flipped until its up-and-out components are
 *   positive, which is true of every grip there is.
 * - **iOS asks permission, and only from a gesture.** `requestPermission`
 *   rejects outside one, and a setting stored "on" is re-applied at boot where
 *   there is no gesture at all. So a refusal to ask is not a refusal to allow:
 *   it waits for the next tap anywhere and asks then. A real "denied" is
 *   final for the page, and is reported as such rather than retried.
 */
import { CONFIG } from "../config";

/** What the sensor is actually doing, for the settings screen to say. */
export type GyroStatus =
  /** The setting is off; nothing is listening. */
  | "off"
  /** No motion API, or the page is not a secure context. */
  | "unsupported"
  /** iOS: waiting for a tap to ask. */
  | "permission"
  /** iOS: the player said no. */
  | "denied"
  /** Listening, and nothing has reported a rotation yet. */
  | "waiting"
  /** Listening, and nothing reported for `silenceAfter`: no gyroscope here. */
  | "absent"
  /** Rotations are arriving. */
  | "live";

/** One frame of gyro input: view rotation in radians, before any gain. */
export interface GyroFrame {
  /** Positive turns the view RIGHT (the camera's own yaw sign). */
  yaw: number;
  /** Positive turns the view UP. */
  pitch: number;
}

/** iOS 13+'s static, which the DOM lib does not declare. */
type PermissionedMotion = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

const DEG = Math.PI / 180;

export class GyroInput {
  /** Raised when `status` changes. `Game` hands it to the settings screen. */
  onStatus: (status: GyroStatus) => void = () => {};

  private statusNow: GyroStatus = "off";
  private wanted = false;
  private listening = false;
  /** A gesture listener is armed to ask iOS for permission. */
  private askArmed = false;

  /** View rotation since the last `consume()`, radians. */
  private yaw = 0;
  private pitch = 0;
  /** The previous event's timestamp, ms; negative before the first. */
  private lastStamp = -1;
  /** Gravity's UP direction in the SCREEN frame (right, up, out), unnormalised. */
  private gRight = 0;
  private gUp = 1;
  private gOut = 0;
  private haveGravity = false;
  private silenceTimer: number | undefined;

  /** Reused: `consume()` runs every frame. */
  private readonly frame: GyroFrame = { yaw: 0, pitch: 0 };

  get status(): GyroStatus {
    return this.statusNow;
  }

  /**
   * Turns listening on or off. Called from `Game.applySettings`, which a tap
   * or a key on the settings screen reaches synchronously — so the iOS prompt
   * can be asked from inside the gesture that turned the setting on.
   */
  setEnabled(on: boolean): void {
    if (on === this.wanted) return;
    this.wanted = on;
    if (!on) {
      this.detach();
      this.setStatus("off");
      return;
    }
    if (
      typeof window === "undefined" ||
      typeof DeviceMotionEvent === "undefined" ||
      !window.isSecureContext
    ) {
      this.setStatus("unsupported");
      return;
    }
    const motion = DeviceMotionEvent as PermissionedMotion;
    if (typeof motion.requestPermission === "function") this.ask();
    else this.attach();
  }

  /** The rotation since the last call, spent by reading it. */
  consume(): GyroFrame {
    this.frame.yaw = this.yaw;
    this.frame.pitch = this.pitch;
    this.yaw = 0;
    this.pitch = 0;
    return this.frame;
  }

  /** iOS: ask now, and if that is refused for want of a gesture, on the next one. */
  private ask(): void {
    const motion = DeviceMotionEvent as PermissionedMotion;
    let pending: Promise<"granted" | "denied">;
    try {
      pending = motion.requestPermission!();
    } catch {
      this.armAsk();
      return;
    }
    pending.then(
      (answer) => {
        if (!this.wanted) return;
        if (answer === "granted") this.attach();
        else this.setStatus("denied");
      },
      // Rejected rather than answered: no gesture, not a "no".
      () => {
        if (this.wanted) this.armAsk();
      },
    );
  }

  /**
   * Waits for the next gesture to ask from. `touchend` and `click` are both
   * activation-triggering events, which a `pointerdown` from a finger is not;
   * `keydown` covers a tablet with a keyboard. Capture phase, so the touch
   * layer's own handlers cannot hide it.
   */
  private armAsk(): void {
    this.setStatus("permission");
    if (this.askArmed) return;
    this.askArmed = true;
    for (const type of ["touchend", "click", "keydown"] as const) {
      window.addEventListener(type, this.onGesture, { capture: true });
    }
  }

  private onGesture = (): void => {
    this.disarmAsk();
    if (this.wanted && !this.listening) this.ask();
  };

  private disarmAsk(): void {
    if (!this.askArmed) return;
    this.askArmed = false;
    for (const type of ["touchend", "click", "keydown"] as const) {
      window.removeEventListener(type, this.onGesture, { capture: true });
    }
  }

  private attach(): void {
    this.disarmAsk();
    if (this.listening) return;
    this.listening = true;
    this.lastStamp = -1;
    this.haveGravity = false;
    window.addEventListener("devicemotion", this.onMotion);
    this.setStatus("waiting");
    this.armSilence();
  }

  private detach(): void {
    this.disarmAsk();
    window.clearTimeout(this.silenceTimer);
    if (this.listening) window.removeEventListener("devicemotion", this.onMotion);
    this.listening = false;
    this.yaw = 0;
    this.pitch = 0;
  }

  /** Reports "absent" if no rotation arrives in time. Re-armed while waiting. */
  private armSilence(): void {
    window.clearTimeout(this.silenceTimer);
    this.silenceTimer = window.setTimeout(() => {
      if (this.listening && this.statusNow === "waiting") this.setStatus("absent");
    }, CONFIG.touch.gyro.silenceAfter * 1000);
  }

  private setStatus(status: GyroStatus): void {
    if (status === this.statusNow) return;
    this.statusNow = status;
    this.onStatus(status);
  }

  private onMotion = (e: DeviceMotionEvent): void => {
    const r = e.rotationRate;
    if (!r || r.alpha === null || r.beta === null || r.gamma === null) return;
    if (this.statusNow !== "live") this.setStatus("live");
    const g = CONFIG.touch.gyro;

    // The event's own clock rather than `interval`, which older iOS reported in
    // seconds and everything else in milliseconds. A gap (the page was hidden,
    // the sensor paused) is a sample thrown away rather than a turn made of it.
    const stamp = e.timeStamp;
    const dt = this.lastStamp < 0 ? 0 : (stamp - this.lastStamp) / 1000;
    this.lastStamp = stamp;
    if (dt <= 0 || dt > 0.1) return;

    // Device axes into the screen's. `angle` is how far the content is turned
    // counter-clockwise from the device's natural orientation; `window.orientation`
    // is iOS before 16.4 saying the same thing with -90 for 270.
    const raw =
      screen.orientation?.angle ??
      ((window as unknown as { orientation?: number }).orientation ?? 0);
    const a = ((((raw % 360) + 360) % 360) * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);

    // Gravity first, so this sample's yaw is taken against it.
    const acc = e.accelerationIncludingGravity;
    if (acc && acc.x !== null && acc.y !== null && acc.z !== null) {
      const right = acc.x * c - acc.y * s;
      const up = acc.x * s + acc.y * c;
      const out = acc.z;
      if (!this.haveGravity) {
        this.gRight = right;
        this.gUp = up;
        this.gOut = out;
        this.haveGravity = true;
      } else {
        const k = Math.min(1, dt * g.gravityRate);
        this.gRight += (right - this.gRight) * k;
        this.gUp += (up - this.gUp) * k;
        this.gOut += (out - this.gOut) * k;
      }
    }
    let upR = this.gRight;
    let upU = this.gUp;
    let upO = this.gOut;
    const len = Math.hypot(upR, upU, upO);
    if (len > 1e-3) {
      upR /= len;
      upU /= len;
      upO /= len;
    } else {
      upR = 0;
      upU = 1;
      upO = 0;
    }
    // The screen faces the player and never the floor. See the header.
    if (upU + upO < 0) {
      upU = -upU;
      upO = -upO;
    }

    // Angular velocity, rad/s, about the screen's right, up and out axes.
    // Right-handed: +right tilts the view UP (the top edge comes toward the
    // player), +up turns it LEFT.
    // `alpha` is about the device's X, `beta` its Y and `gamma` its Z — the
    // spec's current text, and what Chromium and WebKit both do. It is NOT the
    // Euler order `deviceorientation` uses (alpha about Z), which an older
    // revision of the spec also used for this and which MDN still repeats:
    // read that way, tilting the phone turned the view sideways and only a
    // steering-wheel roll pitched it.
    const wx = r.alpha * DEG;
    const wy = r.beta * DEG;
    const wRight = wx * c - wy * s;
    const wUp = wx * s + wy * c;
    const wOut = r.gamma * DEG;

    const worldYaw = wUp * upU + wOut * upO;
    const cap = Math.hypot(wUp, wOut);
    let yawRate = Math.sign(worldYaw) * Math.min(Math.abs(worldYaw) * g.yawRelax, cap);
    let pitchRate = wRight;

    // Tightening: scaled down in proportion under the threshold, never cut.
    const speed = Math.hypot(yawRate, pitchRate);
    const threshold = g.tighten * DEG;
    if (speed < threshold && threshold > 0) {
      const k = speed / threshold;
      yawRate *= k;
      pitchRate *= k;
    }

    // Into the camera's signs: its yaw rises to the RIGHT.
    this.yaw -= yawRate * dt;
    this.pitch += pitchRate * dt;
  };
}
