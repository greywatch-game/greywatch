/**
 * VehicleSystem.ts — The vehicles on the field: one hull per hardstanding, of
 * whatever KIND that hardstanding names, the
 * clock that puts a fresh one there after the last burned, and the geometry
 * questions a driver getting in and out asks.
 * Owns: the `Vehicle` pool (built once per map install, never disposed inside a
 * round), the per-hardstanding respawn timers, and the wreck clock.
 * Owns NO player: nothing in here knows what a player is. `Game` decides who is
 * driving and hands the drive in, exactly as it hands `BattleSystem` a
 * `BattleCtx` rather than letting it reach for one.
 *
 * ## A hull is not in the nav graph, and that is the ragdoll's rule not a bug
 *
 * `NavGrid`, `CoverMap`, `ObstacleField`, the AO bake and the collision bake are
 * all built ONCE from the finished collider set at map load. A tank moves, so it
 * cannot be in any of them, and the consequence is stated rather than hidden:
 * **bots walk through a parked tank**, exactly as they walk through a corpse and
 * for the identical reason. What a tank IS to a bot is a target — `Game` puts
 * every live hull in `BattleSystem`'s non-bot combatant list — and a wall its
 * rounds and its sightlines stop on, because the hull's collider is `solid`.
 *
 * ## Three states and two clocks
 *
 * A hardstanding's hull is LIVE, a WRECK, or GONE, and the two clocks are
 * deliberately not one:
 *
 * - `Vehicle.wreckT` — how long the burnt-out hull stands where it died. It keeps
 *   its collider for all of it, so a wreck is cover. That is the whole reason
 *   destruction does not simply hide the mesh.
 * - `respawnIn` — how long until a fresh hull is on the hardstanding. It starts
 *   at the same instant and runs longer, which is what guarantees a side never
 *   fields two.
 *
 * ## What is refused, and what is not
 *
 * A respawn is never refused. A hardstanding is in `MapBuilder.keepClear`, so
 * nothing is ever built on one, and the only thing that could be standing there
 * is a body — which is a case that resolves itself: the hull arrives, the body
 * is inside its collider, and `moveWithCollisions` pushes them out on their next
 * frame. Refusing instead would mean a side losing its armour for the rest of
 * the round because a bot was loitering, which is a far worse failure than a
 * shove.
 */
