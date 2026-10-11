/**
 * The benchmark's desktop wrapper: plays `?bench=<map>` N times per map in one
 * browser and reports what the runs agree on (`BABYLON_EXIT.md` X0.3).
 *
 *   node plans/webgpu-ref/bench.mjs [map...] [--runs 3] [--capped] [--headed]
 *        [--gpu] [--max] [--size 3440x1440] [--url http://host:port]
 *        [--query simcopy&simcheck] [--out f.json] [--against f.json]
 *
 * **`--query` is appended to every run's URL** after the `?bench=<map>` —
 * the page's own switches: `simcopy` (every command, frame and drain
 * through `structuredClone`, whose fight must hash the same) and, against a
 * DEV server (no `--url`), `simcheck` (every reader held against the live
 * core; each mismatch is a console error, so a run with any says so).
 *
 * **`--max` is every graphics setting at its top rung** (`MAX_SETTINGS`),
 * written into the page's settings store before it boots, which is the
 * desktop's half of `BABYLON_EXIT.md` X0.4's "before". Without it a run gets
 * a fresh context's DEFAULTS, which are chosen per device and are not the
 * top of any ladder. Either way the capture states what was in force
 * (`graphics`), and that is what to quote.
 *
 * **The benchmark is the PAGE's, and this file only drives it from outside.**
 * Everything a run is — the vantages, the path, the seeded fight at a fixed
 * step, the labelled capture at the end — is `src/bench/BenchScript.ts` and
 * `Game.updateBench`, which is what lets a phone run it with nothing but the
 * URL. This opens the URL, waits for `window.__profile.last()` to come back
 * with `reason` `bench`, and reads the report. It does not touch the game.
 *
 * **What it reports, and what it refuses**:
 *
 * - Per map and per GROUP (`vantages`, `path`, `fight`): the median over the
 *   runs of the wall-clock mean, p95 and 1% low, and the SPREAD — the largest
 *   run minus the smallest, over the median, of the mean. `PERF_PLAN.md`'s
 *   protocol reads nothing under ~8% as real, so a spread over 8% is flagged:
 *   that session cannot resolve a lever at that segment.
 * - The FIGHT's hash on every run, and a run whose hash differs from the
 *   first is a failure, not noise: it fought a different fight, and its
 *   `fight` segment measured a different workload.
 * - The simulation core's own timing of its step in each group (`sim`,
 *   report version 14) and, for the fight, its phases — and (version 15)
 *   the PAGE's half of the hop, `wait` and `sync`, beside them. Each run's
 *   line says which thread the core stepped on (`sim worker` or `sim page`,
 *   `BABYLON_EXIT.md` X2.5b); `--query simpage` asks for the page.
 * - `install`, from the URL to the first bench frame — `VERIFYING.md`'s free
 *   control: when the installs differ, the frame rates are not comparable.
 * - `--against f.json` (a previous `--out`): each group's median mean as a
 *   ratio, new over old. Under 1 is faster. Read it only against two runs
 *   taken in ONE session; across sessions this box has swung 45%
 *   (`VERIFYING.md`).
 *
 * **`--size` is the viewport, and it is part of the workload** — 3440x1440 by
 * default, which is the Windows box's own display, and a lever priced at the
 * wrong size has been priced wrong before (`VERIFYING.md`). It is also the
 * size at which the runs AGREE: at the bank's 1920x1080 a frame here is ~2.5 ms,
 * the browser's pacing jitter is a tenth of it, and one vantage's hold moved
 * 23% between three runs while every segment at 3440x1440 stayed within 4%.
 * A run says its size in every capture (`device.backingStore`).
 *
 * **Uncapped by default**, the opposite of `gate.mjs`, because a benchmark
 * that the display's rate holds at a ceiling reports the ceiling: every run
 * agrees and none of them says anything. `--capped` is the player's frame.
 * Uncapping fabricates the collector's rate (`docs/profiling.md`), so read no
 * GC figure out of an uncapped run.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { MAP_IDS, launchClient, root, startDevServer } from "./harness.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};
const HEADED = flag("--headed");
const CAPPED = flag("--capped");
const GPU = flag("--gpu");
const MAX = flag("--max");
/**
 * `--max`: the top rung of every ladder in `src/core/settings.ts`, keyed as
 * that file stores them (`greywatch.setting.` plus the field, or its
 * `STORED_AS` alias — `paperGrain` is `filmGrain`) and written as its codecs
 * write them. A key or a value the build does not know is silently the
 * default there, which is why every run checks `graphics` against this.
 * `fpsCap` 0 is uncapped, which `--capped` still limits at the browser.
 */
