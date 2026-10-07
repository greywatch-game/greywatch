/**
 * AmbienceVoices.ts — A place in the world that makes a noise on its own: a
 * burning drum, a stream, a shore.
 * Owns: the open emitters by key, the gate's transfer curves, the BREATH
 * buffer, and the one graph (`buildAmbience`) every kind is.
 * Reached only through `Sfx`, whose `ambience`/`ambienceOff`/`ambienceAllOff`
 * delegate here (and whose `unlock` builds the breath), and it reaches back
 * only through the `AudioCore` it is handed (`sfxCore.ts`).
 * The graph is a roar, a LIST of humps, a breath and one impulse-excited
 * resonator per event row, so randomness costs no schedule. Both halves are
 * lists for the same reason and it is the reason there are three kinds and no
 * branch: a fire is one hump over a roar with the events carrying the top,
 * and running water is TWO humps with the events a garnish, so **a second
 * hump is a second row**. Both were FITTED to recordings rather than tuned —
 * `docs/audio.md` carries the tables, the three silent failures the fire's
 * fit turned up and the fourth the water's did. `systems/AmbienceSystem.ts`
 * decides WHICH emitters are worth a voice and this file decides what one
 * sounds like. Its one difference from the engines is what a HELD world is
 * owed: an engine is driven by a load a lid freezes and owes silence, a fire
 * is driven by nothing and does not — see `ambienceAllOff`.
 * Invariants: NOTHING HERE IS SCHEDULED — `Sfx`'s rule, held rather than bent:
 * each emitter is a graph of sources held open, and the only things in it
 * that repeat are looping buffers, which are the audio clock's business rather
 * than the frame's and stop with that clock like everything else. Teardown is
 * a loop over `AmbienceVoice.sources`, everything started being on it. A bus
 * is read into a LOCAL by the method making the sound and never held in a
 * field (`docs/audio.md`, the two faders).
 * Never: a recording. One ambient bed prices out at ten times the whole
 * sampled gun kit — see `docs/audio.md`.
 */
import type { Vector3 } from "@babylonjs/core";
import type { MixChannel } from "../config";
import type { AudioCore } from "./sfxCore";

/**
 * The ambience breath's own sample rate, its length, and the wander it is
 * smoothed to — see `buildBreathBuffer`. 3000 Hz is the lowest a WebAudio
 * buffer may state, and this signal has nothing in it over a few hertz.
 *
 * The length and the reference are ONE decision: a kind's breath plays this
 * buffer at `breathHz / BREATH_WANDER_HZ`, so 24 seconds at 1 Hz gives the
 * fire's 1.2 the twenty-second loop it has always had, and a SLOWER breath
 * gets a proportionally longer one for free — the shore's 0.28 loops every
 * 86 s. That is the right way round: a slow swell is exactly the one an ear
 * could catch coming round.
 *
 * It costs 288 KB, once, beside the noise buffer's 192 — and it is a fixed
 * cost rather than a per-kind one, because the rate is a playback rate and
 * a fourth kind is a fourth `breathHz` reading this same buffer.
 */
const BREATH_BUFFER_RATE = 3000;
const BREATH_SECONDS = 24;
const BREATH_WANDER_HZ = 1;

/**
 * Which ambience a place in the world makes.
 *
 * The world layer names a sound by ID rather than reaching for the audio
 * config, which is what keeps a building kit describing what a thing IS and
 * leaves what it SOUNDS like to a table — `MapBuilder`'s `AMBIENCE_KINDS`,
 * which is a `Record` over this union for the reason `WEAPON_BUILDERS` and
 * the optics table are: a second kind does not compile half-added.
 */
export type AmbienceId = "fire" | "stream" | "shore";

/**
 * The two ways a body of WATER is heard, and the reason there are two of them
 * is that they are different sounds rather than the same sound louder.
 *
 * Running water is turbulence over a bed: a steady rush whose bubbles ring
 * around a kilohertz, with a gurgle a few times a second and no bass at all.
 * Still water is heard only where it meets the land, and what is heard there
 * is the SWASH — a slow deep swell an octave lower, because a wave entrains
 * bigger air than a brook does and a bubble's note is `3.26 / r`. `docs/audio.md`
 * has both fits; `MapBuilder` is where a `WaterRect` names one.
 *
 * Derived from `AmbienceId` rather than declared beside it, so a member that
 * is renamed there stops compiling here instead of quietly meaning nothing.
 */
export type WaterAmbienceId = Extract<AmbienceId, "stream" | "shore">;

