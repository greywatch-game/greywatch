/**
 * Compares two `bank.mjs --check --keep=<dir>` directories byte for byte, which
 * is the proof every sub-step of `BABYLON_EXIT.md` X4.6 owes, and which
 * `bank.mjs --check`'s pass line cannot give.
 *
 * Run with `node plans/webgpu-ref/exact.mjs <before-dir> <after-dir> [--new=<id,...>] [--rows=<id,...>]`.
 * It wants no GPU: `diff.mjs`'s decoder is a plain headless shell. `--rows` compares
 * only the named rows, which is how a kept frame is held against `ref/` alone, whose
 * other rows are stale (`README.md`).
 *
 * **Why `--check` is not enough.** `CHECK_TOLERANCE` is a whole-frame MEAN, so a
 * surface can move or go whole inside it: `coldharbour-ring-behind-field` with
 * the zones' split wrong moves 54 pixels by up to 113/255, a mean of 0.0002
 * against 0.02. And a stale bank's row fails `--check` whatever the tree does
 * (`README.md`), so its red says nothing either way. Two kept directories, taken
 * at the parent and at the step on one machine, say all of it.
 *
 * **Exit 0 only when every row is byte-equal or moved within `KNOWN_FLAKES` or
 * `EXPECTED_MOVES`.**
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
 * behind it. Three rows are NOT here, being larger, and each is cross-process residue
 * of the same class: `sarab-ground` (up to 100 pixels by 2/255, at X4.1, X4.4c, X4.4d,
 * X5.1a and X5.2a's F1 fix, where the parent's frame was one the step's processes drew) in
 * the plain bank, and `sarab-alley` (5 pixels by 2/255, X5.1a: two frames
 * of one tree, 3 processes of 4 against 1) and `sarab-particles-dust` (4 pixels by 1/255,
 * X5.1b: two frames of one tree, each drawn by the parent's processes and the step's,
 * Sarab alone two processes a side) under `--query=gi=low` only, never seen at high or
 * off. If any of them moves, run Sarab alone at both ends — `bank.mjs sarab --check
 * --keep=<dir>` at the parent and at the step, two processes each, under the same
 * `--query` — and show the row's frame is one the parent's processes also draw, rather
 * than widen this.
 */
const KNOWN_FLAKES = {
  "harrowmead-view-pistol-reload": { pixels: 2, worst: 1 },
  "sarab-shelf": { pixels: 1, worst: 1 },
};

/**
 * NOT flakes: rows whose move is a RECORDED picture difference the owner accepted
 * for a stated time, with the most it may be. Nothing here is noise, and a row here
 * reproduces exactly on one tree. Over either bound it is a difference like any
 * other, so the tool passes today and fails if the row moves MORE; its own `until`
 * says which step removes the entry, and that step's proof is the row byte-equal.
 */
const EXPECTED_MOVES = {
  // Empty since X4.6d: the one entry there has been, `sarab-shore-flip` (`BABYLON_EXIT.md`,
  // "Decisions", the owner's of 2026-11-04), ended with the one run, its row byte-equal to
  // its truth in `ref/`. A step that moves it against a parent still drawing the flip fails.
};

const args = process.argv.slice(2);
const [beforeDir, afterDir] = args.filter((a) => !a.startsWith("--"));
const listArg = (name) =>
  new Set((args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? "").split(",").filter(Boolean));
const NEW = listArg("new");
const ONLY = listArg("rows");
if (!beforeDir || !afterDir) {
  console.error("usage: node plans/webgpu-ref/exact.mjs <before-dir> <after-dir> [--new=<id,...>] [--rows=<id,...>]");
  process.exit(2);
}

const frames = (dir) =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".png"))
    .map((f) => f.slice(0, -".png".length));
const before = new Set(frames(beforeDir));
const after = new Set(frames(afterDir));
const rows = [...(ONLY.size ? ONLY : new Set([...before, ...after]))].sort();

const failures = [];
let equal = 0;
let flaked = 0;
let added = 0;
let expected = 0;
const browser = await chromium.launch({ headless: true });
for (const row of rows) {
  const label = row.padEnd(44);
  if (!before.has(row) || !after.has(row)) {
    if (NEW.has(row) && after.has(row)) {
      added++;
      console.log(`${label} new, no BEFORE (--new)`);
    } else {
      failures.push(row);
      console.log(`${label} ${before.has(row) ? "ONLY IN BEFORE" : after.has(row) ? "ONLY IN AFTER" : "IN NEITHER"}`);
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
  const accepted = EXPECTED_MOVES[row];
  const bound = flake ?? accepted;
  const within = bound && d.pixels <= bound.pixels && d.max <= bound.worst;
  if (within && flake) flaked++;
  else if (within) expected++;
  else failures.push(row);
  const verdict = !within ? "MOVED" : flake ? "known flake" : `expected to move until ${accepted.until}`;
  const named = flake ? "flake" : "expected move";
  console.log(
    `${label} ${verdict}: ${d.pixels} pixels, worst ${d.max}/255, mean ${d.meanAbs}/255` +
      (bound && !within ? ` (the ${named}'s bound is ${bound.pixels} pixels by ${bound.worst}/255)` : ""),
  );
}
await browser.close();

console.log(
  `\n${rows.length} rows: ${equal} byte-equal, ${flaked} within a known flake, ${expected} an expected move, ${added} new, ${failures.length} different`,
);
if (failures.length) {
  console.log(`different: ${failures.join(", ")}`);
  process.exit(1);
}
