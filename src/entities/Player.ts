/**
 * Player.ts — Player controller: movement/sprint/crouch/jump physics,
 * health/regen, weapon state (fire/reload/spread), gunfeel dressing (muzzle
 * flash mesh, ejected brass), and the first-person viewmodel wiring.
 * Owns: the player Combatant, and the ViewModel hanging off the camera.
 * The carried weapon is a resolved `WeaponSetup`, never CONFIG read at the
 * use site: damage, rate, magazine, spread, range and the recoil multipliers
 * all come off it, so swapping guns is one assignment in `setWeapon`.
 * TWO weapons are carried — the kit's primary and the sidearm everyone has —
 * and each keeps its own magazine in a `Holster` while it is slung, which is
 * the whole point of the second slot: there is no reserve ammunition in this
 * game, so a swap buys you a loaded weapon in a third of a second where a
 * reload costs one and a half. `swapWeapon` starts the gesture and
 * `completeSwap` is the one place the hands change, partway through it and
 * behind the bottom of the frame. Nothing fires while it is in flight.
 * Invariants: probeGround is ANALYTIC — the collider boxes bucketed at map
 * load, the heightfield, and the fleet's decks — and no longer a scene pick, so
 * it costs the same on a 400 m map as on a 240 m one. It filters nothing on
 * `metadata.solid`, because the structures it reads only ever held solids.
 * `position` is the FEET, as `Combatant` requires, and is NOT `root.position`
 * — the capsule's centre, half a body higher. Anything wanting the middle of
 * the body wants `center`. The three exported points (`position`, `center`,
 * `eyePos`) are derived in `syncCombatant` and are the only ones anything
 * outside this file may read.
 * Crouch moves `eyePos` AND `center` on one blend — the eye is the camera, the
 * LOS target and the bots' aim point at once, so lowering it without lowering
 * the hit sphere makes crouching a liability rather than cover.
 * Health regenerates after CONFIG.player.regenDelay — with 8 hostile bots and
 * no medics this is load-bearing, not decoration. The player has no world body
 * mesh at all: the camera is inside the head, so the only thing on screen is
 * the viewmodel (and the blob shadow ShadowSystem draws underfoot). The flash
 * mesh and casing pool are player-only visuals (bots get neither — see
 * CONFIG.gunfeel), and the flash must join VIEWMODEL_GROUP with the rifle it
 * hangs off. Damage flows out via the onDamaged callback wired in Game.
 * The RECOIL VECTOR is built here (`recoilKick`) and nowhere else: every number
 * in it is the weapon's or the body's, and Game only wires the result to the
 * camera. The horizontal is drawn ONCE per shot into `kickDrift`, read by the
 * aim, by the viewmodel's lean and by the view punch — a second draw anywhere
 * would have the weapon leaning one way while the muzzle walked the other.
 * `stringed` is the single test both string-shaped terms share
 * (`firstShotMult` and `recoil.pattern`); splitting them hands the DMR and the
 * pistol a 20% climb discount for firing at their own rate limit.
 * The viewmodel's kick spring is stepped in CLOSED FORM, not integrated: at
 * 6 Hz semi-implicit Euler makes the peak a function of the frame rate (0.08 at
 * 30 fps against 0.78 at 120). CameraSystem.land's 2 Hz is inside where Euler
 * holds and is deliberately not the same code.
 * Footfalls are read off the CAMERA's bob phase, never a step timer of their
 * own — the sound has to land on the dip you can see — and leave here as
 * PlayerEvents rather than as a sound: this file owns no audio.
 * Grenades are a count, a cooldown and a clock here and nothing else — the
 * thrown body belongs to GrenadeSystem, which is Game's. The clock is what
 * makes the throw a gesture rather than an event: `beginThrow` starts it,
 * `throwReleaseDue` reports the frame the hand reaches full extension, and
 * only then does Game ask the pool to carry a grenade and `spendGrenade` book
 * it. The count is still debited last, for the reason it always was — the pool
 * may refuse, and a count spent on a grenade that never arrives is worse than
 * one not thrown.
 */