/**
 * What a place in the world sounds like — the ambience equivalent of
 * `EngineKind`, and held as a spec for that field's reason: what a thing
 * sounds like is a ROW, so a second kind is a second row and never a branch.
 *
 * The values live in `CONFIG.audio.ambience`, which is where every number in
 * the game lives; this is only their shape. Three kinds are built out of it
 * and no branch anywhere tells them apart — see `buildAmbience`, which is
 * one method for the same reason `EngineVoices.buildEngine` is one method for a diesel and
 * a turbine.
 *
 * **The BED is a list and the EVENTS are a list, and between them that is the
 * whole of the difference between a fire and running water.** A fire is a low
 * roar, ONE broad hump up top, and crackles carrying most of the mid-high
 * energy; a brook is TWO humps with only a garnish of gurgle over them.
 * Trying to build a brook's second hump out of event rows is what proved the
 * split necessary rather than tidy: an impulse train dense enough to read as
 * a bed stops being impulses, and measured, the top three octaves came in
 * 4 to 8 dB under a fit that had them right on paper (`docs/audio.md`).
 */
export interface AmbienceKind {
  /**
   * Its own slider on the mixer (`CONFIG.mix.channels`), stated per KIND
   * rather than derived from the id: a bed is one sound a person has an
   * opinion about, and all three sit under the one `ambience` group.
   */
  mix: MixChannel;
  /** Metres: past this the graph is not built. */
  range: number;
  /** Metres: the panner's plateau. */
  refDistance: number;
  /** The panner's inverse rolloff. */
  rolloff: number;
  /** Level at the plateau. */
  level: number;
  /**
   * The BOTTOM, and the one bed term that is not a hump: a lowpass corner in
   * Hz and its share. It is flat to DC, which no bandpass is, and that is
   * what it is for — the fire's column of air and the shore's surf rumble.
   */
  roarHz: number;
  roarLevel: number;
  /**
   * The humps, as a LIST. One is a fire, two is running water, and the gaps
   * between them are left by the filters rather than authored.
   */
  bands: readonly BandSpec[];
  /**
   * The slow swell: how fast the breath wanders, in Hz. It is the ONE number
   * behind it now — the loop is `BREATH_SECONDS` of buffer read at
   * `breathHz / BREATH_WANDER_HZ`, so a slower swell repeats proportionally
   * later and there is nothing left to state. The shore spends this on the
   * wave itself, at 0.28.
   */
  breathHz: number;
  /** How deeply the breath swings the bottom. Each hump carries its own. */
  breathRoarDepth: number;
  /**
   * The events, as a LIST — empty is a wind in a canopy, and a further kind
   * of crackle, gurgle or plop is a further row rather than a branch in
   * `buildAmbience`.
   */
  sparks: readonly SparkSpec[];
}

/**
 * One hump in the bed: a bandpass on the shared noise, and how much of it.
 *
 * `stages` is how many of that bandpass are put in SERIES, and it buys skirt
 * steepness rather than narrowness — which is a thing a single biquad cannot
 * trade for. A brook's spectrum falls about 18 dB an octave below 500 Hz and
 * only 7 above 2 kHz, and fitted against the recording at third-octave
 * resolution one stage lands 0.88 dB rms out, two 0.31 and three 0.27: two is
 * the knee, and the ripple the single stage leaves is a Q of 2.9 poking a
 * tone through the middle of the plateau. Raising Q instead does not help —
 * a one-pole skirt is 6 dB an octave however sharp its peak.
 *
 * `breath` is this hump's own share of the swell, normalised the way
 * `SparkSpec.level` is, so it means a depth rather than a magic number. Two
 * humps do not surge alike: a fire's draught moves the small stuff and the
 * column barely notices (1.1 against 0.32), where a wave moves the whole body
 * of water at once and the shore's two are within a third of each other.
 */
export interface BandSpec {
  /** Centre, in Hz. */
  hz: number;
  /** Width. Under 1 is broader than an octave. */
  q: number;
  /** How many of that bandpass in series. See above: this is SKIRT, not width. */
  stages: number;
  /** Share of the mix, and the floor the breath swings about. */
  level: number;
  /** This hump's share of the breath, as a fraction of its own level. */
  breath: number;
}

/**
 * One family of crackle: how often, and what it rings.
 *
 * `hz` is EVENTS A SECOND and is honoured as one — `sparkThreshold` turns it
 * into a waveshaper threshold against the context's own sample rate, so the
 * row means the same thing at 44.1 and 48 kHz. `rate` is what slice of the
 * shared buffer this chain reads, and its only job is to be different from
 * every other row's: two chains at the same rate fire on the same samples and
 * are one louder chain with two filters on it.
 */
