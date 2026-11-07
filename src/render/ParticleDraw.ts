/**
 * render/ParticleDraw.ts — Every GPU particle field of the game's, run by OUR
 * renderer (`BABYLON_EXIT.md` X4.7c: the ash; X4.7d: the rotor wash), updated
 * in compute and drawn in the main pass where Babylon's group drew its
 * particles — what `GPUParticleSystem` on `ComputeShaderParticleSystem` did
 * until then, ported exactly: its buffers, its random textures, its gradient
 * textures, its ready gate, its clock, its emission, its update and its draw.
 * Owns: `ParticleDraw` — the fields in ONE list in creation order, a disposed
 * one taken out (`scene.particleSystems`' rule, so a rebuilt field goes to the
 * end); each field's GPU half (its two random textures, its update's
 * `SimParams` buffer, its draw's block, a ring's three gradient textures and
 * the update's group over two of them, and from its first update its two
 * particle buffers and the bind groups over them); every pipeline of both
 * feature sets, asked once (`ready`); the one sprite buffer, the pass's
 * `Internals` and the two gradient samplers; the switch every field obeys
 * (`enabled`, `scene.particlesEnabled`'s twin); the prepare that steps every
 * started field and dispatches its update, and the draw; what the last frame
 * drew (`stats`); `ParticleCamera`.
 * Invariants: **a field is Babylon's field by construction**: its random textures
 * are drawn at `create` (`Math.random`, 4 × `randomTextureSize` for the first,
 * then as many for the second, Babylon's constructor order) and its slots'
 * seeds at its first update after a create or a `reset` (4 a slot, in slot order:
 * `_initialize`), and nowhere else; a ring's gradient textures are baked at its
 * first ready test that creates the update (`_recreateUpdateEffect`'s
 * `_create…GradientTexture`), once for the field's life — a reset keeps them,
 * as Babylon's kept them — the colour an `rgba8unorm` of `GRADIENT_WIDTH` × 2,
 * the size and velocity `rg32float` of `GRADIENT_WIDTH` × 1, each written as
 * the field baked it; each frame the scene draws with the switch on, every
 * STARTED field is stepped — `animate` at `ratio`, the scene's animation ratio
 * — then, past the ready gate (`isReady`, the field's texture and both its
 * pipelines, and the update "created" a frame after a create or a reset), its
 * buffers made, its emission run and, with a live count, its update dispatched
 * into the host's prepare encoder, OUTSIDE the main pass
 * (`FrameHost.prepareEncoder`, so no field splits the pass, as each dispatch
 * of Babylon's did) — and drawn; the update reads the buffer `targetIndex`
 * names and writes the other, and the DRAW reads the buffer the update READ —
 * `_createVertexBuffers`' crossed lists, bound at the incremented index — so a
 * frame draws the slots as the previous update left them, as Babylon's did;
 * the draw is at `"particles"`, behind the turf and ahead of the moon, in this
 * list's order — the order Babylon's `scene.particleSystems` held, so a field
 * rebuilt (the motes after an edit of their count, a ring after a new palette)
 * is drawn behind every field made before it; each draw is an instanced strip of four, `currentActiveCount`
 * instances, no frustum test and no size gate, as Babylon dispatched it to group
 * 0 by its emitter; the camera's view and projection are handed APART, with the
 * view's inverse and the eye (`ParticleCamera`, read off the scene by `Game` as
 * this frame draws it), and every other value is the field's own; no particle is
 * drawn in the glow's mask, a shadow map or a bake; a field's buffers and
 * textures are released by `reset` and `dispose`, which are called only OUTSIDE
 * the render (an install, a teardown, the editor's rebuild, a harness) — never
 * while a frame's recording holds them; nothing here allocates on a frame.
 * Never: imports Babylon; reads a node, a camera or a mesh; draws a random number
 * outside `create` and a field's first update; decides what a field emits (its
 * owner's: `systems/Atmosphere.ts`, `systems/RotorWash.ts`).
 * Contract: `docs/rendering.md`, "The particles".
 */
