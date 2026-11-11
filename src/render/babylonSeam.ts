/**
 * render/babylonSeam.ts — The ONE place our renderer meets Babylon's: the
 * device, the frame's draw phase and its clear colour, the passes of the post
 * chain Babylon still opens, and a slot in Babylon's own draw order to record
 * into there.
 * Owns: `BabylonFrameHost`, Babylon's engine and scene as our renderer's
 * `FrameHost`: the device, the moments the frame camera's draw phase opens and
 * closes (`onDrawPhase`), the scene's clear colour, what an open pass of
 * Babylon's draws into, a slot in Babylon's own draw order (`queue`), the
 * encoder submitted ahead of the frame's draws (`prepareEncoder`), the
 * camera's matrix, and a Babylon texture's own view and sampler (`bind`); and
 * `hostTexture`, the one crossing that turns a Babylon texture into the handle
 * the renderer holds.
 * **The frame's own passes are not Babylon's** (`BABYLON_EXIT.md` X5.4e): its
 * opening clear, its main pass, the glow's mask and the glow's five blur
 * passes are our renderer's, on targets of its own (`render/FrameTargets.ts`),
 * recorded into the encoder of item 9 — so this file tells the renderer only
 * WHEN (the draw phase's two observables, public API), and items 2 to 5 and 7
 * and 8 are reached in the POST CHAIN's passes alone, which
 * `shaders/PostPasses.ts` opens with public API after the camera's render —
 * the canvas's, Babylon's main pass, by `restoreDefaultFramebuffer`, and a
 * target of its pool — and asks our renderer to draw in
 * (`Renderer.postStageOpened`): `passIs` (item 5 telling the canvas, which is
 * no render target and so not flipped, from a pool target) and `queue`, and
 * `bind` for a pool target the next stage reads. X5.4f takes those.
 * Invariants: NAMES Babylon's types and loads none of it (every import here
 * is `import type`, so the Babylon-free gate walks this file as it walks the
 * rest of `src/render/`); every Babylon INTERNAL anything in `src/render/`
 * reaches is reached here and is on the numbered list below — the list may
 * grow through Phase 3 and only shrinks after it (`BABYLON_EXIT.md` rule 4),
 * and a retired item's number is never given to another (EIGHT items since
 * X5.3d retired 6 and 10);
 * a draw is QUEUED, never issued — see item 3; nothing here allocates on a
 * frame once the first has run.
 * Never: imports a Babylon value; hands a Babylon object to anything that
 * draws — what leaves this file is a `GPUDevice`, a `GPURenderPassEncoder`,
 * formats and numbers.
 * Contract: `docs/rendering.md`, "Our renderer's frame"; `BABYLON_EXIT.md`
 * rules 4 and 5.
 *
 * WHAT THIS REACHES INTO (Babylon 9.28, `node_modules/@babylonjs/core`;
 * `E` is `Engines/webgpuEngine.pure.js`, `T` is `thinWebGPUEngine.js`):
 *
 *   1. `engine._device` — the `GPUDevice` (E:458). Typed public, documented
 *      as internal; there is no other door to it.
 *   2. `engine._getCurrentRenderPass()` — the open pass, STARTED if Babylon
 *      has delayed it (E:933). Called only so (3) has a pass to run in, and
 *      only in a pass of the post chain something of ours draws in — where,
 *      Babylon drawing nothing, it is what begins the pass Babylon's
 *      `bindFramebuffer` delayed, with the load ops that bind gave it. (The
 *      main pass, the glow's mask and its blur reached it too until
 *      `BABYLON_EXIT.md` X5.4e made them our own passes; items 2 to 5 are the
 *      chain's alone now, and X5.4f takes them with it.)
 *   3. `engine._bundleList.addItem({ run })` (`WebGPU/webgpuBundleList.js`).
 *      Under `compatibilityMode = false` Babylon does not draw into the pass
 *      as it goes: it records render BUNDLES into this list and replays the
 *      list into the pass when the pass ends (T:59). A raw `pass.draw` from
 *      an observable would therefore land BEFORE every Babylon draw already
 *      queued in that pass. An item is the list's own escape hatch: it closes
 *      the open bundle and is `run(pass)` in order with the real encoder.
 *   4. `engine._getCurrentRenderPassWrapper()` (E:958) — the open pass's
 *      colour attachments and depth format (`colorAttachmentGPUTextures`,
 *      `depthTextureFormat`), which is what a pipeline drawn into it must
 *      match (`docs/rendering.md`, the attachment state of a bundle).
 *   5. `engine._currentRenderTarget` and its `_disableEngineYFlip` (E:2872):
 *      whether the open pass draws into a TEXTURE, which Babylon draws upside
 *      down (`internals.yFactor_` = -1) so a later sample reads it the GL way
 *      up — our clip-space y owes the same flip there, and the winding with it
 *      (E:2842): a pool target of the post chain's from the canvas. (WHICH
 *      target it was told the frame's main pass from the glow's mask too, in
 *      `onMainPass`, until X5.4e made both our own.)
 *   7. `internalTexture._hardwareTexture.view` (`WebGPU/webgpuHardwareTexture
 *      .js`): the `GPUTextureView` Babylon itself binds for a texture
 *      (`webgpuCacheBindGroups.js`, `getBindGroups`), so ours is the same view
 *      of the same texture, never a copy (`BABYLON_EXIT.md` rule 5).
 *   8. `engine._cacheSampler.getSampler` (`WebGPU/webgpuCacheSampler.js`)
 *      with the `TextureSampler` fields Babylon's bind fills on the internal
 *      texture first (`_cachedWrapU`/`V`/`R`, `_cachedAnisotropicFilteringLevel`,
 *      `_comparisonFunction`; `_setTexture`, E:2134): the `GPUSampler` out of
 *      Babylon's own cache for the state Babylon would bind, so its filter
 *      and wrap rules are not restated here.
 *      Items 7 and 8 lost the irradiance volume's seven at `BABYLON_EXIT.md`
 *      X5.1b — they are our renderer's own (`render/GiCompute.ts`) — and, at
 *      X5.4d, every texture the game makes for itself (`TextureMaker`: the
 *      grounds, the sky's, the motes, the puff, the scorch, the blob, the
 *      cloud field — and with it the volume trace's COMPUTE read of it, X5.1b's
 *      — the lit texel and the foam), and at X5.4e the frame's own targets (the
 *      frame and its depth, the glow's mask and its blur's five: our
 *      renderer's, `render/FrameTargets.ts`, where `PostPasses`, `GlowPass` and
 *      `FrameDepth`'s wrapper held Babylon's). What they still reach is the
 *      post chain's POOL (`PostPasses`), a target a stage after the first
 *      reads — X5.4f's to take.
 *   9. `engine._uploadEncoder` (E:519, E:2388) — the encoder Babylon finishes
 *      and submits FIRST in `flushFramebuffer`, ahead of `_renderEncoder`
 *      (E:2381-2382), and the one `_timestampQuery.startFrame` opens the frame's
 *      GPU timer on (E:2397; it is closed on `_renderEncoder` in `endFrame`).
 *      Copies and mip generation are recorded into it, each pass begun and
 *      ended inside one call, so it has no pass open while ours records. A
 *      flush mid-frame replaces it, which is why it is read at the call and
 *      never kept: whichever one is current is submitted before the draws
 *      recorded after it, and inside the timer. Since X5.4e the frame's own
 *      passes are recorded into it too, after the prepares (`Renderer.end`,
 *      `recordGlowMask`, `glowBlurPass`), so the post chain, on the render
 *      encoder, reads what they drew.
 *
 * Items 6 and 10 were RETIRED at `BABYLON_EXIT.md` X5.3d, and their numbers
 * are not reused: `RenderingGroup.onBeforeTransparentRendering` (6), the
 * scene's group 0's slot ahead of its transparent meshes, and
 * `RenderingGroup._renderAlphaTest` with `_alphaTestSubMeshes` (10), wrapped
 * while that group rendered — where the `beforeBlended` and `beforeAlphaTest`
 * points were told on a frame Babylon VISITED group 0. Since X5.3c none does:
 * the map editor's build, whose world was Babylon's, was the last thing that
 * did, and the Phase 4 gate and X5.3a's draw log measured a round to visit
 * none in any state (`onDrawPhase`).
 *
 * Public API used here and nowhere else in `src/render/`, for the same
 * reason (it is Babylon's shape): `engine.currentSampleCount`, the engine's
 * end of frame (`onEndFrameObservable`, `afterSubmit`, `BABYLON_EXIT.md` X5.1b),
 * `scene.getTransformMatrix()`, `scene.clearColor` (`clearColor`, X5.4e), the
 * scene's draw-phase observables (`onDrawPhase`; its rendering-group and
 * sprite observables went with items 6 and 10 at X5.3d, its particle
 * observable with the last of Babylon's particle systems at X4.7d), and a
 * texture's readiness,
 * wrap modes and filtering level and the engine's empty textures and
 * anisotropy cap (`bind`).
 *
 * WHAT IS NOT HERE. Two touches of Babylon internals in one file predate
 * this one and stay where they were written, because neither is our
 * renderer's and one cannot move here at all: `core/FrameProfile.ts`'s (the
 * timestamp query, and a patch on `WebGPUCacheRenderPipeline`'s prototype — a
 * Babylon VALUE, which this directory may not import), which leave with
 * Babylon (X6.1). A third, `core/webgpuLeaks.ts`'
 * (`_deletePipelineContext`), was deleted at X5.4b: Babylon releases no
 * effect and makes no bind group after the boot.
 * `shaders/FrameDepth.ts`' (the frame's depth texture,
 * `_currentRenderTarget._depthStencilTexture`) left at `BABYLON_EXIT.md`
 * X5.2d, reading the frame's own render target's PUBLIC
 * `renderTarget.depthStencilTexture` (row "X5.2, `FrameDepth`"), and the
 * file went at X5.4e: the depth is our renderer's (`FrameTargets.depth`). `systems/ReflectionSystem.ts`' two
 * (`_releaseRenderPassId`, `_removeDrawWrapper`) left with Babylon's bake at
 * X3.7c. So rule 4 holds here as "every internal OUR RENDERER reaches";
 * `BABYLON_EXIT.md` records that reading at X3.2.
 */
