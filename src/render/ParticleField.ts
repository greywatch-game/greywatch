/**
 * render/ParticleField.ts — One GPU particle field's CPU HALF, as Babylon 9.28's
 * `GPUParticleSystem` kept it (`BABYLON_EXIT.md` X4.7c, X4.7d): the numbers a
 * field is made of, its life (`start`, `stop`, `reset`), its clock (`animate`),
 * its emission (`emit`, the emit-rate-controlled arm of `render`) and, for a
 * ring, its gradients and their bakes — ported line for line, so its state on
 * every frame is Babylon's by `Object.is` and its gradient textures Babylon's
 * element for element.
 * Owns: `ParticleField` — its feature set (`features`, fixed at construction),
 * the settings a caller writes (the emitter, its box or its cylinder, the
 * directions, colours, sizes, lives, powers, gravity, rate, blend, step and a
 * ring's colour, size and velocity gradients), Babylon's defaults for every one
 * it does not, and the state those make (`started`, `stopped`, `timeDelta`,
 * `accumulatedCount`, `currentActiveCount`, `emitIndex`, `emitCount`,
 * `writePointer`, `targetIndex`, and whether the update was "created" since
 * the last reset, the not-ready gate's one frame); the bakes
 * (`bakeColorGradients`, `bakeFactorGradients`: `_bakeColorGradientData` and
 * `_bakeFactorGradientData` with `GradientHelper.GetCurrentGradient`);
 * `ParticleFieldOptions`, `ColorStop`, `FactorStop`.
 * Invariants: every number is computed as Babylon computed it — the same
 * expression, in doubles, in the same order — and only on the calls Babylon
 * made it on: `animate` once a frame the scene draws a started field (and once
 * a pre-warm step), `emit` on a frame its `render` got past the ready gate and
 * the buffers; `currentActiveCount` only GROWS, toward `ceil(emitRate ×
 * maxLifeTime)` under the capacity, and drops on `reset` alone; a stopped field
 * accumulates nothing and is STILL STARTED, so it drains and is drawn; a
 * gradient list stays sorted by its stop (Babylon's comparator, stable), and is
 * read by the bakes once, as Babylon's textures were made once, at the field's
 * first ready test (`ParticleDraw`) — so a gradient is stated before that, and
 * a field whose colours change is a NEW field (`RotorWash.build`); the GPU half
 * is `ParticleDraw`'s, which owns the buffers and the textures (`initialized`
 * says whether it holds the buffers: not between a reset and the next update,
 * as `_buffer0`) and drives these.
 * Never: imports Babylon; touches the GPU; draws a random number (the
 * constructor's two textures and the first update's seeds are drawn by
 * `ParticleDraw`, in Babylon's calls and order); reads a clock of its own — the
 * step is handed in (`animate`'s `ratio`, `scene.getAnimationRatio()`).
 * Contract: `docs/rendering.md`, "The particles".
 *
 * WHAT IS NOT PORTED, because no field of the game's sets it: emit-rate,
 * start-size, life-time, angular-speed, limit-velocity and drag gradients,
 * `targetStopDuration`, `startDelay`, pre-warm CYCLES (the pair `animate(true)`
 * and a pre-warm update is ported — the bench's harness steps a field by it —
 * but a field never runs it for itself), the legacy (non-rate-controlled)
 * emission, `updateInAnimate`, `isLocal`, attractors, noise, flow maps, sprite
 * sheets, a gradient edited after the first update (Babylon's re-bake in place),
 * and every emitter but the box and the cylinder. A field that needs one owes
 * this file the port, and the update a feature set (`render/particleProgram.ts`).
 */
import { Vector3 } from "../math";
import { GRADIENT_WIDTH, type ParticleBlend, type ParticleFeatures } from "./particleProgram";

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
  /**
   * Which of Babylon's feature sets the field is (`ParticleFeatures`): the box
   * emitter with a colour a slot, the default; or the RING — a cylinder emitter
   * with a two-row colour gradient and size and velocity gradients, which such
   * a field states before its first update (`RotorWash.buildRing`).
   */
  readonly features?: ParticleFeatures;
}

