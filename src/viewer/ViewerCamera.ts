/**
 * viewer/ViewerCamera.ts — Free-fly camera drive for the dev-only map viewer.
 * Owns: the viewer's yaw/pitch/velocity, its pointer-lock-on-right-drag, and
 * its speed step. Owns no camera of its own.
 *
 * `editor/EditorCamera.ts` nearly as it is (`BABYLON_EXIT.md` X5.3b), its
 * arithmetic on `src/math`'s `Vector3` rather than Babylon's — the same
 * operations in the same order, which `scripts/math-check.mjs` holds to
 * Babylon's bit for bit — so the one Babylon thing it touches is the camera it
 * is handed, through a copy (`toBabylon`) where `setTarget` wants one of
 * Babylon's. The editor's copy went with the editor (X5.3c).
 *
 * It writes CameraSystem's FreeCamera rather than creating a second one on
 * purpose: the post chain's pass owner (`PostPasses`, which sizes the frame and
 * opens every stage's pass, the ink's among them since `BABYLON_EXIT.md` X5.2d)
 * and the glow are bound to that camera INSTANCE, so a second camera would
 * render without the chain or the bloom until they were rebound.
 * What it overwrites is put back by the session that made it
 * (`ViewerSession.dispose`), because the viewer is a LID: the deploy screen
 * under it writes no camera of its own, so nothing else would.
 *
 * Look is gated on holding the right mouse button, which is what keeps the
 * left button free for the panel and its plan. WASD/sprint come from
 * InputManager unchanged; Q/E and the right button need their own listeners
 * because InputManager's key set is private and this is a dev-only tool —
 * widening its public surface for it would be the wrong trade.
 *
 * Two hard-won details in the button handling, both the editor's:
 *
 * - It listens for **pointerdown/pointerup, not mousedown/mouseup**. Babylon
 *   calls preventDefault() on the pointer event, and a prevented pointerdown
 *   suppresses the compatibility mouse event completely — `mousedown` simply
 *   never arrives. This is the same trap Game's pointer-lock listener and
 *   InputManager's dual mask both document.
 * - Look does **not** depend on pointer lock being granted. The lock is
 *   requested because it is nicer for long drags (no cursor hitting the screen
 *   edge), but the deltas come from `movementX/movementY`, which the browser
 *   fills in whether or not the lock exists. A tool that stops turning because
 *   a lock request was refused is a tool that looks broken.
 *
 * Never: hands a `src/math` vector to a Babylon
 * method (it would read `_x` and write NaN, CLAUDE.md's two `Vector3`s).
 */
import type { FreeCamera } from "@babylonjs/core";
import type { InputManager } from "../core/InputManager";
import { Vector3, type Vector3Like } from "../math";
import { toBabylon } from "../math/babylon";
import { VIEWER } from "./tuning";

export class ViewerCamera {
  private yaw = 0;
  private pitch = 0.2;
  private speed: number = VIEWER.camera.baseSpeed;
  private velocity = Vector3.Zero();
  /** Where the camera looks this frame, and Babylon's copy of it for `setTarget`. */
  private readonly aim = new Vector3();
  private readonly target = toBabylon(this.aim);
  private up = false;
  private down = false;
  private looking = false;
  /** Mouse movement accumulated since the last frame, in pixels. */
  private lookX = 0;
  private lookY = 0;
  private readonly detach: () => void;

