/**
 * ViewModel.ts — The first-person weapon: whichever gun is carried and the two
 * gloved arms holding it, parented to the camera, plus every offset that moves
 * them (hip/ADS pose, sprint carry, the reload's timeline and the magazine it
 * changes, the off-hand throw's arm and give, sway, bob, kick).
 * Owns: the on-screen weapon. Nothing else may reparent or pose it.
 *
 * Invariants:
 * - A weapon's AMMUNITION is the only part of it that may move on its own,
 *   and it is only movable because the model merged it into a node of its own
 *   — `WeaponParts.magazine` for a weapon loaded through a well, and
 *   `WeaponParts.warhead` for the one loaded through the bore. A rig has at
 *   most one of the two, which is what lets `poseReload` and `poseLoad` each
 *   own the support arm outright. Nothing else may be animated off a weapon
 *   without the same split — everything else is inside one merged mesh per
 *   colour. `stow()` is the only place that state is cleared, and every way
 *   out of a half-finished gesture has to go through it or the weapon comes
 *   back with nothing in it.
 * - The ADS pose is DERIVED, never authored: `adsPos` places the weapon so
 *   that the FITTED sight's own `sightCenter` lands on the camera's axis at
 *   that sight's `eyeRelief`. The reticle then projects to the exact centre
 *   of the screen, which is where CombatSystem sends the bullets. Hand-tuning
 *   that offset breaks the one guarantee ADS is for, and it has to be
 *   re-derived every time EITHER half of the loadout changes — a different
 *   weapon carries the same optic at a different height. `applyFit` is the
 *   only place that may write it.
 * - The aimed pose is also scaled by the sight's `zoomComp`, which is a
 *   uniform scale about the camera's origin: `adsPos` and the node's own
 *   scaling take the same factor, so no ray direction moves and the sight
 *   stays exactly on the axis. Scaling one without the other is what would
 *   break it.
 * - The FITTED optic is a request and the WORN one is the answer. A weapon
 *   with a rail wears what the kit chose; the sidearm wears the notch and
 *   blade on its own slide whatever the kit says, because it has no rail to
 *   bolt anything to. `wornSight` resolves the two and `applyFit` is the only
 *   caller, which is what keeps the aimed pose, the zoom compensation and (via
 *   `carriedSight`) the camera's own FOV all derived from one sight.
 * - A FINISH is the one thing about a weapon that may be changed after it is
 *   built, and it is a material write and nothing else: `finishes.ts` owns
 *   the table and the repaint, `WeaponParts.finish` is the set of colour
 *   groups it may reach, and the optic on the rail is deliberately not in it.
 *   Nothing downstream of the fit is re-derived for one, because a finish
 *   moves no geometry.
 * - Every weapon is built once and all but the carried one is disabled, the
 *   same trick the optics use: a loadout change is a handful of boolean
 *   writes and a re-derivation, never a rebuild. That is also why the muzzle
 *   and the ejection port are nodes owned HERE rather than the model's — they
 *   have things hanging off them (Player's flash) that must survive a swap.
 * - Everything here is cosmetic WITH ONE EXCEPTION, and it is a read rather
 *   than a write: `throwHandWorld` is where the grenade leaves from, so the
 *   throwing hand's pose is the one thing on this rig that something in the
 *   world is placed by. A grenade that spawned anywhere else is a grenade the
 *   hand did not throw, which is the whole reason the arm exists.
 * - Everything else here is cosmetic. It reads the camera; it never writes it,
 *   and it never touches aim, spread or damage.
 * - The per-shot KICK is a spring displacement Player owns and this only reads
 *   (`PoseInput.kick`), the same split as `landDip` and `bobPhase`. It goes
 *   genuinely NEGATIVE as the spring overshoots the carry on the way home, so
 *   every term reading it must invert with it — gating on `> 0` rather than
 *   `!== 0` puts a visible corner in the return. Its lateral, roll and yaw take
 *   `kickDrift` so the model leans the way the muzzle walked, and those three
 *   plus the pitch are damped by `recoil.kick.adsMult` while the z travel is
 *   not: the weapon carries the sight, so anything that rotates or laterally
 *   shifts it while aimed takes the reticle off the axis the rounds fly down.
 * - Meshes render in VIEWMODEL_GROUP with the depth buffer cleared first, so
 *   the weapon is never sliced open by the wall the player is standing
 *   against. Anything else attached to it (Player's muzzle flash) must join
 *   that group or it will be hidden behind the gun it belongs to.
 * - Arms are built at the origin and merged per colour before being parented,
 *   the same rule as BuildingKit and the weapon models: MergeMeshes bakes
 *   world matrices, so the merge is only correct at identity.
 * - The loadout screen's turntable (`beginInspect`/`updateInspect`) is the one
 *   pose that is not the carried one, and it is the only thing here that may
 *   write `rotationQuaternion`. While one is set Babylon ignores `rotation`
 *   entirely, so `endInspect` clearing it is what lets the carried pose come
 *   back at all. The turntable also owns the CARD behind the weapon — see
 *   `buildKitBackdrop`, whose whole difficulty is where in the frame it is
 *   allowed to be drawn — and it goes up and down with the pose, which is
 *   what keeps it out of every other state in the game.
 */
