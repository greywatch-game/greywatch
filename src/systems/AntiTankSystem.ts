/**
 * AntiTankSystem.ts — The anti-tank kit in the world: rockets in flight and
 * mines on the ground.
 * Owns: the rocket pool, the mine pool, the arm clocks and the trigger test.
 * All FIXED SIZE and allocated once, the rule `CombatSystem`'s tracers and
 * `GrenadeSystem`'s pool already follow: a firefight must not allocate.
 * Owns NO blast. What a detonation is worth is `entities/equipment.ts`'s and
 * spending it is `Game`'s, because the direct hit is a `Hittable` and the
 * splash is `GrenadeSystem.blastAt` — the one implementation of an explosion
 * in this game, exactly as the tank shell uses it.
 *
 * **A rocket is the SECOND thing in this game that is not hitscan**, and it is
 * here rather than in `GrenadeSystem` because it shares nothing with a
 * grenade but the fact of flying: no fuse, no bounce, no rest, no tumble, and
 * a contact detonation instead of a clock. What the two DO share is the step
 * ray — one per rocket per frame, cast along the step and a radius past it so
 * a fast body cannot tunnel between frames, filtered `OPAQUE_ONLY` — and the
 * terrain backstop under it. Both of those are copied deliberately: they are
 * the two things about flying through this world that were got wrong first.
 *
 * **A mine is not a projectile at all.** It is a position, a clock and a
 * distance test, and it costs one comparison per live mine per frame against
 * one callback answer. Nothing about it is a collider: a hull drives THROUGH
 * the mesh and what sets it off is `hullNear`.
 *
 * Everything cross-system leaves through callbacks wired in `Game` — this
 * system imports no other system, and in particular it has never heard of a
 * `VehicleSystem`, a `Tank` or a `Player`. It asks "is there a hostile hull
 * within this many metres of this point" and is answered by whoever knows.
 */
