/**
 * GrenadeSystem.ts — Thrown grenades: the flight, the bounces, the fuse and the
 * blast, plus the fireball, embers and dust it throws off.
 * Owns: the grenade pool, the blast pool, the ember pool and `BlastDust`. All
 * four are FIXED SIZE and allocated once — this is the same rule CombatSystem's
 * tracers follow, and for the same reason: a firefight must not allocate.
 *
 * This is the one thing in the game that is not hitscan, and everything here is
 * shaped by that:
 * - A grenade is integrated per frame and collides with ONE ray per grenade per
 *   frame, filtered `OPAQUE_ONLY` — the same collider proxies bullets stop on
 *   and the same ones they pass through, never the visuals. There are at most a
 *   handful in the air, so that ray is affordable where a per-bullet one would
 *   not be. A grenade goes between a fence's rails because a body's width is
 *   not what is travelling.
 * - The blast resolves at detonation against the target list the THROWER is
 *   handed (`hittablesFor`), so friendly fire is excluded by construction, the
 *   same way `CombatSystem.fire` excludes it. Nothing in here knows what a team
 *   is beyond passing one back out.
 * - Damage needs line of sight from the blast centre: one ray per victim inside
 *   the radius, which is bounded by how few things are ever that close.
 *
 * Everything cross-system leaves through callbacks wired in `Game` —
 * `onExploded` for the light, the sound and the camera, `onBlastHit` for the
 * scoreboard. This system imports no other system.
 */
