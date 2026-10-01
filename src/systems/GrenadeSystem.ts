/**
 * GrenadeSystem.ts — Thrown grenades and molotovs: the flight, the bounces, the
 * fuse, the blast and the fire.
 * Owns: the grenade pool (a frag and a bottle per slot), the fire pool a broken
 * bottle burns in, the ground probe under a blast, and the `BlastFx` that draws
 * six of a blast's eight layers. All FIXED SIZE and allocated once — this is
 * the same rule CombatSystem's tracers follow, and for the same reason: a
 * firefight must not allocate.
 *
 * This is the one thing in the game that is not hitscan, and everything here is
 * shaped by that:
 * - A grenade is integrated per frame and collides with ONE ray per grenade per
 *   frame, through `RayWorld.castRound` — the same collider set bullets stop on
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
 * ## The blast is EIGHT layers and this file's `BlastFx` draws six of them
 *
 * `CONFIG.grenade`'s "The blast, as a picture" is the table. Six layers — the
 * flash, the fireball, the surge, the sparks, the burning fragments' trails
 * and the column — are billows drawn by `BlastFx`, which this system owns and
 * the server never builds. Two are not: the chunks a blast tears out of the
 * ground and the mark it leaves are `BlastDebrisSystem`'s, because they are
 * under Havok and this system runs on a server that has no physics world and
 * no canvas.
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
 *   in `probeGround`, and handed to everything that needs it: the surge rolls
 *   out flat to that surface and `BlastDebrisSystem` throws that surface's own
 *   rubble. It reads the same `metadata.surface` a bullet's impact reads, so a
 *   new floor material is one row in `CombatSystem`'s table and nothing here.
 *
 * ## The molotov is the same flight and a different ending
 *
 * The throwable slot holds a frag OR a molotov (`entities/throwables.ts`), and
 * both are slots in the one pool here: the same throw, the same arc, the same
 * one ray a frame. What differs is what the first thing it touches does to
 * it. A frag bounces and waits for its fuse; a bottle BREAKS, and where it
 * breaks a FIRE starts — a slot in a second pool (`Fire`) that burns for
 * `CONFIG.molotov.fire.life` and hurts whoever stands in it a few points at a
 * time, against the thrower's target list fetched on every tick, exactly as a
 * blast fetches it at the detonation. It is drawn in the world's one fire
 * material (`FlameMaterial`), and its ignition is the one blast's own flash
 * and fireball at a fraction of a frag, with the surge left off.
 *
 * **A fire drawn off the wire is a fire with no RULES** (`Fire.rules`): in a
 * match the burn is the authority's, arrives as a `blaze` event, and a client
 * draws it through `drawFire` exactly as it draws somebody else's blast
 * through `drawBlast`. `predicted` is what stops the thrower's own local copy
 * lighting a second one where their bottle landed on their screen.
 *
 * Everything cross-system leaves through callbacks wired in `Game` —
 * `onExploded` for the light, the sound, the camera and the ground layers,
 * `onBlastHit` for the scoreboard, and `onIgnited`/`onBurntOut`/`onBurnHit`
 * for a fire's light, noise, mark and kills. This system imports no other
 * system.
 */
