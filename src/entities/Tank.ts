/**
 * Tank.ts — One vehicle: what it is made of physically, how it drives, where
 * its gun points, and what it feels of a round.
 * Owns: the hull's collider mesh, the `TankRig` hanging off it, the drive
 * state, the turret and gun angles, the magazine clock, and the health.
 * Owns NO rules about who is in it, when it respawns or what its shell does
 * when it lands — those are `VehicleSystem`'s and `Game`'s respectively, the
 * same split `Bot` has against `BattleSystem`.
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
 * **The chase camera still casts, and it still has to turn the hull invisible
 * first** — see `VehicleCamera.pullIn`, which is now the only pick a driver
 * pays. `SOLID_ONLY` reads `isPickable` for exactly that reason and the term
 * must not be taken back out of `world/solid.ts`.
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
import { Mesh, MeshBuilder, Scene, Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { CelMaterialFactory } from "../shaders/CelShader";
import type { DamageKind, ShotOptions } from "../systems/CombatSystem";
import { topFaceHeight } from "../world/boxGeometry";
import type { WorldBox } from "../world/MapBuilder";
import type { ObstacleField } from "../world/ObstacleField";
import { TerrainField } from "../world/TerrainField";
import type { Combatant, Team } from "./Combatant";
import {
  ANTENNA_LENGTHS,
  buildTank,
  paintTank,
  resetTankPose,
  setAntennaBend,
  setTrackRun,
  TRACK_GAUGE,
  TRACK_REACH,
  WHEEL_REACH,
  type TankRig,
} from "./TankModel";

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
 * What a tank's main gun's round IS, as `CombatSystem` needs it told.
 *
 * A module constant for the reason `Player.shotOptions` is a held object: the
 * shell is fired from a per-frame path and a fresh object per shot would be an
 * allocation on the trigger. Every field is a statement about a shell rather
 * than a tuning knob, which is why they are here and not in `CONFIG.vehicles`:
 *
 * - **No fall-off.** `damageFar` equals the gun's own damage and the band is
 *   degenerate, because a shell is a shell at any distance this game contains.
 *   `CONFIG.weapons`' slope is about a bullet losing energy; a 340 m tank round
 *   does not meaningfully lose any inside a 320 m map.
 * - **No `headMult`.** The head zone is the player's alone and is an UPGRADE to
 *   a body hit — a shell that landed on a body has already spent several times
 *   a headshot's worth on it, and a gate at 1 means the sphere is never tested.
 * - **`shell`.** The one thing in the game a hull does not shrug off. See
 *   `CONFIG.vehicles.tank.resist`.
 *
 * It lives beside the gun rather than in whoever pulls the trigger, because
 * there are two of those now and they are in different PROCESSES: `Game`
 * fires a player's shell and `HeadlessGame` re-fires it, and two copies of a
 * statement about what a shell is would be two things to keep in step across
 * a wire whose whole point is that they agree.
 */
export const SHELL_SHOT: ShotOptions = {
  damageFar: CONFIG.vehicles.tank.gun.damage,
  falloffNear: CONFIG.vehicles.tank.gun.range,
  falloffFar: CONFIG.vehicles.tank.gun.range,
  damageKind: "shell",
};

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
 * How much faster each whip answers than the LONG one.
 *
 * A cantilever's natural frequency goes as 1/L^2, so the short mast is stiffer
 * than the long one by the square of the length ratio and nothing about it is
 * tuned separately: `CONFIG.vehicles.tank.antenna` states one spring and this
 * scales it. The pair come out 2.4 Hz and 3.8 Hz, which is why two masts on one
 * turret never swing in step — and a pair that DID would read as one animation
 * playing twice, which is the whole thing being avoided.
 */
const WHIP_RATE = [1, (ANTENNA_LENGTHS[0] / ANTENNA_LENGTHS[1]) ** 2] as const;

/**
 * Where each whip is in the gust, so the two are not stirred in lockstep by a
 * wind that is one wind. Radians of phase, and arbitrary.
 */
