/**
 * The engine-level gate: boots every shipped map on the real backend, plays a
 * real round on each, and fails loudly if any of them is not clean.
 *
 * Run with `node plans/webgpu-ref/gate.mjs [map...]`, `--headed` to watch it,
 * `--uncap` to take the frame limiter off before quoting a frame rate. It
 * exits non-zero when an assertion fails, so it can stand in front of a merge.
 *
 * **What this gate is FOR is the engine and not the picture.** Whether the
 * frame is CORRECT is `bank.mjs`'s question, answered by diffing; whether the
 * frame HAPPENS, costs what it should, and does so without a page error or a
 * WebGPU validation complaint is this one. The two are separate because they
 * fail separately: a shader regression draws a wrong picture at full speed,
 * and a backend regression draws nothing at all.
 *
 * **The frame rate is reported COLD and WARM and the pair is the point.**
 * WebGPU compiles pipelines lazily, so the first seconds of a round are the
 * compiler rather than the game: measured on Coldharbour, 42 shader modules
 * and 25 render pipelines are created in the first second, which runs at 9 fps
 * against the ~46 the same round settles at by the third. A single number
 * taken over the first five seconds is neither of those and is the reading
 * that made a healthy Coldharbour look like a port bug. Quote `warmFps`, and
 * treat a `coldFps` that does not recover as the finding.
 *
 * **`--uncap` is not cosmetic and it is not the default.** Without it Chromium
 * holds the render loop near the display's rate and Hollowmere reads 103 fps
 * because that is the ceiling rather than the cost. With it the same round
 * reads 132. The uncapped number is the one worth writing down; the capped one
 * is the one that resembles what a player sees, so the flag is a choice the
 * caller makes rather than one this file makes for them.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAP_IDS,
  bootMap,
  installRound,
  launchClient,
  startDevServer,
  waitUntilDrawn,
  root,
} from "./harness.mjs";

const args = process.argv.slice(2);
const HEADED = args.includes("--headed");
const UNCAP = args.includes("--uncap");
const maps = args.filter((a) => !a.startsWith("--"));
const targets = maps.length ? maps : MAP_IDS;

/** Long enough to be past the compile stall on the slowest shipped map. */
const WARMUP_MS = 10_000;
/** The window each figure is averaged over. */
const COLD_MS = 5_000;
const WARM_MS = 8_000;

const vite = await startDevServer(root);
// The limiter is a LAUNCH argument and not a page setting, so `--uncap` is a
// differently-launched browser rather than a flag passed later. It is the one
// place a script here does not go through `launchClient`, and it still carries
// that function's two facts — the channel and the flag — because dropping
// either one is a browser with no adapter at all.
const browser = UNCAP
  ? await (await import("playwright")).chromium.launch({
      headless: !HEADED,
      channel: "chromium",
      args: [
        "--enable-unsafe-webgpu",
        "--disable-frame-rate-limit",
        "--disable-gpu-vsync",
      ],
    })
  : await launchClient({ headed: HEADED });

console.log(
  `gate: ${HEADED ? "headed" : "headless"}${UNCAP ? ", uncapped" : ""} @ ${vite.url}\n`,
);
console.log(
  "map           boot  install  bake1  drawnOn  coldFps  warmFps  medMs  p95ms  probes  fail",
);

const rows = [];
const failures = [];
for (const id of targets) {
  const { page, bootMs, pageErrors, consoleErrors } = await bootMap(
    browser,
    vite.url,
    id,
  );
  const build = await installRound(page);
  const { drawnOnFrame } = await waitUntilDrawn(page);

  const perf = await page.evaluate(
    async ([coldMs, warmupMs, warmMs]) => {
      const g = window.__celshock;
      g.spawnPlayer();
      const window_ = async (ms) => {
        const f0 = g.scene.getFrameId();
        const t0 = performance.now();
        await new Promise((res) => setTimeout(res, ms));
        return +((g.scene.getFrameId() - f0) / ((performance.now() - t0) / 1000)).toFixed(1);
      };
      const coldFps = await window_(coldMs);
      await new Promise((res) => setTimeout(res, warmupMs));
      // Per-frame times, so what comes out is milliseconds and not a ratio.
      const times = [];
      let last = performance.now();
      const o = g.scene.onAfterRenderObservable.add(() => {
        const now = performance.now();
        times.push(now - last);
        last = now;
      });
      const warmFps = await window_(warmMs);
      g.scene.onAfterRenderObservable.remove(o);
      times.sort((a, b) => a - b);
      return {
        coldFps,
        warmFps,
        medianMs: +times[Math.floor(times.length / 2)].toFixed(2),
        p95Ms: +times[Math.floor(times.length * 0.95)].toFixed(2),
        state: g.state,
        bots: g.battle.bots.length,
        activeMeshes: g.scene.getActiveMeshes().length,
        isWebGPU: !!g.engine.isWebGPU,
        engine: g.engine.constructor.name,
      };
    },
    [COLD_MS, WARMUP_MS, WARM_MS],
  );

  // The assertions. Each one is a way the backend can be broken while the
  // typecheck passes and the map still looks like it loaded.
  const fails = [];
  if (!perf.isWebGPU) fails.push("engine is not WebGPU");
  if (perf.state !== "playing") fails.push(`state is ${perf.state}, not playing`);
  if (!build.probesRenderOnce) fails.push("a reflection probe is re-rendering every frame");
  if (pageErrors.length) fails.push(`${pageErrors.length} page errors`);
  if (consoleErrors.length) fails.push(`${consoleErrors.length} console errors`);
  if (perf.warmFps < 20) fails.push(`warm frame rate ${perf.warmFps} fps`);

  rows.push({ id, bootMs, ...build, drawnOnFrame, ...perf, pageErrors, consoleErrors, fails });
  if (fails.length) failures.push(`${id}: ${fails.join("; ")}`);
  console.log(
    `${id.padEnd(12)} ${String(bootMs).padStart(5)} ${String(build.installMs).padStart(8)} ` +
      `${String(build.bakeFrameMs).padStart(6)} ${String(drawnOnFrame).padStart(8)} ` +
      `${String(perf.coldFps).padStart(8)} ${String(perf.warmFps).padStart(8)} ` +
      `${String(perf.medianMs).padStart(6)} ${String(perf.p95Ms).padStart(6)} ` +
      `${String(build.probes).padStart(7)}  ${fails.length ? "FAIL" : "ok"}`,
  );
  for (const e of [...pageErrors.slice(0, 3), ...consoleErrors.slice(0, 3)]) {
    console.log(`   ! ${e.slice(0, 200)}`);
  }
  await page.close();
}

writeFileSync(
  join(root, "plans", "webgpu-ref", "gate.json"),
  JSON.stringify({ headed: HEADED, uncapped: UNCAP, rows }, null, 2),
);
await browser.close();
vite.stop();

if (failures.length) {
  console.log(`\n${failures.length} map(s) failed:`);
  for (const f of failures) console.log(`  ${f}`);
  process.exit(1);
}
console.log(`\nall ${targets.length} maps clean`);