import { Mesh, Scene, Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { Combatant, Team } from "../entities/Combatant";
import { buildGrenade, pipLit } from "../entities/GrenadeModel";
import {
  buildMolotov,
  showMolotov,
  type MolotovMeshes,
} from "../entities/MolotovModel";
import type { ThrowableId } from "../entities/throwables";
import type { CelMaterialFactory } from "../shaders/CelShader";
import type { EnvironmentSpec } from "../world/environment";
import { TerrainField } from "../world/TerrainField";
import { flameData } from "../world/flame";
import { newRayHit, type RayWorld } from "../world/RayWorld";
import { BlastFx } from "./BlastFx";
import type { DamageKind, Hittable } from "./CombatSystem";

/**
 * One throwable in flight — a frag (resting with its fuse running, too) or a
 * molotov on its way to breaking.
 *
 * **Both bodies are built into every slot and `kind` says which one is out**,
 * rather than two pools: a slot is claimed by whoever throws next, the refusal
 * rule is the pool's and has to be ONE rule, and a frag and a bottle share
 * everything about the flight but its ending.
 */
interface Grenade {
  mesh: Mesh;
  /** The fuse tell — blinks faster as the fuse runs out. */
  pip: Mesh;
  /** The bottle, when this flight is a molotov. Hidden otherwise. */
  bottle: MolotovMeshes;
  /** Which of the two this flight is. */
  kind: ThrowableId;
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
  /**
   * Seconds of fuse left; <= 0 while the slot is free. A molotov has no fuse,
   * and this counts its `maxFlight` backstop down instead — the same clock, so
   * the wire's `fuse` needs no second field.
   */
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
 * One patch of burning ground, and the second pool in this file.
 *
 * **It is a PLACE with a clock, where a blast is an event with a picture**, so
 * everything a blast resolves once a fire resolves every `tick` for as long as
 * it burns: the thrower's target list, the band a victim's centre has to be
 * in, and one line-of-sight ray per victim inside it.
 */
interface Fire {
  /**
   * What this FIRE is called, for `Game`'s light and its held-open audio
   * graph — both keyed on it for the length of the burn. Monotonic and never
   * reused, for `Grenade.id`'s reason: a slot is reclaimed the instant the
   * oldest fire is put out, and a light keyed on the slot would be taken away
   * from the new fire by the old one's burn-out.
   */
  id: number;
  /** The floor it is burning on. The slot's own copy. */
  at: Vector3;
  /** Seconds since it started; < 0 while the slot is free. */
  t: number;
  team: Team;
  by: Combatant | null;
  /** Seconds until the next burn is resolved. */
  tick: number;
  /** False for a fire drawn off the wire: the authority burns, this only draws. */
  rules: boolean;
  /** Its flames — empty on the authority, which draws nothing. */
  flames: Flame[];
}

/** One flame in a fire: where it stands off the fire's middle, and how big it is. */
interface Flame {
  mesh: Mesh;
  /** Offset on the ground from the fire's middle, metres. */
  dx: number;
  dz: number;
  /** Its own size against the rest, around 1. */
  size: number;
  /** Whether it is lit in THIS fire — false where a wall stands between it and the middle. */
  on: boolean;
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

/**
 * How far short of the blast the fragment ray stops, in metres.
 *
 * **A blast very often goes off exactly ON a surface, and a ray that starts on
 * one hits it.** A grenade rests a radius proud of the floor and never had
 * this problem, but a shell's blast point is `ShotResult.hitPoint` — which is
 * `origin + dir * distance` for the very query that found the face, so it lies
 * on that face to within float noise, on whichever side the noise lands. Cast
 * from there the box test's `tMin >= 0` and the triangle's `t >= 0` both count
 * a hit at zero distance, and the victim standing in the crater is reported as
 * being behind a wall. Measured on Coldharbour: **85% of ground impacts and
 * 47% of wall impacts blocked their own splash**, and of forty-four shells put
 * into the dirt a metre from a bot's boots, forty-four. That is a tank shell
 * that draws a fireball at a man's feet and does not scratch him.
 *
 * **So the ray is cast from the VICTIM toward the blast and stops short of
 * it, rather than from the blast outward**, and the direction is the whole of
 * the fix rather than a preference. A body's chest is in open air; a blast
 * point is on a face, and `boxCast` reports a hit for ANY ray whose origin is
 * inside a box however far in it is — so the suspect point must be the END of
 * the segment, where a graze only has to clear the noise, and never its
 * origin, where no distance clears it. Cast outward instead, five centimetres
 * along a ray leaving a step's top face at three degrees is still inside the
 * step.
 *
 * Five centimetres is three orders above the noise and two below anything a
 * round can hide behind, and giving it up can only ever lose the surface the
 * blast is already touching: a wall BETWEEN the two is still crossed, because
 * the ray is aimed through it and only its last 5 cm are given up.
 */
const LOS_SKIP = 0.05;
const PROBE_REACH = 3.2;

/** Scratch — the flight integrates every frame and must not allocate. */
const _step = new Vector3();
const _normal = new Vector3();
const _tangent = new Vector3();
const _launch = new Vector3();
/**
 * The blast's own scratch: what it went off on.
 *
 * Separate from `_step` deliberately. `_step` belongs to the flight, which is
 * mid-loop when a fuse runs out — a detonation borrowing it would be writing
 * over the integration step of the grenade it is being raised from.
 */
const _ground: BlastGround = { surface: "hard", normal: new Vector3(0, 1, 0) };
/** The flight's step direction, and the blast probe's origin and its straight down. */
const _dir = new Vector3();
const _lifted = new Vector3();
/** `visible`'s own start point, so a fragment ray allocates nothing. */
const _los = new Vector3();
const _down = new Vector3(0, -1, 0);
/** A fire's own point of view for its burn's line of sight, and a flame's floor probe. */
const _flameTop = new Vector3();
const _flameProbe = new Vector3();

/** Construction-time choices. Today: whether this instance can draw. */
export interface GrenadeOptions {
  /**
   * Build the blast's picture (`BlastFx`) and the molotov's flames. Default
   * true; the multiplayer server passes false because a NullEngine has no GPU
   * device to compile their WGSL on. Nothing about where a grenade goes or
   * what it hurts depends on either. Named for the dust it once guarded, and
   * kept: `HeadlessGame` and `docs/multiplayer.md` both spell it.
   */
  dust?: boolean;
}

export class GrenadeSystem {
  private grenades: Grenade[] = [];
  /**
   * The blast's picture — six of its eight layers (`BlastFx`). Null on the
   * authority, which draws nothing: see `GrenadeOptions.dust`.
   */
  private readonly fx: BlastFx | null;
  /** Reused by the flight and the line-of-sight tests alike. */
  /**
   * The solid world as a segment query, and the result buffer the flight, the
   * blast probe and the fragment check all read. Null until a map is
   * installed: a grenade thrown before one meets nothing but its own terrain
   * backstop, which is what an empty scene answered.
   */
  private rays: RayWorld | null = null;
  private readonly hit = newRayHit();
  /** Names the next flight. Never reset — see `Grenade.id`. */
  private nextId = 0;
  /** The burning ground a molotov leaves — see `Fire`. */
  private fires: Fire[] = [];
  /** Names the next fire. Never reset — see `Fire.id`. */
  private nextFireId = 0;
  /**
   * Whether a molotov that breaks HERE lights nothing.
   *
   * True in a netplay client, where the burn is the authority's and arrives as
   * a `blaze` event: the thrower's own local bottle still flies — it is what
   * they watched leave their hand — but lighting it too would put two fires
   * down for one bottle, one of them where it landed on this screen rather
   * than where it landed on the server's. `Game.installMap` writes it beside
   * `VehicleSystem.build`'s own `predicted`, for the same reason.
   */
  predicted = false;
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

  /**
   * Wired by Game: a fire started here, on `ground`. The light, the noise of
   * the bottle going up, and the mark it leaves all hang off this, for
   * `onExploded`'s reason — none of them is this system's to reach.
   *
   * `id` names the fire until `onBurntOut` says the same id, which is what
   * `Game` keys the fire's light and its held-open sound on. `ground` is this
   * system's scratch, exactly as it is on `onExploded`.
   */
  onIgnited: (id: number, at: Vector3, ground: BlastGround) => void = () => {};

  /** Wired by Game: the fire `onIgnited` named is out. Take its light away. */
  onBurntOut: (id: number) => void = () => {};

  /**
   * Wired by Game: a fire burned someone. `onBlastHit`'s four arguments, and a
   * callback of its own rather than that one, because what a BURN owes the
   * thrower is not what a blast does: it arrives four times a second for as
   * long as somebody stands in it, so a hitmarker per tick would be a strobe.
   */
  onBurnHit: (
    victim: Hittable,
    thrower: Team,
    by: Combatant | null,
    killed: boolean,
  ) => void = () => {};

  constructor(
    // Not a field: everything this system builds is built here, and the last
    // thing that wanted the scene afterwards was the flight's step ray.
    scene: Scene,
    mats: CelMaterialFactory,
    opts?: GrenadeOptions,
  ) {
    const g = CONFIG.grenade;
    // The blast's picture is the one part of this system that cannot exist
    // without a renderer: its WGSL has no device to compile on under Babylon's
    // NullEngine. The multiplayer server runs the BALLISTICS — where a grenade
    // lands and who it hurts is a rule, not a picture — so it asks for the
    // system without it.
    const draws = opts?.dust !== false;
    this.fx = draws ? new BlastFx(scene, mats) : null;

    for (let i = 0; i < g.poolSize; i++) {
      const { mesh, pip } = buildGrenade(scene, mats, `grenade${i}`);
      this.grenades.push({
        mesh,
        pip,
        bottle: buildMolotov(scene, mats, `molotov${i}`),
        kind: "frag",
        id: 0,
        vel: new Vector3(),
        fuse: 0,
        live: false,
        team: 0,
        by: null,
        resting: false,
      });
    }

    // The molotov's fires. The FLAMES are built only where something draws —
    // `FlameMaterial` is a WGSL shader and the authority has no device to
    // compile it on — but the SLOTS are built everywhere, because where a fire
    // is and whom it burns are rules. One geometry, cloned: every flame in
    // every fire is the same vertex data at its own scale, and the shader
    // phases each one off its WORLD position, so no two in a street move
    // together however many share the buffer.
    const m = CONFIG.molotov;
    const source = draws ? new Mesh("molotovFlameSource", scene) : null;
    if (source) {
      flameData({ radius: m.flameRadius, height: m.flameHeight }).applyToMesh(source);
      source.material = mats.getFlame();
      source.metadata = { noInk: true, noShadowCaster: true };
      source.isPickable = false;
      source.isVisible = false;
    }
    for (let i = 0; i < m.fires; i++) {
      const flames: Flame[] = [];
      for (let j = 0; source && j < m.flames; j++) {
        const mesh = source.clone(`molotovFlame${i}-${j}`);
        mesh.metadata = { noInk: true, noShadowCaster: true };
        mesh.isPickable = false;
        mesh.isVisible = false;
        // The first flame stands in the middle and the rest walk out on the
        // golden angle to most of the radius, so the disc reads as burning to
        // its edge rather than as one fire with a halo. Deterministic, for
        // the flight's reason: nothing in this constructor, which the server
        // also runs, may draw a random.
        const r =
          j === 0 ? 0 : m.fire.radius * (0.3 + 0.55 * Math.sqrt(j / (m.flames - 1)));
        const a = j * 2.399963 + i * 0.7;
        flames.push({
          mesh,
          dx: Math.cos(a) * r,
          dz: Math.sin(a) * r,
          size: j === 0 ? 1.25 : 0.7 + 0.35 * (((j * 5) % 4) / 3),
          on: false,
        });
      }
      this.fires.push({
        id: 0,
        at: new Vector3(),
        t: -1,
        team: 0,
        by: null,
        tick: 0,
        rules: true,
        flames,
      });
    }
  }

  /** Points the flight's floor backstop at the current map. */
  setTerrain(terrain: TerrainField): void {
    this.terrain = terrain;
  }

  /**
   * And what it bounces off on the way there. Beside `setTerrain` rather than
   * folded into it because the two are different facts about a map — the floor
   * is a backstop UNDER the colliders and this is the colliders.
   */
  setWorld(rays: RayWorld | null): void {
    this.rays = rays;
  }

  /**
   * The only thing in here a map's look reaches: what colour the blast dust
   * is. Called from `installMap` with the environment the map was built
   * against.
   */
  setEnvironment(env: EnvironmentSpec): void {
    this.fx?.setEnvironment(env);
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
    fn: (
      id: number,
      at: Vector3,
      fuse: number,
      by: Combatant | null,
      kind: ThrowableId,
    ) => void,
  ): void {
    for (const n of this.grenades) {
      if (n.live) fn(n.id, body(n).position, n.fuse, n.by, n.kind);
    }
  }

  /**
   * Every fire burning right now, and how far along its own swell it is — 0
   * as it starts and as it goes out, 1 at full height. `Game` is the caller:
   * the fire's light and its held-open sound are keyed on `id` and eased on
   * `strength`, and both belong to systems this one may not reach. `at` is
   * the slot's own vector and valid only for the call, as `forEachLive`'s is.
   */
  forEachFire(fn: (id: number, at: Vector3, strength: number) => void): void {
    for (const f of this.fires) {
      if (f.t >= 0) fn(f.id, f.at, fireStrength(f.t));
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
    kind: ThrowableId = "frag",
  ): boolean {
    // Tilting a unit direction up by an angle and renormalising: cheaper than
    // building a rotation, and the axis is always world up.
    _launch.copyFrom(dir).normalize();
    _launch.y += Math.tan(CONFIG.grenade.throwLift);
    _launch.normalize().scaleInPlace(CONFIG.grenade.throwSpeed);
    return this.throwFrom(from, _launch, team, by, kind);
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
    kind: ThrowableId = "frag",
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
    return this.throwFrom(from, _launch, team, by, kind);
  }

  /**
   * Claims a pool slot and puts the grenade — or the bottle — in the air.
   *
   * Both kinds leave on the same velocity: a molotov is thrown on the frag's
   * arc and states none of its own (see `CONFIG.molotov`'s header), so the
   * two solves above serve both and the bots' measured band holds for both.
   */
  private throwFrom(
    from: Vector3,
    velocity: Vector3,
    team: Team,
    by: Combatant | null,
    kind: ThrowableId,
  ): boolean {
    const slot = this.grenades.find((n) => !n.live);
    if (!slot) return false;
    slot.id = ++this.nextId;
    slot.kind = kind;
    const mesh = body(slot);
    mesh.position.copyFrom(from);
    slot.vel.copyFrom(velocity);
    slot.fuse = kind === "molotov" ? CONFIG.molotov.maxFlight : CONFIG.grenade.fuse;
    slot.live = true;
    slot.resting = false;
    slot.team = team;
    slot.by = by;
    mesh.rotation.set(
      Math.random() * 3,
      Math.random() * 3,
      Math.random() * 3,
    );
    if (kind === "molotov") {
      showMolotov(slot.bottle, true);
    } else {
      slot.mesh.isVisible = true;
      slot.pip.isVisible = true;
    }
    return true;
  }

  update(dt: number): void {
    const g = CONFIG.grenade;
    for (const n of this.grenades) {
      if (!n.live) continue;
      const bottle = n.kind === "molotov";
      const mesh = body(n);
      const radius = bottle ? CONFIG.molotov.radius : g.radius;
      n.fuse -= dt;
      if (n.fuse <= 0) {
        // A frag's fuse, or a bottle that has flown its `maxFlight` without
        // touching anything — broken where it is, which the terrain backstop
        // below makes all but unreachable.
        if (bottle) this.shatter(n, mesh.position, _normal.set(0, 1, 0));
        else this.detonate(n);
        continue;
      }
      // The tell, from the model file so that a grenade drawn off the wire
      // blinks in step with this one — see `pipLit`. A bottle has no fuse to
      // tell; its lit rag is the tell and it is always lit.
      if (!bottle) n.pip.isVisible = pipLit(n.fuse / g.fuse);
      if (n.resting) continue;

      n.vel.y -= g.gravity * dt;
      n.vel.scaleToRef(dt, _step);
      const travel = _step.length();
      if (travel > 1e-5) {
        // One ray per grenade per frame, along the step and a body's radius
        // past it, so a fast grenade cannot tunnel through a wall between two
        // frames. Same filter as every other ray that asks what is in the way.
        _dir.copyFrom(_step).scaleInPlace(1 / travel);
        if (
          this.rays?.castRound(
            mesh.position,
            _dir,
            travel + radius,
            this.hit,
          )
        ) {
          _normal.copyFrom(this.hit.normal);
          // The reported normal may point AWAY from the grenade — a collider's
          // back face, which is exactly what a grenade thrown at a wall from
          // inside a doorway finds. Bouncing off one of those drives it
          // straight through the wall it just hit.
          if (Vector3.Dot(_normal, _dir) > 0) {
            _normal.scaleInPlace(-1);
          }
          mesh.position
            .copyFrom(this.hit.point)
            .addInPlace(_normal.scale(radius));
          // A bottle does not bounce: the first thing it touches is where it
          // breaks, which is the whole difference between it and a frag.
          if (bottle) {
            this.shatter(n, mesh.position, _normal);
            continue;
          }
          this.bounce(n, _normal);
        } else {
          mesh.position.addInPlace(_step);
        }
      }

      // The floor as a backstop under the collider proxies. The terrain blocks
      // are `solid` and the ray above normally finds them, but a grenade that
      // slipped past one (a seam, a step taken from inside a face) has to end
      // up on the ground rather than falling out of the world with a live fuse.
      const floor = this.terrain.heightAt(mesh.position.x, mesh.position.z);
      if (mesh.position.y < floor + radius) {
        mesh.position.y = floor + radius;
        if (bottle) {
          this.shatter(n, mesh.position, _normal.set(0, 1, 0));
          continue;
        }
        this.bounce(n, _normal.set(0, 1, 0));
      }

      // Tumble at a rate that reads off the speed, so a rolling grenade rolls
      // and a resting one is still. A bottle turns end over end, which is the
      // one axis a cylinder shows it on.
      const speed = n.vel.length();
      if (!n.resting) {
        mesh.rotation.x += speed * dt * (bottle ? 0.9 : 2.4);
        mesh.rotation.z += speed * dt * (bottle ? 0.25 : 1.7);
      }
    }

    this.updateFires(dt);
    this.fx?.update(dt);
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
   * A bottle breaking: the flight is over and a fire starts under it.
   *
   * `at` is where it broke and `normal` the face it broke on, both the
   * caller's and read before anything here borrows a scratch vector. **The
   * fire is on the FLOOR under the break, not at it**: a bottle thrown into a
   * wall breaks at head height and the petrol runs down it, so the break point
   * is stepped off the face and a ray looks straight down for somewhere to
   * burn (`dropReach`). Nothing found there is a bottle broken over a drop —
   * the terrain answers, which is what the flight's own backstop does.
   *
   * A `predicted` client lights nothing: the bottle it drew was its own copy,
   * and the fire is the authority's (see the field).
   */
  private shatter(n: Grenade, at: Vector3, normal: Vector3): void {
    const m = CONFIG.molotov;
    n.live = false;
    showMolotov(n.bottle, false);
    if (this.predicted) return;
    _flameProbe.copyFrom(normal).scaleInPlace(m.radius * 2).addInPlace(at);
    const floor = this.floorUnder(_flameProbe, m.dropReach);
    this.ignite(floor, n.team, n.by, true);
  }

  /**
   * Where the floor is under `from`, looking at most `reach` down: the
   * colliders first, then the terrain as the backstop under them — the same
   * pair the flight lands on. Returns `_flameTop`, overwritten per call.
   */
  private floorUnder(from: Vector3, reach: number): Vector3 {
    _lifted.copyFrom(from);
    _lifted.y += PROBE_LIFT;
    const terrain = this.terrain.heightAt(from.x, from.z);
    let y = terrain;
    if (this.rays?.castRound(_lifted, _down, reach + PROBE_LIFT, this.hit)) {
      // A collider's top face above the terrain is a floor to burn on — a
      // roof, a landing, a pavement slab. One below it is a face the terrain
      // is already covering, and the terrain is what the fire stands on.
      y = Math.max(terrain, this.hit.point.y);
    }
    // Never above where the bottle broke: a ray that started inside something
    // reports its far face, and a fire lifted onto a ceiling is a fire in the
    // air.
    return _flameTop.set(from.x, Math.min(y, from.y), from.z);
  }

  /**
   * Starts a fire on the floor at `at`. `rules` is whether it BURNS anybody:
   * true for a bottle that broke in this simulation, false for one drawn off
   * the wire, whose burn is the authority's (`drawFire`).
   *
   * **The slot is claimed by AGE and never refused** — see `CONFIG.molotov
   * .fires`. The fire it takes is put out first, through `onBurntOut`, so a
   * light and a sound keyed on the old id cannot outlive it.
   */
  private ignite(at: Vector3, team: Team, by: Combatant | null, rules: boolean): void {
    let slot = this.fires[0];
    for (const f of this.fires) {
      if (f.t < 0) {
        slot = f;
        break;
      }
      if (f.t > slot.t) slot = f;
    }
    if (slot.t >= 0) this.putOut(slot);
    slot.id = ++this.nextFireId;
    slot.at.copyFrom(at);
    slot.t = 0;
    slot.team = team;
    slot.by = by;
    slot.rules = rules;
    // The first burn resolves on the first tick rather than on the frame the
    // bottle broke: whoever it landed on has the length of one tick to be
    // somewhere else, which is the flinch a whoosh of flame is.
    slot.tick = CONFIG.molotov.fire.tick;
    // Every flame on its own floor, found ONCE here: a fire on a slope or
    // across a kerb that stood every flame at the middle's height would be
    // half of it buried and half of it floating. One short ray each, at the
    // ignition and never again.
    //
    // Read off `slot.at` and never `at` from here on: the caller's vector may
    // BE `_flameTop`, which is `floorUnder`'s return and is overwritten by it.
    //
    // A flame the MIDDLE cannot see is not lit at all: petrol runs across a
    // floor and not through a wall, so a bottle broken against the outside of
    // a house burns the street and leaves the parlour behind that wall alone
    // — which is also exactly where the burn's own line of sight stops.
    const c = slot.at;
    _lifted.set(c.x, c.y + 0.3, c.z);
    for (const fl of slot.flames) {
      _flameProbe.set(c.x + fl.dx, c.y + 0.3, c.z + fl.dz);
      fl.on = !this.rays?.blocked(_lifted, _flameProbe);
      if (!fl.on) continue;
      _flameProbe.y = c.y + 1.2;
      const floor = this.floorUnder(_flameProbe, 2.4);
      fl.mesh.position.set(floor.x, floor.y, floor.z);
      // `floorUnder` borrows `_lifted` for its own ray; put the middle back.
      _lifted.set(c.x, c.y + 0.3, c.z);
    }
    this.poseFire(slot);

    const ground = this.probeGround(c);
    this.igniteFx(c);
    this.onIgnited(slot.id, c, ground);
  }

  /**
   * Draws a fire the authority lit: the flames, the ignition and everything
   * `onIgnited` hangs off it, and no burn. `drawBlast`'s twin — in a match the
   * burn arrives as a `blaze` event with nothing but a position on it.
   */
  drawFire(at: Vector3): void {
    this.ignite(at, 0, null, false);
  }

  /**
   * The ignition: the one blast's own flash and fireball at
   * `molotov.ignition` of a frag, its sparks on the same scale, and a column
   * at `molotov.smoke` — but no surge and no burning fragments, because petrol
   * going up is a whoosh and not a pressure wave. Not told what it went off
   * on: the one layer that would care is the surge.
   */
  private igniteFx(at: Vector3): void {
    const m = CONFIG.molotov;
    this.fx?.ignite(at, m.ignition, m.smoke);
  }

  /** Takes a fire away, and tells `Game` so its light and sound go with it. */
  private putOut(f: Fire): void {
    f.t = -1;
    f.by = null;
    for (const fl of f.flames) fl.mesh.isVisible = false;
    this.onBurntOut(f.id);
  }

  /** Ages every fire, resolves its burns, and poses its flames. */
  private updateFires(dt: number): void {
    const fc = CONFIG.molotov.fire;
    for (const f of this.fires) {
      if (f.t < 0) continue;
      f.t += dt;
      if (f.t >= fc.life) {
        this.putOut(f);
        continue;
      }
      this.poseFire(f);
      if (!f.rules) continue;
      // It stops hurting as it starts to die down: the fade is flames going
      // out, and a fire that was still burning people while visibly
      // guttering would be the picture lying about the rule.
      if (f.t > fc.life - fc.fade) continue;
      f.tick -= dt;
      while (f.tick <= 0) {
        f.tick += fc.tick;
        this.burn(f, fc.dps * fc.tick);
      }
    }
  }

  /**
   * One tick of a fire's burn: everybody the thrower may hurt, whose centre is
   * inside the disc and inside the band over it, and whom the flames can see.
   *
   * The target list is fetched on EVERY tick, for the blast's reason made
   * eight seconds long: the roster a fire burns among is not the one it
   * started among. A hull is skipped outright — see `CONFIG.molotov`.
   */
  private burn(f: Fire, amount: number): void {
    const fc = CONFIG.molotov.fire;
    const r2 = fc.radius * fc.radius;
    _flameTop.copyFrom(f.at);
    _flameTop.y += fc.losLift;
    for (const target of this.hittablesFor(f.team)) {
      if (target.invulnerable || target.armoured) continue;
      const c = target.center;
      const dy = c.y - f.at.y;
      if (dy < -fc.below || dy > fc.above) continue;
      const dx = c.x - f.at.x;
      const dz = c.z - f.at.z;
      if (dx * dx + dz * dz > r2) continue;
      if (!this.visible(_flameTop, c)) continue;
      const killed = target.takeDamage(amount, f.at, "fire");
      this.onBurnHit(target, f.team, f.by, killed);
    }
  }

  /**
   * The flames, at the fire's swell: grown out of the ground over `grow`,
   * held, and sunk back into it over `fade`. Scaled rather than faded — the
   * fire material is hard-banded and has no alpha to fade, and a flame that
   * shrinks is what a fire going out actually looks like.
   */
  private poseFire(f: Fire): void {
    const k = fireStrength(f.t);
    for (const fl of f.flames) {
      const s = fl.size * k;
      if (!fl.on || s < 0.02) {
        fl.mesh.isVisible = false;
        continue;
      }
      // Width grows faster than height, so a fire starting is a spreading
      // pool first and a wall of flame a moment later — the whoosh.
      fl.mesh.scaling.set(fl.size * Math.sqrt(k), s, fl.size * Math.sqrt(k));
      fl.mesh.isVisible = true;
    }
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
   * fireball, the surge, the sparks, the light and the noise — with three
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
    this.fx?.blast(at, power, ground);
    return ground;
  }

  /**
   * What the blast went off ON: one downward ray, and the terrain as a backstop
   * under it exactly as the flight has.
   *
   * `castRound` rather than `castBody`, which is the same choice the flight
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
   * the surge lies flat and the chunks fall, which is what an airburst does.
   */
  private probeGround(at: Vector3): BlastGround {
    _lifted.copyFrom(at);
    _lifted.y += PROBE_LIFT;
    if (this.rays?.castRound(_lifted, _down, PROBE_REACH, this.hit)) {
      _ground.normal.copyFrom(this.hit.normal);
      // A collider's back face points down, and a surge laid onto it is a surge
      // drawn under the floor. The flight flips a normal for the same reason.
      if (_ground.normal.y < 0) _ground.normal.scaleInPlace(-1);
      _ground.surface = this.hit.surface;
      return _ground;
    }
    _ground.normal.set(0, 1, 0);
    _ground.surface = "ground";
    return _ground;
  }

  /**
   * Fragments stop in walls. One ray per victim already inside the radius.
   *
   * Cast from the VICTIM toward the blast and stopped `LOS_SKIP` short of it,
   * which is backwards from how it reads and is the whole of why this is not
   * one line — see `LOS_SKIP`.
   */
  private visible(from: Vector3, to: Vector3): boolean {
    if (!this.rays) return true;
    from.subtractToRef(to, _los);
    const len = _los.length();
    if (len <= LOS_SKIP) return true;
    _los.scaleInPlace((len - LOS_SKIP) / len).addInPlace(to);
    return !this.rays.blocked(to, _los);
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
      showMolotov(n.bottle, false);
      // Dropped rather than left to be overwritten by the next throw: a round
      // is over, and a pooled slot holding a reference to last round's thrower
      // is the one thing in here that would outlive it.
      n.by = null;
    }
    // Through `putOut`, so every fire's light and held-open sound is taken
    // away by the same door a burn-out uses — a fire that survived a map
    // change would light and crackle over a street that no longer exists.
    for (const f of this.fires) {
      if (f.t >= 0) this.putOut(f);
    }
    this.fx?.reset();
  }
}

/** Whichever body a flight is drawn with — the one its position lives on. */
function body(n: Grenade): Mesh {
  return n.kind === "molotov" ? n.bottle.mesh : n.mesh;
}

/**
 * How far along its own swell a fire is, `t` seconds in: up out of the ground
 * over `grow` on an ease-out, held at 1, and down over `fade`. A pure function
 * of the clock, so the flames, the light and the sound all ride one curve.
 */
function fireStrength(t: number): number {
  const fc = CONFIG.molotov.fire;
  const up = Math.min(1, t / fc.grow);
  const down = Math.min(1, Math.max(0, (fc.life - t) / fc.fade));
  return (1 - (1 - up) * (1 - up)) * down;
}
