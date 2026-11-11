/**
 * render/GlowBlur.ts — The glow's blur and box downsample as OUR draws
 * (`BABYLON_EXIT.md` X5.2b): Babylon's `kernelBlur` and the `glowDown` effect,
 * ported as compiled, each drawn in a pass of our own (`Renderer.glowBlurPass`,
 * X5.4e) on the glow's targets (`FrameTargets`), as `GlowPass` asks, with no
 * change to the pass structure Babylon's own draws had.
 * Owns: `GlowBlur` — one pipeline per compiled kernel width asked
 * (`wgsl/glowBlur.ts`' `glowBlurModules`, at the device's own
 * `maxInterStageShaderVariables`, Babylon's `maxVaryingVectors`) and the box
 * filter's; Babylon's full-screen quad as a vertex and an index buffer; the
 * shared `Internals` block (Babylon's `UBInvertY`: -1, and the render height);
 * one `LeftOver` block a pass (the box filter's `scale` and `texel`, each
 * blur's `delta`), so each of the five reads its own, as Babylon's owner-keyed
 * slots gave each draw context its own; each pass's bind group; and `ready`,
 * the pipelines it was built to declare.
 * Invariants: every pipeline is Babylon's state as the probe read it off the
 * parent's device (`plans/webgpu-ref/post.mjs`): a `float32x2` attribute at
 * stride 8 off the quad `(1,1) (-1,1) (-1,-1) (1,-1)`, `uint16` indices
 * `0,1,2,0,2,3`, `drawIndexed(6, 1, 0, 0, 0)`, a triangle list culled back with
 * the front face `cw` (`PipelineCache`'s rule for a flipped pass), no depth,
 * no blend, write mask 15, group 0 an EMPTY group, everything in group 1 —
 * the source at 0, its sampler at 1, `Internals` at 2, the pass's `LeftOver` at
 * 3, each block 8 and 16 bytes as Babylon's, written as Babylon computed it
 * (`delta` is `(1 / width) * direction.x, (1 / height) * direction.y` of the
 * TARGET, in float64, then rounded); the source is read through its own view
 * and the sampler Babylon's cache made for the glow's targets (`FrameTargets`:
 * ours since `BABYLON_EXIT.md` X5.4e, Babylon's render targets before, read
 * through the seam); a pass is drawn only into a target made as
 * `GLOW_BLUR_TARGETS` states, by construction (`Renderer.glowBlurPass`); the kernels
 * `declare` is handed are asked as they are handed, and one first asked at
 * draw time is asked as a miss (the seal says so in play); a kernel whose
 * pipeline is not built yet is NOT drawn — the pass is skipped, its target
 * keeping what it held (the difference below); nothing here allocates on a
 * frame once its bind groups are made (they are remade only when a source's
 * view or sampler changes: a resize).
 * Never: imports Babylon; begins a pass itself — `Renderer.glowBlurPass` does,
 * around the draw; draws a pass `GlowPass` has not asked for.
 *
 * A KNOWN LIVE DIFFERENCE, ACCEPTED BY THE OWNER ON 2026-11-08 (`BABYLON_EXIT.md`
 * X5.2's row "a DPR change in play"): that skip is NOT what Babylon did.
 * Babylon compiled a new width SYNCHRONOUSLY at its first draw
 * (`createRenderPipeline`), taking the hitch and drawing the bloom on that
 * frame; ours compiles off the frame (`createRenderPipelineAsync`). So after
 * a device-pixel-ratio change in play — a browser zoom, the window moved to
 * another monitor — its new widths (up to five) compile for ~3 frames, and
 * since the resize that came with the change recreated the glow's targets
 * zero-filled, the ink composes NO bloom on those frames. A ratio changed in
 * the MENU is the same difference: its widths are declared after the round's
 * list was taken (`ready` covers the constructor's alone), so the warm-up
 * does not wait for them, and a round that reaches play before they are
 * built skips the blur the same way.
 * Contract: `docs/rendering.md`, "The glow: what the depth share replaced".
 */
import type { FrameTarget } from "./FrameTargets";
import type { BuiltPipeline, PipelineSpec, ShaderSource } from "./PipelineCache";
import type { Renderer } from "./Renderer";
import { GLOW_BLUR_TARGETS } from "./targets";
import type { AssembledBinding } from "./wgsl/assemble";
import { blurKernel, GLOW_DOWN_FRAGMENT, GLOW_DOWN_VERTEX, glowBlurModules } from "../shaders/wgsl/glowBlur";

