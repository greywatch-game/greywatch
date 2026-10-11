/**
 * BotRig.ts — the drawn half of one pooled `Bot`: its `SoldierRig`, and the
 * only thing that writes a node on it while the bot lives.
 * Owns: the rig (built once with the pool slot, disposed with it), the
 * root's placement, the pose written onto the joints, the launcher's tube,
 * whether the root is enabled, and `ragdolling` — the one fact about a body
 * that only a picture can have.
 * Reads the `Bot` and NEVER writes it: the root is the bot's own
 * `rootX`..`rootYaw`, the pose is `Bot.solved`, and whether it is in the world
 * is `Bot.shown`. The one call that looks like a write — `solved` — fills a
 * cache of a pure function of the pose, which the muzzle reads the same way.
 * Invariants:
 * - **It implements `RagdollSubject`, and the bot does not.** `RagdollSystem`
 *   reparents this rig's joints onto Havok proxies and writes the root's
 *   height while it sinks, so while `ragdolling` is set nothing here writes
 *   the root or the pose — two writers on one node is the trap.
 * - **A new `life` puts the rig back in its rest pose with
 *   `resetSoldierPose`** before either writer (`follow`, `catchUp`) poses it,
 *   ragdoll or not, at any distance — never a bare pose
 *   write: a corpse leaves residue in the parent, the quaternion and the
 *   scaling, and a quaternion left behind freezes the bot for the round (the
 *   quaternion leak, `docs/deaths.md`).
 * - The root is switched and never the meshes: `WorldCulling` keys a body's
 *   candidacy on the ROOT the roster switches, and `BodyShadows` skips a
 *   disabled root.
 * Never builds anything per frame. `BattleView` holds the pool of these.
 */
import type { Scene } from "@babylonjs/core";
import type { Vector3Like } from "../math";
import type { CelMaterialFactory } from "../shaders/CelShader";
import type { DamageKind } from "../systems/CombatSystem";
import type { Bot } from "./Bot";
import {
  buildSoldier,
  poseSoldier,
  resetSoldierPose,
  type RagdollSubject,
  type SoldierRig,
} from "./SoldierModel";

export class BotRig implements RagdollSubject {
  readonly rig: SoldierRig;
  /**
   * True while `RagdollSystem` owns this rig's joints. Nothing here writes the
   * root or the pose in that window — see the header. Cleared by the pool when
   * it hands the rig back, and by a new `life` as a belt to its braces: a rig
   * handed back late must never come up with a live body still claiming its
   * joints.
   */
  ragdolling = false;
  /** The bot's `life` this rig was last put in its rest pose for. */
  private life: number;
  /** Whether the tube on the back is showing — `Bot.launcher`, last seen. */
  private tube: boolean;

  constructor(
    scene: Scene,
    mats: CelMaterialFactory,
    readonly bot: Bot,
  ) {
    // The side is the VIEWER's read of the bot's team, chosen here for good:
    // the kits differ in silhouette as well as in hue (`core/teamView.ts`).
    this.rig = buildSoldier(scene, mats, bot.team);
    this.rig.root.setEnabled(false);
    this.tube = bot.launcher;
    this.rig.launcher.setEnabled(this.tube);
    this.life = bot.life;
    this.placeRoot();
  }

  // --- RagdollSubject: the bot's own numbers, read through --------------------

  get position(): Vector3Like {
    return this.bot.position;
  }
  get center(): Vector3Like {
    return this.bot.center;
  }
  get deathFrom(): Vector3Like {
    return this.bot.deathFrom;
  }
  get deathDamage(): number {
    return this.bot.deathDamage;
  }
  get deathKind(): DamageKind {
    return this.bot.deathKind;
  }
  get alive(): boolean {
    return this.bot.alive;
  }

