/**
 * THE CENSUS of what is left of `@babylonjs/core` in the tree, and what the
 * build ships — `BABYLON_EXIT.md` X6.1a's instrument, which every later
 * sub-step of X6.1 records in its note, and which must only SHRINK.
 *
 *   node scripts/babylon-census.mjs [--files] [--out f.json] [--against f.json]
 *
 * Owns: nothing but a report and, when asked, one JSON file. It reads source
 * and `dist/`; it builds nothing, so the bundle it measures is whatever the
 * last `npm run build` left (run that first, or the bundle half says it found
 * none).
 *
 * **What it counts**, over `src/`, `server/`, `main.ts`, `scripts/`,
 * `.claude/skills/` and `plans/` (the five the plan names, and `plans/` beside
 * them because X6.1i's whole-tree gate walks it too):
 *
 * - **every import of the package BY NAME**: each specifier of an `import` or
 *   an `export … from` whose module is `@babylonjs/core` or a subpath of it,
 *   with the file it is in and its KIND — `type` when the clause or the
 *   specifier is marked `type` (erased: what `check-babylon-free.mjs` skips),
 *   `value` otherwise, as that gate reads it (syntax, never usage). A
 *   namespace import is the name `*`, a default import `default`, a bare
 *   `import "@babylonjs/core"` the name `(side effect)`, and a string-literal
 *   `import("@babylonjs/core")` the name `(dynamic)` — all values.
 * - **every `ssrLoadModule("@babylonjs/core…")`**: a Node script that loads
 *   the package through Vite's SSR loader (`bounds-check.mjs` and
 *   `sweep-check.mjs` did until X6.1i), which no import statement shows.
 * - **every page-side load of Babylon's module**: a probe that finds the
 *   page's own `babylonjs_core` chunk among its resources and imports it by
 *   URL (`leaks.mjs`, `depth.mjs`, `surfaces.mjs` and the physics clients'
 *   oracle did until X6.1i) — counted by the literal, file and line.
 * - **the BUNDLE**: every file under `dist/`, its bytes raw and gzipped
 *   (`zlib`'s default level, as Vite's report gzips), and the totals.
 *
 * The report prints, per name, how many files import it as a value and how
 * many as a type alone (the plan's "`Scene` 77 + 16"), the files that import
 * the package at all, the loads, and the bundle. `--files` lists every file
 * with its names. `--out` writes it all as JSON; `--against` compares with an
 * earlier `--out` and **exits 1 if anything GREW** — a name in more files, a
 * file importing a name it did not, a load added — printing what shrank
 * beside it; the bundle is reported against, never failed on, since it moves
 * for reasons that are not Babylon.
 *
 * Never: writes anything but `--out`, or fails on anything but `--against`.
 */
import ts from "typescript";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const SELF = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(SELF), "..");
const args = process.argv.slice(2);
const opt = (k) => {
  const i = args.indexOf(`--${k}`);
  return i < 0 ? null : (args[i + 1] ?? null);
};
const OUT = opt("out");
const AGAINST = opt("against");
const FILES = args.includes("--files");

/** Where the census looks, in the order it reports them. */
const ROOTS = ["src", "server", "main.ts", "scripts", ".claude/skills", "plans"];
const SOURCE = [".ts", ".tsx", ".mts", ".js", ".mjs", ".cjs"];
const SKIP_DIRS = new Set(["node_modules", "dist", "dist-server", "dist-server-dev", "ref", "worktrees"]);
const PACKAGE = /^@babylonjs\/core(?:\/|$)/;

const rel = (p) => relative(REPO, p).replaceAll("\\", "/");

function walk(path, out) {
  if (!existsSync(path)) return out;
  const st = statSync(path);
  if (st.isDirectory()) {
    for (const entry of readdirSync(path)) {
      if (SKIP_DIRS.has(entry)) continue;
      walk(join(path, entry), out);
    }
  } else if (SOURCE.includes(extname(path)) && !path.endsWith(".d.ts")) {
    out.push(path);
  }
  return out;
}