import type { HostTexture } from "./frameHost";
import { HostBindGroup, OwnTexture, type TextureHandles } from "./HostBindGroup";
import type { BuiltPipeline } from "./PipelineCache";
import { ParticleField, type ParticleFieldOptions } from "./ParticleField";
import {
  FEATURE_BLENDS,
  GRADIENT_WIDTH,
  PARAMS,
  PARAMS_BYTES,
  PARTICLE_BLOCK,
  PARTICLE_GROUP,
  PARTICLE_INTERNALS,
  PARTICLE_RING_BLOCK,
  PARTICLE_RING_GROUP,
  PARTICLE_SPRITE,
  RING_COLOR_SAMPLER,
  RING_FACTOR_SAMPLER,
  RING_PARAMS,
  RING_PARAMS_BYTES,
  particlePipelines,
  type ParticleBlend,
  type ParticleFeatures,
} from "./particleProgram";
import type { FrameContext, Renderer } from "./Renderer";
import { FRAME_TARGETS } from "./targets";
import { UniformBlockBuffer } from "./UniformBlockBuffer";
import { PARTICLE_RING_STRIDE, PARTICLE_STRIDE } from "../shaders/wgsl/particles";

/** The camera as the frame draws it: what `GPUParticleSystem._render` bound, read by `Game`. */
export interface ParticleCamera {
  /** `scene.getViewMatrix().m`. */
  readonly view: Float32Array;
  /** `scene.getProjectionMatrix().m`. */
  readonly projection: Float32Array;
  /** The view's inverse, as `viewMatrix.invertToRef` made it. */
  readonly invView: Float32Array;
  /** `activeCamera.globalPosition`. */
  readonly eye: Float32Array;
}

const NO_DEFINES: readonly string[] = [];

/** The floats a slot takes in each feature set's buffer (`_attributesStrideSize`). */
const STRIDE: Readonly<Record<ParticleFeatures, number>> = { box: PARTICLE_STRIDE, ring: PARTICLE_RING_STRIDE };

/** A field's buffers from its first update until a reset: two of them, and the groups over them. */
interface Buffers {
  readonly data: readonly [GPUBuffer, GPUBuffer];
  /** The update's group with `data[t]` in and `data[t ^ 1]` out, made at its first dispatch. */
  readonly update: [GPUBindGroup | null, GPUBindGroup | null];
  /** The draw's group at index `t`: `data[t ^ 1]`, `_renderVertexBuffers`' crossing. */
  readonly draw: readonly [HostBindGroup, HostBindGroup];
}

/** A ring's gradient textures, baked once at its first update's creation. */
interface Gradients {
  readonly textures: readonly GPUTexture[];
  /** The colour's, as the draw's group binds it. */
  readonly color: OwnTexture;
  /** The update's group 1: the size and velocity gradients, made against the pipeline's layout. */
  group: GPUBindGroup | null;
  readonly size: GPUTextureView;
  readonly velocity: GPUTextureView;
}

/** The draw's block values: the box's and the ring's (no `colorDead`) share every array but that one. */
type DrawValues = {
  readonly view: Float32Array;
  readonly projection: Float32Array;
  readonly translationPivot: Float32Array;
  readonly worldOffset: Float32Array;
  readonly invView: Float32Array;
  readonly colorDead?: Float32Array;
  readonly eyePosition: Float32Array;
};

/** A field's GPU half. */
interface Slot {
  readonly field: ParticleField;
  readonly texture: HostTexture;
  readonly textureReady: () => boolean;
  readonly random: readonly [GPUTexture, GPUTexture];
  readonly randomViews: readonly [GPUTextureView, GPUTextureView];
  readonly params: GPUBuffer;
  readonly paramFloats: Float32Array<ArrayBuffer>;
  readonly paramInts: Int32Array<ArrayBuffer>;
  readonly block: UniformBlockBuffer;
  readonly values: DrawValues;
  /** The draw's texture handles, the field's own record so a frame's refresh allocates nothing. */
  readonly handles: { diffuseSampler: HostTexture; colorGradientSampler?: OwnTexture };
  gradients: Gradients | null;
  buffers: Buffers | null;
  /** This frame's draw: instances, 0 for none. */
  drawCount: number;
}

export class ParticleDraw {
  /** Whether every pipeline built — asked once, for the session; false if one failed. */
  readonly ready: Promise<boolean>;
  /** What the last frame drew: a draw a field. No outcome reads it; a capture does (`Game`'s `prof.setPools`), and the census. */
  readonly stats = { drawn: 0 };
  /**
   * Whether fields are stepped and drawn at all — `scene.particlesEnabled`'s
   * twin, which the bank's freeze turns off and on; the game never does.
   */
  enabled = true;
  /** Every field, in creation order: the order they are stepped and drawn in. */
  readonly fields: ParticleField[] = [];

