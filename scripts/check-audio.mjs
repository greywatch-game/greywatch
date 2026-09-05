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
 * Four checks, and each one is a failure that is otherwise silent:
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
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
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
