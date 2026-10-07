/**
 * EngineVoices.ts — The hulls' ENGINES: one sustained voice per machine, held
 * open between a mount and a dismount for the hull the player is driving and
 * between two earshot crossings for every other one.
 * Owns: the driven hull's voice, the map of everybody else's, the combustion
 * shaper's curve, and the one graph (`buildEngine`) all of them are.
 * Reached only through `Sfx`, whose `engineOn`/`engineDrive`/`engineOff`/
 * `hullEngine`/`hullEngineOff`/`enginesOff` delegate here, and it reaches back
 * only through the `AudioCore` it is handed (`sfxCore.ts`).
 * The ENGINE has two KINDS and one graph. The hull the player is driving
 * (`engineOn`/`engineDrive`/`engineOff`) is unpanned and uncapped for the
 * reason the player's own report is; every other occupied hull within
 * `CONFIG.audio.engineRange` gets a spatialised one (`hullEngine`/
 * `hullEngineOff`/`enginesOff`), which is a sound in the world like any other.
 * That is two kinds of PLACEMENT and it is a different axis from what the
 * machine IS: `EngineKind.rotor` is the second, a nullable block that turns
 * the same graph from a piston engine geared to road wheels into a turbine
 * hung off a disc. Both arms are `buildEngine` and the fork is in
 * `driveEngine`, because the difference is not levels — it is that a rotor's
 * note is GOVERNED and a piston engine's is not.
 * Invariants: NOTHING HERE IS SCHEDULED — `Sfx`'s rule, held rather than bent:
 * a repeating sound is a timer firing one-shots, and this is a graph of
 * sources held open. The only things in it that repeat are oscillators and a
 * looping buffer, which are the audio clock's business rather than the
 * frame's, and they stop with that clock like everything else. Teardown is a
 * loop over `EngineVoice.sources`, and a source added to the graph without a
 * place on that list is a voice running unheard for the rest of the session.
 * A bus is read into a LOCAL by the method making the sound and never held in
 * a field (`docs/audio.md`, the two faders).
 * Never: a recording — see `docs/audio.md`.
 */
import type { Vector3 } from "@babylonjs/core";
import { CONFIG, type MixChannel } from "../config";
import type { AudioCore, MixBus } from "./sfxCore";

/**
 * How much louder somebody else's engine is AT SOURCE than the one the player
 * is sitting in — `hullEngine`, against `engineOn`'s reference of 1.
 *
 * A level rather than a distance, so it is here with the rest of this file's
 * levels rather than in `CONFIG.audio` with `engineRange`, which is a range.
 * What it pays for is the near field: the panner's rolloff starts biting at
 * `CONFIG.audio.engineRef` (8 m — the engine's own plateau, not the one-shot
 * `refDistance` beside it), so by the time a tank is across a street
 * it has already taken two thirds of the voice, and the numbers in
 * `driveEngine` were tuned for a graph with nothing at all in front of it.
 */
const HULL_ENGINE_LEVEL = 2.2;

/**
 * What one KIND of engine is, against the tank's own voice — see
 * `VehicleSpec.engine`, which is where the two numbers live and carries the
 * argument for each.
 *
 * Restated as a type here rather than imported from the config, because this
 * file is HANDED one by whoever owns the vehicle and has no business reaching
 * for a vehicle's block. It is the same bargain `ReportVoice` makes for a
 * weapon: the caller says what it is, and this file says what that sounds like.
 */
export interface EngineKind {
  /**
   * Its own slider on the mixer (`CONFIG.mix.channels`), stated per KIND for
   * `ReportVoice.mix`'s reason: a fourth powerplant carries its own fader and
   * this file never has to ask which vehicle it is holding. All of them sit
   * under the one `engine` group.
   */
  mix: MixChannel;
  /**
   * A multiplier on the rate every pitched layer is a multiple of — a firing
   * rate on a piston engine, a BLADE rate on a rotor.
   */
  revMult: number;
  /** How much link clatter the voice carries. A tank is 1, a wheeled vehicle 0. */
  clatter: number;
  /**
   * What hangs the machine off a DISC, or null on anything geared to its road
   * wheels — the same nullable-block bargain `VehicleSpec.flight` makes one
   * level up, made here for the same reason.
   *
   * **The two powerplants are not one set of numbers with different values,
   * and that is why this is a block and not three more fields.** A piston
   * engine geared to wheels changes NOTE with what the machine is doing; a
   * rotor is held at one governed speed and changes only how hard it is
   * WORKING. `driveEngine` reads this once and takes the other arm.
   */
  rotor: {
    /** Blade passages a second at governed rotor speed: the thump. */
    slapHz: number;
    /** The tail rotor's blade passage as a multiple of the main disc's. */
    tailRatio: number;
    /** The turbine's governed note, Hz. Answers the SPOOL and not the load. */
    turbineHz: number;
  } | null;
}

/**
 * The nodes of the tank engine — the one sustained voice in this file, held
 * open between a mount and a dismount.
 *
 * Grouped rather than kept as a dozen fields on the class, because the
 * teardown has to reach every single one of them: a node added here without a
 * line in `engineOff` is a source that runs, unheard, for the rest of the
 * session. `sources` exists for exactly that — everything that was started is
 * on it, so stopping is a loop rather than a list somebody has to keep in
 * step.
 *
 * Everything named below is something `engineDrive` MOVES. Anything the
 * throttle does not touch is wired up in `engineOn` and never referred to
 * again.
 */
