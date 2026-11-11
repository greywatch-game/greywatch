/**
 * The BABYLON-LEAK probe (`BABYLON_EXIT.md` X5.4a: X5.4b's proof for deleting
 * `src/core/webgpuLeaks.ts`, which it did). That file patched the two things
 * Babylon's WebGPU backend never gives back — a released effect's pipeline
 * context, which `_deletePipelineContext` on WebGPU never disposes, and the
 * bind-group cache (`WebGPUCacheBindGroups`), which is never pruned — and both
 * bite only while Babylon still RELEASES effects and still MAKES bind groups.
 * Since X5.3d no Babylon material compiles in any state and since X5.2d no
 * Babylon pass draws, so the question X5.4b asked is whether either still
 * happens at all after the boot; this counts both, and nothing else changes. It
 * stays as the regression read for as long as Babylon's engine stands (to
 * X5.4h): a count that moves off zero is the patch's two leaks back. **Since
 * X5.4h Babylon's engine is a `NullEngine`** (`src/core/SceneEngine.ts`): it
 * has no WebGPU backend, no pipeline context and no bind-group cache, so the
 * two counts are 0 by construction and the positive control cannot run (it
 * needs a WebGPU engine to compile an effect and fill a cache): it is said to
 * be skipped, and the device's counts, the live buffers and the heap are
 * read as before.
 *
 * ```
 * node plans/webgpu-ref/leaks.mjs [map] [--then=<map>] [--frames=600] [--rounds=2]
 * ```
 *
 * One page (Coldharbour by default, the map `webgpuLeaks.ts`' header measured),
 * the round's seed pinned: the boot settled at the menu (the BASELINE: whatever
 * the boot made is the boot's), then `--rounds` rounds (two by default; X5.4b
 * read four, the deleted file's own measurement) — each installed, a life of
 * `--frames` frames in play, and torn down to the menu — then a MAP CHANGE (to
 * `--then`, Hollowmere by default, through `Game.setMap` as the menu does it), a
 * round there and its teardown. At the end of each step, read after a forced GC
 * (the DevTools protocol's `HeapProfiler.collectGarbage`), and per frame class
 * (the game's state at the frame adapter's begin):
 *
 * - every call of the engine's `_deletePipelineContext` since the baseline
 *   (counted on the engine; at a parent with `webgpuLeaks.ts`, outside its
 *   wrapper, so its own dispose is not counted twice) and whether it was handed
 *   a context;
 * - every bind group Babylon's cache CREATED since the baseline
 *   (`WebGPUCacheBindGroups.NumBindGroupsCreatedTotal` read across every
 *   `getBindGroups`, so a reset of the cache — the deleted file's
 *   `forgetBindGroups` at a parent's teardown — does not hide one), and every
 *   `GPUDevice.createBindGroup` beside it, ours and Babylon's together;
 * - the live `GPUBuffer`s (made less destroyed, off the device), their BYTES (each
 *   buffer's descriptor size, a destroyed one's taken off once) and the JS heap
 *   used (`Runtime.getHeapUsage`) — `webgpuLeaks.ts`' own measurement (its heap
 *   and its MB of live buffers), which X5.4b repeated over four Coldharbour rounds
 *   at the parent and after the deletion.
 *
 * **A POSITIVE CONTROL runs first, at the menu, before the baseline**
 * (X5.4a's review: a reading of zero is X5.4b's licence to delete a file, so the
 * probe must first be seen to count). Inside one task, in a frame class of its
 * own (`(control)`, kept out of every sum and every step's read):
 *
 * - **a throwaway effect released**: clearQuad's own WGSL (already in the shader
 *   store: the engine's clear quad compiled it at the boot) asked of
 *   `engine.createEffect` under a define of the control's own, so a NEW effect is
 *   compiled and cached, waited until ready, and disposed — Babylon's own path,
 *   `Effect.dispose` to `_releaseEffect` to `_deletePipelineContext` with its
 *   context, through `webgpuLeaks.ts`' wrapper. It must count 1 release, 1 with
 *   a context (through `webgpuLeaks.ts`' wrapper at a parent that has it).
 *   (The game's DEV counter of Babylon compiles WARNS on it, once:
 *   the control compiles on purpose, as `shaders.mjs` does, and nothing here
 *   reads that counter.)
 * - **one bind-group set made by the engine's own cache**: the engine's
 *   `_cacheBindGroups.getBindGroups` called once with a real draw context
 *   (`engine.createDrawContext`), a material context forcing creation
 *   (`forceBindGroupCreation`, which skips the cache's tree, so nothing is left
 *   in it) and a pipeline context stating no binding (so no layout is read and
 *   no GPU bind group made). It must count 1 call and 1 creation, and the
 *   device's `createBindGroup` none.
 *
 * Anything else fails the run (exit 1): the hooks are not where the engine
 * reaches them, and the counts after them grade nothing. **The control is also
 * the one place leak (1) still shows**: with `webgpuLeaks.ts` gone (X5.4b) its
 * released effect keeps its pipeline context's uniform buffer, so every read
 * from the baseline on holds ONE more live `GPUBuffer` than at a parent with
 * the file (measured alone: 142 live buffers at the menu, 143 after the
 * control's release; 142 and 142 at the parent) — the control's, not the
 * game's. **Otherwise it exits
 * 0 whatever it counts**: it records, and X5.4b grades. A lost device ends it
 * (`harness.mjs`, exit 4), and so does a hard limit (exit 3).
 */
