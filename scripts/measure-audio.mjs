/**
 * `npm run audio:measure` — everything a manifest row's note is written from.
 *
 * **`encode-audio.mjs` spends the numbers in a `trim`; this is where they come
 * from.** Every row in `audio/manifest.json` argues its cut from measurements
 * — a trough in front of an onset, a high band that has stopped decaying, two
 * channels coming apart, a mono sum that cancels — and until this existed
 * those measurements were made by whoever was cutting the row, in throwaway
 * scripts, and then thrown away. That is the one thing a committed master and
 * a reviewable `trim` were supposed to prevent: **a decision nobody can re-run
 * is a decision nobody can review**, and two rows measured two different ways
 * do not disagree loudly, they just quote numbers that cannot be compared.
 *
 * It DECIDES nothing, deliberately. `docs/audio.md` is the contract and the
 * rules there are argued rather than mechanical — what the width exception is
 * for, when a plateau is a room, what a sample may contain. This prints what
 * the file is; the row's note still has to say what that means and why.
 *
 * ```
 * node scripts/measure-audio.mjs audio/src/explosion.wav
 * node scripts/measure-audio.mjs audio/src/explosion.wav --trim 0:0.95
 * node scripts/measure-audio.mjs --row explosion
 * node scripts/measure-audio.mjs audio/src/explosion.wav --against audio/src/grenade.wav
 * node scripts/measure-audio.mjs --all
 * node scripts/measure-audio.mjs --decode
 * ```
 *
 * `--trim` is the important one: **a row's shape is a claim about ITS CUT and
 * not about the master**, which is the trap the assault rifle's row records
 * from the other side — width measured over a whole file said one thing and
 * the shipped 90 ms said another. Every figure below the ENVELOPE is measured
 * over the cut, so quote them with the trim that produced them.
 *
 * `--decode` is the only check here that is not arithmetic on a file: it boots
 * the real game in the real browser and asks whether every row DECODED. A
 * container this repo can encode is not necessarily one `decodeAudioData`
 * accepts, the fetch is fire-and-forget so nothing in the game complains, and
 * the failure is a sound that is silently the synthesis forever. **Adding a
 * new CALLER owes one more check this cannot make**: ring it and watch
 * `sfx.voices` go up by exactly ONE, because the synthesis it replaces is
 * three or four layers and three voices means the sample arm never fired.
 *
 * Needs ffmpeg and ffprobe, on the terms `docs/build.md` sets for the
 * generator: a requirement of the tool and never of the build.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MASTER, pcm, probe } from "./ffmpeg.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const AUDIO = join(ROOT, "audio");

/** `Sfx`'s own leading-silence floor. A start above this is one it will keep. */
const SAMPLE_FLOOR_DB = -54;
/** Where a room's late field is taken to have taken over. See `tankCannon`. */
const DECORRELATED = 0.6;

const db = (x) => 20 * Math.log10(Math.max(Math.abs(x), 1e-9));
const f = (x, w = 6, p = 1) => (Number.isFinite(x) ? x.toFixed(p) : "—").padStart(w);
const ms = (x) => `${(x * 1000).toFixed(0)}`.padStart(5);

function rms(a, s = 0, n = a.length - s) {
  let t = 0;
  for (let i = s; i < s + n; i++) t += a[i] * a[i];
  return Math.sqrt(t / n);
}

/** Two-pole pairs, so a "band" here is steep enough to mean something. */
const band = (lo, hi) =>
  "aformat=channel_layouts=mono" +
  (lo ? `,highpass=f=${Math.round(lo)}:poles=2,highpass=f=${Math.round(lo)}:poles=2` : "") +
  (hi ? `,lowpass=f=${Math.round(hi)}:poles=2,lowpass=f=${Math.round(hi)}:poles=2` : "");

// ---------------------------------------------------------------- arguments

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? null : (argv[i + 1] ?? "");
};
const has = (name) => argv.includes(`--${name}`);

const manifest = JSON.parse(readFileSync(join(AUDIO, "manifest.json"), "utf8"));

let file = argv.find((a) => !a.startsWith("--") && /\.(wav|webm|ogg|mp3|flac)$/i.test(a)) ?? null;
let trim = null;
const rowId = flag("row");
if (rowId) {
  const row = manifest.samples.find((r) => r.id === rowId);
  if (!row) throw new Error(`no row "${rowId}" in audio/manifest.json`);
  file = join(AUDIO, row.source);
  trim = { start: row.trim?.start ?? 0, end: row.trim?.end ?? null, row };
}
const trimArg = flag("trim");
if (trimArg) {
  const [a, b] = trimArg.split(":").map(Number);
  trim = { start: a || 0, end: Number.isFinite(b) ? b : null };
}

