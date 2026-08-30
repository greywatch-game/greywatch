/**
 * DebrisSystem.ts — The glass a broken pane throws: a pool of thin rigid
 * bodies under `PhysicsWorld`, cut from the pane they came out of along the
 * cracks a round would have put in it.
 * Owns: the shard pool, its bodies and meshes, the per-size collision shapes,
 * and the burst's own clock. The crack pattern itself is
 * [`glassFracture.ts`](glassFracture.ts).
 * Invariants: it is the second `PhysicsClient` and owns no engine — see
 * `PhysicsWorld`. Nothing here feeds navigation, cover or hit detection: a shard
 * is dressing, exactly as a corpse is, and rounds and bodies pass through it.
 *
 * ## A shard is a fraction of its pane, not a fixed chip
 *
 * This threw twelve 16 cm chips into an 0.8 m cube at the crossing point, for
 * every pane on the map. Against a small punched window that reads; against a
 * shopfront bay it is the bug the whole system was built to avoid — a sheet of
 * glass several metres across vanishes in one frame and a handful of gravel
 * appears where the round went in, so the eye reads the pane as DELETED rather
 * than broken.
 *
 * So the burst is cut from the pane instead. `glass.shards` pieces are cut out
 * of the sheet's own face, laid out ON it, in its plane, before they are
 * thrown — at t=0 a burst is very nearly the sheet that was standing there,
 * which is what makes the next quarter second read as it coming apart.
 *
 * Where a pane is bigger than a burst — any kit that makes a whole glazed
 * elevation breakable in one piece — the pattern is centred on the hole and
 * clipped to the face rather than spread thin across it. That is the graceful
 * failure and it is deliberate: twelve pieces sprinkled over ninety square
 * metres is confetti, while twelve over the two metres around the round is a
 * hole with glass falling out of it. **The right fix for a pane that big is a
 * smaller pane** — see `kit/city.ts`, where the shopfront breaks a bay at a
 * time, the unit its own piers divide the elevation into.
 *
 * ## The pieces are CUT, and a cut is not a grid
 *
 * They were rectangles once, one size, square to the frame, in rows — the face
 * divided into cells of `sqrt(area / shards)` and a piece taken from each. Every
 * rule around it was already right and the shatter still read as a mosaic
 * sliding out of a wall, because glass does not break on a grid. It breaks from
 * the point the load went in, along radials out of the hole crossed by
 * concentric rings, and what falls out is wedges: narrow at the hole, broad at
 * the frame, no two alike. `glassFracture.fracture` is that pattern and this
 * file is what it costs — a piece is a convex polygon of up to `MAX_CORNERS`
 * corners, so a shard's MESH is written per burst rather than scaled.
 *
 * **The topology is fixed even though the outline is not**, which is what keeps
 * that affordable: every shard mesh is an eight-cornered prism built once, and
 * a piece with fewer corners repeats its last one so the spare triangles come
 * out degenerate — the same trick `GlassSystem.collapse` breaks a pane with. A
 * burst rewrites 48 vertices per shard into a buffer it already owns; it never
 * builds a mesh, an index buffer or a geometry.
 *
 * ## Which way the glass goes: the sheet's normal, the round's side
 *
 * A sheet leaves its frame along its own NORMAL, on the side the round was
 * going. The round drags glass along its own path only WITHIN the plane, where
 * its direction is projected. That is not just how a pane fails: it is what
 * keeps the pieces out of the frame they hung in and off the piers either side
 * of them.
 *
 * **The side needs no question asked of the pane, because every pane that
 * breaks is a way THROUGH** (see `PaneSpec.breakable`): there is a room behind
 * it, the shot has just opened it, and that is where the glass belongs. It was
 * a question once, when a city's decorative glazing broke too — a sheet hanging
 * 4 cm off a solid shaft had to throw its pieces back toward the SHOOTER, the
 * one side provably open, or Havok spent the first frames shoving bodies out of
 * the concrete they had been spawned inside. That glass no longer breaks, so
 * the case is gone rather than handled.
 *
 * ## Everything here is bounded, and each bound is a different thing
 *
 * **The POOL** is `glass.maxConcurrent` bursts of `glass.shards` bodies, built
 * once in the constructor and never rebuilt. At four and twelve that is 48
 * bodies, about five corpses — against eight corpses (80 bodies) measured at
 * 0.121 ms/frame, with the whole roster's AI at 0.39–0.42 ms in the same run.
 * The two are one budget and want raising together or not at all.
 *
 * **The DISTANCE** is `glass.shardDistance` and is deliberately not the fog wall
 * that gates a corpse. It is expressed for a piece of `shardMax` and scaled by
 * the pitch the pattern was cut at, because the question a gate answers is how
 * big the thing looks: a 16 cm chip is a pixel at sixty metres and a 0.9 m panel
 * is not. The BREAK is not gated by it: the pane goes at any range, because that
 * is the world changing rather than an effect playing.
 *
 * **The POOL EVICTS, but only what has already landed.** It used to refuse
 * outright, which is `GrenadeSystem`'s rule — but a refused burst is a window
 * that came out of a building with no glass in it, which is exactly the
 * mismatch above. `glass.shardSteal` is the compromise: a burst still in the
 * air is never stolen, because glass that vanishes mid-fall is worse than glass
 * that never flew, while one lying on the pavement is fair game.
 *
 * **There is no fallback and no reason for one.** Havok is required (see
 * `PhysicsWorld`) and the bodies are hung on the meshes in this constructor, so
 * a burst is either under the solver or is not drawn at all. What used to be
 * here was a scripted ballistic arc with the terrain as a floor, for the case
 * where a window broke before the WASM landed — a case that no longer exists,
 * carrying a second integrator and a terrain pointer for a fall nobody had
 * seen since the engine started shipping with the build.
 */
