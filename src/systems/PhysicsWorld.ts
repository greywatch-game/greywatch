/**
 * PhysicsWorld.ts — The one physics engine: the Havok plugin, the map as one
 * static body per 48 m block, and the fixed-step clock everything under it
 * advances on.
 * Owns: the plugin, the static world, the substep accumulator, and the register
 * of clients that have bodies in it.
 * Owns NO bodies of its own. `RagdollSystem` has the corpses, `DebrisSystem` the
 * glass shards and `BlastDebrisSystem` the rubble a blast throws; this file is
 * what the three share, and it is the only place `@babylonjs/havok` is reached.
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
 * - `scene.physicsEnabled` is FALSE and stays false. Babylon steps physics from
 *   `scene.animate()` on every RENDERED frame, and this game renders under the
 *   menu, the deploy map and a pause — so a scene-driven step would be the one
 *   thing still moving behind a pause card. Stepping is `update()`'s job and it
 *   is only ever called from a gameplay path.
 * - The sim is a FIXED step with a CARRIED remainder, so a tumble is identical
 *   at 30, 60 and 144 fps and reproducible headless, where `dt` is clamped to
 *   0.05. Both halves are load-bearing and both have already been wrong once.
 * - Everything under it is COSMETIC. Nothing here feeds navigation, cover or
 *   hit detection, and nothing under it may ever decide anything — that rule
 *   outlived the fallbacks and is the one that has not moved.
 *
 * ## Why this is a system of its own
 *
 * It was `RagdollSystem`'s, privately, and two things made a second consumer
 * impossible rather than merely awkward. The step ran only while a corpse slot
 * was unfrozen, so a shard would have sat motionless whenever nobody was dying.
 * And the plugin was a private field, so the alternative was a second
 * `enablePhysics` on the same scene — which is not a second world, it is the
 * same one with two owners. (There was a third: the ragdoll SETTING tore the
 * static world down as a side effect, so glass would have fallen through the
 * floor for anyone who turned corpses off. That setting is gone with the
 * fallbacks it chose between, and the teardown it abused is now only the map's.)
 *
 * The split is the `BattleSystem`←`CombatSystem` precedent in `CLAUDE.md`:
 * INJECTED by `Game`, never imported system-to-system, and it is a constructor
 * argument rather than a callback because a client needs the plugin
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
import {
  HavokPlugin,
  Mesh,
  PhysicsBody,
  PhysicsMotionType,
  PhysicsShape,
  PhysicsShapeBox,
  PhysicsShapeContainer,
  PhysicsShapeMesh,
  Quaternion,
  Scene,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import { BLOCK_SIZE, type GameMap } from "../world/MapBuilder";

/**
 * The instantiated WASM module, as `HavokPlugin` wants it.
 *
 * Spelled as an import TYPE rather than a named import, which is erased
 * outright — so this file's one real reference to `@babylonjs/havok` is still
 * the dynamic `import()` in `loadHavok`, and the rule below about never naming
 * the binary still holds.
 */
export type HavokInstance = Awaited<
  ReturnType<typeof import("@babylonjs/havok")["default"]>
>;

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
 * The world's own collision bit — `PhysicsShape` defaults membership to 1, and
 * the static world's shapes take that default. Anything that must land on the
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
   * its own freshly-spawned bodies: a body is spawned with `disablePreStep =
   * false` so one step reads its node into the sim, and from there the sim owns
   * it and must not be overwritten. Inside the loop rather than after it — a
   * frame running two substeps would otherwise re-teleport a body onto the
   * transform the first step had just synced back, which Havok does not come
   * out of in the state it went in.
   */
  afterFirstStep(): void;
  /**
   * The static world is being torn down — a map is being replaced, or the
   * editor is rebuilding one. Release everything: the ground these bodies were
   * standing on is about to stop existing.
   */
  worldCleared(): void;
}

