/**
 * render/babylonSeam.ts — The ONE place our renderer meets Babylon's: the
 * device, the pass that is open, its attachments, and a slot in Babylon's own
 * draw order to record into.
 * Owns: `BabylonFrameHost`, Babylon's engine and scene as our renderer's
 * `FrameHost`: the device, what the open pass draws into, a slot in
 * Babylon's own draw order (`queue`), the encoder submitted ahead of the
 * frame's draws (`prepareEncoder`), the camera's matrix, the frame's main
 * pass told apart from every other pass — its start, and the points of
 * rendering group 0 (`MainPassHooks`), all told at the end of the camera's
 * draw phase, Babylon drawing nothing in the group — and a
 * Babylon texture's own view and sampler (`bind`); and `hostTexture`, the one
 * crossing that turns a Babylon texture into the handle the renderer holds.
 * Items 2 to 5 are reached in a second pass of Babylon's too, the glow's MASK
 * (`BABYLON_EXIT.md` X3.6d): our renderer is TOLD when that pass opens
 * (`GlowPass.onMaskOpenObservable`, wired by `Game`) and then asks `passIs`
 * and `queue`s into it exactly as into the main pass — no internal beyond
 * the list below, and no hook here, because the mask's owner announces it.
 * And in the glow's BLUR passes (X5.2b), which `GlowPass` binds on its own
 * targets with public API and asks our renderer to draw in from between the
 * bind and the unbind (`Renderer.glowBlurOpened`): the same `passIs` and
 * `queue`, and no item more. And in the POST CHAIN's passes (X5.2c1; the
 * whole chain since X5.2d), which `shaders/PostPasses.ts` opens with public
 * API after the camera's render — the canvas's, Babylon's main pass, by
 * `restoreDefaultFramebuffer` — and asks our renderer to draw in
 * (`Renderer.postStageOpened`): `passIs` (item 5 telling the canvas, which is
 * no render target and so not flipped) and `queue` again, and no item more.
 * The frame those stages read is `PostPasses`' render target, which the scene
 * binds for the main pass (the camera's `outputRenderTarget`, public API):
 * item 5 tells the main pass by THAT target, as it told the ink's input.
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
 *      only on a frame something of ours draws — and in a glow blur pass,
 *      where nothing of Babylon's draws since X5.2b, it is what begins the
 *      pass Babylon's `bindFramebuffer` delayed, with the load ops that bind
 *      gave it.
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
 *      X5.1b — they are our renderer's own (`render/GiCompute.ts`) — and gained
 *      a COMPUTE reader: the volume's trace binds the cloud field through them
 *      (the host's view and sampler, the owner's decision), as the frame does.
 *   9. `engine._uploadEncoder` (E:519, E:2388) — the encoder Babylon finishes
 *      and submits FIRST in `flushFramebuffer`, ahead of `_renderEncoder`
 *      (E:2381-2382), and the one `_timestampQuery.startFrame` opens the frame's
 *      GPU timer on (E:2397; it is closed on `_renderEncoder` in `endFrame`).
 *      Copies and mip generation are recorded into it, each pass begun and
 *      ended inside one call, so it has no pass open while ours records. A
 *      flush mid-frame replaces it, which is why it is read at the call and
 *      never kept: whichever one is current is submitted before the draws
 *      recorded after it, and inside the timer.
 *
 * Items 6 and 10 were RETIRED at `BABYLON_EXIT.md` X5.3d, and their numbers
 * are not reused: `RenderingGroup.onBeforeTransparentRendering` (6), the
 * scene's group 0's slot ahead of its transparent meshes, and
 * `RenderingGroup._renderAlphaTest` with `_alphaTestSubMeshes` (10), wrapped
 * while that group rendered — where the `beforeBlended` and `beforeAlphaTest`
 * points were told on a frame Babylon VISITED group 0. Since X5.3c none does:
 * the map editor's build, whose world was Babylon's, was the last thing that
 * did, and the Phase 4 gate and X5.3a's draw log measured a round to visit
 * none in any state (`onMainPass`).
 *
 * Public API used here and nowhere else in `src/render/`, for the same
 * reason (it is Babylon's shape): `engine.currentSampleCount`, the engine's
 * end of frame (`onEndFrameObservable`, `afterSubmit`, `BABYLON_EXIT.md` X5.1b),
 * `scene.getTransformMatrix()`, the scene's draw-phase observables
 * (`onMainPass`; its rendering-group and sprite observables went with items 6
 * and 10 at X5.3d, its particle observable with the last of Babylon's
 * particle systems at X4.7d), and a texture's readiness,
 * wrap modes and filtering level and the engine's empty textures and
 * anisotropy cap (`bind`).
 *
 * WHAT IS NOT HERE. Three touches of Babylon internals in two files predate
 * this one and stay where they were written, because none of them is our
 * renderer's and one cannot move here at all: `core/webgpuLeaks.ts`
 * (`_deletePipelineContext`) and `core/FrameProfile.ts` (the timestamp query,
 * and a patch on `WebGPUCacheRenderPipeline`'s prototype — a Babylon VALUE,
 * which this directory may not import). Each leaves with Babylon (X6.1).
 * `shaders/FrameDepth.ts`' (the frame's depth texture,
 * `_currentRenderTarget._depthStencilTexture`) left at `BABYLON_EXIT.md`
 * X5.2d: it reads the frame's own render target's PUBLIC
 * `renderTarget.depthStencilTexture` (row "X5.2, `FrameDepth`"), and X5.4
 * deletes it once the depth is ours. `systems/ReflectionSystem.ts`' two
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
   * Items 2 and 3, into whichever pass is open: the main pass at one of its
   * hooks, the glow's mask as it opens, or a pass of the glow's blur. Babylon's bundles reset the
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

  /**
   * The frame's main pass is the TARGET bound as the draw phase begins — the
   * frame, the camera's `outputRenderTarget`, which the scene's camera render
   * binds — and the draw phase's end with THAT target still bound (item 5).
   * The draw phase's observables are raised by `Scene._renderForCamera`
   * alone, no render target's manager raising them (`GlowPass.render`'s
   * note), and the end's observer is inserted ahead of the glow's, so the
   * target always holds there; it is asked as it was asked while a group's
   * hooks could fire inside a probe's or the glow's pass.
   *
   * WHERE IT BEGINS is the draw phase's own observable: `first` is told
   * there, right after `begin`, ahead of everything queued in the pass.
   *
   * **THE GROUP'S FOUR POINTS ARE TOLD AT THE PHASE'S END, in their order**
   * (`beforeAlphaTest`, `afterOpaque`, `beforeBlended`, `afterGroup`): Babylon
   * draws nothing in rendering group 0 — no mesh of a round's, in any state,
   * since `BABYLON_EXIT.md` X4.7d took its last particle system, and none of
   * any build's since X5.3c took the map editor's — and visits no empty
   * group (`RenderingManager.render` raises no observable for one), so there
   * is nothing of Babylon's between the points for them to fall between.
   * That is ASSUMED here, not checked: the draw log is what asserts it
   * (`plans/webgpu-ref/drawlog.mjs` fails a run with a group-0 visit in any
   * class), and the game carries no check of its own.
   * Until X5.3d a frame on which Babylon DID visit the group was told each
   * point inside it, through items 6 and 10 and the group and sprite
   * observables; that path, the map editor's build's alone since X5.3c, went
   * with them, and this tells the points where it told them on every frame
   * of a round already. The observer is inserted FIRST on the phase's end,
   * ahead of the glow's mask, which renders from the same observer list. No
   * group above 0 holds anything (`BABYLON_EXIT.md` X4.3d).
   *
   * `_groupId` is the group the hooks are named for (`MainPassHooks`), which
   * nothing here reaches for any more.
   */
  onMainPass(_groupId: number, hooks: MainPassHooks): { dispose(): void } {
    const scene = this.scene;
    const e = this.e;
    let frame: RenderTargetInternals | null | undefined;
    const before: Observer<Scene> = scene.onBeforeDrawPhaseObservable.add(() => {
      frame = e._currentRenderTarget;
      hooks.begin();
      hooks.first();
    });
    const after: Observer<Scene> = scene.onAfterDrawPhaseObservable.add(
      () => {
        if (frame !== undefined && e._currentRenderTarget === frame) {
          hooks.beforeAlphaTest();
          hooks.afterOpaque();
          hooks.beforeBlended();
          hooks.afterGroup();
        }
        frame = undefined;
      },
      undefined,
      true,
    );
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
