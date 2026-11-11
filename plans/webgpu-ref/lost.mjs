/**
 * A LOST DEVICE, on purpose (`BABYLON_EXIT.md` X5.4a; X5.4i grades it). The page
 * destroys the `GPUDevice` every draw is made on (`device.destroy()`, through the
 * frame adapter's `device()`) at one of four moments — the MENU, the BUILDING
 * card, DEPLOY and a LIFE — each on a fresh page (a fresh browser context, so
 * a fresh `sessionStorage`), and this records what happens after it: the
 * game's state over time, whether frames go on being drawn and submitted,
 * whether the PAGE RELOADED (the main frame's navigations), whether the
 * boot's plate is up and what it says, every toast the page showed, whether
 * a setting changed before the loss is still set after it, what the old
 * device's `lost` promise said, and every console line and page error.
 *
 * ```
 * node plans/webgpu-ref/lost.mjs [map] [--at=menu,loading,deploy,playing] [--seconds=10]
 *      [--match] [--twice] [--stale] [--strict] [--out=f.json]
 * ```
 *
 * - `--match`: each moment in a SERVER's match rather than the page's own —
 *   `dist-server/index.js` (`npm run build:server` first) spawned on a port of
 *   its own, the page booted with `?server=` naming it and joined by
 *   `joinMatch()` (the lobby's join, not `?mp`, which would rejoin by itself on
 *   a reload); `menu` is skipped, a match having none. After the loss, if the
 *   page reloaded to the menu, it is joined again (`joinMatch()`), and whether
 *   it reaches `deploy` is recorded — the player REJOINING. The server's own
 *   lines are kept.
 * - `--twice`: once the first loss has settled (the page reloaded and drawing,
 *   or `--seconds` up), the device is destroyed AGAIN — inside the game's loop
 *   guard's window (`CONFIG.graphics.deviceLossWindow`) — and the same is
 *   recorded for another `--seconds`. With `--stale`, the record of the first
 *   loss (`sessionStorage`'s `greywatch.deviceLost`, `core/deviceLoss.ts`) is
 *   backdated an hour before the second, so the second reads as a first.
 * - `--strict`: exit 1 when a moment's verdict is not X5.4i's answer. Without it
 *   the verdicts are printed and the run exits 0, which is how it records a
 *   parent.
 *
 * **What it grades, from X5.4i** (row "X5.4, a lost device", the owner's (A)):
 * a first loss RELOADS the page (one navigation) to the MENU, drawing again,
 * with the notice toast shown once and the setting changed before the loss
 * still set; a second inside the window does NOT reload (no navigation more)
 * and puts the boot's plate back up — "Cannot start", "No graphics device",
 * the boot's own sentence — with no frame drawn under it; a stale second
 * reloads again. **At a parent it records the dead frame** (X5.4a to X5.4h:
 * no reload, the frames going on, on the same dead device) and every verdict
 * reads "no".
 *
 * **This script's pages do NOT wear `harness.mjs`' device watch** — a lost device
 * is the point, so the console lines that end every other script's run are what
 * it records — but the run as a whole still has a hard limit (exit 3).
 */
import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { frameAdapter, hardLimit, launchClient, MAP_KEY, root, startDevServer } from "./harness.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const flag = (k) => args.includes(`--${k}`);
const MAP = args.find((a) => !a.startsWith("--")) ?? "hollowmere";
const MATCH = flag("match");
const TWICE = flag("twice");
const STALE = flag("stale");
const STRICT = flag("strict");
const AT = opt("at", MATCH ? "loading,deploy,playing" : "menu,loading,deploy,playing")
  .split(",")
  .filter(Boolean)
  .filter((a) => !(MATCH && a === "menu"));
const SECONDS = Number(opt("seconds", "10"));
const OUT = opt("out", "");
const SEED = 5101;
/** The game's record of the last loss (`src/core/deviceLoss.ts`'s `MARK`), read and — under `--stale` — backdated. */
const LOSS_KEY = "greywatch.deviceLost";
const PORT = 4300 + (process.pid % 500);

hardLimit(300 + AT.length * (SECONDS * (TWICE ? 2 : 1) + 300));

