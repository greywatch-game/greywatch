/**
 * render/ParticleField.ts — One GPU particle field's CPU HALF, as Babylon 9.28's
 * `GPUParticleSystem` kept it (`BABYLON_EXIT.md` X4.7c): the numbers a field is
 * made of, its life (`start`, `stop`, `reset`), its clock (`animate`) and its
 * emission (`emit`, the emit-rate-controlled arm of `render`) — ported line for
 * line, so its state on every frame is Babylon's by `Object.is`.
 * Owns: `ParticleField` — the settings a caller writes (the emitter and its box,
 * the directions, colours, sizes, lives, powers, gravity, rate, blend and step),
 * Babylon's defaults for every one it does not, and the state those make
 * (`started`, `stopped`, `timeDelta`, `accumulatedCount`, `currentActiveCount`,
 * `emitIndex`, `emitCount`, `writePointer`, `targetIndex`, and whether the
 * update was "created" since the last reset, the not-ready gate's one frame);
 * `ParticleFieldOptions`.
 * Invariants: every number is computed as Babylon computed it — the same
 * expression, in doubles, in the same order — and only on the calls Babylon
 * made it on: `animate` once a frame the scene draws a started field (and once
 * a pre-warm step), `emit` on a frame its `render` got past the ready gate and
 * the buffers; `currentActiveCount` only GROWS, toward `ceil(emitRate ×
 * maxLifeTime)` under the capacity, and drops on `reset` alone; a stopped field
 * accumulates nothing and is STILL STARTED, so it drains and is drawn; the GPU
 * half is `ParticleDraw`'s, which owns the buffers (`initialized` says whether
 * it holds them: not between a reset and the next update, as `_buffer0`) and
 * drives these.
 * Never: imports Babylon; touches the GPU; draws a random number (the
 * constructor's two textures and the first update's seeds are drawn by
 * `ParticleDraw`, in Babylon's calls and order); reads a clock of its own — the
 * step is handed in (`animate`'s `ratio`, `scene.getAnimationRatio()`).
 * Contract: `docs/rendering.md`, "The particles".
 *
 * WHAT IS NOT PORTED, because no field of the game's sets it: emit-rate and
 * start-size gradients, `targetStopDuration`, `startDelay`, pre-warm CYCLES (the
 * pair `animate(true)` and a pre-warm update is ported — the bench's harness
 * steps a field by it — but a field never runs it for itself), the legacy
 * (non-rate-controlled) emission, `updateInAnimate`, `isLocal`, attractors, noise,
 * flow maps, sprite sheets, and every emitter but the box. A field that needs one
 * owes this file the port, and the update a feature set (`render/particleProgram.ts`).
 */
import { Vector3 } from "../math";
import type { ParticleBlend } from "./particleProgram";

/** What a field is made with, as `GPUParticleSystem`'s options. */
export interface ParticleFieldOptions {
  /** Slots: fixed for the field's life (`Atmosphere.fit` rebuilds to move it). */
  readonly capacity: number;
  /**
   * Texels in each random texture: the DEVICE's `maxTextureDimension2D` when
   * absent, which is what Babylon's `getCaps().maxTextureSize` read (8192 on the
   * bank's box), capped by it when stated.
   */
  readonly randomTextureSize?: number;
}

export class ParticleField {
  readonly name: string;
  readonly capacity: number;
  /** The random textures' width (`_randomTextureSize`). */
  readonly randomTextureSize: number;

  /** Where the box is: a point (`emitter` a `Vector3` in Babylon's), whose world is a translation. */
  readonly emitter = new Vector3(0, 0, 0);
  /** The box emitter's corners and its two directions — `BoxParticleEmitter`'s defaults. */
  readonly minEmitBox = new Vector3(-0.5, -0.5, -0.5);
  readonly maxEmitBox = new Vector3(0.5, 0.5, 0.5);
  readonly direction1 = new Vector3(0, 1.0, 0);
  readonly direction2 = new Vector3(0, 1.0, 0);
  readonly gravity = new Vector3(0, 0, 0);
  /** rgba, as `Color4`'s four numbers: `BaseParticleSystem`'s defaults. */
  readonly color1 = [1.0, 1.0, 1.0, 1.0];
  readonly color2 = [1.0, 1.0, 1.0, 1.0];
  readonly colorDead = [0, 0, 0, 1.0];
  minSize = 1;
  maxSize = 1;
  minScaleX = 1;
  maxScaleX = 1;
  minScaleY = 1;
  maxScaleY = 1;
  minAngularSpeed = 0;
  maxAngularSpeed = 0;
  minInitialRotation = 0;
  maxInitialRotation = 0;
  minLifeTime = 1;
  maxLifeTime = 1;
  minEmitPower = 1;
  maxEmitPower = 1;
  emitRate = 10;
  /** Babylon's default is `BLENDMODE_ONEONE`, which no field here takes: every caller states one. */
  blendMode: ParticleBlend = "standard";
  updateSpeed = 0.01;
  /** A pre-warm step's length, in frames at the field's own speed. */
  preWarmStepOffset = 1;
  /** Emitted on the next update past the rate, then spent; -1 is none. */
  manualEmitCount = -1;

