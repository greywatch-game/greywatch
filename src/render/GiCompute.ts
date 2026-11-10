/**
 * render/GiCompute.ts — The irradiance volume's GPU half as OUR renderer's
 * (`BABYLON_EXIT.md` X5.1b): the three compute passes, their six buffers and
 * the seven 3D textures the frame reads the volume through. `GiVolume` is
 * its CPU half and decides everything; this records what it was told.
 * Owns: `GiCompute` — the five compute pipelines (the trace and compose at
 * each tier, the visibility pass once), asked at construction on `"auto"`
 * layouts and declared on `Game.roundPipelines` as "the irradiance volume"
 * (`ready`); the params buffer (made once), the tier's state and visibility
 * buffers and the map's boxes, index and heights (each replaced whole by its
 * door); the seven textures at the tier's size (one texel each at `off`), one
 * view each, and the one sampler the frame reads them with, handed to the
 * frame as `OwnTexture`s whose view is rewritten in place (`frameTextures`);
 * the bind groups over them, made at the first dispatch after anything behind
 * them moved; the history's clears; the dispatch ARMED by `dispatch` and
 * recorded by a late prepare; every retired buffer and texture until the
 * frame's submit is past; `GI_TEXTURES`, `GiTierShape`, `GiTextureName`.
 * Invariants: every buffer is Babylon's `StorageBuffer`'s size and usage
 * (`STORAGE | COPY_DST | COPY_SRC`, 140) and is written by the same
 * `writeBuffer`s at the same offsets `GiVolume`'s `StorageBuffer.update`s
 * were; every texture is `RawTexture3D`'s descriptor — `3d`, one mip, usage
 * `COPY_SRC | COPY_DST | TEXTURE_BINDING | STORAGE_BINDING` (15; `COPY_SRC`
 * so a probe reads it back), `rgba16float` for the irradiance and the
 * direction, `rgba8unorm` for the rest — born zeroed and never uploaded; each
 * view is the descriptor Babylon's hardware texture made both of its views
 * with, so the compose's and the vis pass's storage view and the frame's
 * sampled view are one object; the frame's sampler is the descriptor Babylon's
 * cache made for the seven (repeat, clamp, repeat; linear x3; anisotropy 4);
 * every bind group is at Babylon's binding numbers, in its entry order, each
 * buffer bound whole (offset 0, its size) — the trace's 0-4 the four read
 * buffers and the state, 5 and 6 the cloud field's sampler and view; compose
 * 0-4, then its three storage views at 5-7; vis 0-4, 5 the visibility buffer,
 * 6-9 its four views; the CLOUD FIELD is `Sky`'s texture as our renderer
 * holds it (`TextureMaker`'s since `BABYLON_EXIT.md` X5.4d: its own view and
 * sampler, read at each dispatch — the host's view and sampler until then, the
 * owner's decision of 2026-11-07, X5.1b's row 2, which the move restates: the
 * texture's sampler is the one Babylon's cache made for it), the one
 * thing here another system owns; a dispatch is three compute passes, the trace
 * at `budget` workgroups and compose and vis at `groups`, each pass one
 * pipeline and one `dispatchWorkgroups` as Babylon's `_computeDispatch` began
 * one, recorded ONLY on a frame whose `dispatch` call ARMED it — so a frame on
 * which `GiVolume.update` did not run records nothing (the harness's hold) —
 * and recorded as a LATE prepare (`Renderer.onFrame`'s `late`) pushed in the
 * constructor, which `Game` builds AFTER `ProbeBake`: so the bake, which
 * samples the volume, records ahead of it and reads the previous frame's
 * compose as it did with Babylon's dispatch on the render encoder, and the
 * main pass and the glow's mask read this frame's; **that order rests on
 * REGISTRATION order alone** (the late list runs in push order), so a
 * construction order changed or the bake hooked again after the volume
 * reverses it with no error; a clear of the history asked before a dispatch
 * is armed is recorded ahead of that dispatch, and one asked after it behind
 * it, as Babylon's `clearBuffer` on its render encoder landed, and on a frame
 * that dispatches nothing at the frame's prepare; **an ARMED frame whose
 * prepares do not run** (`Renderer.begin` returns before any prepare when
 * nothing of ours is active) is dropped at the frame's end and is an ERROR —
 * a thrown one in a dev build — because `GiVolume.update` has already moved
 * its cursor, its warm frames and its dirty channels for the slice, which
 * would be skipped silently (X5.1a measured that frame never happening, in
 * every state) — a throw NEVER PROVOKED, by any run, and thrown where it
 * stops everything: inside the engine's `onEndFrameObservable`
 * (`FrameHost.afterSubmit`), whose `notifyObservers` catches nothing, so it
 * leaves Babylon's `endFrame` before the render loop queues its next frame —
 * a dev build's render loop STOPS, every end-of-frame observer added after
 * this one is skipped, and the retired buffers and textures are left
 * undestroyed; the CPU half has already advanced by then, so this is the
 * "fail loudly" branch X5.1b's brief asked for, never a recovery; the
 * readiness gate (`isReady`, `GiVolume.update`'s) asks only the five
 * pipelines, where Babylon's `ComputeShader.isReady()` also waited for every
 * texture bound to it — the cloud field among them — so a cloud field not
 * yet READY would there have held the CPU half back and here arms, advances
 * and records nothing (`record`, said once): unreachable today, both
 * candidate cloud fields (`Sky.cloudShadowMap`, `ShadowBindings`' no-cloud
 * texel) being raw textures written at creation (`TextureMaker.raw`); a buffer
 * or texture replaced or dropped is destroyed after
 * the frame's submit (`FrameHost.afterSubmit`), never at the call — a door
 * may run between an armed dispatch and its prepare, which then records on
 * what was current when it was armed; nothing here allocates on a frame but
 * the passes WebGPU makes.
 * Never: imports Babylon; decides a budget, a light, a window or a tier;
 * reads a node; submits.
 * Contract: `docs/rendering.md`, "The irradiance volume" and "Our renderer's
 * frame".
 */