/** A match server of this tree's (`dist-server`), on its own port, its lines kept. */
async function startServer() {
  const entry = join(root, "dist-server/index.js");
  if (!existsSync(entry)) {
    console.error(`--match needs ${entry}: run \`npm run build:server\` first.`);
    process.exit(2);
  }
  const server = spawn(process.execPath, [entry], { cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: ["ignore", "pipe", "pipe"] });
  const lines = [];
  server.stdout.on("data", (b) => lines.push(...String(b).split(/\r?\n/).filter(Boolean)));
  server.stderr.on("data", (b) => lines.push(...String(b).split(/\r?\n/).filter(Boolean)));
  process.on("exit", () => server.kill());
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("the match server did not start")), 30_000);
    const poll = () => (lines.join("\n").includes(`on :${PORT}`) ? (clearTimeout(t), res()) : setTimeout(poll, 100));
    poll();
  });
  return { server, lines };
}

/**
 * Init script, on every document the page loads (so after a reload too): every
 * toast the page shows, and the frames drawn and submitted once the game is up
 * — counted from its boot, on whichever page this is.
 */
function watchPage() {
  const t0 = performance.now();
  const L = (window.__lossLog = { toasts: [], drawn: 0, submitted: 0, bootedAt: null });
  new MutationObserver((recs) => {
    for (const r of recs)
      for (const n of r.addedNodes)
        if (n.nodeType === 1 && n.classList.contains("toast")) L.toasts.push({ t: +((performance.now() - t0) / 1000).toFixed(2), text: n.textContent });
  }).observe(document, { childList: true, subtree: true });
  const poll = setInterval(() => {
    if (!window.__celshock || !window.__refFrame) return;
    clearInterval(poll);
    L.bootedAt = +((performance.now() - t0) / 1000).toFixed(2);
    const F = window.__refFrame();
    F.onDrawn(() => L.drawn++);
    F.onSubmitted(() => L.submitted++);
  }, 20);
}

/** What the page says now, or why it could not say (a navigation under the call). */
async function read(page) {
  try {
    return await page.evaluate((key) => {
      const g = window.__celshock;
      const L = window.__lossLog;
      const b = document.getElementById("boot");
      let mark = null;
      try {
        mark = window.sessionStorage.getItem(key);
      } catch {
        mark = "unreadable";
      }
      const mid = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
      return {
        state: g?.state ?? null,
        booted: Boolean(g),
        drawn: L?.drawn ?? null,
        submitted: L?.submitted ?? null,
        toasts: L?.toasts ?? [],
        setting: g ? g.settings.fpsCounter : null,
        mark,
        plate: b
          ? {
              inDocument: b.isConnected,
              failed: b.classList.contains("failed"),
              fading: b.classList.contains("done"),
              onTop: Boolean(mid?.closest?.("#boot")),
              word: document.getElementById("boot-word")?.textContent ?? null,
              stage: document.getElementById("boot-stage")?.textContent ?? null,
              msg: document.getElementById("boot-msg")?.textContent?.trim() ?? null,
            }
          : null,
      };
    }, LOSS_KEY);
  } catch (e) {
    return { evaluate: `threw: ${String(e.message).slice(0, 160)}` };
  }
}

/** Destroys the device the frame is drawn on; what it was, and its `lost` kept on the page. */
function destroyDevice(page) {
  return page.evaluate(() => {
    const dev = window.__refFrame().device();
    if (!dev) return { device: null };
    const W = (window.__lost = { old: dev, lostInfo: null });
    dev.lost.then((info) => (W.lostInfo = { reason: info.reason, message: String(info.message).slice(0, 300) }));
    dev.destroy();
    return { device: dev.label ?? "" };
  });
}

/** Waits for `n` frames drawn on the page as it is now (`__lossLog`), up to `ms`. */
async function frames(page, n, ms = 120_000) {
  const start = (await read(page)).drawn ?? 0;
  await page.waitForFunction((k) => (window.__lossLog?.drawn ?? 0) >= k, start + n, { timeout: ms, polling: 50 });
}

/**
 * `seconds` of wall clock after a loss, sampled each second; stops early once
 * the page has reloaded and is drawing again at the menu (or, in a match and
 * on the first loss, has rejoined). The navigations are counted node-side.
 */