export interface SparkSpec {
  /** Events a second. */
  hz: number;
  /**
   * Playback rate, and **it MUST be a negative power of two** — 1, 0.5,
   * 0.25, 0.125. Any other value is not a slower row, it is a SILENT one.
   *
   * A spark's threshold sits within a thousandth of full scale, so what it
   * selects is isolated single samples. A read position that does not land
   * exactly on the sample grid interpolates between an extreme sample and
   * its ordinary neighbour, and that average is always under the threshold —
   * so the row fires less often, or not at all. Measured, one row stated at
   * 15 events a second delivered 107% of that at rate 1 and 110% at 0.5, and
   * then **57% at 0.2, 44% at 1/7, 21% at 1/3 and NOTHING AT ALL at 0.37 or
   * 0.61.** Only rates that are exact in binary keep the position on the
   * grid; 1/3 is not 0.333… in a float and the position drifts off it.
   *
   * This shipped as 0.61 in the second cut of this graph, which meant the
   * whole second row was silent and the fire was one pitch repeated — the
   * exact failure the row list exists to prevent, hidden behind numbers that
   * measured well because the surviving row was carrying them. `buildAmbience`
   * warns about it in a DEV build.
   */
  rate: number;
  /**
   * Seconds of the shared buffer this row reads before it repeats, so its
   * own cycle is `loop / rate` and no two rows share one.
   *
   * The buffer is one second long and a row at rate 1 therefore repeats its
   * whole pattern of crackles every second, which is a rhythm, and the
   * reason rate 1 is not used by any row. Rounded to a whole
   * number of SAMPLES at build time: a fractional loop leaves the read
   * position on a fraction after its first wrap, which is the silent failure
   * above arriving by a different door.
   */
  loop: number;
  /** The resonance an impulse rings, and how long it rings for. */
  ringHz: number;
  ringQ: number;
  level: number;
}

/**
 * Points in a spark's transfer table. See `sparkShape`: a crackle's rate
 * is a threshold near the very tip of the noise's range, so this is the
 * resolution of that rate and the usual 1024 cannot express one.
 */
const SPARK_CURVE_POINTS = 32768;

/**
 * Events a second → the sample value a crackle has to exceed.
 *
 * White noise is uniform on [-1, 1], so the share of samples past a threshold
 * `t` is `1 - t` on each tip and the chain fires at `sampleRate * rate *
 * (1 - t)`. Inverting that is the whole function, and it is a function rather
 * than a constant because the answer depends on a device's own sample rate:
 * a threshold that gives fifteen crackles a second at 48 kHz gives sixteen
 * and a half at 44.1, and hard-coding one would be a fire that burns at a
 * different speed on different hardware.
 *
 * Clamped well short of 1 so a badly-stated row is a busy fire rather than a
 * table with no events in it at all.
 */
export function sparkThreshold(hz: number, sampleRate: number, rate: number): number {
  const share = hz / Math.max(1, sampleRate * rate);
  return Math.min(0.9999, Math.max(0, 1 - share));
}

/**
 * One emitter's nodes — `EngineVoice`'s much shorter cousin, and short for a
 * reason worth stating: everything an engine holds on that interface is
 * something the throttle MOVES, and nothing moves here. A fire is not being
 * worked, so the only things this has to keep are the three needed to take it
 * away again.
 *
 * `sources` carries the same rule it carries there: everything started is on
 * it, so stopping is a loop rather than a list somebody has to keep in step.
 * The panner is on it in its own right because `out.disconnect()` would leave
 * one wired to the master — silent, and never collected.
 */
interface AmbienceVoice {
  sources: AudioScheduledSourceNode[];
  out: GainNode;
  panner: PannerNode;
}

export class AmbienceVoices {
  /**
   * The world's sustained emitters, keyed by whatever the caller uses to tell
   * one from another — `AmbienceSystem` uses the emitter's index, which is
   * stable for the life of a map, so a fire keeps its own voice as the
   * ranking around it changes.
   *
   * Held open for as long as the caller keeps asking and the emitter stays
   * inside its kind's `range`. See `ambience`, which is called every frame
   * rather than when something is lit, and `ambienceAllOff`, which is owed by
   * a map being torn down and — unlike `enginesOff` — by nothing else.
   */
  private voices = new Map<number, AmbienceVoice>();
  /**
   * The gate's transfer curves by threshold, built on the first emitter of
   * each kind and shared after that, for the reason `EngineVoices.growlCurve`
   * is. A map rather than a field because a second ambience kind is a second
   * threshold, and the whole point of the spec is that adding one costs no
   * code here.
   */
  private sparkCurves = new Map<number, Float32Array<ArrayBuffer>>();
  /**
   * The ambience BREATH's wander, pre-smoothed and built once — see
   * `buildBreathBuffer`, which is where the argument for holding it as a
   * buffer rather than filtering noise live is written down.
   */
  private breathBuffer: AudioBuffer | null = null;

  constructor(private readonly core: AudioCore) {}

