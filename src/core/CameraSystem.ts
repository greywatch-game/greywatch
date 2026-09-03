/**
 * CameraSystem.ts — First-person camera: aim yaw/pitch, ADS blend (FOV +
 * sensitivity), recoil, per-shot view punch, head bob.
 * Owns: the scene's active camera. The camera sits AT the player's eye — it
 * never leaves the head, so there is no occlusion pick and no pull-in. The one
 * exception is `place()`, which hands the camera to `DeathCam` when there is no
 * longer a head to sit in; that caller owns its own pull-in, because it is the
 * only thing here that ever looks at the player from outside.
 * How far ADS zooms, how much it slows the look, and how fast it gets there
 * all belong to the LOADOUT (`setLoadout`), not to CONFIG.camera — the
 * camera's own numbers are the hip-fire ones. Zoom and sensitivity are the
 * optic's alone; only the blend RATE is shared with the weapon, because how
 * fast a sight comes up is a fact about the weight in your hands as well as
 * about the glass on top of it.
 * The player's look-speed SETTINGS (`setLookScale`, one multiplier per device)
 * multiply the CONFIG rates and reach nothing else: the ADS multipliers, the
 * optic's magnification and the aim assist's bound are all expressed against
 * those rates, so scaling at the source moves all three. `stickYawRate` is the
 * one place the stick's is written out, because that getter exists for the aim
 * assist rather than for this camera.
 * Invariants: recoil decay uses true Math.exp(-rate*dt) — NOT the frame-lerp
 * idiom — because burst climb must not vary with frame rate. Recoil only
 * partly springs back (CONFIG.recoil.recoverFraction); the rest is pushed into
 * the player's aim permanently — a deliberate product decision, not a bug.
 * `addFlinch` is the ONE aim kick that is 100% springy, and must stay that
 * way: a hit is not a choice the player made, so a permanent share would
 * ratchet the view up over one exchange. It shares the spring rather than
 * owning one, so it cannot drift against the recoil sitting on top of it.
 * The view punch (FOV spike / camera shove / directed nudge), the head bob and
 * the landing absorb are pure cosmetics: they are applied only to the rendered
 * camera, never to aimPitch/aimYaw, so bullets and bots never see them. The
 * punch's angles are drawn ONCE per shot and held, not re-rolled per frame —
 * white noise at 8-13 rounds a second is a buzz, not an impact.
 * TWO offsets are deliberately the exception and both are part of
 * aimPitch/aimYaw, because the weapon hangs off this camera and a sight
 * picture that drifts while the rounds fly down an undrifted axis is a reticle
 * that lies. The aimed hold sway (CONFIG.camera.aimSway) is one; the bolt
 * cycle's wobble (CONFIG.viewmodel.cycle.wobble) is the other, and it is here
 * for exactly that reason — a bolt gun keeps its sight picture through the
 * cycle, so the only honest place left to spend the cycle is on where the
 * rifle POINTS. Both are OFFSETS and neither is integrated into pitch/yaw:
 * each is a pure function of a phase and each is exactly zero when its phase
 * is not running, so no amount of breathing or cycling walks the aim anywhere.
 * The landing absorb is a damped spring this system owns and the viewmodel
 * READS (`landDip`) — one integrator per impact, the same rule as the bob
 * phase. It and the view punch are the only two things that write the camera's
 * roll, and they do it through ONE assignment at the end of `update`: a second
 * write site is how a roll becomes whichever contributor happened to run last.
 * Must run before lighting.update()/sfx.setListener() in Game's frame order,
 * and before the shader's eye is pushed on the way into the render.
 */
