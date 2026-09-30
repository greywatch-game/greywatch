/**
 * Prints how big the project is — `npm run loc`.
 *
 * Owns: nothing but a report. Reads `git ls-files`, so what it counts is what
 * is COMMITTED: `node_modules/`, `dist/` and a scratch file nobody added are
 * out by construction, and so is anything `.gitignore` names.
 *
 * **A raw line count of this tree is mostly not code**, which is the reason
 * this script exists rather than a `wc -l`: a map's collision bake and its
 * heightfield are GENERATED and run to thousands of lines each, a seeded
 * layout is emitted by a generator, and a WAV master reads as text to `wc`.
 * So every file is filed into exactly one KIND, and the headline is the
 * hand-written code alone:
 *
^ *   - `hand-written` — TypeScript, JavaScript, CSS and HTML somebody wrote.
 *   - `map data`  — a map's `layout.ts` and `environment.ts`: data rather than
 *                   logic, and a seeded map's layout is generator output that
 *                   the editor then patches, so it is neither kind cleanly.
 *   - `generated` — the collision bakes and heightfields (`npm run collision`,
 *                   the map generators). Nobody edits these.
 *   - `docs`      — Markdown.
 *
 * Code is further split into CODE, COMMENT and BLANK lines. This codebase
 * argues its rules in its contract headers, so the comment share is large and
 * worth seeing rather than hiding inside one number. The split is a line
 * classifier, not a parser: a line holding both code and a comment is code,
 * and a `//` or `/*` inside a string literal can mislead it (the WGSL in
 * template strings is counted as code, which it is).
 *
 * Flags: `-- --files [N]` also lists the N largest hand-written files (20);
 * `-- --json` prints the whole tally as JSON instead of tables.
 *
 * Never: writes anything, or fails a build — it is not a gate.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const json = args.includes("--json");
const filesAt = args.indexOf("--files");
const topN = filesAt < 0 ? 0 : Number(args[filesAt + 1]) || 20;

/** Extension → language label. Anything not here is not counted. */
const LANGS = {
  ".ts": "TypeScript",
  ".mts": "TypeScript",
  ".mjs": "JavaScript",
  ".js": "JavaScript",
  ".css": "CSS",
  ".html": "HTML",
  ".md": "Markdown",
};

/** A map's own directory: `src/world/<map>/<file>.ts`, never `kit/`. */
const MAP_FILE = /^src\/world\/(?!kit\/)[^/]+\/(layout|environment|heights|collision)\.ts$/;

function kindOf(path) {
  const m = MAP_FILE.exec(path);
  if (m) return m[1] === "heights" || m[1] === "collision" ? "generated" : "map data";
  return path.endsWith(".md") ? "docs" : "hand-written";
}

/** Where a hand-written file sits, for the per-area table. */
function areaOf(path) {
  const parts = path.split("/");
  if (parts[0] === "src") {
    if (parts[1] === "world" && parts[2] === "kit") return "src/world/kit";
    return parts.length > 2 ? `src/${parts[1]}` : "src (root)";
  }
  if (parts[0] === ".claude") return ".claude/skills";
  if (parts.length === 1) return "(root)";
  return parts[0];
}

/**
 * Splits a file into code, comment and blank lines. Tracks block comments
 * across lines; HTML's `<!-- -->` is treated as a block comment too.
 */
function classify(text, lang) {
  let code = 0, comment = 0, blank = 0;
  let inBlock = false;
  const [open, close] = lang === "HTML" ? ["<!--", "-->"] : ["/*", "*/"];
  const lineComment = lang === "CSS" || lang === "HTML" ? null : "//";
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (line === "") {
      if (inBlock) comment++; else blank++;
      continue;
    }
    let sawCode = false;
    let sawComment = false;
    while (line.length > 0) {
      if (inBlock) {
        sawComment = true;
        const end = line.indexOf(close);
        if (end < 0) { line = ""; break; }
        inBlock = false;
        line = line.slice(end + close.length).trim();
        continue;
      }
      if (lineComment && line.startsWith(lineComment)) { sawComment = true; break; }
      if (line.startsWith(open)) { inBlock = true; line = line.slice(open.length); continue; }
      sawCode = true;
      break;
    }
    if (sawCode) code++; else if (sawComment) comment++; else blank++;
  }
  // A file ending in a newline yields one empty trailing element; drop it.
  if (text.endsWith("\n")) blank--;
  return { code, comment, blank };
}

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 << 20 })
  .split("\0")
  .filter(Boolean);

