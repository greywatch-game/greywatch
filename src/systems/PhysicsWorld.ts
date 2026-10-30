/**
 * PhysicsWorld.ts — The one physics engine: Havok, the map as one static body
 * per 48 m block, and the fixed-step clock everything under it advances on.
 * Owns: the engine — Havok's own world, created and stepped through the raw
 * API in [`havok.ts`](havok.ts), with no Babylon plugin and no scene physics
 * engine between — the static world, the substep
 * accumulator, and the register of clients that have bodies in it.
 * Owns no body but the static world's. `RagdollSystem` has the corpses,
 * `DebrisSystem` the glass shards and `BlastDebrisSystem` the rubble a blast
 * throws; this file is what the three share, and with `havok.ts` it is the only
 * place `@babylonjs/havok` is reached.
 *
 * ## Havok is REQUIRED, and that is what makes this file short
 *
 * `loadHavok` is awaited in `main.ts` and the instance is handed to `Game`,
 * which hands it here — so a failure is the boot screen's failure message
 * beside "no WebGPU", and by the time this class exists the engine does too.
 * Every "has it arrived yet" question is therefore gone, and so is every
 * fallback that used to answer one: there is no init state, no `ready`, no
 * pending map, no client built later than its own constructor, and no setting.
 * A body falls under the solver or there is no game for it to fall in.
 *
 * It was not always so, and what the optional version cost is worth stating
 * once. Two code paths for every falling thing — a corpse's collapse tween and
 * a shard's scripted arc — each with its own timing constants, each exercised
 * only on machines nobody was testing on, and both reachable at any moment
 * because the WASM could land mid-round. The engine ships with the build and is
 * precached with it; making it optional bought a fallback for a case that, on a
 * machine that can run the rest of this game, does not happen.
 *
 * Invariants, each of which has a way of failing silently:
 * - **Babylon-free** (`scripts/check-babylon-free.mjs` holds it, beside
 *   `havok.ts`). It reaches no node, no mesh and no scene: a body's pose is a
 *   plain array (`WorldBody.pose`) that a client's VIEW writes onto whatever
 *   it draws, and the floor arrives as the
 *   collider clones' own vertex arrays (`GameMap.terrainGeometry`), not as
 *   the meshes.
 * - Stepping is `update()`'s job and it is only ever called from a gameplay
 *   path — `Game.stepAftermath`, and nowhere else. The scene has no physics
 *   engine for `scene.animate()` to step behind a pause card, and `Game`,
 *   which owns the scene, still holds `scene.physicsEnabled` false until the
 *   scene goes (see `CLAUDE.md`, "Deaths, glass, and the one physics engine").
 * - The sim is a FIXED step with a CARRIED remainder, so a tumble is identical
 *   at 30, 60 and 144 fps and reproducible headless, where `dt` is clamped to
 *   0.05. Both halves are load-bearing and both have already been wrong once.
 *   The step IS `death.substep`, every substep, and is 1/60 — the step
 *   Babylon's engine forced on its plugin whatever it was told, which is why
 *   calling Havok directly moved no bits (see the constructor).
 * - Everything under it is COSMETIC. Nothing here feeds navigation, cover or
 *   hit detection, and nothing under it may ever decide anything — that rule
 *   outlived the fallbacks and is the one that has not moved.
 *
 * ## Why this is a system of its own
 *
 * It was `RagdollSystem`'s, privately, and two things made a second consumer
 * impossible rather than merely awkward. The step ran only while a corpse slot
 * was unfrozen, so a shard would have sat motionless whenever nobody was dying.
 * And the engine was a private field (then Babylon's plugin, on the scene), so
 * the alternative was a second `enablePhysics` on the same scene — which is not
 * a second world, it is the same one with two owners. (There was a third: the
 * ragdoll SETTING tore the static world down as a side effect, so glass would
 * have fallen through the floor for anyone who turned corpses off. That setting is gone with the
 * fallbacks it chose between, and the teardown it abused is now only the map's.)
 *
 * The split is the `BattleSystem`←`CombatSystem` precedent in `CLAUDE.md`:
 * INJECTED by `Game`, never imported system-to-system, and it is a constructor
 * argument rather than a callback because a client needs the engine
 * synchronously while it is building bodies.
 *
 * ## Collision filtering
 *
 * Bit 0 is the world's. `RagdollSystem` takes bits 1..30, one per pooled corpse,
 * so a body does not collide with itself; `DEBRIS_GROUP` is bit 31's neighbour
 * and is shared by every shard AND by every blast chunk — neither decides
 * anything, and neither may shove the other or a corpse. A client picking a
 * group takes it from here, so the whole allocation is readable in one place.
 */
