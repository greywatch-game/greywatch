/**
 * Vehicle.ts — One vehicle: what it is made of physically, how it drives, where
 * its gun points, and what it feels of a round.
 * Owns: the hull's collider mesh, the `VehicleRig` hanging off it, the drive
 * state, the turret and gun angles, the CUPOLA gun's own two angles, both
 * weapons' clocks, which of its two seats are filled, and the health.
 * Owns NO rules about who is in it, when it respawns or what its shell does
 * when it lands — those are `VehicleSystem`'s and `Game`'s respectively, the
 * same split `Bot` has against `BattleSystem`.
 *
 * ## TWO guns, two owners, and one world frame between them
 *
 * A hull holds two crewmen (`Vehicle.seats`, `DRIVER` and `GUNNER`) and each lays
 * a weapon of his own: the driver traverses the turret and fires the shell,
 * the gunner turns the commander's machine gun on its cupola ring. **The two
 * are independent and the independence is bought by one decision** — every
 * angle on this vehicle is held in the WORLD, and only the drawing is
 * relative. `turretYaw` is world, so turning the hull under a laid gun does
 * not drag it; `mgYaw` is world for exactly the same reason one node further
 * out, so traversing the TURRET under a laid machine gun does not drag that
 * either. `aimMg` writes both differences onto the rig and nothing else in the
 * game ever sees a local angle.
 *
 * The machine gun is stepped by `VehicleSystem` through `aimMg`/`setMg` rather
 * than inside `update`, because its owner and the hull's need not be the same
 * kind of thing — a person can drive a hull off the wire while a bot lays its
 * cupola gun on the authority. See `aimMg`.
 *
 * ## The one solid mesh in the game that MapBuilder did not make
 *
 * Every other `metadata.solid` mesh is a collider proxy from `MapBuilder`, and
 * the rule in `CLAUDE.md` is that geometry added by any other path is invisible
 * to navigation. A hull is that geometry, deliberately, and it is the RAGDOLL
 * precedent rather than an exception to the world layer's:
 *
 * - It is `solid`, so it is in both pick predicates. A round stops on it, a
 *   sightline breaks on it, the ground probe finds it, and a player can climb
 *   onto the deck. That is the whole of what a tank is to anything holding a
 *   rifle.
 * - It has `checkCollisions`, so `moveWithCollisions` — the player's, and the
 *   other tank's — is held out of it.
 * - It emits NO `WorldBox`, so the nav graph, the cover bake, the obstacle
 *   field, the AO bake and the collision bake have never heard of it. Bots walk
 *   through a parked tank exactly as they walk through a corpse, and for the
 *   identical reason: those structures are baked once from a static world, and
 *   a thing that moves cannot be in them. See `docs/vehicles.md`.
 *
 * ## The collision sphere is on an ARM, so the hull is pushed out of walls
 *
 * `moveWithCollisions` sweeps a TRANSLATION and nothing else, and this vehicle
 * moves its own collider two other ways. The sphere rides `hull.length / 2 -
 * collideRadius` — 1.4 m — off the hull's centre (`aimCollider`), so the YAW
 * carries it round on that arm at up to `turnRate * 1.4`, through whatever the
 * tank is parked beside, untested; and the offset is a world vector, so a hull
 * that pivoted while stopped used to bank the whole swing and spend it in one
 * frame the moment the throttle was touched — measured at 2.37 m.
 *
 * Neither can be collided (the hull's rotation never has been), and Babylon
 * cannot leave a sphere that is inside a box: it ejects one by 0.022 m of world
 * a frame at this radius, which a drive pushing back in beats trivially. That
 * is a tank that stops and cannot start, and the only thing that used to free
 * it was FIRING — `fireGun` writes a velocity straight into `speed`.
 *
 * So `aimCollider` runs on a turn as well as on a move, and `freeFromWalls`
 * ejects the hull at `drive.freeRate` off `ObstacleField.resolve`. See that
 * method, and `docs/vehicles.md`.
 *
 * ## ...and it may not ask the engine for less than a millimetre
 *
 * `moveWithCollisions` writes the position back only when the move exceeds
 * `CollisionsEpsilon`, and returns the mesh where it was otherwise. From rest
 * the first frame asks for `accel * dt^2` — a third of a millimetre at 120 fps
 * — so the hull did not move, the blocked check called that walked-into-
 * something, and `s = 0.35 * (s + accel * dt)` pinned the drive at 0.021 m/s
 * with the throttle wide open on open ground. So the gate on the move is the
 * DISTANCE the frame asks for and never the speed. See `update`.
 *
 * ## A hull stands on its TRACKS, and it casts no ray to do it
 *
 * `standOnGround` samples the world under ten track contacts — five along each
 * belt — and rests the hull on the plank they hold up. That is the whole of
 * what makes a tank drive over things rather than into them, and the two
 * halves of it are worth stating separately:
 *
 * - **A belt rather than a point.** A single sample at the hull's centre
 *   cannot see an obstacle until the middle of the tank is standing on it, so
 *   a car went unnoticed until it was under the turret and the hull then
 *   teleported onto its roof. A contact at the nose meets the car when the
 *   NOSE does, and the resting plane it asks for is a hull tipped up over it.
 *   How many there are is its own decision — see `CONTACT_ROWS`.
 * - **A rate limit rather than a snap.** A contact crossing the edge of a car
 *   steps a metre between two frames. `drive.climbSlope` bounds the rise by
 *   the distance the hull has actually travelled, which turns that step into a
 *   slope the tank drives up and is the physically honest limit — nothing may
 *   climb faster than the steepest grade it can hold.
 * - **Gravity asked first, and asked whatever the hull is doing.** Where the
 *   hull would be with nothing under it is what decides whether there IS
 *   anything under it: a plank dropping away slower than gravity is still
 *   ground and the hull rides it down, and one dropping away faster is a hull
 *   that has driven off something. A height test on the plank alone fell,
 *   landed and zeroed the velocity every frame, which chattered a tenth of a
 *   metre down every slope on the map — and each of those landings is an
 *   impact the springs would now answer to.
 *
 * **It is answered analytically, off `ObstacleField.groundAt`, and that is a
 * budget decision as much as a design one.** The old single probe was
 * `scene.pickWithRay` with a `solid` predicate — the same call that used to make
 * `Player.probeGround` the most expensive thing the game did per frame, because
 * Babylon walks every mesh in the scene to answer it. Six of those is not a
 * thing that can be afforded; six bucket lookups over the collider boxes are
 * free by comparison, and `FINDINGS.md` had already measured the two against
 * each other and named a VEHICLE as the query's better first customer. The one
 * failure it was known to have — a thin box pitched a few degrees claiming
 * ground beside itself — stood a BODY on air and merely rocked a seven-metre
 * hull that is riding a rate limit anyway. **That failure is fixed and the body
 * has followed the hull** (`boxGeometry`'s `topFaceHalfDepth`), which changes
 * nothing here and is why: a tank was always the case this query got right.
 *
 * The terrain is the other half of the answer and not a fallback: the
 * heightfield has no collider box standing in for it (`CLAUDE.md`'s one
 * documented exception), so every contact takes the higher of the boxes and
 * `TerrainField.surfaceAt`.
 *
 * **The chase camera still casts, and it still has to take its own hull out of
 * the answer first** — see `VehicleCamera.pullIn`, which is the only such query
 * a driver pays. It passes the hull as `RayWorld`'s `skip` now rather than
 * clearing `isPickable` around a `scene.pickWithRay`; the flag is still read,
 * by `rayBox`, and still for that reason.
 *
 * ## What is a rule and what is a picture
 *
 * `yaw`, the collider box and `center` are rules. The hull's PITCH and ROLL are
 * a picture: they lean the drawn vehicle onto the ground it stands on and the
 * collider never tilts with them, so nothing that shoots, aims or walks can
 * disagree with what it sees by more than the lean. `turretYaw` is a WORLD
 * angle rather than one relative to the hull, because everything that reads it
 * — the gun's direction, the marker on the HUD, the shell — wants it in the
 * world, and only the drawn node wants the difference.
 *
 * **That picture is TWO pictures added, and they answer to different things.**
 * The ground half is where the slope under the tracks puts the hull, lerped
 * toward a fact that cannot overshoot. The suspension half is what the hull's
 * own mass does to it — the dive under the brake, the squat under power, the
 * lean out of a turn and the rock of the gun — and it is a spring driven by an
 * ACCELERATION, so it must overshoot or it is not a spring.
 *
 * **They are drawn on two different NODES and that is not a detail.** The
 * ground half goes on `rig.hull`, which the RUNNING GEAR hangs off, because a
 * vehicle standing on a slope stands on it tracks and all. The suspension half
 * goes on `rig.sprung`, which the running gear does NOT hang off, because a
 * body diving under the brake is a body moving against tracks that stay where
 * the ground put them — that is what a suspension IS, and summing the two onto
 * the hull node instead drove the leading end of the vehicle under the road it
 * had just been stood on.
 *
 * **There is a THIRD, it is a distance rather than an angle, and it shares the
 * other two's budget.** `flexHeave` moves `rig.sprung` in Y, so a landing
 * compresses onto the bump stop and a hull going light over a crest lifts off
 * its own tracks. It answers to what the GROUND did to the hull's vertical
 * motion and to nothing the driver asked for, which is why the other two had
 * nothing to say about driving over a car. And because all three move the same
 * body against the same running gear, **how far it may travel is stated ONCE**
 * — `heaveBump`/`heaveDroop`, at the road wheel — and the tilt spends what the
 * heave has left. There is no authored limit on either angle.
 *
 * Both are free to be pictures for the same reason: the gun is aimed in world
 * angles off `turretYaw`/`gunPitch` and the shell is fired down that, so a
 * hull leaning under the turret cannot carry the gun off the aim — which is
 * the whole of why the reticle can still not lie.
 *
 * `trackRun` is the other picture, and the one that is DERIVED rather than
 * decided: the drive is still one speed and one yaw rate, and the two track
 * speeds are read off them by the gauge. Nothing in the game may key off it —
 * a track that has run further than the hull has moved is a slipping track and
 * not a faster tank.
 *
 * ## The antennae, and why there is no physics engine in them
 *
 * The two whips are the third picture and the furthest out: they answer to the
 * acceleration the drive achieved (the suspension's own input), to how fast the
 * hull node they hang off is TURNING, and to the wind. That is two damped
 * springs a mast — `flexAntennae` — and it is deliberately not Havok. The
 * engine in this tree is stepped by hand for corpses and glass shards, things
 * nothing reads back and nothing steers; a hull is moved by
 * `moveWithCollisions` and ridden up over a kerb by `standOnGround`,
 * which is a teleport to a solver, and a jointed chain hung off it would crack
 * every time a tank climbed a kerb. What is bought instead is a whip that is
 * clamped, tunable and free. See `docs/vehicles.md`.
 */