const files = [];
for (const path of tracked) {
  const ext = path.slice(path.lastIndexOf("."));
  const lang = LANGS[ext];
  if (!lang) continue;
  let text;
  try { text = readFileSync(path, "utf8"); } catch { continue; } // deleted, not yet staged
  const kind = kindOf(path);
  const counts = lang === "Markdown"
    ? { code: 0, comment: 0, blank: 0, text: text.split(/\r?\n/).length - (text.endsWith("\n") ? 1 : 0) }
    : classify(text, lang);
  files.push({ path, lang, kind, area: areaOf(path), ...counts });
}

const lines = (f) => f.text ?? f.code + f.comment + f.blank;

function tally(list, keyOf) {
  const out = new Map();
  for (const f of list) {
    const key = keyOf(f);
    const row = out.get(key) ?? { key, files: 0, code: 0, comment: 0, blank: 0, lines: 0 };
    row.files++;
    row.code += f.code;
    row.comment += f.comment;
    row.blank += f.blank;
    row.lines += lines(f);
    out.set(key, row);
  }
  return [...out.values()].sort((a, b) => b.lines - a.lines);
}

const written = files.filter((f) => f.kind === "hand-written");
const byKind = tally(files, (f) => f.kind);
const byLang = tally(written, (f) => f.lang);
const byArea = tally(written, (f) => f.area);
const sum = (rows) => rows.reduce((t, r) => ({
  key: "total", files: t.files + r.files, code: t.code + r.code,
  comment: t.comment + r.comment, blank: t.blank + r.blank, lines: t.lines + r.lines,
}), { key: "total", files: 0, code: 0, comment: 0, blank: 0, lines: 0 });

if (json) {
  console.log(JSON.stringify({
    kinds: byKind, languages: byLang, areas: byArea, total: sum(byArea),
    files: files.map(({ path, lang, kind, code, comment, blank }) => ({ path, lang, kind, code, comment, blank, lines: code + comment + blank })),
  }, null, 2));
  process.exit(0);
}

const n = (v) => v.toLocaleString("en-US");
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : "-");

function table(title, rows, { split = true } = {}) {
  const head = split
    ? ["", "files", "code", "comment", "blank", "total", "comment %"]
    : ["", "files", "lines"];
  const body = rows.map((r) => split
    ? [r.key, n(r.files), n(r.code), n(r.comment), n(r.blank), n(r.lines), pct(r.comment, r.code + r.comment)]
    : [r.key, n(r.files), n(r.lines)]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((row) => row[i].length)));
  const fmt = (row) => row.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join("  ");
  console.log(`\n${title}`);
  console.log(fmt(head));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  // The last row is always the total, set off by a rule of its own.
  for (const row of body.slice(0, -1)) console.log(fmt(row));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  console.log(fmt(body.at(-1)));
}

const total = sum(tally(written, () => "total"));
console.log(`GREYWATCH — ${n(total.code)} lines of hand-written code ` +
  `(${n(total.lines)} with comments and blanks, ${n(total.files)} files)`);

table("By kind (everything committed that is text)", [...byKind, sum(byKind)], { split: false });
table("Hand-written code by language", [...byLang, total]);
table("Hand-written code by area", [...byArea, total]);

if (topN > 0) {
  const top = [...written].sort((a, b) => lines(b) - lines(a)).slice(0, topN);
  console.log(`\nLargest ${top.length} hand-written files`);
  const w = Math.max(...top.map((f) => f.path.length));
  for (const f of top) {
    console.log(`${f.path.padEnd(w)}  ${n(lines(f)).padStart(6)}  (${n(f.code)} code)`);
  }
}