import { CONFIG } from "../config";
import { GI_STATE_VEC4, giComposeSource, giTraceSource, giVisSource } from "../shaders/wgsl/giTrace";
import { OwnTexture } from "./HostBindGroup";
import type { FramePrepare, Renderer } from "./Renderer";

/** The seven textures, in the frame's binding order (`FRAME_TEXTURES`), with each one's format. */
export const GI_TEXTURES = [
  { name: "giIrr", format: "rgba16float" },
  { name: "giDir", format: "rgba16float" },
  { name: "giAux", format: "rgba8unorm" },
  { name: "giVis0", format: "rgba8unorm" },
  { name: "giVis1", format: "rgba8unorm" },
  { name: "giVis2", format: "rgba8unorm" },
  { name: "giVis3", format: "rgba8unorm" },
] as const satisfies readonly { name: string; format: GPUTextureFormat }[];

export type GiTextureName = (typeof GI_TEXTURES)[number]["name"];

/** What the GPU half needs of a tier: its grid and the two numbers its modules are compiled for. */
export interface GiTierShape {
  readonly columns: number;
  readonly layers: number;
  readonly rays: number;
  readonly fastRays: number;
}

/*
 * The two usages below are LITERALS: this module is read before a device
 * exists — `main.ts` imports `Game` statically — and `GPUBufferUsage` and
 * `GPUTextureUsage` are secure-context globals a browser without WebGPU does
 * not have, so naming them here would throw before the boot gate could say
 * why (`particleProgram.ts`' `COMPUTE` is the precedent).
 */
