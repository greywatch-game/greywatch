/**
 * render/babylonSeam.ts — The ONE place our renderer meets Babylon's: the
 * device, the pass that is open, its attachments, and a slot in Babylon's own
 * draw order to record into.
 * Owns: `BabylonFrameHost`, Babylon's engine and scene as our renderer's
 * `FrameHost`: the device, what the open pass draws into, a slot in
 * Babylon's own draw order (`queue`), the camera's matrix, and the frame's
 * main pass told apart from every render target that also draws rendering
 * group 0.
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
 *
 * Public API used here and nowhere else in `src/render/`, for the same
 * reason (it is Babylon's shape): `engine.currentSampleCount`,
 * `scene.getTransformMatrix()`, and the scene's draw-phase and
 * rendering-group observables (`onMainPass`).
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
import type { Observer, RenderingGroupInfo, Scene, WebGPUEngine } from "@babylonjs/core";
import type { FrameHost, PassTargets } from "./frameHost";

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

  constructor(
    engine: WebGPUEngine,
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

  viewProjection(out: Float32Array): void {
    out.set(this.scene.getTransformMatrix().m);
  }

  /**
   * The frame's main pass is the TARGET bound as the draw phase begins — the
   * post chain's first, bound by `_prepareFrame` just before — and a group
   * finishing into THAT target before the draw phase ends. Both halves are
   * needed: probes and shadow maps draw before the phase (so outside it), but
   * the glow renders its mask from `onAfterDrawPhaseObservable` itself, so
   * whether its group 0 lands inside the window depends on which observer
   * was added first. The target does not.
   */
  onMainPass(groupId: number, begin: () => void, afterGroup: () => void): { dispose(): void } {
    const scene = this.scene;
    const e = this.e;
    let frame: RenderTargetInternals | null | undefined;
    const before: Observer<Scene> = scene.onBeforeDrawPhaseObservable.add(() => {
      frame = e._currentRenderTarget;
      begin();
    });
    const after: Observer<Scene> = scene.onAfterDrawPhaseObservable.add(
      () => {
        frame = undefined;
      },
      undefined,
      true,
    );
    const group: Observer<RenderingGroupInfo> = scene.onAfterRenderingGroupObservable.add(
      (info) => {
        if (
          frame !== undefined &&
          info.renderingGroupId === groupId &&
          e._currentRenderTarget === frame
        ) {
          afterGroup();
        }
      },
    );
    return {
      dispose: () => {
        scene.onBeforeDrawPhaseObservable.remove(before);
        scene.onAfterDrawPhaseObservable.remove(after);
        scene.onAfterRenderingGroupObservable.remove(group);
      },
    };
  }

  /** Item 5: whether the open pass draws into a target Babylon flips. */
  private flips(): boolean {
    const rt = this.e._currentRenderTarget;
    return rt !== null && !rt._disableEngineYFlip;
  }
}
