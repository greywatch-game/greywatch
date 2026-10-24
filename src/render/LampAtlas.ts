/**
 * render/LampAtlas.ts — The lamps' shadow atlas as OUR renderer owns it
 * (`BABYLON_EXIT.md` X3.6b): one texture of square tiles, a cube face or a
 * spot each, which this module clears and draws into — a fixture's STATIC
 * faces from the world's casters (`WorldDepth`, culled for each face at a
 * slot of its own), and every DYNAMIC tile from proxy boxes — and which
 * every reader on either side samples where it lies.
 * Owns: `LampAtlas` — the atlas (`SHADOW_TARGETS`' colour format) and its
 * depth attachment, the far tile a tile is cleared by copying, the
 * `OwnTexture` our frame binds the atlas through and its sampler, the face
 * records' block and the static faces' tile slots with their bind groups,
 * each static face's cull inputs, the proxy box, the proxies' buffers, bind
 * groups and pipeline, and the frame's work until it is recorded; it HOLDS
 * the casters (`WorldDepth`, the map's while the atlas is ours), which
 * `WorldBlocks` owns; `AtlasWork`, what `LocalShadows` hands it a frame.
 * Invariants: it decides nothing — which lights cast, which tiles each holds,
 * which faces are baked and which tiles redrawn are `LocalShadows`', handed
 * over once a frame (`queue`) — and records what it was handed on the next
 * frame our renderer prepares, into the encoder the host submits ahead of
 * every Babylon pass, so every reader that frame samples the atlas drawn for
 * it; the work is CONSUMED there, so a frame that queues nothing draws
 * nothing, and work still unrecorded when the next is queued is `owed`; a
 * frame's passes come in Babylon's order — every tile flagged CLEARED first
 * (a copy of the far tile, nothing in the way), then a pass a static face,
 * each after its own culls (`PASS_LAMPS`, at the face's slot past the
 * world's maps), then one pass for every dynamic tile — and nothing else is
 * ever cleared, because a static tile must survive every frame that does not
 * bake it; every pass keeps the casters' BACK faces, as Babylon's depth
 * material did; the depth attachment is cleared by each pass and kept by
 * none, because no tile is drawn by two; a texture is born CLEARED to the
 * far value by a submit of its own, and is destroyed when the atlas is
 * re-sized or this is disposed — and by Babylon, at the end of its frame,
 * when a wrapped view of it is disposed, so whoever wraps one lets the view
 * go only with the texture it wraps (`LocalShadows.remake`); `ready` is
 * false until the proxies' pipeline and the casters are built, and
 * `LocalShadows` shadows no light until it is true — a pipeline that FAILS
 * loses the casters and takes none again, so the atlas goes back to
 * Babylon's render target rather than dark; nothing here allocates
 * on a frame but the passes WebGPU makes.
 * Never: imports Babylon; reads a node; decides a face or a tile.
 * Contract: `docs/rendering.md`, "The lamps' shadows" and "Our renderer's
 * frame".
 */
import { createCullInputs, type CullInputs } from "./ClusterCull";
import type { FrameUniforms } from "./frame";
import { HostBindGroup, OwnTexture } from "./HostBindGroup";
import {
  faceInputs,
  LAMP_BLOCK,
  lampProxyDepth,
  PROXY_CORNERS,
  PROXY_GEOMETRY,
  proxyBoxPositions,
} from "./lampDepth";
import type { PassTiming } from "./PassTimer";
import type { BuiltPipeline } from "./PipelineCache";
import type { Renderer } from "./Renderer";
import { SHADOW_TARGETS } from "./targets";
import { UniformBlockBuffer } from "./UniformBlockBuffer";
import { PASS_LAMPS } from "./wgsl/clusterCull";
import type { WorldDepth } from "./WorldDepth";

/**
 * One frame's work, as `LocalShadows` lays it out: one object it owns and
 * refills in place, handed over by `queue` and read when the frame is
 * recorded.
 */
