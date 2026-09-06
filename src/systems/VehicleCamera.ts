/**
 * VehicleCamera.ts — The view from outside a tank you are driving, and the view
 * down the GUNNER's sight from inside it: where the eye goes, where it looks,
 * and the angle the turret is being ASKED for.
 * Owns: the chase camera's own yaw and pitch, its occlusion pull-in, the gun's
 * report kick, and the sight picture the second seat may put up over all of it.
 * Owns no camera — like `DeathCam`, it produces an `eye`, a `look` and a `fov`,
 * and `Game` hands all three to `CameraSystem.place`.
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
 * ## The SIGHT, and why it is the same file rather than a third camera
 *
 * A chase camera FRAMES THE VEHICLE, and a gunner does not want the vehicle
 * framed. The anchor sits at the exact middle of the picture, so whatever this
 * hull's second gun is laid on is behind the hull — which on a tank is a
 * problem you can drive around, and on a gunship is the whole engagement: the
 * chin gun's hemisphere is DOWN and FORWARD, and an eleven-metre fuselage under
 * a five-metre disc is between a fourteen-metre boom and every target it has.
 *
 * So the second seat may put a sight up (`Game`'s ADS, held), and the eye goes
 * to the optic head on the gun. Three things fall out of that and each is worth
 * more than the occlusion it was built to fix:
 *
 * - **The reticle stops needing a marker.** Everything below keeps the promise
 *   from the far end — the camera is an ORDER and `#gun-marker` is drawn where
 *   the barrel actually is. Through the sight the picture IS the axis, so the
 *   marker converges on the middle of the screen and stays there. Nothing in
 *   `Game.pushGunMarker` knows about any of this and nothing had to.
 * - **It does not ROLL**, on the one machine in the fleet that banks 26
 *   degrees. `mgYaw`/`mgPitch` are held in the WORLD — the decision the second
 *   seat already rested on, so that a traversing turret cannot drag a laid gun
 *   round — and a view built from two world angles has no airframe attitude in
 *   it at all. `CameraSystem.place` zeroing the roll is the other half.
 * - **The dead band at the elevation stops goes away.** `aim` clamps the ORDER
 *   to the GUN's limits while the sight is up rather than to the camera's, so
 *   the view stops exactly where the weapon does. Wound down against the
 *   camera's wider band the player would push the order into ground the gun
 *   cannot reach and then have to wind it back before anything moved.
 *
 * **It SNAPS, both ways, and that is a decision rather than a shortcut.** The
 * two views point in different directions — the chase camera along the ORDER,
 * the sight along the GUN — so a blend would spend its whole length pointing at
 * neither, with the reticle lying for exactly as long as it ran. What is
 * continuous is the thing that matters: the order is untouched by the
 * transition, the gun has been tracking it all along, and putting the sight
 * down leaves the chase camera looking where it was looking.
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
import type { AxisSpec, VehicleSpec } from "../config/vehicles";
import type { Vehicle } from "../entities/Vehicle";
import type { InputManager } from "../core/InputManager";
import { newRayHit, type RayWorld } from "../world/RayWorld";

/**
 * The sight picture, resolved once at module load from the one number that
 * states it — `entities/sights.ts`'s derivation, made again for a mount.
 *
 * Magnification is a ratio of TANGENTS and not of angles, which is the trap
 * that file calls out and the reason this is not written down as a field: at
 * 2.2x, halving the radians would be a different instrument.
 */
const SIGHT_FOV =
  2 *
  Math.atan(
    Math.tan(CONFIG.camera.fovHip / 2) / CONFIG.vehicles.sight.magnification,
  );
/**
 * What the look input is worth through it. The chase camera's own `lookMult`
 * is deliberately NOT one of the terms: that number exists because the eye is
 * twelve metres back and the same wrist sweeps far more world than it does
 * from inside a head, and through the sight the eye is on the gun. What
 * applies instead is the ADS pair, wound down by the magnification exactly as
 * a fitted optic winds a rifle's down.
 */