import { bootMap, hardLimit, installRound, launchClient, MAP_IDS, root, startDevServer } from "./harness.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const MAP = args.find((a) => !a.startsWith("--")) ?? "coldharbour";
const THEN = opt("then", "hollowmere");
const FRAMES = Number(opt("frames", "600"));
const ROUNDS = Number(opt("rounds", "2"));
const SEED = 5101;
if (!MAP_IDS.includes(MAP) || !MAP_IDS.includes(THEN)) throw new Error(`a map of ${MAP_IDS.join(", ")}`);

hardLimit(1800);

/** In every page before the game's first line: the device's buffers and bind groups, counted. */
function deviceCounts() {
  const C = (window.__leakDev = { buffers: 0, destroyed: 0, bindGroups: 0, liveBytes: 0 });
  const D = window.GPUDevice?.prototype;
  if (!D) return;
  const dead = new WeakSet();
  const size = new WeakMap();
  const createBuffer = D.createBuffer;
  D.createBuffer = function (...a) {
    C.buffers++;
    const b = createBuffer.apply(this, a);
    const n = Number(a[0]?.size) || 0;
    size.set(b, n);
    C.liveBytes += n;
    return b;
  };
  const destroy = GPUBuffer.prototype.destroy;
  GPUBuffer.prototype.destroy = function (...a) {
    if (!dead.has(this)) {
      dead.add(this);
      C.destroyed++;
      C.liveBytes -= size.get(this) ?? 0;
    }
    return destroy.apply(this, a);
  };
  const createBindGroup = D.createBindGroup;
  D.createBindGroup = function (...a) {
    C.bindGroups++;
    return createBindGroup.apply(this, a);
  };
}

const vite = await startDevServer(root);
const browser = await launchClient({ headed: false });
const sep = vite.url.endsWith("/") ? "" : "/";
const { page, pageErrors, consoleErrors } = await bootMap(browser, `${vite.url}${sep}?seed=${SEED}`, MAP, { init: deviceCounts, hideUI: false });
page.on("dialog", (d) => void d.accept());
const cdp = await page.context().newCDPSession(page);
const frames = (n) =>
  page.evaluate(
    (n) =>
      new Promise((res) => {
        let k = 0;
        const off = window.__refFrame().onDrawn(() => {
          if (++k < n) return;
          off();
          res();
        });
      }),
    n,
  );
await frames(60);