import { CONFIG } from "../config";
import { Quaternion as MathQuaternion } from "../math";
import { BLOCK_SIZE } from "../world/blocks";
import { Havok, type BodyId, type HavokInstance, type Motion, type ShapeId } from "./havok";
import type { GameMap, TerrainGeometry } from "../world/mapTypes";

/**
 * The instantiated WASM module. Spelled in `havok.ts` as an import TYPE, which
 * is erased outright — so this file's one real reference to `@babylonjs/havok`
 * is still the dynamic `import()` in `loadHavok`, and the rule below about
 * never naming the binary still holds.
 */
export type { HavokInstance };

/**
 * Fetches and instantiates the engine. Awaited ONCE, by `main.ts`, before
 * there is a `Game` to give it to; a rejection is the boot screen's failure
 * message and the game does not start.
 *
 * The import is dynamic so Havok's glue is a chunk of its own rather than part
 * of the main bundle's parse. Unlike `src/editor/`, it is deliberately NOT
 * `import.meta.env.DEV`-gated: this ships.
 *
 * Nothing here names the `.wasm`, and it must not. Havok's ESM glue resolves
 * the binary against its own `import.meta.url`, which Vite follows at build
 * time and emits as a CONTENT-HASHED asset — so the binary is versioned with
 * the dependency and needs no `locateFile`. Putting a hand-placed copy in
 * `public/` as well is not belt-and-braces, it is two megabytes shipped and
 * precached twice; measured exactly that before it was taken out again.
 */
export function loadHavok(): Promise<HavokInstance> {
  return import("@babylonjs/havok").then((m) => m.default());
}

/**
 * The world's own collision bit — Havok's default membership is 1, and the
 * static world's shapes take that default. Anything that must land on the
 * map collides with this and, in `DebrisSystem`'s case, with nothing else.
 */
export const WORLD_GROUP = 1;
/**
 * Every shard's group. Bit 31, which is the one bit `RagdollSystem` can never
 * reach: its slots take `1 << (1 + slot % 30)`, so bits 1 through 30.
 *
 * One group for every shard and every blast chunk rather than one each, and it
 * collides with `WORLD_GROUP` alone. Debris must not shove corpses — a body
 * knocked over by falling glass is a corpse DECIDING something, and nothing
 * under this engine decides anything — and debris-on-debris buys a pile nobody
 * looks at for a solver cost quadratic in the burst.
 *
 * Written as a hex literal because `1 << 31` is negative in JavaScript and this
 * crosses into the WASM as a uint32.
 */
export const DEBRIS_GROUP = 0x80000000;

/**
 * Something with bodies in the world. Registered once at construction and
 * never removed — there are three of them and they live as long as the game.
 *
 * A client builds its own pool in its own constructor, because the engine is
 * already up by then. It is built up front rather than at the moment a body is
 * wanted for the reason it always was: shapes and constraints are a hitch, and
 * the frame somebody is killed on or shoots a window on is the worst one
 * available to spend it.
 */
export interface PhysicsClient {
  /**
   * Whether this client has anything that still needs the engine advanced.
   *
   * Asked once per frame, and the engine is stepped only if SOMEBODY says yes —
   * which is what makes a quiet round cost nothing at all. A client that
   * answered true while it had nothing moving would burn a step per frame for
   * the whole game.
   */
  physicsActive(): boolean;
  /**
   * Called after the FIRST substep of a frame and no other.
   *
   * This is the teleport read-in point, and it is per client because each owns
   * its own freshly-spawned bodies: a body is spawned with its teleport on
   * (`WorldBody.teleport`) so one step reads its pose into the sim, and from
   * there the sim owns it and must not be overwritten. Inside the loop rather
   * than after it — a frame running two substeps would otherwise re-teleport a
   * body onto the transform the first step had just synced back, which Havok
   * does not come out of in the state it went in.
   */
  afterFirstStep(): void;
  /**
   * The static world is being torn down — a map is being replaced, or the
   * editor is rebuilding one. Release everything: the ground these bodies were
   * standing on is about to stop existing.
   */
  worldCleared(): void;
}