const SIGHT_LOOK_MOUSE =
  CONFIG.camera.adsLookMouse / CONFIG.vehicles.sight.magnification;
const SIGHT_LOOK_STICK =
  CONFIG.camera.adsLookStick / CONFIG.vehicles.sight.magnification;
/**
 * How far down the bore the sight's look point is put. Any positive distance
 * gives the same picture — `CameraSystem.place` takes a TARGET and keeps only
 * the direction to it — so this is chosen to be a sane world magnitude and
 * means nothing else.
 */
const SIGHT_REACH = 100;

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
  /**
   * …and the second seat's gun, held for the same reason and taken at the same
   * moment. Only its two STOPS are read: `aim` clamps the order to the weapon's
   * own elevation band while the sight is up, so the picture stops where the
   * gun stops and there is no band of order the view will not follow.
   */
  private mount: AxisSpec = CONFIG.vehicles.tank.mg;

  /** This frame's camera pose. `Game` hands all three to `CameraSystem.place`. */
  readonly eye = new Vector3();
  readonly look = new Vector3();
  /**
   * …and the field it is seen through. Written on every `place`, so the frame a
   * sight goes down is a frame that has already put the wide field back.
   */
  fov: number = CONFIG.camera.fovHip;

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
    this.mount = tank.spec.mg;
    this.yaw = tank.yaw;
    this.pitch = this.view.restPitch;
    this.kick = 0;
    this.kickVel = 0;
    // Opened in the CHASE view whichever seat this is, which is the paragraph
    // above carried through: a sight put up on the frame somebody sits down is
    // one that has told them nothing about the machine they are now in.
    this.place(tank, false);
  }

  /** The gun went off. Cosmetic, and entirely on the eye. */
  addKick(radians: number): void {
    this.kickVel -= radians * 12;
  }

  /**
   * `optic` is whether the GUNNER has his sight up this frame — `Game` decides
   * it, because whether there is a sight to put up is a question about the
   * SEAT and this file has never been told which one is holding it.
   */
  aim(dt: number, input: InputManager, optic: boolean): void {
    const c = CONFIG.camera;
    const v = this.view;

    // The same three look sources `CameraSystem` folds, times this view's own
    // multiplier: the eye is twelve metres back, so the same wrist sweeps far
    // more world than it does from inside a head. Through the sight it is on
    // the gun instead and the ADS pair applies — see `SIGHT_LOOK_MOUSE`. The
    // touch drag takes the mouse's of the two, being the same kind of device:
    // a hand moving a picture directly rather than a stick asking for a rate.
    const mouse = optic ? SIGHT_LOOK_MOUSE : v.lookMult;
    const stick = optic ? SIGHT_LOOK_STICK : v.lookMult;
    this.yaw += input.mouseLookX * c.sensX * this.mouseScale * mouse;
    this.pitch -= input.mouseLookY * c.sensY * this.mouseScale * mouse;
    this.yaw += input.stickLookX * c.stickSensX * this.stickScale * stick * dt;
    this.pitch -= input.stickLookY * c.stickSensY * this.stickScale * stick * dt;
    this.yaw +=
      input.touchLookX * CONFIG.touch.lookSensX * this.touchScale * mouse;
    this.pitch -=
      input.touchLookY * CONFIG.touch.lookSensY * this.touchScale * mouse;
    // The GUN's stops while its sight is up and the CAMERA's otherwise. The
    // gun's band is the narrower of the two on every kind in the fleet, so
    // raising the sight can pull the order up to meet a gun already sitting at
    // full depression — which is the right snap and the only one there is: the
    // view arrives where the weapon actually is.
    const lo = optic ? this.mount.pitchMin : v.pitchMin;
    const hi = optic ? this.mount.pitchMax : v.pitchMax;
    this.pitch = Math.max(lo, Math.min(hi, this.pitch));

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
   * Places the eye behind and above the hull, or at the gunner's sight when he
   * has one up.
   *
   * The anchor is above the hull's collider box on purpose: the pull-in's ray
   * starts there, and an origin inside the box would be an origin inside a
   * solid mesh — the one thing `DeathCam.pullIn`'s note says makes the answer
   * meaningless.
   *
   * **The look point is off the eye's own ray, and it has to be.** This used to
   * take a point 90% of the boom's length past the anchor and call it framing,
   * which was exactly nothing: eye, anchor and look were COLLINEAR, and
   * `CameraSystem.place` keeps only the direction to a target — a point on a
   * ray projects to the pixel that ray already went through. So the hull sat
   * dead centre at every angle, which is where the thing being shot at should
   * be. The look DIRECTION is pitched up by `CONFIG.vehicles.frameLift`
   * instead, faded out as the camera looks down; that field carries both
   * halves of why.
   */
  place(tank: Vehicle, optic: boolean): void {
    if (optic) return this.sight(tank);
    const v = tank.spec.camera;
    this.fov = CONFIG.camera.fovHip;
    this.anchor
      .copyFrom(tank.center)
      .addInPlaceFromFloats(0, v.anchorHeight, 0);
    const pitch = this.pitch + this.kick;
    const cp = Math.cos(pitch);
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    this.dir.set(cp * sy, Math.sin(pitch), cp * cy);
    this.eye
      .copyFrom(this.anchor)
      .subtractInPlace(this.dir.scaleInPlace(v.distance));
    // Full at the view's own rest angle and above, gone at the bottom of its
    // travel. Read off the two numbers the kind already states rather than a
    // third, so a camera that is given more depression is one whose lift fades
    // over the whole of it.
    const span = v.restPitch - v.pitchMin;
    const t =
      span > 1e-4
        ? Math.max(0, Math.min(1, (pitch - v.pitchMin) / span))
        : 1;
    const lp = pitch + CONFIG.vehicles.frameLift * t;
    const clp = Math.cos(lp);
    // Off the EYE rather than off the anchor, so the pull-in below carries the
    // look with it: a boom that shortens against a wall must not swing the
    // view round as it goes.
    this.look.set(
      this.eye.x + clp * sy * v.distance,
      this.eye.y + Math.sin(lp) * v.distance,
      this.eye.z + clp * cy * v.distance,
    );
    this.pullIn(tank);
  }

  /**
   * The GUNNER's sight: the eye at the optic head on his gun, looking down the
   * bore. No anchor, no boom and therefore no pull-in — there is nothing
   * between an eye bolted to a weapon and what that weapon is pointing at, and
   * a query that walked this eye toward a wall would be walking it into the
   * hull it is mounted on.
   *
   * The report is the one thing that moves it. `kick` is spent on the SIGHT and
   * never on `mgYaw`/`mgPitch`, which is the same split the chase view makes
   * with the same argument behind it: what a shot shakes is the picture, and a
   * gun whose ORDERS were shoved would walk off target every time it fired.
   * `#gun-marker` is drawn from the gun's true axis, so through a shaken sight
   * the reticle visibly steps off the middle of the screen and settles back —
   * which is the honest picture rather than a decorated one.
   *
   * **It is NEGATED against the chase view's, and that is not a slip.** The two
   * spend the same number on opposite geometry: out on the boom `kick` is added
   * to a pitch that also swings the eye, so a shot takes the camera up and over
   * and the scene rides UP the screen; through a sight there is no boom and the
   * only thing left is where the instrument points, where every other weapon in
   * this game answers a report by CLIMBING. A sight that dipped on firing would
   * be the one recoil in the tree that reads backwards.
   */
  private sight(tank: Vehicle): void {
    this.fov = SIGHT_FOV;
    tank.mgSightToRef(this.eye);
    tank.mgDirToRef(this.dir, -this.kick);
    this.look
      .copyFrom(this.eye)
      .addInPlace(this.dir.scaleInPlace(SIGHT_REACH));
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
