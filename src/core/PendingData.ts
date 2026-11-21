/**
 * PendingData.ts — the page's READINESS: what the
 * game still waits on before a frame of it is the frame it means to draw —
 * Babylon 9.28's `Scene` pending-data list PORTED as written
 * (`scene.pure.js` 2040-2069: `addPendingData`, `removePendingData`,
 * `getWaitingItemsCount`, `isLoading`), and `isReady`, `scene.isReady()`
 * reduced to the one arm this game reaches.
 * Owns: `PendingData` — the list of objects being waited on, in the order they
 * were added, each held by identity.
 * Invariants:
 * - **`isReady` is the list being EMPTY, and nothing else**: the one arm of
 *   `Scene.isReady` (`scene.pure.js` 1827) that could answer false in this
 *   game — the scene held no mesh, geometry, camera, particle system, render
 *   target, layer, effect layer or readiness check, its engine compiled no
 *   effect, and it was never disposed (`plans/webgpu-ref`'s check:
 *   `_pendingData` held the water's foam and nothing else on any frame, and
 *   readiness went false on exactly the frames it was pending).
 * - **Removal is what Babylon's was**: by identity, the first match spliced,
 *   an object never added ignored. `onDataLoadedObservable`, which
 *   `removePendingData` raised as the list emptied, is not ported: nothing
 *   observed it.
 * - The holders: the water's foam mask while it decodes (`WaterSystem`, its
 *   decode's callback removing it on success and on failure alike, as the
 *   scene's `Texture` did). A new thing the frames must wait on is added here.
 * Never: reads a clock, polls or schedules (`executeWhenReady`'s timer has no
 *   caller in the game); is read by the game for an outcome — what reads it
 *   is the instruments (`scripts/lib/frameAdapter.mjs`' `ready`, the bank,
 *   `npm run shots`, the skills' scripts), through `Game.pending`.
 *
 * ## Licence
 *
 * The method bodies are copied from Babylon.js 9.28 (`scene.pure.js`), which
 * is licensed under the Apache License, Version 2.0
 * (`licenses/babylonjs.md`;
 * https://www.apache.org/licenses/LICENSE-2.0). "Babylon.js — Copyright 2023
 * The Babylon.js team" (its NOTICE). Changes from the original: the four
 * members lifted out of the scene, `onDataLoadedObservable` removed, and
 * `isReady` added.
 * Contract: `docs/game.md` ("What a frame owes").
 */
export class PendingData {
  /** What is being waited on, in the order it was added: `Scene._pendingData`. */
  private readonly _pendingData: unknown[] = [];

  /** `Scene.addPendingData`: `data` is waited on until it is removed. */
  addPendingData(data: unknown): void {
    this._pendingData.push(data);
  }

  /** `Scene.removePendingData`: `data` is no longer waited on (an object never added is ignored). */
  removePendingData(data: unknown): void {
    const index = this._pendingData.indexOf(data);
    if (index !== -1) {
      this._pendingData.splice(index, 1);
    }
  }

  /** `Scene.getWaitingItemsCount`: how many objects are waited on. */
  getWaitingItemsCount(): number {
    return this._pendingData.length;
  }

  /** `Scene.isLoading`: whether anything is waited on. */
  get isLoading(): boolean {
    return this._pendingData.length > 0;
  }

  /** `Scene.isReady`'s one arm in this game (the header): nothing waited on. */
  isReady(): boolean {
    return !this.isLoading;
  }
}
