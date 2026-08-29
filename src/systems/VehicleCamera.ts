/**
 * VehicleCamera.ts — The view from outside a tank you are driving: where the
 * eye goes, where it looks, and the angle the turret is being ASKED for.
 * Owns: the chase camera's own yaw and pitch, its occlusion pull-in, and the
 * gun's report kick. Owns no camera — like `DeathCam`, it produces an `eye` and
 * a `look` and `Game` hands both to `CameraSystem.place`.
 *
 * ## Why this is a second camera and not a mode on the first
 *
 * `CameraSystem`'s whole contract is a camera that sits AT the player's eye and
 * never leaves the head — no occlusion pick, no pull-in, and every piece of its
 * state (the ADS blend, the recoil spring, the bob, the landing absorb, the
 * hold sway) is about a body that is standing up. None of that is true of a
 * driver. So this takes the documented hand-off (`place()`) exactly as the
 * death cam does, and owns the two things a third-person view needs that a
 * first-person one has never had: a distance, and something to do when there is
 * a wall in it.
 *
 * ## The reticle cannot lie, and this is half of how
 *
 * `docs/weapons.md`'s rule is that an aimed weapon's picture and its axis are
 * the same fact. A tank breaks the usual way of keeping that promise — the gun
 * is not on the camera, it is on a turret that traverses at 40 deg/s — so the
 * promise is kept from the other end: **this camera's angles are a REQUEST**,
 * `Vehicle` walks the gun toward them at the turret's own rate, and the HUD draws
 * its marker where the GUN points rather than at the middle of the screen.
 * Nothing here may ever be read as "where the shell will go".
 *
 * ## Two halves, and the world step between them
 *
 * `aim` integrates the look into the orders the turret walks toward; `place`
 * puts the eye where the hull ENDED UP. They are separate calls because the
 * hull moves in between — `Game.updateDriver` runs the first, `updateWorld`
 * steps the tank, and `Game.frameVehicleCamera` runs the second. One `update`
 * doing both would frame this frame's camera against last frame's tank, which
 * at 11 m/s is a fifth of a metre of lag in a shot that is nothing but a
 * vehicle in the middle of it.
 *
 * ## The pull-in
 *
 * One ray, cast from the anchor OUTWARD, the same shape and for the same reason
 * as `DeathCam.pullIn`: a ray the other way starts wherever the camera happens
 * to be, which may be inside a wall, and an origin that is always in open space
 * is what makes the answer always mean "the eye can see the tank". The one
 * addition is that the anchor sits above the hull's own collider box, and the
 * tank is taken out of the pick anyway (`Vehicle`'s header says why) — a hull is
 * the nearest solid thing to its own camera by several metres.
 */
import { Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { VehicleSpec } from "../config/vehicles";
import type { Vehicle } from "../entities/Vehicle";
import type { InputManager } from "../core/InputManager";
import { newRayHit, type RayWorld } from "../world/RayWorld";

export class VehicleCamera {
  /** Where the driver is asking the gun to point. `Vehicle` walks to these. */
  yaw = 0;
  pitch: number = CONFIG.vehicles.tank.camera.restPitch;
  /**
   * The hull's own camera block, taken on `take` and held.
   *
   * **Held rather than asked per call, because `aim` is not handed a
   * hull** — it runs before the world step and knows only the input, so
   * the pitch limits and the look multiplier it applies have to come from
   * whatever was last mounted. The tank's is the value at rest, which is
   * what a session that has never been in a vehicle uses and never reads.
   */
  private view: VehicleSpec["camera"] = CONFIG.vehicles.tank.camera;

  /** This frame's camera pose. `Game` hands both to `CameraSystem.place`. */
  readonly eye = new Vector3();
  readonly look = new Vector3();

  /**
   * The gun's report, as an angle on the camera and nothing else. It is not on
   * `yaw`/`pitch`: those are the turret's orders, and a shell that shoved the
   * ORDERS would walk the gun off target every time it fired — which is exactly
   * the permanent share `CONFIG.recoil.recoverFraction` gives a rifle on
   * purpose, and exactly the wrong thing for a weapon that fires every three
   * and a half seconds and is aimed by a machine.
   */
  private kick = 0;
  private kickVel = 0;

  /** The player's look-speed settings, pushed by `Game.applySettings`. */
  private mouseScale = 1;
  private stickScale = 1;
  private touchScale = 1;

  // Scratch. Runs every frame while driving; nothing below allocates.
  private readonly anchor = new Vector3();
  private readonly dir = new Vector3();
  /**
   * The solid world as a segment query, and the buffer the pull-in reads. Null
   * until a map is installed, when nothing is in the way.
   */
  private rays: RayWorld | null = null;
  private readonly hit = newRayHit();

  /** Wired from `Game.installMap`, beside every other system holding a map. */
  setWorld(rays: RayWorld | null): void {
    this.rays = rays;
  }


  /**
   * The same three multipliers `CameraSystem.setLookScale` takes, and they have
   * to be pushed here separately for the reason the whole file exists: this
   * camera is not that one, and a player who has halved their look speed has
   * halved it everywhere or the setting is a lie about one of the two.
   */
  setLookScale(mouse: number, stick: number, touch: number): void {
    this.mouseScale = mouse;
    this.stickScale = stick;
    this.touchScale = touch;
  }

  /**
   * Getting in. The view starts down the hull's own heading rather than
   * wherever the player happened to be looking when they walked up to it: a
   * driver's first frame should be the one that tells them which way the tank
   * is pointing, and inheriting the walk-up angle means the first thing many
   * mounts do is stare at the tracks.
   *
   * The GUN's current bearing is deliberately not used either. A hull that was
   * left with its turret over the back deck would open the view backwards.
   */
  take(tank: Vehicle): void {
    this.view = tank.spec.camera;
    this.yaw = tank.yaw;
    this.pitch = this.view.restPitch;
    this.kick = 0;
    this.kickVel = 0;
    this.place(tank);
  }

  /** The gun went off. Cosmetic, and entirely on the eye. */
  addKick(radians: number): void {
    this.kickVel -= radians * 12;
  }

  aim(dt: number, input: InputManager): void {
    const c = CONFIG.camera;
    const v = this.view;

    // The same three look sources `CameraSystem` folds, times this view's own
    // multiplier: the eye is twelve metres back, so the same wrist sweeps far
    // more world than it does from inside a head.
    this.yaw += input.mouseLookX * c.sensX * this.mouseScale * v.lookMult;
    this.pitch -= input.mouseLookY * c.sensY * this.mouseScale * v.lookMult;
    this.yaw +=
      input.stickLookX * c.stickSensX * this.stickScale * v.lookMult * dt;
    this.pitch -=
      input.stickLookY * c.stickSensY * this.stickScale * v.lookMult * dt;
    this.yaw +=
      input.touchLookX * CONFIG.touch.lookSensX * this.touchScale * v.lookMult;
    this.pitch -=
      input.touchLookY * CONFIG.touch.lookSensY * this.touchScale * v.lookMult;
    this.pitch = Math.max(v.pitchMin, Math.min(v.pitchMax, this.pitch));

    // The report settles on a damped spring, semi-implicit Euler — the same
    // integrator and the same ordering (velocity first, then position off the
    // NEW velocity) as `CameraSystem`'s landing absorb, at a frequency well
    // inside where Euler holds. Explicit Euler here rings instead of settling.
    if (this.kick !== 0 || this.kickVel !== 0) {
      const w = Math.PI * 2 * 1.8;
      this.kickVel += (-w * w * this.kick - 2 * 0.65 * w * this.kickVel) * dt;
      this.kick += this.kickVel * dt;
      if (Math.abs(this.kick) < 1e-4 && Math.abs(this.kickVel) < 1e-3) {
        this.kick = 0;
        this.kickVel = 0;
      }
    }
  }

  /**
   * Places the eye behind and above the hull and points it at the anchor.
   *
   * The anchor is above the hull's collider box on purpose: the pull-in's ray
   * starts there, and an origin inside the box would be an origin inside a
   * solid mesh — the one thing `DeathCam.pullIn`'s note says makes the answer
   * meaningless.
   */
  place(tank: Vehicle): void {
    const v = tank.spec.camera;
    this.anchor
      .copyFrom(tank.center)
      .addInPlaceFromFloats(0, v.anchorHeight, 0);
    const pitch = this.pitch + this.kick;
    const cp = Math.cos(pitch);
    this.dir.set(cp * Math.sin(this.yaw), Math.sin(pitch), cp * Math.cos(this.yaw));
    // Look a little PAST the tank rather than at it, so the hull sits in the
    // lower third of the frame and the street ahead gets the rest. Aiming at
    // the anchor itself puts the vehicle in the middle of the screen, which is
    // where the thing you are shooting at should be.
    this.look
      .copyFrom(this.anchor)
      .addInPlace(this.dir.scale(v.distance * 0.9));
    this.eye.copyFrom(this.anchor).subtractInPlace(this.dir.scale(v.distance));
    this.pullIn(tank);
  }

  /** Walks the eye in until it is on the same side of the wall as the tank. */
  private pullIn(tank: Vehicle): void {
    const v = tank.spec.camera;
    this.eye.subtractToRef(this.anchor, this.dir);
    const len = this.dir.length();
    if (len < 1e-4) return;
    this.dir.scaleInPlace(1 / len);
    // Out of its own query — see `Vehicle`'s header — which is what `skip` is for.
    // The OTHER tank stays in it, which is what makes one hull block another's
    // camera. `castBody` rather than the shot's `castRound`, the same choice
    // the death cam makes: this asks where the eye may SIT, not what it can see
    // through, and a porous box is still somewhere a camera should not park.
    if (!this.rays?.castBody(this.anchor, this.dir, len, this.hit, tank)) return;
    const allow = Math.max(v.minDistance, this.hit.distance - v.wallMargin);
    if (allow >= len) return;
    this.eye.copyFrom(this.anchor).addInPlace(this.dir.scaleInPlace(allow));
  }
}