const MAX_SETTINGS = {
  renderScale: 1,
  fpsCap: 0,
  volumetrics: "high",
  gi: "high",
  shadows: "high",
  grass: "high",
  foliage: "high",
  glow: "high",
  groundRelief: true,
  motionBlur: true,
  paperGrain: true,
  fxaa: true,
};
const STORED_AS = { paperGrain: "filmGrain" };
const RUNS = Math.max(1, Number(value("--runs", "3")));
const URL_ARG = value("--url", null);
const OUT = value("--out", null);
const [VW, VH] = value("--size", "3440x1440").split("x").map(Number);
const AGAINST = value("--against", null);
const QUERY = value("--query", null);
const valued = new Set(["--runs", "--url", "--out", "--against", "--size", "--query"]);
const maps = args.filter((a, i) => !a.startsWith("--") && !valued.has(args[i - 1]));
const targets = maps.length ? maps : MAP_IDS;
/** A run that has not ended in this long is stuck, not slow. */
const RUN_TIMEOUT_MS = 40 * 60_000;
/** The spread over which a session is flagged — the protocol's floor. */
const SPREAD_FLAG = 0.08;
const GROUPS = ["vantages", "path", "fight"];

const vite = URL_ARG ? null : await startDevServer(root);
const url = URL_ARG ?? vite.url;
// The limiter is a LAUNCH argument (`gate.mjs` says why this is the one place
// a script here does not go through `launchClient`), and it still carries that
// function's two facts — the channel and the flag.
const browser = CAPPED
  ? await launchClient({ headed: HEADED })
  : await (await import("playwright")).chromium.launch({
      headless: !HEADED,
      channel: "chromium",
      args: ["--enable-unsafe-webgpu", "--disable-frame-rate-limit", "--disable-gpu-vsync"],
    });
console.log(
  `bench: ${HEADED ? "headed" : "headless"}, ${CAPPED ? "capped" : "uncapped"}` +
    `${GPU ? ", ?gpu" : ""}${MAX ? ", max settings" : ", default settings"}, ${VW}x${VH} @ ${url} — ${RUNS} run${RUNS > 1 ? "s" : ""} a map\n`,
);

const results = {};
const failures = [];
for (const id of targets) {
  const runs = [];
  for (let r = 0; r < RUNS; r++) {
    const run = await benchOnce(id);
    runs.push(run);
    const g = Object.fromEntries(run.groups.map((s) => [s.name, s]));
    console.log(
      `${id.padEnd(12)} run ${r + 1}  install ${String(run.installMs).padStart(6)} ms  ` +
        GROUPS.map((k) =>
          g[k] ? `${k} ${g[k].fps.toFixed(1)} fps p95 ${g[k].p95.toFixed(1)}` : `${k} -`,
        ).join("  ") +
        `  fight ${run.bench?.fight.hash ?? "?"}` +
        `  sim ${run.simMode ?? "?"}` +
        (run.simcheck ? `  simcheck ${run.simcheck.checks} passes ${run.simcheck.mismatches} mismatches` : "") +
        (run.errors.length ? `  ! ${run.errors.length} errors` : ""),
    );
    for (const e of run.errors.slice(0, 3)) console.log(`   ! ${e.slice(0, 200)}`);
  }
  results[id] = summarise(id, runs);
}

console.log("\nmedians over the runs (mean / p95 / 1% low in ms, spread of the mean)");
console.log("map           group      frames    mean     p95  1%low   tick    sim  draws  spread");
for (const id of targets) {
  const s = results[id];
  for (const k of GROUPS) {
    const g = s.groups[k];
    if (!g) continue;
    console.log(
      `${id.padEnd(13)} ${k.padEnd(9)} ${String(g.frames).padStart(7)} ` +
        `${g.mean.toFixed(2).padStart(7)} ${g.p95.toFixed(2).padStart(7)} ` +
        `${g.onePercentLow.toFixed(1).padStart(6)} ${g.tick.toFixed(2).padStart(6)} ` +
        `${(g.sim === null ? "-" : g.sim.toFixed(2)).padStart(6)} ` +
        `${String(g.drawCalls).padStart(6)}  ${(g.spread * 100).toFixed(1).padStart(5)}%` +
        (g.spread > SPREAD_FLAG ? "  OVER 8%" : ""),
    );
  }
}