interface EngineVoice {
  /**
   * What KIND of engine this is — the two numbers `VehicleSpec.engine` states,
   * held on the voice rather than passed per frame.
   *
   * Held, because `driveEngine` runs every frame for every hull in earshot and
   * what a machine IS does not change between them: a graph is built once for
   * one vehicle and the thing that varies frame to frame is how hard it is
   * being worked.
   */
  kind: EngineKind;
  /** Everything started, for the one loop that stops it all. */
  sources: AudioScheduledSourceNode[];
  /** The output tap: the engine's level, and what takes it off the bus. */
  out: GainNode;
  /**
   * Where in the world this engine is, or null for the hull the player is
   * sitting in — which is the whole of the difference between the two kinds.
   * On the teardown list in its own right: `out.disconnect()` leaves a panner
   * still wired to the master, which is silent but is one more node the graph
   * never lets go of.
   */
  panner: PannerNode | null;
  /** The firing rate — a BLADE rate on a rotor. Every pitched layer is a multiple. */
  fire: OscillatorNode;
  /**
   * How DEEP the lump chops, and it is on this list because a rotor moves it.
   *
   * A piston engine's lump is a fixed depth and its throttle is heard in the
   * filters; a disc's whole voice is the thump, so what a loaded rotor does is
   * chop harder rather than open up. Never written on a geared kind, which is
   * what keeps the two ground vehicles the voice they always were.
   */
  fireDepth: GainNode;
  /** The combustion tone, at twice the firing rate, before its shaper. */
  growl: OscillatorNode;
  /** A pure tone at the same pitch: the part of it you feel. */
  chest: OscillatorNode;
  /** The turbo's two blades, a few cents apart so they beat. */
  turbo: [OscillatorNode, OscillatorNode];
  /** How much of the rumble gets out — opens with load. */
  chugTone: BiquadFilterNode;
  /** The same question asked of the combustion tone. */
  growlTone: BiquadFilterNode;
  /** The turbo's resonant peak, swept with the spool. */
  turboTone: BiquadFilterNode;
  /** The turbo's level. Lagged, and that lag is the whole of the spool. */
  turboLevel: GainNode;
  /** Track clatter, gated by how fast the hull is actually moving. */
  trackLevel: GainNode;
  /**
   * The tail rotor, and null on anything without one — which is every kind
   * whose `EngineKind.rotor` is null. Two nodes rather than one because the
   * rate spools with the main disc and the level with it.
   */
  tail: OscillatorNode | null;
  tailLevel: GainNode | null;
}

export class EngineVoices {
  /**
   * The DRIVEN vehicle's engine — the unpanned one. Null whenever the player
   * is on foot. See `engineOn`.
   */
  private engine: EngineVoice | null = null;
  /**
   * Everybody else's, keyed by whatever the caller uses to tell one hull from
   * another. Held open for exactly as long as that hull is occupied, alive and
   * within `CONFIG.audio.engineRange` — see `hullEngine`, which is called every
   * frame rather than on a mount, and `enginesOff`, which is what a frame that
   * did not step the fleet at all owes.
   */
  private hullVoices = new Map<number, EngineVoice>();
  /**
   * The combustion shaper's curve: built on the first mount and shared by
   * every one after it, for the reason the noise buffer is.
   */
  private growlCurve: Float32Array<ArrayBuffer> | null = null;

  constructor(private readonly core: AudioCore) {}

  /**
   * The engine of the tank the PLAYER is driving: one sustained voice, started
   * on the way in and stopped on the way out.
   *
   * Deliberately NOT spatialised and deliberately NOT counted against the
   * voice cap, and that — plus the CATCH below — is the whole of what makes
   * this different from the identical graph every other hull gets through
   * `hullEngine`. It is not a sound in the world you are listening to; it is
   * the vehicle you are sitting in, the same reason the player's own report is
   * exempt.
   */
  engineOn(kind: EngineKind): void {
    const bus = this.core.bus(kind.mix, "engine");
    if (this.engine) return;
    const voice = this.buildEngine(bus, null, kind);
    if (!voice) return;
    this.engine = voice;

    // The CATCH, and it belongs to THIS voice rather than to the graph. The
    // build above comes up from silence over a couple of hundred
    // milliseconds, which on its own is a fade and not a start: three
    // one-shots make it the starter turning the engine over and the first
    // cylinders finding compression. Ordinary one-shots, scheduled on the
    // audio clock and voice-capped like any other — the sustained voice is
    // the exception in `Sfx`, and this is not part of it.
    //
    // `hullEngine` fires none of them, because what starts a voice there is a
    // tank arriving in earshot rather than a hand on a key — see that method.
    //
    // **A TURBINE does not catch, and giving it the same three one-shots was
    // three cylinders finding compression in a machine that has none.** What
    // starts one is a starter spinning air up through it before there is any
    // fire at all, which is a single rising hiss and not an event — and unlike
    // the diesel's catch it is not the start of the engine's own voice but the
    // thing that happens BEFORE it, over the top of the long spool the rotor
    // is already climbing through.
    if (kind.rotor) {
      this.core.burst(bus, {
        dur: 1.1, vol: 0.1, type: "bandpass", freq: 200, freqEnd: 900, q: 2.2,
      });
      return;
    }
    this.core.burst(bus, { dur: 0.32, vol: 0.15, type: "bandpass", freq: 400, freqEnd: 250, q: 2.4 });
    this.core.burst(bus, {
      dur: 0.5, vol: 0.4, type: "lowpass", freq: 430, freqEnd: 70, q: 0.8,
      delay: 0.24,
    });
    this.core.tone(bus, 58, 0.44, "sine", 0.36, 0.55, null, { delay: 0.26 });
  }

