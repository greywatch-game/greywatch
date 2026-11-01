/**
 * render/ViewDraw.ts — The player's own WEAPON as OUR renderer draws it
 * (`BABYLON_EXIT.md` X4.3c, X4.3d): every surface of the viewmodel — each
 * rig's colour groups, magazines, bolt, slide and warhead, each optic's
 * housing, reticle and GLASS, the arms, the fist, its frag and pip, the
 * bottle and its wick, the muzzle flash, and the kit screen's CARD — as
 * SEGMENTS of one kit on the GPU once, each frame's drawn segments one draw
 * apiece into the frame's main pass (the card's program, the cel program or
 * the emissive palette's for an unlit part, the glass's), and the lit ones
 * again into the glow's mask.
 * Owns: `ViewDraw` — the kit's arrays (every segment end to end, and the
 * indices rebased onto them), each draw's matrix and bloom on the GPU and the
 * staging arrays a frame writes them into (`matrices`, `segment`, `recipes`;
 * the bloom, which it PULLS), a material block and group per cel recipe it has
 * been handed and the emissive table's, the glass table (each glass's colour
 * and alpha), the card's texture, its sampler and how far its canvas has been
 * uploaded, the pipelines (asked once, for the session), the main-pass draw,
 * the mask draw, the prepare that uploads a frame, the refusal listeners,
 * whoever is told of a failure (`onFailed`), and what it drew last (`stats`);
 * `ViewDrawSegment`, `ViewDrawKind`, `ViewPull`.
 * Invariants: it DECIDES NOTHING — which segments are drawn, in what order,
 * at what matrix, with what material and at what bloom are its caller's
 * (`Game.drawView`, off the tree's own evaluation and Babylon's group-1 sort,
 * `GlowRules`), handed over once a frame (`commit`) and pulled once inside the
 * render (`pull`, in the prepare: the bloom, off the camera the render placed),
 * and drawn on that frame, nothing else; a draw is ONE segment, one instance,
 * as Babylon drew one mesh (`viewProgram.ts`), the draws in the order handed
 * over — which is what settles an equal depth, the later winning, as
 * Babylon's queue settled it — and laid out as the frame draws them: the
 * CARD first (at most one), then the OPAQUE parts, then the GLASSES; the
 * draws go into the main pass at `"afterGroup"` — after rendering group 0 and
 * its blended queue, the slot the card held as the last of that queue and the
 * weapon as group 1's opaque queue and the glasses as its blended one — and
 * the mask's LAST in that pass, after everything of Babylon's and the
 * palette's and the visors' (`Renderer.addGlowMaskLate`, as the pass closes),
 * where group 1 drew them (X4.3c's review, the owner's decision), no depth
 * written, LEQUAL against the depth the main pass's draw wrote by the same
 * vertex module — and only the opaque, unlit, glowing parts: the weapon IS
 * the stage, so its mask is drawn in every state, the kit screen's included,
 * which is the glow's stage rule stated by the draw (a glass and the card are
 * never in it: `noGlow`); the opaque parts write depth and blend nothing; a
 * GLASS is blended as Babylon's `ALPHA_COMBINE` blends — colour (SRC_ALPHA,
 * ONE_MINUS_SRC_ALPHA), alpha (ONE, ONE), so the coverage channel takes its
 * alpha and the ink behind a lens is attenuated by it — writes no depth,
 * tests LEQUAL and culls BACK FACES, which is required rather than a
 * default kept: its arrays are `DOUBLESIDE` — every triangle and a coincident
 * copy wound the other way (`geometry/primitives.ts`) — so drawn with no
 * culling a lens would blend BOTH copies, the holo's 0.12 landing as ~0.226,
 * and culling the back one is what Babylon's default `backFaceCulling` did; the
 * CARD is blended as `ALPHA_REPLACE_COLOR` blends — colour (ONE, ZERO), alpha
 * (ONE, ONE_MINUS_SRC_ALPHA) at a pixel alpha of 0, the coverage channel
 * untouched — tests `always`, WRITES depth and culls nothing; the card's
 * canvas is uploaded as `DynamicTexture.update` uploaded it
 * (`copyExternalImageToTexture`, flipped in y, not premultiplied, into an
 * `rgba8unorm` texture of the canvas's own size with one mip, made at the
 * first paint — the size is the canvas's, stated once, in `ViewModel`) once
 * per paint and no more, and
 * sampled as Babylon's sampler for it did (linear, no mips — a LOD clamped to
 * 0 — clamped in u and v); a card never uploaded is not drawn; the arrays are
 * uploaded as Babylon uploaded a mesh's (float32; a `color` or `uv` a segment
 * does not carry reading what Babylon's one-float empty vertex buffer read,
 * widened: (0, 0, 0, 1) and (0, 0)); a material's block is re-copied from its
 * recipe only when the caller's epoch moves; a frame with a texture
 * unpublished draws nothing, and a draw whose pipeline is unbuilt is skipped,
 * as a Babylon material not ready drew nothing; it is INSTALLED FOR THE
 * SESSION, not the round — the kit screen covers `menu`, where no map stands —
 * and a pipeline that FAILS (asked at construction or at a recipe's first
 * draw), or a refused pass while something of it would draw — told ONCE per
 * change, not every refused frame — is told to `onFailed`'s listener, never
 * inside the render's commands (the caller defers it, `Game.worldFailed`);
 * nothing here allocates on a frame but the first sight of a recipe (a
 * finish's new material) and the card's texture at its first paint (a
 * paint's copy reuses its descriptors).
 * Never: imports Babylon; reads a node, a joint, a mesh or a material.
 * Contract: `docs/rendering.md`, "The weapon, ours".
 */