  // The state, under Babylon's names but for the underscore.
  started = false;
  stopped = false;
  actualFrame = 0;
  timeDelta = 0;
  accumulatedCount = 0;
  currentActiveCount = 0;
  writePointer = 0;
  emitIndex = 0;
  emitCount = 0;
  /** Which of the two buffers the next update READS (`_targetIndex`). */
  targetIndex = 0;
  /**
   * Whether the update was created since the field was made or reset
   * (`ComputeShaderParticleSystem.isUpdateBufferCreated`): the first ready test
   * after either creates it and answers NO, so a field emits from its second
   * ready frame, as Babylon's did.
   */
  updateCreated = false;
  /**
   * Whether the GPU half holds the field's two buffers, made at the first
   * update after a build or a reset and released by a reset (`_buffer0`).
   */
  initialized = false;

  constructor(name: string, options: ParticleFieldOptions, deviceMaxTexture: number) {
    this.name = name;
    this.capacity = options.capacity;
    this.randomTextureSize = Math.min(deviceMaxTexture, options.randomTextureSize ?? deviceMaxTexture);
  }

  isStarted(): boolean {
    return this.started;
  }

  isStopped(): boolean {
    return this.stopped;
  }

  /** `start()` with no delay and no gradient to rewind. */
  start(): void {
    this.started = true;
    this.stopped = false;
    this.actualFrame = 0;
  }

  /** Immediate, as on the GPU: the field keeps its slots and drains them. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
  }

  /**
   * The CPU half of `reset()`; the buffers are released by `ParticleDraw.reset`,
   * which calls this. The update is "created" again by the next ready test.
   */
  resetState(): void {
    this.updateCreated = false;
    this.currentActiveCount = 0;
    this.targetIndex = 0;
    this.writePointer = 0;
    this.emitIndex = 0;
    this.emitCount = 0;
    this.accumulatedCount = 0;
  }

  /**
   * `animate(preWarm)`: this frame's step — the field's speed times the scene's
   * animation ratio (`ratio`, `|| 1` as Babylon wrote it), or times
   * `preWarmStepOffset` for a pre-warm step.
   */
  animate(preWarm: boolean, ratio: number): void {
    this.timeDelta = this.updateSpeed * (preWarm ? this.preWarmStepOffset : ratio || 1);
    this.actualFrame += this.timeDelta;
  }

  /**
   * The emit-rate-controlled arm of `render()`: the fractional emission
   * accumulated, the slots grown toward the steady state, and the emit range
   * handed to the update off the circular write pointer.
   */
  emit(): void {
    const effectiveEmitRate = this.emitRate;
    if (this.manualEmitCount > -1) {
      this.accumulatedCount += this.manualEmitCount;
      this.manualEmitCount = 0;
    } else if (!this.stopped) {
      this.accumulatedCount += effectiveEmitRate * this.timeDelta;
    }
    let newParticles = 0;
    if (this.accumulatedCount >= 1) {
      newParticles = this.accumulatedCount | 0;
      this.accumulatedCount -= newParticles;
    }
    const steadyStateCount = Math.min(
      Math.max(Math.ceil(effectiveEmitRate * this.maxLifeTime), newParticles),
      this.capacity,
    );
    if (this.currentActiveCount < steadyStateCount && newParticles > 0) {
      const growth = Math.min(newParticles, steadyStateCount - this.currentActiveCount);
      this.currentActiveCount += growth;
    }
    if (this.currentActiveCount > 0 && newParticles > 0) {
      this.emitCount = Math.min(newParticles, this.currentActiveCount);
      this.emitIndex = this.writePointer % this.currentActiveCount;
      this.writePointer += this.emitCount;
    } else {
      this.emitCount = 0;
    }
  }
}