async function after(page, navs, seconds, { rejoin = false } = {}) {
  const navs0 = navs.length;
  const samples = [];
  let rejoined = null;
  for (let s = 1; s <= seconds; s++) {
    await new Promise((r) => setTimeout(r, 1000));
    const now = await read(page);
    samples.push({ t: s, navigations: navs.length - navs0, ...now });
    const back = navs.length > navs0 && now.state === "menu" && (now.drawn ?? 0) > 30;
    if (back && rejoin && rejoined === null) {
      rejoined = "asked";
      await page.evaluate(() => window.__celshock.joinMatch()).catch((e) => (rejoined = `threw: ${e.message}`));
      try {
        await page.waitForFunction(() => window.__celshock?.state === "deploy", null, { timeout: 120_000, polling: 100 });
        rejoined = "deploy";
        samples.push({ t: s, navigations: navs.length - navs0, ...(await read(page)) });
      } catch (e) {
        rejoined = `not in deploy: ${String(e.message).slice(0, 120)}`;
      }
      break;
    }
    if (back && s >= 3) break;
  }
  return { samples, rejoined };
}

/** X5.4i's answer, read off a loss's samples: a reload to the menu with its notice and the setting kept, or the plate. */
function verdict(rec, expect, setting) {
  const end = rec.samples[rec.samples.length - 1] ?? {};
  const navigated = rec.samples.some((s) => s.navigations > 0);
  if (expect === "reload") {
    // Read at the menu the reload came back to (a rejoin may have moved on from it since).
    const back = rec.samples.find((s) => s.navigations > 0 && s.state === "menu" && (s.drawn ?? 0) > 0) ?? end;
    const told = back.toasts?.filter((t) => /graphics device was lost/.test(t.text)) ?? [];
    const ok = navigated && back.state === "menu" && (back.drawn ?? 0) > 0 && told.length === 1 && back.setting === setting && !back.plate?.failed;
    return { expect, ok, navigated, state: back.state, drawn: back.drawn, notices: told.map((t) => t.text), setting: back.setting, plate: back.plate?.failed ?? false };
  }
  const p = end.plate;
  const stopped = rec.samples.length >= 2 && rec.samples[rec.samples.length - 1].drawn === rec.samples[1].drawn;
  const ok = !navigated && Boolean(p?.inDocument && p.failed && p.onTop && p.word === "Cannot start" && p.stage === "No graphics device") && stopped;
  return { expect, ok, navigated, plate: p, framesStopped: stopped };
}

const vite = await startDevServer(root);
const server = MATCH ? await startServer() : null;
const browser = await launchClient({ headed: false });
const sep = vite.url.endsWith("/") ? "" : "/";
const report = { map: MAP, seed: SEED, seconds: SECONDS, match: MATCH, twice: TWICE, stale: STALE, at: {} };
let failed = 0;