export class PhysicsWorld {
  /**
   * Two handles onto the same plugin, deliberately. `engine` is what `_step` is
   * reached through; `plugin` is the concrete type, held because
   * `getPhysicsEngine()`'s union does not carry `setTimeStep` or
   * `setPhysicsBodyTransformation` and a client needs the second one.
   */
  private engine: NonNullable<ReturnType<Scene["getPhysicsEngine"]>>;
  private hkPlugin: HavokPlugin;
  private clients: PhysicsClient[] = [];

  /** Sim time owed but not yet stepped — see `update`. */
  private accum = 0;

  /**
   * The map as one static body per 48 m block — see `buildWorld`, which is
   * where the grouping is argued. Four parallel lists rather than four fields
   * on a record, because the only thing anything does with them is build them
   * and dispose them, and `worldLeaves` was already the shape of the last one.
   */
  private worldNodes: TransformNode[] = [];
  private worldBodies: PhysicsBody[] = [];
  private worldShapes: PhysicsShapeContainer[] = [];
  private worldLeaves: PhysicsShape[] = [];

  /**
   * Stands the engine up, synchronously, on a module `main.ts` has already
   * awaited. Nothing in the game is ever handed a half-built physics world.
   */
  constructor(
    private scene: Scene,
    havok: HavokInstance,
  ) {
    // `false` = do NOT use the frame delta for the world step. The plugin then
    // ignores whatever it is handed and advances a fixed amount, which is what
    // makes a tumble frame-rate independent.
    const plugin = new HavokPlugin(false, havok);
    // ...and THIS is the amount. The argument to `_step` is discarded in this
    // mode (`executeStep`: `_useDeltaForWorldStep ? delta : _fixedTimeStep`),
    // so without this line `death.substep` is not the step length at all — it
    // only divides the frame, and the world advances by the plugin's own
    // default of 1/60 however many times that comes to. The two agreed by
    // coincidence, so the knob was inert: lowering it to 1/120 for a finer
    // tumble would have run the sim at double speed instead. Verified before
    // this line existed by stepping with 1/600 and 1/10 and measuring the same
    // 2.5 m fall in 30 steps.
    plugin.setTimeStep(CONFIG.bots.death.substep);
    scene.enablePhysics(new Vector3(0, CONFIG.bots.death.gravity, 0), plugin);
    // enablePhysics sets this true. It must not stay true — see the header.
    scene.physicsEnabled = false;
    this.engine = scene.getPhysicsEngine()!;
    this.hkPlugin = plugin;
  }

  /** True once there is ground to land on. A body without it falls forever. */
  get hasWorld(): boolean {
    return this.worldBodies.length > 0;
  }

  /** The concrete plugin, for the one call the engine's union type lacks. */
  get plugin(): HavokPlugin {
    return this.hkPlugin;
  }