// The hooks, at the baseline.
await page.evaluate(async () => {
  const g = window.__celshock;
  const url = performance.getEntriesByType("resource").map((e) => e.name).find((n) => /babylonjs_core/i.test(n));
  if (!url) throw new Error("leaks.mjs: Babylon's module is not among the page's resources");
  const B = await import(url);
  if (B.Vector3 !== g.cameraSys.camera.position.constructor) throw new Error("leaks.mjs: not the page's Babylon");
  const L = (window.__leaks = { cls: g.state, byClass: {}, cache: B.WebGPUCacheBindGroups });
  const bucket = () => (L.byClass[L.cls] ??= { deletes: 0, deletesWithContext: 0, cacheCreated: 0, cacheCalls: 0, frames: 0 });
  window.__refFrame().onBegin(() => {
    L.cls = g.state;
    bucket().frames++;
  });
  // Babylon's engine, the scene's (`Game.engine` at a parent).
  const e = g.scene.getEngine();
  const del = e._deletePipelineContext;
  e._deletePipelineContext = function (ctx, ...rest) {
    const b = bucket();
    b.deletes++;
    if (ctx) b.deletesWithContext++;
    return del.call(this, ctx, ...rest);
  };
  const Cache = B.WebGPUCacheBindGroups;
  const get = Cache.prototype.getBindGroups;
  Cache.prototype.getBindGroups = function (...a) {
    const before = Cache.NumBindGroupsCreatedTotal;
    bucket().cacheCalls++;
    const r = get.apply(this, a);
    const after = Cache.NumBindGroupsCreatedTotal;
    bucket().cacheCreated += after >= before ? after - before : after;
    return r;
  };
  // What the BOOT made, so a count of zero after it reads against a counter
  // that is live: Babylon's cache's own total at the baseline.
  return Cache.NumBindGroupsCreatedTotal;
}).then((n) => console.log(`at the baseline Babylon's cache had made ${n} bind groups (the boot's)`));

// THE POSITIVE CONTROL (the header): both hooks seen to count, in a class of
// their own, before anything is read.
const control = await page.evaluate(async () => {
  const g = window.__celshock;
  const L = window.__leaks;
  // Babylon's engine, the scene's: a `NullEngine` since X5.4h (the header).
  const e = g.scene.getEngine();
  if (!e.isWebGPU) return { skipped: e.constructor.name };
  const CONTROL = "(control)";
  const effect = e.createEffect("clearQuad", [], ["color", "depthValue"], undefined, "#define LEAKS_MJS_CONTROL\n", undefined, undefined, undefined, undefined, 1 /* ShaderLanguage.WGSL */);
  for (let frames = 0; !effect.isReady(); frames++) {
    if (frames > 600) return { error: `the control's effect never became ready (${effect.getCompilationError?.() ?? "no error said"})` };
    await window.__refFrame().drawn();
  }
  const devBefore = window.__leakDev.bindGroups;
  L.cls = CONTROL;
  try {
    effect.dispose();
    const draw = e.createDrawContext();
    const material = e.createMaterialContext();
    material.forceBindGroupCreation = true;
    const stated = { shaderProcessingContext: { bufferNames: [], samplerNames: [], textureNames: [], bindGroupLayoutEntries: [] }, bindGroupLayouts: [] };
    e._cacheBindGroups.getBindGroups(stated, draw, material);
  } finally {
    L.cls = g.state;
  }
  const b = L.byClass[CONTROL] ?? { deletes: 0, deletesWithContext: 0, cacheCreated: 0, cacheCalls: 0 };
  return { deletes: b.deletes, deletesWithContext: b.deletesWithContext, cacheCalls: b.cacheCalls, cacheCreated: b.cacheCreated, deviceBindGroups: window.__leakDev.bindGroups - devBefore };
});
const controlHeld = Boolean(control.skipped) || (!control.error && control.deletes === 1 && control.deletesWithContext === 1 && control.cacheCalls === 1 && control.cacheCreated === 1 && control.deviceBindGroups === 0);
console.log(
  control.skipped
    ? `the positive control is SKIPPED: Babylon's engine is a ${control.skipped}, no WebGPU backend to release an effect or fill a cache (X5.4h)`
    : control.error
    ? `the positive control FAILED: ${control.error}`
    : `the positive control: an effect released, ${control.deletes} pipeline context${control.deletes === 1 ? "" : "s"} deleted (${control.deletesWithContext} with a context); the engine's cache asked ${control.cacheCalls} time${control.cacheCalls === 1 ? "" : "s"}, ${control.cacheCreated} bind-group set made, the device's createBindGroup ${control.deviceBindGroups} — ${controlHeld ? "both hooks count" : "FAILED (1, 1, 1, 1 and 0 wanted)"}`,
);
await page.evaluate(() => (window.__leaks.dev0 = { ...window.__leakDev }));

