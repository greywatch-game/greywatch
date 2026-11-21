/**
 * The simulation oracle: what a change to WHO HOSTS the core may not move —
 * the fight `simulate` plays, every assertion `corecheck` makes, and the
 * benchmark's seeded fight — banked once at a parent and graded at every commit
 * after it (`BABYLON_EXIT.md` X2.5c C0).
 *
 *   node plans/sim-ref/sim.mjs [map...] [--bank] [--no-build]
 *        [--keep dir] [--diff dir] [--no-simulate] [--no-corecheck]
 *        [--bench f.json]
 *
 * **Three banks, one file each in `ref/`, each saying the commit it was taken
 * at:**
 *
 * - `simulate.json` — per map, the round `simulate <map> 1 1 777 --events`
 *   plays: its `fight` hash, and the md5 and count of its EVENT LINES (the
 *   `<tick> <kind> <fields>` list `--events` prints, `VERIFYING.md`'s
 *   `grep -E "^[0-9]+ [a-z]"`). The fight hash folds deaths and awards; the
 *   event list is every piece of news `Match` puts on the wire, so it is the
 *   stricter of the two and the one a relay change would move.
 * - `corecheck.json` — every line `corecheck` reports (each `ok`, and each
 *   crash-calibration row), its wall-clock total stripped. The lines carry
 *   their numbers — the event-stream digests, the ticks a leash took, a
 *   crash's charge — so a line that changed is a behaviour that changed. A
 *   check passes when `corecheck` passes AND every banked line appears, in
 *   order; a line it has never printed is reported as NEW and is not a
 *   failure, since a step may add assertions (X2.5c C3 adds a run through the
 *   local transport).
 * - `bench.json` — the benchmark's seven fight hashes (`?bench=<map>`,
 *   `bench.fight.hash`). A browser with a GPU is needed to read one, so this
 *   script does not run the benchmark: `--bench f.json` grades an `--out` file
 *   from `plans/webgpu-ref/bench.mjs` (`VERIFYING.md` says how to run it off a
 *   static build), and `--bank --bench f.json` banks one.
 *
 * **The event lists themselves are NOT banked** — about 0.8 MB a map — only
 * their fingerprints. When one moves, the first differing line is what names
 * the divergence: `--keep dir` writes each map's list to `dir/<map>.events`,
 * and a later run with `--diff dir` prints the first line that differs from
 * the kept one. So keep the parent's lists in a scratch directory before
 * starting a step.
 *
 * Without `--bank` it grades and exits non-zero on any difference. `--bank`
 * replaces what it ran (the maps named unless `--no-simulate`, corecheck
 * unless `--no-corecheck`, the bench if `--bench` is given) and leaves the
 * rest, so a bench read later is banked with `--bank --no-simulate
 * --no-corecheck --bench f.json` — from a tree at the commit the bench was
 * built from, since every bank records the commit it was taken at. It builds
 * the server bundle first (`vite build -c vite.server.config.ts`) whenever it
 * runs `simulate` or `corecheck`, unless `--no-build`.
 *
 * Seed 777 and difficulty 1 are every `simulate` hash this plan has quoted
 * since X0.2; one round, because a second from the same seed is the same
 * round (`simulate`'s header), and `--events` prints the first one.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MAPS, root } from "../../scripts/collision-hash.mjs";

const REF = join(root, "plans", "sim-ref", "ref");
const SEED = 777;
const DIFFICULTY = 1;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const valued = new Set(["--keep", "--diff", "--bench"]);
const maps = args.filter((a, i) => !a.startsWith("--") && !valued.has(args[i - 1]));
const ids = MAPS.map((m) => m.id);
for (const id of maps) if (!ids.includes(id)) throw new Error(`unknown map ${id}`);
const targets = maps.length ? maps : ids;
const BANK = flag("--bank");
const KEEP = value("--keep");
const DIFF = value("--diff");
const BENCH = value("--bench");
const SIMULATE = !flag("--no-simulate");
const CORECHECK = !flag("--no-corecheck");

const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain", "--", "src", "server"], { cwd: root, encoding: "utf8" }).trim() !== "";
const at = dirty ? `${commit}+` : commit;

const load = (file) => (existsSync(join(REF, file)) ? JSON.parse(readFileSync(join(REF, file), "utf8")) : null);
const save = (file, data) => {
  mkdirSync(REF, { recursive: true });
  writeFileSync(join(REF, file), `${JSON.stringify(data, null, 1)}\n`);
  console.log(`banked ref/${file} at ${at}`);
};

const failures = [];

if ((SIMULATE || CORECHECK) && !flag("--no-build")) {
  console.log("building the server bundle…");
  run(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "build", "-c", "vite.server.config.ts"]);
}

// ---------------------------------------------------------------- simulate --
if (SIMULATE) {
  const banked = load("simulate.json");
  const now = {};
  for (const id of targets) {
    const out = run(process.execPath, [join(root, "dist-server", "simulate.js"), id, String(DIFFICULTY), "1", String(SEED), "--events"]);
    const events = out.split(/\r?\n/).filter((l) => /^[0-9]+ [a-z]/.test(l));
    const fight = /fight:\s+([0-9a-f]{16})/.exec(out)?.[1];
    if (!fight) throw new Error(`${id}: simulate printed no fight hash`);
    const md5 = createHash("md5").update(events.join("\n")).digest("hex");
    now[id] = { fight, events: events.length, md5 };
    if (KEEP) {
      mkdirSync(KEEP, { recursive: true });
      writeFileSync(join(KEEP, `${id}.events`), `${events.join("\n")}\n`);
    }
    const ref = banked?.maps?.[id];
    const same = ref && ref.fight === fight && ref.md5 === md5 && ref.events === events.length;
    console.log(
      `simulate ${id.padEnd(12)} fight ${fight}  events ${String(events.length).padStart(6)} ${md5.slice(0, 12)}` +
        (BANK ? "" : ref ? (same ? "  = bank" : `  MOVED (bank ${ref.fight}, ${ref.events} ${ref.md5.slice(0, 12)})`) : "  (no bank)"),
    );
    if (!BANK && !same) failures.push(`simulate ${id}`);
    if (DIFF && !same) firstDifference(id, events);
  }
  if (BANK) {
    const maps = { ...(banked?.maps ?? {}) };
    for (const id of targets) maps[id] = { ...now[id], at };
    save("simulate.json", { seed: SEED, difficulty: DIFFICULTY, rounds: 1, maps });
  }
}

// --------------------------------------------------------------- corecheck --
if (CORECHECK) {
  const res = spawnSync(process.execPath, [join(root, "dist-server", "corecheck.js")], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 << 20,
  });
  const out = `${res.stdout}${res.stderr}`;
  const passed = res.status === 0 && /corecheck: all passed/.test(out);
  const lines = out
    .split(/\r?\n/)
    .filter((l) => /^ {2}(ok|FAIL|--) /.test(l))
    .map((l) => l.trimEnd());
  console.log(`corecheck ${passed ? "all passed" : "FAILED"}, ${lines.length} lines`);
  if (!passed) {
    failures.push("corecheck");
    for (const l of lines.filter((x) => x.startsWith("  FAIL"))) console.log(l);
  }
  if (BANK) {
    if (!passed) throw new Error("refusing to bank a corecheck that did not pass");
    save("corecheck.json", { at, lines });
  } else {
    const banked = load("corecheck.json");
    if (!banked) console.log("corecheck: (no bank)");
    else {
      // Every banked line, in order, as a subsequence of what printed now.
      let j = 0;
      const missing = [];
      for (const want of banked.lines) {
        const k = lines.indexOf(want, j);
        if (k < 0) missing.push(want);
        else j = k + 1;
      }
      const fresh = lines.filter((l) => !banked.lines.includes(l));
      if (missing.length) {
        failures.push(`corecheck: ${missing.length} banked line(s) not printed in order`);
        console.log(`corecheck: ${missing.length} banked line(s) MISSING or out of order:`);
        for (const l of missing) console.log(`  - ${l.trim()}`);
      } else console.log(`corecheck: every banked line printed, in order (bank ${banked.at})`);
      if (fresh.length) {
        console.log(`corecheck: ${fresh.length} NEW line(s), not graded:`);
        for (const l of fresh) console.log(`  + ${l.trim()}`);
      }
    }
  }
}

// ------------------------------------------------------------------- bench --
if (BENCH) {
  const results = JSON.parse(readFileSync(BENCH, "utf8")).results ?? {};
  const banked = load("bench.json");
  if (BANK) {
    const maps = { ...(banked?.maps ?? {}) };
    for (const [id, r] of Object.entries(results)) maps[id] = { fight: r.fight, seed: r.seed, at };
    save("bench.json", { maps });
  } else {
    for (const [id, r] of Object.entries(results)) {
      const ref = banked?.maps?.[id];
      const same = ref && ref.fight === r.fight;
      console.log(
        `bench    ${id.padEnd(12)} fight ${r.fight}` + (ref ? (same ? "  = bank" : `  MOVED (bank ${ref.fight})`) : "  (no bank)"),
      );
      if (!same) failures.push(`bench ${id}`);
    }
  }
}

if (failures.length) {
  console.log(`\n${failures.length} failure(s): ${failures.join("; ")}`);
  process.exit(1);
}
console.log(BANK ? "\nbanked" : "\nall identical to the bank");

/** Runs a Node child to completion, its output returned; a failure throws. */
function run(cmd, argv) {
  const res = spawnSync(cmd, argv, { cwd: root, encoding: "utf8", maxBuffer: 256 << 20 });
  if (res.status !== 0) {
    process.stdout.write(`${res.stdout}${res.stderr}`);
    throw new Error(`${argv.slice(0, 2).join(" ")} exited ${res.status}`);
  }
  return res.stdout;
}

/** Prints the first event line that differs from the list kept in `DIFF`. */
function firstDifference(id, events) {
  const file = join(DIFF, `${id}.events`);
  if (!existsSync(file)) {
    console.log(`  (no kept list at ${file})`);
    return;
  }
  const kept = readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  const n = Math.min(kept.length, events.length);
  for (let i = 0; i < n; i++) {
    if (kept[i] === events[i]) continue;
    console.log(`  first difference at event ${i + 1}:\n    kept ${kept[i]}\n    now  ${events[i]}`);
    return;
  }
  console.log(`  the lists agree for ${n} events; kept ${kept.length}, now ${events.length}`);
}