  /**
   * A place in the world that makes a noise on its own — a burning drum, and
   * whatever is added beside it.
   *
   * **This is `EngineVoices.hullEngine`'s shape with a different budget, and the two are
   * meant to be read together**: a graph held open behind a panner, keyed by
   * whatever the caller uses to tell one emitter from another, called EVERY
   * FRAME rather than when something starts, with the range gate and its
   * hysteresis in here rather than at the call site. What differs is only
   * what is being tracked — not somebody lighting a fire, but a fire being
   * within earshot.
   *
   * **The caller decides WHICH emitters get a voice and this decides whether
   * one is close enough to be worth building.** `AmbienceSystem` owns the
   * ranking, because how many fires a map may hold is a question about the
   * map and not about the graph.
   *
   * The hysteresis is the engine's, for the engine's reason and not for a
   * sound one: by the gate the rolloff has this voice below anything audible
   * either way, so what an emitter sitting on the boundary would otherwise
   * cost is a three-source graph torn down and stood back up every few
   * frames.
   */
  ambience(key: number, at: Vector3, kind: AmbienceKind): void {
    const ctx = this.core.ctx;
    // The kind's own family, not the caller's: a burning drum and a shoreline
    // are one call and two rows on the mixer — see `AmbienceKind.mix`.
    const bus = this.core.bus(kind.mix, "ambience");
    if (!ctx || !bus) return;
    let voice = this.voices.get(key);
    const dist = this.core.distanceToListener(at);
    if (dist > kind.range * (voice ? 1.15 : 1)) {
      this.ambienceOff(key);
      return;
    }
    if (!voice) {
      const panner = ctx.createPanner();
      panner.panningModel = "equalpower";
      panner.distanceModel = "inverse";
      panner.refDistance = kind.refDistance;
      panner.rolloffFactor = kind.rolloff;
      panner.connect(bus.dry);
      const built = this.buildAmbience(panner, kind);
      if (!built) {
        panner.disconnect();
        return;
      }
      voice = built;
      this.voices.set(key, voice);
      // Faded UP rather than switched on. A fire that arrives at full level on
      // the frame it comes into range is the one moment the ranking behind it
      // would be audible as a ranking.
      voice.out.gain.setTargetAtTime(kind.level, ctx.currentTime, 0.25);
    }
    const p = voice.panner;
    p.positionX.value = at.x;
    p.positionY.value = at.y;
    p.positionZ.value = at.z;
  }

  /** One emitter: out of range, or beaten to its slot. */
  ambienceOff(key: number): void {
    const voice = this.voices.get(key);
    if (!voice) return;
    this.voices.delete(key);
    this.stopAmbience(voice);
  }

  /**
   * Every one at once, and it is owed by exactly one caller: a map being torn
   * down, which takes none of its keys with it, so the per-frame
   * `ambienceOff` above would never be asked about them again.
   *
   * **Unlike `enginesOff` this is NOT owed by a frame that held the world**,
   * and the difference between the two is the whole argument for where the
   * push lives. An engine's voice is driven by a parameter a held world
   * freezes — a stopped fleet is a hull droning at a load nobody is asking
   * for — so a frame that did not step it owes those SILENCE. A fire is
   * driven by nothing at all: it is a property of the map being installed and
   * the listener being somewhere, which every state that renders has. A
   * village does not go quiet because a kit screen is up.
   *
   * The suspended clock is the one held world neither of them answers, and
   * for the same reason: the offline pause card stops the audio context,
   * which is already holding this graph exactly as it holds the tail of the
   * last shot.
   */
  ambienceAllOff(): void {
    if (this.core.paused) return;
    for (const voice of this.voices.values()) this.stopAmbience(voice);
    this.voices.clear();
  }

