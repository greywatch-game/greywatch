/**
 * Bot.ts — AI combatant: FSM (advance/hunt/engage/takeCover/suppressed/retreat/
 * capture/dead), movement, perception, aiming, firing. Rig visuals come from
 * SoldierModel.
 * Invariants: NEVER uses moveWithCollisions and never runs its own pathfinding —
 * movement steers on NavGrid flow fields + ObstacleField push-out. Think ticks
 * (target acquisition, FSM transitions) are rate-limited and staggered by
 * BattleSystem; update() (movement/animation) runs every frame. Bots hold a
 * target until it dies/breaks LOS/leaves range — removing that hysteresis
 * makes bots never fire, which is also why `aimT` resets ONLY on a genuine
 * target change and a remembered enemy is re-acquired at `reacquireDelay`
 * rather than from zero. Aim is a LAGGING point, never the target's exact eye
 * position: that is what makes strafing work. Obstacle push-out is a
 * preference, not a veto: squeezeT drops it when wedged. Bots are pooled by
 * BattleSystem — death hides the rig, respawn re-poses it; never allocate a new
 * Bot per respawn. Animation is procedural and the ONE stance an AI decides is
 * the crouch: `wantCrouch` is the decision, `crouchBlend` the eased result, and
 * everything downstream — the eye, the hit sphere, the pose, the speed and the
 * spread — reads the BLEND, so a stance caught halfway is as correct as one at
 * rest. The eye and the hit sphere come down TOGETHER (see `syncTransform`) or
 * crouching makes a body easier to kill rather than harder. There is still no
 * lean and no flinch pose. Cover is a KIND and not a flag: `hard` is stood
 * behind and stepped out of, `crouch` is ducked behind and stood up out of, and
 * the peek cycle is the same clock either way.
 * `yaw` is where the bot LOOKS (and is what the view cone reads);
 * `bodyYaw` is where its feet point. Keeping them apart is what stops a
 * strafing bot walking sideways, and the twist between them is clamped. Cover is a PREFERENCE: a spot that cannot be reached inside
 * cover.abandonTime is dropped (with a cooldown, or the search instantly
 * re-picks it) and the bot fights from where it stands. A bot moving to cover
 * still shoots; only the tucked-in half of the peek cycle holds fire.
 * What a bot hears from its own side is a CUE and never knowledge. Both live on
 * the team's `SquadRadio` and are reached only through `BattleCtx`, and neither
 * is allowed into `BotMemory`, because everything in there feeds `hasCue` and
 * would turn a cue into a SEARCH: a contact call is a LOOK (the cone and the
 * head, nothing else) and a hazard mark is where this team keeps dying, which
 * bends an approach and never aims a rifle.
 * Grenades are two a life, considered on the ordinary think tick against a
 * target the bot already has, and never thrown inside `grenade.bot.minRange` —
 * that band IS the self-preservation, since there is no self-damage to teach
 * one and no rig pose that could sell taking cover from your own frag.
 * New behavior = new FSM state, never new clips.
 */
