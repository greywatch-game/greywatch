/**
 * render/PostChain.ts — The post chain's HOST (`BABYLON_EXIT.md` X5.2c1): the
 * ordered list of full-screen stages OUR renderer draws after Babylon's
 * prefix of the chain (the shafts — a stage a rung — the blur and the grade
 * since X5.2c2), each one DECLARED rather than wired, and the one loop that
 * routes them — a pass per active stage, in list order, each reading the one
 * before's output, the LAST active stage given the canvas and any other a
 * target of the owner's POOL, one a pass POSITION (so each pass of a frame
 * writes a target of its own, as each Babylon pass had an input of its own).
 * Owns: `PostChain`; `PostStage` (what a stage declares), `PostExtra` (a
 * texture a stage reads beside its input) and `PostPassOwner` (what the side
 * that OPENS the passes must do); Babylon's full-screen quad as a vertex and
 * an index buffer, the two `Internals` blocks (the canvas's, not flipped; a
 * texture's, flipped), each stage's uniform block, input sampler, pipelines
 * (one a target kind it can be drawn into) and bind groups; `ready`, the
 * pipelines it was built to declare.
 * Invariants: a stage declares its PROGRAM as compiled (both modules, their
 * bindings: `PipelineCache` builds the layout from them), its uniform block
 * (its size and `fill`, handed the size of what it reads — the render size,
 * which every target of the chain is), its EXTRA bindings (`PostExtra`: a
 * texture of the host's, bound with the host's own view and sampler, or one
 * of our renderer's, `OwnTexture`, bound with its owner's; with a sampler
 * binding if it is sampled), the SAMPLER it reads its input with (a property of the
 * CONSUMER, never of the target it reads, so it is made here from the
 * stage's descriptor), whether it is `active()` (its setting), and whether it
 * reads its input point-wise or across a neighbourhood (`reads`, what a later
 * fusion asks: only a point-wise consumer folds into its producer); NOTHING a
 * stage holds names its output, its place, the canvas or "the frame" — the
 * host hands it an input and opens its target, and a stage is one pass only
 * because the host opens one (`record`); every pipeline is Babylon's state for
 * a post-process pass as the probe read it off the parent's device
 * (`plans/webgpu-ref/post.mjs`): Babylon's quad (`float32x2` at stride 8, the
 * quad `(1,1) (-1,1) (-1,-1) (1,-1)`, `uint16` `0,1,2,0,2,3`,
 * `drawIndexed(6, 1, 0, 0, 0)`), cull none, no blend, write mask 15, group 0
 * EMPTY and everything in group 1 — into the canvas with the ENGINE's
 * `depth32float` written, compare `always` (`canvasTargets`), and into a
 * texture with no depth (`POST_TARGETS`); `Internals` is Babylon's
 * `UBDontInvertY` into the canvas (+1) and `UBInvertY` into a texture (-1),
 * then the render height; a stage draws only into a pass that is exactly its
 * pipeline's targets (`Renderer.postStageOpened`), and only once its pipeline
 * for that target is built (a stage not built draws nothing: `drawsReady`
 * says so, and the round's declared list waits for every one, so play never
 * reaches it); nothing here allocates on a frame once its bind groups are
 * made (at the stage's first draw — a shafts rung's at its first frame —
 * and remade only when a view or a sampler it binds changes: a resize, a
 * shadow map re-made by a quality change or handed between its owners).
 * Never: imports Babylon; binds a target — the `PostPassOwner` binds every
 * one, with Babylon's public API, until the game owns the frame (X5.4); draws
 * a stage that is not `active()`; reads the canvas or its depth.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 *
 * WHAT KEEPS THE DOOR OPEN (X5.2, "Keep the door open for the GPU side").
 * Two neighbours may later be FUSED into one pass reading the same input, and
 * that has to be a change to this host rather than a rewrite of its stages:
 * so the routing is here and nowhere else, a stage says how it reads its input
 * (`reads`), and the shaders are ported AS COMPILED — a fusion drops the 8-bit
 * rounding between two passes, so it is never byte-exact and is a later
 * `Picture change:`.
 */
import type { BoundTexture, HostTexture, PassTargets } from "./frameHost";
import { OwnTexture } from "./HostBindGroup";
import type { BuiltPipeline, PipelineSpec, PipelineState, ShaderSource } from "./PipelineCache";
import type { Renderer } from "./Renderer";
import { canvasTargets, POST_TARGETS } from "./targets";
import type { AssembledBinding } from "./wgsl/assemble";