import { Mesh, Ray, Scene, Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { Combatant, Team } from "../entities/Combatant";
import type { EquipmentId } from "../entities/equipment";
import { buildMineBody } from "../entities/MineModel";
import { buildRocket } from "../entities/RpgModel";
import type { CelMaterialFactory } from "../shaders/CelShader";
import { OPAQUE_ONLY } from "../world/solid";
import { TerrainField } from "../world/TerrainField";
import type { Hittable } from "./CombatSystem";

/**
 * How many rockets may be in the air at once, across every shooter in the
 * round.
 *
 * Small, and it can be: a player carries two and fires one every two seconds,
 * and a launcher bot's cooldown is nine. Eight is more than the whole field
 * can put up at the same instant, and the pool REFUSES rather than stealing a
 * live slot — so the one thing this number can cost is a rocket that was never
 * spent, never a rocket that vanished out of the sky.
 *
 * Exported so `net/NetOrdnance` can size its own pool to exactly this: a
 * client can never be told about a flight it has no mesh for, because the
 * authority cannot have more in the air than this holds. Two constants would
 * be two that could drift, and the failure would be a rocket that is simply
 * not drawn.
 */
export const ROCKET_POOL = 8;

/**
 * How many mines may be lying on the map at once.
 *
 * Sixteen is the roster, and a layer may only have `CONFIG.equipment.mine
 * .carried` of their own live at a time — so this is reached only if half the
 * field is laying mines and none of them has gone off, and the oldest is
 * retired rather than the newest refused. A mine that could not be laid
 * because somebody else's is somewhere on the map would be the most confusing
 * refusal in the game.
 *
 * Exported for `ROCKET_POOL`'s reason, and it binds harder here: a mine's
 * index on the wire IS its pool slot, so a client with a shorter pool would
 * silently drop the mines at the top of the list.
 */
export const MINE_POOL = 16;

/** One rocket in flight. */
interface Rocket {
  mesh: Mesh;
  /**
   * Names the FLIGHT and not the pool slot: monotonic, never reused, and -1
   * while the slot is free. It is what a netplay client keys its interpolation
   * buffer on, exactly as `Grenade.id` is — a reused id would splice two
   * rockets' samples into one buffer and draw a warhead crossing the map.
   */
  id: number;
  /** The motor, parented to the body — the tell a driver actually reads. */
  flame: Mesh;
  vel: Vector3;
  live: boolean;
  /** Seconds before it goes off on its own, having hit nothing. */
  life: number;
  /** Metres flown, against `rocket.armDistance`. */
  flown: number;
  team: Team;
  by: Combatant | null;
}

/** One mine on the ground. */
interface Mine {
  mesh: Mesh;
  /** The fuze lamp: dark while arming, lit once live. */
  lamp: Mesh;
  live: boolean;
  /** Seconds until it arms; <= 0 means it is live. */
  armT: number;
  team: Team;
  by: Combatant | null;
  /**
   * Which laying this was, so the per-owner cap can retire the OLDEST rather
   * than whichever slot happens to be first in the array. Monotonic and never
   * reused, the same reason `Grenade.id` is.
   */
  laid: number;
}

/** What went off, and on what. Handed to `Game`, which is what spends it. */
export interface OrdnanceHit {
  /**
   * Where the detonation is: the blast's centre and the light's position.
   *
   * It is the SYSTEM's own live vector — the slot's mesh position, freed on
   * the same frame — exactly as `GrenadeSystem.forEachLive`'s is. Valid for
   * the length of the handler and not one line longer; anything that keeps it
   * has to clone it, which is what `onExploded` does downstream.
   */
  at: Vector3;
  /** Which item it was, so `Game` can resolve `ordnanceEffect` off one id. */
  kind: EquipmentId;
  team: Team;
  by: Combatant | null;
  /**
   * The hull it went off ON, if it went off on one — the direct hit, which is
   * the thing a falloff cannot express. Null for everything else, including a
   * rocket that landed at a hull's feet.
   */
  hull: Hittable | null;
}

// Module-scope scratch. This runs every frame with up to eight rockets in it,
// and the pool exists so that a firefight allocates nothing.
const _step = new Vector3();
const _back = new Vector3();
const _launch = new Vector3();

export class AntiTankSystem {
  private readonly rockets: Rocket[] = [];
  private readonly mines: Mine[] = [];
  private readonly ray = new Ray(Vector3.Zero(), Vector3.Up(), 1);
  private terrain = new TerrainField();
  private nextLaid = 0;
  /** The next flight id. Monotonic for the life of the system — see `Rocket.id`. */
  private nextFlight = 0;

  /**
   * Bumped whenever the set of live mines changes: one laid, one retired, one
   * gone off, or the field cleared.
   *
   * **The mines' answer to `ScoreBook.version`**, and it exists for the same
   * reason that class has one. A mine never moves, so putting the list on
   * every snapshot would be twenty copies a second of a table that changes a
   * handful of times a round; `Match` watches this instead and re-sends the
   * whole list when it moves. Nothing offline reads it, and it costs one
   * increment on four rare paths.
   */
  version = 0;

  /**
   * Wired by `Game`: the nearest LIVE hostile hull whose centre is within
   * `radius` of `at`, or null.
   *
   * The one question this system asks about the world it is not allowed to
   * know — and it is one question rather than two because the mine's TRIGGER
   * and the rocket's DIRECT HIT are the same test at different radii. The
   * default answers "no armour anywhere", which is the right answer on the
   * three maps with none and on the server, where nothing wires this at all.
   */
  hullNear: (at: Vector3, radius: number, team: Team) => Hittable | null = () =>
    null;

  /**
   * Wired by `Game`: something went off. The direct hit, the splash, the
   * light, the sound and the camera all belong to systems this one may not
   * import, so they leave as one event.
   */
  onDetonated: (hit: OrdnanceHit) => void = () => {};

  constructor(
    private readonly scene: Scene,
    mats: CelMaterialFactory,
  ) {
    for (let i = 0; i < ROCKET_POOL; i++) {
      const { mesh, flame } = buildRocket(scene, mats, `rocket${i}`);
      this.rockets.push({
        mesh,
        flame,
        id: -1,
        vel: new Vector3(),
        live: false,
        life: 0,
        flown: 0,
        team: 0,
        by: null,
      });
    }
    for (let i = 0; i < MINE_POOL; i++) {
      const { mesh, lamp } = buildMineBody(scene, mats, `mine${i}`);
      this.mines.push({
        mesh,
        lamp,
        live: false,
        armT: 0,
        team: 0,
        by: null,
        laid: 0,
      });
    }
  }

  /**
   * The floor under the colliders, as a backstop and not as the ground test —
   * the same contract `GrenadeSystem.setTerrain` has, and it is a backstop for
   * the same reason: `heightAt` can sit a fraction under the drawn surface,
   * which is fine for catching a rocket that slipped through a seam and wrong
   * for anything that has to line up.
   */
  setTerrain(terrain: TerrainField): void {
    this.terrain = terrain;
  }

  /**
   * Puts a rocket in the air along `dir`, from `from`.
   *
   * Returns false when the pool is exhausted, and a caller that gets a false
   * must NOT spend a rocket on it — the same contract, and the same reason, as
   * `GrenadeSystem.throwAlong`: a count debited for something that never
   * arrived is the most confusing thing this could hand a player.
   */
  launch(from: Vector3, dir: Vector3, team: Team, by: Combatant | null): boolean {
    const slot = this.rockets.find((r) => !r.live);
    if (!slot) return false;
    const cfg = CONFIG.equipment.rpg.rocket;
    _launch.copyFrom(dir).normalize().scaleInPlace(cfg.speed);
    slot.mesh.position.copyFrom(from);
    slot.vel.copyFrom(_launch);
    slot.id = this.nextFlight++;
    slot.live = true;
    slot.life = cfg.life;
    slot.flown = 0;
    slot.team = team;
    slot.by = by;
    // The whole body, motor and fins included — see `buildRocket` on why this
    // is `setEnabled` and not `isVisible`.
    slot.mesh.setEnabled(true);
    this.faceFlight(slot);
    return true;
  }

  /**
   * Lays a mine at `at`, disarmed.
   *
   * Refuses only when the pool is exhausted — the per-owner cap RETIRES the
   * layer's oldest instead, because a player who has laid two and lays a third
   * has made a decision about which two are on the field, and refusing them
   * would be the game telling them to go and find their own mine first.
   */
  place(at: Vector3, team: Team, by: Combatant | null): boolean {
    const cfg = CONFIG.equipment.mine;
    if (by) {
      let live = 0;
      let oldest: Mine | null = null;
      for (const m of this.mines) {
        if (!m.live || m.by !== by) continue;
        live += 1;
        if (!oldest || m.laid < oldest.laid) oldest = m;
      }
      if (live >= cfg.carried && oldest) this.park(oldest);
    }
    const slot = this.mines.find((m) => !m.live);
    if (!slot) return false;
    slot.mesh.position.copyFrom(at);
    slot.live = true;
    slot.armT = cfg.mine.armTime;
    slot.team = team;
    slot.by = by;
    slot.laid = ++this.nextLaid;
    slot.mesh.setEnabled(true);
    this.version += 1;
    // Dark until it arms. That is the whole tell, and it is the right way
    // round: what a driver can see is a mine that would go off.
    slot.lamp.isVisible = false;
    return true;
  }

  update(dt: number): void {
    const cfg = CONFIG.equipment.rpg;
    for (const r of this.rockets) {
      if (!r.live) continue;
      r.life -= dt;
      if (r.life <= 0) {
        this.detonateRocket(r);
        continue;
      }

      // Gravity, then one ray along the step. A rocket has a motor, so this is
      // a twelfth of the grenade's fall and reads as a rocket rather than as a
      // thrown thing — see `CONFIG.equipment`.
      r.vel.y -= cfg.rocket.gravity * dt;
      r.vel.scaleToRef(dt, _step);
      const travel = _step.length();
      if (travel > 1e-5) {
        this.ray.origin.copyFrom(r.mesh.position);
        this.ray.direction.copyFrom(_step).scaleInPlace(1 / travel);
        this.ray.length = travel + cfg.rocket.radius;
        const hit = this.scene.pickWithRay(this.ray, OPAQUE_ONLY);
        if (hit?.hit && hit.pickedPoint) {
          // Backed off along the flight by a radius, so the detonation is on
          // the face rather than a hair inside it — a blast centre inside a
          // wall has the wall between it and everything it should have hurt,
          // and `blastAt`'s line-of-sight ray would answer for all of them.
          r.mesh.position
            .copyFrom(hit.pickedPoint)
            .subtractInPlace(_back.copyFrom(this.ray.direction).scaleInPlace(cfg.rocket.radius));
          r.flown += travel;
          this.detonateRocket(r);
          continue;
        }
        r.mesh.position.addInPlace(_step);
        r.flown += travel;
      }

      // The floor as a backstop under the collider proxies, exactly as the
      // grenade has one: a rocket that slipped past a seam has to go off on
      // the ground rather than fly on under the map.
      const floor = this.terrain.heightAt(r.mesh.position.x, r.mesh.position.z);
      if (r.mesh.position.y < floor + cfg.rocket.radius) {
        r.mesh.position.y = floor + cfg.rocket.radius;
        this.detonateRocket(r);
        continue;
      }

      this.faceFlight(r);
      // The motor, guttering. Driven by the distance FLOWN rather than by a
      // clock or a random: it costs one sine, it is the same flicker for the
      // same rocket however the frame rate wanders, and it is what stops a
      // solid cone of light reading as a painted-on tail.
      const flick = 0.78 + 0.22 * Math.sin(r.flown * 37);
      r.flame.scaling.set(flick, flick, 0.75 + 0.5 * flick);
    }

    const mine = CONFIG.equipment.mine;
    for (const m of this.mines) {
      if (!m.live) continue;
      if (m.armT > 0) {
        m.armT -= dt;
        if (m.armT <= 0) m.lamp.isVisible = true;
        continue;
      }
      // The trigger, and the whole of it: a hostile hull whose centre has come
      // within `contactRadius` of the plate. A body walking over it is not
      // enough pressure and is not asked about — see `CONFIG.equipment`.
      const hull = this.hullNear(m.mesh.position, mine.contactRadius, m.team);
      if (hull) this.detonateMine(m, hull);
    }
  }

  /**
   * Points a rocket along its own velocity.
   *
   * `lookAt` rather than an angle pair because the body has a roll nobody
   * cares about and two angles that would have to be kept in step: what a
   * rocket owes the picture is that the warhead is at the front, and the up
   * vector it picks for the rest is free.
   */
  private faceFlight(r: Rocket): void {
    _launch.copyFrom(r.mesh.position).addInPlace(r.vel);
    r.mesh.lookAt(_launch);
  }

  private detonateRocket(r: Rocket): void {
    r.live = false;
    r.id = -1;
    r.mesh.setEnabled(false);
    // A rocket that has not flown far enough to arm is a dud: it stops, and
    // nothing happens. The warhead is live at three metres, which is past the
    // doorframe the shooter is standing in and well inside anything they were
    // aiming at.
    if (r.flown < CONFIG.equipment.rpg.rocket.armDistance) return;
    this.onDetonated({
      at: r.mesh.position,
      kind: "rpg",
      team: r.team,
      by: r.by,
      hull: this.hullNear(
        r.mesh.position,
        CONFIG.equipment.rpg.contactRadius,
        r.team,
      ),
    });
  }

  private detonateMine(m: Mine, hull: Hittable): void {
    const at = m.mesh.position;
    this.park(m);
    this.onDetonated({ at, kind: "mine", team: m.team, by: m.by, hull });
  }

  /** Frees a slot and takes its meshes off the screen. */
  private park(m: Mine): void {
    // Only a slot that was actually live is a change worth telling anybody
    // about: `reset` walks the whole pool, and bumping sixteen times for the
    // fifteen slots that were already free would re-send the list on every
    // map install for nothing.
    if (m.live) this.version += 1;
    m.live = false;
    m.by = null;
    m.mesh.setEnabled(false);
    m.lamp.isVisible = false;
  }

  /**
   * Everything in the air and everything on the ground, gone.
   *
   * Called by `installMap` beside `grenades.reset()` and for the same reason:
   * a rocket whose flight outlived the map it was fired across would go off
   * over terrain that no longer exists, and a mine would be waiting under a
   * street that is not there.
   */
  reset(): void {
    for (const r of this.rockets) {
      r.live = false;
      r.id = -1;
      r.by = null;
      r.mesh.setEnabled(false);
    }
    for (const m of this.mines) this.park(m);
  }

  /**
   * Every rocket in the air, for the authority to put on the wire.
   *
   * `GrenadeSystem.forEachLive`'s shape and its contract to the letter: both
   * vectors are the SLOT's own and are valid for the length of the call, so a
   * caller that keeps either has to copy it. Nothing offline calls this.
   */
  forEachRocket(
    fn: (id: number, at: Vector3, vel: Vector3, by: Combatant | null) => void,
  ): void {
    for (const r of this.rockets) {
      if (r.live) fn(r.id, r.mesh.position, r.vel, r.by);
    }
  }

  /**
   * Every mine on the ground, for the same reason and under the same rule
   * about the vector. The INDEX is the pool slot rather than a monotonic id —
   * unlike a rocket, a mine is re-stated whole every time the set changes, so
   * nothing on the far side is keying a buffer on it.
   */
  forEachMine(
    fn: (
      index: number,
      at: Vector3,
      team: Team,
      armed: boolean,
      by: Combatant | null,
    ) => void,
  ): void {
    for (const [i, m] of this.mines.entries()) {
      if (m.live) fn(i, m.mesh.position, m.team, m.armT <= 0, m.by);
    }
  }

  /**
   * Every mine this owner has live, for the HUD's count.
   *
   * A player wants to know how many of theirs are out there, because the cap
   * means laying a third moves one — and the count in the hands is what they
   * have LEFT, which is a different number.
   */
  minesFor(by: Combatant): number {
    let n = 0;
    for (const m of this.mines) if (m.live && m.by === by) n += 1;
    return n;
  }
}
