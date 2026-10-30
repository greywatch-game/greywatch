/**
 * render/BodyShadowMap.ts — The moon's BODY shadow map as OUR renderer owns
 * it (`BABYLON_EXIT.md` X4.1c): one texture this module makes, clears and
 * draws the bodies' proxy boxes into — soldiers' `RAGDOLL_BONES` and hulls'
 * collider boxes, as `BodyShadows` packs them — which every reader on either
 * side samples where it lies.
 * Owns: `BodyShadowMap` — the map's colour texture (`SHADOW_TARGETS`' format)
 * and its depth attachment, the `OwnTexture` our renderer binds it through and
 * the sampler behind it, the light block (`DEPTH_BLOCK`) and its bind group,
 * the box's corners and the instances' matrices on the GPU, the proxies'
 * geometry group, the pipeline (asked once, for the session), the pass, and
 * the frame's ask until it is recorded.
 * Invariants: it decides nothing — where the window stands, the light's
 * matrix and which bodies cast are `BodyShadows`', handed over each frame it
 * updates (`draw`) — and records the ask on the next frame our renderer
 * prepares, into the encoder the host submits ahead of every Babylon pass, so
 * every reader that frame samples the map drawn for it; an ask holding no
 * proxy OWES a clear, if the map holds any, recorded on the same next frame —
 * the cleared pass Babylon's generator drew for an empty frame, and never
 * sooner: an empty ask made after a frame's render (the warm-up's last,
 * `Game.finishBakeWait`) leaves that frame's picture alone, as it left
 * Babylon's — unless a SECOND ask arrives with no frame prepared since, which
 * is a state whose frames our renderer prepares nothing in (an editor build,
 * whose world is Babylon's): then the clear is recorded at once, into the
 * host's prepare encoder, so it lands after anything already recorded there
 * and never under it, and such a state is never left holding the last round's
 * bodies; a map holding proxies is drawn whole each time — cleared to LIT (depth 1,
 * past every receiver), then every instance — and keeps the casters' BACK
 * faces, as `forceBackFacesOnly` did; a texture is born and re-made CLEARED
 * TO LIT by a submit of its own, and is destroyed when the map is re-sized or
 * this is disposed — and by Babylon, at the end of its frame, when a wrapped
 * view of it is disposed, so whoever wraps one lets the view go only with the
 * texture it wraps (`BodyShadows.setQuality`); until the pipeline is built an
 * ask waits, and a pipeline that FAILS is never drawn and is told to every
 * failure handed over (`setFailure`: the round's, `Game.worldFailed`) — every
 * round after it fails on it too, rather than play with no body map; nothing
 * here allocates on a frame but the passes WebGPU makes.
 * Never: imports Babylon; reads a node; decides where a light stands or what
 * casts.
 * Contract: `docs/rendering.md`, "The bodies' map" and "Our renderer's
 * frame".
 */
import { BODY_PROXIES, bodyDepth } from "./bodyDepth";
import { DEPTH_BLOCK } from "./celDepth";
import type { FrameUniforms } from "./frame";
import { HostBindGroup, OwnTexture } from "./HostBindGroup";
import type { FrameHost } from "./frameHost";
import { PROXY_CORNERS, proxyBoxPositions } from "./lampDepth";
import type { PassTiming } from "./PassTimer";
import type { BuiltPipeline } from "./PipelineCache";
import type { Renderer } from "./Renderer";
import { SHADOW_TARGETS } from "./targets";
import { UniformBlockBuffer } from "./UniformBlockBuffer";

/** What a texel of a map nothing was drawn into reads: depth 1, the far plane, past every receiver. */
const LIT: GPUColor = { r: 1, g: 1, b: 1, a: 1 };

export class BodyShadowMap {
  private readonly device: GPUDevice;
  /** Babylon's rule for a shadow map: nearest, clamped (`ShadowGenerator`, `FILTER_NONE`). */
  private readonly sampler: GPUSampler;
  /** What our renderer binds the map as: its view is null while there is none. */
  readonly own = new OwnTexture();
  private size = 0;
  private colour: GPUTexture | null = null;
  private depthTexture: GPUTexture | null = null;
  /** The pass the map is drawn with, made with its texture: cleared to lit, the depth cleared and discarded. */
  private pass: GPURenderPassDescriptor | null = null;
  /** Whether the texture holds any proxy: what an empty ask has to clear. */
  private holds = false;
  /** An empty ask was made while it held proxies: a clear is owed (`draw`). */
  private owedClear = false;
  /** Asks since a frame was last prepared: a second with none between is a state that prepares nothing. */
  private asks = 0;
  /** The pass an owed clear is recorded with: the colour cleared to lit, nothing drawn. */
  private clearPass: GPURenderPassDescriptor | null = null;
  private readonly host: FrameHost;