/** One file's imports of the package, `{ name, kind, line }`, its SSR loads and its page loads. */
function scan(file) {
  const text = readFileSync(file, "utf8");
  const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const imports = [];
  const ssr = [];
  const page = [];
  const lineOf = (node) => src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1;
  const named = (elements, clauseType, line) => {
    for (const e of elements) {
      imports.push({ name: (e.propertyName ?? e.name).text, kind: clauseType || e.isTypeOnly ? "type" : "value", line });
    }
  };
  const visit = (n) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && PACKAGE.test(n.moduleSpecifier.text)) {
      const line = lineOf(n);
      const c = n.importClause;
      if (!c) imports.push({ name: "(side effect)", kind: "value", line });
      else {
        if (c.name) imports.push({ name: "default", kind: c.isTypeOnly ? "type" : "value", line });
        const b = c.namedBindings;
        if (b && ts.isNamespaceImport(b)) imports.push({ name: "*", kind: c.isTypeOnly ? "type" : "value", line });
        else if (b) named(b.elements, c.isTypeOnly, line);
      }
    } else if (
      ts.isExportDeclaration(n) &&
      n.moduleSpecifier &&
      ts.isStringLiteral(n.moduleSpecifier) &&
      PACKAGE.test(n.moduleSpecifier.text)
    ) {
      const line = lineOf(n);
      if (!n.exportClause) imports.push({ name: "*", kind: n.isTypeOnly ? "type" : "value", line });
      else if (ts.isNamedExports(n.exportClause)) named(n.exportClause.elements, n.isTypeOnly, line);
      else imports.push({ name: "*", kind: n.isTypeOnly ? "type" : "value", line });
    } else if (ts.isCallExpression(n)) {
      const arg = n.arguments[0];
      const literal = arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) ? arg.text : null;
      if (n.expression.kind === ts.SyntaxKind.ImportKeyword && literal && PACKAGE.test(literal)) {
        imports.push({ name: "(dynamic)", kind: "value", line: lineOf(n) });
      } else if (
        ts.isPropertyAccessExpression(n.expression) &&
        n.expression.name.text === "ssrLoadModule" &&
        literal &&
        PACKAGE.test(literal)
      ) {
        ssr.push({ spec: literal, line: lineOf(n) });
      }
    } else if ((ts.isStringLiteral(n) || ts.isRegularExpressionLiteral(n)) && /babylonjs_core/i.test(n.text)) {
      // The page's own chunk of Babylon, found among its resources and loaded by URL.
      page.push({ literal: n.text, line: lineOf(n) });
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  return { imports, ssr, page };
}

function census() {
  const files = {};
  const ssr = [];
  const page = [];
  for (const root of ROOTS) {
    for (const f of walk(join(REPO, root), [])) {
      // Not itself: its own pattern for a page load is not one.
      if (f === SELF) continue;
      const r = scan(f);
      const path = rel(f);
      if (r.imports.length) {
        // A name a file imports both ways (a value somewhere, a type elsewhere) is a value there.
        const names = {};
        for (const i of r.imports) names[i.name] = names[i.name] === "value" || i.kind === "value" ? "value" : "type";
        files[path] = Object.fromEntries(Object.entries(names).sort(([a], [b]) => (a < b ? -1 : 1)));
      }
      for (const s of r.ssr) ssr.push({ file: path, ...s });
      for (const p of r.page) page.push({ file: path, ...p });
    }
  }
  const byName = {};
  for (const [file, names] of Object.entries(files)) {
    for (const [name, kind] of Object.entries(names)) {
      const b = (byName[name] ??= { value: [], type: [] });
      b[kind].push(file);
    }
  }
  const byRoot = {};
  for (const file of Object.keys(files)) {
    const root = ROOTS.find((r) => file === r || file.startsWith(`${r}/`)) ?? "(other)";
    const b = (byRoot[root] ??= { files: 0, valueFiles: 0 });
    b.files++;
    if (Object.values(files[file]).includes("value")) b.valueFiles++;
  }
  return { files, byName, byRoot, ssr, page, bundle: bundle() };
}

/** Every file under `dist/`, raw and gzipped, or null when there is none. */
function bundle() {
  const dist = join(REPO, "dist");
  if (!existsSync(dist)) return null;
  const all = [];
  const each = (p) => {
    if (statSync(p).isDirectory()) for (const e of readdirSync(p)) each(join(p, e));
    else {
      const data = readFileSync(p);
      all.push({ file: relative(dist, p).replaceAll("\\", "/"), raw: data.length, gzip: gzipSync(data).length });
    }
  };
  each(dist);
  all.sort((a, b) => (a.file < b.file ? -1 : 1));
  const sum = (k, f = () => true) => all.filter(f).reduce((s, x) => s + x[k], 0);
  const js = (x) => x.file.endsWith(".js");
  return {
    built: statSync(join(dist, "index.html")).mtime.toISOString(),
    files: all,
    total: { raw: sum("raw"), gzip: sum("gzip") },
    js: { raw: sum("raw", js), gzip: sum("gzip", js) },
  };
}

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;

