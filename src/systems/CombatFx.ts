/**
 * CombatFx.ts — The PICTURE of a round: the tracer streak, the impact spark,
 * the dust disc and the bullet mark, as fixed-size pools.
 * Owns: the four pools, the `IMPACTS` look table, the tracer's flight and the
 * impact it spawns on arrival, and the wall query `drawRounds` makes for a
 * round this client did not resolve.
 * Invariants: it READS the simulation and never writes it — what it draws
 * reaches it as `CombatSystem.onRound` (wired by `Game`) or as a `drawRounds`
 * call, and nothing here deals damage, raises a near miss or breaks glass.
 * Every pool is fixed-size: add new effects to a pool, NEVER allocate per
 * shot. The authority never builds one (`BABYLON_EXIT.md` X2.2) — the
 * simulation half is all `server/HeadlessGame.ts` holds.
 * Contract: this header. `docs/rendering.md` "Impacts" for the disc and the
 * mark, `docs/multiplayer.md` for `drawRounds`.
 *
 * Split out of `CombatSystem` at X2.2 C2, and the line is the one the brief
 * draws for every mixed system: the simulation keeps the name and the shot,
 * and this file keeps everything a GPU is needed for. Its inputs are
 * `Vector3Like` and are read through their FIELDS, because the simulation's
 * vectors are `src/math`'s and a Babylon method would read `_x` off one and
 * write NaN.
 *
 * The disc pool is `noGlow`, which the bloom reads every frame; without it
 * every dust disc blooms like a lamp.
 * The MARK pool (`BulletMarks`) is the one whose slots outlive the shot, and
 * the two things that reach out of it are here rather than there: a mark is
 * owed by the impact KIND (`IMPACTS.mark`, absent on flesh and on glass), and
 * only ever by a round that stopped on the STATIC world — a hull is "hard"
 * like any other box and is the one solid thing in the game that drives away
 * from where it was shot. The simulation says which (`onRound`'s `mark`).
 * `drawRounds` is the PICTURE without the shot: no target list, no near miss
 * and no `onShotPath`, so it deals no damage and breaks no glass. It exists for
 * the rounds this client did not resolve — everybody else's, in a match, where
 * the authority sends the trigger and nothing else (`docs/multiplayer.md`).
 * A tracer is a short streak flown from muzzle to impact over several frames,
 * NOT a muzzle-to-impact beam — the hit is resolved instantly regardless, so
 * the flight is presentation only and must never gate damage. The impact spark
 * rides the streak and spawns on arrival: it is the one thing here that waits,
 * because an impact seen before its round lands is what makes a slowed tracer
 * read as fake — and `onImpact`, the sound, rides the same clock.
 */