import {
  Color3,
  Color4,
  DynamicTexture,
  GPUParticleSystem,
  Mesh,
  MeshBuilder,
  Ray,
  Scene,
  Vector3,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import type { Combatant, Team } from "../entities/Combatant";
import { buildGrenade, pipLit } from "../entities/GrenadeModel";
import type { CelMaterialFactory } from "../shaders/CelShader";
import type { EnvironmentSpec } from "../world/environment";
import { TerrainField } from "../world/TerrainField";
import { OPAQUE_ONLY } from "../world/solid";
import type { Hittable } from "./CombatSystem";

/** One grenade in flight (or resting with its fuse running). */
interface Grenade {
  mesh: Mesh;
  /** The fuse tell — blinks faster as the fuse runs out. */
  pip: Mesh;
  /**
   * What this FLIGHT is called, for anything outside that has to follow one
   * grenade across frames — today the multiplayer server, which replicates the
   * live ones so every client can watch them arrive.
   *
   * Monotonic and never reused, which is the whole reason it is not simply the
   * pool index: a slot is claimed the instant the last grenade in it went off,
   * so a client keying on the index would take the new grenade's samples as a
   * continuation of the old one's and draw a streak from the detonation to
   * somebody's hand.
   */
  id: number;
  vel: Vector3;
  /** Seconds of fuse left; <= 0 while the slot is free. */
  fuse: number;
  live: boolean;
  team: Team;
  /**
   * Who threw it, for whoever has to be credited with what it does.
   *
   * A reference and not a team, because a scoreboard counts BODIES: the team
   * is already on the slot next door (it is what the target list is fetched
   * against) and the thrower's identity is the part that cannot be recovered
   * three seconds and two bounces later. It also replaces the `byPlayer` flag
   * this field grew out of — "was it the player" is a question only `Game` can
   * answer, and it answers it by comparing this against its own `Player`.
   *
   * Null is a grenade nobody owns, which nothing throws today; the field is
   * optional so that this system never has to invent a thrower to satisfy a
   * type. Its team is NEVER read here — see the note on `hittablesFor`.
   */
  by: Combatant | null;
  /** Set once it has settled, so a resting grenade stops paying for a ray. */
  resting: boolean;
}

/** One expanding fireball. */
interface Blast {
  mesh: Mesh;
  t: number;
}

/** One ember flung out of a blast. */
interface Ember {
  mesh: Mesh;
  vel: Vector3;
  t: number;
}

/** Scratch — the flight integrates every frame and must not allocate. */
const _step = new Vector3();
const _normal = new Vector3();
const _tangent = new Vector3();
const _launch = new Vector3();

/** Construction-time choices. Today: whether this instance can draw. */
export interface GrenadeOptions {
  /**
   * Build the blast dust. Default true; the multiplayer server passes false
   * because a NullEngine has neither a canvas nor WebGL2, and the dust needs
   * both. Nothing about where a grenade goes or what it hurts depends on it.
   */
  dust?: boolean;
}

export class GrenadeSystem {
  private grenades: Grenade[] = [];
  private blasts: Blast[] = [];
  private embers: Ember[] = [];
  /** The dust half of a blast — see `BlastDust`. */
  private dust: BlastDust | null;
  /** Reused by the flight and the line-of-sight tests alike. */
  private readonly ray = new Ray(new Vector3(), new Vector3(0, -1, 0), 1);
  /** Names the next flight. Never reset — see `Grenade.id`. */
  private nextId = 0;
  /** The map's floor, as a backstop under the collider proxies. */
  private terrain: TerrainField = new TerrainField();

  /**
   * Wired by Game: who this thrower is allowed to hurt. The same list
   * `CombatSystem.fire` is handed for a bullet, resolved at DETONATION rather
   * than at the throw — a grenade is in the air for seconds, and the roster it
   * goes off among is not the one it left the hand among.
   */
  hittablesFor: (team: Team) => Hittable[] = () => [];

  /**
   * Wired by Game: a grenade went off here. The light, the sound and the
   * camera's concussion all hang off this — none of them are this system's
   * business, and two of them are owned by systems it must not import.
   */
  onExploded: (at: Vector3) => void = () => {};

  /**
   * Wired by Game: the blast hurt someone. `killed` is whether it finished
   * them, `thrower` is the team to credit, and `by` is the combatant who threw
   * it — the one thing a kill needs that cannot be worked out at the far end.
   *
   * `by` is where the retired `byPlayer` flag went. The flag was this system
   * carrying an answer to a question about `Game`'s own `Player`, which it has
   * never had any way to ask; a consumer compares the thrower against whatever
   * it considers "us" and gets the same answer without this file knowing there
   * is such a thing as a player.
   */
  onBlastHit: (
    victim: Hittable,
    thrower: Team,
    by: Combatant | null,
    killed: boolean,
  ) => void = () => {};

  constructor(
    private scene: Scene,
    mats: CelMaterialFactory,
    opts?: GrenadeOptions,
  ) {
    const g = CONFIG.grenade;
    // The dust is the one part of this system that cannot exist without GL:
    // it builds a `DynamicTexture` (which needs a canvas) and a
    // `GPUParticleSystem` (which needs WebGL2), and under Babylon's NullEngine
    // the first of those throws `OffscreenCanvas is not defined` before the
    // constructor returns. The multiplayer server runs the BALLISTICS — where a
    // grenade lands and who it hurts is a rule, not a picture — so it asks for
    // the system without the dust. Everything else here is spheres and
    // materials, which are inert without a renderer and cost nothing to keep.
    this.dust = opts?.dust === false ? null : new BlastDust(scene);
    const fireMat = mats.getEmissive("#ffb45a");
    const emberMat = mats.getEmissive("#ffd07a");

    for (let i = 0; i < g.poolSize; i++) {
      const { mesh, pip } = buildGrenade(scene, mats, `grenade${i}`);
      this.grenades.push({
        mesh,
        pip,
        id: 0,
        vel: new Vector3(),
        fuse: 0,
        live: false,
        team: 0,
        by: null,
        resting: false,
      });
    }

    // One fireball per grenade would be a pool nobody can exhaust; a handful is
    // what "two blasts close together" actually needs.
    for (let i = 0; i < 6; i++) {
      const mesh = MeshBuilder.CreateSphere(
        `blast${i}`,
        { diameter: 2, segments: 8 },
        scene,
      );
      mesh.material = fireMat;
      mesh.metadata = { noOutline: true };
      mesh.isVisible = false;
      mesh.isPickable = false;
      this.blasts.push({ mesh, t: 0 });
    }

    for (let i = 0; i < g.emberCount * 3; i++) {
      const mesh = MeshBuilder.CreateBox(
        `ember${i}`,
        { width: 0.09, height: 0.09, depth: 0.22 },
        scene,
      );
      mesh.material = emberMat;
      mesh.metadata = { noOutline: true };
      mesh.isVisible = false;
      mesh.isPickable = false;
      this.embers.push({ mesh, vel: new Vector3(), t: 0 });
    }
  }

  /** Points the flight's floor backstop at the current map. */
  setTerrain(terrain: TerrainField): void {
    this.terrain = terrain;
  }

  /**
   * The only thing in here a map's look reaches: what colour the blast dust
   * is. Called from `installMap` with the environment the map was built
   * against.
   */
  setEnvironment(env: EnvironmentSpec): void {
    this.dust?.setEnvironment(env);
  }

  /**
   * Every grenade in the air right now, for whoever has to say where they are.
   *
   * The multiplayer server is the caller: a grenade is the one thing in this
   * game that takes seconds to arrive, so the authority replicates the live
   * ones in its snapshot and every client draws them arcing in rather than
   * being handed the explosion. `by` goes with the position because the
   * thrower is already watching their OWN copy of it fly — see
   * `net/NetGrenades`.
   *
   * A visitor rather than an array, so the hot path allocates nothing and
   * nobody outside can hold on to a pooled slot: `at` is the live mesh
   * position and is valid only for the length of the call.
   */
  forEachLive(
    fn: (id: number, at: Vector3, fuse: number, by: Combatant | null) => void,
  ): void {
    for (const n of this.grenades) {
      if (n.live) fn(n.id, n.mesh.position, n.fuse, n.by);
    }
  }

  /**
   * A throw along a look direction, tilted up by `throwLift`. The player's
   * path: you throw where you are looking, and aiming up throws further.
   *
   * Returns false when the pool is exhausted, and a caller that gets a false
   * must NOT spend a grenade on it — a count spent on something that never
   * arrives is the most confusing bug a player can be handed.
   */
  throwAlong(
    from: Vector3,
    dir: Vector3,
    team: Team,
    by: Combatant | null,
  ): boolean {
    // Tilting a unit direction up by an angle and renormalising: cheaper than
    // building a rotation, and the axis is always world up.
    _launch.copyFrom(dir).normalize();
    _launch.y += Math.tan(CONFIG.grenade.throwLift);
    _launch.normalize().scaleInPlace(CONFIG.grenade.throwSpeed);
    return this.throwFrom(from, _launch, team, by);
  }

  /**
   * A throw aimed to LAND at `to`. The bots' path, and the reason the
   * ballistics live in here rather than in whoever is throwing: an AI that
   * wants a grenade on a position should say so and be told whether the arm
   * can make it, not do trigonometry of its own.
   *
   * The low arc of the standard solve: with `d` the horizontal distance and
   * `h` the rise, the launch angle satisfies
   * `tan A = (v^2 - sqrt(v^4 - g(g d^2 + 2 h v^2))) / (g d)`. A negative
   * discriminant means the throw simply cannot be made at `throwSpeed`, which
   * is exactly what the caller needs to hear — the alternative is a bot lobbing
   * grenades that land at its own feet. Low rather than high on purpose: a lob
   * spends longer in the air, which is longer for the target to walk out of it,
   * and it is the one that catches the eaves on the way over.
   */
  throwAt(
    from: Vector3,
    to: Vector3,
    team: Team,
    by: Combatant | null,
  ): boolean {
    const cfg = CONFIG.grenade;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) return false;
    const h = to.y - from.y;
    const v2 = cfg.throwSpeed * cfg.throwSpeed;
    const g = cfg.gravity;
    const disc = v2 * v2 - g * (g * d * d + 2 * h * v2);
    if (disc < 0) return false;
    const angle = Math.atan2(v2 - Math.sqrt(disc), g * d);
    const horizontal = Math.cos(angle) * cfg.throwSpeed;
    _launch.set(
      (dx / d) * horizontal,
      Math.sin(angle) * cfg.throwSpeed,
      (dz / d) * horizontal,
    );
    return this.throwFrom(from, _launch, team, by);
  }

  /** Claims a pool slot and puts the grenade in the air. */
  private throwFrom(
    from: Vector3,
    velocity: Vector3,
    team: Team,
    by: Combatant | null,
  ): boolean {
    const slot = this.grenades.find((n) => !n.live);
    if (!slot) return false;
    slot.id = ++this.nextId;
    slot.mesh.position.copyFrom(from);
    slot.vel.copyFrom(velocity);
    slot.fuse = CONFIG.grenade.fuse;
    slot.live = true;
    slot.resting = false;
    slot.team = team;
    slot.by = by;
    slot.mesh.rotation.set(
      Math.random() * 3,
      Math.random() * 3,
      Math.random() * 3,
    );
    slot.mesh.isVisible = true;
    slot.pip.isVisible = true;
    return true;
  }

  update(dt: number): void {
    const g = CONFIG.grenade;
    for (const n of this.grenades) {
      if (!n.live) continue;
      n.fuse -= dt;
      if (n.fuse <= 0) {
        this.detonate(n);
        continue;
      }
      // The tell, from the model file so that a grenade drawn off the wire
      // blinks in step with this one — see `pipLit`.
      n.pip.isVisible = pipLit(n.fuse / g.fuse);
      if (n.resting) continue;

      n.vel.y -= g.gravity * dt;
      n.vel.scaleToRef(dt, _step);
      const travel = _step.length();
      if (travel > 1e-5) {
        // One ray per grenade per frame, along the step and a body's radius
        // past it, so a fast grenade cannot tunnel through a wall between two
        // frames. Same filter as every other ray that asks what is in the way.
        this.ray.origin.copyFrom(n.mesh.position);
        this.ray.direction.copyFrom(_step).scaleInPlace(1 / travel);
        this.ray.length = travel + g.radius;
        const hit = this.scene.pickWithRay(this.ray, OPAQUE_ONLY);
        const normal = hit?.hit && hit.pickedPoint ? hit.getNormal(true) : null;
        if (hit?.pickedPoint && normal) {
          _normal.copyFrom(normal);
          // The reported normal may point AWAY from the grenade — a collider's
          // back face, which is exactly what a grenade thrown at a wall from
          // inside a doorway finds. Bouncing off one of those drives it
          // straight through the wall it just hit.
          if (Vector3.Dot(_normal, this.ray.direction) > 0) {
            _normal.scaleInPlace(-1);
          }
          n.mesh.position
            .copyFrom(hit.pickedPoint)
            .addInPlace(_normal.scale(g.radius));
          this.bounce(n, _normal);
        } else {
          n.mesh.position.addInPlace(_step);
        }
      }

      // The floor as a backstop under the collider proxies. The terrain blocks
      // are `solid` and the ray above normally finds them, but a grenade that
      // slipped past one (a seam, a step taken from inside a face) has to end
      // up on the ground rather than falling out of the world with a live fuse.
      const floor = this.terrain.heightAt(n.mesh.position.x, n.mesh.position.z);
      if (n.mesh.position.y < floor + g.radius) {
        n.mesh.position.y = floor + g.radius;
        this.bounce(n, _normal.set(0, 1, 0));
      }

      // Tumble at a rate that reads off the speed, so a rolling grenade rolls
      // and a resting one is still.
      const speed = n.vel.length();
      if (!n.resting) {
        n.mesh.rotation.x += speed * dt * 2.4;
        n.mesh.rotation.z += speed * dt * 1.7;
      }
    }

    this.updateEffects(dt);
  }

  /**
   * Reflects a grenade off a surface. Restitution takes the normal component,
   * friction takes the tangential one, and a slow grenade sitting on something
   * flat is parked outright — a body that keeps micro-bouncing on a floor
   * never settles, and a grenade that never settles never stops paying for its
   * collision ray.
   */
  private bounce(n: Grenade, normal: Vector3): void {
    const g = CONFIG.grenade;
    const vn = Vector3.Dot(n.vel, normal);
    if (vn > 0) return; // already leaving the surface
    _tangent.copyFrom(n.vel).subtractInPlace(normal.scale(vn));
    n.vel
      .copyFrom(_tangent)
      .scaleInPlace(g.friction)
      .addInPlace(normal.scale(-vn * g.restitution));
    if (n.vel.length() < g.restSpeed && normal.y > 0.6) {
      n.vel.setAll(0);
      n.resting = true;
    }
  }

  /**
   * The blast: radial damage with a line-of-sight test, then the effects.
   *
   * Damage falls linearly from full inside `innerRadius` to nothing at
   * `blastRadius`, measured to the victim's CENTRE — the same point bullets are
   * tested against, so a crouched target is genuinely harder to catch with a
   * grenade in the same way it is harder to shoot.
   */
  private detonate(n: Grenade): void {
    const g = CONFIG.grenade;
    const at = n.mesh.position;
    n.live = false;
    n.mesh.isVisible = false;
    n.pip.isVisible = false;

    for (const target of this.hittablesFor(n.team)) {
      if (target.invulnerable) continue;
      const dist = Vector3.Distance(at, target.center);
      if (dist > g.blastRadius) continue;
      if (!this.visible(at, target.center)) continue;
      const falloff =
        dist <= g.innerRadius
          ? 1
          : 1 - (dist - g.innerRadius) / (g.blastRadius - g.innerRadius);
      const killed = target.takeDamage(g.damage * falloff, at);
      this.onBlastHit(target, n.team, n.by, killed);
    }

    this.spawnBlast(at);
    // The light, the sound and the camera's concussion belong to systems this
    // one may not import, so they leave as one event with a position on it.
    this.onExploded(at.clone());
  }

  /** Fragments stop in walls. One ray per victim already inside the radius. */
  private visible(from: Vector3, to: Vector3): boolean {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.01) return true;
    this.ray.origin.copyFrom(from);
    this.ray.direction.set(dx / len, dy / len, dz / len);
    this.ray.length = len;
    const hit = this.scene.pickWithRay(this.ray, OPAQUE_ONLY);
    return !hit?.hit;
  }

  private spawnBlast(at: Vector3): void {
    const g = CONFIG.grenade;
    const blast = this.blasts.find((b) => b.t <= 0) ?? this.blasts[0];
    blast.mesh.position.copyFrom(at);
    blast.mesh.scaling.setAll(0.4);
    blast.mesh.isVisible = true;
    blast.t = g.blastVisualTime;

    // The dust goes up with the flash and outlives it by a second — the
    // fireball is the event and the cloud is what the event left behind.
    this.dust?.burst(at);

    // Embers, thrown out of the blast on an even-ish spread rather than a
    // random one — a handful of random directions clumps, and a clump reads as
    // one lump of debris instead of as a burst.
    let spawned = 0;
    for (const e of this.embers) {
      if (spawned >= g.emberCount) break;
      if (e.t > 0) continue;
      const yaw = ((spawned + Math.random()) / g.emberCount) * Math.PI * 2;
      const lift = 0.25 + Math.random() * 0.9;
      const speed = g.emberSpeed * (0.5 + Math.random() * 0.7);
      e.vel
        .set(Math.sin(yaw), lift, Math.cos(yaw))
        .normalize()
        .scaleInPlace(speed);
      e.mesh.position.copyFrom(at);
      e.mesh.isVisible = true;
      e.t = g.emberLife * (0.6 + Math.random() * 0.6);
      spawned++;
    }
  }

  private updateEffects(dt: number): void {
    const g = CONFIG.grenade;
    this.dust?.update(dt);
    for (const b of this.blasts) {
      if (b.t <= 0) continue;
      b.t -= dt;
      if (b.t <= 0) {
        b.mesh.isVisible = false;
        continue;
      }
      // Expands fast and fades faster: the flash is the first two frames and
      // the rest is the ball of it going out.
      const age = 1 - b.t / g.blastVisualTime;
      b.mesh.scaling.setAll(0.4 + g.blastVisualRadius * Math.sqrt(age));
      b.mesh.visibility = Math.max(0, 1 - age * age);
    }
    for (const e of this.embers) {
      if (e.t <= 0) continue;
      e.t -= dt;
      if (e.t <= 0) {
        e.mesh.isVisible = false;
        continue;
      }
      e.vel.y -= g.emberGravity * dt;
      e.mesh.position.addInPlace(_step.copyFrom(e.vel).scaleInPlace(dt));
      e.mesh.rotation.x += dt * 9;
      e.mesh.visibility = Math.min(1, e.t / (g.emberLife * 0.4));
    }
  }

  /**
   * Drops everything in flight, and every cloud standing over it. Called
   * wherever the map under it is thrown away — a grenade whose fuse survives a
   * round change would go off in the next one, over terrain that no longer
   * exists, and a cloud left up would hang in the middle of an editor rebuild.
   */
  reset(): void {
    for (const n of this.grenades) {
      n.live = false;
      n.resting = false;
      n.mesh.isVisible = false;
      n.pip.isVisible = false;
      // Dropped rather than left to be overwritten by the next throw: a round
      // is over, and a pooled slot holding a reference to last round's thrower
      // is the one thing in here that would outlive it.
      n.by = null;
    }
    for (const b of this.blasts) {
      b.t = 0;
      b.mesh.isVisible = false;
    }
    for (const e of this.embers) {
      e.t = 0;
      e.mesh.isVisible = false;
    }
    this.dust?.reset();
  }
}