/**
 * A client's body on the raw API, held here so the step can do for it what the
 * plugin's `executeStep` did for a `PhysicsBody`: teleport it from its pose
 * before a substep, and write its pose back after one.
 *
 * **The pose is a plain array, not a node**, and
 * it is exactly what the plugin's node was to it: the plugin teleported from
 * an UNPARENTED node's raw `position` and `rotationQuaternion` and synced back
 * into the same two, neither normalised — so this array is those seven
 * numbers, read and written the same way. Whatever a client draws the body as
 * (a rig's joint, posed off this very array since `BABYLON_EXIT.md` X4.1b; a
 * shard's mesh, a chunk's, written FROM it by `poseView.ts` at the points
 * something reads the drawing) is the client's VIEW of it; nothing here ever
 * writes one.
 */
export interface WorldBody {
  readonly id: BodyId;
  /**
   * `[px, py, pz, qx, qy, qz, qw]`: where the body is, as the last substep
   * left it — or as its client put it, for a teleport. A client writes it to
   * place a body (with `teleport` on, or through `park`) and reads it to draw
   * one; the substep writes it after every step while the body is DYNAMIC.
   * A `Float64Array`, so it holds what Havok hands back bit for bit, a `-0`
   * included.
   */
  readonly pose: Float64Array;
  /**
   * Teleport from `pose` at the NEXT substep — what the plugin called
   * `disablePreStep = false`. It is read at the substep, not when it is set,
   * so a frame that takes no substep keeps it pending, and it stays set for
   * every substep until the client clears it (`afterFirstStep`). `park` clears
   * it and writes at once.
   */
  teleport: boolean;
  /**
   * Written back after every substep — the plugin's `!disableSync`, which is
   * true exactly while the body is DYNAMIC. Set only through `setMotion`.
   */
  dynamic: boolean;
}

export class PhysicsWorld {
  private clients: PhysicsClient[] = [];

  /** Sim time owed but not yet stepped — see `update`. */
  private accum = 0;

  /**
   * The raw API over this world's own Havok world — see `havok.ts`. Every body
   * in the game is built and stepped through it: the static world here, the
   * clients' through `addBody` and `havok`.
   */
  private hp: Havok;

  /**
   * The map as one static body per 48 m block — see `buildWorld`, which is
   * where the grouping is argued. Three parallel lists of raw handles rather
   * than fields on a record, because the only thing anything does with them is
   * build them and release them, in the order `clearWorld` gives.
   */
  private worldBodies: BodyId[] = [];
  private worldShapes: ShapeId[] = [];
  private worldLeaves: ShapeId[] = [];

  /**
   * Every client body on the raw API, in creation order — which is the order
   * the plugin's engine listed them in (the corpses' bones, built first, then
   * the shards', then the chunks'), and so the order a substep teleports and
   * syncs them. See `substep`.
   */
  private bodies: WorldBody[] = [];

  /**
   * Stands the engine up, synchronously, on a module `main.ts` has already
   * awaited. Nothing in the game is ever handed a half-built physics world.
   */
  constructor(havok: HavokInstance) {
    // The world and its gravity, and nothing else: no speed limit (the
    // plugin set none, and Havok's own defaults are what every tumble was
    // tuned under) and no query collector (nothing here casts against this
    // world — every ray in the game is `RayWorld`'s).
    //
    // The step is `death.substep`, taken by `substep` below. Under Babylon's
    // plugin it was 1/60 whatever that said — the engine `enablePhysics`
    // built reset the plugin's step to its own default straight after it was
    // set — and `death.substep` is exactly 1/60 today, which is why the port
    // moved no bits; lowering it to 1/120 for a finer tumble now does what it
    // says.
    this.hp = Havok.createWorld(havok, [0, CONFIG.bots.death.gravity, 0]);
  }

  /** True once there is ground to land on. A body without it falls forever. */
  get hasWorld(): boolean {
    return this.worldBodies.length > 0;
  }

  /** The raw API, on the world every body here lives in. */
  get havok(): Havok {
    return this.hp;
  }

  /** How many static bodies the map was built as — one per bucket. */
  get worldBodyCount(): number {
    return this.worldBodies.length;
  }

