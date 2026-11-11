/**
 * GlowPass.ts — The game's bloom, as RULES it owns end to end: when the mask
 * and its blur are drawn (the end of the draw phase), at what sizes (the
 * mask at the frame's, the blur below it by the rung), with which kernel, and
 * what the additive compose adds (its intensity; the arithmetic is the ink's
 * last line, X5.2d). Owns the rung, the sizes it last gave the targets and
 * the kernel it last read — but since `BABYLON_EXIT.md` X5.4e no target and no
 * pass: the mask, its blur's five and every pass into them are OUR renderer's
 * (`render/FrameTargets.ts`, `Renderer.recordGlowMask`, `render/GlowBlur.ts`),
 * asked for through `GlowDraws`, which `Game` hands in. Reads no game state
 * and writes to no mesh.
 * Invariants: the mask is drawn against the frame's OWN depth, at the size
 * that depth is at on the frame it is borrowed — so a bloom that reaches
 * through a wall is a bug here and never a tuning question; nothing draws
 * into that depth in the mask; the targets are resized here, all six at once,
 * whenever the frame's size or the rung moved, before the mask is asked for;
 * this file imports nothing of `src/render/` (`GlowDraws` is the crossing);
 * and every Babylon call is public API (the draw phase's observable, the
 * engine's render height and scaling level).
 *
 * WHAT IT REPLACED, AND WHY. The bloom was a `GlowLayer` with `GlowDepth`
 * bolted on from the outside. The layer is built to own four things — its
 * texture, its depth buffer, its clear and its place in the frame — and
 * `GlowDepth` overrode all four through three Babylon internals, re-applying
 * the overrides every frame because the layer kept putting its own back. What
 * that bought is kept here exactly: the render list is the emissive meshes
 * ALONE, and their occlusion is the main pass's depth rather than the whole
 * visible scene redrawn in opaque black (docs/rendering.md, "The glow: what
 * the depth share replaced" — ~20% of the frame on
 * Coldharbour, Harrowmead and Sarab). What it cost is gone by construction:
 *
 * - **No schedule to move.** The mask is a target nothing else renders; it is
 *   rendered once, from the end of the draw phase, where the depth is final.
 * - **No clear to replace.** Colour only, the depth loaded: the mask's pass is
 *   our renderer's (`BABYLON_EXIT.md` X5.4e), begun with exactly those ops.
 *   (While it was Babylon's, an observer on the target's clear replaced the
 *   default, installed once on a texture nothing else recreated.)
 * - **No framebuffer to re-bind by internal.** The frame is our renderer's
 *   target (`FrameTargets.frame`, X5.4e; `PostPasses`' render target and its
 *   public `renderTarget` from X5.2d).
 * - **No frame lost on a resize.** The layer's
 *   texture and the depth it borrowed resized on different schedules, and the
 *   frame between was encoded with a colour attachment at one size and a depth
 *   at another and rejected whole. Here ONE function reads the size of the
 *   depth it is about to borrow, resizes to it, shares, and draws, so the two
 *   ends cannot disagree on any frame.
 * - **The blur is off the backing store.** Depth sharing needs the mask at full
 *   resolution, and the layer blurred the texture it drew, so four times the
 *   pixels went through the blur. The mask stays full resolution — `CelInk`
 *   reads it as its emissive mask — and the blur starts from a half-resolution
 *   downsample, which is the size the kernel was tuned at in the first place.
 *
 * THE GLOW SETTING MOVES WHERE THE BLUR STARTS AND NOTHING ELSE
 * (`CONFIG.graphics.glowTiers`). `high` is the paragraph above. `low` blurs at
 * a quarter and an eighth instead, with the kernel halved in texels so the
 * bloom reaches exactly as far on screen and is only softer. It owes one more
 * pass to do that honestly: the first blur reads the full-resolution mask
 * with taps spaced in texels of its OWN target, which at half resolution
 * already touches about half the mask's pixels and at quarter would touch an
 * eighth — a one-pixel tracer or reticle line falling between taps and
 * flickering as it moved. So `low` first box-filters the mask to quarter
 * resolution (`glowDown`, four bilinear taps reading every pixel once) and
 * blurs from that.
 *
 * THE MASK WAS DRAWN WITH AN OVERRIDE MATERIAL, NOT WITH THE MESH'S OWN, and
 * every draw of ours there keeps the rule: a glowing surface's own unlit
 * colour is already faded by `EmissiveFog` TOWARD THE FOG, and a bloom of the
 * fog colour is a white haze round every distant lamp on a bright map — so
 * the mask is handed each surface's colour faded toward black instead
 * (`Game.bloomColour`, the rules `Game` holds). It writes NO depth: every
 * surface it draws already wrote its own into the frame's buffer in the main
 * pass, so an LEQUAL test against that buffer is the whole of the occlusion —
 * and a blended surface that wrote none must not start writing one here, or
 * the ink and the blur read it. (Babylon's override materials, the
 * `glowMask*` programs, drew the map editor's build's meshes here until
 * `BABYLON_EXIT.md` X5.3d.)
 *
 * THE LOOK is Babylon's glow layer as it was tuned: a Gaussian `kernelBlur`
 * at half resolution and again at quarter, the two summed, scaled by
 * `glowIntensity`, clamped to 1, added to the frame. The one deliberate change
 * is WHERE: the bloom is added AFTER the ink rather than blended onto the frame
 * before it, so a bloom lies over the ink lines around its lamp rather than
 * under them.
 *
 * THE BLUR IS OUR RENDERER'S DRAWS IN OUR RENDERER'S PASSES (`render/GlowBlur.ts`,
 * `BABYLON_EXIT.md` X5.2b; the passes since X5.4e, where this file bound and
 * unbound each of its five targets with public API until then). This file asks
 * for each pass in order — the box filter on `low`, then the four blurs — and
 * our renderer begins it on its target, draws Babylon's `kernelBlur` or the box
 * filter, ported as compiled, and ends it: the pass structure Babylon's own
 * draws had. The kernel is still read HERE every frame
 * (`kernelTexels`), and `glowKernels` is the same formula asked of every rung
 * at every render scale ahead, because the blur's text is the kernel's and its
 * pipelines are declared (X5.2's row "pipelines"). A pass whose program is not
 * built is not begun — which is NOT what Babylon did: it compiled a new width
 * synchronously at its first draw and drew the bloom. Ours compiles off the
 * frame, so after a device-pixel-ratio change in play (or one in the menu
 * whose widths are not built by the time the round plays) the ink composes
 * NO bloom for the ~3 frames they compile, the resize having recreated these
 * targets zero-filled — a known live difference the owner accepted on
 * 2026-11-08 (`render/GlowBlur.ts`' header, X5.2's row "a DPR change in play").
 *
 * THE COMPOSE IS NOT A PASS OF ITS OWN, and that is a phone's fill rate rather
 * than tidiness. It reads one pixel of the frame and adds two bilinear taps,
 * so as a post-process it was a whole-frame write and read for three fetches —
 * on a tile-based GPU, a round trip of the full backing store through memory.
 * So the arithmetic is the ink's LAST LINE: the ink already holds the pixel,
 * and adding the bloom after its own `mix` is exactly the order the separate
 * pass kept. The one difference is that the inked frame is no longer rounded
 * to 8 bits before the bloom lands on it, which is under half a step. Its
 * text is the ink's compiled module's `glowAt` (`wgsl/celInk.ts`,
 * `BABYLON_EXIT.md` X5.2d: the snippet this file spliced into the ink's
 * source, as Babylon's processor compiled it), and what it reads is handed
 * from here — the two blurred targets and the intensity (`composeNear`,
 * `composeWide`, `composeIntensity`), which the ink's stage binds and fills.
 * The snippet's own note, kept verbatim: "Clamped BEFORE the add, as the
 * layer's merge was: it wrote into an 8-bit target and was blended on from
 * there. The layer's blend also scaled by the merge's alpha, which was always
 * 1 — the mask clears to alpha 1 and nothing drawn into it lowers that — so
 * there is no alpha term here, and the caller keeps whatever alpha it was
 * going to write."
 *
 * THE EMISSIVE PALETTE'S MASK IS OUR RENDERER'S, and nothing of it is drawn
 * here (`render/WorldGlow.ts`, X3.6d, X3.7b, X3.7c): it draws the merged
 * world's lit windows and lenses FIRST in the mask's pass, right after the clear —
 * the palette was in Babylon's opaque queue, ahead of every blended mask
 * draw, and first keeps that order. Its MAIN pass is ours too (X3.6e), and
 * Babylon is made no mesh of it, so it has no twin here: a palette surface ours
 * cannot hold and a mask it cannot draw are the world's failure, and
 * `noGlow` is read per surface at the take. The BODIES' visors are ours too
 * (`render/BodyDraw.ts`, X4.1d: no rig is a Babylon mesh), drawn first in
 * the pass with the palette, each at `GlowRules.colour`'s answer for its
 * body. So are the WEAPON's lit parts (`render/ViewDraw.ts`, X4.3c: no
 * viewmodel part is a Babylon mesh since X4.3d), drawn LAST in the pass — after
 * every mesh of Babylon's, blended ones included — as Babylon's group 1 drew
 * them — at the pass's close, `onMaskCloseObservable` until X5.4e (X4.3c's
 * review, the owner's decision): so a blended emissive that writes no depth (an impact's spark
 * fading) in front of a lit weapon part lands UNDER the weapon's colour, as
 * it did. The MOON is ours too (`render/SkyDraw.ts`, X4.5c: no sky piece is a
 * Babylon mesh), drawn at the open behind every other draw of ours, so still
 * ahead of the blended meshes here, of which it was the first by distance; the
 * opaque ones lying between, each having written the depth it is rejected by,
 * cannot be told from either order. So are the sparks, the pools' pieces,
 * the billows and the fires (X4.4), each told where Babylon's mask drew its
 * meshes. Nothing of Babylon's draws in the mask since X5.3c: the `EMISSIVE`
 * and `OPACITY` variants, `SelfMasking` (a material whose vertices move
 * bringing its own twin, the fire's) and the per-mesh dressing were the map
 * editor's build's alone, and were deleted at X5.3d. The PASS moved with the
 * main pass at X5.4e (`BABYLON_EXIT.md` X5.2's row "the mask"): our renderer
 * records it, the mask cleared to black with alpha 1 and the frame's depth
 * loaded, as `onClearObservable` cleared it and `shareDepth` attached it.
 */