/** One blast's dust: the GPU system holding it, and when it goes quiet. */
interface DustCloud {
  system: GPUParticleSystem;
  /** Seconds until the last puff has faded; <= 0 while the slot is free. */
  t: number;
}

/**
 * The low cloud a blast lifts off the ground: `CONFIG.grenade.dust.puffs` soft
 * quads thrown out of a flat disc at the detonation, expanding, slowing and
 * fading over `life`. Not emissive and not the flame — `BLENDMODE_STANDARD`,
 * tinted from the map's own mist toward its key light, so it occludes what is
 * behind it rather than adding to it.
 *
 * Owned by `GrenadeSystem` and constructed by it. It is in this file rather
 * than in one of its own because it is the blast's own visuals, which is where
 * the rest of them already live; nothing in `Game` wires it, and it is not a
 * system in that sense.
 *
 * **It is a pool of GPU systems, not one system holding every cloud, and that
 * is Babylon's constraint rather than a preference.** In emit-rate-controlled
 * mode a `GPUParticleSystem` re-emits into a ring of
 * `max(emitRate * maxLifeTime, this frame's emission)` slots from a circular
 * write pointer. `emitRate` is zero here — that is what makes this a burst
 * rather than a field — so the ring is exactly one `manualEmitCount`, and a
 * second blast inside the first cloud's life would write over the first
 * cloud's slots and pop it off the screen mid-fade. One ring per cloud is what
 * keeps two blasts apart, for the same reason there are six fireball meshes
 * and not one. (`Atmosphere` documents the other side of the same invariant:
 * there the ring is sized so the pointer comes round exactly as the oldest
 * mote dies.)
 *
 * Two more things about that mode are load-bearing:
 *
 * - **A stopped system refuses manual emissions too.** The update shader gates
 *   its emit branch on `stopFactor != 0`, so `stop()` is not a way to hold a
 *   burst system idle between blasts. Every system here is started once at
 *   construction and left started; with `emitRate` at zero an idle one emits
 *   nothing, and `_render` returns before doing any work while its ring is
 *   still empty.
 * - **`updateSpeed` is `1/60` so the numbers mean what they say.** The GPU
 *   clock advances by `updateSpeed * scene.getAnimationRatio()` per frame, and
 *   that ratio is `dt * 60`, so at `1/60` a lifetime is seconds and an emit
 *   power is metres per second — the units the rest of `CONFIG.grenade` is
 *   written in. (`Atmosphere`'s 0.012 is deliberately not that: its mote lives
 *   are in its own clock.)
 */