// ------------------------------------------------------------- measurements

/** The width and sum tests, over one window of one file. Both decide a row. */
function widthOf(file, start, duration) {
  const [L, R] = pcm(file, { start, duration });
  if (!R) return { mono: true };
  const n = L.length;
  let mm = 0, ss = 0, mp = 0, sp = 0, ll = 0, rr = 0, lr = 0;
  for (let i = 0; i < n; i++) {
    const m = 0.5 * (L[i] + R[i]);
    const s = 0.5 * (L[i] - R[i]);
    mm += m * m; ss += s * s; ll += L[i] * L[i]; rr += R[i] * R[i]; lr += L[i] * R[i];
    mp = Math.max(mp, Math.abs(m)); sp = Math.max(sp, Math.abs(s));
  }
  const mono = Math.sqrt(mm / n);
  const chan = Math.sqrt((ll + rr) / (2 * n));
  return {
    mono: false,
    rms: db(Math.sqrt(mm / n)) - db(Math.sqrt(ss / n)),
    peak: db(mp) - db(sp),
    r: lr / Math.sqrt(Math.max(ll * rr, 1e-20)),
    // What the DOWNMIX costs, which is a second question the first one cannot
    // answer: `tankCannon`'s channels go negatively correlated past 230 ms, so
    // a longer cut would have arrived thinner in the game than on disk.
    sumLoss: db(chan) - db(mono),
    monoPeak: db(mp),
  };
}

function envelope(file, start, duration, winSec) {
  const [L, R] = pcm(file, { start, duration });
  const hi = pcm(file, { start, duration, filter: band(3500, null) })[0];
  const lo = pcm(file, { start, duration, filter: band(null, 300) })[0];
  const n = L.length;
  const W = Math.max(1, Math.round(winSec * MASTER.rate));
  const rows = [];
  for (let s = 0; s + W <= n; s += W) {
    let mm = 0, ss = 0, ll = 0, rr = 0, lr = 0, pk = 0;
    for (let i = s; i < s + W; i++) {
      const m = R ? 0.5 * (L[i] + R[i]) : L[i];
      const sd = R ? 0.5 * (L[i] - R[i]) : 0;
      mm += m * m; ss += sd * sd; pk = Math.max(pk, Math.abs(m));
      if (R) { ll += L[i] * L[i]; rr += R[i] * R[i]; lr += L[i] * R[i]; }
    }
    rows.push({
      t: start + s / MASTER.rate,
      mid: db(Math.sqrt(mm / W)),
      peak: db(pk),
      hi: db(rms(hi, s, W)),
      lo: db(rms(lo, s, W)),
      width: R ? db(Math.sqrt(mm / W)) - db(Math.sqrt(ss / W)) : Infinity,
      r: R ? lr / Math.sqrt(Math.max(ll * rr, 1e-20)) : 1,
    });
  }
  return rows;
}

function octaves(file, start, duration) {
  const full = rms(pcm(file, { start, duration, filter: band(null, null) })[0]);
  return [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000].map((b) => [
    b,
    db(rms(pcm(file, { start, duration, filter: band(b / Math.SQRT2, b * Math.SQRT2) })[0]) / full),
  ]);
}

/**
 * Is this the same recording as that one? The replacement test, and the reason
 * it is here is that "a bigger take of the same event" and "a longer copy of
 * the file you already had" are indistinguishable in an envelope.
 */
function against(a, b, seconds = 0.5) {
  const x = pcm(a, { duration: seconds, filter: band(null, null) })[0];
  const y = pcm(b, { duration: seconds, filter: band(null, null) })[0];
  const n = Math.min(x.length, y.length);
  let best = 0, bestLag = 0;
  for (let lag = -2400; lag <= 2400; lag += 8) {
    let s = 0, aa = 0, bb = 0;
    for (let i = 0; i < n; i++) {
      const u = x[i] ?? 0, v = y[i + lag] ?? 0;
      s += u * v; aa += u * u; bb += v * v;
    }
    const r = s / Math.sqrt(Math.max(aa * bb, 1e-20));
    if (Math.abs(r) > Math.abs(best)) { best = r; bestLag = lag; }
  }
  return { r: best, lagMs: bestLag / (MASTER.rate / 1000) };
}