const WHIP_PHASE = [0, 2.1] as const;

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
 * is two more ray picks — that is the whole reason the ground stopped being a
 * `pickWithRay`, and it is what makes this number a design choice rather than
 * a budget one.
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

export class Tank implements Combatant {
  /** The collider box, and the thing that MOVES. See the header. */
  readonly body: Mesh;
  readonly rig: TankRig;

  alive = true;
  health: number = CONFIG.vehicles.tank.maxHealth;

  /** Feet — the point the tracks rest on, as `Combatant` requires. */
  readonly position = new Vector3();
  /** The hull's centre, which is the sphere every round is tested against. */
  readonly center = new Vector3();
  /** The cupola: what bots test line of sight to, and aim at. */
  readonly eyePos = new Vector3();
  readonly hitRadius = CONFIG.vehicles.tank.hitRadius;
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
   * neutral-steer pivot (which this vehicle can do at a standstill) comes out
   * as the two tracks going opposite ways, and a hull that is being STOPPED by
   * something still runs them, because `speed` is what the drive achieved.
   */
  private readonly trackRun: [number, number] = [0, 0];
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
   * `TankRig.sprung` for why the tracks are not on it.
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
   * Somebody is driving. Written by `VehicleSystem` alone — a tank does not
   * know what a player is, only whether it is being told what to do.
   */
  occupied = false;

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

