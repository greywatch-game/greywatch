/**
 * GrenadeSystem.ts — Thrown grenades: the flight, the bounces, the fuse and the
 * blast, plus six of the eight layers the blast is drawn as.
 * Owns: the grenade pool, the blast pool (a flash, a cluster of fireball lobes
 * and a shock ring per slot), the ember pool, and the two `BlastDust` clouds —
 * the low dust and the smoke column. All FIXED SIZE and allocated once — this
 * is the same rule CombatSystem's tracers follow, and for the same reason: a
 * firefight must not allocate.
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
 * ## The blast is EIGHT layers and this file owns six of them
 *
 * `CONFIG.grenade`'s "The blast, as a picture" is the table; what is here is
 * the machinery under it. Six layers are drawn from this file — the flash, the
 * fireball's lobes, the shock ring, the embers, the dust and the smoke — and
 * two are not: the chunks a blast tears out of the ground and the mark it
 * leaves are `BlastDebrisSystem`'s, because they are under Havok and this
 * system runs on a server that has no physics world and no canvas.
 *
 * Three rules hold the whole picture together:
 *
 * - **There is ONE blast in this game and one set of numbers describing it.**
 *   `blastAt` takes a `power` — the grenade passes 1 and is the reference,
 *   exactly as the rifle is the reference for a weapon's `report` — and a tank
 *   shell is `CONFIG.vehicles.tank.gun.blastPower` of the same eight layers.
 *   Nothing else in the codebase describes an explosion.
 * - **`power` scales SIZE and COUNT, never TIME.** A blast that lasted longer
 *   because it was bigger would leave the tank's fireball still burning while
 *   its own smoke column was already up, and the ORDER the layers arrive in is
 *   what the effect is made of.
 * - **What the blast went off ON is answered once**, by a single downward ray
 *   in `probeGround`, and handed to everything that needs it: the shock ring
 *   lies flat to that surface and `BlastDebrisSystem` throws that surface's own
 *   rubble. It reads the same `metadata.surface` a bullet's impact reads, so a
 *   new floor material is one row in `CombatSystem`'s table and nothing here.
 *
 * Everything cross-system leaves through callbacks wired in `Game` —
 * `onExploded` for the light, the sound, the camera and the ground layers,
 * `onBlastHit` for the scoreboard. This system imports no other system.
 */
