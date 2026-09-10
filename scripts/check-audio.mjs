/**
 * Refuses a build whose audio is stale, over budget, or wired to nothing.
 *
 * Runs on the front of `npm run build` beside `check-collision.mjs` and
 * `check-deep-imports.mjs`, and it is the reason the budget in
 * `audio/manifest.json` is a fact rather than a paragraph. The pipeline it
 * guards LOWERS the friction of adding a sound, and the friction was doing
 * some of the enforcing — so this has to do the rest.
 *
 * **Needs no ffmpeg**, deliberately: it reads the manifest and hashes the
 * masters, both of which are committed. `npm run audio` is the half with a
 * host requirement, and a clean checkout never has to run it.
 *
 * Five checks, and each one is a failure that is otherwise silent:
 *
 * - **Stale.** A master edited without re-running the generator ships the OLD
 *   sound, and the diff looks like the new one landed. Same shape as
 *   `check-collision.mjs` refusing a bake older than its layout.
 * - **Budget.** Summed mono-seconds against the manifest's ceiling. RAM is
 *   `duration * rate * channels * 4` and nothing else, so seconds is the unit
 *   and a stereo row costs two of them per second.
 * - **Wired.** Every encoded file is imported by `src/core/samples.ts` and
 *   every url it imports has a row here. An encoded file nobody loads is dead
 *   weight in the download; a row in `samples.ts` with no generator behind it
 *   is the authored-asset problem this whole pipeline exists to retire.
 * - **Present.** The encoded output exists at all.
 * - **Counted.** Every place the docs state HOW MANY sounds there are, or how
 *   many masters, or what the directory weighs, against what the manifest
 *   actually holds — see `CLAIMS` below for why that is worth a check rather
 *   than a habit.
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const AUDIO = join(ROOT, "audio");
const SAMPLES = join(ROOT, "src", "core", "samples.ts");

const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex").slice(0, 16);
const fail = (lines) => {
  console.error(`check-audio: ${lines.join("\n  ")}`);
  process.exit(1);
};

const manifest = JSON.parse(readFileSync(join(AUDIO, "manifest.json"), "utf8"));
const source = readFileSync(SAMPLES, "utf8");
// Every `?url` import in samples.ts, as the path it names.
const imported = new Set(
  [...source.matchAll(/from\s+"[^"]*\/audio\/([^"?]+)\?url"/g)].map((m) => m[1]),
);

const problems = [];
let spent = 0;

for (const row of manifest.samples) {
  const src = join(AUDIO, row.source);
  const out = join(AUDIO, row.out);

  if (!existsSync(src)) {
    problems.push(`${row.id}: master missing at audio/${row.source}`);
    continue;
  }
  if (!existsSync(out)) {
    problems.push(`${row.id}: audio/${row.out} has never been encoded — run \`npm run audio\``);
    continue;
  }
  if (!row.sourceHash || !row.decoded) {
    problems.push(`${row.id}: manifest has no sourceHash/decoded — run \`npm run audio\``);
    continue;
  }
  if (sha(src) !== row.sourceHash) {
    problems.push(
      `${row.id}: audio/${row.source} has changed since audio/${row.out} was encoded — ` +
      `run \`npm run audio\`. The build would otherwise ship the OLD sound.`,
    );
  }
  if (!imported.has(row.out)) {
    problems.push(
      `${row.id}: audio/${row.out} is encoded but src/core/samples.ts imports no such file, ` +
      `so it would be committed and never loaded`,
    );
  }
  spent += row.decoded.seconds * row.decoded.channels;
}

for (const file of imported) {
  if (!manifest.samples.some((r) => r.out === file)) {
    problems.push(
      `src/core/samples.ts imports audio/${file}, which has no row in audio/manifest.json — ` +
      `every shipped sound needs a committed master and a generator behind it (docs/build.md)`,
    );
  }
}

/**
 * The countable claims the prose makes, and where each one lives.
 *
 * **Every number here is derivable from the manifest, which is exactly why it
 * drifts**: a row added or a master replaced changes four files' worth of
 * arithmetic, none of it load-bearing, none of it typechecked, and all of it
 * quoted with the confidence of something that was true once. Adding the
 * seventeenth row found "eleven masters" in `docs/audio.md` that had been
 * twelve for two rows, and `docs/build.md` still quoting a download size two
 * sounds out of date. Nothing breaks; the contract just stops being true in
 * the small way that makes a reader stop trusting the large way.
 *
 * **A pattern that matches NOTHING is a failure too, and that is the half
 * worth having.** A claim reworded out of existence would otherwise silently
 * take its check with it, which is the same trap `check-proving.mjs` guards
 * from the other side — so a sentence that moves has to be re-pointed here
 * deliberately.
 *
 * The prose is matched with its whitespace collapsed, so re-wrapping a
 * paragraph is free and only the WORDS are the claim.
 */