  register(client: PhysicsClient): void {
    this.clients.push(client);
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
      this.engine._step(d.substep);
      this.accum -= d.substep;
      if (first) {
        first = false;
        for (const c of this.clients) c.afterFirstStep();
      }
    }
  }

  /**
   * The map as ONE static body PER 48 m BLOCK, because a single compound is
   * quadratic in the colliders put into it.
   *
   * **`HavokPlugin.addChild` is one `HP_Shape_AddChild`, and Havok rebuilds the
   * container's acceleration structure on every one of them.** Profiled on the
   * proving ground (`FINDINGS.md` 25): 5,929 boxes into one container is
   * 1,726 ms and 16,526 is 13,433 — 2.79x the boxes for 7.78x the time, an
   * exponent of 1.94, with 13,244 of those milliseconds inside `addChild`
   * rather than in shape construction. There is no batch entry point through
   * the plugin, so the lever is the SIZE of each container: `k` buckets turn
   * `n^2` into `k(n/k)^2`. Measured on the same two grounds, 420 and 1,023
   * buckets of ~14 and ~16 boxes take the same builds to 268 ms and 682 —
   * 6.4x and 19.7x — and the exponent with them, to 0.89, which is a straight
   * line with the rounding off (`ENGINE_UPGRADE.md` S5b).
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
   * not.** The plugin's `executeStep` walks every body in the engine three
   * times, and a static one is a `continue` in each — which is why the
   * single-body version's argument was about DYNAMIC bodies rather than about
   * a list length. Measured with sixty-four boxes resting on the 1500 m
   * ground, a step costs 36/36 us with one static body and 35/31 with 1,023,
   * which is inside the scatter of the same reading taken twice. What does
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
    // Insertion-ordered, so the containers are built in the order the boxes
    // first reach them and the world is the same world on every boot. The
    // colliders are seeded and ordered; nothing here may make them less so.
    const buckets = new Map<string, PhysicsShapeContainer>();
    const bucket = (x: number, z: number): PhysicsShapeContainer => {
      const key = `${Math.floor(x / BLOCK_SIZE)},${Math.floor(z / BLOCK_SIZE)}`;
      let container = buckets.get(key);
      if (!container) {
        container = new PhysicsShapeContainer(this.scene);
        buckets.set(key, container);
      }
      return container;
    };

    for (const b of map.colliderBoxes) {
      const shape = new PhysicsShapeBox(
        Vector3.Zero(),
        Quaternion.Identity(),
        new Vector3(b.w, b.h, b.d),
        this.scene,
      );
      // MapBuilder.collider writes `mesh.rotation.set(rotX, rotY, 0)` and
      // Babylon's Euler order is yaw-pitch-roll, so this is the same
      // orientation — which is what carries the ramps across for free.
      //
      // Bucketed by the box's CENTRE, and a box wider than a block is
      // therefore in one bucket and hanging out of it — which the four rim
      // boundary boxes always are. That is a locality hint being imprecise,
      // not a shape being wrong: the child still carries the same world-space
      // transform it did when there was one container.
      bucket(b.cx, b.cz).addChild(
        shape,
        new Vector3(b.cx, b.cy, b.cz),
        Quaternion.RotationYawPitchRoll(b.rotY, b.rotX, 0),
      );
      this.worldLeaves.push(shape);
    }

    // The floor is the documented collider exception: a heightfield has no box
    // to stand in for it, so its blocks are mesh clones and come across as
    // mesh shapes. They are static, so each BVH is built once per map and
    // never again — and they are bucketed by their CENTRE exactly as a box is,
    // so a patch cut on a lattice of its own (`GameMap.terrainBlock`) is in one
    // bucket and hanging out of it, which is a locality hint being imprecise
    // rather than a shape being wrong. Its centre is read off the
    // bounding box rather than parsed out of the mesh's name, which is the
    // string-sniffing `GameMap.terrainColliders` exists to avoid.
    for (const mesh of map.terrainColliders) {
      const shape = new PhysicsShapeMesh(mesh as Mesh, this.scene);
      const centre = mesh.getBoundingInfo().boundingBox.centerWorld;
      bucket(centre.x, centre.z).addChild(shape);
      this.worldLeaves.push(shape);
    }

    for (const [key, container] of buckets) {
      const node = new TransformNode(`physics-world-${key}`, this.scene);
      const body = new PhysicsBody(
        node,
        PhysicsMotionType.STATIC,
        false,
        this.scene,
      );
      body.shape = container;
      this.worldNodes.push(node);
      this.worldBodies.push(body);
      this.worldShapes.push(container);
    }
  }

  /**
   * Releases the whole static world.
   *
   * **Every list, and all of them**: the world used to be one body, one
   * container and its leaves, and it is now one body and one container PER
   * BLOCK. A rebuild that dropped a single bucket would leak a live static
   * body into the next map — the editor's tier-3 rebuild does this on every
   * save — which is why the bucketing's sharp edge is here rather than in
   * `buildWorld`.
   */
  private clearWorld(): void {
    for (const b of this.worldBodies) b.dispose();
    for (const c of this.worldShapes) c.dispose();
    // Every leaf, or the WASM heap grows one map build at a time.
    for (const s of this.worldLeaves) s.dispose();
    for (const n of this.worldNodes) n.dispose();
    this.worldBodies = [];
    this.worldShapes = [];
    this.worldLeaves = [];
    this.worldNodes = [];
  }

  dispose(): void {
    this.clearWorld();
    this.clients = [];
  }
}