  /**
   * The root's switch. `RagdollSystem` throws it on (a corpse is worth
   * simulating only while it is drawn) and off (handing a corpse back);
   * `follow` re-derives it every frame from the bot and the camera, so neither
   * outlasts the next one.
   */
  setEnabled(on: boolean): void {
    this.rig.root.setEnabled(on);
  }

  /**
   * One frame of the picture, after the simulation has stepped.
   *
   * Drawn while the bot is in the world (`shown`) or a ragdoll holds the
   * corpse, and inside `viewDistance` — past it there is nothing to see, so the
   * root is switched off and the walk never offers a mesh of it. Posed only
   * inside `freezeDistance` and only while alive: past it a body nobody can
   * make out holds its last drawn pose.
   */
  follow(eye: Vector3Like, viewDistance: number, freezeDistance: number): void {
    const bot = this.bot;
    this.syncLife();
    if (bot.launcher !== this.tube) {
      this.tube = bot.launcher;
      this.rig.launcher.setEnabled(this.tube);
    }
    if (!this.ragdolling) this.placeRoot();
    const dx = bot.position.x - eye.x;
    const dy = bot.position.y - eye.y;
    const dz = bot.position.z - eye.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const drawn = (bot.shown || this.ragdolling) && d <= viewDistance;
    this.rig.root.setEnabled(drawn);
    if (drawn && bot.alive && !this.ragdolling && d < freezeDistance) {
      poseSoldier(this.rig, bot.solved);
    }
  }

  /**
   * The root and the pose brought up to the bot NOW, whatever the distance —
   * for a body about to be handed to `RagdollSystem`, which builds the corpse
   * from where the joints stand in the world at that moment. `follow` runs
   * once a frame after the fight, and a body can die between two of them in a
   * place it has only just been put: a crewman set down beside his burning
   * hull (`Bot.nudgeTo`) and killed on the same line.
   */
  catchUp(): void {
    // The new life FIRST, here as in `follow`: a bot put back and killed in
    // one `battle.update` reaches this before any `follow` has seen the new
    // life, and a reset left for that `follow` would land after
    // `RagdollSystem` had taken the joints — clearing `ragdolling` and
    // reparenting them off the proxies under a slot still holding the corpse,
    // which then stands to attention until it sinks.
    this.syncLife();
    if (this.ragdolling) return;
    this.placeRoot();
    poseSoldier(this.rig, this.bot.solved);
  }

  /** Switched off at once — the round being reset under it. */
  hide(): void {
    this.rig.root.setEnabled(false);
  }

  /**
   * Frees the rig. The flag it does NOT pass is the load-bearing half: a
   * soldier is painted out of `CelMaterialFactory`'s shared caches
   * (`mats.get`, `mats.getEmissive`), so disposing this rig's materials would
   * dispose the paint every other body and the map itself are holding, and
   * the factory would hand the dead material out again on the next `get`. See
   * `VehicleView.dispose`, where the same flag took most of a city off the screen.
   */
  dispose(): void {
    this.rig.root.dispose(false);
  }

  /**
   * A new `life` is a rig back in its rest pose, before anything writes a
   * pose onto it — so BOTH writers call this first. The authoritative
   * restore: parents, positions, rotations, quaternions and scalings on every
   * posed node — whatever the last life ended in, the pose a corpse settled
   * in or the stride it was refused a fall mid-way through. At every
   * distance, or a bot respawning past the freeze walks around in a dead
   * man's shape until the camera closes in.
   */
  private syncLife(): void {
    if (this.bot.life === this.life) return;
    this.life = this.bot.life;
    this.ragdolling = false;
    resetSoldierPose(this.rig);
  }

  /**
   * The bot's root, unchanged: the centre over the feet and the feet's yaw,
   * which is also the root its muzzle is replayed from. It does not move with
   * the crouch — the stance lives inside the rig.
   */
  private placeRoot(): void {
    const bot = this.bot;
    this.rig.root.position.set(bot.rootX, bot.rootY, bot.rootZ);
    this.rig.root.rotation.y = bot.rootYaw;
  }
}
