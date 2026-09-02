/**
 * GlowDepth.ts — Makes the GlowLayer take its occlusion from the MAIN pass's
 * depth buffer instead of by redrawing the whole visible scene as opaque black.
 * Owns: the layer's main-texture schedule, its clear, its render list and the
 * depth it shares — and nothing else. Reads no game state and writes to no
 * mesh. Invariant: the composited frame is the one the whole-scene pass
 * produced; a bloom that reaches through a wall is a bug here and never a
 * tuning question. Must never be given a layer whose `mainTextureRatio` is not
 * 1 — depth sharing requires matching dimensions, and a mismatch is silent.
 *
 * WHY. `EffectLayer` nulls its main texture's `renderList`, so `ObjectRenderer`
 * falls back to `scene.getActiveMeshes()` and the layer redraws the entire
 * visible scene into its own buffer every frame. Everything that is not
 * emissive draws as opaque BLACK — `_setEmissiveTextureAndColor` has no
 * `emissiveColor` to read off a cel `ShaderMaterial` — purely so the glow
 * buffer depth-occludes and a brazier behind a cottage does not bloom through
 * the wall. Measured on Coldharbour: **586 meshes in that list of which 57 are
 * emissive**, and the layer costing **2.60 ms of a 10.20 ms frame**. Ninety per
 * cent of the pass is occluder.
 *
 * `FINDINGS.md` 3 has three attempts at narrowing that set — by distance from
 * the light, by excluding the rigs, and by a screen-space overlap test — and
 * all three failed, the last one on measurement rather than on sight. They
 * failed for one reason: **there is no cheap way to know which geometry matters
 * to a bloom, because the only honest answer is a per-pixel depth test.** The
 * frame already does that test. This takes its result rather than recomputing
 * it, so the render list becomes the emissive meshes alone and the occlusion
 * gets BETTER rather than approximate — it is the real depth buffer, exact to
 * the pixel, with no predicate in front of it.
 *
 * Measured, live round, uncapped headless on the Windows box:
 * **Coldharbour 9.45 -> 7.60 ms (1.85 ms, 19.6%)**, Harrowmead 10.55 -> 8.25
 * (21.8%), Sarab 13.40 -> 10.55 (21.3%) — both arms of every pair agreeing to
 * within 0.3 ms. The layer costs 2.60 ms and this recovers most of it; the rest
 * is the blur and the compose, which is the trade the full-resolution texture
 * below buys.
 *
 * FIVE THINGS MAKE IT WORK AND EVERY ONE OF THEM FAILED SILENTLY FIRST.
 *
 * 1. **The main texture has to render LATE.** The scene component registers
 *    `_renderMainTexture` on `_cameraDrawRenderTargetStage`, which runs BEFORE
 *    the camera draws, and the compose on `_afterCameraDrawStage`, which runs
 *    after. Only the first is in the wrong place: a texture rendered before the
 *    frame can only share the PREVIOUS frame's depth, which is a bloom whose
 *    occlusion lags the camera by a frame. So the early call is neutralised and
 *    the original is invoked from the end of the draw phase instead. It has to
 *    be MOVED and never skipped, because `_renderMainTexture` also raises the
 *    `_renderEffects` flag that the compose reads — skip it and the layer stops
 *    compositing altogether, which looks like the glow being deleted.
 *
 * 2. **The clear has to be REPLACED, not added to.** `_createMainTexture`
 *    installs its own `onClearObservable` handler that clears colour, depth AND
 *    stencil, and an `Observable` runs every observer it holds — so adding a
 *    colour-only clear beside it leaves the depth being wiped, and the sharing
 *    does exactly nothing. This cost a whole measurement round: the arm with
 *    depth sharing and the arm without came back BIT-IDENTICAL, which reads
 *    like "the mechanism does not work" and actually meant "the mechanism never
 *    ran". `onClearObservable.clear()` first.
 *
 * 3. **The framebuffer has to be re-bound after the render.** A
 *    `RenderTargetTexture.render` restores the DEFAULT framebuffer when it is
 *    done, so the compose that follows would land on the canvas rather than on
 *    the post chain's input, and the post chain would then paint over it.
 *
 * 4. **The texture has to be FULL resolution**, because `shareDepth` demands
 *    matching dimensions, where the layer's default is half
 *    (`mainTextureRatio` 0.5). That is four times the pixels through the blur —
 *    free on a frame this draw-call bound, and exactly the trade `FINDINGS.md`
 *    17's third open thread says inverts on a phone. The blur kernel is stated
 *    in TEXELS of that texture, so it must double with it or the bloom silently
 *    halves in size on screen; `GLOW_KERNEL_SCALE` is that doubling and the two
 *    constants have to move together.
 *
 * 5. **The main texture is REBUILT on any resize, and the two halves of this
 *    do not come back together.** `EffectLayer.render` — the compose, which
 *    runs after this hook in the same frame — throws the texture away and
 *    builds another whenever the render size moves, and the new one carries
 *    Babylon's own clear again (colour, depth AND stencil) while the render
 *    list SURVIVES, because that lives on the `ObjectRenderer` the new texture
 *    is handed rather than on the texture. Reverting BOTH would only have cost
 *    the measurement above; reverting ONE leaves the pass drawing the emissive
 *    meshes ALONE into a freshly cleared private depth buffer, which is no
 *    occluders anywhere — every lamp in the map blooming through the wall it
 *    hangs on, for the rest of the page's life. A window dragged to another
 *    size, a browser zoom, a monitor with a different density, the render-scale
 *    setting, a phone turned on its side: all of them are `engine.resize()`,
 *    and the only thing that ever cleared it was a reload, which is what made
 *    it read as intermittent. So the hooks are re-installed BY IDENTITY every
 *    frame rather than once in the constructor, and the share is keyed on BOTH
 *    of its ends — a share is a relation between two targets and caching it on
 *    one of them was the whole of the bug. Two reference comparisons a frame,
 *    and the work still only happens on the frames a target actually moves.
 *
 * WHAT IT REACHES INTO. `_getComponent`, `_renderMainTexture` and
 * `_currentRenderTarget` are Babylon internals, and a version bump can move any
 * of them. Every one is asserted in a DEV build for the reason `OutlineFog.ts`
 * asserts its patch anchors: the failure mode of a silent miss is a frame that
 * still renders, with the bloom either gone or reaching through walls, and
 * nobody looking at the thing that changed.
 */