import {
  Mesh,
  MeshBuilder,
  Quaternion,
  Scene,
  Vector3,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import type { Vector3Like } from "../math";
import type { CelMaterialFactory } from "../shaders/CelShader";
import { newRayHit, type RayHull, type RayWorld } from "../world/RayWorld";
import { BulletMarks } from "./BulletMarks";
import type { ImpactKind } from "./CombatSystem";

/**
 * How each kind looks: the hot core, the dust disc, how big it opens, and the
 * MARK it leaves once the dust is gone.
 *
 * The first three are the moment and the fourth is the minute after it, which
 * is why `mark` is the one field here whose absence is a statement rather than
 * a default: a kind with none leaves nothing behind. Flesh does not (there is
 * no blood in this game), and glass does not (a pane either breaks whole or is
 * decoration — `docs/world.md`), so the two that mark are the two that throw
 * dust, and each marks in its own dust's colour a good deal darker. `radius`
 * is metres, before the per-mark jitter `BulletMarks.place` rolls on top.
 */
const IMPACTS: Record<
  ImpactKind,
  {
    spark: string | null;
    disc: string | null;
    from: number;
    to: number;
    mark: { hex: string; radius: number } | null;
  }
> = {
  // A hit on a body gets the spark and NO disc. Flesh does not throw dust on
  // the world, and the hitmarker plus `Sfx.hit` is where that confirmation
  // actually lands. There is no blood anywhere in this game and this is not
  // the pass that introduces it.
  flesh: { spark: "#ffe680", disc: null, from: 0, to: 0, mark: null },
  // Stone and timber: the original grey spark, plus a small pale bloom of
  // dust off the face — and a chip out of the render that stays.
  hard: {
    spark: "#c8c8c8",
    disc: "#b9b4ab",
    from: 0.15,
    to: 0.5,
    mark: { hex: "#2b2723", radius: 0.042 },
  },
  // Earth does not spark. It throws more and glows less, so the disc alone,
  // bigger and duller — and the divot it leaves is bigger and warmer for the
  // same reason.
  ground: {
    spark: null,
    disc: "#6b5a44",
    from: 0.2,
    to: 0.75,
    mark: { hex: "#4b3a26", radius: 0.062 },
  },
  // Glass is the odd one, and it is the ONLY kind not chosen by
  // `metadata.surface`: a round passes through a pane rather than stopping on
  // it, so there is no pick to read a surface off. `GlassSystem` names this
  // one directly at the crossing point. A bright cold spark and no disc —
  // glass throws shards, which `DebrisSystem` draws, not dust.
  glass: { spark: "#cfeaf2", disc: null, from: 0, to: 0, mark: null },
};

interface Tracer {
  mesh: Mesh;
  /** Muzzle, and the unit direction to the impact point. */
  from: Vector3;
  dir: Vector3;
  /** Metres from muzzle to whatever the round stopped on. */
  dist: number;
  /** Metres the leading edge has flown. The tail trails it by `tracerLength`. */
  head: number;
  alive: boolean;
  /** Where the round stopped — `from + dir * dist`, kept for the spark. */
  impact: Vector3;
  /**
   * The impact this round owes, spawned when the streak's head arrives and
   * nulled so it fires once. Null for a round that stopped on nothing.
   */
  impactKind: ImpactKind | null;
  /**
   * The surface normal there, copied at spawn so the streak allocates nothing
   * in flight. Points up when the pick could not supply one, which is the
   * right guess for the only surface that answers "ground".
   */
  impactNormal: Vector3;
  /**
   * Whether this round's impact may leave a MARK — which is a question about
   * what it stopped ON and not about the surface, so it cannot be read off
   * `impactKind`.
   *
   * False for a round that stopped on a HULL. A hull answers "hard" like every
   * other box in the world and gets the spark and the dust for it, but it is
   * the one solid thing in this game that MOVES (`docs/vehicles.md`), and a
   * decal is stood in the world rather than parented to anything — so a mark
   * on a tank is one hanging in the street the moment it drives off.
   */
  impactMark: boolean;
}

/** One dust disc: a facing quad that opens and fades on the surface. */
interface Disc {
  mesh: Mesh;
  t: number;
  from: number;
  to: number;
}

interface Spark {
  mesh: Mesh;
  t: number;
}

/** Reused by the tracer update so a live streak costs no allocation. */
const SCRATCH = new Vector3();
/** Where a drawn round stopped, handed to `spawnTracer`, which copies it. */
const DRAWN_TO = new Vector3();
const UP = Vector3.Up();
const FORWARD = Vector3.Forward();

/**
 * The transient effects a round throws off, object-pooled. Built once by
 * `Game` with the scene and never rebuilt — a map change clears it.
 */
export class CombatFx {
  private tracers: Tracer[] = [];
  private sparks: Spark[] = [];
  private discs: Disc[] = [];
  /**
   * The fourth pool, and the only one whose slots outlive the shot — see
   * `BulletMarks`. Built here rather than wired by `Game` for the reason the
   * other three are: it is this file's own picture of a round arriving, and
   * nothing outside ever raises one.
   */
  private marks: BulletMarks;

  /**
   * Wired by Game: a round ARRIVED somewhere, at the moment its streak got
   * there rather than the moment the damage resolved.
   *
   * A callback because this file draws the player's rounds and every bot's
   * and must not know what `Sfx` is. `at` is the tracer's own vector: read
   * it, do not keep it.
   */
  onImpact: (at: Vector3, kind: ImpactKind) => void = () => {};

  /**
   * The solid world, for `drawRounds`' own wall query. Wired beside
   * `CombatSystem.setWorld` from `installMap`, so a drawn round stops where a
   * resolved one would.
   */
  private rays: RayWorld | null = null;

  /** `drawRounds`' wall query. Scratch: read inside the call, never held. */
  private readonly wall = newRayHit();

  setWorld(rays: RayWorld | null): void {
    this.rays = rays;
  }

  constructor(
    scene: Scene,
    private mats: CelMaterialFactory,
  ) {
    const fx = CONFIG.effects;
    for (let i = 0; i < fx.tracerPoolSize; i++) {
      const mesh = MeshBuilder.CreateCylinder(
        `tracer${i}`,
        { height: 1, diameter: 0.055, tessellation: 5 },
        scene,
      );
      mesh.material = mats.getEmissive("#ffe680");
      mesh.rotationQuaternion = Quaternion.Identity();
      mesh.isVisible = false;
      mesh.isPickable = false;
      this.tracers.push({
        mesh,
        from: Vector3.Zero(),
        dir: Vector3.Forward(),
        dist: 0,
        head: 0,
        alive: false,
        impact: Vector3.Zero(),
        impactKind: null,
        impactNormal: Vector3.Up(),
        impactMark: false,
      });
    }
    for (let i = 0; i < fx.sparkPoolSize; i++) {
      const mesh = MeshBuilder.CreateSphere(
        `spark${i}`,
        { diameter: 0.3, segments: 4 },
        scene,
      );
      mesh.material = mats.getEmissive("#ffe680");
      mesh.isVisible = false;
      mesh.isPickable = false;
      this.sparks.push({ mesh, t: 0 });
    }
    for (let i = 0; i < fx.discPoolSize; i++) {
      // DOUBLESIDE as GEOMETRY, never by touching the material's
      // `backFaceCulling`: `getEmissive` caches one material per colour and
      // this pool shares those with the tracers and the sparks, so a flag
      // flipped here would flip for every effect in the game. A disc is lifted
      // off its surface and can be looked at from either side of a thin wall.
      const mesh = MeshBuilder.CreateDisc(
        `impact${i}`,
        { radius: 1, tessellation: 8, sideOrientation: Mesh.DOUBLESIDE },
        scene,
      );
      mesh.rotationQuaternion = Quaternion.Identity();
      mesh.isVisible = false;
      mesh.isPickable = false;
      // Out of the bloom — see the header. Without it a brown dust disc
      // blooms like a lamp.
      mesh.metadata = { noGlow: true };
      this.discs.push({ mesh, t: 0, from: 0, to: 1 });
    }
    this.marks = new BulletMarks(scene, mats);
  }

  /**
   * A round the SIMULATION resolved — `CombatSystem.onRound`, wired by `Game`
   * to this and to nothing else. The arguments are that event's, and every
   * vector in it is read here and copied, never held: `to` is the shot's
   * `hitPoint`, `normal` the wall query's scratch.
   */
  drawRound(
    muzzle: Vector3Like,
    to: Vector3Like,
    kind: ImpactKind | null,
    normal: Vector3Like | null,
    mark: boolean,
  ): void {
    this.spawnTracer(muzzle, to, kind, normal, mark);
  }

  /**
   * Rounds SOMEBODY ELSE fired, DRAWN and nothing else — `drawBlast`'s
   * counterpart, public for the same reason: in a match the authority raises
   * them with nothing on the wire but who fired, and this client owes the
   * picture.
   *
   * Offline every tracer in the village comes out of `CombatSystem.fire`
   * (through `onRound`), because this machine resolves every round in it. In a
   * netplay round it resolves exactly one shooter's — its own — so without
   * this the rest of the roster fired invisible rounds: the report and the
   * minimap reveal arrived and nothing left the barrel. See
   * `Game.drawNetShots`.
   *
   * Three things `fire` does are deliberately NOT done here, and each one is
   * an outcome rather than a picture. No target list is walked, so nothing
   * takes damage and no near miss is raised — the authority sends `hit`,
   * `damage` and `nearmiss` itself, and a second opinion here would double
   * every cue it carries. And `onShotPath` is not raised, so this breaks no
   * glass: a pane is the authority's (`docs/multiplayer.md`), and a client
   * breaking one off a drawn round would put a hole in a window nobody shot
   * through on any other screen.
   *
   * What is left is the wall query — the same `castRound` `fire` pays for, so
   * the streak stops where the round did and the dust comes off the surface it
   * stopped on. `origin` is the shooter's EYE and `muzzle` is where the streak
   * is flown from, which is the split `BattleSystem.botFire` already makes.
   *
   * **The BURST is one call and one ray**, which is the whole reason the count
   * is a parameter rather than the caller looping: a snapshot's worth of
   * rounds off one slot share an origin and an axis by construction — the
   * client has one pose for them — so the second cast could only ever return
   * what the first did. What differs is WHEN each one leaves the barrel, and
   * that is `spacing`, laid back across the interval exactly as the reports
   * are.
   */
  drawRounds(
    origin: Vector3Like,
    dir: Vector3Like,
    muzzle: Vector3Like,
    range: number,
    rounds: number,
    spacing: number,
    fromHull: RayHull | null = null,
  ): void {
    const hitWall =
      this.rays !== null &&
      this.rays.castRound(origin, dir, range, this.wall, fromHull);
    const dist = hitWall ? this.wall.distance : range;
    // On the FIELDS: either library's vector may arrive here. Scratch, and
    // handed straight to `spawnTracer`, which copies it.
    DRAWN_TO.copyFromFloats(
      origin.x + dir.x * dist,
      origin.y + dir.y * dist,
      origin.z + dir.z * dist,
    );
    const kind = hitWall ? this.wall.surface : null;
    const normal = hitWall ? this.wall.normal : null;
    const mark = hitWall && this.wall.hull === null;
    for (let i = 0; i < rounds; i++) {
      this.spawnTracer(muzzle, DRAWN_TO, kind, normal, mark, i * spacing);
    }
  }

  update(dt: number): void {
    // Tracers: a fixed-length streak flying from the muzzle to the impact
    // point. The head runs out to `dist` and stops there; the tail keeps going
    // until it catches up, so the streak emerges from the barrel and is eaten
    // by whatever the round hit rather than popping in and out whole.
    const fx = CONFIG.effects;
    for (const tr of this.tracers) {
      if (!tr.alive) continue;
      tr.head += fx.tracerSpeed * dt;
      // Still behind the barrel — see `spawnTracer`. It holds a pool slot,
      // which is the point: a queued round that lost its slot to the next
      // shot would be one that never left.
      if (tr.head < 0) continue;
      tr.mesh.isVisible = true;
      if (tr.impactKind !== null && tr.head >= tr.dist) {
        this.spawnImpact(tr.impact, tr.impactNormal, tr.impactKind, tr.impactMark);
        // Nulled so it fires once, and it is also what makes the sound and
        // the visual one event rather than two things that could disagree.
        tr.impactKind = null;
      }
      const tail = tr.head - fx.tracerLength;
      if (tail >= tr.dist) {
        tr.alive = false;
        tr.mesh.isVisible = false;
        continue;
      }
      const back = Math.max(tail, 0);
      const len = Math.max(Math.min(tr.head, tr.dist) - back, 0.01);
      // Pooled effect: no per-frame allocation.
      tr.dir.scaleToRef(back + len / 2, SCRATCH);
      tr.mesh.position.copyFrom(tr.from).addInPlace(SCRATCH);
      tr.mesh.scaling.set(1, len, 1);
    }

    // Sparks: quick scale-out pops.
    for (const s of this.sparks) {
      if (s.t > 0) {
        s.t -= dt;
        const k = Math.max(0, s.t / 0.18);
        s.mesh.scaling.setAll(0.4 + (1 - k) * 1.6);
        s.mesh.visibility = k;
        if (s.t <= 0) s.mesh.isVisible = false;
      }
    }

    // Dust discs: open out from `from` to `to` and fade as they go. The fade
    // is the square of the remaining life rather than the life itself, so
    // most of the disc's visible time is spent near its opening size — dust
    // thrown off a wall is briefly dense and then mostly gone, and a linear
    // alpha reads as a solid plate shrinking.
    for (const d of this.discs) {
      if (d.t > 0) {
        d.t -= dt;
        const k = Math.max(0, d.t / CONFIG.effects.discLife);
        d.mesh.scaling.setAll(d.from + (1 - k) * (d.to - d.from));
        d.mesh.visibility = k * k;
        if (d.t <= 0) d.mesh.isVisible = false;
      }
    }
  }

  /**
   * Shows idle members of the effect pools for the frames of the building
   * card's pipeline warm-up (`core/PipelineWarmup.ts`), or takes them back
   * off — so the first shot of a round draws through pipelines already
   * compiled rather than paying for four of them on the frame the trigger is
   * pulled.
   *
   * **Each is posed as it is IN FLIGHT, because that is what decides the
   * pipeline, and an idle pose compiles the wrong one.** A tracer is stretched
   * along its length, and a non-uniform scale is a different effect
   * (`NONUNIFORMSCALING`); a spark and a disc fade by `visibility`, and under 1
   * that is a BLENDED pipeline beside the opaque one their first frame uses —
   * so the two of those are shown twice, once at each. Only idle slots are
   * used, from the end of each pool, and every property touched is put back
   * exactly as it was.
   */
  warm(on: boolean): void {
    const look = IMPACTS.hard;
    if (!on) {
      for (let i = 0; i < this.warmedCount; i++) {
        const w = this.warmed[i];
        w.mesh!.isVisible = false;
        w.mesh!.visibility = w.visibility;
        w.mesh!.scaling.copyFrom(w.scaling);
        w.mesh = null;
      }
      this.warmedCount = 0;
      this.marks.warm(false, look.mark!.hex);
      return;
    }
    const tracer = this.tracers[this.tracers.length - 1];
    if (!tracer.alive) this.warmOne(tracer.mesh, 1, 3);
    for (let i = 0; i < 2; i++) {
      const spark = this.sparks[this.sparks.length - 1 - i];
      if (spark.t > 0) continue;
      spark.mesh.material = this.mats.getEmissive(look.spark!);
      this.warmOne(spark.mesh, i === 0 ? 1 : 0.5, 1);
    }
    for (let i = 0; i < 2; i++) {
      const disc = this.discs[this.discs.length - 1 - i];
      if (disc.t > 0) continue;
      disc.mesh.material = this.mats.getEmissive(look.disc!);
      this.warmOne(disc.mesh, i === 0 ? 1 : 0.5, 1);
    }
    this.marks.warm(true, look.mark!.hex);
  }

  /** One pooled mesh shown for `warm`, its old visibility and scale kept. */
  private warmOne(mesh: Mesh, visibility: number, stretch: number): void {
    if (mesh.isVisible) return;
    const w = this.warmed[this.warmedCount++];
    w.mesh = mesh;
    w.visibility = mesh.visibility;
    w.scaling.copyFrom(mesh.scaling);
    mesh.visibility = visibility;
    mesh.scaling.set(1, stretch, 1);
    mesh.isVisible = true;
  }
  /**
   * What `warm` switched on, and what to put back when it switches off: one
   * record per mesh it can show (a tracer, two sparks, two discs), held so a
   * warm frame allocates nothing.
   */
  private readonly warmed = Array.from({ length: 5 }, () => ({
    mesh: null as Mesh | null,
    visibility: 1,
    scaling: new Vector3(),
  }));
  private warmedCount = 0;

  /** Clears transient effects between rounds. */
  clearTransient(): void {
    for (const tr of this.tracers) {
      tr.alive = false;
      tr.impactKind = null;
      tr.mesh.isVisible = false;
    }
    for (const s of this.sparks) {
      s.t = 0;
      s.mesh.isVisible = false;
    }
    for (const d of this.discs) {
      d.t = 0;
      d.mesh.isVisible = false;
    }
    // The marks go with them, and this is the only thing that takes one off
    // the world: they belong to the MAP that was standing when they were
    // made, and this method is called from `teardownMap` before the next one
    // is built.
    this.marks.clear();
  }

  /**
   * `kind` is the impact this round owes on arrival, or null if it stopped on
   * nothing. A stolen slot (exhausted pool) drops its pending impact with the
   * streak it belonged to, which is right: an impact whose tracer was recycled
   * would pop with nothing visibly arriving — and would fire a sound with it.
   *
   * `normal` is the surface's, or null where there is no disc to orient (a
   * flesh hit, or a round that stopped on nothing). Every vector is COPIED
   * here, through its fields, rather than held — so nothing in flight
   * references a query result, and either library's vector may arrive.
   */
  private spawnTracer(
    from: Vector3Like,
    to: Vector3Like,
    kind: ImpactKind | null,
    normal: Vector3Like | null,
    mark: boolean,
    delay = 0,
  ): void {
    const tr = this.tracers.find((t) => !t.alive) ?? this.tracers[0];
    tr.from.copyFromFloats(from.x, from.y, from.z);
    const delta = tr.dir.copyFromFloats(to.x - from.x, to.y - from.y, to.z - from.z);
    const dist = Math.max(delta.length(), 0.01);
    delta.scaleInPlace(1 / dist);
    tr.dist = dist;
    // A round still waiting its turn starts with its head BEHIND the muzzle —
    // the delay expressed as the metres it has yet to fly rather than as a
    // clock of its own, so `update` needs no second timer and the pool stays a
    // pool. See `drawRounds`, the one caller that passes one.
    tr.head = -delay * CONFIG.effects.tracerSpeed;
    tr.alive = true;
    tr.impact.copyFromFloats(to.x, to.y, to.z);
    tr.impactKind = kind;
    tr.impactMark = mark;
    // Up is the right guess where the pick could not supply one: the only
    // surface that answers "ground" is the valley floor.
    if (normal) tr.impactNormal.copyFromFloats(normal.x, normal.y, normal.z);
    else tr.impactNormal.set(0, 1, 0);
    // The direction is fixed for the whole flight, so this is set once here and
    // only `update` moves the streak along it.
    Quaternion.FromUnitVectorsToRef(UP, delta, tr.mesh.rotationQuaternion!);
    tr.mesh.position.copyFrom(tr.from);
    tr.mesh.scaling.set(1, 0.01, 1);
    tr.mesh.isVisible = tr.head >= 0;
  }

  /**
   * A round arriving: the hot core, the dust it throws, and the noise of it.
   *
   * One entry point for all three so the surface is looked up once and the
   * sound cannot drift out of step with the picture — they are the same
   * event, and this is the moment the streak got there rather than the moment
   * the damage resolved. Whether the sound is actually played is `Sfx`'s
   * decision, not this file's: it owns the voice budget the sixteen bots
   * are competing for, and there is nothing useful this side of it could
   * decide about audibility.
   */
  private spawnImpact(
    pos: Vector3,
    normal: Vector3,
    kind: ImpactKind,
    mark: boolean,
  ): void {
    const look = IMPACTS[kind];
    if (look.spark) this.spawnSpark(pos, look.spark);
    if (look.disc) this.spawnDisc(pos, normal, look);
    // Two gates and they ask different things: the KIND says whether this
    // surface is one that keeps a mark at all, and `mark` says whether what
    // was hit will still be there to keep it.
    if (look.mark && mark) {
      this.marks.place(pos, normal, look.mark.hex, look.mark.radius);
    }
    this.onImpact(pos, kind);
  }

  private spawnDisc(
    pos: Vector3,
    normal: Vector3,
    look: { disc: string | null; from: number; to: number },
  ): void {
    const d = this.discs.find((x) => x.t <= 0) ?? this.discs[0];
    // Off the surface along its own normal. A coplanar quad z-fights with the
    // wall it was thrown from, and that reads as a broken decal rather than
    // as dust — see `effects.discLift`.
    normal.scaleToRef(CONFIG.effects.discLift, SCRATCH);
    d.mesh.position.copyFrom(pos).addInPlace(SCRATCH);
    // A disc is built in the XY plane facing +Z, so its facing is the axis
    // that has to be turned onto the normal.
    Quaternion.FromUnitVectorsToRef(FORWARD, normal, d.mesh.rotationQuaternion!);
    d.mesh.material = this.mats.getEmissive(look.disc!);
    d.from = look.from;
    d.to = look.to;
    d.mesh.scaling.setAll(look.from);
    d.mesh.visibility = 1;
    d.mesh.isVisible = true;
    d.t = CONFIG.effects.discLife;
  }

  private spawnSpark(pos: Vector3, colorHex: string): void {
    const s = this.sparks.find((x) => x.t <= 0) ?? this.sparks[0];
    s.mesh.position.copyFrom(pos);
    s.mesh.material = this.mats.getEmissive(colorHex);
    s.mesh.scaling.setAll(0.4);
    s.mesh.isVisible = true;
    s.t = 0.18;
  }
}
