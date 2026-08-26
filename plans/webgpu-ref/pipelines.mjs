/**
 * Counts WebGPU shader modules and render pipelines against the frame clock,
 * which is how you tell a slow map from a map that is still compiling.
 *
 * Run with `node plans/webgpu-ref/pipelines.mjs [map] [--seconds N]`.
 *
 * **This is the replacement for the WebGL2 debug hook `VERIFYING.md` used to
 * describe.** That one patched `WebGL2RenderingContext.prototype.shaderSource`
 * to catch shader text on its way to the driver. The WebGPU equivalent is
 * `GPUDevice.prototype.createShaderModule` in an `addInitScript`, and it is
 * strictly better: hold `descriptor.code` and the module's own
 * `getCompilationInfo()` hands back `{lineNum, linePos, message}` against the
 * source you are holding.
 *
 * **What it was written to settle is a number that looked like a bug.**
 * Coldharbour measured 16 fps on a machine where Hollowmere measured 103, and
 * finding 12 says the gap should be about 25%. It is not a gap: 42 shader
 * modules and 25 render pipelines are created in the FIRST SECOND after the
 * player spawns, that second runs at 9 fps, the second runs at 33, and by the
 * third the round is flat at ~49 and creates nothing further. The map was
 * never slow; the instrument was pointed at the compiler.
 *
 * **The cost does NOT show up in the call it comes from, and that is the trap
 * this file exists to keep someone out of.** Summed across a whole round,
 * `createRenderPipeline` accounts for 0.7 ms — near enough to nothing. Dawn
 * compiles behind the call and the stall lands on first USE, so timing the
 * creation functions proves only that they were called. Read the `+pipelines`
 * column against the `fps` column beside it; the correlation is the evidence,
 * and the `ms` column is there to show you it is not the explanation.
 */
import {
  bootMap,
  launchClient,
  startDevServer,
  root,
} from "./harness.mjs";

const args = process.argv.slice(2);
const MAP = args.find((a) => !a.startsWith("--")) ?? "coldharbour";
const secondsArg = args.indexOf("--seconds");
const SECONDS = secondsArg >= 0 ? Number(args[secondsArg + 1]) : 16;

const vite = await startDevServer(root);
const { chromium } = await import("playwright");
// Uncapped, because the point is what the frame rate does over the first few
// seconds and a limiter flattens exactly the recovery being measured.
const browser = await chromium.launch({
  headless: true,
  channel: "chromium",
  args: ["--enable-unsafe-webgpu", "--disable-frame-rate-limit", "--disable-gpu-vsync"],
});

const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.addInitScript((mapId) => {
  window.localStorage.setItem("greywatch.map", mapId);
  window.__gpuLog = { modules: [], pipelines: [], moduleMs: 0, pipelineMs: 0 };
  const proto = window.GPUDevice?.prototype;
  if (!proto) return;
  for (const [name, bucket] of [
    ["createShaderModule", "modules"],
    ["createRenderPipeline", "pipelines"],
    ["createComputePipeline", "pipelines"],
  ]) {
    const orig = proto[name];
    if (!orig) continue;
    proto[name] = function patched(...a) {
      const t0 = performance.now();
      const result = orig.apply(this, a);
      const dt = performance.now() - t0;
      window.__gpuLog[bucket].push({ t: +t0.toFixed(1), ms: +dt.toFixed(2) });
      if (bucket === "pipelines") window.__gpuLog.pipelineMs += dt;
      else window.__gpuLog.moduleMs += dt;
      return result;
    };
  }
}, MAP);
await page.goto(vite.url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => Boolean(window.__celshock), null, { timeout: 180_000 });

const out = await page.evaluate(async (seconds) => {
  const g = window.__celshock;
  const L = window.__gpuLog;
  const atBoot = { modules: L.modules.length, pipelines: L.pipelines.length };
  g.startRound();
  await new Promise((res) => {
    const poll = () => (g.state === "deploy" ? res() : setTimeout(poll, 10));
    poll();
  });
  const atInstall = { modules: L.modules.length, pipelines: L.pipelines.length };
  g.spawnPlayer();
  const buckets = [];
  for (let s = 0; s < seconds; s++) {
    const f = g.scene.getFrameId();
    const m = L.modules.length;
    const p = L.pipelines.length;
    const pm = L.pipelineMs;
    await new Promise((res) => setTimeout(res, 1000));
    buckets.push({
      sec: s + 1,
      fps: g.scene.getFrameId() - f,
      newModules: L.modules.length - m,
      newPipelines: L.pipelines.length - p,
      pipelineMs: +(L.pipelineMs - pm).toFixed(1),
    });
  }
  return {
    atBoot,
    atInstall,
    totals: {
      modules: L.modules.length,
      pipelines: L.pipelines.length,
      moduleMs: +L.moduleMs.toFixed(1),
      pipelineMs: +L.pipelineMs.toFixed(1),
    },
    buckets,
  };
}, SECONDS);

console.log(`map ${MAP}`);
console.log(`  at boot:    ${JSON.stringify(out.atBoot)}`);
console.log(`  at install: ${JSON.stringify(out.atInstall)}`);
console.log(`  totals:     ${JSON.stringify(out.totals)}`);
console.log("\nsec   fps  +modules  +pipelines  pipelineMs");
for (const b of out.buckets) {
  console.log(
    `${String(b.sec).padStart(3)} ${String(b.fps).padStart(5)} ` +
      `${String(b.newModules).padStart(9)} ${String(b.newPipelines).padStart(11)} ` +
      `${String(b.pipelineMs).padStart(11)}`,
  );
}
await browser.close();
vite.stop();