  /**
   * The engine graph itself: six sources held open (seven off a rotor), and the
   * ONE description in this game of what a powerplant sounds like. Both kinds
   * of voice are this method — a null `panner` is the hull the player is
   * sitting inside, wired straight onto the master bus, and a panner is
   * anybody else's — and so are both kinds of MACHINE, which is the other
   * nullable block: see `EngineKind.rotor`, read once at the top as `r`.
   *
   * **The five layers below are a diesel when `r` is null and a rotor when it
   * is not, and they are the same five layers either way** — which is not a
   * coincidence and is why this is one method rather than two. A cylinder
   * firing and a blade passing are the same event: a lump, at a rate, with air
   * moving round it. What differs is which rate, how deep the lump is, how far
   * up the whistle sits, and — the only thing that is not a number — whether a
   * governor is holding the rate still. The tail rotor is the one layer with
   * no counterpart, and it is built only when there is one.
   *
   * **This is the one graph here that does not end on its own**, and
   * the header's rule — nothing here schedules a repeating sound — is intact
   * rather than bent: a repeating sound is a timer firing one-shots, and this
   * is a graph of sources that is simply held open. The one thing in it that
   * repeats is an OSCILLATOR (the firing rate below), which is the audio
   * clock's business and not the frame's. It still stops with that clock, so a
   * pause holds it exactly as it holds the tail of the last shot.
   *
   * It comes up SILENT and at cranking speed, so a caller owes it a
   * `driveEngine` before there is anything to hear.
   *
   * **A diesel is a string of separate explosions, and that — not the spectrum
   * of any one layer — is what this voice is built around.** Filtered noise and
   * a sawtooth make a drone; the same two multiplied by a gain swinging at the
   * FIRING RATE make an engine, because the ear reads the lump as combustion
   * and everything without it as wind. Five layers hang off that idea:
   *
   * | layer | what it is for |
   * | --- | --- |
   * | chug — lowpassed noise, lumped | the mass of air a big diesel shifts |
   * | growl — a sawtooth through an asymmetric clip, lumped | the iron in it |
   * | chest — a sine well over it, lumped | the part you feel rather than hear |
   * | turbo — two beating sines through a resonance | the only layer that says TURBO, and the only one that is late |
   * | track — a resonant noise band, gated on speed | link on link, which a tank at speed has and an idling one does not |
   *
   * …and the same five read off a disc:
   *
   * | layer | what it is for |
   * | --- | --- |
   * | chug — the same lowpassed noise, lumped harder | the DOWNWASH, and the loudest thing a helicopter makes up close |
   * | growl — nearly out of the mix | there is no combustion growl in a machine that burns continuously |
   * | chest — half again, landing on the hull peak | the 95 Hz note that carries when everything over it is gone |
   * | turbo — the same two sines, plus AIR through the same peak | the turbine, and the one layer that answers the spool alone |
   * | track — silent, because `clatter` is 0 | nothing hung off a rotor runs on belts |
   * | tail — a sawtooth read through a band well above itself | the tail rotor: the buzz under the thump |
   *
   * Everything but the turbo goes through the lump, and the turbo does not
   * because a wheel spinning at forty thousand rpm does not care what the
   * crank is doing — chopping it at the firing rate would make it a further
   * cylinder rather than a compressor.
   *
   * The noise runs at a third speed so the shared one-second buffer loops every
   * three, and it is lowpassed hard enough that the seam is not a thing an ear
   * can find.
   */
  private buildEngine(
    bus: MixBus | null,
    panner: PannerNode | null,
    kind: EngineKind,
  ): EngineVoice | null {
    const ctx = this.core.ctx;
    if (!ctx || !bus || !this.core.noiseBuffer) return null;
    // **The one question this method asks about a kind, asked once.** Every
    // line below that reads it is a level or a corner frequency chosen for a
    // disc instead of for a cylinder — see `EngineKind.rotor` — and a kind
    // that states null gets the numbers this graph has always had, to the bit.
    const r = kind.rotor;
    try {
      const out = ctx.createGain();
      out.gain.value = 0;
      // When there is a panner it is already on the bus — `hullEngine`
      // builds it, because it is the node the range gate is about.
      out.connect(panner ?? bus.dry);

      // What comes off the bottom, and it is NOT a DC blocker — the shaper
      // below is asymmetric and the lump multiplies signals by a gain they are
      // phase-locked to, either of which could leave an offset behind, but
      // with the curve normalised the way `growlShape` argues the measured DC
      // is 0.0003 against a 0.36 peak and there is nothing there to remove.
      // What this is for is the band UNDER the engine: the growl's own
      // fundamental at idle is 26 Hz, which no speaker a player owns can make
      // a sound in, and the soft clip on the master is charged for every bit
      // of it.
      const lowCut = ctx.createBiquadFilter();
      lowCut.type = "highpass";
      lowCut.frequency.value = 32;
      lowCut.connect(out);

      // The hull. One resonance the whole engine is heard through, because a
      // diesel in a steel box is not a spectrum, it is a room. A peak here
      // buys more weight than any amount of level on the layers does: it
      // lifts one band rather than everything, so what comes up is the bottom
      // and not the hiss with it.
      const body = ctx.createBiquadFilter();
      body.type = "peaking";
      body.frequency.value = 92;
      body.Q.value = 1.1;
      body.gain.value = 4.5;
      body.connect(lowCut);

      // THE LUMP, and it is the whole voice. Every layer but the turbo is
      // multiplied by this one gain, so the engine breathes at the firing rate
      // instead of droning at it.
      //
      // Two details carry it. A SAWTOOTH rather than a sine, because the
      // discontinuity once a cycle is the edge of a power stroke and a sine is
      // a wobble. And the depth is NEGATIVE, which flips that saw over: a
      // positive one swells slowly and then drops, which is a firing order
      // running backwards. What is wanted is the bang first and the decay
      // after it.
      const lump = ctx.createGain();
      lump.gain.value = 0.68;
      lump.connect(body);
      const fire = ctx.createOscillator();
      fire.type = "sawtooth";
      // Cranking speed. `engineDrive` pulls this up to idle over its own
      // couple of hundred milliseconds, so the engine CATCHES rather than
      // fading in at the note it will settle on.
      fire.frequency.value = 6;
      // The saw's own edge is one SAMPLE wide, and a gain that steps in one
      // sample is a click by definition — thirteen to thirty-two of them a
      // second, which is a buzz and not a diesel. Rounding it to a couple of
      // milliseconds is what turns each firing into a thump: the attack is
      // still far faster than anything else in the mix, which is what makes it
      // read as an impact, and it is no longer a discontinuity. Measured as
      // the worst sample-to-sample jump over a whole mount-to-dismount render:
      // 0.130 without this filter against a 0.36 peak, and about 0.05 with it.
      const fireEdge = ctx.createBiquadFilter();
      fireEdge.type = "lowpass";
      // A harder edge on a disc, and the argument above is unchanged in kind:
      // 260 Hz still rounds the step to about half a millisecond, which is far
      // slower than a sample and far faster than anything else in the mix. A
      // blade slap is a CRACK where a cylinder firing is a thump, and rounding
      // both to the same corner made the rotor a soft flutter.
      fireEdge.frequency.value = r ? 260 : 190;
      fireEdge.Q.value = 0.9;
      const fireDepth = ctx.createGain();
      // The resting depth. On a rotor `driveEngine` writes this every frame —
      // the load IS the depth there — so what it is set to here is only where
      // the chop starts.
      fireDepth.gain.value = r ? -0.3 : -0.4;
      fire.connect(fireEdge).connect(fireDepth).connect(lump.gain);

      // The chug: the shared noise buffer at a third speed, lowpassed to a
      // rumble. It is the meat of the thing, and it is noise rather than a
      // tone because most of what a big diesel makes is air being moved.
      const noise = ctx.createBufferSource();
      noise.buffer = this.core.noiseBuffer;
      noise.loop = true;
      noise.playbackRate.value = 0.33;
      const chugTone = ctx.createBiquadFilter();
      chugTone.type = "lowpass";
      chugTone.frequency.value = 420;
      chugTone.Q.value = 0.8;
      const chugLevel = ctx.createGain();
      // On a disc this layer is the DOWNWASH rather than the exhaust, and it
      // is the loudest thing a helicopter makes at close range — a rotor is
      // mostly the sound of air being thrown at the ground.
      chugLevel.gain.value = r ? 1.15 : 0.88;
      noise.connect(chugTone).connect(chugLevel).connect(lump);

      // The growl: the combustion tone at twice the firing rate, bent through
      // an asymmetric soft clip. A sawtooth on its own is a buzz; what makes
      // it iron is the distortion, and what makes the distortion big rather
      // than merely dirty is that it is LOPSIDED — see `growlShape`. The
      // highpass after it takes the fundamental back OUT again: what is wanted
      // off this layer is the harmonics the shaper made, and the bottom octave
      // is the chest note's job below rather than two layers stacked on one
      // frequency.
      const growl = ctx.createOscillator();
      growl.type = "sawtooth";
      growl.frequency.value = 12;
      const growlDrive = ctx.createGain();
      growlDrive.gain.value = 1.7;
      const shaper = ctx.createWaveShaper();
      shaper.curve = this.growlShape();
      shaper.oversample = "2x";
      const growlTone = ctx.createBiquadFilter();
      growlTone.type = "lowpass";
      growlTone.frequency.value = 500;
      growlTone.Q.value = 0.8;
      const growlEdge = ctx.createBiquadFilter();
      growlEdge.type = "highpass";
      growlEdge.frequency.value = 90;
      const growlLevel = ctx.createGain();
      // Nearly out of the way on a turbine: there is no combustion growl in a
      // machine that burns continuously, and what is left of this layer there
      // is the disc's own harmonics giving the thump an edge.
      growlLevel.gain.value = r ? 0.13 : 0.32;
      growl.connect(growlDrive).connect(shaper).connect(growlTone);
      growlTone.connect(growlEdge).connect(growlLevel).connect(lump);

      // The chest: a pure sine well above the growl, sitting on the hull
      // resonance above. NOT at the growl's own pitch, which is where it
      // started: at idle that is 26 Hz, a band most speakers cannot make a
      // sound in at all, so it was heard as nothing and charged for as the
      // loudest thing in the mix.
      const chest = ctx.createOscillator();
      chest.type = "sine";
      chest.frequency.value = 30;
      const chestLevel = ctx.createGain();
      // Half again on a disc, and it lands square on the 92 Hz hull peak
      // above: five blade passages is 95 Hz, which is the note a helicopter
      // carries across a valley when everything over it has been lost.
      chestLevel.gain.value = r ? 0.3 : 0.2;
      chest.connect(chestLevel).connect(lump);

      // The turbo. Two sines a few cents apart through a resonant peak: one
      // sine is a test tone, and two beating against each other is a wheel.
      // It bypasses the lump for the reason above, and its level starts at
      // nothing because a cold turbo is not spinning.
      const turboA = ctx.createOscillator();
      turboA.type = "sine";
      turboA.frequency.value = 700;
      const turboB = ctx.createOscillator();
      turboB.type = "sine";
      turboB.frequency.value = 700;
      turboB.detune.value = 11;
      const turboTone = ctx.createBiquadFilter();
      turboTone.type = "bandpass";
      turboTone.frequency.value = 700;
      // Broader on a turbine. A turbocharger is a wheel and a narrow peak is
      // what makes it one; a turboshaft is a wheel inside a jet, and the same
      // Q there is a whistle rather than an engine.
      turboTone.Q.value = r ? 2 : 3.2;
      const turboLevel = ctx.createGain();
      turboLevel.gain.value = 0;
      turboA.connect(turboTone);
      turboB.connect(turboTone);
      turboTone.connect(turboLevel).connect(out);
      if (r) {
        // …and the jet is AIR through the same peak. Two beating sines alone
        // read as a test tone at the level a turboshaft has to sit at, and no
        // amount of detune fixes that: what is missing is not beating but
        // breadth. This costs one gain node and the noise source is already
        // running for the wash.
        const turbineAir = ctx.createGain();
        turbineAir.gain.value = 0.85;
        noise.connect(turbineAir).connect(turboTone);
      }

      // Track clatter: the same noise through a resonant band up where link
      // meets link, gated on how fast the hull is actually going. It rides
      // the lump too, so the rattle arrives in the same pulses the engine
      // does — that is a tracked vehicle lurching, rather than a hiss laid
      // over one.
      const clatter = ctx.createBiquadFilter();
      clatter.type = "bandpass";
      clatter.frequency.value = 1700;
      clatter.Q.value = 1.3;
      const trackLevel = ctx.createGain();
      trackLevel.gain.value = 0;
      noise.connect(clatter).connect(trackLevel).connect(lump);

      // The tail rotor: a small disc turning about five times as fast, and the
      // second thing after the slap that says helicopter rather than merely
      // aircraft. A SAWTOOTH read through a band well ABOVE its own
      // fundamental, because what an ear picks a tail rotor out by is the rasp
      // of its harmonics — the 93 Hz they hang off is underneath the main
      // disc's own weight and would be heard as nothing at all.
      //
      // Onto the low cut rather than into the lump, and both halves of that
      // are deliberate: a tail rotor is its own machine and is not chopped at
      // the main disc's rate, and going in past `body` keeps its fundamental
      // off a 92 Hz peak it would otherwise land square on.
      let tail: OscillatorNode | null = null;
      let tailLevel: GainNode | null = null;
      if (r) {
        tail = ctx.createOscillator();
        tail.type = "sawtooth";
        tail.frequency.value = 30;
        const tailTone = ctx.createBiquadFilter();
        tailTone.type = "bandpass";
        tailTone.frequency.value = 780;
        tailTone.Q.value = 1.6;
        tailLevel = ctx.createGain();
        tailLevel.gain.value = 0;
        tail.connect(tailTone).connect(tailLevel).connect(lowCut);
      }

      const sources: AudioScheduledSourceNode[] = [
        noise, fire, growl, chest, turboA, turboB,
      ];
      // On the list before anything starts, or it is a voice running unheard
      // for the rest of the session — see the interface's header, which is the
      // one rule this graph has.
      if (tail) sources.push(tail);
      for (const s of sources) s.start();
      return {
        kind, sources, out, panner, fire, fireDepth, growl, chest,
        turbo: [turboA, turboB], chugTone, growlTone, turboTone, turboLevel,
        trackLevel, tail, tailLevel,
      };
    } catch {
      return null;
    }
  }