const NUMBER_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
  "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
  "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
];
const spoken = (n) => NUMBER_WORDS[n] ?? String(n);
const said = (raw) => {
  const i = NUMBER_WORDS.indexOf(raw.toLowerCase());
  return i >= 0 ? i : Number(raw);
};

const rows = manifest.samples.length;
const masters = new Set(manifest.samples.map((r) => r.source)).size;
const mono = manifest.samples.filter((r) => r.decoded.channels === 1).length;
const shippedKb = +(
  manifest.samples.reduce((t, r) => t + statSync(join(AUDIO, r.out)).size, 0) / 1024
).toFixed(1);

const CLAIMS = [
  ["CLAUDE.md", /and (\w+) audio files/, [rows]],
  ["CLAUDE.md", /but for those (\w+)\./, [rows]],
  ["CLAUDE.md", /which is what keeps (\w+) files serving/, [rows]],
  ["docs/audio.md", /\*\*(\w+) files sit on top of it/, [rows]],
  ["docs/audio.md", /([\d.]+) KB downloaded once, ([\d.]+) of the (\d+) mono-seconds/,
    [shippedKb, +spent.toFixed(2), manifest.budget.decodedSeconds]],
  ["docs/audio.md", /(\w+) of the (\w+) rows take that exception and the (\w+) that do not/,
    [rows - mono, rows, mono]],
  ["docs/audio.md", /the (\w+) are (\w+)-(\w+) rather than/, [rows, rows - mono, mono]],
  ["docs/audio.md", /(\w+) masters carry (\w+) rows/, [masters, rows]],
  ["docs/audio.md", /(\w+) masters and (\w+) cuts\./, [masters, rows]],
  ["docs/audio.md", /they carry six of the (\w+) rows/, [rows]],
  ["docs/build.md", /\(([\d.]+) KB shipped, (\w+) sounds off (\w+) masters\)/,
    [shippedKb, rows, masters]],
];

for (const [file, re, want] of CLAIMS) {
  const flat = readFileSync(join(ROOT, file), "utf8").replace(/\s+/g, " ");
  const hits = [...flat.matchAll(new RegExp(re.source, "g"))];
  if (hits.length !== 1) {
    problems.push(
      `${file}: the claim /${re.source}/ matches ${hits.length} times, not once — ` +
      `a sentence carrying a countable fact was reworded or removed, so re-point ` +
      `or drop its row in CLAIMS (scripts/check-audio.mjs)`,
    );
    continue;
  }
  hits[0].slice(1).forEach((raw, i) => {
    if (said(raw) !== want[i]) {
      problems.push(
        `${file}: says "${raw}" where the manifest says ${want[i]} ` +
        `(/${re.source}/, capture ${i + 1}) — the docs state ${spoken(want[i])}`,
      );
    }
  });
}

const budget = manifest.budget.decodedSeconds;
if (spent > budget) {
  problems.push(
    `audio is over budget: ${spent.toFixed(2)} mono-seconds against a ceiling of ${budget} ` +
    `(${((spent * 48000 * 4) / 1048576).toFixed(1)} MB decoded). Cut a sound, make one mono, ` +
    `or raise the ceiling in audio/manifest.json deliberately — see docs/audio.md.`,
  );
}

if (problems.length) fail(problems);

console.log(
  `check-audio: ${manifest.samples.length} sample(s), ` +
  `${spent.toFixed(2)}/${budget} mono-seconds ` +
  `(${((spent / budget) * 100).toFixed(1)}% of budget), all fresh.`,
);