import { type Camera, Observable, type Scene } from "@babylonjs/core";
import { CONFIG } from "../config";

/** A rung of the Glow setting — derived from the config for `VolumetricRung`'s reason. */
export type GlowRung = keyof typeof CONFIG.graphics.glowTiers;

/**
 * The blur's kernel in TEXELS of the near target, for a rung's `downsample`
 * and a scaling `level` — see `GlowPass.kernelTexels`, which reads it every
 * frame, and `glowKernels`, which asks it of every setting ahead.
 */
function kernelTexelsAt(downsample: number, level: number): number {
  return Math.max(1, CONFIG.graphics.glowKernel / (downsample * level));
}

/**
 * Every kernel the blur can be asked for at a device pixel ratio of `dpr`:
 * each rung at each render scale, at the scaling level `Game.applyRenderScale`
 * sets for them (`1 / (dpr * scale)`, the same expression, so the same
 * double) — what the blur's pipelines are declared for (`render/GlowBlur.ts`,
 * `BABYLON_EXIT.md` X5.2's row "pipelines"), so a setting changed in play
 * compiles nothing.
 */
export function glowKernels(dpr: number): number[] {
  const out: number[] = [];
  for (const rung of Object.keys(CONFIG.graphics.glowTiers) as GlowRung[]) {
    for (const scale of CONFIG.graphics.renderScales) {
      out.push(kernelTexelsAt(CONFIG.graphics.glowTiers[rung].downsample, 1 / (dpr * scale)));
    }
  }
  return out;
}