for (const at of AT) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const lines = [];
  const navs = [];
  const t0 = Date.now();
  const stamp = () => +((Date.now() - t0) / 1000).toFixed(2);
  page.on("console", (m) => lines.push({ t: stamp(), type: m.type(), text: m.text().slice(0, 400) }));
  page.on("pageerror", (e) => lines.push({ t: stamp(), type: "pageerror", text: String(e.message).slice(0, 400) }));
  page.on("crash", () => lines.push({ t: stamp(), type: "crash", text: "the page crashed" }));
  page.on("dialog", (d) => void d.accept());
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) navs.push(stamp());
  });
  await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [MAP_KEY, MAP]);
  await page.addInitScript(frameAdapter);
  await page.addInitScript(watchPage);
  const query = MATCH ? `?server=ws://localhost:${PORT}/ws&seed=${SEED}` : `?seed=${SEED}`;
  await page.goto(`${vite.url}${sep}${query}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__celshock && window.__lossLog?.bootedAt !== null), null, { timeout: 180_000 });
  await frames(page, 30);
  // A setting changed by the player before the loss (through the settings
  // screen's own door): the readout, which draws nothing in the frame.
  const setting = await page.evaluate(() => {
    const g = window.__celshock;
    g.setSetting("fpsCounter", !g.settings.fpsCounter);
    return g.settings.fpsCounter;
  });
  // To the moment.
  if (at !== "menu") {
    await page.evaluate((m) => (m ? window.__celshock.joinMatch() : window.__celshock.startRound()), MATCH);
    if (at === "loading") {
      await page.waitForFunction(() => window.__celshock.state === "loading", null, { timeout: 60_000, polling: 1 });
    } else {
      await page.waitForFunction(() => window.__celshock.state === "deploy", null, { timeout: 600_000 });
      await frames(page, 30);
      if (at === "playing") {
        await page.evaluate(() => window.__celshock.spawnPlayer());
        await page.waitForFunction(() => window.__celshock.state === "playing", null, { timeout: 60_000 });
        await frames(page, 60);
      }
    }
  }
  const before = await read(page);
  const lostAt = stamp();
  const destroyed = await destroyDevice(page);
  const first = await after(page, navs, SECONDS, { rejoin: MATCH });
  first.lostInfo = await page.evaluate(() => window.__lost?.lostInfo ?? "the page that lost it is gone").catch(() => null);
  const rec = { before, setting, lostAt, destroyed, first, verdicts: [verdict(first, "reload", setting)] };
  if (TWICE) {
    const now = await read(page);
    if (now.booted && now.state !== null) {
      if (STALE)
        await page.evaluate((key) => {
          const m = JSON.parse(window.sessionStorage.getItem(key) ?? "null");
          if (m) window.sessionStorage.setItem(key, JSON.stringify({ ...m, at: m.at - 3_600_000 }));
        }, LOSS_KEY);
      rec.againAt = stamp();
      rec.againDestroyed = await destroyDevice(page);
      rec.again = await after(page, navs, SECONDS);
      rec.verdicts.push(verdict(rec.again, STALE ? "reload" : "plate", setting));
    } else {
      rec.again = { skipped: `no booted game to lose a second device on (${JSON.stringify(now).slice(0, 160)})` };
    }
  }
  rec.navigations = navs;
  rec.lines = lines.filter((l) => l.t >= lostAt - 0.5);
  report.at[at] = rec;

  console.log(`\n== lost at ${at}${MATCH ? " (a server's match)" : ""} (state ${before.state}, ${before.drawn} frames drawn before, fpsCounter set to ${setting}) ==`);
  const show = (label, r) => {
    if (!r?.samples) return console.log(`  ${label}: ${r?.skipped ?? "nothing"}`);
    console.log(`  ${label}:`);
    for (const s of r.samples) {
      if (s.evaluate) {
        console.log(`    +${s.t}s nav ${s.navigations}: ${s.evaluate}`);
        continue;
      }
      const plate = s.plate ? `plate ${s.plate.inDocument ? (s.plate.failed ? `FAILED "${s.plate.word}" / "${s.plate.stage}"${s.plate.onTop ? " on top" : ""}` : s.plate.fading ? "fading" : "up") : "removed"}` : "no plate";
      console.log(`    +${s.t}s nav ${s.navigations}: ${s.state}, drawn ${s.drawn}, ${plate}, fpsCounter ${s.setting}, toasts ${JSON.stringify(s.toasts.map((t) => t.text))}`);
    }
    if (r.rejoined !== undefined && r.rejoined !== null) console.log(`    rejoined: ${r.rejoined}`);
  };
  show("after the loss", first);
  console.log(`  the old device's lost: ${JSON.stringify(first.lostInfo)}`);
  if (TWICE) show(`after a second loss${STALE ? " (the first backdated an hour)" : ""}`, rec.again);
  for (const v of rec.verdicts) {
    if (!v.ok) failed++;
    console.log(`  verdict (${v.expect}): ${v.ok ? "YES" : "no"} — ${JSON.stringify({ ...v, ok: undefined, expect: undefined, plate: v.plate && typeof v.plate === "object" ? `${v.plate.word} / ${v.plate.stage}` : v.plate })}`);
  }
  const seen = new Map();
  for (const l of rec.lines) {
    const k = `${l.type}: ${l.text.replace(/\d+/g, "#").slice(0, 160)}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  console.log(`  console after the loss (${rec.lines.length} lines, folded):`);
  for (const [k, n] of [...seen].slice(0, 30)) console.log(`    ${n}x ${k}`);
  await page.close().catch(() => {});
}
if (server) {
  report.server = server.lines;
  console.log(`\nthe match server said (${server.lines.length} lines; joins and leaves):`);
  for (const l of server.lines.filter((l) => /slot|join|left|leav|welcom|seat|peer|close/i.test(l)).slice(0, 40)) console.log(`  ${l.slice(0, 200)}`);
}
console.log(`\n${failed === 0 ? "every verdict X5.4i's answer" : `${failed} verdict(s) not X5.4i's answer`}`);
if (OUT) writeFileSync(OUT, JSON.stringify(report));
await browser.close().catch(() => {});
vite.stop();
process.exit(STRICT && failed > 0 ? 1 : 0);