import type {
  BaseTexture,
  InternalTexture,
  Observer,
  Scene,
  WebGPUEngine,
} from "@babylonjs/core";
import type {
  BoundTexture,
  DrawPhaseHooks,
  FrameHost,
  HostTexture,
  PassTargets,
} from "./frameHost";

/** The internals above, typed as far as this file reads them. */
interface EngineInternals {
  readonly _device: GPUDevice;
  readonly currentSampleCount: number;
  readonly _currentRenderTarget: RenderTargetInternals | null;
  _getCurrentRenderPass(): GPURenderPassEncoder;
  _getCurrentRenderPassWrapper(): {
    readonly colorAttachmentGPUTextures: readonly ({ readonly format: GPUTextureFormat } | null)[];
    readonly depthTextureFormat: GPUTextureFormat | undefined;
  };
  readonly _bundleList: { addItem(item: QueuedItem): void };
  readonly _uploadEncoder: GPUCommandEncoder;
  readonly _cacheSampler: { getSampler(sampler: SamplerState): GPUSampler };
}

/** Item 7: what an internal texture holds on the device. */
interface InternalTextureInternals {
  readonly _hardwareTexture: { readonly view?: GPUTextureView } | null;
  readonly _cachedWrapR: number | null;
  readonly _comparisonFunction: number;
}