/** What the vertex modules declare: `Internals` and the pass's `LeftOver` (every effect's vertex module carries its whole block). */
const VERTEX_BINDINGS: readonly AssembledBinding[] = [
  { group: 1, binding: 2, kind: "uniform", name: "internals", type: "Internals" },
  { group: 1, binding: 3, kind: "uniform", name: "uniforms", type: "LeftOver" },
];

/** What the fragment modules declare: the source, its sampler, and both blocks. */
const FRAGMENT_BINDINGS: readonly AssembledBinding[] = [
  { group: 1, binding: 0, kind: "texture", name: "textureSampler", type: "texture_2d<f32>" },
  { group: 1, binding: 1, kind: "sampler", name: "textureSamplerSampler", type: "sampler" },
  ...VERTEX_BINDINGS,
];

/** Babylon's quad attribute: `position`, two floats at location 0 (`EffectRenderer`'s "always assumes stride of 2"). */
const QUAD_LAYOUT: readonly GPUVertexBufferLayout[] = [
  { arrayStride: 8, stepMode: "vertex", attributes: [{ format: "float32x2", offset: 0, shaderLocation: 0 }] },
];

/** `EffectRenderer`'s default quad and its indices. */
const QUAD = new Float32Array([1, 1, -1, 1, -1, -1, 1, -1]);
const QUAD_INDICES = new Uint16Array([0, 1, 2, 0, 2, 3]);

/**
 * The usages Babylon's buffer manager gave the quad's two buffers (read off the
 * parent: 168 and 152 — storage, for its vertex pulling, beside vertex or index
 * and copy-dst), so the probe reads them as the same buffers. As LITERALS:
 * this module is read before a device exists — `main.ts` imports `Game`
 * statically — and `GPUBufferUsage` is a secure-context global a browser
 * without WebGPU does not have, so naming it here would throw before the boot
 * gate could say why (`particleProgram.ts`' `COMPUTE` is the precedent).
 */
const QUAD_USAGE = 168; // GPUBufferUsage.VERTEX (32) | STORAGE (128) | COPY_DST (8)
const INDEX_USAGE = 152; // GPUBufferUsage.INDEX (16) | STORAGE (128) | COPY_DST (8)

/** The five passes, in `GlowPass`'s order: the box filter, then mask → near (across, down) → wide (across, down). */
const DOWN = 4;

/** One pass's own state: its block, its last values and its bind group. */
interface PassState {
  readonly block: GPUBuffer;
  /** The block's values as last written (the box filter's four, a blur's `delta` and two zeros). */
  readonly values: Float32Array<ArrayBuffer>;
  /** Whether `values` has reached the block yet. */
  written: boolean;
  /** The pipeline this pass draws with this frame. */
  pipeline: BuiltPipeline | null;
  group: GPUBindGroup | null;
  /** What `group` was made from. */
  groupLayout: GPUBindGroupLayout | null;
  groupView: GPUTextureView | null;
  groupSampler: GPUSampler | null;
}

export class GlowBlur {
  /** Settles once every pipeline the constructor was handed is built (true) or one failed (false). */
  readonly ready: Promise<boolean>;
  private readonly device: GPUDevice;
  /** Babylon's `maxVaryingVectors` under WebGPU: the device's own limit. */
  private readonly limit: number;
  /** Built pipelines by compiled kernel width, null while compiling; absent: never asked. */
  private readonly blurs = new Map<number, BuiltPipeline | null>();
  private downPipeline: BuiltPipeline | null = null;
  private readonly quad: GPUBuffer;
  private readonly indices: GPUBuffer;
  private readonly internals: GPUBuffer;
  private readonly internalsValues = new Float32Array([-1, 0]);
  private internalsHeight = -1;
  private readonly passes: PassState[] = [];
  /** Group 0, which every pipeline here declares EMPTY, made once against the first layout seen. */
  private empty: GPUBindGroup | null = null;
  /** One draw function a pass, made once, so a frame's passes allocate nothing. */
  private readonly runs: ((pass: GPURenderPassEncoder) => void)[] = [];
  /** What blurs 1 to 3 read (the first's is the mask or the box filter's output) and what the four draw into. */
  private readonly sources: readonly FrameTarget[];
  private readonly outputs: readonly FrameTarget[];