// ------------------------------------------------------------------ reports

function report(file, trim) {
  const info = probe(file);
  const start = trim?.start ?? 0;
  const end = trim?.end ?? info.seconds;
  const duration = +(end - start).toFixed(6);
  const cut = trim ? ` cut ${ms(start)}–${ms(end)} ms` : " whole file";

  console.log(`\n${file}`);
  console.log(
    `  ${info.codec} ${info.rate} Hz ${info.channels}ch  ${(info.seconds * 1000).toFixed(0)} ms` +
    `  ·${cut} (${(duration * 1000).toFixed(0)} ms)`,
  );
  if (info.codec !== MASTER.codec || info.rate !== MASTER.rate) {
    console.log(`  ! not a MASTER: wants ${MASTER.codec} at ${MASTER.rate} Hz (scripts/ffmpeg.mjs)`);
  }

  // The ENVELOPE is measured over the WHOLE file even under a --trim: where to
  // cut is a question about what is on either side of the cut.
  const winMs = Number(flag("win") ?? (info.seconds > 1.2 ? 20 : 10));
  const env = envelope(file, 0, info.seconds, winMs / 1000);
  const top = Math.max(...env.map((r) => r.mid));
  console.log(`\n  envelope, ${winMs} ms windows, dB relative to the loudest (${f(top, 5)} dBFS)`);
  console.log("     t(ms)    mid   >3.5k   <300   m/s      r");
  for (const r of env) {
    if (r.mid < top - 70) continue;
    const inCut = r.t >= start && r.t < end;
    console.log(
      `  ${inCut ? "·" : " "}${ms(r.t)} ${f(r.mid - top)} ${f(r.hi - top)} ${f(r.lo - top)}` +
      ` ${f(r.width, 6)} ${f(r.r, 6, 2)}`,
    );
  }

  // The START rule: `Sfx.trimSample` only takes what is under its own floor,
  // so anything louder than that ships as LATENCY between the trigger and the
  // sound — and a start belongs in the TROUGH in front of the onset rather
  // than hard against it, so the cut cannot click and the transient keeps a
  // foot. Both are measured per millisecond and never off the envelope above:
  // a window wide enough to find a knee is far too wide to place a cut inside
  // an attack.
  const fine = envelope(file, 0, Math.min(info.seconds, 0.25), 0.001);
  const finePeak = Math.max(...fine.map((r) => r.peak));
  const first = fine.find((r) => r.peak - finePeak > SAMPLE_FLOOR_DB);
  if (first) {
    const before = fine.slice(0, fine.indexOf(first));
    const trough = before.length ? before.reduce((a, b) => (b.peak < a.peak ? b : a)) : null;
    const under = trough && trough.peak - finePeak < SAMPLE_FLOOR_DB;
    console.log(
      `\n  onset   first millisecond over ${SAMPLE_FLOOR_DB} dBFS at ${ms(first.t)} ms` +
      (trough
        ? `, quietest one in front of it ${ms(trough.t)} ms at ${f(trough.peak - finePeak)} dB` +
          (under ? " — under the floor, so a cut there needs no fade in" : "")
        : ", nothing in front of it"),
    );
  }

  // The ROOM rule, read off the channels rather than the envelope.
  const runs = [];
  let run = 0;
  for (const r of env) {
    if (r.r < DECORRELATED && r.mid > top - 60) { run += 1; if (run === 3) runs.push(r.t); }
    else run = 0;
  }
  console.log(
    `  room    ${runs.length
      ? `channels first hold r < ${DECORRELATED} for three windows at ${ms(runs[0])} ms — a late field`
      : `no sustained r < ${DECORRELATED} anywhere — nothing here reads as a decorrelated late field`}`,
  );

  const w = widthOf(file, start, duration);
  if (!w.mono) {
    console.log(
      `\n  width   side ${f(w.rms, 5)} dB under the mid in RMS, ${f(w.peak, 5)} at peak, r ${f(w.r, 5, 2)}` +
      `\n  sum     mono downmix ${f(w.sumLoss, 5, 2)} dB under the channel average, peak ${f(w.monoPeak, 5)} dBFS`,
    );
    if (w.sumLoss > 0.5) console.log("  !       the sum CANCELS: a mono row would arrive thinner than this measures");
  }

  console.log("\n  octaves over the cut, dB relative to its own full-band RMS");
  console.log("   " + octaves(file, start, duration).map(([b, v]) => `${b}:${v.toFixed(1)}`).join("  "));

  const chans = trim?.row?.channels ?? (w.mono ? 1 : null);
  const spent = manifest.samples.reduce((t, r) => t + r.decoded.seconds * r.decoded.channels, 0);
  console.log(
    `\n  budget  this cut is ${duration.toFixed(3)} × ${chans ?? "?"}ch of the ` +
    `${manifest.budget.decodedSeconds} mono-second ceiling; the directory spends ${spent.toFixed(3)} today`,
  );

  const other = flag("against");
  if (other) {
    const x = against(file, other);
    console.log(
      `\n  against ${other}\n` +
      `          peak cross-correlation ${f(x.r, 5, 3)} at ${f(x.lagMs, 5)} ms over the first 500 ms — ` +
      `${Math.abs(x.r) > 0.8 ? "the SAME take" : "a different recording"}`,
    );
    const a = octaves(file, start, duration);
    const b = octaves(other, 0, Math.min(probe(other).seconds, duration));
    console.log("          octave deltas (this − that): " +
      a.map(([hz, v], i) => `${hz}:${(v - b[i][1]).toFixed(1)}`).join("  "));
  }
}