/**
 * Item 8: what `WebGPUCacheSampler` reads off the `TextureSampler` it is
 * handed — a plain object of the same shape serves, filled as `_setTexture`
 * fills the internal texture before Babylon's own bind.
 */
interface SamplerState {
  samplingMode: number;
  useMipMaps: boolean | null;
  _comparisonFunction: number;
  _cachedWrapU: number;
  _cachedWrapV: number;
  _cachedWrapR: number | null;
  _cachedAnisotropicFilteringLevel: number;
}

/** A Babylon texture as the handle our renderer holds — the one crossing that mints one. */
export function hostTexture(texture: BaseTexture): HostTexture {
  return texture as unknown as HostTexture;
}

interface RenderTargetInternals {
  readonly _disableEngineYFlip?: boolean;
}

/** What Babylon's bundle list runs: `run` with the pass, and `clone` for its snapshot path. */
interface QueuedItem {
  run(pass: GPURenderPassEncoder): void;
  clone(): QueuedItem;
}

/** Babylon's engine and scene, as our renderer's `FrameHost`. */
export class BabylonFrameHost implements FrameHost {
  readonly device: GPUDevice;
  private readonly e: EngineInternals;
  /** One list item per queued function, so a frame's `queue` allocates nothing. */
  private readonly items = new Map<(pass: GPURenderPassEncoder) => void, QueuedItem>();
  /** `bind`'s sampler state, rewritten in place per texture. */
  private readonly sampler: SamplerState = {
    samplingMode: 0,
    useMipMaps: null,
    _comparisonFunction: 0,
    _cachedWrapU: 1,
    _cachedWrapV: 1,
    _cachedWrapR: null,
    _cachedAnisotropicFilteringLevel: 1,
  };