  /**
   * How hard the PLAYER's engine is working, once a frame for as long as they
   * are aboard. `driveEngine` is the whole of it and carries the argument.
   */
  engineDrive(load: number, speed: number): void {
    if (this.engine) this.driveEngine(this.engine, load, speed);
  }

  /**
   * How hard one engine is working: `load` is the throttle 0..1 and `speed` is
   * how much of the vehicle's top speed it is doing.
   *
   * Shared by both kinds of voice, and a hull nobody local is driving is given
   * its own SPEED for both — see `hullEngine`, which cannot see anybody else's
   * stick and does not pretend to.
   *
   * `level` scales the whole voice and is 1 for the hull the player is inside,
   * which is the reference the levels below were tuned as. A spatialised one
   * is louder at source because it is not heard at source: the panner has
   * already taken it down by two thirds before a tank is even across the
   * street, and a number tuned for something sitting in your head with no
   * attenuation at all under it comes out as a machine you cannot hear.
   *
   * Both, not one, and they are asked different questions. SPEED is what the
   * crank is doing, so it carries the pitch and it alone gates the track
   * clatter — an engine revved on a stationary tank rattles no links. LOAD is
   * how hard it is being worked, so it carries the level and both filters:
   * standing on the throttle against a wall still sounds like work. A single
   * term would make a stalled tank silent, which is the opposite of what a
   * stalled tank sounds like.
   *
   * The pitch is not speed ALONE, though. A quarter of it is the throttle,
   * because an engine lugging against a wall pulls down toward idle rather
   * than holding the note it had rolling.
   */
  private driveEngine(
    e: EngineVoice,
    load: number,
    turning: number,
    level = 1,
  ): void {
    if (!this.core.ctx) return;
    const t = this.core.ctx.currentTime;
    // **The fork, and it is the data rather than the kind.** A rotor is not
    // this voice with different numbers in it: the note is governed, so
    // everything below that reads the machine's SPEED to decide a pitch is a
    // sentence that is false about a helicopter. See `driveRotor`.
    if (e.kind.rotor) {
      this.driveRotor(e, e.kind.rotor, load, turning, level, t);
      return;
    }
    const rev = Math.min(1, 0.75 * turning + 0.25 * load);
    // The firing rate, and every pitched layer is a multiple of it so the
    // engine changes note as one machine. 13 Hz is a lope you can count and 32
    // is a diesel working; a real V12's firing rate is far above both, and
    // taking it there trades the lump this voice is built on for a buzz.
    //
    // **`revMult` is the one thing a KIND changes about the note**, and it is a
    // multiplier on this rather than on each layer below: every pitched layer
    // is a multiple of the firing rate, so scaling it here revs the whole
    // engine as one machine. A petrol truck at 1.55 idles where the tank's
    // diesel is working, which is the whole of what tells the two apart from
    // the next street.
    const fire = (13 + 19 * rev) * e.kind.revMult;
    e.fire.frequency.setTargetAtTime(fire, t, 0.14);
    e.growl.frequency.setTargetAtTime(fire * 2, t, 0.12);
    e.chest.frequency.setTargetAtTime(fire * 5, t, 0.12);
    // Levels here are art and sit beside the rest of `Sfx`'s, which are
    // all literals for the same reason: what a layer is worth is decided by ear
    // against the others, not by a number anybody would tune from outside.
    //
    // Ramped rather than assigned, or every frame is a click. 80 ms is short
    // enough that the engine still answers the throttle inside a tenth of a
    // second and long enough that no step in it is audible.
    e.out.gain.setTargetAtTime((0.12 + 0.18 * load) * level, t, 0.08);
    e.chugTone.frequency.setTargetAtTime(420 + 900 * load, t, 0.1);
    e.growlTone.frequency.setTargetAtTime(500 + 1600 * load, t, 0.1);
    // The turbo, whose whole character is that it is LATE. A tenth of a second
    // is the rest of the engine answering the stick; six tenths is the wheel
    // getting there. So a stab of throttle is heard as the engine first and
    // the whistle arriving behind it, and letting go leaves the whistle
    // running on for a moment after the growl has dropped — which is the one
    // cue in the mix that says turbo rather than merely big.
    const spool = Math.min(1, 0.45 * turning + 0.65 * load);
    const hz = 700 + 1500 * spool;
    e.turbo[0].frequency.setTargetAtTime(hz, t, 0.6);
    e.turbo[1].frequency.setTargetAtTime(hz, t, 0.6);
    e.turboTone.frequency.setTargetAtTime(hz, t, 0.6);
    e.turboLevel.gain.setTargetAtTime(0.007 + 0.055 * spool, t, 0.55);
    // …and `clatter` is the other, and it is not a level to be balanced: it is
    // whether this thing runs on BELTS. At 0 the layer is silent and a wheeled
    // vehicle is a wheeled vehicle; anything above 0 under one is a tank
    // arriving that nobody can see.
    e.trackLevel.gain.setTargetAtTime(
      (0.006 + 0.045 * turning) * e.kind.clatter,
      t,
      0.12,
    );
  }

