/**
 * renderId.ts — the RENDER ID: the counter the viewmodel's render cache is
 * keyed on (`rigJoints.ts`' `RenderCache`, `viewTree.ts`), and the one moment a
 * render's evaluation is SETTLED at it. Babylon's render id, ported.
 * Owns: `RenderId` (the number, its advance, and the evaluation's listeners).
 * Invariants:
 * - **It moves at exactly TWO points a frame, both in `SceneFrame.render`**:
 *   the frame's, after its render targets, and the camera render's, before
 *   the camera binds its frame buffer — where Babylon's moved
 *   (`Scene._renderFrame` and `Scene._renderForCamera`, 9.28 `scene.pure.js`
 *   4573 and 4069). The glow mask's render moves neither. The cache compares
 *   ids for EQUALITY only, so these two points decide every read's answer —
 *   `muzzleWorld` and `throwHandWorld` among them, and with them
 *   `GrenadeCommand.origin` and `OrdnanceCommand.origin`, bit for bit.
 * - **The evaluation is told inside the camera's render, once it has moved the
 *   id**, so `settle` stamps the joints the evaluation took with the id the
 *   render took.
 * - Ids are never negative and never repeat: the cache keeps the negatives for
 *   its provisional evaluations.
 * Never: moves at a third point.
 * Contract: this header, `rigJoints.ts`' `RenderCache` and `docs/game.md`
 * (`drawView`'s row).
 */

export class RenderId {
  private id = 0;
  /** Told at each render's evaluation, in the order they were added. */
  private readonly evaluations: (() => void)[] = [];

  /** The current render id. */
  get current(): number {
    return this.id;
  }

  /** One of the two points a render moves the id at. */
  advance(): void {
    this.id++;
  }

  /** Hangs `fn` on every render's evaluation, after those already hung. */
  onEvaluated(fn: () => void): void {
    this.evaluations.push(fn);
  }

  /** The render has evaluated what it draws, at the id it has moved to. */
  evaluated(): void {
    for (let i = 0; i < this.evaluations.length; i++) this.evaluations[i]();
  }
}