/** `StorageBuffer`'s usage: `GPUBufferUsage.STORAGE (128) | COPY_DST (8) | COPY_SRC (4)`. */
const BUFFER_USAGE = 140;
/** `RawTexture3D` with `TEXTURE_CREATIONFLAG_STORAGE`: `GPUTextureUsage.COPY_SRC (1) | COPY_DST (2) | TEXTURE_BINDING (4) | STORAGE_BINDING (8)`. */
const TEXTURE_USAGE = 15;
/** The sampler Babylon's cache made for the seven: toroidal across, clamped up (`celGi`). */
const FRAME_SAMPLER: GPUSamplerDescriptor = {
  label: "gi: the frame's sampler",
  magFilter: "linear",
  minFilter: "linear",
  mipmapFilter: "linear",
  addressModeU: "repeat",
  addressModeV: "clamp-to-edge",
  addressModeW: "repeat",
  maxAnisotropy: 4,
};
const TRACE_PASS: GPUComputePassDescriptor = { label: "gi: trace" };
const COMPOSE_PASS: GPUComputePassDescriptor = { label: "gi: compose" };
const VIS_PASS: GPUComputePassDescriptor = { label: "gi: vis" };

/**
 * One set of what a dispatch binds — replaced whole by a door, never edited —
 * with the groups made over it. A dispatch armed before a door records on
 * the set it was armed with.
 */
interface Resources {
  readonly state: GPUBuffer | null;
  readonly vis: GPUBuffer | null;
  readonly boxes: GPUBuffer | null;
  readonly index: GPUBuffer | null;
  readonly heights: GPUBuffer | null;
  readonly textures: readonly GPUTexture[];
  readonly views: readonly GPUTextureView[];
  traceGroup: GPUBindGroup | null;
  /** What the trace's group was made against: its pipeline and the cloud field's view and sampler. */
  traceOf: GPUComputePipeline | null;
  traceView: GPUTextureView | null;
  traceSampler: GPUSampler | null;
  composeGroup: GPUBindGroup | null;
  composeOf: GPUComputePipeline | null;
  visGroup: GPUBindGroup | null;
}

export class GiCompute {
  /** Whether all five pipelines built — asked once, at construction. */
  readonly ready: Promise<boolean>;
  /**
   * The seven as the frame binds them (`CelMaterialFactory.fillFrameTextures`),
   * by name: the same seven objects for the GPU half's whole life, their view
   * rewritten in place when the tier stands a new set up.
   */
  readonly frameTextures: Record<GiTextureName, OwnTexture>;
  /** How many frames this has recorded the volume's passes on — the harness's count (`__refGiCount`). */
  recorded = 0;
  /** The cloud field the trace lights its hits by, as its owner holds it; null binds nothing (no dispatch). */
  cloud: OwnTexture | null = null;

  private readonly device: GPUDevice;
  private readonly params: GPUBuffer;
  private readonly sampler: GPUSampler;
  /** By `rays`, by `fastRays`: one module and pipeline per tier's value. */
  private readonly traces = new Map<number, GPUComputePipeline>();
  private readonly composes = new Map<number, GPUComputePipeline>();
  private visPipeline: GPUComputePipeline | null = null;
  private res: Resources;
  /** Retired and not yet destroyed: past the next submit. */
  private readonly retired: (GPUBuffer | GPUTexture)[] = [];
  /** Clears asked and not yet recorded, in the order asked. */
  private readonly pendingClears: GPUBuffer[] = [];
  /** The armed dispatch: what it records on, with what, and the clears asked ahead of it. Null: none. */
  private armed: Resources | null = null;
  private armedTrace: GPUComputePipeline | null = null;
  private armedCompose: GPUComputePipeline | null = null;
  private armedBudget = 0;
  private armedGroups = 0;
  private readonly armedClears: GPUBuffer[] = [];
  private readonly unhook: () => void;
  private readonly unsubmit: { dispose(): void };
  private warnedUnrecorded = false;
  private warnedCloud = false;