/** One colour stop, as Babylon's `ColorGradient`: rgba as `Color4`'s four numbers, and the optional second colour of its row pair. */
export interface ColorStop {
  readonly gradient: number;
  readonly color1: readonly [number, number, number, number];
  readonly color2: readonly [number, number, number, number] | undefined;
}

/** One factor stop, as Babylon's `FactorGradient`. */
export interface FactorStop {
  readonly gradient: number;
  readonly factor1: number;
  readonly factor2: number | undefined;
}

export class ParticleField {
  readonly name: string;
  readonly capacity: number;
  /** The random textures' width (`_randomTextureSize`). */
  readonly randomTextureSize: number;
  /** Its feature set, fixed at construction: which modules update and draw it. */
  readonly features: ParticleFeatures;

  /** Where the emitter is: a point (`emitter` a `Vector3` in Babylon's), whose world is a translation. */
  readonly emitter = new Vector3(0, 0, 0);
  /** The box emitter's corners and its two directions — `BoxParticleEmitter`'s defaults. */
  readonly minEmitBox = new Vector3(-0.5, -0.5, -0.5);
  readonly maxEmitBox = new Vector3(0.5, 0.5, 0.5);
  readonly direction1 = new Vector3(0, 1.0, 0);
  readonly direction2 = new Vector3(0, 1.0, 0);
  /**
   * The cylinder emitter's four numbers (a ring's; `createCylinderEmitter`'s
   * defaults), read by its update as `CylinderParticleEmitter.applyToShader`
   * wrote them.
   */
  radius = 1;
  height = 1;
  radiusRange = 1;
  directionRandomizer = 0;
  /** A ring's gradients, each kept SORTED by its stop as Babylon's `add…Gradient` sorted them. */
  readonly colorGradients: ColorStop[] = [];
  readonly sizeGradients: FactorStop[] = [];
  readonly velocityGradients: FactorStop[] = [];
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
    this.features = options.features ?? "box";
  }

  /** `addColorGradient`: a stop, the list re-sorted as Babylon sorted it. Before the first update only (the bake reads them then). */
  addColorGradient(
    gradient: number,
    color1: readonly [number, number, number, number],
    color2?: readonly [number, number, number, number],
  ): void {
    this.colorGradients.push({ gradient, color1, color2 });
    this.colorGradients.sort(byStop);
  }

  /** `addSizeGradient`, as `_addFactorGradient` adds one. */
  addSizeGradient(gradient: number, factor1: number, factor2?: number): void {
    this.sizeGradients.push({ gradient, factor1, factor2 });
    this.sizeGradients.sort(byStop);
  }

  /** `addVelocityGradient`, as `_addFactorGradient` adds one. */
  addVelocityGradient(gradient: number, factor1: number, factor2?: number): void {
    this.velocityGradients.push({ gradient, factor1, factor2 });
    this.velocityGradients.sort(byStop);
  }

  /** Whether any colour stop carries a second colour (`_hasColorGradientColor2`): the colour texture's two rows. */
  get colorGradientColor2(): boolean {
    for (const g of this.colorGradients) if (g.color2) return true;
    return false;
  }

  /**
   * `_bakeColorGradientData(height)`: the colour gradient as Babylon bakes its
   * texture — `GRADIENT_WIDTH` texels a row, each `x / width` along the stops
   * (`GradientHelper.GetCurrentGradient`), lerped as `Color4.LerpToRef` lerps,
   * in doubles, and stored as an 8-bit RGBA by the `Uint8Array`'s own
   * conversion of `channel * 255`; a second row of each stop's `color2`
   * (its `color1` where it has none) when `height` is 2.
   */
  bakeColorGradients(height: 1 | 2): Uint8Array<ArrayBuffer> {
    const width = GRADIENT_WIDTH;
    const stops = this.colorGradients;
    const data = new Uint8Array(width * 4 * height);
    const tmp = [0, 0, 0, 0];
    const lerp = (a: readonly number[], b: readonly number[], amount: number): void => {
      tmp[0] = a[0] + (b[0] - a[0]) * amount;
      tmp[1] = a[1] + (b[1] - a[1]) * amount;
      tmp[2] = a[2] + (b[2] - a[2]) * amount;
      tmp[3] = a[3] + (b[3] - a[3]) * amount;
    };
    for (let x = 0; x < width; x++) {
      const ratio = x / width;
      currentGradient(ratio, stops, (current, next, scale) => {
        lerp(current.color1, next.color1, scale);
        data[x * 4] = tmp[0] * 255;
        data[x * 4 + 1] = tmp[1] * 255;
        data[x * 4 + 2] = tmp[2] * 255;
        data[x * 4 + 3] = tmp[3] * 255;
      });
    }
    if (height === 2) {
      const rowOffset = width * 4;
      for (let x = 0; x < width; x++) {
        const ratio = x / width;
        currentGradient(ratio, stops, (current, next, scale) => {
          lerp(current.color2 ?? current.color1, next.color2 ?? next.color1, scale);
          data[rowOffset + x * 4] = tmp[0] * 255;
          data[rowOffset + x * 4 + 1] = tmp[1] * 255;
          data[rowOffset + x * 4 + 2] = tmp[2] * 255;
          data[rowOffset + x * 4 + 3] = tmp[3] * 255;
        });
      }
    }
    return data;
  }

  /**
   * `_bakeFactorGradientData`: a factor gradient as Babylon bakes its `RG`
   * float texture — `GRADIENT_WIDTH` texels, each the two factors lerped
   * (`Lerp`) at `x / width`, a stop with no second factor using its first.
   */
  bakeFactorGradients(stops: readonly FactorStop[]): Float32Array<ArrayBuffer> {
    const width = GRADIENT_WIDTH;
    const data = new Float32Array(width * 2);
    for (let x = 0; x < width; x++) {
      const ratio = x / width;
      currentGradient(ratio, stops, (current, next, scale) => {
        data[x * 2] = lerpScalar(current.factor1, next.factor1, scale);
        data[x * 2 + 1] = lerpScalar(current.factor2 ?? current.factor1, next.factor2 ?? next.factor1, scale);
      });
    }
    return data;
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

/** Babylon's comparator for a gradient list (`_addFactorGradient`, `_refreshColorGradient`): by stop, stable. */
function byStop(a: { readonly gradient: number }, b: { readonly gradient: number }): number {
  if (a.gradient < b.gradient) return -1;
  if (a.gradient > b.gradient) return 1;
  return 0;
}

/**
 * `GradientHelper.GetCurrentGradient`, line for line: the stop pair `ratio`
 * falls between and how far along it is — the first stop held below it, the
 * last held past it.
 */
function currentGradient<T extends { readonly gradient: number }>(
  ratio: number,
  gradients: readonly T[],
  update: (current: T, next: T, scale: number) => void,
): void {
  if (gradients[0].gradient > ratio) {
    update(gradients[0], gradients[0], 1.0);
    return;
  }
  for (let i = 0; i < gradients.length - 1; i++) {
    const current = gradients[i];
    const next = gradients[i + 1];
    if (ratio >= current.gradient && ratio <= next.gradient) {
      const scale = (ratio - current.gradient) / (next.gradient - current.gradient);
      update(current, next, scale);
      return;
    }
  }
  const last = gradients.length - 1;
  update(gradients[last], gradients[last], 1.0);
}

/** Babylon's `Lerp` (`math.scalar.functions`). */
function lerpScalar(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}