export interface AtlasWork {
  /** The face records, four vec4s a tile, as `LAMP_BLOCK`'s `faces` reads them. */
  readonly faces: Float32Array<ArrayBuffer>;
  /** One flag a tile: above 0.5 clears it this frame — a static face being baked, a dynamic tile redrawn. */
  readonly clear: Float32Array<ArrayBuffer>;
  /** The static faces baked this frame, by tile: the first `bakes` of them. */
  readonly bakeTiles: Int32Array;
  bakes: number;
  /** The proxies — a matrix (16 floats, Babylon's order) and a tile each — and how many. */
  readonly proxyMatrices: Float32Array<ArrayBuffer>;
  readonly proxyTiles: Float32Array<ArrayBuffer>;
  proxies: number;
  /** Whether the dynamic tiles flagged are drawn this frame. */
  dynamic: boolean;
}

/** The far value every reader takes for nothing in the way: the light's range. */
const FAR: GPUColor = { r: 1, g: 1, b: 1, a: 1 };

/** 1 as an IEEE half float — `r16float`'s far value, which a cleared tile holds. */
const HALF_ONE = 0x3c00;

/** A uniform binding's offsets must be multiples of this (WebGPU's `minUniformBufferOffsetAlignment`). */
const UNIFORM_ALIGN = 256;

/** A buffer-to-texture copy's rows must be multiples of this (`bytesPerRow`). */
const ROW_ALIGN = 256;

export class LampAtlas {
  private readonly device: GPUDevice;
  /** Babylon's rule for the atlas: nearest, clamped (`LocalShadows`' render target). */
  private readonly sampler: GPUSampler;
  /** What our renderer binds the atlas as: its view is null while there is none. */
  readonly own = new OwnTexture();
  private size = 0;
  private tile = 0;
  private tilesPerRow = 0;
  private colour: GPUTexture | null = null;
  private depthTexture: GPUTexture | null = null;
  /**
   * A tile of the far value, copied over every tile a frame clears, as one
   * copy's three descriptors — made with the atlas, the origin moved a tile.
   */
  private far: GPUBuffer | null = null;
  private farCopy: GPUTexelCopyBufferInfo | null = null;
  private readonly tileOrigin = { x: 0, y: 0 };
  private tileCopy: GPUTexelCopyTextureInfo | null = null;
  private readonly tileSize = { width: 0, height: 0 };
  /** Every pass but the clears: the atlas kept, the depth cleared. */
  private pass: GPURenderPassDescriptor | null = null;

  /** The face records and the atlas's shape, written once a recorded frame. */
  private readonly lampBlock: UniformBlockBuffer;
  private readonly shape = new Float32Array(4);
  private readonly lampValues: { faces: Float32Array | undefined; atlasShape: Float32Array };
  /** Group 0 of the proxies' pass: the lamp block alone, against each layout asked. */
  private readonly lampGroups = new Map<GPUBindGroupLayout, GPUBindGroup>();
  private readonly lampGroup = (layout: GPUBindGroupLayout): GPUBindGroup => {
    let group = this.lampGroups.get(layout);
    if (!group) {
      group = this.device.createBindGroup({
        label: "lamp atlas: lamp",
        layout,
        entries: [{ binding: 0, resource: { buffer: this.lampBlock.buffer } }],
      });
      this.lampGroups.set(layout, group);
    }
    return group;
  };

  /** Each static face's tile, a uniform slot apiece (`LAMP_FACE_BLOCK`), and the floats written into them. */
  private readonly faceBuffer: GPUBuffer;
  private readonly faceTiles: Float32Array<ArrayBuffer>;
  /** Each slot's group 0 — the lamp block and its tile — against each layout asked, made once. */
  private readonly faceGroups: ((layout: GPUBindGroupLayout) => GPUBindGroup)[] = [];
  /** Each static face's cull inputs: its face's view-projection, the light, the reach, `PASS_LAMPS`. */
  private readonly faceCulls: CullInputs[] = [];

  /** The proxies' pipeline once built, and their buffers. */
  private proxyPipeline: BuiltPipeline | null = null;
  /** The proxies' pipeline did not build: the atlas can never be ours, and no caster is taken for it. */
  private failed = false;
  private readonly boxPositions: GPUBuffer;
  private readonly proxyMatrices: GPUBuffer;
  private readonly proxyTiles: GPUBuffer;
  private readonly proxyGeometry: HostBindGroup;

  /** The casters while the atlas is ours, whether they are built, and the culls' first slot that is ours. */
  private depth: WorldDepth | null = null;
  private built = false;
  private firstSlot = 0;
  /** Bumped by `setCasters`: a build that settles for casters already replaced does nothing. */
  private generation = 0;
  /** Told when the casters this was handed cannot draw (`lose`, or a failed build). */
  private lost: (() => void) | null = null;

