/**
 * VehicleView.ts — What one hull LOOKS like: the rig its kind's model builds,
 * stood where the hull's collider box stands, the belts' run, the two whips
 * and the paint.
 * Owns: the `VehicleRig` (its joints and its segments), a `HullWhips`, the run
 * each side's running gear has covered and the stick and disc it was last
 * drawn at, and which paint is on. Only the client builds one
 * (`systems/VehicleViews.ts`, one per hardstanding); the authority runs
 * `Vehicle` alone and draws nothing. Reads its `Vehicle` and NEVER writes it:
 * everything it decides is where a joint stands, how it is turned, whether
 * the hull is drawn and what it is painted.
 * Invariants:
 * - **The joints are COPIES of the hull's `pose`**, written only where they
 *   differ — the hull wrote the record behind the guards the node writes had,
 *   so a joint is exactly what the record says and the muzzles the simulation
 *   replays off the record are the muzzles drawn here (`entities/hullFrame.ts`).
 *   The guards stay although a joint costs nothing to write: an unguarded
 *   write of a `-0` over a `0` is a different bit in the drawn matrix.
 * - **The joints are OURS and Babylon has no node and no mesh of a hull**
 *   (`BABYLON_EXIT.md` X4.2a, X4.2b, `vehicleRig.ts`' header): `Game`
 *   composes them (`fadeHulls`, `vehicleRig.composeHull`, in the cull span)
 *   and writes the rig's drawing for our renderer (`drawHulls`,
 *   `writeHullDrawing`), once a frame after every write and before the
 *   render, and nothing in the game reads a joint but the drawing.
 * - **Five things it is TOLD, as `Vehicle`'s `HullPicture`**: a placing (the
 *   rig back to rest), a shot (the masts crack), a wreck (the charred paint),
 *   each step of the running gear and each step of the hull's mass — because a
 *   reset and two integrators cannot be polled, and a wreck lands later in the
 *   frame than `update` runs. Everything else is read in `update`, which runs
 *   right after `VehicleSystem.update` and BEFORE the battle, the grenades and
 *   the rockets step: nothing after the fleet moves a hull, but any of the
 *   three can wreck one, and a poll would paint that a frame late.
 * - **The body joint follows the hull** (`rig.body`): at `pos`, turned `yaw`
 *   — the collider box's own frame and the joint the rig's root hangs off,
 *   which an invisible body box MESH was until X4.2a (the rig its child). The
 *   hull is drawn exactly while `present` (`setHullRigEnabled`, the rig's one
 *   switch, which the drawing reads). The two
 *   shadow maps draw the HULL's box off its own fields (`core/proxyBoxes.ts`,
 *   `BABYLON_EXIT.md` X4.1c), and no ray and no sweep in the game reads the
 *   drawing: a hull is answered by `Vehicle.rayBox`.
 * Never: holds anything of Babylon's — there is nothing of a hull's to free
 * since X4.2b: its drawing is its kit's, which outlives every round.
 */
import { HullWhips } from "./HullWhips";
import type { HullPicture, Vehicle } from "./Vehicle";
import type { VehicleModel } from "./vehicleModels";
import { setHullRigEnabled, type VehicleRig } from "./vehicleRig";

export class VehicleView implements HullPicture {
  readonly rig: VehicleRig;
  /** The masts. See `HullWhips`. */
  private readonly whips: HullWhips;
  /**
   * How far each side's running gear has run over the ground, in metres, left
   * then right.
   *
   * **A PICTURE, and the hull keeps nothing like it**: the drive is one speed
   * and one yaw rate, and the split is the gauge's — a hull turning at `w`
   * runs its outer side faster than its inner one by `w * gauge / 2`, so a
   * neutral-steer pivot (which a hull whose `steerAtRest` is 1 can do at a
   * standstill) comes out as the two tracks going opposite ways, and a hull
   * that is being STOPPED by something still runs them, because the speed it
   * is told is what the drive achieved.
   */
  private readonly trackRun: [number, number] = [0, 0];
  /**
   * The linkage the running gear was last DRAWN at, so a parked truck's
   * wheels answer the stick while the hull itself has not moved. Reset with
   * the tracks, because a respawned hull is drawn straight.
   */
  private steerShown = 0;
  /** The disc's run last drawn, so a turning rotor redraws a hull that is still. */
  private rotorShown = 0;
  /** Whether the body is on the field as drawn. Follows `hull.present`. */
  private shownPresent = true;

