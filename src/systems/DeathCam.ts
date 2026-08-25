/**
 * DeathCam.ts — What the player watches after they are killed: a body standing
 * in for them, thrown by the round that did it, and a camera that leaves the
 * head to look at it.
 *
 * Owns two things and nothing else: ONE `SoldierRig` — the bot model, in the
 * player's own team colours — and, each frame, where the camera should be and
 * what it should be looking at. It owns no rules, no screen and not the respawn
 * clock; the cam's own clock runs here but `Game` is what reads it and moves the
 * state on, and `Game` is what hands `eye`/`look` to `CameraSystem.place`.
 *
 * Five things are load-bearing:
 *
 * - **The body is the BOT rig, deliberately.** There is no rigged character
 *   asset in this tree and there must not become one: standing up an imported
 *   body here would pull multiple megabytes into the production bundle for four
 *   seconds of screen time, which is the whole reason the first-person
 *   conversion dropped the one that used to exist. The bot rig is nine merged
 *   meshes, is already what `RAGDOLL_BONES` is measured against, and hands to
 *   `RagdollSystem` with nothing adapted.
 * - **It is a stand-in, not the player.** `Player` has no rig and never grows
 *   one: it is a capsule, a viewmodel and an eye. The corpse is a separate
 *   `RagdollSubject` stood up at the player's last position on the frame they
 *   die and hidden again when the cam ends, so nothing in movement, collision
 *   or hit detection ever gains a mesh to disagree with.
 * - **This body is never refused, and it needs no exception to say so.** Havok
 *   is required, the corpse is at the camera so the pool's one remaining
 *   refusal (distance) cannot reach it, and a full pool evicts its oldest
 *   corpse — which for the whole four seconds is never this one. The cam used
 *   to carry a `priority` flag and a collapse tween for the cases that answer
 *   made and the cases it did not; both are gone.
 * - **The camera's pull-in lives here**, and it is the only occlusion pick in
 *   the game outside combat. `CameraSystem` has none because the camera is
 *   normally inside the head and has nothing to be occluded by; a camera three
 *   metres behind a body that died against a wall has plenty. It is affordable
 *   because `Player.probeGround` — the frame's most expensive pick, ~2.5 ms —
 *   is not running while the player is dead.
 * - **Nothing here simulates.** The ragdoll is stepped by `RagdollSystem` from
 *   `Game.updateGameplay` like every other body; this file only says which body
 *   to throw and where to stand to watch it.
 */