  /**
   * The ambience graph, and the same bargain the engine makes one subsystem
   * over — see `EngineVoices.buildEngine`, whose header rule is this one's too. Nothing
   * here is scheduled. The only things that repeat are buffer sources
   * looping, which is the audio clock's business rather than the frame's, and
   * they stop with that clock like everything else.
   *
   * **A fire is a low ROAR, a high hump, and EVENTS — with a hole in the
   * middle.** That last part is measured rather than designed: the reference
   * recording's octave bands run 63 Hz -4.1 dB, 125 -5.2, 250 -10.2, then
   * **500 -21.2 and 1k -19.5**, then back up to 4k -11.8 and 8k -11.5. Two
   * humps and a fifteen-decibel hole between them. Nothing here fills that
   * hole and nothing here should: a 12 dB/octave lowpass at `roarHz` and a
   * bandpass whose skirt starts an octave and a half above it leave it there
   * for free.
   *
   * **AND RUNNING WATER IS EXACTLY THAT HOLE.** The water reference peaks at
   * 1 kHz — dead centre of the two octaves the fire has almost nothing in —
   * and falls away hard on both sides, which is why the second kind built out
   * of this method needed no term the first did not have and needed its terms
   * pointed somewhere else entirely. It is also why a burning drum on a
   * quayside does not mask the sea beside it.
   *
   * | layer | a fire | water |
   * | --- | --- | --- |
   * | roar — lowpassed noise | the column of air the drum is moving | the shore's surf rumble; a brook has none |
   * | bands — the SAME noise through humps | one: sap, ash and small stuff | two: the rush, and the spray over it |
   * | breath — a slow modulator on all of them | a fire is not steady | the WAVE, on a shore |
   * | sparks — impulses ringing resonators | the crackles | the gurgles and plops |
   *
   * **The roar and every hump are one source read through several filters**,
   * which is where a source was saved: noise is broadband, so a second
   * buffer player buys two filters' worth of independence and nothing an ear
   * can find. The BREATH is a source of its own for the opposite reason, and
   * a BUFFER of its own as well: a modulator tapped off the one-second noise
   * read at 0.33 repeats every three seconds, and a three-second breathing
   * pattern is exactly the kind of thing an ear catches — while a modulator
   * FILTERED to a sub-hertz wander is a recursion that measurably runs away
   * (`buildBreathBuffer`).
   *
   * **A HUMP IS A ROW, AND THAT IS NOT TIDINESS — IT IS THE ONE THING THE
   * EVENT ROWS CANNOT STAND IN FOR.** The first fit of the brook tried to
   * carry its 2.5–16 kHz shelf on dense spark rows, which is the fire's own
   * lesson applied in the wrong direction. It does not work and it cannot:
   * an impulse train dense enough to read as a bed is no longer isolated
   * impulses, the threshold that selects them widens into clusters, and the
   * source those clusters are cut from is band-limited by its own playback
   * rate. Measured, the top three octaves came in 4 to 8 dB under a fit whose
   * arithmetic said they were right. The fix was a second `BandSpec`, and it
   * took the brook's third-octave error from 2.9 dB rms to 1.1.
   *
   * **A CRACKLE IS AN IMPULSE RINGING A RESONATOR**, and that is the whole
   * of what makes this sound like a fire rather than like a firefight two
   * streets away. The first version of this graph gated a continuous
   * resonant band with a lowpassed noise, which cannot work and could not
   * have been tuned into working: a gate built out of a band-limited signal
   * opens as slowly as its own bandwidth, so every event had a soft attack,
   * the same length, the same pitch and nearly the same level. Measured, it
   * gave 9.4 events a second at 1500 Hz with millisecond attacks, against a
   * real fire's 24.7 a second at 7 kHz attacking in 0.15 ms — and a
   * soft-attacked mid-band transient at an even rate is not a near-miss for
   * a crackle, it is a good imitation of a distant rifle.
   *
   * So `sparkShape` thresholds the shared noise buffer SAMPLE BY SAMPLE with
   * no filter in front of it. A single sample survives as a single-sample
   * impulse — the attack is exact by construction rather than tuned — and
   * that train excites a bandpass whose ring is the decay. Three properties
   * fall out for free rather than being dialled in: the attack, the impulse
   * heights (uniform on (0, 1], which is the 14 dB of level spread the
   * reference has), and the fact that nothing is scheduled.
   *
   * **The rows are a LIST because one pitch repeated is the other half of
   * the gunfire read.** Two chains at different playback rates read
   * different slices of the buffer, so their events neither coincide nor
   * share a timbre. A third is a third row in `CONFIG.audio.ambience.fire`
   * and no code here at all — and a kind with an empty list is a wind in a
   * canopy, which is `EngineKind.rotor`'s bargain made again: what a thing
   * sounds like is a row, never a branch. **A gurgle is the same mechanism
   * spent on a different physics**: a bubble in water is a resonator struck
   * once and left to ring, exactly as a snapping fibre is, so the brook's
   * rows differ from the fire's in nothing but where they ring and how often
   * — 560 Hz at Q 14 for a plop, which is an 18 ms ringdown and about what
   * the Minnaert relation gives for a bubble that size.
   *
   * It comes up SILENT — `ambience` fades it in, for the reason stated there.
   */
  private buildAmbience(
    panner: PannerNode,
    kind: AmbienceKind,
  ): AmbienceVoice | null {
    const ctx = this.core.ctx;
    if (!ctx || !this.core.noiseBuffer || !this.breathBuffer) return null;
    try {
      const out = ctx.createGain();
      out.gain.value = 0;
      out.connect(panner);

      // The one source the roar and the sizzle share. A third of speed for
      // the same reason the engine's chug runs slow: the shared one-second
      // buffer then loops every three, under filters that leave no seam an
      // ear can find.
      const base = ctx.createBufferSource();
      base.buffer = this.core.noiseBuffer;
      base.loop = true;
      base.playbackRate.value = 0.33;

      const roarTone = ctx.createBiquadFilter();
      roarTone.type = "lowpass";
      roarTone.frequency.value = kind.roarHz;
      roarTone.Q.value = 0.7;
      const roarLevel = ctx.createGain();
      roarLevel.gain.value = kind.roarLevel;
      base.connect(roarTone).connect(roarLevel).connect(out);

      // The humps get a source of THEIR OWN, read at full speed, and the
      // reason is bandwidth rather than decorrelation: a buffer played at
      // 0.33 has no content above a third of Nyquist, so the roar's source
      // is silent over about 8 kHz. Measured, that put the 16 kHz octave
      // 11.4 dB under where the fire reference has it — a fire with the top
      // cut off it, which is most of the difference between sizzling and
      // rushing. It loops every second and nothing can hear that, because
      // what is left after these bandpasses is noise.
      //
      // ONE source for every hump, for the reason the roar shares it: noise
      // is broadband, so a second buffer player buys two filters' worth of
      // independence and nothing an ear can find.
      const bandSrc = ctx.createBufferSource();
      bandSrc.buffer = this.core.noiseBuffer;
      bandSrc.loop = true;
      bandSrc.playbackRate.value = 1;
      const bandLevels: GainNode[] = [];
      for (const band of kind.bands) {
        // In SERIES, and the count is the row's — see `BandSpec.stages`. Two
        // of a wide bandpass is a steep-skirted plateau, which is what a
        // brook's spectrum is and what no single biquad can be.
        let tone: AudioNode = bandSrc;
        for (let s = 0; s < band.stages; s++) {
          const f = ctx.createBiquadFilter();
          f.type = "bandpass";
          f.frequency.value = band.hz;
          f.Q.value = band.q;
          tone = tone.connect(f);
        }
        // DRIVEN, and the base value is the floor rather than the level: an
        // AudioParam sums its scheduled value with whatever is connected to
        // it, so the breath below swings this about `band.level` rather than
        // scaling it.
        const level = ctx.createGain();
        level.gain.value = band.level;
        tone.connect(level).connect(out);
        bandLevels.push(level);
      }

      // The breath: one loop of slow wander spent on the humps and the bottom
      // together, at its own rate.
      //
      // **The wander is BAKED and the rate is a playback rate**, which is the
      // trick the bed above already plays on the shared noise buffer — and it
      // is load-bearing rather than tidy: asked of a live `BiquadFilterNode`,
      // the shore's 0.28 Hz corner is a float32 double integrator that
      // measurably runs away, and the emitter it runs away in is the one that
      // never gets torn down. `buildBreathBuffer` carries the measurement.
      const breath = ctx.createBufferSource();
      breath.buffer = this.breathBuffer;
      breath.loop = true;
      breath.playbackRate.value = kind.breathHz / BREATH_WANDER_HZ;
      // A depth is a SHARE of the level it swings, like `SparkSpec.level`, so
      // `BandSpec.breath` is a number that can be reasoned about rather than
      // a magic one — and here that is simply the depth, because the buffer
      // is unit RMS by construction.
      //
      // It is worth knowing WHY that matters, because the term once did
      // nothing at all: a modulator arriving at ~0.023 RMS swings a bed by
      // about one per cent, and a depth stated as a plain multiplier is
      // invisible in a listen and invisible in a diff — rendered, the fire's
      // hump depth at 0.55 and at 1.0 gave a bed breathing 1.51x and 1.50x.
      // What used to divide it back out was an ESTIMATE of the filter's own
      // noise bandwidth, 4 to 10% out where it was measured; normalising the
      // buffer instead makes it exact.
      kind.bands.forEach((band, i) => {
        const depth = ctx.createGain();
        depth.gain.value = band.breath * band.level;
        breath.connect(depth).connect(bandLevels[i].gain);
      });
      // …and a share of the SAME breath on the bottom. One signal rather than
      // one per term, because a draught is one event: the flame and the
      // column of air over it surge together, and so do a wave and the foam
      // on it. A depth PER TERM, because they do not surge by the same
      // amount, and moving them all by one fraction is what reads as somebody
      // turning a volume knob rather than as weather. How far apart they are
      // is itself a claim about the sound: a fire's differ by 3.4x, because
      // its draught moves the small stuff and the column barely notices, and
      // the shore's are within a third of each other, because a wave moves
      // the whole body of water at once.
      const roarBreath = ctx.createGain();
      roarBreath.gain.value = kind.breathRoarDepth * kind.roarLevel;
      breath.connect(roarBreath).connect(roarLevel.gain);

      const sources: AudioScheduledSourceNode[] = [base, bandSrc, breath];

      // The crackles. One chain per row, and no row knows about any other.
      for (const spark of kind.sparks) {
        // The one thing about a row that fails SILENTLY, so it is checked
        // rather than only written down — see `SparkSpec.rate`.
        if (
          import.meta.env.DEV &&
          !Number.isInteger(Math.log2(spark.rate))
        ) {
          console.warn(
            `ambience: spark rate ${spark.rate} is not a power of two — this row will be quiet or silent. See SparkSpec.rate.`,
          );
        }
        const src = ctx.createBufferSource();
        src.buffer = this.core.noiseBuffer;
        src.loop = true;
        src.playbackRate.value = spark.rate;
        // A whole number of samples, so a wrap cannot leave the read position
        // on a fraction — see `SparkSpec.loop`.
        src.loopStart = 0;
        src.loopEnd = Math.round(spark.loop * ctx.sampleRate) / ctx.sampleRate;
        const shaper = ctx.createWaveShaper();
        // NO oversampling. It is the default, and it is stated because it is
        // load-bearing here and nowhere else in the audio graph: oversampling
        // filters the signal on the way in and out, which would round off
        // the single-sample impulse this whole layer is built on.
        shaper.oversample = "none";
        shaper.curve = this.sparkShape(
          sparkThreshold(spark.hz, ctx.sampleRate, spark.rate),
        );
        const ring = ctx.createBiquadFilter();
        ring.type = "bandpass";
        ring.frequency.value = spark.ringHz;
        ring.Q.value = spark.ringQ;
        const level = ctx.createGain();
        // NORMALISED, so `level` is a level rather than a magic number.
        //
        // A single-sample impulse into a bandpass does not come out at the
        // height it went in at — the filter's own impulse response opens at
        // `alpha / (1 + alpha)`, which at 7.2 kHz and Q 11 is about 0.036.
        // So the first cut of this graph, at a stated level of 0.5, put its
        // crackles 12 dB UNDER the bed and the rendered events stood 2.0 dB
        // out of it against the reference's 9.8. Dividing it back out makes
        // `spark.level` the peak of a full-height crackle, which is a number
        // that can be reasoned about and compared between rows — and it
        // tracks Q and the sample rate on its own, so retuning a resonance
        // no longer silently retunes the mix.
        const w0 = (2 * Math.PI * spark.ringHz) / ctx.sampleRate;
        const alpha = Math.sin(w0) / (2 * spark.ringQ);
        level.gain.value = spark.level * ((1 + alpha) / Math.max(1e-4, alpha));
        src.connect(shaper).connect(ring).connect(level).connect(out);
        sources.push(src);
      }

      // On the list before anything starts — `EngineVoice.sources`' rule, and
      // it is the same rule for the same reason: a source started without a
      // place on it is a voice running unheard for the rest of the session.
      for (const src of sources) src.start();
      return { sources, out, panner };
    } catch {
      return null;
    }
  }