  /**
   * The same six sources driven as a TURBINE HANGING OFF A DISC, and the whole
   * of what makes a helicopter one.
   *
   * `turning` here is the SPOOL — how fast the rotor is going round, 0..1 of
   * governed — and `load` is DISC LOADING, how hard it is being worked. Both
   * come off the hull itself; `Vehicle.powerplant` is where they are worked
   * out and carries the argument for each.
   *
   * **The one sentence this method exists to make true: the note does not move
   * with what the machine is doing.** A rotor is held at one speed by a
   * governor, so a helicopter accelerating does not rev, a helicopter slowing
   * does not fall away, and a helicopter HOVERING is at nearly full power and
   * very nearly its loudest. Driving this voice off road speed said the
   * opposite of all three — a machine that went quiet whenever it stopped
   * moving, which is a machine flying with its engine switched off.
   *
   * So the two numbers are asked completely different questions from the ones
   * a geared engine asks:
   *
   * | | geared to wheels | hung off a disc |
   * | --- | --- | --- |
   * | the NOTE | road speed and a quarter of the throttle | the spool, and nothing else |
   * | the LEVEL | the throttle | the spool floor plus the disc loading |
   * | the LUMP | a fixed depth | the loading — a worked disc chops harder |
   * | the whistle | late, and swept by the throttle | governed, and swept by the spool alone |
   *
   * The spool is the one thing here that DOES move the note, and it is not an
   * exception: a rotor coming up to speed is a rotor whose speed is changing.
   * It is why the whole voice is written against `turning` rather than pinned
   * at governed — the machine winds up over `flight.spoolTime`, in step with
   * the disc the player is watching and with the moment it gets light on its
   * skids, and winds down again when the pilot steps out.
   */
  private driveRotor(
    e: EngineVoice,
    r: NonNullable<EngineKind["rotor"]>,
    load: number,
    turning: number,
    level: number,
    t: number,
  ): void {
    // The blade rate, and a floor under it so a disc barely turning is a flap
    // rather than a DC oscillator. `revMult` multiplies it for the reason it
    // multiplies a firing rate: everything pitched in this voice is a multiple
    // of one rate, so the machine spools as one machine.
    const blade = r.slapHz * e.kind.revMult * (0.08 + 0.92 * turning);
    // A quarter second, which is a twentieth of the spool it is following. Long
    // enough that nothing in it steps, short enough that the whine arrives with
    // the disc rather than behind it.
    e.fire.frequency.setTargetAtTime(blade, t, 0.25);
    e.growl.frequency.setTargetAtTime(blade * 2, t, 0.25);
    e.chest.frequency.setTargetAtTime(blade * 5, t, 0.25);
    if (e.tail) {
      e.tail.frequency.setTargetAtTime(blade * r.tailRatio, t, 0.25);
    }
    // THE SLAP, and it is the load. This is the line a geared engine has no
    // equivalent of: a throttle is heard in a diesel's filters because a
    // cylinder firing is the same event however hard it is working, where a
    // blade beating into its own wake is not — a loaded disc hits harder. The
    // sign is negative for `buildEngine`'s reason: the bang first, the decay
    // after it.
    e.fireDepth.gain.setTargetAtTime(-(0.36 + 0.4 * load), t, 0.12);
    // Loud at a HOVER. The spool term is what a machine hanging still over a
    // street is worth before the pilot has asked it for anything, and it is
    // most of the voice.
    e.out.gain.setTargetAtTime(
      (0.045 + 0.05 * turning + 0.2 * load) * level,
      t,
      0.1,
    );
    // The wash opens further than a diesel's does: what a loaded disc throws
    // down is air, and air is broadband where exhaust is not.
    e.chugTone.frequency.setTargetAtTime(380 + 1500 * load, t, 0.12);
    e.growlTone.frequency.setTargetAtTime(420 + 900 * load, t, 0.12);
    // The TURBINE, and it answers the spool alone — which is the whole of what
    // "governed" means and is audible as the machine holding its note through
    // a hard pull. The one exception is DROOP: a couple of per cent of sag
    // under load, which is the cue that says there is a governor working
    // rather than that the note is free to wander.
    const hz = r.turbineHz * (0.22 + 0.78 * turning) * (1 - 0.025 * load);
    // A tenth of a second rather than the turbocharger's six tenths. That lag
    // was the whole character of a turbo — a wheel getting there after the
    // engine had — and it is exactly wrong here: the spool is already IN
    // `turning`, measured off the disc the player is watching, so a lag on top
    // of it is a whine belonging to a rotor it has fallen behind.
    e.turbo[0].frequency.setTargetAtTime(hz, t, 0.12);
    e.turbo[1].frequency.setTargetAtTime(hz, t, 0.12);
    e.turboTone.frequency.setTargetAtTime(hz, t, 0.12);
    e.turboLevel.gain.setTargetAtTime(
      0.006 + 0.1 * turning + 0.04 * load,
      t,
      0.12,
    );
    if (e.tailLevel) {
      e.tailLevel.gain.setTargetAtTime(0.014 + 0.055 * turning, t, 0.12);
    }
    // `trackLevel` is deliberately not written, and it is not an omission: it
    // was built at 0 and nothing hung off a rotor runs on belts. A kind that
    // claimed both would be describing a machine that does not exist.
  }