import {
  type AbstractMesh,
  Mesh,
  MeshBuilder,
  type Node,
  Scene,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import { impulse } from "../core/math";
import {
  RecoilAxis,
  recoilGain,
  type RecoilShape,
} from "../core/recoilCurve";
import { CelMaterialFactory } from "../shaders/CelShader";
import type { CameraSystem } from "../core/CameraSystem";
import type { InputManager } from "../core/InputManager";
import {
  equipmentSetup,
  isEquipmentId,
  type EquipmentId,
} from "./equipment";
import type { FinishId } from "./finishes";
import type { SightId } from "./sights";
import {
  DEFAULT_WEAPON,
  SIDEARM,
  weaponSetup,
  type PrimaryWeaponId,
  type ReportVoice,
  type CarriedId,
  type WeaponId,
  type WeaponSetup,
} from "./weapons";
import { ViewModel, VIEWMODEL_GROUP, type ViewModelParams } from "./ViewModel";
import { narrowedMove, type CollisionField } from "../world/CollisionField";
import type { ObstacleField } from "../world/ObstacleField";
import { TerrainField } from "../world/TerrainField";
import type { Combatant, Team } from "./Combatant";
import type { DamageKind, ShotOptions } from "../systems/CombatSystem";

/**
 * The height of the highest MOVING solid surface a body standing at `(x, z)`
 * would be on, in the band `[floor, ceiling]`, or null for nothing there.
 *
 * `ObstacleField.groundAt`'s signature, deliberately term for term, because it
 * is the same question asked of the half of the world that the baked structures
 * cannot hold. It is a bare function type and not a system, so nothing here has
 * heard of a vehicle: `Game` wires it to `VehicleSystem.deckAt`, which is where
 * a tank's deck actually is, and the day something else in this game moves and
 * can be stood on it goes through the same door.
 */
export type MovingGround = (
  x: number,
  z: number,
  ceiling: number,
  floor: number,
) => number | null;

/**
 * One weapon the player is carrying: what it is, and the magazine that stays
 * with it while it is slung.
 *
 * A holster rather than a bare id because the ammunition is the whole reason
 * the second slot is worth having: a weapon put away half-empty comes back
 * half-empty, so swapping is a way to keep shooting rather than a way to
 * refill. There is no reserve pool in this game — a reload always fills the
 * magazine — so if a swap handed back a full one the sidearm would be a free
 * reload and nothing else would ever be reloaded at all.
 */
interface Holster {
  setup: WeaponSetup;
  /** Rounds left in this weapon's magazine, carried across a swap. */
  ammo: number;
}

/** A weapon picked up with a full magazine. */
function holster(id: WeaponId): Holster {
  const setup = weaponSetup(id);
  return { setup, ammo: setup.magSize };
}

/**
 * An anti-tank item picked up with a life's worth of it.
 *
 * The same shape as a weapon's holster and it has to be, or the third slot
 * would be a second carry path — but what is in `ammo` is not a magazine. It
 * is the whole of the ammunition, `magSize` IS `CONFIG.equipment[id].carried`,
 * and there is no reload to put more in: `startReload` refuses this slot, so
 * a spent launcher stays spent until the body does.
 */
function equipHolster(id: EquipmentId): Holster {
  const setup = equipmentSetup(id);
  return { setup, ammo: setup.magSize };
}

/**
 * The two slots, by index — which is not an implementation detail: it is
 * exactly what the `1` and `2` keys name, so the number on the key and the
 * number here are the same fact and there is no table in between them to
 * disagree.
 */
export const PRIMARY_SLOT = 0;
export const SIDEARM_SLOT = 1;
/**
 * The anti-tank slot — `3`, and the one slot that may not be there at all.
 *
 * A kit carries it only on a map with armour on it (`Game.applyLoadout`), so
 * `slots` is two long or three and every reader of it has to cope with both.
 * That is why `drawSlot` bounds-checks rather than switching on a constant,
 * and why the wheel swaps between the first two: a slot that exists on one map
 * and not the next cannot be half of "the other weapon".
 */
export const EQUIP_SLOT = 2;

/** Run-scoped stat modifiers granted by loot. */
export interface PlayerMods {
  damageMult: number;
  speedMult: number;
  maxHpBonus: number;
  magBonus: number;
}

/** One live brass case: world-space ballistic, despawned on `t` expiry. */
interface Casing {
  mesh: Mesh;
  vel: Vector3;
  spin: number;
  t: number;
}

/** Scratch for the eject direction — no allocation per shot. */
const _casingDir = new Vector3();

/**
 * Bob phase of the first of the two footfalls in a stride.
 *
 * The camera's vertical bob is `sin(bobPhase * 2)`, so its two dips per cycle
 * — the moments the head is lowest — are at 3pi/4 and 7pi/4. That is where a
 * foot is taking the weight, so that is where the sound goes. Deriving it from
 * the phase rather than running a step timer is the same rule the viewmodel
 * follows: two things fed the same drive stay together, and a step heard off
 * the beat of the dip you can see is worse than no step at all.
 */
const FOOTFALL_PHASE = (3 * Math.PI) / 4;

/**
 * Whether the bob phase passed a footfall this frame. Phase wraps at 2pi and
 * only ever advances, so this measures forward distance to each of the two
 * marks and asks whether the frame's advance covered it.
 */
function crossedFootfall(prev: number, next: number): boolean {
  const tau = Math.PI * 2;
  const advance = (next - prev + tau) % tau;
  if (advance <= 0) return false;
  const first = (FOOTFALL_PHASE - prev + tau) % tau;
  const second = (FOOTFALL_PHASE + Math.PI - prev + tau) % tau;
  return (first > 0 && first <= advance) || (second > 0 && second <= advance);
}

/**
 * What happened to the player this frame that something outside it has to
 * react to. Returned from `update` and reused between frames — Game reads it
 * immediately and keeps nothing.
 */
export interface PlayerEvents {
  jumped: boolean;
  /** Loudness 0..1 of a foot going down this frame; 0 if none did. */
  footstep: number;
  /** Impact speed (m/s) of a landing this frame; 0 if the player didn't. */
  landed: number;
}

/**
 * Player pawn: movement (walk/jump/gravity) with Babylon collision sliding,
 * weapon state (ammo/reload/fire cooldown), and the smoothed signals that
 * drive the first-person weapon (movement, sprint, reload, turn rate, kick).
 *
 * The invisible root capsule stays the physics collider. In first person the
 * pawn has no visible body — the camera sits at its eye — so the only meshes
 * it owns are the viewmodel's, the muzzle flash and the brass.
 */
export class Player implements Combatant {
  root: Mesh;
  /** Which side the player fights for. Set by Game when a round starts. */
  team: Team = 0;
  /**
   * FEET, as `Combatant` requires — NOT `root.position`, which is the collider
   * capsule's centre and sits `groundY` above them.
   *
   * The distinction is invisible offline, where nothing outside this file reads
   * the `y` at all, and it is the whole ballgame over a wire: the server and
   * every other client take a combatant's `position.y` as the ground under it
   * and build the body, the centre and the eye up from there. Handed a capsule
   * centre they build all three half a body too high — the remote body floats,
   * its hit spheres float with it, and the movement validator asks whether
   * there is room for a player standing 0.9 m in the air, which is how a door
   * lintel becomes a wall. Kept in sync beside `center` and `eyePos`.
   */
  readonly position = new Vector3();
  /** Body centre and eye line, kept in sync each frame for hitscan and LOS. */
  readonly center = new Vector3();
  readonly eyePos = new Vector3();
  readonly hitRadius = CONFIG.player.hitRadius;
  /**
   * Wired by Game. Bots damage the player straight through `CombatSystem`, so
   * this is how the flash, the sound, and the death handling still happen.
   */
  onDamaged: (
    amount: number,
    died: boolean,
    from?: Vector3,
    kind?: DamageKind,
  ) => void = () => {};
  /** The rifle and hands on screen; the only visible thing the player owns. */
  private view: ViewModel;
  /** Whether the viewmodel is hidden (menu, deploy screen, editor). */
  private bodyHidden = true;
  /**
   * Whether the weapon is on the loadout screen's turntable. Its own flag
   * rather than a case of `bodyHidden`: every state the kit screen covers has
   * the gun put away, and showing it there must not mean the player is
   * holding it.
   */
  private inspecting = false;

  // Smoothed inputs for the viewmodel pose.
  private moveBlend = 0;
  private airBlend = 0;
  private reloadBlend = 0;
  private sprintBlend = 0;
  /** Smoothed camera yaw/pitch rates (rad/s): the weapon trails both. */
  private turnRate = 0;
  private pitchRate = 0;
  private prevYaw = 0;
  private prevPitch = 0;
  /** Last frame's bob phase, for the footfall crossing test. */
  private prevBobPhase = 0;
  /** This frame's outgoing events; rewritten each update, never reallocated. */
  private readonly events: PlayerEvents = { jumped: false, footstep: 0, landed: 0 };

  health: number = CONFIG.player.maxHealth;
  alive = true;
  /**
   * Nothing may hurt this body — read by `CombatSystem.fire`,
   * `GrenadeSystem.blastAt` and `AimAssistSystem`, exactly as `Hittable`
   * describes it, and written by nothing in this file.
   *
   * Today it is true for one reason: the player is inside a vehicle, and the
   * HULL is what is being shot at. `Game` also takes them out of
   * `BattleSystem`'s combatant list for the same span, which is the belt to
   * this brace — a bot that could still ACQUIRE an unkillable target would sit
   * firing at it forever, and this flag only stops the rounds landing.
   *
   * Deliberately NOT checked inside `takeDamage`: that would give the flag a
   * second meaning, and the one caller that must get through it regardless is
   * the vehicle that has just been destroyed with this body inside it.
   */
  invulnerable = false;
  grounded = true;
  /**
   * Grenades left this life. Refilled by `fullReset` and by nothing else —
   * there is no resupply, so two a life is the whole economy.
   */
  grenades: number = CONFIG.grenade.carried;

  /**
   * The two things the player carries: the kit's primary, and the sidearm
   * everybody has. Both are resolved `WeaponSetup`s, so everything about how a
   * gun behaves is read off the carried one rather than from CONFIG at the use
   * site — which is what makes "the player is holding the pistol now" a single
   * reassignment of `carried`.
   */
  private readonly slots: Holster[] = [holster(DEFAULT_WEAPON), holster(SIDEARM)];
  /** Which of `slots` is in the hands. The index IS what `1`/`2` name. */
  private slot = PRIMARY_SLOT;
  /**
   * Wired by Game: the weapon in the player's hands changed. The camera zooms,
   * slows and blends by whatever is being carried, and the HUD names it, so
   * both have to be told — and a swap happens mid-round where `applyLoadout`
   * cannot reach.
   */
  onCarryChanged: () => void = () => {};
  /**
   * Wired by Game: a reload gesture has just begun.
   *
   * `startReload` is the only thing that begins one, and it is reached two ways
   * — the reload key, and `tryShot` firing the last round in the magazine — so
   * a caller that wanted to react to a reload had to catch both and would go on
   * having to catch the next one. The sound is hung off this for that reason,
   * and in a networked round so is the announcement that lets fifteen other
   * players hear it: an unannounced reload is a cue the whole match loses, and
   * the auto-reload is exactly the case a call site would forget.
   *
   * The counterpart of `Bot.onReload`, which `BattleSystem` wires for the same
   * cue on every bot in the pool.
   */
  onReload: () => void = () => {};
  /**
   * Seconds into the swap gesture, or -1 when neither hand is busy. Counts UP
   * like the throw's clock and for the same reason: there is an event in the
   * middle of it (the weapons changing places) and "how long ago" is the only
   * thing that says which side of it we are on.
   */
  private swapT = -1;
  /** How long this particular swap takes — the INCOMING weapon's draw time. */
  private swapTime = 0;
  /** Whether the weapons have yet to change places in this gesture. */
  private swapPending = false;
  /** The slot this swap ends on. Read once, by `completeSwap`. */
  private swapTo = PRIMARY_SLOT;
  reloading = false;
  /** True while the sprint key is held and the player is actually running. */
  sprinting = false;
  /** True while crouch is asked for (held or latched) and not sprinting. */
  crouching = false;
  /**
   * Eased 0..1 stance blend. Drives the eye height, the hit sphere's centre,
   * the move speed, the spread and the bob together — one number, so the
   * transition reads as a single motion the way ADS does.
   */
  private crouchBlend = 0;
  /**
   * That blend, for the one thing outside this class that needs the eased
   * number rather than the `crouching` intent: the stand-in body `DeathCam`
   * stands up has to be posed in the stance the eye and the hit sphere were
   * actually in, and both of those ride this. The boolean would round a body
   * caught a third of the way into a crouch to a full one — half a metre of
   * pop on the frame of death, on the one body the camera is about to spend
   * four seconds pointing at.
   */
  get stance(): number {
    return this.crouchBlend;
  }
  /** Counts down from `regenDelay` after each hit; regen resumes at zero. */
  private regenLockT = 0;
  private reloadT = 0;
  /**
   * 0..1 through the reload, and it FREEZES rather than resetting when one
   * ends. The viewmodel plays the whole gesture off this (see
   * `CONFIG.viewmodel.reload`), so a reload cancelled at a third of the way
   * through has to leave the phase at a third: `reloadBlend` is what eases the
   * weapon back out of the pose, and a phase that snapped to 1 underneath it
   * would take the pose off in a single frame instead. Reset by
   * `startReload`, which is the only thing that begins a gesture.
   */
  private reloadPhase = 1;
  private fireCooldown = 0;
  /**
   * Whether the trigger has been down since before the last thing it asked
   * for. A semi-automatic weapon needs a release between pulls, and this is
   * the only state that remembers one — `InputManager.fire` is held state and
   * has no idea what it was last used for.
   */
  private triggerHeld = false;
  /**
   * Rounds still owed by the burst in flight, or 0 when there is none.
   *
   * This is the whole of what makes a burst a burst rather than three quick
   * shots: the trigger has already said everything it is going to say, so the
   * remaining rounds leave on the weapon's clock and a release cannot stop
   * them. It is therefore also the one piece of firing state that has to be
   * ABANDONED rather than allowed to run out — see the guards in `tryShot`,
   * which drop it on anything that takes the weapon away.
   */
  private burstLeft = 0;
  private velY = 0;
  /** Seconds until the arm is ready to throw another grenade. */
  private throwCooldown = 0;
  /**
   * Seconds since the throw was asked for, or -1 when the arm is idle. The
   * clock the whole gesture runs on: the viewmodel poses the arm from it and
   * `throwReleaseDue` reports the one frame it crosses `throw.windup`, which
   * is when the grenade actually leaves.
   */
  private throwT = -1;
  /** Whether this throw's grenade is still in the hand. */
  private throwPending = false;
  /** Extra spread accumulated by sustained fire; bleeds off when not firing. */
  private spreadBloom = 0;
  /**
   * Rounds fired in the current string, and seconds since the last one.
   *
   * Together they answer one question — is the next round a FIRST round? —
   * which is what `recoil.firstShotMult` is applied to. They live here beside
   * `spreadBloom` because they have exactly its lifecycle: raised by a shot,
   * bled off by time, and dropped by anything that takes the weapon away.
   *
   * `sinceShot` starts at the reset window rather than at 0 so the very first
   * round of a life is a first shot. It is a plain time integral compared
   * against a time threshold, so nothing here varies with the frame rate.
   */
  private stringShots = 0;
  // Annotated, not inferred: `CONFIG` is `as const`, so the initialiser's type
  // is the literal 0.35 and every later assignment fails to compile.
  private sinceShot: number = CONFIG.recoil.stringResetTime;
  /**
   * How hard the player is currently being shot at, 0..1. Raised by every
   * round that cracks past and bled off by time.
   *
   * It reaches exactly one thing — the aimed hold sway, through the drive
   * `update` already pushes at the camera — and that restraint is the design.
   * Suppression that blurs or desaturates the screen is a mechanic that takes
   * INFORMATION away from a player who is already losing, and it is the first
   * thing anyone points at when this feature is disliked. An aimed weapon
   * getting less steady while rounds go past is the same pressure made out of
   * something the player can answer: break the sightline, or crouch, which
   * `aimSway.crouchMult` already rewards.
   *
   * Hip fire is untouched for free, because the sway itself rides the ADS
   * blend. `CONFIG.player.suppressSwayMult` at 0 disables the whole feature.
   */
  private suppression = 0;
  /**
   * The weapon punch on the viewmodel: the gun thrown by the charge, ARRESTED
   * by the grip and then HAULED back into the shoulder.
   *
   * `kick.value` is how far the weapon is displaced along its kick axes, 1
   * being a single round's peak. A shot adds VELOCITY rather than setting a
   * displacement, so a second round arriving on a weapon that has not come
   * home adds to what is already there instead of restarting it.
   *
   * **It was a damped spring and the model is deliberately not that any more.**
   * A spring is symmetric about its peak and smooth in the first derivative
   * through it, so the weapon eased out of the top of its travel on the curve
   * it eased in — an animation rather than an impact, and at the amplitude a
   * heavy weapon wants it read as rubber. `core/recoilCurve.ts` carries the
   * argument in full; the short version is that no part of a gun wants to be
   * where it started, and what brings it back is a person.
   *
   * `kickDrift` is the SIGNED lateral of the round that last fired, -1..+1: the
   * same number the aim kick's horizontal is built from, kept so the model can
   * lean the way the muzzle actually walked. One shot's worth — it is replaced,
   * never accumulated, because the pose it feeds is about the last round.
   *
   * This system owns the motion and `ViewModel` reads it, the split the bob
   * phase and the landing dip already document: two integrators on one impact
   * drift apart and the weapon swims against the view.
   */
  private readonly kick = new RecoilAxis();
  /**
   * The weapon's own recoil constants at each end of the ADS blend, and the
   * scratch they blend into. Stiffer than the aim's at both ends because it is
   * a shorter lever — the aim is the shooter's whole upper body rotating, this
   * is a receiver moving in two hands.
   */
  private readonly kickHip: RecoilShape = {
    grip: CONFIG.recoil.kick.grip,
    haul: CONFIG.recoil.kick.haul,
    riseTurns: CONFIG.recoil.kick.riseTurns,
    easeBand: CONFIG.recoil.kick.easeBand,
  };
  private readonly kickAds: RecoilShape = {
    grip: CONFIG.recoil.kick.gripAds,
    haul: CONFIG.recoil.kick.haulAds,
    riseTurns: CONFIG.recoil.kick.riseTurns,
    easeBand: CONFIG.recoil.kick.easeBand,
  };
  private readonly kickShape: RecoilShape = { ...this.kickHip };
  /**
   * The ADS blend as of the last frame, for the ONE reader that has no camera
   * to ask: `tryShot` runs from `Game`'s trigger handling rather than from
   * `animate`, so the shot has to take the stance the step left behind. It is
   * one frame old, which is 16 ms against a blend that takes 150-400.
   */
  private adsForKick = 0;
  /** Public because `Game` throws the view punch the same way (`addPunch`). */
  kickDrift = 0;
  /** Muzzle flash star: shown for `gunfeel.flashTime` after each shot. */
  private flashRoot!: TransformNode;
  private flashT = 0;
  /** Ejected brass pool; a case is live while its `t > 0`. */
  private casings: Casing[] = [];
  /** Scratch for casing integration — no per-frame allocation. */
  private readonly casingStep = new Vector3();
  /**
   * Scratch for the camera-relative movement basis. Two, because the vector
   * being built and the one being added into it are live at the same moment.
   */
  private readonly moveScratch = new Vector3();
  private readonly basisScratch = new Vector3();
  /**
   * The pose parameters handed to `ViewModel.update`, filled in place each
   * frame. See the fill site in `animate` for why it is not a literal.
   */
  private readonly viewParams: ViewModelParams = {
    adsBlend: 0,
    moveBlend: 0,
    sprintBlend: 0,
    reloadBlend: 0,
    reloadPhase: 0,
    reloading: false,
    loadPhase: 1,
    cyclePhase: 1,
    swapBlend: 0,
    throwTime: -1,
    kick: 0,
    actionJolt: 0,
    kickDrift: 0,
    kickWeight: 0,
    turnRate: 0,
    pitchRate: 0,
    bobPhase: 0,
    velY: 0,
    landDip: 0,
  };

  mods: PlayerMods = { damageMult: 1, speedMult: 1, maxHpBonus: 0, magBonus: 0 };

  private readonly groundY = CONFIG.player.height / 2;
  /**
   * The surface height `probeGround` found under the feet this frame — the
   * floor the body is standing on, or falling toward.
   *
   * Public because it is the answer to a question more than one thing asks,
   * and the asking is expensive: the probe is a whole-scene ray pick, so a
   * second caller casting its own identical ray doubles the most expensive
   * piece of per-frame CPU in the game. `ShadowSystem.updateBlobs` is that
   * caller and now reads this instead. Written every `update`, so anything
   * reading it must run after Player in the frame — everything in
   * `updateGameplay`'s tail does.
   */
  floorY = 0;
  /** Reused so the per-frame ground probe allocates nothing. */
  /**
   * The static world's collider boxes, bucketed. Null until a map hands them
   * over, and a player with none stands on the heightfield alone — which is
   * what a body on an empty field is standing on anyway, and is also what the
   * very first frame of a round is, before `installMap` has run.
   */
  private obstacles: ObstacleField | null = null;
  /**
   * The moving half of the same question, wired by `Game` to the tank fleet.
   * Separate from `obstacles` because it IS separate: the boxes are baked once
   * at map load and a hull is not in them. See `Vehicle.deckAt`.
   */
  private movingGround: MovingGround | null = null;
  /**
   * The collidable MESHES, bucketed — what the move sweep is narrowed to. Null
   * until a map hands one over, and a body with none walks the whole scene
   * exactly as it always did: slow rather than wrong.
   */
  private collidables: CollisionField | null = null;
  /**
   * The list handed to `root.surroundingMeshes` each sweep. Its own, not
   * shared with the fleet's — Babylon holds the array on the mesh across the
   * call, and one scratch between two movers is the second one's street under
   * the first one's feet.
   */
  private readonly nearby: AbstractMesh[] = [];
  /**
   * The map's floor, and the probe's floor of last resort. Flat until a map is
   * built. Held rather than reached for through the scene because it is the one
   * surface with no collider proxy — see `probeGround`.
   */
  private terrain: TerrainField = new TerrainField();

  constructor(scene: Scene, mats: CelMaterialFactory, camera: Node) {
    const p = CONFIG.player;

    // Invisible collider capsule — physics only, never rendered.
    this.root = MeshBuilder.CreateCapsule(
      "player",
      { height: p.height, radius: p.radius },
      scene,
    );
    this.root.position = new Vector3(0, this.groundY, 0);
    this.root.isVisible = false;
    this.root.ellipsoid = new Vector3(p.radius, p.height / 2 - 0.05, p.radius);

    // The weapon hangs off the camera, not off this capsule: in first person
    // the rifle you see is a viewmodel, posed in camera space.
    this.view = new ViewModel(scene, mats, camera);

    // --- gunfeel dressing: muzzle flash star + brass pool (player only) ---
    // The flash is three crossed emissive petals at the muzzle; per shot it
    // gets a random roll and scale so no two shots strobe identically.
    this.flashRoot = new TransformNode("player_muzzleFlash", scene);
    // The viewmodel's own muzzle node, not the carried model's: the model can
    // be switched off under a loadout change and the flash must not go with it.
    this.flashRoot.parent = this.view.muzzle;
    this.flashRoot.setEnabled(false);
    const flashMat = mats.getEmissive("#ffd9a0");
    for (let i = 0; i < 3; i++) {
      const petal = MeshBuilder.CreatePlane(
        `player_flashPetal${i}`,
        { width: 0.34, height: 0.15, sideOrientation: Mesh.DOUBLESIDE },
        scene,
      );
      petal.parent = this.flashRoot;
      petal.rotation.y = Math.PI / 2; // length runs along the barrel
      petal.rotation.z = (i * Math.PI) / 3;
      petal.position.z = 0.14;
      petal.material = flashMat;
      petal.metadata = { noInk: true };
      petal.isPickable = false;
      // The flash lives on the viewmodel, so it has to be drawn in the same
      // depth-cleared pass — left in the world group it would be hidden
      // behind the very barrel it sits on.
      petal.renderingGroupId = VIEWMODEL_GROUP;
      petal.alwaysSelectAsActiveMesh = true;
    }

    const casingMat = mats.get("#b99b4e");
    for (let i = 0; i < CONFIG.gunfeel.casingPool; i++) {
      const m = MeshBuilder.CreateBox(
        `player_casing${i}`,
        { width: 0.016, height: 0.016, depth: 0.05 },
        scene,
      );
      m.material = casingMat;
      m.isPickable = false;
      m.isVisible = false;
      this.casings.push({ mesh: m, vel: new Vector3(), spin: 0, t: 0 });
    }
    // Brass is thrown into the WORLD, not onto the camera, so it stays in the
    // ordinary rendering group and is occluded by geometry like anything else.

    this.applyVisibility();
    // `position`, `center` and `eyePos` are read by things that run before the
    // player has ever been placed — the shadow focus and the carried lamp are
    // both live under the menu — so they start correct rather than at origin.
    this.syncCombatant();
  }

  /** Whatever is in the hands right now. Everything weapon-shaped reads this. */
  private get weapon(): WeaponSetup {
    return this.carried.setup;
  }

  private get carried(): Holster {
    return this.slots[this.slot];
  }

  /**
   * Rounds in the magazine of the weapon being held. An accessor onto the
   * holster rather than a field of its own: two slots each keep their own
   * count, and a mirrored copy here is a second source of truth that a swap
   * would have to remember to keep in step.
   */
  get ammo(): number {
    return this.carried.ammo;
  }

  set ammo(rounds: number) {
    this.carried.ammo = rounds;
  }

  /** Which weapon is in the hands — for the camera's fit and the HUD's caption. */
  get carriedWeapon(): CarriedId {
    return this.weapon.id;
  }

  /**
   * The anti-tank item in the hands, or null for anything else.
   *
   * The one question the shooting path has to ask about the third slot, and it
   * is asked of what is CARRIED rather than of what the kit chose: a launcher
   * in the kit and a rifle in the hands fires bullets. `Game` branches on this
   * to send a rocket or lay a mine instead of resolving a hitscan round, and
   * `tryShot` reads it for the three things an AT item does not do — eject
   * brass, flash a muzzle, or reload when it runs out.
   */
  get carriedEquipment(): EquipmentId | null {
    const id = this.weapon.id;
    return isEquipmentId(id) ? id : null;
  }

  /**
   * The optic actually being looked through, which is not always the one the
   * kit fitted — the sidearm carries its own. Read by Game and pushed at the
   * camera, which must agree with the viewmodel's aimed pose about it.
   */
  get carriedSight(): SightId {
    return this.view.carriedSight;
  }

  /**
   * The slot the wheel would bring up NEXT: the weapon a swap arrives at, and
   * the magazine it kept while it was down.
   *
   * Nothing about the weapon being fired depends on it. It exists for the
   * HUD's stowed row, because the second slot is the one part of the kit a
   * player can carry a whole round without discovering — the viewmodel shows
   * one weapon, the ammunition readout counts one magazine, and a slung pistol
   * with eight rounds in it is only ever announced by the key that draws it.
   */
  private get slung(): Holster {
    return this.slots[this.slungSlot];
  }

  get slungWeapon(): CarriedId {
    return this.slung.setup.id;
  }

  /**
   * Which slot the wheel would bring up, which is also which key names it —
   * the digit is `slot + 1`, and that is the same one fact `drawSlot` and the
   * number row share.
   */
  get slungSlot(): number {
    // **The wheel CYCLES and the number keys NAME**, which with two slots is
    // the toggle this has always been and with three is the only shape that
    // works: a phone has no number keys and a pad has no button left for one,
    // so a third slot reachable only by `3` would be a third slot two of the
    // three input devices could not get at. Wrapping through the slots that
    // exist costs a second press to come back to the primary and is what every
    // shooter's wheel already does.
    return (this.slot + 1) % this.slots.length;
  }

  get slungAmmo(): number {
    return this.slung.ammo;
  }

  /** The same expression as `magSize`, so both counts are read one way. */
  get slungMagSize(): number {
    return this.slung.setup.magSize + this.mods.magBonus;
  }

  /**
   * Rockets or mines left in the third slot, or 0 when the kit has no third
   * slot at all.
   *
   * Read off the SLOT rather than kept as a count of its own, exactly as
   * `ammo` is: the AT item keeps its ammunition in its holster like every
   * other weapon, and a mirrored copy here would be a second source of truth
   * for the HUD to get out of step with across a swap.
   */
  get equipmentLeft(): number {
    return this.slots.length > EQUIP_SLOT ? this.slots[EQUIP_SLOT].ammo : 0;
  }

  /** True while a swap is in flight: the weapon is down and nothing can fire. */
  get swapping(): boolean {
    return this.swapT >= 0;
  }

  get maxHealth(): number {
    return CONFIG.player.maxHealth + this.mods.maxHpBonus;
  }

  get magSize(): number {
    return this.weapon.magSize + this.mods.magBonus;
  }

  get damage(): number {
    return this.weapon.damage * this.mods.damageMult;
  }

  /**
   * The carried weapon's fall-off, as the object `CombatSystem.fire` takes.
   *
   * One object, filled in on read rather than rebuilt: a fresh literal per
   * round is exactly the per-shot allocation the effect pools exist to avoid,
   * and a field cached on a carry change is a thing to forget on the next one
   * — the weapon, the mods and the magazine all change from different places.
   * Deriving it here cannot go stale and costs three writes.
   *
   * `mods.damageMult` scales the far end as well as the near one, or a damage
   * buff would quietly stop applying at range.
   */
  get shotOptions(): ShotOptions {
    const o = this.shotOpts;
    o.damageFar = this.weapon.damageFar * this.mods.damageMult;
    o.falloffNear = this.weapon.falloffNear;
    o.falloffFar = this.weapon.falloffFar;
    return o;
  }

  /**
   * `headMult` is set once and never cleared: the head zone is the PLAYER's,
   * and this object is the only place in the game that asks for it. Bots fire
   * through `BOT_SHOT`, which omits the field, so their rounds never test the
   * sphere at all — see the header of `CombatSystem`.
   */
  private readonly shotOpts: ShotOptions = {
    damageFar: 0,
    falloffNear: 0,
    falloffFar: 0,
    headMult: CONFIG.combat.headshotMult,
  };

  /** Where a round from the carried weapon stops (m). */
  get range(): number {
    return this.weapon.range;
  }

  /**
   * The whole of `recoil.firstShotMult`, resolved here so the call site reads
   * one number: what the round about to leave multiplies its kick by.
   *
   * **It is 1 on a weapon that is a string of one**, and that exclusion is the
   * feature rather than an exception to it. The multiplier is about the
   * difference between a settled weapon and one mid-burst; on the DMR and the
   * pistol every shot is a first shot, so it would not be texture at all —
   * just a flat 60% recoil increase wearing feel's clothing, and on the DMR's
   * 2.2 multiplier that is 6.0 deg on every deliberate scoped round. Their
   * `recoilMult` already carries the punch a single shot is supposed to have.
   *
   * The carbine is `semiAuto` too and is deliberately included: `burst > 1`
   * means one pull is three rounds that climb as one motion, which is exactly
   * the thing that has a first round in it.
   */
  private get recoilRamp(): number {
    if (!this.stringed) return 1;
    return this.stringShots === 1 ? CONFIG.recoil.firstShotMult : 1;
  }

  /**
   * Whether the carried weapon HAS a string — whether there is such a thing as
   * being in the middle of a cycle on it. `!semiAuto` is a held trigger and
   * `burst > 1` is one pull that climbs as a single motion; a weapon that is
   * neither is the DMR or the pistol, where the trigger comes up between every
   * round and every round is a first round.
   *
   * **Both string-shaped terms share this test**, and they have to. Applied to
   * a string of one, `firstShotMult` is a flat 60% increase and `pattern`'s
   * taper is a flat 20% DECREASE — and the decrease is the worse of the two,
   * because both weapons' fire rates sit just inside `stringResetTime` (the
   * DMR's 0.333 s against 0.35) and so only a player firing them as fast as the
   * weapon allows would collect it. That is a discount for spamming a precision
   * weapon, which is the opposite of what the rate limit is for. Excluded, they
   * fire shot one every time: full climb, minimum drift, nothing to learn and
   * nothing to game.
   */
  private get stringed(): boolean {
    const w = this.weapon;
    return !w.semiAuto || w.burst > 1;
  }

  /**
   * The aim kick owed by the round `tryShot` has just fired, for `Game` to hand
   * the camera. Call it exactly once per successful shot and no other time: it
   * reads `stringShots` and `kickDrift`, both of which belong to that round.
   *
   * **It lives here because every number in it is the WEAPON's**, and
   * `docs/weapons.md` has always said the recoil multipliers reach nothing but
   * `Player`. They used to reach `Game`, which assembled the vector out of
   * three getters and a random draw — so the weapon's kick was described in one
   * file and built in another, and the horizontal was drawn a second time from
   * the one the viewmodel needed. One draw, in `tryShot`, read by both.
   *
   * Five things scale it and they are deliberately separate questions: how hard
   * the weapon kicks (`recoilMult`), whether this is a first round
   * (`recoilRamp`), how far into a string it is (`pattern`), whether the weapon
   * is braced against a shoulder (`adsMult`), and what the body under it is
   * doing (`crouchMult`/`moveMult`/`airMult`).
   */
  /**
   * How much of the carried weapon's kick reaches the MODEL, as opposed to the
   * aim. A compression, and the compression is the point: 2.4 is a defensible
   * thing to do to an aim measured in fractions of a degree and an
   * indefensible thing to do to a pose measured in centimetres, which is why
   * the model used to ignore the weapon entirely rather than read this.
   *
   * **It reads `recoilImpulse` and not `recoilMult`, and that is the honest
   * one of the two.** The kick's largest term by a distance is `kickBack`,
   * travel straight along the bore toward the eye — which is the LINEAR
   * impulse and nothing to do with how far the muzzle tips. At `kick.compress`
   * 0.6 the rifle is 1.00, the DMR 1.69, the bolt gun 2.16 and the SMG 0.66.
   */
  private get kickWeight(): number {
    return Math.pow(this.weapon.recoilImpulse, CONFIG.recoil.kick.compress);
  }

  /**
   * The weapon's recoil constants for the stance it is actually held in, into
   * the scratch shape. `riseTurns` and `easeBand` do not blend — they are the
   * SHAPE of the response rather than its speed, and the same at both ends.
   */
  private kickShapeAt(blend: number): RecoilShape {
    const a = this.kickHip;
    const b = this.kickAds;
    this.kickShape.grip = a.grip + (b.grip - a.grip) * blend;
    this.kickShape.haul = a.haul + (b.haul - a.haul) * blend;
    this.kickShape.riseTurns = a.riseTurns;
    this.kickShape.easeBand = a.easeBand;
    return this.kickShape;
  }

  /**
   * The ACTION, as one signed number on the shot clock: the carrier reaching
   * the back of its travel and then slamming into battery.
   *
   * **This is what makes a self-loader read as a machine.** The charge is not
   * the only impulse a shooter feels and a rifle does not make one smooth
   * excursion per round — there is the shot, then a mass stopping hard against
   * the buffer some milliseconds later, then the same mass arriving in
   * battery. The two beats are OPPOSITE in sign, which is the whole of why the
   * pair reads as a mechanism cycling rather than as a second recoil: mass
   * travelling rearward drives the weapon back into the shoulder, and the same
   * mass arriving forward pulls it out and dips the muzzle.
   *
   * It costs no state at all. `sinceShot` is already here — the string
   * counter's clock, raised by a shot and dropped by anything that takes the
   * weapon away — and `impulse` is already the shape of an arrival, all attack
   * and no ease-in. Past the last beat both terms are zero and this is 0
   * without a test.
   *
   * **A bolt gun is exempt and so is anything that is not a gun.** `boltCycle`
   * says the action is worked by a hand rather than by the gas, and
   * `CONFIG.viewmodel.cycle` already plays that over a second and a quarter;
   * two accounts of one mechanism would be one too many. The launcher and the
   * mine have no action to cycle.
   */
  private get viewActionJolt(): number {
    const w = this.weapon;
    if (w.boltCycle || this.carriedEquipment) return 0;
    const a = CONFIG.recoil.kick.action;
    const t = this.sinceShot;
    if (t > a.home + a.fall) return 0;
    return (
      (a.backKick * impulse(t, a.back, a.fall) +
        a.homeKick * impulse(t, a.home, a.fall)) *
      this.kickWeight
    );
  }

  /**
   * How hard this weapon SHOCKS the frame — `CameraSystem.addPunch`'s scale,
   * compressed out of the same impulse for the reason `kickWeight` is.
   *
   * Public and read by `Game` at the two shot sites, because the punch has a
   * caller that is not a weapon at all: a blast raises one too, and a grenade
   * going off has no business being scaled by whatever happens to be in the
   * player's hands. So the SHOCK is per-EVENT and passed, while the settle
   * spring and the post-shot unsteadiness are per-WEAPON and held by the
   * camera across the shots that stack on them.
   */
  get punchShock(): number {
    return Math.pow(this.weapon.recoilImpulse, CONFIG.recoil.punchCompress);
  }

  recoilKick(adsBlend: number): { pitch: number; yaw: number } {
    const r = CONFIG.recoil;
    const pat = r.pattern;
    // How far into the string this round is, 0 on the first and 1 once the
    // pattern has settled. `stringShots` was raised by the shot this is for, so
    // round one reads exactly 0 and both envelopes are at their opening value.
    // A weapon with no string is pinned there — see `stringed`, which is also
    // what excludes those weapons from `firstShotMult`.
    const into =
      !this.stringed || pat.patternShots <= 1
        ? 0
        : Math.min(1, (this.stringShots - 1) / (pat.patternShots - 1));
    // The stance. ADS is a blend because the sight comes up over time; crouch
    // and movement are blends for the same reason and are already eased by
    // `update`. Airborne is the one step function here — feet are on the ground
    // or they are not — but it rides `airBlend` so a hop does not switch the
    // weapon's character on and off between two frames.
    const stance =
      (1 - (1 - r.adsMult) * adsBlend) *
      (1 - (1 - r.crouchMult) * this.crouchBlend) *
      (1 + (r.moveMult - 1) * this.moveBlend) *
      (1 + (r.airMult - 1) * this.airBlend);
    const kickMult = stance * this.weapon.recoilMult * this.recoilRamp;
    return {
      pitch: r.pitchPerShot * (1 + (pat.pitchSettled - 1) * into) * kickMult,
      yaw:
        this.kickDrift *
        r.yawPerShot *
        (pat.yawStart + (1 - pat.yawStart) * into) *
        kickMult,
    };
  }

  /**
   * A round cracked past. Wired from `CombatSystem.onNearMiss` through Game,
   * the same event that already feeds `BattleSystem.suppress` for bots — so
   * the player is suppressed by exactly the thing that suppresses everyone
   * else, rather than by a rule of their own.
   *
   * It saturates rather than accumulating: being shot at by three men is
   * being shot at, and a value that could climb with the volume of fire would
   * make a machine gun a hard counter to aiming at all.
   */
  suppress(): void {
    this.suppression = Math.min(
      1,
      this.suppression + CONFIG.player.suppressPerMiss,
    );
  }

  /** How the shot and the reload are voiced — see `ReportVoice`. */
  get report(): ReportVoice {
    return this.weapon.report;
  }

  get reloadTime(): number {
    return this.weapon.reloadTime;
  }

  /** The weapon's caption on the HUD's magazine strip. */
  get weaponName(): string {
    return this.weapon.short;
  }

  /**
   * Picks up a primary. The magazine comes with it — this is only reachable
   * from the menu and the deploy screen, where the gun is already put away,
   * so there is no half-spent magazine to carry across and no reload to
   * interrupt.
   *
   * It puts the primary back IN THE HANDS as well, for the same reason: the
   * kit screen shows the weapon that was just chosen, and closing it holding
   * the pistol instead would be a screen that lied about what it did.
   */
  setWeapon(id: PrimaryWeaponId): void {
    this.slots[PRIMARY_SLOT] = holster(id);
    this.slot = PRIMARY_SLOT;
    this.swapT = -1;
    this.swapPending = false;
    this.reloading = false;
    this.reloadT = 0;
    this.fireCooldown = 0;
    this.burstLeft = 0;
    this.spreadBloom = 0;
    // The string belongs to the WEAPON, not to the finger — the same split
    // `burstLeft` and `triggerHeld` already draw. A gun that has just come
    // into your hands has not been fired, whatever the last one was doing.
    this.stringShots = 0;
    this.sinceShot = CONFIG.recoil.stringResetTime;
    this.ammo = this.magSize;
    this.view.setWeapon(id);
    this.onCarryChanged();
  }

  /**
   * Puts a named slot in the hands — what the `1` and `2` keys ask for.
   *
   * The gesture takes the INCOMING weapon's `drawTime` and nothing can be
   * fired for the whole of it — that wait is the cost the sidearm's whole case
   * is measured against, and the reason its own figure is the smallest here.
   * The weapons change places partway through (`viewmodel.swap.switchFrac`),
   * behind the bottom of the frame, so the model never pops.
   *
   * Asking for the weapon already carried is refused rather than replayed: the
   * animation would cost half a second and change nothing, and a key pressed
   * twice in a firefight must not be the reason a shot was late. So is a swap
   * while a grenade is in the air, because that is the same off hand.
   *
   * A reload in progress is CANCELLED rather than remembered: the magazine
   * being worked on is going away with the weapon, and a reload that resumed
   * on a gun the player has since put down would finish invisibly.
   */
  drawSlot(slot: number): boolean {
    if (slot < 0 || slot >= this.slots.length) return false;
    if (!this.alive || this.swapping || this.throwT >= 0) return false;
    // `slot` is where the gesture ENDS, so a request for the weapon already up
    // is a no-op — including one arriving while the last swap is still landing,
    // which is why this tests the destination rather than the current hands.
    if (slot === this.slot) return false;
    this.swapT = 0;
    this.swapTime = this.slots[slot].setup.drawTime;
    this.swapPending = true;
    this.swapTo = slot;
    this.reloading = false;
    this.reloadT = 0;
    return true;
  }

  /** The NEXT weapon, wrapping — what the wheel, pad Y and the touch button ask for. */
  swapWeapon(): boolean {
    return this.drawSlot(this.slungSlot);
  }

  /** How long the swap now in flight takes, for the sound that has to fit it. */
  get swapTotal(): number {
    return this.swapTime;
  }

  /**
   * The weapons changing places, at the point in the gesture where neither is
   * on screen. The fire cooldown and the spread bloom are dropped with the
   * weapon that earned them — they are facts about a gun now on a sling, and
   * the swap has already cost more time than either.
   *
   * The trigger latch deliberately is NOT: it belongs to the finger rather
   * than to the weapon, so a trigger held down across a swap still has to be
   * released before the new weapon fires, exactly as it does across a reload.
   * A burst is the weapon's, not the finger's, and goes with it.
   */
  private completeSwap(): void {
    this.slot = this.swapTo;
    this.swapPending = false;
    this.fireCooldown = 0;
    this.burstLeft = 0;
    this.spreadBloom = 0;
    // Explicitly, not by relying on the clock: the sidearm's `drawTime` is
    // 0.34 s against a 0.35 s reset window, so a swap to it would otherwise
    // land one hundredth of a second inside the old weapon's string and hand
    // the pistol's first round the rifle's settled kick.
    this.stringShots = 0;
    this.sinceShot = CONFIG.recoil.stringResetTime;
    this.view.setWeapon(this.weapon.id);
    this.onCarryChanged();
  }

  /**
   * Puts an anti-tank item in the third slot, or takes the slot away.
   *
   * **Null is not "carry nothing" — it is a kit with two slots**, which is
   * what every map without armour on it hands the player and what the AT
   * screen row is hidden for. So this is the one loadout call that changes how
   * many slots there ARE, and the two things that follow from that are both
   * here: a body holding the item when the slot goes has to end up holding
   * something (the primary), and a swap in flight toward a slot that is about
   * to stop existing has to be abandoned rather than landing on nothing.
   *
   * Reachable only from the menu and the deploy screen, exactly as `setWeapon`
   * is, so there is no half-spent launcher to carry across.
   */
  setEquipment(id: EquipmentId | null): void {
    if (id === null) {
      if (this.slots.length <= EQUIP_SLOT) return;
      this.slots.length = EQUIP_SLOT;
      if (this.slot === EQUIP_SLOT) this.slot = PRIMARY_SLOT;
      if (this.swapTo === EQUIP_SLOT) this.swapTo = PRIMARY_SLOT;
    } else {
      this.slots[EQUIP_SLOT] = equipHolster(id);
    }
    this.swapT = -1;
    this.swapPending = false;
    this.view.setWeapon(this.weapon.id);
    this.onCarryChanged();
  }

  /**
   * Fits an optic. Pure pass-through to the viewmodel — the sight changes
   * what the player can see, never what the weapon does, so nothing about
   * damage, spread or recoil is downstream of this.
   */
  setSight(id: SightId): void {
    this.view.setSight(id);
  }

  /**
   * Paints a weapon. The purest pass-through on this class — a finish changes
   * what the gun looks like and nothing else at all, so unlike the optic it is
   * not even upstream of what the player can SEE.
   */
  setFinish(weapon: PrimaryWeaponId, id: FinishId): void {
    this.view.setFinish(weapon, id);
  }

  /**
   * Bullet spread half-angle for the next shot, including recoil bloom.
   * Bloom is damped in ADS by the same factor as the aim kick — a braced
   * stance would otherwise lose far more precision than it has to give.
   *
   * Crouching scales the whole result, bloom included: it is a steadier
   * platform, not a second set of sights, so it helps most where the sights
   * help least (hip fire, deep into a burst).
   */
  spread(adsBlend: number): number {
    const w = this.weapon;
    const base = w.spreadHip + (w.spreadAds - w.spreadHip) * adsBlend;
    const bloomMult = 1 - (1 - CONFIG.recoil.adsMult) * adsBlend;
    const crouchMult =
      1 - (1 - CONFIG.player.crouchSpreadMult) * this.crouchBlend;
    return (base + this.spreadBloom * bloomMult) * crouchMult;
  }

  /** Full reset at the start of a run (permadeath — mods are cleared too). */
  fullReset(): void {
    this.regenLockT = 0;
    this.mods = { damageMult: 1, speedMult: 1, maxHpBonus: 0, magBonus: 0 };
    this.health = this.maxHealth;
    this.alive = true;
    // A fresh body is in nobody's vehicle. Cleared here as well as on the
    // dismount, because a hull destroyed with the player inside it kills them
    // and there is no dismount on that path.
    this.invulnerable = false;
    // A fresh body comes up with the primary in its hands and both magazines
    // full. The slung weapon has to be refilled explicitly: only the carried
    // one is reachable through `startReload`, so a sidearm left empty last
    // life would otherwise be drawn empty in this one.
    this.swapT = -1;
    this.swapPending = false;
    this.slot = PRIMARY_SLOT;
    this.view.setWeapon(this.weapon.id);
    for (const h of this.slots) h.ammo = h.setup.magSize;
    this.ammo = this.magSize;
    this.grenades = CONFIG.grenade.carried;
    this.throwCooldown = 0;
    this.throwT = -1;
    this.throwPending = false;
    this.reloading = false;
    this.fireCooldown = 0;
    // A body that died mid-burst does not owe the rounds: `dying` stops
    // `tryShot` being called at all, so the guards that would abandon it never
    // run and the remainder would leave out of the next life's first frame.
    this.burstLeft = 0;
    this.velY = 0;
    this.spreadBloom = 0;
    this.stringShots = 0;
    this.sinceShot = CONFIG.recoil.stringResetTime;
    // A fresh body is not under fire, whatever the last one died in.
    this.suppression = 0;
    // The spring's velocity as well as its displacement: a body that died with
    // the weapon still travelling would otherwise come back carrying the last
    // life's kick and finish it in the new one's first frames.
    this.kick.reset();
    this.kickDrift = 0;
    this.flashT = 0;
    this.flashRoot.setEnabled(false);
    for (const c of this.casings) {
      c.t = 0;
      c.mesh.isVisible = false;
    }
    this.crouching = false;
    this.crouchBlend = 0;
    this.moveBlend = 0;
    this.airBlend = 0;
    this.reloadBlend = 0;
    this.sprintBlend = 0;
    this.turnRate = 0;
    this.pitchRate = 0;
    this.prevBobPhase = 0;
    this.view.reset();
    // The hands changed — a life that ended holding the pistol starts the next
    // one holding the primary — so the camera's fit and the HUD's caption both
    // owe a repush.
    this.onCarryChanged();
  }

  /**
   * Health regeneration, and the lock that holds it off after a hit.
   *
   * Its own method because it is the one part of a player's frame that is owed
   * even when the body is not being simulated at all: a driver sitting inside a
   * tank still heals, and `Game` does not call `update` for them (the tank is
   * what moves, aims and probes the ground). Without this split, mounting at
   * forty health meant staying at forty for as long as you stayed in the hull.
   *
   * Everything else in `update` is about a body standing on the ground and
   * would be wrong to run for one that is not, which is why this is the only
   * thing that leaves.
   */
  updateVitals(dt: number): void {
    // Stay hurt for a few seconds after the last hit, then heal back to full.
    // Without this, sixteen hostile bots and no medic turns the round into a
    // respawn queue for anyone who wins a fight at half health.
    const p = CONFIG.player;
    this.regenLockT = Math.max(0, this.regenLockT - dt);
    if (this.regenLockT <= 0 && this.health < this.maxHealth) {
      this.health = Math.min(this.maxHealth, this.health + p.regenRate * dt);
    }
  }

  placeAt(spawn: Vector3): void {
    this.root.position.copyFrom(spawn);
    this.root.position.y = spawn.y + this.groundY;
    this.velY = 0;
    this.grounded = true;
    // The spawn IS a standable surface, so it is the right answer until the
    // first probe runs — without this the blob shadow spends the frame the
    // player appears on at whatever floor the last life ended over.
    this.floorY = spawn.y;
    this.syncCombatant();
  }

  /**
   * Moves the body to `feet` without touching what it is doing.
   *
   * This is the small end of a networked correction, and the difference from
   * `placeAt` is the point: a spawn is a body arriving on solid ground, so it
   * lands stopped and grounded, while a correction is the authority disagreeing
   * with a body that is still living its life. Zeroing `velY` here would eat a
   * jump or a fall, and every accepted step near a wall would strip the arc off
   * a player who is merely brushing it.
   *
   * `feet`, like everything else that crosses the wire — see `position`.
   */
  nudgeTo(feet: Vector3): void {
    this.root.position.set(feet.x, feet.y + this.groundY, feet.z);
    this.syncCombatant();
  }

  /**
   * Height of the surface underfoot: the highest thing standing in the band the
   * feet can reach, taken from the three places the world keeps one.
   *
   * The band is a step-height above the feet down to `groundProbeLength` below
   * that, so a rise reads as a step to walk up rather than a wall to stop
   * against and a roof overhead is above the ceiling and never considered. Its
   * three sources, and none of them is optional:
   *
   * - **The terrain**, unbanded, through `TerrainField.surfaceAt`. The
   *   heightfield is the one floor with no box standing in for it — the
   *   documented exception to the visual/collider rule — and it is always under
   *   the player somewhere, so it is the floor of last resort rather than a
   *   candidate. `surfaceAt` and not `heightAt`: what a body stands on is the
   *   floor as DRAWN, which the smooth field disagrees with by centimetres on
   *   every twisted quad.
   * - **The static world**, through `ObstacleField.groundAt` — the same query,
   *   in the same band, that `Vehicle.supportAt` takes ten times a frame.
   * - **The fleet**, through `Game`'s wiring to `VehicleSystem.deckAt`, because
   *   a hull is in no baked structure and you can climb onto one.
   *
   * Highest wins, which is exactly what a ray cast down from the ceiling would
   * have reported, and the whole thing is a bucket lookup, a heightfield sample
   * and a loop over the fleet — two hulls on most maps with vehicles, four on
   * Sarab.
   *
   * ## THIS USED TO BE THE MOST EXPENSIVE THING THE GAME DID PER FRAME
   *
   * It was `scene.pickWithRay` with a `solid` predicate: Babylon walked all
   * ~1,800 meshes in the scene and ray-tested all ~820 colliders to find the
   * floor. Measured on real hardware it was **0.483 ms — a third of the game's
   * own per-frame JS and five times the next item on the list** — and it scaled
   * with how big the MAP was rather than with anything on screen, which is what
   * made it the first wall a larger map would hit. `Player.floorY` exists
   * because of it: a second caller casting an identical ray would have doubled
   * it. Keep `floorY` — the reason it was introduced is gone, but a second
   * caller re-deriving the same number is still a second opinion about where
   * the floor is.
   *
   * **What kept it a ray was one geometry bug, and the bug was in the shared
   * primitive rather than here.** Over the 51,000 positions the nav graph says
   * a body can stand on, the two agreed on 99.8%, and of the 116 that differed
   * one class was fatal: along a fence line the analytic reported a surface
   * half a metre up that the ray passed straight through. `topFaceAtLocalZ`
   * extrapolated a box's top-face PLANE across the whole solid footprint, which
   * for a pitched box is wider than the face, so a stair parapet claimed ground
   * beside itself by up to a slab thickness — a routing nuisance to `NavGrid`
   * and a player standing on air here. `boxGeometry` now gates every height
   * query on the top face's own footprint, which closes it by construction:
   * see `topFaceHalfDepth`. `FINDINGS.md` 6 carries the measurement.
   */
  private probeGround(): number {
    const p = CONFIG.player;
    const pos = this.root.position;
    const ceiling = pos.y - this.groundY + p.stepHeight + 0.05;
    const floor = ceiling - p.groundProbeLength;
    // The floor of last resort, and never banded — see above.
    let best = this.terrain.surfaceAt(pos.x, pos.z);
    const box = this.obstacles?.groundAt(pos.x, pos.z, ceiling, floor) ?? null;
    if (box !== null && box > best) best = box;
    const deck = this.movingGround?.(pos.x, pos.z, ceiling, floor) ?? null;
    if (deck !== null && deck > best) best = deck;
    return best;
  }

  /**
   * Hands the player the world it stands on: the heightfield, the collider
   * boxes bucketed over it, whatever moves, and the same colliders as MESHES
   * for the sweep.
   *
   * The first three in one call, for the reason `Vehicle.setGround` takes them
   * that way — the probe takes the highest of them and a player holding one
   * without the others answers a fraction of the question.
   *
   * The fourth is the same collider set a further way round: what a body WALKS
   * INTO rather than what it stands on, which is the one thing here that was
   * still being asked of the whole scene. See `world/CollisionField.ts`.
   * Called from `installMap` and nowhere else, which is the same contract
   * `VehicleSystem.build` has with the fleet: the editor rebuilds
   * `map.obstacles` without going back through `installMap`, so these go stale
   * there, and it does not matter because the editor frame is the gameplay one
   * MINUS the player.
   */
  setGround(
    terrain: TerrainField,
    obstacles: ObstacleField | null,
    moving: MovingGround | null,
    collidables: CollisionField | null = null,
  ): void {
    this.terrain = terrain;
    this.obstacles = obstacles;
    this.movingGround = moving;
    this.collidables = collidables;
  }


  update(dt: number, input: InputManager, cam: CameraSystem): PlayerEvents {
    const p = CONFIG.player;
    const ev = this.events;
    ev.jumped = false;
    ev.footstep = 0;
    ev.landed = 0;

    // --- stance ---
    // Sprinting is mutually exclusive with aiming, and blocks firing (see
    // `tryShot`) — otherwise it is strictly better than walking.
    //
    // Sprint outranks crouch, and is resolved first so the two can't argue:
    // asking to run stands the player up. Crouch is deliberately NOT gated on
    // `grounded` — jumping out of it would pop the camera half a metre at the
    // worst possible moment, and the collider capsule never changes size, so
    // there is nothing underfoot to reconcile.
    //
    // **A LATCH IS SPENT BY WHAT OVERRIDES IT, NEVER SUSPENDED BY IT**, and
    // this is where that is enforced, because this is the only place that
    // knows whether a sprint is actually happening: `input.sprint` is the ask,
    // and the stick, the optic and the hands being full are what decide — see
    // `loading`, which is a magazine going in OR a rocket going down a bore.
    // So the two edges below are the state changing, not a button.
    //
    // Starting to run spends a latched crouch, or the run would drop the
    // player back into a crouch they asked for before it. Ending a run spends
    // the sprint latch, or a pad player who stops for a corner starts running
    // again the moment they touch the stick — the L3 press is a sprint, not a
    // standing intention to sprint whenever moving. Both are one-way: neither
    // clears an input that is *held*, so Shift and Ctrl still mean what they
    // say for as long as they are down, and a held Ctrl still comes back after
    // a sprint because the player never stopped asking for it.
    const wasSprinting = this.sprinting;
    this.sprinting =
      input.sprint && input.moveY > 0.1 && cam.adsBlend < 0.4 && !this.loading;
    if (this.sprinting && !wasSprinting) input.clearCrouchToggle();
    if (wasSprinting && !this.sprinting) input.clearSprintToggle();
    this.crouching = input.crouch && !this.sprinting;
    this.crouchBlend +=
      ((this.crouching ? 1 : 0) - this.crouchBlend) *
      Math.min(1, dt * p.crouchBlendSpeed);

    // --- horizontal movement (camera-relative), with collision sliding ---
    const speed =
      p.moveSpeed *
      this.mods.speedMult *
      (cam.adsBlend > 0.4 ? p.adsMoveMult : 1) *
      (this.sprinting ? p.sprintMult : 1) *
      (1 - (1 - p.crouchMoveMult) * this.crouchBlend);
    // Built in scratch: this used to be six `Vector3`s a frame — two basis
    // vectors, two scales, an add and the final scale — on the one path that
    // runs on every frame of every round.
    const move = cam.flatForwardToRef(this.moveScratch).scaleInPlace(input.moveY);
    move.addInPlace(cam.flatRightToRef(this.basisScratch).scaleInPlace(input.moveX));
    const moveInput = Math.min(1, move.length());
    if (move.lengthSquared() > 1) move.normalize();
    if (move.lengthSquared() > 0.0001) {
      // **A street rather than the map**, and on this path that is worth as
      // much as the whole fleet was. Babylon's coordinator walks `scene.meshes`
      // for every call, once a frame, on every frame the player is moving —
      // which is most of them — and the walk is charged AGAIN per retry, so it
      // is dearest exactly when the player is pressed against something.
      // Measured walking a real round: **2.21 ms a frame on Sarab, 0.62 on
      // Coldharbour, 0.52 on Hollowmere**, against 0.036 / 0.015 / 0.026 with
      // the list. See `world/CollisionField.ts` for the three rules the
      // substitution rests on and for why it is CHECKED rather than trusted;
      // the ejection case that check exists for is not theoretical here,
      // because a hull respawning on its hardstanding arrives around whoever
      // is standing on it.
      narrowedMove(
        this.root,
        move.scaleInPlace(speed * dt),
        this.collidables,
        this.nearby,
      );
    }

    // --- jump & gravity, against whatever surface is actually underfoot ---
    if (input.jumpPressed && this.grounded) {
      this.velY = p.jumpVelocity;
      this.grounded = false;
      ev.jumped = true;
    }
    this.velY -= p.gravity * dt;
    this.root.position.y += this.velY * dt;

    // Hollowmere has terraces, embankments, ramps and a hayloft, so the floor
    // is wherever the probe finds it rather than a fixed plane. Ground rising
    // under the feet is always snapped up to (a step, not a wall).
    //
    // The tolerance BELOW the feet is grounded-only, and that is load-bearing.
    // It exists so walking off a kerb or down a slope keeps the feet on the
    // floor instead of starting a fall every stride. Extend it to a body in
    // the air — which is what testing `velY <= 0` did — and a jump lands a
    // full `stepHeight` early, teleporting the last 0.6 m in a single frame:
    // over a third of a jump's own height gone between two frames, with no
    // impact where the eye can see one. That is what read as a dropped frame.
    // Airborne, the landing is where the feet actually meet the floor, and the
    // only thing the snap resolves is one frame's worth of overlap.
    const floorY = this.probeGround();
    this.floorY = floorY;
    const foot = this.root.position.y - this.groundY;
    const stick = this.grounded ? p.stepHeight : 0;
    if (foot <= floorY + stick) {
      // Report the arrival before the snap eats the speed it arrived at. Only
      // a fall counts: walking on level ground touches down every frame at
      // roughly one frame of gravity, which is well under `landMinSpeed`.
      if (!this.grounded) {
        ev.landed = Math.max(0, -this.velY);
        // The eye absorbs it. Pushed straight at the camera rather than routed
        // through `PlayerEvents` for the same reason the bob drive is: the
        // camera owns the spring, this owns the movement that excites it, and
        // Game's copy would arrive a frame late. The sound still goes out as
        // an event, because audio is Game's.
        cam.land(ev.landed);
      }
      this.root.position.y = floorY + this.groundY;
      this.velY = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    // --- the capsule still faces the camera yaw ---
    // Nothing renders off it any more, but the blob shadow underfoot is
    // oriented from it, and a capsule that never turned would drag an
    // unturning oval around with the player.
    this.root.rotation.y = cam.yaw;

    this.updateVitals(dt);

    // --- weapon timers ---
    this.fireCooldown -= dt;
    this.throwCooldown -= dt;
    // The throw clock counts UP, and it is parked rather than clamped: the
    // gesture has a release in the middle of it, so "how long ago" is the only
    // thing that says where in it the arm is. It is stopped once the arm is
    // home so a long round cannot walk it off into imprecision.
    if (this.throwT >= 0) {
      const th = CONFIG.viewmodel.throw;
      this.throwT += dt;
      if (this.throwT > th.windup + th.recover) this.throwT = -1;
    }
    // The swap runs on the same shape of clock, and the weapons change places
    // partway through it rather than at either end — see `completeSwap`.
    if (this.swapT >= 0) {
      this.swapT += dt;
      if (
        this.swapPending &&
        this.swapT >= this.swapTime * CONFIG.viewmodel.swap.switchFrac
      ) {
        this.completeSwap();
      }
      if (this.swapT >= this.swapTime) this.swapT = -1;
    }
    this.spreadBloom = Math.max(
      0,
      this.spreadBloom - CONFIG.recoil.bloomRecovery * dt,
    );
    // The string's clock. It is only ever read against `stringResetTime`, so
    // it is left to run rather than clamped — no shot in the game cares how
    // long ago the last one was beyond "longer than the window".
    this.sinceShot += dt;
    this.suppression = Math.max(
      0,
      this.suppression - CONFIG.player.suppressDecay * dt,
    );
    if (this.reloading) {
      this.reloadT -= dt;
      this.reloadPhase = Math.min(1, 1 - this.reloadT / this.weapon.reloadTime);
      if (this.reloadT <= 0) {
        this.reloading = false;
        this.ammo = this.magSize;
      }
    }

    this.syncCombatant();
    this.updateGunfeel(dt);
    this.animate(dt, moveInput, cam);
    return ev;
  }

  /**
   * Smooths this frame's movement/look into the signals the viewmodel poses
   * from, and pushes them. All the easing stays here so the weapon's response
   * is frame-rate independent, the same reason it lived here for the body.
   *
   * The bob phase comes back off the camera rather than being integrated
   * again here: two integrators on the same drive would drift apart and the
   * weapon would swim against the view. Player runs before the camera in
   * Game's frame order, so the phase read is one frame old — 16 ms of an
   * ~0.8 s cycle, against a visible desync if the weapon kept its own.
   */
  private animate(dt: number, moveInput: number, cam: CameraSystem): void {
    // Smoothed blend weights so poses ease in/out instead of snapping.
    const ease = (current: number, target: number, rate: number) =>
      current + (target - current) * Math.min(1, dt * rate);
    this.moveBlend = ease(this.moveBlend, moveInput, 10);
    this.airBlend = ease(this.airBlend, this.grounded ? 0 : 1, 9);
    this.reloadBlend = ease(this.reloadBlend, this.reloading ? 1 : 0, 12);
    this.sprintBlend = ease(this.sprintBlend, this.sprinting ? 1 : 0, 6);
    // Camera yaw/pitch rates, wrapped and smoothed: the weapon trails both.
    let dYaw = cam.yaw - this.prevYaw;
    this.prevYaw = cam.yaw;
    if (dYaw > Math.PI) dYaw -= Math.PI * 2;
    else if (dYaw < -Math.PI) dYaw += Math.PI * 2;
    this.turnRate = ease(this.turnRate, dt > 0 ? dYaw / dt : 0, 8);
    const dPitch = cam.pitch - this.prevPitch;
    this.prevPitch = cam.pitch;
    this.pitchRate = ease(this.pitchRate, dt > 0 ? dPitch / dt : 0, 8);

    // --- weapon punch: an arrest and a haul, not a spring ---
    // The same model the aim runs on (`core/recoilCurve.ts`) at this system's
    // own, stiffer constants, and for the same reason: the charge throws the
    // gun, the grip stops it, and the shooter drives it back. What that gives
    // that a spring cannot is a CORNER at the top of the travel — the point
    // where the motion changes cause — and a descent that is a straight line
    // rather than the back half of a cosine.
    //
    // **Stepped exactly at any `dt`**, which the spring it replaced also had
    // to be: measured on a semi-implicit Euler version, one round peaked at
    // 0.08 of its intended travel at 30 fps, 0.54 at 60 and 0.78 at 120 — the
    // recoil visibly growing with the frame rate. The arrest integrates in
    // closed form and the haul is a rate, so neither can do that.
    //
    // Parking it exactly is not tidiness either. The kick is an additive
    // offset on the viewmodel's pose, so a residue left running puts all
    // twenty-six sight pictures that far off the camera axis forever, and the
    // alignment check in VERIFYING.md reads that as a geometry bug.
    this.adsForKick = cam.adsBlend;
    this.kick.step(dt, this.kickShapeAt(cam.adsBlend));

    // The camera bobs on the same drive the weapon does; it owns the phase.
    // The drive is movement *intent*, not speed, so the crouch damping has to
    // be applied here — a half-speed shuffle covering ground at a full jog's
    // stride tempo is the tell.
    cam.setBobDrive(
      this.moveBlend *
        (1 - (1 - CONFIG.camera.bobCrouchMult) * this.crouchBlend),
      this.grounded,
    );

    // How steady the stance is, for the camera's hold sway. Off the same two
    // blends the bob uses and for the same reason — movement owns them — but
    // it is a multiplier around 1 rather than a 0..1 drive: a player standing
    // still still breathes. Crouching is the one thing that buys steadiness,
    // which is what makes it worth doing for a shot rather than only for cover.
    const sw = CONFIG.camera.aimSway;
    cam.setSwayDrive(
      (1 + (sw.moveMult - 1) * this.moveBlend) *
        (1 - (1 - sw.crouchMult) * this.crouchBlend) *
        (1 + CONFIG.player.suppressSwayMult * this.suppression),
    );

    // Where the bolt is, for the wobble the camera puts on the aim while one is
    // being worked. Pushed for the same reason as the two drives above — this
    // side owns the clock — and it is the same number `ViewModel` plays the
    // roll off, because an aimed cycle and a hip one are one gesture spent two
    // ways rather than two gestures. It reads 1 on every weapon that is not a
    // bolt gun, so nothing here asks which weapon is in the hands.
    cam.setCyclePhase(this.cycleProgress);

    // --- footfalls, off that same phase ---
    // The phase read here is a frame behind (the camera has not run yet), the
    // same 16 ms the viewmodel's bob is behind, and for the same reason.
    //
    // Amplitude, cadence and loudness all come off one drive: the bob stalls
    // when the player stops, so the steps stop with it, and the crouch damping
    // above slows the cadence while `crouchMult` below takes the level down.
    // Sprinting does NOT speed this up — the drive is movement *intent*, which
    // is already 1 at a walk — so a sprint reads as heavier boots at the same
    // pace rather than a faster gait.
    const f = CONFIG.audio.footstep;
    if (this.grounded && this.moveBlend > 0.15) {
      if (crossedFootfall(this.prevBobPhase, cam.bobPhase)) {
        this.events.footstep =
          (f.walkVol + (f.sprintVol - f.walkVol) * this.sprintBlend) *
          (1 - (1 - f.crouchMult) * this.crouchBlend) *
          this.moveBlend;
      }
    }
    this.prevBobPhase = cam.bobPhase;
    // Filled in place rather than rebuilt. `ViewModel.update` is documented as
    // allocating nothing and holds to it across 200 lines; the sixteen-field
    // literal that CALLED it was the one allocation on the path. ViewModel
    // reads the fields and keeps no reference, so one object outlives the call.
    const v = this.viewParams;
    v.adsBlend = cam.adsBlend;
    v.moveBlend = this.moveBlend * (1 - this.airBlend);
    v.sprintBlend = this.sprintBlend;
    v.reloadBlend = this.reloadBlend;
    v.reloadPhase = this.reloadProgress;
    v.reloading = this.reloading;
    v.loadPhase = this.loadProgress;
    v.cyclePhase = this.cycleProgress;
    v.swapBlend = this.swapWeight();
    v.throwTime = this.throwT;
    v.kick = this.kick.value;
    v.actionJolt = this.viewActionJolt;
    v.kickDrift = this.kickDrift;
    v.kickWeight = this.kickWeight;
    v.turnRate = this.turnRate;
    v.pitchRate = this.pitchRate;
    v.bobPhase = cam.bobPhase;
    v.velY = this.velY;
    v.landDip = cam.landDip;
    this.view.update(dt, v);
  }

  /**
   * How far the weapon is out of frame for the swap: 0 in the hands, 1 fully
   * away, peaking where the two change places.
   *
   * A triangle rather than a blend toward a state, and it is the same curve
   * either way round — one weapon rides it down and the next rides it back up,
   * which is why the peak has to be exactly where `completeSwap` fires. The
   * easing is the viewmodel's; this is only the clock read as a weight.
   */
  private swapWeight(): number {
    if (this.swapT < 0) return 0;
    const switchT = this.swapTime * CONFIG.viewmodel.swap.switchFrac;
    return this.swapT <= switchT
      ? this.swapT / switchT
      : Math.max(0, 1 - (this.swapT - switchT) / (this.swapTime - switchT));
  }

  /**
   * Consumes one shot if the weapon can fire right now.
   * Auto-reloads when the magazine empties.
   *
   * Takes the trigger rather than being called behind it, because a
   * semi-automatic weapon has to see the trigger come UP: the release is what
   * arms the next pull, and a caller that only speaks when the trigger is
   * down can never report one. Every path through here therefore ends with
   * the latch matching the trigger.
   *
   * The latch is set before the guards below, not after a successful shot, so
   * holding the trigger through a reload or a sprint does not fire the instant
   * either ends — which is exactly what a trigger that was never released
   * should do.
   *
   * A burst already in flight does not ask the trigger anything. It is the
   * one case where a released trigger still fires a round: the pull spent all
   * three, and a burst that stopped halfway because the finger came up would
   * be a fire mode nobody could aim, since the release lands mid-burst every
   * time it is tapped. The latch is still maintained underneath, so the pull
   * after it needs a genuine release exactly as the first one did.
   */
  tryShot(trigger: boolean): boolean {
    const wasHeld = this.triggerHeld;
    this.triggerHeld = trigger;
    // What a pull is allowed to ask for: a fresh round (or burst) needs the
    // trigger down, and needs it to have come up first on a weapon that says
    // so. A burst owed rounds asks on its own behalf.
    if (this.burstLeft <= 0) {
      if (!trigger) return false;
      if (this.weapon.semiAuto && wasHeld) return false;
    }
    // The cooldown is the weapon's clock and is NOT a refusal: mid-burst it is
    // the gap between the rounds, so it must be tested before anything that
    // would abandon the burst below.
    if (this.fireCooldown > 0) return false;
    if (
      !this.alive ||
      this.reloading ||
      this.sprinting ||
      this.swapping ||
      this.ammo <= 0
    ) {
      // Whatever the burst had left is gone with the weapon, the magazine or
      // the body. Remembering it would fire the remainder out of a reload or
      // out of a fresh spawn, seconds after the pull that asked for it.
      this.burstLeft = 0;
      return false;
    }
    const r = CONFIG.recoil;
    this.ammo -= 1;
    // A burst opens on its first round and closes on its last: within it the
    // gap is the weapon's rate, and at the end it is `burstCycle` — the dwell
    // that is the entire cost of the mode.
    if (this.weapon.burst > 1) {
      if (this.burstLeft <= 0) this.burstLeft = this.weapon.burst;
      this.burstLeft -= 1;
      this.fireCooldown =
        this.burstLeft > 0 ? this.weapon.shotInterval : this.weapon.burstCycle;
    } else {
      this.fireCooldown = this.weapon.shotInterval;
    }
    // Weapon-side recoil: the spread bloom the next shot inherits, and the
    // punch the body rides out. The aim kick itself belongs to the camera.
    // The ceiling takes the weapon's multiplier along with the per-shot term:
    // a weapon that blooms faster has to be allowed to bloom further, or the
    // extra rounds per second cost it nothing after the second shot.
    this.spreadBloom = Math.min(
      r.maxBloom * this.weapon.bloomMult,
      this.spreadBloom + r.bloomPerShot * this.weapon.bloomMult,
    );
    // A weapon quiet long enough for the spring to settle is firing a first
    // round again. No reload or ADS reset is needed on top: the shortest
    // reload here is 1.05 s, so the clock has already done it.
    if (this.sinceShot >= r.stringResetTime) this.stringShots = 0;
    this.stringShots += 1;
    this.sinceShot = 0;
    // Which way this round goes, drawn ONCE and read by both the aim
    // (`recoilKick`) and the model (`ViewModel`'s kick). The bias SCALES the
    // random term and offsets it rather than being added to it, so the total
    // stays inside -1..+1 whatever the bias is — which is what keeps every
    // ceiling documented for `maxYaw` true, and makes a bias of 0 bit-for-bit
    // the symmetric noise this replaced.
    const bias = this.weapon.yawBias;
    this.kickDrift = (Math.random() * 2 - 1) * (1 - Math.abs(bias)) + bias;
    // The weapon takes a velocity, not a displacement: see `kick`. It
    // ACCUMULATES on a weapon still coming home, which is the whole reason a
    // held trigger looks different from a string of taps — and the shot also
    // restarts the shooter's reaction, so a round landing mid-recovery pauses
    // the haul exactly as it does on the aim.
    //
    // `sinceShot` has already been zeroed above, which is the clock the ACTION
    // beats are laid on (`viewActionJolt`). One shot, one clock, three impacts
    // hanging off it.
    this.kick.strike(this.kickWeight, recoilGain(this.kickShapeAt(this.adsForKick)));
    // **The three things an anti-tank item does not do**, and they are one
    // test rather than three because they are one fact: it is not a gun. No
    // brass, because nothing here is cased; no muzzle strobe, because a
    // launcher's light is the motor leaving and `Game` puts that at the
    // rocket; and no auto-reload, because there is nothing behind the last
    // round to load. What DOES happen instead is a swap back to the primary
    // once the tube is empty — an empty launcher in the hands is a player
    // holding a pipe, and every shooter that has ever had one puts it away.
    if (this.carriedEquipment) {
      if (this.ammo === 0) this.drawSlot(PRIMARY_SLOT);
      return true;
    }
    // Muzzle flash: a single-frame-scale strobe with a random roll and scale,
    // so full-auto reads as flicker rather than one static sprite.
    const g = CONFIG.gunfeel;
    this.flashT = g.flashTime;
    this.flashRoot.setEnabled(true);
    this.flashRoot.rotation.z = Math.random() * Math.PI;
    this.flashRoot.scaling.setAll(0.85 + Math.random() * 0.4);
    this.ejectCasing();
    if (this.ammo === 0) this.startReload();
    return true;
  }

  /**
   * Gives back the round `tryShot` has just spent, for a shot that turned out
   * not to be makeable.
   *
   * The mirror of `spendGrenade`, arrived at from the other direction. A
   * throw is two calls a frame apart, so the pool can be asked BEFORE the
   * count is debited; a trigger is one call, so the count goes first and this
   * is what puts it back. The COOLDOWN is deliberately not refunded — the
   * weapon did cycle, and the alternative is a trigger that can be held
   * against a full pool at the frame rate.
   *
   * Bounded by the magazine for the reason every other write to `ammo` is:
   * two returns for one shot would be a rocket out of nowhere.
   */
  returnRound(): void {
    this.ammo = Math.min(this.magSize, this.ammo + 1);
  }

  /**
   * Whether a grenade could leave the hand right now.
   *
   * Sprinting is not a bar: a grenade is an off-hand action and running is
   * exactly when you want to get one over a wall. Reloading is not either, for
   * the same reason — the hand that works the magazine is not the hand that
   * throws.
   */
  canThrowGrenade(): boolean {
    return this.alive && this.grenades > 0 && this.throwCooldown <= 0;
  }

  /**
   * Starts the gesture. The arm is booked here and the grenade is not: a throw
   * takes `throw.windup` to reach the release, and what the pool can carry is
   * a question about the moment the thing has to exist, not about the moment
   * the button went down.
   *
   * The cooldown is spent up front all the same, or the button would restart
   * the wind-up under itself every frame it was held.
   */
  beginThrow(): boolean {
    if (!this.canThrowGrenade()) return false;
    this.throwT = 0;
    this.throwPending = true;
    this.throwCooldown = CONFIG.grenade.throwInterval;
    return true;
  }

  /**
   * True on the single frame the hand reaches full extension — the release.
   * Consumed by the asking, so the caller may throw exactly once per gesture,
   * and false forever if the player died mid-wind-up (the arm is gone with the
   * body, and a grenade must not appear where it was).
   */
  throwReleaseDue(): boolean {
    if (!this.throwPending) return false;
    if (this.throwT < CONFIG.viewmodel.throw.windup) return false;
    this.throwPending = false;
    return this.alive;
  }

  /**
   * Books the grenade the pool has just agreed to carry. Deliberately separate
   * from `throwReleaseDue`, and for the same reason it was always separate from
   * `canThrowGrenade`: a count debited for a grenade that never made it into
   * the air is the most confusing thing this feature could hand a player. A
   * refused release costs the arm's cooldown and nothing else.
   */
  spendGrenade(): void {
    this.grenades -= 1;
  }

  /** Where the throwing hand is, which is where the grenade leaves from. */
  throwHandWorld(): Vector3 {
    return this.view.throwHandWorld();
  }

  /**
   * Pops one brass case out of the eject port: sideways off the rifle with a
   * random upward toss and tumble. Pool-starved shots just skip the case.
   */
  private ejectCasing(): void {
    const c = this.casings.find((c) => c.t <= 0);
    if (!c) return;
    const g = CONFIG.gunfeel;
    // The port is on the viewmodel, so this is a camera-space frame resolved
    // to world: the brass leaves the gun you can see and then falls in the
    // world, which is exactly where it should end up. The node is the
    // viewmodel's rather than the model's, so it follows a weapon swap.
    const port = this.view.ejectPort;
    c.mesh.position.copyFrom(port.getAbsolutePosition());
    Vector3.TransformNormalToRef(
      _casingDir.set(1, 0, -0.2),
      port.getWorldMatrix(),
      c.vel,
    );
    c.vel.normalize().scaleInPlace(g.casingEject * (0.8 + Math.random() * 0.4));
    c.vel.y += g.casingUp * (0.7 + Math.random() * 0.6);
    c.spin = (Math.random() * 2 - 1) * 25;
    c.mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    c.t = g.casingLife;
    c.mesh.isVisible = !this.bodyHidden;
  }

  /**
   * Advances the flash strobe and the live brass. Cases fall ballistically
   * and come to rest on the ground plane under the player (an approximation
   * — they're never more than a toss away) until their lifetime expires.
   */
  private updateGunfeel(dt: number): void {
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) this.flashRoot.setEnabled(false);
    }
    const g = CONFIG.gunfeel;
    const restY = this.root.position.y - this.groundY + 0.02;
    for (const c of this.casings) {
      if (c.t <= 0) continue;
      c.t -= dt;
      if (c.t <= 0) {
        c.mesh.isVisible = false;
        continue;
      }
      if (c.vel.y !== 0 || c.mesh.position.y > restY) {
        c.vel.y -= g.casingGravity * dt;
        c.mesh.position.addInPlace(
          this.casingStep.copyFrom(c.vel).scaleInPlace(dt),
        );
        if (c.mesh.position.y <= restY && c.vel.y < 0) {
          c.mesh.position.y = restY;
          c.vel.setAll(0); // bounced to rest; tumble stops with it
          c.spin = 0;
        } else {
          c.mesh.rotation.x += c.spin * dt;
          c.mesh.rotation.z += c.spin * 0.7 * dt;
        }
      }
    }
  }

  startReload(): boolean {
    // Not during a swap: the magazine being worked would be on a weapon that
    // is halfway into a holster.
    if (this.reloading || this.swapping || this.ammo >= this.magSize) return false;
    // **An anti-tank item has no reload and this is the only place that is
    // said.** There is no reserve behind it — what is in the hands is the whole
    // of a life's rockets or mines — so a reload could only ever conjure one,
    // and the gesture the viewmodel would play is a magazine change on a
    // weapon that has no magazine. `tryShot` does not auto-start one either,
    // for the same reason.
    if (this.carriedEquipment) return false;
    this.reloading = true;
    this.reloadT = this.weapon.reloadTime;
    this.reloadPhase = 0;
    // Raised AFTER the state is set, so a handler reading `reloadTime` or
    // `reloading` sees the gesture that has begun rather than the one before it.
    this.onReload();
    return true;
  }

  /** Where the gesture is, 0..1 — frozen where a cancelled reload left it. */
  get reloadProgress(): number {
    return this.reloadPhase;
  }

  /**
   * Where the LAUNCHER's load is, 0..1, and 1 whenever nothing is being
   * loaded — the clock `ViewModel` plays `CONFIG.viewmodel.load` off.
   *
   * **It is the fire cooldown read as a gesture, and that is the whole idea.**
   * An anti-tank item has no reload and `startReload` refuses the slot
   * outright (see there, and `docs/antitank.md`) — there is no reserve to load
   * FROM, so a reload could only ever conjure a rocket. What there IS is
   * `shotInterval`, which on a two-shot weapon is the loader and nothing else:
   * `equipment.rpg.carry.fireRate` is written as the time it takes to put the
   * next rocket in the tube. So the gesture needs no state of its own, no
   * cancel path and no blend to ease it off — it is a pure function of a clock
   * that is already kept, already dropped by a swap (`completeSwap`) and
   * already zeroed by a fresh weapon in the hands.
   *
   * `ammo` is the other half of it, and the reason there is no "is this a
   * launcher" test here: a spent tube has nothing to load and `tryShot` is
   * already putting it away. What a weapon with a round left actually SHOWS is
   * the viewmodel's business — the mine, which comes through here too, has no
   * round to move and no gesture to play.
   */
  get loadProgress(): number {
    if (!this.alive || !this.carriedEquipment || this.ammo <= 0) return 1;
    const total = this.weapon.shotInterval;
    if (this.fireCooldown <= 0 || total <= 0) return 1;
    return Math.max(0, 1 - this.fireCooldown / total);
  }

  /**
   * Whether ammunition is going INTO the weapon right now — a magazine into a
   * well, or a rocket down a bore.
   *
   * The two gestures share almost nothing (see `loadProgress`), but everything
   * that has to ask "are the hands free?" wants both, and asking it as one
   * question is what stops the answer being right for one weapon and wrong for
   * the other. `reloading` and `loadProgress` stay separate underneath because
   * the viewmodel needs to know WHICH; nothing outside it does.
   *
   * The sprint is the caller that matters: a body cannot run with both hands
   * on the front of a launcher any more than it can run while changing a
   * magazine, and a launcher that could be loaded at a sprint would be the one
   * weapon in the kit whose reload is free. Firing needs no term from this —
   * `tryShot` is already refused by `fireCooldown`, which for the launcher IS
   * this gesture's clock.
   *
   * **`muzzleLoad` is why this is not simply `loadProgress < 1`.** Both AT
   * items run a cooldown and they mean opposite things: the launcher's is a
   * rocket going down a tube, the mine's is how fast a man can set one down
   * and stand up. Pinning somebody for the mine's half-second would be an
   * unexplained stop — there is no gesture on screen for it — at the exact
   * moment `layMine` already refuses to punish, which is a player backing away
   * from a hull.
   */
  get loading(): boolean {
    if (this.reloading) return true;
    const id = this.carriedEquipment;
    return id !== null && CONFIG.equipment[id].muzzleLoad && this.loadProgress < 1;
  }

  /**
   * How long the load now beginning takes, or 0 when there is none — for the
   * sound that has to fit it. `swapTotal`'s opposite number, and it exists for
   * the same reason: the gesture and the noise over it are one event, and the
   * only way they can stay one is if both read the same number.
   */
  get loadTime(): number {
    return this.loadProgress < 1 ? this.weapon.shotInterval : 0;
  }

  /**
   * Where the BOLT is, 0..1, and 1 whenever nothing is being cycled — the
   * clock `ViewModel` plays `CONFIG.viewmodel.cycle` off.
   *
   * **`loadProgress`'s twin, arrived at from the other end of the kit**, and
   * worth reading beside it: both are the fire cooldown read as a gesture, and
   * both exist because a wait with nothing on screen to be is a wait the player
   * reads as a rule rather than as an action. The launcher's cooldown is a
   * rocket going down a bore; this one is a shooter working an action, which is
   * the same idea one weapon further from the trigger.
   *
   * So it needs no state of its own either: no cancel path, no eased gate, and
   * nothing to strand. `fireCooldown` is already dropped by a swap
   * (`completeSwap`), already zeroed by a fresh weapon in the hands, and already
   * the thing that stops the trigger — which is why `tryShot` needs no term
   * from this and there is nothing here that could disagree with it.
   *
   * Three things read 1 and each is a different weapon not cycling. `boltCycle`
   * is the table's own answer and is false on everything but the sniper, so
   * this is the whole of the "is this a bolt gun" test and no caller repeats
   * it. `ammo <= 0` is the round that emptied the magazine: `tryShot` has
   * already started the reload on that frame and the reload owns the weapon
   * from there — a bolt worked under a magazine change would be two gestures on
   * one pair of hands. And `reloading` covers the reload started by the key
   * rather than by the last round.
   */
  get cycleProgress(): number {
    if (!this.alive || !this.weapon.boltCycle) return 1;
    if (this.reloading || this.ammo <= 0) return 1;
    const total = this.weapon.shotInterval;
    if (this.fireCooldown <= 0 || total <= 0) return 1;
    return Math.max(0, 1 - this.fireCooldown / total);
  }

  /**
   * How long the cycle now beginning takes, or 0 when there is none — for the
   * sound that has to fit it. `loadTime`'s twin, and it exists for that
   * field's reason: the gesture and the noise over it are one event, and the
   * only way they stay one is if both read the same number.
   */
  get cycleTime(): number {
    return this.cycleProgress < 1 ? this.weapon.shotInterval : 0;
  }

  /** World position of the rifle muzzle (tracer origin). */
  muzzleWorld(): Vector3 {
    return this.view.muzzleWorld();
  }

  /** Returns true if this damage killed the player. */
  /**
   * Keeps `center`/`eyePos` current; called once per frame from `update`.
   *
   * Both ride the crouch blend, and they must ride it together. `eyePos` is
   * the camera, the line-of-sight target and the point bots aim at all at
   * once, so dropping it alone would leave the player harder to see and
   * *easier* to hit — every incoming round aimed at the middle of an unmoved
   * sphere instead of grazing its top. Moving `center` down by the same half
   * metre keeps the sphere's top the same 0.05 m above the eye it is when
   * standing, so the profile shrinks honestly.
   *
   * The collider capsule itself is untouched: `moveWithCollisions` is
   * horizontal-only and the ground probe places the feet, so a shorter body
   * would buy nothing and would need a stand-up clearance test to be safe.
   */
  private syncCombatant(): void {
    const c = CONFIG.player;
    const p = this.root.position;
    const feet = p.y - this.groundY;
    const centerH =
      this.groundY + (c.crouchCenterHeight - this.groundY) * this.crouchBlend;
    const eyeH =
      CONFIG.camera.eyeHeight +
      (c.crouchEyeHeight - CONFIG.camera.eyeHeight) * this.crouchBlend;
    this.position.set(p.x, feet, p.z);
    this.center.set(p.x, feet + centerH, p.z);
    this.eyePos.set(p.x, feet + eyeH, p.z);
  }

  /**
   * `from` is the shooter's firing origin and `kind` is what delivered it, both
   * forwarded straight back out through `onDamaged` — the player controller has
   * no use for either, but the HUD's directional indicator wants the first and
   * the death cam's corpse wants the second, and this is the only path damage
   * takes. Neither is stored: a player has no `deathFrom` because a player has
   * no rig, and the stand-in body that does is stood up by `Game` from what
   * arrives here.
   */
  takeDamage(amount: number, from?: Vector3, kind?: DamageKind): boolean {
    if (!this.alive) return false;
    this.health = Math.max(0, this.health - amount);
    this.regenLockT = CONFIG.player.regenDelay;
    const died = this.health <= 0;
    if (died) this.alive = false;
    this.onDamaged(amount, died, from, kind);
    return died;
  }

  heal(amount: number): void {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  /**
   * The networked half of `takeDamage`: health the authority decided, plus the
   * regen lock that came with it.
   *
   * A multiplayer round assigns health rather than subtracting it, for the
   * reason `Game.onNetEvent` gives — but the LOCK is the other half of the same
   * event and the client still has to arm it, because regen is PREDICTED here.
   * Nothing on the wire carries a health except a hit, so a client that took
   * the number without the lock healed straight back to full over the next few
   * seconds off a server that had never healed it, and the lie held until the
   * next round landed and knocked it back down to what it had always been.
   *
   * Everything else a hit does — the vignette, the arc, the flinch — is
   * `Game`'s and stays there; the callback is deliberately NOT raised, because
   * the authority already told `Game` what happened and this is only the
   * bookkeeping that goes with it.
   */
  applyServerHealth(health: number): void {
    this.health = health;
    this.regenLockT = CONFIG.player.regenDelay;
  }

  /**
   * Shows/hides everything the player renders — which in first person is the
   * viewmodel and its brass, nothing else. Hidden outside gameplay: the menu
   * and deploy screen sit over a live view of the world, and the editor flies
   * the same camera the weapon is parented to, so a visible rifle would ride
   * along in front of it.
   */
  setBodyHidden(hidden: boolean): void {
    this.bodyHidden = hidden;
    // Putting the gun away and taking it out both end an inspection, which is
    // what stops a turntable pose surviving into a round — and it is why the
    // three places that hide the kit screen from underneath (the menu, the
    // editor, a round starting) owe nothing beyond the call they already make.
    if (this.inspecting) this.inspectWeapon(false);
    else this.applyVisibility();
  }

  /**
   * Hands the weapon to the loadout screen's turntable, or takes it back.
   * Pure pass-through apart from the visibility: the pose is the viewmodel's,
   * and nothing about the weapon's state — magazine, reload, spread — changes
   * because it is being looked at.
   */
  inspectWeapon(on: boolean): void {
    this.inspecting = on;
    if (on) this.view.beginInspect();
    else this.view.endInspect();
    this.applyVisibility();
  }

  /**
   * Turns the inspected weapon and re-poses it — one call per frame from the
   * loadout state, which is the only place that has a camera standing still
   * long enough for a turntable to mean anything.
   */
  updateInspect(dYaw: number, dPitch: number, fovY: number, aspect: number): void {
    if (!this.inspecting) return;
    this.view.spinInspect(dYaw, dPitch);
    this.view.updateInspect({ fovY, aspect });
  }

  private applyVisibility(): void {
    this.view.setVisible(!this.bodyHidden || this.inspecting);
    // The flash goes out with the weapon, and it has to be ENDED here rather
    // than left to retire itself. It hangs off the viewmodel's muzzle node but
    // is not one of the viewmodel's meshes, so the call above does not reach
    // it, and the strobe that would switch it off is `updateGunfeel` — which
    // stops being called the moment the body is put away. A death taken inside
    // the 50 ms of a shot's flash would otherwise freeze the star mid-strobe
    // and, because it draws in the viewmodel's depth-cleared group, hang it
    // over the middle of the screen for the whole death cam. It never *starts*
    // while the weapon is stowed, which is what made this look self-managing;
    // being stowed part-way through one is the case that was missing.
    if (this.bodyHidden) {
      this.flashT = 0;
      this.flashRoot.setEnabled(false);
    }
    // Live brass goes with it. Brass is deliberately NOT part of an
    // inspection: it is thrown into the world, and the world is not what the
    // kit screen is showing.
    for (const c of this.casings) {
      c.mesh.isVisible = c.t > 0 && !this.bodyHidden;
    }
  }
}
