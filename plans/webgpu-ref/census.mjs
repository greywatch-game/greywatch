/**
 * The MAIN PASS's draw count at every bank vantage — Babylon's draws into the
 * frame's own target plus our renderer's — with and without a DEV switch, so
 * a step that moves the world's draws from one renderer to the other can say
 * what it traded (`BABYLON_EXIT.md` X3.3a: one draw for one draw; X3.3b: the
 * count falls).
 *
 * Run with `node plans/webgpu-ref/census.mjs [map...] [--query=ourworld]`.
 * Without `--query` it counts the game as it ships; with one it counts both
 * and prints the two side by side, row by row, and fails if the switch's
 * total differs from the build's without it (`--fall` instead fails unless
 * it is LOWER — X3.3b's test).
 *
 * **What a "main-pass draw" is**: a call of Babylon's `engine._draw` made
 * while the target bound as the draw phase began is still bound and the
 * phase has not ended — `render/babylonSeam.ts`'s own test for the frame's
 * main pass, so a shadow map, a probe face, the lamps' atlas and the glow's
 * mask (rendered from `onAfterDrawPhaseObservable`) are not counted — plus
 * what our renderer drew in that pass (`Game.handover.stats.drawn`). Read on
 * a FROZEN frame, after the bank's own settle, so the count is the vantage's
 * and not a frame's: the same frame a `bank.mjs --check` photographs.
 *
 * It is a STRUCTURAL count of one vantage at a time, the rows the bank
 * already chose; `VERIFYING.md`'s 30-sample sweep is the protocol for a
 * figure quoted as a map's.
 */
import { freeze, installRound, MAP_IDS, placeVantage, root, settle, startDevServer, launchClient, thaw, vantages, waitUntilDrawn, bootMap } from "./harness.mjs";
import { shotList } from "./vantages.mjs";

const args = process.argv.slice(2);
const QUERY = args.find((a) => a.startsWith("--query="))?.slice("--query=".length) ?? "";
const FALL = args.includes("--fall");
const maps = args.filter((a) => !a.startsWith("--"));
const targets = maps.length ? maps : MAP_IDS;

/** The bank's own settle, so the count is of the frame `bank.mjs` grades. */
const CONVERGE_FRAMES = 30;
const SETTLE_FRAMES = 6;

const vite = await startDevServer(root);
const browser = await launchClient({ headed: false });
const VANTAGES = await vantages(browser, vite.url);

/** Arms a counter of main-pass draws in the page; returns nothing. */
function arm(page) {
  return page.evaluate(() => {
    const g = window.__celshock;
    const scene = g.scene;
    const engine = scene.getEngine();
    const c = { frame: undefined, babylon: 0 };
    scene.onBeforeDrawPhaseObservable.add(() => {
      c.frame = engine._currentRenderTarget;
      c.babylon = 0;
    });
    scene.onAfterDrawPhaseObservable.add(() => (c.frame = undefined), undefined, true);
    const draw = engine._draw.bind(engine);
    engine._draw = (...a) => {
      if (c.frame !== undefined && engine._currentRenderTarget === c.frame) c.babylon++;
      return draw(...a);
    };
    window.__census = c;
  });
}

/** The last complete frame's main-pass draws. */
function read(page) {
  return page.evaluate(async () => {
    const g = window.__celshock;
    await new Promise((res) => {
      const o = g.scene.onAfterRenderObservable.add(() => {
        g.scene.onAfterRenderObservable.remove(o);
        res();
      });
    });
    const ours = g.handover ? g.handover.stats : { taken: 0, drawn: 0 };
    return { babylon: window.__census.babylon, ours: ours.drawn, taken: ours.taken };
  });
}

/** Every vantage of `id`, counted in a build booted with `query`. */
async function census(id, query) {
  const { page, pageErrors } = await bootMap(browser, query ? `${vite.url}/?${query}` : vite.url, id);
  await installRound(page);
  await arm(page);
  const rows = [];
  for (const v of shotList(id, VANTAGES[id])) {
    await thaw(page);
    await placeVantage(page, v);
    await waitUntilDrawn(page);
    await settle(page, CONVERGE_FRAMES);
    await freeze(page, undefined, { windTime: v.wind ?? 0, turn: v.turn ?? 0 });
    await settle(page, SETTLE_FRAMES);
    rows.push({ id: v.id, ...(await read(page)) });
  }
  if (pageErrors.length) console.log(`  ${pageErrors.length} page errors: ${pageErrors[0]}`);
  await page.close();
  return rows;
}

const problems = [];
console.log(`census: main-pass draws${QUERY ? `, against ?${QUERY}` : ""}\n`);
for (const id of targets) {
  const base = await census(id, "");
  const sw = QUERY ? await census(id, QUERY) : null;
  console.log(id);
  let total = 0;
  let totalSw = 0;
  base.forEach((b, i) => {
    const n = b.babylon + b.ours;
    total += n;
    let line = `  ${b.id.padEnd(13)} ${String(n).padStart(5)}`;
    if (sw) {
      const s = sw[i];
      const m = s.babylon + s.ours;
      totalSw += m;
      line += `   ?${QUERY} ${String(m).padStart(5)} (Babylon ${s.babylon}, ours ${s.ours} of ${s.taken} taken)  ${m === n ? "=" : m < n ? `-${n - m}` : `+${m - n}`}`;
    }
    console.log(line);
  });
  if (sw) {
    const verdict = FALL ? totalSw < total : totalSw === total;
    if (!verdict) problems.push(`${id}: ${total} draws without the switch, ${totalSw} with it`);
    console.log(`  ${"total".padEnd(13)} ${String(total).padStart(5)}   ?${QUERY} ${String(totalSw).padStart(5)}  ${verdict ? "ok" : "FAIL"}`);
  }
}

await browser.close();
await vite.stop?.();
if (problems.length) {
  console.log(`\n${problems.length} problem(s):\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
process.exit(0);
