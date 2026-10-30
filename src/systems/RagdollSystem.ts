/**
 * RagdollSystem.ts — Physics-driven deaths: a pool of corpses, and the hand-off
 * of a rig's joints to the solver and back.
 * Owns the pool, the bone bodies, the constraints and the proxies. It does NOT
 * own the engine — `PhysicsWorld` does, and hands it in — so this file no longer
 * names `@babylonjs/havok`, builds the static map, or steps anything. See that
 * file's header for why the split exists.
 *
 * It holds `RagdollSubject`s, not `Bot`s, and deliberately cannot tell the
 * kinds apart: a body's rig killed in the fight (`NetSoldier` — a `Bot` is
 * simulation and has no rig) and the stand-in body `DeathCam` stands up where
 * the player fell are the same thing to this file. Every rule
 * below applies to both, which is what stopped the player's corpse needing a
 * second copy of any of it.
 *
 * **Two halves, one file.** The PHYSICS half is
 * the bodies, the constraints, the impulses and every spawn, freeze, park and
 * eviction decision, and it holds a bone's pose as `WorldBody.pose` — seven
 * plain numbers `PhysicsWorld` steps. The VIEW half is the proxies and the
 * rig: it writes those numbers onto each bone's proxy (`drawSlot`,
 * `poseView.applyPose`) at the points something reads the drawing — the top
 * of `update`, which `Game` runs straight after the step and which is where
 * `freeze` hands the joints back off the proxies' poses; the moment `spawn`
 * places a proxy, before the joint is hung on it; and `park` — so
 * `shadowFor`, the render and every hand-off see the nodes the solver's own
 * per-substep sync used to leave (`plans/physics-ref/clients.mjs` hashes
 * those nodes, and the rig's joints, bit for bit).
 *
 * Invariants, each of which has a way of failing silently:
 * - Havok never touches a rig joint, and touches no node at all: the view
 *   writes POOL-OWNED PROXY nodes, and the rig's joints — our own hierarchy
 *   since `BABYLON_EXIT.md` X4.1a (`rigJoints.ts`) — HANG ON those
 *   (`JointTree.hold`, handed back by `release`), each hand-off a replay of
 *   Babylon's `setParent`, so a frozen corpse is the locals a node's would
 *   have been, to the bit. A proxy is unparented and owns the one
 *   `rotationQuaternion` near the rig. A holder left on a joint is the leak to
 *   fear — a respawned bot whose limbs stay where the corpse lay for the rest
 *   of the round — which is why `resetSoldierPose` clears every one. X4.1b
 *   deletes the hand-off: a corpse's joints then come straight off the poses.
 * - A proxy is composed by NOTHING but this file: no Babylon mesh hangs under
 *   it since the joints left the scene, so a read of its matrix is FORCED
 *   (`applyImpulse`), as `setParent` forced it when a node was hung there.
 * - Nothing here feeds navigation, cover, or hit detection. A corpse is not in
 *   `NavGrid`, not in `ObstacleField`, not in `hittablesAgainst`. Bots walk
 *   through bodies and rounds pass through them, exactly as they did before
 *   this file existed. Do NOT "fix" that by feeding corpses into
 *   `ObstacleField` — its buckets are baked at map load for a reason.
 * - It is strictly cosmetic, and it is no longer optional. Havok is required
 *   (see `PhysicsWorld`), so the three refusals that were about the engine
 *   having arrived are gone along with the collapse tween that answered them.
 *   **What is left is ONE refusal: a death past `viewDistance`**, which is the
 *   fog wall, which is where the rig stops being drawn — so nothing the player
 *   can see is ever refused a fall. The pool being full is not a refusal any
 *   more either: `takeSlot` ends by evicting the OLDEST corpse, which was the
 *   death cam's exception and is now everyone's. See it for why that is safe.
 * - **A round DROPS a body and an explosion THROWS it, and they are not one
 *   number scaled.** A round is a newton-second on the chest; a blast is a SPEED
 *   spent on every bone at once, because the same throw on the 34 kg chest alone
 *   drags eleven bones through their constraints to catch up. `subject.deathKind`
 *   picks and the test is "not a bullet or a burn"; how far it flies is the falloff-scaled
 *   `deathDamage` the corpse already recorded, so a blast's `power` is left
 *   alone. See `applyImpulse`.
 * - The sim is a FIXED step with a CARRIED remainder, so a tumble is identical
 *   at 30, 60 and 144 fps and reproducible headless, where `dt` is clamped to
 *   0.05. That clock is `PhysicsWorld`'s now; what stays here is the half that
 *   depends on it — `afterFirstStep` is this file's share of the teleport
 *   read-in, and it is per client precisely because each owns its own bodies.
 */