  constructor(
    scene: Scene,
    private mats: CelMaterialFactory,
    readonly team: Team,
  ) {
    const t = CONFIG.vehicles.tank;
    this.body = MeshBuilder.CreateBox(
      `tank-body-${team}`,
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

    this.rig = buildTank(scene, mats, team);
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
    const t = CONFIG.vehicles.tank;
    this.alive = true;
    this.health = t.maxHealth;
    this.yaw = yaw;
    this.turretYaw = yaw;
    this.gunPitch = 0;
    this.turretRate = 0;
    this.gunRate = 0;
    this.speed = 0;
    this.trackRun[0] = 0;
    this.trackRun[1] = 0;
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
    this.groundPitchTarget = 0;
    this.groundRollTarget = 0;
    this.leadSign = 1;
    this.reloadT = 0;
    this.wreckT = 0;
    this.occupied = false;
    this.floorY = pos.y;
    this.needsGround = true;
    this.body.position.set(pos.x, pos.y + t.hull.height / 2, pos.z);
    this.body.rotation.y = yaw;
    // A fresh hull is solid again — destruction cleared this, and the pooled
    // mesh is the same one. See `destroy`.
    this.body.metadata = { solid: true };
    this.body.checkCollisions = true;
    this.body.isPickable = true;
    resetTankPose(this.rig, this.mats);
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

  /** Is the gun loaded? */
  get gunReady(): boolean {
    return this.alive && this.reloadT <= 0;
  }

  /** 0 just fired, 1 loaded — what the HUD draws as the gun's own magazine. */
  get loadProgress(): number {
    const cool = CONFIG.vehicles.tank.gun.cooldown;
    return Math.min(1, 1 - this.reloadT / cool);
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

  /** The barrel's tip in world space: where a shell starts and its flash is lit. */
  muzzleToRef(out: Vector3): Vector3 {
    return out.copyFrom(this.rig.muzzle.getAbsolutePosition());
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
    if (!this.gunReady) return false;
    const g = CONFIG.vehicles.tank.gun;
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
    const s = CONFIG.vehicles.tank.suspension;
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
    const kick = CONFIG.vehicles.tank.antenna.gunKick;
    for (let i = 0; i < 2; i++) this.whipVelX[i] += kick;
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
    const resist = CONFIG.vehicles.tank.resist;
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
    paintTank(this.rig, this.mats, true);
    this.onDestroyed();
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
    const c = CONFIG.vehicles.tank.drive;
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

    // Neutral steer at a standstill, tapering toward `turnAtSpeed` at road
    // speed — a tank does not pivot at 40 km/h.
    const fast = Math.min(1, this.travel / c.maxSpeed);
    const turn = c.turnRate * (1 - (1 - c.turnAtSpeed) * fast);
    const yawRate = d.steer * turn;
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
    if (this.speed !== 0 || yawRate !== 0) {
      const differential = (yawRate * TRACK_GAUGE) / 2;
      this.trackRun[0] += (this.speed + differential) * dt;
      this.trackRun[1] += (this.speed - differential) * dt;
      setTrackRun(this.rig, this.trackRun[0], this.trackRun[1]);
    }

    if (Math.abs(this.speed) > 1e-3) {
      this.aimCollider();
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
      const got = Math.hypot(
        this.body.position.x - before,
        this.body.position.z - beforeZ,
      );
      const asked = Math.abs(this.speed * dt);
      if (asked > 1e-4 && got < asked * 0.5) this.speed *= 0.35;
    }

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
    if (drive) {
      const tur = CONFIG.vehicles.tank.turret;
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
    this.rig.gun.rotation.x = -this.gunPitch;

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
    const t = CONFIG.vehicles.tank;
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
      const differential = (yawRate * TRACK_GAUGE) / 2;
      this.trackRun[0] += (this.speed + differential) * dt;
      this.trackRun[1] += (this.speed - differential) * dt;
      setTrackRun(this.rig, this.trackRun[0], this.trackRun[1]);
    }
    if (Math.abs(this.speed) > 1e-3) this.aimCollider();

    this.standOnGround(dt);
    this.flexHeave(dt);

    // Held in the world and drawn against the hull, exactly as `update` does
    // it: the turret is an absolute bearing and the hull turning under it must
    // not drag it round.
    this.rig.turret.rotation.y = angleDelta(this.yaw, this.turretYaw);
    this.rig.gun.rotation.x = -this.gunPitch;

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
    const t = CONFIG.vehicles.tank;
    if (Math.abs(this.speed) > 1e-3) this.leadSign = this.speed > 0 ? 1 : -1;
    const bias = (t.hull.length / 2 - t.drive.collideRadius) * this.leadSign;
    this.body.ellipsoidOffset.set(
      Math.sin(this.yaw) * bias,
      t.drive.climbHeight / 2,
      Math.cos(this.yaw) * bias,
    );
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
    const t = CONFIG.vehicles.tank;
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
    if (!this.body.isEnabled() || !this.body.isPickable) return null;
    const hull = CONFIG.vehicles.tank.hull;
    const b = this.deckBox;
    b.w = hull.width;
    b.h = hull.height;
    b.d = hull.length;
    b.cx = this.body.position.x;
    b.cy = this.body.position.y;
    b.cz = this.body.position.z;
    b.rotY = this.body.rotation.y;
    const top = topFaceHeight(b, x, z);
    return top === null || top > ceiling || top < floor ? null : top;
  }

  /**
   * The hull as a `WorldBox`, rewritten per `deckAt` call and never escaping
   * one. A scratch rather than a field kept in step with the body, because the
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
    const t = CONFIG.vehicles.tank;
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
    const reach = TRACK_REACH;
    const wide = TRACK_GAUGE / 2;
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
    const jl = CONFIG.vehicles.tank.suspension.joltLimit;
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
    const c = CONFIG.vehicles.tank.drive;
    // Nothing off the ground can change which way it is pointing. The target
    // is measured against the ground BELOW the hull, which a falling tank is
    // nowhere near — so in the air the lerp all but stops and the hull lands on
    // the attitude it left with. See `drive.airTiltRate`.
    const k = Math.min(1, dt * (this.grounded ? c.tiltRate : c.airTiltRate));
    this.groundPitch += (this.groundPitchTarget - this.groundPitch) * k;
    this.groundRoll += (this.groundRollTarget - this.groundRoll) * k;
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
   * on this hull, and nothing in `CONFIG` states either number.
   *
   * Stepped semi-implicit Euler rather than in closed form. `CLAUDE.md`'s rule
   * is that anything that moves where bullets go or reads as recoil is stepped
   * exactly; this moves neither — the gun sits on the turret, which hangs off
   * this node and is aimed in WORLD angles, so a leaning hull does not carry
   * the gun off the aim — and at ~1 Hz Euler holds it comfortably. Same
   * treatment as the camera's landing absorb, and for the same reason.
   */
  private flexSuspension(dt: number, accel: number, lateral: number): void {
    const s = CONFIG.vehicles.tank.suspension;
    const bound = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));
    const felt = bound(accel, s.accelLimit);
    // Accelerating lifts the nose and a positive X rotation puts it down, so
    // the pitch target is the negative of the acceleration. Turning right is a
    // positive yaw rate, and a body thrown left by it stands its RIGHT side up,
    // which is a positive Z.
    const wantPitch = -s.pitchPerAccel * felt;
    const wantRoll = s.rollPerAccel * bound(lateral, s.accelLimit);
    this.suspPitchVel +=
      (s.stiffness * (wantPitch - this.suspPitch) - s.damping * this.suspPitchVel) * dt;
    this.suspRollVel +=
      (s.stiffness * (wantRoll - this.suspRoll) - s.damping * this.suspRollVel) * dt;
    let pitch = this.suspPitch + this.suspPitchVel * dt;
    let roll = this.suspRoll + this.suspRollVel * dt;
    // --- the stops, which are at the WHEEL STATIONS and not on the angles ---
    //
    // How much travel a corner station has left, in metres, AFTER `flexHeave`
    // has spent what it spent. A tilt spends both stops at once — one end down
    // is the other end up — so what is left is the smaller of the two
    // remainders, which is why the tilt is bounded by `heaveDroop` rather than
    // by the larger `heaveBump`.
    const room = Math.min(s.heaveDroop - this.heave, s.heaveBump + this.heave);
    // What the springs are asking for, at the outermost road wheel and the
    // outer edge of a track. `WHEEL_REACH` and not `TRACK_REACH`: a bump stop
    // is something a road-wheel ARM reaches, and the sprocket and the idler
    // hang off the hull with no arms at all.
    const asked =
      WHEEL_REACH * Math.abs(Math.sin(pitch)) +
      (TRACK_GAUGE / 2) * Math.abs(Math.sin(roll));
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
    const s = CONFIG.vehicles.tank.suspension;
    this.heaveVel -= this.jolt * s.heaveResponse;
    this.heaveVel +=
      (-s.heaveStiffness * this.heave - s.heaveDamping * this.heaveVel) * dt;
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
    const a = CONFIG.vehicles.tank.antenna;
    const lim = CONFIG.vehicles.tank.suspension.accelLimit;
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
    for (let i = 0; i < 2; i++) {
      // Two sines well off a whole ratio, so the gust does not come round on a
      // metronome — the same trick the grass shader plays, at a mast's rate.
      const t = this.windT * a.wind.speed + WHIP_PHASE[i];
      const puff = a.wind.sway * (Math.sin(t) * 0.7 + Math.sin(t * 0.41) * 0.3);
      // A positive X rotation tips the mast's top toward +Z and a positive Z
      // rotation tips it toward -X, which is where both signs below come from.
      const wantX = -localAZ * a.swayPerAccel - rateX * a.lagPerRate + windZ * puff;
      const wantZ = localAX * a.swayPerAccel - rateZ * a.lagPerRate - windX * puff;
      // One spring per mast, scaled off the long one by its length — see
      // `WHIP_RATE`. Stiffness goes as the square of the rate and damping as
      // the rate itself, which is what keeps both at the same damping RATIO:
      // scaling only the stiffness would leave the short mast ringing.
      const rate = WHIP_RATE[i];
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
      setAntennaBend(this.rig, i, this.whipX[i], this.whipZ[i], this.tipX[i], this.tipZ[i]);
    }
  }

  /**
   * Derives the three exported points from the collider box. The only place
   * they are written, the same rule `Player.syncCombatant` follows.
   */
  private sync(): void {
    const t = CONFIG.vehicles.tank;
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