import { CEL_MATERIAL_BLOCK, CEL_MATERIAL_TEXTURES, type CelRecipe } from "./celMaterial";
import { EMISSIVE_BLOCK, EMISSIVE_BLOCK_DEFINES, type EmissiveRecipe } from "./emissiveWorld";
import type { PassTargets } from "./frameHost";
import { HostBindGroup, OwnTexture } from "./HostBindGroup";
import type { BuiltPipeline, PipelineState } from "./PipelineCache";
import type { FrameContext, Renderer } from "./Renderer";
import { FRAME_TARGETS, GLOW_TARGETS } from "./targets";
import { UniformBlockBuffer } from "./UniformBlockBuffer";
import {
  VIEW_CARD,
  VIEW_GEOMETRY,
  VIEW_GLASS,
  VIEW_GLOW,
  viewBlendedPrograms,
  viewCelProgram,
  viewEmissivePrograms,
  type ViewProgram,
} from "./viewProgram";

/**
 * How a segment is drawn: by its cel material's recipe, by the emissive
 * palette's program (an unlit part), as an optic's glass, or as the kit card.
 */
export type ViewDrawKind = "cel" | "unlit" | "glass" | "card";

/** One segment of the kit: one mesh of the viewmodel it was until X4.3c and X4.3d, in its own frame. */
export interface ViewDrawSegment {
  readonly kind: ViewDrawKind;
  /** xyz a vertex. */
  readonly positions: ArrayLike<number>;
  readonly normals: ArrayLike<number> | null;
  /** rgba a vertex, or null for a segment that carries none. */
  readonly colors: ArrayLike<number> | null;
  /** uv a vertex, or null. */
  readonly uvs: ArrayLike<number> | null;
  /** The emissive table's 1-based slot for an UNLIT segment; 0 for any other. */
  readonly slot: number;
  /** Whether it is drawn into the glow's mask: unlit, a colour above black, and not `noGlow`. */
  readonly glows: boolean;
  /** A GLASS's colour and alpha (rgba, its material's `emissiveColor` and `alpha`); null for any other. */
  readonly tint: readonly number[] | null;
  readonly indices: ArrayLike<number>;
}

/**
 * What the prepare pulls inside the render, for this frame's first `n` draws:
 * each masked draw's bloom into `glow` at `k * 4` (rgb the colour, a the
 * material's alpha) — read off the camera the render has placed.
 */
export type ViewPull = (glow: Float32Array, n: number) => void;