  constructor(
    private readonly renderer: Renderer,
    /** The ideal kernels to declare (`glowKernels`: every rung at every render scale at the current DPR). */
    kernels: readonly number[],
  ) {
    const device = renderer.device;
    this.device = device;
    this.limit = device.limits.maxInterStageShaderVariables;
    const t = renderer.targets;
    this.sources = [t.mask, t.nearH, t.near, t.wideH];
    this.outputs = [t.nearH, t.near, t.wideH, t.wide];
    this.quad = this.buffer("glow blur: quad", QUAD, QUAD_USAGE);
    this.indices = this.buffer("glow blur: quad indices", QUAD_INDICES, INDEX_USAGE);
    this.internals = device.createBuffer({
      label: "glow blur: internals",
      size: 8,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    for (let i = 0; i < 5; i++) {
      this.passes.push({
        block: device.createBuffer({
          label: i === DOWN ? "glow down: leftover" : `glow blur ${i}: leftover`,
          size: 16,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        }),
        values: new Float32Array(4),
        written: false,
        pipeline: null,
        group: null,
        groupLayout: null,
        groupView: null,
        groupSampler: null,
      });
      const state = this.passes[i];
      this.runs.push((pass) => this.run(pass, state));
    }
    const asks: Promise<boolean>[] = [
      renderer.pipelines.get(this.spec("glow down", GLOW_DOWN_VERTEX, GLOW_DOWN_FRAGMENT)).then(
        (built) => {
          this.downPipeline = built;
          return true;
        },
        (e: unknown) => {
          console.error("render: the glow's box filter did not compile", e);
          return false;
        },
      ),
    ];
    for (const k of kernels) {
      const n = blurKernel(k);
      if (!this.blurs.has(n)) asks.push(this.ask(n, false));
    }
    this.ready = Promise.all(asks).then((oks) => oks.every(Boolean));
  }

  /**
   * Asks the blur for every ideal kernel in `kernels` that is not asked yet —
   * the glow's every rung at every render scale at a device pixel ratio the
   * session has moved to (`glowKernels`) — as asks the seal ALLOWS (X5.2's row
   * "pipelines": a compile on a DPR change is allowed). The blur is skipped
   * while one compiles (~3 frames), where Babylon compiled it synchronously
   * and drew it — the live difference the header records, accepted by the
   * owner on 2026-11-08.
   */
  declare(kernels: readonly number[]): void {
    for (const k of kernels) {
      const n = blurKernel(k);
      if (!this.blurs.has(n)) void this.ask(n, true);
    }
  }

  /** Whether the box filter can draw this frame. */
  downReady(): boolean {
    return this.downPipeline !== null;
  }

  /**
   * Whether a blur of ideal width `kernel` can draw this frame; a width never
   * asked is asked now, as a MISS (the seal's DEV warning names it in play).
   */
  blurReady(kernel: number): boolean {
    const n = blurKernel(kernel);
    if (!this.blurs.has(n)) void this.ask(n, false);
    return this.blurs.get(n) != null;
  }

  /**
   * The box filter's pass (`glow.down`), into the glow's `down` target, reading
   * the mask, of `width` x `height`: Babylon's `scale` (1, 1) and `texel`, one
   * texel of the source. `outputHeight` is the render height
   * (`Internals.textureOutputHeight_`, as Babylon's engine wrote it).
   */
  down(width: number, height: number, outputHeight: number): void {
    const t = this.renderer.targets;
    this.write(this.passes[DOWN], 1, 1, 1 / width, 1 / height);
    this.draw(DOWN, this.downPipeline, t.mask, t.down, outputHeight);
  }

  /**
   * Blur pass `index` (0 to 3: near across, near down, wide across, wide down)
   * into its target (`nearH`, `near`, `wideH`, `wide`), of `width` x `height`,
   * reading the pass before's output — the first, the box filter's output
   * `fromDown`, else the mask — with the kernel of ideal width `kernel`,
   * `across` or down: `delta` as `ThinBlurPostProcess.bind` computes it.
   */
  blur(
    index: number,
    kernel: number,
    across: boolean,
    fromDown: boolean,
    width: number,
    height: number,
    outputHeight: number,
  ): void {
    const dx = across ? 1 : 0;
    const dy = across ? 0 : 1;
    this.write(this.passes[index], (1 / width) * dx, (1 / height) * dy, 0, 0);
    const source = index === 0 && fromDown ? this.renderer.targets.down : this.sources[index];
    this.draw(index, this.blurs.get(blurKernel(kernel)) ?? null, source, this.outputs[index], outputHeight);
  }

  dispose(): void {
    this.quad.destroy();
    this.indices.destroy();
    this.internals.destroy();
    for (const p of this.passes) p.block.destroy();
  }

  private ask(n: number, unsealed: boolean): Promise<boolean> {
    this.blurs.set(n, null);
    const m = glowBlurModules(n, this.limit);
    return this.renderer.pipelines.get(this.spec(`glow blur ${n}`, m.vertex, m.fragment), unsealed).then(
      (built) => {
        this.blurs.set(n, built);
        return true;
      },
      (e: unknown) => {
        // Left unbuilt and not asked again, so a module that cannot compile
        // costs one error rather than one a frame: the blur at that width is
        // skipped for the session, its targets keeping what they held.
        console.error(`render: the glow's blur of width ${n} did not compile`, e);
        return false;
      },
    );
  }

  private spec(label: string, vertex: string, fragment: string): PipelineSpec {
    const v: ShaderSource = { label: `${label}: vertex`, code: vertex, bindings: VERTEX_BINDINGS };
    const f: ShaderSource = { label: `${label}: fragment`, code: fragment, bindings: FRAGMENT_BINDINGS };
    return {
      vertex: v,
      vertexEntry: "main",
      fragment: f,
      fragmentEntry: "main",
      targets: GLOW_BLUR_TARGETS,
      vertexBuffers: QUAD_LAYOUT,
    };
  }

  /** A pass's block, written only when a value moved. */
  private write(state: PassState, a: number, b: number, c: number, d: number): void {
    const v = state.values;
    if (state.written && v[0] === Math.fround(a) && v[1] === Math.fround(b) && v[2] === Math.fround(c) && v[3] === Math.fround(d)) {
      return;
    }
    v[0] = a;
    v[1] = b;
    v[2] = c;
    v[3] = d;
    state.written = true;
    this.device.queue.writeBuffer(state.block, 0, v);
  }

  /** The pass's bind group for this frame's source, and its pass recorded with the draw in it. */
  private draw(index: number, pipeline: BuiltPipeline | null, source: FrameTarget, target: FrameTarget, outputHeight: number): void {
    if (!pipeline) return;
    const state = this.passes[index];
    if (outputHeight !== this.internalsHeight) {
      this.internalsHeight = outputHeight;
      this.internalsValues[1] = outputHeight;
      this.device.queue.writeBuffer(this.internals, 0, this.internalsValues);
    }
    const view = source.view;
    const sampler = source.sampler;
    if (!view || !sampler) return;
    const layout = pipeline.groups[1];
    if (!state.group || state.groupLayout !== layout || state.groupView !== view || state.groupSampler !== sampler) {
      state.group = this.device.createBindGroup({
        label: "glow blur: source",
        layout,
        entries: [
          { binding: 0, resource: view },
          { binding: 1, resource: sampler },
          // Sized, as Babylon binds a block: the whole of each.
          { binding: 2, resource: { buffer: this.internals, offset: 0, size: 8 } },
          { binding: 3, resource: { buffer: state.block, offset: 0, size: 16 } },
        ],
      });
      state.groupLayout = layout;
      state.groupView = view;
      state.groupSampler = sampler;
    }
    this.empty ??= this.device.createBindGroup({ label: "glow blur: group 0", layout: pipeline.groups[0], entries: [] });
    state.pipeline = pipeline;
    this.renderer.glowBlurPass(target, this.runs[index]);
  }

  private readonly run = (pass: GPURenderPassEncoder, state: PassState): void => {
    pass.setPipeline(state.pipeline!.pipeline);
    pass.setBindGroup(0, this.empty);
    pass.setBindGroup(1, state.group);
    pass.setVertexBuffer(0, this.quad);
    pass.setIndexBuffer(this.indices, "uint16");
    pass.drawIndexed(6, 1, 0, 0, 0);
  };

  private buffer(label: string, data: Float32Array | Uint16Array, usage: number): GPUBuffer {
    // Padded to four bytes, as `mappedAtCreation` asks (the indices are 12).
    const size = Math.ceil(data.byteLength / 4) * 4;
    const b = this.device.createBuffer({ label, size, usage, mappedAtCreation: true });
    new Uint8Array(b.getMappedRange()).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    b.unmap();
    return b;
  }
}