  constructor(
    renderer: Renderer,
    paramBytes: number,
  ) {
    const device = renderer.device;
    this.device = device;
    this.params = this.buffer("gi-params", paramBytes);
    this.sampler = device.createSampler(FRAME_SAMPLER);
    const frame = {} as Record<GiTextureName, OwnTexture>;
    for (const t of GI_TEXTURES) {
      const own = new OwnTexture();
      own.sampler = this.sampler;
      frame[t.name] = own;
    }
    this.frameTextures = frame;
    const off = this.makeTextures(null);
    this.res = this.resources(null, null, null, null, null, off.textures, off.views);

    // Every tier's, asked now: a tier switched in a round compiles nothing.
    const pipelines = renderer.pipelines;
    const keep = (p: Promise<GPUComputePipeline>, put: (built: GPUComputePipeline) => void): Promise<boolean> =>
      p.then(
        (built) => {
          put(built);
          return true;
        },
        (err: unknown) => {
          console.error("gi: a pipeline did not build; the irradiance volume will not trace", err);
          return false;
        },
      );
    const waits: Promise<boolean>[] = [];
    for (const tier of Object.values(CONFIG.gi.tiers)) {
      if (!this.traces.has(tier.rays)) {
        const rays = tier.rays;
        waits.push(keep(pipelines.compute("gi-trace", giTraceSource(rays), "main"), (p) => this.traces.set(rays, p)));
      }
      if (!this.composes.has(tier.fastRays)) {
        const fastRays = tier.fastRays;
        waits.push(
          keep(pipelines.compute("gi-compose", giComposeSource(fastRays), "main"), (p) => this.composes.set(fastRays, p)),
        );
      }
    }
    waits.push(keep(pipelines.compute("gi-vis", giVisSource(), "main"), (p) => (this.visPipeline = p)));
    this.ready = Promise.all(waits).then((oks) => oks.every(Boolean));

    // LATE, and pushed here: `Game` builds this after `ProbeBake`, whose bake
    // samples the volume, so the bake records first and reads the previous
    // frame's compose (the header — the order is the push order and nothing
    // else).
    this.unhook = renderer.onFrame(this.prepare, true);
    this.unsubmit = renderer.host.afterSubmit(this.frameEnd);
  }

  /** Whether the passes a tier dispatches are built: `GiVolume.update`'s readiness gate. */
  isReady(tier: GiTierShape): boolean {
    return this.traces.has(tier.rays) && this.composes.has(tier.fastRays) && this.visPipeline !== null;
  }

  /** Whether everything a dispatch reads is standing: a tier's buffers and a map's. */
  get traceable(): boolean {
    const r = this.res;
    return r.state !== null && r.vis !== null && r.boxes !== null && r.index !== null && r.heights !== null;
  }

  /** Whether a map's boxes are uploaded — `writeHulls` writes into them. */
  get hasMap(): boolean {
    return this.res.boxes !== null;
  }

  /**
   * Stands the tier's buffers and textures up (one texel each and no
   * buffers for `null`, the setting `off`), retiring the old ones, and points
   * the frame's seven at the new views.
   */
  setTier(tier: GiTierShape | null): void {
    const r = this.res;
    this.retire(r.state);
    this.retire(r.vis);
    for (const t of r.textures) this.retire(t);
    let state: GPUBuffer | null = null;
    let vis: GPUBuffer | null = null;
    if (tier) {
      const total = tier.columns * tier.columns * tier.layers;
      state = this.buffer("gi-state", total * GI_STATE_VEC4 * 16);
      vis = this.buffer("gi-vis", total * 16);
    }
    const set = this.makeTextures(tier);
    this.res = this.resources(state, vis, r.boxes, r.index, r.heights, set.textures, set.views);
  }

  /** A map's traceable world, replacing the last one's (`GiVolume.uploadMap`). */
  uploadMap(boxes: Float32Array<ArrayBuffer>, index: Uint32Array<ArrayBuffer>, heights: Float32Array<ArrayBuffer>): void {
    this.dropMap();
    const r = this.res;
    const b = this.buffer("gi-boxes", boxes.byteLength);
    const i = this.buffer("gi-index", index.byteLength);
    const h = this.buffer("gi-heights", heights.byteLength);
    const q = this.device.queue;
    q.writeBuffer(b, 0, boxes);
    q.writeBuffer(i, 0, index);
    q.writeBuffer(h, 0, heights);
    this.res = this.resources(r.state, r.vis, b, i, h, r.textures, r.views);
  }