import { type Scene, Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { Team } from "../entities/Combatant";
import {
  DRIVER,
  GUNNER,
  Vehicle,
  type CrewSeat,
  type DriveInput,
  type GunAngles,
  type GunInput,
} from "../entities/Vehicle";
import { kindOf } from "../entities/vehicleKinds";
import type { CelMaterialFactory } from "../shaders/CelShader";
import type { GameMap, VehicleSpawnDef } from "../world/MapBuilder";
import { newRayHit, type RayWorld } from "../world/RayWorld";

/**
 * Who is telling which hull what to do, asked once per hull per frame.
 *
 * `Game` is the only implementer and holds one across the whole round: it is
 * the only place that knows both about the player's seat and about the bot
 * crews, and neither of those belongs in here — nothing in this file has heard
 * of a player or of an AI.
 */
export interface VehicleOrders {
  /** What is in this hull asking for, or null when it is empty. */
  driveFor(tank: Vehicle): DriveInput | null;
  /**
   * What the SECOND crewman is asking the cupola gun for, or null when nobody
   * is on it.
   *
   * A question of its own rather than a field on the answer above, because the
   * two seats can be filled by two different kinds of thing at once: the
   * player driving with a bot on the gun, a bot driving with the player on the
   * gun, or either seat empty while the other is not. Every one of those is
   * ordinary and none of them is representable through one lookup.
   */
  gunFor(tank: Vehicle): GunInput | null;
  /**
   * The state that arrived for this hull from somewhere else this frame, or
   * null for one this process is simulating.
   *
   * The netplay half, and it is a second question rather than a mode on the
   * first because the two answers are different KINDS: a `DriveInput` is what
   * a hull is being asked to do and this is where it ended up. On a client
   * every hull but the one the player is sitting in answers here; on the
   * authority, only the hulls with a person driving them do — a bot crew's is
   * simulated on the server exactly as it is offline.
   *
   * Optional so the offline round, which is every round that has no wire,
   * states nothing at all.
   */
  remoteFor?(tank: Vehicle): RemoteHull | null;
  /**
   * Where a machine gun somebody ELSE is laying has got to, or null for one
   * this process is laying itself.
   *
   * `remoteFor`'s counterpart for the second seat, and it is a SECOND question
   * because the two seats' answers are independent: a client whose player is
   * driving simulates its own hull off `driveFor` and still has to be told
   * where the bot gunner beside it has pointed the cupola gun, and a client
   * whose player is the GUNNER poses the hull from the wire while laying that
   * one gun itself.
   */
  remoteGunFor?(tank: Vehicle): GunAngles | null;
}

/**
 * Where a hull somebody else is driving has got to. `Vehicle.updateRemote`'s
 * arguments, as one object so the lookup above allocates nothing.
 */
export interface RemoteHull {
  x: number;
  y: number;
  z: number;
  yaw: number;
  turretYaw: number;
  gunPitch: number;
}

/** One team's parking space, and whatever is standing on it. */
interface Hardstanding {
  def: VehicleSpawnDef;
  tank: Vehicle;
  /** Seconds until a fresh hull arrives; <= 0 while one is already here. */
  respawnIn: number;
}

export class VehicleSystem {
  private stands: Hardstanding[] = [];
  /**
   * The same hulls as a flat list, held rather than derived. `Game` folds this
   * into the combatant list every frame, and a getter that built an array would
   * be an allocation per frame on the one path that runs on every frame of
   * every round.
   */
  private readonly fleet: Vehicle[] = [];

  /**
   * Wired by `Game`: this hull is gone. Raised on the frame it is destroyed,
   * before anything else happens to it, because the one thing that cannot wait
   * is getting whoever is inside out of it.
   */
  onDestroyed: (tank: Vehicle) => void = () => {};

  /**
   * Wired by `Game`: a fresh hull has arrived on a hardstanding. The minimap
   * and the toast are `Game`'s to draw; this system knows only that the clock
   * ran out.
   */
  onRespawned: (tank: Vehicle) => void = () => {};

  /**
   * The solid world as a segment query, and the buffer the dismount's floor
   * test reads. Held from `build` rather than pushed in separately, because
   * this system is handed the whole map already and the fleet's hulls go INTO
   * it on the same call.
   */
  private rays: RayWorld | null = null;
  private readonly hit = newRayHit();
  private readonly down = new Vector3(0, -1, 0);
  /**
   * The dismount probe's origin. A scratch of its own and NOT `spot`, which is
   * the answer `dismountSpot` is building up across two candidates — writing
   * the probe into it would clobber the better side with the worse one's
   * origin whenever the second candidate lost.
   */
  private readonly probeFrom = new Vector3();
  private readonly spot = new Vector3();

  constructor(
    private scene: Scene,
    private mats: CelMaterialFactory,
  ) {}

  /** Every hull on the field, live or wrecked. Empty on a map with no armour. */
  get hulls(): readonly Vehicle[] {
    return this.fleet;
  }

  /**
   * The highest deck a body standing at `(x, z)` would be on, or null. The
   * fleet's answer to `ObstacleField.groundAt`, in the same band and with the
   * same meaning, and the two are meant to be read together: that one is the
   * STATIC world and this one is the part of the world that drives away.
   *
   * `Game` hands this to `Player.probeGround` — see `Vehicle.deckAt`, which
   * carries why a hull needs a door of its own at all. A loop and not an index:
   * the fleet is two hulls on the two maps with one hardstanding a side and
   * four on Sarab, and a spatial structure over four boxes would cost more to
   * keep current than to skip.
   *
   * Highest rather than first, because hulls can be parked on each other —
   * a tank drives over things, and one that has ridden up onto another is a
   * position the plank makes reachable.
   */
  deckAt(x: number, z: number, ceiling: number, floor: number): number | null {
    let best: number | null = null;
    for (const tank of this.fleet) {
      const top = tank.deckAt(x, z, ceiling, floor);
      if (top !== null && (best === null || top > best)) best = top;
    }
    return best;
  }

  /** True on the three shipped maps that state no hardstandings. */
  get empty(): boolean {
    return this.stands.length === 0;
  }

  /**
   * Builds the fleet for a freshly installed map.
   *
   * Disposes the last one outright rather than pooling across maps: the rigs
   * are painted per TEAM and a map states which team owns which hardstanding,
   * so a pool carried over would have to be re-painted anyway — and this runs
   * once per round, next to a map build that takes the better part of a second.
   * Inside a round nothing here is ever disposed; see `Vehicle.placeAt`.
   *
   * There is deliberately no `reset()` beside `BattleSystem`'s and
   * `RagdollSystem`'s. A round always starts with a fresh `installMap`, and
   * this runs from inside it — so a second entry point that put the same hulls
   * back would be a method nothing called, kept alive by the symmetry of the
   * list it sat in.
   */
  build(map: GameMap, predicted = false): void {
    this.dispose();
    this.predicted = predicted;
    // **The hulls go into the segment query here and come out in `dispose`.**
    // A tank is in no baked structure — that is the ragdoll's rule and a hull
    // is an instance of it — so the one place that knows the fleet is the one
    // place that can tell every ray in the game there is armour on the field.
    this.rays = map.rays;
    for (const def of map.vehicleSpawns) {
      // **The one place a KIND becomes a hull**, and the whole of what a second
      // kind costs this system: a `VehicleSpawnDef` names one, `kindOf` hands
      // back the numbers and the model, and nothing below this line — nor
      // anywhere else in the file — asks what it is holding.
      const tank = new Vehicle(this.scene, this.mats, def.team, kindOf(def.kind));
      tank.setGround(map.terrain, map.obstacles);
      tank.onDestroyed = () => this.onDestroyed(tank);
      tank.placeAt(def.pos, def.yaw);
      // A hull in a match refuses local damage and answers to the wire for
      // when it burns and when a fresh one arrives — see `Vehicle.predicted` and
      // the clocks in `update`. Set here rather than by the caller so a fleet
      // is all one thing: a mixture would be a round in which some armour was
      // authoritative and some was not.
      tank.predicted = predicted;
      this.stands.push({ def, tank, respawnIn: 0 });
      this.fleet.push(tank);
      map.rays.hulls.push(tank);
    }
  }

  /**
   * True when this fleet is drawn from the wire rather than simulated here.
   *
   * Read by `update` to leave both hardstanding clocks alone: in a match the
   * authority decides when a wreck is taken away and when a fresh hull stands
   * on the pad, and a client running its own copy of either would take a hull
   * off the street the server still holds there — with its collider, which is
   * the difference between a picture disagreeing and a round disagreeing.
   */
  private predicted = false;

  /**
   * One frame of every hull on the field.
   *
   * `orders` is asked once per hull: what is the thing inside this one telling
   * it to do, or null when nobody is. Null is not the same as a centred stick
   * — see `Vehicle.update`.
   *
   * It is a lookup rather than "the one driven hull and its input" because
   * there is no longer one driver. A map with two hardstandings can have the
   * player in one and a bot crew in the other, or a crew in both, and a
   * signature that named a single hull made that unrepresentable. `Game` owns
   * the object and holds it across frames, so asking costs no allocation.
   */
  update(dt: number, orders: VehicleOrders): void {
    for (const stand of this.stands) {
      const tank = stand.tank;
      // Asked FIRST, for the reason `Game.vehicleOrders` asks the player's own
      // hull before the crews: a hull whose state arrived from elsewhere is
      // not one this process may simulate, whatever else might have an opinion
      // about what it should be doing.
      const remote = orders.remoteFor?.(tank) ?? null;
      if (remote) {
        tank.updateRemote(
          dt,
          remote.x,
          remote.y,
          remote.z,
          remote.yaw,
          remote.turretYaw,
          remote.gunPitch,
        );
      } else {
        tank.update(dt, orders.driveFor(tank));
      }
      // The cupola gun, AFTER the hull, and asked as its own question of its
      // own owner — see `Vehicle.aimMg`. After, because the ring it turns on is
      // bolted to a turret this frame may just have traversed, and a gun laid
      // against last frame's turret is a gun drawn at the wrong local angle.
      const mgAt = orders.remoteGunFor?.(tank) ?? null;
      if (mgAt) tank.setMg(dt, mgAt.yaw, mgAt.pitch);
      else tank.aimMg(dt, orders.gunFor(tank));
      if (tank.alive) continue;
      // Both clocks below are the AUTHORITY's in a match — see `predicted`.
      if (this.predicted) continue;
      // The wreck's own clock has run out: take the hull away. Its collider
      // goes with it, which is the moment the street opens up again.
      if (tank.wreckT <= 0 && tank.body.isEnabled()) tank.hide();
      // The hardstanding's clock is separate and starts on the same frame the
      // hull died. Armed here rather than in `Vehicle.destroy` so that the tank
      // never has to know what a hardstanding is.
      if (stand.respawnIn <= 0) {
        stand.respawnIn = CONFIG.vehicles.respawnDelay;
        continue;
      }
      stand.respawnIn -= dt;
      if (stand.respawnIn > 0) continue;
      stand.respawnIn = 0;
      tank.placeAt(stand.def.pos, stand.def.yaw);
      this.onRespawned(tank);
    }
  }

  /**
   * How long until `team` has a vehicle back on a pad, or null while it
   * already has one on the field.
   */
  respawnFor(team: Team): number | null {
    // The SOONEST of them, and null the moment any one of this side's
    // hardstandings has something standing on it. A side can hold more than one
    // now — Sarab states a tank and a truck apiece — so "the first entry for
    // this team" is an answer about one pad rather than about the team.
    let best: number | null = null;
    for (const stand of this.stands) {
      if (stand.def.team !== team) continue;
      if (stand.tank.alive) return null;
      const left = Math.max(0, stand.respawnIn);
      if (best === null || left < best) best = left;
    }
    return best;
  }

  /**
   * The nearest hull of `team` a body standing at `at` could get into: live,
   * with a SEAT still free, and inside `enterRadius` of its centre.
   *
   * "Free" is either seat — `seatOn` is what decides which one a boarder
   * takes, and the driver's is taken first.
   *
   * Team-locked on purpose. Stealing the other side's armour is a real design
   * choice and a good one in some shooters, but it is a choice — and made by
   * accident here it would mean a hardstanding's respawn timer feeding the
   * wrong team for the rest of the round.
   */
  /**
   * Takes or gives up a seat. The ONE writer of `Vehicle.occupied`, and it is here
   * rather than derived inside `update` for a reason that has already been a
   * bug: derived, the flag is only true from the next frame's world step, so
   * `enterable` would offer a hull somebody is already sitting in for the rest
   * of the frame they got into it. Written on the transition, it is never
   * wrong for an instant.
   */
  setOccupied(tank: Vehicle, seat: CrewSeat, on: boolean): void {
    tank.seats[seat] = on;
  }

  /**
   * The nearest hull of `team` this body could get INTO, and which seat it
   * would take — the driver's if it is free, the gunner's otherwise.
   *
   * **The seat is decided here rather than by the caller**, which is what makes
   * "first in drives" a fact about the fleet rather than a convention two
   * callers have to agree on: `Game` asks this offline and `HeadlessGame` asks
   * it on the authority, and a rule stated in both is a rule that can drift.
   * Returns -1 for a hull that is full or out of reach, so a caller reads one
   * number and needs no second question.
   */
  seatOn(tank: Vehicle, at: Vector3, team: Team): CrewSeat | -1 {
    const r = CONFIG.vehicles.enterRadius;
    if (!tank.alive || tank.team !== team) return -1;
    if (Vector3.DistanceSquared(at, tank.center) > r * r) return -1;
    if (!tank.seats[DRIVER]) return DRIVER;
    if (!tank.seats[GUNNER]) return GUNNER;
    return -1;
  }

  enterable(at: Vector3, team: Team): Vehicle | null {
    return this.nearestOwn(at, team, false);
  }

  /**
   * The nearest hull of `team` within reach of `at` whose BOTH seats are
   * taken. `enterable`'s mirror, and it exists for exactly one caller: the
   * player walking up to their own side's armour with a full bot crew in it.
   *
   * A hull with one bot in it is `enterable`, not this — the player gets in
   * beside him and nobody is turned out. Eviction is the last resort rather
   * than the greeting, which is the version that costs the AI the least.
   *
   * **A hull the AI is using must never be a hull the player cannot have.** A
   * map states one hardstanding per side per KIND, so a crew that held its seat
   * for the life of the vehicle would make whether the player ever drives a
   * coin toss on who reached the yard first. `Game` answers this with an eviction rather
   * than by keeping the bots out of the tank, which is the version that costs
   * the feature nothing: armour is something the AI uses while nobody else
   * wants it.
   *
   * Still team-locked, for `enterable`'s reason: this offers a seat, and the
   * side's own hull is the only seat it may offer.
   */
  occupiedNear(at: Vector3, team: Team): Vehicle | null {
    return this.nearestOwn(at, team, true);
  }

  /**
   * The pair above, which differ by one term.
   *
   * **`full` and not `occupied`, and the difference is the second seat.** A
   * hull with one crewman in it is still a hull somebody may get into, so
   * `enterable` asks for one with a seat left rather than one with nobody
   * aboard; only a hull with BOTH seats taken is a hull that has to be evicted
   * to be joined.
   */
  private nearestOwn(at: Vector3, team: Team, full: boolean): Vehicle | null {
    const r = CONFIG.vehicles.enterRadius;
    let best: Vehicle | null = null;
    let bestDist = r * r;
    for (const stand of this.stands) {
      const tank = stand.tank;
      const taken = tank.seats[DRIVER] && tank.seats[GUNNER];
      if (!tank.alive || taken !== full || tank.team !== team) continue;
      const d = Vector3.DistanceSquared(at, tank.center);
      if (d < bestDist) {
        bestDist = d;
        best = tank;
      }
    }
    return best;
  }

  /**
   * The nearest LIVE hull of the OTHER side whose centre is within `radius` of
   * `at`, or null. What `AntiTankSystem` asks, for both of the questions it
   * has: a mine's trigger and a rocket's direct hit.
   *
   * **Hostile by construction rather than by a check at the call site**, the
   * same bargain `CombatSystem.fire` makes with its target list: `team` is the
   * team the ordnance BELONGS to, so a mine cannot catch its own side's armour
   * and a rocket cannot claim a direct hit on it. That is the only place
   * friendly fire is excluded on this path, and it has to be here, because
   * `AntiTankSystem` has never heard of a team beyond passing one back out.
   *
   * A WRECK is not a hull. `alive` is what the AT kit is for, and a mine that
   * kept going off under a burnt-out chassis would spend a player's whole
   * pouch on a thing that is already dead.
   */
  hostileNear(at: Vector3, radius: number, team: Team): Vehicle | null {
    let best: Vehicle | null = null;
    let bestDist = radius * radius;
    for (const stand of this.stands) {
      const tank = stand.tank;
      if (!tank.alive || tank.team === team) continue;
      const d = Vector3.DistanceSquared(at, tank.center);
      if (d < bestDist) {
        bestDist = d;
        best = tank;
      }
    }
    return best;
  }

  /**
   * Where to put a body stepping out of `tank`: beside the hull, on whatever
   * the ground there is.
   *
   * Both flanks are tried and the one whose floor is nearest the tank's own is
   * taken, which is what stops a dismount onto the roof of the building the
   * tank is parked against — or into the stairwell it is parked over. Neither
   * being sensible is not a failure worth refusing over: the fallback is the
   * hull's own position, and `moveWithCollisions` pushes the body clear on its
   * next frame exactly as it does for a respawned hull.
   *
   * The result is scratch and must be consumed inside the call, which the one
   * caller does.
   */
  exitSpot(tank: Vehicle): Vector3 {
    const off = CONFIG.vehicles.exitOffset;
    // The hull's own right, which is `(cos(yaw), 0, -sin(yaw))` — the same
    // basis `CameraSystem.flatRightToRef` builds.
    const rx = Math.cos(tank.yaw);
    const rz = -Math.sin(tank.yaw);
    let bestY: number | null = null;
    for (const side of [1, -1]) {
      const x = tank.center.x + rx * off * side;
      const z = tank.center.z + rz * off * side;
      const y = this.groundAt(x, z, tank);
      if (y === null) continue;
      if (bestY === null || Math.abs(y - tank.position.y) < Math.abs(bestY - tank.position.y)) {
        bestY = y;
        this.spot.set(x, y, z);
      }
    }
    if (bestY === null) this.spot.copyFrom(tank.position);
    return this.spot;
  }

  /**
   * The floor at a point, for the dismount alone. A pick per candidate, twice,
   * on a one-off event — which is why this may cast the game's most expensive
   * ray at all: nothing here runs per frame.
   */
  private groundAt(x: number, z: number, tank: Vehicle): number | null {
    const t = tank.spec;
    if (!this.rays) return null;
    this.probeFrom.set(x, tank.center.y + t.hull.height, z);
    // Out of its own answer — the hull the body is climbing out of is not the
    // floor it is climbing out ONTO — which is `skip`, and was two writes to
    // `isPickable` around a `scene.pickWithRay`.
    const found = this.rays.castBody(
      this.probeFrom,
      this.down,
      t.hull.height * 2 + t.drive.probeLength,
      this.hit,
      tank,
    );
    return found ? this.hit.point.y : null;
  }

  dispose(): void {
    for (const stand of this.stands) stand.tank.dispose();
    this.stands = [];
    // Out of the segment query as well as off the field. `build` installs a
    // fresh map's own `RayWorld` a line later, so this only matters for the
    // editor's teardown — which disposes the fleet and builds none — but a
    // disposed hull left in a live list is exactly the stale pointer the
    // vehicle wiring in `installMap` is ordered to prevent.
    if (this.rays) {
      for (const tank of this.fleet) {
        const at = this.rays.hulls.indexOf(tank);
        if (at >= 0) this.rays.hulls.splice(at, 1);
      }
    }
    this.rays = null;
    this.fleet.length = 0;
  }
}
