/**
 * BlastDebrisSystem.ts — What a blast tears out of the ground and throws, and
 * the mark it leaves where it happened: two of `CONFIG.grenade`'s eight blast
 * layers, and the two that outlive the fire.
 * Owns: the chunk pool and its bodies, the per-surface rubble colours, and
 * `ScorchMarks`. The other six layers are `GrenadeSystem`'s.
 * Invariants: it is the THIRD `PhysicsClient` and owns no engine — see
 * `PhysicsWorld`. Nothing here feeds navigation, cover or hit detection: a
 * chunk is dressing exactly as a corpse and a glass shard are, and rounds and
 * bodies pass through it.
 *
 * ## What makes this worth having is that it knows what it went off ON
 *
 * A blast that throws the same grey chips in a wheat field, on a jungle floor
 * and in a marble lobby is a blast that has not noticed where it happened, and
 * that is most of why explosions read as decals stuck onto a world rather than
 * as something the world did. `GrenadeSystem.probeGround` casts one downward
 * ray at the detonation and reads the same `metadata.surface` a bullet's impact
 * reads — the field `MapBuilder` sets on exactly one thing, the terrain floor's
 * collider clone — so a blast is one of two things:
 *
 * | surface | throws | coloured from |
 * | --- | --- | --- |
 * | `ground` | more chunks, all of them smaller | the map's own `floorColor`, mixed toward subsoil: a crater turns up what is UNDER the field, not the field |
 * | `hard` (the default) | fewer, bigger, paler | a stone literal, for `DebrisSystem`'s reason — a system may not reach into the world layer's palette |
 *
 * Adding a third — timber off a barn, sheet metal off a car — is one arm in
 * `RUBBLE` and one member of `CombatSystem.ImpactKind`, and no signature
 * between here and the world layer moves.
 *
 * ## Everything is bounded, and each bound is a different thing
 *
 * **The POOL** is `debris.bursts` bursts of `debris.chunks` bodies, built once
 * and never rebuilt. At 3 and 10 that is 30 bodies, against `DebrisSystem`'s 48
 * and `RagdollSystem`'s 80 at full stretch; the three are one budget and want
 * raising together or not at all.
 *
 * **A chunk's SIZE is decided at construction, not at the burst.** Each of the
 * thirty gets its own three half-extents off a seeded stream, and its collision
 * shape is cut to them once — so the variety is baked into the pool and a burst
 * never builds a shape, never rewrites a vertex and never touches the WASM heap
 * on the frame somebody was killed. That is the one thing this does more simply
 * than `DebrisSystem`, which cannot: a glass shard's outline is cut from the
 * pane it came out of and cannot be known in advance.
 *
 * **The DISTANCE gate is `debris.distance`, scaled by `power`.** A 15 cm chunk
 * is a pixel at eighty metres and the blast has six other layers that carry at
 * that range; a tank shell throws bigger rubble and is allowed further. The
 * SCORCH is not gated by it — a mark is what is left when you walk back through
 * a minute later, and it has to be there when you do.
 *
 * **The pool EVICTS, but only what has already landed.** `DebrisSystem`'s rule
 * exactly, and for its reason: rubble that vanishes mid-flight is worse than
 * rubble that never flew, while a chunk lying in the road is fair game.
 */