  /** No map: the traced world's buffers retired (`GiVolume.clearMap`, and `uploadMap` first). */
  clearMap(): void {
    this.dropMap();
  }

  /** A fresh history: the state and the visibility buffers zeroed ahead of the next dispatch. */
  clearHistory(): void {
    const r = this.res;
    if (r.state) this.pendingClears.push(r.state);
    if (r.vis) this.pendingClears.push(r.vis);
  }

  /** The whole params array, this frame's (`GiVolume.writeParams`). */
  writeParams(data: Float32Array<ArrayBuffer>): void {
    this.device.queue.writeBuffer(this.params, 0, data);
  }

  /** The hull slots at the front of the box buffer (`GiVolume.writeHulls`). */
  writeHulls(data: Float32Array<ArrayBuffer>): void {
    const boxes = this.res.boxes;
    if (boxes) this.device.queue.writeBuffer(boxes, 0, data);
  }

  /**
   * ARMS this frame's dispatch — the trace at `budget` workgroups and compose
   * and vis at `groups` — for the late prepare to record, on what stands now.
   * `GiVolume.update` calls it once its readiness gate has passed and before
   * it moves its cursor; a frame that never calls it records nothing.
   */
  dispatch(tier: GiTierShape, budget: number, groups: number): void {
    const trace = this.traces.get(tier.rays);
    const compose = this.composes.get(tier.fastRays);
    if (!trace || !compose || !this.visPipeline) return;
    this.armed = this.res;
    this.armedTrace = trace;
    this.armedCompose = compose;
    this.armedBudget = budget;
    this.armedGroups = groups;
    const clears = this.pendingClears;
    for (let i = 0; i < clears.length; i++) this.armedClears.push(clears[i]);
    clears.length = 0;
  }

  /** The GPUTexture of one of the seven — a probe's readback (`gi.mjs`'s `__giGpu`). */
  textureOf(name: GiTextureName): GPUTexture {
    return this.res.textures[GI_TEXTURES.findIndex((t) => t.name === name)];
  }

  /** The GPUView of one of the seven, the one the compute writes and the frame samples. */
  viewOf(name: GiTextureName): GPUTextureView {
    return this.res.views[GI_TEXTURES.findIndex((t) => t.name === name)];
  }

  /** One of the six buffers by the probe's name, or null. */
  bufferOf(name: "params" | "state" | "vis" | "boxes" | "index" | "heights"): GPUBuffer | null {
    return name === "params" ? this.params : this.res[name];
  }

  dispose(): void {
    this.unhook();
    this.unsubmit.dispose();
    this.armed = null;
    this.armedClears.length = 0;
    this.pendingClears.length = 0;
    const r = this.res;
    for (const b of [this.params, r.state, r.vis, r.boxes, r.index, r.heights]) b?.destroy();
    for (const t of r.textures) t.destroy();
    for (const x of this.retired) x.destroy();
    this.retired.length = 0;
    for (const t of GI_TEXTURES) this.frameTextures[t.name].view = null;
  }

  // --- the frame ---------------------------------------------------------------

  private readonly prepare: FramePrepare = (_frame, encoder) => {
    const res = this.armed;
    if (res) {
      // The history's clears asked ahead of this dispatch, then the dispatch.
      const ahead = this.armedClears;
      for (let i = 0; i < ahead.length; i++) encoder.clearBuffer(ahead[i]);
      ahead.length = 0;
      if (this.record(encoder, res)) this.recorded++;
      this.armed = null;
    }
    // Asked after the arm (behind the dispatch, as Babylon's landed), or on a
    // frame that dispatches nothing (that frame's, as Babylon's landed).
    const clears = this.pendingClears;
    for (let i = 0; i < clears.length; i++) encoder.clearBuffer(clears[i]);
    clears.length = 0;
  };