  private readonly device: GPUDevice;
  private readonly slots: Slot[] = [];
  private readonly update: Record<ParticleFeatures, GPUComputePipeline | null> = { box: null, ring: null };
  private readonly render: Record<ParticleFeatures, Partial<Record<ParticleBlend, BuiltPipeline>>> = { box: {}, ring: {} };
  private readonly sprite: GPUBuffer;
  private readonly internals: UniformBlockBuffer;
  /** The ring's two samplers, made at its first bake (`RING_COLOR_SAMPLER`, `RING_FACTOR_SAMPLER`). */
  private samplers: { readonly color: GPUSampler; readonly factor: GPUSampler } | null = null;
  /** The camera this frame, filled once a frame something draws. */
  private readonly camera: ParticleCamera = {
    view: new Float32Array(16),
    projection: new Float32Array(16),
    invView: new Float32Array(16),
    eye: new Float32Array(3),
  };
  private readonly zero2 = new Float32Array(2);
  private readonly zero3 = new Float32Array(3);
  private readonly deviceMaxTexture: number;

  constructor(
    private readonly renderer: Renderer,
    /** Fills the camera as this frame draws it (`ParticleCamera`). */
    private readonly readCamera: (out: ParticleCamera) => void,
    /** The scene's animation ratio this frame (`scene.getAnimationRatio()`): the fields' clock. */
    private readonly ratio: () => number,
  ) {
    const device = renderer.device;
    this.device = device;
    this.deviceMaxTexture = device.limits.maxTextureDimension2D;
    const asked = particlePipelines(renderer.pipelines);
    const keep = <T>(p: Promise<T>, put: (t: T) => void): Promise<boolean> =>
      p.then(
        (built) => {
          put(built);
          return true;
        },
        (err: unknown) => {
          console.error("particles: a pipeline did not build; no particle field can be drawn", err);
          return false;
        },
      );
    const waits: Promise<boolean>[] = [];
    for (const features of ["box", "ring"] as const) {
      const set = asked[features];
      waits.push(keep(set.update, (p) => (this.update[features] = p)));
      for (const blend of FEATURE_BLENDS[features]) {
        const render = set.render[blend];
        if (render) waits.push(keep(render, (p) => (this.render[features][blend] = p)));
      }
    }
    this.ready = Promise.all(waits).then((oks) => oks.every(Boolean));

    this.sprite = device.createBuffer({
      label: "particles: sprite",
      size: PARTICLE_SPRITE.byteLength,
      usage: GPUBufferUsage.STORAGE,
      mappedAtCreation: true,
    });
    new Float32Array(this.sprite.getMappedRange()).set(PARTICLE_SPRITE);
    this.sprite.unmap();
    this.internals = new UniformBlockBuffer(device, PARTICLE_INTERNALS, NO_DEFINES, "particles: internals");
    // The pass's y flip, as Babylon's processor wrote it: -1 into the frame's texture.
    this.internals.write({ yFactor_: new Float32Array([FRAME_TARGETS.flipY ? -1 : 1]) });

    renderer.onFrame(this.prepare);
    renderer.add(this.draw, "particles", this.active);
  }