import {
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  PhysicsBody,
  PhysicsMotionType,
  PhysicsShape,
  PhysicsShapeBox,
  Quaternion,
  Scene,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import type { CelMaterialFactory } from "../shaders/CelShader";
import { attachEmissiveFog } from "../shaders/EmissiveFog";
import type { ShaderMaterial } from "@babylonjs/core";
import type { EnvironmentSpec } from "../world/environment";
import type { BlastGround } from "./GrenadeSystem";
import {
  DEBRIS_GROUP,
  WORLD_GROUP,
  type PhysicsClient,
  type PhysicsWorld,
} from "./PhysicsWorld";

/**
 * What each surface throws, and the two rules the table is written under.
 *
 * `tint` for `hard` is a STONE LITERAL rather than a colour taken from the
 * world layer's palette — `src/world/kit/core.ts` is the map's own and a system
 * may not reach into it, which is exactly the note `DebrisSystem`'s `SHARD_COLOR`
 * carries. If the two ever disagree the rubble is the wrong grey and nothing
 * else breaks, which is the right failure for a duplicated art constant.
 *
 * `tint` for `ground` is null because it is the MAP's: a blast in a field turns
 * up what is under the field, so the colour is `EnvironmentSpec.floorColor`
 * mixed toward `SUBSOIL` and taken down by `EARTH_DARKEN`, through
 * `setEnvironment`.
 */
const RUBBLE: Record<
  BlastGround["surface"],
  { tint: string | null; count: number; size: number }
> = {
  ground: { tint: null, count: 1, size: 0.85 },
  hard: { tint: "#8d8781", count: 0.7, size: 1.25 },
};

/**
 * What a crater turns up, and how much of it is the map's rather than this.
 *
 * A blast does not throw the colour of the grass; it throws what was under it —
 * so the earth is the map's own `floorColor` mixed `EARTH_MIX` toward `SUBSOIL`
 * and then taken down a little. Both halves of that are load-bearing:
 *
 * - **A shared brown alone** puts Coldharbour's concrete craters in a ploughed
 *   field, which is the mismatch this whole file exists to avoid.
 * - **A plain multiple of `floorColor` alone** was tried first and is worse than
 *   it sounds. Every one of the four maps is already dark on the floor — #3a3a33
 *   is the brightest of them — so halving it is #1d1d19, and a cel material at
 *   that albedo under a night key is not dark rubble but no rubble at all.
 *
 * The mix is what keeps a chunk legible against the ground it came out of while
 * still belonging to it, and the `0.85` after it is the only "darker" left.
 */
const SUBSOIL = "#4a3a29";
const EARTH_MIX = 0.4;
const EARTH_DARKEN = 0.85;

/** Where a body waits between bursts, well under any map. `DebrisSystem`'s. */
const PARKED_Y = -1000;

/** One chunk: its mesh, the body that moves it, and the shape cut to its size. */
interface Chunk {
  mesh: Mesh;
  body: PhysicsBody;
  shape: PhysicsShape;
  /** Half-extents (m). The mesh, the shape and the mass all come off these. */
  hx: number;
  hy: number;
  hz: number;
}

/** One blast's worth of rubble, reused for the life of the process. */
interface Burst {
  chunks: Chunk[];
  /** Seconds since it was thrown, or -1 when the slot is free. */
  t: number;
  /** How many of its chunks this burst actually threw. */
  live: number;
}

/** Scratch — a burst must not allocate, and it runs on a frame somebody died on. */
const _vel = new Vector3();
const _spin = new Vector3();
const _tangent = new Vector3();
const _bitangent = new Vector3();
const _along = new Vector3();

export class BlastDebrisSystem implements PhysicsClient {
  private bursts: Burst[] = [];
  private readonly scorch: ScorchMarks;
  /**
   * The two rubble materials, rebuilt per map by `setEnvironment`. Null until
   * one has been installed, which is the state a burst before the first
   * `installMap` would be in — there is no such state in the game, and the
   * check is what makes that true rather than assumed.
   */
  private mats: Record<BlastGround["surface"], ShaderMaterial> | null = null;

  /**
   * The burst's own jitter stream, re-seeded by `reset` — so per round, and per
   * map with it.
   *
   * Seeded for `DebrisSystem`'s reason rather than for reproducibility of the
   * rubble: nothing may make a ROUND play out differently because a grenade
   * happened to go off near a bot, and a shared `Math.random` would put every
   * later draw in the process one call out of step.
   */
  private seed = 0x5bd1;

  constructor(
    private scene: Scene,
    private factory: CelMaterialFactory,
    private physics: PhysicsWorld,
  ) {
    physics.register(this);
    this.scorch = new ScorchMarks(scene);
    this.buildPool();
  }

  /** How many bursts are live. Test hook, exactly as `DebrisSystem`'s is. */
  get activeCount(): number {
    return this.bursts.reduce((n, b) => n + (b.t >= 0 ? 1 : 0), 0);
  }

  // --- PhysicsClient --------------------------------------------------------

  /** Whether any burst still owes the solver time. */
  physicsActive(): boolean {
    return this.bursts.some((b) => b.t >= 0);
  }

  afterFirstStep(): void {
    for (const burst of this.bursts) {
      if (burst.t < 0) continue;
      for (const c of burst.chunks) c.body.disablePreStep = true;
    }
  }

  /** The ground went away: park everything rather than leave it hanging. */
  worldCleared(): void {
    for (const burst of this.bursts) if (burst.t >= 0) this.release(burst);
  }

  // --- the map --------------------------------------------------------------

  /**
   * What this map's rubble is made of.
   *
   * Called from `installMap` with the environment the map was built against,
   * the same place `GrenadeSystem.setEnvironment` tints the dust — and for the
   * same reason: a blast is only ever seen against the map it went off on.
   *
   * **The scorch is deliberately not in here.** It multiplies rather than
   * paints (see `ScorchMarks`), so it is already the map's colour by
   * construction and has nothing to be told.
   */
  setEnvironment(env: EnvironmentSpec): void {
    const earth = Color3.Lerp(
      Color3.FromHexString(env.floorColor),
      Color3.FromHexString(SUBSOIL),
      EARTH_MIX,
    ).scale(EARTH_DARKEN);
    this.mats = {
      ground: this.factory.get(earth.toHexString()),
      hard: this.factory.get(RUBBLE.hard.tint!),
    };
  }

  // --- the burst ------------------------------------------------------------

  /**
   * A blast at `at`, of `power`, that went off on `ground`.
   *
   * Returns whether any rubble was thrown, which is false past the distance
   * gate and false with every slot's chunks still in the air. The SCORCH is
   * laid either way — it is neither gated nor pooled against the chunks, and a
   * blast that leaves no mark is the one thing here a player can walk back and
   * check.
   */
  burst(at: Vector3, power: number, ground: BlastGround, camPos: Vector3): boolean {
    const d = CONFIG.grenade.debris;
    this.scorch.mark(at, power, ground);

    if (!this.mats || this.bursts.length === 0) return false;
    if (Vector3.Distance(at, camPos) > d.distance * power) return false;

    const look = RUBBLE[ground.surface];
    const slot = this.take();
    if (!slot) return false;

    const material = this.mats[ground.surface];
    // Scaled by the surface AND by the blast: a shell in a field throws
    // everything the pool has, a grenade on flagstones throws seven pieces.
    const wanted = Math.min(
      slot.chunks.length,
      Math.max(3, Math.round(d.chunks * look.count * Math.min(1.6, power))),
    );
    slot.t = 0;
    slot.live = wanted;

    // An orthonormal pair across the surface, so the spread is laid out ON the
    // ground rather than in world XZ — a blast on a 30-degree bank throws its
    // rubble down the bank, which is the whole reason the normal is carried
    // this far.
    const up = ground.normal;
    _tangent.set(up.z, 0, -up.x);
    if (_tangent.lengthSquared() < 1e-6) _tangent.set(1, 0, 0);
    _tangent.normalize();
    Vector3.CrossToRef(up, _tangent, _bitangent);

    for (let i = 0; i < wanted; i++) {
      const chunk = slot.chunks[i];
      chunk.mesh.material = material;

      // Born spread across the crater rather than all at the centre, and lifted
      // clear of the surface by its own longest half-extent: thirty boxes born
      // at one point start interpenetrating, and Havok's first job would be
      // shoving them apart rather than throwing them.
      const yaw = ((i + this.rand()) / wanted) * Math.PI * 2;
      const spread = CONFIG.grenade.flash.radius * 0.35 * power * this.rand();
      const clear = Math.max(chunk.hx, chunk.hy, chunk.hz) + 0.04;
      chunk.mesh.position
        .copyFrom(_tangent)
        .scaleInPlace(Math.cos(yaw) * spread)
        .addInPlace(_along.copyFrom(_bitangent).scaleInPlace(Math.sin(yaw) * spread))
        .addInPlace(_along.copyFrom(up).scaleInPlace(clear))
        .addInPlace(at);
      Quaternion.RotationYawPitchRollToRef(
        this.rand() * Math.PI * 2,
        this.rand() * Math.PI * 2,
        this.rand() * Math.PI * 2,
        chunk.mesh.rotationQuaternion!,
      );
      // The surface's own size multiplier, and the ONE place the mesh and its
      // collision box are allowed to disagree: Havok's transform sync writes
      // position and orientation onto an unparented node and leaves scaling
      // alone, so a chunk drawn at 1.25 rests up to 3 cm inside the road it
      // landed on. That is under the ground's own vertex noise, against a piece
      // of dressing that is gone in seven seconds; the alternative is a second
      // shape per size, which is a WASM allocation for a shadow-thin gain.
      chunk.mesh.scaling.setAll(look.size);
      chunk.mesh.setEnabled(true);

      // Out along the ground and up off it, mixed by `lift`. The lift is high
      // and has to be — see `CONFIG.grenade.debris`. A chunk lighter than the
      // pool's biggest leaves faster, which is what makes one burst read as
      // gravel and grit rather than as ten identical bricks.
      //
      // The floor under the divisor is what keeps that from running away: the
      // smallest piece in the pool is a sixth of the largest by half-extent, so
      // an honest inverse would throw it six times as hard — 80 m/s under a
      // gravity of 18, which is a chunk of soil clearing the rooftops. At 0.65
      // the spread across the pool is about 2:1, which reads as a mix and lands
      // inside the crater.
      const heft = Math.max(0.65, chunk.hy / d.sizeMax);
      const speed = (d.speed * power * (0.55 + 0.75 * this.rand())) / heft;
      _vel
        .copyFrom(_tangent)
        .scaleInPlace(Math.cos(yaw) * (1 - d.lift))
        .addInPlace(
          _along.copyFrom(_bitangent).scaleInPlace(Math.sin(yaw) * (1 - d.lift)),
        )
        .addInPlace(
          _along.copyFrom(up).scaleInPlace(d.lift * (0.6 + 0.8 * this.rand())),
        )
        .normalize()
        .scaleInPlace(speed);
      const spin = d.spin * (0.4 + 1.2 * this.rand());
      _spin.set(
        (this.rand() - 0.5) * spin,
        (this.rand() - 0.5) * spin,
        (this.rand() - 0.5) * spin,
      );

      chunk.body.setMotionType(PhysicsMotionType.DYNAMIC);
      // Two-phase teleport, exactly as a corpse's bones and a glass shard take:
      // one step reads the node into the sim, and `afterFirstStep` hands
      // ownership over.
      chunk.body.disablePreStep = false;
      chunk.body.setLinearVelocity(_vel);
      chunk.body.setAngularVelocity(_spin);
    }
    return true;
  }

  /**
   * Ages every burst, sinks the ones that have outlived themselves, retires
   * them, and fades the marks.
   *
   * Like `RagdollSystem.update` and `DebrisSystem.update` it does NOT step the
   * engine — `PhysicsWorld` does, and must have run for this frame first.
   */
  update(dt: number): void {
    const d = CONFIG.grenade.debris;
    this.scorch.update(dt);
    for (const burst of this.bursts) {
      if (burst.t < 0) continue;
      burst.t += dt;
      // The sink is a corpse's and a shard's: the matte cel material writes
      // alpha 1.0 and one instance of it is shared by everything of that
      // colour, so a fade here would dim every chunk in the pool at once rather
      // than the burst that is expiring. A chunk goes down through the floor.
      const sinking = burst.t - d.life;
      if (sinking > 0) {
        const drop = (sinking / d.sink) * 0.5;
        for (let i = 0; i < burst.live; i++) {
          burst.chunks[i].mesh.position.y -= drop * dt * 8;
        }
      }
      if (burst.t > d.life + d.sink) this.release(burst);
    }
  }

  /**
   * A slot for a new blast: a free one, or the oldest burst whose rubble has
   * already landed. Null when every slot's chunks are still in the air.
   */
  private take(): Burst | null {
    let oldest: Burst | null = null;
    for (const burst of this.bursts) {
      if (burst.t < 0) return burst;
      if (!oldest || burst.t > oldest.t) oldest = burst;
    }
    // Two seconds is well past the fall: a chunk thrown at 11 m/s under the
    // death gravity is on the ground inside 1.2 s, and the margin is what stops
    // a second blast in the same doorway snatching rubble still bouncing.
    if (!oldest || oldest.t < 2) return null;
    this.release(oldest);
    return oldest;
  }

  /** Parks a burst's chunks and frees the slot. */
  private release(burst: Burst): void {
    burst.t = -1;
    burst.live = 0;
    for (const c of burst.chunks) {
      c.mesh.setEnabled(false);
      c.body.setLinearVelocity(Vector3.ZeroReadOnly);
      c.body.setAngularVelocity(Vector3.ZeroReadOnly);
      c.body.setMotionType(PhysicsMotionType.STATIC);
      // Parked THROUGH the plugin, not just by moving the node: a static body
      // whose transform was only written on the mesh leaves its collision proxy
      // where it stopped — an invisible box lying in the street that rounds and
      // bodies stop on. `RagdollSystem.park` carries the measurement.
      c.mesh.position.set(0, PARKED_Y, 0);
      c.body.disablePreStep = false;
      this.physics.plugin.setPhysicsBodyTransformation(c.body, c.mesh);
      c.body.disablePreStep = true;
    }
  }

  /**
   * The whole pool — meshes, shapes and bodies — built once at construction,
   * with every chunk's size drawn HERE rather than at a burst.
   *
   * That is the saving the whole file is arranged around: thirty boxes and
   * thirty WASM shapes are not a cost to pay on the frame a grenade goes off,
   * and because a chunk keeps its size for the life of the process, a burst is
   * thirty property writes and no allocation at all.
   *
   * The stream is the seeded one, so the pool is identical between page loads
   * — the same rule world-building runs under, and the reason a screenshot diff
   * of a blast means anything.
   */
  private buildPool(): void {
    const d = CONFIG.grenade.debris;
    const death = CONFIG.bots.death;
    const span = d.sizeMax - d.sizeMin;
    for (let i = 0; i < d.bursts; i++) {
      const chunks: Chunk[] = [];
      for (let j = 0; j < d.chunks; j++) {
        // A base size walking the band across the burst, then three axes
        // jittered off it: a cube is a die and a slab is a paving stone, and a
        // burst wants both.
        const base = d.sizeMin + span * ((j + 0.5) / d.chunks);
        const hx = base * (0.7 + 0.6 * this.rand());
        const hy = base * (0.55 + 0.5 * this.rand());
        const hz = base * (0.7 + 0.6 * this.rand());
        const mesh = MeshBuilder.CreateBox(
          `blastChunk${i}-${j}`,
          { width: hx * 2, height: hy * 2, depth: hz * 2 },
          this.scene,
        );
        mesh.position.y = PARKED_Y;
        mesh.rotationQuaternion = Quaternion.Identity();
        mesh.isPickable = false;
        mesh.checkCollisions = false;
        mesh.setEnabled(false);
        // No ink and no bloom. An outline shell around a 15 cm box is most of
        // the pixels it covers and doubles a draw that is on screen for six
        // seconds; `noGlow` is not inert, because this system is built before
        // `Game`'s construction-time glow-exclusion scan runs — the same
        // ordering `DebrisSystem`'s pool relies on.
        mesh.metadata = { noGlow: true };

        const shape = new PhysicsShapeBox(
          Vector3.Zero(),
          Quaternion.Identity(),
          new Vector3(hx * 2, hy * 2, hz * 2),
          this.scene,
        );
        shape.material = { friction: death.friction, restitution: 0.2 };
        shape.filterMembershipMask = DEBRIS_GROUP;
        // The world and nothing else — see `DEBRIS_GROUP`. Rubble must not
        // shove corpses, and chunk-on-chunk buys a pile nobody looks at for a
        // solver cost quadratic in the burst.
        shape.filterCollideMask = WORLD_GROUP;

        // The body is on the MESH with no proxy node, which a chunk can do and
        // a ragdoll's bone cannot: it is parented to nothing and posed by
        // nobody, so the quaternion Havok writes is the only thing that ever
        // orients it.
        const body = new PhysicsBody(
          mesh,
          PhysicsMotionType.STATIC,
          false,
          this.scene,
        );
        body.shape = shape;
        body.setMassProperties({ mass: (d.mass * (hx * hy * hz)) / (d.sizeMax ** 3) });
        body.setLinearDamping(death.linearDamping);
        body.setAngularDamping(death.angularDamping);

        chunks.push({ mesh, body, shape, hx, hy, hz });
      }
      this.bursts.push({ chunks, t: -1, live: 0 });
    }
  }

  /** xorshift on the shared seed — see `seed`. */
  private rand(): number {
    this.seed ^= this.seed << 13;
    this.seed ^= this.seed >>> 17;
    this.seed ^= this.seed << 5;
    return ((this.seed >>> 0) % 10000) / 10000;
  }

  /** Drops every burst and every mark. Round start and map rebuild. */
  reset(): void {
    for (const burst of this.bursts) if (burst.t >= 0) this.release(burst);
    this.scorch.reset();
    this.seed = 0x5bd1;
  }

  dispose(): void {
    this.reset();
    for (const burst of this.bursts) {
      for (const c of burst.chunks) {
        c.body.dispose();
        c.shape.dispose();
        c.mesh.dispose();
      }
    }
    this.bursts = [];
    this.scorch.dispose();
  }
}

/** One scorch: the disc, and how long it has left. */
interface Mark {
  mesh: Mesh;
  /** Seconds since it was laid; < 0 while the slot is free. */
  t: number;
}

/**
 * The mark a blast leaves on the ground, and the only layer of an explosion
 * still there when you walk back through a minute later.
 *
 * A flat disc laid on whatever the blast went off on and turned onto that
 * surface's own normal, darkening the middle and ragged at the edge, holding
 * for `scorch.life` and fading over `scorch.fade`.
 *
 * **Four things about it are what stop a decal from looking like a decal**, and
 * every one of them has been got wrong here already:
 *
 * - **It is BLACK, and that is what makes it a multiply.** Ordinary alpha
 *   blending over an RGB of zero is `dst * (1 - a) + 0 * a` — a proportional
 *   DARKENING of whatever the mark is lying on, which needs no per-map tuning at
 *   all. Both of the things that look like the answer instead are wrong, and
 *   both were tried:
 *   - **A dark COLOUR rather than black** is what the first version painted
 *     (`floorColor * 0.16` at 62% alpha). On Hollowmere's night cobbles that is
 *     a near-black disc over a near-black street — no contrast whatever, and a
 *     value tuned to read at dusk in a city vanishes in a village at night.
 *     Painting a colour ON cannot know what it is landing on.
 *   - **`Constants.ALPHA_MULTIPLY`** is `blendFunc(DST_COLOR, ZERO)`: the result
 *     is `dst * src` and the source ALPHA plays no part in the colour at all. A
 *     black disc came out as a hard-edged black hole cut in the street, with the
 *     soft texture doing nothing and `mesh.visibility` unable to fade it. The
 *     mode is named for multiplying COLOURS, not for a decal.
 * - **It loses the depth fight on purpose.** `disableDepthWrite` plus a
 *   negative `zOffset` — the polygon offset is what puts it in front of the
 *   floor it is lying on, rather than a lift big enough to make it visibly
 *   hover the moment the ground tilts. `scorch.lift` is the small remainder.
 * - **It is turned onto the surface, not onto world up.** A mark drawn flat on
 *   a hillside is a disc floating over it at both ends.
 * - **It is FOGGED**, through the same `attachEmissiveFog` plugin every unlit
 *   emissive material in the game wears — and it is the fog that stops a distant
 *   mark darkening, because the plugin lifts the RGB off black toward the fog
 *   colour and `dst * (1 - a) + fog * a` is the haze rather than a hole in it. A
 *   scorch that stayed pitch black across a valley the rest of which had gone to
 *   haze is the bug that rule exists for.
 *
 * One material for every mark and one texture behind it, so the per-mark fade
 * is `mesh.visibility` — which IS per mesh, is the same lever the fireball's
 * lobes fade on, and at zero walks the mark back to `dst` exactly.
 */
class ScorchMarks {
  private marks: Mark[] = [];
  private readonly material: StandardMaterial;

  constructor(scene: Scene) {
    const s = CONFIG.grenade.scorch;
    this.material = new StandardMaterial("blastScorch", scene);
    this.material.opacityTexture = buildScorchTexture(scene);
    this.material.diffuseColor = Color3.Black();
    this.material.specularColor = Color3.Black();
    // BLACK, and it has to be: ordinary alpha blending over zero is
    // `dst * (1 - a)`, which is the proportional darkening this whole decal is.
    // Any RGB above zero is a colour being painted ON the ground instead, which
    // is the version that could not be made to read on a night village and a
    // dusk city at once. The blend mode is left at the DEFAULT for the same
    // reason — see the header on what `ALPHA_MULTIPLY` actually does. The RGB's
    // only other job is to be lifted toward the fog colour by the plugin below,
    // which is what stops a distant mark darkening.
    this.material.emissiveColor = Color3.Black();
    this.material.disableLighting = true;
    this.material.backFaceCulling = false;
    this.material.disableDepthWrite = true;
    // BOTH terms. `zOffset` is the polygon-offset FACTOR, which is scaled by
    // the fragment's depth slope — and a decal lying flat on a floor seen from
    // above has a slope of very nearly zero, so the factor alone does nothing
    // in exactly the case the offset exists for. `zOffsetUnits` is the constant
    // that bites there.
    this.material.zOffset = -2;
    this.material.zOffsetUnits = -4;
    attachEmissiveFog(this.material);

    for (let i = 0; i < s.marks; i++) {
      // Built at radius 1 and scaled, which a flat disc may do and a physics
      // body may not: nothing here is under the solver.
      const mesh = MeshBuilder.CreateDisc(
        `blastScorch${i}`,
        { radius: 1, tessellation: 24 },
        scene,
      );
      mesh.material = this.material;
      mesh.metadata = { noGlow: true, noShadowCaster: true };
      mesh.isPickable = false;
      mesh.checkCollisions = false;
      mesh.rotationQuaternion = Quaternion.Identity();
      mesh.isVisible = false;
      this.marks.push({ mesh, t: -1 });
    }
  }

  /**
   * One mark at a blast. An exhausted pool takes the OLDEST rather than
   * refusing — `BlastDust`'s rule and for its reason: nothing is spent on a
   * mark, so a blast with no scorch is a worse lie than an old one cut short.
   */
  mark(at: Vector3, power: number, ground: BlastGround): void {
    const s = CONFIG.grenade.scorch;
    let slot = this.marks[0];
    for (const m of this.marks) {
      if (m.t < 0) {
        slot = m;
        break;
      }
      if (m.t > slot.t) slot = m;
    }
    // `CreateDisc` faces +Z, so the turn is from that onto the surface normal.
    Quaternion.FromUnitVectorsToRef(
      FORWARD,
      ground.normal,
      slot.mesh.rotationQuaternion!,
    );
    slot.mesh.position
      .copyFrom(ground.normal)
      .scaleInPlace(s.lift)
      .addInPlace(at);
    slot.mesh.scaling.setAll(s.radius * power);
    slot.mesh.visibility = s.opacity;
    slot.mesh.isVisible = true;
    slot.t = 0;
  }

  update(dt: number): void {
    const s = CONFIG.grenade.scorch;
    for (const m of this.marks) {
      if (m.t < 0) continue;
      m.t += dt;
      if (m.t > s.life + s.fade) {
        m.t = -1;
        m.mesh.isVisible = false;
        continue;
      }
      if (m.t > s.life) {
        m.mesh.visibility = s.opacity * (1 - (m.t - s.life) / s.fade);
      }
    }
  }

  reset(): void {
    for (const m of this.marks) {
      m.t = -1;
      m.mesh.isVisible = false;
    }
  }

  dispose(): void {
    for (const m of this.marks) m.mesh.dispose();
    this.marks = [];
    this.material.dispose();
  }
}

/** `CreateDisc`'s own facing, for the turn onto a surface normal. */
const FORWARD = new Vector3(0, 0, 1);

/**
 * The scorch: an alpha map, dark and solid at the middle, ragged and thin at
 * the rim, with streaks running out of it.
 *
 * Generated so the game still ships no image files, and generated the way
 * `buildPuffTexture` is: FIXED offsets rather than random ones. One texture is
 * shared by every mark on the map, so a texture that differed between page
 * loads would only make a screenshot diff lie — the variety is in the size and
 * the rotation each mark is laid at.
 *
 * The streaks are what make it a blast rather than a stain. A pure radial
 * gradient is a shadow; the spokes out of the middle are the thing an eye reads
 * as something having been thrown outward from a point.
 */
function buildScorchTexture(scene: Scene): DynamicTexture {
  const size = 256;
  const texture = new DynamicTexture(
    "blastScorchTex",
    { width: size, height: size },
    scene,
    false,
  );
  const ctx = texture.getContext();
  const c = size / 2;
  ctx.clearRect(0, 0, size, size);

  // The body, and it stops well SHORT of the rim on purpose — 0.62 of the
  // radius, with the spokes below running out past it. A core that filled the
  // disc is a smooth ellipse whatever its falloff, and a smooth ellipse
  // multiplied over a street is read as a hole in the street rather than as
  // soot on it. The silhouette has to be broken by something.
  const core = ctx.createRadialGradient(c, c, 0, c, c, c);
  core.addColorStop(0, "rgba(255,255,255,0.95)");
  core.addColorStop(0.22, "rgba(255,255,255,0.82)");
  core.addColorStop(0.44, "rgba(255,255,255,0.4)");
  core.addColorStop(0.62, "rgba(255,255,255,0.12)");
  core.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, size, size);

  // The spokes: 17 of them at the golden angle, so no two are opposite and the
  // pattern has no axis for the eye to find. Length and width walk with the
  // index rather than with a random, for the reason above, and the longest run
  // to the rim — they are what a blast throws out and what stops the mark
  // having an outline.
  //
  // Painted with the DEFAULT composite, which is the one Babylon's
  // `ICanvasRenderingContext` exposes — and it is the right one anyway: plain
  // source-over alpha reaches `src + dst * (1 - src)`, so a spoke deepens the
  // thin part of the body it crosses without blowing the core out to solid.
  for (let i = 0; i < 17; i++) {
    const a = i * 2.399963;
    const len = c * (0.62 + 0.38 * (((i * 5) % 7) / 6));
    const wide = 0.045 + 0.055 * (((i * 3) % 5) / 4);
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.arc(c, c, len, a - wide, a + wide);
    ctx.closePath();
    const spoke = ctx.createRadialGradient(c, c, c * 0.12, c, c, len);
    spoke.addColorStop(0, "rgba(255,255,255,0.45)");
    spoke.addColorStop(0.55, "rgba(255,255,255,0.2)");
    spoke.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = spoke;
    ctx.fill();
  }

  texture.update();
  texture.hasAlpha = true;
  return texture;
}