  /**
   * Out of the vehicle: the engine stops, and its nodes are let go.
   * `stopEngine` is the wind-down and carries the argument for it.
   */
  engineOff(): void {
    const e = this.engine;
    if (!e) return;
    // Dropped before the ramps rather than after them, so `engineOn` can build
    // a fresh voice while this one is still winding down — getting straight
    // back into the same hull is an ordinary thing for a player to do, and the
    // two graphs are independent.
    this.engine = null;
    this.stopEngine(e);
  }

  /**
   * Somebody ELSE's hull, and the gap this used to be is why it exists: a tank
   * driven past you by a bot or by another player made no sound at all, and
   * armour you cannot hear is armour that arrives from nowhere.
   *
   * The same graph as `engineOn`, spatialised, one voice per `key` and DRIVEN
   * EVERY FRAME rather than opened on a mount and closed on a dismount. That
   * is the difference that matters: what is being tracked here is not somebody
   * getting in, it is a tank being within earshot, so the voice is built when
   * one comes into range and torn down when it leaves. Which is also why there
   * is no CATCH — the three one-shots `engineOn` fires are a starter motor
   * turning over, and firing them on a range crossing would be a tank starting
   * up once a street.
   *
   * `load` and `speed` are asked the way `Game.frameVehicleCamera` asks them
   * for a GUNNER: the throttle belongs to whoever is holding the stick and
   * nobody outside the hull can see it, so the hull's own speed is the honest
   * answer to both. A stationary occupied hull idles, which is what a
   * stationary occupied hull does.
   *
   * The rolloff is INVERSE, which it was alone in `Sfx` in being until the
   * one-shot panner (`Sfx.panner`) was moved onto the same model for the same
   * reason — linear over a long range is a source as loud at fifty metres as
   * at ten, and that is what makes an engine GROW as the thing arrives rather
   * than simply exist until it doesn't.
   *
   * What is still its own is the PLATEAU: `CONFIG.audio.engineRef` (8 m)
   * against a one-shot's 3, because a hull is not a point source — a tank is
   * seven metres long, so there is no useful sense in which the listener is
   * three metres from its engine. It carries `HULL_ENGINE_LEVEL` with it, so
   * the two move together or a tank goes inaudible. The rolloff is a full 1
   * here and 0.7 there for the opposite reason to the compromise made for
   * one-shots: an engine is a continuous sound the player tracks by its
   * growth, and it has `engineRange` (150 m) to grow across.
   */
  hullEngine(
    key: number,
    at: Vector3,
    load: number,
    speed: number,
    kind: EngineKind,
  ): void {
    const ctx = this.core.ctx;
    const bus = this.core.bus(kind.mix, "engine");
    if (!ctx || !bus) return;
    let voice = this.hullVoices.get(key);
    const dist = this.core.distanceToListener(at);
    // The gate, with a little hysteresis on the way back out — and the
    // hysteresis is about the BUILD rather than about the sound. By the gate
    // the rolloff has this voice below anything audible either way, so what a
    // hull idling on the boundary would otherwise cost is a six-source graph
    // torn down and stood back up every few frames.
    if (dist > CONFIG.audio.engineRange * (voice ? 1.15 : 1)) {
      this.hullEngineOff(key);
      return;
    }
    if (!voice) {
      const panner = ctx.createPanner();
      panner.panningModel = "equalpower";
      panner.distanceModel = "inverse";
      panner.refDistance = CONFIG.audio.engineRef;
      panner.rolloffFactor = 1;
      panner.connect(bus.dry);
      const built = this.buildEngine(bus, panner, kind);
      if (!built) {
        panner.disconnect();
        return;
      }
      voice = built;
      this.hullVoices.set(key, voice);
    }
    const p = voice.panner;
    if (p) {
      p.positionX.value = at.x;
      p.positionY.value = at.y;
      p.positionZ.value = at.z;
    }
    this.driveEngine(voice, load, speed, HULL_ENGINE_LEVEL);
  }

