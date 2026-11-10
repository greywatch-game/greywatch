/**
 * renderId.ts — the RENDER ID as a counter of OURS (`BABYLON_EXIT.md` X5.4b):
 * the id the viewmodel's render cache is keyed on (`rigJoints.ts`'
 * `RenderCache`, `viewTree.ts`), with Babylon's meaning, and the one moment a
 * render's evaluation is SETTLED at it.
 * Owns: `RenderId` (the number, its advance, and the evaluation's listeners)
 * and, until the scene stops rendering, `driveFromScene` — the two points
 * Babylon's `scene.render` moved its own id at, and its evaluation, told off
 * the scene's PUBLIC observables.
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
 * - **Each advance is told from the first public observable AFTER Babylon's
 *   own**, inserted ahead of every other observer on it, so nothing the scene
 *   raises there meets ours behind Babylon's: the frame's
 *   `onAfterRenderTargetsRenderObservable` (raised before the camera renders —
 *   the camera's own raise of it is told apart, and moves nothing), and
 *   `onBeforeCameraRenderObservable`. Between Babylon's increment and each of
 *   those, Babylon runs only its own code.
 * - **The evaluation is told where Babylon's was**: inside the camera's render,
 *   once it has moved the id (`onAfterActiveMeshesEvaluationObservable`), so
 *   `settle` stamps the joints the evaluation took with the id the render took.
 * - **A DEV build holds ours against Babylon's** (`shadow`): at every read,
 *   `ours - Babylon's` must be what it was when the drive began. A read where
 *   it is not is a site that moved Babylon's id and not ours — the cache's
 *   answers there would differ — and it is counted (`drift`, must be 0) and
 *   said as a console error, once per new difference. It goes when the scene
 *   stops rendering (X5.4f), because Babylon's id stops moving with it.
 * - Ids are never negative and never repeat: the cache keeps the negatives for
 *   its provisional evaluations.
 * Never: reads Babylon's id outside the DEV shadow, or moves at a third point.
 * Contract: this header, `rigJoints.ts`' `RenderCache` and `docs/game.md`
 * (`drawView`'s row).
 */
import type { Scene } from "@babylonjs/core";

export class RenderId {
  private id = 0;
  /** Told at each render's evaluation, in the order they were added. */
  private readonly evaluations: (() => void)[] = [];
  /** DEV: Babylon's own id, read at every read of ours; null outside one. */
  private twin: (() => number) | null = null;
  /** DEV: `ours - Babylon's`, as it stood when the shadow began. */
  private offset = 0;
  /** DEV: reads at which ours and Babylon's were not `offset` apart. Must be 0. */
  drift = 0;

  /** The current render id — what `scene.getRenderId()` answered. */
  get current(): number {
    if (this.twin !== null) this.check();
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

  /** DEV: holds every read against `babylon` from here on (the header). */
  shadow(babylon: () => number): void {
    this.twin = babylon;
    this.offset = this.id - babylon();
  }

  private check(): void {
    const d = this.id - this.twin!();
    if (d === this.offset) return;
    this.drift++;
    console.error(
      `RenderId: ours (${this.id}) less Babylon's render id is ${d}, not ${this.offset} — ` +
        "something moved one and not the other, so the viewmodel's render cache no longer answers " +
        "as Babylon's did (core/renderId.ts, BABYLON_EXIT.md X5.4b)",
    );
    this.offset = d;
  }
}

/**
 * Moves `ids` where `scene.render` moves Babylon's render id, and tells its
 * evaluation, off the scene's public observables (the header). Once, before
 * anything hangs on `ids`; the DEV shadow with it.
 */
export function driveFromScene(ids: RenderId, scene: Scene): void {
  // Whether the camera's render is under way: the frame's own raise of
  // `onAfterRenderTargetsRender` comes before it, the camera's inside it.
  let inCamera = false;
  scene.onAfterRenderTargetsRenderObservable.add(
    () => {
      if (!inCamera && scene.renderTargetsEnabled) ids.advance();
    },
    undefined,
    true,
  );
  scene.onBeforeCameraRenderObservable.add(
    () => {
      inCamera = true;
      ids.advance();
    },
    undefined,
    true,
  );
  scene.onAfterCameraRenderObservable.add(() => {
    inCamera = false;
  });
  scene.onAfterActiveMeshesEvaluationObservable.add(() => ids.evaluated());
  if (import.meta.env.DEV) ids.shadow(() => scene.getRenderId());
}
