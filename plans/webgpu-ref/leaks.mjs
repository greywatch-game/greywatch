/**
 * The BABYLON-LEAK probe (`BABYLON_EXIT.md` X5.4a: X5.4b's proof for
 * `src/core/webgpuLeaks.ts`). That file patches the two things Babylon's WebGPU
 * backend never gives back — a released effect's pipeline context, which
 * `_deletePipelineContext` on WebGPU never disposes, and the bind-group cache
 * (`WebGPUCacheBindGroups`), which is never pruned — and both bite only while
 * Babylon still RELEASES effects and still MAKES bind groups. Since X5.3d no
 * Babylon material compiles in any state and since X5.2d no Babylon pass draws,
 * so the question X5.4b asks is whether either still happens at all after the
 * boot; this counts both, and nothing else changes.
 *
 * ```
 * node plans/webgpu-ref/leaks.mjs [map] [--then=<map>] [--frames=600]
 * ```
 *
 * One page (Coldharbour by default, the map `webgpuLeaks.ts`' header measured),
 * the round's seed pinned: the boot settled at the menu (the BASELINE: whatever
 * the boot made is the boot's), then two rounds — each installed, a life of
 * `--frames` frames in play, and torn down to the menu — then a MAP CHANGE (to
 * `--then`, Hollowmere by default, through `Game.setMap` as the menu does it), a
 * round there and its teardown. At the end of each step, read after a forced GC
 * (the DevTools protocol's `HeapProfiler.collectGarbage`), and per frame class
 * (the game's state at the frame adapter's begin):
 *
 * - every call of the engine's `_deletePipelineContext` since the baseline (the
 *   method `webgpuLeaks.ts` wraps; counted on the engine, outside that wrapper,
 *   so its own dispose is not counted twice) and whether it was handed a context;
 * - every bind group Babylon's cache CREATED since the baseline
 *   (`WebGPUCacheBindGroups.NumBindGroupsCreatedTotal` read across every
 *   `getBindGroups`, so the cache's own reset at a teardown, `forgetBindGroups`,
 *   does not hide one), and every `GPUDevice.createBindGroup` beside it, ours
 *   and Babylon's together;
 * - the live `GPUBuffer`s (made less destroyed, off the device) and the JS heap
 *   used (`Runtime.getHeapUsage`) — `webgpuLeaks.ts`' own measurement, which
 *   X5.4b repeats over four Coldharbour rounds before it deletes the file.
 *
 * Exits 0 whatever it counts: it records, and X5.4b grades. A lost device ends
 * it (`harness.mjs`, exit 4), and so does a hard limit (exit 3).
 */
import { bootMap, hardLimit, installRound, launchClient, MAP_IDS, root, startDevServer } from "./harness.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const MAP = args.find((a) => !a.startsWith("--")) ?? "coldharbour";
const THEN = opt("then", "hollowmere");
const FRAMES = Number(opt("frames", "600"));
const SEED = 5101;
if (!MAP_IDS.includes(MAP) || !MAP_IDS.includes(THEN)) throw new Error(`a map of ${MAP_IDS.join(", ")}`);

hardLimit(1800);

/** In every page before the game's first line: the device's buffers and bind groups, counted. */
function deviceCounts() {
  const C = (window.__leakDev = { buffers: 0, destroyed: 0, bindGroups: 0 });
  const D = window.GPUDevice?.prototype;
  if (!D) return;
  const dead = new WeakSet();
  const createBuffer = D.createBuffer;
  D.createBuffer = function (...a) {
    C.buffers++;
    return createBuffer.apply(this, a);
  };
  const destroy = GPUBuffer.prototype.destroy;
  GPUBuffer.prototype.destroy = function (...a) {
    if (!dead.has(this)) {
      dead.add(this);
      C.destroyed++;
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
  const e = g.engine;
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
  L.dev0 = { ...window.__leakDev };
  // What the BOOT made, so a count of zero after it reads against a counter
  // that is live: Babylon's cache's own total at the baseline.
  return Cache.NumBindGroupsCreatedTotal;
}).then((n) => console.log(`at the baseline Babylon's cache had made ${n} bind groups (the boot's)`));

const reads = [];
const read = async (step) => {
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("HeapProfiler.collectGarbage");
  const heap = await cdp.send("Runtime.getHeapUsage");
  const r = await page.evaluate((step) => {
    const L = window.__leaks;
    const d = window.__leakDev;
    const sum = (k) => Object.values(L.byClass).reduce((a, b) => a + b[k], 0);
    return {
      step,
      state: window.__celshock.state,
      deletes: sum("deletes"),
      deletesWithContext: sum("deletesWithContext"),
      cacheCreated: sum("cacheCreated"),
      deviceBindGroups: d.bindGroups - L.dev0.bindGroups,
      liveBuffers: d.buffers - d.destroyed,
      byClass: JSON.parse(JSON.stringify(L.byClass)),
    };
  }, step);
  r.heapMB = +(heap.usedSize / 1048576).toFixed(1);
  reads.push(r);
  console.log(
    `${step.padEnd(30)} ${r.state.padEnd(9)} deletes ${r.deletes} (with a context ${r.deletesWithContext}), Babylon's cache made ${r.cacheCreated} bind groups, the device ${r.deviceBindGroups}; live buffers ${r.liveBuffers}, heap ${r.heapMB} MB`,
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

console.log(`leaks.mjs: ${MAP}, then ${THEN}; ${FRAMES} frames a life; seed ${SEED}`);
await read("baseline (the menu at boot)");
for (const n of [1, 2]) {
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
process.exit(0);