class BlastDust {
  private clouds: DustCloud[] = [];
  private texture: DynamicTexture;

  constructor(scene: Scene) {
    const d = CONFIG.grenade.dust;
    this.texture = buildPuffTexture(scene);

    for (let i = 0; i < d.clouds; i++) {
      const system = new GPUParticleSystem(
        `blastDust${i}`,
        {
          capacity: d.puffs,
          emitRateControl: true,
          // The default is the engine's max texture size, which is 16k random
          // vec4s generated with `Math.random()` per system at construction —
          // ~131,000 calls and half a megabyte of VRAM each, to seed a few
          // dozen puffs, and paid once per cloud in the pool. This is variety
          // enough that no two puffs in a cloud share a seed.
          randomTextureSize: 4096,
        },
        scene,
      );
      system.particleTexture = this.texture;
      system.emitter = new Vector3();
      system.blendMode = GPUParticleSystem.BLENDMODE_STANDARD;
      system.updateSpeed = 1 / 60;
      // Zero, and it must stay zero: a rate is what would turn this from a
      // burst into a fountain standing wherever the last grenade went off.
      system.emitRate = 0;
      system.minLifeTime = d.life * 0.7;
      system.maxLifeTime = d.life;
      // Born radially out of a flat disc, so the cloud spreads along the
      // ground. The randomizer is what stops it reading as a ring.
      system.createCylinderEmitter(d.radius, d.height, 1, 0.55);
      system.minEmitPower = d.speed * 0.45;
      system.maxEmitPower = d.speed;
      system.gravity = new Vector3(0, d.rise, 0);
      // Thrown out hard, then stopping in the air. Read against the particle's
      // own age, so it is per puff rather than per system.
      system.addVelocityGradient(0, 1);
      system.addVelocityGradient(0.25, 0.4);
      system.addVelocityGradient(1, d.settle);
      // A puff grows as it goes: this is what separates dust from debris. The
      // pair at each stop is a per-particle range, so the cloud is not three
      // dozen quads breathing in step.
      system.addSizeGradient(0, d.sizeStart, d.sizeStart * (1 + d.sizeSpread));
      system.addSizeGradient(1, d.sizeEnd, d.sizeEnd * (1 + d.sizeSpread));
      // A billboard that never turns is a decal; these are one texture seen
      // three dozen times in one place.
      system.minInitialRotation = 0;
      system.maxInitialRotation = Math.PI * 2;
      system.minAngularSpeed = -0.5;
      system.maxAngularSpeed = 0.5;
      system.start();
      this.clouds.push({ system, t: 0 });
    }
  }

