/**
 * render/ParticleDraw.ts — Every GPU particle field of the game's that OUR
 * renderer runs (`BABYLON_EXIT.md` X4.7c: the ash), updated in compute and drawn
 * in the main pass where Babylon's group drew its particles — what
 * `GPUParticleSystem` on `ComputeShaderParticleSystem` did until X4.7c, ported
 * exactly: its buffers, its random textures, its ready gate, its clock, its
 * emission, its update and its draw.
 * Owns: `ParticleDraw` — the fields in ONE list in creation order, a disposed
 * one taken out (`scene.particleSystems`' rule, so a rebuilt field goes to the
 * end); each field's GPU half (its two random textures, its update's
 * `SimParams` buffer, its draw's block, and from its first update its two
 * particle buffers and the bind groups over them); the three pipelines, asked
 * once (`ready`); the one sprite buffer and the pass's `Internals`; the switch
 * every field obeys (`enabled`, `scene.particlesEnabled`'s twin); the prepare
 * that steps every started field and dispatches its update, and the draw;
 * what the last frame drew (`stats`); `ParticleCamera`.
 * Invariants: **a field is Babylon's field by construction**: its random textures
 * are drawn at `create` (`Math.random`, 4 × `randomTextureSize` for the first,
 * then as many for the second, Babylon's constructor order) and its slots'
 * seeds at its first update after a create or a `reset` (4 a slot, in slot order:
 * `_initialize`), and nowhere else; each frame the scene draws with the switch
 * on, every STARTED field is stepped — `animate` at `ratio`, the scene's
 * animation ratio — then, past the ready gate (`isReady`, the field's texture
 * and both its pipelines, and the update "created" a frame after a create or a
 * reset), its buffers made, its emission run and, with a live count, its
 * update dispatched into the host's prepare encoder, OUTSIDE the main pass
 * (`FrameHost.prepareEncoder`, so no field splits the pass, as each dispatch
 * of Babylon's did) — and drawn; the update reads the buffer `targetIndex`
 * names and writes the other, and the DRAW reads the buffer the update READ —
 * `_createVertexBuffers`' crossed lists, bound at the incremented index — so a
 * frame draws the slots as the previous update left them, as Babylon's did;
 * the draw is at `"particles"`, behind the turf and ahead of the moon, in this
 * list's order — so ahead of every particle system Babylon still draws (the
 * rotor wash, until X4.7d), which in every shipped flow came after the motes
 * (X4.7a's reading); each draw is an instanced strip of four, `currentActiveCount`
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
 * owner's: `systems/Atmosphere.ts`).
 * Contract: `docs/rendering.md`, "The particles".
 */
import type { HostTexture } from "./frameHost";
import { HostBindGroup } from "./HostBindGroup";
import type { BuiltPipeline } from "./PipelineCache";
import { ParticleField, type ParticleFieldOptions } from "./ParticleField";
import {
  PARAMS,
  PARAMS_BYTES,
  PARTICLE_BLOCK,
  PARTICLE_GROUP,
  PARTICLE_INTERNALS,
  PARTICLE_SPRITE,
  particlePipelines,
  type ParticleBlend,
} from "./particleProgram";
import type { FrameContext, Renderer } from "./Renderer";
import { FRAME_TARGETS } from "./targets";
import { UniformBlockBuffer } from "./UniformBlockBuffer";
import { PARTICLE_STRIDE } from "../shaders/wgsl/particles";

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