  /**
   * One hull's engine away: it emptied, it burned, or it drove out of earshot.
   * Idempotent, and it winds down rather than cutting for `stopEngine`'s
   * reason — a tank leaving is a diesel receding, which is the same half
   * second either way.
   */
  hullEngineOff(key: number): void {
    const voice = this.hullVoices.get(key);
    if (!voice) return;
    this.hullVoices.delete(key);
    this.stopEngine(voice);
  }

  /**
   * Every hull engine at once, and it is owed by two callers that look
   * unrelated and are not: a frame that did not STEP the fleet, and a map
   * being torn down.
   *
   * A held world is a fleet whose speeds are frozen, so a voice left running
   * under the deploy card is a tank droning in a street where nothing moves;
   * and a fleet that stops existing takes none of its keys with it, so the
   * per-frame `hullEngineOff` above would never be asked about them again.
   *
   * The PLAYER's own engine is deliberately not touched. That one is bracketed
   * by a mount and a dismount rather than by a frame, and every path out of a
   * seat already runs `engineOff`.
   *
   * A SUSPENDED clock is the one held world this does not answer, and refusing
   * is the whole of why it knows about `paused` at all: the offline pause card
   * stops the audio context, which is already holding these voices exactly as
   * it holds the tail of the last shot. Stopping them as well would schedule a
   * half-second wind-down that cannot run until the resume — so the frame the
   * player comes back on would hear a dying engine under the fresh one this
   * method's own caller immediately rebuilds.
   */
  enginesOff(): void {
    if (this.core.paused) return;
    for (const voice of this.hullVoices.values()) this.stopEngine(voice);
    this.hullVoices.clear();
  }