// The simulation core's own timing of its step (report version 14, the
// `sim` span and its children), over the fight's stepped frames — medians
// over the runs, in ms per frame. A capture older than v14 has none.
const simRows = targets.filter((id) => results[id].groups.fight?.simPhases);
if (simRows.length) {
  const kids = Object.keys(results[simRows[0]].groups.fight.simPhases);
  console.log("\nthe core's step in the fight (median ms per stepped frame)");
  console.log(
    `map              sim ${kids.map((k) => k.replace(/^sim/, "").padStart(10)).join("")}` +
      "      wait      sync   (the page's half of the hop, X2.5b)",
  );
  for (const id of simRows) {
    const f = results[id].groups.fight;
    console.log(
      `${id.padEnd(13)} ${f.sim.toFixed(3).padStart(6)} ` +
        kids.map((k) => (f.simPhases[k] ?? 0).toFixed(3).padStart(10)).join("") +
        (f.hop ? `${f.hop.wait.toFixed(3).padStart(10)}${f.hop.sync.toFixed(3).padStart(10)}` : ""),
    );
  }
}

console.log("\nthe worst SEGMENT per map (every vantage's hold, the path, the fight)");
for (const id of targets) {
  const segs = Object.entries(results[id].segments);
  if (!segs.length) continue;
  const [name, worst] = segs.sort((a, b) => b[1].spread - a[1].spread)[0];
  const over = segs.filter(([, v]) => v.spread > SPREAD_FLAG).map(([k]) => k);
  console.log(
    `${id.padEnd(13)} ${name.padEnd(22)} ${(worst.spread * 100).toFixed(1).padStart(5)}%` +
      (over.length ? `  OVER 8%: ${over.join(", ")}` : "  all within 8%"),
  );
}

if (AGAINST) {
  const old = JSON.parse(readFileSync(AGAINST, "utf8"));
  console.log(`\nagainst ${AGAINST} — median mean, new / old (under 1 is faster)`);
  for (const id of targets) {
    for (const k of GROUPS) {
      const a = results[id]?.groups[k];
      const b = old.results?.[id]?.groups?.[k];
      if (!a || !b) continue;
      console.log(`${id.padEnd(13)} ${k.padEnd(9)} ${(a.mean / b.mean).toFixed(3)}`);
    }
  }
}

if (OUT) {
  writeFileSync(
    OUT,
    JSON.stringify(
      { headed: HEADED, capped: CAPPED, gpu: GPU, size: `${VW}x${VH}`, runs: RUNS, results },
      null,
      1,
    ),
  );
  console.log(`\nwrote ${OUT}`);
}
await browser.close();
vite?.stop();

if (failures.length) {
  console.log(`\n${failures.length} failure(s):`);
  for (const f of failures) console.log(`  ${f}`);
  process.exit(1);
}
console.log("\nall runs completed, every map fought one fight");

/**
 * One run on a fresh page: the URL, then the capture. A fresh CONTEXT per run
 * (Playwright's `newPage` on a browser makes one), so no run inherits another's
 * stored settings or the hand-off key.
 */