  register(client: PhysicsClient): void {
    this.clients.push(client);
  }

  // --- client bodies on the raw API -------------------------------------------

  /**
   * A body added to the world at `at` — `new PhysicsBody(node, motion,
   * false)`, call for call, and never asleep. `at` is `[px, py, pz, qx, qy,
   * qz, qw]` and it is the pose the plugin read off the node it was built on,
   * which was the node's ABSOLUTE pose (its world matrix computed, then
   * decomposed) — so a client building one on a node hands in that read
   * (`poseView.absolutePose`; the corpse pool, which has no node since X4.1b,
   * hands in the park that read gave), and the body's `pose` starts as it. The shape,
   * the mass and the dampings are the client's, through `havok`, in the order
   * it always made them.
   */
  addBody(motion: Motion, at: ArrayLike<number>): WorldBody {
    const id = this.hp.createBody(motion, [at[0], at[1], at[2]], [at[3], at[4], at[5], at[6]]);
    const pose = new Float64Array(7);
    for (let i = 0; i < 7; i++) pose[i] = at[i];
    const body: WorldBody = { id, pose, teleport: false, dynamic: motion === "dynamic" };
    this.bodies.push(body);
    return body;
  }

  /** `PhysicsBody.setMotionType`: the sync follows the motion type. */
  setMotion(body: WorldBody, motion: Motion): void {
    body.dynamic = motion === "dynamic";
    this.hp.setMotion(body.id, motion);
  }

  /**
   * Teleports a body to its `pose` NOW and clears any teleport pending — what
   * a client parking a body did through the plugin's
   * `setPhysicsBodyTransformation`. A static body whose pose alone was
   * rewritten leaves its collision proxy where it stopped
   * (`RagdollSystem.park` carries the measurement).
   */
  park(body: WorldBody): void {
    body.teleport = false;
    this.teleport(body);
  }

  /**
   * `installMap`'s hook: drop last build's static world and register this one.
   *
   * Called for every map build, and it must be, because the alternative is a
   * physics world holding shapes built from a DISPOSED map's geometry — the
   * silent failure `installMap`'s own note is about.
   *
   * Editor builds are skipped outright: there are no corpses in the editor and
   * a tier-3 rebuild is already ~570 ms.
   */
  setMap(map: GameMap | null, editor: boolean): void {
    for (const c of this.clients) c.worldCleared();
    this.clearWorld();
    if (map && !editor) this.buildWorld(map);
  }

  /**
   * Advances the sim by whole substeps, carrying the remainder.
   *
   * Steps only while SOMEBODY has something moving. Once every corpse has
   * frozen and every shard has settled the engine is not touched at all — which
   * is what makes physics cost nothing in the great majority of frames.
   */
  update(dt: number): void {
    const d = CONFIG.bots.death;

    let simulating = false;
    for (const c of this.clients) if (c.physicsActive()) simulating = true;
    if (!simulating) {
      // Nothing owes any time, and a remainder carried across a lull would give
      // the next body a free part-step on the frame it appeared.
      this.accum = 0;
      return;
    }

    // Fixed steps with the REMAINDER CARRIED, bounded so a long frame cannot
    // spiral. Carrying it is what makes the step fixed at all: spending the
    // frame instead — `left = dt`, step until it runs out — rounds every frame
    // UP to a whole substep, so the sim advances `ceil(dt / substep)` steps,
    // which is one at any rate above 60 fps and two at anything just under it.
    // Measured over a second of wall clock before this: 60 steps at 30 fps and
    // at a clean 60, but 118 at 59 and one per frame at 144 — a tumble at 2x
    // and 2.4x speed, jittering between the two on a real 60 Hz display as `dt`
    // crosses 1/60. `maxSteps` still bounds the catch-up, which is what makes a
    // headless run at 2 fps play in slow motion rather than teleporting bodies
    // across the map.
    this.accum = Math.min(this.accum + dt, d.substep * d.maxSteps);
    let first = true;
    while (this.accum >= d.substep) {
      this.substep(d.substep);
      this.accum -= d.substep;
      if (first) {
        first = false;
        for (const c of this.clients) c.afterFirstStep();
      }
    }
  }