import {
  Color3,
  Color4,
  CylinderParticleEmitter,
  DynamicTexture,
  GPUParticleSystem,
  Mesh,
  MeshBuilder,
  Quaternion,
  Ray,
  Scene,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import type { Combatant, Team } from "../entities/Combatant";
import { buildGrenade, pipLit } from "../entities/GrenadeModel";
import type { CelMaterialFactory } from "../shaders/CelShader";
import type { EnvironmentSpec } from "../world/environment";
import { TerrainField } from "../world/TerrainField";
import { OPAQUE_ONLY } from "../world/solid";
import type { DamageKind, Hittable } from "./CombatSystem";

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

/**
 * One lobe of a fireball: a sphere with its own offset, size and start delay.
 *
 * The offset is a DIRECTION and a distance rather than a point, because a lobe
 * travels out along it as it grows — a cluster of spheres that merely sat where
 * they were born would be a lumpy balloon instead of a churning one.
 */
interface Lobe {
  mesh: Mesh;
  /** Unit direction out of the detonation, and how far along it the lobe ends. */
  dir: Vector3;
  reach: number;
  /** Drawn radius at full expansion, before `power`. */
  size: number;
  /** Seconds after the detonation this lobe appears. */
  delay: number;
  /** Which rung of `FIRE_LADDER` it currently wears; -1 while parked. */
  rung: number;
}

/**
 * One drawn blast: the flash at the point, the lobes around it, and the ring
 * running out along the ground.
 *
 * All three are one slot because they are one event — a pool that could hand
 * out a fireball with no ring behind it, or claim a ring for the next blast
 * while this one's lobes were still burning, would be three pools kept in step
 * by hand.
 */
interface Blast {
  flash: Mesh;
  lobes: Lobe[];
  ring: Mesh;
  /** Seconds since the detonation; < 0 while the slot is free. */
  t: number;
  /** How big this one is, with the grenade as 1. */
  power: number;
  /** Where it went off — the slot's own copy, since the caller's is scratch. */
  at: Vector3;
}

/** One ember flung out of a blast. */
interface Ember {
  mesh: Mesh;
  vel: Vector3;
  t: number;
}

/**
 * What a blast went off ON: the surface kind and which way it faces.
 *
 * `surface` is `CombatSystem.ImpactKind`'s two world answers and not the type
 * itself — `flesh` and `glass` are things a ROUND stops on, and a blast is
 * resolved at a point in space rather than against a pick, so there is nothing
 * here that could ever produce them.
 *
 * A blast hands one of these out through `drawBlast`, and it is the SYSTEM's
 * own scratch: valid for the length of the call and no longer, exactly as
 * `forEachLive`'s position is.
 */
export interface BlastGround {
  surface: "ground" | "hard";
  normal: Vector3;
}

/**
 * The fireball's colour, as four SHARED materials rather than one animated one.
 *
 * `CelMaterialFactory.getEmissive` hands out one material per colour to the
 * whole game, so a lobe that wrote its own `emissiveColor` would repaint every
 * brazier, tracer and lit window that happened to share the hex. A lobe swaps
 * material as it ages instead: four steps, each a property write, and the fade
 * to nothing on top of it is `mesh.visibility`, which IS per mesh.
 *
 * `at` is the fraction of the lobe's life the rung starts at. White for the
 * first eighth — a real fireball is only ever white in the frames the eye
 * cannot resolve — then the orange it is mostly seen as, then the deep red of
 * it going out, then the char that hands over to the smoke.
 */
const FIRE_LADDER: { at: number; hex: string }[] = [
  { at: 0, hex: "#fff4d6" },
  { at: 0.12, hex: "#ffc247" },
  { at: 0.34, hex: "#f2701a" },
  { at: 0.62, hex: "#7d2a10" },
];

/**
 * The shock ring: warm-pale, and the one layer that is never orange.
 *
 * Deliberately UNDER white. It is unlit emissive and it is in the glow layer,
 * so a ring at `#ffe4bc`-and-above blooms into a solid band of light lying on
 * the street — a magic circle rather than a pressure wave. The peak visibility
 * in `poseRing` is the other half of the same restraint.
 */
const SHOCK_COLOR = "#ffd2a0";

/**
 * How long a blast slot is held, in seconds: the last lobe's delay plus its
 * life, which is the longest of the three layers in it.
 *
 * Derived rather than declared, because it is not a choice — a slot released
 * early takes a burning lobe off the screen, and one held late is a slot the
 * next blast has to steal. It is a `const` over `CONFIG` at module scope, which
 * is safe here for the reason `CONFIG` is `as const`: nothing can move these at
 * runtime.
 */
const BLAST_SLOT_LIFE =
  CONFIG.grenade.fireball.stagger + CONFIG.grenade.fireball.life;

/**
 * The ground probe: how far ABOVE the blast the ray starts, and how far it
 * runs.
 *
 * It starts above because a grenade detonates resting on the floor, a radius
 * proud of it — a ray cast from there straight down starts inside nothing but
 * can still miss a collider whose top face it is sitting exactly on. The reach
 * is generous for the other case: a shell's impact point is on a face, and a
 * blast in open air is meant to find nothing and be told it is over earth.
 */
const PROBE_LIFT = 0.4;
const PROBE_REACH = 3.2;

/** Scratch — the flight integrates every frame and must not allocate. */
const _step = new Vector3();
const _normal = new Vector3();
const _tangent = new Vector3();
const _launch = new Vector3();
/**
 * The blast's own scratch: what it went off on, the torus's own axis, and one
 * spare for posing the ring.
 *
 * Separate from `_step` deliberately. `_step` belongs to the flight, which is
 * mid-loop when a fuse runs out — a detonation borrowing it would be writing
 * over the integration step of the grenade it is being raised from.
 */
const _ground: BlastGround = { surface: "hard", normal: new Vector3(0, 1, 0) };
const _up = new Vector3(0, 1, 0);
const _lift = new Vector3();

/** Construction-time choices. Today: whether this instance can draw. */
export interface GrenadeOptions {
  /**
   * Build the blast's two GPU clouds — the dust and the smoke. Default true;
   * the multiplayer server passes false because a NullEngine has neither a
   * canvas nor WebGL2, and both need both. Nothing about where a grenade goes
   * or what it hurts depends on either.
   */
  dust?: boolean;
}

export class GrenadeSystem {
  private grenades: Grenade[] = [];
  private blasts: Blast[] = [];
  private embers: Ember[] = [];
  /** The low cloud a blast lifts off the ground — see `BlastDust`. */
  private dust: BlastDust | null;
  /** The column it sends up. The same class, different numbers — see `smoke`. */
  private smoke: BlastDust | null;
  /** The fireball's four rungs, resolved once — see `FIRE_LADDER`. */
  private readonly fireMats: StandardMaterial[];
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
   * Wired by Game: a blast happened here, and this is what it landed on.
   *
   * The light, the sound, the camera's concussion and the two ground layers —
   * the chunks and the scorch mark — all hang off this. None of them are this
   * system's business and three of them are owned by systems it must not
   * import, `BlastDebrisSystem` among them.
   *
   * `power` is the grenade-relative size (see the header) and `ground` is this
   * system's own scratch: read it inside the call or copy it, never keep it.
   */
  onExploded: (at: Vector3, power: number, ground: BlastGround) => void =
    () => {};

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
    const draws = opts?.dust !== false;
    this.dust = draws ? new BlastDust(scene, "blastDust", g.dust) : null;
    this.smoke = draws ? new BlastDust(scene, "blastSmoke", g.smoke) : null;
    this.fireMats = FIRE_LADDER.map((rung) => mats.getEmissive(rung.hex));
    const shockMat = mats.getEmissive(SHOCK_COLOR);
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
    // what "two blasts close together" actually needs. Each slot is a flash, a
    // cluster of lobes and a ring — see `Blast`.
    for (let i = 0; i < g.blastSlots; i++) {
      const flash = MeshBuilder.CreateSphere(
        `blastFlash${i}`,
        { diameter: 2, segments: 10 },
        scene,
      );
      flash.material = this.fireMats[0];
      flash.metadata = { noOutline: true };
      flash.isVisible = false;
      flash.isPickable = false;

      // **The lobes' shape is decided HERE and not at the detonation**, which
      // is what makes a burst free: a slot's five lobes get their directions,
      // sizes and delays once, drawn off the golden angle so the cluster is
      // spread rather than clumped, and every blast that claims the slot wears
      // the same arrangement at whatever `power` it came with. Four slots is
      // four arrangements, which is more variety than an eye gets out of an
      // event lasting half a second.
      const lobes: Lobe[] = [];
      for (let j = 0; j < g.fireball.lobes; j++) {
        const mesh = MeshBuilder.CreateSphere(
          `blastLobe${i}-${j}`,
          { diameter: 2, segments: 8 },
          scene,
        );
        mesh.material = this.fireMats[0];
        mesh.metadata = { noOutline: true };
        mesh.isVisible = false;
        mesh.isPickable = false;
        // The golden angle around the vertical and a lift that walks up it:
        // an even spread with no two lobes on the same bearing, and no call to
        // `Math.random()` in a constructor the server also runs.
        const yaw = j * 2.399963;
        const lift = -0.15 + (j / Math.max(1, g.fireball.lobes - 1)) * 0.95;
        const flat = Math.sqrt(Math.max(0, 1 - lift * lift));
        lobes.push({
          mesh,
          dir: new Vector3(Math.cos(yaw) * flat, lift, Math.sin(yaw) * flat),
          reach: g.fireball.spread * (0.45 + 0.55 * ((j * 7) % 5) / 4),
          size: g.fireball.radius * (0.55 + 0.45 * ((j * 3) % 4) / 3),
          delay: (j / g.fireball.lobes) * g.fireball.stagger,
          rung: -1,
        });
      }

      // Built at diameter 2 so a uniform scale of `r` IS a ring of radius `r`,
      // and the tube is quoted as a fraction of that — it widens in proportion
      // as the ring runs out, which is what a wave front does. `squash` is the
      // one axis that does not scale with the rest, and is what keeps the ring
      // lying on the ground rather than standing up as a doughnut.
      const ring = MeshBuilder.CreateTorus(
        `blastRing${i}`,
        { diameter: 2, thickness: 0.095, tessellation: 28 },
        scene,
      );
      ring.material = shockMat;
      // **`noGlow` is the ring's, and it is the one layer here that opts out.**
      // The flash and the lobes are FIRE and want the bloom; the ring is a thin
      // pale band lying on the street, and the glow layer turns a thin pale
      // band into a solid halo of light — a magic circle, drawn at full
      // strength in daylight where the fireball behind it is not. It is not
      // inert: this system is built before `Game`'s construction-time
      // glow-exclusion scan, the same ordering `DebrisSystem`'s pool relies on.
      ring.metadata = { noOutline: true, noGlow: true };
      ring.isVisible = false;
      ring.isPickable = false;
      ring.rotationQuaternion = Quaternion.Identity();

      this.blasts.push({
        flash,
        lobes,
        ring,
        t: -1,
        power: 1,
        at: new Vector3(),
      });
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
    this.smoke?.setEnvironment(env);
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
    this.blastAt(at, n.team, n.by, {
      radius: g.blastRadius,
      inner: g.innerRadius,
      damage: g.damage,
      kind: "blast",
      // The grenade is the reference and its power is 1 by definition — see
      // the header, and `CONFIG.grenade`'s "The blast, as a picture".
      power: 1,
    });
  }

  /**
   * A blast at a point: radial damage with a line-of-sight test, then the
   * effects. `detonate` is one caller and the tank's shell is the other.
   *
   * Damage falls linearly from full inside `inner` to nothing at `radius`,
   * measured to the victim's CENTRE — the same point bullets are tested
   * against, so a crouched target is genuinely harder to catch with a grenade
   * in the same way it is harder to shoot.
   *
   * **The second caller is why this is a method rather than the body of
   * `detonate`, and the alternative was worse than the coupling looks.** A tank
   * shell wants exactly this — a falloff, a fragment ray per victim, the
   * fireball, the dust, the embers, the light and the noise — with three
   * different numbers and a different `DamageKind`. Written again in the
   * vehicle system it would have been the second copy of a five-line falloff
   * and a nine-line LOS test, and this codebase has already paid once for two
   * copies of something drifting apart (`installMap`). So the numbers are the
   * CALLER's and the shape is this system's, which leaves the grenade's own
   * figures where they have always been, in `CONFIG.grenade`.
   *
   * It does not make this the blast system. It stays `GrenadeSystem` because
   * everything else in here — the pool, the arc, the bounce, the fuse — is
   * about the one thing that flies, and a shell does not fly: it is hitscan
   * like every other round in the game, and only its ARRIVAL comes here.
   */
  blastAt(
    at: Vector3,
    team: Team,
    by: Combatant | null,
    spec: {
      radius: number;
      inner: number;
      damage: number;
      kind: DamageKind;
      /** How big it LOOKS, with the grenade as 1. See the header. */
      power: number;
    },
  ): void {
    for (const target of this.hittablesFor(team)) {
      if (target.invulnerable) continue;
      const dist = Vector3.Distance(at, target.center);
      if (dist > spec.radius) continue;
      if (!this.visible(at, target.center)) continue;
      const falloff =
        dist <= spec.inner
          ? 1
          : 1 - (dist - spec.inner) / (spec.radius - spec.inner);
      const killed = target.takeDamage(spec.damage * falloff, at, spec.kind);
      this.onBlastHit(target, team, by, killed);
    }

    // The picture, and then the event. In that order because the ground probe
    // is inside the first and the second is handed its answer.
    const ground = this.drawBlast(at, spec.power);
    // The light, the sound, the camera's concussion and the two layers under
    // Havok all belong to systems this one may not import, so they leave as one
    // event with a position, a size and a surface on it.
    this.onExploded(at.clone(), spec.power, ground);
  }

  /**
   * Draws a blast without resolving one: the six layers this file owns, and the
   * ground probe under them.
   *
   * **Public because there are two ways a blast can happen and only one of them
   * is a rule.** Offline `blastAt` runs both halves. In a netplay round the
   * damage is the authority's and arrives as an `explode` event with nothing
   * but a position on it, so `Game` calls this directly — which is also what
   * puts a fireball on somebody ELSE's grenade, an event that used to arrive as
   * a light and a bang with nothing burning at the middle of it.
   *
   * The returned `BlastGround` is this system's scratch and is valid only for
   * the length of the caller's own handling of it.
   */
  drawBlast(at: Vector3, power: number): BlastGround {
    const ground = this.probeGround(at);
    this.spawnBlast(at, power, ground);
    return ground;
  }

  /**
   * What the blast went off ON: one downward ray, and the terrain as a backstop
   * under it exactly as the flight has.
   *
   * `OPAQUE_ONLY` rather than `SOLID_ONLY`, which is the same choice the flight
   * makes and for the same reason: debris comes off things that stop rounds, so
   * a fence's coarse run is not a surface a blast tears anything out of. The
   * kind is read off `metadata.surface` — the field `MapBuilder` sets on
   * exactly one thing, the terrain floor's collider clone — so every wall, roof
   * and prop in the village answers "hard" by omission, and a new floor
   * material is a row in `CombatSystem`'s table and nothing here.
   *
   * A blast in mid-air (a shell into a wall high up, a grenade that went off
   * over a stairwell) finds nothing within `PROBE_REACH` and is told the ground
   * is level earth beneath it. That is the right answer for the two consumers:
   * the ring lies flat and the chunks fall, which is what an airburst does.
   */
  private probeGround(at: Vector3): BlastGround {
    this.ray.origin.copyFrom(at);
    this.ray.origin.y += PROBE_LIFT;
    this.ray.direction.set(0, -1, 0);
    this.ray.length = PROBE_REACH;
    const hit = this.scene.pickWithRay(this.ray, OPAQUE_ONLY);
    const normal = hit?.hit && hit.pickedPoint ? hit.getNormal(true) : null;
    if (hit?.hit && normal) {
      _ground.normal.copyFrom(normal);
      // A collider's back face points down, and a ring turned onto it is a ring
      // drawn under the floor. The flight flips a normal for the same reason.
      if (_ground.normal.y < 0) _ground.normal.scaleInPlace(-1);
      _ground.surface =
        hit.pickedMesh?.metadata?.surface === "ground" ? "ground" : "hard";
      return _ground;
    }
    _ground.normal.set(0, 1, 0);
    _ground.surface = "ground";
    return _ground;
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

  /**
   * Claims a blast slot and starts all six layers on the same frame.
   *
   * **The slot is claimed by AGE and never refused**, which is the dust's rule
   * rather than the grenade pool's and for the dust's reason: nothing is spent
   * on a fireball, so a blast with no fire in it is a worse lie than a
   * half-second-old one cut short.
   */
  private spawnBlast(at: Vector3, power: number, ground: BlastGround): void {
    const g = CONFIG.grenade;

    let slot = this.blasts[0];
    for (const b of this.blasts) {
      if (b.t < 0) {
        slot = b;
        break;
      }
      if (b.t > slot.t) slot = b;
    }
    slot.t = 0;
    slot.power = power;
    slot.at.copyFrom(at);

    slot.flash.position.copyFrom(at);
    slot.flash.material = this.fireMats[0];
    for (const lobe of slot.lobes) {
      // Parked until its delay is up. Its rung is cleared so the first pose
      // reassigns the material rather than trusting what the last blast left.
      lobe.mesh.isVisible = false;
      lobe.rung = -1;
    }

    // The ring lies flat to whatever the blast went off on. `FromUnitVectorsTo`
    // is the shortest turn from the torus's own axis onto that normal, which
    // for the overwhelmingly common flat-earth case is the identity.
    Quaternion.FromUnitVectorsToRef(_up, ground.normal, slot.ring.rotationQuaternion!);
    slot.ring.position.copyFrom(at);
    // Off the surface by the same trick a bullet's dust disc uses: a coplanar
    // ring z-fights with the floor it is expanding across.
    slot.ring.position.addInPlace(_lift.copyFrom(ground.normal).scaleInPlace(0.06));

    // **Posed HERE and not left to the next frame**, which is the one thing
    // about this that has to be said out loud: a slot is reused, so a mesh made
    // visible without being posed is drawn for one frame at whatever size and
    // brightness the LAST blast in this slot ended on — a fireball that flashes
    // full-size and dark before it starts. At `t = 0` these three are the birth
    // pose and nothing about them is a special case.
    this.poseFlash(slot);
    this.poseLobes(slot);
    this.poseRing(slot);

    // The dust goes up with the flash and outlives it by a second — the
    // fireball is the event and the cloud is what the event left behind — and
    // the smoke column outlives THAT by another two.
    this.dust?.burst(at, power);
    this.smoke?.burst(at, power);

    // Embers, thrown out of the blast on an even-ish spread rather than a
    // random one — a handful of random directions clumps, and a clump reads as
    // one lump of debris instead of as a burst.
    const wanted = Math.round(g.emberCount * power);
    let spawned = 0;
    for (const e of this.embers) {
      if (spawned >= wanted) break;
      if (e.t > 0) continue;
      const yaw = ((spawned + Math.random()) / wanted) * Math.PI * 2;
      const lift = 0.25 + Math.random() * 0.9;
      const speed = g.emberSpeed * power * (0.5 + Math.random() * 0.7);
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
    this.smoke?.update(dt);
    for (const b of this.blasts) {
      if (b.t < 0) continue;
      b.t += dt;
      if (b.t > BLAST_SLOT_LIFE) {
        this.parkBlast(b);
        continue;
      }
      this.poseFlash(b);
      this.poseLobes(b);
      this.poseRing(b);
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
   * The core: already large on the frame it appears, gone two frames later.
   *
   * It expands hardly at all — from 55% to full — because this is the layer
   * that FIXES the detonation point for the eye. The lobes are scattered and
   * the clouds are lifted, so a flash that grew from nothing would leave the
   * first frame of a blast with nothing at its middle.
   */
  private poseFlash(b: Blast): void {
    const f = b.t / CONFIG.grenade.flash.life;
    if (f >= 1) {
      b.flash.isVisible = false;
      return;
    }
    b.flash.scaling.setAll(CONFIG.grenade.flash.radius * b.power * (0.55 + 0.45 * f));
    // Squared, so most of the flash is spent at nearly full brightness and the
    // fall-off is the last third rather than a linear dim across the whole of it.
    b.flash.visibility = (1 - f) * (1 - f);
    b.flash.isVisible = true;
  }

  /**
   * The cluster: each lobe out along its own bearing, growing on a square root
   * so it arrives fast and settles, climbing on `rise`, and stepping down
   * `FIRE_LADDER` as it goes.
   */
  private poseLobes(b: Blast): void {
    const fb = CONFIG.grenade.fireball;
    for (const lobe of b.lobes) {
      const age = b.t - lobe.delay;
      const f = age / fb.life;
      if (age < 0 || f >= 1) {
        if (lobe.mesh.isVisible) lobe.mesh.isVisible = false;
        continue;
      }
      const grown = Math.sqrt(f);
      lobe.mesh.scaling.setAll(lobe.size * b.power * (0.3 + 0.7 * grown));
      lobe.mesh.position
        .copyFrom(lobe.dir)
        .scaleInPlace(lobe.reach * b.power * (0.35 + 0.65 * grown))
        .addInPlace(b.at);
      lobe.mesh.position.y += fb.rise * age;
      // Held solid for the first half and faded over the second — the ladder
      // is already darkening it, and fading from the first frame would take the
      // fireball out before the colour had anywhere to go.
      lobe.mesh.visibility = f < 0.5 ? 1 : 1 - (f - 0.5) * 2;
      // The rung, and it is only WRITTEN when it changes: a material assignment
      // that is already the material it was is still a property write Babylon
      // dirties a sub-mesh over.
      let rung = 0;
      for (let i = FIRE_LADDER.length - 1; i >= 0; i--) {
        if (f >= FIRE_LADDER[i].at) {
          rung = i;
          break;
        }
      }
      if (rung !== lobe.rung) {
        lobe.rung = rung;
        lobe.mesh.material = this.fireMats[rung];
      }
      lobe.mesh.isVisible = true;
    }
  }

  /**
   * The ring: out to `shock.radius` inside `shock.life`, widening as it goes.
   *
   * Its expansion EASES OUT (`1 - (1-f)^2`) rather than running linearly,
   * which is the difference between a pressure wave and a hoop rolling away
   * from the blast: most of the distance is covered in the first third.
   */
  private poseRing(b: Blast): void {
    const sh = CONFIG.grenade.shock;
    const f = b.t / sh.life;
    if (f >= 1) {
      b.ring.isVisible = false;
      return;
    }
    const out = 1 - (1 - f) * (1 - f);
    // The torus is built at diameter 2, so a scale of r is a ring of radius r.
    const r = sh.radius * b.power * (0.08 + 0.92 * out);
    b.ring.scaling.set(r, r * sh.squash, r);
    // `peak` is a cap and not a taste: this is unlit emissive inside the glow
    // layer, so a ring drawn at full alpha blooms into a solid band of light on
    // the street. See `SHOCK_COLOR`.
    b.ring.visibility = sh.peak * (1 - f) * (1 - f);
    b.ring.isVisible = true;
  }

  /** Puts a blast's three layers away and frees the slot. */
  private parkBlast(b: Blast): void {
    b.t = -1;
    b.flash.isVisible = false;
    b.ring.isVisible = false;
    for (const lobe of b.lobes) {
      lobe.mesh.isVisible = false;
      lobe.rung = -1;
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
    for (const b of this.blasts) this.parkBlast(b);
    for (const e of this.embers) {
      e.t = 0;
      e.mesh.isVisible = false;
    }
    this.dust?.reset();
    this.smoke?.reset();
  }
}

/** One blast's dust: the GPU system holding it, and when it goes quiet. */
interface DustCloud {
  system: GPUParticleSystem;
  /** Seconds until the last puff has faded; <= 0 while the slot is free. */
  t: number;
}

/**
 * What one cloud is made of. `CONFIG.grenade.dust` and `.smoke` are both this.
 *
 * Spelled out rather than taken as `typeof CONFIG.grenade.dust`, which would
 * be `as const`'s LITERAL types — a spec whose `puffs` is the type `34` accepts
 * exactly one of the two clouds this file builds.
 */
interface CloudSpec {
  readonly clouds: number;
  readonly puffs: number;
  readonly life: number;
  readonly radius: number;
  readonly height: number;
  readonly lift: number;
  readonly speed: number;
  readonly settle: number;
  readonly rise: number;
  readonly sizeStart: number;
  readonly sizeEnd: number;
  readonly sizeSpread: number;
  readonly opacity: number;
  readonly lit: number;
}

/**
 * A cloud a blast throws: `spec.puffs` soft quads out of a flat disc at the
 * detonation, expanding, slowing and fading over `spec.life`. Not emissive and
 * not the flame — `BLENDMODE_STANDARD`, tinted from the map's own mist toward
 * its key light, so it occludes what is behind it rather than adding to it.
 *
 * **Two of these are built and they are the same class with different
 * numbers**: `CONFIG.grenade.dust` is the low cloud a blast lifts off the
 * ground, and `.smoke` is the column it sends up — fewer puffs, much bigger,
 * much longer-lived, a real `rise` and a `lit` near zero. A second
 * implementation would be a second place the four Babylon constraints below
 * have to be remembered, and they are the whole of what is hard about this.
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
 * keeps two blasts apart, for the same reason there is a pool of fireball slots
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

  constructor(
    scene: Scene,
    name: string,
    private readonly d: CloudSpec,
  ) {
    this.texture = buildPuffTexture(scene);

    for (let i = 0; i < d.clouds; i++) {
      const system = new GPUParticleSystem(
        `${name}${i}`,
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
    const d = this.d;
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
  burst(at: Vector3, power: number): void {
    const d = this.d;
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
    (slot.system.emitter as Vector3).copyFrom(at).y += d.lift * power;
    // **`power` is applied HERE and not in the constructor**, because these are
    // the three properties the GPU update shader reads inside its EMISSION
    // branch — `scaleRange`, `emitPower` and the emitter's own extents — and
    // that branch runs only for a particle being born. So a burst may change
    // them freely: the puffs already in the ring were sized when they were
    // emitted and are not resized under a later blast.
    //
    // A size GRADIENT could not do this: those are baked into a texture at
    // `start()` and are shared by everything in the ring.
    slot.system.minScaleX = power;
    slot.system.maxScaleX = power;
    slot.system.minScaleY = power;
    slot.system.maxScaleY = power;
    slot.system.minEmitPower = d.speed * 0.45 * power;
    slot.system.maxEmitPower = d.speed * power;
    const shape = slot.system.particleEmitterType as CylinderParticleEmitter;
    shape.radius = d.radius * power;
    shape.height = d.height * power;
    slot.system.manualEmitCount = Math.round(d.puffs * Math.min(2, power));
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
