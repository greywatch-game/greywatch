/**
 * The one place ffmpeg is found, run and asked what a file is.
 *
 * Shared by `encode-audio.mjs`, which CUTS the masters, and
 * `measure-audio.mjs`, which MEASURES them — the two scripts that reach for a
 * binary this repo does not ship. It is one module for the reason
 * `browser.mjs` is: two copies of "where is ffmpeg on this machine" drift, and
 * the failure when one of them drifts is a script that reports the AUDIO is
 * broken.
 *
 * `MASTER` lives here for a stronger version of the same reason. It is the
 * claim `audio/src/` makes about every file in it, and both scripts depend on
 * it — the generator refuses a master that breaks it, and every measurement
 * the other one prints is quoted in dBFS and milliseconds that only mean
 * anything at a known rate and depth.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * What a master may be, and the check is here rather than in prose because git
 * never forgets a binary. Mono/stereo is the row's own choice, but 48 kHz
 * 16-bit PCM is not: a 96 kHz 24-bit master is six times the bytes for
 * information `decodeAudioData` throws away on the way to the context rate,
 * and by the time anyone notices it is in the history for good.
 */
export const MASTER = { rate: 48000, codec: "pcm_s16le" };

/** ffmpeg and ffprobe, wherever this machine keeps them. */
export function tool(name) {
  const local = join(ROOT, "tools", `${name}.exe`);
  return existsSync(local) ? local : name;
}

export function run(bin, args, opts = {}) {
  try {
    return execFileSync(bin, args, {
      encoding: opts.binary ? "buffer" : "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: opts.maxBuffer ?? 1024 * 1024 * 512,
    });
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(
        `${bin} is not on PATH. The audio scripts need ffmpeg and ffprobe — it is a ` +
        `requirement of the GENERATOR, not of the build: the encoded files are ` +
        `committed, so nothing else in this repo needs them. See docs/build.md.`,
      );
    }
    throw new Error(`${bin} failed: ${err.stderr || err.message}`);
  }
}

/** Everything ffprobe knows about a file's one audio stream. */
export function probe(file) {
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

/**
 * A window of a file as `Float32Array`s, one per channel, at the file's own
 * rate — optionally through a filter graph first.
 *
 * **The seek is an INPUT seek and that is load-bearing here as it is in the
 * generator**: an output seek would run the filter graph over the whole file
 * and then discard frames, so a filter with any state in it (every one below
 * has) would be measured having already run over material the caller asked to
 * leave out. Input seeking is exact on PCM — there are no keyframes in a WAV.
 */
export function pcm(file, { start = 0, duration = null, filter = null } = {}) {
  const args = ["-v", "error"];
  if (start) args.push("-ss", String(start));
  args.push("-i", file);
  if (duration !== null) args.push("-t", String(duration));
  if (filter) args.push("-af", filter);
  args.push("-f", "f32le", "-acodec", "pcm_f32le", "-");
  const buf = run(tool("ffmpeg"), args, { binary: true });
  const flat = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
  const ch = filter && /channel_layouts=mono/.test(filter) ? 1 : probe(file).channels;
  if (ch === 1) return [flat];
  const n = Math.floor(flat.length / ch);
  const out = Array.from({ length: ch }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) out[c][i] = flat[i * ch + c];
  return out;
}