  /**
   * One substep: what Babylon's plugin's `executeStep` did, over every client
   * body in creation order — the corpses' bones (built first), then the
   * shards', then the chunks', which was the plugin engine's list — and the
   * oracles (`plans/physics-ref/`) grade Havok's state bit for bit, so the
   * order is kept: every pending teleport, then the step (`SetIdealStepTime`
   * and `Step`, at `death.substep` — see the constructor), then every dynamic
   * body's pose written back into its array. The clients' views read those
   * arrays after `update` returns (`Game` runs each client's `update` straight
   * after it) — a once-a-frame write of the last substep's pose, which is
   * every number the plugin's per-substep node writes left standing. What
   * `executeStep` also did and this does not: re-region bodies for a floating
   * origin (off: no scene set one) and read the collision and trigger events
   * (none: no body asks for any, and reading them changes nothing).
   */
  private substep(dt: number): void {
    for (const b of this.bodies) if (b.teleport) this.teleport(b);

    this.hp.step(dt);

    for (const b of this.bodies) {
      if (!b.dynamic) continue;
      // The plugin's sync for an unparented node: the position plus the world
      // region's floating origin (zero, and the `+ 0` is what turns a Havok
      // `-0` into a `0`, as that addition did) and the orientation as Havok
      // holds it, unnormalised.
      const [p, q] = this.hp.pose(b.id);
      const o = b.pose;
      o[0] = p[0] + 0;
      o[1] = p[1] + 0;
      o[2] = p[2] + 0;
      o[3] = q[0];
      o[4] = q[1];
      o[5] = q[2];
      o[6] = q[3];
    }
  }

  /**
   * The plugin's TELEPORT for an unparented node: its raw position (less a
   * floating origin of zero) and its raw quaternion, unnormalised — the seven
   * numbers `pose` holds in their place.
   */
  private teleport(b: WorldBody): void {
    const o = b.pose;
    this.hp.setPose(b.id, [o[0], o[1], o[2]], [o[3], o[4], o[5], o[6]]);
  }