/**
 * A texture a stage reads beside its input: its binding in group 1, the
 * binding of the sampler it is read with if it is SAMPLED (absent for one
 * read by `textureLoad`, the frame's depth), and what is bound there this
 * frame — the host's texture, bound with the host's own view and sampler,
 * or one our renderer owns, bound with the view and sampler its owner holds
 * (`OwnTexture`, `BABYLON_EXIT.md` rule 5: the shafts' shadow maps, X5.2c2).
 */
export interface PostExtra {
  readonly binding: number;
  readonly samplerBinding?: number;
  /** The texture now, or null while it does not exist yet (the stage then draws nothing). */
  texture(): HostTexture | OwnTexture | null;
}

/** One stage of the chain, as it DECLARES itself (see the header). */
export interface PostStage {
  /** Its name, as `post.mjs` names its draws (`grain`). */
  readonly name: string;
  /**
   * Its name as Babylon named the post-process it was (`paperGrain`): the
   * label of its pipelines, and of the target it READS, which a pass owner
   * names by its reader as Babylon named a pass's input (`PostProcessRTT-<it>`).
   */
  readonly label: string;
  readonly vertex: string;
  readonly vertexBindings: readonly AssembledBinding[];
  readonly fragment: string;
  readonly fragmentBindings: readonly AssembledBinding[];
  /** Whether it reads its input only at its own pixel, or across a neighbourhood (the grain's aberration). */
  readonly reads: "point" | "neighbourhood";
  /** Group 1's numbers: the input, its sampler, `Internals` and the block. */
  readonly inputBinding: number;
  readonly inputSamplerBinding: number;
  readonly internalsBinding: number;
  readonly blockBinding: number;
  /** The sampler the stage reads its input with, as Babylon bound it. */
  readonly inputSampler: GPUSamplerDescriptor;
  /** The block's size, in floats (a multiple of four). */
  readonly blockFloats: number;
  readonly extras: readonly PostExtra[];
  /** Whether it draws this frame. */
  active(): boolean;
  /** This frame's block, for an input of `width` x `height`; every float written. */
  fill(block: Float32Array<ArrayBuffer>, width: number, height: number): void;
}

/**
 * What the side that OPENS the chain's passes does (`shaders/PostPasses.ts`
 * until X5.4): Babylon's prefix of the chain writes `prefixOutput`, and each
 * stage of ours draws into a pass it opens, in the order `record` asks.
 */
export interface PostPassOwner {
  /** What the first active stage reads: the prefix's output. */
  readonly prefixOutput: HostTexture;
  /** The render size, which every target of the chain is. */
  readonly width: number;
  readonly height: number;
  /**
   * Opens a pass into pool target `slot` — the POSITION of the pass among
   * this frame's passes into the pool, 0 first, so each pass of a frame has a
   * target of its own as each Babylon pass had an input of its own — bound
   * and cleared as Babylon's `PostProcess.activate` bound and cleared the
   * input of `reader` (the stage that will read it), named for `reader`;
   * returns the target.
   */
  openPool(slot: number, reader: PostStage): HostTexture;
  /** Opens the canvas's pass: the last active stage's. */
  openCanvas(): void;
}

/** The two kinds of target a stage is drawn into. */
const CANVAS = 0;
const POOL = 1;

/** Babylon's quad attribute: `position`, two floats at location 0. */
const QUAD_LAYOUT: readonly GPUVertexBufferLayout[] = [
  { arrayStride: 8, stepMode: "vertex", attributes: [{ format: "float32x2", offset: 0, shaderLocation: 0 }] },
];
/** `PostProcessManager`'s quad and its indices. */
const QUAD = new Float32Array([1, 1, -1, 1, -1, -1, 1, -1]);
const QUAD_INDICES = new Uint16Array([0, 1, 2, 0, 2, 3]);
/**
 * The usages Babylon's buffer manager gave the quad's two buffers (168 and
 * 152), as LITERALS: this module is read before a device exists, and a
 * browser without WebGPU has no `GPUBufferUsage` (`GlowBlur.ts`' reason).
 */