  /**
   * A field, built and at the END of the list: its two random textures drawn
   * now, as Babylon's constructor drew them. Not started (`ParticleField.start`).
   */
  create(name: string, options: ParticleFieldOptions, texture: HostTexture, textureReady: () => boolean): ParticleField {
    const field = new ParticleField(name, options, this.deviceMaxTexture);
    const n = field.randomTextureSize;
    const device = this.device;
    const randomTexture = (label: string): [GPUTexture, GPUTextureView] => {
      const d = new Float32Array(n * 4);
      for (let i = 0; i < n * 4; i++) d[i] = Math.random();
      const t = device.createTexture({
        label: `particles: ${name} ${label}`,
        size: [n, 1],
        format: "rgba32float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      device.queue.writeTexture({ texture: t }, d, { bytesPerRow: n * 16 }, [n, 1]);
      return [t, t.createView()];
    };
    const [r1, v1] = randomTexture("random1");
    const [r2, v2] = randomTexture("random2");
    const ring = field.features === "ring";
    const bytes = ring ? RING_PARAMS_BYTES : PARAMS_BYTES;
    const params = new ArrayBuffer(bytes);
    const values: DrawValues = {
      view: this.camera.view,
      projection: this.camera.projection,
      translationPivot: this.zero2,
      worldOffset: this.zero3,
      invView: this.camera.invView,
      ...(ring ? {} : { colorDead: new Float32Array(4) }),
      eyePosition: this.camera.eye,
    };
    const slot: Slot = {
      field,
      texture,
      textureReady,
      random: [r1, r2],
      randomViews: [v1, v2],
      params: device.createBuffer({
        label: `particles: ${name} params`,
        size: bytes,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
      paramFloats: new Float32Array(params),
      paramInts: new Int32Array(params),
      block: new UniformBlockBuffer(device, ring ? PARTICLE_RING_BLOCK : PARTICLE_BLOCK, NO_DEFINES, `particles: ${name} block`),
      values,
      handles: { diffuseSampler: texture },
      gradients: null,
      buffers: null,
      drawCount: 0,
    };
    this.fields.push(field);
    this.slots.push(slot);
    return field;
  }

  /** The field gone: out of the list, and every GPU resource of its released. Outside the render only. */
  dispose(field: ParticleField): void {
    const i = this.fields.indexOf(field);
    if (i < 0) return;
    const slot = this.slots[i];
    this.release(slot);
    slot.random[0].destroy();
    slot.random[1].destroy();
    slot.params.destroy();
    slot.block.destroy();
    if (slot.gradients) for (const t of slot.gradients.textures) t.destroy();
    slot.gradients = null;
    this.fields.splice(i, 1);
    this.slots.splice(i, 1);
  }

  /**
   * `reset()`: every slot emptied — the buffers released, the CPU half zeroed.
   * A ring's gradient textures stay, as Babylon's did. Outside the render only.
   */
  reset(field: ParticleField): void {
    const slot = this.slotOf(field);
    this.release(slot);
    field.resetState();
  }

  /**
   * `isReady()`: the texture, the draw's pipeline for the field's blend, and the
   * update — which the first test after a create or a reset CREATES and answers
   * no, as Babylon's platform did (a ring's gradient textures baked then, the
   * first time, as `_recreateUpdateEffect` made them).
   */
  isReady(field: ParticleField): boolean {
    return this.readyOf(this.slotOf(field));
  }

  /**
   * One pre-warm step NOW, outside any frame (`animate(true)`, then
   * `render(true, true)`): stepped at `preWarmStepOffset`, updated, not drawn,
   * its dispatch submitted at once — so a second step in the same frame reads
   * the first's output and its own parameters. The bank's harness steps a field
   * by it; nothing in the game does.
   */
  preWarmStep(field: ParticleField): void {
    const slot = this.slotOf(field);
    field.animate(true, 1);
    const encoder = this.device.createCommandEncoder({ label: `particles: ${field.name} pre-warm` });
    this.step(slot, true, encoder);
    this.device.queue.submit([encoder.finish()]);
  }

  private slotOf(field: ParticleField): Slot {
    const i = this.fields.indexOf(field);
    if (i < 0) throw new Error(`particles: ${field.name} is not one of this draw's fields`);
    return this.slots[i];
  }

  private release(slot: Slot): void {
    const b = slot.buffers;
    if (b) {
      b.data[0].destroy();
      b.data[1].destroy();
    }
    slot.buffers = null;
    slot.drawCount = 0;
    slot.field.initialized = false;
  }

  private readyOf(slot: Slot): boolean {
    const field = slot.field;
    if (!slot.textureReady()) return false;
    if (!this.render[field.features][field.blendMode]) return false;
    if (!field.updateCreated) {
      field.updateCreated = true;
      if (field.features === "ring" && !slot.gradients) this.bake(slot);
      return false;
    }
    return this.update[field.features] !== null;
  }

  /**
   * A ring's three gradient textures, as `_recreateUpdateEffect` made them on
   * its first call (`_createColorGradientTexture`, `_createSizeGradientTexture`,
   * `_createVelocityGradientTexture`): baked off the field's stops
   * (`ParticleField.bakeColorGradients`, `bakeFactorGradients`) and written
   * whole. The ring's modules are compiled for exactly this set, two colour
   * rows included, so a ring missing one is refused rather than drawn wrong.
   */
  private bake(slot: Slot): void {
    const field = slot.field;
    if (!field.colorGradients.length || !field.sizeGradients.length || !field.velocityGradients.length || !field.colorGradientColor2) {
      throw new Error(`particles: ${field.name} is a ring with a gradient missing; its modules are compiled for all three, two colour rows`);
    }
    const device = this.device;
    this.samplers ??= {
      color: device.createSampler(RING_COLOR_SAMPLER),
      factor: device.createSampler(RING_FACTOR_SAMPLER),
    };
    const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST;
    const color = device.createTexture({
      label: `particles: ${field.name} colour gradient`,
      size: [GRADIENT_WIDTH, 2],
      format: "rgba8unorm",
      usage,
    });
    device.queue.writeTexture({ texture: color }, field.bakeColorGradients(2), { bytesPerRow: GRADIENT_WIDTH * 4 }, [GRADIENT_WIDTH, 2]);
    const factor = (label: string, data: Float32Array<ArrayBuffer>): GPUTexture => {
      const t = device.createTexture({ label: `particles: ${field.name} ${label}`, size: [GRADIENT_WIDTH, 1], format: "rg32float", usage });
      device.queue.writeTexture({ texture: t }, data, { bytesPerRow: GRADIENT_WIDTH * 8 }, [GRADIENT_WIDTH, 1]);
      return t;
    };
    const size = factor("size gradient", field.bakeFactorGradients(field.sizeGradients));
    const velocity = factor("velocity gradient", field.bakeFactorGradients(field.velocityGradients));
    const own = new OwnTexture();
    own.view = color.createView();
    own.sampler = this.samplers.color;
    slot.gradients = { textures: [color, size, velocity], color: own, group: null, size: size.createView(), velocity: velocity.createView() };
    slot.handles.colorGradientSampler = own;
  }

  /** Whether any field may draw this frame: the switch on and one started. Allocates nothing. */
  private readonly active = (): boolean => {
    if (!this.enabled) return false;
    const fields = this.fields;
    for (let i = 0; i < fields.length; i++) if (fields[i].started) return true;
    return false;
  };

  /**
   * As the main pass begins: every started field stepped and, past its gate,
   * emitted, updated into `encoder` and marked to draw — in the list's order.
   */
  private readonly prepare = (_frame: unknown, encoder: GPUCommandEncoder): void => {
    this.stats.drawn = 0;
    const slots = this.slots;
    for (let i = 0; i < slots.length; i++) slots[i].drawCount = 0;
    if (!this.enabled) return;
    let camera = false;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const field = slot.field;
      if (!field.started) continue;
      field.animate(false, this.ratio());
      const count = this.step(slot, false, encoder);
      if (count === 0) continue;
      slot.drawCount = count;
      if (!camera) {
        this.readCamera(this.camera);
        camera = true;
      }
      const dead = slot.values.colorDead;
      if (dead) {
        const c = field.colorDead;
        dead[0] = c[0];
        dead[1] = c[1];
        dead[2] = c[2];
        dead[3] = c[3];
      }
      slot.block.write(slot.values);
      const b = slot.buffers!;
      b.draw[field.targetIndex].refresh(this.renderer.host, slot.handles as TextureHandles);
    }
  };

  /**
   * `render(preWarm, true)` for a pre-warm step, `render(false, false)` for a
   * frame's: the gate, the buffers, the emission, the update. Returns the
   * instances the frame draws (0 for a pre-warm step, as for none).
   */
  private step(slot: Slot, preWarm: boolean, encoder: GPUCommandEncoder): number {
    const field = slot.field;
    if (!field.started) return 0;
    if (!this.readyOf(slot)) return 0;
    this.initialize(slot);
    field.emit();
    if (!field.currentActiveCount) return 0;
    this.dispatch(slot, encoder);
    return preWarm ? 0 : field.currentActiveCount;
  }

  /** `_initialize`: the two buffers, every slot dead, its seed drawn — once, until a reset. */
  private initialize(slot: Slot): void {
    if (slot.buffers) return;
    const field = slot.field;
    field.targetIndex = 0;
    const capacity = field.capacity;
    const stride = STRIDE[field.features];
    const data = new Float32Array(capacity * stride);
    for (let i = 0, at = 8; i < capacity; i++, at += stride) {
      data[at] = Math.random();
      data[at + 1] = Math.random();
      data[at + 2] = Math.random();
      data[at + 3] = Math.random();
    }
    const device = this.device;
    const buffer = (label: string): GPUBuffer => {
      const b = device.createBuffer({
        label: `particles: ${field.name} ${label}`,
        size: data.byteLength,
        usage: GPUBufferUsage.STORAGE,
        mappedAtCreation: true,
      });
      new Float32Array(b.getMappedRange()).set(data);
      b.unmap();
      return b;
    };
    const d0 = buffer("buffer0");
    const d1 = buffer("buffer1");
    const ring = field.features === "ring";
    const group = (source: GPUBuffer, label: string): HostBindGroup =>
      new HostBindGroup(device, `particles: ${field.name} draw ${label}`, ring ? PARTICLE_RING_GROUP : PARTICLE_GROUP, NO_DEFINES, {
        [PARTICLE_BLOCK.var]: slot.block.buffer,
        [PARTICLE_INTERNALS.var]: this.internals.buffer,
        particleData: source,
        spriteData: this.sprite,
      });
    slot.buffers = { data: [d0, d1], update: [null, null], draw: [group(d1, "0"), group(d0, "1")] };
    field.initialized = true;
  }

  /** `_update`: this step's `SimParams` written and the update dispatched over the live slots; then the buffers swap. */
  private dispatch(slot: Slot, encoder: GPUCommandEncoder): void {
    const field = slot.field;
    const update = this.update[field.features];
    const b = slot.buffers;
    if (!update || !b) return;
    const ring = field.features === "ring";
    if (ring) this.writeRingParams(slot);
    else this.writeBoxParams(slot);
    this.device.queue.writeBuffer(slot.params, 0, slot.paramFloats);

    const t = field.targetIndex;
    let group = b.update[t];
    if (!group) {
      group = this.device.createBindGroup({
        label: `particles: ${field.name} update ${t}`,
        layout: update.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: slot.params } },
          { binding: 1, resource: { buffer: b.data[t] } },
          { binding: 2, resource: { buffer: b.data[t ^ 1] } },
          { binding: 3, resource: slot.randomViews[0] },
          { binding: 4, resource: slot.randomViews[1] },
        ],
      });
      b.update[t] = group;
    }
    const pass = encoder.beginComputePass(UPDATE_PASS);
    pass.setPipeline(update);
    pass.setBindGroup(0, group);
    if (ring) pass.setBindGroup(1, this.gradientGroup(slot, update));
    pass.dispatchWorkgroups(Math.ceil(field.currentActiveCount / 64));
    pass.end();
    field.targetIndex = t === 0 ? 1 : 0;
  }