  /**
   * The three passes, in Babylon's order: trace, compose, vis. False, and
   * nothing recorded, with no cloud field to bind — which `GiVolume` hands
   * over before it arms anything, so it is said once if it ever happens.
   */
  private record(encoder: GPUCommandEncoder, res: Resources): boolean {
    const trace = this.armedTrace!;
    const compose = this.armedCompose!;
    const vis = this.visPipeline!;
    const traceGroup = this.traceGroup(res, trace);
    if (!traceGroup) {
      if (!this.warnedCloud) {
        this.warnedCloud = true;
        console.error("gi: an armed dispatch with no cloud field to bind recorded nothing");
      }
      return false;
    }
    const composeGroup = this.composeGroup(res, compose);
    const visGroup = this.visGroup(res, vis);
    const groups = this.armedGroups;
    let pass = encoder.beginComputePass(TRACE_PASS);
    pass.setPipeline(trace);
    pass.setBindGroup(0, traceGroup);
    pass.dispatchWorkgroups(this.armedBudget, 1, 1);
    pass.end();
    pass = encoder.beginComputePass(COMPOSE_PASS);
    pass.setPipeline(compose);
    pass.setBindGroup(0, composeGroup);
    pass.dispatchWorkgroups(groups, 1, 1);
    pass.end();
    pass = encoder.beginComputePass(VIS_PASS);
    pass.setPipeline(vis);
    pass.setBindGroup(0, visGroup);
    pass.dispatchWorkgroups(groups, 1, 1);
    pass.end();
    return true;
  }

  /** After every frame's submit: an armed dispatch left unrecorded is the error the header names; the retired go. */
  private readonly frameEnd = (): void => {
    if (this.armed) {
      // Its clears go back to wait for the next dispatch, ahead of what is
      // pending — but for one retired since, which goes below and needs none.
      const ahead = this.armedClears;
      for (let i = ahead.length - 1; i >= 0; i--) {
        if (!this.retired.includes(ahead[i])) this.pendingClears.unshift(ahead[i]);
      }
      ahead.length = 0;
      this.armed = null;
      const message =
        "gi: a dispatch was armed and no prepare of ours ran this frame — GiVolume.update moved its cursor for a slice nobody traced";
      if (import.meta.env.DEV) throw new Error(message);
      if (!this.warnedUnrecorded) {
        this.warnedUnrecorded = true;
        console.error(message);
      }
    }
    const retired = this.retired;
    if (retired.length === 0) return;
    for (let i = 0; i < retired.length; i++) retired[i].destroy();
    retired.length = 0;
  };

  // --- what a dispatch binds ---------------------------------------------------

  private traceGroup(res: Resources, trace: GPUComputePipeline): GPUBindGroup | null {
    const cloud = this.cloud;
    if (!cloud) return null;
    const view = cloud.view;
    const sampler = cloud.sampler;
    if (!view || !sampler) return null;
    if (res.traceGroup && res.traceOf === trace && res.traceView === view && res.traceSampler === sampler) {
      return res.traceGroup;
    }
    res.traceGroup = this.device.createBindGroup({
      label: "gi: trace",
      layout: trace.getBindGroupLayout(0),
      entries: [...this.common(res), { binding: 5, resource: sampler }, { binding: 6, resource: view }],
    });
    res.traceOf = trace;
    res.traceView = view;
    res.traceSampler = sampler;
    return res.traceGroup;
  }

  private composeGroup(res: Resources, compose: GPUComputePipeline): GPUBindGroup {
    if (res.composeGroup && res.composeOf === compose) return res.composeGroup;
    const v = res.views;
    res.composeGroup = this.device.createBindGroup({
      label: "gi: compose",
      layout: compose.getBindGroupLayout(0),
      entries: [
        ...this.common(res),
        { binding: 5, resource: v[0] },
        { binding: 6, resource: v[1] },
        { binding: 7, resource: v[2] },
      ],
    });
    res.composeOf = compose;
    return res.composeGroup;
  }