  /**
   * Dust is the ground it came off and the air it hangs in, so its colour is
   * the map's rather than this system's: `mistColor` lifted toward the key
   * light by `dust.lit`. Called from `installMap` with the environment the map
   * was built against — a cloud is only ever seen against that map's night.
   */
  setEnvironment(env: EnvironmentSpec): void {
    const d = CONFIG.grenade.dust;
    const tint = Color3.Lerp(
      Color3.FromHexString(env.mistColor),
      Color3.FromHexString(env.lighting.color),
      d.lit,
    );
    for (const cloud of this.clouds) {
      cloud.system.color1 = new Color4(tint.r, tint.g, tint.b, d.opacity);
      // The other end of one puff's colour, darker and thinner: a cloud of a
      // single tone is a shape, and the shaded half is what gives it a body.
      // Each puff picks its own place between the two from its seed.
      cloud.system.color2 = new Color4(
        tint.r * 0.5,
        tint.g * 0.5,
        tint.b * 0.58,
        d.opacity * 0.72,
      );
      // Alpha runs LINEARLY from `color1`/`color2` to this over the puff's
      // life, and that is the whole fade — there is no curve on it.
      //
      // A colour gradient is what would buy one (hold, then go), and it is not
      // usable: `addColorGradient` on a GPU system in Babylon 9.19.1 throws on
      // the next render and takes the entire scene's rendering down with it,
      // black frame and all, rather than failing to the ungraded colours.
      // Size and velocity gradients on the same system are fine. So the fade
      // is bought with the numbers instead: `opacity` is set for how the cloud
      // reads at half life rather than at birth, and `life` for where linear
      // decay puts the tail.
      cloud.system.colorDead = new Color4(tint.r, tint.g, tint.b, 0);
    }
  }

