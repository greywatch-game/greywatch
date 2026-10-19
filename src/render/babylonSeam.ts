/**
 * render/babylonSeam.ts — The ONE place our renderer meets Babylon's: the
 * device, the pass that is open, its attachments, and a slot in Babylon's own
 * draw order to record into.
 * Owns: `BabylonFrameHost`, Babylon's engine and scene as our renderer's
 * `FrameHost`: the device, what the open pass draws into, a slot in
 * Babylon's own draw order (`queue`), the encoder submitted ahead of the
 * frame's draws (`prepareEncoder`), the camera's matrix, the frame's main
 * pass told apart from every render target that also draws rendering group
 * 0 — and the two points inside it where that group's alpha-tested meshes
 * begin and where its opaque and alpha-tested meshes end — and a
 * Babylon texture's own view and sampler (`bind`); and `hostTexture`, the one
 * crossing that turns a Babylon texture into the handle the renderer holds.
 * Invariants: NAMES Babylon's types and loads none of it (every import here
 * is `import type`, so the Babylon-free gate walks this file as it walks the
 * rest of `src/render/`); every Babylon INTERNAL anything in `src/render/`
 * reaches is reached here and is on the numbered list below — the list may
 * grow through Phase 3 and only shrinks after it (`BABYLON_EXIT.md` rule 4);
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
 *      only on a frame something of ours draws.
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
 *      (E:2842); and WHICH target, which is how `onMainPass` knows the frame's
 *      from the glow's (see it).
 *   6. `RenderingGroup.onBeforeTransparentRendering`
 *      (`Rendering/renderingGroup.js`), reached by the public
 *      `scene.renderingManager.getRenderingGroup`, on a class Babylon tags
 *      `@internal`. One slot, called in `render` after the group's opaque and
 *      alpha-tested meshes, its sprites and its particles. Only the SCENE's
 *      manager is reached — every render target owns a manager of its own —
 *      so it fires in the camera's pass and in no other.
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
 *   9. `engine._uploadEncoder` (E:519, E:2388) — the encoder Babylon finishes
 *      and submits FIRST in `flushFramebuffer`, ahead of `_renderEncoder`
 *      (E:2381-2382), and the one `_timestampQuery.startFrame` opens the frame's
 *      GPU timer on (E:2397; it is closed on `_renderEncoder` in `endFrame`).
 *      Copies and mip generation are recorded into it, each pass begun and
 *      ended inside one call, so it has no pass open while ours records. A
 *      flush mid-frame replaces it, which is why it is read at the call and
 *      never kept: whichever one is current is submitted before the draws
 *      recorded after it, and inside the timer.
 *  10. `RenderingGroup._renderAlphaTest` and `_alphaTestSubMeshes`
 *      (`Rendering/renderingGroup.js`, the group item 6 reaches): `render`
 *      draws its opaque list, then calls `_renderAlphaTest` with
 *      `_alphaTestSubMeshes` — and calls the same function once BEFORE that,
 *      with its depth-only list, which is why the argument is compared and
 *      never the call counted. Babylon has no hook between the two lists, so
 *      the function is WRAPPED while the main pass's group renders: the
 *      wrapper is made once, installed as the group starts and restored as it
 *      ends (and on `dispose`), and re-read at every start because the
 *      `alphaTestSortCompareFn` setter replaces it (`Game` sets the group's
 *      order through `setRenderingOrder`). A list empty that frame is never
 *      handed over, so the point falls back to item 6's slot, ahead of it.
 *
 * Public API used here and nowhere else in `src/render/`, for the same
 * reason (it is Babylon's shape): `engine.currentSampleCount`,
 * `scene.getTransformMatrix()`, the scene's draw-phase, rendering-group,
 * sprite and particle observables (`onMainPass`), and a texture's readiness,
 * wrap modes and filtering level and the engine's empty textures and
 * anisotropy cap (`bind`).
 *
 * WHAT IS NOT HERE. Six touches of Babylon internals in four files predate
 * this one and stay where they were written, because none of them is our
 * renderer's and one cannot move here at all: `shaders/FrameDepth.ts` (the
 * frame's depth texture, `_currentRenderTarget._depthStencilTexture`),
 * `core/webgpuLeaks.ts` (`_deletePipelineContext`),
 * `systems/ReflectionSystem.ts` (`_releaseRenderPassId`,
 * `_removeDrawWrapper`) and `core/FrameProfile.ts` (the timestamp query, and
 * a patch on `WebGPUCacheRenderPipeline`'s prototype — a Babylon VALUE, which
 * this directory may not import). Each leaves with the code that owns it:
 * FrameDepth when the frame's depth is ours (X5.4), the rest with Babylon
 * (X6.1). So rule 4 holds here as "every internal OUR RENDERER reaches";
 * `BABYLON_EXIT.md` records that reading at X3.2.
 */