  /** The vis pass's one pipeline is the session's, so its group is made once a set. */
  private visGroup(res: Resources, vis: GPUComputePipeline): GPUBindGroup {
    if (res.visGroup) return res.visGroup;
    const v = res.views;
    res.visGroup = this.device.createBindGroup({
      label: "gi: vis",
      layout: vis.getBindGroupLayout(0),
      entries: [
        ...this.common(res),
        { binding: 5, resource: whole(res.vis!) },
        { binding: 6, resource: v[3] },
        { binding: 7, resource: v[4] },
        { binding: 8, resource: v[5] },
        { binding: 9, resource: v[6] },
      ],
    });
    return res.visGroup;
  }

  /** Bindings 0-4 of all three: the params, the boxes, the index, the heights and the state, each whole. */
  private common(res: Resources): GPUBindGroupEntry[] {
    return [
      { binding: 0, resource: whole(this.params) },
      { binding: 1, resource: whole(res.boxes!) },
      { binding: 2, resource: whole(res.index!) },
      { binding: 3, resource: whole(res.heights!) },
      { binding: 4, resource: whole(res.state!) },
    ];
  }

  // --- the resources -----------------------------------------------------------

  private buffer(label: string, size: number): GPUBuffer {
    return this.device.createBuffer({ label, size, usage: BUFFER_USAGE });
  }

  /** The seven at the tier's size, or one texel each with no tier: they must EXIST either way. */
  private makeTextures(tier: GiTierShape | null): { textures: GPUTexture[]; views: GPUTextureView[] } {
    const n = tier ? tier.columns : 1;
    const l = tier ? tier.layers : 1;
    const textures: GPUTexture[] = [];
    const views: GPUTextureView[] = [];
    for (const t of GI_TEXTURES) {
      const texture = this.device.createTexture({
        label: t.name,
        size: [n, l, n],
        format: t.format,
        dimension: "3d",
        mipLevelCount: 1,
        sampleCount: 1,
        usage: TEXTURE_USAGE,
        viewFormats: [],
      });
      textures.push(texture);
      // Babylon's hardware texture's descriptor, for its sampled view and its
      // storage view alike: one object serves both here.
      views.push(
        texture.createView({
          label: t.name,
          format: t.format,
          dimension: "3d",
          mipLevelCount: 1,
          baseArrayLayer: 0,
          baseMipLevel: 0,
          arrayLayerCount: 1,
          aspect: "all",
        }),
      );
    }
    return { textures, views };
  }

  private resources(
    state: GPUBuffer | null,
    vis: GPUBuffer | null,
    boxes: GPUBuffer | null,
    index: GPUBuffer | null,
    heights: GPUBuffer | null,
    textures: readonly GPUTexture[],
    views: readonly GPUTextureView[],
  ): Resources {
    // The frame's seven follow the set: the same objects, their view rewritten.
    for (let i = 0; i < GI_TEXTURES.length; i++) this.frameTextures[GI_TEXTURES[i].name].view = views[i];
    return {
      state,
      vis,
      boxes,
      index,
      heights,
      textures,
      views,
      traceGroup: null,
      traceOf: null,
      traceView: null,
      traceSampler: null,
      composeGroup: null,
      composeOf: null,
      visGroup: null,
    };
  }

  private dropMap(): void {
    const r = this.res;
    if (!r.boxes && !r.index && !r.heights) return;
    this.retire(r.boxes);
    this.retire(r.index);
    this.retire(r.heights);
    this.res = this.resources(r.state, r.vis, null, null, null, r.textures, r.views);
  }

  /** Destroyed after the frame's submit (`frameEnd`); a clear still waiting on it is dropped. */
  private retire(x: GPUBuffer | GPUTexture | null): void {
    if (!x) return;
    this.retired.push(x);
    const clears = this.pendingClears;
    for (let i = clears.length - 1; i >= 0; i--) if (clears[i] === x) clears.splice(i, 1);
  }
}

/** A buffer bound whole, as Babylon's compute context binds one: offset 0, its size. */
function whole(buffer: GPUBuffer): GPUBufferBinding {
  return { buffer, offset: 0, size: buffer.size };
}
