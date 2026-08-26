/**
 * Takes the reference frames every WGSL landing diffs against, and refuses to
 * write one that is not reproducible.
 *
 * Run with `node plans/webgpu-ref/bank.mjs [map...]`, `--headed` to take the
 * bank in headed mode, `--check` to compare against what is already banked
 * rather than replacing it. Frames land in `plans/webgpu-ref/ref/<map>.png`.
 *
 * **The refusal is the feature.** A reference frame is only worth having if
 * the same machine, asked twice, produces the same bytes — otherwise a later
 * diff is measuring the noise and every landing looks like a regression. So
 * this takes TWO consecutive screenshots of the frozen frame and writes
 * nothing unless they are byte-identical. Measured with the full freeze set,
 * they are, on all four maps in both browser modes; measured with the post
 * chain alone they are not, which is what the freeze set in `harness.mjs`
 * exists to say.
 *
 * **Taking a bank and checking against one are graded DIFFERENTLY, and
 * conflating them is what a first version of this got wrong.** Byte-identity
 * is reachable inside one process and is not reachable across two: boot the
 * same map twice and the same frozen frame comes back with the sky and the
 * tower moved by a fraction of a level, 0.00/255 on Greyfen and 0.14 on
 * Harrowmead. So the write path demands identical bytes — it has both grabs in
 * hand and nothing excuses a difference — and the check path grades by
 * MAGNITUDE against `CHECK_TOLERANCE`, which sits above that residue and well
 * below a real picture change. A check that demanded bytes would fail on every
 * run and teach everyone to ignore it, which is worse than having no check.
 *
 * **What is deliberately NOT frozen is the post chain itself.** Switching it
 * off would reach the same zero floor and would make the bank useless for the
 * three post fragments, which are exactly the shaders a WGSL port has to
 * prove. The grain is held by replacing `post.update` — the clock stops, the
 * vignette, the aberration, the god rays and the motion blur all stay in the
 * picture.
 *
 * **A frame is engine-difference-absorbed and shader-difference-sensitive, and
 * that is the whole technique.** These are NOT WebGL2 shots. The engine swap
 * landed with every shader still in GLSL, so a frame taken here already has
 * the engine difference inside it and a diff against it therefore means a
 * SHADER difference — which is the only thing the remaining milestones can
 * break. Re-taking the bank after a shader change destroys that property, so
 * re-take it only when the engine or the vantages move, and say so in the
 * commit.
 *
 * **A bank is tied to the browser mode it was taken in.** Headed and headless
 * frames are not byte-identical on three of the four maps; `--check` compares
 * against whatever is on disk, so running it in the other mode reports four
 * regressions that are a browser mode. The mode is recorded in `ref/mode.json`
 * and `--check` refuses a mismatch rather than reporting nonsense.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CHECK_TOLERANCE, comparePngs } from "./diff.mjs";
import {
  MAP_IDS,
  bootMap,
  freeze,
  installRound,
  launchClient,
  placeVantage,
  settle,
  startDevServer,
  vantages,
  waitUntilDrawn,
  root,
} from "./harness.mjs";

const args = process.argv.slice(2);
const HEADED = args.includes("--headed");
const CHECK = args.includes("--check");
const maps = args.filter((a) => !a.startsWith("--"));
const targets = maps.length ? maps : MAP_IDS;

/** Frames to let the camera-derived passes converge, BEFORE the freeze. */
const CONVERGE_FRAMES = 30;
/** Frames to let the shadow map and the post chain settle, AFTER the freeze. */
const SETTLE_FRAMES = 6;

const refDir = join(root, "plans", "webgpu-ref", "ref");
const modePath = join(refDir, "mode.json");
mkdirSync(refDir, { recursive: true });

const mode = HEADED ? "headed" : "headless";
if (CHECK && existsSync(modePath)) {
  const banked = JSON.parse(readFileSync(modePath, "utf8")).mode;
  if (banked !== mode) {
    console.error(
      `bank was taken ${banked}; re-run with ${banked === "headed" ? "--headed" : "no --headed"}.\n` +
        "Headed and headless frames are not byte-identical — see the header.",
    );
    process.exit(2);
  }
}