  constructor(
    private camera: FreeCamera,
    private canvas: HTMLCanvasElement,
  ) {
    const c = VIEWER.camera;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "KeyE") this.up = true;
      else if (e.code === "KeyQ") this.down = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "KeyE") this.up = false;
      else if (e.code === "KeyQ") this.down = false;
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 2) return;
      this.looking = true;
      // Best-effort: a pointerdown is a user gesture so this normally
      // succeeds, but look works from movementX/Y either way. Swallow the
      // rejection rather than logging a failure that changes nothing.
      void Promise.resolve(this.canvas.requestPointerLock()).catch(() => {});
    };
    const stopLooking = () => {
      if (!this.looking) return;
      this.looking = false;
      this.lookX = 0;
      this.lookY = 0;
      if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.button !== 2) return;
      stopLooking();
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!this.looking) return;
      this.lookX += e.movementX;
      this.lookY += e.movementY;
    };
    const onWheel = (e: WheelEvent) => {
      // The panel scrolls its findings with the wheel; that is not a speed
      // change. (The editor's camera took both; its panel had less to scroll.)
      if ((e.target as Element | null)?.closest?.("#viewer-panel")) return;
      const f = e.deltaY < 0 ? c.speedStep : 1 / c.speedStep;
      this.speed = Math.min(c.maxSpeed, Math.max(c.minSpeed, this.speed * f));
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", stopLooking);
    document.addEventListener("pointermove", onPointerMove);
    // A button released while the window is unfocused never reports up.
    window.addEventListener("blur", stopLooking);
    document.addEventListener("wheel", onWheel, { passive: true });
    this.detach = () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", stopLooking);
      document.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("blur", stopLooking);
      document.removeEventListener("wheel", onWheel);
    };
  }

  /** Metres per second at the current speed step, for the panel readout. */
  get flySpeed(): number {
    return this.speed;
  }

  /** The heading, for the plan's camera mark: 0 looks along +Z, map north. */
  get heading(): number {
    return this.yaw;
  }

  /**
   * Places the camera without a transition — used on entry so the viewer opens
   * looking at wherever the eye was, and by a click on the plan or a finding.
   */
  warpTo(position: Vector3Like, yaw: number, pitch: number): void {
    this.camera.position.copyFromFloats(position.x, position.y, position.z);
    this.yaw = yaw;
    this.pitch = Math.max(-VIEWER.camera.maxPitch, Math.min(VIEWER.camera.maxPitch, pitch));
    this.velocity.setAll(0);
  }

  update(dt: number, input: InputManager): void {
    const c = VIEWER.camera;

    if (this.lookX !== 0 || this.lookY !== 0) {
      this.yaw += this.lookX * c.lookSensitivity;
      this.pitch -= this.lookY * c.lookSensitivity;
      this.pitch = Math.max(-c.maxPitch, Math.min(c.maxPitch, this.pitch));
      this.lookX = 0;
      this.lookY = 0;
    }

    const forward = this.forward;
    // Strafe stays level regardless of pitch — a banking sidestep makes it
    // impossible to judge a building's footprint while lining it up.
    const right = new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const wish = forward
      .scale(input.moveY)
      .addInPlace(right.scale(input.moveX))
      .addInPlace(new Vector3(0, (this.up ? 1 : 0) - (this.down ? 1 : 0), 0));
    if (wish.lengthSquared() > 1) wish.normalize();

    const target = wish.scale(this.speed * (input.sprint ? c.boost : 1));
    // Plain frame-lerp smoothing, the codebase idiom. Nothing here decides
    // where a bullet goes, so exponential decay would be overkill.
    const k = Math.min(1, dt * c.damping);
    this.velocity.addInPlace(target.subtractInPlace(this.velocity).scaleInPlace(k));

    const pos = this.camera.position;
    pos.addInPlaceFromFloats(this.velocity.x * dt, this.velocity.y * dt, this.velocity.z * dt);
    this.aim.copyFromFloats(pos.x + forward.x, pos.y + forward.y, pos.z + forward.z);
    this.camera.setTarget(toBabylon(this.aim, this.target));
  }

  /** The view direction, for the shadow focus bias. */
  get forward(): Vector3 {
    const cp = Math.cos(this.pitch);
    return new Vector3(cp * Math.sin(this.yaw), Math.sin(this.pitch), cp * Math.cos(this.yaw));
  }

  dispose(): void {
    this.detach();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }
}