  /**
   * The spark's transfer curve: zero everywhere except the extreme tips,
   * where it ramps to one. Cached per threshold for the reason the noise
   * buffer and the combustion shaper are cached at all.
   *
   * Public for one borrower outside this class: `Sfx.playerHurt` rings the
   * same gate at ~500 events a second for its grit, and takes the curve from
   * this cache rather than keeping a second one.
   *
   * **The table is enormous on purpose and that is the one detail here that
   * is easy to get wrong.** A `WaveShaper` indexes its curve by the INPUT
   * sample, so the resolution of the threshold is the resolution of the
   * table: at the usual 1024 points the finest threshold expressible is
   * about 0.998, which fires on two samples in a thousand — ninety-six
   * events a second, an order of magnitude past a fire. `SPARK_CURVE_POINTS`
   * (32768) resolves 6.1e-5, which puts a fifteen-a-second threshold four
   * points inside the top of the table. It is 128 KB, built once per
   * threshold and shared by every emitter after that.
   *
   * Rectifying is deliberate: the noise is signed and a fibre does not care
   * which way it snaps, so both tips are events. Below the threshold the
   * curve is FLAT ZERO rather than merely small, which is what makes the
   * silence between crackles actually silent — the resonator downstream is
   * excited by nothing at all until an impulse arrives, so its ring is the
   * whole of what is heard.
   */
  sparkShape(threshold: number): Float32Array<ArrayBuffer> {
    const cached = this.sparkCurves.get(threshold);
    if (cached) return cached;
    const n = SPARK_CURVE_POINTS;
    const curve = new Float32Array(n);
    const span = Math.max(1e-6, 1 - threshold);
    for (let i = 0; i < n; i++) {
      const u = Math.abs((i / (n - 1)) * 2 - 1);
      curve[i] = u <= threshold ? 0 : (u - threshold) / span;
    }
    this.sparkCurves.set(threshold, curve);
    return curve;
  }