const QUAD_USAGE = 168; // GPUBufferUsage.VERTEX (32) | STORAGE (128) | COPY_DST (8)
const INDEX_USAGE = 152; // GPUBufferUsage.INDEX (16) | STORAGE (128) | COPY_DST (8)
const UNIFORM_USAGE = 72; // GPUBufferUsage.UNIFORM (64) | COPY_DST (8)

/** Babylon's post-process pipeline state: cull none, no blend; into the canvas the engine's depth is written, compare `always`. */
const CANVAS_STATE: PipelineState = { cullMode: "none", depthWrite: true, depthCompare: "always" };
const POOL_STATE: PipelineState = { cullMode: "none" };

/** One stage's own state. */
interface StageState {
  readonly stage: PostStage;
  readonly sampler: GPUSampler;
  readonly block: GPUBuffer;
  readonly values: Float32Array<ArrayBuffer>;
  /** What `values` last reached the block as (compared, so a still frame writes nothing). */
  readonly written: Float32Array<ArrayBuffer>;
  wroteOnce: boolean;
  /** Built pipelines by target kind, null while compiling or never asked. */
  readonly pipelines: (BuiltPipeline | null)[];
  /** Whether each kind was asked (so a draw-time miss asks once). */
  readonly asked: boolean[];
  /** This frame's draw: what `run` binds. */
  pipeline: BuiltPipeline | null;
  group: GPUBindGroup | null;
  /** What `group` was made from: the layout, the internals, the input view, each extra's view and sampler. */
  groupLayout: GPUBindGroupLayout | null;
  groupInternals: GPUBuffer | null;
  groupInput: GPUTextureView | null;
  readonly groupExtras: (GPUTextureView | null)[];
  readonly groupExtraSamplers: (GPUSampler | null)[];
  /** This frame's extras' views and samplers. */
  readonly extraViews: (GPUTextureView | null)[];
  readonly extraSamplers: (GPUSampler | null)[];
  readonly run: (pass: GPURenderPassEncoder) => void;
}

export class PostChain {
  /** Settles once every pipeline the constructor asked is built (true) or one failed (false). */
  readonly ready: Promise<boolean>;
  /** The stages in list order, as declared — for the probe's adapter, which names each pool target by the stage that writes it. */
  readonly stages: readonly PostStage[];
  private readonly device: GPUDevice;
  /** The canvas's targets, at the device's preferred format (the swap chain's). */
  private readonly canvas: PassTargets;
  private readonly states: StageState[] = [];
  private readonly quad: GPUBuffer;
  private readonly indices: GPUBuffer;
  /** `Internals` into the canvas (+1) and into a texture (-1), each then the render height. */
  private readonly internals: GPUBuffer[];
  private readonly internalsValues = [new Float32Array([1, 0]), new Float32Array([-1, 0])];
  private readonly internalsHeight = [-1, -1];
  /** Group 0, which every pipeline here declares EMPTY, made once against the first layout seen. */
  private empty: GPUBindGroup | null = null;
  private readonly bound: BoundTexture = { view: null, sampler: null };

  constructor(
    private readonly renderer: Renderer,
    stages: readonly PostStage[],
  ) {
    const device = renderer.device;
    this.device = device;
    this.stages = stages;
    this.canvas = canvasTargets(navigator.gpu.getPreferredCanvasFormat());
    this.quad = this.buffer("post chain: quad", QUAD, QUAD_USAGE);
    this.indices = this.buffer("post chain: quad indices", QUAD_INDICES, INDEX_USAGE);
    this.internals = [
      device.createBuffer({ label: "post chain: internals (canvas)", size: 8, usage: UNIFORM_USAGE }),
      device.createBuffer({ label: "post chain: internals (texture)", size: 8, usage: UNIFORM_USAGE }),
    ];
    const asks: Promise<boolean>[] = [];
    stages.forEach((stage, i) => {
      const state: StageState = {
        stage,
        sampler: device.createSampler({ label: `${stage.label}: input`, ...stage.inputSampler }),
        block: device.createBuffer({ label: `${stage.label}: leftover`, size: stage.blockFloats * 4, usage: UNIFORM_USAGE }),
        values: new Float32Array(stage.blockFloats),
        written: new Float32Array(stage.blockFloats),
        wroteOnce: false,
        pipelines: [null, null],
        asked: [false, false],
        pipeline: null,
        group: null,
        groupLayout: null,
        groupInternals: null,
        groupInput: null,
        groupExtras: stage.extras.map(() => null),
        groupExtraSamplers: stage.extras.map(() => null),
        extraViews: stage.extras.map(() => null),
        extraSamplers: stage.extras.map(() => null),
        run: (pass) => this.run(pass, state),
      };
      this.states.push(state);
      // Every target this stage can be given: the canvas always (any stage
      // can be the last active one), and the pool only if a stage follows it.
      asks.push(this.ask(state, CANVAS, false));
      if (i < stages.length - 1) asks.push(this.ask(state, POOL, false));
    });
    this.ready = Promise.all(asks).then((oks) => oks.every(Boolean));
  }