/** One line per shipped row: the audit that says the directory is consistent. */
function all() {
  console.log("row               cut(ms)  ch   side/RMS  side/peak     r   sum  peak dBFS");
  for (const row of manifest.samples) {
    const src = join(AUDIO, row.source);
    const start = row.trim?.start ?? 0;
    const end = row.trim?.end ?? probe(src).seconds;
    const w = widthOf(src, start, +(end - start).toFixed(6));
    console.log(
      `${row.id.padEnd(16)} ${String(Math.round((end - start) * 1000)).padStart(7)} ` +
      `${String(row.channels ?? manifest.defaults.channels).padStart(3)} ` +
      (w.mono
        ? "        (mono master)"
        : `${f(w.rms, 10)} ${f(w.peak, 10)} ${f(w.r, 5, 2)} ${f(w.sumLoss, 5, 2)} ${f(w.monoPeak, 10)}`),
    );
  }
}

/**
 * Does the real browser decode all of them? The one check here that is not
 * arithmetic — see the header. Deps are imported inside the branch so the
 * measuring half never pays for Playwright.
 */
async function decode() {
  const { startDevServer } = await import("./dev-server.mjs");
  const { launchClient } = await import("./browser.mjs");
  const server = await startDevServer(ROOT);
  const browser = await launchClient();
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 200)));
    await page.goto(server.url, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__celshock, null, { timeout: 90000 });
    await page.mouse.click(400, 300);
    await page.evaluate(() => window.__celshock.sfx.unlock());
    const want = manifest.samples.length;
    const got = await page.waitForFunction(
      (n) => {
        const s = window.__celshock.sfx.samples;
        return s.size >= n
          ? [...s.entries()].map(([id, v]) => ({
              id,
              seconds: +v.buffer.duration.toFixed(3),
              channels: v.buffer.numberOfChannels,
              rate: v.buffer.sampleRate,
              offset: +v.offset.toFixed(4),
            }))
          : null;
      },
      want,
      { timeout: 30000 },
    ).then((h) => h.jsonValue());
    let bad = 0;
    for (const row of manifest.samples) {
      const d = got.find((g) => g.id === row.id);
      const want = row.decoded;
      const ok = d && d.channels === want.channels && Math.abs(d.seconds - want.seconds) < 0.02;
      if (!ok) bad += 1;
      console.log(
        `  ${ok ? "ok  " : "FAIL"} ${row.id.padEnd(16)} ` +
        (d ? `${d.seconds.toFixed(3)}s ${d.channels}ch @${d.rate} (manifest ${want.seconds}s ${want.channels}ch)` : "never decoded"),
      );
    }
    console.log(`\n${got.length}/${want} rows decoded in the browser, ${bad} disagreeing with the manifest`);
    if (bad) process.exitCode = 1;
  } finally {
    await browser.close();
    server.close?.();
    process.exit(process.exitCode ?? 0);
  }
}

// ---------------------------------------------------------------------- run

if (has("decode")) {
  await decode();
} else if (has("all")) {
  all();
} else if (file) {
  report(file, trim);
} else {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]
    .split("\n").slice(2).map((l) => l.replace(/^ \* ?/, "")).join("\n"));
}
