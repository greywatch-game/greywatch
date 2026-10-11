/**
 * CombatSystem.ts — Hitscan for EVERYONE (player and bots share fire()): the
 * SIMULATION of a round, and nothing a GPU is needed for.
 * Owns: `fire`, the fall-off, the head zone, the cone (`jitterDirection`), the
 * wall query that caps a shot, and the three events a round raises —
 * `onNearMiss`, `onRound` (the picture's) and `onShotPath` (the glass's).
 * Invariants: fire() takes the shooter's target list — friendly fire is
 * excluded by the caller's list construction, never by a team check inside.
 * The wall query is `RayWorld.castRound` — the solid world minus what a round
 * passes through, which today is fence rails and intact glass — and it caps the
 * shot; a target sphere farther than the first opaque hit does not count (a bot
 * embedded in a prop is unshootable — movement bugs become combat bugs). It was
 * `scene.pickWithRay` until `ENGINE_UPGRADE.md` wall 2, and the only thing that
 * changed about the shot is what answers it.
 * Damage is `damage` at close range falling to `opts.damageFar` past
 * `opts.falloffFar`, resolved against the distance the impact point already
 * cost — range is a slope now, and `range` is only where the ray stops.
 * The HEAD ZONE belongs to whoever passes `opts.headMult` > 1, which today is
 * the player and only the player: bots aim at `eyePos`, so a head sphere their
 * rounds could find would make every accurate bot shot a headshot. Below 1 the
 * sphere is never tested, so the bot path pays nothing for it. It is an
 * upgrade to a body hit that already landed, never a separate candidate — the
 * body sphere encloses it and it could not win a nearest-hit search.
 * Never: import `@babylonjs/core` or `math/babylon.ts`, hold a mesh, or draw.
 * Its vectors are `src/math`'s and what it is handed is `Vector3Like`, read
 * through the fields (`BABYLON_EXIT.md` X2.2).
 *
 * THE PICTURE IS `CombatFx`'s, AND THIS FILE RAISES IT RATHER THAN DRAWING IT.
 * Until X2.2 C2 the tracer, spark, disc and mark pools lived here and the
 * authority built all four under a NullEngine to draw nothing. Now each
 * resolved round raises `onRound` once — where the tracer used to be spawned,
 * so it is still ahead of `onShotPath` and a break's own effects still fall
 * behind the round that caused them — and `Game` wires it to
 * `CombatFx.drawRound`. On the authority nothing is wired, and the default is a
 * no-op. `RayHit.surface` chooses the impact's kind, which the event carries;
 * "hard" is what everything but the floor answers, exactly as
 * `metadata.surface` was absent on everything but the terrain collider's
 * clone.
 */
