/**
 * editor/EditorCamera.ts — Free-fly camera drive for the map editor.
 * Owns: the editor's yaw/pitch/velocity, its pointer-lock-on-right-drag, and
 * its speed step. Owns no camera of its own.
 *
 * It writes CameraSystem's FreeCamera rather than creating a second one on
 * purpose: DefaultRenderingPipeline and HorrorPost are bound to that camera
 * INSTANCE, so a second camera would render without FXAA or the grade until
 * both were rebound. Nothing needs restoring on the way out either —
 * CameraSystem.update() writes position, target and fov absolutely every
 * frame, so the first gameplay frame overwrites everything done here.
 *
 * Look is gated on holding the right mouse button, which is what keeps the
 * left button free for the panel and the gizmos: camera-look and gizmo-drag
 * can never be active at the same time. WASD/sprint come from InputManager
 * unchanged; Q/E and the right button need their own listeners because
 * InputManager's key set is private and this is a dev-only tool — widening its
 * public surface for the editor would be the wrong trade.
 *
 * Two hard-won details in the button handling:
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
 */
import type { FreeCamera } from "@babylonjs/core";
import { Vector3 } from "@babylonjs/core";
import type { InputManager } from "../core/InputManager";
import { EDITOR } from "./tuning";

export class EditorCamera {
  private yaw = 0;
  private pitch = 0.2;
  private speed: number = EDITOR.camera.baseSpeed;
  private velocity = Vector3.Zero();
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
    const c = EDITOR.camera;

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

  /**
   * Places the camera without a transition — used on entry so the editor opens
   * looking at wherever the player was rather than snapping to the origin.
   */
  warpTo(position: Vector3, yaw: number, pitch: number): void {
    this.camera.position.copyFrom(position);
    this.yaw = yaw;
    this.pitch = pitch;
    this.velocity.setAll(0);
  }

  update(dt: number, input: InputManager): void {
    const c = EDITOR.camera;

    if (this.lookX !== 0 || this.lookY !== 0) {
      this.yaw += this.lookX * c.lookSensitivity;
      this.pitch -= this.lookY * c.lookSensitivity;
      this.pitch = Math.max(-c.maxPitch, Math.min(c.maxPitch, this.pitch));
      this.lookX = 0;
      this.lookY = 0;
    }

    const cp = Math.cos(this.pitch);
    const forward = new Vector3(
      cp * Math.sin(this.yaw),
      Math.sin(this.pitch),
      cp * Math.cos(this.yaw),
    );
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

    this.camera.position.addInPlace(this.velocity.scale(dt));
    this.camera.setTarget(this.camera.position.add(forward));
  }

  /** The view direction, for the shadow focus bias. */
  get forward(): Vector3 {
    const cp = Math.cos(this.pitch);
    return new Vector3(
      cp * Math.sin(this.yaw),
      Math.sin(this.pitch),
      cp * Math.cos(this.yaw),
    );
  }

  dispose(): void {
    this.detach();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }
}