import { AbstractEngine, Mesh, MeshBuilder, Scene, Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { CelMaterialFactory } from "../shaders/CelShader";
import type { DamageKind, ShotOptions } from "../systems/CombatSystem";
import { rotateToLocalXZ, topFaceHeight, type LocalXZ } from "../world/boxGeometry";
import type { WorldBox } from "../world/MapBuilder";
import type { ObstacleField } from "../world/ObstacleField";
import type { RayHull } from "../world/RayWorld";
import { TerrainField } from "../world/TerrainField";
import type { Combatant, Team } from "./Combatant";
import { setAntennaBend, type VehicleRig } from "./vehicleRig";
import type { VehicleSpec } from "../config/vehicles";

/** What the driver is asking for this frame. */
export interface DriveInput {
  /** -1 full reverse .. +1 full ahead. */
  throttle: number;
  /** -1 left .. +1 right, of hull yaw. */
  steer: number;
  /** Where the gun is being ASKED to point. The turret walks to it at its own rate. */
  aimYaw: number;
  aimPitch: number;
}

/**
 * What the SECOND crewman is asking the cupola gun for.
 *
 * A type of its own rather than two more fields on `DriveInput`, because the
 * two are written by two different people: a hull can be driven by one player
 * with a bot on the gun, or sat still by a gunner with nobody at the sticks,
 * and a single struct would make either of those a lie about who asked for
 * what. `VehicleSystem` fetches them separately for exactly that reason.
 *
 * Both are WORLD angles and both are ORDERS — `Vehicle.aimMg` walks the gun to
 * them at the ring's own rate, which is the same bargain the turret makes and
 * the same reason the marker drawn from this gun cannot lie either.
 */
export interface GunInput {
  aimYaw: number;
  aimPitch: number;
}

/** Where a machine gun somebody ELSE is laying has got to. See `Vehicle.setMg`. */
export interface GunAngles {
  yaw: number;
  pitch: number;
}

/**
 * What one vehicle's main gun's round IS, as `CombatSystem` needs it told.
 *
 * Built ONCE PER HULL in the constructor and held, for the reason
 * `Player.shotOptions` is a held object: a shell is fired from a per-frame path
 * and a fresh object per shot would be an allocation on the trigger. It is
 * per-hull rather than a module constant because there are two KINDS now and
 * each states its own gun — and null on a kind that has none, which is the
 * same statement `VehicleSpec.gun` makes one layer up.
 *
 * Every field is a statement about a shell rather than a tuning knob, which is
 * why they are derived here and not restated in `CONFIG.vehicles`:
 *
 * - **No fall-off.** `damageFar` equals the gun's own damage and the band is
 *   degenerate, because a shell is a shell at any distance this game contains.
 *   `CONFIG.weapons`' slope is about a bullet losing energy; a 340 m tank round
 *   does not meaningfully lose any inside a 320 m map.
 * - **No `headMult`.** The head zone is the player's alone and is an UPGRADE to
 *   a body hit — a shell that landed on a body has already spent several times
 *   a headshot's worth on it, and a gate at 1 means the sphere is never tested.
 * - **`shell`.** The one thing in the game a hull does not shrug off. See
 *   `VehicleSpec.resist`.
 *
 * It lives on the gun rather than in whoever pulls the trigger, because there
 * are two of those and they are in different PROCESSES: `Game` fires a
 * player's shell and `HeadlessGame` re-fires it, and two copies of a statement
 * about what a shell is would be two things to keep in step across a wire whose
 * whole point is that they agree.
 */
function shellShotFor(spec: VehicleSpec, hull: Vehicle): ShotOptions | null {
  const g = spec.gun;
  if (!g) return null;
  return {
    damageFar: g.damage,
    falloffNear: g.range,
    falloffFar: g.range,
    damageKind: "shell",
    fromHull: hull,
  };
}

/**
 * What a round out of the SECOND seat's gun is, as `CombatSystem` needs it
 * told. `shellShotFor`'s twin, and every field is the opposite of the shell's
 * — which is the whole point of the second seat:
 *
 * - **Fall-off, and a lot of it.** A machine gun is a bullet weapon and loses
 *   with distance exactly as the rifle does; `VehicleSpec.mg` states the band.
 * - **No `headMult`.** The head zone is the player's alone and this gun is
 *   fired at bots as often as by the player — see `ShotOptions.headMult`.
 * - **`bullet`.** Not stated, because absent IS `bullet` and a field saying so
 *   would be a second place to change it. It is what makes this gun useless
 *   against armour by construction: a tank's `resist.bullet` is 0.05, so a
 *   whole belt into a hull is worth about a rifle magazine — which is the trade
 *   that stops a second gun making the first one decoration, and on the truck
 *   is the reason a fast vehicle is not simply a better tank.
 */
function mgShotFor(spec: VehicleSpec, hull: Vehicle): ShotOptions {
  return {
    damageFar: spec.mg.damageFar,
    falloffNear: spec.mg.falloffNear,
    falloffFar: spec.mg.falloffFar,
    fromHull: hull,
  };
}

/**
 * The two jobs inside a hull, as an index into `Vehicle.seats`.
 *
 * **They are a PAIR and not a list**, which is why this is two constants and a
 * union rather than an enum that could grow: the driver's seat carries the
 * sticks and the main gun and the gunner's carries the cupola gun, and a third
 * would be a body with nothing to do. Everything that crosses the wire, the
 * roster or the HUD names a seat with one of these two numbers.
 */
export type CrewSeat = 0 | 1;
/** The sticks, the main gun, and the only seat that can move the hull. */
export const DRIVER: CrewSeat = 0;
/** The cupola gun, and nothing else at all. */
export const GUNNER: CrewSeat = 1;

/**
 * The two jobs, in the order they are filled: a hull gets a driver before it
 * gets a gunner.
 *
 * **That order is the rule, not a convenience.** A tank with a man on the
 * cupola gun and nobody at the sticks is a pillbox; a tank with a driver and
 * an empty cupola is a tank. So every sweep that fills a seat walks this list
 * and takes the first free one, which is also exactly what a player boarding
 * gets — see `VehicleSystem.seatOn`, where the same rule is stated once for
 * both processes.
 *
 * **Here rather than in `VehicleCrew`, where it was, because it is what a
 * VEHICLE has and not what the AI does with one**: `Game.crewLine` walks it to
 * draw one entry per chair, which is how a hull with a seat count other than
 * two would draw the seats it actually has rather than the two a tank has.
 */
export const SEATS: readonly CrewSeat[] = [DRIVER, GUNNER];

/** A tank standing still, for the frames nobody is driving one. */
const IDLE: DriveInput = { throttle: 0, steer: 0, aimYaw: 0, aimPitch: 0 };

/**
 * How far the reported height may differ from the local probe's before
 * `updateRemote` abandons the probe and takes the wire's, in metres.
 *
 * A metre, because the two things it has to tell apart are an order of
 * magnitude either side of it: the ordinary disagreement between two machines
 * standing the same hull on the same plank is centimetres, and the events that
 * genuinely move a hull vertically — driving off a terrace, a fresh one
 * arriving on its hardstanding — are metres. Set tighter it would snap on
 * float noise every time a track crossed a kerb; set looser a hull that fell
 * off something would climb back up to it at the kerb rate instead of being
 * put where it is.
 */
const REMOTE_RESYNC_Y = 1;

/**
 * The one wind's bearing, normalised once — `CONFIG.wind.dir` is documented as
 * un-normalised and every reader owes this.
 *
 * The masts are the third layer to lean on it, after the grass field and the
 * world's foliage, and they take the BEARING alone: what a gust does to a blade
 * of grass, to ten metres of canopy and to a steel whip are three different
 * answers to the same question, which is exactly the split `config/wind.ts`
 * makes. See `CONFIG.vehicles.tank.antenna.wind`.
 */
const WIND_HYP = Math.hypot(CONFIG.wind.dir[0], CONFIG.wind.dir[1]);
const WIND_X = CONFIG.wind.dir[0] / WIND_HYP;
const WIND_Z = CONFIG.wind.dir[1] / WIND_HYP;

/**
 * How many places along each belt the hull asks what it is standing on.
 *
 * **This is a BELT and not a set of feet, and the number is what decides which
 * of the two it reads as.** A track bridges: once its leading edge is up on a
 * car, the hull stays up until its trailing edge is past. Sampled at three
 * points a side the contacts are 3 m apart, which is wider than a car is deep,
 * so the fore contact climbs the car, drops off the far side before the middle
 * one has reached it, and the hull sags 13 cm in the middle of the obstacle —
 * measured, and it reads as the tank stumbling over the thing rather than
 * riding it. At five the spacing is 1.5 m and nothing on Coldharbour a tank
 * drives over is narrow enough to fall between two of them.
 *
 * The cost of the sixth pair would be two more bucket lookups. What it is not
 * is two more whole-scene picks — that is the whole reason the ground stopped
 * being a `pickWithRay`, and it is what makes this number a design choice
 * rather than a budget one. Every other ray in the game has since followed it
 * off the scene (`RayWorld`), which changes nothing here and is why.
 */
const CONTACT_ROWS = 5;

/** Two contacts to a row, one per belt. */
const CONTACT_COUNT = CONTACT_ROWS * 2;

/**
 * Where track contact `i` sits along the hull, in metres ahead of its centre.
 *
 * The rows run fore to aft, two to a row, right belt first — the order is
 * stated here and in `contactLat` rather than in a table of vectors, because
 * the two passes in `standOnGround` walk it twice and a table would be ten
 * allocations or a piece of shared mutable state for arithmetic this small.
 */
function contactLong(i: number, reach: number): number {
  return reach * (1 - ((i >> 1) * 2) / (CONTACT_ROWS - 1));
}

/** Where track contact `i` sits across the hull: positive is the RIGHT belt. */
function contactLat(i: number, wide: number): number {
  return (i & 1) === 0 ? wide : -wide;
}

/**
 * Shortest signed angle from `a` to `b`, in (-pi, pi].
 *
 * Exported for the one reader outside this file: an AI crew asks how far the
 * gun still has to walk before it is worth pulling the trigger, and that is
 * the same question `update` asks to walk it. A second copy of four lines of
 * angle wrapping is exactly the kind of thing that gets a sign wrong once.
 */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * What rate an axis of the turret should be turning at, given how far it still
 * has to go and how fast it is turning now — the whole of what makes a gun
 * being laid read as a mass being swung rather than a value being assigned.
 *
 * **A rate limit alone is silent about everything under it, and that silence
 * is what "jittery" was.** The old walk stepped the angle by
 * `min(|error|, rate * dt)`, so an order moving slower than the traverse — a
 * hand tracking a target, which is most aiming — was copied EXACTLY, a frame
 * at a time. The lumpiness in that order is not the hand's: mouse reports
 * arrive unevenly against a fixed frame, so the per-frame delta wobbles by
 * most of its own size whatever the wrist is doing, and the gun wobbled with
 * it. Measured on the shipped numbers, a steady drag put 2.3 rad/s^2 of jerk
 * rms on the barrel where the hand asked for none. The same limit also
 * arrested as hard as it started: 35 rad/s^2 on the last frame of every sweep,
 * sixty tonnes of turret stopping inside a sixtieth of a second.
 *
 * So the axis carries a RATE, and three terms decide what that rate is asked
 * to be. Each is a different question and the smallest wins:
 *
 * - `maxRate` — what the traverse is. Unchanged and still exact, because it is
 *   the fact the flanking argument rests on: a full traverse still takes nine
 *   seconds.
 * - the stopping term — the fastest it could still STOP from inside the error
 *   it has left, which is `sqrt(2 * accel * |err|)` with a frame's correction
 *   folded in. This is what turns the arrest into a deceleration: the gun eases
 *   off over the last few degrees and lands on the order rather than at it,
 *   and because it can always stop it can never overshoot — which an aim a
 *   marker is drawn from may not do.
 * - `|err| / settle` — a time constant over the last of it. Without it the
 *   term above is still exact at a hundredth of a degree, where it demands a
 *   rate the frame cannot resolve and the axis chatters onto the order one
 *   frame and off it the next. With it the last degree decays smoothly, and
 *   there is no error, at any size, where the gun is a copy of the order again.
 *
 * The rate then moves toward that by at most `accel * dt` — the same shape as
 * the drive's own speed limiter and for the same reason. Stepped exactly rather
 * than lerped, as anything that moves where rounds go must be, and frame-rate
 * free with it: measured, a 90 degree lay takes 2.44 s at 60, 30 and 20 Hz
 * alike, and overshoots by under a twentieth of a degree at the worst of them.
 *
 * **What this costs is a LAG while the gun is tracking, and the cost is the
 * point rather than a defect.** An axis that follows a noisy order with no lag
 * has not rejected the noise, it has passed it on; the steady-state error at
 * order rate `v` is `v * settle` exactly. `CONFIG.vehicles.tank.turret`'s
 * `settleTime` is where that trade is argued, and it is bounded from OUTSIDE
 * this file — an AI crew's trigger is behind `crew.fireCone`, and a turret
 * lagging further than that stops firing at anything that moves.
 */
function slewRate(
  dt: number,
  err: number,
  rate: number,
  maxRate: number,
  accel: number,
  settle: number,
): number {
  const mag = Math.abs(err);
  // Half a frame of deceleration carried INSIDE the root, which is what makes
  // the stopping term safe on a clock rather than only in the limit. Following
  // the plain curve costs exactly `accel`, so a rate limiter stepping along it
  // has no margin at all and the discretisation spends the difference past the
  // order — measured at a third of a degree at 60 Hz and most of one at 20,
  // which is a marker drawn at the gun's own range sliding through the reticle
  // and coming back. In this form the margin is a whole frame's worth where the
  // axis is braking hard and vanishes as the error does, so it never becomes a
  // floor under the last of the movement: the term below still closes that.
  const half = accel * dt * 0.5;
  const stop = Math.sqrt(2 * accel * mag + half * half) - half;
  const want = Math.sign(err) * Math.min(maxRate, stop, mag / settle);
  const step = accel * dt;
  return rate + Math.max(-step, Math.min(step, want - rate));
}

export class Vehicle implements Combatant, RayHull {
  /** The collider box, and the thing that MOVES. See the header. */
  readonly body: Mesh;
  readonly rig: VehicleRig;

  alive = true;
  health: number;

  /**
   * Every number this hull runs on — the `VehicleSpec` its kind states. Read
   * by everything that used to reach for `CONFIG.vehicles.tank`, which is how
   * a second kind reached the drive, the camera, the crush and the HUD without
   * any of them learning that kinds exist.
   */
  readonly spec: VehicleSpec;
  /** What the HUD calls it: `"TANK"`, `"TRUCK"`. See `VehicleType.name`. */
  readonly name: string;

  /**
   * Does this vehicle have a main gun at all?
   *
   * **The one question anything asks about a KIND, and the only one.** It is
   * `spec.gun !== null` resolved once, and everything that would otherwise
   * have to branch on what it is holding asks this instead: the trigger, the
   * HUD's loader row, the gun marker, an AI driver's lay-and-fire, and the
   * authority's own rate gate on a claimed shell. `Vehicle` itself uses it in
   * exactly two places — `update` leaves `turretYaw` on the hull's own heading
   * so an inert ring draws at a local zero, and `fireGun` refuses.
   */
  readonly armed: boolean;

  /**
   * What this hull's own rounds are, resolved once. Null on an unarmed kind,
   * which is `armed` seen from the other side — see `shellShotFor`.
   */
  readonly shellShot: ShotOptions | null;
  readonly mgShot: ShotOptions;

  /** Feet — the point the tracks rest on, as `Combatant` requires. */
  readonly position = new Vector3();
  /** The hull's centre, which is the sphere every round is tested against. */
  readonly center = new Vector3();
  /** The cupola: what bots test line of sight to, and aim at. */
  readonly eyePos = new Vector3();
  readonly hitRadius: number;
  /**
   * This is a vehicle — the one thing in the game that declares it, and the
   * one bit an AI needs to decide whether the thing in front of it is worth a
   * rocket. See `Combatant.armoured`.
   */
  readonly armoured = true;

  /** Which way the hull points, in world radians. */
  yaw = 0;
  /** Which way the GUN points, in world radians. Never the hull's. */
  turretYaw = 0;
  gunPitch = 0;
  /**
   * How fast each of those two is turning, in rad/s.
   *
   * **The turret has MASS, and this pair is the whole of what says so.** The
   * gun does not jump to the rate the order asks for and does not stop dead on
   * reaching it; `slewRate` walks these toward what the error wants at the
   * turret's own acceleration, and `update` integrates them. Nothing outside
   * this class may read them — what a driver, a crew and the marker all ask is
   * where the gun POINTS, and a rate is how it got there.
   */
  private turretRate = 0;
  private gunRate = 0;

  /**
   * Which way the COMMANDER's gun points, in world radians, and its elevation.
   *
   * **World, exactly as `turretYaw` is, and that is the whole of what makes
   * the second seat a seat rather than a decoration.** The mount is bolted to
   * the turret, so a drawn angle relative to it would be dragged round by
   * every traverse the driver asked for — a gunner laid on a doorway would be
   * swept off it the moment the main gun moved. Held in the world, the ring
   * simply turns under the gun and the lay stays where the gunner put it;
   * `aimMg` writes the DIFFERENCE onto `rig.mgMount` for the drawing, and that
   * difference is the only thing about this gun that is relative to anything.
   */
  mgYaw = 0;
  mgPitch = 0;
  private mgYawRate = 0;
  private mgPitchRate = 0;
  /**
   * The turret's world bearing as it was when the machine gun was last
   * stepped, so an UNMANNED gun can ride the ring it is standing on.
   *
   * A gun nobody is laying holds its LOCAL bearing rather than its world one,
   * which is the opposite of the rule above and is right for the same reason
   * the rule is: a stowed gun is a lump of steel bolted to a turret, and steel
   * bolted to a turret goes round with it. Held as the previous angle rather
   * than derived, because `aimMg` is the only thing that may write `mgYaw` and
   * a hull can be stepped by either of two methods.
   */
  private mgRideYaw = 0;
  /** Seconds until the machine gun will fire again. */
  private mgNextT = 0;

  /** Along the hull's own forward. Negative is reverse. */
  speed = 0;
  /**
   * How far each track has run over the ground, in metres, left then right.
   *
   * **A PICTURE, and the only piece of drive state that is.** Nothing reads it
   * but `setTrackRun`; the drive itself is one speed and one yaw, exactly as it
   * was before the tracks moved. What it costs to keep is two additions a
   * frame, and what it buys is the one thing a hull sliding along the street on
   * a static band cannot do — look driven rather than dragged.
   *
   * The split is the tank's, not the drive's: a hull turning at `w` runs its
   * outer track faster than its inner one by `w * TRACK_GAUGE / 2`, so a
   * neutral-steer pivot (which a hull whose `steerAtRest` is 1 can do at a
   * standstill, and which is the only kind that ever reaches this line with no
   * speed on it) comes out as the two tracks going opposite ways, and a hull that is being STOPPED by
   * something still runs them, because `speed` is what the drive achieved.
   */
  private readonly trackRun: [number, number] = [0, 0];
  /**
   * The stick position the running gear was last DRAWN at, and nothing else —
   * no part of the drive reads it.
   *
   * It exists so the skip in `update` can stay the physical question it is
   * ("has this hull moved or turned?") while still letting a parked vehicle's
   * wheels answer the stick. Reset with the tracks, because a respawned hull
   * is drawn straight.
   */
  private steerShown = 0;
  /**
   * Where the STEERING has actually got to, -1..1, as against where the driver
   * is asking for it — see `steerTo`.
   */
  private steerHeld = 0;
  /**
   * The drawn hull's attitude, in two halves that are never mixed: where the
   * ground puts it, and what its own mass does to it.
   *
   * Both are pictures — see the header — and they are kept apart because they
   * answer to different things AND because they move different nodes. The
   * ground half is a lerp toward a slope that is a fact about the world and
   * cannot overshoot it, and it turns the whole vehicle, tracks and all; the
   * suspension half is a spring answering to an ACCELERATION, which must
   * overshoot or it is not a spring at all, and it turns only what the springs
   * carry. They are summed for exactly one reader — the rate the mast feet are
   * rotating at — and never for the drawing.
   */
  private groundPitch = 0;
  private groundRoll = 0;
  /**
   * The attitude the six track contacts are asking for, written by
   * `standOnGround` and eased into `groundPitch`/`groundRoll` by
   * `leanToGround`.
   *
   * Held as a target rather than lerped where it is measured because the two
   * halves of a contact answer are wanted at different sharpnesses: the HEIGHT
   * has to be taken instantaneously (a plank eased toward a pitch it has not
   * got yet is a flat hull demanding to clear its own nose contact, which
   * lifts the whole tank onto the car rather than tipping it up over one),
   * while the ANGLE wants the same lerp every other lean on this vehicle has.
   */
  private groundPitchTarget = 0;
  private groundRollTarget = 0;
  private suspPitch = 0;
  private suspPitchVel = 0;
  private suspRoll = 0;
  private suspRollVel = 0;
  /**
   * The heave axis: how far the BODY has travelled against the running gear it
   * stands on, in metres, and how fast. Negative is compressed. The pitch and
   * roll above are the other two axes of the same travel and share its stops.
   *
   * The other two are angles because a hull rocking fore and aft turns about
   * its own middle; this one is a distance because a hull landing on its
   * tracks does not turn at all. It is drawn on `rig.sprung`, which is
   * everything the springs carry — see `flexHeave` for what drives it, and
   * `VehicleRig.sprung` for why the tracks are not on it.
   */
  private heave = 0;
  private heaveVel = 0;
  /**
   * What the ground did to the hull's own vertical velocity this frame, in
   * m/s, written by `standOnGround` and spent by `flexHeave`.
   *
   * Held as a field rather than passed because a WRECK spends it too: a hull
   * killed off a kerb still falls, still lands and still settles on its
   * springs, and that path never goes near `leanHull`.
   */
  private jolt = 0;
  /**
   * The hull node's attitude as it was LAST frame, and how fast it is turning.
   *
   * Kept because the whips answer to it: a mast bolted to a rocking hull bends
   * because its foot is ROTATING, which is a rate and not an angle, and the
   * rate has to be read off the two halves SUMMED — a tank climbing a kerb
   * cracks its antennae exactly as one firing its gun does, and only one of
   * those is the suspension's.
   */
  private leanX = 0;
  private leanZ = 0;
  private leanRateX = 0;
  private leanRateZ = 0;
  /**
   * The two whips: the bow each spring is holding, its velocity, and the LAGGED
   * angle the tip has actually got to. Long mast first, `ANTENNA_LENGTHS`' own
   * order. Pictures, every one of them — see `flexAntennae`.
   */
  private readonly whipX: [number, number] = [0, 0];
  private readonly whipZ: [number, number] = [0, 0];
  private readonly whipVelX: [number, number] = [0, 0];
  private readonly whipVelZ: [number, number] = [0, 0];
  private readonly tipX: [number, number] = [0, 0];
  private readonly tipZ: [number, number] = [0, 0];
  /** The idle stir's own clock. Held by whatever holds the world, as the wind is. */
  private windT = 0;
  private velY = 0;
  /**
   * How fast the ground under the tracks actually moved the hull this frame,
   * m/s, and where the hull's centre had to be last frame for it to be
   * standing on its plank.
   *
   * `velY` above is the BALLISTIC velocity — what the hull carries when there
   * is nothing under it — and these two are what the ground did, which is not
   * the same number while the climb's rate limiter is biting: a hull being
   * shoved up over a kerb is moving at the limiter's rate and carries none of
   * it, because a constraint is not a momentum. The springs answer to this
   * pair and gravity answers to `velY`.
   */
  private riseRate = 0;
  private lastTarget = 0;
  private grounded = true;
  /**
   * Whether the ground under the tracks is still worth asking about.
   *
   * Cheaper than it was — six bucket lookups rather than one whole-scene ray
   * pick — but still not free, and a round on Coldharbour has two hulls
   * standing on hardstandings doing nothing at all for most of it. So a parked,
   * grounded hull that has finished climbing asks NOTHING, and the moment it
   * moves, is placed, leaves the floor or still owes itself a rise, it starts
   * asking again.
   */
  private needsGround = true;
  /** The height of the resting plane under the hull's centre. See `standOnGround`. */
  floorY = 0;
  /**
   * The track contacts' surface heights, in `standOnGround`'s own order. A
   * field rather than locals because the plank is solved in two passes over
   * them — one for the attitude, one for the height that attitude needs — and
   * this runs every frame a hull is moving.
   */
  private readonly contacts = new Float64Array(CONTACT_COUNT);
  /**
   * How much rise the hull still owes the ground under it, in metres.
   *
   * Zero on flat going and on any slope the drive can climb at its own speed;
   * positive only while the rate limit is actually biting, which is exactly
   * the frames a tank is shouldering its way up a STEP. `update` spends
   * `drive.climbDrag` against it, so the obstacle is something the driver
   * feels rather than watches.
   */
  private climbOwed = 0;
  /**
   * Which end of the hull the collision sphere is riding at: +1 the nose, -1
   * the tail. See `CONFIG.vehicles.tank.drive.collideRadius`.
   *
   * It follows the direction of TRAVEL and is held across a stop rather than
   * recentred, because the flip is the one moment the sphere teleports the
   * length of the hull and the safe time to do it is while the speed is
   * passing through zero — which is the only way the drive ever changes its
   * sign.
   */
  private leadSign = 1;

  /** Seconds until the gun will fire again. */
  private reloadT = 0;
  /** Counts down while the burnt-out hull is still standing. See `VehicleSystem`. */
  wreckT = 0;

  /**
   * Who is in this hull, by seat: index `DRIVER` is the sticks and the main
   * gun, index `GUNNER` is the cupola gun and nothing else.
   *
   * Written by `VehicleSystem.setOccupied` alone — a tank does not know what a
   * player is, only whether each of its two jobs is being done. It is a pair
   * of booleans rather than a count because the two seats are not
   * interchangeable: the question every caller asks is "is the DRIVER's seat
   * free", never "how many are aboard".
   */
  readonly seats: [boolean, boolean] = [false, false];

  /**
   * Is anybody at all in here? What the boarding sweep and the wreck clock
   * ask, and it is a getter over `seats` rather than a field beside it because
   * two facts about one thing are two facts that can disagree.
   */
  get occupied(): boolean {
    return this.seats[DRIVER] || this.seats[GUNNER];
  }

  /**
   * True for a hull in a NETPLAY round: it refuses local damage, exactly as
   * `NetSoldier.takeDamage` does and for the identical reason.
   *
   * A client in a match resolves its own rounds so that the tracer stops in
   * the thing it hit and the hitmarker is immediate — but the authority
   * re-runs every one of them against its own copy, and only that result deals
   * damage. A hull is the one target on the client that is a REAL simulated
   * object rather than a pooled ghost, so without this it would be the one
   * target a client could kill on its own screen: the wreck would appear, the
   * street would open up, the crew would burn, and the next snapshot would put
   * a healthy tank back in the middle of it.
   *
   * Written by `VehicleSystem.build` off one fact `Game` passes down, so a
   * fleet is all one thing or all the other and there is no hull anywhere that
   * is half-authoritative.
   */
  predicted = false;

  /**
   * Wired by `VehicleSystem`: this hull has just been destroyed, and whoever
   * was inside it needs to know before anything else happens to it.
   */
  onDestroyed: () => void = () => {};

  private terrain: TerrainField = new TerrainField();
  /**
   * The collider boxes, bucketed. Null until a map hands them over, and a hull
   * with none falls back to the terrain alone — which is what a tank standing
   * on an empty field is standing on anyway.
   */
  private obstacles: ObstacleField | null = null;
  // Scratch. This runs every frame a tank exists; nothing below allocates.
  private readonly step = new Vector3();
  /** Where the push-out would put the hull. See `freeFromWalls`. */
  private readonly clear = new Vector3();
  /**
   * The push-out has not finished: it moved the hull last frame and the
   * overlap outlasted the rate.
   *
   * Held because `freeFromWalls` is otherwise asked only on a frame the hull
   * STIRS, which is right for finding an overlap and wrong for leaving one — a
   * driver who lets go halfway out would park a hull inside a wall and it would
   * sit there until somebody touched a control. `needsGround`'s shape exactly,
   * and for the same reason: the question stays open until the answer stops
   * changing.
   */
  private clearing = false;

  constructor(
    scene: Scene,
    mats: CelMaterialFactory,
    readonly team: Team,
    /**
     * WHAT this hull is: what to call it, every number it runs on, and the
     * function that draws it.
     *
     * **Handed in rather than reached for**, because a `Vehicle` is one hull of
     * whatever KIND its hardstanding named and this file may not know which —
     * and the moment it could ask, the branch it would grow is the thing the
     * whole arrangement exists to avoid. `entities/vehicleKinds.ts` is where a
     * kind becomes one of these, and `VehicleSystem.build` is its only caller.
     *
     * Stated structurally rather than imported as `VehicleType`, so the
     * dependency runs one way: the registry knows about the models, and the
     * hull knows about neither.
     */
    private type: {
      readonly name: string;
      readonly spec: VehicleSpec;
      readonly build: (
        scene: Scene,
        mats: CelMaterialFactory,
        team: Team,
      ) => VehicleRig;
    },
  ) {
    const t = this.type.spec;
    this.spec = t;
    this.name = this.type.name;
    this.health = t.maxHealth;
    this.hitRadius = t.hitRadius;
    this.armed = t.gun !== null;
    // `this` is handed in so the round can be taken out of its OWN hull's wall
    // query — see `ShotOptions.fromHull`. It is only a reference: nothing here
    // calls `rayBox`, and the collider two lines below is what it will read.
    this.shellShot = shellShotFor(t, this);
    this.mgShot = mgShotFor(t, this);
    this.body = MeshBuilder.CreateBox(
      `hull-body-${team}`,
      { width: t.hull.width, height: t.hull.height, depth: t.hull.length },
      scene,
    );
    this.body.isVisible = false;
    this.body.isPickable = true;
    this.body.checkCollisions = true;
    // Both predicates, on purpose: a hull is somewhere a body may not be AND
    // something a round stops on. Neither `porous` nor `rayOnly` — those two
    // describe a fence, which is a thing that is one to a body and the other to
    // a bullet, and a tank is both to both.
    this.body.metadata = { solid: true };
    // A circle, because Babylon's collision ellipsoid does not turn with the
    // mesh — see `CONFIG.vehicles.tank.drive.collideRadius`.
    //
    // **Its floor sits a CLIMB HEIGHT above the tracks, and that is what makes
    // a tank drive over things.** `moveWithCollisions` has no notion of
    // climbing: it slides along a vertical face whatever its height, so a hull
    // whose collider reached the ground would be stopped dead by a 0.3 m kerb
    // however generous the ground query was. Lifting the floor means anything
    // shorter than `climbHeight` is simply not in the way horizontally, and
    // `standOnGround` — which accepts a surface from exactly the same band —
    // then rides the hull up over it. It is the same trick the player's capsule
    // plays with its own 5 cm, at the scale tracks deserve.
    //
    // What it costs is that the bottom `climbHeight` of the hull is not a
    // collider: a tank shoulders THROUGH the bottom of a barrier for the few
    // frames it takes to climb it. Against being stopped by kerbs and parked
    // cars, that is the trade.
    //
    // The OFFSET is written per frame rather than here, because it carries the
    // sphere to the leading end of the hull and that is a world direction that
    // turns with the tank. See `aimCollider`.
    this.body.ellipsoid = new Vector3(
      t.drive.collideRadius,
      (t.hull.height - t.drive.climbHeight) / 2,
      t.drive.collideRadius,
    );
    this.body.ellipsoidOffset = new Vector3(0, t.drive.climbHeight / 2, 0);

    this.rig = this.type.build(scene, mats, team);
    this.rig.root.parent = this.body;
    // The rig is drawn with `y = 0` at the bottom of the tracks and the
    // collider box is centred on the hull, so the model hangs half a hull
    // below the box's own origin.
    this.rig.root.position.y = -t.hull.height / 2;
  }

  /**
   * Hands the hull the world it stands on: the collider boxes it rides over
   * and the heightfield under them.
   *
   * Both, in one call, because a contact takes the higher of the two and a
   * hull holding one without the other answers half a question — the boxes
   * have no floor in them and the field has no kerb.
   */
  setGround(terrain: TerrainField, obstacles: ObstacleField | null): void {
    this.terrain = terrain;
    this.obstacles = obstacles;
  }

  /**
   * A fresh hull on its hardstanding: full health, stopped, level, gun forward,
   * paint back on and the magazine loaded.
   *
   * Everything a round could have left behind is written here rather than at
   * the moment of destruction, for the reason `Player.fullReset` gives: the
   * rig is pooled and never disposed, so the only guarantee worth having is
   * that what comes BACK is clean.
   */
  placeAt(pos: Vector3, yaw: number): void {
    const t = this.spec;
    this.alive = true;
    this.health = t.maxHealth;
    this.yaw = yaw;
    this.turretYaw = yaw;
    this.gunPitch = 0;
    this.turretRate = 0;
    this.gunRate = 0;
    this.mgYaw = yaw;
    this.mgPitch = 0;
    this.mgYawRate = 0;
    this.mgPitchRate = 0;
    this.mgRideYaw = yaw;
    this.mgNextT = 0;
    this.speed = 0;
    this.trackRun[0] = 0;
    this.trackRun[1] = 0;
    this.steerShown = 0;
    this.steerHeld = 0;
    this.groundPitch = 0;
    this.groundRoll = 0;
    this.suspPitch = 0;
    this.suspPitchVel = 0;
    this.suspRoll = 0;
    this.suspRollVel = 0;
    this.heave = 0;
    this.heaveVel = 0;
    this.jolt = 0;
    this.leanX = 0;
    this.leanZ = 0;
    this.leanRateX = 0;
    this.leanRateZ = 0;
    for (let i = 0; i < 2; i++) {
      this.whipX[i] = 0;
      this.whipZ[i] = 0;
      this.whipVelX[i] = 0;
      this.whipVelZ[i] = 0;
      this.tipX[i] = 0;
      this.tipZ[i] = 0;
    }
    this.velY = 0;
    this.riseRate = 0;
    this.lastTarget = pos.y + t.hull.height / 2;
    this.grounded = true;
    this.climbOwed = 0;
    this.clearing = false;
    this.groundPitchTarget = 0;
    this.groundRollTarget = 0;
    this.leadSign = 1;
    this.reloadT = 0;
    this.wreckT = 0;
    this.seats[DRIVER] = false;
    this.seats[GUNNER] = false;
    this.floorY = pos.y;
    this.needsGround = true;
    this.body.position.set(pos.x, pos.y + t.hull.height / 2, pos.z);
    this.body.rotation.y = yaw;
    // The sphere with it, or a fresh hull stands on its hardstanding carrying
    // the offset the LAST one's heading left behind — which nothing would
    // notice until the first frame somebody drove it. Everything a round could
    // have left behind is written here, and this is one of them.
    this.aimCollider();
    // A fresh hull is solid again — destruction cleared this, and the pooled
    // mesh is the same one. See `destroy`.
    this.body.metadata = { solid: true };
    this.body.checkCollisions = true;
    this.body.isPickable = true;
    this.rig.reset();
    this.body.setEnabled(true);
    this.sync();
  }

  /** Takes the hull off the field outright — the frame after a wreck is done. */
  hide(): void {
    this.body.setEnabled(false);
    this.body.checkCollisions = false;
    this.body.isPickable = false;
  }

  /**
   * Takes the hull out of the world. Called only by `VehicleSystem.build`,
   * which is to say once per map install.
   *
   * **Never `dispose(false, true)`.** Every material on this rig came out of
   * `CelMaterialFactory`'s shared per-colour cache (`mats.get`), which is the
   * same cache the WORLD is painted from — so the second flag disposes paint
   * that the map's own meshes are holding, and the factory hands the dead
   * material out again on the next `get` because nothing takes it back out of
   * the cache. The failure is silent and it is not local: a `ShaderMaterial`
   * that has been disposed never reports ready, and Babylon skips a mesh whose
   * material is not ready, so most of the city simply stops being drawn on the
   * second round of a map that has armour on it. The rig's meshes are this
   * hull's; the paint on them is everybody's.
   */
  dispose(): void {
    this.rig.root.dispose(false);
    this.body.dispose();
  }

  /**
   * Is the gun loaded? **False forever on a hull that has no gun**, which is
   * what makes `fireGun` and the AI crew's trigger both refuse without either
   * of them having to ask what kind of vehicle this is.
   */
  get gunReady(): boolean {
    return this.armed && this.alive && this.reloadT <= 0;
  }

  /**
   * 0 just fired, 1 loaded — what the HUD draws as the gun's own magazine, and
   * **null on a hull with no gun**, which is what takes the loader row off the
   * band rather than leaving it dimmed at a permanent full.
   */
  get loadProgress(): number | null {
    const g = this.spec.gun;
    if (!g) return null;
    return Math.min(1, 1 - this.reloadT / g.cooldown);
  }

  /** How fast the hull is going, regardless of which way. For the engine note. */
  get travel(): number {
    return Math.abs(this.speed);
  }

  /** Where the gun actually points, in the world. NOT where the player is looking. */
  gunDirToRef(out: Vector3): Vector3 {
    const cp = Math.cos(this.gunPitch);
    return out.set(
      cp * Math.sin(this.turretYaw),
      Math.sin(this.gunPitch),
      cp * Math.cos(this.turretYaw),
    );
  }

  /**
   * The barrel's tip in world space: where a shell starts and its flash is lit.
   *
   * **On an unarmed hull there is no barrel**, and this answers with the ring
   * the gun would have been on rather than throwing — every caller is already
   * behind `armed` or behind `fireGun`'s refusal, so the fallback is
   * unreachable, and a `Vector3` nobody reads is a cheaper way to say that than
   * a nullable every call site has to unwrap.
   */
  muzzleToRef(out: Vector3): Vector3 {
    const muzzle = this.rig.muzzle ?? this.rig.turret;
    return out.copyFrom(muzzle.getAbsolutePosition());
  }

  /** Where the COMMANDER's gun points, in the world. Never where the turret does. */
  mgDirToRef(out: Vector3): Vector3 {
    const cp = Math.cos(this.mgPitch);
    return out.set(
      cp * Math.sin(this.mgYaw),
      Math.sin(this.mgPitch),
      cp * Math.cos(this.mgYaw),
    );
  }

  /** The cupola gun's muzzle in world space: where a round starts and its flash is lit. */
  mgMuzzleToRef(out: Vector3): Vector3 {
    return out.copyFrom(this.rig.mgMuzzle.getAbsolutePosition());
  }

  /** Is the belt-fed gun's own rate limit spent? `fireMg`'s gate, asked outside. */
  get mgReady(): boolean {
    return this.alive && this.mgNextT <= 0;
  }

  /**
   * Spends one round of the belt. Returns false when the rate limit has not
   * come round yet, and a caller that gets a false has fired nothing — the
   * same contract `fireGun` has one calibre up.
   *
   * **Nothing is kicked here, and that is the difference from `fireGun`
   * rather than an omission.** A shell's recoil is a fact about the hull: it
   * shoves the drive, rocks the springs and cracks both masts. A machine gun
   * on a ring is a few hundred newtons against sixty tonnes — what it moves is
   * the CAMERA of whoever is holding it, which is the gunner's own business
   * and is spent by `Game` exactly as the shell's camera kick is.
   */
  fireMg(): boolean {
    if (!this.mgReady) return false;
    this.mgNextT = 1 / this.spec.mg.fireRate;
    return true;
  }

  /**
   * One frame of the cupola gun, walked toward the order the second crewman is
   * giving it — or, with no order, riding the ring it is bolted to.
   *
   * **It is stepped from `VehicleSystem` rather than from `update`, and that
   * separation is the feature.** The two guns on this hull have two owners who
   * need not be the same kind of thing: the driver can be a person reporting a
   * simulated hull off the wire while the gunner is a bot on the authority, or
   * the other way round. Folded into `update` the machine gun would only be
   * laid on the hulls somebody was DRIVING, and folded into `updateRemote` it
   * would only ever be posed. Asked as its own question it is answered the
   * same way on every machine for every hull.
   *
   * `slewRate` is the turret's, unchanged: a ring is the same problem as a
   * traverse with different numbers in it, and the reasons a bare rate limit
   * could not say "mass" are the reasons it could not say "light" either.
   *
   * **With no gunner the gun holds its LOCAL bearing**, which is the opposite
   * of what it does with one and is right: an unmanned gun is steel bolted to
   * a turret and goes round with the turret. The rates are zeroed rather than
   * run down, for the reason `update` zeroes the turret's — a gun that carried
   * a stale rate across an empty seat would start moving again on the frame
   * somebody sat back down at it.
   */
  aimMg(dt: number, order: GunInput | null): void {
    const ride = angleDelta(this.mgRideYaw, this.turretYaw);
    this.mgRideYaw = this.turretYaw;
    if (!this.alive) return;
    this.mgNextT = Math.max(0, this.mgNextT - dt);
    const m = this.spec.mg;
    if (!order) {
      this.mgYaw += ride;
      this.mgYawRate = 0;
      this.mgPitchRate = 0;
    } else {
      this.mgYawRate = slewRate(
        dt,
        angleDelta(this.mgYaw, order.aimYaw),
        this.mgYawRate,
        m.traverseRate,
        m.traverseAccel,
        m.settleTime,
      );
      this.mgYaw += this.mgYawRate * dt;
      const want = Math.max(m.pitchMin, Math.min(m.pitchMax, order.aimPitch));
      this.mgPitchRate = slewRate(
        dt,
        want - this.mgPitch,
        this.mgPitchRate,
        m.elevationRate,
        m.elevationAccel,
        m.settleTime,
      );
      this.mgPitch += this.mgPitchRate * dt;
    }
    this.drawMg();
  }

  /**
   * The same axis, told where it IS rather than where it is wanted: a gunner
   * somewhere else laid this gun and the authority relayed the answer.
   *
   * `aimMg`'s twin, and the split between them is `update`/`updateRemote`'s
   * exactly — what a crewman DECIDES arrives from outside, and nothing else
   * about this gun is a fact about the world worth re-deriving. The rate is
   * dropped rather than estimated: nothing reads it but the slew, and the slew
   * is not running on this machine for this gun.
   *
   * The belt's clock still runs, because a remote gun's rounds arrive as
   * events and the local hull is what draws their flashes.
   */
  setMg(dt: number, yaw: number, pitch: number): void {
    this.mgRideYaw = this.turretYaw;
    if (!this.alive) return;
    this.mgNextT = Math.max(0, this.mgNextT - dt);
    this.mgYaw = yaw;
    this.mgPitch = pitch;
    this.mgYawRate = 0;
    this.mgPitchRate = 0;
    this.drawMg();
  }

  /**
   * The cupola gun's two nodes, from the world angles above.
   *
   * Drawn relative to the TURRET and held in the world, exactly as the main
   * gun is drawn relative to the hull and held in the world — traversing the
   * turret under a laid machine gun must not drag it round, which is the
   * whole of what `mgYaw` being a world angle buys.
   */
  private drawMg(): void {
    this.rig.mgMount.rotation.y = angleDelta(this.turretYaw, this.mgYaw);
    // A positive X rotation tips a box's +Z face DOWN, so the elevation is the
    // negative of it — the main gun's own convention one node along.
    this.rig.mgGun.rotation.x = -this.mgPitch;
  }

  /**
   * Spends the round in the breech. Returns false when the gun is not loaded,
   * and a caller that gets a false must not fire one — the same contract
   * `GrenadeSystem.throwAlong` has, and for the same reason.
   *
   * The recoil is taken here rather than by the caller because it is a fact
   * about the hull: a stationary tank rocks away from wherever its GUN is laid
   * when it fires, and the shove is spent against the drive over the next
   * second whether anybody is holding the throttle or not.
   */
  fireGun(): boolean {
    const g = this.spec.gun;
    // `gunReady` is already false on an unarmed hull; the second test is what
    // narrows the type, and the two are one statement rather than two.
    if (!g || !this.gunReady) return false;
    this.reloadT = g.cooldown;
    // What follows is ONE force spent in three places, and the direction of it
    // is the GUN's and never the hull's. The turret traverses and the hull does
    // not follow it, so a round sent over the left track shoves the hull
    // RIGHT and one over the tail shoves it FORWARD — written along the hull's
    // own axis instead, a tank rocked backwards whichever way its gun happened
    // to be pointing, which is a body that has decided what a shot did to it
    // before the gun was laid.
    //
    // The bearing is the turret's LOCAL yaw, which the drawn node already
    // carries, and each term below is that one vector resolved onto the axis
    // it acts on. ELEVATION is deliberately not in it: the gun's arc is -8 to
    // +18 deg, so the horizontal share of the recoil never falls below 95%,
    // and the vertical remainder would be a HEAVE — which the couple argued
    // for under `suspension.gunKick` says a body standing on tracks does not
    // feel.
    const phi = this.rig.turret.rotation.y;
    const along = Math.cos(phi);
    const across = Math.sin(phi);
    // The shove, spent against the drive over the next second. Only the share
    // along the HULL's heading can be spent that way at all — `speed` is a
    // scalar on the tracks and there is nowhere for a lateral velocity to go —
    // so a turret at ninety degrees takes nothing off the road speed, and that
    // is the honest answer rather than a dropped term: a stationary tank is
    // not driven sideways by its own gun either.
    this.speed -= g.recoilSpeed * along;
    // ...and the hull ROCKS, which is a second fact and not the same one. The
    // shove above is spent against the drive over the next second; this is a
    // velocity straight into the suspension's springs, NOSE UP, because a gun's
    // recoil is a rearward force well above the tracks and what that does to a
    // body standing on them is lift the front. Left to the acceleration term
    // the shove would read as a brake and dive the nose — the opposite of every
    // tank that has ever fired. See `CONFIG.vehicles.tank.suspension.gunKick`.
    //
    // The same couple over a TRAVERSED turret is a roll and not a pitch, and
    // the two are the one impulse split by the bearing, so the hull is rocked
    // exactly as hard whichever way the gun is laid. A positive Z stands the
    // hull's RIGHT side up (`flexSuspension` says so), and a shot to the right
    // shoves the hull left — which lifts the right side, hence the sign.
    const s = this.spec.suspension;
    this.suspPitchVel -= s.gunKick * along;
    this.suspRollVel += s.gunKick * across;
    // ...and the MASTS crack, which is a third fact and belongs here for the
    // same reason the second one does. The hull is shoved back along the GUN's
    // axis, so both whips are thrown out along it; the only thing the drive
    // terms would ever see of a shot is the quarter second afterwards where the
    // tracks brake that shove out, which lays them BACK — so said here, the
    // pair come out as one crack and a lay-back after it. See `antenna.gunKick`.
    //
    // No bearing on this one, and that is the whole point rather than an
    // omission: a whip's axes are the TURRET's and so is the gun's, so the
    // direction a shot throws a mast is the one thing on this vehicle that
    // traversing cannot change. A positive X bend tips a tip toward the
    // turret's +Z, which is where the gun points.
    const kick = this.spec.antenna.gunKick;
    for (let i = 0; i < this.rig.antennae.length; i++) this.whipVelX[i] += kick;
    return true;
  }

  /**
   * `from` and `kind` as `Hittable` describes them. The kind is the whole
   * reason this is not two lines: see `CONFIG.vehicles.tank.resist`.
   *
   * Returns whether this hit finished the hull, exactly as a body's does, so
   * `CombatSystem.fire` and `GrenadeSystem.blastAt` need no arm for vehicles.
   */
  takeDamage(amount: number, _from?: Vector3, kind: DamageKind = "bullet"): boolean {
    if (!this.alive) return false;
    // A hull in a match is drawn from the wire and damaged by nobody but the
    // authority — see `predicted`. Refused rather than merely unrecorded, so
    // that `CombatSystem.fire` and `blastAt` read "nothing died" and neither
    // credits a kill nor burns a crew this client has no business burning.
    if (this.predicted) return false;
    const resist = this.spec.resist;
    const felt =
      amount *
      (kind === "shell" ? resist.shell : kind === "blast" ? resist.blast : resist.bullet);
    this.health = Math.max(0, this.health - felt);
    if (this.health > 0) return false;
    this.destroy();
    return true;
  }

  /**
   * The hull burns. It KEEPS its collider for `wreckTime` — a wreck in the
   * street is cover, and that is the whole reason destruction is not simply
   * `setEnabled(false)` — but it stops being a target: `alive` is false, so it
   * leaves every list `hittablesAgainst` builds, and bots stop shooting a thing
   * that is already dead.
   */
  private destroy(): void {
    this.wreck();
  }

  /**
   * The same thing, said from OUTSIDE: this hull has burned.
   *
   * Public for exactly one caller — a netplay client, which is told a hull is
   * gone rather than working it out. A `predicted` hull refuses every blow
   * (see `takeDamage`), so `destroy` is unreachable there and the wire is the
   * only thing that can move it from live to wreck; this is the same door with
   * the health check taken off the front of it.
   *
   * Idempotent, because the wire re-states a wreck on every snapshot for as
   * long as it stands and a second call would re-arm the wreck clock and
   * repaint a hull that is already charred.
   */
  wreck(): void {
    if (!this.alive) return;
    this.alive = false;
    this.speed = 0;
    // A wreck's hull node is never leaned again, so the rate that bends its
    // whips has to be retired with it — left standing, the last frame's rock
    // would be a constant bias holding both masts over for the whole wreck.
    this.leanRateX = 0;
    this.leanRateZ = 0;
    this.wreckT = CONFIG.vehicles.wreckTime;
    this.rig.paint(true);
    this.onDestroyed();
  }

  /**
   * How fast this hull can turn RIGHT NOW at full stick, in rad/s — signed, so
   * multiplying a stick position by it is the whole of the steering and a
   * yaw rate divided by it is the stick that must have produced one.
   *
   * Two ends and a taper, and between them they are the only thing in the
   * codebase that knows tracks from wheels — without knowing it, because both
   * ends are numbers a `VehicleSpec` states:
   *
   * - `turnAtSpeed` is the top end. A hull does not turn as hard at road speed
   *   as it does off the line, whichever way it is steered.
   * - `steerAtRest` is the bottom. At 1 the ramp is a flat 1 everywhere and
   *   this collapses to the taper alone — a tracked hull pivots on the spot
   *   and reverses into the same pivot. At 0 the authority is proportional to
   *   the hull's own VELOCITY up to `steerRollSpeed`, so a wheeled hull turns
   *   nothing while parked and turns the other way backing up, which is what a
   *   steered axle does and what stops a five-tonne truck spinning in the road.
   *
   * Signed by `this.speed` rather than `this.travel` for that last clause, and
   * a `steerRollSpeed` of 0 means "no ramp" rather than a division by zero.
   */
  private steerAuthority(): number {
    const c = this.spec.drive;
    const turn =
      c.turnRate *
      (1 - (1 - c.turnAtSpeed) * Math.min(1, this.travel / c.maxSpeed));
    if (c.steerAtRest >= 1 || c.steerRollSpeed <= 0) return turn;
    const rolling = Math.max(
      -1,
      Math.min(1, this.speed / c.steerRollSpeed),
    );
    return turn * (c.steerAtRest + (1 - c.steerAtRest) * rolling);
  }

  /**
   * Where the steering has got to this frame, walking toward what the driver is
   * asking for at `drive.steerRate` — the LINKAGE, and the answer everything
   * downstream of the stick uses.
   *
   * **A key is not a steering wheel, and that is the whole of what this is
   * for.** `InputManager.moveX` is +-1 the instant `A` or `D` goes down, which
   * on foot is right — walking left is a direction and not a quantity — and in
   * a hull is a driver who can hit full lock and centre again inside one
   * frame. The yaw rate that comes out of it is a step function, and a step
   * function into a five-tonne body reads exactly as what it is: jerky.
   *
   * **This is a rate limit and not a smoothing**, which is the honest shape
   * for it twice over. It is what the mechanism IS — a wheel is wound at the
   * speed a pair of hands can wind it, and a tiller is pulled at the speed an
   * arm moves — and it is frame-rate exact by construction rather than by the
   * `Math.min(1, dt * rate)` idiom, which never quite arrives and arrives
   * differently at 30 Hz. It is deliberately the same three lines as the
   * throttle's walk toward its wanted speed, ten lines below: both are a
   * control the driver ASKS with and the hull answers at its own rate.
   *
   * **It costs the AI driver nothing it was not already doing**: a crew's
   * steer is `err * steerGain` and is a continuous quantity, so the limit only
   * bites where a bot's own heading error saturates the stick.
   *
   * It is the DRAWN wheels' angle as well, because `steerShown` is fed from
   * this rather than from the stick — a truck whose wheels snapped to full
   * lock while the hull turned in over a quarter of a second would be telling
   * two stories about one linkage.
   *
   * At `steerRate` 0 it hands back the ask untouched, which is a kind with no
   * linkage worth modelling.
   */
  private steerTo(want: number, dt: number): number {
    const rate = this.spec.drive.steerRate;
    if (rate <= 0) {
      this.steerHeld = want;
      return want;
    }
    const gap = want - this.steerHeld;
    this.steerHeld += Math.sign(gap) * Math.min(Math.abs(gap), rate * dt);
    return this.steerHeld;
  }

  /**
   * One frame of a tank: the drive, the ground under it, the turret walking
   * toward where it was asked to point, and the lean.
   *
   * `drive` is null for a hull nobody is in, which is not the same as one being
   * driven with the sticks centred: an empty tank still has to be put on the
   * ground it is standing on (the map under it can change — a pane breaks, the
   * editor rebuilds) and still runs its wreck clock, but its turret stays where
   * the last driver left it rather than walking back to the hull's heading.
   */
  update(dt: number, drive: DriveInput | null): void {
    if (this.wreckT > 0) this.wreckT = Math.max(0, this.wreckT - dt);
    if (!this.alive) {
      // A wreck still falls — it can be killed off a kerb — and then settles
      // and stops asking, exactly as a parked hull does. A hull that has been
      // taken off the field (`hide`) is skipped outright: nothing can see it,
      // and the probe is far too expensive to spend on a mesh that is not
      // there.
      if (this.body.isEnabled()) {
        this.standOnGround(dt);
        // A wreck settles on its springs after it falls, for the reason its
        // masts keep stirring: it is still a mass standing on the ground.
        this.flexHeave(dt);
        // The masts keep stirring on a burnt-out hull, and that is the point of
        // paying for them: a wreck with two antennae frozen mid-crack is a
        // freeze-frame, and a wreck whose whips settle and then move in the
        // wind is the only thing on it still saying the world is running.
        this.flexAntennae(dt, 0, 0);
      }
      this.sync();
      return;
    }

    this.reloadT = Math.max(0, this.reloadT - dt);
    const d = drive ?? IDLE;
    const c = this.spec.drive;
    // What the drive ACHIEVES this frame, for the suspension to answer to. Read
    // as a difference rather than taken from the throttle because the three
    // things that decelerate a hull are not all the throttle's: letting go of
    // it, braking against it, and driving into a building. The gun's own shove
    // is deliberately NOT in here — `fireGun` runs outside this method and
    // kicks the spring itself.
    const speedWas = this.speed;

    // --- drive ---
    // The throttle picks a speed and the hull walks to it; it does not add
    // force. That keeps a tank's top speed a fact rather than a consequence,
    // and makes the brake and the coast the same line of arithmetic.
    const wanted =
      d.throttle >= 0 ? d.throttle * c.maxSpeed : d.throttle * c.reverseSpeed;
    // Slowing is faster than speeding up, and letting go is slowing.
    const rate = Math.abs(wanted) > Math.abs(this.speed) ? c.accel : c.brake;
    const gap = wanted - this.speed;
    const move = Math.min(Math.abs(gap), rate * dt);
    this.speed += Math.sign(gap) * move;

    // What the LINKAGE has got to, which is what the hull turns on — never the
    // stick itself. See `steerTo`: a key is not a steering wheel.
    const steer = this.steerTo(d.steer, dt);
    const yawRate = steer * this.steerAuthority();
    this.yaw += yawRate * dt;
    this.body.rotation.y = this.yaw;

    // The drawn tracks, off the drive that has just been decided. A yaw to the
    // RIGHT (which is a positive one — `forward` is `(sin yaw, cos yaw)`, so
    // +90 degrees points at +x) is the LEFT track running long.
    //
    // Skipped outright for a hull that is neither moving nor turning, for the
    // reason `needsGround` skips the probe: two of these are parked doing
    // nothing for most of a round, and writing six transforms a frame to put
    // them back exactly where they were is six world matrices to recompute.
    //
    // The same question the collision sphere and the push-out below both ask,
    // and asking it once is deliberate: a hull that has neither moved nor
    // turned cannot have changed what it is touching, and those two are the
    // only ways it can.
    const stirred = this.speed !== 0 || yawRate !== 0;
    // **The steering is drawn on a hull that is not moving at all**, which is
    // the one thing the skip above cannot cover on a vehicle that has to be
    // rolling to turn: a parked truck under full lock yaws by nothing, and if
    // the wheels did not turn either then the driver's only feedback for the
    // stick being over is that they are still pointing the same way. A tank
    // has never reached this branch — a stick over on one IS a yaw rate — so
    // it costs the parked pair nothing. It is the LINKAGE that is compared
    // rather than the stick, so a parked truck winds its wheels over the same
    // quarter-second a moving one does instead of snapping them.
    if (stirred || steer !== this.steerShown) {
      const differential = (yawRate * this.rig.gauge) / 2;
      this.trackRun[0] += (this.speed + differential) * dt;
      this.trackRun[1] += (this.speed - differential) * dt;
      this.rig.setRun(this.trackRun[0], this.trackRun[1], steer);
      this.steerShown = steer;
    }

    // **Aimed on a TURN as well as on a move, and that is a fix rather than a
    // tidy-up.** The offset is a world vector swung by the yaw, so a hull that
    // pivots while stopped is carrying one drawn for a heading it no longer
    // has — and the frame the throttle is finally touched, the sphere arrives
    // at its true place in one step. Measured: a 115 deg neutral-steer pivot
    // at a standstill moved it not at all, and then **2.37 m in a single
    // frame**, through anything that happened to be in between. Written every
    // frame the hull stirs, the same swing is a continuous 1.26 m/s at full
    // stick, which is a rate `freeFromWalls` can answer.
    if (stirred) this.aimCollider();

    // **The gate is the DISTANCE this frame asks for and not the speed, because
    // the engine's own gate is a distance — and a speed here was a hull that
    // could not pull away from a standstill.**
    //
    // `moveWithCollisions` writes the position back only when the move it
    // worked out exceeds `CollisionsEpsilon`, one millimetre, and silently
    // returns the mesh where it was otherwise. From rest the first frame asks
    // for `accel * dt^2` — a third of a millimetre at 120 fps — so the hull did
    // not move, the check below read that as walked-into-something and docked
    // the speed to a third, and the two settled into a fixed point:
    // `s = 0.35 * (s + accel * dt)`, which at 8.3 ms is 0.021 m/s. Measured at
    // exactly 0.021, on open ground, with the throttle wide open and the hull
    // stationary. It came out of it only when a frame ran long enough for
    // `speed * dt` to clear the millimetre, so it was WORSE the better the
    // machine — seconds of a tank refusing to pull away at 120 fps and nothing
    // at all under about 40.
    //
    // Asking below the engine's threshold is asking for nothing, so the frames
    // that would ask are skipped outright: `speed` goes on building at the
    // throttle's rate and the hull is moving inside three frames. Nothing is
    // lost by not asking — those frames never moved the hull anyway.
    const asked = Math.abs(this.speed * dt);
    if (asked > AbstractEngine.CollisionsEpsilon) {
      this.step.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      this.step.scaleInPlace(this.speed * dt);
      const before = this.body.position.x;
      const beforeZ = this.body.position.z;
      this.body.moveWithCollisions(this.step);
      // Walked into something: drop the speed rather than grinding along it at
      // full throttle. `moveWithCollisions` already slid the hull, so this is
      // about the ENGINE noise and the driver's read, not about the position —
      // a tank pressed against a wall that still sounds like it is doing 40 is
      // the tell that nothing noticed.
      //
      // **Read along the asked direction and not as a distance**, because the
      // two come apart in exactly the case this used to make worse. A hull
      // whose sphere is inside a box is being EJECTED — Babylon pushes it back
      // out along the slide plane whatever the drive asked for — so the ground
      // it covered is large and every metre of it is the wrong way. As a bare
      // magnitude that read as "moving fine" on some frames and as "blocked"
      // on others, and the frames it called blocked docked the drive to a
      // third exactly when the hull needed the speed to leave. Being shoved
      // backwards is not the engine note this is about; being held is.
      const progress =
        ((this.body.position.x - before) * this.step.x +
          (this.body.position.z - beforeZ) * this.step.z) /
        asked;
      if (progress >= 0 && progress < asked * 0.5) this.speed *= 0.35;
    }

    if (stirred || this.clearing) this.freeFromWalls(dt);
    this.standOnGround(dt);
    this.flexHeave(dt);
    // ...and climbing costs speed, for the same reason walking into a wall
    // does. Spent here rather than inside the ground so it lands BEFORE the
    // acceleration below is read off `speed`: shouldering up onto a car is a
    // deceleration the suspension should feel, not a number the drive was
    // quietly docked after the fact. See `drive.climbDrag`.
    if (this.climbOwed > 1e-3) this.speed *= Math.max(0, 1 - c.climbDrag * dt);

    // --- the turret walks to where it was asked to point ---
    // This is the whole of why a third-person view can have an honest reticle:
    // the look input moves `aimYaw`/`aimPitch` and the gun is what actually
    // gets there, at its own rate, so the marker the HUD draws is the gun and
    // never the camera.
    //
    // What walks is a RATE and not the angle — see `slewRate`, which is where
    // the turret's mass is written down. A hull nobody is in has its rates
    // zeroed rather than run down: its gun stays exactly where the last driver
    // left it, and a turret that carried a stale rate across an empty seat
    // would start moving again on the frame somebody sat back in it.
    //
    // **An UNARMED hull is the one case that skips it entirely**, and what it
    // does instead is keep `turretYaw` on the hull's own heading. That is not a
    // special case dressed up: the drawn angle is `turretYaw - yaw`, so a
    // turret that tracks the hull draws at a permanent local zero — which is
    // exactly what a ring bolted to a truck's roof should do — and `aimMg`,
    // which writes `mgYaw - turretYaw` onto the mount above it, then puts a
    // world-held machine gun on a body-mounted ring with no branch of its own.
    const tur = this.spec.gun?.turret;
    if (!tur) {
      this.turretYaw = this.yaw;
      this.gunPitch = 0;
      this.turretRate = 0;
      this.gunRate = 0;
    } else if (drive) {
      const dy = angleDelta(this.turretYaw, d.aimYaw);
      this.turretRate = slewRate(
        dt,
        dy,
        this.turretRate,
        tur.traverseRate,
        tur.traverseAccel,
        tur.settleTime,
      );
      this.turretYaw += this.turretRate * dt;
      const wantPitch = Math.max(tur.pitchMin, Math.min(tur.pitchMax, d.aimPitch));
      this.gunRate = slewRate(
        dt,
        wantPitch - this.gunPitch,
        this.gunRate,
        tur.elevationRate,
        tur.elevationAccel,
        tur.settleTime,
      );
      this.gunPitch += this.gunRate * dt;
    } else {
      this.turretRate = 0;
      this.gunRate = 0;
    }
    // Drawn relative to the hull, held in the world: turning the hull under a
    // held gun must not drag the gun round with it.
    this.rig.turret.rotation.y = angleDelta(this.yaw, this.turretYaw);
    // A positive X rotation tips a box's +Z face DOWN, so the gun's elevation
    // is the negative of it.
    if (this.rig.gun) this.rig.gun.rotation.x = -this.gunPitch;

    // Sideways is `speed * yawRate` and nothing else: a neutral-steer pivot at a
    // standstill has no lateral acceleration in it, and a hull that leaned into
    // one would be leaning against a force that is not there.
    const accel = dt > 0 ? (this.speed - speedWas) / dt : 0;
    const lateral = this.speed * yawRate;
    this.leanHull(dt, accel, lateral);
    // After the hull, never before it: the whips answer to how fast the node
    // they hang off is turning, and that rate is a difference `leanHull` has
    // only just finished computing.
    this.flexAntennae(dt, accel, lateral);
    this.sync();
  }

  /**
   * One frame of a hull SOMEBODY ELSE is driving — the authority's copy of a
   * player's tank, or a client's copy of anybody's.
   *
   * `update`'s twin, and the split between them is exactly the split
   * `docs/multiplayer.md` makes for a body: what a driver DECIDES arrives from
   * outside, and everything that is a fact about the world the hull is
   * standing in is re-derived here rather than sent. So the drive, the
   * throttle curve and the turret's slew are gone — those produced the numbers
   * that just arrived — and the ground, the lean, the suspension, the tracks
   * and the masts all run exactly as they do for a driven hull.
   *
   * **The height is the LOCAL probe's and not the wire's**, which is the one
   * decision in here worth arguing. Every client and the server hold the
   * identical collider world and heightfield, so ten track contacts answer the
   * same question the same way on all of them — and answering it locally costs
   * one probe fan that a parked hull skips anyway, while sending it would put
   * an interpolated `y` in a fight with the plank the springs are measured
   * against. What the wire's `y` is kept for is the RESYNC: a difference of
   * more than a metre is not float noise, it is a hull that has driven off
   * something or been put back on its hardstanding, and the local guess has to
   * be abandoned rather than climbed out of at the kerb rate.
   *
   * `speed` is MEASURED from the ground covered, for `Match.movingFor`'s
   * reason one scale up: it is what the tracks, the engine note and the climb
   * limiter all read, and a driver reporting it could report anything. A hull
   * that is being shoved sideways by the interpolator still runs its belts,
   * which is right — that is what a track slipping looks like.
   */
  updateRemote(
    dt: number,
    x: number,
    y: number,
    z: number,
    yaw: number,
    turretYaw: number,
    gunPitch: number,
  ): void {
    if (this.wreckT > 0) this.wreckT = Math.max(0, this.wreckT - dt);
    const t = this.spec;
    const c = t.drive;
    const half = t.hull.height / 2;
    const p = this.body.position;
    const speedWas = this.speed;

    // What the hull actually covered, resolved onto the heading it arrived
    // with. The lateral share is deliberately dropped: `speed` is a scalar on
    // the tracks and there is nowhere for a sideways velocity to go, which is
    // the same statement `fireGun` makes about the gun's recoil.
    const along = (x - p.x) * Math.sin(yaw) + (z - p.z) * Math.cos(yaw);
    // **Bounded by what a hull can actually do**, which is not the same as
    // what the interpolator just did. A frame that runs long — a stall, a GC
    // pause, a tab coming back — advances the render clock further than its
    // clamped `dt` says, so the ground covered over that step divides out at
    // several times road speed. Everything downstream reads this as the
    // hull's own motion: the belts scroll at it, `standOnGround` sizes its
    // climb step by it, and the difference frame to frame is the acceleration
    // the springs answer to. Left unbounded, one long frame slams the
    // suspension onto its stops and runs the tracks like a conveyor for a
    // hull that was driving perfectly steadily.
    const raw = dt > 0 ? along / dt : 0;
    const top = c.maxSpeed;
    this.speed = Math.max(-c.reverseSpeed, Math.min(top, raw));
    const yawRate = dt > 0 ? angleDelta(this.yaw, yaw) / dt : 0;
    this.yaw = yaw;
    this.body.rotation.y = yaw;
    p.x = x;
    p.z = z;
    // See the header: the probe owns `y` unless the wire says the hull is
    // somewhere the probe could not have walked it to.
    const wantY = y + half;
    if (Math.abs(p.y - wantY) > REMOTE_RESYNC_Y) {
      p.y = wantY;
      this.velY = 0;
      this.grounded = false;
    }
    this.turretYaw = turretYaw;
    this.gunPitch = gunPitch;

    if (!this.alive) {
      // A wreck standing where it died: the same three lines `update` spends
      // on one, for the same reasons. Nothing arriving from the wire moves it,
      // so this is purely the picture running down.
      if (this.body.isEnabled()) {
        this.standOnGround(dt);
        this.flexHeave(dt);
        this.flexAntennae(dt, 0, 0);
      }
      this.sync();
      return;
    }

    // The gun's own clock keeps running on this side too, so a client can draw
    // a loaded gun and the authority is not the only thing that knows. Nothing
    // here fires: `fireGun` is the driver's or the crew's.
    this.reloadT = Math.max(0, this.reloadT - dt);

    // The belts, off the drive that was just measured — `update`'s arithmetic
    // to the letter, including the skip for a hull doing neither.
    if (this.speed !== 0 || yawRate !== 0) {
      const differential = (yawRate * this.rig.gauge) / 2;
      this.trackRun[0] += (this.speed + differential) * dt;
      this.trackRun[1] += (this.speed - differential) * dt;
      // **The steer a watcher sees is DERIVED here and reported nowhere**,
      // which is the bargain the lean, the heave and the belts already make:
      // the wire carries where a hull ended up and every client works the
      // picture out for itself. A yaw rate over the turn the drive could have
      // asked for at this speed IS the stick that produced it.
      const turn = this.steerAuthority();
      this.rig.setRun(
        this.trackRun[0],
        this.trackRun[1],
        Math.abs(turn) > 1e-4 ? Math.max(-1, Math.min(1, yawRate / turn)) : 0,
      );
    }
    if (Math.abs(this.speed) > 1e-3) this.aimCollider();

    this.standOnGround(dt);
    this.flexHeave(dt);

    // Held in the world and drawn against the hull, exactly as `update` does
    // it: the turret is an absolute bearing and the hull turning under it must
    // not drag it round. An unarmed hull takes `update`'s rule here too — the
    // wire carries a `tyaw` for every hull and this is what makes the one it
    // carries for a turretless one harmless.
    if (!this.armed) {
      this.turretYaw = this.yaw;
      this.gunPitch = 0;
    }
    this.rig.turret.rotation.y = angleDelta(this.yaw, this.turretYaw);
    if (this.rig.gun) this.rig.gun.rotation.x = -this.gunPitch;

    const accel = dt > 0 ? (this.speed - speedWas) / dt : 0;
    const lateral = this.speed * yawRate;
    this.leanHull(dt, accel, lateral);
    this.flexAntennae(dt, accel, lateral);
    this.sync();
  }

  /**
   * Carries the collision sphere to the LEADING end of the hull.
   *
   * Babylon's `ellipsoidOffset` is a WORLD-space displacement of the collider
   * from the mesh's origin and is not rotated by anything, so the bias along
   * the hull's forward has to be rebuilt whenever the hull turns — which is
   * every frame it is driven. Written only on the frames the hull actually
   * moves, since that is the only time the offset is read.
   *
   * The sign follows the direction of travel and is only ever changed while
   * the drive is passing through zero, which is the whole of why the flip is
   * safe: the reference point jumps the length of the hull when it changes,
   * and the end it jumps to is the end the tank has just driven away from.
   */
  private aimCollider(): void {
    const t = this.spec;
    // The SIGN is the only thing here that waits for motion. Where the sphere
    // sits is a fact about the yaw and has to be written whenever the yaw
    // moves; which END it sits at is a fact about the direction of travel, and
    // the safe moment to change that is while the speed is passing through
    // zero — see `leadSign`.
    if (Math.abs(this.speed) > 1e-3) this.leadSign = this.speed > 0 ? 1 : -1;
    const bias = (t.hull.length / 2 - t.drive.collideRadius) * this.leadSign;
    this.body.ellipsoidOffset.set(
      Math.sin(this.yaw) * bias,
      t.drive.climbHeight / 2,
      Math.cos(this.yaw) * bias,
    );
  }

  /**
   * Pushes the hull back out of anything its collision sphere has ended up
   * INSIDE, at `drive.freeRate`.
   *
   * ## Why a vehicle needs this and a body does not
   *
   * `moveWithCollisions` sweeps a TRANSLATION. It is the whole of what stops a
   * hull and it is blind to the other two ways this vehicle moves its own
   * collider, and both of them are the yaw:
   *
   * - **Turning swings the sphere.** It rides `hull.length / 2 -
   *   collideRadius` — 1.4 m — off the hull's centre, so a yaw carries it
   *   round on that arm at up to `turnRate * 1.4`, 1.26 m/s, through whatever
   *   the tank is beside. Nothing tests it, and nothing can: the hull's
   *   rotation is not collided at all, which `docs/vehicles.md` has always
   *   said and which is fine for the HULL and was never fine for the sphere.
   * - **A stopped hull used to bank that swing up and spend it at once**,
   *   because the offset was only written on a frame the hull was moving.
   *   `update` now aims it on a turn as well, which turns the teleport into
   *   the rate above — and a rate is a thing this can beat.
   *
   * A body has neither problem: `Player`'s capsule is round, centred, and
   * turning it moves nothing.
   *
   * ## Why the engine cannot do it
   *
   * Babylon ejects an embedded collider by `CollisionsEpsilon * 10` per frame
   * in the space it has SCALED by the ellipsoid — 0.022 m of world at this
   * radius, measured as exactly that constant on every frame of every hang.
   * The drive pushes back in at up to 11 m/s, so the hull sits in the wall
   * with the stick held: 1.5 s of full throttle moved one 0.02 m, and letting
   * go and pressing again moved it 0.00. It came out when the GUN was fired,
   * because `fireGun` writes a velocity straight into `speed` and clears the
   * 0.022 in one frame — which is a bug reporting itself as a workaround.
   *
   * ## What it asks
   *
   * `ObstacleField.resolve`, which is the same bucketed push-out that keeps a
   * bot out of a tree and the same primitive `supportAt` already asks ten
   * times a frame. The BAND is the hull's own two numbers and they are the
   * pair `rideableAt` uses, so what the tank is pushed out of and what it
   * steers around cannot come apart: a top face inside `climbHeight` is
   * something the tracks ride over rather than something to be ejected from,
   * and an underside above the hull's roof is an archway.
   *
   * **The correction is the SPHERE's and the hull carries it**, so it is
   * applied to `body.position` and not to the offset — the offset is where the
   * sphere sits on the tank, and moving it would leave the collider somewhere
   * the vehicle is not.
   *
   * **It is a rate and never a snap**, for `climbSlope`'s reason one axis
   * over: a seven-metre hull moved sideways in one frame is a teleport, and
   * anything that arrived gradually can leave gradually. Nothing here touches
   * `speed`: being pushed out of a wall is a correction to a position the
   * drive should never have reached, not a force the tracks felt.
   */
  private freeFromWalls(dt: number): void {
    const obstacles = this.obstacles;
    this.clearing = false;
    if (!obstacles) return;
    const t = this.spec;
    const p = this.body.position;
    const e = this.body.ellipsoidOffset;
    const cx = p.x + e.x;
    const cz = p.z + e.z;
    const tracks = p.y - t.hull.height / 2;
    if (
      !obstacles.resolve(
        cx,
        p.y,
        cz,
        t.drive.collideRadius,
        this.clear,
        tracks + t.drive.climbHeight,
        tracks + t.hull.height,
      )
    ) {
      return;
    }
    const dx = this.clear.x - cx;
    const dz = this.clear.z - cz;
    const want = Math.hypot(dx, dz);
    if (want < 1e-4) return;
    const step = Math.min(want, t.drive.freeRate * dt);
    p.x += (dx / want) * step;
    p.z += (dz / want) * step;
    // Still owed: keep asking next frame even if the driver has let go of
    // everything. See `clearing`.
    this.clearing = step < want;
  }

  /**
   * Could this hull drive onto `(x, z)`, `reach` metres away from where it
   * stands?
   *
   * **This is the road graph a tank does not have, and it is answered
   * ANALYTICALLY rather than baked** — which is the whole reason an AI driver
   * became possible without one. `NavGrid`'s node is a body's standing
   * surface and a 7.2 m hull cannot use one; but the question a driver
   * actually needs answered is not "what is the route", it is "is that way a
   * wall", and this vehicle has already had to answer exactly that ten times a
   * frame to stand on its tracks. `standOnGround` spends the answer on where
   * the hull IS; this spends the same query on where it is ABOUT to be.
   *
   * Both halves of the world are asked, for the reason `supportAt` asks both:
   * the boxes have no floor in them and the heightfield has no kerb.
   *
   * - The boxes, through `ObstacleField.wallAt`, in the hull's own climb band —
   *   **the same `climbHeight` the collision ellipsoid's floor is set from**,
   *   so what the driver steers around and what the hull is actually stopped
   *   by are one number and cannot drift apart. That invariant is the whole of
   *   `climbHeight`'s contract; see the constructor.
   * - The terrain, as a GRADE rather than a height, because a rise this hull
   *   can climb at its own speed is not an obstacle at all: the allowance is
   *   `climbSlope` over the distance being asked about, plus the step the hull
   *   would ride anyway. The same expression bounds the DROP, so a driver
   *   turns away from the lip of a cliff rather than finding out.
   *
   * It is a STEERING answer, never a collision one. `moveWithCollisions` is
   * still what stops a hull, `standOnGround` is still what stands it up, and a
   * wrong answer here costs a detour and never a position. Cheap enough that
   * the number of whiskers is a design decision: one bucket walk and one
   * heightfield sample, the same pair a track contact costs.
   */
  rideableAt(x: number, z: number, reach: number): boolean {
    const t = this.spec;
    const c = t.drive;
    const tracks = this.body.position.y - t.hull.height / 2;
    if (
      this.obstacles?.wallAt(x, z, tracks + c.climbHeight, tracks + t.hull.height)
    ) {
      return false;
    }
    const rise = this.terrain.surfaceAt(x, z) - tracks;
    const allow = c.climbHeight + reach * c.climbSlope;
    return rise <= allow && rise >= -allow;
  }

  /**
   * The height of this hull's DECK above `(x, z)`, or null when a body standing
   * there would not be on it. `ObstacleField.groundAt`'s band, term for term,
   * so a caller can take the higher of the two without reconciling anything.
   *
   * **This exists because a hull is in no baked structure and a body can stand
   * on one.** `NavGrid`, `CoverMap`, `ObstacleField` and the collision bake are
   * all built once from the finished collider set at map load, and a thing that
   * MOVES cannot be in any of them — that is the ragdoll's rule, and the hull is
   * an instance of it rather than an exception to it. For as long as
   * `Player.probeGround` was a whole-scene ray that gap cost nothing, because
   * the pick found the hull's own mesh like any other `solid` one. The analytic
   * probe reads boxes, the boxes are the STATIC world, and so climbing onto a
   * tank had to be given a door of its own. `VehicleSystem` is what fans this
   * over the fleet; `Game` wires that to the player.
   *
   * Answered through `boxGeometry`'s own primitive off a scratch `WorldBox`
   * rather than by rolling the transform out here. The yaw convention has been
   * got wrong once already (see `rotateToLocalXZ`), and a deck resolved in a
   * mirrored frame would be a strip of standable air beside every hull parked
   * at an angle. `rotX` is 0 and stays 0: the collider never tilts, only the
   * PICTURE leans.
   *
   * The enabled/pickable gate is `SOLID_ONLY`'s, deliberately — a WRECK keeps
   * its collider for `wreckTime` because a burnt-out hull in the street is
   * cover, and a body may stand on it for exactly as long as a round stops on
   * it. `hide` is what ends both.
   */
  deckAt(x: number, z: number, ceiling: number, floor: number): number | null {
    const b = this.rayBox();
    if (!b) return null;
    const top = topFaceHeight(b, x, z);
    return top === null || top > ceiling || top < floor ? null : top;
  }

  /**
   * True when a body standing at `feet` with its hit sphere at `center` is
   * UNDER this hull — which, on a hull that is moving, is a body being run
   * over. The geometry half of a crush; `Game.crushSweep` and its authority
   * twin own the rule, exactly as `resolveShell` owns the rule over `fireGun`.
   *
   * **Horizontally it is the sphere and vertically it is the feet**, and the
   * split is what gets the one case that matters right. A footprint padded by
   * `hitRadius` is the same shape a round is tested against, so a tank kills
   * whom it visibly hits and the man half a stride outside the tracks lives.
   * But the sphere cannot answer the vertical question: a body's is 1.5 m tall
   * against a 2.9 m box, so a man CROUCHING on the deck still has his chest
   * inside it and would be run over by the hull he is standing on. The feet
   * cannot be anywhere but on top of it or under it, so they are what is
   * asked: below the deck is under the tracks, on it is riding, and riding on
   * a hull is the one thing a crush must not take away.
   *
   * The other end of the band is the sphere again, and it is what spares a man
   * in the street under a bridge a tank is crossing: his whole body is below
   * the hull's floor, and nothing at all of him is inside it.
   *
   * Nearest-point-on-footprint against the sphere's radius, in the box's own
   * frame through the one place the yaw convention lives. Both height terms
   * are unrotated because `rotX` is 0 on this box and stays 0 — `rayBox`
   * writes it once and the collider never tilts, only the picture leans.
   *
   * The enabled/pickable gate is `rayBox`'s, so a hull that has been taken
   * away crushes nothing. A WRECK still can, and never does: nothing moves one.
   */
  crushes(center: Vector3, feet: number, radius: number): boolean {
    const b = this.rayBox();
    if (!b) return false;
    // The cheap half first: two comparisons that reject a body on the deck
    // above and a body under the floor below, before anything is rotated.
    if (feet >= b.cy + b.h / 2 || center.y + radius <= b.cy - b.h / 2) {
      return false;
    }
    rotateToLocalXZ(b, center.x, center.z, this.crushLocal);
    const dx = Math.abs(this.crushLocal.lx) - b.w / 2;
    const dz = Math.abs(this.crushLocal.lz) - b.d / 2;
    const ox = dx > 0 ? dx : 0;
    const oz = dz > 0 ? dz : 0;
    return ox * ox + oz * oz <= radius * radius;
  }

  /**
   * The scratch `crushes` rotates into. Its own rather than shared with the
   * `deckBox` next door: that one is the BOX being asked about and this is the
   * POINT asking, and neither is held across a call.
   */
  private readonly crushLocal: LocalXZ = { lx: 0, lz: 0 };

  /**
   * The hull as an oriented box for `RayWorld`, or null when it is out of every
   * ray — `RayHull`'s one method.
   *
   * The gate and the scratch are `deckAt`'s, which is what this was factored
   * out of, and both are the same statement made twice over: the enabled and
   * pickable terms are `SOLID_ONLY`'s, deliberately, because a WRECK keeps its
   * collider for `wreckTime` and a round stops on it for exactly as long as a
   * body may stand on it. `hide` is what ends both. `rotX` is 0 and stays 0:
   * the collider never tilts, only the PICTURE leans.
   *
   * The two callers that must take their OWN hull out of a query pass `this`
   * as `RayWorld`'s `skip` rather than writing `isPickable` around the call,
   * which is what they did to a `scene.pickWithRay`.
   */
  rayBox(): WorldBox | null {
    if (!this.body.isEnabled() || !this.body.isPickable) return null;
    const hull = this.spec.hull;
    const b = this.deckBox;
    b.w = hull.width;
    b.h = hull.height;
    b.d = hull.length;
    b.cx = this.body.position.x;
    b.cy = this.body.position.y;
    b.cz = this.body.position.z;
    b.rotY = this.body.rotation.y;
    return b;
  }

  /**
   * The hull as a `WorldBox`, rewritten per query and never held across one. A
   * scratch rather than a field kept in step with the body, because the
   * body is what moves and a cached copy is a second opinion about where the
   * tank is; and never a real entry in `colliderBoxes`, because everything that
   * reads that list was baked before this hull moved. `rotX` is written once
   * here and never again.
   */
  private readonly deckBox: WorldBox = {
    w: 0,
    h: 0,
    d: 0,
    cx: 0,
    cy: 0,
    cz: 0,
    rotX: 0,
    rotY: 0,
  };

  /**
   * The surface one track contact is standing on: the highest collider top
   * face inside the band, or the terrain under it, whichever is higher.
   *
   * The band is closed at both ends and both ends are load-bearing. `ceiling`
   * is a climb height above the tracks, so anything taller than the hull will
   * ride over is not ground at all — the same number the collision ellipsoid's
   * floor is set from, and the two must not drift apart. `floor` is as far
   * down as the contact looks before it stops caring, which is what lets a
   * hull driven off a ledge find nothing and fall.
   *
   * The terrain is taken unbanded because the heightfield is not a box and
   * cannot be one: it is the map's own floor, it is always under the hull
   * somewhere, and `surfaceAt` rather than `heightAt` because what a tank
   * stands on is the floor as DRAWN.
   */
  private supportAt(x: number, z: number, ceiling: number, floor: number): number {
    const box = this.obstacles?.groundAt(x, z, ceiling, floor) ?? null;
    const ground = this.terrain.surfaceAt(x, z);
    return box !== null && box > ground ? box : ground;
  }

  /**
   * Stands the hull on its tracks, and lets it fall off anything it drives
   * over the edge of.
   *
   * ## The plank
   *
   * `CONTACT_ROWS` places along each belt are sampled, and the hull is the
   * rigid plank they hold up. That is solved in two passes and the ORDER of
   * them is the whole trick:
   *
   * 1. **The attitude**, from the ends against each other: nose-up is the rise
   *    from the aft pair to the fore pair over the wheelbase, and roll is the
   *    same across the gauge. Both clamped to `tiltLimit`.
   * 2. **The height**, as the lowest plane at that attitude with no contact
   *    poking through it. Every contact says how high the hull's centre would
   *    have to be for the plane to clear it, and the plank takes the largest.
   *
   * Doing it the other way round — a height first, then a lean — is what a
   * single centre probe effectively did, and it is why a car used to launch a
   * tank: with no pitch in hand, a plane clearing a 1.1 m nose contact is a
   * hull sitting 1.1 m up in the air, level, with its tail off the ground.
   * With the pitch taken first the same contact asks for 0.55 and a nose-up of
   * ten degrees, which is a tank tipped up over a car.
   *
   * It also gets the cliff right for free, which the average of the ends would
   * not: a hull with its nose over a ledge has a fore contact far below and an
   * aft one on the deck, and the aft constraint is the binding one — so the
   * hull hangs on its tail at the drop's own lip and tips rather than floating
   * out over the middle of the gap.
   *
   * ## The rise
   *
   * A contact crossing the edge of a car steps a metre between two frames, so
   * the plank's answer is a step function and taking it literally is a
   * teleport. `climbSlope` bounds the rise by the ground the hull has actually
   * covered — nothing climbs faster than the steepest grade it can hold — and
   * `climbFloor` keeps a stopped hull from being stranded under ground that
   * came up beneath it. Falling is left to gravity, which needs no limit: a
   * hull driven off a roof is supposed to drop like one.
   */
  private standOnGround(dt: number): void {
    const t = this.spec;
    const c = t.drive;
    const half = t.hull.height / 2;
    const p = this.body.position;
    this.climbOwed = 0;
    // Nothing measured yet, so nothing for the springs: a hull that skips the
    // question below owes `flexHeave` a zero rather than last frame's landing.
    this.jolt = 0;
    // Anything that could have changed what is underfoot re-arms the question;
    // a hull that is stopped, standing and settled asks nothing. See
    // `needsGround`.
    if (Math.abs(this.speed) > 1e-3) this.needsGround = true;
    if (!this.needsGround && this.grounded) return;

    const tracks = p.y - half;
    const ceiling = tracks + c.climbHeight;
    const floor = tracks - c.probeLength;
    // Forward is `(sin yaw, cos yaw)`, so right is `(cos yaw, -sin yaw)`.
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const reach = this.rig.contactReach;
    const wide = this.rig.gauge / 2;
    const h = this.contacts;
    // Fore to aft; right belt then left within each row. `contactLong` and
    // `contactLat` reproduce this order and both passes below walk it.
    for (let i = 0; i < CONTACT_COUNT; i++) {
      const l = contactLong(i, reach);
      const lat = contactLat(i, wide);
      h[i] = this.supportAt(
        p.x + fx * l + fz * lat,
        p.z + fz * l - fx * lat,
        ceiling,
        floor,
      );
    }

    // --- the attitude the contacts are asking for ---
    const lim = c.tiltLimit;
    const clamp = (v: number) => Math.max(-lim, Math.min(lim, v));
    const front = Math.max(h[0], h[1]);
    const rear = Math.max(h[CONTACT_COUNT - 2], h[CONTACT_COUNT - 1]);
    let right = -Infinity;
    let left = -Infinity;
    for (let i = 0; i < CONTACT_COUNT; i += 2) {
      if (h[i] > right) right = h[i];
      if (h[i + 1] > left) left = h[i + 1];
    }
    // Nose-up, and positive. A positive X rotation tips the nose DOWN, so what
    // the drawn node is given is the negative of it.
    const rise = clamp(Math.atan2(front - rear, reach * 2));
    const roll = clamp(Math.atan2(right - left, wide * 2));
    this.groundPitchTarget = -rise;
    this.groundRollTarget = roll;

    // --- the height that attitude needs ---
    const tanRise = Math.tan(rise);
    const tanRoll = Math.tan(roll);
    let plank = -Infinity;
    for (let i = 0; i < CONTACT_COUNT; i++) {
      // What this contact would put the hull's centre at, given the lean: the
      // plane is `y + l * tanRise + lat * tanRoll`, so the centre it demands is
      // the contact less those two.
      const need =
        h[i] - contactLong(i, reach) * tanRise - contactLat(i, wide) * tanRoll;
      if (need > plank) plank = need;
    }
    this.floorY = plank;

    const target = plank + half;
    // How fast the plank itself is moving, which is the velocity a hull merely
    // RESTING on it has — and the only vertical velocity a hull is allowed to
    // carry off the end of something. See `drive.launchSpeed`.
    const plankRate = dt > 0 ? (target - this.lastTarget) / dt : 0;
    this.lastTarget = target;
    const riseWas = this.riseRate;
    // **Gravity is asked FIRST and it is asked whatever the hull is doing**,
    // because where the hull would be with nothing under it is what decides
    // whether there is anything under it. A plank dropping away slower than
    // gravity is still ground and the hull rides it down; one dropping away
    // faster is a hull that has driven off something.
    //
    // Which is the whole of what replaced a height test on the plank alone.
    // That version fell for a frame, landed, zeroed the velocity and fell
    // again, so a tank driving down a slope chattered at a tenth of a metre —
    // and every one of those landings is an impact the springs below would now
    // answer to. A hull following the ground down carries the GROUND's own
    // rate and lands exactly once, when there is finally nothing there.
    const vFree = this.velY - c.gravity * dt;
    const yFree = p.y + vFree * dt;
    if (yFree > target) {
      p.y = yFree;
      this.velY = vFree;
      this.riseRate = vFree;
      this.grounded = false;
      this.needsGround = true;
    } else {
      // Held up. Ride up — never snap — and take whatever coming down is left
      // as it comes: falling has no rate limit, because falling is gravity's.
      const step = Math.max(c.climbFloor, Math.abs(this.speed) * c.climbSlope) * dt;
      const to = Math.min(target, p.y + step);
      // **The rate that leaves this frame is the one the hull is now MOVING
      // at, never the fraction of it this frame happened to spend**, and the
      // difference is the whole of a landing. A hull dropping at 11 m/s onto a
      // plank 16 cm below it covers that 16 cm and stops: read as an achieved
      // rate the frame reports -9.5 and hands the springs a jolt of 1.5, and
      // the other 9.5 is never handed over at all — the hull is settled by
      // then, `needsGround` has gone false and the frame that would have said
      // so never runs. Measured before it was fixed: a wreck dropped three
      // metres compressed its springs 3 cm, where driving off a car compressed
      // 7. A hull that has arrived is moving at the plank's rate, and a hull
      // still owing a climb is moving at the limiter's.
      this.riseRate = to < target ? (dt > 0 ? (to - p.y) / dt : 0) : plankRate;
      // **What a hull carries off the end of something is the GROUND's rate
      // and never the limiter's**, and the two are only the same number when
      // the tracks have caught up with what they are standing on. A hull still
      // owing a climb is being SHOVED — that is a constraint and there is no
      // momentum in it — where a hull riding the ground up a grade genuinely
      // has the rise in hand and takes it over the crest. Get that wrong and
      // every kerb in the city throws the tank into the air.
      this.velY = Math.min(to < target ? 0 : plankRate, c.launchSpeed);
      p.y = to;
      this.climbOwed = target - to;
      this.grounded = true;
      // Down, stopped and level with what is under it: the answer cannot change
      // again until something moves.
      if (Math.abs(this.speed) <= 1e-3 && this.climbOwed <= 1e-4) {
        this.needsGround = false;
      }
    }
    // What the ground just did to the hull's own vertical motion, which is the
    // one input the sprung mass has. Nothing here knows whether it was a
    // landing, a kerb or the top of a car — see `flexHeave`, and
    // `suspension.joltLimit` for why a one-frame answer is bounded.
    const jl = this.spec.suspension.joltLimit;
    this.jolt = Math.max(-jl, Math.min(jl, this.riseRate - riseWas));
  }

  /**
   * The whole of the drawn hull's attitude: the ground it is standing on, plus
   * what its own mass is doing to it, written to the rig in one place.
   *
   * Cosmetic in the strict sense — the collider box never tilts, so nothing
   * here can move where a round goes, where a body may stand or what a
   * sightline breaks on. A driver reads it and nothing else does.
   *
   * The write is guarded rather than unconditional because two of these are
   * parked on hardstandings doing nothing for most of a round, and an
   * assignment to a `TransformNode`'s rotation is a world matrix to recompute
   * whether or not the number changed. Same rule as `trackRun`'s skip and
   * `needsGround`'s.
   */
  private leanHull(dt: number, accel: number, lateral: number): void {
    this.leanToGround(dt);
    this.flexSuspension(dt, accel, lateral);
    // **The two halves are written to two DIFFERENT NODES, and that is the
    // whole of the difference between a tank on a suspension and a tank being
    // tilted.** The ground half is the whole vehicle standing on a slope, so
    // the running gear goes with it; the suspension half is the BODY moving
    // against running gear that stays where the ground put it, so it goes on
    // `sprung` beside the heave. Summed onto one node, a nose-down dive took
    // the tracks down with it and drove the leading end of the vehicle under
    // the road — which is what the ground had just finished standing it on.
    const g = this.rig.hull.rotation;
    if (
      Math.abs(this.groundPitch - g.x) > 1e-5 ||
      Math.abs(this.groundRoll - g.z) > 1e-5
    ) {
      g.x = this.groundPitch;
      g.z = this.groundRoll;
    }
    const b = this.rig.sprung.rotation;
    if (
      Math.abs(this.suspPitch - b.x) > 1e-5 ||
      Math.abs(this.suspRoll - b.z) > 1e-5
    ) {
      b.x = this.suspPitch;
      b.z = this.suspRoll;
    }
    // How fast the MAST FEET are turning, which is what the antennae bend
    // against, and it is still the SUM: a whip hangs off the turret, which
    // rides on the sprung body, which hangs off the hull, so its foot carries
    // both halves. A hull tipping onto a kerb rotates it exactly as one
    // rocking on its own springs does, and a whip cannot tell the two apart.
    const pitch = this.groundPitch + this.suspPitch;
    const roll = this.groundRoll + this.suspRoll;
    if (dt > 0) {
      this.leanRateX = (pitch - this.leanX) / dt;
      this.leanRateZ = (roll - this.leanZ) / dt;
    }
    this.leanX = pitch;
    this.leanZ = roll;
  }

  /**
   * Eases the drawn hull onto the attitude its track contacts are asking for.
   *
   * **All the measuring is `standOnGround`'s and none of it is here**, which is
   * the whole difference between this and what it replaced. It used to sample
   * four points of the terrain FIELD — because four more whole-scene ray picks
   * for a picture was not affordable — and then fade the result out by how far
   * the tracks were above that field, so a hull standing on a road slab or a
   * parkade deck sat dead level rather than leaning onto a heightfield it was
   * nowhere near. The contacts answer against the collider boxes as well as the
   * field, so the structure a tank is standing on is simply part of the ground
   * and the fade has nothing left to do.
   *
   * What stays is the lerp. The target is a fact about the world and cannot be
   * overshot, and it is the half of the hull's attitude that must not ring —
   * the spring next door is the half that must.
   */
  private leanToGround(dt: number): void {
    const c = this.spec.drive;
    // Nothing off the ground can change which way it is pointing. The target
    // is measured against the ground BELOW the hull, which a falling tank is
    // nowhere near — so in the air the lerp all but stops and the hull lands on
    // the attitude it left with. See `drive.airTiltRate`.
    const k = Math.min(1, dt * (this.grounded ? c.tiltRate : c.airTiltRate));
    this.groundPitch += (this.groundPitchTarget - this.groundPitch) * k;
    this.groundRoll += (this.groundRollTarget - this.groundRoll) * k;
  }

  /**
   * How much travel a tilt is asking of its outermost station, in metres.
   *
   * `WHEEL_REACH` and not `TRACK_REACH`: a bump stop is something a road-wheel
   * ARM reaches, and the sprocket and the idler hang off the hull with no arms
   * at all. The two axes SUM because one station is the corner both of them
   * reach — a hull diving and leaning at once puts the same wheel nearest its
   * stop twice over.
   */
  private stationTravel(pitch: number, roll: number): number {
    return (
      this.rig.wheelReach * Math.abs(Math.sin(pitch)) +
      (this.rig.gauge / 2) * Math.abs(Math.sin(roll))
    );
  }

  /**
   * What a spring's rate is multiplied by once `f` of its travel is spent.
   *
   * **A PROGRESSIVE spring is the difference between a suspension that runs
   * out and a suspension that resists**, and it is one number:
   * `1 + progression * f^2`. Squared, so the first part of the travel is
   * within a few per cent of the plain rate and the last part is where the
   * pack goes solid — a spring that hardened linearly from rest would be a
   * stiffer spring rather than a progressive one, and would take the small
   * movements away along with the flop.
   *
   * **It changes where a spring SETTLES and not just how fast it gets there**,
   * which is the whole of what it is for: the drive term is untouched, so a
   * steady acceleration now solves `x * rate(x) = want` instead of `x = want`
   * and the answer is inside the travel where the old one was on the stop.
   *
   * **The stops are not what this replaces.** They are still there and still
   * spend one budget — this is the ramp up to a wall that used to be a wall on
   * its own, and a hull that has spent its travel on one axis still has none
   * left for the other. What it does change is who arrives at them: on a
   * progressive hull the tilt reaches a stop on turn-in and comes off it,
   * where it used to lie against one, and the heave stops arriving at all —
   * see `truck.suspension.heaveBump` for why that is a reserve and not dead
   * space.
   *
   * At `progression: 0` it returns 1 and every spring in the file is the exact
   * arithmetic it was, which is what a tank gets.
   */
  private springRate(f: number): number {
    const p = this.spec.suspension.progression;
    if (p <= 0) return 1;
    const spent = Math.min(1, Math.max(0, f));
    return 1 + p * spent * spent;
  }

  /**
   * What the hull's own mass does to it: the nose dives under the brake, squats
   * under power, and the body leans out of a turn.
   *
   * **A hull that stayed perfectly level was the tell that a tank was a box
   * being slid rather than a mass being driven**, and the fix is not more
   * animation but the arithmetic that was already there: the drive knows the
   * acceleration it achieved and the yaw rate it turned at, and weight transfer
   * is those two numbers and a spring.
   *
   * Two springs, one per axis, driven toward an angle proportional to the
   * acceleration along that axis:
   *
   * - **Pitch** answers to `accel` along the hull's own forward, which is a
   *   DIFFERENCE and not the throttle — coasting, braking and driving into a
   *   building all decelerate, and only the last of them is unasked for. The
   *   input is clamped (`accelLimit`) because a collision spends most of road
   *   speed in a single frame, and the output is bounded by the STOPS below.
   * - **Roll** answers to `speed * yawRate`, the lateral acceleration of the
   *   turn. That is zero for a neutral-steer pivot on the spot, which is
   *   correct: the hull is rotating, not cornering, and there is nothing for it
   *   to lean against.
   *
   * **What bounds the answer is a TRAVEL and not an angle, and that is the
   * second half of the fix the node split is the first half of.** A real
   * tracked suspension runs out where a road-wheel arm meets its bump stop, so
   * how far the body may tilt is how much travel is left at the outermost
   * station divided by how far out that station is — and the heave draws on
   * the same stops, so the two are spent from ONE budget rather than clamped
   * separately at limits that could each be legal and jointly put the belly
   * through the road. It falls out at ~3.3 deg of pitch and ~5.2 deg of roll
   * on the tank, and nothing in `CONFIG` states either number.
   *
   * **The springs get STIFFER the more of that budget they have spent
   * (`suspension.progression`), and that is what keeps a stop an event rather
   * than a driving position.** A linear spring pointed at a target angle
   * outside its travel has nowhere to go but the stop, and it sits there for
   * as long as the input holds with its velocity killed — measured on the
   * truck, where full lock at road speed asks for 19.4 deg against a budget
   * worth 8.2, the body lay on its side through every corner, and **half the
   * steering range produced the same lean as the other half**. What hardens is
   * the RESTORE and never the drive, so the angle a steady acceleration
   * settles at solves `x * rate(x) = want` and lands inside the travel with
   * the curve monotone the whole way out. The tank states 0 and its arithmetic
   * is untouched, exactly and not approximately.
   *
   * Stepped semi-implicit Euler rather than in closed form. `CLAUDE.md`'s rule
   * is that anything that moves where bullets go or reads as recoil is stepped
   * exactly; this moves neither — the gun sits on the turret, which hangs off
   * this node and is aimed in WORLD angles, so a leaning hull does not carry
   * the gun off the aim — and at ~1 Hz Euler holds it comfortably. Same
   * treatment as the camera's landing absorb, and for the same reason.
   */
  private flexSuspension(dt: number, accel: number, lateral: number): void {
    const s = this.spec.suspension;
    const bound = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));
    const felt = bound(accel, s.accelLimit);
    // Accelerating lifts the nose and a positive X rotation puts it down, so
    // the pitch target is the negative of the acceleration. Turning right is a
    // positive yaw rate, and a body thrown left by it stands its RIGHT side up,
    // which is a positive Z.
    const wantPitch = -s.pitchPerAccel * felt;
    const wantRoll = s.rollPerAccel * bound(lateral, s.accelLimit);
    // How much travel a corner station has left, in metres, AFTER `flexHeave`
    // has spent what it spent. A tilt spends both stops at once — one end down
    // is the other end up — so what is left is the smaller of the two
    // remainders, which is why the tilt is bounded by `heaveDroop` rather than
    // by the larger `heaveBump`.
    const room = Math.min(s.heaveDroop - this.heave, s.heaveBump + this.heave);
    // The RATE the two springs are standing at, off the travel they have
    // already spent — ONE number for both axes, because they spend one budget,
    // which is the same argument the stop below makes one step later. Read off
    // where the tilt IS rather than off where this frame is taking it, which
    // is the semi-implicit step the rest of this method takes.
    const rate = this.springRate(
      room > 1e-6 ? this.stationTravel(this.suspPitch, this.suspRoll) / room : 1,
    );
    // **The drive term is the acceleration's and the rate never touches it; it
    // is the RESTORE that hardens.** `stiffness * (want - rate * x)` is the
    // plain `stiffness * (want - x)` at rate 1, which is what a hull with no
    // `progression` gets, exactly and not approximately.
    //
    // The DAMPER hardens with it, as the square root of the rate, so that the
    // damping ratio the two figures were tuned to is the ratio at every point
    // of the travel: a suspension that rang at full lean and not at rest would
    // be two different vehicles. What is left over — the spring's TANGENT rate
    // climbs faster than the secant one the restore is written in — leaves a
    // hull a little livelier the harder it is leaning, which is the direction
    // a truck should err in.
    const damp = s.damping * Math.sqrt(rate);
    this.suspPitchVel +=
      (s.stiffness * (wantPitch - rate * this.suspPitch) - damp * this.suspPitchVel) * dt;
    this.suspRollVel +=
      (s.stiffness * (wantRoll - rate * this.suspRoll) - damp * this.suspRollVel) * dt;
    let pitch = this.suspPitch + this.suspPitchVel * dt;
    let roll = this.suspRoll + this.suspRollVel * dt;
    // --- the stops, which are at the WHEEL STATIONS and not on the angles ---
    //
    // What the springs are asking for now, at the outermost road wheel and the
    // outer edge of a track.
    const asked = this.stationTravel(pitch, roll);
    if (asked > room) {
      // Scaled rather than clamped per axis, because the two are drawing on
      // ONE budget: a hull already leaning hard has less dive left in it, and
      // a hull that has just landed on its bump stops has none at all and goes
      // flat, which is what bottoming out does to a body.
      const scale = room / asked;
      pitch *= scale;
      roll *= scale;
      // A stop absorbs rather than bounces, exactly as `flexHeave`'s does.
      this.suspPitchVel = 0;
      this.suspRollVel = 0;
    }
    this.suspPitch = pitch;
    this.suspRoll = roll;
  }

  /**
   * Settles the hull's BODY onto its running gear, which is the third axis of
   * the suspension and the only one measured in metres.
   *
   * **A hull that stayed exactly as far off its tracks as it was parked at was
   * the last thing making a tank look weightless.** The other two springs
   * answer to the drive, so a tank that was neither accelerating nor cornering
   * had nothing to say — and driving over a car is exactly that: the hull went
   * up, came back down and never once looked like it weighed sixty tonnes,
   * because the only thing that had moved was the whole vehicle, rigidly,
   * exactly as far as the ground told it to.
   *
   * What it answers to is one number and it is not a new measurement:
   * `standOnGround` already knows what the ground did to the hull's own
   * vertical velocity, and **when the ground under a vehicle changes speed the
   * body does not** — the difference IS the deflection. So a landing spends
   * the closing speed into the spring, mounting a kerb spends the rise, the
   * top of a car spends that same rise back the other way, and a hull in the
   * air spends gravity itself and droops onto its stops. One term, four
   * events, and nothing anywhere that knows which of them is happening.
   *
   * **The jolt is spent on the spring's VELOCITY and never on its position**,
   * for the reason `fireGun` kicks the pitch spring's: it is an impulse, so it
   * is frame-rate free — the sum of what a fall hands over does not depend on
   * how many frames the fall took — where an acceleration read off it and
   * clamped would hand a 30 Hz frame twice the landing of a 60 Hz one.
   *
   * **The spring is the progressive one `flexSuspension` describes**, on this
   * axis' own two stops: one suspension has one rate, and a body that has
   * crushed most of its bump rubber is not on the rate it was parked at. What
   * it does NOT do is take the stop away — the most the ground can hand these
   * springs still carries more energy than the hardened spring absorbs inside
   * `heaveBump`, so a real landing still arrives on the stop and rings off it.
   *
   * **The two stops are not the same number, they are not this axis' alone,
   * and `heaveBump` is not a taste**: it is two thirds of `TankModel.BELLY`,
   * so a body compressing much further would put the hull through the road it
   * is driving on — and the third that is left over is what `flexSuspension`
   * is allowed to tilt into. Reaching a stop kills the travel dead and the
   * spring pushes back out, which is what bottoming out is, and a hull that
   * has reached one has no dive left in it either.
   *
   * Cosmetic in `flexSuspension`'s strict sense — this reaches one
   * `TransformNode`'s Y and nothing else. The collider does not move, the gun
   * is aimed in world angles off a turret that rides on this node, and the
   * reticle still cannot lie.
   */
  private flexHeave(dt: number): void {
    const s = this.spec.suspension;
    this.heaveVel -= this.jolt * s.heaveResponse;
    // The hardening the tilt takes, on this axis' own pair of stops — one
    // suspension, one rate, and a body two thirds of the way onto its bump
    // rubber is not standing on the rate it left the ride height at. The two
    // directions normalise against DIFFERENT stops because they ARE different
    // stops: `heaveBump` is a rubber being crushed and `heaveDroop` is a body
    // lifting off its own running gear.
    const rate = this.springRate(
      this.heave < 0 ? -this.heave / s.heaveBump : this.heave / s.heaveDroop,
    );
    this.heaveVel +=
      (-s.heaveStiffness * rate * this.heave -
        s.heaveDamping * Math.sqrt(rate) * this.heaveVel) *
      dt;
    const want = this.heave + this.heaveVel * dt;
    this.heave = Math.max(-s.heaveBump, Math.min(s.heaveDroop, want));
    // A stop absorbs rather than bounces: what is left of the travel is spent
    // in the rubber, and what comes back out is the spring's own doing.
    if (this.heave !== want) this.heaveVel = 0;
    // Guarded for `leanHull`'s reason: two of these are parked doing nothing
    // for most of a round, and a write is a world matrix whether the number
    // moved or not.
    if (Math.abs(this.heave - this.rig.sprung.position.y) > 1e-5) {
      this.rig.sprung.position.y = this.heave;
    }
  }

  /**
   * Bends the two whip antennae.
   *
   * **This is the suspension's own argument one derivative further out, and it
   * is why there is no physics engine anywhere near it.** A mast is a thin
   * cantilever bolted to the turret: it bends because of the acceleration the
   * drive achieved, because of how fast the thing it is bolted to is rotating,
   * and because there is a wind. All three of those numbers are already in this
   * class, and what a whip does with them is one damped spring per axis. A
   * Havok chain would need a kinematic body per link, a constraint per joint
   * and a transform read back per frame — for a picture, on a hull that is
   * moved by `moveWithCollisions` and SNAPPED up to `stepHeight` by the ground
   * probe, which is a teleport as far as a solver is concerned and cracks a
   * jointed chain every time a tank climbs a kerb. See `docs/vehicles.md`.
   *
   * Four terms, and every one of them is in the TURRET's frame rather than the
   * hull's, because that is what the masts hang off: a hull diving under a
   * turret traversed ninety degrees bends its whips SIDEWAYS, and terms written
   * in the hull's axes would lay them back along a tank that was stopping
   * beside them.
   *
   * - **The drive's acceleration**, clamped by `suspension.accelLimit` — the
   *   same clamp for the same one-frame reason, deliberately not restated in
   *   the antenna block. A whip trails what is thrown at it, so the tip goes
   *   the OPPOSITE way to the acceleration: a hull pulling away lays its masts
   *   back, and one that has just hit a building throws them forward.
   * - **Sideways is `speed * yawRate`**, as the hull's roll is, so a
   *   neutral-steer pivot whips nothing sideways. There is no lateral
   *   acceleration in one to whip against.
   * - **The base's own rotation RATE**, which is the term that makes the gun
   *   visible from outside the tank: `fireGun` rocks the hull nose-up in a
   *   fifth of a second, the mast feet go with it and the tips do not, so both
   *   whips bend back and ring. It costs nothing extra and it arrives through
   *   the ground lean too, so kerbs and shell craters crack them for free.
   * - **The wind**, so a parked hull is not two steel rods. Bearing from
   *   `CONFIG.wind.dir` because there is one wind; amplitude and speed its own,
   *   because a mast is not a blade of grass.
   *
   * Then the bow is handed on in two pieces. The spring's angle is the whip's,
   * and the TIP's angle is a lagged copy of it — so during a fast event the
   * upper link is bent back against the lower one and the mast is an S, and
   * once it settles the two agree and it is a smooth bow. See
   * `setAntennaBend`.
   *
   * Stepped semi-implicit Euler like the suspension, and it holds for the same
   * reason: the frame's `dt` is clamped at 0.05 and the faster of the two masts
   * runs at 3.8 Hz, which is `w * dt` of 1.2 against Euler's ceiling of 2. What
   * would break it is a stiffer spring, not a slower frame.
   */
  private flexAntennae(dt: number, accel: number, lateral: number): void {
    const a = this.spec.antenna;
    const lim = this.spec.suspension.accelLimit;
    const bound = (v: number, l: number) => Math.max(-l, Math.min(l, v));
    // Into the turret's own frame: its world yaw is `turretYaw`, so the local
    // one is what the drawn node already carries.
    const phi = this.rig.turret.rotation.y;
    const cs = Math.cos(phi);
    const sn = Math.sin(phi);
    const ax = bound(lateral, lim);
    const az = bound(accel, lim);
    const localAX = ax * cs - az * sn;
    const localAZ = ax * sn + az * cs;
    const rateX = this.leanRateX * cs - this.leanRateZ * sn;
    const rateZ = this.leanRateX * sn + this.leanRateZ * cs;
    const windX = WIND_X * cs - WIND_Z * sn;
    const windZ = WIND_X * sn + WIND_Z * cs;
    // Wrapped at the two sines' COMMON period rather than at either one's, so
    // the gust is continuous across the wrap and the clock does not grow for
    // the length of a round. Same rule as `setTrackRun`'s modulo.
    this.windT = (this.windT + dt) % (200 * Math.PI / a.wind.speed);
    for (let i = 0; i < this.rig.antennae.length; i++) {
      const whip = this.rig.antennae[i];
      // Two sines well off a whole ratio, so the gust does not come round on a
      // metronome — the same trick the grass shader plays, at a mast's rate.
      const t = this.windT * a.wind.speed + whip.phase;
      const puff = a.wind.sway * (Math.sin(t) * 0.7 + Math.sin(t * 0.41) * 0.3);
      // A positive X rotation tips the mast's top toward +Z and a positive Z
      // rotation tips it toward -X, which is where both signs below come from.
      const wantX = -localAZ * a.swayPerAccel - rateX * a.lagPerRate + windZ * puff;
      const wantZ = localAX * a.swayPerAccel - rateZ * a.lagPerRate - windX * puff;
      // One spring per mast, scaled off the long one by its length — see
      // `Whip.rate`. Stiffness goes as the square of the rate and damping as
      // the rate itself, which is what keeps both at the same damping RATIO:
      // scaling only the stiffness would leave the short mast ringing.
      const rate = whip.rate;
      const k = a.stiffness * rate * rate;
      const c = a.damping * rate;
      this.whipVelX[i] += (k * (wantX - this.whipX[i]) - c * this.whipVelX[i]) * dt;
      this.whipX[i] = bound(this.whipX[i] + this.whipVelX[i] * dt, a.bendLimit);
      this.whipVelZ[i] += (k * (wantZ - this.whipZ[i]) - c * this.whipVelZ[i]) * dt;
      this.whipZ[i] = bound(this.whipZ[i] + this.whipVelZ[i] * dt, a.bendLimit);
      // The tip chases the bow and never leads it. This is the only reason the
      // mast is drawn as two links rather than one.
      const follow = Math.min(1, dt * a.lagRate);
      this.tipX[i] += (this.whipX[i] - this.tipX[i]) * follow;
      this.tipZ[i] += (this.whipZ[i] - this.tipZ[i]) * follow;
      setAntennaBend(whip, a.baseShare, this.whipX[i], this.whipZ[i], this.tipX[i], this.tipZ[i]);
    }
  }

  /**
   * Derives the three exported points from the collider box. The only place
   * they are written, the same rule `Player.syncCombatant` follows.
   */
  private sync(): void {
    const t = this.spec;
    const p = this.body.position;
    const feet = p.y - t.hull.height / 2;
    this.position.set(p.x, feet, p.z);
    this.center.copyFrom(p);
    this.eyePos.set(p.x, feet + t.cupolaHeight, p.z);
  }

  /** Where the gun is pointing, as a fresh vector. Per event, never per frame. */
  get gunDir(): Vector3 {
    return this.gunDirToRef(new Vector3());
  }
}