import type { Camera, GlowLayer, Scene } from "@babylonjs/core";

/**
 * The glow texture's size as a fraction of the render size. **1 is required**,
 * not preferred: `shareDepth` reassigns a depth texture between two render
 * targets and nothing validates that they are the same size.
 */
export const GLOW_TEXTURE_RATIO = 1;

/**
 * What `CONFIG.graphics.glowKernel` is multiplied by when the layer is built.
 *
 * The kernel is in texels of the main texture and the game's number was tuned
 * against Babylon's default half-resolution one, so at `GLOW_TEXTURE_RATIO` 1
 * it takes twice as many texels to cover the same distance on screen. Change
 * the ratio and this changes with it, or the bloom's size moves and it will
 * read as the glow having been turned down.
 */
export const GLOW_KERNEL_SCALE = 2;

/** The scene component key the effect layers register under. */
const EFFECT_LAYER_COMPONENT = "EffectLayer";

/** What `_renderMainTexture` looks like on the effect-layer scene component. */
type LayerComponent = {
  _renderMainTexture?: (camera: Camera) => boolean;
};

/** A render-target wrapper as the two ends of a depth share need to be seen. */
type RenderTarget = {
  shareDepth(target: unknown): void;
  /** Read only by the DEV check below: a `shareDepth` with no depth to give is a no-op. */
  _depthStencilTexture?: object | null;
};

/** The two engine internals this needs, named so the casts stay in one place. */
type EngineInternals = {
  _currentRenderTarget?: RenderTarget | null;
  bindFramebuffer(
    target: unknown,
    faceIndex?: number,
    requiredWidth?: number,
    requiredHeight?: number,
    forceFullscreenViewport?: boolean,
  ): void;
};

export class GlowDepth {
  /** The render list handed back each frame, reused so a frame allocates nothing. */
  private readonly kept: unknown[] = [];

  /** The main-pass target the depth currently comes from; re-shared when it moves. */
  private sharedFrom: object | null = null;

  /**
   * The glow target the depth was last shared TO. A share has two ends and
   * either of them can move underneath it — see (5): the layer rebuilds its
   * main texture on every resize, and keying the cache on the source alone
   * left the new one holding a private depth buffer nobody had ever drawn an
   * occluder into.
   */
  private sharedTo: object | null = null;