const reads = [];
const read = async (step) => {
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("HeapProfiler.collectGarbage");
  const heap = await cdp.send("Runtime.getHeapUsage");
  const r = await page.evaluate((step) => {
    const L = window.__leaks;
    const d = window.__leakDev;
    const steps = Object.entries(L.byClass).filter(([c]) => c !== "(control)").map(([, b]) => b);
    const sum = (k) => steps.reduce((a, b) => a + b[k], 0);
    return {
      step,
      state: window.__celshock.state,
      deletes: sum("deletes"),
      deletesWithContext: sum("deletesWithContext"),
      cacheCreated: sum("cacheCreated"),
      deviceBindGroups: d.bindGroups - L.dev0.bindGroups,
      liveBuffers: d.buffers - d.destroyed,
      liveBufferMB: +(d.liveBytes / 1048576).toFixed(1),
      byClass: JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(L.byClass).filter(([c]) => c !== "(control)")))),
    };
  }, step);
  r.heapMB = +(heap.usedSize / 1048576).toFixed(1);
  reads.push(r);
  console.log(
    `${step.padEnd(30)} ${r.state.padEnd(9)} deletes ${r.deletes} (with a context ${r.deletesWithContext}), Babylon's cache made ${r.cacheCreated} bind groups, the device ${r.deviceBindGroups}; live buffers ${r.liveBuffers} (${r.liveBufferMB} MB), heap ${r.heapMB} MB`,
  );
};
const life = async () => {
  await page.evaluate(() => window.__celshock.spawnPlayer());
  await page.waitForFunction(() => window.__celshock.state === "playing", null, { timeout: 60_000 });
  await frames(FRAMES);
};
const toMenu = async () => {
  await page.evaluate(() => window.__celshock.enterMenu());
  await frames(60);
};

console.log(`leaks.mjs: ${MAP} ${ROUNDS} rounds, then ${THEN}; ${FRAMES} frames a life; seed ${SEED}`);
await read("baseline (the menu at boot)");
for (let n = 1; n <= ROUNDS; n++) {
  await installRound(page);
  await frames(30);
  await read(`round ${n}: deploy`);
  await life();
  await read(`round ${n}: a life`);
  await toMenu();
  await read(`round ${n}: torn down`);
}
await page.evaluate((i) => window.__celshock.setMap(i), MAP_IDS.indexOf(THEN));
await frames(30);
await read(`the map changed to ${THEN}`);
await installRound(page);
await frames(30);
await life();
await read(`${THEN}: a life`);
await toMenu();
await read(`${THEN}: torn down`);

const last = reads[reads.length - 1];
console.log(`\nafter the boot: ${last.deletes} pipeline contexts released, ${last.cacheCreated} bind groups made by Babylon's cache`);
for (const [c, b] of Object.entries(last.byClass)) console.log(`  ${c.padEnd(10)} ${b.frames} frames: ${b.deletes} released (${b.deletesWithContext} with a context), ${b.cacheCreated} cached bind groups made in ${b.cacheCalls} asks of the cache`);
if (pageErrors.length || consoleErrors.length) {
  console.log(`${pageErrors.length} page errors, ${consoleErrors.length} console errors`);
  for (const e of [...pageErrors, ...consoleErrors].slice(0, 5)) console.log(`  ${String(e).slice(0, 300)}`);
}
await browser.close();
vite.stop();
process.exit(controlHeld ? 0 : 1);