  /** A ring's update group 1 — the size and velocity gradients — made once, at its first dispatch. */
  private gradientGroup(slot: Slot, update: GPUComputePipeline): GPUBindGroup {
    const g = slot.gradients!;
    if (g.group) return g.group;
    const sampler = this.samplers!.factor;
    g.group = this.device.createBindGroup({
      label: `particles: ${slot.field.name} gradients`,
      layout: update.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: g.size },
        { binding: 4, resource: sampler },
        { binding: 5, resource: g.velocity },
      ],
    });
    return g.group;
  }

  /** The box's `SimParams`, as `_update` set them (`BoxParticleEmitter.applyToShader` last). */
  private writeBoxParams(slot: Slot): void {
    const field = slot.field;
    const f = slot.paramFloats;
    f[PARAMS.currentCount] = field.currentActiveCount;
    f[PARAMS.timeDelta] = field.timeDelta;
    f[PARAMS.stopFactor] = field.stopped ? 0 : 1;
    f[PARAMS.emitIndex] = field.emitIndex;
    f[PARAMS.emitCount] = field.emitCount;
    slot.paramInts[PARAMS.randomTextureSize] = field.randomTextureSize;
    f[PARAMS.lifeTime] = field.minLifeTime;
    f[PARAMS.lifeTime + 1] = field.maxLifeTime;
    f[PARAMS.emitPower] = field.minEmitPower;
    f[PARAMS.emitPower + 1] = field.maxEmitPower;
    f.set(field.color1, PARAMS.color1);
    f.set(field.color2, PARAMS.color2);
    f[PARAMS.sizeRange] = field.minSize;
    f[PARAMS.sizeRange + 1] = field.maxSize;
    f[PARAMS.scaleRange] = field.minScaleX;
    f[PARAMS.scaleRange + 1] = field.maxScaleX;
    f[PARAMS.scaleRange + 2] = field.minScaleY;
    f[PARAMS.scaleRange + 3] = field.maxScaleY;
    f[PARAMS.angleRange] = field.minAngularSpeed;
    f[PARAMS.angleRange + 1] = field.maxAngularSpeed;
    f[PARAMS.angleRange + 2] = field.minInitialRotation;
    f[PARAMS.angleRange + 3] = field.maxInitialRotation;
    putVector(f, PARAMS.gravity, field.gravity);
    putEmitter(f, PARAMS.emitterWM, field);
    putVector(f, PARAMS.direction1, field.direction1);
    putVector(f, PARAMS.direction2, field.direction2);
    putVector(f, PARAMS.minEmitBox, field.minEmitBox);
    putVector(f, PARAMS.maxEmitBox, field.maxEmitBox);
  }

  /**
   * The ring's `SimParams`, as `_update` set them for this feature set: no
   * colours (a gradient carries them), and `CylinderParticleEmitter.applyToShader`'s
   * four numbers last.
   */
  private writeRingParams(slot: Slot): void {
    const field = slot.field;
    const f = slot.paramFloats;
    f[RING_PARAMS.currentCount] = field.currentActiveCount;
    f[RING_PARAMS.timeDelta] = field.timeDelta;
    f[RING_PARAMS.stopFactor] = field.stopped ? 0 : 1;
    f[RING_PARAMS.emitIndex] = field.emitIndex;
    f[RING_PARAMS.emitCount] = field.emitCount;
    slot.paramInts[RING_PARAMS.randomTextureSize] = field.randomTextureSize;
    f[RING_PARAMS.lifeTime] = field.minLifeTime;
    f[RING_PARAMS.lifeTime + 1] = field.maxLifeTime;
    f[RING_PARAMS.emitPower] = field.minEmitPower;
    f[RING_PARAMS.emitPower + 1] = field.maxEmitPower;
    f[RING_PARAMS.sizeRange] = field.minSize;
    f[RING_PARAMS.sizeRange + 1] = field.maxSize;
    f[RING_PARAMS.scaleRange] = field.minScaleX;
    f[RING_PARAMS.scaleRange + 1] = field.maxScaleX;
    f[RING_PARAMS.scaleRange + 2] = field.minScaleY;
    f[RING_PARAMS.scaleRange + 3] = field.maxScaleY;
    f[RING_PARAMS.angleRange] = field.minAngularSpeed;
    f[RING_PARAMS.angleRange + 1] = field.maxAngularSpeed;
    f[RING_PARAMS.angleRange + 2] = field.minInitialRotation;
    f[RING_PARAMS.angleRange + 3] = field.maxInitialRotation;
    putVector(f, RING_PARAMS.gravity, field.gravity);
    putEmitter(f, RING_PARAMS.emitterWM, field);
    f[RING_PARAMS.radius] = field.radius;
    f[RING_PARAMS.height] = field.height;
    f[RING_PARAMS.radiusRange] = field.radiusRange;
    f[RING_PARAMS.directionRandomizer] = field.directionRandomizer;
  }

  /** At `"particles"`: every field marked this frame, in the list's order, one instanced strip each. */
  private readonly draw = (pass: GPURenderPassEncoder, _ctx: FrameContext): void => {
    const slots = this.slots;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (slot.drawCount === 0) continue;
      const field = slot.field;
      const built = this.render[field.features][field.blendMode];
      const group = built && slot.buffers ? slot.buffers.draw[field.targetIndex].get(built.groups[0]) : null;
      if (!built || !group) continue;
      pass.setPipeline(built.pipeline);
      pass.setBindGroup(0, group);
      pass.draw(4, slot.drawCount);
      this.stats.drawn++;
    }
  };
}

/** The update pass's descriptor, one for every dispatch: the particles are no cull, so untimed (`gpu.cull`). */
const UPDATE_PASS: GPUComputePassDescriptor = { label: "particles: update" };

/** A vector's three components at float `at`. */
function putVector(f: Float32Array, at: number, v: { readonly x: number; readonly y: number; readonly z: number }): void {
  f[at] = v.x;
  f[at + 1] = v.y;
  f[at + 2] = v.z;
}

/** `Matrix.TranslationToRef` off the emitter: the identity with the emitter in row 3. */
function putEmitter(f: Float32Array, wm: number, field: ParticleField): void {
  for (let k = 0; k < 16; k++) f[wm + k] = k % 5 === 0 ? 1 : 0;
  f[wm + 12] = field.emitter.x;
  f[wm + 13] = field.emitter.y;
  f[wm + 14] = field.emitter.z;
}
