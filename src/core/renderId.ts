/**
 * renderId.ts — the RENDER ID as a counter of OURS (`BABYLON_EXIT.md` X5.4b):
 * the id the viewmodel's render cache is keyed on (`rigJoints.ts`'
 * `RenderCache`, `viewTree.ts`), with Babylon's meaning, and the one moment a
 * render's evaluation is SETTLED at it.
 * Owns: `RenderId` (the number, its advance, and the evaluation's listeners).
 * Invariants:
 * - **It moves exactly where Babylon's render id moved in a round, and
 *   nowhere else.** X5.4a's log (`plans/webgpu-ref/readers.mjs`) found TWO
 *   points a frame, both inside `scene.render`: `Scene._renderFrame`'s, after
 *   its custom render targets' block under `renderTargetsEnabled`
 *   (`scene.pure.js` 4573), and `Scene._renderForCamera`'s, before the camera
 *   binds its frame buffer (4069). The glow mask's render moves neither (a
 *   plain 2D target takes `RenderTargetTexture._render`'s third branch). The
 *   cache compares ids for EQUALITY only, so a counter that moves at the same
 *   points gives every read the answer Babylon's id gave — `muzzleWorld` and
 *   `throwHandWorld` among them, and with them `GrenadeCommand.origin` and
 *   `OrdnanceCommand.origin`, bit for bit (decided 2026-10-31).
 * - **The frame that moves it is OURS since X5.4f** (`core/SceneFrame.ts`,
 *   `render`): the scene is never rendered, so the two advances and the
 *   evaluation are called there, at the points `scene.render` reached them,
 *   where until then they were told off the scene's public observables
 *   (`driveFromScene`, held a constant apart from Babylon's own id by a DEV
 *   shadow, both retired with the render: Babylon's id no longer moves).
 * - **The evaluation is told where Babylon's was**: inside the camera's render,
 *   once it has moved the id (where `onAfterActiveMeshesEvaluationObservable`
 *   was raised), so `settle` stamps the joints the evaluation took with the id
 *   the render took.
 * - Ids are never negative and never repeat: the cache keeps the negatives for
 *   its provisional evaluations.
 * Never: moves at a third point; reads Babylon's id.
 * Contract: this header, `rigJoints.ts`' `RenderCache` and `docs/game.md`
 * (`drawView`'s row).
 */

export class RenderId {
  private id = 0;
  /** Told at each render's evaluation, in the order they were added. */
  private readonly evaluations: (() => void)[] = [];

  /** The current render id — what `scene.getRenderId()` answered. */
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