import { FreeCamera, Scene, Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import { hermite, impulse, smoothstep } from "./math";
import { RecoilAxis, recoilGain, type RecoilShape } from "./recoilCurve";
import {
  DEFAULT_SIGHT,
  sightSetup,
  type SightId,
  type SightSetup,
} from "../entities/sights";
import {
  carriedSetup,
  DEFAULT_WEAPON,
  weaponSetup,
  type CarriedId,
} from "../entities/weapons";
import type { InputManager } from "./InputManager";

/**
 * First-person camera. Aiming down sights brings the weapon's sight onto the
 * camera axis (ViewModel's job) while this system zooms the FOV, slows the
 * look, and damps the bob — one blend drives all three so the transition
 * reads as a single motion.
 */
export class CameraSystem {
  readonly camera: FreeCamera;
  yaw = 0;
  pitch = 0.12;
  /** 0 = hip, 1 = fully aimed (ADS). */
  adsBlend = 0;

  /**
   * The fitted optic's resolved numbers: aimed FOV, look multipliers, and how
   * fast the blend converges. Everything ADS does about zoom comes from here
   * rather than from CONFIG.camera, so a loadout change is one assignment.
   */
  private sight: SightSetup = sightSetup(DEFAULT_SIGHT);
  /**
   * The carried weapon's share of the ADS blend rate. How fast a sight comes
   * up is the optic's `adsSpeedMult` times this — a scope is slow on either
   * weapon, and either weapon raises the same scope at its own pace. Nothing
   * else about the gun reaches the camera.
   */
  private weaponAdsMult = weaponSetup(DEFAULT_WEAPON).adsSpeedMult;
  /** The carried weapon's steadiness in the hands, scaling the hold sway. */
  private weaponSwayMult = weaponSetup(DEFAULT_WEAPON).swayMult;

  /**
   * The player's own look-speed multipliers, one per device
   * (`Settings.mouseSensitivity` / `stickSensitivity`), pushed by
   * `Game.applySettings`. 1 is the shipped rate.
   *
   * They multiply the CONFIG rates and nothing else, which is what keeps them
   * out of everything downstream: the ADS multipliers, the optic's
   * magnification and the aim assist's bound are all expressed against those
   * rates, so scaling at the source moves all three together and none of them
   * has to know this setting exists.
   */
  private mouseScale = 1;
  private stickScale = 1;
  private touchScale = 1;

  /**
   * Head-bob phase, in radians, advanced by travel rather than by time.
   * Public because the viewmodel bobs on the SAME phase — two integrators fed
   * the same drive would drift apart and the weapon would swim against the
   * view. ViewModel reads it one frame late (Player updates before the
   * camera does), which is 16 ms of a 0.8 s cycle.
   */
  bobPhase = 0;
  /** Smoothed 0..1 movement drive for the bob, pushed by Player each frame. */
  private bobAmount = 0;
  private bobTarget = 0;

  /**
   * The recoil offset on the aim, stacked on top of the player's own angle:
   * the gun's own rotation, arrested by the grip and then hauled back by the
   * shooter. `core/recoilCurve.ts` is the model and carries the argument for
   * why it is not a spring — the short version is that nothing about a gun
   * wants to be where it started, so a restoring force is the wrong shape and
   * reads as rubber at any amplitude worth feeling.
   *
   * Two axes, one per angle, stepped on the SAME shape — the pitch and the
   * yaw of one event, so a weapon whose kick is mostly sideways at the end of
   * a string still comes home on the timing its mass and the shooter's stance
   * decide.
   */
  private readonly recoilPitch = new RecoilAxis();
  private readonly recoilYaw = new RecoilAxis();
  /**
   * The permanent share of the kicks fired so far that has not yet reached the
   * player's own aim. A bookkeeping bucket and deliberately not a second model
   * of the same motion: it holds no rate of its own, is drained at the haul's
   * own rate, and cannot therefore drift against it the way two integrators on
   * one impact would.
   *
   * It exists because the permanent share used to be applied whole on the
   * frame the trigger broke. Under a first-order decay that was invisible —
   * the whole kick was a step function too — but against a model with a rise
   * it is 30% of every kick landing in one frame underneath an attack that
   * takes 30-60 ms, which is exactly the artefact the rise was brought in to
   * remove.
   */
  private owedPitch = 0;
  private owedYaw = 0;
  /**
   * How disturbed the shooter's POSITION is, 0 at rest and `recoil.shake.max`
   * at saturation. Raised by every shot in proportion to the weapon's
   * `recoilImpulse` and fading on a true exponential; it widens and quickens
   * the hold sway and nothing else. See `CONFIG.recoil.shake` — this is the
   * half of a heavy round's cost that is not an angle.
   */
  private shotShake = 0;
  /**
   * The carried weapon's `recoilImpulse`, and how long its disturbance takes
   * to fade. Held rather than passed because both are state the shots stack
   * on, unlike the view punch's scale — see `addPunch`.
   */
  private weaponImpulse: number = weaponSetup(DEFAULT_WEAPON).recoilImpulse;
  private shakeSettle: number = CONFIG.recoil.shake.settle;
  /**
   * The recoil model's constants at each end of the ADS blend, resolved from
   * the carried weapon by `setSettleShape` and blended per frame by `shapeAt`.
   *
   * **They are two shapes rather than one scaled, because the two stances are
   * two mechanical systems.** Aimed, the weapon is in a three-point lock —
   * shoulder pocket, cheek weld, support hand — which is stiff and which a
   * braced shooter drives back at once. At the hip it hangs on two arms: a
   * long, soft lever with nothing constraining it. Under the old spring the
   * stance was one amplitude multiplier and the SHAPE was identical, so hip
   * fire was aimed fire turned up, which is the one thing it is not.
   */
  private readonly shapeHip: RecoilShape = {
    grip: CONFIG.recoil.settle.gripHip,
    haul: CONFIG.recoil.settle.haulHip * CONFIG.recoil.pitchPerShot,
    riseTurns: CONFIG.recoil.settle.riseTurns,
    easeBand: CONFIG.recoil.settle.easeBand * CONFIG.recoil.pitchPerShot,
  };
  private readonly shapeAds: RecoilShape = {
    grip: CONFIG.recoil.settle.gripAds,
    haul: CONFIG.recoil.settle.haulAds * CONFIG.recoil.pitchPerShot,
    riseTurns: CONFIG.recoil.settle.riseTurns,
    easeBand: CONFIG.recoil.settle.easeBand * CONFIG.recoil.pitchPerShot,
  };
  /** Scratch for the blended shape — stepped every frame, never allocated. */
  private readonly shape: RecoilShape = { ...this.shapeHip };
  /**
   * View punch, 1 at the shot and falling to 0 over `recoil.punchTime`.
   * Squared before use so the spike is at the impact frame.
   */
  private punchT = 0;
  /**
   * The direction this punch is throwing the view, drawn once per shot and
   * held for its life. Unit-ish: pitch is up-biased, yaw and roll carry the
   * shot's own drift with noise on top.
   *
   * It used to be `Math.random()` re-rolled every frame, and that is why the
   * amplitudes in `CONFIG.recoil` had to be almost invisible: white noise at
   * 8-13 rounds a second overlaps into a buzz that reads as a dirty lens
   * rather than as a weapon going off. One coherent nudge per shot reads as an
   * impact at roughly twice the amplitude and costs nothing.
   */
  private punchPitch = 0;
  private punchYaw = 0;
  private punchRoll = 0;
  /**
   * How hard THIS punch hits, scaling all five of its terms together — the
   * FOV spike, the shove and the three angles. Held for the punch's life like
   * the direction above, and 1 for anything that does not state one.
   */
  private punchScale = 1;

  /**
   * The aimed hold sway: this frame's offsets, and the free-running breath
   * phase they are drawn from. Part of the AIM (see the header) — the weapon
   * wanders and the rounds wander with it.
   *
   * The phase runs whether or not anything is aiming, so bringing a sight up
   * does not restart the same wander from the same place every time; it wraps
   * at 4pi rather than at 2pi because the slowest term runs at half rate, and
   * every term's multiplier is a half-integer so all four are continuous
   * across the wrap.
   */
  private swayPhase = 0;
  private swayPitch = 0;
  private swayYaw = 0;
  /** Eased weight from the player's stance, 1 = standing still. */
  private swayAmount = 1;
  private swayTarget = 1;

  /**
   * The bolt cycle, 0..1 and 1 whenever nothing is being cycled — pushed by
   * `Player`, which owns the clock (`Player.cycleProgress`), for the reason the
   * bob and sway drives are pushed rather than pulled.
   *
   * The two offsets under it are what a rifle being worked does to the HOLD,
   * and they are here rather than on the weapon because a bolt gun is the one
   * weapon whose gesture keeps the sight picture: the scope stays on the eye,
   * so the rifle may not move, so what moves is where it is pointed. See
   * `CONFIG.viewmodel.cycle` — the timeline is stated once, over there, beside
   * the roll this crosses with.
   */
  private cyclePhase = 1;
  private cyclePitch = 0;
  private cycleYaw = 0;

  /**
   * The landing absorb: how far the eye has sunk into a touchdown, in metres
   * and never positive until the recovery overshoots. A damped spring rather
   * than a decaying pulse, because knees are one — it is given a downward
   * VELOCITY at the impact and finds its own way back, so the dip has weight
   * on the way in and a small rebound on the way out instead of a sawtooth.
   *
   * Public because the weapon rides a share of it (`ViewModel`). One
   * integrator, read by both — the same rule the bob phase follows, and for
   * the same reason: two springs on one impact drift apart and the gun swims
   * against the view.
   */
  landDip = 0;
  private landVel = 0;

  /** Scratch for the rendered camera position — no per-frame allocation. */
  private readonly eye = new Vector3();

  constructor(scene: Scene) {
    this.camera = new FreeCamera("mainCamera", new Vector3(0, 3, -8), scene);
    this.camera.minZ = 0.05;
    this.camera.fov = CONFIG.camera.fovHip;
    this.camera.inputs.clear(); // fully driven by this system
    // The roll (`rotation.z`, written by the landing absorb) reaches the view
    // matrix only through the camera's UP VECTOR, and Babylon otherwise keeps
    // that vector as state refreshed on the frames `rotation.z` *changes*.
    // Since the refresh bakes the yaw and pitch of that frame in with the
    // roll, the frame a landing settles on leaves a stale up vector standing
    // for the rest of the round: the tilt is zero where it was settled and
    // grows with every degree you turn away from it. This derives the up
    // vector from `rotation` every frame instead, which is what the flag is
    // for. Never remove it while anything writes roll.
    this.camera.updateUpVectorFromRotation = true;
    scene.activeCamera = this.camera;
  }

  /** Takes the whole loadout. Cheap enough to call on every change. */
  setLoadout(weapon: CarriedId, sight: SightId): void {
    this.sight = sightSetup(sight);
    const w = carriedSetup(weapon);
    this.weaponAdsMult = w.adsSpeedMult;
    this.weaponSwayMult = w.swayMult;
    this.setSettleShape(w.recoilImpulse);
  }

  /**
   * Resolves the recoil model for what is now in the hands, at both ends of
   * the ADS blend.
   *
   * **A heavier weapon is a SLOWER response, never a bigger angle**, which is
   * the whole of the split between `recoilMult` and `recoilImpulse`: more mass
   * takes longer to arrest and longer to drive back. Neither term can move
   * where the round went.
   *
   * Cheap enough to call on every loadout change, and it may be called with a
   * kick in flight — a swap does not zero the aim, and an excursion that
   * continues under new constants is a weapon changing hands rather than a
   * discontinuity in the picture.
   */
  private setSettleShape(impulse: number): void {
    const st = CONFIG.recoil.settle;
    const sh = CONFIG.recoil.shake;
    this.weaponImpulse = impulse;
    // The mine states 0 (nothing is fired), and both terms are divisions.
    const imp = Math.max(0.1, impulse);
    this.shakeSettle = sh.settle * Math.pow(imp, sh.settleExp);
    const mass = Math.pow(imp, st.massExp);
    const ref = CONFIG.recoil.pitchPerShot;
    this.shapeHip.grip = st.gripHip / mass;
    this.shapeHip.haul = (st.haulHip * ref) / mass;
    this.shapeHip.easeBand = st.easeBand * ref;
    this.shapeAds.grip = st.gripAds / mass;
    this.shapeAds.haul = (st.haulAds * ref) / mass;
    this.shapeAds.easeBand = st.easeBand * ref;
  }

  /**
   * The model's constants for the stance the shooter is actually in, into the
   * scratch shape. A plain lerp: both ends are the same three quantities and
   * shouldering a weapon is a continuous act, so a blend between them is a
   * grip tightening rather than a switch between two behaviours.
   */
  private shapeAt(blend: number): RecoilShape {
    const a = this.shapeHip;
    const b = this.shapeAds;
    this.shape.grip = a.grip + (b.grip - a.grip) * blend;
    this.shape.haul = a.haul + (b.haul - a.haul) * blend;
    this.shape.riseTurns = a.riseTurns;
    this.shape.easeBand = a.easeBand;
    return this.shape;
  }

  /**
   * How fast the permanent share is handed into the player's own aim, per
   * second, for the stance it was fired in.
   *
   * **Derived from the haul rather than authored**, because the two are the
   * same event: the shooter bringing the muzzle down is also the moment they
   * stop fighting what is left of it. `haul` is a rate in radians and
   * `pitchPerShot` is what one kick is worth, so their ratio is the
   * reciprocal of how long a reference kick takes to come home — 12/s aimed
   * and 7/s at the hip on the reference weapon, which is what the numbers in
   * `settle` are stated in.
   */
  private drainRate(blend: number): number {
    return this.shapeAt(blend).haul / CONFIG.recoil.pitchPerShot;
  }

  /**
   * The player's look-speed settings. Cheap enough to call on every change,
   * like `setLoadout`; `Game.applySettings` is the only caller.
   */
  setLookScale(mouse: number, stick: number, touch: number): void {
    this.mouseScale = mouse;
    this.stickScale = stick;
    this.touchScale = touch;
  }

  /**
   * Where the weapon is actually pointed: the player's aim, plus recoil, plus
   * the hold sway. Everything downstream — the shot, the aim assist, the
   * damage arcs — reads the aim through here, so the sway is honest by
   * construction rather than by anyone remembering to add it.
   */
  get aimPitch(): number {
    return (
      this.pitch + this.recoilPitch.value + this.swayPitch + this.cyclePitch
    );
  }

  get aimYaw(): number {
    return this.yaw + this.recoilYaw.value + this.swayYaw + this.cycleYaw;
  }

  /**
   * World-space aim direction (through the crosshair), into `out`.
   *
   * The `ToRef` form exists because the getter below it is the most-read API in
   * the frame — the aim assist, the shadow focus, the audio listener and the
   * camera's own update each take it once per frame, and every one of those
   * reads used to mint a `Vector3`. This file's own scratch comment three
   * dozen lines up says it does not allocate per frame; the accessors were the
   * one place that was not true.
   *
   * The plain getters are kept for the per-EVENT callers (a shot, a throw, a
   * grenade release), where an allocation is free and a scratch would be a trap
   * — two of them holding the same vector is a bug that reads as correct.
   */
  forwardToRef(out: Vector3): Vector3 {
    const cp = Math.cos(this.aimPitch);
    return out.set(
      cp * Math.sin(this.aimYaw),
      Math.sin(this.aimPitch),
      cp * Math.cos(this.aimYaw),
    );
  }

  /** World-space aim direction (through the crosshair). */
  get forward(): Vector3 {
    return this.forwardToRef(new Vector3());
  }

  /**
   * The yaw rate a full stick deflection currently produces (rad/s), with the
   * fitted optic's ADS multiplier already in it. `AimAssistSystem` bounds its
   * own rotation as a fraction of this, which is what makes "a committed
   * stick always out-turns the assist" true through a 3.5x scope as well as
   * down the irons — the assist tuned as an absolute rate was 3.4x the
   * player's own scoped turn rate. Reads the same `adsBlend > 0.5` step
   * `update` applies the multiplier on, so the two cannot disagree.
   *
   * The player's own stick setting is in here for the same reason the optic's
   * multiplier is: a player who has halved their look speed has halved what
   * "the player always out-turns the assist" is measured against, and an assist
   * left at the shipped rate would out-turn them.
   */
  get stickYawRate(): number {
    const aiming = this.adsBlend > 0.5;
    return (
      CONFIG.camera.stickSensX *
      this.stickScale *
      (aiming ? this.sight.stickMult : 1)
    );
  }

  /**
   * The same quantity for a THUMB (rad/s), and the reason it needs inventing:
   * a stick has a full deflection to measure "as fast as the player can turn"
   * against, and a drag does not. `CONFIG.touch.swipeReference` stands in for
   * one — the speed a brisk swipe travels at — so the aim assist's bound means
   * the same thing on glass as it does on a pad, and shrinks with the optic and
   * with the player's own touch sensitivity exactly as the stick's does.
   */
  get touchYawRate(): number {
    const aiming = this.adsBlend > 0.5;
    return (
      CONFIG.touch.lookSensX *
      CONFIG.touch.swipeReference *
      this.touchScale *
      (aiming ? this.sight.mouseMult : 1)
    );
  }

  /** Yaw-only forward, for movement on the ground plane. Deliberately the
   * un-recoiled yaw: strafing must not swim while the gun is kicking. */
  get flatForward(): Vector3 {
    return this.flatForwardToRef(new Vector3());
  }

  /** As `flatForward`, into `out`. See `forwardToRef` on why both exist. */
  flatForwardToRef(out: Vector3): Vector3 {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  get flatRight(): Vector3 {
    return this.flatRightToRef(new Vector3());
  }

  /** As `flatRight`, into `out`. See `forwardToRef` on why both exist. */
  flatRightToRef(out: Vector3): Vector3 {
    return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  reset(yaw: number): void {
    this.yaw = yaw;
    this.pitch = 0.12;
    this.adsBlend = 0;
    // Both axes in full — the displacement, the impulse still arriving and
    // the reaction clock — or a death mid-burst finishes the last life's kick,
    // and hands the last life's permanent walk, in the first frames of the
    // next one.
    this.recoilPitch.reset();
    this.recoilYaw.reset();
    this.owedPitch = 0;
    this.owedYaw = 0;
    this.shotShake = 0;
    this.punchT = 0;
    // All three, not just the roll: `punchT` at 0 already makes them
    // unreadable, so zeroing one of a set that is written together is a
    // half-truth for whoever reads this next.
    this.punchPitch = 0;
    this.punchYaw = 0;
    this.punchRoll = 0;
    this.punchScale = 1;
    // The phase deliberately survives a respawn — it is a body breathing, not
    // a round starting, and restarting it would put every life's first aimed
    // shot at the same point of the same wander.
    this.swayPitch = 0;
    this.swayYaw = 0;
    this.swayAmount = 1;
    this.swayTarget = 1;
    this.cyclePhase = 1;
    this.cyclePitch = 0;
    this.cycleYaw = 0;
    this.bobPhase = 0;
    this.bobAmount = 0;
    this.bobTarget = 0;
    this.landDip = 0;
    this.landVel = 0;
  }

  /**
   * Absorbs a landing; called by Player with the speed the feet arrived at.
   * Scaled across the fall speeds that count as one at all, so stepping off a
   * kerb bends nothing and a drop off the chapel terrace bends everything.
   *
   * The impact sets a downward velocity rather than a displacement — a leg
   * that is already loaded does not reset when it takes a second hit — and the
   * hardest of two impacts in the same breath wins rather than summing, so a
   * bounce down a flight of steps cannot dig the eye through the floor.
   */
  land(speed: number): void {
    const l = CONFIG.camera.land;
    const t = Math.min(1, (speed - l.minSpeed) / (l.fullSpeed - l.minSpeed));
    if (t <= 0) return;
    this.landVel = Math.min(this.landVel, -l.dipSpeed * t);
  }

  /**
   * This frame's bob drive: 0 standing, 1 at full ground speed. Pushed by
   * Player (which owns the movement) before the camera updates; airborne is
   * simply zero, because feet that aren't on the ground aren't striding.
   */
  setBobDrive(speed01: number, grounded: boolean): void {
    this.bobTarget = grounded ? Math.max(0, Math.min(1, speed01)) : 0;
  }

  /**
   * How steady the player is standing, as a multiplier on the hold sway: 1 is
   * standing still, above it is moving, below it is crouched. Pushed by Player
   * (which owns the stance) for the same reason the bob drive is — the stance
   * blends are movement's, and the camera has no business re-deriving them.
   * Eased here rather than there, because it is this system's offset.
   */
  setSwayDrive(steadiness: number): void {
    this.swayTarget = Math.max(0, steadiness);
  }

  /**
   * Where the bolt is this frame, 0..1 and 1 for every weapon that has none —
   * `Player.cycleProgress`, pushed here for the reason the two drives above are
   * pushed: the clock is the fire cooldown and movement owns it, and this
   * system has no business re-deriving a gesture's phase.
   *
   * It carries no state of its own and cannot strand one. The offsets it drives
   * are recomputed from scratch every frame and are zero the moment the phase
   * returns to 1, which a swap, a death and a fresh weapon in the hands all do
   * at the source.
   */
  setCyclePhase(phase: number): void {
    this.cyclePhase = phase;
  }

  /**
   * Fires the cosmetic view punch; called once per shot, and once per blast.
   * Unlike `addRecoil` this touches nothing the bullets read — it is FOV, a
   * small backward shove, and a directed nudge on the rendered camera only.
   *
   * `drift` is the shot's own lateral, -1..+1 (`Player.kickDrift`), or the
   * bearing a blast arrived from. The punch is biased UP and toward it, with
   * noise on top, so what the view does is visibly the same event as what the
   * muzzle did rather than a second one happening at the same moment. The
   * pitch term is deliberately never negative: a weapon does not push the
   * shooter's head down.
   *
   * The roll is drawn AGAINST the drift, opposing the roll the viewmodel takes
   * (`recoil.kickRoll`). Rolled the same way the two cancel and the whole
   * picture tips instead; opposed, the weapon reads as twisting in the hands.
   *
   * `shock` scales all five terms together and is the weapon's own
   * `recoilImpulse`, compressed (`Player.punchShock`). It is PASSED rather
   * than read off the carried weapon because a blast raises a punch too, and a
   * grenade has no business being scaled by whatever is in the hands — which
   * is why this one number arrives per event while the settle spring and the
   * post-shot unsteadiness are held per weapon. Until it existed a bolt gun
   * and a submachine gun shook the frame identically.
   */
  addPunch(drift = 0, shock = 1): void {
    this.punchT = 1;
    this.punchScale = shock;
    const d = Math.max(-1, Math.min(1, drift));
    this.punchPitch = 0.6 + Math.random() * 0.4;
    this.punchYaw = d * 0.5 + (Math.random() * 2 - 1) * 0.5;
    this.punchRoll = -d * (0.7 + Math.random() * 0.3);
  }

  /**
   * Kicks the aim; called once per shot fired, with the peak radians
   * `Player.recoilKick` built.
   *
   * **It hands the settle spring a VELOCITY rather than setting a level**, the
   * same idiom and the same argument as the viewmodel's kick one layer down:
   * the rise, the peak and the slight settle below the line then come out of
   * the mechanism instead of being authored, and a round arriving on an aim
   * that has not come home adds to what is already there. What it replaced was
   * a step to full amplitude and a first-order fade from it, which gave every
   * weapon in the kit the same instantaneous attack — and nothing with mass
   * behind it moves like that.
   *
   * Each kick is still split: most of it settles out on its own, and
   * `1 - recoverFraction` of it is owed to the player's own aim and never
   * comes back, which is what actually walks the muzzle off target over a long
   * burst. **The owed share is queued rather than applied here** — see
   * `owedPitch` — so that the whole kick has a rise and not merely 70% of it.
   * The permanent part moves `yaw` too, so the character turns with it, the
   * same as any other look input.
   *
   * The third thing a shot does is disturb the shooter's POSITION, which is
   * `shotShake` and is where a heavy round is actually charged. It is raised
   * from the carried weapon's own impulse (`setSettleSpring` holds it) rather
   * than passed, because unlike the view punch this is state the shots stack
   * on and nothing but a weapon can raise it.
   */
  addRecoil(pitch: number, yaw: number): void {
    const r = CONFIG.recoil;
    const keep = 1 - r.recoverFraction;
    this.owedPitch += pitch * keep;
    this.owedYaw += yaw * keep;
    // The gain is taken for the stance the shot was FIRED in, and the bleed
    // term is the share of `owed` that will have been handed over by the time
    // the muzzle reaches the top of its travel — without it the two sum past
    // the kick the table states.
    const shape = this.shapeAt(this.adsBlend);
    const rise = shape.riseTurns / shape.grip;
    const bleed = keep * (1 - Math.exp(-this.drainRate(this.adsBlend) * rise));
    const gain = recoilGain(shape, bleed);
    this.recoilPitch.strike(pitch, gain);
    this.recoilYaw.strike(yaw, gain);
    this.shotShake = Math.min(
      r.shake.max,
      this.shotShake + r.shake.perShot * this.weaponImpulse,
    );
  }

  /**
   * A hit knocking the aim off. Called once per wound taken.
   *
   * It is on `aimPitch`/`aimYaw` rather than on the rendered camera, and that
   * is the point: a flinch you can shoot straight through is decoration. This
   * has to move where the rounds go, or being shot at costs nothing but a
   * vignette.
   *
   * **Deliberately not `addRecoil`, and the difference is the whole design.**
   * That method pushes `1 - recoverFraction` of every kick permanently into
   * `pitch`/`yaw`, because a magazine you CHOSE to empty should walk off
   * target. A hit is not a choice. At four bot rounds to a kill, a permanent
   * share would ratchet the view skyward across a single exchange and make
   * each hit likelier to be followed by another — a death spiral wearing
   * feel's clothing. So this is entirely springy.
   *
   * It rides the SAME spring rather than bringing its own, which is what
   * makes it settle on the same constants, obey the same `maxPitch`/`maxYaw`
   * ceilings so a crossfire cannot stack it off the screen, and clear itself
   * in `reset()` for free. Two springs on one aim would drift against each
   * other for exactly the reason two bob integrators would. Note the
   * consequence, which is right rather than merely tolerable: a hit taken with
   * a bolt gun in the hands rocks the view more slowly than one taken with an
   * SMG, because the spring is the SHOOTER's and the mass in their hands is
   * part of what absorbs it.
   *
   * **It hands a velocity and queues nothing**, which is how the 100%-springy
   * invariant is now stated: `owedPitch`/`owedYaw` are the only route into
   * `pitch`/`yaw`, and this method does not touch them.
   */
  addFlinch(pitch: number, yaw: number): void {
    const shape = this.shapeAt(this.adsBlend);
    const gain = recoilGain(shape);
    this.recoilPitch.strike(pitch, gain);
    this.recoilYaw.strike(yaw, gain);
  }

  /**
   * Points the camera at something that is not the player's eye, and is the
   * ONLY way that is allowed to happen.
   *
   * `DeathCam` is the one caller: once the player is down there is no eye to
   * sit at, and the body on the ground is what the frame is about. It is a
   * plain placement rather than a mode on this system because everything else
   * here — the look input, the ADS blend, the recoil, the bob, the landing
   * spring — is about a body that is still standing up, and none of it should
   * run while one is not. `update` is simply not called in that window, so no
   * state advances and the aim is exactly where it was left when the round
   * comes back.
   *
   * The roll and the FOV are written explicitly rather than left alone: both
   * are this system's own state, and a camera handed over mid-landing would
   * otherwise watch the body through a tilted, zoomed frame for four seconds.
   */
  place(eye: Vector3, target: Vector3): void {
    this.camera.position.copyFrom(eye);
    this.camera.setTarget(target);
    this.camera.rotation.z = 0;
    this.camera.fov = CONFIG.camera.fovHip;
  }

  /**
   * `eyePos` is the player's eye in world space — the camera goes there
   * outright, offset only by the cosmetic bob and punch.
   *
   * `assist` is the aim-assist frame from `AimAssistSystem` (null when
   * inactive). Its slowdown is multiplied into the stick and touch terms only
   * — the MOUSE look path is deliberately never scaled, which is that system's
   * first invariant — and its rotation is applied on top of the player's own
   * input, then clamped like any other.
   */
  update(
    dt: number,
    input: InputManager,
    eyePos: Vector3,
    assist: { stickMult: number; yaw: number; pitch: number } | null = null,
  ): void {
    const c = CONFIG.camera;

    // --- look ---
    const aiming = this.adsBlend > 0.5;
    // The player's own setting multiplies the optic's, so ADS stays the same
    // FRACTION of hip fire whatever look speed they have chosen.
    const mouseMult = (aiming ? this.sight.mouseMult : 1) * this.mouseScale;
    const stickMult = (aiming ? this.sight.stickMult : 1) * this.stickScale;
    const assistMult = assist ? assist.stickMult : 1;
    this.yaw += input.mouseLookX * c.sensX * mouseMult;
    this.pitch -= input.mouseLookY * c.sensY * mouseMult;
    this.yaw += input.stickLookX * c.stickSensX * stickMult * assistMult * dt;
    this.pitch -= input.stickLookY * c.stickSensY * stickMult * assistMult * dt;
    // The touch drag. No `dt`: it is a delta the finger already made, the same
    // as the mouse's, so the frame rate is in the size of it rather than in a
    // rate to be integrated. It takes the OPTIC's per-pixel multiplier for the
    // same reason — a scoped drag has to cover fewer radians per pixel, which
    // is what `mouseMult` means — and unlike the mouse it takes the assist's
    // slowdown, because a thumb has none of a mouse's precision to trade away.
    const touchMult =
      (aiming ? this.sight.mouseMult : 1) * this.touchScale * assistMult;
    this.yaw += input.touchLookX * CONFIG.touch.lookSensX * touchMult;
    this.pitch -= input.touchLookY * CONFIG.touch.lookSensY * touchMult;
    if (assist) {
      this.yaw += assist.yaw;
      this.pitch += assist.pitch;
    }
    this.pitch = Math.max(c.pitchMin, Math.min(c.pitchMax, this.pitch));

    // --- recoil comes back toward the player's own aim ---
    // An ARREST and a HAUL, not a spring. `core/recoilCurve.ts` carries the
    // argument; what it buys here is a shape with a CORNER in it — a fast
    // flattening rise while the grip stops the gun, then a straight descent
    // while the shooter drags it back — where a spring's peak is smooth and
    // symmetric and reads as animation. The stance picks the constants rather
    // than an amplitude, because a weapon in a three-point lock and a weapon
    // on two arms are two mechanical systems and not one at two volumes.
    const rec = CONFIG.recoil;
    const shape = this.shapeAt(this.adsBlend);
    // The permanent share is handed over at the haul's own rate, so all of it
    // has arrived by the time the muzzle is home and none of it before the
    // muzzle has moved. It is drained rather than applied at the shot because
    // 30% of a kick landing on one frame is the step function this model
    // exists to remove. Before the clamp below, which is `pitch`'s.
    if (this.owedPitch !== 0 || this.owedYaw !== 0) {
      const give = 1 - Math.exp(-this.drainRate(this.adsBlend) * dt);
      const dp = this.owedPitch * give;
      const dy = this.owedYaw * give;
      this.pitch = Math.max(c.pitchMin, Math.min(c.pitchMax, this.pitch + dp));
      this.yaw += dy;
      this.owedPitch -= dp;
      this.owedYaw -= dy;
      if (Math.abs(this.owedPitch) < 1e-7) this.owedPitch = 0;
      if (Math.abs(this.owedYaw) < 1e-7) this.owedYaw = 0;
    }
    this.recoilPitch.step(dt, shape);
    this.recoilYaw.step(dt, shape);
    // The ceilings are on the DISPLACEMENT, as they always were: sustained
    // fire must not walk the recoverable part off the screen and a crossfire's
    // flinches must not stack off it either. Under this model they bind later
    // and mean more than they did — a spring's peak was bounded by its own
    // damping, where an arrest that is out-run by a fast string genuinely
    // keeps climbing.
    if (this.recoilPitch.value > rec.maxPitch) this.recoilPitch.value = rec.maxPitch;
    if (this.recoilYaw.value > rec.maxYaw) this.recoilYaw.value = rec.maxYaw;
    else if (this.recoilYaw.value < -rec.maxYaw) this.recoilYaw.value = -rec.maxYaw;

    // --- the shooter's position settles (the other half of a heavy round) ---
    // A true exponential for the reason above: it is on the hold sway, which
    // is on the aim. It fades toward the breathing wander rather than toward
    // stillness — the sway is what it is disturbing, not what it replaces —
    // and on the WEAPON's own time constant, because a heavy round does not
    // merely disturb more, it disturbs for longer. That is also what keeps the
    // four automatics distinct: they all pile shake up faster than it fades,
    // so what separates a submachine gun from a belt-fed gun on a held trigger
    // is where the pile-up balances and not the ceiling it would share.
    if (this.shotShake !== 0) {
      this.shotShake *= Math.exp(-dt / this.shakeSettle);
      if (this.shotShake < 1e-4) this.shotShake = 0;
    }

    // --- view punch decays (cosmetic — safe to use a plain time decay) ---
    this.punchT = Math.max(0, this.punchT - dt / CONFIG.recoil.punchTime);

    // --- landing absorb settles (semi-implicit Euler on a damped spring) ---
    // Velocity first, then position off the NEW velocity. The other way round
    // is explicit Euler, which gains energy every step and rings instead of
    // settling — on a spring the eye sits in, that is nausea. dt is
    // clamped to 0.05 upstream, which keeps `omega * dt` well inside stability
    // at these frequencies.
    const l = CONFIG.camera.land;
    if (this.landDip !== 0 || this.landVel !== 0) {
      const w = Math.PI * 2 * l.frequency;
      this.landVel +=
        (-w * w * this.landDip - 2 * l.damping * w * this.landVel) * dt;
      this.landDip += this.landVel * dt;
      // Park it exactly, so the eye and the weapon both stop reading a
      // micrometre of sag for the rest of the round.
      if (Math.abs(this.landDip) < 1e-4 && Math.abs(this.landVel) < 1e-3) {
        this.landDip = 0;
        this.landVel = 0;
      }
    }

    // --- ADS blend (exponential ease toward target) ---
    const target = input.ads ? 1 : 0;
    this.adsBlend +=
      (target - this.adsBlend) *
      Math.min(1, dt * this.sight.blendSpeed * this.weaponAdsMult);
    const t = hermite(this.adsBlend);

    // --- hold sway: the wander of an aimed weapon ---
    // Two sines per axis. The pitch term is the breath and the yaw term runs
    // at half its rate, which is what draws the slow figure-eight instead of a
    // diagonal; the smaller pair, at 2.5x and 3.5x the breath, is what keeps
    // it from reading as a machine tracing the same loop. Every multiplier is
    // a half-integer of the phase, so all four are continuous where it wraps.
    //
    // It is scaled by the ADS blend, so it eases in with the sight and hip
    // fire is left exactly as it was. This is an offset ON TOP of the player's
    // aim, never integrated into `pitch`/`yaw`: it has to average out to where
    // they were pointing, or a held aim would simply drift away.
    //
    // A shot DISTURBS that wander and the disturbance is spent here rather
    // than as an offset of its own, for the reason the bolt cycle's wobble is:
    // this is already an honest disturbance of where the rifle POINTS, so
    // widening it cannot make the reticle lie. It both widens the loop and
    // QUICKENS it — a disturbed position is restless as well as loose, and a
    // 0.23 Hz breath multiplied by two says nothing inside the second it takes
    // to fade. Riding `swayW` also means bracing steadies the disturbance
    // exactly as it steadies the hold, and hip fire pays none of it.
    const sw = c.aimSway;
    const shake = this.shotShake;
    this.swayAmount +=
      (this.swayTarget - this.swayAmount) * Math.min(1, dt * sw.smooth);
    this.swayPhase =
      (this.swayPhase +
        Math.PI * 2 * sw.rate * (1 + shake * rec.shake.rateGain) * dt) %
      (Math.PI * 4);
    const b = this.swayPhase;
    const swayW =
      t *
      this.swayAmount *
      this.weaponSwayMult *
      (1 + shake * rec.shake.swayGain);
    this.swayPitch =
      sw.pitch * (Math.sin(b) + 0.28 * Math.sin(b * 2.5 + 0.6)) * swayW;
    this.swayYaw =
      sw.yaw * (Math.sin(b * 0.5 + 1) + 0.22 * Math.sin(b * 3.5 + 2.4)) * swayW;

    // --- the bolt cycle, spent on the hold instead of on the picture ---
    // The hold sway's sibling and its opposite number: that one is a wander
    // with no cause, this one is a cause with no wander. A bolt is worked with
    // the scope still on the eye, so the rifle may not move (`ViewModel` takes
    // the roll to nothing across this same blend) and what a hand hauling a
    // bolt back and slamming it home actually disturbs is the thing left —
    // where the rifle is POINTED. The reticle stays on the axis and the world
    // swings behind it, which is the only version of this that does not make
    // the sight lie.
    //
    // Three terms over the phase, and every one of them is exactly zero at
    // both ends of it: the arc of the bolt's own travel, and the two impacts
    // at the ends of that travel, on the same beats and the same shape as the
    // jolts `ViewModel` lays on the weapon at the hip. One event, one clock,
    // two places it can be spent.
    //
    // Scaled by the ADS blend, so the hip keeps the roll and pays none of
    // this, and by the same eased stance weight the sway runs on, so crouching
    // steadies a cycle exactly as it steadies a hold. Neither is a new number.
    const cyc = CONFIG.viewmodel.cycle;
    if (this.cyclePhase < 1) {
      const wob = cyc.wobble;
      const ph = this.cyclePhase;
      const drift =
        smoothstep(cyc.lift, cyc.back, ph) - smoothstep(cyc.back, cyc.home, ph);
      const stop = impulse(ph, cyc.back, wob.kickFall);
      const home = impulse(ph, cyc.home, wob.kickFall);
      const cw = t * this.swayAmount;
      this.cyclePitch =
        cw *
        (wob.drift.pitch * drift +
          wob.stop.pitch * stop +
          wob.home.pitch * home);
      this.cycleYaw =
        cw *
        (wob.drift.yaw * drift + wob.stop.yaw * stop + wob.home.yaw * home);
    } else if (this.cyclePitch !== 0 || this.cycleYaw !== 0) {
      this.cyclePitch = 0;
      this.cycleYaw = 0;
    }

    // --- head bob: phase advances with travel, amplitude eases with intent ---
    this.bobAmount +=
      (this.bobTarget - this.bobAmount) * Math.min(1, dt * c.bobSmooth);
    this.bobPhase = (this.bobPhase + dt * c.bobRate * this.bobAmount) % (Math.PI * 2);
    const bobW = this.bobAmount * (1 - (1 - c.bobAdsMult) * t);

    // --- position: the eye, plus the two cosmetic offsets ---
    const dir = this.forward;
    this.eye.copyFrom(eyePos);
    if (bobW > 0.001) {
      // Vertical at twice the lateral rate: one dip per footfall, one sway
      // per stride. The lateral term rides the flat right axis so it stays
      // level with the horizon when looking up or down.
      const right = this.flatRight;
      this.eye.y += Math.sin(this.bobPhase * 2) * c.bobVertical * bobW;
      this.eye.addInPlace(
        right.scale(Math.sin(this.bobPhase) * c.bobLateral * bobW),
      );
    }
    // The eye sinks with the knees. Translation only — a metre of drop is a
    // metre of parallax and nothing else, so the bullets are untouched.
    this.eye.y += this.landDip;
    const r = CONFIG.recoil;
    const punch = this.punchT * this.punchT * this.punchScale;
    if (punch > 0) {
      this.eye.subtractInPlace(dir.scale(r.camPush * punch));
    }

    // The nod and the roll are what make the absorb read as a body arriving
    // rather than as the floor moving: the chin drops toward the impact and
    // the weight comes down on one side. Both are damped while aiming, the
    // same bargain the bob makes — a braced shooter absorbs with the legs, and
    // it is only the ROTATIONAL part that swings the picture off the rounds
    // (which fly along the un-nodded `forward`, like every other cosmetic
    // here). The dip itself is left alone; knees bend whether or not you are
    // looking through a sight.
    const swing = this.landDip * (1 - (1 - l.adsMult) * t);
    const nod = swing * l.nod;

    this.camera.position.copyFrom(this.eye);
    if (punch > 0 || nod !== 0) {
      const shPitch = this.punchPitch * r.shakePitch * punch;
      const shYaw = this.punchYaw * r.shakeYaw * punch;
      const sp = this.aimPitch + shPitch + nod;
      const sy = this.aimYaw + shYaw;
      const cp = Math.cos(sp);
      this.camera.setTarget(
        this.eye.add(
          new Vector3(cp * Math.sin(sy), Math.sin(sp), cp * Math.cos(sy)),
        ),
      );
    } else {
      this.camera.setTarget(this.eye.add(dir));
    }
    // Roll goes on AFTER the target: `setTarget` writes yaw and pitch out of
    // the direction and never touches z, so this is the one axis the camera
    // keeps of its own. It is still the only place anything writes it — two
    // contributors now, but one assignment, because a second write site is how
    // a roll ends up being whichever of them ran last.
    this.camera.rotation.z = swing * l.roll + this.punchRoll * r.shakeRoll * punch;
    this.camera.fov =
      c.fovHip + (this.sight.fovAds - c.fovHip) * t + r.fovPunch * punch;
  }
}