function report(c) {
  const names = Object.entries(c.byName).sort(
    ([, a], [, b]) => b.value.length + b.type.length - (a.value.length + a.type.length) || 0,
  );
  const nFiles = Object.keys(c.files).length;
  const nValue = Object.values(c.files).filter((n) => Object.values(n).includes("value")).length;
  console.log(`@babylonjs/core: ${nFiles} files import it (${nValue} with a value import, ${nFiles - nValue} by type alone)`);
  for (const r of ROOTS) {
    const b = c.byRoot[r];
    if (b) console.log(`  ${r.padEnd(15)} ${String(b.files).padStart(4)} files (${b.valueFiles} value)`);
  }
  console.log(`by name, files importing it as a value + by type alone:`);
  for (const [name, b] of names) console.log(`  ${name.padEnd(28)} ${b.value.length} + ${b.type.length}`);
  console.log(`ssrLoadModule("@babylonjs/core"): ${c.ssr.length}`);
  for (const s of c.ssr) console.log(`  ${s.file}:${s.line}  ${s.spec}`);
  console.log(`page-side loads of Babylon's chunk: ${c.page.length}`);
  for (const p of c.page) console.log(`  ${p.file}:${p.line}`);
  if (FILES) {
    console.log(`files:`);
    for (const [file, n] of Object.entries(c.files)) {
      console.log(`  ${file}  ${Object.entries(n).map(([k, v]) => (v === "type" ? `type ${k}` : k)).join(", ")}`);
    }
  }
  if (!c.bundle) console.log(`bundle: no dist/ (run npm run build first)`);
  else {
    console.log(`bundle (dist/, built ${c.bundle.built}): ${c.bundle.files.length} files, ${kb(c.bundle.total.raw)} raw, ${kb(c.bundle.total.gzip)} gzipped; JS ${kb(c.bundle.js.raw)} raw, ${kb(c.bundle.js.gzip)} gzipped`);
    for (const f of c.bundle.files) console.log(`  ${f.file.padEnd(48)} ${kb(f.raw).padStart(11)} ${kb(f.gzip).padStart(11)}`);
  }
}

/** What grew against an earlier census (the failures) and what shrank (said beside them). */
function against(c, b) {
  const grew = [];
  const shrank = [];
  for (const [file, names] of Object.entries(c.files)) {
    const was = b.files[file] ?? {};
    for (const [name, kind] of Object.entries(names)) {
      if (!(name in was)) grew.push(`${file} imports ${name} (${kind}), which it did not`);
      else if (was[name] === "type" && kind === "value") grew.push(`${file} imports ${name} as a value, where it was a type`);
    }
  }
  for (const [file, names] of Object.entries(b.files)) {
    const now = c.files[file] ?? {};
    for (const [name, kind] of Object.entries(names)) {
      if (!(name in now)) shrank.push(`${file} no longer imports ${name}`);
      else if (kind === "value" && now[name] === "type") shrank.push(`${file} imports ${name} as a type alone`);
    }
  }
  const key = (x) => `${x.file} ${x.spec ?? x.literal}`;
  for (const [label, now, was] of [
    ["ssrLoadModule", c.ssr, b.ssr],
    ["page load", c.page, b.page],
  ]) {
    const w = new Map();
    for (const x of was) w.set(key(x), (w.get(key(x)) ?? 0) + 1);
    const n = new Map();
    for (const x of now) n.set(key(x), (n.get(key(x)) ?? 0) + 1);
    for (const [k, v] of n) if (v > (w.get(k) ?? 0)) grew.push(`${label} added: ${k}`);
    for (const [k, v] of w) if (v > (n.get(k) ?? 0)) shrank.push(`${label} gone: ${k}`);
  }
  const files = (x) => Object.keys(x.files).length;
  console.log(`\nagainst ${AGAINST}: ${files(b)} files -> ${files(c)}; ${shrank.length} shrank, ${grew.length} grew`);
  for (const s of shrank.slice(0, 40)) console.log(`  shrank  ${s}`);
  if (shrank.length > 40) console.log(`  … and ${shrank.length - 40} more`);
  for (const g of grew) console.log(`  GREW    ${g}`);
  if (c.bundle && b.bundle) {
    const d = (k) => c.bundle.total[k] - b.bundle.total[k];
    console.log(`  bundle ${kb(b.bundle.total.raw)} -> ${kb(c.bundle.total.raw)} raw (${d("raw") >= 0 ? "+" : ""}${kb(d("raw"))}), ${kb(b.bundle.total.gzip)} -> ${kb(c.bundle.total.gzip)} gzipped (${d("gzip") >= 0 ? "+" : ""}${kb(d("gzip"))})`);
  }
  return grew.length;
}

const c = census();
report(c);
if (OUT) {
  writeFileSync(OUT, `${JSON.stringify(c, null, 1)}\n`);
  console.log(`wrote ${OUT}`);
}
if (AGAINST) {
  const grew = against(c, JSON.parse(readFileSync(AGAINST, "utf8")));
  if (grew) process.exit(1);
}