async function benchOnce(id) {
  const page = await browser.newPage({ viewport: { width: VW, height: VH } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  if (MAX) {
    const stored = Object.entries(MAX_SETTINGS).map(([k, v]) => [
      `greywatch.setting.${STORED_AS[k] ?? k}`,
      typeof v === "boolean" ? (v ? "1" : "0") : String(v),
    ]);
    await page.addInitScript((rows) => {
      for (const [k, v] of rows) window.localStorage.setItem(k, v);
    }, stored);
  }
  const t0 = Date.now();
  await page.goto(`${url}/?bench=${id}${GPU ? "&gpu" : ""}${QUERY ? `&${QUERY}` : ""}`);
  await page.waitForFunction(() => window.__celshock?.state === "bench", null, {
    timeout: RUN_TIMEOUT_MS,
  });
  const installMs = Date.now() - t0;
  await page.waitForFunction(
    () => (window.__profile?.last()?.reason ?? "").startsWith("bench"),
    null,
    { timeout: RUN_TIMEOUT_MS, polling: 2000 },
  );
  // The summary only: the full report's series are megabytes a run, and every
  // figure this compares is already aggregated in the page.
  const report = await page.evaluate(() => {
    const r = window.__profile.last();
    return {
      reason: r.reason,
      version: r.version,
      seed: r.seed,
      simMode: r.simMode ?? null,
      bench: r.bench,
      device: r.device,
      graphics: r.graphics,
      window: r.window,
      frame: r.frame,
      gpu: r.gpu,
      groups: r.segments?.groups ?? [],
      list: r.segments?.list ?? [],
      // `?simcheck`'s tally (DEV): passes run, mismatches, the first by name.
      simcheck: window.__simcheck
        ? { checks: window.__simcheck.checks, mismatches: window.__simcheck.mismatches, first: window.__simcheck.first.slice(0, 4) }
        : null,
    };
  });
  await page.close();
  return { installMs, errors, ...report };
}

/** Medians and spreads over one map's runs, and the failures they show. */
function summarise(id, runs) {
  const hashes = runs.map((r) => r.bench?.fight.hash ?? "none");
  if (hashes.some((h) => h !== hashes[0])) {
    failures.push(`${id}: the runs fought different fights (${hashes.join(", ")})`);
  }
  runs.forEach((r, i) => {
    if (r.reason !== "bench" || !r.bench?.completed) {
      failures.push(`${id} run ${i + 1}: ended as "${r.reason}"`);
    }
    if (r.errors.length) failures.push(`${id} run ${i + 1}: ${r.errors.length} page/console errors`);
    if (MAX) {
      const off = Object.entries(MAX_SETTINGS)
        .filter(([k, v]) => r.graphics?.[k] !== v)
        .map(([k, v]) => `${k} ${r.graphics?.[k]} (asked ${v})`);
      if (off.length) failures.push(`${id} run ${i + 1}: not at max — ${off.join(", ")}`);
    }
  });
  const groups = {};
  for (const k of GROUPS) {
    const per = runs.map((r) => r.groups.find((g) => g.name === k)).filter(Boolean);
    if (per.length === 0) continue;
    const med = (f) => median(per.map(f));
    const means = per.map((g) => g.mean);
    groups[k] = {
      frames: per[0].frames,
      mean: med((g) => g.mean),
      p95: med((g) => g.p95),
      onePercentLow: med((g) => g.onePercentLow),
      fps: med((g) => g.fps),
      tick: med((g) => g.tick),
      render: med((g) => g.render),
      drawCalls: Math.round(med((g) => g.drawCalls)),
      gpuFrame: med((g) => g.gpuFrame),
      // The core's step (report version 14): null on a group that stepped
      // nothing, and on a capture from before the field.
      sim: per.every((g) => g.sim) ? med((g) => g.sim.mean) : null,
      simPhases: per.every((g) => g.sim)
        ? Object.fromEntries(
            Object.keys(per[0].sim.phases).map((k) => [k, med((g) => g.sim.phases[k] ?? 0)]),
          )
        : null,
      // The page's half of the hop (report version 15): the main thread's
      // wait on the Worker and its mirror sync, per stepped frame.
      hop: per.every((g) => g.sim?.hop)
        ? { wait: med((g) => g.sim.hop.wait), sync: med((g) => g.sim.hop.sync) }
        : null,
      spread: (Math.max(...means) - Math.min(...means)) / median(means),
      runs: means,
    };
  }
  // Every labelled segment on its own as well — each vantage's hold, the path
  // and the fight — because a group's mean can agree while one of its parts
  // does not. The settles and the lead-in are not measurements and are left out.
  const segments = {};
  for (const seg of runs[0].list) {
    if (seg.group === null) continue;
    const means = runs.map((r) => r.list.find((x) => x.name === seg.name)?.mean).filter((m) => m > 0);
    if (means.length < runs.length) continue;
    segments[seg.name] = {
      frames: seg.frames,
      mean: median(means),
      spread: (Math.max(...means) - Math.min(...means)) / median(means),
    };
  }
  return {
    seed: runs[0].seed,
    fight: hashes[0],
    segments,
    // Every run's own labelled stretches, so a spread can be traced to the
    // stretch it came from rather than only to its group.
    perRun: runs.map((r) => r.list.map((x) => ({ name: x.name, mean: x.mean, p95: x.p95, frames: x.frames }))),
    installMs: runs.map((r) => r.installMs),
    graphics: runs[0].graphics,
    device: runs[0].device,
    groups,
  };
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