  /** The main texture the two hooks are installed on; re-hooked when it moves. */
  private hooked: object | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly glow: GlowLayer,
    private readonly camera: Camera,
  ) {
    this.hookMainTexture();
    this.installLateRender();
  }

  /**
   * Puts the render list and the clear back on whatever the layer's main
   * texture is NOW, and forgets the share if the texture has moved.
   *
   * Called once from the constructor and then once a frame, because there is
   * no observable for the rebuild in (5): `onSizeChangedObservable` fires
   * BEFORE it, on the texture that is about to be thrown away. An identity
   * test is the whole of the mechanism, and on every frame but the one after a
   * resize it is the only thing here that runs.
   */
  private hookMainTexture(): void {
    const tex = this.glow.mainTexture as unknown as object;
    if (tex === this.hooked) return;
    this.hooked = tex;
    this.installRenderList();
    this.installClear();
    // A new texture is a new depth attachment, so whatever was shared last was
    // shared to a target that is gone. BOTH ends are forgotten rather than only
    // the destination: the source is re-read below either way, and a share
    // remembered by halves is exactly the state this pair exists to make
    // unreachable.
    this.sharedFrom = null;
    this.sharedTo = null;
  }

  /**
   * The list becomes the emissive meshes alone.
   *
   * With the depth shared there is nothing for a non-emissive mesh to
   * contribute: it used to be there to write black into the depth buffer, and
   * the depth buffer now arrives already written. `hasMesh` is asked as well,
   * because the list `getCustomRenderList` receives is the scene's active
   * meshes BEFORE the layer's own exclusions — and `Sky`'s cloud decks are
   * emissive, excluded, and would otherwise bloom.
   */
  private installRenderList(): void {
    const tex = this.glow.mainTexture as unknown as {
      getCustomRenderList:
        | ((pass: number, list: readonly unknown[], length: number) => unknown[])
        | null;
    };
    tex.getCustomRenderList = (_pass, list, length) => {
      const kept = this.kept;
      kept.length = 0;
      for (let i = 0; i < length; i++) {
        const mesh = list[i] as {
          material?: { emissiveColor?: { r: number; g: number; b: number } } | null;
        };
        const e = mesh.material?.emissiveColor;
        if (!e || (e.r <= 0 && e.g <= 0 && e.b <= 0)) continue;
        if (!this.glow.hasMesh(mesh as never)) continue;
        kept.push(mesh);
      }
      return kept as never[];
    };
  }

  /**
   * Colour only — see (2) in the header, and note the `clear()` before the add.
   * Re-run by `hookMainTexture` after a rebuild, where what that `clear()`
   * takes off is the default handler the new texture was born with rather than
   * an older copy of our own.
   */
  private installClear(): void {
    const tex = this.glow.mainTexture;
    tex.onClearObservable.clear();
    tex.onClearObservable.add((engine) => {
      engine.clear(this.glow.neutralColor, true, false, false);
    });
  }

  /** Moves the main-texture render to the end of the draw phase — (1) and (3). */
  private installLateRender(): void {
    const component = (
      this.scene as unknown as { _getComponent(name: string): LayerComponent | null }
    )._getComponent(EFFECT_LAYER_COMPONENT);
    const original = component?._renderMainTexture;
    if (!component || typeof original !== "function") {
      // DEV-only, and loud: without this the layer renders early, shares last
      // frame's depth, and the bug is a bloom that lags the camera by one
      // frame — which nobody finds by looking at a still.
      if (import.meta.env.DEV) {
        throw new Error(
          "GlowDepth: no _renderMainTexture on the EffectLayer scene component — " +
            "Babylon's internals have moved and the glow's occlusion is now a frame stale",
        );
      }
      return;
    }
    component._renderMainTexture = () => false;

    const engine = this.scene.getEngine() as unknown as EngineInternals;
    this.scene.onAfterDrawPhaseObservable.add(() => {
      // Render targets drive this observable too — a reflection probe's bake is
      // the one that matters here — and a probe's depth is not the frame's.
      if (this.scene.activeCamera !== this.camera) return;
      const main = engine._currentRenderTarget;
      if (!main) return;
      // Before the share, because a rebuilt texture is a different target to
      // share TO as well as a clear that has to be replaced again.
      this.hookMainTexture();
      const dest = this.glow.mainTexture.renderTarget as RenderTarget | null;
      if (!dest) return;
      if (main !== this.sharedFrom || dest !== this.sharedTo) {
        main.shareDepth(dest);
        this.sharedFrom = main;
        this.sharedTo = dest;
        if (import.meta.env.DEV && dest._depthStencilTexture !== main._depthStencilTexture) {
          // `shareDepth` is a NO-OP when the source has no depth of its own,
          // and a no-op here paints the same picture as (5): the emissive
          // meshes alone against a buffer no occluder was ever drawn into.
          // The frame draws into the FIRST post-process in the camera's chain
          // and Babylon gives a depth buffer to that one alone, so this is
          // really an assertion about the order `Game` assembled the chain in.
          throw new Error(
            "GlowDepth: the main pass handed over no depth — the glow layer is about " +
              "to occlude against nothing and every lamp will bloom through its wall",
          );
        }
      }
      original.call(component, this.camera);
      // (3): the RTT render restored the default framebuffer, and the compose
      // in `_afterCameraDrawStage` is next.
      engine.bindFramebuffer(main, undefined, undefined, undefined, true);
    });
  }
}