import {
  Mesh,
  PhysicsBody,
  PhysicsMotionType,
  PhysicsShape,
  PhysicsShapeBox,
  Quaternion,
  Scene,
  Vector3,
  VertexBuffer,
  VertexData,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import { clamp } from "../core/math";
import type { CelMaterialFactory } from "../shaders/CelShader";
import type { WorldPane } from "../world/MapBuilder";
import { DEBRIS_GROUP, WORLD_GROUP, type PhysicsClient, type PhysicsWorld } from "./PhysicsWorld";
import { MAX_CORNERS, fracture, makePieces, type ShardPiece } from "./glassFracture";

/**
 * The glazing's own colour, and it is the kit's `GLASS` restated rather than
 * imported: `src/world/kit/core.ts` is the world layer's palette and a system
 * may not reach into it. If the two ever disagree the shards are the wrong
 * colour and nothing else breaks, which is the right failure for a duplicated
 * art constant — see `CombatSystem`, whose spark colours are literals for the
 * same reason.
 *
 * **A shard is drawn OPAQUE in it, unlike the pane it came out of.** That is
 * not an oversight: the pane's material composites a reflection over this
 * colour and reads as glass because it is a sheet with a sky in it, and a piece
 * of it in mid-air has neither — transparent, it is very nearly invisible, and
 * forty-eight of them would be forty-eight sorted draws for the privilege.
 * `mats.get` is the matte variant. It is also what makes the moment of the
 * break read: shattering glass goes opaque as it crazes, so a plane of matte
 * panels appearing where a clear sheet stood is the right first frame.
 */
const SHARD_COLOR = "#2a333b";

/** Where a body waits between bursts, well under any map. */
const PARKED_Y = -1000;

/**
 * Metres. Piece extents are rounded to this before a collision shape is looked
 * up, which is what keeps the shape cache small: a cut pattern makes every
 * piece a different size where the grid made twelve of one, so the step is
 * coarse on purpose — a box up to 5 cm out on a plate that is dressing either
 * way. The cache is still bounded rather than merely slow-growing: a piece is
 * never wider than the pattern's own reach, which is `shardMax` times a
 * constant, so the key space is a few hundred at the very worst and a few
 * dozen in practice.
 */
const SIZE_STEP = 0.1;

/**
 * How far the crack pattern reaches, over the radius a disc of the burst's own
 * area would have.
 *
 * A burst is `shards` pieces of about `pitch`, so its area is fixed and the
 * disc that holds it follows. Laid over a rectangle that disc leaves the
 * corners, and a burst that covered the sheet worse than the grid it replaced
 * would trade one mismatch for another — so it reaches a little past its own
 * area, and the pieces at the rim are what run off the edge of the pane.
 */
const REACH_OVER = 1.1;

/**
 * Radians. How far a piece is turned out of the sheet's own plane as it goes,
 * and how far it is turned within it.
 *
 * Both are small and the in-plane one is smaller, which is the pattern's doing
 * rather than timidity: the pieces TILE the face, so a roll about the normal
 * is the one rotation that puts them through each other and takes the cracks
 * out of the first frame. Out of plane costs nothing — a plate foreshortens
 * and the crack it was cut along stays where it was.
 */
const TILT = 0.2;
const ROLL = 0.1;

/**
 * Metres. How far out of the plane a piece's own corner is allowed to reach by
 * being tilted, and it is a LENGTH rather than an angle because that is what
 * the pane costs.
 *
 * A tilted plate stands off the sheet by its half-extent times its angle, so
 * one angle for every piece means the burst's biggest panel starts a quarter
 * of a metre inside the shop while its smallest starts three centimetres in —
 * and the first frame, which is meant to be a cracked pane, is a plane of
 * glass hanging off the frame instead. Holding the REACH still and letting the
 * angle fall out of it fixes the standoff at ~0.17 m for every piece of every
 * size, most of which is the two colliders' own thickness. It also happens to
 * be how glass goes: a big panel leaves flat and a chip spins.
 */
const LEAN = 0.05;

/** Vertices in one shard mesh: a corner front, back, and twice per side quad. */
const SHARD_VERTS = MAX_CORNERS * 6;

/** One piece of glass: its mesh, the body that moves it, and the outline both wear. */
interface Shard {
  mesh: Mesh;
  body: PhysicsBody;
  /** The mesh's own vertex buffers, rewritten per burst and never reallocated. */
  pos: Float32Array;
  nrm: Float32Array;
  /** Which collision shape this body currently holds, by `shapeKey`. */
  key: number;
}

/** One pane's worth of shards, reused for the life of the process. */
interface Burst {
  shards: Shard[];
  /** Seconds since it was thrown, or -1 when the slot is free. */
  t: number;
  /** How many of its shards this burst actually cut. */
  live: number;
}

export class DebrisSystem implements PhysicsClient {
  private bursts: Burst[] = [];
  /**
   * Collision shapes by rounded size, shared by every body of that size and
   * never disposed until this system is. A shape is a WASM allocation and the
   * frame a window breaks on is the worst one available to spend it, so the
   * first burst that wants a given size pays for it and no later one does.
   */
  private shapes = new Map<number, PhysicsShape>();
  /**
   * The pieces the current burst is cut into, refilled in place. One buffer,
   * because a burst is resolved before the next one can start.
   */
  private readonly pieces = makePieces(CONFIG.glass.shards);
  /**
   * Every shard's index buffer, and there is only one: the topology is fixed
   * (see the header) so this is built once and shared by all 48 meshes. It is
   * declared before the constructor runs `buildPool`, which needs it.
   */
  private readonly indices = shardIndices();
  /**
   * The burst's own jitter stream, re-seeded by `reset` — so per round, and
   * per map with it.
   *
   * Seeded for `RagdollSystem`'s reason rather than for reproducibility of the
   * glass itself: nothing may make a ROUND play out differently because a
   * window happened to break near a bot, and a shared `Math.random` would put
   * every later draw in the process one call out of step.
   */
  private seed = 0x91a5;

  // Scratch. A burst runs every frame while it is live, and FINDINGS #7 already
  // measures 13.4 KB/frame of allocation churn without this file in it. The two
  // vectors are the throw, handed straight to the body and never read back.
  private readonly vel = new Vector3();
  private readonly spin = new Vector3();

  constructor(
    private scene: Scene,
    private mats: CelMaterialFactory,
    private physics: PhysicsWorld,
  ) {
    physics.register(this);
    this.buildPool();
  }

  /** How many bursts are live. Test hook. */
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
      for (const s of burst.shards) s.body.disablePreStep = true;
    }
  }

  /** The ground went away: park everything rather than leave it hanging. */
  worldCleared(): void {
    for (const burst of this.bursts) if (burst.t >= 0) this.release(burst);
  }

  // --- the burst ------------------------------------------------------------

  /**
   * The pane `geom` went in, crossed at `at` by a round travelling along `dir`.
   *
   * Returns whether anything was drawn, which is false past the distance gate
   * and false with every slot's burst still in the air — and in both cases the
   * pane is still gone, because the break is the world changing and this is
   * only what it looked like.
   */
  burst(geom: WorldPane, at: Vector3, dir: Vector3, camPos: Vector3): boolean {
    if (this.bursts.length === 0) return false;
    const g = CONFIG.glass;

    // --- the sheet's own frame ---------------------------------------------
    //
    // A pane is thin in ONE of its two horizontal axes and the other spans the
    // face. Local +x is world (cos, -sin) and local +z is world (sin, cos) —
    // `GlassSystem.segmentHitsPane`'s convention, which this must not mirror or
    // every yawed building on the map throws its glass sideways.
    const c = Math.cos(geom.rotY);
    const s = Math.sin(geom.rotY);
    const alongX = geom.w >= geom.d;
    const faceW = alongX ? geom.w : geom.d;
    const faceH = geom.h;
    const thick = alongX ? geom.d : geom.w;
    // Out of the face.
    const nx = alongX ? s : c;
    const nz = alongX ? c : -s;
    // **Across it, and DERIVED from the normal rather than from the pane's own
    // long axis.** A shard is no longer a box: it is a polygon cut in these
    // coordinates and written into a mesh that one yaw about the normal
    // orients, and that yaw is what fixes where local +x points in the world —
    // `(nz, -nx)`. An across-axis that disagreed with it by a sign would mirror
    // every piece about its own centre, which a box could not tell you about
    // and the pattern's tiling comes apart over.
    const ux = nz;
    const uz = -nx;

    // --- how big a piece, and how far the cracks run ------------------------
    //
    // The pitch is what a piece averages: the sheet's own area over the budget,
    // held in the band. `reach` is the radius the pattern is cut out to — see
    // `REACH_OVER`.
    const pitch = clamp(Math.sqrt((faceW * faceH) / g.shards), g.shardMin, g.shardMax);
    const reach = pitch * Math.sqrt(g.shards / Math.PI) * REACH_OVER;

    // The gate is an apparent size, not a distance: `shardDistance` is quoted
    // for a piece of `shardMax` and a smaller cut stops nearer, in proportion.
    // See the header.
    const seen = (g.shardDistance * pitch) / g.shardMax;
    if (Vector3.Distance(at, camPos) > seen) return false;

    // Where the round crossed, in the face's own coordinates: `du` across it
    // from the centre, `dv` up it.
    const du = (at.x - geom.cx) * ux + (at.z - geom.cz) * uz;
    const dv = at.y - geom.cy;

    const rand = () => {
      // xorshift on the shared seed: one stream for every burst, so the draw
      // count is a function of how much glass has broken and of nothing else.
      this.seed ^= this.seed << 13;
      this.seed ^= this.seed >>> 17;
      this.seed ^= this.seed << 5;
      return ((this.seed >>> 0) % 10000) / 10000;
    };

    // Cut BEFORE a slot is taken, so a pattern that comes back with nothing —
    // a pane too small to hold one piece — costs no burst its place in the
    // pool. `take` evicts, and evicting for a burst that is then not drawn is
    // the one way this could take glass off the street for nothing.
    const count = fracture(
      this.pieces,
      faceW,
      faceH,
      du,
      dv,
      reach,
      g.shardPack,
      rand,
    );
    if (count === 0) return false;

    const slot = this.take();
    if (!slot) return false;
    slot.t = 0;
    slot.live = count;

    // --- which way it leaves ------------------------------------------------
    //
    // The way the round went, always: a pane that breaks is a pane with a room
    // behind it, and the room is where the glass goes. See the header for the
    // case this used to be a choice between.
    const facing = dir.x * nx + dir.z * nz;
    const side = facing > 0 ? 1 : -1;
    // The round's own direction, projected into the plane. Out-of-plane it is
    // the normal above and nothing else, which is what keeps the glass out of
    // the frame the pane was hanging in.
    const carry = dir.x * ux + dir.z * uz;
    // The one turn that puts a piece back on the sheet it was cut from: local
    // +z onto the pane's normal, local +x onto the across-axis above.
    const yaw = Math.atan2(nx, nz);

    for (let k = 0; k < count; k++) {
      const piece = this.pieces[k];
      const shard = slot.shards[k];
      this.cut(shard, piece);

      // Clear of the pane's own thickness on the side it is leaving by, so a
      // piece starts neither inside the sheet it replaces nor inside the frame
      // that sheet was hanging in — and on the far side of the collider, which
      // is still standing until the authority says otherwise. `LEAN` is the
      // last term of it: what the tilt below is allowed to add.
      const standoff = side * (thick / 2 + g.shardCollide / 2 + LEAN + 0.02);
      shard.mesh.position.set(
        geom.cx + piece.u * ux + standoff * nx,
        geom.cy + piece.v,
        geom.cz + piece.u * uz + standoff * nz,
      );
      // Turned onto the pane's own normal, then nudged off it. The nudge is
      // small on purpose: the first frame is a cracked pane and not a cloud,
      // and Havok has the rest of the fall to make it one. The out-of-plane
      // pair is bounded by what it may REACH rather than by an angle — see
      // `LEAN` — so a panel and a chip stand off the sheet by the same amount.
      const swing = Math.min(TILT, (2 * LEAN) / Math.max(piece.hw, piece.hh, 0.05));
      Quaternion.RotationYawPitchRollToRef(
        yaw + (rand() - 0.5) * swing,
        (rand() - 0.5) * swing,
        (rand() - 0.5) * ROLL,
        shard.mesh.rotationQuaternion!,
      );
      shard.mesh.setEnabled(true);

      // **What the round did, and what gravity is about to do.** A piece at the
      // hole is blown out of the frame and carried along the round's own path;
      // one at the far corner of the sheet simply lets go. The falloff is the
      // whole difference between a break and an explosion.
      const d = Math.hypot(piece.u - du, piece.v - dv) / g.shardBlast;
      const f = 1 / (1 + d * d);
      const out = g.shardSpeed * (0.2 + 0.8 * f) * side;
      const along = g.shardSpeed * g.shardAlongShot * f;
      this.vel.set(
        out * nx + carry * along * ux + (rand() - 0.5) * g.shardSpread,
        dir.y * along - g.shardDrop * (1 - 0.5 * f) + (rand() - 0.5) * g.shardSpread,
        out * nz + carry * along * uz + (rand() - 0.5) * g.shardSpread,
      );
      const spin = g.shardSpin * (0.25 + 0.75 * f);
      this.spin.set(
        (rand() - 0.5) * spin,
        (rand() - 0.5) * spin,
        (rand() - 0.5) * spin,
      );

      shard.body.setMotionType(PhysicsMotionType.DYNAMIC);
      // Two-phase teleport, exactly as a corpse's bones take: one step reads
      // the node into the sim, and `afterFirstStep` hands ownership over.
      shard.body.disablePreStep = false;
      shard.body.setLinearVelocity(this.vel);
      shard.body.setAngularVelocity(this.spin);
    }
    return true;
  }

  /**
   * Ages every burst, sinks the ones that have outlived themselves, and
   * retires them.
   *
   * Like `RagdollSystem.update` it does NOT step the engine — `PhysicsWorld`
   * does, and must have run for this frame first.
   */
  update(dt: number): void {
    const g = CONFIG.glass;
    for (const burst of this.bursts) {
      if (burst.t < 0) continue;
      burst.t += dt;

      // The sink is the same idea as a corpse's and for the same reason: the
      // matte cel material writes alpha 1.0 outright and one instance of it is
      // shared by everything of that colour, so a fade here would dim every
      // shard in the pool at once rather than the burst that is expiring. A
      // shard goes down through the floor instead.
      const sinking = burst.t - g.shardLife;
      if (sinking > 0) {
        const drop = (sinking / g.shardSink) * 0.5;
        for (let i = 0; i < burst.live; i++) burst.shards[i].mesh.position.y -= drop * dt * 8;
      }
      if (burst.t > g.shardLife + g.shardSink) this.release(burst);
    }
  }

  /**
   * A slot for a new pane: a free one, or the oldest burst that has already
   * landed. Null when every slot holds glass still in the air — see
   * `glass.shardSteal`.
   */
  private take(): Burst | null {
    let oldest: Burst | null = null;
    for (const burst of this.bursts) {
      if (burst.t < 0) return burst;
      if (!oldest || burst.t > oldest.t) oldest = burst;
    }
    if (!oldest || oldest.t < CONFIG.glass.shardSteal) return null;
    this.release(oldest);
    return oldest;
  }

  /**
   * Writes one piece into one shard: the prism's vertices and normals, and the
   * collision box cut to the same extents.
   *
   * **The outline is in the VERTICES, and nothing here scales anything.** It
   * was a unit box with `mesh.scaling` for a size, which Havok's transform sync
   * makes safe — it writes position and orientation onto an unparented node and
   * leaves scaling alone — but a scaling cannot express a polygon. So the piece
   * is written flat into the buffer this shard already owns, in its own local
   * frame, and the body is sized by its shape as before. The two are cut from
   * the same numbers here and nowhere else; a mismatch shows as a piece resting
   * a few centimetres inside the road.
   */
  private cut(shard: Shard, piece: ShardPiece): void {
    const t = CONFIG.glass.shardThickness / 2;
    const pos = shard.pos;
    const n = piece.n;
    // Front and back faces. The pad is the fixed topology's price and the
    // whole reason it is affordable: a piece with fewer corners than the mesh
    // has repeats its last one, which leaves every triangle built on the spare
    // corners degenerate — drawn as nothing, exactly as a collapsed pane is.
    for (let i = 0; i < MAX_CORNERS; i++) {
      const m = i < n ? i : n - 1;
      const x = piece.x[m];
      const y = piece.y[m];
      let o = i * 3;
      pos[o] = x;
      pos[o + 1] = y;
      pos[o + 2] = t;
      o = (MAX_CORNERS + i) * 3;
      pos[o] = x;
      pos[o + 1] = y;
      pos[o + 2] = -t;
    }
    // The edge between each pair, four vertices of its own so the sheet's rim
    // is a hard edge rather than a smeared normal.
    for (let e = 0; e < MAX_CORNERS; e++) {
      const b = e + 1 === MAX_CORNERS ? 0 : e + 1;
      const ax = pos[e * 3];
      const ay = pos[e * 3 + 1];
      const bx = pos[b * 3];
      const by = pos[b * 3 + 1];
      const o = (MAX_CORNERS * 2 + e * 4) * 3;
      pos[o] = ax;
      pos[o + 1] = ay;
      pos[o + 2] = t;
      pos[o + 3] = ax;
      pos[o + 4] = ay;
      pos[o + 5] = -t;
      pos[o + 6] = bx;
      pos[o + 7] = by;
      pos[o + 8] = -t;
      pos[o + 9] = bx;
      pos[o + 10] = by;
      pos[o + 11] = t;
    }
    // Computed rather than written out: a degenerate face contributes a zero
    // normal and no more, which is what makes the pad invisible here too.
    VertexData.ComputeNormals(pos, this.indices, shard.nrm);
    // `true` is the extents: the bounding box is what the frustum test reads,
    // and a shard that kept the last piece's would be culled by the outline of
    // a piece that is no longer there.
    shard.mesh.updateVerticesData(VertexBuffer.PositionKind, pos, true);
    shard.mesh.updateVerticesData(VertexBuffer.NormalKind, shard.nrm);

    const key = shapeKey(piece.hw * 2, piece.hh * 2);
    if (key !== shard.key) {
      shard.key = key;
      shard.body.shape = this.shapeFor(key);
    }
    // After the shape, which recomputes the mass properties from it.
    shard.body.setMassProperties({ mass: massFor(piece.area) });
  }

  /** The shared collision shape for a piece of this rounded size, built once. */
  private shapeFor(key: number): PhysicsShape {
    const found = this.shapes.get(key);
    if (found) return found;
    const d = CONFIG.bots.death;
    const shape = new PhysicsShapeBox(
      Vector3.Zero(),
      Quaternion.Identity(),
      new Vector3(
        Math.floor(key / 1000) * SIZE_STEP,
        (key % 1000) * SIZE_STEP,
        CONFIG.glass.shardCollide,
      ),
      this.scene,
    );
    shape.material = { friction: d.friction, restitution: 0.12 };
    shape.filterMembershipMask = DEBRIS_GROUP;
    // The world and nothing else — see `DEBRIS_GROUP`.
    shape.filterCollideMask = WORLD_GROUP;
    this.shapes.set(key, shape);
    return shape;
  }

  /** Parks a burst's shards and frees the slot. */
  private release(burst: Burst): void {
    burst.t = -1;
    burst.live = 0;
    for (const s of burst.shards) {
      s.mesh.setEnabled(false);
      s.body.setLinearVelocity(Vector3.ZeroReadOnly);
      s.body.setAngularVelocity(Vector3.ZeroReadOnly);
      s.body.setMotionType(PhysicsMotionType.STATIC);
      // Parked THROUGH the plugin, not just by moving the node. A static body
      // whose transform was only written on the mesh leaves its collision
      // proxy where it stopped — an invisible box lying in the street that
      // rounds and bodies stop on. `RagdollSystem.park` carries the measurement
      // that found it.
      s.mesh.position.set(0, PARKED_Y, 0);
      s.body.disablePreStep = false;
      this.physics.plugin.setPhysicsBodyTransformation(s.body, s.mesh);
      s.body.disablePreStep = true;
    }
  }

  /**
   * The whole pool — meshes and bodies together — built once at construction.
   *
   * It was two methods, and the split was the fallback's: the meshes were made
   * here and the bodies hung on them later, from a `physicsStarted` callback,
   * so a window broken before the WASM landed still threw shards on a scripted
   * arc. The engine is up before this system is constructed now, so there is
   * one phase and a shard has a body from the moment it exists.
   *
   * It is still not built on the frame a window breaks: 48 meshes, their GL
   * buffers and their shapes are not a cost to pay on the frame somebody pulled
   * a trigger — `DeathCam`'s stand-in rig is built at `startRound` for the same
   * reason. What a burst DOES pay for on that frame is a `cut` per piece: a
   * rewrite of vertices the mesh already has, and never a geometry, an index
   * buffer or — once a size has been seen — a shape.
   *
   * **A shard's body is on the MESH, with no proxy node**, which is the one way
   * this is simpler than a corpse. A ragdoll needs proxies because Havok's sync
   * force-creates a `rotationQuaternion` on any node with a parent and the rig
   * is posed through Euler channels — but a shard is parented to nothing, is
   * posed by nobody, and is handed back to nothing. The quaternion Havok writes
   * is the only thing that ever orients it.
   */
  private buildPool(): void {
    const g = CONFIG.glass;
    const d = CONFIG.bots.death;
    const material = this.mats.get(SHARD_COLOR);
    // A middle size, so the pool starts consistent and no shape is built on a
    // frame that matters unless the cut asks for one this is not.
    const w0 = (g.shardMin + g.shardMax) / 2;
    const key0 = shapeKey(w0, w0);
    const shape = this.shapeFor(key0);
    for (let i = 0; i < g.maxConcurrent; i++) {
      const shards: Shard[] = [];
      for (let j = 0; j < g.shards; j++) {
        // An eight-cornered prism of nothing: the vertices are the burst's to
        // write (see `cut`), and the indices over them never change. Its own
        // buffers rather than one shared pair, because Babylon keeps the array
        // it was handed as the mesh's CPU-side copy — one scratch buffer would
        // leave every shard reading the last one cut.
        const pos = new Float32Array(SHARD_VERTS * 3);
        const nrm = new Float32Array(SHARD_VERTS * 3);
        const mesh = new Mesh(`shard${i}-${j}`, this.scene);
        const data = new VertexData();
        data.positions = pos;
        data.normals = nrm;
        data.indices = this.indices;
        data.applyToMesh(mesh, true);
        mesh.material = material;
        mesh.position.y = PARKED_Y;
        mesh.rotationQuaternion = Quaternion.Identity();
        mesh.isPickable = false;
        mesh.checkCollisions = false;
        mesh.setEnabled(false);
        // No outline and no glow. An ink shell around a piece of glass is most
        // of the pixels it covers, and 48 outlined meshes is 96 draws for
        // something on screen for a second and a half. `noGlow` is what makes
        // the second half true and is NOT inert: this pool exists by the time
        // `Game`'s construction-time exclusion scan runs, because `Game` builds
        // this system before it builds the glow layer's exclusions.
        mesh.metadata = { noOutline: true, noGlow: true };

        const body = new PhysicsBody(
          mesh,
          PhysicsMotionType.STATIC,
          false,
          this.scene,
        );
        body.shape = shape;
        body.setMassProperties({ mass: massFor(w0 * w0) });
        body.setLinearDamping(d.linearDamping);
        body.setAngularDamping(d.angularDamping);

        shards.push({ mesh, body, pos, nrm, key: key0 });
      }
      this.bursts.push({ shards, t: -1, live: 0 });
    }
  }

  /** Drops every burst and re-seeds the jitter. Round start and map rebuild. */
  reset(): void {
    for (const burst of this.bursts) if (burst.t >= 0) this.release(burst);
    this.seed = 0x91a5;
  }

  dispose(): void {
    this.reset();
    for (const burst of this.bursts) {
      for (const s of burst.shards) {
        s.body.dispose();
        s.mesh.dispose();
      }
    }
    this.bursts = [];
    for (const s of this.shapes.values()) s.dispose();
    this.shapes.clear();
  }
}