import type {
  BaseTexture,
  InternalTexture,
  Observable,
  Observer,
  RenderingGroupInfo,
  Scene,
  WebGPUEngine,
} from "@babylonjs/core";
import type {
  BoundTexture,
  FrameHost,
  HostTexture,
  MainPassHooks,
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

/** Items 6 and 10: the scene's rendering group, as far as this file reaches into it. */
interface GroupInternals {
  onBeforeTransparentRendering: (() => void) | undefined;
  /** Called with the depth-only list, then with `_alphaTestSubMeshes`; replaced by the sort setters. */
  _renderAlphaTest: (this: GroupInternals, subMeshes: unknown) => void;
  readonly _alphaTestSubMeshes: unknown;
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
   * Items 2 and 3. Babylon's bundles reset the pipeline, the bind groups and
   * the vertex and index buffers around an item. The viewport, the scissor,
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
   * The frame's main pass is the TARGET bound as the draw phase begins — the
   * post chain's first, bound by `_prepareFrame` just before — and a group
   * rendering into THAT target before the draw phase ends. Both halves are
   * needed: probes and shadow maps draw before the phase (so outside it), but
   * the glow renders its mask from `onAfterDrawPhaseObservable` itself, so
   * whether its group 0 lands inside the window depends on which observer
   * was added first. The target does not.
   *
   * WHERE THE ALPHA-TESTED MESHES BEGIN is the call item 10 wraps, made with
   * the group's alpha-tested list — after its depth-only and opaque lists.
   * Babylon skips the call for a list empty that frame (and for a group
   * drawn with `renderAlphaTestMeshes` off), and then the point is answered
   * where the opaque meshes end, immediately ahead of that hook: so it fires
   * once a group, always before `afterOpaque`.
   *
   * WHERE THE OPAQUE MESHES END is the first of three things the group does
   * after its opaque and alpha-tested lists, whichever it reaches: its
   * sprites (an observable only once the sprite component is loaded), its
   * particles (each raises its observable only when the group holds some — and the particles' also fires in the active-mesh walk, which
   * is outside any group, so it counts only inside one), or item 6, which it
   * always reaches. A group with none of them, a `customRenderFunction`'s,
   * is answered as it ends, before `afterGroup`.
   */
  onMainPass(groupId: number, hooks: MainPassHooks): { dispose(): void } {
    const scene = this.scene;
    const e = this.e;
    let frame: RenderTargetInternals | null | undefined;
    /**
     * Inside group `groupId` of the main pass, and whether its alpha-tested
     * meshes have begun and its opaque meshes ended.
     */
    let inGroup = false;
    let alphaBegun = false;
    let opaqueDone = false;
    const inMainPass = (): boolean => frame !== undefined && e._currentRenderTarget === frame;
    const alphaTestBegins = (): void => {
      if (!inGroup || alphaBegun) return;
      alphaBegun = true;
      hooks.beforeAlphaTest();
    };
    const opaqueEnds = (): void => {
      if (!inGroup || opaqueDone) return;
      // A group whose alpha-tested list was empty never called item 10.
      alphaTestBegins();
      opaqueDone = true;
      hooks.afterOpaque();
    };
    // Items 6 and 10. Typed as always set; item 6 is one slot nothing in
    // Babylon fills, and item 10 is set by the group's constructor.
    const group = scene.renderingManager.getRenderingGroup(groupId) as unknown as GroupInternals;
    /** Item 10: the group's own function while the wrapper stands in for it; null otherwise. */
    let alphaTest: GroupInternals["_renderAlphaTest"] | null = null;
    const wrapped = (subMeshes: unknown): void => {
      if (subMeshes === group._alphaTestSubMeshes) alphaTestBegins();
      // Installed only with `alphaTest` set, and `unwrap` is the one place
      // that clears it — after taking the wrapper out.
      alphaTest!.call(group, subMeshes);
    };
    const unwrap = (): void => {
      if (alphaTest && group._renderAlphaTest === wrapped) group._renderAlphaTest = alphaTest;
      alphaTest = null;
    };
    const before: Observer<Scene> = scene.onBeforeDrawPhaseObservable.add(() => {
      frame = e._currentRenderTarget;
      hooks.begin();
    });
    const after: Observer<Scene> = scene.onAfterDrawPhaseObservable.add(
      () => {
        frame = undefined;
        inGroup = false;
        unwrap();
      },
      undefined,
      true,
    );
    const groupStart: Observer<RenderingGroupInfo> = scene.onBeforeRenderingGroupObservable.add(
      (info) => {
        if (info.renderingGroupId !== groupId || !inMainPass()) return;
        inGroup = true;
        alphaBegun = false;
        opaqueDone = false;
        // Re-read every frame: the sort setters replace the function.
        const own = group._renderAlphaTest;
        if (own !== wrapped) {
          alphaTest = own;
          group._renderAlphaTest = wrapped;
        }
      },
    );
    const groupEnd: Observer<RenderingGroupInfo> = scene.onAfterRenderingGroupObservable.add(
      (info) => {
        if (!inGroup || info.renderingGroupId !== groupId) return;
        opaqueEnds();
        inGroup = false;
        unwrap();
        hooks.afterGroup();
      },
    );
    // The sprites' observable exists only once Babylon's sprite component is
    // loaded (`spriteSceneComponent`), and nothing draws a sprite without it.
    type Sprites = { onBeforeSpritesRenderingObservable?: Observable<Scene> };
    const spriteHook = (scene as Sprites).onBeforeSpritesRenderingObservable;
    const sprites = spriteHook?.add(opaqueEnds) ?? null;
    const particles: Observer<Scene> = scene.onBeforeParticlesRenderingObservable.add(opaqueEnds);
    // Item 6.
    if (group.onBeforeTransparentRendering) {
      throw new Error(`babylonSeam: rendering group ${groupId}'s transparent hook is already taken`);
    }
    group.onBeforeTransparentRendering = opaqueEnds;
    return {
      dispose: () => {
        scene.onBeforeDrawPhaseObservable.remove(before);
        scene.onAfterDrawPhaseObservable.remove(after);
        scene.onBeforeRenderingGroupObservable.remove(groupStart);
        scene.onAfterRenderingGroupObservable.remove(groupEnd);
        if (sprites) spriteHook?.remove(sprites);
        scene.onBeforeParticlesRenderingObservable.remove(particles);
        if (group.onBeforeTransparentRendering === opaqueEnds) {
          group.onBeforeTransparentRendering = undefined;
        }
        unwrap();
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
