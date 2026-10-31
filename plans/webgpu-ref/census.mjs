/**
 * The MAIN PASS's draw count at every bank vantage — Babylon's draws into the
 * frame's own target plus our renderer's — so a step that moves the world's
 * draws from one renderer to the other can say what it traded
 * (`BABYLON_EXIT.md` X3.3a: one draw for one draw; X3.3b and X3.3c: the
 * count falls).
 *
 * Run with `node plans/webgpu-ref/census.mjs [map...] [--query=<flags>]
 * [--out f.json] [--against f.json] [--fall]`. Without `--query` it counts the
 * game as it ships; with one it counts both and prints the two side by side,
 * row by row, and fails if the switch's total differs from the build's
 * without it. `--out` writes the shipping build's rows; `--against` compares
 * them, row by row, with rows an earlier `--out` wrote — the BEFORE of a step
 * that leaves no switch behind (X3.3c), taken by running this file in a
 * worktree of the commit before it — and fails if a map's total differs.
 * `--fall` makes either comparison fail unless the total is LOWER instead.
 *
 * **What a "main-pass draw" is**: a call of Babylon's `engine._draw` made
 * while the target bound as the draw phase began is still bound and the
 * phase has not ended — `render/babylonSeam.ts`'s own test for the frame's
 * main pass, so a shadow map, a probe face, the lamps' atlas and the glow's
 * mask (rendered from `onAfterDrawPhaseObservable`) are not counted — plus
 * what our renderer drew in that pass (`Game.handover.stats.drawn`, since
 * X4.1d `Game.bodyDraw.stats.drawn`, and since X4.2b `Game.hullDraw.stats
 * .drawn`). Read on
 * a FROZEN frame, after the bank's own settle, so the count is the vantage's
 * and not a frame's: the same frame a `bank.mjs --check` photographs.
 *
 * It is a STRUCTURAL count of one vantage at a time, the rows the bank
 * already chose; `VERIFYING.md`'s 30-sample sweep is the protocol for a
 * figure quoted as a map's.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { freeze, installRound, MAP_IDS, placeVantage, root, settle, startDevServer, launchClient, thaw, vantages, waitUntilDrawn, bootMap } from "./harness.mjs";
import { shotList } from "./vantages.mjs";

const args = process.argv.slice(2);
const QUERY = args.find((a) => a.startsWith("--query="))?.slice("--query=".length) ?? "";
const FALL = args.includes("--fall");
/** The value after `flag`, or null. */
function value(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? (args[i + 1] ?? null) : null;
}
const OUT = value("--out");
const AGAINST = value("--against");
const BEFORE = AGAINST ? JSON.parse(readFileSync(AGAINST, "utf8")) : null;
const valued = new Set([OUT, AGAINST]);
const maps = args.filter((a) => !a.startsWith("--") && !valued.has(a));
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
    // Null before X3.3c unless the switch was on, so a BEFORE taken in a
    // worktree of then counts Babylon alone. The BODIES are ours since
    // X4.1d (`BodyDraw`, its main-pass draws), counted with the world's — a
    // BEFORE older than that counts its rigs' meshes in Babylon's.
    // The HULLS are ours since X4.2b (`HullDraw`, a rank of every hull a
    // draw), counted the same way; a BEFORE older than that counts their
    // meshes in Babylon's, one a mesh, so a row with hulls in it FALLS.
    const ours = g.handover ? g.handover.stats : { taken: 0, drawn: 0 };
    const bodies = g.bodyDraw ? g.bodyDraw.stats.drawn : 0;
    const hulls = g.hullDraw ? g.hullDraw.stats.drawn : 0;
    return { babylon: window.__census.babylon, ours: ours.drawn + bodies + hulls, bodies, hulls, taken: ours.taken };
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
const written = {};
console.log(
  `census: main-pass draws${QUERY ? `, against ?${QUERY}` : ""}${AGAINST ? `, against ${AGAINST}` : ""}\n`,
);
for (const id of targets) {
  const base = await census(id, "");
  written[id] = base;
  const sw = QUERY ? await census(id, QUERY) : null;
  const before = BEFORE ? BEFORE[id] : null;
  if (BEFORE && !before) problems.push(`${id}: not in ${AGAINST}`);
  console.log(id);
  let total = 0;
  let totalSw = 0;
  let totalBefore = 0;
  base.forEach((b, i) => {
    const n = b.babylon + b.ours;
    total += n;
    let line = `  ${b.id.padEnd(13)} ${String(n).padStart(5)} (Babylon ${b.babylon}, ours ${b.ours} of ${b.taken} taken)`;
    const was = before?.find((r) => r.id === b.id);
    if (before && !was) problems.push(`${id}: vantage ${b.id} not in ${AGAINST}`);
    if (was) {
      const w = was.babylon + was.ours;
      totalBefore += w;
      line += `   before ${String(w).padStart(5)}  ${n === w ? "=" : n < w ? `-${w - n}` : `+${n - w}`}`;
    }
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
  } else if (before) {
    const verdict = FALL ? total < totalBefore : total === totalBefore;
    if (!verdict) problems.push(`${id}: ${totalBefore} draws before, ${total} now`);
    console.log(`  ${"total".padEnd(13)} ${String(total).padStart(5)}   before ${String(totalBefore).padStart(5)}  ${verdict ? "ok" : "FAIL"}`);
  } else {
    console.log(`  ${"total".padEnd(13)} ${String(total).padStart(5)}`);
  }
}
if (OUT) {
  writeFileSync(OUT, `${JSON.stringify(written, null, 2)}\n`);
  console.log(`\nrows -> ${OUT}`);
}

await browser.close();
await vite.stop?.();
if (problems.length) {
  console.log(`\n${problems.length} problem(s):\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
process.exit(0);