  constructor(
    private readonly engine: WebGPUEngine,
    private readonly scene: Scene,
  ) {
    this.e = engine as unknown as EngineInternals;
    this.device = this.e._device; // item 1
  }

  /** Items 2, 4 and 5 — for a diagnostic; `passIs` is the per-frame test. */
  openPass(): PassTargets {
    this.e._getCurrentRenderPass();
    const wrapper = this.e._getCurrentRenderPassWrapper();
    const colorFormats: GPUTextureFormat[] = [];
    for (const t of wrapper.colorAttachmentGPUTextures) if (t) colorFormats.push(t.format);
    return {
      colorFormats,
      depthFormat: wrapper.depthTextureFormat,
      sampleCount: this.e.currentSampleCount,
      flipY: this.flips(),
    };
  }

  /** Items 2, 4 and 5, compared in place. */
  passIs(t: PassTargets): boolean {
    this.e._getCurrentRenderPass();
    const wrapper = this.e._getCurrentRenderPassWrapper();
    const attached = wrapper.colorAttachmentGPUTextures;
    let n = 0;
    for (let i = 0; i < attached.length; i++) {
      const a = attached[i];
      if (!a) continue;
      if (a.format !== t.colorFormats[n]) return false;
      n++;
    }
    return (
      n === t.colorFormats.length &&
      wrapper.depthTextureFormat === t.depthFormat &&
      this.e.currentSampleCount === t.sampleCount &&
      this.flips() === t.flipY
    );
  }

  /**
   * Items 2 and 3, into whichever pass is open: a pass of the post chain, its
   * owner asking from inside it (the main pass, the glow's mask and its blur
   * until `BABYLON_EXIT.md` X5.4e). Babylon's bundles reset the
   * pipeline, the bind groups and the vertex and index buffers around an
   * item. The viewport, the scissor,
   * the stencil reference and the blend constant they do NOT reset, and
   * Babylon re-emits one only when its own cache thinks it changed — so an
   * item that sets any of the four leaves Babylon's next draws with it.
   */
  queue(run: (pass: GPURenderPassEncoder) => void): void {
    let item = this.items.get(run);
    if (!item) {
      const made: QueuedItem = { run, clone: () => made };
      this.items.set(run, made);
      item = made;
    }
    this.e._getCurrentRenderPass();
    this.e._bundleList.addItem(item);
  }

  /** Item 9. */
  prepareEncoder(): GPUCommandEncoder {
    return this.e._uploadEncoder;
  }

  viewProjection(out: Float32Array): void {
    out.set(this.scene.getTransformMatrix().m);
  }

  /**
   * The engine's end of frame, public API: `endFrame` raises it after
   * `flushFramebuffer` has submitted both encoders, so the frame's commands
   * are the queue's by then (the irradiance volume's retired buffers and
   * textures, `GiCompute`).
   */
  afterSubmit(run: () => void): { dispose(): void } {
    const engine = this.engine;
    const o = engine.onEndFrameObservable.add(run);
    return { dispose: () => engine.onEndFrameObservable.remove(o) };
  }