  constructor(
    /** The hull this draws. Read, never written. */
    readonly hull: Vehicle,
    model: VehicleModel,
  ) {
    const t = hull.spec;
    this.rig = model(hull.team);
    // The rig is drawn with `y = 0` at the bottom of the tracks and the
    // collider box is centred on the hull, so the model hangs half a hull
    // below the box's own origin (`rig.body`) — `hullPointToRef`'s `drop`.
    this.rig.root.position.y = -t.hull.height / 2;
    this.whips = new HullWhips(this.rig.antennae, t);
    // The hull was placed before there was a picture to tell, so the rig goes
    // through the placing it missed, exactly as a respawned one does — and
    // through the wreck, if it missed that too.
    this.placed();
    if (!hull.alive) this.wrecked();
    this.update();
  }

  // --- HullPicture ---------------------------------------------------------

  /** A fresh hull: the rig at rest and in its livery, the masts straight. */
  placed(): void {
    this.rig.reset();
    this.whips.reset();
    this.trackRun[0] = 0;
    this.trackRun[1] = 0;
    this.steerShown = 0;
    this.rotorShown = 0;
  }

  kicked(): void {
    this.whips.kick();
  }

  /** The charred paint, on the call that wrecked the hull. */
  wrecked(): void {
    this.rig.paint(true);
  }

  /**
   * The belts, off the drive the hull has just decided. Skipped outright for a
   * hull that neither moved nor turned and whose linkage and disc are where
   * they were last drawn — two of these are parked doing nothing for most of a
   * round, and a still hull's belts are where they were (the run is a sum, so
   * the skip is part of what the picture is, not only a saving). A yaw to the
   * RIGHT (which is
   * a positive one — forward is `(sin yaw, cos yaw)`, so +90 degrees points at
   * +x) is the LEFT track running long.
   */
  rolled(
    dt: number,
    speed: number,
    yawRate: number,
    steer: number,
    rotorRun: number,
    moved: boolean,
    linkage: boolean,
  ): void {
    if (
      !moved &&
      !(linkage && steer !== this.steerShown) &&
      rotorRun === this.rotorShown
    ) {
      return;
    }
    const differential = (yawRate * this.hull.frame.gauge) / 2;
    this.trackRun[0] += (speed + differential) * dt;
    this.trackRun[1] += (speed - differential) * dt;
    this.rig.setRun(this.trackRun[0], this.trackRun[1], steer, rotorRun);
    if (linkage) this.steerShown = steer;
    this.rotorShown = rotorRun;
  }

  flexed(
    dt: number,
    accel: number,
    lateral: number,
    footPitch: number,
    footRoll: number,
  ): void {
    this.whips.step(dt, accel, lateral, footPitch, footRoll, this.hull.pose.turretY);
  }

  // --- the frame -------------------------------------------------------------

  /**
   * Everything that is STATE, read off the hull and written onto the joints:
   * where the body stands, whether it is drawn, and the joints from the pose.
   * Run right after the fleet has been stepped (`Game.updateWorld`) and
   * before the rest of the fight, which can wreck a hull but never move one —
   * which is why the wreck's paint is told (`wrecked`) rather than read here.
   *
   * A joint is written only where it differs from the pose — the guards the
   * node writes had, kept because the record was written behind them and
   * they decide a zero's sign (the header).
   */
  update(): void {
    const hull = this.hull;
    const r = this.rig;
    const present = hull.present;
    if (present !== this.shownPresent) {
      this.shownPresent = present;
      setHullRigEnabled(r, present);
    }
    const p = hull.pos;
    r.body.position.set(p.x, p.y, p.z);
    r.body.rotation.y = hull.yaw;
    const s = hull.pose;
    const lean = r.hull.rotation;
    if (lean.x !== s.hullX) lean.x = s.hullX;
    if (lean.z !== s.hullZ) lean.z = s.hullZ;
    const sprung = r.sprung;
    if (sprung.rotation.x !== s.sprungX) sprung.rotation.x = s.sprungX;
    if (sprung.rotation.z !== s.sprungZ) sprung.rotation.z = s.sprungZ;
    if (sprung.position.y !== s.sprungY) sprung.position.y = s.sprungY;
    if (r.turret.rotation.y !== s.turretY) r.turret.rotation.y = s.turretY;
    if (r.gun && r.gun.rotation.x !== s.gunX) r.gun.rotation.x = s.gunX;
    if (r.mgMount.rotation.y !== s.mgMountY) r.mgMount.rotation.y = s.mgMountY;
    if (r.mgGun.rotation.x !== s.mgGunX) r.mgGun.rotation.x = s.mgGunX;
  }
}