/**
 * What this pass asks of OUR renderer, which owns the glow's targets and
 * records every pass of it (`render/FrameTargets.ts`, `Renderer.recordGlowMask`,
 * `render/GlowBlur.ts`; `BABYLON_EXIT.md` X5.2b, X5.4e) — handed in by `Game`,
 * as `GlowRules` is, so this file imports nothing of `src/render/`.
 */
export interface GlowDraws {
  /** The frame's width and height this frame — its depth's, which the mask borrows; 0 before a frame is made. */
  frameWidth(): number;
  frameHeight(): number;
  /** The six targets' sizes: the mask's, then the box filter's, the near pair's and the wide pair's. */
  resize(
    maskW: number,
    maskH: number,
    downW: number,
    downH: number,
    nearW: number,
    nearH: number,
    wideW: number,
    wideH: number,
  ): void;
  /** The mask's pass, recorded now: its clear, the draws first in it and the draws last. */
  mask(): void;
  /** Whether the box filter can draw this frame (its pipeline built). */
  downReady(): boolean;
  /** Whether a blur of ideal width `kernel` can draw this frame — a width not built yet is skipped (Babylon compiled one synchronously and drew it: the header's accepted difference). */
  blurReady(kernel: number): boolean;
  /** The box filter's pass: the mask, of `width` x `height`, into the `down` target; `outputHeight` the render height. */
  down(width: number, height: number, outputHeight: number): void;
  /**
   * Blur pass `index` (0 to 3) into its target of `width` x `height`, `across`
   * or down, with the kernel of ideal width `kernel` — the first reading the
   * box filter's output `fromDown`, else the mask; each other the one before's.
   */
  blur(
    index: number,
    kernel: number,
    across: boolean,
    fromDown: boolean,
    width: number,
    height: number,
    outputHeight: number,
  ): void;
}

