/**
 * CombatSystem.ts — Hitscan for EVERYONE (player and bots share fire()), plus
 * pooled tracer/spark effects.
 * Invariants: fire() takes the shooter's target list — friendly fire is
 * excluded by the caller's list construction, never by a team check inside.
 * Wall ray filters OPAQUE_ONLY — the solid world minus what a round passes
 * through, which today is fence rails — and caps the shot; a target sphere
 * farther than the first opaque hit does not count (a bot embedded in a prop is
 * unshootable — movement bugs become combat bugs).
 * Damage is `damage` at close range falling to `opts.damageFar` past
 * `opts.falloffFar`, resolved against the distance the impact point already
 * cost — range is a slope now, and `range` is only where the ray stops.
 * The HEAD ZONE belongs to whoever passes `opts.headMult` > 1, which today is
 * the player and only the player: bots aim at `eyePos`, so a head sphere their
 * rounds could find would make every accurate bot shot a headshot. Below 1 the
 * sphere is never tested, so the bot path pays nothing for it. It is an
 * upgrade to a body hit that already landed, never a separate candidate — the
 * body sphere encloses it and it could not win a nearest-hit search.
 * Tracers/sparks/impact discs are
 * fixed-size pools: add new effects to a pool, NEVER allocate per shot.
 * The disc pool is `noGlow`, and that flag only works because `Game` builds
 * this system BEFORE its construction-time GlowLayer scan. Move the
 * construction later and every dust disc blooms like a lamp.
 * `metadata.surface` on the picked mesh chooses the impact; absent means
 * "hard", which is what every collider but the terrain floor's clone leaves.
 * A tracer is a short streak flown from muzzle to impact over several frames,
 * NOT a muzzle-to-impact beam — the hit is resolved instantly regardless, so
 * the flight is presentation only and must never gate damage. The impact spark
 * rides the streak and spawns on arrival: it is the one thing here that waits,
 * because an impact seen before its round lands is what makes a slowed tracer
 * read as fake.
 */
