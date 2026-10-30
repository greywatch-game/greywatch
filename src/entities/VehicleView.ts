/**
 * VehicleView.ts — What one hull LOOKS like: its invisible body box, the rig
 * its kind's model builds, the belts' run, the two whips and the paint.
 * Owns: the body mesh, the `VehicleRig`, a `HullWhips`, the run each side's
 * running gear has covered and the stick and disc it was last drawn at, and
 * which paint is on. Only the client builds one (`systems/VehicleViews.ts`,
 * one per hardstanding); the authority runs `Vehicle` alone and draws nothing.
 * Reads its `Vehicle` and NEVER writes it: everything it decides is where a
 * node stands, how it is turned, whether it is drawn and what it is painted.
 * Invariants:
 * - **The nodes are COPIES of the hull's `pose`**, written only where they
 *   differ — the hull wrote the record behind the guards the node writes had,
 *   so a node is exactly what the record says and the muzzles the simulation
 *   replays off the record are the muzzles drawn here (`entities/hullFrame.ts`).
 * - **Five things it is TOLD, as `Vehicle`'s `HullPicture`**: a placing (the
 *   rig back to rest), a shot (the masts crack), a wreck (the charred paint),
 *   each step of the running gear and each step of the hull's mass — because a
 *   reset and two integrators cannot be polled, and a wreck lands later in the
 *   frame than `update` runs. Everything else is read in `update`, which runs
 *   right after `VehicleSystem.update` and BEFORE the battle, the grenades and
 *   the rockets step: nothing after the fleet moves a hull, but any of the
 *   three can wreck one, and a poll would paint that a frame late.
 * - **The body box follows the hull**: at `pos`, turned `yaw`, enabled
 *   exactly while `present`. It is the node the rig hangs off and nothing
 *   else — the two shadow maps draw the HULL's box off its own fields
 *   (`core/proxyBoxes.ts`, `BABYLON_EXIT.md` X4.1c), never this: never
 *   pickable and never `metadata.solid`, because the one mesh pick left in the
 *   game is the editor's (`world/solid.ts`) and the editor builds no hulls. No
 *   ray and no sweep in the game reads it: a hull is answered by
 *   `Vehicle.rayBox`.
 * Never: `dispose(false, true)` — see `dispose`.
 */
import { MeshBuilder, type Mesh, type Scene } from "@babylonjs/core";
import type { CelMaterialFactory } from "../shaders/CelShader";
import { HullWhips } from "./HullWhips";
import type { HullPicture, Vehicle } from "./Vehicle";
import type { VehicleModel } from "./vehicleModels";
import type { VehicleRig } from "./vehicleRig";

export class VehicleView implements HullPicture {
  /**
   * The collider box's MESH, invisible, and a FOLLOWER of the hull — see the
   * header for its two readers. Built before the rig, in the order the scene
   * always received the two.
   */
  readonly body: Mesh;
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
    scene: Scene,
    mats: CelMaterialFactory,
    /** The hull this draws. Read, never written. */
    readonly hull: Vehicle,
    model: VehicleModel,
  ) {
    const t = hull.spec;
    this.body = MeshBuilder.CreateBox(
      `hull-body-${hull.team}`,
      { width: t.hull.width, height: t.hull.height, depth: t.hull.length },
      scene,
    );
    this.body.isVisible = false;
    // Out of every pick: what a hull is to a body and to a round — both, to
    // both; neither `porous` nor `rayOnly`, which describe a fence — is
    // `Vehicle.rayBox`, and it reads no mesh.
    this.body.isPickable = false;
    this.rig = model(scene, mats, hull.team);
    this.rig.root.parent = this.body;
    // The rig is drawn with `y = 0` at the bottom of the tracks and the
    // collider box is centred on the hull, so the model hangs half a hull
    // below the box's own origin — `hullPointToRef`'s `drop`.
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
   * round, and writing six transforms a frame to put them back exactly where
   * they were is six world matrices to recompute. A yaw to the RIGHT (which is
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
   * Everything that is STATE, read off the hull and written onto the nodes:
   * where the body stands, whether it is drawn, and the joints from the pose.
   * Run right after the fleet has been stepped (`Game.updateWorld`) and
   * before the rest of the fight, which can wreck a hull but never move one —
   * which is why the wreck's paint is told (`wrecked`) rather than read here.
   *
   * A joint is written only where it differs from the pose: an assignment to
   * a `TransformNode`'s rotation is a world matrix to recompute whether the
   * number moved or not, and two of these are parked doing nothing for most
   * of a round.
   */
  update(): void {
    const hull = this.hull;
    const present = hull.present;
    if (present !== this.shownPresent) {
      this.shownPresent = present;
      this.body.setEnabled(present);
    }
    const p = hull.pos;
    this.body.position.set(p.x, p.y, p.z);
    this.body.rotation.y = hull.yaw;
    const s = hull.pose;
    const r = this.rig;
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

  /**
   * Takes the hull's drawing out of the world. Called only by
   * `VehicleViews`, which is to say once per map install.
   *
   * **Never `dispose(false, true)`.** Every material on this rig came out of
   * `CelMaterialFactory`'s shared per-colour cache (`mats.get`), which is the
   * same cache the WORLD is painted from — so the second flag disposes paint
   * that the map's own meshes are holding, and the factory hands the dead
   * material out again on the next `get` because nothing takes it back out of
   * the cache. The failure is silent and it is not local: a `ShaderMaterial`
   * that has been disposed never reports ready, and Babylon skips a mesh whose
   * material is not ready, so most of the city simply stops being drawn on the
   * second round of a map that has armour on it. The rig's meshes are this
   * hull's; the paint on them is everybody's.
   */
  dispose(): void {
    this.rig.root.dispose(false);
    this.body.dispose();
  }
}
