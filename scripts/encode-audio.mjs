/**
 * `npm run audio` — cuts every master in `audio/manifest.json` and encodes it.
 *
 * The fifth generator in `package.json`, and it exists so the one authored
 * asset class in the tree passes the same test the other four do: a generator
 * here, its output committed, and the input that produced it committed beside
 * it. See `docs/build.md` for that test and `docs/audio.md` for the budget.
 *
 * **The CUT is in the manifest and never in the master.** A master is the
 * recording as delivered; what gets shipped is a start, an end and a fade
 * stated as numbers a reviewer can read in a diff. That is the whole reason
 * the raw file is committed rather than a pre-trimmed one — a trim baked into
 * a binary is a decision nobody can see, re-run or argue with, and the trims
 * in this project are load-bearing (the rifle's exists to stop a baked room
 * fighting the shared convolution reverb).
 *
 * **It needs ffmpeg on PATH and says so rather than half-running.** `/tools/`
 * is gitignored, so the binary that happens to be on the machine this was
 * written on is not in the repo. That is the same bargain `npm run shots`
 * makes by needing a real GPU and a display: a requirement of the GENERATOR,
 * documented, and not a requirement of building or playing the game — the
 * encoded files are committed, so a clean checkout never runs this.
 *
 * Writes `sourceHash` and `decoded` back into the manifest. Those two are the
 * only fields it authors, and they are what `scripts/check-audio.mjs` reads to
 * refuse a stale or over-budget build.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const AUDIO = join(ROOT, "audio");
const MANIFEST = join(AUDIO, "manifest.json");

/**
 * What a master may be, and the check is here rather than in prose because git
 * never forgets a binary. Mono/stereo is the row's own choice, but 48 kHz
 * 16-bit PCM is not: a 96 kHz 24-bit master is six times the bytes for
 * information `decodeAudioData` throws away on the way to the context rate,
 * and by the time anyone notices it is in the history for good.
 */
const MASTER = { rate: 48000, codec: "pcm_s16le" };

/** ffmpeg and ffprobe, wherever this machine keeps them. */
function tool(name) {
  const local = join(ROOT, "tools", `${name}.exe`);
  return existsSync(local) ? local : name;
}

function run(bin, args) {
  try {
    return execFileSync(bin, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(
        `${bin} is not on PATH. \`npm run audio\` needs ffmpeg and ffprobe — it is a ` +
        `requirement of the GENERATOR, not of the build: the encoded files are ` +
        `committed, so nothing else in this repo needs them. See docs/build.md.`,
      );
    }
    throw new Error(`${bin} failed: ${err.stderr || err.message}`);
  }
}

/** Everything ffprobe knows about a file's one audio stream. */
function probe(file) {
  const out = run(tool("ffprobe"), [
    "-v", "error", "-select_streams", "a:0",
    "-show_entries", "stream=codec_name,sample_rate,channels,duration",
    "-of", "json", file,
  ]);
  const s = JSON.parse(out).streams?.[0];
  if (!s) throw new Error(`${file}: no audio stream`);
  return {
    codec: s.codec_name,
    rate: Number(s.sample_rate),
    channels: Number(s.channels),
    seconds: Number(s.duration),
  };
}

const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 16);

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const d = manifest.defaults;
let spent = 0;

for (const row of manifest.samples) {
  const src = join(AUDIO, row.source);
  const out = join(AUDIO, row.out);
  if (!existsSync(src)) throw new Error(`${row.id}: master missing at ${row.source}`);

  const master = probe(src);
  if (master.codec !== MASTER.codec || master.rate !== MASTER.rate) {
    throw new Error(
      `${row.id}: master must be ${MASTER.codec} at ${MASTER.rate} Hz, ` +
      `got ${master.codec} at ${master.rate}. See MASTER in this file for why.`,
    );
  }

  const channels = row.channels ?? d.channels;
  const trim = row.trim ?? {};
  const start = trim.start ?? 0;
  const end = trim.end ?? master.seconds;
  const fade = trim.fadeOut ?? 0;
  if (end <= start) throw new Error(`${row.id}: trim.end must be past trim.start`);
  if (end > master.seconds + 1e-6) {
    throw new Error(`${row.id}: trim.end ${end}s is past the master's ${master.seconds}s`);
  }
  const seconds = +(end - start).toFixed(6);

  // Downmix explicitly rather than through `-ac 1`: ffmpeg's own stereo->mono
  // matrix can sum correlated channels past full scale, and a gunshot's two
  // channels are highly correlated. Halving is the safe average.
  const filters = [];
  if (channels === 1 && master.channels === 2) filters.push("pan=mono|c0=0.5*c0+0.5*c1");
  // The fade is measured from the END of the cut, so a change to `end` carries
  // it along rather than stranding it mid-sound. It is therefore stated in the
  // CUT's own seconds, which is why the seek below has to be an INPUT one.
  if (fade > 0) filters.push(`afade=t=out:st=${+(seconds - fade).toFixed(6)}:d=${fade}`);

  run(tool("ffmpeg"), [
    "-v", "error", "-y",
    // **`-ss` goes BEFORE `-i` and that is load-bearing, not a style.** An
    // output seek discards frames AFTER the filter graph has run, so the graph
    // still sees the master's own timeline while `afade`'s `st` is measured
    // from the start of the CUT — and the fade therefore lands `start` seconds
    // early, taking everything after it to DIGITAL SILENCE. It shipped that
    // way: the three rows with a non-zero `start` were all truncated, worst on
    // the LMG, whose row argues for a fade over 140–170 ms and whose file was
    // silent from 90. A row starting at 0 is unaffected, which is why this
    // survived seven files. Input seeking is exact on PCM — there are no
    // keyframes in a WAV — so it costs nothing.
    "-ss", String(start),
    "-i", src,
    "-t", String(seconds),
    ...(filters.length ? ["-af", filters.join(",")] : []),
    "-ac", String(channels),
    "-c:a", row.codec ?? d.codec,
    "-b:a", row.bitrate ?? d.bitrate,
    ...(( row.container ?? d.container) === "webm" ? ["-f", "webm"] : []),
    out,
  ]);

  const enc = probe(out);
  // RAM is duration * ctx.sampleRate * channels * 4 and nothing else — see the
  // budget note in the manifest. Quoted at 48 kHz, which is what every browser
  // measured here runs its context at.
  const kb = +((seconds * 48000 * channels * 4) / 1024).toFixed(1);
  row.sourceHash = sha(src);
  row.decoded = { seconds, channels, kb };
  spent += seconds * channels;

  const bytes = readFileSync(out).length;
  console.log(
    `${row.id.padEnd(16)} ${row.out.padEnd(24)} ` +
    `cut ${(seconds * 1000).toFixed(0)}ms of ${(master.seconds * 1000).toFixed(0)}ms  ` +
    `${channels}ch  ${(bytes / 1024).toFixed(1)} KB file  ${kb} KB decoded`,
  );
  if (Math.abs(enc.channels - channels) > 0) {
    console.log(`  ! ${row.id}: encoder wrote ${enc.channels} channels, wanted ${channels}`);
  }
}

writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
const budget = manifest.budget.decodedSeconds;
console.log(
  `\naudio budget: ${spent.toFixed(3)} of ${budget} mono-seconds ` +
  `(${((spent / budget) * 100).toFixed(1)}%), ` +
  `${((spent * 48000 * 4) / 1048576).toFixed(2)} MB decoded`,
);
