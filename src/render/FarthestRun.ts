/**
 * render/FarthestRun.ts — The ONE back-to-front run of ours (`BABYLON_EXIT.md`
 * X4.6e): the see-through glazing, the sparks, the dust discs, the scorch and
 * the blob shadows, drawn as Babylon's transparent list drew them, in one
 * order at one point — because every one of them blends and writes no depth,
 * so what is under what is the ORDER, and one sort over all of them is the
 * only way a fade behind a pane and one in front of it both come out right.
 * And the sparks' blooms into the glow's mask, in that same order, where the
 * mask's own transparent list drew them.
 * Owns: `FarthestRun` — the frame's one draw at `"beforeBlended"`, its one
 * draw in the mask (`addGlowMaskBlended`), the pull asked inside the render,
 * and the order the pull writes: `order` (a code a draw — a pane's index in
 * `GlassDraw.surfaces`, or `FADE` plus a drawn fade's index in `FadeDraw`'s
 * arrays), `keys` (each one's distance from the eye) and `draws`, and
 * `masked`, how many of them the mask draws.
 * Invariants: behind the moon at `"beforeBlended"` (`SkyDraw` adds it at its
 * construction, this at each install), where Babylon's transparent list
 * began — past its particles and the moon, which was the first of that list
 * by distance — and ahead of `"afterGroup"`; its mask draw behind the moon's
 * there too, where Babylon's mask drew its blended meshes; **nothing here
 * orders anything**: which surfaces are drawn, each one's key and the order
 * are the pull's (`Game.farthestPull`: Babylon's `_distanceToCamera`, the
 * square root of the bounding sphere's centre from `globalPosition`,
 * farthest first, a tie in the order the meshes stood in the scene), asked
 * once a frame after every prepare (`late`) and after the glazing's own pull
 * (`GlassDraw`, installed first), whose see-through verdicts it files; a
 * frame it has nothing to draw costs a predicate; nothing here makes an
 * object on a frame but a frame drawing more than any before it.
 * Never: imports Babylon; draws a thing itself; holds a surface; decides a key.
 * Contract: `docs/rendering.md`, "The one run" and "The pools, ours".
 */
import type { FadeDraw } from "./FadeDraw";
import type { GlassDraw } from "./GlassDraw";
import type { FrameContext, Renderer } from "./Renderer";

/** A code at or past this is a drawn fade: `code - FADE` is its index. */
export const FADE = 1 << 20;

export class FarthestRun {
  /** This frame's draws, farthest first: the pull writes them. */
  order = new Int32Array(64);
  /** Each one's distance from the eye, in that order. */
  keys = new Float64Array(64);
  /** How many of `order` this frame draws. */
  draws = 0;
  /** How many of them are sparks the mask draws (the pull counts them). */
  masked = 0;

  private removes: (() => void)[] = [];

  constructor(
    private readonly renderer: Renderer,
    private readonly glass: GlassDraw,
    private readonly fades: FadeDraw,
    /** Asked inside the render, once a frame: writes the order and the fades' arrays. */
    private readonly pull: (into: FarthestRun) => void,
    /** Whether drawn fade `k` blooms (a spark, the glow admitting). */
    private readonly blooms: (k: number) => boolean,
  ) {}

  /** Room for `n` draws: the one allocation, past the most any frame before drew. */
  reserve(n: number): void {
    if (n <= this.order.length) return;
    let cap = this.order.length;
    while (cap < n) cap *= 2;
    this.order = new Int32Array(cap);
    this.keys = new Float64Array(cap);
  }

  /** Draws the run from the next frame on: the caller installs it after the moon's draw at `"beforeBlended"`. */
  install(): void {
    this.uninstall();
    this.removes.push(
      // Late, so every draw's prepare has given its verdict on this frame.
      this.renderer.onFrame(this.prepare, true),
      this.renderer.add(this.draw, "beforeBlended", this.active),
      this.renderer.addGlowMaskBlended(this.drawMask, this.maskActive),
    );
  }

  /** Draws nothing again until the next `install`. */
  uninstall(): void {
    for (const remove of this.removes) remove();
    this.removes.length = 0;
    this.draws = 0;
    this.masked = 0;
  }

  private readonly active = (): boolean => this.glass.active || this.fades.active;

  private readonly maskActive = (): boolean => this.fades.active;

  private readonly prepare = (): void => {
    this.draws = 0;
    this.masked = 0;
    if (!this.glass.drawing && !this.fades.drawing) return;
    this.pull(this);
  };

  /** The order, each stretch of one kind bound once. */
  private readonly draw = (pass: GPURenderPassEncoder, ctx: FrameContext): void => {
    const order = this.order;
    const glass = this.glass;
    const fades = this.fades;
    // Which of the two drew last: 0 neither, 1 a pane, 2 a fade.
    let last = 0;
    for (let d = 0; d < this.draws; d++) {
      const code = order[d];
      if (code >= FADE) {
        fades.drawFade(pass, ctx, code - FADE, last !== 2);
        last = 2;
      } else {
        glass.drawSeeThrough(pass, ctx, code, last !== 1);
        last = 1;
      }
    }
  };

  /** The sparks' blooms, in the same order. */
  private readonly drawMask = (pass: GPURenderPassEncoder, ctx: FrameContext): void => {
    if (this.masked === 0 || !this.fades.masking) return;
    const order = this.order;
    let fresh = true;
    for (let d = 0; d < this.draws; d++) {
      const code = order[d];
      if (code < FADE || !this.blooms(code - FADE)) continue;
      this.fades.maskFade(pass, ctx, code - FADE, fresh);
      fresh = false;
    }
  };
}
