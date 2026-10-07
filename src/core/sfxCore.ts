/**
 * sfxCore.ts — The handle `Sfx` gives its two sustained-voice subsystems,
 * and the few types all three files read.
 * Owns: `AudioCore` (what `EngineVoices` and `AmbienceVoices` may reach of
 * `Sfx`), `MixBus`, `BurstSpec` and `Point`. Types only — nothing here runs.
 * Invariants: `AudioCore` is the WHOLE of what a voice class may touch —
 * the context, the shared noise buffer, the mixer's buses, the listener's
 * distance, the two layer helpers and the pause flag. Everything on it is
 * read LIVE (`Sfx` answers with getters), because the context and the noise
 * buffer do not exist until `unlock` and a voice class is built before that.
 * Never: hold a bus. A `MixBus` is read into a local by the method making the
 * sound, through `AudioCore.bus`, and never kept in a field (`docs/audio.md`).
 */
import type { MixChannel, MixGroup } from "../config";

/** A world position as the panner reads one — a `Vector3` is one. */
export type Point = { x: number; y: number; z: number };

/**
 * One family's pair of taps, and the reason a fader is a NODE rather than a
 * number folded into a level.
 *
 * A sound reaches the output twice — dry through its panner and wet through
 * the shared convolver, which `Sfx.send` taps PRE-panner and which therefore
 * bypasses anything sitting between a panner and the master. So a fader
 * applied on one path only would take a family's direct sound away and leave
 * the village still answering it, which at this game's send levels is most of
 * what a distant shot IS. Two nodes carrying the same number is the whole
 * fix, and it is why every layer helper in `Sfx` is handed a bus rather than
 * a scalar.
 *
 * Both are held for the life of the context and neither is ever rebuilt: a
 * fader is a `gain.value` write on two nodes (`Sfx.setGroupMix`,
 * `Sfx.setChannelMix`), which is what makes the dev mixer's slider audible on
 * the sustained voices — an engine, a fire — as well as on the one-shots that
 * are rebuilt per trigger anyway.
 */
export interface MixBus {
  /** Into the master, after the panner. */
  dry: GainNode;
  /** Into the shared convolver, and the `send` tap's only destination. */
  wet: GainNode;
}

/**
 * One layer of `Sfx.burst` — a random slice of the shared noise buffer
 * through an optional filter, with a two-stage decay. See that method.
 */
export interface BurstSpec {
  dur: number;
  vol: number;
  /** Omitted leaves the slice unfiltered. */
  type?: BiquadFilterType;
  freq?: number;
  /** Swept to, over the layer's duration. */
  freqEnd?: number;
  /**
   * Seconds of SWELL in front of the two-stage decay, inside `dur` rather
   * than in front of it — the layer still starts now, still ends at `dur`,
   * and still sweeps its filter across the whole of it.
   *
   * **It is the one shape `Sfx.burst` could not make, and the one thing
   * that reads as APPROACH.** The two-stage decay is what says "something
   * was struck"; a source coming towards the ear says the opposite, and no
   * choice of frequency or duration substitutes for it. `Sfx.nearMiss` is
   * the only caller, and a second one should be something that ARRIVES.
   */
  rise?: number;
  q?: number;
  /** Seconds from now, on the audio clock — not a setTimeout. */
  delay?: number;
  out?: AudioNode | null;
  /** Level into the shared environment reverb, pre-panner. */
  send?: number;
  /**
   * Exempt from the voice cap — still counted, never refused. The player's
   * own report, and thunder once a layer is DUE (`Sfx.thunder` queues the
   * wait rather than scheduling it, which is what bounds it); see `Sfx.shoot`
   * for the bound that makes the report safe.
   */
  keep?: boolean;
}

/**
 * What `Sfx` lends `EngineVoices` and `AmbienceVoices`, and nothing else.
 *
 * The two sustained-voice subsystems share almost nothing with the one-shots
 * beside them, and this is the measure of how little: a context, a buffer,
 * the buses, one distance, the two layer helpers their one-shots (an engine's
 * catch) are made of, and whether the clock is stopped.
 */
export interface AudioCore {
  /** Null before `Sfx.unlock`, and the first thing every voice method asks. */
  readonly ctx: AudioContext | null;
  /** The shared one-second noise buffer, built once on unlock. */
  readonly noiseBuffer: AudioBuffer | null;
  /** True while an offline pause has the context suspended (`Sfx.setSuspended`). */
  readonly paused: boolean;
  /** One sound's taps — `Sfx.bus`. Read into a LOCAL, never a field. */
  bus(c: MixChannel, g: MixGroup): MixBus | null;
  /** Metres from the listener, as of the last `Sfx.setListener`. */
  distanceToListener(at: Point): number;
  /** `Sfx.burst`: one percussive layer, voice-capped like any other. */
  burst(bus: MixBus | null, b: BurstSpec): void;
  /** `Sfx.tone`: one pitched layer, voice-capped like any other. */
  tone(
    bus: MixBus | null,
    freq: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    freqMult: number,
    out?: AudioNode | null,
    extra?: { delay?: number; send?: number; keep?: boolean },
  ): void;
}