  /**
   * The map as ONE static body PER 48 m BLOCK, because a single compound is
   * quadratic in the colliders put into it.
   *
   * **Every child is one `HP_Shape_AddChild` (`Havok.addChild`), and Havok
   * rebuilds the container's acceleration structure on every one of them.**
   * Profiled on the proving ground while this still went through Babylon's
   * plugin, whose `addChild` was that one call: 5,929 boxes into one
   * container is 1,726 ms and 16,526 is 13,433 — 2.79x the boxes for 7.78x
   * the time, an exponent of 1.94, with 13,244 of those milliseconds inside
   * `addChild` rather than in shape construction. The raw API has no batch
   * entry point either, so the lever is the SIZE of each container: `k`
   * buckets turn `n^2` into `k(n/k)^2`. Measured on the same two grounds, 420
   * and 1,023 buckets of ~14 and ~16 boxes take the same builds to 268 ms and
   * 682 — 6.4x and 19.7x — and the exponent with them, to 0.89, which is a
   * straight line with the rounding off (`ENGINE_UPGRADE.md` S5b).
   *
   * **48 m is `BLOCK_SIZE`, the world layer's fixed unit of LOCALITY, and the
   * key is spelled exactly as `BlockMerge` spells its own**, so the physics
   * world is bucketed the way the geometry it stands in for is grouped.
   * Nothing reads the key — it is a grouping and not an identity — but a block
   * is the unit of locality this whole world layer already thinks in, and a
   * bucket of neighbours is also the bucket a query wants.
   *
   * **It is deliberately NOT `GameMap.blockSize`, and the quadratic above is
   * the reason.** A map states its own merge block to cut draw calls, and at
   * 1500 m that means widening it — 128 m over the same ground is a seventh of
   * the buckets and therefore seven times the boxes in each, which is most of
   * what the bucketing just bought handed straight back. What this wants from a
   * big map is more buckets, not fewer, so it stays on the constant.
   *
   * **Every bucket's node stands at the ORIGIN and every child carries its own
   * world-space offset**, exactly as the single container's children did. That
   * is what makes this a regrouping and nothing else: no transform in the world
   * moves, so a body rests on what it always rested on. The physics oracle
   * (`plans/physics-ref/drop.mjs`) is what says so rather than an argument, and
   * the shape of what it says is the useful part: across all five maps the
   * worst of 64 dropped bodies comes to rest 3.8 cm from where it did, and
   * under a MILLIMETRE of that is vertical. Sideways is the solver taking the
   * same contacts in another order; height is what the world is, and it did not
   * move.
   *
   * **What it spends is the per-step body walk, and the answer is that it does
   * not.** The plugin's `executeStep` walked every body in the engine three
   * times, and a static one was a `continue` in each — which is why the
   * single-body version's argument was about DYNAMIC bodies rather than about
   * a list length (and `substep` now walks only the clients' bodies, so the
   * map's cost it nothing at all). Measured, through the plugin, with
   * sixty-four boxes resting on the 1500 m ground, a step costs 36/36 us with
   * one static body and 35/31 with 1,023, which is inside the scatter of the
   * same reading taken twice. What does
   * show is the FALLING phase: the whole 480-substep settle goes from ~52 ms
   * to ~60, or about 18 us a substep with sixty-four bodies in contact at
   * once, which is a tenth of a percent of a frame and only while something is
   * tumbling.
   *
   * A local set of statics around each corpse was the alternative and is worse
   * on both counts that matter: a tumbling body leaves the set and falls
   * through the wall at its edge, and building shapes at the moment of a kill
   * is a hitch on the worst possible frame.
   *
   * **A pane of glass is in here like any other collider**, and stays in it
   * after it breaks. That is deliberate: this world is what a corpse and a
   * shard land on, and neither decides anything — a shard resting against glass
   * that a round took out is a cosmetic wrongness lasting a second, while
   * rebuilding the compound every time a window goes in is a hitch on the frame
   * somebody shot one. That argument is untouched by the bucketing and is only
   * stronger for it: what a rebuild would cost is a whole map's containers.
   * Nothing that DECIDES anything reads these bodies.
   */
  private buildWorld(map: GameMap): void {
    const hp = this.hp;
    // Insertion-ordered, so the containers are built in the order the boxes
    // first reach them and the world is the same world on every boot. The
    // colliders are seeded and ordered; nothing here may make them less so.
    // A container is created the first time a shape REACHES its bucket, after
    // that shape — the order the plugin's `PhysicsShapeContainer` was built
    // in, and creation order is handle order.
    const buckets = new Map<string, ShapeId>();
    const bucket = (x: number, z: number): ShapeId => {
      const key = `${Math.floor(x / BLOCK_SIZE)},${Math.floor(z / BLOCK_SIZE)}`;
      let container = buckets.get(key);
      if (!container) {
        container = hp.container();
        buckets.set(key, container);
      }
      return container;
    };

    for (const b of map.colliderBoxes) {
      const shape = hp.box([0, 0, 0], [0, 0, 0, 1], [b.w, b.h, b.d]);
      // MapBuilder.collider writes `mesh.rotation.set(rotX, rotY, 0)` and
      // Babylon's Euler order is yaw-pitch-roll, so this is the same
      // orientation — which is what carries the ramps across for free.
      // `src/math`'s quaternion is Babylon's bit for bit.
      //
      // Bucketed by the box's CENTRE, and a box wider than a block is
      // therefore in one bucket and hanging out of it — which the four rim
      // boundary boxes always are. That is a locality hint being imprecise,
      // not a shape being wrong: the child still carries the same world-space
      // transform it did when there was one container.
      const q = MathQuaternion.RotationYawPitchRoll(b.rotY, b.rotX, 0);
      hp.addChild(bucket(b.cx, b.cz), shape, [b.cx, b.cy, b.cz], [q.x, q.y, q.z, q.w], [1, 1, 1]);
      this.worldLeaves.push(shape);
    }

    // The floor is the documented collider exception: a heightfield has no box
    // to stand in for it, so its blocks are mesh clones and come across as
    // mesh shapes — built from the clones' own vertex arrays
    // (`GameMap.terrainGeometry`), never from the meshes. They are static, so
    // each BVH is built once per map and never again — and they are bucketed
    // by their CENTRE exactly as a box is, so a patch cut on a lattice of its
    // own (`GameMap.terrainBlock`) is in one bucket and hanging out of it,
    // which is a locality hint being imprecise rather than a shape being
    // wrong. See `floorShape` for the centre.
    for (const patch of map.terrainGeometry) {
      const [shape, cx, cz] = this.floorShape(patch);
      hp.addChild(bucket(cx, cz), shape, [0, 0, 0], [0, 0, 0, 1], [1, 1, 1]);
      this.worldLeaves.push(shape);
    }

    // One static body per bucket, standing at the origin with no turn — what
    // the plugin read off a fresh `TransformNode` (measured: exactly
    // `[0, 0, 0]` and `[0, 0, 0, 1]`, no negative zero) — given its container
    // and the mass properties built off it. NO material on any world shape:
    // Havok's default friction (0.5) is what every body here lands on, and
    // `FINDINGS.md` 53 is what that costs. Keep it until somebody asks.
    for (const container of buckets.values()) {
      const body = hp.createBody("static", [0, 0, 0], [0, 0, 0, 1]);
      hp.setShape(body, container);
      this.worldBodies.push(body);
      this.worldShapes.push(container);
    }
  }