import { Scene, Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { CelMaterialFactory } from "../shaders/CelShader";
import type { CoverKind } from "../world/CoverMap";
import type { FlowField, NavGrid } from "../world/NavGrid";
import {
  animateSoldier,
  buildSoldier,
  resetSoldierPose,
  STRIDE,
  type SoldierRig,
} from "./SoldierModel";
import { profileFor, type BotProfile } from "./BotSkill";
import { mulberry32 } from "../world/rng";
import { BotMemory } from "./BotMemory";
import type { Combatant, Team } from "./Combatant";
// Type-only, and erased — this file still knows nothing about a system.
import type { DamageKind } from "../systems/CombatSystem";

/**
 * `advance` walks the flow field to the squad's objective; `engage` fights a
 * visible enemy; `retreat` breaks contact toward the team's own spawn after
 * taking hits; `capture` holds still inside a zone; `dead` stands aside for the
 * ragdoll pool and hides the rig when the pool did not want it.
 */
export type BotState =
  | "advance"
  | "hunt"
  | "engage"
  | "takeCover"
  | "suppressed"
  | "retreat"
  | "capture"
  | "dead";

/**
 * What the bot is standing on, as far as its own objective is concerned.
 * `contest` is a flag that still needs bodies in the circle to move the meter;
 * `hold` is one the team already owns, where standing in the middle of an open
 * capture radius is how you lose it.
 */
export type BotZone = "none" | "contest" | "hold";

/**
 * Which states may interrupt which. A transition *up* this order is always
 * allowed; a transition down waits out `CONFIG.bots.stateDwell`.
 *
 * Without it the table — which is stateless and re-derived at `thinkRate` —
 * flips a bot on the edge of two conditions every 200 ms, and the bot vibrates
 * in a doorway instead of committing to anything.
 */
const PRIORITY: Record<BotState, number> = {
  dead: 7,
  retreat: 6,
  suppressed: 5,
  takeCover: 4,
  engage: 3,
  hunt: 2,
  capture: 1,
  advance: 0,
};

/** What a bot is allowed to know about the world. */
export interface BattleCtx {
  nav: NavGrid;
  /** Nearest enemy in the bot's view cone with line of sight, or null. */
  acquire(bot: Bot): Combatant | null;
  /** Is `to` visible from `from`? Costs one ray pick — budgeted by the caller. */
  visible(from: Vector3, to: Vector3): boolean;
  /**
   * Hitscan shot from a bot at a world point — the bot's lagging aim point, not
   * its target's position. Returns true when the round was stopped by geometry
   * without finding any target, which is how a bot learns it has lost line of
   * sight without spending a ray of its own.
   */
  fire(bot: Bot, aimAt: Vector3, spread: number): boolean;
  /** Flow field toward the bot's current objective, or null if it has none. */
  fieldFor(bot: Bot): FlowField | null;
  /**
   * Flow field back toward this bot's own home spawn. Built by MapBuilder for
   * every map and, until `retreat` existed, read by nothing.
   */
  homeFieldFor(bot: Bot): FlowField | null;
  /**
   * What the bot's current spot offers against `(tx, tz)`: cover it can stand
   * and shoot from, cover it has to duck behind, or nothing. A baked bit test —
   * no rays, no allocation.
   */
  coverKind(bot: Bot, tx: number, tz: number): CoverKind;
  /**
   * Nearest reachable spot with cover from `(tx, tz)`, written into `into`, and
   * what kind it is. `"none"` when there is nothing better than standing where
   * the bot already is. Spots a squadmate has already anchored on are skipped,
   * so a squad under fire spreads along a wall instead of stacking on one
   * corner.
   */
  findCover(bot: Bot, tx: number, tz: number, into: Vector3): CoverKind;
  /** 0 (walled in) .. 1 (open ground) at the bot's current spot. */
  openness(bot: Bot): number;
  /** Push-apart from nearby friendlies, written into `out`. */
  separation(bot: Bot, out: Vector3): void;
  /**
   * Lobs a grenade from this bot, aimed to LAND at `at`. False when the throw
   * cannot be made — out of the arm's range, or the pool is empty — and a bot
   * that gets one must not spend a grenade on it.
   *
   * The ballistics are deliberately not the bot's: a bot says where it wants
   * the grenade and is told whether the arm can do it, exactly as it says where
   * it wants to shoot and lets `fire` resolve the round.
   */
  throwGrenade(bot: Bot, at: Vector3): boolean;
  /**
   * Fires this bot's launcher at `at` — a point on a hull, never a body.
   *
   * False when the rocket could not be put in the air, and a bot that gets one
   * must not spend a rocket on it: the same contract `throwGrenade` has, for
   * the same reason. The flight is deliberately not the bot's, exactly as the
   * grenade's ballistics are not: a bot says what it wants to hit and is told
   * whether the launcher could oblige.
   *
   * Wired on BOTH sides — `Game` offline and `HeadlessGame` in a match — and
   * it has to be: the authority fields the same hulls, so a launcher bot that
   * only fired offline would leave a netplay tank with nothing but the other
   * team's tank to answer it. The rocket is the AUTHORITY's object in a match
   * exactly as the bot's rounds are.
   */
  fireRocket(bot: Bot, at: Vector3): boolean;
  /**
   * Tells this bot's SQUAD that it can see an enemy at `at`.
   *
   * The squad and not the team: a team-wide broadcast turns one sighting into
   * sixteen bots converging on one grid reference, which is the herd rather
   * than the fix for it.
   */
  callContact(bot: Bot, at: Vector3): void;
  /**
   * The squad's freshest contact call, written into `into`. False when there is
   * none, or when it has gone stale.
   *
   * Raw: the LISTENER puts its own error on it (`radio.contactJitter`), which
   * is what sends a squad toward a fight rather than stacking it on a point.
   */
  contactCall(bot: Bot, into: Vector3): boolean;
  /**
   * The nearest place this bot's own TEAM has been dying, if it is near enough
   * to matter: the spot into `into`, the bearing the fire came from into
   * `from`, and how much the mark is worth as the return (0 = no such place).
   *
   * A fact about where this team's bodies fell, never about where the enemy is
   * — see `SquadRadio`.
   */
  hazardNear(bot: Bot, into: Vector3, from: Vector3): number;
  /**
   * Pushes a body at `(x, y, z)` out of any collider it overlaps, writing the
   * result into `out`. Returns false, leaving `out` set to the input, when the
   * spot was already clear.
   */
  clearObstacles(x: number, y: number, z: number, out: Vector3): boolean;
}

/** Shortest signed angle for `a`, in -PI..PI. */
function wrapAngle(a: number): number {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

// Module-scope scratch vectors. AI runs 16 times a frame and allocating a
// handful of Vector3s per bot per frame was measurable churn in the old code.
const _dir = new Vector3();
const _sep = new Vector3();
const _to = new Vector3();
const _spot = new Vector3();
const _nade = new Vector3();
const _rocket = new Vector3();

export class Bot implements Combatant {
  readonly team: Team;
  readonly rig: SoldierRig;

  /** Which squad this bot belongs to; squads share an objective. */
  squad = 0;
  /** Control-point id the squad is heading for. */
  objective = "";
  /** Squad posture: is this flag one the team already holds? */
  defending = false;

  hp = 0;
  alive = false;
  state: BotState = "dead";
  /** Seconds until this corpse can be recycled into a fresh spawn. */
  respawnT = 0;

  /**
   * Where the KILLING damage came from — a shooter's eye, or a grenade's blast
   * centre — and how much of it there was. Both are already handed to
   * `takeDamage` by every damage path in the game (`CombatSystem.fire` passes
   * the shot's origin, `GrenadeSystem` the detonation point), so a ragdoll
   * needs no new parameter threaded through the three call sites that converge
   * on `Game.registerBotKill`. `BotMemory.tookHit` has been reading the same
   * vector for a different purpose all along.
   */
  readonly deathFrom = new Vector3();
  deathDamage = 0;
  /**
   * …and WHAT it was, which is the third thing `takeDamage` has been handed
   * since the tank went in and the one that says whether this body is dropped
   * or thrown. `RagdollSystem` is the only reader; see its `applyImpulse`.
   */
  deathKind: DamageKind = "bullet";
  /**
   * True while `RagdollSystem` owns this rig's joints. `Bot.update` writes no
   * pose at all in that window — see the dead branch.
   */
  ragdolling = false;

  readonly position = new Vector3();
  readonly eyePos = new Vector3();
  readonly center = new Vector3();
  hitRadius = CONFIG.bots.hitRadius;

  target: Combatant | null = null;

  /**
   * How good this bot is, 0..1, and the numbers that fall out of it. Resolved
   * once here and re-resolved on respawn — never per frame.
   */
  skill = CONFIG.bots.skill.defaultSkill;
  profile: BotProfile = profileFor(CONFIG.bots.skill.defaultSkill);

  /** Everything this bot has noticed and not yet forgotten. */
  readonly memory = new BotMemory();

  // --- replication view ---------------------------------------------------
  //
  // What the multiplayer server puts on the wire so a client can draw this bot
  // without running its FSM. Read-only, derived, and deliberately the SAME five
  // values `update` hands `animateSoldier` — a remote client poses the identical
  // rig from the identical numbers, so a bot on screen over the network is the
  // bot the authority is simulating rather than an impression of one.
  //
  // Accessors rather than making the fields public: these are outputs of the
  // AI, and nothing outside this class may write them. `walkPhase` is
  // deliberately NOT among them — it is a free-running cycle with no meaning
  // beyond "where in a stride", so a client integrates its own from `moveAmount`
  // and spends no bandwidth on it. See `src/net/protocol.ts`.

  /** Where the bot LOOKS. What the view cone reads, and what a client aims its head with. */
  get lookYaw(): number {
    return this.yaw;
  }

  /** Where its feet point. Kept apart from `lookYaw` so a strafing bot does not walk sideways. */
  get feetYaw(): number {
    return this.bodyYaw;
  }

  /** 0..1 walk-cycle weight — how much of a stride to play. */
  get moveAmount(): number {
    return this.moveBlend;
  }

  /** Torso pitch toward the current target, radians. Zero with no target. */
  get aimAngle(): number {
    return this.aimPitch();
  }

  /**
   * 0..1 stance blend, 0 standing .. 1 fully crouched — the authority's own
   * eased value, and the one the eye and the hit sphere were derived from this
   * tick.
   *
   * On the wire as `EntityState.crouch`, exactly as a person's is. A client
   * draws the body from this number and puts its local copy of those spheres in
   * the same place, so what an observer aims at and what the server rewinds are
   * the same shape at the same instant — including halfway through the
   * quarter-second the stance takes.
   */
  get stance(): number {
    return this.crouchBlend;
  }

  /**
   * The cover spot this bot has latched, or null.
   *
   * Read by `BattleSystem` so a squadmate's cover search can skip it. The claim
   * IS the anchor rather than a reservation kept beside it, which is what makes
   * it impossible for one to go stale: a bot that drops its cover has released
   * it by the same line.
   */
  get coverAnchor(): Vector3 | null {
    return this.hasCoverSpot ? this.coverSpot : null;
  }

  /**
   * How far through a death this body is: 0 while alive, 1 once it is done.
   *
   * Only netplay reads it — the authority puts it on the wire as
   * `EntityState.dead`, and a client hides a body it did not ragdoll when it
   * reaches 1. It used to be the collapse tween's own progress, and is keyed
   * to `hideTime` now that there is no tween for it to drive.
   */
  get deathProgress(): number {
    return this.state === "dead"
      ? Math.min(1, this.deadT / CONFIG.bots.death.hideTime)
      : 0;
  }

  /** Seconds spent in the current state; gates dropping to a lower priority. */
  private stateT = 0;
  /** Seconds left sweeping at a searched-out position before giving up. */
  private sweepT = 0;
  /** The cover spot latched on entering `takeCover`; valid while `hasCoverSpot`. */
  private readonly coverSpot = new Vector3();
  private hasCoverSpot = false;
  /**
   * What that spot is: cover to stand behind, or cover to duck behind.
   *
   * Re-read against the CURRENT bearing on every think while the bot is at the
   * spot, because a corner that was stand-up cover when the fight started stops
   * being one when the shooter walks round it — and the answer to that is to
   * get down, not to keep standing behind a wall that no longer covers you.
   */
  private coverKind: CoverKind = "none";
  /**
   * The stance. `wantCrouch` is this frame's decision and `crouchBlend` is the
   * eased result; nothing but the ease reads the first, and everything else
   * reads the second — see the file header.
   */
  private wantCrouch = false;
  private crouchBlend = 0;
  /** While positive, the bot will not go looking for cover again. */
  private coverCooldownT = 0;
  /**
   * Peek cycle. Positive means leaned out and shooting; negative means tucked
   * back in behind the anchor. It runs only while anchored at cover.
   */
  private peekT = 0;
  private peekedOut = false;
  /** Which kind of objective the bot is standing on; drives `capture`. */
  private zone: BotZone = "none";
  /**
   * The nearest place this team has been dying, refreshed on the think tick:
   * where it is, which way the fire came from, and how much the mark is worth
   * (0 = nowhere near one).
   *
   * Held rather than queried per frame because it is used by three things that
   * run every frame — the approach's speed, the heading swerve and where the
   * bot is looking — and it changes at walking pace.
   */
  private readonly hazard = new Vector3();
  private readonly hazardFrom = new Vector3();
  private hazardW = 0;
  /**
   * Where the squad last said it had contact, and whether that is worth
   * looking at (0 = nothing to look at).
   *
   * Held here rather than in `BotMemory` on purpose: everything in there feeds
   * `hasCue`, and a bearing that put a bot into `hunt` would turn every
   * sighting anywhere in the squad into a search — see `think`. This one only
   * widens the cone and turns the head.
   */
  private readonly call = new Vector3();
  private callW = 0;
  /**
   * This bot's own random stream. Seeded rather than `Math.random()` so a round
   * plays out the same way twice — with seven stages of new movement to tune,
   * behaviour that cannot be reproduced cannot be judged.
   *
   * PRIVATE, and it went public once: `RagdollSystem` drew the tumble's jitter
   * from it, which cost three draws on any death the pool accepted — so
   * whether this bot's next weave, strafe or grenade matched a previous run
   * turned on the camera's distance from a corpse, the pool's occupancy, the
   * ragdoll setting and whether the WASM had loaded. The pool has its own
   * stream now; a death is still varied and still reproducible, and nothing
   * about a body falling reaches the fight.
   */
  private rand: () => number = mulberry32(1);

  /**
   * Gives this bot its own deterministic stream. Called once by BattleSystem
   * with the pool index, so every bot weaves and paces differently but the same
   * way on every run.
   */
  seedRandom(seed: number): void {
    this.rand = mulberry32(seed);
  }
  /** Phase of this bot's lateral weave, so squadmates don't share a line. */
  private lanePhase = 0;
  /** Per-bot speed multiplier: nobody marches in lockstep. */
  private paceMult = 1;
  /** Smoothed heading, so the flow field's eight compass points don't snap. */
  private headingX = 0;
  private headingZ = 0;
  private headingSet = false;
  /** While positive, the bot is stopped looking at a corner it just reached. */
  private cornerT = 0;
  /**
   * Where the feet point. `yaw` is where the bot is *looking*; the difference
   * between the two is the upper-body twist, and keeping them separate is what
   * stops a strafing bot walking visibly sideways.
   */
  private bodyYaw = 0;
  /** Cached twist, clamped, handed to the poser each frame. */
  private torsoTwist = 0;

  /**
   * Where the bot is actually pointing — a lagging chase of the target's eyes
   * rather than the eyes themselves. Aiming exactly at the target every shot is
   * what made strafing pointless.
   */
  private readonly aimPoint = new Vector3();
  private aimLocked = false;

  /** Time since the current target was acquired; gates the first shot. */
  private aimT = 0;
  private fireCooldown = 0;
  private burstLeft = 0;
  private magLeft = 0;
  private reloadT = 0;
  /** Grenades left this life — the same two-a-life pouch the player carries. */
  private grenades = CONFIG.grenade.carried;
  /** While positive, this bot will not throw another. */
  private grenadeT = 0;
  /**
   * This bot carries a rocket launcher. Written once by `BattleSystem` when
   * the squads are cut, and never by the bot itself — one per squad is a fact
   * about the SQUAD, and a bot that decided for itself would give a team
   * anywhere between none and eight of them.
   *
   * It changes nothing about how the bot fights infantry: the rifle is still
   * the weapon, the rig still carries one, and the launcher exists only in
   * `considerRocket`. What a launcher bot IS, is the one body in its squad
   * that can hurt a tank.
   */
  private hasLauncher = false;

  /**
   * Whether this bot carries a launcher, and the one place the rig is told.
   *
   * A property rather than a field because the tube on its back has to follow
   * it: `BattleSystem` writes this once when it cuts the squads, before the
   * bot has ever been spawned, and the rig it was built with is the rig it
   * keeps for the life of the process — so the write and the mesh can be the
   * same statement instead of two that have to be kept in step.
   */
  get launcher(): boolean {
    return this.hasLauncher;
  }

  set launcher(on: boolean) {
    this.hasLauncher = on;
    this.rig.launcher.setEnabled(on);
  }
  /** Rockets left this life. Refilled by `spawn`, like the grenade pouch. */
  private rockets = CONFIG.antiTankBots.carried;
  /** While positive, this bot will not fire another. */
  private rocketT = 0;
  /** Consecutive shots stopped by geometry with no target found. */
  private blockedStreak = 0;
  /** While positive, a recent hit is disrupting aim and speed. */
  private flinchT = 0;
  private walkPhase = 0;
  private moveBlend = 0;
  private yaw = 0;
  private deadT = 0;
  private strafe = 1;
  private strafeT = 0;
  /** Set when the bot has recently been hit; drives `retreat`. */
  private pressure = 0;
  /** How long the bot has been trying to move without getting anywhere. */
  private stuckT = 0;
  /** Seconds left of the sidestep the watchdog triggered. */
  private detourT = 0;
  /** Which way round the obstruction that sidestep goes. */
  private detourSide = 1;
  /** Sidesteps taken since the bot last actually got somewhere. */
  private stuckStreak = 0;
  /** While positive, the bot may clip geometry to get out of a pinch. */
  private squeezeT = 0;

  constructor(scene: Scene, mats: CelMaterialFactory, team: Team) {
    this.team = team;
    this.rig = buildSoldier(scene, mats, team);
    this.setEnabled(false);
  }

  /** Brings a pooled bot back to life at a spawn point. */
  spawn(at: Vector3, yaw: number): void {
    this.hp = CONFIG.bots.maxHealth;
    this.alive = true;
    this.state = "advance";
    this.position.copyFrom(at);
    this.yaw = yaw;
    this.bodyYaw = yaw;
    this.torsoTwist = 0;
    this.target = null;
    this.memory.reset();
    this.stateT = 0;
    this.sweepT = 0;
    this.lanePhase = this.rand() * Math.PI * 2;
    this.paceMult =
      1 + (this.rand() * 2 - 1) * CONFIG.bots.movement.speedJitter;
    this.headingSet = false;
    this.cornerT = 0;
    this.zone = "none";
    this.hasCoverSpot = false;
    this.coverKind = "none";
    this.wantCrouch = false;
    this.crouchBlend = 0;
    this.hazardW = 0;
    this.callW = 0;
    this.coverCooldownT = 0;
    this.peekT = 0;
    this.peekedOut = false;
    this.aimT = 0;
    this.aimLocked = false;
    this.flinchT = 0;
    this.blockedStreak = 0;
    this.deadT = 0;
    // Belt to RagdollSystem's braces: a rig handed back late must never come
    // up with a live body still claiming its joints.
    this.ragdolling = false;
    this.pressure = 0;
    this.burstLeft = this.profile.burstSize;
    this.magLeft = CONFIG.bots.combat.magSize;
    this.reloadT = 0;
    this.fireCooldown = 0;
    this.grenades = CONFIG.grenade.carried;
    this.grenadeT = 0;
    this.rockets = CONFIG.antiTankBots.carried;
    this.rocketT = 0;
    this.stuckT = 0;
    this.detourT = 0;
    this.stuckStreak = 0;
    this.squeezeT = 0;
    this.syncTransform();
    // Re-pose to idle. The pooled rig may still hold whatever the last life
    // ended in — the pose a corpse settled in, or the stride it was refused a
    // fall mid-way through — and animateSoldier only runs inside
    // CONFIG.bots.lodFreezeDistance, so without this a bot respawning beyond
    // it walks around in a dead man's shape until the player closes in and the
    // pose unfreezes.
    //
    // `resetSoldierPose` rather than a bare `animateSoldier(..., 0)`, and the
    // difference matters because a corpse has been a ragdoll: that call
    // writes ten Euler channels and a ragdoll leaves residue in the parent,
    // the quaternion, the scaling and every channel it does not touch. See its
    // own note — a quaternion left behind freezes this bot for the round.
    resetSoldierPose(this.rig);
    this.setEnabled(true);
  }

  setEnabled(on: boolean): void {
    this.rig.root.setEnabled(on);
  }

  /**
   * Carries this body to `at` without simulating a step to get there.
   *
   * `Player.nudgeTo`'s twin, and it exists for the identical reason: a body
   * inside a vehicle is CARRIED rather than walked, and every downstream
   * reader — the conquest occupancy count, the minimap blip, a squad's
   * centroid — asks where it is and deserves the honest answer, which is "in
   * that tank". The eye and the hit sphere come with it, because
   * `syncTransform` is the one place they are ever written.
   *
   * It is also what puts a crewman down beside the hull he has just been
   * burned out of: the corpse a ragdoll is built from is posed off this rig,
   * so a body still standing at the middle of a wreck would fall through a
   * collider that is deliberately still there.
   */
  nudgeTo(at: Vector3): void {
    this.position.copyFrom(at);
    this.syncTransform();
  }

  /** LOD hook: distant bots stop animating but keep moving. */
  setOutlines(on: boolean): void {
    for (const m of this.rig.meshes) {
      if (!m.metadata?.noOutline) m.renderOutline = on;
    }
  }

  /**
   * `from` is the shooter's origin. `CombatSystem.fire` has always passed it and
   * this class used to drop it on the floor, which is why a bot shot in the back
   * reacted with a directionless `pressure` scalar and nothing else — no turn,
   * no idea where the round came from.
   */
  takeDamage(
    amount: number,
    from?: Vector3,
    // Annotated with the default the interface already implies, so a caller
    // that has no opinion — the leash, a crew burning with its hull — is a
    // round rather than an explosion.
    kind: DamageKind = "bullet",
  ): boolean {
    if (!this.alive) return false;
    this.hp -= amount;
    this.pressure = 1;
    if (from) {
      this.memory.tookHit(from);
      // A hit disrupts aim. There is no flinch pose to play — the rig has no
      // joint that could sell one — so it lands as a brief speed drop and an
      // aim point knocked off target, both read in update()/shoot().
      this.flinchT = CONFIG.bots.combat.flinchTime;
    }
    if (this.hp <= 0) {
      this.alive = false;
      this.state = "dead";
      this.deadT = 0;
      this.target = null;
      // Captured here rather than passed along the kill path: this is the one
      // place that sees both the blow and where it came from.
      if (from) this.deathFrom.copyFrom(from);
      else this.deathFrom.copyFrom(this.center);
      this.deathDamage = amount;
      this.deathKind = kind;
      // Reinforcements are not instant: the delay is what makes losing a
      // firefight cost the team ground as well as a ticket. The scatter on top
      // is what stops a squad that was wiped together coming back together —
      // four bodies on one respawn clock walk out of the gatehouse as one.
      this.respawnT =
        CONFIG.conquest.respawnDelay + this.rand() * CONFIG.bots.spawnJitter;
      // Told before the corpse is anything else: the team keeps a mark where
      // its own bodies fall, and the only place that has both the body and the
      // bearing it fell to is right here.
      this.onDied();
      return true;
    }
    return false;
  }

  /**
   * True while a threat cue is live; widens the view cone and drives facing.
   *
   * Ground the team has been dying on counts. A soldier walking into somewhere
   * his squad was cut down is looking harder than one on a quiet street, which
   * is the same claim `combat.alertFovBonus` already makes about being shot at
   * — and it is the half of the hazard memory that costs nothing to act on.
   */
  get alerted(): boolean {
    return this.memory.alerted || this.callW > 0 || this.hazardW > 0;
  }

  /** Which way the bot is looking. Read by BattleSystem's view-cone test. */
  get facing(): number {
    return this.yaw;
  }

  /**
   * Cheap per-frame step: movement integration and animation only.
   *
   * The expensive half — target acquisition, line-of-sight rays, objective
   * re-evaluation — runs in `think()` at `CONFIG.bots.thinkRate`, staggered
   * across frames by `BattleSystem`.
   */
  update(dt: number, ctx: BattleCtx, animate: boolean): void {
    if (this.state === "dead") {
      this.deadT += dt;
      // While a ragdoll owns the joints this branch stands aside entirely —
      // two things writing the same nodes is the trap the camera's bob phase
      // documents from the other side. RagdollSystem hides the rig and hands
      // it back itself.
      //
      // What is left here is the OTHER case, and it is now the only one: a
      // body killed past `death.maxDistance`, which is the fog wall, which is
      // where the rig has already stopped being drawn. There is nothing to
      // pose — the pool takes every death the player could see — so the rig
      // simply holds whatever it died in until the clock hides it. This used
      // to run a collapse tween, exempt from the pose-freeze LOD because a
      // corpse that held its mid-stride pose and then vanished read as a pop;
      // nothing that could be seen reaches this branch any more, so there is
      // no pop to hide.
      if (!this.ragdolling && this.deadT > CONFIG.bots.death.hideTime) {
        this.setEnabled(false);
      }
      this.respawnT -= dt;
      return;
    }

    const b = CONFIG.bots;
    this.pressure = Math.max(0, this.pressure - dt * 0.5);
    this.memory.decay(dt);
    this.stateT += dt;
    this.flinchT = Math.max(0, this.flinchT - dt);
    this.coverCooldownT = Math.max(0, this.coverCooldownT - dt);
    this.squeezeT = Math.max(0, this.squeezeT - dt);
    this.grenadeT = Math.max(0, this.grenadeT - dt);
    this.rocketT = Math.max(0, this.rocketT - dt);
    this.strafeT -= dt;
    if (this.strafeT <= 0) {
      this.strafeT = 0.8 + this.rand() * 1.6;
      this.strafe = this.pickStrafe(ctx);
    }

    let speed: number = b.moveSpeed;
    _dir.setAll(0);
    // The stance is re-decided from scratch every frame, by whichever state the
    // bot is in. Standing is what you get by saying nothing, so a state that
    // has no opinion about the crouch cannot leave a bot in one.
    this.wantCrouch = false;

    switch (this.state) {
      case "advance": {
        const field = ctx.fieldFor(this);
        if (field) {
          ctx.nav.steerAhead(field, this.position, b.movement.lookaheadCells, _dir);
          this.smoothHeading(ctx, dt, _dir);
        }
        // A sprint across ground the team has been dying on is how it went on
        // being ground the team dies on. Inside a mark the approach drops to a
        // walk — and `smoothHeading` bends it round the spot while the facing
        // code puts the bot's eyes on the bearing the fire came from, so the
        // three together are one behaviour: come in slower, wider and looking
        // the right way.
        speed *= this.hazardW > 0 ? b.radio.hazardCaution : b.advanceSprintMult;
        break;
      }
      case "capture": {
        if (this.zone === "hold") {
          // A flag the team already owns. The meter is maxed, so standing in
          // the middle of an open circle achieves nothing and gets the holder
          // shot first; sit at the most covered spot nearby instead and watch.
          // Cover here is scored against the *threat bearing* rather than a
          // target, since by definition there is nobody visible.
          if (!this.hasCoverSpot && this.coverCooldownT <= 0 && this.alerted) {
            const found = ctx.findCover(
              this,
              this.memory.threat.x,
              this.memory.threat.z,
              this.coverSpot,
            );
            if (found !== "none") {
              this.hasCoverSpot = true;
              this.coverKind = found;
            } else {
              this.coverCooldownT = CONFIG.bots.cover.retryDelay;
            }
          }
          if (this.hasCoverSpot && !this.atCoverSpot()) {
            _to.copyFrom(this.coverSpot).subtractInPlace(this.position);
            _to.y = 0;
            const away = _to.length();
            if (away > 1e-3) _dir.copyFrom(_to).scaleInPlace(1 / away);
            speed *= 0.8;
          } else if (this.hasCoverSpot && this.alerted) {
            // Arrived, with something to watch for: get down behind it. A
            // sentry standing over his own cover is a sentry with a head
            // showing, and there is nothing to move for from here.
            this.wantCrouch = true;
          }
          break;
        }
        // Still being taken: bodies in the circle are what move the meter, so
        // drift slowly rather than standing like a statue.
        _dir.set(Math.cos(this.walkPhase * 0.3), 0, Math.sin(this.walkPhase * 0.3));
        speed *= 0.25;
        break;
      }
      case "hunt": {
        // Walk to where the enemy was last seen, then sweep. This is the
        // corner-checking behaviour: losing sight of someone used to drop the
        // bot straight back to walking at its flag, which is what made them
        // feel oblivious.
        //
        // Steered directly rather than on a flow field — fields only route to
        // objectives, and a remembered position is not one. `tryMove`'s axis
        // sliding and the stuck watchdog are exactly what that case needs, and
        // they are already here.
        _to.copyFrom(this.memory.lastKnown).subtractInPlace(this.position);
        _to.y = 0;
        const away = _to.length();
        if (away > CONFIG.bots.perception.huntArriveRadius && this.sweepT <= 0) {
          _dir.copyFrom(_to).scaleInPlace(1 / away);
        } else {
          // Arrived. Stand and look around rather than walking in circles.
          if (this.sweepT <= 0) this.sweepT = CONFIG.bots.perception.huntSweepTime;
          this.sweepT -= dt;
          if (this.sweepT <= 0) this.memory.lastKnownT = 0;
        }
        speed *= CONFIG.bots.perception.huntSpeedMult;
        break;
      }
      case "engage": {
        const t = this.target;
        // The bearing being fought along: the target while there is one, and
        // the last thing to shoot at this bot while there is not.
        //
        // The second case is not an edge case, it is what cover DOES: a bot
        // tucked in behind its own wall cannot see the enemy, so a peek cycle
        // that only ran while a target was visible would stop dead on the half
        // of itself that matters. `think` keeps the bot here on `lastAimed`,
        // and this is the half that keeps moving.
        const covering = this.hasCoverSpot && !t && this.memory.lastAimedT > 0;
        if (t || covering) {
          const bx = t ? t.position.x : this.memory.threat.x;
          const bz = t ? t.position.z : this.memory.threat.z;
          _to.set(bx - this.position.x, 0, bz - this.position.z);
          const dist = _to.length();
          if (dist > 1e-3) _to.scaleInPlace(1 / dist);
          // Hold the sweet spot: close if far, back off if crowded, otherwise
          // strafe so the bot isn't a stationary target.
          if (this.hasCoverSpot) {
            // Anchored at cover: run the peek cycle instead of circling. Out to
            // shoot, back to reload and wait. `shoot()` reads `peekedOut` and
            // holds fire while tucked in.
            this.peekT -= dt;
            if (this.peekT <= 0) {
              this.peekedOut = !this.peekedOut;
              const c = CONFIG.bots.cover;
              this.peekT = this.peekedOut ? this.profile.peekOutTime : c.peekInTime;
            }
            // What a peek IS depends on the cover, and the two kinds are the
            // same cycle on the same clock because they are the same decision:
            // be shootable for a moment, then not. Round a corner the bot steps
            // out sideways and stays standing. Behind a low wall there is
            // nowhere to step to — the wall only covers a body that is DOWN
            // behind it — so the peek is standing up in place and the stance is
            // the whole of the exposure. A reload is a moment to be down for
            // either kind.
            this.wantCrouch =
              !this.peekedOut && (this.coverKind === "crouch" || this.reloadT > 0);
            // Lean out along the tangent to the target: (-dz, dx) rotated by
            // which side this bot favours. Read into locals first — `_to` is
            // about to be overwritten with the result.
            const off =
              this.peekedOut && this.coverKind === "hard"
                ? CONFIG.bots.cover.peekOffset
                : 0;
            const tanX = -_to.z * this.strafe * off;
            const tanZ = _to.x * this.strafe * off;
            _to.set(
              this.coverSpot.x + tanX - this.position.x,
              0,
              this.coverSpot.z + tanZ - this.position.z,
            );
            const away = _to.length();
            if (away > 0.25) _dir.copyFrom(_to).scaleInPlace(1 / away);
            speed *= 0.9;
            break;
          }
          // No cover, so hold the sweet spot instead: close if far, back off if
          // crowded, otherwise strafe so the bot isn't a stationary target.
          // Only ever with a target — closing on a remembered bearing is what
          // `hunt` is for, and doing it here would walk a bot out of the fight
          // it is standing in.
          if (!t) break;
          if (dist > b.engageRange * 0.7) _dir.copyFrom(_to);
          else if (dist < b.minEngageRange) _dir.copyFrom(_to).scaleInPlace(-1);
          else _dir.set(-_to.z * this.strafe, 0, _to.x * this.strafe);
          speed *= 0.7;
        }
        break;
      }
      case "takeCover": {
        // Move to the latched spot, holding fire on the way. Steered directly:
        // it is a handful of metres, and `tryMove`'s axis sliding plus the
        // stuck watchdog are exactly the tools for short awkward hops.
        if (this.hasCoverSpot) {
          _to.copyFrom(this.coverSpot).subtractInPlace(this.position);
          _to.y = 0;
          const away = _to.length();
          if (away > 1e-3) _dir.copyFrom(_to).scaleInPlace(1 / away);
        }
        break;
      }
      case "suppressed": {
        // Pinned. Not moving is the correct answer to heavy fire, and getting
        // down is the other half of it — this is the one state where the stance
        // is unconditional, because the bot is not trying to do anything else
        // with its body. It is taken whatever the cover is: a corner does not
        // stop a burst that is already walking along the wall.
        this.wantCrouch = true;
        break;
      }
      case "retreat": {
        // Genuinely break contact, along the route back to the team's own
        // spawn. The old `reposition` steered on the *objective* field at plain
        // speed — which is to say it walked toward the enemy while refusing to
        // shoot, the opposite of falling back. The home field has been built by
        // MapBuilder for every map since the beginning and read by nothing.
        const field = ctx.homeFieldFor(this) ?? ctx.fieldFor(this);
        if (field) {
          ctx.nav.steerAhead(field, this.position, b.movement.lookaheadCells, _dir);
          this.smoothHeading(ctx, dt, _dir);
        }
        break;
      }
    }

    // The stance itself, eased on `player.crouchBlendSpeed` — the player's
    // number because it is how fast a BODY folds rather than a property of
    // whoever asked for it, and because a remote copy of this bot eases the
    // authority's blend with the same constant (`NetSoldier`). Everything
    // downstream reads the blend: the speed here, the spread in `shoot`, the
    // eye and the hit sphere in `syncTransform`, the pose in `animateSoldier`.
    this.crouchBlend +=
      ((this.wantCrouch ? 1 : 0) - this.crouchBlend) *
      Math.min(1, dt * CONFIG.player.crouchBlendSpeed);
    speed *= 1 - (1 - b.cover.crouchMoveMult) * this.crouchBlend;

    // A bot that has just been hit stumbles rather than jogging on serenely.
    if (this.flinchT > 0) speed *= 0.6;
    // Per-bot pace, so a squad on one flow field doesn't move as one body.
    speed *= this.paceMult;
    // Stopped at a corner to look before committing to what is round it.
    if (this.cornerT > 0) {
      this.cornerT -= dt;
      speed = 0;
      _dir.setAll(0);
    }

    ctx.separation(this, _sep);
    _dir.addInPlace(_sep);

    if (this.detourT > 0) {
      // Watchdog sidestep: swing the intent round to the detour side so the bot
      // walks *along* whatever it is grinding on. Keeping a third of the
      // original heading means it still drifts the right way while it does.
      this.detourT -= dt;
      const tx = -_dir.z * this.detourSide;
      const tz = _dir.x * this.detourSide;
      _dir.set(_dir.x * 0.3 + tx, 0, _dir.z * 0.3 + tz);
    }

    // De-penetrate before anything else: a bot that ended up inside a collider
    // — spawned on a prop, shoved there by separation — has to get out even
    // when it is standing still, or it is left unshootable.
    this.stepTo(ctx, 0, 0);

    const len = Math.hypot(_dir.x, _dir.z);
    if (len > 1e-4) {
      const step = (speed * dt) / len;
      const fromX = this.position.x;
      const fromZ = this.position.z;
      this.tryMove(ctx, _dir.x * step, _dir.z * step);

      // A bot that asked to move and barely did is grinding on something.
      const covered = Math.hypot(this.position.x - fromX, this.position.z - fromZ);
      if (covered < speed * dt * b.stuckFraction) {
        this.stuckT += dt;
        if (this.stuckT > b.stuckTime && this.detourT <= 0) {
          this.stuckT = 0;
          this.detourT = b.detourTime;
          this.detourSide = this.pickDetourSide(ctx, _dir.x / len, _dir.z / len);
          // Sidestepping twice with nothing to show for it means the bot is
          // wedged somewhere narrower than its own body — a gate post, a gap
          // between two props — where the push-out cancels every step it
          // takes. Let it clip through: overlapping geometry for a second is
          // the lesser evil against standing there for the rest of the round.
          if (++this.stuckStreak >= 2) this.squeezeT = b.detourTime;
        }
      } else {
        this.stuckT = 0;
        this.stuckStreak = 0;
      }

      // The walk cycle is advanced by distance travelled, so a footfall is a
      // point on it and never a timer: a bot slowed to a hunt's walk steps
      // more slowly for free, and a stopped one stops stepping. The legs swing
      // as sin(walkPhase), so a foot is planted forward at each half turn —
      // pi/2 and 3pi/2, which is every pi offset by pi/2.
      const wasStride = Math.floor((this.walkPhase - Math.PI / 2) / Math.PI);
      this.walkPhase += (speed * dt) / STRIDE;
      if (Math.floor((this.walkPhase - Math.PI / 2) / Math.PI) !== wasStride) {
        this.onStep();
      }
      this.moveBlend = Math.min(1, this.moveBlend + dt * 6);
    } else {
      this.stuckT = 0;
      this.stuckStreak = 0;
      this.moveBlend = Math.max(0, this.moveBlend - dt * 6);
    }

    // What to look at, in priority order: the enemy being fought, then the
    // bearing danger last came from, then wherever the feet are going. The
    // middle one is the whole "shot in the back" reaction — without it a bot
    // took a round from behind and kept walking.
    let faceX: number;
    let faceZ: number;
    if (this.target) {
      faceX = this.target.position.x - this.position.x;
      faceZ = this.target.position.z - this.position.z;
    } else if (this.state === "hunt" && this.sweepT > 0) {
      // Sweeping a searched-out spot: swing the look across the approach rather
      // than staring at one point, which is what reads as *checking* a corner.
      const swing = Math.sin(this.sweepT * 2.2) * 1.1;
      faceX = Math.sin(this.yaw + swing);
      faceZ = Math.cos(this.yaw + swing);
    } else if (this.memory.alerted) {
      faceX = this.memory.threat.x - this.position.x;
      faceZ = this.memory.threat.z - this.position.z;
    } else if (this.callW > 0) {
      // The squad has called contact and this bot has nothing of its own to
      // look at: look where it was told. Against an acquisition cone that
      // gates on facing, this is most of what a warning is worth — the enemy
      // who walked past an unaware bot is now walking into a bot that is
      // pointed at them.
      faceX = this.call.x - this.position.x;
      faceZ = this.call.z - this.position.z;
    } else if (this.hazardW > 0) {
      // Nothing live and nothing called, but this is where the team keeps
      // dying: walk it watching whatever has been doing the killing.
      //
      // `memory.alerted` is tested above rather than `this.alerted`, which now
      // covers this branch and the one before it — a bearing the memory does
      // not hold must never be read out of it.
      faceX = this.hazardFrom.x - this.position.x;
      faceZ = this.hazardFrom.z - this.position.z;
    } else {
      faceX = _dir.x;
      faceZ = _dir.z;
    }
    if (Math.abs(faceX) + Math.abs(faceZ) > 1e-3) {
      const delta = wrapAngle(Math.atan2(faceX, faceZ) - this.yaw);
      // Fast while flinching, so being shot reads as a snap round — but still a
      // slew, because instant is what makes an aimbot look like an aimbot.
      const rate =
        this.profile.turnRate *
        (this.flinchT > 0 ? CONFIG.bots.combat.flinchTurnMult : 1);
      this.yaw += delta * Math.min(1, dt * rate);
    }

    // Feet follow travel, torso twists to the look direction.
    //
    // The rig hangs off a single root yaw, so before this a bot pointed its
    // whole body at whatever it was looking at: one strafing across a doorway
    // while tracking you walked visibly sideways, legs swinging along an axis
    // it was not travelling on. Splitting the two also fixes the walk cycle for
    // free, since the hips now swing along the direction of travel.
    const mv = b.movement;
    const travel = Math.hypot(_dir.x, _dir.z);
    // Standing still, the feet come round to meet the eyes — nobody stands
    // indefinitely with their body square and their head over one shoulder.
    const wantBody = travel > 1e-3 ? Math.atan2(_dir.x, _dir.z) : this.yaw;
    this.bodyYaw += wrapAngle(wantBody - this.bodyYaw) * Math.min(1, dt * mv.bodyTurnRate);
    let twist = wrapAngle(this.yaw - this.bodyYaw);
    // Past the limit the hips have to come round with it. Without the clamp a
    // bot tracking something behind it ends up with its shoulders on backwards.
    if (twist > mv.maxTorsoTwist) {
      this.bodyYaw += twist - mv.maxTorsoTwist;
      twist = mv.maxTorsoTwist;
    } else if (twist < -mv.maxTorsoTwist) {
      this.bodyYaw += twist + mv.maxTorsoTwist;
      twist = -mv.maxTorsoTwist;
    }
    this.bodyYaw = wrapAngle(this.bodyYaw);
    this.torsoTwist = twist;

    this.trackAim(dt);
    this.shoot(dt, ctx);
    this.syncTransform();
    if (animate) {
      animateSoldier(
        this.rig,
        this.walkPhase,
        this.moveBlend,
        this.aimPitch(),
        this.torsoTwist,
        this.crouchBlend,
      );
    }
  }

  /**
   * Which way to sidestep round whatever the bot is grinding on: it probes a
   * body's length along each tangent and takes the more open one.
   *
   * Picking by probe rather than by coin flip is what stops the watchdog
   * oscillating. Each detour is short and re-triggers as soon as the bot faces
   * the obstruction again, so a side chosen at random alternates left/right
   * against a long wall and the bot stays exactly where it is. The probe scores
   * the same side every time, and consecutive detours add up into a walk around
   * the building.
   */
  private pickDetourSide(ctx: BattleCtx, dirX: number, dirZ: number): number {
    const probe = CONFIG.bots.detourProbe;
    let bestSide = this.detourSide;
    let bestScore = -Infinity;
    for (const side of [1, -1]) {
      const px = this.position.x - dirZ * side * probe;
      const pz = this.position.z + dirX * side * probe;
      const surface = ctx.nav.surfaceAt(px, this.position.y, pz);
      if (surface < 0) continue;
      if (Math.abs(ctx.nav.heightOf(surface) - this.position.y) > CONFIG.nav.stepHeight) {
        continue;
      }
      // How far the push-out has to shove the probe back is how blocked that
      // side is; an untouched probe scores zero, the best possible.
      ctx.clearObstacles(px, this.position.y, pz, _spot);
      const score = -Math.hypot(_spot.x - px, _spot.z - pz);
      // Ties keep the current side, so an ongoing detour doesn't reverse.
      if (score > bestScore + 1e-3 || (side === this.detourSide && score >= bestScore)) {
        bestScore = score;
        bestSide = side;
      }
    }
    return bestSide;
  }

  /**
   * A step with wall sliding. Head-on is tried first, then each axis alone, so
   * a bot pressed into a wall walks along it instead of standing there. The old
   * all-or-nothing test is what made bots visibly hang on corners: `engage` and
   * `capture` steer straight at a target rather than along the flow field, so
   * walking into geometry is the normal case, not the exception.
   */
  private tryMove(ctx: BattleCtx, dx: number, dz: number): boolean {
    if (this.stepTo(ctx, dx, dz)) return true;
    if (Math.abs(dx) > 1e-5 && this.stepTo(ctx, dx, 0)) return true;
    if (Math.abs(dz) > 1e-5 && this.stepTo(ctx, 0, dz)) return true;
    return false;
  }

  /**
   * Moves by `(dx, dz)` if the destination is somewhere a body can stand.
   *
   * Bots move on the nav graph rather than through Babylon's collider: 16
   * agents calling `moveWithCollisions` would walk the whole collidable mesh
   * list 16 times a frame. But the grid only samples cell centres, so the
   * destination is also pushed clear of any collider it overlaps — most of the
   * map's props are narrower than a cell and are otherwise invisible to
   * navigation entirely.
   *
   * The push-out is a preference, not a veto: where the clear spot is somewhere
   * the graph won't allow, the bot takes the overlapping one instead. Standing
   * half in a wall is bad, but being frozen where the old code could walk is
   * worse, and it is the failure the player reads as a broken bot.
   */
  private stepTo(ctx: BattleCtx, dx: number, dz: number): boolean {
    const tx = this.position.x + dx;
    const tz = this.position.z + dz;
    if (this.squeezeT > 0) return this.settle(ctx, tx, tz);
    if (
      ctx.clearObstacles(tx, this.position.y, tz, _spot) &&
      this.settle(ctx, _spot.x, _spot.z)
    ) {
      return true;
    }
    return this.settle(ctx, tx, tz);
  }

  /** Stands at `(x, z)` if the nav graph has a surface there within a step. */
  private settle(ctx: BattleCtx, x: number, z: number): boolean {
    const surface = ctx.nav.surfaceAt(x, this.position.y, z);
    if (surface < 0) return false;
    // The graph only links surfaces within a step of each other; hold the same
    // rule here or a bot can drop off the bridge into the creek in one frame.
    const height = ctx.nav.heightOf(surface);
    if (Math.abs(height - this.position.y) > CONFIG.nav.stepHeight) return false;
    this.position.set(x, height, z);
    return true;
  }

  /**
   * Chases the target's eyes with a lagging aim point.
   *
   * This is the single largest change to how bots feel to fight. Before it,
   * `botFire` aimed at `target.eyePos` exactly on every shot and the only error
   * was a spread cone, so a strafing player was hit at precisely the same rate
   * as a stationary one — lateral movement was worth nothing. A point that
   * trails at `profile.trackRate` produces natural lead and lag, rewards
   * movement, and is what separates an ace from a rookie by something other
   * than luck.
   */
  private trackAim(dt: number): void {
    const t = this.target;
    if (!t || !t.alive) {
      this.aimLocked = false;
      return;
    }
    if (!this.aimLocked) {
      // First sight of this enemy: start on them rather than swinging in from
      // wherever the last one died, which would read as a scripted sweep.
      this.aimPoint.copyFrom(t.eyePos);
      this.aimLocked = true;
      return;
    }
    const k = Math.min(1, dt * this.profile.trackRate);
    this.aimPoint.x += (t.eyePos.x - this.aimPoint.x) * k;
    this.aimPoint.y += (t.eyePos.y - this.aimPoint.y) * k;
    this.aimPoint.z += (t.eyePos.z - this.aimPoint.z) * k;
  }

  /**
   * Burst fire, gated by reaction time, a per-burst pause, and a magazine.
   *
   * The magazine is the readable window: a bot that has to stop and reload is
   * a bot the player can push, which burst-and-pause alone never gave them.
   */
  private shoot(dt: number, ctx: BattleCtx): void {
    const b = CONFIG.bots;
    this.fireCooldown -= dt;
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        this.magLeft = b.combat.magSize;
        this.burstLeft = this.profile.burstSize;
      }
      return;
    }

    const t = this.target;
    if (!t || !t.alive) return;
    // Moving to cover still shoots. Holding fire for the whole trip made a bot
    // whose chosen corner turned out to be awkward stop fighting entirely, and
    // firing while repositioning is what soldiers actually do — the movement is
    // the difference between these states, not the willingness to shoot.
    if (this.state !== "engage" && this.state !== "takeCover") return;
    // Tucked in behind cover, though, is genuinely a pause: the whole point of
    // the peek cycle is that there are moments the bot is neither shooting nor
    // shootable.
    if (this.state === "engage" && this.hasCoverSpot && !this.peekedOut) return;

    this.aimT += dt;
    if (this.aimT < this.profile.reactionTime) return;
    if (this.fireCooldown > 0) return;

    const dist = Vector3.Distance(this.eyePos, t.eyePos);
    if (dist > b.engageRange) return;

    // Accuracy falls off linearly with range, so a bot across the square is a
    // nuisance and one in the same building is lethal. Skill scales the whole
    // cone, and a recent hit opens it further.
    const k = Math.min(1, dist / b.engageRange);
    let spread = (b.spreadNear + (b.spreadFar - b.spreadNear) * k) * this.profile.spreadMult;
    // Crouching steadies the shot by the same modest amount it does for the
    // player: the stance is bought for the cover, and is not a second ADS.
    spread *= 1 - (1 - b.cover.crouchSpreadMult) * this.crouchBlend;
    if (this.flinchT > 0) spread += b.combat.flinchKick / Math.max(dist, 1);

    const blocked = ctx.fire(this, this.aimPoint, spread);

    // The shot already paid for a wall pick inside CombatSystem; reading its
    // result back is a free line-of-sight check. A single blocked round proves
    // nothing (a wide one behind a live target does that all the time), but a
    // run of them means the target has stepped behind something.
    this.blockedStreak = blocked ? this.blockedStreak + 1 : 0;
    if (this.blockedStreak >= b.combat.losBrokenShots) {
      this.blockedStreak = 0;
      this.rememberTarget();
      this.target = null;
      this.aimLocked = false;
    }

    this.magLeft -= 1;
    this.burstLeft -= 1;
    if (this.magLeft <= 0) {
      this.reloadT = this.profile.reloadTime;
      this.onReload();
    } else if (this.burstLeft <= 0) {
      this.burstLeft = this.profile.burstSize;
      this.fireCooldown = this.profile.burstPause;
    } else {
      this.fireCooldown = 1 / b.fireRate;
    }
  }

  /** Wired by BattleSystem so Game can play the sound. */
  onReload: () => void = () => {};

  /**
   * Wired by BattleSystem: this bot has just been killed, with `position` and
   * `deathFrom` both already written.
   *
   * A callback rather than the kill path telling the radio, because the kill
   * path is `Game`'s and `Match`'s and there are three of them; this is the one
   * place every death goes through, whichever side of the wire it is on.
   */
  onDied: () => void = () => {};

  /**
   * Wired by BattleSystem so Game can play the sound: a foot went down. Fires
   * for every bot on the map, however far away — the distance test lives in
   * `Sfx.botStep`, which is the only thing that knows where the listener is.
   */
  onStep: () => void = () => {};

  /**
   * Parks the current target in short-term memory before it is dropped, so
   * re-acquiring the same enemy costs `reacquireDelay` rather than a fresh
   * wind-up. Without this, nulling a target on a lost line of sight would read
   * as a target *change* on the next think and reset `aimT` — the exact
   * hysteresis failure that once made bots never fire at all.
   */
  private rememberTarget(): void {
    if (!this.target) return;
    this.memory.lastAimed = this.target;
    this.memory.lastAimedT = CONFIG.bots.combat.threatMemory;
    this.memory.sawEnemy(this.target.position);
  }

  /**
   * The expensive half of the AI, run at `CONFIG.bots.thinkRate` rather than
   * every frame. Everything here either fires a ray or walks a list.
   */
  think(ctx: BattleCtx, zone: BotZone): void {
    if (this.state === "dead") return;
    const b = CONFIG.bots;

    const m = this.memory;
    const previous = this.target;
    this.target = ctx.acquire(this);
    if (this.target !== previous) {
      if (previous) {
        m.lastAimed = previous;
        m.lastAimedT = b.combat.threatMemory;
      }
      // A genuinely new enemy pays the full wind-up. One this bot was tracking
      // moments ago is picked back up part-way through it — which is what makes
      // a second peek round the same corner dangerous, without ever being an
      // instant snap. Keeping this reset narrow is load-bearing: reset it on
      // anything less than a real target change and bots never finish a
      // wind-up and effectively never fire.
      this.aimT =
        this.target && this.target === m.lastAimed
          ? this.profile.reactionTime - this.profile.reacquireDelay
          : 0;
      this.aimLocked = false;
      this.blockedStreak = 0;
    }
    this.callW = 0;
    if (this.target) {
      m.sawEnemy(this.target.position);
      // Tell the squad. One line of traffic per think while a bot has eyes on
      // somebody, which is the one thing hearing cannot report: an enemy who
      // has not fired yet.
      ctx.callContact(this, this.target.position);
    } else if (!m.alerted && ctx.contactCall(this, _to)) {
      // **A call is a LOOK, not a search.** Where to walk is the squad's
      // objective and a shot is what changes it (`hearGunshot` seeds a hunt);
      // what a call buys is that the rest of the squad is FACING the right way
      // when it matters, which against a directional acquisition cone is most
      // of what being warned is worth. Making it a destination instead was
      // measured and rejected: it put Greyfen's roster in `hunt` 63% of the
      // time against 39%, halved the time spent fighting, and cost the flags
      // the difference — a squad that investigates every sighting is a squad
      // that never arrives anywhere.
      //
      // Only when there is nothing of the bot's OWN to look at: something this
      // body saw or was shot by outranks something it was told.
      const d = Math.hypot(_to.x - this.position.x, _to.z - this.position.z);
      if (d < b.engageRange) {
        // Close enough that it could become this bot's fight. Further off, a
        // whole squad turning to stare at a point none of them could shoot at
        // is a tell with nothing behind it.
        //
        // The error is drawn HERE and not at the caller, so four bots take one
        // call four slightly different ways — the same reason `hearGunshot`
        // jitters per listener.
        const j = CONFIG.bots.radio.contactJitter;
        this.call.set(
          _to.x + (this.rand() * 2 - 1) * j,
          _to.y,
          _to.z + (this.rand() * 2 - 1) * j,
        );
        this.callW = 1;
      }
    }
    // Where the team has been dying, refreshed at think rate for the three
    // per-frame consumers: the approach speed, the heading swerve and the
    // facing. See `hazard`.
    this.hazardW = ctx.hazardNear(this, this.hazard, this.hazardFrom);
    this.considerGrenade(ctx);
    this.considerRocket(ctx);

    let want: BotState;
    if (this.target) {
      const c = b.cover;
      const tx = this.target.position.x;
      const tz = this.target.position.z;
      // What the ground the bot is standing on is worth against THIS bearing.
      // Read once: the re-validation below, the decision to look for something
      // better and the stance all turn on it.
      const hereKind = ctx.coverKind(this, tx, tz);
      // A spot picked against one bearing stops being cover the moment the
      // shooter walks round it. Re-validating here is what stops a bot hugging
      // a wall that no longer has anything behind it — and re-reading the KIND
      // is the softer half of the same rule: a corner that has become something
      // you can only duck behind is still cover, and the answer to it is the
      // stance rather than the search.
      if (this.hasCoverSpot && this.atCoverSpot()) {
        this.coverKind = hereKind;
        if (hereKind === "none") this.dropCover();
      }
      // Cover is a preference, not a commitment. A bot that has not reached the
      // corner within `abandonTime` is walking into something the direct
      // steering cannot get round, and standing there holding fire for the rest
      // of the round is far worse than fighting from where it is.
      //
      // This is a wall-clock cap rather than the stuck watchdog on purpose: the
      // watchdog only fires once per detour cycle, so accumulating against it
      // took a minute and a half to trip and bots simply never came back.
      if (this.state === "takeCover" && this.stateT > c.abandonTime) {
        this.dropCover();
        // And do not immediately pick it again. Without the cooldown the very
        // next branch re-runs `findCover`, gets the same unreachable spot back,
        // and the bot spends the whole round oscillating into a wall.
        this.coverCooldownT = c.retryDelay;
      }
      if (
        this.pressure > 0.75 &&
        this.hp < b.maxHealth * this.profile.retreatHealthFrac
      ) {
        // Hurt and under fire with no kill in sight: break contact rather than
        // trade rounds you are losing.
        want = "retreat";
      } else if (
        m.suppression > c.suppressEnter &&
        this.hasCoverSpot &&
        this.atCoverSpot()
      ) {
        // Heavy fire while already behind something: stay there.
        want = "suppressed";
      } else if (
        this.state === "suppressed" &&
        m.suppression > c.suppressExit &&
        this.hasCoverSpot
      ) {
        want = "suppressed";
      } else if (this.hasCoverSpot && !this.atCoverSpot()) {
        want = "takeCover";
      } else if (
        this.profile.coverUse > b.skill.coverUseThreshold &&
        !this.hasCoverSpot &&
        this.coverCooldownT <= 0 &&
        // Only once rounds are actually coming this way. Breaking for a wall
        // the instant an enemy is merely *visible* had every bot in every fight
        // sprinting for the nearest corner, which is neither human nor fun.
        (this.memory.suppression > 0 || this.pressure > 0)
      ) {
        if (hereKind === "crouch") {
          // Under fire, already standing behind something a ducked body is safe
          // behind. Anchor here: that is the whole of what crouch cover buys —
          // the wall is at the bot's feet, and taking it costs a stance instead
          // of a trip across open ground to a corner. The peek cycle starts
          // itself on the next frame, up over the wall rather than round it.
          this.coverSpot.copyFrom(this.position);
          this.coverKind = "crouch";
          this.hasCoverSpot = true;
          want = "engage";
        } else if (hereKind === "hard") {
          // Stand-up cover where it stands: nothing to move to and no stance to
          // take, which is exactly what this branch did before there was one.
          want = "engage";
        } else {
          // In the open, with somewhere better within a few metres. One baked
          // lookup, no rays.
          const found = ctx.findCover(this, tx, tz, this.coverSpot);
          if (found !== "none") {
            this.hasCoverSpot = true;
            this.coverKind = found;
            want = "takeCover";
          } else {
            want = "engage";
          }
        }
      } else {
        want = "engage";
      }
    } else if (zone === "hold") {
      // Checked *before* the cue, deliberately. A defender that hears a shot
      // and walks off to investigate has abandoned the only thing it was there
      // to do — staying put is the job. It watches the bearing instead, which
      // the facing code already does from the same threat memory.
      //
      // The hold branch owns its own cover spot, so unlike every other case
      // here it must not drop one.
      this.zone = zone;
      want = "capture";
    } else if (this.hasCoverSpot && this.atCoverSpot() && m.lastAimedT > 0) {
      // No line of sight from behind this bot's own cover — which is what the
      // cover is DOING, and is the ordinary state of the tucked-in half of a
      // peek. Hold the anchor: the cycle stands the bot up again in a moment,
      // and `lastAimed` outliving the sightline is what lets it pick the same
      // enemy back up part-way through the wind-up.
      //
      // Falling through to the search cue below is what used to happen, and it
      // dropped the anchor on the first think after ducking: a bot that took
      // cover forgot why it had, stood up out of it and walked off to look for
      // whoever was shooting at it. It is also why crouching behind a low wall
      // could not work at all — the stance breaks the sightline by
      // construction, so the ducking bot was the one that always lost its
      // target.
      //
      // Heavy fire while down there is `suppressed` and not `engage`, which is
      // the one state that never peeks out: pinned by rounds you cannot see the
      // source of is exactly what that state is for, and it is the one this
      // branch made reachable — the whole decision tree above it needs a
      // visible target.
      // Two thresholds, for the reason the visible-target branch above has
      // two: a bot sitting on one flickers between the states every think.
      const pin =
        this.state === "suppressed" ? b.cover.suppressExit : b.cover.suppressEnter;
      want = m.suppression > pin ? "suppressed" : "engage";
    } else if (m.hasCue) {
      // Something happened and nobody is in sight: go and look.
      this.dropCover();
      want = "hunt";
    } else if (zone === "contest") {
      this.dropCover();
      this.zone = zone;
      want = "capture";
    } else {
      this.dropCover();
      this.zone = "none";
      want = "advance";
    }

    if (want === this.state) return;
    // Escalation is immediate; falling back to something calmer has to wait out
    // the dwell of the state being *left*, so a bot commits to what it is doing
    // instead of chattering between two conditions it sits on the edge of.
    // `dead` was ruled out by the early return above, which is why this indexes
    // straight into the table rather than guarding for it.
    const dwell = CONFIG.bots.stateDwell[this.state];
    if (PRIORITY[want] > PRIORITY[this.state] || this.stateT >= dwell) {
      this.state = want;
      this.stateT = 0;
      if (want === "hunt") this.sweepT = 0;
      if (want === "engage" && this.hasCoverSpot) {
        // Arrived, or gave up on the way. Start the cycle leaned out so a bot
        // that reached cover mid-fight fires promptly rather than waiting a
        // full tuck-in first.
        this.peekedOut = true;
        this.peekT = this.profile.peekOutTime;
      }
    }
  }

  /**
   * Whether to put a grenade on the enemy this bot is already fighting.
   *
   * Considered on the ordinary think tick rather than on a timer of its own:
   * it is a decision about a target the bot has, and a bot with no target has
   * nothing to throw at. That also means the chance below is per tick, so the
   * think rate is part of the tuning — see `CONFIG.grenade.bot.chance`.
   *
   * **The range band IS the safety model.** A bot has no idea how far its own
   * blast reaches — there is no self-damage to teach it and no sim to ask — so
   * it is simply never allowed to throw at anything close enough to catch
   * itself, and the arc solve refuses anything too far. Nothing else here
   * protects the thrower, and nothing else has to: grenades cannot hurt their
   * own side (see `CONFIG.grenade`).
   *
   * Skill scales the chance rather than the accuracy. An ace throwing wildly
   * is indistinguishable from a rookie doing the same thing; an ace throwing
   * MORE is a squad that starts using grenades once it has been held up, which
   * is what the player actually reads.
   */
  private considerGrenade(ctx: BattleCtx): void {
    const cfg = CONFIG.grenade.bot;
    const t = this.target;
    if (!t || this.grenades <= 0 || this.grenadeT > 0) return;
    const dx = t.position.x - this.position.x;
    const dz = t.position.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < cfg.minRange || dist > cfg.maxRange) return;
    if (this.rand() > cfg.chance * (0.4 + this.skill)) return;
    // Aimed at the ground the target is standing on, scattered — a grenade
    // thrown exactly onto someone's feet every time is a mortar, not a soldier,
    // and the falloff is where the play is anyway.
    _nade.set(
      t.position.x + (this.rand() * 2 - 1) * cfg.scatter,
      t.position.y,
      t.position.z + (this.rand() * 2 - 1) * cfg.scatter,
    );
    // The arm gets the last word: a solve it cannot make spends nothing.
    if (!ctx.throwGrenade(this, _nade)) return;
    this.grenades -= 1;
    this.grenadeT = cfg.cooldown;
  }

  /**
   * Whether to put a rocket into the armour this bot is already looking at.
   *
   * **A launcher bot fires at ARMOUR and at nothing else**, and that test is
   * the first line rather than a band or a chance, because it is the rule and
   * the rest is tuning. A rocket is a one-shot kill on a body with five metres
   * of splash around it; sixteen bots that could reach for one would turn
   * every firefight in the game into indirect fire. The launcher exists so
   * that a tank is a decision rather than a free ride, and it is allowed to do
   * that and nothing else.
   *
   * Considered on the ordinary think tick beside the grenade, and for the same
   * reason: it is a decision about a target the bot already has.
   *
   * **It fires at where the hull IS, with no lead at all**, and that is the
   * counterplay rather than an approximation. A rocket takes over a second to
   * cross an avenue and a tank does 11 m/s, so a hull that keeps moving is
   * caught by the splash at worst and a hull that stops to line up its own
   * shot is hit squarely. That is exactly the trade a driver should be making,
   * and a bot that solved for the intercept would take it away.
   *
   * Skill scales the chance rather than the accuracy, the argument
   * `considerGrenade` makes at length.
   */
  private considerRocket(ctx: BattleCtx): void {
    const cfg = CONFIG.antiTankBots;
    const t = this.target;
    if (!this.hasLauncher || !t?.armoured) return;
    if (this.rockets <= 0 || this.rocketT > 0) return;
    const dx = t.center.x - this.position.x;
    const dz = t.center.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < cfg.minRange || dist > cfg.maxRange) return;
    if (this.rand() > cfg.chance * (0.4 + this.skill)) return;
    // Scatter, pro rata with the range: a launcher bot that hit a stationary
    // hull dead centre every time would be a guided missile, and the splash
    // means a near miss is still worth firing.
    const spread = cfg.scatter * (dist / cfg.maxRange);
    _rocket.set(
      t.center.x + (this.rand() * 2 - 1) * spread,
      t.center.y + (this.rand() * 2 - 1) * spread * 0.3,
      t.center.z + (this.rand() * 2 - 1) * spread,
    );
    // The pool gets the last word, exactly as the arm does for a grenade: a
    // launch that never happened must not cost a rocket.
    if (!ctx.fireRocket(this, _rocket)) return;
    this.rockets -= 1;
    this.rocketT = cfg.cooldown;
  }

  /**
   * Turns the flow field's raw output into something a body could plausibly
   * walk, in place: smooths it, weaves it, hugs walls with it, and notices when
   * the route has just turned a corner.
   *
   * Only the flow-field states use this. The close-quarters states (`hunt`
   * arrival, `takeCover`, the peek cycle) steer at a specific point a few metres
   * away, where smoothing would only add lag and blur the peek.
   *
   * It runs *before* separation and the stuck watchdog on purpose: the
   * watchdog's sidestep is what gets a wedged bot out from behind a tree, and
   * smoothing applied after it would blunt exactly that.
   */
  private smoothHeading(ctx: BattleCtx, dt: number, dir: Vector3): void {
    const m = CONFIG.bots.movement;
    if (dir.x === 0 && dir.z === 0) return;

    // Lateral weave. Four bots sharing one field otherwise walk single file
    // down the identical line, which no squad has ever done.
    this.lanePhase += (dt * Math.PI * 2) / m.lanePeriod;
    const weave = Math.sin(this.lanePhase) * m.laneOffset;
    let wantX = dir.x - dir.z * weave;
    let wantZ = dir.z + dir.x * weave;

    // Wall hugging: nudge toward the more enclosed side. A preference only —
    // the field still decides where the bot is going, this picks which side of
    // the street it walks down.
    const open = ctx.openness(this);
    if (open < 1) {
      const pull = (1 - open) * m.wallHug;
      wantX += -dir.z * this.strafe * pull;
      wantZ += dir.x * this.strafe * pull;
    }

    // Ground the team has been dying on. There is one route graph and no second
    // one to pick, so "a different way in" is made by bending the only way
    // there is: push the heading round the mark rather than through it, on
    // whichever side the bot is already passing. Lateral and never a retreat —
    // a bot pushed straight back would stop advancing and stand there instead.
    // What it buys is a squad that got cut down crossing the square coming
    // round the edge of it next time.
    if (this.hazardW > 0) {
      const awayX = this.position.x - this.hazard.x;
      const awayZ = this.position.z - this.hazard.z;
      const awayLen = Math.hypot(awayX, awayZ);
      if (awayLen > 1e-3) {
        // Which side of the route the mark is on: the component of "away from
        // it" along the heading's left normal.
        const lat = (-dir.z * awayX + dir.x * awayZ) / awayLen;
        const side = lat >= 0 ? 1 : -1;
        const pull = this.hazardW * CONFIG.bots.radio.hazardSwerve;
        wantX += -dir.z * side * pull;
        wantZ += dir.x * side * pull;
      }
    }

    const len = Math.hypot(wantX, wantZ);
    if (len < 1e-4) return;
    wantX /= len;
    wantZ /= len;

    if (!this.headingSet) {
      this.headingX = wantX;
      this.headingZ = wantZ;
      this.headingSet = true;
    } else {
      // A big swing means the route just turned a corner. Stop and look before
      // walking round it — the pause is the tell, and `moveBlend` decaying to
      // zero makes the rig actually stand still rather than moonwalk.
      const dot = this.headingX * wantX + this.headingZ * wantZ;
      if (dot < Math.cos(m.cornerAngle) && this.cornerT <= 0) {
        this.cornerT = m.cornerPause;
      }
      const k = Math.min(1, dt * m.headingRate);
      this.headingX += (wantX - this.headingX) * k;
      this.headingZ += (wantZ - this.headingZ) * k;
      const hl = Math.hypot(this.headingX, this.headingZ);
      if (hl > 1e-4) {
        this.headingX /= hl;
        this.headingZ /= hl;
      }
    }
    dir.set(this.headingX, 0, this.headingZ);
  }

  /**
   * Which way to strafe, by cover rather than by coin flip. The old version
   * flipped a `Math.random()` every second or so, which circles a target
   * regardless of whether either side has anything to hide behind.
   */
  private pickStrafe(ctx: BattleCtx): number {
    const t = this.target;
    if (!t) return this.rand() < 0.5 ? -1 : 1;
    const dx = t.position.x - this.position.x;
    const dz = t.position.z - this.position.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) return this.strafe;
    const probe = CONFIG.bots.cover.probeDistance;
    // A body's step along each tangent, scored by whether it has cover from
    // where the target is standing.
    const leftCovered = ctx.coverKind(this, t.position.x, t.position.z) !== "none";
    if (leftCovered) return this.strafe;
    const nx = -dz / len;
    const nz = dx / len;
    // Cheap proxy for "is there more to hide behind that way": the cover mask
    // is per-surface, so sample the bearing rather than moving the bot. Either
    // kind counts — this only picks which way to circle, and something to duck
    // behind is a better place to end up than open ground.
    const a =
      ctx.coverKind(this, this.position.x + nx * probe, this.position.z + nz * probe) !==
      "none";
    const b =
      ctx.coverKind(this, this.position.x - nx * probe, this.position.z - nz * probe) !==
      "none";
    if (a !== b) return a ? 1 : -1;
    return this.rand() < 0.5 ? -1 : 1;
  }

  /** Standing at (or beside) the latched cover spot. */
  private atCoverSpot(): boolean {
    if (!this.hasCoverSpot) return false;
    const dx = this.position.x - this.coverSpot.x;
    const dz = this.position.z - this.coverSpot.z;
    const r = CONFIG.bots.cover.arriveRadius + CONFIG.bots.cover.peekOffset;
    return dx * dx + dz * dz <= r * r;
  }

  /**
   * Drops the current cover spot. Called when the fight ends, when the threat
   * moves so the spot no longer covers anything, or when the watchdog says the
   * bot cannot get there.
   */
  private dropCover(): void {
    this.hasCoverSpot = false;
    this.coverKind = "none";
    this.peekedOut = false;
    this.peekT = 0;
  }

  private aimPitch(): number {
    const t = this.target;
    if (!t) return 0;
    const dy = t.eyePos.y - this.eyePos.y;
    const flat = Math.hypot(
      t.position.x - this.position.x,
      t.position.z - this.position.z,
    );
    return Math.atan2(dy, Math.max(flat, 0.1));
  }

  private syncTransform(): void {
    const c = this.rig.centerHeight;
    const p = CONFIG.player;
    // The ROOT does not move with the crouch. The stance lives inside the rig —
    // `animateSoldier` drops the body node and folds the legs with the boots
    // planted — so a root pulled down with it would put the feet through the
    // floor. The same split `NetSoldier` and `DeathCam` draw for a body they do
    // not own.
    this.rig.root.position.set(this.position.x, this.position.y + c, this.position.z);
    this.rig.root.rotation.y = this.bodyYaw;
    // What DOES come down is the pair the fight is fought with, and they must
    // come down TOGETHER. `eyePos` is what every shooter aims at and what line
    // of sight is tested to; `center` is the sphere their rounds are tested
    // against. Drop the eye alone and crouching makes this bot easier to kill,
    // not harder — every incoming round aimed at the middle of an unmoved
    // sphere instead of grazing its top. The arithmetic is `NetSoldier`'s,
    // because a remote copy of this body has to land in the same place.
    this.center.set(
      this.position.x,
      this.position.y + c + (p.crouchCenterHeight - c) * this.crouchBlend,
      this.position.z,
    );
    // `camera.eyeHeight`, not a literal repeat of it. This is the point the
    // player's own camera sits at, the point bots test line of sight against,
    // and the point `combat.headRadius` centres the head zone on — one number
    // doing all three is what makes "what a bot can see is what you can see"
    // true. Written out here it was a fourth copy that could not be reached by
    // any of the three comments reasoning about its value.
    this.eyePos.set(
      this.position.x,
      this.position.y +
        CONFIG.camera.eyeHeight +
        (p.crouchEyeHeight - CONFIG.camera.eyeHeight) * this.crouchBlend,
      this.position.z,
    );
  }

  muzzleWorld(): Vector3 {
    return this.rig.muzzle.getAbsolutePosition();
  }

  /**
   * Frees the rig. The pool is built once and never disposed, so nothing in a
   * round reaches this — but the flag it does NOT pass is the load-bearing
   * half: a soldier is painted out of `CelMaterialFactory`'s shared caches
   * (`mats.get`, `mats.getEmissive`), so disposing this rig's materials would
   * dispose the paint every other bot and the map itself are holding, and the
   * factory would hand the dead material out again on the next `get`. See
   * `Tank.dispose`, where the same flag took most of a city off the screen.
   */
  dispose(): void {
    this.rig.root.dispose(false);
  }
}
