/**
 * Sfx.ts — All audio: synthesized WebAudio, zero asset files.
 * Owns: the AudioContext, one cached noise buffer shared by every shot, one
 * shared convolution reverb every gunshot sends into, a master soft clip, the
 * voice cap (CONFIG.audio.maxVoices — over-cap sounds are skipped silently),
 * and positional panning relative to the listener.
 * Invariants: never generate a fresh noise buffer or impulse response per
 * sound — both are built once on unlock. setListener() is called once per
 * frame by Game, after the camera update. Firefox needs the legacy
 * setPosition/setOrientation path — keep both. Nothing here schedules a
 * repeating sound: footsteps are one-shots fired by the caller's own gait
 * phase (the camera's bob, a bot's walk cycle), never by a timer in here.
 * There is ONE sustained voice and it is not a counter-example: the driven
 * vehicle's engine (`engineOn`/`engineDrive`/`engineOff`) is a single source
 * held open between a mount and a dismount, not a timer firing one-shots. It
 * is unpanned and uncapped for the reason the player's own report is, and it
 * stops with the audio clock like everything else.
 */
import type { Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { ReportVoice } from "../entities/weapons";

/**
 * How far past full scale the master soft clip stays roughly linear. 3 lets a
 * firefight stack three simultaneous full-level sounds before the curve bends
 * enough to hear, and saturates rather than clipping past that.
 */
const SOFT_CLIP_DRIVE = 3;

/**
 * What a shooter with no weapon of its own is heard as.
 *
 * Not a fallback: every bot in the game carries the same rifle on its rig
 * (`SoldierModel`'s `bot-rifle`) and fires the one flat round `CONFIG.bots`
 * describes, so this is the weapon in its hands. It is also the identity
 * voice — every field of the rifle's row is 1, because that row IS the
 * reference report `shoot` is written around — which is why naming the rifle
 * here and meaning "no deviation" are the same statement rather than two that
 * can drift apart.
 */
const FLAT_REPORT: ReportVoice = CONFIG.weapons.rifle.report;

/**
 * Procedural sound effects via WebAudio — no audio assets.
 *
 * Three things here exist because of the jump from a twelve-enemy arena to a
 * thirty-two-bot battlefield:
 *
 * - **One cached noise buffer.** Filling a fresh `AudioBuffer` per shot meant
 *   ~1,900 `Math.random()` calls each time; with a full firefight that was
 *   hundreds of buffer allocations a second on the main thread. Now a single
 *   one-second buffer is generated on unlock and every burst plays a random
 *   slice of it.
 * - **Positional playback.** A distant firefight has to sit behind you rather
 *   than in your ear, so world-space sounds run through a `PannerNode` with
 *   distance rolloff and are dropped entirely past `maxDistance`.
 * - **A voice cap.** Sixteen bots at five rounds a second is ~80 gunshots
 *   a second. Beyond `maxVoices` concurrent one-shots, new ones are skipped —
 *   the ear cannot pick them apart anyway, and the scheduler can't keep up.
 *
 * **Gunfire is noise, not tone.** Every layer of a shot is a filtered slice of
 * the shared noise buffer; the single pitched oscillator left in a report is
 * the low chest thump, which genuinely is one frequency. An oscillator at any
 * audible pitch reads as a beep however it is enveloped, and that — more than
 * spectrum or envelope — is what made synthesized gunfire sound like a toy.
 *
 * **The tail is the reverb, not the shot.** Outdoors, a rifle is a two
 * millisecond transient followed by a quarter second of the village answering
 * it. That answer is one shared `ConvolverNode` on a send, so it costs nothing
 * per shot and, crucially, is not a voice: eighty shots a second all decay
 * through the same bus instead of eighty tail voices fighting over the cap.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /**
   * The driven vehicle's engine — the one held-open voice in this file. Null
   * whenever the player is on foot. See `engineOn`.
   */
  private engineSrc: AudioBufferSourceNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private listener: AudioListener | null = null;
  /** Reused by every `burst()` call; built once on unlock. */
  private noiseBuffer: AudioBuffer | null = null;
  /** The shared environment reverb every gunshot sends into. */
  private reverb: ConvolverNode | null = null;
  /** Currently-playing one-shots, for the voice cap. */
  private voices = 0;
  /** True while the game is paused and the context is suspended. */
  private paused = false;
  /** Last listener position, for propagation delay and air absorption. */
  private lx = 0;
  private ly = 0;
  private lz = 0;
  /** Audio-clock time of the last impact, for that method's own rate limit. */
  private lastImpact = 0;

  unlock(): void {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = 1;
        // A firefight sums twenty-odd voices, and un-limited that is digital
        // clipping — the crackle reads as a broken speaker, not as loud.
        //
        // This is a **static soft clip, deliberately not a
        // `DynamicsCompressor`.** Measured: Chrome's compressor took a shot's
        // 0.45 transient down to 0.07, and — because its detector barely
        // engages on an isolated click — left a reload louder than the rifle
        // that needed it. Any envelope follower has that failure mode against
        // impulsive material: it ducks the very leading edge that makes a
        // gunshot sound like one. A `tanh` curve has no time constants at all,
        // so anything below saturation passes at exactly unity and only the
        // sums that would have clipped are bent.
        const clip = this.ctx.createWaveShaper();
        const curve = new Float32Array(1024);
        for (let i = 0; i < curve.length; i++) {
          const u = (i / (curve.length - 1)) * 2 - 1;
          curve[i] = Math.tanh(u * SOFT_CLIP_DRIVE);
        }
        clip.curve = curve;
        clip.oversample = "4x";
        // The pre-gain maps ±SOFT_CLIP_DRIVE of input across the curve, which
        // is what makes the small-signal slope unity.
        const pre = this.ctx.createGain();
        pre.gain.value = 1 / SOFT_CLIP_DRIVE;
        this.master.connect(pre).connect(clip).connect(this.ctx.destination);
        // The reverb is a send: dry stays at full level and wet is mixed in
        // alongside it, joining the dry path at the soft clip so the two are
        // saturated together rather than separately.
        this.reverb = this.ctx.createConvolver();
        const wet = this.ctx.createGain();
        wet.gain.value = CONFIG.audio.reverbMix;
        this.reverb.connect(wet).connect(pre);
        this.listener = this.ctx.listener;
        this.buildNoiseBuffer();
        this.buildImpulse();
      } catch {
        this.ctx = null;
      }
    }
    if (this.ctx && this.ctx.state === "suspended" && !this.paused) {
      void this.ctx.resume();
    }
  }

  /**
   * Freezes or thaws the whole graph — an OFFLINE pause menu, and nothing
   * else. A networked round is still being played by everybody else and is
   * still sounding off the wire while its card is up, so `Game.pause` leaves
   * this alone there: a stopped clock would neither play those nor let them
   * end, and they would all arrive together on the resume.
   *
   * Suspending the context rather than muting a gain is what makes this
   * correct for free: anything already scheduled (the tail of the shot that
   * was in the air, a reload two clacks in) stops where it is and carries on
   * from there, and the `voices` counter stays honest because nothing ends
   * while the clock is stopped.
   *
   * The flag is also what stops `unlock()` from thawing it behind our back:
   * the click on the pause menu is a pointer gesture like any other, and Game
   * unlocks audio on every one of those.
   */
  setSuspended(on: boolean): void {
    if (this.paused === on) return;
    this.paused = on;
    if (!this.ctx) return;
    void (on ? this.ctx.suspend() : this.ctx.resume());
  }

  /**
   * Points the audio listener at the camera. Called once per frame, after the
   * camera has moved — same ordering rule as the lighting and fog uniforms.
   */
  setListener(position: Vector3, forward: Vector3): void {
    const l = this.listener;
    if (!l || !this.ctx) return;
    this.lx = position.x;
    this.ly = position.y;
    this.lz = position.z;
    const t = this.ctx.currentTime;
    // Firefox still only implements the deprecated setters.
    if (l.positionX) {
      l.positionX.setValueAtTime(position.x, t);
      l.positionY.setValueAtTime(position.y, t);
      l.positionZ.setValueAtTime(position.z, t);
      l.forwardX.setValueAtTime(forward.x, t);
      l.forwardY.setValueAtTime(forward.y, t);
      l.forwardZ.setValueAtTime(forward.z, t);
      l.upX.setValueAtTime(0, t);
      l.upY.setValueAtTime(1, t);
      l.upZ.setValueAtTime(0, t);
    } else {
      (l as unknown as { setPosition(x: number, y: number, z: number): void })
        .setPosition(position.x, position.y, position.z);
      (l as unknown as {
        setOrientation(...a: number[]): void;
      }).setOrientation(forward.x, forward.y, forward.z, 0, 1, 0);
    }
  }

  // --- player-local one-shots (always 2D, always audible) ---

  /**
   * The player's own weapon, at the player's own ear. Five layers plus the
   * shared reverb, in the order the ear resolves them: the snap of the shock
   * front, the body of the report, a low roll under it, the chest thump, and
   * the action cycling a beat later.
   *
   * **This method owns the SHAPE of a gunshot and the weapon owns nothing but
   * deviations from it** (`ReportVoice`, tabled in `CONFIG.weapons[id].report`
   * with what each field means). That split is the same one `recoilMult` makes
   * against `CONFIG.recoil`, and it is what the six guns sounding identical
   * cost: the only thing a weapon could say used to be `sfxPitch`, one
   * multiplier over every frequency, which can make a big gun a small gun
   * slowed down and nothing else. How much charge is behind the round, how
   * long the report rings, how hard it drives the village and how loud the
   * mechanism is against the shot are what actually separate an SMG from a
   * DMR, and none of them had anywhere to be said.
   *
   * **The two low layers are where "heavy" lives, and they are separate on
   * purpose.** The roll is broadband noise under a resonant lowpass — the gas
   * column, which has no pitch — and the thump is the one pitched oscillator
   * this class allows itself, because the pressure pulse genuinely is a single
   * frequency. Either alone is thin: noise without the sine is a rumble with
   * no centre, and the sine without the noise is a kick drum. The roll's raw
   * gain looks enormous beside the others and is not — a lowpass at 360 Hz
   * throws away all but about a tenth of a noise slice's amplitude, the same
   * arithmetic the body layer and every footstep in here are written against.
   *
   * **These five layers are the one sound in the game exempt from the voice
   * cap** (`keep`), and it is the impact reserve's argument taken one step
   * further. The cap is first-come-first-served, so the firefight loud enough
   * to spend it is exactly the moment the player's own weapon would come out
   * thin — the roll, the thump and the action are scheduled last and would be
   * the three dropped, which is to say the gun would lose its bottom end
   * precisely when it is being fired in anger. The exemption is bounded by
   * construction rather than by trust: ONE shooter, five layers, and a rate the
   * weapon table caps. Computed over every weapon's whole magazine held down,
   * the worst case is TEN — the carbine, whose three rounds inside 0.1 s stack
   * deeper than the LMG's nine or the rifle's seven — against a cap of 24 with
   * 6 of those already reserved from impacts. They are still COUNTED, so
   * everything else still yields to them.
   */
  shoot(voice: ReportVoice = FLAT_REPORT): void {
    // Two rounds from the same weapon are never the same report, and eight a
    // second of one recording is the loudest tell that a gun is synthesized.
    const v = 0.92 + Math.random() * 0.16;
    const f = v * voice.pitch;
    const lvl = voice.level;
    // How long the report rings on. Scales the three layers that have a decay
    // worth the name; the snap has none and the action is a click.
    const len = voice.length;
    const tail = voice.tail;
    // The snap: the shock front, above 3.6 kHz, over in seven milliseconds.
    // This is the layer that reads as violent rather than as loud, and it is
    // why the DMR is not just the rifle an octave down — it has the deepest
    // body here AND the sharpest edge.
    this.burst({
      dur: 0.007, vol: 0.68 * v * lvl * voice.snap, type: "highpass",
      freq: 3600 * f, q: 1, send: 0.2 * tail, keep: true,
    });
    // The body of the report, sweeping down as the gas column collapses. A
    // lowpass throws away most of a noise slice's amplitude, so its gain is
    // set well above the level it actually plays at.
    this.burst({
      dur: 0.1 * len, vol: 0.74 * lvl, type: "lowpass", freq: 2600 * f,
      freqEnd: 340 * voice.pitch, send: 0.9 * tail, keep: true,
    });
    // The low roll: the gas leaving the muzzle, under a lowpass with enough
    // resonance to put a peak where a small speaker can still find it. Sent
    // hardest of the five, because outdoors the low end of a shot is mostly
    // the village answering it.
    this.burst({
      dur: 0.26 * len, vol: 1.75 * lvl * voice.weight, type: "lowpass",
      freq: 360 * voice.pitch, freqEnd: 95 * voice.pitch, q: 3,
      send: 1.2 * tail, keep: true,
    });
    // Chest thump: the low pressure wave, and the one part of a gunshot that
    // really is a single frequency. A sine's peak is its gain exactly.
    this.tone(150 * f, 0.16 * len, "sine", 0.32 * lvl * voice.weight, 0.34, null, {
      send: 0.7 * tail, keep: true,
    });
    // The action riding home, behind the shot rather than under it — mechanism,
    // so it sits far below the blast. A light bolt comes back sooner as well as
    // higher, which is why the delay is divided by the same number that pitches
    // it: the SMG's is thirty milliseconds and the LMG's is sixty-six.
    this.burst({
      dur: 0.04, vol: 0.18 * lvl * voice.actionVol, type: "bandpass",
      freq: 2900 * voice.actionPitch, q: 1.3,
      delay: 0.045 / voice.actionPitch, send: 0.25 * tail, keep: true,
    });
  }

  /** Hitmarker: a chunky two-part "thock", not a beep. */
  hit(): void {
    this.tone(520, 0.05, "square", 0.07, 0.7);
    this.burst({ dur: 0.025, vol: 0.12 });
  }

  /**
   * The headshot. Higher and cleaner than `hit()` and built the opposite way:
   * where the body hit is a square wave and a noise slice — deliberately
   * blunt, a thing striking a thing — this is two sines an octave apart with
   * the upper one late, which has no noise in it at all and so cuts through a
   * burst of ordinary markers instead of merging into them.
   *
   * That separation is the whole job. A headshot at full auto is worth nothing
   * as feedback if it sounds like the shots either side of it, and the marker
   * cannot carry it alone: `flashHitmarker` lets a kill outrank a head hit on
   * screen precisely because the ear is where this read lands.
   *
   * Both layers are brief and unsent — a headshot is confirmation, and giving
   * it a tail would put it in the same space as the report that caused it.
   */
  headshot(): void {
    this.tone(1180, 0.055, "sine", 0.085, 1);
    this.tone(2360, 0.09, "sine", 0.05, 1, null, { delay: 0.03 });
    this.burst({ dur: 0.018, vol: 0.06, type: "highpass", freq: 4200, q: 0.7 });
  }

  /**
   * A round cracking past the player's head. Not a hit and not a hit sound —
   * the supersonic N-wave, which arrives *before* the report of the rifle that
   * fired it and is the only thing that tells you you are being shot at rather
   * than shot near. Wired from `CombatSystem.onNearMiss` for the player only.
   */
  nearMiss(at: Vector3): void {
    const v = 0.9 + Math.random() * 0.2;
    // Panned from the point of closest approach, so the crack says WHICH SIDE
    // as well as "you are being shot at" — which is the difference between a
    // cue you can act on and one that only raises your pulse. It was mono for
    // as long as it existed, and it is the most urgent sound in the game.
    const panner = this.panner(at);
    this.burst({
      dur: 0.02, vol: 0.5, type: "bandpass", freq: 3400 * v, freqEnd: 1100,
      // No propagation delay, and that is the entire point of the N-wave: it
      // arrives BEFORE the report of the rifle that sent it. The point is
      // inside 1.9 m (`hitRadius` + `suppressRadius`) anyway, where the delay
      // would be five milliseconds. Send is small for the same reason — a
      // crack past your head is direct sound, not the valley answering.
      q: 0.9, send: 0.15, out: panner,
    });
  }

  enemyDie(): void {
    this.tone(300, 0.25, "sawtooth", 0.06, 0.3);
  }

  playerHurt(): void {
    this.tone(110, 0.2, "sawtooth", 0.08, 0.7);
  }

  /**
   * Working the magazine: catch, magazine out, fresh magazine seated, bolt
   * released. Four metallic clicks rather than two beeps, and spaced across
   * the *actual* reload so the animation's end lands on the bolt rather than
   * on silence — which is why the offsets are fractions of the config value
   * and not absolute times.
   *
   * **The weapon's own mechanism voices them** (`ReportVoice.actionPitch` and
   * `actionVol`, the same pair that pitches the action inside `shoot`), so a
   * belt going into an LMG and a magazine going into a pistol are not one
   * sound at two speeds. The TIMING is untouched by it: those four fractions
   * are keyed to `ViewModel`'s reload beats to the frame, and a change to one
   * is a change to the other — see `docs/weapons.md`.
   */
  reload(duration: number, voice: ReportVoice = FLAT_REPORT): void {
    const t = duration;
    const p = voice.actionPitch;
    const g = voice.actionVol;
    this.clack(2600 * p, 0.9 * g, 0);
    this.clack(1500 * p, 0.5 * g, t * 0.18);
    this.clack(760 * p, 1 * g, t * 0.55);
    this.clack(3400 * p, 0.8 * g, t * 0.8);
  }

  /**
   * Swapping weapons: one goes onto the sling, the other comes off it.
   *
   * Two events rather than a rummage, and they are placed where the hands
   * actually are — the first on the button, the second at the point the
   * viewmodel exchanges the models — so the sound tells you how far through
   * the wait you are, which on a swap is the only thing you want to know. The
   * second is the brighter of the two: a weapon coming up is what the player
   * is waiting for, and the sound that says "you can shoot" should be the one
   * that carries.
   */
  swap(duration: number): void {
    this.clack(900, 0.55, 0);
    this.clack(2200, 0.7, duration * 0.45);
  }

  /**
   * A grenade leaving the hand: the pin and lever going, then the cloth of the
   * throw. Player-local — bots' throws are deliberately silent, because the
   * one cue that matters for an incoming grenade is the blinking pip on the
   * thing itself, and sixteen bots' worth of throw noise would bury it.
   */
  grenadeThrow(): void {
    this.clack(3200, 0.55, 0);
    this.burst({
      dur: 0.13, vol: 0.1, type: "bandpass", freq: 800, freqEnd: 1900,
      q: 0.9, delay: 0.06, send: 0.15,
    });
  }


  /**
   * A rocket leaving a launcher: the motor lighting, the tube's own crack, and
   * the whoosh trailing away behind it.
   *
   * `cannon` reasoned about from the other end. A tank gun is a slam with a
   * long roll under it because a shell is pushed by a charge that is over
   * before the round leaves; a launcher is the opposite shape — a soft leading
   * edge, then a hiss that keeps going, because the motor is still burning
   * after the thing has gone. What the two share is the low body, which is why
   * this is here beside it rather than shaped out of `CONFIG.weapons`'
   * `ReportVoice`: an eight-scalar deviation from a rifle cannot describe a
   * sound whose loudest part arrives after the shot.
   *
   * Spatialised like every other weapon, and audible as far as a cannon is:
   * the point of a launcher on the map is that the crew knows there is one.
   */
  launcher(at: Vector3): void {
    const a = CONFIG.audio;
    const dist = this.distanceToListener(at);
    if (dist > a.maxDistance * 2.2) return;
    const panner = this.panner(at);
    if (!panner) return;
    const far = Math.min(1, dist / (a.maxDistance * 1.4));
    const delay = dist / a.speedOfSound;
    const v = 0.94 + Math.random() * 0.12;
    // The ignition: broadband, and softer at the front than a gun's, because
    // nothing here is a sealed breech letting go.
    this.burst({
      dur: 0.09, vol: 0.7 * (1 - far * 0.6), type: "highpass",
      freq: (900 - 600 * far) * v, q: 0.5, delay, out: panner, send: 0.6,
    });
    // The body: the backblast off the venturi, sweeping down as it spreads.
    this.burst({
      dur: 0.5 + far * 0.3, vol: 0.9, type: "lowpass",
      freq: 620 - 400 * far, freqEnd: 70, delay, out: panner, send: 1.4,
    });
    // The chest of it. Higher and shorter than a cannon's — a shoulder tube,
    // not a hundred and twenty millimetres.
    this.tone(38 * v, 0.36, "sine", 0.4 * (1 - far * 0.45), 0.55, panner, {
      delay, send: 0.7,
    });
    // The motor going away, which is the layer that says ROCKET. It starts
    // under the launch and outlives it, and it climbs rather than falling:
    // everything else here is a pressure wave spreading, and this is a thing
    // receding, so it is the one layer whose filter sweeps UP.
    this.burst({
      dur: 0.62, vol: 0.3 * (1 - far * 0.5), type: "bandpass",
      freq: 700 * v, freqEnd: 2600, q: 0.8, delay: delay + 0.05, out: panner,
      send: 0.5,
    });
  }

  /**
   * Loading a launcher: the next rocket coming out of the bag, tapped onto the
   * mouth of the tube, driven home, and the hammer thumbed back.
   *
   * `reload` reasoned about from the other end, and the differences are all the
   * same difference — this is a MUZZLE load. There is no catch and no magazine
   * falling free, because nothing was released; the first thing you hear is
   * webbing, because the round has to be fetched. The last thing is the hammer
   * rather than a bolt, and it is the one that matters: an RPG is cocked by
   * hand, so the cock IS the sound that says the weapon will fire.
   *
   * Player-local and unspatialised like the grenade's throw and the mine's
   * plate: it is a thing happening in your own hands. What somebody else's
   * launcher is heard as is `launcher`, and nothing between.
   *
   * **The four offsets are `CONFIG.viewmodel.load`'s beats and must move with
   * them** — the same contract `reload` has with `viewmodel.reload`, and for
   * the same reason: the whole of what makes a gesture legible is that what
   * you SEE lands on what you HEAR. Change a fraction in either file and
   * change it in both.
   */
  rpgLoad(duration: number): void {
    const t = duration;
    // The round out of the bag: cloth and webbing, which is the one soft
    // event in a family of metallic ones and is what says a thing was
    // FETCHED rather than worked.
    this.burst({
      dur: 0.22, vol: 0.09, type: "bandpass", freq: 520, freqEnd: 1400,
      q: 0.8, delay: t * 0.26, send: 0.2,
    });
    // The boom tapped onto the muzzle as the round is offered to the bore.
    // Light and high: it is a rim being found, not a part going home.
    this.clack(2900, 0.45, t * 0.56);
    // The motor driven down the tube — the long one, and the only sound here
    // with any length to it, because it is the only event that is a SLIDE.
    this.burst({
      dur: 0.17, vol: 0.14, type: "lowpass", freq: 1500, freqEnd: 380,
      delay: t * 0.6, send: 0.3,
    });
    // Home. The heaviest of the four: a kilogram of rocket against a stop.
    this.clack(620, 1, t * 0.78);
    this.tone(210, 0.09, "sine", 0.05, 0.5, null, { delay: t * 0.78 });
    // The hammer back. Bright, short, and last — the launcher's bolt.
    this.clack(3300, 0.7, t * 0.9);
  }

  /**
   * A mine going down on the road: the plate settling, then the fuze arming a
   * beat later.
   *
   * Two events rather than one, because the mine IS two events — a thing put
   * down and a thing switched on — and the gap between them is
   * `CONFIG.equipment.mine.mine.armTime`, which is the one number about this
   * weapon a player has to feel. The arming beep is the audible half of the
   * lamp coming on, so both halves of the tell say the same thing at the same
   * moment.
   *
   * Player-local and unspatialised, like the grenade's throw: it is a thing
   * happening in your own hands. What somebody ELSE's mine is heard as is the
   * blast, and nothing before it.
   */
  mineSet(): void {
    // Metal on stone, twice: the plate down, then the rim rocking flat.
    this.clack(420, 0.9, 0);
    this.clack(300, 0.5, 0.07);
    this.burst({
      dur: 0.16, vol: 0.09, type: "lowpass", freq: 260, freqEnd: 90,
      delay: 0.01, send: 0.25,
    });
    // The fuze, on the arming clock. A single clean tone against a mix that
    // has nothing else like it in it.
    this.tone(1650, 0.07, "square", 0.05, 1, null, {
      delay: CONFIG.equipment.mine.mine.armTime,
    });
  }

  pickup(): void {
    this.tone(700, 0.08, "sine", 0.07, 1.6);
  }

  jump(): void {
    this.tone(330, 0.08, "sine", 0.04, 1.6);
  }

  /**
   * One boot going down, at the player's own feet. `weight` is 0..1 — a
   * crouched shuffle to a sprint.
   *
   * Two layers, and the split is the whole sound: a soft lowpassed thud is the
   * boot's mass arriving, and a very short bandpassed scuff on top is the grit
   * it lands on. The thud alone is a knock on a door; the scuff alone is a
   * brush stroke. Both are slices of the shared noise buffer for the same
   * reason gunfire is — a footstep has no pitch, and anything with one reads
   * as a click track under the movement.
   *
   * Volumes here are deliberately an order below the rifle. This plays two to
   * three times a second for the entire round, which is exactly the sound that
   * gets mixed too loud and then cannot be un-noticed.
   */
  step(weight: number): void {
    const v = 0.88 + Math.random() * 0.24;
    // A lowpass throws most of a noise slice's amplitude away, so the gain is
    // set well above the level this plays at — same as the report's body.
    this.burst({
      dur: 0.07, vol: 0.3 * weight, type: "lowpass", freq: 420 * v,
      freqEnd: 130, send: 0.12,
    });
    this.burst({
      dur: 0.035, vol: 0.05 * weight * v, type: "bandpass", freq: 2400 * v,
      q: 0.8, send: 0.1,
    });
  }

  /**
   * Touching down. `weight` is 0..1 across the fall speeds `CONFIG.audio
   * .footstep` calls a landing rather than a step; the loud end is both boots
   * and the gear on them, so it gets a third layer the walking step does not.
   */
  land(weight: number): void {
    const v = 0.9 + Math.random() * 0.2;
    this.burst({
      dur: 0.09 + weight * 0.06, vol: 0.34 + 0.3 * weight, type: "lowpass",
      freq: 300 * v, freqEnd: 90, send: 0.2,
    });
    this.burst({
      dur: 0.05, vol: 0.07 + 0.07 * weight, type: "bandpass", freq: 1900 * v,
      q: 0.7, send: 0.15,
    });
    // Webbing and magazines catching up with the body, a beat behind the feet.
    if (weight > 0.25) {
      this.clack(3000, 0.35 * weight, 0.035);
    }
  }

  /** Flag captured. */
  capture(): void {
    this.tone(440, 0.12, "sine", 0.07, 1.5);
    setTimeout(() => this.tone(660, 0.18, "sine", 0.07, 1.2), 130);
  }

  /** Flag lost or neutralised — the same shape, falling instead of rising. */
  flagLost(): void {
    this.tone(520, 0.14, "sine", 0.06, 0.65);
    setTimeout(() => this.tone(340, 0.2, "sine", 0.06, 0.7), 130);
  }

  // --- world-space ---

  /**
   * A round arriving somewhere. Spatialised through exactly the machinery bot
   * fire uses — panner, propagation delay, air absorption in the filter
   * frequency, and a reverb send that climbs with distance — because the
   * world may only describe distance one way, and a wall being hit is as much
   * a fact about the village as the rifle that hit it.
   *
   * **ONE layer, three gates, and all four of those are the voice cap.** This
   * is the only sound in the game generated at gunfire's rate while mattering
   * less than gunfire: sixteen bots is ~80 rounds a second and nearly every
   * one lands. So it is rejected past `impactRange`, rate-limited to ~22 a
   * second, and refused against a RESERVE rather than against `maxVoices` —
   * see `CONFIG.audio` for why the reserve is the load-bearing one.
   *
   * The kinds differ only in filter, length and level, which is all the
   * ear needs: a tick off stone, a duller thud into earth, and a wet slap
   * into a body. All noise and no oscillator, per this class's own rule —
   * an impact is the most obviously *struck* thing in the game.
   *
   * **Glass is the exception to the gates as well as to the filter**, because
   * it is not an impact at the same rate as the others: a round that crosses a
   * pane breaks it once and every round after it crosses a hole. So it skips
   * the rate limiter — a pane can only break once, so there is no stream of
   * them to limit — and carries further, because a window going in is a thing
   * the whole street hears and is worth hearing at a range a spark off a wall
   * is not.
   */
  impact(at: Vector3, kind: "flesh" | "ground" | "hard" | "glass"): void {
    const a = CONFIG.audio;
    if (!this.ctx) return;
    // Against the reserve, and BEFORE any work: the point is to leave voices
    // standing for the gunshots, not to discover there are none left.
    if (this.voices >= a.maxVoices - a.impactReserve) return;
    const now = this.ctx.currentTime;
    const glass = kind === "glass";
    if (!glass && now - this.lastImpact < a.impactInterval) return;
    const range = glass ? a.glassRange : a.impactRange;
    const dist = this.distanceToListener(at);
    if (dist > range) return;
    const panner = this.panner(at);
    if (!panner) return;
    // A break does not spend the rate limiter either, or one window going in
    // would silence the next four rounds' worth of sparks around it.
    if (!glass) this.lastImpact = now;
    const far = dist / range;
    // The delay is honest for every round but your own, and that is the case
    // to keep it for. A bot shooting a wall thirty metres away owes you
    // `dist/343`; your own round owes you that too, on top of a tracer already
    // flying at 320 m/s against a real 900 — so your long shots crack a
    // fraction late. Dropping the term to fix that would break every other
    // shot in the game, and a late crack reads as distance rather than as a
    // fault.
    const delay = dist / a.speedOfSound;
    const send = a.reverbMix * (0.4 + far * a.reverbDistanceSend);
    const v = 0.88 + Math.random() * 0.24;
    const near = 1 - far * 0.5;
    if (glass) {
      // Two layers, and the pair is what makes it read as a sheet failing
      // rather than a bottle dropping: a bright crack as the pane goes, and a
      // longer, quieter tail of pieces landing under it. Both are noise, and
      // the tail's own delay is on top of the flight time so the fall is heard
      // after the break rather than with it.
      this.burst({
        dur: 0.06, vol: 0.4 * near, type: "highpass",
        freq: 3400 * v, freqEnd: 5200, q: 0.7,
        delay, out: panner, send,
      });
      this.burst({
        dur: 0.34, vol: 0.2 * near, type: "bandpass",
        freq: 5200 * v, freqEnd: 2400, q: 2.4,
        delay: delay + 0.05, out: panner, send,
      });
    } else if (kind === "hard") {
      this.burst({
        dur: 0.05, vol: 0.34 * near, type: "bandpass",
        freq: 2600 * v * (1 - far * 0.4), freqEnd: 900, q: 1.1,
        delay, out: panner, send,
      });
    } else if (kind === "ground") {
      this.burst({
        dur: 0.09, vol: 0.3 * near, type: "lowpass",
        freq: 700 * v * (1 - far * 0.4), freqEnd: 160,
        delay, out: panner, send,
      });
    } else {
      this.burst({
        dur: 0.07, vol: 0.26 * near, type: "lowpass",
        freq: 420 * v, freqEnd: 120, q: 0.8,
        delay, out: panner, send,
      });
    }
  }

  /**
   * Somebody else's weapon, somewhere out in the village. Three layers,
   * spatialised, and the first thing dropped when the voice budget runs out.
   *
   * **Distance is heard three ways here, and only one of them is volume.** The
   * panner handles the level; on top of that the report arrives late (sound
   * covers the map in a fifth of a second, and a flash you see before you hear
   * it is the strongest range cue there is), air absorption strips the top off
   * the crack long before the shot gets quiet, and the reverb send climbs, so
   * a shot across the valley is nearly all tail. The result is that a rifle at
   * 15 m and one at 60 m are different *sounds*, not the same sound twice.
   *
   * **The third layer is the low roll, and it is gated on distance rather than
   * faded out over the full range** (`CONFIG.audio.thumpRange`). It is what
   * makes a weapon going off across the street a physical event rather than a
   * noise, and it is also the layer the map cannot afford at scale: this is
   * the sound sixteen bots generate eighty a second, and the ones out at
   * sixty metres would be spending a voice on a rumble the panner has already
   * taken to nothing. So the near half of the field gets weight and the far
   * half gets range cues, which is what each one is actually listening for.
   *
   * `voice` is the shooter's weapon, and it is the whole reason a match can be
   * read by ear: sixteen bots fire one flat round off the same rig and are
   * heard as the rifle they are holding, while a person's slot carries their
   * own weapon from the authority (`ServerEvent.fire`'s `w`). A DMR two
   * streets away does not sound like the SMG beside you.
   *
   * `after` is extra seconds on the audio clock, on top of the propagation
   * delay, and it exists for one caller: a netplay round is told what a remote
   * weapon did once per snapshot, so two rounds fired inside the same 50 ms
   * arrive as one message and have to be laid back out in time. Scheduled on
   * the audio clock rather than through a `setTimeout`, so the spacing is
   * sample-accurate and unaffected by the frame rate.
   */
  botShot(at: Vector3, after = 0, voice: ReportVoice = FLAT_REPORT): void {
    const a = CONFIG.audio;
    const dist = this.distanceToListener(at);
    // Beyond maxDistance the linear rolloff has already reached silence, so
    // building the nodes only burns voices that could have carried an audible
    // shot. Reject before the panner, not after.
    if (dist > a.maxDistance) return;
    const panner = this.panner(at);
    if (!panner) return;
    const far = dist / a.maxDistance;
    const delay = after + dist / a.speedOfSound;
    const send = a.reverbMix * (0.4 + far * a.reverbDistanceSend);
    const v = 0.9 + Math.random() * 0.2;
    const p = voice.pitch;
    this.burst({
      dur: 0.03, vol: 0.4 * v * voice.level * voice.snap * (1 - far * 0.8),
      type: "highpass", freq: (2400 - 1700 * far) * v * p, q: 0.6, delay,
      out: panner, send: send * 0.3 * voice.tail,
    });
    // The far half of the map hears a longer, duller thud; the near half hears
    // a report with an edge on it.
    this.burst({
      dur: (0.1 + far * 0.14) * voice.length, vol: 0.62 * voice.level,
      type: "lowpass", freq: (1500 - 1150 * far) * p, freqEnd: 190 * p, delay,
      out: panner, send: send * voice.tail,
    });
    // The low roll, close in only. Faded over its OWN range rather than the
    // panner's much longer one, so the last of it trails off instead of
    // stopping at a line — the same rule `botStep` follows for the same
    // reason.
    if (dist >= a.thumpRange) return;
    const near = 1 - dist / a.thumpRange;
    this.burst({
      dur: 0.2 * voice.length, vol: 1.5 * near * voice.level * voice.weight,
      type: "lowpass", freq: 320 * p, freqEnd: 95 * p, q: 3, delay,
      out: panner, send: send * 0.8 * voice.tail,
    });
  }

  /**
   * A grenade going off. Spatialised like bot fire, and built the same way —
   * filtered slices of the shared noise buffer plus one pitched layer for the
   * part that genuinely is a single frequency.
   *
   * The difference from a gunshot is entirely in the time scale, and that is
   * what makes it read as an explosion rather than as a loud rifle: the crack
   * is the same order (a few tens of milliseconds), but underneath it sits a
   * half-second low roll and a full second of debris, and the reverb send is
   * near unity because outdoors a blast is mostly the valley answering it.
   *
   * Exempt from `botShot`'s early distance rejection at `maxDistance`: a
   * grenade at 90 m is still a thing you want to know happened, and there are
   * seconds between them rather than eighty a second, so it can afford the
   * voices.
   *
   * **`power` is the same grenade-relative size the picture is drawn at** (see
   * `GrenadeSystem`), and a bigger blast is voiced by going DOWN rather than by
   * going up: every pitched layer divides by it and the roll runs longer, while
   * the levels barely move. That is what a bigger charge actually sounds like,
   * and it is also the only version that stays inside the mix — a shell voiced
   * as a grenade at twice the gain is a clip, not a bang.
   */
  explosion(at: Vector3, power = 1): void {
    const a = CONFIG.audio;
    const dist = this.distanceToListener(at);
    // A bigger blast carries further, on the same 1.6x exemption.
    if (dist > a.maxDistance * 1.6 * power) return;
    const panner = this.panner(at);
    if (!panner) return;
    const far = Math.min(1, dist / (a.maxDistance * power));
    const delay = dist / a.speedOfSound;
    const v = 0.92 + Math.random() * 0.16;
    // A blast twice the size is not twice as loud; it is lower and longer. The
    // pitch divisor is square-rooted so 1.85x power is a fifth down rather than
    // an octave, which is where a tank gun sits against a frag.
    const drop = Math.sqrt(power);
    const gain = Math.min(1.35, 0.75 + 0.25 * power);
    // The crack. Broadband, over in 40 ms, and the thing that says "sharp".
    this.burst({
      dur: 0.04 * drop, vol: 0.7 * v * gain * (1 - far * 0.7), type: "highpass",
      freq: ((1800 - 1300 * far) * v) / drop, q: 0.5, delay, out: panner, send: 0.4,
    });
    // The body: a long lowpassed roll sweeping down as the pressure wave
    // spreads. This is most of what a distant blast is.
    this.burst({
      dur: (0.5 + far * 0.35) * power, vol: gain, type: "lowpass",
      freq: (900 - 600 * far) / drop, freqEnd: 70 / drop, delay, out: panner,
      send: 1.4,
    });
    // The chest thump, a fifth of the rifle's pitch and five times its length.
    this.tone((42 * v) / drop, 0.42 * power, "sine", 0.5 * gain * (1 - far * 0.5), 0.4, panner, {
      delay, send: 0.8,
    });
    // Debris coming back down, well behind the blast — the tail that stops it
    // sounding like a single event, and the one layer this game now DRAWS as
    // well (see `BlastDebrisSystem`), so it runs as long as the rubble does.
    this.burst({
      dur: 0.7 * power, vol: 0.16 * gain * (1 - far * 0.6), type: "bandpass",
      freq: 2200 * v, freqEnd: 700, q: 0.7, delay: delay + 0.14, out: panner,
      send: 0.6,
    });
  }

  /**
   * A tank's main gun. The one report in the game that is not built from
   * `CONFIG.weapons` — it is not a weapon in that table, it has no magazine
   * and no `ReportVoice`, and shaping it as an eight-scalar deviation from a
   * rifle would be describing a howitzer as a loud carbine.
   *
   * It is `explosion` reasoned about from the other end: the same four layers,
   * because a gun that size and a blast that size are the same physics, with
   * the crack pushed forward and much harder and the debris tail dropped. What
   * is left is a slam with a long roll under it.
   *
   * Spatialised like every other gun, and audible half again as far as one:
   * the whole point of a tank on the map is that everybody knows there is a
   * tank on the map.
   */
  cannon(at: Vector3): void {
    const a = CONFIG.audio;
    const dist = this.distanceToListener(at);
    if (dist > a.maxDistance * 2.2) return;
    const panner = this.panner(at);
    if (!panner) return;
    const far = Math.min(1, dist / (a.maxDistance * 1.4));
    const delay = dist / a.speedOfSound;
    const v = 0.94 + Math.random() * 0.12;
    // The muzzle blast: broadband and over in 60 ms. Twice a rifle's and half
    // the length of the roll behind it.
    this.burst({
      dur: 0.06, vol: 1.15 * (1 - far * 0.6), type: "highpass",
      freq: (1500 - 1100 * far) * v, q: 0.6, delay, out: panner, send: 0.7,
    });
    // The body, sweeping down as the pressure wave spreads. Longer than a
    // grenade's, because the barrel keeps pointing it somewhere.
    this.burst({
      dur: 0.62 + far * 0.4, vol: 1, type: "lowpass",
      freq: 700 - 460 * far, freqEnd: 55, delay, out: panner, send: 1.7,
    });
    // The chest thump, an octave under the grenade's.
    this.tone(24 * v, 0.55, "sine", 0.62 * (1 - far * 0.45), 0.5, panner, {
      delay, send: 0.9,
    });
  }

  /**
   * The engine of the tank the PLAYER is driving: one sustained voice, started
   * on the way in and stopped on the way out.
   *
   * **This is the only thing in this file that does not end on its own**, and
   * the header's rule — nothing here schedules a repeating sound — is intact
   * rather than bent: a repeating sound is a timer firing one-shots, and this
   * is a single source that is simply held open. It still stops with the audio
   * clock, so a pause holds it exactly as it holds the tail of the last shot.
   *
   * Deliberately NOT spatialised and deliberately NOT counted against the voice
   * cap. It is not a sound in the world you are listening to; it is the vehicle
   * you are sitting in, the same reason the player's own report is exempt.
   * Somebody else's tank is heard through `cannon` and through nothing else,
   * which is a real gap and is written down in `docs/vehicles.md`.
   *
   * The noise runs at a third speed so the shared one-second buffer loops every
   * three, and it is lowpassed hard enough that the seam is not a thing an ear
   * can find.
   */
  engineOn(): void {
    if (!this.ctx || !this.master || !this.noiseBuffer || this.engineGain) return;
    try {
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      const filter = this.ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 300;
      filter.Q.value = 0.7;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;
      src.playbackRate.value = 0.33;
      // The pitched half: an engine has a firing order, and a sawtooth under
      // filtered noise is what makes the two read as one machine rather than
      // as wind.
      const osc = this.ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = 40;
      const oscGain = this.ctx.createGain();
      oscGain.gain.value = 0.35;
      src.connect(filter).connect(gain);
      osc.connect(oscGain).connect(filter);
      gain.connect(this.master);
      src.start();
      osc.start();
      this.engineSrc = src;
      this.engineOsc = osc;
      this.engineGain = gain;
      this.engineFilter = filter;
    } catch {
      // ignore
    }
  }

  /**
   * How hard the engine is working: `load` is the throttle 0..1 and `speed` is
   * how much of the vehicle's top speed it is doing.
   *
   * Both, not one. Pitch tracks SPEED, so the note rises as the tank gets
   * going; volume and the filter track LOAD, so standing on the throttle
   * against a wall still sounds like work. A single term would make a stalled
   * tank silent, which is the opposite of what a stalled tank sounds like.
   */
  engineDrive(load: number, speed: number): void {
    if (!this.ctx || !this.engineGain || !this.engineOsc || !this.engineFilter) {
      return;
    }
    const t = this.ctx.currentTime;
    // Levels here are art and sit beside the rest of this file's, which are
    // all literals for the same reason: what a layer is worth is decided by ear
    // against the others, not by a number anybody would tune from outside.
    const level = 0.1 + 0.16 * load;
    // Ramped rather than assigned, or every frame is a click. 80 ms is short
    // enough that the engine still answers the throttle inside a tenth of a
    // second and long enough that no step in it is audible.
    this.engineGain.gain.setTargetAtTime(level, t, 0.08);
    this.engineOsc.frequency.setTargetAtTime(34 + 52 * speed, t, 0.12);
    this.engineFilter.frequency.setTargetAtTime(220 + 620 * load, t, 0.1);
  }

  /** Out of the vehicle: the engine stops, and its nodes are let go. */
  engineOff(): void {
    if (!this.engineGain) return;
    try {
      this.engineSrc?.stop();
      this.engineOsc?.stop();
      this.engineGain.disconnect();
    } catch {
      // ignore
    }
    this.engineSrc = null;
    this.engineOsc = null;
    this.engineGain = null;
    this.engineFilter = null;
  }

  /**
   * Somebody else working their magazine. The player's own reload is flat and
   * front-and-centre; this one is spatialised, because knowing *which* of the
   * enemies in front of you has just gone dry is the point of hearing it — it
   * is the cue to push. Fixed offsets rather than the player's fractions: bot
   * reload time is a per-bot skill value and this only has a position.
   *
   * `voice` is the shooter's mechanism, and it turns the cue from "somebody is
   * reloading" into "somebody with an LMG is reloading", which is a rather
   * different sentence: it is the difference between a second and a half of
   * window and three and a half.
   */
  botReload(at: Vector3, voice: ReportVoice = FLAT_REPORT): void {
    const dist = this.distanceToListener(at);
    if (dist > CONFIG.audio.maxDistance) return;
    const panner = this.panner(at);
    if (!panner) return;
    const delay = dist / CONFIG.audio.speedOfSound;
    const p = voice.actionPitch;
    const g = voice.actionVol;
    this.clack(2200 * p, 0.5 * g, delay, panner);
    this.clack(760 * p, 0.6 * g, delay + 0.3, panner);
    this.clack(3100 * p, 0.45 * g, delay + 0.55, panner);
  }

  /**
   * A bot's boot, out in the village. Spatialised, and cut off far short of
   * `maxDistance` (`CONFIG.audio.footstep.botRange`) — see that field for why.
   *
   * One layer, not the player's two: the scuff is the first thing the air and
   * the distance take off a footstep, and past a few metres all that is left
   * is the thud. Skipping it also halves what a squad jogging past costs.
   *
   * No propagation delay either, unlike `botShot`. At 20 m that is 58 ms — far
   * too small to read as distance, and it would only smear the one thing this
   * sound is for, which is knowing that someone is moving *now*, close, and
   * roughly over there.
   */
  botStep(at: Vector3): void {
    const f = CONFIG.audio.footstep;
    const dist = this.distanceToListener(at);
    if (dist > f.botRange) return;
    const panner = this.panner(at);
    if (!panner) return;
    const v = 0.85 + Math.random() * 0.3;
    // Fades out over its own range rather than the panner's much longer one,
    // so the last audible steps trail off instead of being cut mid-stride.
    const far = dist / f.botRange;
    this.burst({
      dur: 0.075, vol: 0.34 * (1 - far * 0.6), type: "lowpass", freq: 380 * v,
      freqEnd: 110, out: panner, send: 0.15,
    });
  }

  // --- primitives ----------------------------------------------------------

  private buildNoiseBuffer(): void {
    if (!this.ctx) return;
    const rate = this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, rate, rate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;
  }

  /**
   * The village's impulse response: a handful of discrete slaps off the
   * nearest walls, then a decaying diffuse tail. Built once.
   *
   * Two details carry it. The tail is run through a one-pole lowpass as it is
   * written, because air and stone eat the top end first — an undarkened noise
   * tail is a hiss, which reads as tape, not as a valley. And the two channels
   * get independent noise and different early-reflection times: identical
   * channels collapse to a point between your ears, and the whole reason a
   * gunshot sounds outdoors is that its tail comes from everywhere at once.
   */
  private buildImpulse(): void {
    if (!this.ctx || !this.reverb) return;
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * CONFIG.audio.reverbSeconds);
    const ir = this.ctx.createBuffer(2, len, rate);
    // Milliseconds and amplitude of the early reflections, per channel.
    const early = [
      [13, 0.5, 29, 0.36, 48, 0.26, 71, 0.18, 104, 0.12],
      [19, 0.46, 34, 0.33, 57, 0.24, 83, 0.17, 119, 0.11],
    ];
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        lp += 0.3 * (Math.random() * 2 - 1 - lp);
        // Squared falloff reaching exactly zero at the end, so the tail can
        // never click off.
        d[i] = lp * (1 - t) * (1 - t) * 0.6;
      }
      const table = early[ch];
      for (let k = 0; k < table.length; k += 2) {
        const at = Math.floor((rate * table[k]) / 1000);
        if (at < len) d[at] += table[k + 1];
      }
    }
    this.reverb.buffer = ir;
  }

  private distanceToListener(at: Vector3): number {
    const dx = at.x - this.lx;
    const dy = at.y - this.ly;
    const dz = at.z - this.lz;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /**
   * A distance-attenuated output node, or null when the sound is too far away
   * or the voice budget is spent.
   */
  private panner(at: Vector3): PannerNode | null {
    if (!this.ctx || !this.master) return null;
    const a = CONFIG.audio;
    if (this.voices >= a.maxVoices) return null;
    const node = this.ctx.createPanner();
    node.panningModel = "equalpower";
    node.distanceModel = "linear";
    node.refDistance = a.refDistance;
    node.maxDistance = a.maxDistance;
    node.rolloffFactor = 1;
    node.positionX.value = at.x;
    node.positionY.value = at.y;
    node.positionZ.value = at.z;
    node.connect(this.master);
    return node;
  }

  /**
   * freqMult: ending frequency as a multiple of the start (for slides).
   * `extra` carries the three things only gunfire needs — a scheduling offset,
   * a reverb send and the voice-cap exemption `shoot` argues for — so the
   * eight plain call sites stay plain.
   */
  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    freqMult: number,
    out?: AudioNode | null,
    extra?: { delay?: number; send?: number; keep?: boolean },
  ): void {
    if (!this.ctx || !this.master) return;
    if (!extra?.keep && this.voices >= CONFIG.audio.maxVoices) return;
    try {
      const t0 = this.ctx.currentTime + (extra?.delay ?? 0);
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * freqMult), t0 + dur);
      gain.gain.setValueAtTime(vol, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain).connect(out ?? this.master);
      this.send(gain, extra?.send);
      this.voices += 1;
      osc.onended = () => {
        this.voices -= 1;
      };
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    } catch {
      // audio is non-critical; ignore failures
    }
  }

  /**
   * One layer of a percussive sound: a random slice of the shared noise buffer
   * through an optional filter, with a two-stage decay.
   *
   * **The two stages are the point.** A single exponential from full to
   * silence is a whoosh however short you make it; every impulsive sound in
   * the physical world collapses most of the way in the first few percent of
   * its length and then trails. That envelope, applied to filtered noise, is
   * what the ear reads as "something struck", and it is doing more work here
   * than any of the frequency choices above it.
   */
  private burst(b: {
    dur: number;
    vol: number;
    /** Omitted leaves the slice unfiltered. */
    type?: BiquadFilterType;
    freq?: number;
    /** Swept to, over the layer's duration. */
    freqEnd?: number;
    q?: number;
    /** Seconds from now, on the audio clock — not a setTimeout. */
    delay?: number;
    out?: AudioNode | null;
    /** Level into the shared environment reverb, pre-panner. */
    send?: number;
    /**
     * Exempt from the voice cap — still counted, never refused. The player's
     * own report and nothing else; see `shoot` for the bound that makes it
     * safe.
     */
    keep?: boolean;
  }): void {
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    if (!b.keep && this.voices >= CONFIG.audio.maxVoices) return;
    try {
      const t0 = this.ctx.currentTime + (b.delay ?? 0);
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(b.vol, t0);
      gain.gain.exponentialRampToValueAtTime(b.vol * 0.18, t0 + b.dur * 0.15);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + b.dur);
      let head: AudioNode = src;
      if (b.type && b.freq) {
        const f = this.ctx.createBiquadFilter();
        f.type = b.type;
        f.Q.value = b.q ?? 1;
        f.frequency.setValueAtTime(b.freq, t0);
        if (b.freqEnd) {
          f.frequency.exponentialRampToValueAtTime(b.freqEnd, t0 + b.dur);
        }
        src.connect(f);
        head = f;
      }
      head.connect(gain).connect(b.out ?? this.master);
      this.send(gain, b.send);
      this.voices += 1;
      src.onended = () => {
        this.voices -= 1;
      };
      // A different slice each time, so repeated shots don't phase together.
      const offset = Math.random() * Math.max(0, this.noiseBuffer.duration - b.dur);
      src.start(t0, offset, b.dur);
    } catch {
      // ignore
    }
  }

  /**
   * Taps a layer into the shared reverb. Tapped *before* the panner
   * deliberately: reverberant energy is diffuse and arrives from every
   * direction, so it is neither panned nor distance-attenuated — callers set
   * the send level from distance themselves.
   */
  private send(from: GainNode, level: number | undefined): void {
    if (!this.ctx || !this.reverb || !level) return;
    const s = this.ctx.createGain();
    s.gain.value = level;
    from.connect(s).connect(this.reverb);
  }

  /**
   * A piece of the weapon's mechanism. Bandpassed noise, because metal on
   * metal is a resonance and a struck resonance is exactly what a filtered
   * noise burst is — a square wave at the same pitch is a beep.
   */
  private clack(
    freq: number,
    vol: number,
    delay: number,
    out?: AudioNode | null,
  ): void {
    // The bandpass throws away about half the noise's amplitude, so the raw
    // gain sits above the level this ends up playing at — and the whole family
    // sits far below a report, because a magazine catch is not a gunshot.
    this.burst({
      dur: 0.045, vol: 0.28 * vol, type: "bandpass", freq, q: 1.2,
      delay, out, send: 0.2,
    });
  }
}