  /** Whether any stage draws this frame — what decides whether Babylon's prefix writes the canvas or our input. */
  active(): boolean {
    for (const s of this.states) if (s.stage.active()) return true;
    return false;
  }

  /**
   * Whether every active stage can draw this frame where `record` would draw
   * it — the harness's readiness arm, and what a frame drawn before it reads
   * as a stage that drew nothing. Asks nothing.
   */
  drawsReady(): boolean {
    const last = this.lastActive();
    for (let i = 0; i <= last; i++) {
      const s = this.states[i];
      if (!s.stage.active()) continue;
      if (!s.pipelines[i === last ? CANVAS : POOL]) return false;
    }
    return true;
  }

  /**
   * The chain's passes for this frame, in list order: each active stage is
   * handed the output before it (the first, the prefix's) and drawn into the
   * pass the owner opens for it — the canvas for the last, a pool target
   * for any other, one a position (`PostPassOwner.openPool`). Called by the owner after Babylon's
   * prefix has written `prefixOutput`; a stage whose pipeline is not built,
   * or whose bindings do not exist yet, draws nothing in its pass.
   */
  record(owner: PostPassOwner): void {
    const last = this.lastActive();
    if (last < 0) return;
    let input = owner.prefixOutput;
    let slot = 0;
    for (let i = 0; i <= last; i++) {
      const s = this.states[i];
      if (!s.stage.active()) continue;
      if (i === last) {
        owner.openCanvas();
        this.draw(s, CANVAS, input, owner);
      } else {
        const out = owner.openPool(slot, this.nextActive(i));
        this.draw(s, POOL, input, owner);
        input = out;
        slot++;
      }
    }
  }

  dispose(): void {
    this.quad.destroy();
    this.indices.destroy();
    for (const b of this.internals) b.destroy();
    for (const s of this.states) s.block.destroy();
  }

  /** The first stage that draws this frame, or null — what reads the prefix's output. */
  firstActive(): PostStage | null {
    for (const s of this.states) if (s.stage.active()) return s.stage;
    return null;
  }

  private lastActive(): number {
    for (let i = this.states.length - 1; i >= 0; i--) if (this.states[i].stage.active()) return i;
    return -1;
  }

  private nextActive(i: number): PostStage {
    for (let j = i + 1; j < this.states.length; j++) if (this.states[j].stage.active()) return this.states[j].stage;
    return this.states[i].stage;
  }

  private ask(state: StageState, kind: number, unsealed: boolean): Promise<boolean> {
    state.asked[kind] = true;
    const st = state.stage;
    const v: ShaderSource = { label: `${st.label}: vertex`, code: st.vertex, bindings: st.vertexBindings };
    const f: ShaderSource = { label: `${st.label}: fragment`, code: st.fragment, bindings: st.fragmentBindings };
    const spec: PipelineSpec = {
      vertex: v,
      vertexEntry: "main",
      fragment: f,
      fragmentEntry: "main",
      targets: kind === CANVAS ? this.canvas : POST_TARGETS,
      state: kind === CANVAS ? CANVAS_STATE : POOL_STATE,
      vertexBuffers: QUAD_LAYOUT,
    };
    return this.renderer.pipelines.get(spec, unsealed).then(
      (built) => {
        state.pipelines[kind] = built;
        return true;
      },
      (e: unknown) => {
        // Left unbuilt and not asked again: one error, not one a frame.
        console.error(`render: the post chain's ${st.name} did not compile`, e);
        return false;
      },
    );
  }