  /**
   * One terrain patch as a Havok mesh shape, and the centre it is bucketed by
   * — `PhysicsShapeMesh`'s `MeshAccumulator` and the collider clone's bounding
   * box, both without the mesh.
   *
   * **The positions are the clone's own LOCAL ones and the shape's space is
   * the world's**, because the clone stands at identity: the plugin baked
   * them through the mesh's absolute scaling (exactly 1) as
   * `Vector3.TransformCoordinates` over `Matrix.Scaling`, and every term that
   * arithmetic added was a zero — which changes no finite number but a `-0`,
   * into a `0`. So each coordinate is `x + 0` here, which is the same float
   * to the bit; the float32 copy into the heap keeps the sign bit, so it is
   * not a detail.
   *
   * **The triangles are REVERSED, each one**: every triangle in the world is
   * wound for Babylon's left-handed default (`scene.useRightHandedSystem` is
   * false and nothing sets it), and Havok wants the other winding, the one
   * that lets it skip interior edges. The plugin reversed them for exactly
   * that scene.
   *
   * **The centre is the bounding box's, computed as Babylon computed it**:
   * the extremes found by strict comparison from `+-Number.MAX_VALUE`, then
   * `(max + min) * 0.5`. Not an approximation of it — a 240 m map's patches
   * are cut from -120 in 48 m blocks, so a patch's centre can sit exactly on a
   * multiple of 48 (-96 is `-2 * 48`), where `Math.floor` at the key flips on
   * the last bit.
   */
  private floorShape(patch: TerrainGeometry): [ShapeId, number, number] {
    const data = patch.positions;
    const positions = new Float64Array(data.length);
    let minX = Number.MAX_VALUE;
    let minZ = Number.MAX_VALUE;
    let maxX = -Number.MAX_VALUE;
    let maxZ = -Number.MAX_VALUE;
    for (let i = 0; i + 2 < data.length; i += 3) {
      const x = data[i];
      const z = data[i + 2];
      positions[i] = x + 0;
      positions[i + 1] = data[i + 1] + 0;
      positions[i + 2] = z + 0;
      if (x < minX) minX = x;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (z > maxZ) maxZ = z;
    }
    const indices = patch.indices;
    const triangles = new Int32Array(indices.length - (indices.length % 3));
    for (let i = 0; i + 2 < indices.length; i += 3) {
      triangles[i] = indices[i + 2];
      triangles[i + 1] = indices[i + 1];
      triangles[i + 2] = indices[i];
    }
    return [this.hp.mesh(positions, triangles), (maxX + minX) * 0.5, (maxZ + minZ) * 0.5];
  }

  /**
   * Releases the whole static world, in the plugin's order: every body out of
   * the world and released, then every container, then every leaf.
   *
   * **Every list, and all of them**: the world used to be one body, one
   * container and its leaves, and it is now one body and one container PER
   * BLOCK. A rebuild that dropped a single bucket would leak a live static
   * body into the next map — the editor's tier-3 rebuild does this on every
   * save — which is why the bucketing's sharp edge is here rather than in
   * `buildWorld`.
   */
  private clearWorld(): void {
    for (const b of this.worldBodies) this.hp.destroyBody(b);
    for (const c of this.worldShapes) this.hp.releaseShape(c);
    // Every leaf, or the WASM heap grows one map build at a time.
    for (const s of this.worldLeaves) this.hp.releaseShape(s);
    this.worldBodies = [];
    this.worldShapes = [];
    this.worldLeaves = [];
  }
}