export class GlowPass {
  /**
   * Fired around the pass's own work — the mask and its blur, at the end of
   * the draw phase — so the frame profiler can bracket it without this file
   * knowing it exists. The compose is three fetches inside `CelInk` and is
   * that pass's cost now.
   */
  readonly onBeforeWorkObservable = new Observable<void>();
  readonly onAfterWorkObservable = new Observable<void>();

  private rung: GlowRung = "high";
  /** Set when the rung moves, so the next frame re-sizes the targets whatever the frame did. */
  private stale = false;
  /** The kernel the blur last read (`kernelTexels`), ideal and unrounded, as Babylon's blurs held it. */
  private kernel = 1;
  /** The size the mask was last given (0 before the first), and the four blur passes' targets'. */
  private maskW = 0;
  private maskH = 0;
  private readonly outW = [0, 0, 0, 0];
  private readonly outH = [0, 0, 0, 0];

  constructor(
    private readonly scene: Scene,
    private readonly camera: Camera,
    private readonly draws: GlowDraws,
  ) {
    scene.onAfterDrawPhaseObservable.add(() => this.render());
  }

  /**
   * The Glow setting. A no-op unless the rung moved; a move re-sizes the blur's
   * targets on the next frame, and the kernel follows by itself because it is
   * read before every blur.
   */
  setQuality(rung: GlowRung): void {
    if (rung === this.rung) return;
    this.rung = rung;
    this.stale = true;
  }

  /** The compose's scale on the summed halves (`CONFIG.graphics.glowIntensity`). */
  get composeIntensity(): number {
    return CONFIG.graphics.glowIntensity;
  }

  /**
   * The mask and its blur, at the end of the draw phase — after our renderer
   * recorded the frame's main pass, whose observer is inserted first there.
   *
   * Sized and drawn in one function, which is the whole of the resize fix:
   * the size is READ off the frame whose depth the mask borrows, on the frame
   * it is borrowed, so the colour attachment and the depth attachment of the
   * mask's pass are never two sizes.
   */
  private render(): void {
    // Only `Scene._renderForCamera` notifies this observable (Babylon 9.28,
    // `scene.pure.js` 4180; no render target's manager does, a reflection
    // probe's bake included), so this guards against a camera other than the
    // frame's being drawn, which nothing does today. Harmless, and kept.
    if (this.scene.activeCamera !== this.camera) return;
    const draws = this.draws;
    const w = draws.frameWidth();
    const h = draws.frameHeight();
    // No frame made yet (no `PostPasses.prepareFrame` has sized one): no depth
    // to borrow — as Babylon's mask had no frame target to share one from.
    if (w === 0 || h === 0) return;
    this.onBeforeWorkObservable.notifyObservers();
    if (this.stale || this.maskW !== w || this.maskH !== h) this.resize(w, h);
    draws.mask();
    this.blur();
    this.onAfterWorkObservable.notifyObservers();
  }