import { CONFIG } from "../config";
import { Vector3, type Vector3Like, type Vector3Ref } from "../math";
import { newRayHit, type RayHull, type RayWorld } from "../world/RayWorld";
import type { Rand } from "./RoundRandom";

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
 *
 * `crush` is the one member no ROUND ever carries — nothing here delivers it,
 * because it is a hull's tracks rather than anything that was fired. It is in
 * this vocabulary anyway for the two readers that already key off it and would
 * otherwise each need a term of their own: `Vehicle.takeDamage`, where it falls
 * to `resist.bullet` and is a dead branch by construction (a tank is never in
 * the list a tank's tracks are swept against — `hullRules.crushSweep`), and
 * `RagdollSystem.applyImpulse`, whose test is "not a bullet" and which
 * therefore THROWS a crushed body clear of the hull without being taught what
 * one is.
 *
 * `fire` is a molotov's burn, a few points at a time while somebody stands in
 * it (`GrenadeSystem`'s fire pool). It is the second member that DROPS a body
 * rather than throwing it, so `RagdollSystem`'s test names both — a man who
 * burns to death folds where he stood; nothing went off to lift him. No hull
 * ever takes one: the burn skips `armoured` targets outright.
 */
export type DamageKind = "bullet" | "blast" | "shell" | "crush" | "fire";

/**
 * Anything a hitscan shot can damage.
 *
 * **Its vectors are either library's** (`BABYLON_EXIT.md` X2.2): `center` and
 * `eyePos` are `Vector3Ref` — read through their fields, and written through
 * `set`/`copyFromFloats` by the one thing that moves them from outside,
 * `src/sim/LagComp.ts`'s rewind — so nothing that reaches a target through
 * this interface may hand either to a Babylon method, which would read `_x`
 * off one of ours and write NaN. The types refuse it.
 */
export interface Hittable {
  center: Vector3Ref;
  hitRadius: number;
  /**
   * This target is a HULL, and so is answered by its collider box rather than
   * by `center`/`hitRadius`.
   *
   * `Combatant.armoured`, restated on the interface that resolves a shot for
   * the reason `eyePos` is: every list `fire` is given is built out of
   * `Combatant`s, and this is the one property of a target that changes what
   * SHAPE the round is tested against. See `fire`.
   */
  readonly armoured?: boolean;
  /**
   * This target is a `Bot`, and nothing else may declare it — `isBotVictim`
   * in `killRules.ts` narrows on it to the class.
   *
   * A flag rather than an `instanceof` for `armoured`'s reason one level
   * down: the one reader is `settleKill`, which both simulations reach, and
   * an `instanceof` is a VALUE import of `Bot` — which pulled the whole
   * soldier rig and the scene behind it into a module that only books a kill
   * (`BABYLON_EXIT.md` X2.2). Absent on everything that is not one.
   */
  readonly isBot?: true;
  /**
   * The eye, which is also the head — `CONFIG.combat.headRadius` about this
   * point is the head zone. It lives here rather than only on `Combatant`
   * because the head test is part of resolving a shot, and everything that
   * reaches this interface already had one: `Player` and `Bot` both declare
   * it, and every list `fire` is given is built out of `Combatant`s.
   */
  eyePos: Vector3Ref;
  invulnerable?: boolean;
  /**
   * `from` is where the shot started, for whoever wants to face the shooter;
   * `kind` is what delivered it, for whoever answers differently to each. A
   * target that ignores either may simply not declare it — a method with fewer
   * parameters satisfies this one.
   *
   * **A PROPERTY, not a method signature, and that is the point**: a method's
   * parameters are checked bivariantly, so an implementer declaring `from` as
   * Babylon's `Vector3` — and calling `copyFrom(from)` on it — would compile
   * against `Vector3Like` and write NaN the day a caller hands it one of ours.
   * As a property `strictFunctionTypes` refuses that implementer; take the
   * coordinates with `copyFromFloats(from.x, from.y, from.z)`.
   */
  takeDamage: (amount: number, from?: Vector3Like, kind?: DamageKind) => boolean;
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
   * A fresh `src/math` `Vector3` per shot — as `dir` is — so a reader still on
   * Babylon's math copies it through `toBabylon` rather than handing it to a
   * Babylon method. That is affordable for the reason the plain
   * `forward` getter on `CameraSystem` is: this is per EVENT and not per frame,
   * and the alternative — scratch handed out of a method whose result a caller
   * naturally keeps — is the bug that reads as correct. `fire` already computes
   * this point to place the tracer's far end (`onRound`'s `to`), so nothing
   * extra is measured for it; what needed it was a round that does something
   * AT the impact rather than only to whatever it stopped on, which today is
   * the tank's shell.
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
  /**
   * The hull this round is LEAVING, taken out of its own wall query.
   *
   * **A vehicle's guns are drawn on the vehicle, so a muzzle is regularly
   * inside the box the hull is answered by** — and `boxCast` hands a ray that
   * started inside a box the FAR face, so the round stopped on the thing that
   * fired it. Measured on Sarab before this field existed: the gun truck's
   * station is 2.26 above the tracks and 0.79 behind the hull's centre, inside
   * a 5.4 x 2.5 x 2.5 collider, so a round laid dead ahead died 2.03 m out and
   * one laid astern 0.33 m out, while the same gun trained abeam worked
   * perfectly — the muzzle swings to 1.46 in x, which is outside the box's
   * 1.25. The tank escapes it by geometry rather than by rule: its cupola gun
   * is 3.39 up against a 2.9 m box and its barrel reaches past the hull at
   * every bearing.
   *
   * **It is stated on the GUN and not at the trigger** for `shellShotFor`'s
   * reason — there are two triggers in two processes — and it is the reason
   * a third gun bolted to a hull cannot reintroduce this: the options object
   * belongs to the hull, so it carries the hull.
   *
   * Absent on every shooter that is not a vehicle, and absent costs nothing:
   * the skip is an identity compare inside a loop the cast already runs.
   */
  fromHull?: RayHull;
}

/**
 * What a round stopped on, and the only thing that decides how the impact
 * looks and sounds.
 *
 * "hard" is the DEFAULT rather than a value anything writes: `MapBuilder`
 * marks only the terrain floor's collider clone (`surface: "ground"`), and
 * every box `collider()` makes leaves the field absent. Adding "wood" or
 * "metal" is one member here, one row in `CombatFx`'s `IMPACTS`, one arm in
 * `Sfx.impact` and a `surface` argument on `collider()` — no signature
 * between here and the world layer moves.
 */
export type ImpactKind = "flesh" | "ground" | "hard" | "glass";

/** Where a near-missing round came closest, handed to `onNearMiss`. */
const NEAR_POINT = new Vector3();
/** The target's centre less the origin, for the near-miss point. */
const SCRATCH = new Vector3();

/**
 * Hitscan shooting. Every combatant is hitscan — the player and both bot
 * teams alike — so there is no projectile pool to thrash in a 16-bot
 * firefight, and the picture of each round is `CombatFx`'s.
 */
export class CombatSystem {
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
   * handler, copy it if you mean to keep it. Both are `Vector3Like`, so a
   * handler still on Babylon's math reads the fields or copies through
   * `toBabylon`.
   */
  onNearMiss: (near: Hittable, from: Vector3Like, at: Vector3Like) => void =
    () => {};

  /**
   * Wired by Game: the picture of ONE resolved round — `CombatFx.drawRound`.
   *
   * `muzzle` is where the streak is flown from (the caller's), `to` where the
   * round stopped (the shot's `hitPoint`), `kind` the impact it owes on
   * arrival or null if it stopped on nothing, `normal` the face's outward
   * normal or null where there is none (a body, or nothing), and `mark`
   * whether what it stopped on is the STATIC world and may keep a decal — a
   * hull is "hard" like any box and is the one solid thing that drives away.
   * Every vector is read-only and valid for the call only: `normal` is the
   * wall query's scratch.
   *
   * Raised once per round, after the damage and BEFORE `onShotPath`, which is
   * the order the tracer used to be spawned in. A no-op on the authority,
   * which draws nothing — and nothing here waits on it: the damage is already
   * dealt, and the impact's arrival clock is the view's.
   */
  onRound: (
    muzzle: Vector3Like,
    to: Vector3Like,
    kind: ImpactKind | null,
    normal: Vector3Like | null,
    mark: boolean,
  ) => void = () => {};

  /**
   * Wired by Game: the segment a round actually flew, from the shooter's origin
   * along `dir` for `dist` — where `dist` is where it STOPPED, not its range.
   *
   * This exists for glass and only for glass, and it is a hook rather than a
   * second pick because a pane is the one thing in the world a round goes
   * through: it cannot stop a `castRound` without stopping the round, so the
   * wall pick above can never report one however the pane is declared. See
   * `GlassSystem`, which answers this analytically and puts nothing on the
   * per-frame ray budget.
   *
   * Raised for every round from every shooter, the bots' included, and AFTER
   * the wall pick has bounded the segment — so a window behind the wall a round
   * stopped on is not broken by it. `dir` is the shot's own (`ShotResult.dir`):
   * read it, do not keep it.
   */
  onShotPath: (origin: Vector3Like, dir: Vector3Like, dist: number) => void =
    () => {};

  /**
   * The solid world as a segment query. Null until a map is installed, and a
   * round fired before one stops on nothing — which is the same thing an empty
   * scene used to answer.
   */
  private rays: RayWorld | null = null;

  /** The wall query's result. Scratch: read inside `fire`, never held. */
  private readonly wall = newRayHit();

  /**
   * The world every round is capped against. Wired from `installMap` on the
   * client and from `startRound` on the authority, so both resolve a shot
   * against the same boxes — which is the whole of why the rewind can work.
   */
  setWorld(rays: RayWorld | null): void {
    this.rays = rays;
  }

  /**
   * A hitscan shot. Used by the player and by every bot — same ray, same
   * spread model, same `onRound`; only the target list and the origin differ.
   *
   * Every vector it is handed is read through its FIELDS — the camera's and
   * the viewmodel's muzzle are still Babylon's — and every vector it makes
   * is `src/math`'s.
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
   *
   * `rand` is the SHOOTER's stream (`RoundRandom`), and the cone is the one
   * thing here that draws from it — two draws a round, none at a spread of
   * zero. Never `Math.random`: where a round goes is an outcome, and an
   * outcome drawn from a shared unseeded source is a round nobody can play
   * twice. A caller with no spread passes `UNDRAWN`.
   */
  fire(
    origin: Vector3Like,
    aimDir: Vector3Like,
    spread: number,
    rand: Rand,
    damage: number,
    muzzle: Vector3Like,
    targets: Hittable[],
    range: number,
    opts: ShotOptions,
  ): ShotResult {
    const dir = jitterDirection(aimDir, spread, rand);

    // Wall/prop/floor hit distance caps the shot. `range` is the whole reach of
    // the round, so it bounds this as well as the near-miss sweep below.
    const hitWall =
      this.rays !== null &&
      this.rays.castRound(origin, dir, range, this.wall, opts.fromHull ?? null);
    let hitDist = hitWall ? this.wall.distance : range;

    // **A HULL is answered by the box the wall query already found it with**,
    // and is taken out of the sphere sweep below entirely.
    //
    // The two shapes disagree, and a sphere that disagrees with a collider in
    // front of it always loses: `hitRadius` is 3.2 about the hull's centre and
    // the collider reaches 3.6 to the nose, so a round arriving within ~32 deg
    // of either end met the box FIRST and the sphere behind it was rejected by
    // the `d < hitDist` test as a target standing behind a wall. A tank shell
    // laid dead on another tank's front plate sparked and did nothing, and so
    // did every rifle round `resist.bullet` is written for. Widening the
    // sphere to swallow the box would put three and a half metres of live air
    // off each end, which is where the infantry beside the tank are standing —
    // so the answer is the box, which is the shape that is drawn.
    //
    // It costs nothing: `castRound` walks the hulls before anything else on
    // every shot already, and now says which one it stopped on.
    let hitTarget: Hittable | null = null;
    if (hitWall && this.wall.hull !== null) {
      const hull = this.wall.hull as unknown as Hittable;
      // Membership, not a team check — the caller's list is where friendly
      // fire is excluded, exactly as it is for every body below.
      if (targets.includes(hull) && !hull.invulnerable) hitTarget = hull;
    }

    // Nearest target sphere along the ray, if closer than the wall. The same
    // pass also notes anyone the round merely went *past*: the sphere test is
    // already being paid for, so widening it by `suppressRadius` costs one
    // extra compare per target and gives the AI a suppression signal that would
    // otherwise need a system of its own.
    const graze = CONFIG.bots.perception.suppressRadius;
    for (const target of targets) {
      if (target.invulnerable || target.armoured) continue;
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
          // On the centre's FIELDS, because a target's centre may be either
          // library's vector — Babylon's `subtractToRef` reads `_x` off it.
          SCRATCH.copyFromFloats(
            target.center.x - origin.x,
            target.center.y - origin.y,
            target.center.z - origin.z,
          );
          dir.scaleToRef(Vector3.Dot(SCRATCH, dir), NEAR_POINT);
          NEAR_POINT.addInPlace(origin);
          this.onNearMiss(target, origin, NEAR_POINT);
        }
      }
    }

    // Babylon's `origin.add(dir.scale(hitDist))`, on the origin's fields —
    // the same two operations in the same order.
    const step = dir.scale(hitDist);
    const hitPoint = new Vector3(
      origin.x + step.x,
      origin.y + step.y,
      origin.z + step.z,
    );
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
      // Never on ARMOUR: the zone is a body's head, and a hull's `eyePos` is
      // its cupola — a sphere there would turn a lucky rifle round into a
      // multiplied one against the one target in the game whose whole point is
      // that small arms do not matter to it.
      const headMult = hitTarget.armoured ? 1 : (opts.headMult ?? 1);
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
    // it. The IMPACT is not: it is handed to the tracer (`onRound`, drawn by
    // `CombatFx`) and spawned when the streak's head arrives, so nothing is
    // seen or heard before the round that caused it gets there. At
    // `tracerSpeed` that is up to ~0.4 s at the range cap, which is exactly
    // how long the tell was. The sound rides the same clock as the visual for
    // the same reason.
    //
    // The surface comes off the query this method already paid for. `hard` is
    // what everything but the floor answers, exactly as only the terrain
    // collider's clone ever carried `metadata.surface`. A flesh hit has no
    // normal, and neither does a round that stopped on nothing.
    let kind: ImpactKind | null = null;
    let normal: Vector3 | null = null;
    // The STATIC world is what a mark may be stood on, and `hull` is the whole
    // of the test — see `onRound`. It is read here beside the surface rather
    // than at the impact, because by then the query has been paid for again by
    // somebody else's round.
    let mark = false;
    if (hitTarget && !hitTarget.armoured) {
      kind = "flesh";
    } else if (hitWall) {
      kind = this.wall.surface;
      // Scratch, and handed straight to `onRound`, whose handler copies it.
      // Nothing in flight holds a query result.
      normal = this.wall.normal;
      mark = this.wall.hull === null;
    }
    // The picture, raised where the tracer used to be spawned — `CombatFx`
    // flies the streak and spawns the impact, and its sound, on arrival.
    this.onRound(muzzle, hitPoint, kind, normal, mark);
    // Glass last, and bounded by `hitDist` rather than by `range`: the segment
    // the round actually flew is the one that crosses windows, so a wall — or a
    // body — between the shooter and a pane protects it, exactly as it protects
    // whatever is behind it. Raised after `onRound` so a break's own effects
    // are ordered behind the round that caused them.
    this.onShotPath(origin, dir, hitDist);
    return { target: hitTarget, killed, hitWall, headshot, dir, hitPoint };
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
  origin: Vector3Like,
  dir: Vector3Like,
  center: Vector3Like,
  radius: number,
): number | null {
  // Babylon's `center.subtract(origin)`, `Dot` and `lengthSquared`, written
  // out on the fields in their own order — a target's centre may be either
  // library's vector, and this way neither is handed to the other's methods.
  const ocx = center.x - origin.x;
  const ocy = center.y - origin.y;
  const ocz = center.z - origin.z;
  const t = ocx * dir.x + ocy * dir.y + ocz * dir.z;
  if (t < 0) return null;
  const d2 = ocx * ocx + ocy * ocy + ocz * ocz - t * t;
  if (d2 > radius * radius) return null;
  return t - Math.sqrt(Math.max(radius * radius - d2, 0));
}

/**
 * Perturbs an aim direction inside a cone (uniform over the disc), drawing
 * from the shooter's own stream — and drawing NOTHING at a zero half-angle,
 * which is what `UNDRAWN` relies on.
 */
function jitterDirection(aim: Vector3Like, halfAngle: number, rand: Rand): Vector3 {
  // Babylon's arithmetic on `src/math`'s vectors, which reproduce it bit for
  // bit (`scripts/math-check.mjs`): the aim is copied off its FIELDS first,
  // because the camera's forward is still Babylon's.
  const dir = new Vector3(aim.x, aim.y, aim.z);
  if (halfAngle <= 0) return dir.normalizeToNew();
  let u = Vector3.Cross(dir, Vector3.Up());
  if (u.lengthSquared() < 0.001) u = Vector3.Cross(dir, Vector3.Right());
  u.normalize();
  const v = Vector3.Cross(dir, u).normalize();
  const angle = rand() * Math.PI * 2;
  const r = Math.tan(halfAngle) * Math.sqrt(rand());
  return dir
    .add(u.scale(Math.cos(angle) * r))
    .add(v.scale(Math.sin(angle) * r))
    .normalize();
}
