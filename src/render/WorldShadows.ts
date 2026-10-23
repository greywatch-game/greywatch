/**
 * render/WorldShadows.ts — The world's four directional shadow maps as OUR
 * renderer owns them (`BABYLON_EXIT.md` X3.6a): the far and near cascades,
 * the foliage's front-face map and the lightning's, each a texture this
 * module makes, clears and draws the map's casters into, which every reader
 * on either side samples where it lies.
 * Owns: `WorldShadows` — each map's colour texture (`SHADOW_TARGETS`'
 * format), the depth attachments they share by size, each map's light block
 * (`DEPTH_BLOCK`) and its bind groups, the pass each is drawn with, the
 * `OwnTexture` our renderer binds it through and the sampler behind it, which
 * maps are owed a draw and which have not been drawn since their casters
 * or their texture changed; it HOLDS the casters they are drawn from
 * (`WorldDepth`, the map's while its shadows are ours), which `WorldBlocks`
 * owns; `WORLD_SHADOW_MAPS` and `WorldShadowMap`.
 * Invariants: a map is drawn only when ASKED (`draw`, which `ShadowSystem`
 * calls when a window it places moves, as Babylon's generator re-rendered
 * only when its refresh counter was reset) and is drawn ONCE for the ask, on
 * the next frame our renderer prepares — recorded into the encoder the host
 * submits ahead of every Babylon pass (`FramePrepare`), so every reader that
 * frame, a probe's or the main pass's, samples the map drawn for it; until
 * the casters are built, and on a frame our renderer prepares nothing (it
 * draws nothing of the world's either, which only the first frames of a map
 * behind the building card do), an ask waits; `settled` says whether every
 * map ASKED for since its casters or its texture changed has been drawn once
 * — never whether the latest ask has, which a moving window keeps renewing;
 * its survivors are banded from where the light stands (`draw`'s `eye`) by
 * the camera's bands, which a light ~90 m back mostly lands past, so the
 * order is the scan's and buys the depth test little; a texture is
 * born and re-made CLEARED TO LIT (depth 1, past every receiver) by a submit
 * of its own, so no reader ever samples a map nobody drew, and a map with no
 * casters is cleared to lit as well — and so is the lightning's re-made by a
 * rung change, until the next strike, where Babylon's re-made generator drew
 * the last strike again; the far, near and lightning maps keep
 * the casters' BACK faces and the foliage's their front, each its own pass
 * mask (`PASS_CASTS`, `PASS_SOLID`); a texture is destroyed when its map is
 * re-sized or this is disposed — and by Babylon, at the end of its frame,
 * when a wrapped view of it is disposed, so whoever wraps one lets the view
 * go only with the texture it wraps (`ShadowSystem.remakeOurs`); nothing
 * here allocates on a frame but the passes WebGPU makes.
 * Never: imports Babylon; decides where a light stands or when a window has
 * moved — the matrix is handed in, as `ShadowSystem` places it; reads a node.
 * Contract: `docs/rendering.md`, "The world's map records BACK faces" and
 * "Our renderer's frame".
 */
import { DEPTH_BLOCK } from "./celDepth";
import { createCullInputs, type CullInputs } from "./ClusterCull";
import type { PassTiming } from "./PassTimer";
import { OwnTexture } from "./HostBindGroup";
import type { FrameUniforms } from "./frame";
import type { Renderer } from "./Renderer";
import { SHADOW_TARGETS } from "./targets";
import { type BlockValues, UniformBlockBuffer } from "./UniformBlockBuffer";
import { PASS_CASTS, PASS_SOLID } from "./wgsl/clusterCull";
import type { DepthFaces, WorldDepth } from "./WorldDepth";

/** The world's directional shadow maps, in the order a frame draws those owed. */
export const WORLD_SHADOW_MAPS = ["far", "near", "foliage", "flash"] as const;
export type WorldShadowMap = (typeof WORLD_SHADOW_MAPS)[number];