  /** The stage's block, its bind group and its draw, queued into the pass just opened. */
  private draw(state: StageState, kind: number, input: HostTexture, owner: PostPassOwner): void {
    const built = state.pipelines[kind];
    if (!built) {
      // Never asked for this kind (a list that grew): asked now, as a miss.
      if (!state.asked[kind]) void this.ask(state, kind, false);
      return;
    }
    const st = state.stage;
    const host = this.renderer.host;
    const b = this.bound;
    host.bind(input, b);
    const inputView = b.view;
    if (!inputView) return;
    for (let i = 0; i < st.extras.length; i++) {
      const x = st.extras[i];
      const t = x.texture();
      if (!t) return;
      if (t instanceof OwnTexture) {
        b.view = t.view;
        b.sampler = t.sampler;
      } else host.bind(t, b);
      if (!b.view) return;
      if (x.samplerBinding !== undefined && !b.sampler) return;
      state.extraViews[i] = b.view;
      state.extraSamplers[i] = x.samplerBinding !== undefined ? b.sampler : null;
    }
    // The block, written only when a value moved.
    st.fill(state.values, owner.width, owner.height);
    const v = state.values;
    const w = state.written;
    let moved = !state.wroteOnce;
    for (let i = 0; i < v.length && !moved; i++) moved = !Object.is(v[i], w[i]);
    if (moved) {
      w.set(v);
      state.wroteOnce = true;
      this.device.queue.writeBuffer(state.block, 0, v);
    }
    const internals = this.internals[kind];
    if (owner.height !== this.internalsHeight[kind]) {
      this.internalsHeight[kind] = owner.height;
      this.internalsValues[kind][1] = owner.height;
      this.device.queue.writeBuffer(internals, 0, this.internalsValues[kind]);
    }
    const layout = built.groups[1];
    let stale =
      !state.group || state.groupLayout !== layout || state.groupInternals !== internals || state.groupInput !== inputView;
    for (let i = 0; i < st.extras.length && !stale; i++) {
      stale = state.groupExtras[i] !== state.extraViews[i] || state.groupExtraSamplers[i] !== state.extraSamplers[i];
    }
    if (stale) {
      const entries: GPUBindGroupEntry[] = [
        { binding: st.inputBinding, resource: inputView },
        { binding: st.inputSamplerBinding, resource: state.sampler },
        // Sized, as Babylon binds a block: the whole of each.
        { binding: st.internalsBinding, resource: { buffer: internals, offset: 0, size: 8 } },
        { binding: st.blockBinding, resource: { buffer: state.block, offset: 0, size: st.blockFloats * 4 } },
      ];
      st.extras.forEach((x, i) => {
        entries.push({ binding: x.binding, resource: state.extraViews[i]! });
        if (x.samplerBinding !== undefined) entries.push({ binding: x.samplerBinding, resource: state.extraSamplers[i]! });
      });
      entries.sort((p, q) => p.binding - q.binding);
      state.group = this.device.createBindGroup({ label: `${st.label}: group 1`, layout, entries });
      state.groupLayout = layout;
      state.groupInternals = internals;
      state.groupInput = inputView;
      for (let i = 0; i < st.extras.length; i++) {
        state.groupExtras[i] = state.extraViews[i];
        state.groupExtraSamplers[i] = state.extraSamplers[i];
      }
    }
    this.empty ??= this.device.createBindGroup({ label: "post chain: group 0", layout: built.groups[0], entries: [] });
    state.pipeline = built;
    this.renderer.postStageOpened(kind === CANVAS ? this.canvas : POST_TARGETS, state.run);
  }

  private run(pass: GPURenderPassEncoder, state: StageState): void {
    pass.setPipeline(state.pipeline!.pipeline);
    pass.setBindGroup(0, this.empty);
    pass.setBindGroup(1, state.group);
    pass.setVertexBuffer(0, this.quad);
    pass.setIndexBuffer(this.indices, "uint16");
    pass.drawIndexed(6, 1, 0, 0, 0);
  }

  private buffer(label: string, data: Float32Array | Uint16Array, usage: number): GPUBuffer {
    // Padded to four bytes, as `mappedAtCreation` asks.
    const size = Math.ceil(data.byteLength / 4) * 4;
    const b = this.device.createBuffer({ label, size, usage, mappedAtCreation: true });
    new Uint8Array(b.getMappedRange()).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    b.unmap();
    return b;
  }
}