import {
  Color3,
  Constants,
  DynamicTexture,
  Matrix,
  Mesh,
  MeshBuilder,
  type Node,
  Quaternion,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import { clamp, hermite } from "../core/math";
import type { CelMaterialFactory } from "../shaders/CelShader";
import { buildCarbine } from "./CarbineModel";
import { buildDmr } from "./DmrModel";
import { buildLmg } from "./LmgModel";
import { buildPistol } from "./PistolModel";
import { buildRifle } from "./RifleModel";
import { buildSmg } from "./SmgModel";
import { buildSniper } from "./SniperModel";
import { applyFinish, type FinishId } from "./finishes";
import { DEFAULT_SIGHT, sightSetup, type SightId, type SightSetup } from "./sights";
import { wornSight, type GripSpec, type WeaponBuilder, type WeaponParts } from "./weaponKit";
import { buildMine } from "./MineModel";
import { buildRpg } from "./RpgModel";
import {
  CARRIED_IDS,
  DEFAULT_WEAPON,
  carriedSetup,
  type CarriedId,
  type PrimaryWeaponId,
  type WeaponSetup,
} from "./weapons";

/**
 * Rendering group for everything that hangs off the camera. Babylon clears
 * depth between rendering groups, so group 1 draws over the world instead of
 * intersecting it — the standard fix for a viewmodel clipping through
 * geometry the player walks up to.
 */
export const VIEWMODEL_GROUP = 1;

/**
 * The model builder for each weapon. The one place the ids in
 * `CONFIG.weapons` meet the geometry, and a `Record` rather than a lookup so
 * adding a weapon without a model fails to compile.
 */
const WEAPON_BUILDERS: Record<CarriedId, WeaponBuilder> = {
  rifle: buildRifle,
  carbine: buildCarbine,
  smg: buildSmg,
  dmr: buildDmr,
  sniper: buildSniper,
  lmg: buildLmg,
  pistol: buildPistol,
  // The anti-tank slot's two. They are in this table for the same reason they
  // resolve to a `WeaponSetup`: the viewmodel is the one part of the game that
  // has no business knowing which table an id came out of — it builds a rig,
  // enables one and poses what is enabled.
  rpg: buildRpg,
  mine: buildMine,
};

/**
 * The card the kit screen's turntable stands against: one camera-parented
 * quad, dark, and up only while a weapon is being looked at.
 *
 * **Its rendering slot is the whole trick, and there is exactly one that
 * works.** The card has to cover the world and then be covered by the weapon,
 * and the two are in different rendering groups — the world in 0, everything
 * on the camera in `VIEWMODEL_GROUP`. Babylon draws a group's opaque meshes
 * first and its BLENDED ones last, so a blended mesh in group 0 with the
 * highest `alphaIndex` in the scene is the last thing drawn before the
 * viewmodel and the first thing the viewmodel draws over. That is why the card
 * is a hair transparent (see `inspect.backdrop.alpha`) rather than flatly
 * opaque: opaque, it would be sorted in among the village.
 *
 * The card is a painted flat, not geometry: nothing may collide with it, pick
 * it, shadow it or bloom it. The one thing it cannot cover is the GLOW LAYER,
 * which is composited over the finished frame rather than drawn into it —
 * `Game`'s emissive selector is where that is dealt with.
 */
function buildKitBackdrop(scene: Scene): Mesh {
  const i = CONFIG.viewmodel.inspect;
  const b = i.backdrop;
  // Square, because the quad is scaled to the frustum every frame and the
  // gradient is a soft pool that reads the same however it is stretched.
  const tex = new DynamicTexture("kitBackdrop", { width: 256, height: 256 }, scene);
  const ctx = tex.getContext();
  // The pool is centred where the WEAPON is: the anchor is in NDC, and the
  // canvas is y-down, which is the one place those two disagree.
  const cx = ((i.anchorX + 1) / 2) * 256;
  const cy = ((1 - i.anchorY) / 2) * 256;
  const pool = ctx.createRadialGradient(cx, cy, 0, cx, cy, 256 * b.poolRadius);
  pool.addColorStop(0, b.near);
  pool.addColorStop(1, b.far);
  ctx.fillStyle = b.far;
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = pool;
  ctx.fillRect(0, 0, 256, 256);
  tex.update();

  const mat = new StandardMaterial("kitBackdrop", scene);
  // Unlit: the card is a painted value, and a lit one would take the bench
  // lamps that are there to light the weapon.
  mat.disableLighting = true;
  mat.diffuseColor = Color3.Black();
  mat.specularColor = Color3.Black();
  mat.emissiveTexture = tex;
  mat.alpha = b.alpha;
  // Depth is then bent both ways, and both are load-bearing. `ALWAYS` is what
  // lets the card ignore the world's depth, so a wall the deploy camera is
  // standing against cannot cut a hole in the bench. Writing depth is how it
  // covers what its own pass cannot reach: the SKY is in the viewmodel's
  // rendering group too (`Sky` puts the moon there so the dome cannot drop
  // it), which draws after this one whatever the sorting says — and a card
  // that stamps 8 m across the frame fails the moon out of the depth test
  // while the weapon, a half-metre from the lens, sails through it.
  //
  // `forceDepthWrite`, not the absence of `disableDepthWrite`: setting a blend
  // mode turns depth writing OFF in the engine, so a blended mesh has to ask.
  mat.forceDepthWrite = true;
  mat.depthFunction = Constants.ALWAYS;
  mat.backFaceCulling = false;

  const card = MeshBuilder.CreatePlane("viewmodel_kitBackdrop", { size: 1 }, scene);
  card.material = mat;
  // Last of every blended mesh in the scene, and INFINITY is what that takes:
  // Babylon's default `alphaIndex` is already `Number.MAX_VALUE`, so any
  // ordinary large number sorts the card in FRONT of the untouched ones and
  // the capture skirt — a 28 m cylinder the deploy camera is usually inside —
  // paints its pane of light straight back over the bench.
  card.alphaIndex = Number.POSITIVE_INFINITY;
  card.isPickable = false;
  // Camera-parented, so its bounds are recomputed against a moving frustum —
  // the same reason the weapon's own meshes skip the cull test.
  card.alwaysSelectAsActiveMesh = true;
  // Read by the Game constructor's scan; it is up before that runs. A flat
  // painted with an emissive texture is exactly what the glow layer would
  // otherwise bloom, and a bloomed backdrop is a bright wash over the weapon.
  card.metadata = { noGlow: true, noInk: true, noShadowCaster: true };
  card.setEnabled(false);
  return card;
}

/** What the weapon needs to know about the player, per frame. */
export interface ViewModelParams {
  /** 0 = hip, 1 = fully aimed. The camera's blend, not the raw input. */
  adsBlend: number;
  /** 0..1 movement drive — the same value the camera bobs on. */
  moveBlend: number;
  sprintBlend: number;
  /**
   * The GATE on the reload gesture, eased — it is what takes the pose back off
   * the weapon when a reload is cancelled by a swap or a death. What the
   * gesture DOES is the phase's business, not this one's.
   */
  reloadBlend: number;
  /**
   * 0..1 through the reload: the whole timeline in `CONFIG.viewmodel.reload`
   * is read off it, from the magazine leaving the well to the bolt going
   * forward. Frozen by Player where a cancelled reload left it, so the pose
   * eases out of where it was rather than off the end of the gesture.
   */
  reloadPhase: number;
  /**
   * Whether a reload is actually in flight, as opposed to the weapon easing
   * out of one that was cancelled. The magazine keys off THIS rather than off
   * the blend: it has two places to be — in the weapon or out of it — and no
   * way to be halfway between them, so a cancelled reload has to put it back
   * rather than fade it home through the receiver.
   */
  reloading: boolean;
  /**
   * 0..1 through the LAUNCHER's load, and 1 whenever nothing is being loaded
   * — the whole timeline in `CONFIG.viewmodel.load` is read off it, from the
   * empty tube coming down off the shoulder to the hammer going back.
   *
   * It needs no gate beside it the way the reload does, and that is the shape
   * of the thing rather than an omission: `Player.loadProgress` is the fire
   * cooldown read as a fraction, so it starts at rest and ENDS at rest, and
   * everything that would cancel a reload — a swap, a death, a fresh weapon —
   * puts the clock back to zero rather than leaving a gesture stranded
   * halfway. A weapon with nothing to load reads 1 forever and this costs it
   * one comparison.
   */
  loadPhase: number;
  /**
   * 0..1 through the BOLT CYCLE, and 1 whenever nothing is being cycled — the
   * whole timeline in `CONFIG.viewmodel.cycle` is read off it.
   *
   * `loadPhase`'s twin in every respect, gate included: it needs none, because
   * `Player.cycleProgress` is a pure function of the fire cooldown and
   * everything that would cancel a gesture — a swap, a death, a fresh weapon —
   * zeroes that clock rather than stranding a phase halfway. A weapon with no
   * bolt to work reads 1 forever and this costs it nothing.
   */
  cyclePhase: number;
  /**
   * 0 = the weapon is in the hands, 1 = it is fully out of frame. A TRIANGLE
   * over the swap rather than a blend toward a state, because a swap is a
   * round trip: the same curve carries one weapon away and brings the next one
   * up, and the models are exchanged at the peak where nothing is on screen to
   * see it happen. Player owns the clock; this only reads it.
   */
  swapBlend: number;
  /**
   * Seconds since the throw was asked for, or negative when there is no throw
   * in flight. Seconds rather than a blend because the gesture is a TIMELINE
   * with a release in the middle of it (see `viewmodel.throw`) — the hand
   * cocks, whips, lets go and comes back, and a single 1 -> 0 weight cannot
   * say where in that the arm is. Player owns the clock; this only reads it.
   */
  throwTime: number;
  /**
   * The weapon punch: how far the weapon is displaced along its kick axes, ~1
   * at a single round's peak and briefly NEGATIVE as the spring overshoots the
   * carry on the way home. Read, never integrated here — Player owns the
   * spring, the same rule `landDip` and `bobPhase` follow.
   */
  kick: number;
  /**
   * Which way the last round walked, -1..+1. The same signed draw the aim kick
   * is built from (`Player.kickDrift`), so the model leans the way the muzzle
   * actually went rather than picking its own direction.
   */
  kickDrift: number;
  /** The carried weapon's share of the kick — `Player.kickWeight`. */
  kickWeight: number;
  /** Smoothed look rates (rad/s) — the weapon trails both. */
  turnRate: number;
  pitchRate: number;
  /** The camera's bob phase, so weapon and view stride together. */
  bobPhase: number;
  /** Vertical velocity (m/s), for the airborne give. */
  velY: number;
  /**
   * The camera's landing absorb, in metres and negative while the eye is
   * sunk. Read, never integrated here: one spring per impact (see
   * `CameraSystem.landDip`), the same rule the bob phase follows.
   */
  landDip: number;
}

const GLOVE = "#23262c";
const SLEEVE = "#3d4335";

/**
 * The throwing arm's geometry, in the same model units the weapons' arms are
 * built in (its node carries `scale`, exactly as the weapon does). The fist is
 * at the node's origin so the whole gesture can be authored as where the HAND
 * is, and the forearm runs back and outboard from it to an elbow that is
 * rigid — the arm swings as one piece, the same simplification the support
 * hand's trip to the magwell already makes.
 *
 * Its LENGTH is load-bearing rather than anatomical: the forearm stops at a
 * flat cut where a shoulder there is no geometry for would be, so the cut has
 * to stay off the screen at every pose in the gesture or the arm reads as a
 * floating log. Long, aimed down and outboard, it runs off the bottom-left
 * corner instead — see the note on the hand keys in `viewmodel.throw`.
 */
const THROW_ELBOW = new Vector3(-0.22, -0.55, -0.24);
/**
 * The frag in the fist, in those same model units — so 0.046 m once the node's
 * scale is applied, against `grenade.radius`'s 0.11 in the world. Deliberately
 * not the same number: the thrown body is sized to be NOTICED arriving across
 * a street, and a ball that size held at the lens is a beachball in a glove.
 * What has to match is the read — an olive sphere with a live pip on it.
 */
const THROW_BALL = 0.075;
/**
 * How far past the release the hand carries on, as a fraction of the whip it
 * just travelled, and the share of the recovery it spends getting there. An
 * arm that reversed on the release frame reads as the throw being cancelled
 * rather than followed through.
 */
const THROW_FOLLOW = 0.18;
const THROW_FOLLOW_FRAC = 0.28;

/** A plain triple, which is how every pose in CONFIG is written. */
type XYZ = { x: number; y: number; z: number };

/** Ramp from a to b, clamped at both ends. */
const ramp = (a: number, b: number, x: number) =>
  hermite(clamp((x - a) / (b - a), 0, 1));
/**
 * An impact and its die-away: 1 on the beat at `at`, squared to nothing over
 * `fall`, and zero outside. All attack and no ease-in, which is the difference
 * between something arriving and something being moved into place — the same
 * shape the per-shot kick has, for the same reason.
 */
const impulse = (x: number, at: number, fall: number) => {
  const t = (x - at) / fall;
  return t < 0 || t > 1 ? 0 : (1 - t) * (1 - t);
};

/**
 * What the turntable needs from the camera it is parented to. The weapon is
 * placed by SCREEN position, so it has to know how the camera projects: the
 * anchor is back-projected through these, which is also what makes the pose
 * survive a resize or a camera left zoomed by the last round.
 */
export interface InspectParams {
  /** Vertical field of view (radians) — Babylon's default fixed axis. */
  fovY: number;
  /** Render width / height. */
  aspect: number;
}

/** One built weapon and the arms holding it — enabled only while carried. */
interface WeaponRig {
  /** Parent of everything in this rig; the switch a loadout change throws. */
  root: TransformNode;
  parts: WeaponParts;
  /** The support arm, which leaves the handguard for the magazine swap. */
  supportArm: TransformNode;
  /**
   * The TRIGGER arm, which leaves the grip for the bolt knob.
   *
   * It exists for the same reason the support arm's node does and was added
   * for the opposite gesture: a reload is worked by the support hand and a bolt
   * is worked by the firing hand, so the two arms need one posable node each or
   * one of the two gestures is a part moving on its own. Every weapon has one
   * and all but the bolt gun leave it at identity forever, which costs a
   * `TransformNode` per rig and nothing per frame.
   */
  triggerArm: TransformNode;
  /** This weapon's magazine, or null if it has nothing that comes out. */
  magazine: TransformNode | null;
  /**
   * This weapon's loaded ROUND, or null if it is not loaded through the
   * muzzle. The magazine's twin, and exclusive with it: a rig has one of the
   * two at most, which is what lets the two gestures own the support arm
   * without arbitrating for it.
   */
  warhead: TransformNode | null;
  /**
   * This weapon's BOLT, or null if its action is not worked by hand.
   *
   * Unlike the magazine and the warhead this is not exclusive with either — a
   * bolt gun has a magazine as well — and unlike both of them it never leaves
   * the weapon. See `WeaponParts.bolt` for the one thing its geometry owes.
   */
  bolt: TransformNode | null;
  /**
   * The unit axis that magazine leaves along, weapon-local, resolved once from
   * the model's own rake. Straight down for anything standing vertically in
   * its well; see `magDropAxis`.
   */
  magDrop: Vector3;
}

export class ViewModel {
  /** Every visible part, for the one visibility switch Player owns. */
  readonly meshes: Mesh[] = [];
  /**
   * The gloved arms, of every weapon — the subset that lets go while the
   * weapon is on the turntable. A forearm cut off at the elbow is a fact of
   * first person that reads fine when the weapon is being carried and reads as
   * a severed arm when it is being turned over on a bench.
   */
  private readonly arms: Mesh[] = [];
  /** Whether the on-screen weapon is visible at all (Player's switch). */
  private shown = false;
  private inspecting = false;
  /**
   * The carried weapon's barrel tip and ejection port, as nodes that outlive a
   * loadout change. Player hangs the muzzle flash off the first and throws its
   * brass from the second, so neither may be a child of a rig that can be
   * switched off underneath them.
   */
  readonly muzzle: TransformNode;
  readonly ejectPort: TransformNode;

  /** Carries the whole pose; every rig hangs off it. */
  private readonly weapon: TransformNode;
  /**
   * The kit screen's backdrop — see `buildKitBackdrop`. Sized to the frustum
   * by `updateInspect`, so it follows the window without knowing anything
   * about the screen that raised it.
   */
  private readonly backdrop: Mesh;
  private readonly rigs = {} as Record<CarriedId, WeaponRig>;
  /**
   * The material factory, kept for the one thing here that mints materials
   * after construction: a FINISH. Everything else about a weapon is decided
   * when it is built, which is why nothing else on this class holds it.
   */
  private readonly mats: CelMaterialFactory;

  /**
   * The throwing arm, and the grenade in its fist. Parented to the CAMERA
   * rather than to `weapon`: the weapon tips out of the way for the throw, and
   * a hand that inherited that would be shoved around by the very pose it is
   * the cause of. Disabled whenever no throw is in flight, which is nearly
   * always — `setEnabled` rather than `isVisible`, so it composes with (and
   * cannot be trampled by) `applyMeshVisibility`'s two flags.
   */
  private readonly throwHand: TransformNode;
  /** Hidden the instant the real grenade leaves; back for the next wind-up. */
  private readonly throwBall: TransformNode;
  /**
   * The gesture as four keys — rest, cock, release, follow-through — resolved
   * once so the per-frame job is one lerp between two of them. The last is
   * DERIVED from the other two rather than authored: a little further along
   * the line the hand was already travelling when it let go, so an arm that
   * stopped dead on the release frame instead carries on and slows, and it
   * stays right whatever the three authored keys are moved to.
   */
  private readonly throwKeys: { pos: Vector3; rot: Vector3 }[] = [];

  /** Aimed position, derived from the fit (see the header). */
  private readonly adsPos = new Vector3();
  /** The carried weapon. Written only by `applyFit`. */
  private weaponFit: WeaponSetup = carriedSetup(DEFAULT_WEAPON);
  /**
   * The optic the KIT has fitted — a request, not the answer. A weapon with a
   * rail wears it; the sidearm wears the sights on its own slide whatever this
   * says, which is what `wornSight` resolves and `sight` below records.
   */
  private fittedSight: SightId = DEFAULT_SIGHT;
  /**
   * The optic actually in front of the eye, resolved by `applyFit` from the
   * carried weapon's own sights. Everything downstream of the fit — the aimed
   * pose, the zoom compensation, and (through `carriedSight`) the camera's FOV
   * and look rates — reads this rather than `fittedSight`, or the pose and the
   * zoom would be derived from a sight that is not on the weapon.
   */
  private sight: SightSetup = sightSetup(DEFAULT_SIGHT);
  /** Where the support hand goes for a magazine — this weapon's, or the shared
   *  offset when it has no opinion. Resolved by `applyFit`, never per frame. */
  private readonly magHand = new Vector3();
  /** The authored hip pose, plus the carried weapon's own length offset. */
  private readonly hipPos: Vector3;
  private readonly hipRot: Vector3;

  /**
   * The carried weapon's turntable pivot, in the weapon's own frame: a point
   * along its axis derived from its own muzzle landmark (see
   * `inspect.pivotFrac`), so the SMG spins about the middle of the SMG.
   * Written by `applyFit` with everything else the fit decides.
   */
  private readonly pivot = new Vector3();
  /** Turntable angles, in radians. Only the inspect path reads them. */
  private inspectYaw = 0;
  private inspectPitch = 0;

  // Sway state: a spring behind the look rates, so the weapon settles after
  // the camera has stopped instead of snapping back with it.
  private swayX = 0;
  private swayY = 0;
  private swayYaw = 0;
  private swayPitch = 0;
  /**
   * Smoothed airborne give (metres). The lag is the point: the body's vertical
   * speed steps at both ends of a jump, and the weapon is the one thing on
   * screen that must not step with it.
   */
  private airGive = 0;

  /** Scratch — the pose is rebuilt every frame and must not allocate. */
  private readonly pos = new Vector3();
  private readonly rot = new Vector3();
  /**
   * Every positional offset laid on TOP of the base pose — sprint, reload,
   * sway, bob, the airborne give and the per-shot kick. Kept apart from
   * `pos` so the zoom compensation can be applied to it: these are metres in
   * the camera's frame, and a compensated weapon is a weapon drawn closer,
   * where the same metre is a much bigger angle. Left unscaled, a flick of
   * sway that nudges the holo's picture would swing a 3.5x scope's bore
   * clean off the axis.
   *
   * Rotations deliberately do NOT get the same treatment: the weapon turns
   * about its own root, so the displacement a given angle produces already
   * scales with the model, and the angle at the eye comes out unchanged.
   */
  private readonly off = new Vector3();
  /**
   * Scratch for the loaded round's own offset while it is being put in — where
   * it is relative to seated, and how far it is turned getting there. Two,
   * because the hand riding it reads both after they are written.
   */
  private readonly roundPos = new Vector3();
  private readonly roundRot = new Vector3();
  /** Scratch for the turntable's rotation — built per frame, never allocated. */
  private readonly spinYaw = Matrix.Identity();
  private readonly spinPitch = Matrix.Identity();
  private readonly spin = Matrix.Identity();
  /**
   * The quaternion the node itself holds while inspecting. Handed over once by
   * `beginInspect` and mutated in place after that — Babylon compares the
   * object against its own cache, so an in-place write is seen, exactly as it
   * is for `position`.
   */
  private readonly spinQ = new Quaternion();

  constructor(scene: Scene, mats: CelMaterialFactory, camera: Node) {
    const v = CONFIG.viewmodel;
    this.mats = mats;
    this.hipPos = new Vector3(v.hipPos.x, v.hipPos.y, v.hipPos.z);
    this.hipRot = new Vector3(v.hipRot.x, v.hipRot.y, v.hipRot.z);

    this.weapon = new TransformNode("viewmodel", scene);
    this.weapon.parent = camera;
    this.weapon.scaling.setAll(v.scale);

    this.backdrop = buildKitBackdrop(scene);
    this.backdrop.parent = camera;

    // Every weapon is built up front. The cost is a set of merged colour
    // groups per weapon sitting disabled — against a rebuild in the middle of
    // a deploy screen, which would drop Player's muzzle flash on the floor and
    // stall the frame it happened on.
    for (const id of CARRIED_IDS) {
      const root = new TransformNode(`viewmodel_${id}`, scene);
      root.parent = this.weapon;
      const parts = WEAPON_BUILDERS[id](scene, mats, `view_${id}`);
      parts.root.parent = root;
      const supportArm = new TransformNode(`viewmodel_${id}_supportArm`, scene);
      supportArm.parent = root;
      // Both hands hang off a node of their own, so either gesture can take one
      // off the weapon. Both nodes sit at identity, so a weapon that never
      // moves a hand is drawn exactly as it was before they existed.
      const triggerArm = new TransformNode(`viewmodel_${id}_triggerArm`, scene);
      triggerArm.parent = root;
      const arms = [
        ...buildArm(scene, mats, `${id}_trigger`, parts.grip, triggerArm),
        ...buildArm(scene, mats, `${id}_support`, parts.support, supportArm),
      ];
      this.meshes.push(...parts.meshes, ...arms);
      this.arms.push(...arms);
      this.rigs[id] = {
        root,
        parts,
        supportArm,
        triggerArm,
        magazine: parts.magazine ?? null,
        warhead: parts.warhead ?? null,
        bolt: parts.bolt ?? null,
        // Straight down is the default, and it is right for anything standing
        // upright in its well — only a raked magazine has to say otherwise.
        magDrop: parts.magDrop ? parts.magDrop.clone() : new Vector3(0, -1, 0),
      };
    }

    // The throwing arm: ONE rig shared by every weapon, unlike the two arms
    // above. Where a hand grips is the model's business and is why those are
    // per-weapon; a fist closed around a grenade is not holding the gun at all
    // and has nothing to fit.
    this.throwHand = new TransformNode("viewmodel_throwHand", scene);
    this.throwHand.parent = camera;
    this.throwHand.scaling.setAll(v.scale);
    this.throwHand.setEnabled(false);
    const throwArm = buildArm(
      scene,
      mats,
      "throwHand",
      { hand: Vector3.Zero(), elbow: THROW_ELBOW },
      this.throwHand,
    );
    const ball = MeshBuilder.CreateSphere(
      "view_throwGrenade",
      { diameter: THROW_BALL * 2, segments: 6 },
      scene,
    );
    ball.parent = this.throwHand;
    ball.position.set(0, 0.04, 0.06);
    ball.material = mats.get("#3f4a33");
    ball.isPickable = false;
    const pip = MeshBuilder.CreateSphere(
      "view_throwGrenadePip",
      { diameter: THROW_BALL * 0.62, segments: 4 },
      scene,
    );
    pip.parent = ball;
    // Proud of the body's ink shell, the same rule the thrown grenade's pip and
    // the player's visor slit both follow.
    pip.position.y = THROW_BALL;
    pip.material = mats.getEmissive("#ff5a4f");
    pip.metadata = { noInk: true };
    pip.isPickable = false;
    this.throwBall = ball;
    this.meshes.push(...throwArm, ball, pip);
    this.arms.push(...throwArm);

    const th = v.throw;
    const key = (pos: XYZ, rot: XYZ) => ({
      pos: new Vector3(pos.x, pos.y, pos.z),
      rot: new Vector3(rot.x, rot.y, rot.z),
    });
    this.throwKeys.push(
      key(th.handRest, th.handRestRot),
      key(th.handCock, th.handCockRot),
      key(th.handRelease, th.handReleaseRot),
      key(th.handRelease, th.handReleaseRot),
    );
    // The follow-through, extrapolated past the release along the whip.
    for (const f of ["pos", "rot"] as const) {
      this.throwKeys[3][f]
        .subtractInPlace(this.throwKeys[1][f])
        .scaleInPlace(THROW_FOLLOW)
        .addInPlace(this.throwKeys[2][f]);
    }

    this.muzzle = new TransformNode("viewmodel_muzzle", scene);
    this.muzzle.parent = this.weapon;
    this.ejectPort = new TransformNode("viewmodel_ejectPort", scene);
    this.ejectPort.parent = this.weapon;
    this.applyFit();

    for (const m of this.meshes) {
      // **NO OUTLINE HULL, and this was the LAST one in the game.** The weapon
      // used to set `renderOutline` by hand — never through `addOutline`, which
      // is why it outlived the sweep that took the outline pass out — at
      // 0.004 m, an order of magnitude finer than the world's, because a
      // body-width line on parts this small swallows the whole weapon in black.
      // The ink is a screen-space pass now and inks the gun off the same depth
      // buffer as everything else; what stands in for the fine width is
      // `CONFIG.graphics.ink.near`, which scales the ink down over the first
      // couple of metres. See `shaders/CelInk.ts`.
      m.renderingGroupId = VIEWMODEL_GROUP;
      // Bounds of a camera-parented mesh are recomputed from a matrix that
      // moves with the frustum; skip the cull test rather than race it.
      m.alwaysSelectAsActiveMesh = true;
    }

    // Start in the hip pose so the first rendered frame is already right.
    this.weapon.position.copyFrom(this.hipPos);
    this.weapon.rotation.copyFrom(this.hipRot);
  }

  /**
   * Picks up a weapon: shows that rig, hides the rest, re-derives the pose.
   *
   * It takes a `CarriedId` and resolves through `carriedSetup`, which is the
   * one line in this file that knows the two tables exist. Everything past it
   * — the fit, the aimed pose, the arms — reads the resolved `WeaponSetup` and
   * cannot tell a launcher from a rifle. What a weapon is LOADED by is the one
   * thing that can: the rig carries a magazine or a warhead or neither, and
   * `update` picks the gesture off that rather than off the id.
   */
  setWeapon(id: CarriedId): void {
    this.weaponFit = carriedSetup(id);
    // The rig being put down keeps whatever mid-reload offset its support arm
    // had, whatever the magazine was doing when the reload was cancelled —
    // and, if the swap caught a throw in flight, an arm switched off for it.
    // All of it is per-rig state that a weapon this hand has never held must
    // not inherit.
    this.stow();
    this.applyFit();
  }

  /**
   * Fits an optic. What the kit asked for — whether the carried weapon can
   * actually take it is the weapon's business, and `applyFit` is where that is
   * settled.
   */
  setSight(id: SightId): void {
    this.fittedSight = id;
    this.applyFit();
  }

  /**
   * Paints a weapon. Cosmetic to the last pixel: nothing downstream of the fit
   * is re-derived, because a finish moves no landmark, no sight centre and no
   * hand — which is why this is the one loadout call that does not end in
   * `applyFit`.
   *
   * It names the weapon rather than assuming the carried one, so the pick a
   * player makes on the kit screen lands on the rig it was made against even
   * if something else is in the hands by the time it arrives.
   */
  setFinish(weapon: PrimaryWeaponId, id: FinishId): void {
    applyFinish(this.mats, this.rigs[weapon].parts.finish, id);
  }

  /**
   * The optic actually in front of the eye. Read by Player, and through it by
   * the camera, which has to agree with the aimed pose derived here about
   * which sight is being looked through — a camera zooming to a scope's FOV
   * over a pistol's notch is exactly the mismatch this getter exists to
   * prevent.
   */
  get carriedSight(): SightId {
    return this.sight.id;
  }

  /**
   * Puts the fit on screen and re-derives everything downstream of it.
   *
   * The derivation is the one thing here that is not art direction. The
   * sight's own centre is a child of the weapon root, which sits at identity
   * under `weapon`, so its local offset is exactly what has to be cancelled —
   * scaled, because `weapon.position` is in the camera's frame while the
   * sight's offset is in the weapon's, and `scale` is what separates the two.
   * Dropping that factor drops the reticle a couple of degrees below the
   * point of impact: a sight picture that looks plausible and shoots high.
   *
   * `zoomComp` then shrinks the whole aimed configuration — the stand-off and
   * the model together — about the camera's origin, which cannot move the
   * sight off the axis because a scale about the origin preserves directions.
   * It is how a 3.5x optic magnifies the world without magnifying the weapon.
   */
  private applyFit(): void {
    const v = CONFIG.viewmodel;
    const fitted = this.weaponFit.id;
    for (const id of CARRIED_IDS) {
      const rig = this.rigs[id];
      rig.root.setEnabled(id === fitted);
      // A rail switches one of three on; a fixed sight is part of the weapon
      // and there is nothing to switch — it goes wherever its weapon goes.
      const sights = rig.parts.sights;
      if (sights.kind === "fitted") {
        for (const [key, assembly] of Object.entries(sights.assemblies)) {
          assembly.root.setEnabled(key === this.fittedSight);
        }
      }
    }
    const parts = this.rigs[fitted].parts;
    const worn = wornSight(parts.sights, this.fittedSight);
    this.sight = sightSetup(worn.id);
    this.muzzle.position.copyFrom(parts.muzzle);
    this.ejectPort.position.copyFrom(parts.ejectPort);
    // A pistol keeps its magazine in the grip, so the shared trip to a magwell
    // under the receiver is wrong for it and it says so itself. The fallback is
    // set componentwise, never `copyFrom`: the CONFIG entry is a plain triple
    // and `copyFrom` reads `_x`/`_y`/`_z`, which would silently give NaN.
    const mh = parts.magHand;
    if (mh) this.magHand.copyFrom(mh);
    else this.magHand.set(v.magHandOffset.x, v.magHandOffset.y, v.magHandOffset.z);
    // A shorter weapon sits closer, or it reads as being held at arm's length;
    // one that hangs below its own bore is carried higher, or it falls off the
    // bottom of the frame. Both offsets are the weapon's, and both are applied
    // to the HIP pose alone — the aimed one is derived and has no say in it.
    this.hipPos.set(
      v.hipPos.x,
      v.hipPos.y + this.weaponFit.hipY,
      v.hipPos.z + this.weaponFit.hipZ,
    );
    // …and how far it is TURNED, which is the same offset arrangement one axis
    // further round: the shared pose frames a receiver, and a weapon that is
    // not one says how far it has to come off that. Only the hip pose takes
    // it — the aimed one is DERIVED, and a yaw baked into it would swing the
    // sight off the axis the rounds fly down.
    this.hipRot.set(
      v.hipRot.x,
      v.hipRot.y + this.weaponFit.hipYaw,
      v.hipRot.z,
    );

    // Where the turntable spins: along this weapon's own axis, so a swap on
    // the kit screen re-centres the model instead of hanging the SMG off the
    // point the rifle's receiver used to sit at.
    this.pivot.set(0, 0, parts.muzzle.z * v.inspect.pivotFrac);

    const s = v.scale * this.sight.zoomComp;
    const centre = worn.assembly.sightCenter.position;
    this.adsPos.set(
      -centre.x * s,
      -centre.y * s,
      this.sight.eyeRelief * this.sight.zoomComp - centre.z * s,
    );
  }

  /** World position of the muzzle (tracer and flash origin). */
  muzzleWorld(): Vector3 {
    return this.muzzle.getAbsolutePosition().clone();
  }

  setVisible(visible: boolean): void {
    this.shown = visible;
    this.applyMeshVisibility();
  }

  /**
   * The one place a mesh's visibility is written. Two flags decide it — shown
   * at all, and whether the hands are on the weapon — and routing both through
   * here is what stops the kit screen's "show the weapon" and its "let go of
   * it" from fighting over the arms depending on which ran last.
   */
  private applyMeshVisibility(): void {
    for (const m of this.meshes) m.isVisible = this.shown;
    if (this.inspecting) for (const m of this.arms) m.isVisible = false;
  }

  /** Drops every transient offset — called when a round starts. */
  reset(): void {
    this.swayX = 0;
    this.swayY = 0;
    this.swayYaw = 0;
    this.swayPitch = 0;
    this.stow();
    this.throwHand.setEnabled(false);
  }

  /**
   * Puts every rig back the way it is carried: both hands on the weapon, the
   * magazine in it and the round in the tube. The one place that state is
   * cleared, because there are three ways to leave a reload half-finished — a
   * swap, a round starting, and the kit screen coming up over one — and a
   * magazine left out of frame by any of them is a weapon that comes back
   * without one. The launcher's round is here for the same reason and not
   * quite the same argument: its own clock cannot strand it (see
   * `ViewModelParams.loadPhase`), but the kit screen freezes every clock
   * there is, and a rocket left hanging beside the turntable would be exactly
   * the magazine bug wearing a different hat.
   */
  private stow(): void {
    for (const id of CARRIED_IDS) {
      const rig = this.rigs[id];
      rig.supportArm.position.setAll(0);
      rig.supportArm.setEnabled(true);
      rig.triggerArm.position.setAll(0);
      if (rig.bolt) {
        rig.bolt.position.setAll(0);
        rig.bolt.rotation.setAll(0);
      }
      if (rig.warhead) {
        rig.warhead.position.setAll(0);
        rig.warhead.rotation.setAll(0);
        rig.warhead.setEnabled(true);
      }
      if (!rig.magazine) continue;
      rig.magazine.position.setAll(0);
      rig.magazine.rotation.x = 0;
      rig.magazine.setEnabled(true);
    }
  }

  /**
   * Takes the weapon off the shoulder and puts it on the loadout screen's
   * turntable, opened at the authored angles rather than wherever it was left
   * three deploys ago — the same rule the kit screen's own cursor follows.
   *
   * The pose switches to a quaternion here, and that is not a detail: the
   * carried pose is Euler and Babylon composes it in the WEAPON's frame, so at
   * a side-on yaw the pitch a drag asks for arrives as a roll. A quaternion
   * built yaw-then-pitch keeps the pitch about the camera's own horizontal
   * axis at every yaw, which is what makes a drag feel like a hand on the
   * weapon. `endInspect` puts the Euler pose back.
   */
  beginInspect(): void {
    const i = CONFIG.viewmodel.inspect;
    this.inspectYaw = i.baseYaw;
    this.inspectPitch = i.basePitch;
    this.weapon.rotationQuaternion = this.spinQ;
    this.inspecting = true;
    // The card goes up with the weapon and comes down with it, which is what
    // keeps it out of every other state in the game: there is one way onto the
    // turntable and one way off it.
    this.backdrop.setEnabled(true);
    // Nothing here runs `update`, so a throw caught by the kit screen would
    // leave its arm frozen across the turntable for as long as the screen is
    // up — and a reload, a magazine hanging in the air beside the turntable.
    this.throwHand.setEnabled(false);
    this.stow();
    this.applyMeshVisibility();
  }

  /** Hands the weapon back to the carried pose, hands and all. */
  endInspect(): void {
    // Euler `rotation` is dead while this is set, so dropping it is what lets
    // the hip pose return at all.
    this.weapon.rotationQuaternion = null;
    this.weapon.scaling.setAll(CONFIG.viewmodel.scale);
    this.inspecting = false;
    this.backdrop.setEnabled(false);
    this.applyMeshVisibility();
  }

  /**
   * Turns the weapon on the turntable — radians, from a drag or a stick. Yaw
   * wraps; pitch stops short of straight up and down, where a spinning
   * turntable stops reading as one.
   */
  spinInspect(dYaw: number, dPitch: number): void {
    const i = CONFIG.viewmodel.inspect;
    this.inspectYaw = (this.inspectYaw + dYaw) % (Math.PI * 2);
    this.inspectPitch = clamp(this.inspectPitch + dPitch, -i.pitchMax, i.pitchMax);
  }

  /**
   * Poses the weapon on the turntable. Not a step of `update` — nothing that
   * moves the carried weapon applies to one being looked at, so sway, bob, the
   * kick and the whole hip/ADS blend are simply absent.
   *
   * Two things are derived rather than authored, and both are what make the
   * stage hold still:
   * - The position is the stage's screen anchor BACK-PROJECTED to the inspect
   *   distance, so the weapon sits where the DOM says the stage is at any
   *   window size, and the distance is scaled by the live FOV against the
   *   hip-fire one so a camera left zoomed by the last round frames it the
   *   same. (Babylon holds the vertical FOV, hence the aspect on x alone.)
   * - The pivot correction. The node rotates about its own origin, which on a
   *   rifle is the receiver and nowhere near the middle of the model, so a
   *   turntable about it would swing the weapon around the screen. Placing the
   *   ROTATED pivot on the anchor instead keeps the weapon's own centre
   *   nailed to the stage while it turns.
   */
  updateInspect(p: InspectParams): void {
    const v = CONFIG.viewmodel;
    const i = v.inspect;

    // Yaw first, then pitch about the camera's horizontal axis: Babylon's
    // matrix product applies the left operand first (the same order
    // scale-rotate-translate is composed in).
    Matrix.RotationYToRef(this.inspectYaw, this.spinYaw);
    Matrix.RotationXToRef(this.inspectPitch, this.spinPitch);
    this.spinYaw.multiplyToRef(this.spinPitch, this.spin);
    Quaternion.FromRotationMatrixToRef(this.spin, this.spinQ);

    // The distance also gives way to a viewport narrower than the one the
    // framing was authored for: apparent size follows the VERTICAL fov, while
    // the room the weapon has to fit in is the stage's share of the WIDTH, so
    // on a nearly square window a rifle framed for 16:9 lies across the panel.
    const fit = Math.max(1, i.aspectReference / p.aspect);
    // Written as "hold the visible half-height at the weapon" rather than as a
    // distance, because that IS the framing: how much of the world fits beside
    // the weapon is what decides how big it looks, and holding it fixed is what
    // makes the stage identical through any FOV the last round left behind.
    const halfH = i.dist * fit * Math.tan(CONFIG.camera.fovHip / 2);
    const dist = halfH / Math.tan(p.fovY / 2);
    this.pos.copyFrom(this.pivot).scaleInPlace(v.scale);
    Vector3.TransformCoordinatesToRef(this.pos, this.spin, this.pos);
    this.pos.set(
      i.anchorX * halfH * p.aspect - this.pos.x,
      i.anchorY * halfH - this.pos.y,
      dist - this.pos.z,
    );

    this.weapon.position.copyFrom(this.pos);
    this.weapon.scaling.setAll(v.scale);

    // The card, cut to the frustum at its own distance. Derived every frame
    // from the same two numbers the weapon is placed with, so a resize, a
    // rotation into portrait and a camera left zoomed by the last round all
    // move the two together — and none of them can leave an edge of the world
    // showing down one side of the stage.
    const b = i.backdrop;
    const cardH = 2 * b.dist * Math.tan(p.fovY / 2) * b.margin;
    this.backdrop.position.set(0, 0, b.dist);
    this.backdrop.scaling.set(cardH * p.aspect, cardH, 1);
  }

  update(dt: number, p: ViewModelParams): void {
    const v = CONFIG.viewmodel;
    // The reload's weight is resolved FIRST, because the aim is one of the
    // things it acts on: a shouldered weapon comes down to be reloaded, and an
    // aimed one is on the camera axis, where any reload pose swings the
    // receiver across the middle of the screen whichever way it moves. Broken
    // out of the aim, the aimed reload is simply the hip reload.
    const r = v.reload;
    const rp = p.reloadPhase;
    const reloadW =
      p.reloadBlend *
      ramp(0, r.tiltIn, rp) *
      (1 - ramp(r.tiltOut[0], r.tiltOut[1], rp));
    // The launcher's load is the same shape one beat further on: a weight over
    // a phase, gating the aim exactly as the reload's does. The two are never
    // both live — a weapon is loaded through a well or through the bore — so
    // the aim takes both terms rather than choosing between them.
    const l = v.load;
    const lp = p.loadPhase;
    const rig = this.rigs[this.weaponFit.id];
    const loading = rig.warhead !== null && lp < 1;
    const loadW = loading
      ? ramp(0, l.tiltIn, lp) * (1 - ramp(l.tiltOut[0], l.tiltOut[1], lp))
      : 0;
    // The bolt cycle is the third of these and the same shape again: a weight
    // over a phase, gating the aim exactly as the other two do. It is the only
    // one that can genuinely coincide with another — the round that empties the
    // magazine starts a reload on the frame it fires — and `Player
    // .cycleProgress` settles that at the source by reading 1 while reloading,
    // so the aim never has both taken off it at once.
    const c = v.cycle;
    const cp = p.cyclePhase;
    const cycling = cp < 1;
    const cycleW = cycling
      ? ramp(0, c.tiltIn, cp) * (1 - ramp(c.tiltOut[0], c.tiltOut[1], cp))
      : 0;
    const t =
      hermite(clamp(p.adsBlend, 0, 1)) *
      (1 - reloadW * r.aimBreak) *
      (1 - loadW * l.aimBreak) *
      (1 - cycleW * c.aimBreak);

    // --- base pose: hip -> aimed, with sprint and reload layered on top ---
    // The state offsets are additive rather than exclusive, so a reload that
    // starts mid-sprint bends out of one and into the other with no pop.
    Vector3.LerpToRef(this.hipPos, this.adsPos, t, this.pos);
    this.rot.copyFrom(this.hipRot).scaleInPlace(1 - t);
    this.off.setAll(0);
    const sprintW = p.sprintBlend;
    if (sprintW > 0.001) {
      addScaled(this.off, v.sprintPos, sprintW);
      addScaled(this.rot, v.sprintRot, sprintW);
    }
    // The reload is a TIMELINE, not a state the weapon sits in. `reloadBlend`
    // is only the gate — it is what eases a cancelled one back off — and the
    // phase is the gesture: the weapon cants out of the carry as the support
    // hand leaves the handguard, holds while the magazine is changed under it,
    // and is level again on the bolt. The old pose was this offset held flat
    // for the whole duration, which is why a reload read as the weapon being
    // switched off and on rather than as anything being done to it.
    if (reloadW > 0.001) {
      addScaled(this.off, v.reloadPos, reloadW);
      addScaled(this.rot, v.reloadRot, reloadW);
    }
    // The magazine going home and the bolt going forward, laid on top as
    // IMPULSES rather than as poses. They are impacts, and the shape a weapon
    // answers an impact with is the one the per-shot kick already has: all
    // attack, then a squared decay. Sat in the pose stack as blends instead,
    // they would be two more places the weapon leans and neither would land on
    // the sound it belongs to.
    if (p.reloadBlend > 0.001) {
      const seat = p.reloadBlend * impulse(rp, r.magSeat, r.kickFall);
      if (seat > 0.001) {
        addScaled(this.off, r.seatKick.pos, seat);
        addScaled(this.rot, r.seatKick.rot, seat);
      }
      const bolt = p.reloadBlend * impulse(rp, r.bolt, r.kickFall);
      if (bolt > 0.001) {
        addScaled(this.off, r.boltKick.pos, bolt);
        addScaled(this.rot, r.boltKick.rot, bolt);
      }
    }
    // The launcher coming down off the shoulder to be loaded and going back up
    // onto it, and the two impacts in the middle of that — the rocket driven
    // home and the hammer thumbed back. Same construction as the reload above
    // it, because it is the same kind of thing: a pose over a timeline, with
    // the events laid on as impulses so each one lands on the sound it is.
    if (loadW > 0.001) {
      addScaled(this.off, v.loadPos, loadW);
      addScaled(this.rot, v.loadRot, loadW);
    }
    if (loading) {
      const seat = impulse(lp, l.seat, l.kickFall);
      if (seat > 0.001) {
        addScaled(this.off, l.seatKick.pos, seat);
        addScaled(this.rot, l.seatKick.rot, seat);
      }
      const cock = impulse(lp, l.cock, l.kickFall);
      if (cock > 0.001) {
        addScaled(this.off, l.cockKick.pos, cock);
        addScaled(this.rot, l.cockKick.rot, cock);
      }
    }
    // The rifle rolling its right flank up to be worked and coming back down,
    // and the two ends of the bolt's travel laid on as impulses. Same
    // construction as the reload and the load above it, for the third time and
    // the same reason: a pose over a timeline, with the events laid on top so
    // each one lands on the sound it is.
    if (cycleW > 0.001) {
      addScaled(this.off, v.cyclePos, cycleW);
      addScaled(this.rot, v.cycleRot, cycleW);
    }
    if (cycling) {
      const stop = impulse(cp, c.back, c.kickFall);
      if (stop > 0.001) {
        addScaled(this.off, c.stopKick.pos, stop);
        addScaled(this.rot, c.stopKick.rot, stop);
      }
      const home = impulse(cp, c.home, c.kickFall);
      if (home > 0.001) {
        addScaled(this.off, c.homeKick.pos, home);
        addScaled(this.rot, c.homeKick.rot, home);
      }
    }
    // The swap, on the same additive footing as the two above — which is what
    // lets a swap taken out of a sprint bend out of the carry rather than
    // snapping to the drop. Eased here rather than in Player: the clock is a
    // straight triangle, and the ease is how the weapon moves, which is this
    // file's business.
    const swapW = hermite(clamp(p.swapBlend, 0, 1));
    if (swapW > 0.001) {
      addScaled(this.off, v.swap.pos, swapW);
      addScaled(this.rot, v.swap.rot, swapW);
    }
    // The throw's give is NOT a symmetric arc like the blends above: it is the
    // support hand being somewhere else, so it comes on as fast as the hand
    // leaves the handguard, holds for as long as the hand is away, and eases
    // back as the arm returns. A weapon that dipped and recovered on a bell
    // curve is the shape of a recoil impulse, which is exactly what the old
    // throw was mistaken for.
    const th = v.throw;
    const total = th.windup + th.recover;
    const cockT = th.windup * th.cockFrac;
    const throwing = p.throwTime >= 0 && p.throwTime <= total;
    if (throwing) {
      const w =
        ramp(0, cockT, p.throwTime) *
        (1 - ramp(th.windup + th.recover * 0.3, total, p.throwTime));
      addScaled(this.off, th.weaponPos, w);
      addScaled(this.rot, th.weaponRot, w);
    }

    // --- sway: the weapon trails the look, damped hard while braced ---
    const swayMult = 1 - (1 - v.adsSwayMult) * t;
    const s = Math.min(1, dt * v.swaySmooth);
    this.swayX += (clamp(-p.turnRate * v.swayPos, -v.swayMax, v.swayMax) - this.swayX) * s;
    this.swayY +=
      (clamp(-p.pitchRate * v.swayPitchPos, -v.swayMax, v.swayMax) - this.swayY) * s;
    this.swayYaw +=
      (clamp(-p.turnRate * v.swayRot, -v.swayMax, v.swayMax) - this.swayYaw) * s;
    this.swayPitch +=
      (clamp(p.pitchRate * v.swayRot, -v.swayMax, v.swayMax) - this.swayPitch) * s;
    this.off.x += this.swayX * swayMult;
    this.off.y += this.swayY * swayMult;
    this.rot.y += this.swayYaw * swayMult;
    this.rot.x += this.swayPitch * swayMult;

    // --- bob: the camera's phase, so the weapon strides with the view ---
    const bobW = p.moveBlend * (1 - (1 - v.adsBobMult) * t);
    if (bobW > 0.001) {
      this.off.x += Math.sin(p.bobPhase) * v.bobLateral * bobW;
      this.off.y += Math.sin(p.bobPhase * 2) * v.bobVertical * bobW;
      this.rot.z += Math.sin(p.bobPhase) * v.bobRoll * bobW;
    }

    // --- airborne give: the weapon lags the body through a jump ---
    // Sprung, not read straight off velY. Vertical speed is a STEP function at
    // both ends of a jump — 0 to jumpVelocity at the push, impact speed to 0
    // on the frame the feet land — so a give taken directly from it snaps the
    // full `airDropMax` back to neutral in one frame, which is exactly the
    // pop the landing absorb below exists to replace.
    const give = -clamp(p.velY * v.airDrop, -v.airDropMax, v.airDropMax);
    this.airGive += (give - this.airGive) * Math.min(1, dt * v.airDropSmooth);
    this.off.y += this.airGive;

    // --- landing absorb: the hands take the impact after the eye does ---
    // The camera owns the spring and this reads it, the same arrangement as
    // the bob phase. The weapon is parented to the camera, so it already
    // travels with the dip; what these two add is the part that SHOWS — a
    // share of the sink again on top of it, and the muzzle dropping (rot.x
    // positive is nose-down, the way the per-shot kick is nose-up) as the
    // arms give and come back.
    this.off.y += p.landDip * v.landFollow;
    this.rot.x -= p.landDip * v.landPitch;

    // --- per-shot kick: back, up, nose-high, and over toward the drift ---
    // `p.kick` is a spring displacement, not a fading level, so it goes briefly
    // negative on the way home and every term below inverts with it — the
    // weapon comes back THROUGH the carry and settles from the front, which is
    // the half of the cycle the old fade could not show. Hence `!== 0` and not
    // `> 0.001`: the overshoot is real motion and clipping it at zero would put
    // a visible corner in the return.
    //
    // The lateral three take the shot's own drift, so the model leans the way
    // the muzzle walked. They are damped hard while aimed and the longitudinal
    // travel is not, and that split is geometry rather than taste: the weapon
    // carries the sight, so anything that rotates or laterally shifts it while
    // aimed takes the RETICLE off the axis the rounds fly down and the sight
    // picture lies. Travel along z leaves the picture centred and costs
    // nothing, which is also what a braced shoulder actually does with a rifle.
    if (p.kick !== 0) {
      const r = CONFIG.recoil;
      const k = p.kick * p.kickWeight;
      // Everything that moves the SIGHT off the camera axis rides this; only
      // the z travel below is exempt. Named for what it does rather than for an
      // axis, because it covers both a translation and two rotations.
      const offAxis = k * (1 - (1 - r.kick.adsMult) * t);
      const side = offAxis * p.kickDrift;
      // The travel is toward the EYE, and an aimed weapon is already only a few
      // centimetres from it — so on a magnified optic the kick can drive the
      // sight through the near plane, which reads as the scope going inside
      // your head. Worst case is the DMR with the scope: 0.065 x 1.605 x 0.457
      // is 4.8 cm of travel into a 7.8 cm stand-off, putting the eyepiece at
      // 3.0 cm against a 5 cm `minZ`. The rifle grazes it at 4.8 cm.
      //
      // The bound is DERIVED from the fitted sight rather than authored, the
      // same rule `adsPos` itself follows, so every optic on every weapon gets
      // the right answer with nothing per-combination written down. What the
      // travel spends is SCALED to fit the room rather than clamped to it: a
      // clamp stops the weapon dead partway through the kick and reads as a
      // clunk, where a scale keeps the spring's shape and only takes amplitude
      // off it. It blends in with `t`, so hip fire is untouched.
      //
      // The room is measured against `stackPeak`, not against one round: a
      // burst arrives faster than the spring returns, so the displacement this
      // is derived for is the biggest a string reaches, not 1.
      const sightDist = this.sight.eyeRelief * this.sight.zoomComp;
      const room = Math.max(0, sightDist - r.kick.adsClearance);
      const authored =
        r.kickBack * p.kickWeight * this.sight.zoomComp * r.kick.stackPeak;
      const fit = authored > 1e-6 ? Math.min(1, room / authored) : 1;
      this.off.z -= r.kickBack * k * (1 + (fit - 1) * t);
      this.off.y += r.kickBack * 0.25 * offAxis;
      this.off.x += r.kickSide * side;
      this.rot.x -= r.kickPitch * offAxis;
      // Negative against the drift: a positive roll takes the weapon's right
      // flank UP (see `viewmodel.reloadRot`), so a weapon walking right has to
      // roll negative to lean into where it is going rather than away from it.
      this.rot.z -= r.kickRoll * side;
      this.rot.y += r.kickYaw * side;
    }

    // The zoom compensation rides the same blend as the pose, so the weapon
    // shrinks into the aim exactly as the FOV closes around it and its
    // apparent size never jumps. At t = 0 this is 1 and the hip pose is
    // untouched; with a sight at or under the reference magnification it is 1
    // throughout and both lines below are a multiply by one.
    const k = 1 + (this.sight.zoomComp - 1) * t;
    this.pos.addInPlace(this.off.scaleInPlace(k));
    this.weapon.position.copyFrom(this.pos);
    this.weapon.rotation.copyFrom(this.rot);
    this.weapon.scaling.setAll(v.scale * k);

    // --- the round change: the magazine's trip, or the launcher's ---
    // One or the other and never both. They are exclusive because a rig holds
    // at most one of the two nodes (see `WeaponParts.warhead`) and because
    // both write the support arm — run together, whichever went second would
    // simply be the answer.
    if (rig.warhead) this.poseLoad(p, rig, throwing);
    else this.poseReload(p);
    // …and the bolt, which is neither of those and does not arbitrate with
    // them: it writes the TRIGGER arm and the bolt node, where both of the
    // above write the support arm and a round.
    this.poseBolt(p, rig);
    const supportArm = rig.supportArm;
    // ...and off the weapon entirely for a throw. The hand that throws IS the
    // support hand, so leaving it welded to the handguard would put two left
    // arms on screen at once — and hiding it is what motivates the give above:
    // the weapon tips because only the firing hand is still on it.
    supportArm.setEnabled(!throwing);

    // --- the throwing arm: the gesture the grenade actually leaves from ---
    this.throwHand.setEnabled(throwing);
    if (throwing) this.poseThrowHand(p.throwTime, cockT, th.windup, total);
  }

  /**
   * Places the throwing hand on the gesture's timeline. Four keys and one lerp
   * between two of them; what carries the read is the EASING, which differs
   * per segment because the phases of a throw are not the same motion:
   * - the wind-up eases in and out — the arm cocking is deliberate;
   * - the whip eases IN and is cut off at the release, so the hand is at its
   *   fastest on the very frame the grenade leaves it, which is the frame the
   *   eye is asked to believe the throw on;
   * - the follow-through eases OUT, the arm running down against itself;
   * - the return is a smoothstep, out of frame and forgotten.
   */
  private poseThrowHand(
    t: number,
    cockT: number,
    windup: number,
    total: number,
  ): void {
    const holdT = windup + (total - windup) * THROW_FOLLOW_FRAC;
    let a = 0;
    let b = 1;
    let w: number;
    if (t <= cockT) {
      w = hermite(t / cockT);
    } else if (t <= windup) {
      a = 1;
      b = 2;
      const x = (t - cockT) / (windup - cockT);
      w = x * x;
    } else if (t <= holdT) {
      a = 2;
      b = 3;
      const x = (t - windup) / (holdT - windup);
      w = 1 - (1 - x) * (1 - x);
    } else {
      a = 3;
      b = 0;
      w = hermite((t - holdT) / (total - holdT));
    }
    Vector3.LerpToRef(
      this.throwKeys[a].pos,
      this.throwKeys[b].pos,
      w,
      this.throwHand.position,
    );
    Vector3.LerpToRef(
      this.throwKeys[a].rot,
      this.throwKeys[b].rot,
      w,
      this.throwHand.rotation,
    );
    // The frag is in the fist right up to the release and gone after it: the
    // one in the air from that frame on is GrenadeSystem's, thrown from this
    // hand's own position, and two of them on screen at once would give the
    // whole thing away.
    this.throwBall.setEnabled(t < windup);
  }

  /**
   * Where the throwing hand is in the world — the release point Game hands to
   * `GrenadeSystem`, so the grenade leaves the hand the player watched cock
   * back instead of appearing on the camera axis like a muzzle. One frame
   * stale in the camera's own motion, exactly as the muzzle and the ejection
   * port are, because the camera has not been updated yet this frame.
   */
  throwHandWorld(): Vector3 {
    return this.throwHand.getAbsolutePosition().clone();
  }

  /**
   * The magazine change: where the magazine is on the reload's timeline, and
   * where the hand doing it is. The half of the gesture that is not the
   * weapon's pose, and the half that says what is actually happening — a
   * weapon that only tips and comes back is a weapon being fiddled with.
   *
   * The two are one motion by construction rather than by matching keys: from
   * the moment the fresh magazine enters the frame the hand rides EXACTLY the
   * travel the magazine rides, so it is carrying it rather than arriving with
   * it. Before that they part company on purpose — the old magazine is falling
   * free and accelerating away while the hand goes down after the new one, and
   * a hand that chased it down would read as having dropped it.
   *
   * Everything is scaled by `magHand`, which is the weapon's own answer to
   * "where is the well" — this runs for a pistol whose magazine is up inside
   * the grip and for a machine gun with a box under it, with no case for
   * either.
   */
  private poseReload(p: ViewModelParams): void {
    const r = CONFIG.viewmodel.reload;
    const rig = this.rigs[this.weaponFit.id];
    const ph = p.reloadPhase;

    // How far the magazine is out of the well along this weapon's drop axis,
    // how far it has tipped getting there, and whether it is in frame at all.
    let dist = 0;
    let tilt = 0;
    let shown = true;
    // Where the hand is on that same axis. Not the magazine's travel until the
    // fresh one is in it: while the old one falls, the hand is going down for
    // the new one at its own pace.
    let handDist = 0;
    if (ph > r.magOut) {
      const fall = (ph - r.magOut) / r.dropTime;
      if (fall < 1) {
        // Falling free, and accelerating — this is the one part of a reload
        // with no hand on it, and a magazine leaving at a constant rate reads
        // as being lowered rather than dropped.
        dist = r.dropDist * fall * fall;
        tilt = r.dropTumble * fall * fall;
      } else if (ph < r.insertFrom) {
        // Out of the bottom of the frame and gone. The one that comes back is
        // read as a fresh magazine because it was never seen to be the same
        // one, which is the whole reason the drop has to CLEAR the frame.
        shown = false;
      } else if (ph < r.magSeat) {
        // Coming up: distance to go falls as (1 - x²), so the magazine is at
        // its fastest on the frame it arrives. That is what makes the seat an
        // impact the weapon can flinch from and the clack a sound of something.
        const x = (ph - r.insertFrom) / (r.magSeat - r.insertFrom);
        const k = 1 - x * x;
        dist = r.insertDist * k;
        // Rocked in nose-first, the way a magazine with a lip at the front of
        // its well has to go in. The sign is the other way from the tumble
        // above: this is the mouth coming UP to meet the weapon.
        tilt = -r.insertTilt * k;
      }
      handDist =
        ph < r.insertFrom ? r.insertDist * ramp(r.magOut, r.insertFrom, ph) : dist;
    }

    // The magazine, gated on the reload being live rather than on the eased
    // blend: it belongs either in the weapon or out of it, so a cancelled
    // reload puts it back instead of lerping it home through the receiver.
    const mag = rig.magazine;
    if (mag) {
      if (p.reloading) {
        const axis = rig.magDrop;
        mag.position.set(axis.x * dist, axis.y * dist, axis.z * dist);
        mag.rotation.x = tilt;
        mag.setEnabled(shown);
      } else if (mag.position.lengthSquared() > 0 || !mag.isEnabled(false)) {
        mag.position.setAll(0);
        mag.rotation.x = 0;
        mag.setEnabled(true);
      }
    }

    // The hand. Off the handguard by the time the magazine is released, home
    // again once it is seated, and the eased blend on top of both so a reload
    // cancelled halfway takes the arm back with the pose rather than dropping
    // it back on the weapon in one frame.
    const w =
      p.reloadBlend * ramp(0, r.magOut, ph) * (1 - ramp(r.handHome[0], r.handHome[1], ph));
    const arm = rig.supportArm;
    if (w > 0.0001 || arm.position.lengthSquared() > 0) {
      const o = this.magHand;
      const d = handDist * p.reloadBlend;
      const axis = rig.magDrop;
      arm.position.set(
        o.x * w + axis.x * d,
        o.y * w + axis.y * d,
        o.z * w + axis.z * d,
      );
    }
  }

  /**
   * The bolt cycle: where the bolt is on the timeline, and where the hand
   * working it is.
   *
   * `poseReload`'s and `poseLoad`'s third sibling, and the shortest of the
   * three because the part it moves never leaves the weapon. A magazine is
   * released and replaced; a rocket is fetched and pushed home; a bolt is
   * lifted, drawn a cartridge's length, pushed back and turned down, and every
   * one of those four is a straight lerp with an ease on it. There is nothing
   * to hide, nothing to swap and nothing to drop.
   *
   * The two motions are deliberately SEPARATE clocks over the one phase rather
   * than one blend. A bolt turns before it moves and moves before it turns
   * back, and running the two together would be a handle spiralling out of its
   * notch — which is not a mechanism, it is a screw.
   *
   * The hand and the bolt are one motion by the construction the other two
   * gestures use: from the lift onward the hand rides EXACTLY the travel the
   * bolt rides, offset by where a fist sits on a knob, so it is pulling the
   * thing rather than hovering beside it. Before the lift they part company on
   * purpose — the hand is coming off the grip and the bolt has not moved yet.
   *
   * It runs for every weapon and costs a weapon without a bolt one comparison
   * and one `lengthSquared`, which is the price of not needing a caller to know
   * which weapon is in the hands.
   */
  private poseBolt(p: ViewModelParams, rig: WeaponRig): void {
    const c = CONFIG.viewmodel.cycle;
    const ph = p.cyclePhase;
    const cycling = ph < 1;

    // How far back the bolt is drawn, and how far the handle is turned.
    // `draw` opens on the lift and closes on the seat; `liftTurn` is up by the
    // lift and down again by the lock, so the handle is horizontal for the
    // whole of the travel between them and vertical at neither end of it.
    let draw = 0;
    let turn = 0;
    if (cycling) {
      draw =
        c.draw *
        (ramp(c.lift, c.back, ph) - ramp(c.back, c.home, ph));
      turn =
        c.liftTurn * (ramp(0, c.lift, ph) - ramp(c.home, c.lock, ph));
    }

    // The bolt, gated on the cycle being live rather than on an eased weight:
    // it belongs either forward in the action or somewhere along its travel,
    // and a weapon put down mid-cycle has to come back closed rather than lerp
    // home through its own receiver. `Player.cycleProgress` cannot strand it —
    // a swap zeroes the clock — so this is the reload's rule kept for the one
    // case it cannot cover, which is a rig switched off while the phase was
    // still running.
    const bolt = rig.bolt;
    if (bolt) {
      if (cycling) {
        bolt.position.z = -draw;
        bolt.rotation.z = turn;
      } else if (bolt.position.z !== 0 || bolt.rotation.z !== 0) {
        bolt.position.setAll(0);
        bolt.rotation.setAll(0);
      }
    }

    // The hand. Off the grip by the time the handle lifts, home again once it
    // is locked down, and riding the draw in between. There is no eased blend
    // over it the way the reload's has, because there is nothing that can
    // interrupt this halfway: the clock under it is the fire cooldown, and
    // everything that would abandon the gesture zeroes that clock instead.
    const w = cycling
      ? ramp(0, c.lift, ph) * (1 - ramp(c.handHome[0], c.handHome[1], ph))
      : 0;
    const arm = rig.triggerArm;
    if (w > 0.0001 || arm.position.lengthSquared() > 0) {
      const o = c.cycleHand;
      arm.position.set(o.x * w, o.y * w, o.z * w - draw);
    }
  }

  /**
   * The launcher's load: where the fresh rocket is on the timeline, and where
   * the hand putting it there is.
   *
   * `poseReload`'s opposite number, and it is worth reading them side by side
   * because the difference between them is the difference between the two
   * weapons. A magazine is RELEASED — it falls out of the well under gravity
   * with no hand on it, clears the frame, and a second one comes up from
   * below. A rocket is never released at all: what left the tube left it under
   * power and is a hundred metres away, so there is nothing to drop, nothing
   * to catch and no fall to animate. What there is instead is a REACH — the
   * hand goes out of frame after the next round and comes back with it — and
   * then the one motion this gesture exists to show: the round offered to the
   * mouth of the bore and pushed back down it.
   *
   * The two halves are one motion by the same construction the magazine's are:
   * from the moment the round is in the hand, the hand rides EXACTLY the
   * travel the round rides, offset by where a hand sits on a rocket. Before
   * that they are the same trip anyway, because the hand is going to fetch the
   * thing rather than following it.
   *
   * The round appears at `offerFrom` and is simply NOT THERE before it, which
   * is the frame's whole account of a launcher between rockets: an empty tube
   * with a hand away from it. Nothing fades and nothing is half-loaded — a
   * rocket is in the weapon or it is not.
   */
  private poseLoad(p: ViewModelParams, rig: WeaponRig, throwing: boolean): void {
    const l = CONFIG.viewmodel.load;
    const round = rig.warhead;
    if (!round) return;
    const ph = p.loadPhase;

    // Where the round is relative to seated, and how far it is still turned
    // out of the notch. Three segments, and the seams between them agree by
    // construction rather than by matching keys: each begins where the last
    // one ended.
    this.roundPos.setAll(0);
    this.roundRot.setAll(0);
    // How far through the reach the hand is — 1 from the moment it has the
    // round. It is what the hand's own trip out of frame runs on, and it is
    // the one part of this the round is not in.
    let reach = 1;
    if (ph < l.offerFrom) {
      // Fetching. There is no round yet, and the hand is on its way down to
      // where one will be — which is the same place, so the two never have to
      // be reconciled.
      reach = hermite(ph / l.offerFrom);
      this.roundPos.set(
        l.offerPos.x * reach,
        l.offerPos.y * reach,
        l.offerPos.z * reach,
      );
    } else if (ph < l.alignAt) {
      // Coming up and turning onto the bore. Eased at both ends: this is an
      // arm lifting something heavy into place, not a part travelling on a
      // rail, and it is the half of the gesture the player has time to read.
      const x = hermite((ph - l.offerFrom) / (l.alignAt - l.offerFrom));
      this.roundPos.set(
        l.offerPos.x * (1 - x),
        l.offerPos.y * (1 - x),
        l.offerPos.z + (l.alignDist - l.offerPos.z) * x,
      );
      this.roundRot.set(l.offerRot.x * (1 - x), l.offerRot.y * (1 - x), l.indexTurn);
    } else {
      // Going home down the bore, and the index turn unwinding with it. The
      // distance falls as (1 - x²), so the round is at its FASTEST on the
      // frame it arrives — the magazine's rule, and it is what makes the seat
      // an impact the weapon can flinch from rather than a part being parked.
      // This arm also covers seated: at x = 1 it is identity, which is where
      // the round spends every frame nothing is happening to it.
      const x = Math.min(1, (ph - l.alignAt) / (l.seat - l.alignAt));
      const k = 1 - x * x;
      this.roundPos.z = l.alignDist * k;
      this.roundRot.z = l.indexTurn * k;
    }

    round.position.copyFrom(this.roundPos);
    round.rotation.copyFrom(this.roundRot);
    // Gated on the phase rather than eased, because a rocket has two places to
    // be and nothing in between. Written only on the frames it changes: this
    // runs every frame of the game the launcher is carried, and `setEnabled`
    // walks the subtree under it.
    //
    // **A throw takes the round with the hand**, and it has to: the throwing
    // hand IS the support hand, so `update` switches that arm off for the
    // gesture — and a round left drawn is then a rocket hanging in mid-air in
    // front of the camera with nothing holding it. The magazine next door gets
    // away with staying put because it spends the throw below the frame; this
    // one is half a metre of warhead in the middle of it. The two come back
    // together on the same frame, still in each other's company, because the
    // hand's position is this round's position plus a constant.
    const shown = ph >= l.offerFrom && !throwing;
    if (round.isEnabled(false) !== shown) round.setEnabled(shown);

    // The hand. Off the shield as it goes down for the round, carrying it for
    // the whole of the trip up and in, and home again once the motor is
    // seated — the return laid over the top so the arm walks back to the
    // handguard instead of arriving there.
    const arm = rig.supportArm;
    const w = reach * (1 - ramp(l.handHome[0], l.handHome[1], ph));
    if (w > 0.0001 || arm.position.lengthSquared() > 0) {
      const o = l.loadHand;
      arm.position.set(
        (o.x + this.roundPos.x) * w,
        (o.y + this.roundPos.y) * w,
        (o.z + this.roundPos.z) * w,
      );
    }
  }
}

function addScaled(
  target: Vector3,
  by: { x: number; y: number; z: number },
  w: number,
): void {
  target.x += by.x * w;
  target.y += by.y * w;
  target.z += by.z * w;
}

/**
 * One gloved hand plus the forearm running back out of frame, built at the
 * origin in weapon-local units and merged per colour before being parented —
 * the arm is rigid relative to the weapon (a viewmodel's hands never let go),
 * so there is nothing to animate and every reason to collapse the draw calls.
 * Each weapon gets its own pair, because where a hand sits is the model's
 * business and a shorter gun is held somewhere else entirely.
 *
 * The forearm is aimed with a throwaway node rather than trigonometry:
 * `lookAt` puts local +z on the elbow and the cylinders are laid along it.
 * Every part is then detached with `setParent(null)` — which folds the aim
 * node's transform into the part's own — BEFORE the merge, because
 * `bakeCurrentTransformIntoVertices` (the one-mesh path, as in MapBuilder)
 * resets the local matrix and would leave a still-parented mesh transformed
 * twice.
 */
function buildArm(
  scene: Scene,
  mats: CelMaterialFactory,
  name: string,
  grip: GripSpec,
  parent: TransformNode,
): Mesh[] {
  const parts = new Map<string, Mesh[]>();
  const collect = (color: string, m: Mesh) => {
    m.material = mats.get(color);
    m.isPickable = false;
    const g = parts.get(color);
    if (g) g.push(m);
    else parts.set(color, [m]);
  };

  // The fist: a blocky glove wrapped around the grip/handguard.
  const fist = MeshBuilder.CreateBox(
    `view_${name}Hand`,
    { width: 0.09, height: 0.125, depth: 0.11 },
    scene,
  );
  fist.position.copyFrom(grip.hand);
  collect(GLOVE, fist);

  // Wrist -> elbow, tapering out to the sleeve.
  const aim = new TransformNode(`view_${name}Aim`, scene);
  aim.position.copyFrom(grip.hand);
  aim.lookAt(grip.elbow);
  const len = Vector3.Distance(grip.hand, grip.elbow);

  const wrist = MeshBuilder.CreateCylinder(
    `view_${name}Wrist`,
    { height: len * 0.28, diameterTop: 0.084, diameterBottom: 0.092, tessellation: 8 },
    scene,
  );
  wrist.parent = aim;
  wrist.rotation.x = Math.PI / 2; // +y axis -> the aim node's +z
  wrist.position.z = len * 0.16;
  collect(GLOVE, wrist);

  const sleeve = MeshBuilder.CreateCylinder(
    `view_${name}Sleeve`,
    { height: len * 0.76, diameterTop: 0.096, diameterBottom: 0.13, tessellation: 8 },
    scene,
  );
  sleeve.parent = aim;
  sleeve.rotation.x = Math.PI / 2;
  sleeve.position.z = len * 0.62;
  collect(SLEEVE, sleeve);

  const merged: Mesh[] = [];
  for (const [color, group] of parts) {
    for (const m of group) m.setParent(null);
    const m =
      group.length === 1
        ? group[0].bakeCurrentTransformIntoVertices()
        : Mesh.MergeMeshes(group, true, true);
    if (!m) continue;
    m.name = `view_${name}_${color.slice(1)}`;
    m.material = mats.get(color);
    m.parent = parent;
    m.isPickable = false;
    merged.push(m);
  }
  aim.dispose();
  return merged;
}