  /**
   * One cloud at a detonation.
   *
   * An exhausted pool takes the OLDEST cloud rather than refusing, which is
   * the opposite of the grenade pool's rule and for the opposite reason:
   * nothing is spent on a cloud, so a blast with no dust is a worse lie than a
   * second-old cloud cut short. `manualEmitCount` is consumed by the next
   * render, so the puffs appear on the same frame as the fireball.
   */
  burst(at: Vector3): void {
    const d = CONFIG.grenade.dust;
    let slot = this.clouds[0];
    for (const cloud of this.clouds) {
      if (cloud.t <= 0) {
        slot = cloud;
        break;
      }
      if (cloud.t < slot.t) slot = cloud;
    }
    // Lifted off the detonation — see `dust.lift`. The blast itself is
    // resolved at `at` and only the cloud stands above it.
    (slot.system.emitter as Vector3).copyFrom(at).y += d.lift;
    slot.system.manualEmitCount = d.puffs;
    slot.t = d.life;
  }

  /** Ages the clouds. Only bookkeeping — the puffs are simulated on the GPU. */
  update(dt: number): void {
    for (const cloud of this.clouds) {
      if (cloud.t > 0) cloud.t -= dt;
    }
  }

  /**
   * Drops every cloud, the same way the grenade pool is dropped and for the
   * same reason: a cloud standing over terrain that no longer exists is what
   * an editor rebuild would otherwise leave hanging in the air. `reset()`
   * releases the GPU buffers, which the next burst re-creates.
   */
  reset(): void {
    for (const cloud of this.clouds) {
      cloud.system.reset();
      cloud.t = 0;
    }
  }
}

/**
 * The puff: a soft blob with a lumpy edge, generated so the game still ships
 * no image files. Three overlapping gradients at FIXED offsets rather than
 * random ones — one texture is shared by every puff in every cloud, so the
 * variety has to come from rotation and size, and a texture that differed
 * between page loads would only make a screenshot diff lie.
 */
function buildPuffTexture(scene: Scene): DynamicTexture {
  const size = 128;
  const texture = new DynamicTexture(
    "blastDust",
    { width: size, height: size },
    scene,
    false,
  );
  const ctx = texture.getContext();
  const lobes: [number, number, number][] = [
    [64, 64, 46],
    [46, 52, 30],
    [82, 74, 26],
  ];
  for (const [x, y, r] of lobes) {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, "rgba(255,255,255,0.95)");
    gradient.addColorStop(0.5, "rgba(255,255,255,0.45)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  texture.update();
  texture.hasAlpha = true;
  return texture;
}