import { Quaternion, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import {
  Quaternion as PoseQuaternion,
  Vector3 as PoseVector3,
} from "../math";
import { CONFIG, FOG_WALL } from "../config";
import {
  jointPosition,
  RAGDOLL_BONES,
  RAGDOLL_LINKS,
  resetSoldierPose,
  type BoneJoint,
  type RagdollSubject,
  type SoldierRig,
} from "../entities/SoldierModel";
import { mulberry32 } from "../world/rng";
import type { AxisLimit, ShapeId } from "./havok";
import type { PhysicsClient, PhysicsWorld, WorldBody } from "./PhysicsWorld";
import { absolutePose, applyPose, storePose } from "./poseView";

/** One bone of one pooled corpse. */
interface Bone {
  joint: BoneJoint;
  /**
   * The bone as DRAWN: the view writes the body's pose onto it, and the rig's
   * joint is parented to it while the corpse is live. Unparented, so a pose
   * is its raw transform (`poseView`).
   */
  proxy: TransformNode;
  /**
   * On Havok's raw API, through `PhysicsWorld`;
   * where the bone IS is `body.pose`, which the proxy is drawn from.
   */
  body: WorldBody;
  /**
   * `RAGDOLL_BONES`' own mass, kept because a blast's throw is a SPEED and an
   * impulse is what Havok takes — see `applyImpulse`. Copied rather than read
   * back off the body, which would be a `getMassProperties` allocation per bone
   * on the frame somebody was killed.
   */
  mass: number;
}

/** One corpse's worth of bodies, reused for the life of the process. */
interface Slot {
  bones: Bone[];
  /** Null when the slot is free. */
  subject: RagdollSubject | null;
  rig: SoldierRig | null;
  /** Seconds since this corpse was taken. */
  t: number;
  /** Seconds the whole body has been under `sleepSpeed`. */
  stillT: number;
  /**
   * True once the pose is baked back into the rig's hierarchy and the bodies
   * have stopped. A frozen corpse is still a corpse — it lies there costing one
   * property write — which is why this is NOT the same thing as `sinking`.
   */
  frozen: boolean;
  /**
   * True once the body has started going. This is the one that makes a slot
   * reclaimable: a corpse on its way out may be cut short, a corpse merely
   * lying still may not.
   */
  sinking: boolean;
  /** `rig.root.position.y` when the sink started, so the drop is absolute. */
  sinkFromY: number;
}

const UP = new Vector3(0, 1, 0);

/** Where a body waits between corpses — see `park`. */
const PARKED_Y = -1000;
/** That place as a pose: under the map, unturned (`Quaternion.Identity()`). */
const PARKED_POSE = [0, PARKED_Y, 0, 0, 0, 0, 1];

/**
 * The pool's own stream, re-seeded per round. It is deliberately NOT the
 * subject's: `Bot.rand` also drives grenade chance, throw scatter and strafe
 * direction, so drawing the tumble's jitter from it made a bot's BEHAVIOUR
 * depend on whether a corpse near it was accepted — which turns on the camera
 * distance and, back when there were three more ways to be refused, on the
 * settings toggle and whether the WASM had loaded. A seeded round has to play
 * out the same way twice, and that is the one thing the seed is for.
 */
const SPIN_SEED = 0x5eed;

export class RagdollSystem implements PhysicsClient {
  /**
   * Past this a body is not worth tumbling, because it is not worth drawing —
   * the map's body draw distance, pushed by `Game.installMap` beside the same
   * number going to `NetRoster`. It is where the rig stops being drawn by
   * construction rather than by coincidence (see `config/fogWall.ts`), and
   * the construction is that both are
   * handed one number resolved once (`bodyDrawDistanceOf`); `CONFIG` holds
   * what a map with no opinion gets.
   *
   * That number is the map's `fogEnd` unless it states an
   * `EnvironmentSpec.bodyDrawDistance` — which is the case this construction
   * was always protecting against, arriving: a shorter gate for bodies pulls
   * the rig LOD in, and a corpse refused a tumble somewhere its own rig is
   * still drawn would stand to attention until `death.hideTime`.
   */
  private viewDistance = FOG_WALL;
  /** The tumble's jitter. See `SPIN_SEED`. */
  private rand: () => number = mulberry32(SPIN_SEED);

  private slots: Slot[] = [];

  // Scratch — this runs every frame with up to `maxConcurrent` corpses live,
  // and the frame already carries allocation churn (`docs/profiling.md`, "The
  // heap and the collector").
  private readonly v1 = new Vector3();
  private readonly v2 = new Vector3();
  // A joint's world, decomposed: the rig's matrices are `src/math`'s.
  private readonly jointAt = new PoseVector3();
  private readonly jointScale = new PoseVector3();
  private readonly jointQuat = new PoseQuaternion();

  /**
   * The engine, INJECTED rather than owned. See `PhysicsWorld`'s header for why
   * the split exists and why it is a constructor argument — briefly: the step
   * used to run only while a corpse was falling, and the ragdoll setting used
   * to tear the static world down, so neither could survive a second client.
   *
   * This is the `BattleSystem`←`CombatSystem` precedent: `Game` still owns the
   * wiring, and a system may hold another it was handed.
   */
  constructor(
    private scene: Scene,
    private physics: PhysicsWorld,
  ) {
    physics.register(this);
    // Built HERE, and it can be because the engine is up before `Game` is
    // constructed. It used to wait for a `physicsStarted` callback that only
    // existed because the WASM might still be in flight.
    this.buildPool();
  }

  /** How many corpses are simulating. Test hook. */
  get activeCount(): number {
    return this.slots.reduce((n, s) => n + (s.subject ? 1 : 0), 0);
  }

  // --- PhysicsClient --------------------------------------------------------

  /** Whether any corpse still owes the solver time. */
  physicsActive(): boolean {
    return this.slots.some((s) => s.subject && !s.frozen);
  }

  /**
   * The teleport read-in, one step into the frame and no further. See
   * `PhysicsClient.afterFirstStep` for why it is inside the substep loop.
   */
  afterFirstStep(): void {
    for (const slot of this.slots) {
      if (!slot.subject || slot.frozen) continue;
      for (const bone of slot.bones) bone.body.teleport = false;
    }
  }

  /** The ground went away: hand every rig back before its bodies vanish. */
  worldCleared(): void {
    this.reset();
  }

  /** See `viewDistance`. Pushed with the map, not read from CONFIG. */
  setViewDistance(metres: number): void {
    this.viewDistance = metres;
  }

  /**
   * Offer a dead body to the pool. Returns whether it was taken, which callers
   * are free to ignore: there is nothing to do instead any more.
   *
   * **The distance is the whole of the refusal**, and it is sampled ONCE, here:
   * a corpse does not move, and re-testing per frame would switch a tumble off
   * halfway through because the player backed away from it. Past
   * `viewDistance` the rig is not drawn at all, so what is refused is a body
   * nobody can see. Every subject is a `NetSoldier` or the death cam's
   * stand-in, and a refused `NetSoldier` keeps the stance it was hit in and
   * hides itself when its death progress off the wire reaches 1
   * (`NetSoldier`'s `dead >= 1` branch).
   */
  spawn(subject: RagdollSubject, camPos: Vector3): boolean {
    // There is a map to land on. The only thing `PhysicsWorld` can still say
    // no to, and it says it between a map being disposed and the next one
    // being built — which is not a window anything dies in, but a body spawned
    // in it would fall for ever.
    if (!this.physics.hasWorld || this.slots.length === 0) return false;
    // By fields: a subject's vectors are typed `Vector3Like` (`RagdollSubject`),
    // which admits `src/math`'s as well as Babylon's, and Babylon's `Distance`
    // reads `_x` (the NaN trap, `src/math/vector.ts`).
    const gx = subject.position.x - camPos.x;
    const gy = subject.position.y - camPos.y;
    const gz = subject.position.z - camPos.z;
    if (Math.sqrt(gx * gx + gy * gy + gz * gz) > this.viewDistance) {
      return false;
    }
    // A body already held is not offered twice. Each death has one caller
    // (`NetRoster.onDeath` for every body off the wire, the death cam) and fires
    // once, but a rig in two slots would be two sets of
    // bodies fighting over the same joints.
    if (subject.ragdolling || this.slots.some((s) => s.subject === subject)) {
      return false;
    }
    // A crouched body is NOT refused, and the bone table is what earns that.
    // A leg was one rigid 0.72 m segment oriented by the hip joint until it had
    // a knee and an ankle of its own, and a body caught mid-crouch would have
    // been thrown with two planks sticking forward out of its hips, propping a
    // corpse up off geometry its own drawn legs were nowhere near. There was no
    // pose that fixed it — straight legs under lowered hips reach through the
    // floor, and lifting the hips to meet them is half a metre of pop on the
    // frame of death — so the refusal stood in for the missing joints. The
    // joints exist now (`RAGDOLL_BONES`), the proxies below take whatever pose
    // the rig is in, and the one stance a player is most likely to be shot in
    // falls over like every other.
    const slot = this.takeSlot();
    if (!slot) return false;

    const rig = subject.rig;
    slot.subject = subject;
    slot.rig = rig;
    slot.t = 0;
    slot.stillT = 0;
    slot.frozen = false;
    slot.sinking = false;
    slot.sinkFromY = rig.root.position.y;
    subject.ragdolling = true;
    // The rig must be visible for the corpse to be worth simulating; the
    // roster's LOD (`NetRoster`) keeps it on every frame while this pool holds it.
    subject.setEnabled(true);

    const hp = this.physics.havok;
    for (const bone of slot.bones) {
      const joint = rig[bone.joint];
      // Place the bone exactly where the joint currently is in the world, so
      // the ragdoll starts in the pose the bot died in rather than in a T-pose
      // — into the body's pose, which the next substep teleports from, and
      // onto the proxy at once, because the joint is hung off it next. The
      // world is composed FRESH, the bones already hung on this offer
      // included, as `computeWorldMatrix(true)` composed it off the nodes.
      rig.tree
        .computeChain(joint)
        .decompose(this.jointScale, this.jointQuat, this.jointAt);
      storePose(bone.body.pose, this.jointAt, this.jointQuat);
      applyPose(bone.body.pose, bone.proxy);
      // Hang the joint on the proxy (`JointTree.hold`): its world kept and its
      // local re-derived exactly as `TransformNode.setParent` did, Euler and
      // all, so the hand-back is the same arithmetic the other way.
      rig.tree.hold(joint, bone.proxy);

      // The body is pooled and still carries the last corpse's motion.
      hp.setLinearVelocity(bone.body.id, [0, 0, 0]);
      hp.setAngularVelocity(bone.body.id, [0, 0, 0]);
      this.physics.setMotion(bone.body, "dynamic");
      // Two-phase teleport: one step reads the pose into the sim, then the sim
      // owns it (`afterFirstStep`). A kinematic target the body accelerates
      // toward is NOT this.
      bone.body.teleport = true;
    }

    this.applyImpulse(slot, subject);
    return true;
  }

  /**
   * Ages every corpse, sinks the settled ones and retires them.
   *
   * **It does not step the engine.** `PhysicsWorld.update` does, and it must
   * have run for this frame before this is called: a corpse tested for
   * stillness before its own step would be tested on last frame's velocities.
   * `Game` orders the two, which is the whole reason the step left this file.
   *
   * Called ONLY from a gameplay path, which is what holds the whole thing still
   * under a pause and under the deploy screen.
   */
  update(dt: number): void {
    const d = CONFIG.bots.death;

    // The view, FIRST: every live corpse's proxies onto where the step just
    // left its bones, before anything below reads them — `freeze` hands
    // the joints off the proxies' world matrices.
    for (const slot of this.slots) if (slot.subject && !slot.frozen) this.drawSlot(slot);

    for (const slot of this.slots) {
      if (!slot.subject || !slot.rig) continue;
      // The rig was recycled out from under us. It should not be possible —
      // a corpse is gone at `sinkStart + sinkTime` (6 s) and Conquest wants
      // the rig at `respawnDelay` (8 s) — but the failure if it ever were is
      // a slot re-parenting a LIVE bot's joints for the rest of the round, so
      // it is checked here rather than left to that margin holding.
      if (slot.subject.alive) {
        this.release(slot);
        continue;
      }
      slot.t += dt;
      // Stop simulating as soon as it has come to rest, or at the hard stop.
      if (!slot.frozen && (this.hasSettled(slot, dt) || slot.t > d.settleTime)) {
        this.freeze(slot);
      }
      if (slot.t < d.sinkStart) continue;
      // Its time is up. Freezing first is what makes the sink one write.
      if (!slot.frozen) this.freeze(slot);
      if (!slot.sinking) {
        slot.sinking = true;
        slot.sinkFromY = slot.rig.root.position.y;
      }
      const k = Math.min(1, (slot.t - d.sinkStart) / d.sinkTime);
      // Eased, so the body starts going rather than dropping on one frame.
      slot.rig.root.position.y = slot.sinkFromY - d.sinkDepth * k * k;
      if (k >= 1) this.release(slot);
    }
  }

  /**
   * Where a downed body's shadow goes, and how strong. 0 means "not mine" —
   * which is every bot this system is not holding, so an unwired `ShadowSystem`
   * behaves exactly as it did before.
   *
   * It reads the DRAWN torso, and needs no draw of its own: the view is
   * written at the top of `update`, which `Game.stepAftermath` runs straight
   * after the step, so there is no point in a frame at which a body has moved
   * and its proxy has not.
   */
  shadowFor(subject: RagdollSubject, out: Vector3): number {
    const slot = this.slots.find((s) => s.subject === subject);
    if (!slot || !slot.rig) return 0;
    const d = CONFIG.bots.death;
    jointPosition(slot.rig, slot.rig.torso, out);
    if (slot.t <= d.sinkStart) return 1;
    // Fades with the body rather than snapping off under it.
    return Math.max(0, 1 - (slot.t - d.sinkStart) / d.sinkTime);
  }

  /**
   * Drops ONE body early, if this pool is holding it. Idempotent, and a no-op
   * for a body it never took — so a caller may offer and retire without ever
   * checking whether the offer landed.
   *
   * A bot never needs this: its corpse outlives the death cam's whole window
   * and retires on its own clock. The player's does, because the deploy screen
   * comes up over the top of it and a body left lying there would come back
   * mid-sink on the next life.
   */
  retire(subject: RagdollSubject): void {
    const slot = this.slots.find((s) => s.subject === subject);
    if (slot) this.release(slot);
  }

  /**
   * Drops every corpse and restores every rig. Round start and map rebuild.
   *
   * Re-seeds the jitter with it, so the same round twice throws its bodies the
   * same way — the stream is the pool's, so the only thing it could otherwise
   * carry across is how many people died last round.
   */
  reset(): void {
    for (const slot of this.slots) if (slot.subject) this.release(slot);
    this.rand = mulberry32(SPIN_SEED);
  }

  // --- construction -------------------------------------------------------

  /**
   * One shape per bone for ONE slot, in that slot's own collision group.
   *
   * Per slot rather than one set shared by every corpse, and the group is why.
   * A ragdoll's own bones overlap by construction — a folded leg lies the shin
   * along the thigh and puts the boot inside it — so a corpse that collided
   * with itself would spend the frame it was thrown on shoving its own limbs
   * apart. Filtering is the only way to say that: the mask lives on the SHAPE,
   * so a shape shared between slots could only turn every corpse's
   * self-collision off together with every corpse-against-corpse one, and two
   * bodies landing on each other is worth keeping. Bit 0 is left to the world
   * (`WORLD_GROUP`, Havok's default membership), so slot `i` takes bit `i + 1`
   * and collides with everything except itself.
   *
   * The wrap at 30 is a backstop, not a design: past thirty slots two corpses
   * would share a group and pass through each other, which is the mildest
   * failure available and far better than shifting into the sign bit.
   */
  private buildShapes(slot: number): Map<BoneJoint, ShapeId> {
    const d = CONFIG.bots.death;
    const hp = this.physics.havok;
    const group = 1 << (1 + (slot % 30));
    const shapes = new Map<BoneJoint, ShapeId>();
    for (const bone of RAGDOLL_BONES) {
      // Centred on `center` in the bone's own space, which is what offsets
      // each bone's centre of mass from its joint. FULL extents.
      const [cx, cy, cz] = bone.center;
      const [sx, sy, sz] = bone.size;
      const shape = hp.box([cx, cy, cz], [0, 0, 0, 1], [sx, sy, sz]);
      hp.setMaterial(shape, d.friction, d.restitution);
      hp.setFilterMembership(shape, group);
      // Written unsigned, because this crosses into the WASM as a uint32. It
      // reads back out of Havok as the same bits signed (-3 for slot 0), and
      // both forms answer a `&` test identically.
      hp.setFilterCollide(shape, ~group >>> 0);
      shapes.set(bone.joint, shape);
    }
    return shapes;
  }

  private buildPool(): void {
    const d = CONFIG.bots.death;
    const hp = this.physics.havok;
    for (let i = 0; i < d.maxConcurrent; i++) {
      const shapes = this.buildShapes(i);
      const bones: Bone[] = RAGDOLL_BONES.map((spec) => {
        const proxy = new TransformNode(`ragdoll${i}-${spec.joint}`, this.scene);
        // Pre-created so the view (`applyPose`) only ever copies into it — the
        // one place a quaternion is allowed to exist anywhere near this rig.
        proxy.rotationQuaternion = Quaternion.Identity();
        proxy.position.y = PARKED_Y;
        // Created where the proxy stands, static, then shaped, weighed and
        // damped: the plugin's calls in its order (`PhysicsWorld.addBody`).
        // The pool is built before the debris pools, so these are the first
        // client bodies in the world's table, as they were in the plugin's.
        const body = this.physics.addBody("static", absolutePose(proxy));
        hp.setShape(body.id, shapes.get(spec.joint)!);
        hp.setMass(body.id, spec.mass);
        hp.setLinearDamping(body.id, d.linearDamping);
        hp.setAngularDamping(body.id, d.angularDamping);
        return { joint: spec.joint, proxy, body, mass: spec.mass };
      });

      const byJoint = new Map(bones.map((b) => [b.joint, b]));
      for (const [joint, link] of Object.entries(RAGDOLL_LINKS)) {
        if (!link) continue;
        const child = byJoint.get(joint as BoneJoint);
        // The bone this one hangs off, which is the chest for everything above
        // the hips and the segment above for a knee and an ankle. Pinning the
        // whole leg to the chest instead would hold a shin at a fixed offset
        // from the ribs and let it swing there — a corpse whose knee is a
        // second hip.
        const parent = byJoint.get(link.parent);
        if (!child || !parent) continue;
        // The three linear axes are pinned (a range of exactly zero, which
        // Havok is told as LOCKED) and the three angular ones are ranges.
        const limits: AxisLimit[] = [
          { axis: "LINEAR_X", min: 0, max: 0 },
          { axis: "LINEAR_Y", min: 0, max: 0 },
          { axis: "LINEAR_Z", min: 0, max: 0 },
          { axis: "ANGULAR_X", min: link.x[0], max: link.x[1] },
          { axis: "ANGULAR_Y", min: link.y[0], max: link.y[1] },
          { axis: "ANGULAR_Z", min: link.z[0], max: link.z[1] },
        ];
        const [px, py, pz] = link.pivot;
        hp.sixDof(
          parent.body.id,
          child.body.id,
          // Identical axes on both sides: every joint is at identity relative
          // to its parent in the carried pose, so the standing pose is the
          // ZERO of all three angular axes and the limits read as plain ranges
          // rather than offsets from an authored rest angle.
          { pivot: [px, py, pz], axis: [1, 0, 0], perp: [0, 1, 0] },
          { pivot: [0, 0, 0], axis: [1, 0, 0], perp: [0, 1, 0] },
          limits,
          // Constrained bodies overlap by construction; letting them collide
          // is what makes a ragdoll jitter itself apart.
          false,
        );
      }

      this.slots.push({
        bones,
        subject: null,
        rig: null,
        t: 0,
        stillT: 0,
        frozen: false,
        sinking: false,
        sinkFromY: 0,
      });
    }
  }

  // --- lifetime -----------------------------------------------------------

  /**
   * A free slot, then a sinking one, and failing both the OLDEST corpse — so a
   * body inside the view distance is never refused a fall.
   *
   * The three tiers are in that order because each is a worse thing to spend
   * than the one before it, and only the last of them costs anything at all.
   *
   * **The eviction used to be the death cam's private exception**, passed as a
   * `priority` flag from one wiring site, because a bot's corpse is one of
   * sixteen bodies somewhere on screen while the player's is the sole subject
   * of a four-second shot. Being refused was not rare: a slot is held for the
   * whole `sinkStart` (5 s) before it becomes reclaimable, so four nearby
   * deaths inside five seconds lock the pool — and a player who has just fought
   * hard enough to be killed is usually standing in exactly that. Measured at
   * the time: a corpse 0.65 m from the camera refused outright, and accepted on
   * the same offer once the four bot corpses had aged past `sinkStart`.
   *
   * It is everyone's now, because the tween that a refused bot fell back to is
   * gone and a refusal would leave a body standing to attention in plain sight.
   * **Taking the oldest is what makes that safe rather than arbitrary**: it is
   * the corpse nearest its own sink and so the one with least left to lose, and
   * it protects the death cam's body for free — that body is the freshest in
   * the pool for the whole four seconds the camera is on it, so it is the last
   * one this can reach. The rule it gives up is `GrenadeSystem`'s "refuse
   * rather than steal a live slot", and it gives it up knowingly: a corpse
   * yanked mid-tumble is a pop, but so is a corpse that never fell, and only
   * one of the two happens under a pool eight deep.
   */
  private takeSlot(): Slot | null {
    const free = this.slots.find((s) => !s.subject);
    if (free) return free;
    // A corpse already going is committed to vanishing, so it is the cheapest
    // thing to cut short — cheaper than one that has settled where the player
    // can see it lying.
    const sinking = this.slots.find((s) => s.sinking);
    if (sinking) {
      this.release(sinking);
      return sinking;
    }
    if (this.slots.length === 0) return null;
    let oldest = this.slots[0];
    for (const s of this.slots) if (s.t > oldest.t) oldest = s;
    this.release(oldest);
    return oldest;
  }

  /**
   * The throw, and it is TWO throws with one direction between them.
   *
   * **A round is a blow and an explosion is a velocity**, which is the whole of
   * the split and the reason it is not a multiplier. A rifle round lands at a
   * point: `imp` is a newton-second on the chest, applied `lift` above the
   * centre of mass so the fold falls out of the geometry, and the eleven other
   * bones follow because they are hanging off it. A blast arrives on all of a
   * body at once, so `imp.blast` is a SPEED spent as `speed * mass` on every
   * bone at its own origin — every one of them leaves at the same velocity and
   * nothing is dragged through a joint to catch up. Putting a blast's whole
   * throw on the 34 kg chest instead is the same corpse with its limbs trailing
   * a metre behind it, which is a body coming apart rather than one thrown.
   *
   * **How far it flies is `deathDamage` and nothing else needed plumbing for
   * it**: `GrenadeSystem.blastAt` scales its damage by the falloff before
   * `takeDamage` ever sees it, so what a corpse recorded is already the
   * strength of the explosion AT THE PLACE IT WAS STANDING. A frag at the feet
   * throws further than one across the street, and a tank shell throws further
   * than either, with no second number to keep in step.
   */
  private applyImpulse(slot: Slot, subject: RagdollSubject): void {
    const imp = CONFIG.bots.death.impulse;
    const chest = slot.bones.find((b) => b.joint === "torso");
    if (!chest) return;

    // "Not a bullet" rather than a list of the two kinds that are explosions,
    // so a new one is thrown without being remembered here. `DamageKind` is
    // the vocabulary and `CombatSystem` owns it. A BURN is the one other kind
    // that drops a body: a molotov's fire puts nobody in the air, and a corpse
    // flung out of a patch of burning road reads as an explosion nobody saw.
    const blast =
      subject.deathKind !== "bullet" && subject.deathKind !== "fire";

    // Direction is free: `deathFrom` is the shooter's eye or the blast centre.
    // Y is kept, so a round from a rooftop pushes a body down.
    const c = subject.center;
    const from = subject.deathFrom;
    this.v1.set(c.x - from.x, c.y - from.y, c.z - from.z);
    if (this.v1.lengthSquared() < 1e-6) this.v1.copyFrom(UP);
    this.v1.normalize();
    if (blast) {
      // Up as well as out, and it is added to the UNIT direction so it means
      // an angle rather than a distance: a charge going off level with a body
      // — on a windowsill, on a parapet, against the far wall of a room —
      // would otherwise skid it along the floor, and what a blast does to a
      // man is lift him off it.
      this.v1.y += imp.blast.rise;
      this.v1.normalize();
    }

    const hp = this.physics.havok;
    if (blast) {
      const speed = Math.min(
        imp.blast.max,
        imp.blast.base + subject.deathDamage * imp.blast.perDamage,
      );
      for (const bone of slot.bones) {
        this.v2.copyFrom(this.v1).scaleInPlace(speed * bone.mass);
        // At the bone's own origin — the pose `spawn` wrote from the joint's
        // world matrix a few lines ago, which is the proxy's position, and a
        // proxy is parented to nothing, so its world position. The shape's
        // centre is offset from it by `RAGDOLL_BONES`, so each bone picks up a
        // little turn of its own, which is exactly the free tumble the round's
        // `lift` is asking for by hand.
        //
        // **It lands BEFORE the teleport**: Havok still holds the body parked
        // at `PARKED_Y`, and the location is the proxy's NEW position, a
        // kilometre away (`FINDINGS.md` 57). Reproduced exactly as the plugin
        // made it; fixing it is a change of its own.
        const p = bone.body.pose;
        hp.applyImpulse(bone.body.id, [this.v2.x, this.v2.y, this.v2.z], [p[0], p[1], p[2]]);
      }
    } else {
      this.v1.scaleInPlace(
        Math.min(imp.max, imp.base + subject.deathDamage * imp.perDamage),
      );
      // Applied ABOVE the centre of mass, so the tumble falls out of the
      // off-centre application instead of needing an authored spin. Measured
      // off the DRAWN chest, as it always was — `spawn` drew the proxy a few
      // lines ago, and its world matrix is float32, so this is the pose
      // rounded to float32 rather than the pose. FORCED: the proxy has no
      // child in Babylon's scene since the joints left it (X4.1a), so nothing
      // else composes it, and an unforced read inside one render id hands
      // back the last corpse's — the compose `setParent` forced here when the
      // joint was still a node hung on it.
      chest.proxy.computeWorldMatrix(true);
      chest.proxy.getAbsolutePosition().addToRef(
        this.v2.copyFrom(UP).scaleInPlace(imp.lift),
        this.v2,
      );
      // Before the teleport, as the blast's is — see above.
      hp.applyImpulse(
        chest.body.id,
        [this.v1.x, this.v1.y, this.v1.z],
        [this.v2.x, this.v2.y, this.v2.z],
      );
    }

    // A seeded kick so two identical deaths do not fall identically. THIS
    // POOL'S stream — never Math.random, which would make a death impossible
    // to reproduce, and never the subject's own, which is what `SPIN_SEED`
    // is about. Bigger for a blast, because a body in the air has the room to
    // spend it — a corpse merely knocked over spends its first step against
    // the floor.
    const spin = blast ? imp.blast.spin : imp.spin;
    this.v2.set(
      (this.rand() * 2 - 1) * spin,
      (this.rand() * 2 - 1) * spin,
      (this.rand() * 2 - 1) * spin,
    );
    hp.applyAngularImpulse(chest.body.id, [this.v2.x, this.v2.y, this.v2.z]);
  }

  /**
   * True once every bone has been under `sleepSpeed` AND `sleepSpin` for
   * `sleepTime`.
   *
   * The spin is not redundant with the speed: a body that has come to rest on
   * its back and is turning on the spot has almost no linear velocity, and
   * freezing it bakes the pose it happened to be passing through. It is the
   * pose that is being committed to here, so the test has to cover every way
   * one can still be changing.
   */
  private hasSettled(slot: Slot, dt: number): boolean {
    const d = CONFIG.bots.death;
    const hp = this.physics.havok;
    let fastest = 0;
    let spinniest = 0;
    for (const bone of slot.bones) {
      // Written out as `Vector3.length` spells it, so the thresholds see the
      // same floats the plugin's read-back gave them.
      const [lx, ly, lz] = hp.linearVelocity(bone.body.id);
      fastest = Math.max(fastest, Math.sqrt(lx * lx + ly * ly + lz * lz));
      const [ax, ay, az] = hp.angularVelocity(bone.body.id);
      spinniest = Math.max(spinniest, Math.sqrt(ax * ax + ay * ay + az * az));
    }
    if (fastest > d.sleepSpeed || spinniest > d.sleepSpin) {
      slot.stillT = 0;
      return false;
    }
    slot.stillT += dt;
    return slot.stillT >= d.sleepTime;
  }

  /**
   * Bakes the settled pose back into the rig's own hierarchy and stops
   * simulating.
   *
   * The hand-back (`JointTree.release`, `setParent`'s arithmetic) preserves
   * the world transform, so the corpse keeps the shape it landed in — as an
   * ordinary Euler-posed hierarchy under `rig.root`, which is what makes the
   * sink one property write for the whole body.
   *
   * A settled corpse therefore stops being collidable, and that is the right
   * end of the trade rather than an omission: the bodies do not follow the
   * sink (that is the point of baking the pose in), so a corpse left standing
   * in the world would be a ledge that outlives the body a player can see, and
   * anything resting on it would hang in mid-air at `sinkStart`. Two bodies
   * falling at the same time still collide — both are live in the sim.
   */
  private freeze(slot: Slot): void {
    if (slot.frozen || !slot.rig) return;
    const rig = slot.rig;
    for (const bone of slot.bones) {
      // Before the park, and it has to be: the hand-back derives the local
      // transform from the joint's world, which hangs off the proxy — drawn
      // from the bone's pose at the top of `update`.
      rig.tree.release(rig[bone.joint]);
      this.park(bone);
    }
    slot.frozen = true;
  }

  /**
   * Takes a bone's body out of the world and holds it at `PARKED_Y`.
   *
   * Rewriting the pose is NOT enough, and that is the whole reason this
   * exists. The world copies a pose into its body during the pre-step and
   * only while a teleport is pending, so a body whose pose alone was rewritten
   * stays exactly where the corpse settled — an
   * invisible static box lying on the street. Measured before this: a downward
   * physics ray over open ground read 0.000 m before a death and **0.303 m
   * after the body had been retired and its slot freed**, which the next corpse
   * to fall there would have landed on.
   *
   * Writing the transform into the engine by hand (`PhysicsWorld.park`) is
   * what makes the park immediate. Waiting for the next step will not do: the step is skipped
   * exactly when nothing is simulating, which is the state a release usually
   * leaves behind.
   */
  private park(bone: Bone): void {
    const hp = this.physics.havok;
    hp.setLinearVelocity(bone.body.id, [0, 0, 0]);
    hp.setAngularVelocity(bone.body.id, [0, 0, 0]);
    // Under the map, and drawn there at once, as the plugin's node was — the
    // joint is handed back (by `freeze` before this, by `release`'s
    // `resetSoldierPose` straight after), so the proxy ends up drawing
    // nothing, but it is the pool's node and it stands where its body does.
    bone.body.pose.set(PARKED_POSE);
    applyPose(bone.body.pose, bone.proxy);
    // A TELEPORT now with any pending one cleared, then the pooled state.
    this.physics.park(bone.body);
    this.physics.setMotion(bone.body, "static");
  }

  /**
   * The VIEW: a live corpse's bones drawn where its bodies are — each pose
   * onto its proxy, which the rig's joint hangs off. See the header for the
   * points this runs at.
   */
  private drawSlot(slot: Slot): void {
    for (const bone of slot.bones) applyPose(bone.body.pose, bone.proxy);
  }

  /**
   * Hands the rig back, restored exactly, and frees the slot. Idempotent.
   *
   * The ordering is deliberate: the rig is put back and hidden BEFORE
   * `ragdolling` is cleared, so a body's view (`NetSoldier`) never sees a
   * half-restored rig. The frame after this it takes over a rig in its rest
   * pose, and draws it or not off the bot's own clock: almost always that has
   * already taken the body out of the world (`death.hideTime`, under a second,
   * against a corpse held for seconds), but a corpse EVICTED inside that window
   * (`takeSlot`) is drawn standing at rest until the clock runs out — the pop
   * eviction accepts. Either way a new life has one case to handle, not two.
   */
  private release(slot: Slot): void {
    const { subject, rig } = slot;
    if (!subject || !rig) {
      slot.subject = null;
      slot.rig = null;
      return;
    }
    for (const bone of slot.bones) this.park(bone);
    // Both of these belong to a CORPSE, and `update`'s guard can hand this a
    // body that came back to life while the pool was holding it. Hiding a live
    // body costs a frame of invisibility (`NetRoster` re-enables it on the
    // next one) and writing its root would drop it at the dead one's sink
    // height for that frame. The joints still have to go back, which is the
    // whole reason that guard releases rather than just forgetting the slot.
    if (!subject.alive) {
      // Undo the sink before handing the rig back: `root.position` is the
      // body's own, and a respawn writes it through `NetSoldier` — but a rig
      // retired by `reset()` mid-sink would otherwise keep the offset.
      if (slot.sinking) rig.root.position.y = slot.sinkFromY;
      subject.setEnabled(false);
    }
    // The authoritative restore: holders, positions, rotations
    // and scalings, on every posed joint. See its own note for why
    // `animateSoldier(..., 0)` is not a substitute.
    resetSoldierPose(rig);
    subject.ragdolling = false;
    slot.subject = null;
    slot.rig = null;
    slot.frozen = false;
    slot.sinking = false;
    slot.t = 0;
    slot.stillT = 0;
  }
}