/** Floats in one draw's matrix. */
const MATRIX_FLOATS = 16;

/** `ALPHA_COMBINE`'s factors (Babylon's `alphaCullingState`, mode 2): what an optic's glass blends by. */
const GLASS_BLEND: GPUBlendState = {
  color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
};

/** `ALPHA_REPLACE_COLOR`'s factors (mode 21): what the kit card blends by. */
const CARD_BLEND: GPUBlendState = {
  color: { srcFactor: "one", dstFactor: "zero", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
};

/** A material's own block and its group, made the first time its recipe is drawn. */
interface MaterialSlot {
  readonly block: UniformBlockBuffer;
  readonly group: HostBindGroup;
  /** The cel pipeline for its variant and bias. */
  readonly pipeline: CelPipeline;
}

/** A cel pipeline, by variant and depth bias: built, or not yet. */
interface CelPipeline {
  built: BuiltPipeline | null;
}

export class ViewDraw {
  /** Segments in the kit — and the most draws one frame may make, each drawn at most once. */
  readonly capacity: number;
  /** This frame's draws' matrices, written by the caller before `commit`: draw `k` at `k * 16`, `Matrix.m`'s layout. */
  readonly matrices: Float32Array<ArrayBuffer>;
  /** This frame's draws' segments, by their place in the kit, written before `commit`. */
  readonly segment: Uint32Array<ArrayBuffer>;
  /** This frame's draws' cel recipes, written before `commit`: null for any segment not cel. */
  readonly recipes: (CelRecipe | null)[];
  /** Whether the pipelines asked at construction built; false if one failed. */
  readonly ready: Promise<boolean>;
  /**
   * What the last frame drew: main-pass draws (the card and the glasses
   * among them), mask draws. Nothing in the game reads it; a profiler
   * capture does (`ProfileReport.view`) and the census.
   */
  readonly stats = { drawn: 0, masked: 0 };

  private readonly device: GPUDevice;
  /** Each segment's first index in `indexData`, and its count. */
  private readonly first: Uint32Array;
  private readonly count: Uint32Array;
  private readonly unlit: Uint8Array;
  private readonly glows: Uint8Array;
  private readonly owned: GPUBuffer[] = [];
  private readonly matrixBuffer: GPUBuffer;
  private readonly glowBuffer: GPUBuffer;
  private readonly glow: Float32Array<ArrayBuffer>;
  private readonly geometry: HostBindGroup;
  private readonly emissiveBlock: UniformBlockBuffer;
  private readonly emissiveGroup: HostBindGroup;
  private readonly glowGroup: HostBindGroup;
  private readonly glassGroup: HostBindGroup;
  /** The card's texture, as its group binds it, and the group. */
  private cardTexture: GPUTexture | null = null;
  private readonly cardHandle = new OwnTexture();
  /** A paint's copy: its three descriptors, made with the texture and kept, so a later upload allocates nothing. */
  private cardSource: GPUCopyExternalImageSourceInfo | null = null;
  private cardDestination: GPUCopyExternalImageDestInfo | null = null;
  private readonly cardExtent = [0, 0, 1];
  private readonly cardGroup: HostBindGroup;
  /** The canvas paint last uploaded (`ViewModel.kitCard.painted`): 0 is never. */
  private cardUploaded = 0;
  private emissive: BuiltPipeline | null = null;
  private mask: BuiltPipeline | null = null;
  private glass: BuiltPipeline | null = null;
  private card: BuiltPipeline | null = null;
  /** Every cel pipeline asked, by `celKey`. */
  private readonly cels = new Map<string, CelPipeline>();
  /** Every recipe drawn so far. */
  private readonly materials = new Map<CelRecipe, MaterialSlot>();

  private pending = false;
  private instances = 0;
  /** This frame's layout: draws `[0, cards)` the card, `[cards, glassFrom)` the opaque parts, `[glassFrom, instances)` the glasses. */
  private cards = 0;
  private glassFrom = 0;
  /** This frame's draws include one for the mask. */
  private anyMasked = false;
  /** The materials' epoch as last copied; NaN is never. */
  private epoch = Number.NaN;
  /** This frame's verdict: committed, uploaded. */
  private ours = false;
  private failed: (reason: string) => void;
  private failedPipelines = false;
  /**
   * Whether a refusal of the main pass, or of the mask, has been told since
   * the last frame that drew there — so a refused pass is told ONCE per
   * change, not up to three times a frame (`Renderer.onRefused`).
   */
  private refusalTold = false;
  private maskRefusalTold = false;
  private readonly unhook: () => void;

  constructor(
    private readonly renderer: Renderer,
    segments: readonly ViewDrawSegment[],
    private readonly emissiveRecipe: EmissiveRecipe,
    /** The cel recipes the kit is born wearing: their pipelines are asked here, ahead. */
    celRecipes: readonly CelRecipe[],
    private readonly pull: ViewPull,
    failed: (reason: string) => void,
  ) {
    const device = renderer.device;
    this.device = device;
    this.failed = failed;
    const n = segments.length;
    this.capacity = Math.max(1, n);
    this.matrices = new Float32Array(this.capacity * MATRIX_FLOATS);
    this.segment = new Uint32Array(this.capacity);
    this.recipes = new Array<CelRecipe | null>(this.capacity).fill(null);
    this.glow = new Float32Array(this.capacity * 4);
    this.first = new Uint32Array(this.capacity);
    this.count = new Uint32Array(this.capacity);
    this.unlit = new Uint8Array(this.capacity);
    this.glows = new Uint8Array(this.capacity);

    // The kit's arrays, end to end, and `indexData`: every segment's indices
    // rebased onto them, each segment's run its own.
    let vertices = 0;
    let indexTotal = 0;
    let glasses = 0;
    for (const s of segments) {
      vertices += s.positions.length / 3;
      indexTotal += s.indices.length;
      if (s.kind === "glass") glasses++;
    }
    const positions = new Float32Array(vertices * 3);
    const normals = new Float32Array(vertices * 3);
    // `color` and `uv` where a segment carries none read what Babylon's empty
    // vertex buffer read for a mesh with none: ONE float32 0, which WebGPU
    // widens to (0, 0, 0, 1) and (0, 0) — the baked occlusion UNoccluded.
    const colors = new Float32Array(vertices * 4);
    const uvs = new Float32Array(vertices * 2);
    const uvs2 = new Float32Array(vertices * 2);
    const indices = new Uint32Array(Math.max(1, indexTotal));
    // Each glass's colour and alpha, by its 1-based slot in `uv2.x`.
    const glassTable = new Float32Array(Math.max(1, glasses) * 4);
    let glassSlot = 0;
    let v = 0;
    let at = 0;
    segments.forEach((s, i) => {
      const count = s.positions.length / 3;
      // `Float32Array.set` rounds a double to nearest, as Babylon's upload of
      // a mesh's `number[]` did.
      positions.set(s.positions, v * 3);
      if (s.normals) normals.set(s.normals, v * 3);
      if (s.colors) colors.set(s.colors, v * 4);
      else for (let c = 0; c < count; c++) colors[(v + c) * 4 + 3] = 1;
      if (s.uvs) uvs.set(s.uvs, v * 2);
      let slot = s.kind === "unlit" ? s.slot : 0;
      if (s.kind === "glass") {
        // The material's colour and alpha as Babylon's uniforms held them:
        // float32, rounded once.
        glassTable.set(s.tint!, glassSlot * 4);
        slot = ++glassSlot;
      }
      if (slot > 0) for (let c = 0; c < count; c++) uvs2[(v + c) * 2] = slot;
      this.first[i] = at;
      this.count[i] = s.indices.length;
      this.unlit[i] = s.kind === "unlit" ? 1 : 0;
      this.glows[i] = s.kind === "unlit" && s.glows ? 1 : 0;
      for (let j = 0; j < s.indices.length; j++) indices[at++] = s.indices[j] + v;
      v += count;
    });

    const storage = (label: string, data: ArrayBufferView<ArrayBuffer>): GPUBuffer => {
      const buffer = device.createBuffer({
        label: `view: ${label}`,
        size: Math.max(16, Math.ceil(data.byteLength / 4) * 4),
        usage: GPUBufferUsage.STORAGE,
        mappedAtCreation: true,
      });
      new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      buffer.unmap();
      this.owned.push(buffer);
      return buffer;
    };
    const frameBuffer = (label: string, bytes: number): GPUBuffer => {
      const buffer = device.createBuffer({
        label: `view: ${label}`,
        size: Math.max(16, bytes),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.owned.push(buffer);
      return buffer;
    };
    this.matrixBuffer = frameBuffer("matrices", this.matrices.byteLength);
    this.glowBuffer = frameBuffer("bloom", this.glow.byteLength);
    const host = renderer.host;
    this.geometry = new HostBindGroup(device, "view: geometry", VIEW_GEOMETRY, [], {
      positionData: storage("positions", positions),
      normalData: storage("normals", normals),
      colorData: storage("colours", colors),
      uvData: storage("uvs", uvs),
      uv2Data: storage("slots", uvs2),
      indexData: storage("indices", indices),
      viewMatrices: this.matrixBuffer,
    });
    // No textures: resolved once, whole for good.
    this.geometry.refresh(host, {});
    this.emissiveBlock = new UniformBlockBuffer(device, EMISSIVE_BLOCK, EMISSIVE_BLOCK_DEFINES, "view: emissive");
    this.emissiveGroup = new HostBindGroup(device, "view: emissive", [EMISSIVE_BLOCK], [], {
      [EMISSIVE_BLOCK.var]: this.emissiveBlock.buffer,
    });
    this.emissiveGroup.refresh(host, {});
    this.glowGroup = new HostBindGroup(device, "view: bloom", VIEW_GLOW, [], { viewGlow: this.glowBuffer });
    this.glowGroup.refresh(host, {});
    this.glassGroup = new HostBindGroup(device, "view: glass", VIEW_GLASS, [], {
      viewGlass: storage("glass", glassTable),
    });
    this.glassGroup.refresh(host, {});
    // The card's sampler: what Babylon's WebGPU cache made of a trilinear
    // sampling mode with no mips — linear both ways, the LOD clamped to 0,
    // clamped in u and v (w at its default, which a 2D lookup never reads),
    // no anisotropy. Its texture is made at the first paint (`cardPicture`).
    this.cardHandle.sampler = device.createSampler({
      label: "view: kit card",
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "nearest",
      lodMinClamp: 0,
      lodMaxClamp: 0,
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
      addressModeW: "repeat",
      maxAnisotropy: 1,
    });
    this.cardGroup = new HostBindGroup(device, "view: kit card", VIEW_CARD, [], {});
    this.cardGroup.refresh(host, { viewCard: this.cardHandle });

    const emissive = viewEmissivePrograms();
    const blended = viewBlendedPrograms();
    const asks: Promise<boolean>[] = [
      this.ask(emissive.main, FRAME_TARGETS, undefined, (b) => (this.emissive = b)),
      // No depth written: every pixel's depth is the main pass's, which the
      // same vertex module wrote.
      this.ask(emissive.mask, GLOW_TARGETS, { depthWrite: false }, (b) => (this.mask = b)),
      this.ask(blended.glass, FRAME_TARGETS, { depthWrite: false, blend: GLASS_BLEND }, (b) => (this.glass = b)),
      this.ask(
        blended.card,
        FRAME_TARGETS,
        { cullMode: "none", depthWrite: true, depthCompare: "always", blend: CARD_BLEND },
        (b) => (this.card = b),
      ),
    ];
    for (const recipe of celRecipes) {
      const key = celKey(recipe);
      if (this.cels.has(key)) continue;
      asks.push(this.askCel(recipe, key));
    }
    this.ready = Promise.all(asks).then((oks) => oks.every(Boolean));
    void this.ready.then((ok) => {
      if (ok) return;
      this.failedPipelines = true;
      this.failed("our weapon cannot draw: a pipeline of its failed");
    });

    const removes = [
      renderer.onFrame(this.prepare),
      // Counted only on a frame something was committed (`Renderer.begin`
      // skips a frame with nothing of ours: the menu with no kit screen).
      renderer.add(this.draw, "afterGroup", () => this.pending && this.instances > 0),
      renderer.onRefused(this.refused),
      // LAST in the mask, after everything of Babylon's, where its group 1
      // drew the weapon's emissives (X4.3c's review, the owner's decision).
      renderer.addGlowMaskLate(this.drawMask, () => this.pending && this.anyMasked),
      renderer.onGlowMaskRefused(this.maskRefused),
    ];
    this.unhook = () => {
      for (const remove of removes) remove();
      removes.length = 0;
    };
  }

  /**
   * Whom a failure is told from now on — the round's owner while a map
   * stands (`Game.worldFailed`), the console otherwise — told at once if the
   * pipelines have already failed, as every round after a failed one is.
   */
  onFailed(failed: (reason: string) => void): void {
    this.failed = failed;
    if (this.failedPipelines) failed("our weapon cannot draw: a pipeline of its failed");
  }

  /**
   * The kit card's picture, before this frame's `commit`: its canvas and how
   * often it has been painted (`ViewModel.kitCard`). A paint not yet uploaded
   * is uploaded now, as `DynamicTexture.update` uploaded it in the frame's
   * update; one already uploaded costs nothing.
   */
  cardPicture(canvas: HTMLCanvasElement | null, painted: number): void {
    if (!canvas || painted === this.cardUploaded) return;
    const w = canvas.width;
    const h = canvas.height;
    let texture = this.cardTexture;
    if (!texture || texture.width !== w || texture.height !== h) {
      // What Babylon's `DynamicTexture` made of its canvas: `rgba8unorm`, the
      // canvas's size, one mip (no mips were asked for).
      texture?.destroy();
      texture = this.device.createTexture({
        label: "view: kit card",
        size: [w, h, 1],
        format: "rgba8unorm",
        mipLevelCount: 1,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.cardTexture = texture;
      this.cardHandle.view = texture.createView();
      this.cardGroup.refresh(this.renderer.host, { viewCard: this.cardHandle });
      this.cardDestination = { texture, premultipliedAlpha: false };
      this.cardExtent[0] = w;
      this.cardExtent[1] = h;
    }
    if (this.cardSource?.source !== canvas) this.cardSource = { source: canvas, flipY: true };
    this.device.queue.copyExternalImageToTexture(this.cardSource, this.cardDestination!, this.cardExtent);
    this.cardUploaded = painted;
  }

  /**
   * This frame's draws: the first `n`, their matrices, segments and recipes
   * already written — the card first (`cards` of them, none or one), the
   * opaque parts up to `glassFrom`, the glasses after — drawn on the next
   * frame our renderer prepares, the bloom pulled then. `epoch` is the
   * materials' (`CelMaterialFactory.materialEpoch`): when it moved, every
   * block is copied again from its recipe.
   */
  commit(n: number, cards: number, glassFrom: number, epoch: number): void {
    const count = Math.max(0, Math.min(n, this.capacity));
    this.instances = count;
    this.cards = Math.min(cards, count);
    this.glassFrom = Math.max(this.cards, Math.min(glassFrom, count));
    // This frame's, from here: a frame `Renderer.begin` skips (nothing
    // committed) runs neither the prepare nor the draw that would reset them.
    this.stats.drawn = 0;
    this.stats.masked = 0;
    this.pending = true;
    let anyMasked = false;
    for (let k = this.cards; k < this.glassFrom; k++) {
      const recipe = this.recipes[k];
      if (recipe && !this.materials.has(recipe)) this.adopt(recipe);
      if (this.glows[this.segment[k]]) anyMasked = true;
    }
    this.anyMasked = anyMasked;
    if (epoch !== this.epoch) {
      this.epoch = epoch;
      this.emissiveBlock.write(this.emissiveRecipe.values);
      for (const [recipe, slot] of this.materials) {
        slot.block.write(recipe.values);
        slot.group.refresh(this.renderer.host, recipe.textures);
      }
    }
  }

  dispose(): void {
    this.unhook();
    for (const buffer of this.owned) buffer.destroy();
    this.emissiveBlock.destroy();
    for (const slot of this.materials.values()) slot.block.destroy();
    this.cardTexture?.destroy();
  }

  /** `recipe`'s block and group, made and filled the first time it is drawn, and its pipeline asked if no recipe of its shape was. */
  private adopt(recipe: CelRecipe): void {
    const key = celKey(recipe);
    if (!this.cels.has(key)) {
      if (import.meta.env.DEV) {
        console.warn(`view: a cel material of a shape not asked at construction (${key}) — compiled now, in the round`);
      }
      // A pipeline that fails here is told as a construction ask's is.
      void this.askCel(recipe, key).then((ok) => {
        if (!ok) this.failed("our weapon cannot draw: a pipeline of its failed");
      });
    }
    const block = new UniformBlockBuffer(this.device, CEL_MATERIAL_BLOCK, recipe.defines, "view: material");
    const group = new HostBindGroup(
      this.device,
      "view: material",
      [CEL_MATERIAL_BLOCK, ...CEL_MATERIAL_TEXTURES],
      recipe.defines,
      { [CEL_MATERIAL_BLOCK.var]: block.buffer },
    );
    block.write(recipe.values);
    group.refresh(this.renderer.host, recipe.textures);
    this.materials.set(recipe, { block, group, pipeline: this.cels.get(key)! });
  }

  /** Asks the cel pipeline for `recipe`'s variant and bias, filed under `key`. */
  private askCel(recipe: CelRecipe, key: string): Promise<boolean> {
    const slot: CelPipeline = { built: null };
    this.cels.set(key, slot);
    const state = recipe.depthBias !== 0 ? { depthBias: recipe.depthBias } : undefined;
    return this.ask(viewCelProgram(recipe.defines), FRAME_TARGETS, state, (b) => (slot.built = b));
  }

  private ask(
    program: ViewProgram,
    targets: PassTargets,
    state: PipelineState | undefined,
    set: (built: BuiltPipeline) => void,
  ): Promise<boolean> {
    return this.renderer.pipelines
      .get({
        vertex: program.vertex,
        vertexEntry: "main",
        fragment: program.fragment,
        fragmentEntry: "main",
        targets,
        state,
      })
      .then(
        (built) => {
          set(built);
          return true;
        },
        (err: unknown) => {
          console.error(
            `view: the ${program.vertex.label} / ${program.fragment.label} pipeline did not build; the weapon cannot be drawn`,
            err,
          );
          return false;
        },
      );
  }

  /**
   * As the main pass begins — inside the render, the camera placed: this
   * frame's verdict, the bloom pulled, and the draws uploaded if the frame is
   * ours.
   */
  private readonly prepare = (): void => {
    const pending = this.pending;
    this.pending = false;
    this.stats.drawn = 0;
    this.stats.masked = 0;
    const n = this.instances;
    this.ours = pending && n > 0;
    if (!this.ours) return;
    const queue = this.device.queue;
    queue.writeBuffer(this.matrixBuffer, 0, this.matrices, 0, n * MATRIX_FLOATS);
    if (this.anyMasked) {
      this.pull(this.glow, n);
      queue.writeBuffer(this.glowBuffer, 0, this.glow, 0, n * 4);
    }
  };

  /**
   * The weapon in the main pass, one draw a segment in the order handed over:
   * the card, the opaque parts, the glasses.
   */
  private readonly draw = (pass: GPURenderPassEncoder, ctx: FrameContext): void => {
    // Reached only through a pass that is not refused.
    this.refusalTold = false;
    if (!this.ours) return;
    let drawn = 0;
    // The card, first: a canvas never uploaded has nothing to show.
    if (this.cards > 0 && this.cardUploaded > 0) {
      drawn += this.drawWith(pass, ctx, this.card, this.cardGroup, 0, this.cards);
    }
    const end = this.glassFrom;
    let bound: BuiltPipeline | null = null;
    let material: HostBindGroup | null = null;
    for (let k = this.cards; k < end; k++) {
      const s = this.segment[k];
      const recipe = this.recipes[k];
      let built: BuiltPipeline | null;
      let group: HostBindGroup;
      if (recipe === null) {
        // An unlit segment the kit did not slot (a material the caller could
        // not read) draws nothing, as a mesh with no material ready would.
        if (!this.unlit[s]) continue;
        built = this.emissive;
        group = this.emissiveGroup;
      } else {
        const slot = this.materials.get(recipe)!;
        built = slot.pipeline.built;
        group = slot.group;
      }
      if (!built) continue;
      if (built !== bound || group !== material) {
        const frame = ctx.frameGroup(built.groups[0]);
        const own = group.get(built.groups[1]);
        const geometry = this.geometry.get(built.groups[2]);
        // A texture unpublished: nothing of this pipeline can draw this frame.
        if (!frame || !own || !geometry) continue;
        if (built !== bound) {
          pass.setPipeline(built.pipeline);
          pass.setBindGroup(0, frame);
          pass.setBindGroup(2, geometry);
        }
        pass.setBindGroup(1, own);
        bound = built;
        material = group;
      }
      pass.draw(this.count[s], 1, this.first[s], k);
      drawn++;
    }
    // The glasses, last, over everything opaque.
    if (this.instances > end) drawn += this.drawWith(pass, ctx, this.glass, this.glassGroup, end, this.instances);
    this.stats.drawn = drawn;
  };

  /** Draws `[from, to)` with one pipeline and its group 1; how many it drew. */
  private drawWith(
    pass: GPURenderPassEncoder,
    ctx: FrameContext,
    built: BuiltPipeline | null,
    own: HostBindGroup,
    from: number,
    to: number,
  ): number {
    if (!built) return 0;
    const frame = ctx.frameGroup(built.groups[0]);
    const group = own.get(built.groups[1]);
    const geometry = this.geometry.get(built.groups[2]);
    if (!frame || !group || !geometry) return 0;
    pass.setPipeline(built.pipeline);
    pass.setBindGroup(0, frame);
    pass.setBindGroup(1, group);
    pass.setBindGroup(2, geometry);
    for (let k = from; k < to; k++) {
      const s = this.segment[k];
      pass.draw(this.count[s], 1, this.first[s], k);
    }
    return to - from;
  }

  /** The lit segments' bloom, last in the glow's mask: the same draws, by the same vertex module. */
  private readonly drawMask = (pass: GPURenderPassEncoder, ctx: FrameContext): void => {
    this.maskRefusalTold = false;
    if (!this.ours || !this.anyMasked) return;
    const mask = this.mask;
    if (!mask) return;
    const frame = ctx.frameGroup(mask.groups[0]);
    const own = this.glowGroup.get(mask.groups[1]);
    const geometry = this.geometry.get(mask.groups[2]);
    if (!frame || !own || !geometry) return;
    pass.setPipeline(mask.pipeline);
    pass.setBindGroup(0, frame);
    pass.setBindGroup(1, own);
    pass.setBindGroup(2, geometry);
    let masked = 0;
    const end = this.glassFrom;
    for (let k = this.cards; k < end; k++) {
      const s = this.segment[k];
      if (this.recipes[k] !== null || !this.glows[s]) continue;
      pass.draw(this.count[s], 1, this.first[s], k);
      masked++;
    }
    this.stats.masked = masked;
  };

  /** `Renderer.onRefused`: the main pass drew nothing of ours, the weapon included. */
  private readonly refused = (): void => {
    if (!this.ours || this.refusalTold) return;
    this.refusalTold = true;
    this.failed("the main pass was refused, so the weapon cannot be drawn");
  };

  /** `Renderer.onGlowMaskRefused`: the mask drew nothing of ours, the reticles' bloom included. */
  private readonly maskRefused = (): void => {
    if (!this.ours || !this.anyMasked || this.maskRefusalTold) return;
    this.maskRefusalTold = true;
    this.failed("the glow's mask pass was refused, so no reticle of ours can bloom");
  };
}

/** A cel pipeline's identity: the variant and the depth bias, which is pipeline state. */
function celKey(recipe: CelRecipe): string {
  return `${[...recipe.defines].sort().join("+")}@${recipe.depthBias}`;
}
