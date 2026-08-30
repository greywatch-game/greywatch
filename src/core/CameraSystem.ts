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
 * The aimed hold sway is the ONE exception, and deliberately so: it is part of
 * aimPitch/aimYaw, because the weapon hangs off this camera and a sight
 * picture that drifts while the rounds fly down an undrifted axis is a reticle
 * that lies. See CONFIG.camera.aimSway.
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
import { hermite } from "./math";
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
   * The springy part of the recoil, stacked on top of the player's own aim
   * and decaying back to zero. The rest of each kick goes straight into
   * `pitch`/`yaw` and stays there — see `addRecoil`.
   */
  private recoilPitch = 0;
  private recoilYaw = 0;
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
    return this.pitch + this.recoilPitch + this.swayPitch;
  }

  get aimYaw(): number {
    return this.yaw + this.recoilYaw + this.swayYaw;
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
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.punchT = 0;
    // All three, not just the roll: `punchT` at 0 already makes them
    // unreadable, so zeroing one of a set that is written together is a
    // half-truth for whoever reads this next.
    this.punchPitch = 0;
    this.punchYaw = 0;
    this.punchRoll = 0;
    // The phase deliberately survives a respawn — it is a body breathing, not
    // a round starting, and restarting it would put every life's first aimed
    // shot at the same point of the same wander.
    this.swayPitch = 0;
    this.swayYaw = 0;
    this.swayAmount = 1;
    this.swayTarget = 1;
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
   */
  addPunch(drift = 0): void {
    this.punchT = 1;
    const d = Math.max(-1, Math.min(1, drift));
    this.punchPitch = 0.6 + Math.random() * 0.4;
    this.punchYaw = d * 0.5 + (Math.random() * 2 - 1) * 0.5;
    this.punchRoll = -d * (0.7 + Math.random() * 0.3);
  }

  /**
   * Kicks the aim; called once per shot fired. Each kick is split: most of it
   * springs back on its own, but `1 - recoverFraction` of it is added to the
   * player's own aim and never comes back, which is what actually walks the
   * muzzle off target over a long burst. The permanent part moves `yaw` too,
   * so the character turns with it — the same as any other look input.
   */
  addRecoil(pitch: number, yaw: number): void {
    const r = CONFIG.recoil;
    const keep = 1 - r.recoverFraction;
    this.pitch += pitch * keep;
    this.yaw += yaw * keep;
    this.recoilPitch = Math.min(
      r.maxPitch,
      this.recoilPitch + pitch * r.recoverFraction,
    );
    this.recoilYaw = Math.max(
      -r.maxYaw,
      Math.min(r.maxYaw, this.recoilYaw + yaw * r.recoverFraction),
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
   * makes it recover on the same true exponential, obey the same
   * `maxPitch`/`maxYaw` ceilings so a crossfire cannot stack it off the
   * screen, and clear itself in `reset()` for free. Two springs on one aim
   * would drift against each other for exactly the reason two bob
   * integrators would.
   */
  addFlinch(pitch: number, yaw: number): void {
    const r = CONFIG.recoil;
    this.recoilPitch = Math.min(r.maxPitch, this.recoilPitch + pitch);
    this.recoilYaw = Math.max(
      -r.maxYaw,
      Math.min(r.maxYaw, this.recoilYaw + yaw),
    );
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

    // --- recoil settles back toward the player's own aim ---
    // A true exponential, not the frame-lerp used for the cosmetic blends:
    // this one moves where the bullets go, so how high a burst climbs must
    // not depend on the frame rate.
    const settle = Math.exp(-CONFIG.recoil.recovery * dt);
    this.recoilPitch *= settle;
    this.recoilYaw *= settle;

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
    const sw = c.aimSway;
    this.swayAmount +=
      (this.swayTarget - this.swayAmount) * Math.min(1, dt * sw.smooth);
    this.swayPhase =
      (this.swayPhase + Math.PI * 2 * sw.rate * dt) % (Math.PI * 4);
    const b = this.swayPhase;
    const swayW = t * this.swayAmount * this.weaponSwayMult;
    this.swayPitch =
      sw.pitch * (Math.sin(b) + 0.28 * Math.sin(b * 2.5 + 0.6)) * swayW;
    this.swayYaw =
      sw.yaw * (Math.sin(b * 0.5 + 1) + 0.22 * Math.sin(b * 3.5 + 2.4)) * swayW;

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
    const punch = this.punchT * this.punchT;
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