  /**
   * The wind-down, shared by both kinds of voice. The caller has already let
   * go of it — see `engineOff` — so this only has to spend it.
   *
   * It is NOT cut on the frame the player steps down, or on the frame a hull
   * leaves earshot. A diesel that is switched off falls through its own idle
   * and stops turning over about half a second later, and a graph this
   * sustained disappearing in one sample is the single moment the whole thing
   * would sound synthesized. The wind-down is scheduled on the audio clock and
   * the sources are stopped at the end of it, so a pause holds the shutdown
   * exactly as it holds everything else.
   */
  private stopEngine(e: EngineVoice): void {
    if (!this.core.ctx) return;
    try {
      const t = this.core.ctx.currentTime;
      // The level is held where it actually is first: the last frame's own
      // `setTargetAtTime` is still approaching a target, and ramping from a
      // stale value would step.
      e.out.gain.cancelScheduledValues(t);
      e.out.gain.setValueAtTime(e.out.gain.value, t);
      // A beat of it still running, then away. The pitch falls through the
      // whole of it and the turbo dies first, because a wheel with no exhaust
      // behind it stops long before the crank does.
      e.out.gain.setTargetAtTime(0.0001, t + 0.16, 0.15);
      e.turboLevel.gain.setTargetAtTime(0.0001, t, 0.1);
      e.fire.frequency.setTargetAtTime(4, t, 0.28);
      e.growl.frequency.setTargetAtTime(9, t, 0.28);
      e.chest.frequency.setTargetAtTime(18, t, 0.28);
      const stop = t + 0.6;
      for (const s of e.sources) s.stop(stop);
      // BOTH nodes: dropping only the gain leaves a panner wired to the master
      // for the rest of the session — silent, and never collected.
      e.sources[0].onended = () => {
        e.out.disconnect();
        e.panner?.disconnect();
      };
    } catch {
      // ignore
    }
  }

  /**
   * The combustion tone's distortion curve, built on the first mount and then
   * shared — the noise buffer's rule, for the noise buffer's reason.
   *
   * **Asymmetric on purpose.** A symmetric clip folds a sawtooth into odd
   * harmonics only, which is a rasp; offsetting the curve puts EVEN ones in
   * beside them, and the even harmonics are the difference between an engine
   * that sounds big and one that just sounds dirty. The offset is subtracted
   * back out at zero, so the curve passes zero through and adds no DC of its
   * own at rest.
   */
  private growlShape(): Float32Array<ArrayBuffer> {
    if (this.growlCurve) return this.growlCurve;
    const curve = new Float32Array(1024);
    const k = 2.4;
    const bias = 0.14;
    const zero = Math.tanh(k * bias);
    // Normalised by the curve's own PEAK and not by the span of one half of
    // it, which is worth stating because getting that wrong does not look like
    // a bug: dividing by the positive half's span left the negative half with
    // a gain of TEN, and what that sounds like is an engine — a very loud one,
    // drowning every other layer by 26 dB, with the whole mix under 90 Hz.
    let peak = 0;
    for (let i = 0; i < curve.length; i++) {
      const u = (i / (curve.length - 1)) * 2 - 1;
      const y = Math.tanh(k * (u + bias)) - zero;
      curve[i] = y;
      peak = Math.max(peak, Math.abs(y));
    }
    for (let i = 0; i < curve.length; i++) curve[i] /= peak;
    this.growlCurve = curve;
    return curve;
  }
}