/** What each map records: which faces, and the clusters of which pass. */
const RECORDS: Readonly<Record<WorldShadowMap, { readonly faces: DepthFaces; readonly mask: number }>> = {
  far: { faces: "back", mask: PASS_CASTS },
  near: { faces: "back", mask: PASS_CASTS },
  foliage: { faces: "front", mask: PASS_SOLID },
  flash: { faces: "back", mask: PASS_CASTS },
};

/** One map's state. */
interface ShadowMapState {
  readonly name: WorldShadowMap;
  /** Its slot in the casters' culls: its place in `WORLD_SHADOW_MAPS`. */
  readonly slot: number;
  /** Its resolution; 0 is none. */
  size: number;
  colour: GPUTexture | null;
  /** What our renderer binds it as; its view is null while the map has no texture. */
  readonly own: OwnTexture;
  /** What it records and how: `RECORDS`' row. */
  readonly faces: DepthFaces;
  /** Its light block, and the bind group made of it against each layout asked. */
  readonly light: UniformBlockBuffer;
  /** What its block is written from: the light's view-projection, which `inputs` holds. */
  readonly lightValues: BlockValues;
  readonly groups: Map<GPUBindGroupLayout, GPUBindGroup>;
  /** `groups`' maker, as `WorldDepth.record` asks for group 0: made once, so a draw makes no closure. */
  readonly lightGroup: (layout: GPUBindGroupLayout) => GPUBindGroup;
  /** What its casters are culled for: its light, its pass mask, no reach, no gate, no sway. */
  readonly inputs: CullInputs;
  /** The pass it is drawn with, made with its texture. */
  pass: GPURenderPassDescriptor | null;
  /** It was asked for and not drawn yet. */
  pending: boolean;
  /** It has been drawn since its casters or its texture last changed. */
  drawnOnce: boolean;
  /** It was asked for since then and not drawn yet: what `settled` waits on. */
  owedFirst: boolean;
}

export class WorldShadows {
  private readonly device: GPUDevice;
  private readonly maps: Record<WorldShadowMap, ShadowMapState>;
  /** The same, in `WORLD_SHADOW_MAPS`' order: what a frame walks. */
  private readonly order: readonly ShadowMapState[];
  /** The depth attachments, one a size in use: the maps draw one after another, so maps of a size share one. */
  private readonly depths = new Map<number, GPUTexture>();
  /** Babylon's rule for a shadow map: nearest, clamped (`ShadowGenerator`, `FILTER_NONE`). */
  private readonly sampler: GPUSampler;
  /** The map's casters while its shadows are ours, and whether they are built. */
  private depth: WorldDepth | null = null;
  private built = false;
  /** Bumped by `setCasters`: a build that settles for casters already replaced does nothing. */
  private generation = 0;
  /** Takes the prepare back off the renderer; null while none is registered. */
  private unhook: (() => void) | null = null;
  /** Told when the casters this was handed cannot draw (`lose`, or a failed build). */
  private lost: (() => void) | null = null;