const sha = (b) => createHash("sha256").update(b).digest("hex");
const vite = await startDevServer(root);
const browser = await launchClient({ headed: HEADED });
// The differ decodes PNGs on a 2D canvas and wants no GPU, so it is a plain
// headless shell rather than a second copy of the game's browser — and it is
// opened once for the whole run rather than once per map.
const decoder = CHECK
  ? await (await import("playwright")).chromium.launch({ headless: true })
  : null;
const VANTAGES = await vantages(browser, vite.url);

console.log(`bank: ${mode} @ ${vite.url}${CHECK ? "  (check only)" : ""}\n`);
const problems = [];
for (const id of targets) {
  const vantage = VANTAGES[id];
  if (!vantage) {
    console.log(`${id.padEnd(12)} no vantage in mapShots.ts — skipped, which is not an error`);
    continue;
  }
  const { page, pageErrors } = await bootMap(browser, vite.url, id);
  await installRound(page);
  await placeVantage(page, vantage);
  const { drawnOnFrame } = await waitUntilDrawn(page);
  // Settle BEFORE the freeze, not after it: the god rays and the motion blur
  // are pinned by a camera that has been standing still rather than by a
  // constant, so they have to be given the frames to converge while their
  // updates still run. The clocks that the freeze pins are unaffected by how
  // long this takes, which is the point of pinning them. See `freeze`.
  await settle(page, CONVERGE_FRAMES);
  await freeze(page);
  await settle(page, SETTLE_FRAMES);

  const a = await page.screenshot({ type: "png", timeout: 120_000 });
  const b = await page.screenshot({ type: "png", timeout: 120_000 });
  const reproducible = sha(a) === sha(b);
  const out = join(refDir, `${id}.png`);

  if (!reproducible) {
    problems.push(`${id}: frame is not reproducible — two consecutive grabs differ`);
    console.log(`${id.padEnd(12)} NOT REPRODUCIBLE — nothing written (drawn on frame ${drawnOnFrame})`);
  } else if (CHECK) {
    if (!existsSync(out)) {
      problems.push(`${id}: nothing banked to compare against`);
      console.log(`${id.padEnd(12)} no reference on disk`);
    } else {
      // Graded by MAGNITUDE and not by byte equality, for the reason
      // `CHECK_TOLERANCE` gives: the same frozen frame does not come back
      // byte-identical across processes, and a check that demanded it would
      // fail on every run and teach everyone to ignore it.
      const grab = join(refDir, `${id}.check.png`);
      writeFileSync(grab, a);
      const d = await comparePngs(out, grab, { tiles: true, browser: decoder });
      rmSync(grab, { force: true });
      const bad = d.sizeMismatch || d.meanAbs > CHECK_TOLERANCE;
      if (bad) {
        problems.push(
          d.sizeMismatch
            ? `${id}: size mismatch against the bank`
            : `${id}: mean ${d.meanAbs}/255 over tolerance ${CHECK_TOLERANCE}`,
        );
      }
      console.log(
        `${id.padEnd(12)} ${bad ? "REGRESSION" : "within floor"}  ` +
          `${d.pctPixels}% of pixels, mean ${d.meanAbs}/255, worst ${d.max}/255  ` +
          `(drawn on frame ${drawnOnFrame})`,
      );
      if (bad && d.tiles) {
        for (const t of d.tiles.slice(0, 4)) {
          console.log(`   col ${String(t.col).padStart(2)} row ${t.row}  mean ${t.mean}/255`);
        }
      }
    }
  } else {
    writeFileSync(out, a);
    console.log(
      `${id.padEnd(12)} ${(a.length / 1024).toFixed(0)} KB -> ${out}  ` +
        `(drawn on frame ${drawnOnFrame}, floor 0.000%)`,
    );
  }
  if (pageErrors.length) problems.push(`${id}: ${pageErrors.length} page errors`);
  await page.close();
}

if (!CHECK) writeFileSync(modePath, JSON.stringify({ mode }, null, 2));
await browser.close();
await decoder?.close();
vite.stop();

if (problems.length) {
  console.log("");
  for (const p of problems) console.log(`  ${p}`);
  process.exit(1);
}