import {
  Mesh,
  MeshBuilder,
  Quaternion,
  Ray,
  Scene,
  Vector3,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import type { CelMaterialFactory } from "../shaders/CelShader";
import { OPAQUE_ONLY } from "../world/solid";

/**
 * What DELIVERED a hit, for the one kind of target that answers differently
 * depending on the answer.
 *
 * A body does not care: 30 damage is 30 damage however it arrived, which is why
 * this is the last parameter and an optional one, and why `Player`, `Bot` and
 * `NetSoldier` all still implement `takeDamage` without mentioning it. A HULL
 * cares about nothing else — see `CONFIG.vehicles.tank.resist` — and the
 * alternative to naming the kind here was giving a tank an armour figure large
 * enough to shrug off a rifle and then inflating every anti-tank number in the
 * game to get back through it.
 *
 * `bullet` is the default rather than a value anything writes: `fire` says it
 * for every round in the game unless the shooter's `ShotOptions` say otherwise,
 * so the sixteen shooters with nothing to declare declare nothing.
 */
export type DamageKind = "bullet" | "blast" | "shell";

/** Anything a hitscan shot can damage. */
export interface Hittable {
  center: Vector3;
  hitRadius: number;
  /**
   * The eye, which is also the head — `CONFIG.combat.headRadius` about this
   * point is the head zone. It lives here rather than only on `Combatant`
   * because the head test is part of resolving a shot, and everything that
   * reaches this interface already had one: `Player` and `Bot` both declare
   * it, and every list `fire` is given is built out of `Combatant`s.
   */
  eyePos: Vector3;
  invulnerable?: boolean;
  /**
   * `from` is where the shot started, for whoever wants to face the shooter;
   * `kind` is what delivered it, for whoever answers differently to each. A
   * target that ignores either may simply not declare it — a method with fewer
   * parameters satisfies this one.
   */
  takeDamage(amount: number, from?: Vector3, kind?: DamageKind): boolean;
}

/** Outcome of one shot: who it hit, whether that killed them, and if it stopped on geometry. */
export interface ShotResult {
  target: Hittable | null;
  killed: boolean;
  hitWall: boolean;
  /** The round landed in the head zone. Always false unless `headMult` > 1. */
  headshot: boolean;
  /**
   * The direction the round ACTUALLY flew — the aim with this shot's own
   * spread already rolled into it.
   *
   * Part of the outcome rather than of the request, because the roll happens
   * in here: `fire` jitters the aim it is given, so the caller cannot know
   * which bullet it fired until it is told. Multiplayer is what needs it — the
   * authority has to re-resolve THIS round rather than a differently-jittered
   * one — but it is a fact about the shot either way.
   */
  dir: Vector3;
  /**
   * Where the round stopped — a body, a wall, or the end of its own range.
   *
   * A fresh `Vector3` per shot, and that is affordable for the reason the plain
   * `forward` getter on `CameraSystem` is: this is per EVENT and not per frame,
   * and the alternative — scratch handed out of a method whose result a caller
   * naturally keeps — is the bug that reads as correct. `fire` already computes
   * this point to place the tracer's far end, so nothing extra is measured for
   * it; what needed it was a round that does something AT the impact rather
   * than only to whatever it stopped on, which today is the tank's shell.
   */
  hitPoint: Vector3;
}

/**
 * What a shooter's round does that is not the ray — everything a weapon
 * decides after the geometry has been resolved.
 *
 * An options object rather than four more positional parameters: `fire` was
 * already at seven, and the two call sites pass a STABLE object each (see
 * `Player.shotOptions`), so this costs no allocation per shot either.
 */
export interface ShotOptions {
  /** Damage at or beyond `falloffFar`; `damage` applies at or inside `falloffNear`. */
  damageFar: number;
  falloffNear: number;
  falloffFar: number;
  /**
   * What a hit in the head zone is worth. **Omitted or 1 skips the head test
   * outright**, and that is the whole of how the zone stays the player's:
   * bots aim at `eyePos`, so a head sphere they could find would turn every
   * accurate bot round into a headshot. It also means the sixteen shooters
   * that do not have the feature never pay a sphere test for it.
   */
  headMult?: number;
  /**
   * What this shooter's round counts AS when it lands on something that cares.
   * Absent means `bullet`, which is every weapon in `CONFIG.weapons` and every
   * bot; a tank's main gun is the one shooter that says `shell`. See
   * `DamageKind`.
   */
  damageKind?: DamageKind;
}

/**
 * What a round stopped on, and the only thing that decides how the impact
 * looks and sounds.
 *
 * "hard" is the DEFAULT rather than a value anything writes: `MapBuilder`
 * marks only the terrain floor's collider clone (`surface: "ground"`), and
 * every box `collider()` makes leaves the field absent. Adding "wood" or
 * "metal" is one member here, one row in `IMPACTS`, one arm in `Sfx.impact`
 * and a `surface` argument on `collider()` — no signature between here and
 * the world layer moves.
 */
export type ImpactKind = "flesh" | "ground" | "hard" | "glass";

/** How each kind looks: the hot core, the dust disc, and how big it opens. */
const IMPACTS: Record<
  ImpactKind,
  { spark: string | null; disc: string | null; from: number; to: number }
> = {
  // A hit on a body gets the spark and NO disc. Flesh does not throw dust on
  // the world, and the hitmarker plus `Sfx.hit` is where that confirmation
  // actually lands. There is no blood anywhere in this game and this is not
  // the pass that introduces it.
  flesh: { spark: "#ffe680", disc: null, from: 0, to: 0 },
  // Stone and timber: the original grey spark, plus a small pale bloom of
  // dust off the face.
  hard: { spark: "#c8c8c8", disc: "#b9b4ab", from: 0.15, to: 0.5 },
  // Earth does not spark. It throws more and glows less, so the disc alone,
  // bigger and duller.
  ground: { spark: null, disc: "#6b5a44", from: 0.2, to: 0.75 },
  // Glass is the odd one, and it is the ONLY kind not chosen by
  // `metadata.surface`: a round passes through a pane rather than stopping on
  // it, so there is no pick to read a surface off. `GlassSystem` names this
  // one directly at the crossing point. A bright cold spark and no disc —
  // glass throws shards, which `DebrisSystem` draws, not dust.
  glass: { spark: "#cfeaf2", disc: null, from: 0, to: 0 },
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
/** Where a near-missing round came closest, handed to `onNearMiss`. */
const NEAR_POINT = new Vector3();

/**
 * Hitscan shooting and the transient effects it throws off. Tracers and
 * sparks are object-pooled.
 *
 * Every combatant is hitscan — the player and both bot teams alike — so there
 * is no projectile pool to thrash in a 16-bot firefight.
 */
export class CombatSystem {
  private tracers: Tracer[] = [];
  private sparks: Spark[] = [];
  private discs: Disc[] = [];

  /**
   * Wired by Game: a round passed within `suppressRadius` of `near` without
   * hitting it. `from` is the shooter's origin.
   *
   * A callback rather than a direct call because this system must not know
   * about bots — it fires the player's rounds too, and the player is a
   * perfectly good thing to suppress later.
   *
   * `at` is the round's point of CLOSEST APPROACH, which is what a crack past
   * your ear actually is — not the shooter, and not wherever the round
   * eventually stopped. It is a shared scratch vector: read it in the
   * handler, copy it if you mean to keep it.
   */
  onNearMiss: (near: Hittable, from: Vector3, at: Vector3) => void = () => {};

  /**
   * Wired by Game: a round ARRIVED somewhere, at the moment its streak got
   * there rather than the moment the damage resolved.
   *
   * A callback for exactly the reason `onNearMiss` is one — this system fires
   * the player's rounds and all sixteen bots' and must not know what `Sfx`
   * is. `at` is the tracer's own scratch vector: read it, do not keep it.
   */
  onImpact: (at: Vector3, kind: ImpactKind) => void = () => {};

  /**
   * Wired by Game: the segment a round actually flew, from the shooter's origin
   * along `dir` for `dist` — where `dist` is where it STOPPED, not its range.
   *
   * This exists for glass and only for glass, and it is a hook rather than a
   * second pick because a pane is the one thing in the world a round goes
   * through: it cannot be in `OPAQUE_ONLY` without stopping the round, so the
   * wall pick above can never report one however the pane is declared. See
   * `GlassSystem`, which answers this analytically and puts nothing on the
   * per-frame ray budget.
   *
   * Raised for every round from every shooter, the bots' included, and AFTER
   * the wall pick has bounded the segment — so a window behind the wall a round
   * stopped on is not broken by it. `dir` is this method's own scratch: read
   * it, do not keep it.
   */
  onShotPath: (origin: Vector3, dir: Vector3, dist: number) => void = () => {};

  constructor(
    private scene: Scene,
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
      // The GlowLayer scan is construction-time and runs in `Game`'s
      // constructor AFTER this system is built, so this flag is honoured —
      // see the header. Without it a brown dust disc blooms like a lamp.
      mesh.metadata = { noGlow: true };
      this.discs.push({ mesh, t: 0, from: 0, to: 1 });
    }
  }

  /**
   * A hitscan shot. Used by the player and by every bot — same ray, same
   * spread model, same tracer; only the target list and the origin differ.
   *
   * `targets` is whatever the shooter is allowed to hit, so friendly fire is
   * excluded by construction rather than by a team check in here.
   *
   * `range` comes from the shooter rather than from CONFIG: the player's two
   * weapons carry different distances, and this used to read the one rifle's
   * out of the config directly. It bounds the wall pick behind `hitWall` and
   * the near-miss sweep as well as the damage, so it is the whole reach of
   * the round, not just where the tracer stops.
   *
   * `damage` is what the round does CLOSE. `opts` carries the fall-off, and
   * it is resolved against the distance this method already had to compute to
   * place the impact — so range costs the shot nothing extra to know about.
   * `range` is still the hard reach; the ramp lives inside it.
   */
  fire(
    origin: Vector3,
    aimDir: Vector3,
    spread: number,
    damage: number,
    muzzle: Vector3,
    targets: Hittable[],
    range: number,
    opts: ShotOptions,
  ): ShotResult {
    const dir = jitterDirection(aimDir, spread);

    // Wall/prop/floor hit distance caps the shot.
    const ray = new Ray(origin, dir, range);
    const wallPick = this.scene.pickWithRay(ray, OPAQUE_ONLY);
    let hitDist = wallPick && wallPick.hit ? wallPick.distance : range;
    const hitWall = !!(wallPick && wallPick.hit);

    // Nearest target sphere along the ray, if closer than the wall. The same
    // pass also notes anyone the round merely went *past*: the sphere test is
    // already being paid for, so widening it by `suppressRadius` costs one
    // extra compare per target and gives the AI a suppression signal that would
    // otherwise need a system of its own.
    let hitTarget: Hittable | null = null;
    const graze = CONFIG.bots.perception.suppressRadius;
    for (const target of targets) {
      if (target.invulnerable) continue;
      const d = raySphere(origin, dir, target.center, target.hitRadius);
      if (d !== null && d < hitDist) {
        hitDist = d;
        hitTarget = target;
      } else if (d === null) {
        const near = raySphere(origin, dir, target.center, target.hitRadius + graze);
        // Only counts in front of the shooter and short of whatever stopped the
        // round — a bullet that buried itself in a wall did not crack past
        // someone standing beyond it.
        if (near !== null && near < hitDist) {
          // Where the round came closest, which is where the crack is. Two
          // dot products on a branch that has already run a `raySphere`;
          // nothing on the common path pays for it. `NEAR_POINT` is module
          // scratch and is handed out rather than copied, so the handler must
          // read it now — which the one handler does.
          target.center.subtractToRef(origin, SCRATCH);
          dir.scaleToRef(Vector3.Dot(SCRATCH, dir), NEAR_POINT);
          NEAR_POINT.addInPlace(origin);
          this.onNearMiss(target, origin, NEAR_POINT);
        }
      }
    }

    const hitPoint = origin.add(dir.scale(hitDist));
    let killed = false;
    let headshot = false;
    if (hitTarget) {
      // `hitDist` is the target's own entry distance by this point, which is
      // the number the fall-off wants — the range the round actually flew,
      // not the range to whatever was behind it.
      let dealt = falloffDamage(damage, hitDist, opts);
      // The head zone is an UPGRADE to a body hit, never a candidate of its
      // own. The body sphere already encloses the head, so a head sphere
      // entered the nearest-hit search only to lose it — and testing it here
      // instead costs one sphere per round that LANDED rather than one per
      // target per shot. The gate is what keeps it off the bot path entirely.
      const headMult = opts.headMult ?? 1;
      if (headMult > 1) {
        const head = raySphere(
          origin,
          dir,
          hitTarget.eyePos,
          CONFIG.combat.headRadius,
        );
        if (head !== null) {
          headshot = true;
          dealt *= headMult;
        }
      }
      killed = hitTarget.takeDamage(dealt, origin, opts.damageKind ?? "bullet");
    }

    // The DAMAGE is instant — everyone is hitscan and nothing below may gate
    // it. The IMPACT is not: it is handed to the tracer and spawned when the
    // streak's head arrives, so nothing is seen or heard before the round that
    // caused it gets there. At `tracerSpeed` that is up to ~0.4 s at the range
    // cap, which is exactly how long the tell was. The sound rides the same
    // clock as the visual for the same reason.
    //
    // The surface comes off the pick this method already paid for. `hard` is
    // the default and nothing writes it: only the terrain floor's collider
    // clone says `surface`, so every wall, prop and roof in the village
    // answers by omission. The NORMAL is fetched only when there is a disc
    // that will use it — a flesh hit has none, and neither does a round that
    // stopped on nothing.
    let kind: ImpactKind | null = null;
    let normal: Vector3 | null = null;
    if (hitTarget) {
      kind = "flesh";
    } else if (hitWall) {
      kind =
        wallPick!.pickedMesh?.metadata?.surface === "ground" ? "ground" : "hard";
      normal = wallPick!.getNormal(true);
    }
    this.spawnTracer(muzzle, hitPoint, kind, normal);
    // Glass last, and bounded by `hitDist` rather than by `range`: the segment
    // the round actually flew is the one that crosses windows, so a wall — or a
    // body — between the shooter and a pane protects it, exactly as it protects
    // whatever is behind it. Raised after the tracer so a break's own effects
    // are ordered behind the round that caused them.
    this.onShotPath(origin, dir, hitDist);
    return { target: hitTarget, killed, hitWall, headshot, dir, hitPoint };
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
      if (tr.impactKind !== null && tr.head >= tr.dist) {
        this.spawnImpact(tr.impact, tr.impactNormal, tr.impactKind);
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
  }

  /**
   * `kind` is the impact this round owes on arrival, or null if it stopped on
   * nothing. A stolen slot (exhausted pool) drops its pending impact with the
   * streak it belonged to, which is right: an impact whose tracer was recycled
   * would pop with nothing visibly arriving — and would fire a sound with it.
   *
   * `normal` is the surface's, or null where there is no disc to orient (a
   * flesh hit, or a round that stopped on nothing). It is COPIED here rather
   * than held, so nothing in flight references a Babylon pick result.
   */
  private spawnTracer(
    from: Vector3,
    to: Vector3,
    kind: ImpactKind | null,
    normal: Vector3 | null,
  ): void {
    const tr = this.tracers.find((t) => !t.alive) ?? this.tracers[0];
    const delta = to.subtract(from);
    const dist = Math.max(delta.length(), 0.01);
    delta.scaleInPlace(1 / dist);
    tr.from.copyFrom(from);
    tr.dir.copyFrom(delta);
    tr.dist = dist;
    tr.head = 0;
    tr.alive = true;
    tr.impact.copyFrom(to);
    tr.impactKind = kind;
    // Up is the right guess where the pick could not supply one: the only
    // surface that answers "ground" is the valley floor.
    if (normal) tr.impactNormal.copyFrom(normal);
    else tr.impactNormal.set(0, 1, 0);
    // The direction is fixed for the whole flight, so this is set once here and
    // only `update` moves the streak along it.
    Quaternion.FromUnitVectorsToRef(
      Vector3.Up(),
      delta,
      tr.mesh.rotationQuaternion!,
    );
    tr.mesh.position.copyFrom(from);
    tr.mesh.scaling.set(1, 0.01, 1);
    tr.mesh.isVisible = true;
  }

  /**
   * A round arriving: the hot core, the dust it throws, and the noise of it.
   *
   * One entry point for all three so the surface is looked up once and the
   * sound cannot drift out of step with the picture — they are the same
   * event, and this is the moment the streak got there rather than the moment
   * the damage resolved. Whether the sound is actually played is `Sfx`'s
   * decision, not this system's: it owns the voice budget the sixteen bots
   * are competing for, and there is nothing useful this side of it could
   * decide about audibility.
   */
  private spawnImpact(pos: Vector3, normal: Vector3, kind: ImpactKind): void {
    const look = IMPACTS[kind];
    if (look.spark) this.spawnSpark(pos, look.spark);
    if (look.disc) this.spawnDisc(pos, normal, look);
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
    Quaternion.FromUnitVectorsToRef(
      Vector3.Forward(),
      normal,
      d.mesh.rotationQuaternion!,
    );
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

/**
 * What a round is still worth after flying `dist` metres.
 *
 * Flat inside `falloffNear`, flat again past `falloffFar`, linear between.
 * A weapon with `damageFar === damage` (the DMR) runs the same arithmetic and
 * lands on the same number at both ends, which is why the exemption needs no
 * branch here and no optional field in the table.
 */
function falloffDamage(damage: number, dist: number, o: ShotOptions): number {
  if (dist <= o.falloffNear) return damage;
  if (dist >= o.falloffFar) return o.damageFar;
  const t = (dist - o.falloffNear) / (o.falloffFar - o.falloffNear);
  return damage + (o.damageFar - damage) * t;
}

/** Ray vs sphere: returns entry distance along the ray, or null on miss. */
function raySphere(
  origin: Vector3,
  dir: Vector3,
  center: Vector3,
  radius: number,
): number | null {
  const oc = center.subtract(origin);
  const t = Vector3.Dot(oc, dir);
  if (t < 0) return null;
  const d2 = oc.lengthSquared() - t * t;
  if (d2 > radius * radius) return null;
  return t - Math.sqrt(Math.max(radius * radius - d2, 0));
}

/** Perturbs an aim direction inside a cone (uniform over the disc). */
function jitterDirection(dir: Vector3, halfAngle: number): Vector3 {
  if (halfAngle <= 0) return dir.normalizeToNew();
  let u = Vector3.Cross(dir, Vector3.Up());
  if (u.lengthSquared() < 0.001) u = Vector3.Cross(dir, Vector3.Right());
  u.normalize();
  const v = Vector3.Cross(dir, u).normalize();
  const angle = Math.random() * Math.PI * 2;
  const r = Math.tan(halfAngle) * Math.sqrt(Math.random());
  return dir
    .add(u.scale(Math.cos(angle) * r))
    .add(v.scale(Math.sin(angle) * r))
    .normalize();
}