import { Ray, Scene, Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { Team } from "../entities/Combatant";
import type { DamageKind } from "./CombatSystem";
import {
  animateSoldier,
  buildSoldier,
  resetSoldierPose,
  type RagdollSubject,
  type SoldierRig,
} from "../entities/SoldierModel";
import type { CelMaterialFactory } from "../shaders/CelShader";
import { SOLID_ONLY } from "../world/solid";

/**
 * The player's stand-in, as the ragdoll pool wants it.
 *
 * `alive` is false for the whole of its short life and is never flipped: it is
 * the pool's self-defence guard against a rig recycled out from under it, and
 * this rig belongs to nobody else, so there is nothing for it to defend
 * against. The cam retires the body explicitly instead.
 */
class Corpse implements RagdollSubject {
  readonly position = new Vector3();
  readonly center = new Vector3();
  readonly deathFrom = new Vector3();
  deathDamage = 0;
  deathKind: DamageKind = "bullet";
  ragdolling = false;
  readonly alive = false;

  constructor(readonly rig: SoldierRig) {}

  setEnabled(on: boolean): void {
    this.rig.root.setEnabled(on);
  }
}

export class DeathCam {
  /**
   * Wired by `Game`, because a system may not import another one. Both default
   * to a no-op, so an unwired cam still runs — it just frames a body that
   * stands where it was stood up, which is what the whole state exists to
   * avoid and is therefore a wiring bug rather than a mode.
   */
  onSpawnRagdoll: (subject: RagdollSubject) => void = () => {};
  onRetireRagdoll: (subject: RagdollSubject) => void = () => {};

  /** This frame's camera pose. `Game` hands both to `CameraSystem.place`. */
  readonly eye = new Vector3();
  readonly look = new Vector3();

  private corpse: Corpse | null = null;
  /** Which team the standing rig was built in; a team change is a rebuild. */
  private builtFor: Team | null = null;
  private running = false;
  /** Seconds since the killing round landed. */
  private t = 0;
  /** Where the orbit currently is, as a world yaw. */
  private orbit = 0;

  /** The eye and the look point at the instant of death, to ease out of. */
  private readonly fromEye = new Vector3();
  private readonly fromLook = new Vector3();
  /** The smoothed point on the body the shot is framed on. */
  private readonly anchor = new Vector3();

  // Scratch. This runs every frame of the cam; nothing below allocates.
  private readonly want = new Vector3();
  private readonly dir = new Vector3();
  private readonly ray = new Ray(new Vector3(), new Vector3(0, 0, 1), 1);

  constructor(
    private scene: Scene,
    private mats: CelMaterialFactory,
  ) {}

  /** True while the cam is up. `Game`'s `dying` state is exactly this. */
  get active(): boolean {
    return this.running;
  }

  /** Seconds the cam has been up, against `CONFIG.player.deathCam.time`. */
  get elapsed(): number {
    return this.t;
  }

  /** Which way the frame faces, for anything that keys off the view yaw. */
  get yaw(): number {
    return this.orbit + Math.PI;
  }

  /**
   * The body, for the blob shadow's sake — `Game` hands it to the same
   * `RagdollSystem.shadowFor` a bot's corpse goes through, so the player's
   * shadow ends up under the body rather than under the spot they were standing
   * in when they were shot. Null whenever the cam is down.
   */
  get subject(): RagdollSubject | null {
    return this.running ? this.corpse : null;
  }

  /**
   * Builds the rig, once, before it is needed. Called from `startRound` rather
   * than lazily at the moment of death for the reason `BattleSystem`'s pool is
   * built up front: `buildSoldier` allocates nine merged meshes and their GL
   * buffers, and the frame the player is killed on is the worst one in the
   * round to spend that on.
   *
   * A change of team is the one thing that rebuilds, and the rebuild has to go
   * through `stop()` first. The standing rig may be held by `RagdollSystem` at
   * that moment, whose proxy nodes are the PARENTS of the joints about to be
   * disposed — a slot left pointing at freed nodes would go on writing them for
   * the rest of the corpse's life and hand back a hierarchy that no longer
   * exists. Offline nothing reaches it: the player is team 0 every round, so
   * every call after the first is the early return above. A netplay welcome is
   * what reaches it — the authority can seat this client on team 1, and it can
   * say so with the cam already up, which is the case `stop()` covers. The cam
   * going down under `Game`'s `dying` state is safe by construction:
   * `updateDeathCam` ends that state on a cam that is no longer active exactly
   * as it does on one whose clock ran out.
   */
  prepare(team: Team): void {
    if (this.builtFor === team && this.corpse) return;
    this.stop();
    // Nodes only, never the materials: the body is painted from
    // `CelMaterialFactory`'s shared caches, so disposing them here takes the
    // paint out from under every bot on the field and the map with them. See
    // `Tank.dispose`.
    this.corpse?.rig.root.dispose(false);
    const rig = buildSoldier(this.scene, this.mats, team);
    rig.root.setEnabled(false);
    this.corpse = new Corpse(rig);
    this.builtFor = team;
  }

  /**
   * Stands a body up where the player fell and offers it to the physics pool.
   *
   * `from` is the shooter's eye or the blast centre — the same vector every
   * damage path in the game already carries — and it is what sends the body the
   * way the round was travelling. Without one, `RagdollSystem` reads the
   * zero-length direction and throws it straight up instead. `kind` is the
   * other half of the same fact and travels the same way: it is what decides
   * whether the player watches their own body fold where it stood or leave the
   * ground, and a player killed by a grenade should never be shown the first.
   *
   * `feet` is the player's FEET, not `Player.position`, which is the middle of
   * the collider capsule. `Player.floorY` is the height to use and is already
   * probed this frame, so it costs nothing.
   *
   * `crouch` is the player's own eased stance blend, and the body is posed in
   * it before it is offered. It is the same number `Player.syncCombatant` has
   * been spending all along — the eye, the hit sphere and now the corpse come
   * off one blend — so a player shot halfway into a crouch gets a body halfway
   * into one, standing exactly where the round that killed them found it.
   */
  start(
    feet: Vector3,
    yaw: number,
    eye: Vector3,
    forward: Vector3,
    from: Vector3 | undefined,
    damage: number,
    kind: DamageKind,
    crouch: number,
  ): void {
    if (!this.corpse) return;
    const corpse = this.corpse;
    const rig = corpse.rig;

    corpse.position.copyFrom(feet);
    // The CENTRE rides the stance and the ROOT does not, which is the same
    // split `NetPlayer` draws for a remote body: the crouch lives inside the
    // rig — `animateSoldier` drops the hips and plants the boots — so a root
    // pulled down with it would put the feet through the floor. The centre is
    // where the round landed and where the throw is aimed away from, so it goes
    // to the same place `Player.center` was on the frame of death.
    corpse.center.set(
      feet.x,
      feet.y +
        rig.centerHeight +
        (CONFIG.player.crouchCenterHeight - rig.centerHeight) * crouch,
      feet.z,
    );
    corpse.deathDamage = damage;
    corpse.deathKind = kind;
    if (from) corpse.deathFrom.copyFrom(from);
    else corpse.deathFrom.copyFrom(corpse.center);

    // A clean pose facing the way the player was, in the stance they were in,
    // so the throw starts from the shape they were in rather than from whatever
    // the last corpse left behind.
    resetSoldierPose(rig);
    animateSoldier(rig, 0, 0, 0, 0, crouch);
    rig.root.position.set(feet.x, feet.y + rig.centerHeight, feet.z);
    rig.root.rotation.y = yaw;
    corpse.setEnabled(true);

    this.running = true;
    this.t = 0;
    // Behind where the player was facing: the camera leaves along the axis the
    // eye was already on, which is what makes the hand-off read as being
    // knocked out of your own head rather than as a cut to a second camera.
    this.orbit = yaw + Math.PI;
    this.fromEye.copyFrom(eye);
    this.fromLook
      .copyFrom(forward)
      .scaleInPlace(CONFIG.player.deathCam.distance)
      .addInPlace(eye);
    rig.torso.computeWorldMatrix(true);
    this.anchor.copyFrom(rig.torso.getAbsolutePosition());
    this.eye.copyFrom(this.fromEye);
    this.look.copyFrom(this.fromLook);

    // Offered AFTER the pose is set, because the pool reads each joint's world
    // transform to place its proxies. This body is never refused — it is at
    // the camera, so the distance gate cannot touch it, and a full pool now
    // evicts its oldest corpse rather than saying no.
    this.onSpawnRagdoll(corpse);
  }

  /**
   * Ages the cam and works out where the camera goes. Called only from `Game`'s
   * `dying` branch, which sits inside the same `updateGameplay` the ragdoll is
   * stepped from — so a pause holds the shot exactly as it holds everything
   * else.
   */
  update(dt: number): void {
    if (!this.running || !this.corpse) return;
    const c = CONFIG.player.deathCam;
    const rig = this.corpse.rig;
    this.t += dt;

    // The chest, computed rather than read: outside the render loop
    // `getAbsolutePosition` returns a stale cache, and while the ragdoll owns
    // this joint its parent is a proxy node the solver moved this frame.
    rig.torso.computeWorldMatrix(true);
    const chest = rig.torso.getAbsolutePosition();
    chest.subtractToRef(this.anchor, this.dir);
    this.anchor.addInPlace(this.dir.scaleInPlace(Math.min(1, dt * c.followRate)));

    this.orbit += c.orbitRate * dt;
    this.want.set(
      this.anchor.x + Math.sin(this.orbit) * c.distance,
      this.anchor.y + c.height,
      this.anchor.z + Math.cos(this.orbit) * c.distance,
    );

    // Ease out of the head. BOTH ends move — the target slides from what the
    // player was looking at to the body itself — so the hand-off is one motion
    // rather than a position blend against a target that already snapped.
    const k = c.riseTime > 0 ? Math.min(1, this.t / c.riseTime) : 1;
    const e = k * k * (3 - 2 * k);
    Vector3.LerpToRef(this.fromEye, this.want, e, this.eye);
    Vector3.LerpToRef(this.fromLook, this.anchor, e, this.look);

    this.pullIn();
  }

  /**
   * Retires the body and drops the cam. Idempotent, and safe to call for a cam
   * that was never up — which is what lets `startRound` and `endRound` call it
   * unconditionally.
   */
  stop(): void {
    if (this.corpse) {
      this.onRetireRagdoll(this.corpse);
      // The pool restores the rig on release; this covers a cam that was never
      // wired to one, where the rig was never handed over in the first place.
      this.corpse.setEnabled(false);
      resetSoldierPose(this.corpse.rig);
    }
    this.running = false;
    this.t = 0;
  }

  dispose(): void {
    // Nodes only — see `prepare`.
    this.corpse?.rig.root.dispose(false);
    this.corpse = null;
    this.builtFor = null;
  }

  /**
   * Walks the camera in until it is on the same side of the wall as the body.
   *
   * One ray, and two things about it are deliberate. It is cast from the body
   * OUTWARD, never from the camera in: a ray the other way starts inside
   * whatever the camera has already backed into and reports the far face of it,
   * which walks the camera further into the stone rather than out of it. And it
   * starts at the ANCHOR — a real point on the body — rather than at `look`,
   * which during the rise is still partly the point the player was looking at
   * and can therefore be inside a wall they died facing. An origin that is
   * always in open space is what makes the answer always mean "the camera can
   * see the body".
   */
  private pullIn(): void {
    const c = CONFIG.player.deathCam;
    this.eye.subtractToRef(this.anchor, this.dir);
    const len = this.dir.length();
    if (len < 1e-4) return;
    this.dir.scaleInPlace(1 / len);
    this.ray.origin.copyFrom(this.anchor);
    this.ray.direction.copyFrom(this.dir);
    this.ray.length = len;
    // Collider proxies only, so the corpse's own meshes — and every other
    // visual — are transparent to it. `SOLID_ONLY` rather than the shot ray's
    // `OPAQUE_ONLY`, because this asks where the camera may SIT, not what it
    // can see through: a porous box is still somewhere a camera should not be
    // parked, and stopping short of a fence costs four seconds of a view that
    // was see-through anyway.
    const hit = this.scene.pickWithRay(this.ray, SOLID_ONLY);
    if (!hit || !hit.hit) return;
    const allow = Math.max(c.minDistance, hit.distance - c.wallMargin);
    if (allow >= len) return;
    this.eye.copyFrom(this.anchor).addInPlace(this.dir.scaleInPlace(allow));
  }
}