  /**
   * Four separable passes: mask -> near (across, down) -> wide (across, down),
   * near being half resolution on `high` and quarter on `low` — where the mask
   * is box-filtered into `down` first and the first pass reads that instead.
   *
   * **Every pass is OUR renderer's** (`draws`, `BABYLON_EXIT.md` X5.2b, X5.4e),
   * the structure Babylon's own draws had. A pass whose program is not built
   * is not begun at all, its target keeping what it held — zeros, after the
   * resize a device-pixel-ratio change brings, so no bloom for the frames its
   * new widths compile, where Babylon compiled them synchronously and drew
   * them (the header's accepted live difference).
   */
  private blur(): void {
    // Read every frame: the render-scale setting moves the backing store.
    const kernel = this.kernelTexels();
    this.kernel = kernel;
    // `Internals.textureOutputHeight_`, which Babylon's engine wrote the
    // render height into (`_initializeMainAttachments`) and no blur reads.
    const outputHeight = this.scene.getEngine().getRenderHeight(true);
    const draws = this.draws;
    // Until the box filter's program has compiled, the first pass reads the
    // mask direct — undersampled for a frame or two rather than blurring
    // nothing.
    let fromDown = false;
    if (this.downsampleBy() > 2 && draws.downReady()) {
      draws.down(this.maskW, this.maskH, outputHeight);
      fromDown = true;
    }
    for (let i = 0; i < 4; i++) {
      if (!draws.blurReady(kernel)) continue;
      draws.blur(i, kernel, i % 2 === 0, i === 0 && fromDown, this.outW[i], this.outH[i], outputHeight);
    }
  }

  /** The kernel the blur last read, ideal and unrounded (`kernelTexels`) — for an instrument. */
  get blurKernel(): number {
    return this.kernel;
  }

  private resize(w: number, h: number): void {
    this.stale = false;
    const by = this.downsampleBy();
    const nw = Math.max(1, Math.floor(w / by));
    const nh = Math.max(1, Math.floor(h / by));
    const ww = Math.max(1, Math.floor(nw / 2));
    const wh = Math.max(1, Math.floor(nh / 2));
    // The box filter's output IS the near size, four mask pixels to a texel;
    // 1x1 on `high`, which never reads it.
    const down = by > 2;
    this.draws.resize(w, h, down ? nw : 1, down ? nh : 1, nw, nh, ww, wh);
    this.maskW = w;
    this.maskH = h;
    this.outW[0] = this.outW[1] = nw;
    this.outH[0] = this.outH[1] = nh;
    this.outW[2] = this.outW[3] = ww;
    this.outH[2] = this.outH[3] = wh;
  }

  /** How far below the frame the near target sits, off the rung. */
  private downsampleBy(): number {
    return CONFIG.graphics.glowTiers[this.rung].downsample;
  }

  /**
   * The kernel in TEXELS of the near target, from
   * `CONFIG.graphics.glowKernel`, which is stated against the FRAME.
   *
   * A near texel is `downsample` backing-store pixels (2 on `high`, 4 on
   * `low`), and a backing-store pixel is `level` CSS pixels
   * (`Game.applyRenderScale`), so `glowKernel` CSS pixels is
   * `glowKernel / (downsample * level)` texels — the same reach on screen on
   * either rung. The wide target uses the same count and so blurs twice as
   * wide on screen, which is the pair the layer composed. At a scaling level
   * of 1 on `high` this is exactly the kernel the layer ran with.
   */
  private kernelTexels(): number {
    return kernelTexelsAt(this.downsampleBy(), this.scene.getEngine().getHardwareScalingLevel());
  }
}