  /** The frame's work, queued and not yet recorded. */
  private work: AtlasWork | null = null;
  private readonly unhook: () => void;

  /**
   * Whether the shadow rung draws an atlas at all, whoever holds it — stated
   * by `LocalShadows.setQuality`, which alone knows the rung. With none,
   * casters would be held for it for nothing.
   */
  rungDraws = true;

  constructor(
    renderer: Renderer,
    /** The static faces one frame may bake: a slot each, past the world's maps', in the casters' culls. */
    readonly slots: number,
    /** The most proxies one frame may draw. */
    maxProxies: number,
  ) {
    const device = renderer.device;
    this.device = device;
    this.sampler = device.createSampler({
      label: "lamp atlas",
      magFilter: "nearest",
      minFilter: "nearest",
      mipmapFilter: "nearest",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
    this.lampBlock = new UniformBlockBuffer(device, LAMP_BLOCK, [], "lamp atlas: faces");
    this.lampValues = { faces: undefined, atlasShape: this.shape };

    this.faceBuffer = device.createBuffer({
      label: "lamp atlas: face tiles",
      size: Math.max(1, slots) * UNIFORM_ALIGN,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.faceTiles = new Float32Array((Math.max(1, slots) * UNIFORM_ALIGN) / 4);
    for (let i = 0; i < slots; i++) {
      const groups = new Map<GPUBindGroupLayout, GPUBindGroup>();
      this.faceGroups.push((layout) => {
        let group = groups.get(layout);
        if (!group) {
          group = device.createBindGroup({
            label: `lamp atlas: face ${i}`,
            layout,
            entries: [
              { binding: 0, resource: { buffer: this.lampBlock.buffer } },
              { binding: 1, resource: { buffer: this.faceBuffer, offset: i * UNIFORM_ALIGN, size: 16 } },
            ],
          });
          groups.set(layout, group);
        }
        return group;
      });
      const inputs = createCullInputs();
      inputs.mask = PASS_LAMPS;
      this.faceCulls.push(inputs);
    }

    const box = proxyBoxPositions();
    this.boxPositions = device.createBuffer({
      label: "lamp atlas: proxy box",
      size: box.byteLength,
      usage: GPUBufferUsage.STORAGE,
      mappedAtCreation: true,
    });
    new Float32Array(this.boxPositions.getMappedRange()).set(box);
    this.boxPositions.unmap();
    this.proxyMatrices = device.createBuffer({
      label: "lamp atlas: proxy matrices",
      size: Math.max(1, maxProxies) * 64,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.proxyTiles = device.createBuffer({
      label: "lamp atlas: proxy tiles",
      size: Math.max(1, maxProxies) * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.proxyGeometry = new HostBindGroup(device, "lamp atlas: proxies", PROXY_GEOMETRY, [], {
      boxPositions: this.boxPositions,
      proxyMatrices: this.proxyMatrices,
      proxyTiles: this.proxyTiles,
    });
    // No textures: resolved once, whole for good.
    this.proxyGeometry.refresh(renderer.host, {});

    const program = lampProxyDepth();
    void renderer.pipelines
      .get({
        vertex: program.vertex,
        vertexEntry: "main",
        fragment: program.fragment,
        fragmentEntry: "main",
        targets: SHADOW_TARGETS,
        // The proxy's material culled the FRONT, read off the flipped pass
        // (`WorldDepth`'s rule for the same faces).
        state: { cullMode: "front" },
      })
      .then(
        (built) => {
          this.proxyPipeline = built;
        },
        (err: unknown) => {
          // Babylon's render target can still draw every pass: hand it back.
          console.error("lamp atlas: the proxies' pipeline did not build; the atlas stays Babylon's", err);
          this.failed = true;
          this.lose();
        },
      );
    this.unhook = renderer.onFrame(this.prepare);
  }

  /** The casters while the atlas is ours — null while it is Babylon's. */
  get casters(): WorldDepth | null {
    return this.depth;
  }

  /**
   * Whether the atlas can draw everything a frame may hand it: the proxies'
   * pipeline and the casters built. Until it can, `LocalShadows` shadows no
   * light, so no tile is published that nothing drew.
   */
  get ready(): boolean {
    return this.proxyPipeline !== null && this.depth !== null && this.built;
  }

  /** Work was queued that no frame has recorded yet — a frame our renderer prepared nothing in. */
  get owed(): boolean {
    return this.work !== null;
  }

  /** The atlas, or null while it has none — what a Babylon reader is handed a wrapped view of. */
  get texture(): GPUTexture | null {
    return this.colour;
  }

  /** Who is told when the casters handed over cannot draw, and the atlas must be Babylon's. */
  onLost(lost: () => void): void {
    this.lost = lost;
  }

  /**
   * Re-makes the atlas at `size` texels a side in tiles of `tile` — none at
   * 0 — cleared to the far value, with no work owed. Whoever handed a view of
   * the old texture to a reader must have taken that view back first.
   */
  setSize(size: number, tile: number): void {
    if (size === this.size && tile === this.tile) return;
    this.colour?.destroy();
    this.depthTexture?.destroy();
    this.far?.destroy();
    this.colour = null;
    this.depthTexture = null;
    this.far = null;
    this.farCopy = null;
    this.tileCopy = null;
    this.pass = null;
    this.own.view = null;
    this.own.sampler = null;
    this.work = null;
    this.size = size;
    this.tile = tile;
    this.tilesPerRow = size > 0 ? Math.floor(size / tile) : 0;
    const perRow = Math.max(1, this.tilesPerRow);
    this.shape.set([perRow, 1 / perRow, 0, 0]);
    if (size <= 0) return;
    const device = this.device;
    const colour = device.createTexture({
      label: "lamp atlas",
      size: [size, size],
      format: SHADOW_TARGETS.colorFormats[0],
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.colour = colour;
    this.depthTexture = device.createTexture({
      label: "lamp atlas: depth",
      size: [size, size],
      format: SHADOW_TARGETS.depthFormat!,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    // One tile of the far value, its rows padded to what a copy takes.
    const farRow = Math.ceil((tile * 2) / ROW_ALIGN) * ROW_ALIGN;
    const far = device.createBuffer({
      label: "lamp atlas: far tile",
      size: farRow * tile,
      usage: GPUBufferUsage.COPY_SRC,
      mappedAtCreation: true,
    });
    new Uint16Array(far.getMappedRange()).fill(HALF_ONE);
    far.unmap();
    this.far = far;
    this.farCopy = { buffer: far, bytesPerRow: farRow };
    this.tileCopy = { texture: colour, origin: this.tileOrigin };
    this.tileSize.width = tile;
    this.tileSize.height = tile;
    const view = colour.createView();
    this.own.view = view;
    this.own.sampler = this.sampler;
    this.pass = {
      label: "lamp atlas",
      colorAttachments: [{ view, loadOp: "load", storeOp: "store" }],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthLoadOp: "clear",
        depthStoreOp: "discard",
        depthClearValue: 1,
      },
    };
    // Born holding the far value, by a submit of its own: no reader ever
    // samples a tile nobody drew or cleared.
    const encoder = device.createCommandEncoder({ label: "lamp atlas: clear" });
    encoder.beginRenderPass({ label: "lamp atlas: clear", colorAttachments: [{ view, loadOp: "clear", storeOp: "store", clearValue: FAR }] }).end();
    device.queue.submit([encoder.finish()]);
  }

  /**
   * The casters the static faces are drawn from from now on, at the culls'
   * slots from `firstSlot` (past the world's maps'), or null when the atlas
   * is not ours. Their build is waited on here; one that fails is LOST
   * (`onLost`). None are taken once the proxies' pipeline has failed.
   */
  setCasters(depth: WorldDepth | null, firstSlot: number): void {
    if (this.failed) depth = null;
    this.generation++;
    this.depth = depth;
    this.built = false;
    this.firstSlot = firstSlot;
    this.work = null;
    if (!depth) return;
    const generation = this.generation;
    void depth.ready.then((ok) => {
      if (generation !== this.generation) return;
      if (!ok) {
        this.lose();
        return;
      }
      this.built = true;
    });
  }

  /**
   * The casters can no longer draw what Babylon would — one went back to
   * Babylon's main pass, or the main pass was refused: they are dropped, and
   * whoever asked to be told takes the atlas over (`onLost`) once the task in
   * hand is done.
   */
  lose(): void {
    if (!this.depth) return;
    this.setCasters(null, 0);
    // After the task, for `WorldShadows.lose`'s reason: a loss can land inside
    // a render whose commands, not yet submitted, still hold this texture.
    const lost = this.lost;
    if (lost) queueMicrotask(lost);
  }

  /** `work` is this frame's, recorded as the main pass begins; it is read then, not copied now. */
  queue(work: AtlasWork): void {
    this.work = work;
  }

  /** Drops work no frame recorded (`owed`), whose tiles were given back: nothing is drawn into them. */
  drop(): void {
    this.work = null;
  }

  dispose(): void {
    this.unhook();
    this.setCasters(null, 0);
    this.setSize(0, 0);
    this.lampBlock.destroy();
    this.faceBuffer.destroy();
    this.boxPositions.destroy();
    this.proxyMatrices.destroy();
    this.proxyTiles.destroy();
  }

  /** As the main pass begins: the clears, a pass a static face, then the dynamic tiles. */
  private readonly prepare = (_frame: FrameUniforms, encoder: GPUCommandEncoder, _timing: PassTiming | null): void => {
    const work = this.work;
    this.work = null;
    const pass = this.pass;
    const farCopy = this.farCopy;
    const tileCopy = this.tileCopy;
    if (!work || !pass || !farCopy || !tileCopy || !this.ready) return;
    const tiles = this.tilesPerRow * this.tilesPerRow;
    let cleared = false;
    for (let t = 0; t < tiles && !cleared; t++) cleared = work.clear[t] > 0.5;
    const bakes = Math.min(work.bakes, this.slots);
    const dynamic = work.dynamic && work.proxies > 0;
    // A frame with no work draws nothing, as Babylon's `render` did.
    if (!cleared && bakes === 0 && !dynamic) return;
    this.lampValues.faces = work.faces;
    this.lampBlock.write(this.lampValues);

    // Every tile this frame redraws, back to the far value — the clear
    // sheet's work, as a copy.
    const tile = this.tile;
    for (let t = 0; t < tiles; t++) {
      if (work.clear[t] <= 0.5) continue;
      const row = Math.floor(t / this.tilesPerRow);
      this.tileOrigin.x = (t - row * this.tilesPerRow) * tile;
      this.tileOrigin.y = row * tile;
      encoder.copyBufferToTexture(farCopy, tileCopy, this.tileSize);
    }

    const depth = this.depth!;
    if (bakes > 0) {
      for (let i = 0; i < bakes; i++) this.faceTiles[(i * UNIFORM_ALIGN) / 4] = work.bakeTiles[i];
      this.device.queue.writeBuffer(this.faceBuffer, 0, this.faceTiles, 0, (bakes * UNIFORM_ALIGN) / 4);
      for (let i = 0; i < bakes; i++) {
        const inputs = this.faceCulls[i];
        const t = work.bakeTiles[i];
        faceInputs(work.faces, t, inputs.viewProjection);
        const o = t * 16;
        inputs.eye[0] = work.faces[o];
        inputs.eye[1] = work.faces[o + 1];
        inputs.eye[2] = work.faces[o + 2];
        // The light's range (`faceInputs`).
        inputs.reach2 = work.faces[o + 3] * work.faces[o + 3];
        if (!depth.cull(inputs, encoder, this.firstSlot + i)) continue;
        const p = encoder.beginRenderPass(pass);
        depth.draw(p, "lamp", PASS_LAMPS, this.faceGroups[i]);
        p.end();
      }
    }

    const proxies = this.proxyPipeline!;
    if (dynamic) {
      const n = work.proxies;
      this.device.queue.writeBuffer(this.proxyMatrices, 0, work.proxyMatrices, 0, n * 16);
      this.device.queue.writeBuffer(this.proxyTiles, 0, work.proxyTiles, 0, n);
      const bound = this.proxyGeometry.get(proxies.groups[1]);
      if (!bound) return;
      const p = encoder.beginRenderPass(pass);
      p.setPipeline(proxies.pipeline);
      p.setBindGroup(0, this.lampGroup(proxies.groups[0]));
      p.setBindGroup(1, bound);
      p.draw(n * PROXY_CORNERS);
      p.end();
    }
  };
}