  constructor(private readonly renderer: Renderer) {
    this.device = renderer.device;
    this.sampler = this.device.createSampler({
      label: "world shadows",
      magFilter: "nearest",
      minFilter: "nearest",
      mipmapFilter: "nearest",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
    const state = (name: WorldShadowMap, slot: number): ShadowMapState => {
      const inputs = createCullInputs();
      inputs.mask = RECORDS[name].mask;
      const map: ShadowMapState = {
        name,
        slot,
        size: 0,
        colour: null,
        own: new OwnTexture(),
        faces: RECORDS[name].faces,
        light: new UniformBlockBuffer(this.device, DEPTH_BLOCK, [], `world shadows: ${name} light`),
        lightValues: { lightViewProjection: inputs.viewProjection },
        groups: new Map(),
        lightGroup: (layout) => this.lightGroup(map, layout),
        inputs,
        pass: null,
        pending: false,
        drawnOnce: false,
        owedFirst: false,
      };
      return map;
    };
    this.maps = {
      far: state("far", 0),
      near: state("near", 1),
      foliage: state("foliage", 2),
      flash: state("flash", 3),
    };
    this.order = WORLD_SHADOW_MAPS.map((name) => this.maps[name]);
  }

  /** The casters while the map's shadows are ours — null while they are Babylon's. */
  get casters(): WorldDepth | null {
    return this.depth;
  }

  /**
   * Whether every map asked for since its casters or its texture changed has
   * been drawn once from built casters — what a reader that samples a map
   * once and keeps the answer waits on (the probes' bake, `ShadowSystem
   * .ready`). Not whether the LATEST ask has been: a window that keeps moving
   * keeps asking, and a gate on that could wait for as long as it moves.
   * False with no casters.
   */
  get settled(): boolean {
    if (!this.depth || !this.built) return false;
    const order = this.order;
    for (let i = 0; i < order.length; i++) if (order[i].owedFirst) return false;
    return true;
  }

  /**
   * Whether the shadow rung draws any of the four maps, whoever holds them —
   * stated by `ShadowSystem.setQuality`, which alone knows the rung's sizes
   * (these textures have none while Babylon's generators hold the maps).
   * With none, a map's casters would be held for nothing.
   */
  rungDraws = true;

  /** How many maps one submit may draw: a slot each in the casters' culls. */
  get slots(): number {
    return WORLD_SHADOW_MAPS.length;
  }

  /** `name`'s texture, or null while it has none — what a Babylon reader is handed a wrapped view of. */
  texture(name: WorldShadowMap): GPUTexture | null {
    return this.maps[name].colour;
  }

  /** `name` as our renderer binds it: a handle whose view follows the texture. */
  own(name: WorldShadowMap): OwnTexture {
    return this.maps[name].own;
  }

  /** Who is told when the casters handed over cannot draw, and the world's shadows must be someone else's. */
  onLost(lost: () => void): void {
    this.lost = lost;
  }

  /**
   * Re-makes `name`'s texture at `size` texels a side — none at 0 — cleared
   * to lit, and owing nothing until `draw` asks. A size that did not move
   * leaves it alone.
   * The old texture is destroyed: whoever handed a view of it to a reader
   * must have taken that view back first.
   */
  setSize(name: WorldShadowMap, size: number): void {
    const map = this.maps[name];
    if (size === map.size) return;
    map.colour?.destroy();
    map.colour = null;
    map.pass = null;
    map.own.view = null;
    map.own.sampler = null;
    map.size = size;
    map.drawnOnce = false;
    map.owedFirst = false;
    this.releaseDepths();
    if (size <= 0) {
      map.pending = false;
      return;
    }
    const colour = this.device.createTexture({
      label: `world shadows: ${name}`,
      size: [size, size],
      format: SHADOW_TARGETS.colorFormats[0],
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    map.colour = colour;
    const view = colour.createView();
    map.own.view = view;
    map.own.sampler = this.sampler;
    map.pass = {
      label: `world shadows: ${name}`,
      colorAttachments: [{ view, loadOp: "clear", storeOp: "store", clearValue: LIT }],
      depthStencilAttachment: {
        view: this.depthOf(size).createView(),
        depthLoadOp: "clear",
        depthStoreOp: "discard",
        depthClearValue: 1,
      },
    };
    this.clear(map);
    // Owed a draw only once asked: the light's matrix is `draw`'s.
    map.pending = false;
  }

  /**
   * Owes `name` a draw from `viewProjection` — the light's, 16 floats as
   * WGSL's `mat4x4f` reads them — on the next frame our renderer prepares;
   * `eye` is where the light stands, which its casters are ordered nearest
   * first from. A map with no texture is asked for nothing.
   */
  draw(name: WorldShadowMap, viewProjection: ArrayLike<number>, eye: ArrayLike<number>): void {
    const map = this.maps[name];
    if (!map.colour) return;
    map.inputs.viewProjection.set(viewProjection);
    map.inputs.eye.set(eye);
    map.pending = true;
    if (!map.drawnOnce) map.owedFirst = true;
  }

  /**
   * The casters the world's maps are drawn from from now on, or null when
   * the world's shadows are not ours: then every map is cleared to lit and
   * nothing more is drawn until casters are handed over again. Their build
   * is waited on here; one that fails is LOST (`onLost`).
   */
  setCasters(depth: WorldDepth | null): void {
    this.generation++;
    this.unhook?.();
    this.unhook = null;
    this.depth = depth;
    this.built = false;
    for (let i = 0; i < this.order.length; i++) {
      this.order[i].drawnOnce = false;
      this.order[i].owedFirst = false;
    }
    if (!depth) {
      for (const name of WORLD_SHADOW_MAPS) {
        const map = this.maps[name];
        map.pending = false;
        if (map.colour) this.clear(map);
      }
      return;
    }
    const generation = this.generation;
    void depth.ready.then((ok) => {
      if (generation !== this.generation) return;
      if (!ok) {
        this.lose();
        return;
      }
      this.built = true;
      this.unhook = this.renderer.onFrame(this.prepare);
    });
  }

  /**
   * The casters can no longer draw what Babylon would — one went back to
   * Babylon's main pass, or the main pass was refused: they are dropped, the
   * maps cleared to lit, and whoever asked to be told takes the world's
   * shadows over (`onLost`) once the task in hand is done.
   */
  lose(): void {
    if (!this.depth) return;
    this.setCasters(null);
    // After the task: a loss can land INSIDE a render (`Renderer.onRefused`),
    // and whoever takes the maps over destroys these textures, which that
    // frame's commands — not yet submitted — still hold.
    const lost = this.lost;
    if (lost) queueMicrotask(lost);
  }

  dispose(): void {
    this.setCasters(null);
    for (const name of WORLD_SHADOW_MAPS) {
      this.setSize(name, 0);
      this.maps[name].light.destroy();
    }
  }

  /** The depth attachment for maps of `size`, made on first ask. */
  private depthOf(size: number): GPUTexture {
    let depth = this.depths.get(size);
    if (!depth) {
      depth = this.device.createTexture({
        label: `world shadows: depth ${size}`,
        size: [size, size],
        format: SHADOW_TARGETS.depthFormat!,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.depths.set(size, depth);
    }
    return depth;
  }

  /** Destroys the depth attachments no map is the size of any more. */
  private releaseDepths(): void {
    for (const [size, depth] of this.depths) {
      if (WORLD_SHADOW_MAPS.some((name) => this.maps[name].size === size)) continue;
      depth.destroy();
      this.depths.delete(size);
    }
  }

  /** `map` cleared to lit, by a submit of its own — a texture's birth, or casters gone. */
  private clear(map: ShadowMapState): void {
    const encoder = this.device.createCommandEncoder({ label: `world shadows: clear ${map.name}` });
    encoder
      .beginRenderPass({
        label: `world shadows: clear ${map.name}`,
        colorAttachments: [{ view: map.own.view!, loadOp: "clear", storeOp: "store", clearValue: LIT }],
      })
      .end();
    this.device.queue.submit([encoder.finish()]);
  }

  /** `map`'s group 0 against `layout`: its light block. */
  private lightGroup(map: ShadowMapState, layout: GPUBindGroupLayout): GPUBindGroup {
    let group = map.groups.get(layout);
    if (!group) {
      group = this.device.createBindGroup({
        label: `world shadows: ${map.name} light`,
        layout,
        entries: [{ binding: 0, resource: { buffer: map.light.buffer } }],
      });
      map.groups.set(layout, group);
    }
    return group;
  }

  /** As the main pass begins: every map owed a draw, drawn, in `WORLD_SHADOW_MAPS`' order. */
  private readonly prepare = (_frame: FrameUniforms, encoder: GPUCommandEncoder, _timing: PassTiming | null): void => {
    const depth = this.depth;
    if (!depth || !this.built) return;
    const order = this.order;
    for (let i = 0; i < order.length; i++) {
      const map = order[i];
      if (!map.pending || !map.pass) continue;
      map.light.write(map.lightValues);
      depth.record(encoder, map.pass, map.inputs, map.faces, map.lightGroup, map.slot);
      map.pending = false;
      map.drawnOnce = true;
      map.owedFirst = false;
    }
  };
}

/** What a texel of a shadow map nothing was drawn into reads: depth 1, the far plane, past every receiver. */
const LIT: GPUColor = { r: 1, g: 1, b: 1, a: 1 };