  /** The light's view-projection, as the ask hands it, and the block it is written into. */
  private readonly lightMatrix = new Float32Array(16);
  private readonly lightValues = { lightViewProjection: this.lightMatrix };
  private readonly light: UniformBlockBuffer;
  private readonly lightGroups = new Map<GPUBindGroupLayout, GPUBindGroup>();

  /** The box's corners and the instances' matrices, and the proxies' geometry over them. */
  private readonly boxPositions: GPUBuffer;
  private readonly matrices: GPUBuffer;
  private readonly geometry: HostBindGroup;
  private readonly maxInstances: number;

  /** The pipeline once built. */
  private pipeline: BuiltPipeline | null = null;
  /**
   * Whether the pipeline built — asked once, for the session, and settled
   * false if it failed: every failure handed over waits on it (`setFailure`),
   * so one handed over after it fails on it too.
   */
  readonly ready: Promise<boolean>;
  /** Bumped by `setFailure`: a settling for a failure already replaced tells nobody. */
  private generation = 0;

  /** The ask not yet recorded: the instances' matrices (its owner's array, read when recorded) and how many. */
  private pending = false;
  private instances: Float32Array<ArrayBuffer> | null = null;
  private count = 0;
  private readonly unhook: () => void;

  constructor(
    renderer: Renderer,
    /** The most proxies one ask may hold. */
    maxInstances: number,
  ) {
    const device = renderer.device;
    this.device = device;
    this.host = renderer.host;
    this.maxInstances = Math.max(1, maxInstances);
    this.sampler = device.createSampler({
      label: "body shadows",
      magFilter: "nearest",
      minFilter: "nearest",
      mipmapFilter: "nearest",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
    this.light = new UniformBlockBuffer(device, DEPTH_BLOCK, [], "body shadows: light");

    const box = proxyBoxPositions();
    this.boxPositions = device.createBuffer({
      label: "body shadows: proxy box",
      size: box.byteLength,
      usage: GPUBufferUsage.STORAGE,
      mappedAtCreation: true,
    });
    new Float32Array(this.boxPositions.getMappedRange()).set(box);
    this.boxPositions.unmap();
    this.matrices = device.createBuffer({
      label: "body shadows: proxy matrices",
      size: this.maxInstances * 64,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.geometry = new HostBindGroup(device, "body shadows: proxies", BODY_PROXIES, [], {
      boxPositions: this.boxPositions,
      proxyMatrices: this.matrices,
    });
    // No textures: resolved once, whole for good.
    this.geometry.refresh(renderer.host, {});

    const program = bodyDepth();
    this.ready = renderer.pipelines
      .get({
        vertex: program.vertex,
        vertexEntry: "main",
        fragment: program.fragment,
        fragmentEntry: "main",
        targets: SHADOW_TARGETS,
        // The faces a generator forcing back faces keeps, read off the
        // FLIPPED pass (`WorldDepth`'s rule for the world's maps).
        state: { cullMode: "front" },
      })
      .then(
        (built) => {
          this.pipeline = built;
          return true;
        },
        (err: unknown) => {
          // No body map of ours can be drawn this session: every round fails
          // on it (`setFailure`).
          console.error("body shadows: the pipeline did not build; no body map of ours can be drawn", err);
          return false;
        },
      );
    this.unhook = renderer.onFrame(this.prepare);
  }

  /** The map, or null while it has none — what a Babylon reader is handed a wrapped view of. */
  get texture(): GPUTexture | null {
    return this.colour;
  }

  /**
   * Re-makes the map at `size` texels a side — none at 0 — cleared to lit,
   * with nothing asked. A size that did not move leaves it alone. Whoever
   * handed a view of the old texture to a reader must have taken that view
   * back first.
   */
  setSize(size: number): void {
    if (size === this.size) return;
    this.colour?.destroy();
    this.depthTexture?.destroy();
    this.colour = null;
    this.depthTexture = null;
    this.pass = null;
    this.clearPass = null;
    this.own.view = null;
    this.own.sampler = null;
    this.pending = false;
    this.holds = false;
    this.owedClear = false;
    this.size = size;
    if (size <= 0) return;
    const colour = this.device.createTexture({
      label: "body shadows",
      size: [size, size],
      format: SHADOW_TARGETS.colorFormats[0],
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.colour = colour;
    this.depthTexture = this.device.createTexture({
      label: "body shadows: depth",
      size: [size, size],
      format: SHADOW_TARGETS.depthFormat!,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const view = colour.createView();
    this.own.view = view;
    this.own.sampler = this.sampler;
    this.pass = {
      label: "body shadows",
      colorAttachments: [{ view, loadOp: "clear", storeOp: "store", clearValue: LIT }],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthLoadOp: "clear",
        depthStoreOp: "discard",
        depthClearValue: 1,
      },
    };
    this.clearPass = {
      label: "body shadows: clear",
      colorAttachments: [{ view, loadOp: "clear", storeOp: "store", clearValue: LIT }],
    };
    // Born lit by a submit of its own: nothing of ours can be recorded into
    // a texture that did not exist.
    const encoder = this.device.createCommandEncoder({ label: "body shadows: born" });
    encoder.beginRenderPass(this.clearPass).end();
    this.device.queue.submit([encoder.finish()]);
  }

  /**
   * Owes the map a draw of `count` proxies — the first `count` matrices of
   * `instances` (16 floats each, Babylon's `Matrix.m`), read when the draw is
   * recorded, not copied now — from `viewProjection`, the light's (16
   * floats as WGSL's `mat4x4f` reads them), on the next frame our renderer
   * prepares; with none, the map is owed a clear to lit if it holds any, on
   * that same next frame — or at once, if no frame was prepared since the
   * last ask (see the header). A map with no texture is asked for nothing.
   */
  draw(viewProjection: ArrayLike<number>, instances: Float32Array<ArrayBuffer>, count: number): void {
    if (!this.colour) return;
    this.asks++;
    const n = Math.min(count, this.maxInstances);
    if (n <= 0) {
      this.pending = false;
      this.instances = null;
      if (this.holds) {
        if (this.asks > 1) this.clearNow();
        else this.owedClear = true;
      }
      return;
    }
    this.owedClear = false;
    this.lightMatrix.set(viewProjection);
    this.instances = instances;
    this.count = n;
    this.pending = true;
  }

  /**
   * Who is told if this map cannot be drawn — the round's failure (the
   * round's install, `Game.worldFailed`), or nobody (an editor build, a map
   * going): told once the pipeline has settled false, unless another has
   * been handed over since.
   */
  setFailure(failed: (reason: string) => void = ignore): void {
    const generation = ++this.generation;
    void this.ready.then((ok) => {
      if (!ok && generation === this.generation) failed("our bodies' shadow map cannot draw: its pipeline failed");
    });
  }

  dispose(): void {
    this.unhook();
    this.setFailure();
    this.setSize(0);
    this.light.destroy();
    this.boxPositions.destroy();
    this.matrices.destroy();
  }

  /**
   * The owed clear recorded NOW, outside a frame: into the host's prepare
   * encoder, which is submitted with (and after) anything already recorded
   * into it — so a draw a frame recorded earlier can never land on top.
   */
  private clearNow(): void {
    this.host.prepareEncoder().beginRenderPass(this.clearPass!).end();
    this.holds = false;
    this.owedClear = false;
  }

  /** Group 0 against `layout`: the light block. */
  private lightGroup(layout: GPUBindGroupLayout): GPUBindGroup {
    let group = this.lightGroups.get(layout);
    if (!group) {
      group = this.device.createBindGroup({
        label: "body shadows: light",
        layout,
        entries: [{ binding: 0, resource: { buffer: this.light.buffer } }],
      });
      this.lightGroups.set(layout, group);
    }
    return group;
  }

  /** As the main pass begins: an owed clear, or the ask, if one is owed, drawn whole. */
  private readonly prepare = (_frame: FrameUniforms, encoder: GPUCommandEncoder, _timing: PassTiming | null): void => {
    this.asks = 0;
    if (this.owedClear && this.clearPass) {
      encoder.beginRenderPass(this.clearPass).end();
      this.holds = false;
      this.owedClear = false;
      return;
    }
    const pipeline = this.pipeline;
    const instances = this.instances;
    if (!this.pending || !this.pass || !pipeline || !instances) return;
    const bound = this.geometry.get(pipeline.groups[1]);
    if (!bound) return;
    this.pending = false;
    const n = this.count;
    this.device.queue.writeBuffer(this.matrices, 0, instances, 0, n * 16);
    this.light.write(this.lightValues);
    const pass = encoder.beginRenderPass(this.pass);
    pass.setPipeline(pipeline.pipeline);
    pass.setBindGroup(0, this.lightGroup(pipeline.groups[0]));
    pass.setBindGroup(1, bound);
    pass.draw(n * PROXY_CORNERS);
    pass.end();
    this.holds = true;
  };
}

/** A `setFailure` with nobody to tell: an editor build, or tearing down. */
function ignore(): void {}