  /** The scene's clear colour, public API: the value Babylon's clear of the frame read (`Scene._clearFrameBuffer`). */
  clearColor(out: GPUColorDict): void {
    const c = this.scene.clearColor;
    out.r = c.r;
    out.g = c.g;
    out.b = c.b;
    out.a = c.a;
  }

  /**
   * The frame camera's DRAW PHASE, public API: `begin` on the scene's
   * `onBeforeDrawPhaseObservable`, `end` on its `onAfterDrawPhaseObservable`,
   * inserted FIRST there, ahead of the glow's mask, which renders from the
   * same observer list. Both are raised by `Scene._renderForCamera` alone (the
   * frame's one camera, `scene.pure.js` 4174 and 4180), never by a render
   * target's own manager, and Babylon draws nothing between them: no mesh of a
   * round's in any state since `BABYLON_EXIT.md` X4.7d, none of any build's
   * since X5.3c, and it visits no empty group (`RenderingManager.render`
   * raises no observable for one). That is ASSUMED here, not checked: the draw
   * log is what asserts it (`plans/webgpu-ref/drawlog.mjs` fails a run with a
   * group-0 visit in any class).
   *
   * Until X5.4e this was `onMainPass`, which told the main pass's points
   * inside BABYLON's pass — the frame's target, the camera's
   * `outputRenderTarget`, bound as the phase began and asked again (item 5)
   * as it ended — so they could be queued there (item 3). The pass is the
   * renderer's own since, recorded at `end`, so only the moments are told.
   */
  onDrawPhase(hooks: DrawPhaseHooks): { dispose(): void } {
    const scene = this.scene;
    const before: Observer<Scene> = scene.onBeforeDrawPhaseObservable.add(() => hooks.begin());
    const after: Observer<Scene> = scene.onAfterDrawPhaseObservable.add(() => hooks.end(), undefined, true);
    return {
      dispose: () => {
        scene.onBeforeDrawPhaseObservable.remove(before);
        scene.onAfterDrawPhaseObservable.remove(after);
      },
    };
  }

  /**
   * Items 7 and 8: what Babylon's own bind of `t` would be now, by
   * `_setTexture`'s rules — the empty texture of the right kind while `t` is
   * not ready, a cube's wrap from its coordinates mode, the anisotropy capped
   * by the device — and nothing written onto `t` or its internal texture.
   */
  bind(t: HostTexture, out: BoundTexture): void {
    const tex = t as unknown as BaseTexture;
    const engine = this.engine;
    let internal: InternalTexture | null;
    if (tex.isReady()) internal = tex.getInternalTexture();
    else if (tex.isCube) internal = engine.emptyCubeTexture;
    else if (tex.is3D) internal = engine.emptyTexture3D;
    else if (tex.is2DArray) internal = engine.emptyTexture2DArray;
    else internal = engine.emptyTexture;
    if (!internal) {
      out.view = null;
      out.sampler = null;
      return;
    }
    const inner = internal as unknown as InternalTextureInternals;
    out.view = inner._hardwareTexture?.view ?? null; // item 7
    const s = this.sampler;
    s.samplingMode = internal.samplingMode;
    s.useMipMaps = internal.useMipMaps;
    s._comparisonFunction = inner._comparisonFunction;
    if (internal.isCube) {
      // CUBIC_MODE (3) and SKYBOX_MODE (5) clamp; every other mode repeats.
      const wrap = tex.coordinatesMode !== 3 && tex.coordinatesMode !== 5 ? 1 : 0;
      s._cachedWrapU = wrap;
      s._cachedWrapV = wrap;
    } else {
      s._cachedWrapU = tex.wrapU;
      s._cachedWrapV = tex.wrapV;
    }
    s._cachedWrapR = internal.is3D ? tex.wrapR : inner._cachedWrapR;
    s._cachedAnisotropicFilteringLevel = Math.min(
      tex.anisotropicFilteringLevel,
      engine.getCaps().maxAnisotropy,
    );
    out.sampler = this.e._cacheSampler.getSampler(s); // item 8
  }

  /** Item 5: whether the open pass draws into a target Babylon flips. */
  private flips(): boolean {
    const rt = this.e._currentRenderTarget;
    return rt !== null && !rt._disableEngineYFlip;
  }
}