/**
 * A piece's mass, from its area. `glass.shardMass` is quoted for a piece of
 * `shardMax` square and everything smaller is lighter in proportion, so a
 * cottage window's shards skitter where a shopfront's panels drop.
 */
function massFor(area: number): number {
  const g = CONFIG.glass;
  return (g.shardMass * area) / (g.shardMax * g.shardMax);
}

/**
 * The cache key for a collision box of this size, and the only place a piece's
 * extents are rounded. A step at each end so a splinter still gets a box the
 * solver can see.
 */
function shapeKey(w: number, h: number): number {
  const qw = Math.max(1, Math.round(w / SIZE_STEP));
  const qh = Math.max(1, Math.round(h / SIZE_STEP));
  return qw * 1000 + qh;
}

/**
 * Every shard's triangles, over the fixed eight-corner topology: a fan across
 * the front, the same fan reversed across the back, and a quad bridging each
 * pair of corners.
 *
 * **Wound for Babylon's LEFT-handed default**, where a front face is clockwise
 * seen from the front — the order worked out on paper from the cross product is
 * inverted here and fails silently, which is `BuildingKit.gableEnd`'s note and
 * this is the same prism it builds.
 */
function shardIndices(): number[] {
  const n = MAX_CORNERS;
  const idx: number[] = [];
  for (let m = 1; m + 1 < n; m++) idx.push(0, m, m + 1);
  for (let m = 1; m + 1 < n; m++) idx.push(n, n + m + 1, n + m);
  for (let e = 0; e < n; e++) {
    const o = n * 2 + e * 4;
    idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
  return idx;
}
