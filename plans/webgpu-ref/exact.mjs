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
 * behind it. `sarab-ground` (up to 100 pixels by 2/255, at X4.1, X4.4c and X4.4d, each
 * time cross-process residue) is not here, being larger: if it moves, run Sarab alone
 * at both ends rather than widen this.
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
  // `BABYLON_EXIT.md`, "Decisions", the owner's of 2026-11-04: `Game.grassPull`'s two
  // points against Babylon's order, the frame's reedy bodies either side of the key.
  // Graded against 21839d1's truth (`ref/`), the one frame on the other side of it.
  "sarab-shore-flip": { pixels: 27, worst: 54, until: "X4.6d" },
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
