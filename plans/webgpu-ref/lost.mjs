/**
 * A LOST DEVICE, on purpose (`BABYLON_EXIT.md` X5.4a; X5.4i grades it). The page
 * destroys the `GPUDevice` every draw is made on (`device.destroy()`, through the
 * frame adapter's `device()`) at one of four moments — the MENU, the BUILDING
 * card, DEPLOY and a LIFE — each on a fresh page, and this records what happens
 * after it: the game's state over time, whether frames go on being drawn and
 * submitted, whether the device the frame adapter answers is a new one, what
 * the old device's `lost` promise said, and every console line and page error.
 *
 * ```
 * node plans/webgpu-ref/lost.mjs [map] [--at=menu,loading,deploy,playing] [--seconds=10] [--out=f.json]
 * ```
 *
 * **It records TODAY's behaviour and grades nothing until X5.4i.** Today
 * (`BABYLON_EXIT.md` X5.4, "What the frame is today") the device is Babylon's:
 * Babylon's own `lost` handler re-creates ITS device, while our renderer keeps
 * the `GPUDevice` it read once at construction — so what this logs at the
 * parent is a dead frame, not a recovery. The owner's answer for X5.4i (row
 * "X5.4, a lost device") is a reload to the menu; this script is how that is
 * tested, twice in a row, offline and in a match, when it lands.
 *
 * **This script's pages do NOT wear `harness.mjs`' device watch** — a lost device
 * is the point, so the console lines that end every other script's run are what
 * it records — but the run as a whole still has a hard limit (exit 3).
 */
import { writeFileSync } from "node:fs";
import { frameAdapter, hardLimit, launchClient, MAP_KEY, root, startDevServer } from "./harness.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const MAP = args.find((a) => !a.startsWith("--")) ?? "hollowmere";
const AT = opt("at", "menu,loading,deploy,playing").split(",").filter(Boolean);
const SECONDS = Number(opt("seconds", "10"));
const OUT = opt("out", "");
const SEED = 5101;

hardLimit(300 + AT.length * (SECONDS + 240));

const vite = await startDevServer(root);
const browser = await launchClient({ headed: false });
const sep = vite.url.endsWith("/") ? "" : "/";
const report = { map: MAP, seed: SEED, seconds: SECONDS, at: {} };

for (const at of AT) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const lines = [];
  const t0 = Date.now();
  const stamp = () => +((Date.now() - t0) / 1000).toFixed(2);
  page.on("console", (m) => lines.push({ t: stamp(), type: m.type(), text: m.text().slice(0, 400) }));
  page.on("pageerror", (e) => lines.push({ t: stamp(), type: "pageerror", text: String(e.message).slice(0, 400) }));
  page.on("crash", () => lines.push({ t: stamp(), type: "crash", text: "the page crashed" }));
  page.on("dialog", (d) => void d.accept());
  await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [MAP_KEY, MAP]);
  await page.addInitScript(frameAdapter);
  await page.goto(`${vite.url}${sep}?seed=${SEED}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__celshock), null, { timeout: 180_000 });
  // The frames, counted from here on: drawn (the adapter's draw) and submitted
  // (its end of frame), each with the state it ended in.
  await page.evaluate(() => {
    const F = window.__refFrame();
    const W = (window.__lost = { drawn: 0, submitted: 0, states: [] });
    F.onDrawn(() => W.drawn++);
    F.onSubmitted(() => W.submitted++);
  });
  const settle = (n) =>
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
  await settle(30);
  // To the moment.
  if (at !== "menu") {
    await page.evaluate(() => window.__celshock.startRound());
    if (at === "loading") {
      await page.waitForFunction(() => window.__celshock.state === "loading", null, { timeout: 60_000, polling: 1 });
    } else {
      await page.waitForFunction(() => window.__celshock.state === "deploy", null, { timeout: 600_000 });
      await settle(30);
      if (at === "playing") {
        await page.evaluate(() => window.__celshock.spawnPlayer());
        await page.waitForFunction(() => window.__celshock.state === "playing", null, { timeout: 60_000 });
        await settle(60);
      }
    }
  }
  const before = await page.evaluate(() => ({ state: window.__celshock.state, drawn: window.__lost.drawn, submitted: window.__lost.submitted }));
  // The loss: the device the frame is drawn on, destroyed by the page.
  const lostAt = stamp();
  const destroyed = await page.evaluate(() => {
    const dev = window.__refFrame().device();
    if (!dev) return { device: null };
    const W = window.__lost;
    W.old = dev;
    W.lostInfo = null;
    dev.lost.then((info) => (W.lostInfo = { reason: info.reason, message: String(info.message).slice(0, 300) }));
    dev.destroy();
    return { device: dev.label ?? "" };
  });
  // Then SECONDS of wall clock, the state and the frame counts sampled each second.
  const samples = [];
  for (let s = 1; s <= SECONDS; s++) {
    await new Promise((r) => setTimeout(r, 1000));
    let sample;
    try {
      sample = await page.evaluate(() => {
        const W = window.__lost;
        let dev = null;
        try {
          dev = window.__refFrame().device();
        } catch {
          dev = undefined;
        }
        return { state: window.__celshock?.state ?? null, drawn: W?.drawn ?? null, submitted: W?.submitted ?? null, sameDevice: dev === W?.old, deviceLabel: dev ? (dev.label ?? "") : null, lost: W?.lostInfo ?? null };
      });
    } catch (e) {
      sample = { evaluate: `threw: ${String(e.message).slice(0, 200)}` };
    }
    samples.push({ t: s, ...sample });
  }
  const rec = { before, lostAt, destroyed, samples, lines: lines.filter((l) => l.t >= lostAt - 0.5) };
  report.at[at] = rec;
  const end = samples[samples.length - 1];
  console.log(`\n== lost at ${at} (state ${before.state}, ${before.drawn} frames drawn before) ==`);
  console.log(`  device lost: ${JSON.stringify(end.lost)}; the adapter's device afterwards: ${end.sameDevice ? "the same (dead) one" : `a new one (${JSON.stringify(end.deviceLabel)})`}`);
  for (const s of samples) console.log(`  +${s.t}s ${s.evaluate ?? `${s.state}, drawn ${s.drawn - before.drawn}, submitted ${s.submitted - before.submitted}`}`);
  const seen = new Map();
  for (const l of rec.lines) {
    const k = `${l.type}: ${l.text.replace(/\d+/g, "#").slice(0, 160)}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  console.log(`  console after the loss (${rec.lines.length} lines, folded):`);
  for (const [k, n] of [...seen].slice(0, 25)) console.log(`    ${n}x ${k}`);
  await page.close().catch(() => {});
}
if (OUT) writeFileSync(OUT, JSON.stringify(report));
await browser.close().catch(() => {});
vite.stop();
process.exit(0);
