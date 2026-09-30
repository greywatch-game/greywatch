/**
 * webgpuLeaks.ts — the two things Babylon's WebGPU backend never gives back,
 * and the one line each that makes it. Owns no state: a patch on the engine,
 * installed once where the engine is built, and a flush `Game.teardownMap`
 * calls when a map goes away.
 * Invariants: neither touches anything a live draw holds — the patch runs only
 * for an effect Babylon has already released, and the flush drops a CACHE whose
 * misses are rebuilt on the next draw. Never call `forgetBindGroups` from inside
 * a frame's render. Contract: this header, and `docs/game.md`'s teardown.
 *
 * **Every map BUILD used to leave ~30 MB of JS heap AND ~28 MB of GPU buffers
 * behind, and a session of rounds kept all of them** (Coldharbour, measured
 * after a forced GC in the menu: 127 → 200 MB of heap and 0 → 91 MB of live
 * `GPUBuffer`s over four rounds; with both of these, 103 → 113 MB and 5 MB
 * flat). Neither is the game holding a map — `teardownMap` releases every
 * reference to one. Both are Babylon 9.19.1:
 *
 * **1. A released effect's pipeline context is never disposed on WebGPU.**
 * `Effect.dispose` at refcount 0 reaches `_deletePipelineContext`, which on
 * WebGL deletes the program and on WebGPU only calls `resetCachedPipeline` —
 * a no-op there, because the WebGPU path never registers a pipeline in
 * `cachedPipelines` (it passes no `context`). So `WebGPUPipelineContext.dispose`
 * never runs, and its `leftOver-…` UniformBuffer stays in
 * `engine._uniformBuffers` for the life of the process, holding its whole
 * per-frame POOL — one GPU buffer for every draw of that effect in the busiest
 * frame it ever saw, which during the reflection bake is thousands. The cel
 * MATERIALS are permanent, but their effects are refcounted per SUBMESH, so
 * disposing a map's meshes releases every effect only that map was wearing,
 * and the next build compiles a fresh one and grows a fresh pool beside the
 * dead one. The patch does what WebGL's arm does: dispose the context it was
 * asked to delete.
 *
 * **2. The bind-group cache is never pruned.** `WebGPUCacheBindGroups._Cache`
 * is one static tree keyed by buffer and texture `uniqueId`s, which are a
 * monotonic counter, so an entry for a disposed buffer can never be hit again
 * and is never removed either — ~15k bind groups a Coldharbour build. Babylon
 * resets it only after a lost context. Resetting it costs the next frames a
 * cache miss per draw context that is DIRTY, and nothing else: a draw context
 * keeps its own last bind groups, so a mesh that has not changed never asks.
 *
 * If a future Babylon disposes the context itself, (1) becomes a second
 * dispose of a UniformBuffer, which Babylon tolerates (it is not in the list,
 * and a buffer's refcount only destroys at zero) — so check for that before
 * deleting it, rather than because it broke.
 *
 * **Still unfixed upstream as of 9.28.0** (checked 2026-09-29):
 * `_deletePipelineContext` and `webgpuCacheBindGroups.js` are unchanged, and
 * no issue or PR names either leak. **An upgrade past ~9.26 brings PR #18880
 * with it**, on by default (`_useOwnerKeyedUniformBufferSlots`): the
 * `leftOver` pools are keyed per DRAW CONTEXT rather than per draw order,
 * which frees a slot only when its UBO is disposed — so (1) is still needed
 * and the pool it leaks may be LARGER (the PR's own example is 1,200 buffers
 * against 3) — and it states outright that it adds no bind-group eviction, so
 * (2) is still needed too. Re-measure both before trusting either across that
 * upgrade.
 */
import { type WebGPUEngine, WebGPUCacheBindGroups } from "@babylonjs/core";

/** Makes a released effect give back its uniform buffers. Once, at boot. */
export function disposeReleasedPipelines(engine: WebGPUEngine): void {
  const release = engine._deletePipelineContext.bind(engine);
  engine._deletePipelineContext = (pipelineContext) => {
    release(pipelineContext);
    pipelineContext?.dispose();
  };
}

/** Drops every cached bind group. Between maps, outside a render. */
export function forgetBindGroups(): void {
  WebGPUCacheBindGroups.ResetCache();
}