  /**
   * The fade-out, and it is longer than it needs to be on purpose.
   *
   * A fire has no wind-down of its own — it is not a machine being switched
   * off — so what this spends is not mechanism but CONCEALMENT: the moment it
   * runs is a ranking decision, an emitter losing its slot or dropping out of
   * range, and that is the one thing about the whole system the player must
   * never be able to hear. Three quarters of a second of `setTargetAtTime`
   * under a rolloff that already has it near the floor is inaudible; a cut is
   * a click.
   */
  private stopAmbience(v: AmbienceVoice): void {
    if (!this.core.ctx) return;
    try {
      const t = this.core.ctx.currentTime;
      // Held where it actually is first: a voice stopped during its own
      // fade-IN is still approaching a target, and ramping from a stale value
      // would step. `EngineVoices.stopEngine`'s first three lines, for its reason.
      v.out.gain.cancelScheduledValues(t);
      v.out.gain.setValueAtTime(v.out.gain.value, t);
      v.out.gain.setTargetAtTime(0.0001, t, 0.2);
      const stop = t + 0.75;
      for (const src of v.sources) src.stop(stop);
      // BOTH nodes: dropping only the gain leaves a panner wired to the master
      // for the rest of the session — silent, and never collected.
      v.sources[0].onended = () => {
        v.out.disconnect();
        v.panner.disconnect();
      };
    } catch {
      // ignore
    }
  }

