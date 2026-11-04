/**
 * Compares two `bank.mjs --check --keep=<dir>` directories byte for byte, which
 * is the proof every sub-step of `BABYLON_EXIT.md` X4.6 owes, and which
 * `bank.mjs --check`'s pass line cannot give.
 *
 * Run with `node plans/webgpu-ref/exact.mjs <before-dir> <after-dir> [--new=<id,...>]`.
 * It wants no GPU: `diff.mjs`'s decoder is a plain headless shell.
 *
 * **Why `--check` is not enough.** `CHECK_TOLERANCE` is a whole-frame MEAN, so a
 * surface can move or go whole inside it: `coldharbour-ring-behind-field` with
 * the zones' split wrong moves 54 pixels by up to 113/255, a mean of 0.0002
 * against 0.02. And a stale bank's row fails `--check` whatever the tree does
 * (`README.md`), so its red says nothing either way. Two kept directories, taken
 * at the parent and at the step on one machine, say all of it.
 *
 * **Exit 0 only when every row is byte-equal or moved within `KNOWN_FLAKES`.**
 * A row present on one side alone FAILS, since a frame `--keep` did not write is
 * one that was not reproducible: a row a step ADDED is named in `--new`, which
 * says what its BEFORE cannot, and is only listed.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { comparePngs } from "./diff.mjs";

/**
 * The rows that come back a pixel or two off on an UNCHANGED tree, with the most
 * they have ever moved. Over either bound it is a difference like any other.
 * Both were traced to the tree's own frames and not to a step
 * (`plans/done/babylon_exit_landed.md`, X4.1's sub-steps for the shelf and X4.3's
 * for the pistol). A row belongs here only with a run of one tree against itself
 * behind it. `sarab-ground` (up to 100 pixels by 2/255, at X4.1, X4.4c and X4.4d, each
 * time cross-process residue) is not here, being larger: if it moves, run Sarab alone
 * at both ends rather than widen this.
 */
const KNOWN_FLAKES = {
  "harrowmead-view-pistol-reload": { pixels: 2, worst: 1 },
  "sarab-shelf": { pixels: 1, worst: 1 },
};

const args = process.argv.slice(2);
const [beforeDir, afterDir] = args.filter((a) => !a.startsWith("--"));
const NEW = new Set(
  (args.find((a) => a.startsWith("--new="))?.slice("--new=".length) ?? "").split(",").filter(Boolean),
);
if (!beforeDir || !afterDir) {
  console.error("usage: node plans/webgpu-ref/exact.mjs <before-dir> <after-dir> [--new=<id,...>]");
  process.exit(2);
}

const frames = (dir) =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".png"))
    .map((f) => f.slice(0, -".png".length));
const before = new Set(frames(beforeDir));
const after = new Set(frames(afterDir));
const rows = [...new Set([...before, ...after])].sort();

const failures = [];
let equal = 0;
let flaked = 0;
let added = 0;
const browser = await chromium.launch({ headless: true });
for (const row of rows) {
  const label = row.padEnd(44);
  if (!before.has(row) || !after.has(row)) {
    if (NEW.has(row) && after.has(row)) {
      added++;
      console.log(`${label} new, no BEFORE (--new)`);
    } else {
      failures.push(row);
      console.log(`${label} ONLY IN ${before.has(row) ? "BEFORE" : "AFTER"}`);
    }
    continue;
  }
  const a = join(beforeDir, `${row}.png`);
  const b = join(afterDir, `${row}.png`);
  if (readFileSync(a).equals(readFileSync(b))) {
    equal++;
    console.log(`${label} byte-equal`);
    continue;
  }
  const d = await comparePngs(a, b, { browser });
  if (d.sizeMismatch) {
    failures.push(row);
    console.log(`${label} SIZE ${d.sizeMismatch.join(" ")}`);
    continue;
  }
  if (d.pixels === 0) {
    // The PNG's encoding, not the picture.
    equal++;
    console.log(`${label} pixel-equal (the files differ)`);
    continue;
  }
  const flake = KNOWN_FLAKES[row];
  const within = flake && d.pixels <= flake.pixels && d.max <= flake.worst;
  if (within) flaked++;
  else failures.push(row);
  console.log(
    `${label} ${within ? "known flake" : "MOVED"}: ${d.pixels} pixels, worst ${d.max}/255, mean ${d.meanAbs}/255` +
      (flake && !within ? ` (the flake's bound is ${flake.pixels} pixels by ${flake.worst}/255)` : ""),
  );
}
await browser.close();

console.log(
  `\n${rows.length} rows: ${equal} byte-equal, ${flaked} within a known flake, ${added} new, ${failures.length} different`,
);
if (failures.length) {
  console.log(`different: ${failures.join(", ")}`);
  process.exit(1);
}