/** A field's buffers from its first update until a reset: two of them, and the groups over them. */
interface Buffers {
  readonly data: readonly [GPUBuffer, GPUBuffer];
  /** The update's group with `data[t]` in and `data[t ^ 1]` out, made at its first dispatch. */
  readonly update: [GPUBindGroup | null, GPUBindGroup | null];
  /** The draw's group at index `t`: `data[t ^ 1]`, `_renderVertexBuffers`' crossing. */
  readonly draw: readonly [HostBindGroup, HostBindGroup];
}

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
  readonly values: {
    readonly view: Float32Array;
    readonly projection: Float32Array;
    readonly translationPivot: Float32Array;
    readonly worldOffset: Float32Array;
    readonly invView: Float32Array;
    readonly colorDead: Float32Array;
    readonly eyePosition: Float32Array;
  };
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
  private update: GPUComputePipeline | null = null;
  private readonly render: Record<ParticleBlend, BuiltPipeline | null> = { add: null, standard: null };
  private readonly sprite: GPUBuffer;
  private readonly internals: UniformBlockBuffer;
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
    this.ready = Promise.all([
      keep(asked.update, (p) => (this.update = p)),
      keep(asked.render.add, (p) => (this.render.add = p)),
      keep(asked.render.standard, (p) => (this.render.standard = p)),
    ]).then((oks) => oks.every(Boolean));

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
    const params = new ArrayBuffer(PARAMS_BYTES);
    const slot: Slot = {
      field,
      texture,
      textureReady,
      random: [r1, r2],
      randomViews: [v1, v2],
      params: device.createBuffer({
        label: `particles: ${name} params`,
        size: PARAMS_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
      paramFloats: new Float32Array(params),
      paramInts: new Int32Array(params),
      block: new UniformBlockBuffer(device, PARTICLE_BLOCK, NO_DEFINES, `particles: ${name} block`),
      values: {
        view: this.camera.view,
        projection: this.camera.projection,
        translationPivot: this.zero2,
        worldOffset: this.zero3,
        invView: this.camera.invView,
        colorDead: new Float32Array(4),
        eyePosition: this.camera.eye,
      },
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
    this.fields.splice(i, 1);
    this.slots.splice(i, 1);
  }

  /** `reset()`: every slot emptied — the buffers released, the CPU half zeroed. Outside the render only. */
  reset(field: ParticleField): void {
    const slot = this.slotOf(field);
    this.release(slot);
    field.resetState();
  }

  /**
   * `isReady()`: the texture, the draw's pipeline for the field's blend, and the
   * update — which the first test after a create or a reset CREATES and answers
   * no, as Babylon's platform did.
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
    if (!this.render[field.blendMode]) return false;
    if (!field.updateCreated) {
      field.updateCreated = true;
      return false;
    }
    return this.update !== null;
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
      const c = field.colorDead;
      const dead = slot.values.colorDead;
      dead[0] = c[0];
      dead[1] = c[1];
      dead[2] = c[2];
      dead[3] = c[3];
      slot.block.write(slot.values);
      const b = slot.buffers!;
      const host = this.renderer.host;
      const handles = this.handles;
      handles.diffuseSampler = slot.texture;
      b.draw[field.targetIndex].refresh(host, handles);
    }
  };

  /** One texture handle record, rewritten per field, so a frame's refresh allocates nothing. */
  private readonly handles: { diffuseSampler: HostTexture | null } = { diffuseSampler: null };

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
    const data = new Float32Array(capacity * PARTICLE_STRIDE);
    for (let i = 0, at = 8; i < capacity; i++, at += PARTICLE_STRIDE) {
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
    const group = (source: GPUBuffer, label: string): HostBindGroup =>
      new HostBindGroup(device, `particles: ${field.name} draw ${label}`, PARTICLE_GROUP, NO_DEFINES, {
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
    const update = this.update;
    const b = slot.buffers;
    if (!update || !b) return;
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
    // `Matrix.TranslationToRef` off the emitter: the identity with the emitter in row 3.
    const wm = PARAMS.emitterWM;
    for (let k = 0; k < 16; k++) f[wm + k] = k % 5 === 0 ? 1 : 0;
    f[wm + 12] = field.emitter.x;
    f[wm + 13] = field.emitter.y;
    f[wm + 14] = field.emitter.z;
    putVector(f, PARAMS.direction1, field.direction1);
    putVector(f, PARAMS.direction2, field.direction2);
    putVector(f, PARAMS.minEmitBox, field.minEmitBox);
    putVector(f, PARAMS.maxEmitBox, field.maxEmitBox);
    this.device.queue.writeBuffer(slot.params, 0, f);

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
    pass.dispatchWorkgroups(Math.ceil(field.currentActiveCount / 64));
    pass.end();
    field.targetIndex = t === 0 ? 1 : 0;
  }

  /** At `"particles"`: every field marked this frame, in the list's order, one instanced strip each. */
  private readonly draw = (pass: GPURenderPassEncoder, _ctx: FrameContext): void => {
    const slots = this.slots;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (slot.drawCount === 0) continue;
      const built = this.render[slot.field.blendMode];
      const group = built && slot.buffers ? slot.buffers.draw[slot.field.targetIndex].get(built.groups[0]) : null;
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