  /**
   * The ambience BREATH: one loop of slow wander, smoothed here rather than
   * by a filter in the live graph, and normalised to unit RMS.
   *
   * **It was a `BiquadFilterNode` lowpass on the shared noise, and at the
   * shore's 0.28 Hz that filter RUNS AWAY.** A two-pole lowpass at
   * `fc / fs = 5.8e-6` has both poles within 3.7e-5 of z = 1, which is a
   * double integrator with a rounding error going into it: the state is
   * float32, the residue is integrated twice, and the walk has no restoring
   * force worth the name. Measured over 300-second renders of that filter
   * alone, THREE of six diverged — a DC offset that appears after ten or
   * fifteen seconds and then climbs without bound, past ±4 by the end.
   * Nothing about it is audio; it is the recursion drifting.
   *
   * What that cost is the whole point of the fix. The breath is spent on the
   * band and roar gains through a makeup of `depth / rms` — 26x on the
   * shore's swash — so a DC of 4 arrives as a band gain of 105 against a
   * nominal 0.46, and the water comes up some 40 dB hot and still rising. It
   * is the one voice in the game that can do this, for the one reason that
   * matters: an emitter that never loses its slot is never torn down, so the
   * filter state is never reset, and a marsh map's waterline holds its slot
   * for a whole match. Rebuilt every few minutes, as a fire is when you walk
   * past it, it would never have shown.
   *
   * So the same shape is built ONCE, in doubles, where there is no recursion
   * left to drift: two one-pole passes, which is EXACTLY what the biquad was
   * (a lowpass at Q 0.5 is two coincident real poles at the corner), run
   * CYCLICALLY so the loop has no seam. The rate is then the source's
   * `playbackRate` rather than a filter corner, which is the trick the bed
   * already plays on the shared noise buffer — and 0.28 Hz is nothing
   * special to a buffer read slowly.
   *
   * **Normalised to unit RMS, which retires the estimate the makeup used to
   * divide by.** That estimate (`0.577 * sqrt(...)`) was the noise-bandwidth
   * arithmetic for the filter it no longer has, and it was 4 to 10% out
   * where it was measured — so `BandSpec.breath` and `breathRoarDepth` are
   * now exactly the fraction of their own level that they say they are.
   */
  buildBreathBuffer(): void {
    if (!this.core.ctx) return;
    const n = Math.round(BREATH_SECONDS * BREATH_BUFFER_RATE);
    const buffer = this.core.ctx.createBuffer(1, n, BREATH_BUFFER_RATE);
    // In doubles, and only the last wrap is kept: the first two are what put
    // the filter in its steady state at the buffer's START, which is what
    // makes the loop seamless — a smoothed buffer whose ends do not meet is
    // a step on a gain param once a loop, and this one loops for the length
    // of a match.
    const work = new Float64Array(n);
    for (let i = 0; i < n; i++) work[i] = Math.random() * 2 - 1;
    const a = Math.exp((-2 * Math.PI * BREATH_WANDER_HZ) / BREATH_BUFFER_RATE);
    for (let pass = 0; pass < 2; pass++) {
      let y = 0;
      for (let wrap = 0; wrap < 3; wrap++) {
        for (let i = 0; i < n; i++) {
          y = y * a + work[i] * (1 - a);
          if (wrap === 2) work[i] = y;
        }
      }
    }
    // Centred and scaled to unit RMS, so a depth is a depth. The mean matters
    // in its own right: this signal is SUMMED into a gain param, so a DC
    // offset here is a term's level quietly moved.
    let mean = 0;
    for (let i = 0; i < n; i++) mean += work[i];
    mean /= n;
    let sq = 0;
    for (let i = 0; i < n; i++) {
      work[i] -= mean;
      sq += work[i] * work[i];
    }
    const rms = Math.sqrt(sq / n) || 1;
    const data = buffer.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = work[i] / rms;
    this.breathBuffer = buffer;
  }
}
