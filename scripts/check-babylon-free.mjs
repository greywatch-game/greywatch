/**
 * Fails the build on any import of `@babylonjs/core` ANYWHERE in the tree —
 * the package is not a dependency since `BABYLON_EXIT.md` X6.1i — on any
 * VALUE import path to it from the game, the authority or a simulation module,
 * and on any path from the LOCAL MATCH's two entries that reaches Node.
 *
 * Run from `npm run build` (which it joined at X2.3, and where since X6.1i it
 * stands in for `check-deep-imports.mjs`, deleted then: an import of a package
 * that is not there is the deep import's rule and more), and by hand as
 * `node scripts/check-babylon-free.mjs` (pass paths to walk from those roots
 * instead, a diagnostic). The simulation is off the scene, the authority runs
 * without an engine, and since X6.1i nothing in the tree imports the package;
 * **this is what keeps it that way**, because the way back in is one
 * innocent import. A simulation module that imports a helper that imports a
 * mesh builder typechecks, plays, and passes review — and puts Babylon back
 * in the match server's bundle and a node back under an outcome, which is the
 * class of bug Phase 2 spent eleven commits taking out (`CLAUDE.md`,
 * "Ownership and wiring": a system that SIMULATES never imports Babylon).
 * `tsc` cannot see it: it is a property of the import GRAPH, not of any one
 * file — and `tsc` sees none of the tree's scripts at all.
 *
 * **Three passes for the package** (and a fourth for Node, below).
 *
 *   - **The TREE, file by file** (`TREE`, and the three files at the root,
 *     `TREE_FILES`): `src/`, `server/`, `main.ts`, `scripts/`, `plans/` and
 *     `.claude/skills/` (`BABYLON_EXIT.md` rule 6's last turn, X6.1i), and
 *     the two Vite configs beside `main.ts`. `plans/` and `.claude/skills/`
 *     alone are read when present and SKIPPED with a note when not
 *     (`TREE_OPTIONAL`): the Docker image's build stage copies neither,
 *     nothing in them ships, and `ci.yml`'s full checkout gates them; the
 *     rest must exist. Every file there that NAMES the package as a module
 *     fails, a declaration file (`.d.ts`) included: an `import` or
 *     `export … from` of it (`import type` too — the package is not
 *     installed, so even a type is a dangling name, and `skipLibCheck` hides
 *     one in a `.d.ts` from `tsc`), an `import()`, a `require()`, an
 *     `import.meta.resolve()` and a Vite `ssrLoadModule()` taking it as a
 *     literal, a `declare module` of it or a `/// <reference types>` to it,
 *     or a relative path into `node_modules/@babylonjs/core`. Text
 *     that only MENTIONS the package — a comment, the history in a header, a
 *     string a census greps for — is not an import and is not read. The
 *     instruments may compute a specifier (a probe importing a page's module
 *     by its url): nothing the package could answer is installed to load.
 *   - **The GRAPH, walked** (`DIRECTORIES`, `ROOT_FILES`, `SIMULATIONS`):
 *     every VALUE import followed from every file under `src/` and `server/`
 *     and from `main.ts`, so a path to the package by any route — a
 *     relative path into `node_modules`, which the resolved file betrays
 *     where the specifier does not — is printed with its chain. Until X6.1i
 *     this was the gate's whole job and it widened a directory at a time as
 *     the sub-steps emptied them (rule 6: X3.1 `src/render/`, X3.2
 *     `src/math/` with the crossing `math/babylon.ts` in `NOT_ROOTS`, X6.1c
 *     `src/shaders/wgsl/`, X6.1d's review the thirteen already clean, X6.1f
 *     `src/viewer/` when the crossing went, X6.1g six, X6.1h the last three
 *     under `src/`); since X6.1i its roots are the whole of `src/` and
 *     `server/` and `main.ts`.
 *   - **Every SIMULATION module, named one by one** (`SIMULATIONS`,
 *     `docs/build.md`), walked the same way. The tree pass already refuses
 *     the package everywhere, so this list says nothing more about Babylon
 *     today; it is kept as it was (the owner's, row "X6.1, the gate's
 *     simulations": re-aiming it at what a PICTURE is made of now — no value
 *     path from a simulation to `src/render/`, `src/ui/` or a view module —
 *     is booked for after the exit, `FINDINGS.md` 75). **A new module that
 *     simulates — or a system split into a simulation and a view — joins
 *     `SIMULATIONS` in the commit that makes it**; its view never does. A
 *     root that does not exist FAILS, so a rename cannot quietly drop one
 *     out.
 *
 * **An entry in `NOT_ROOTS` is exempt from being a root, never from being
 * REACHED** (empty since X6.1f).
 *
 * What counts as an import on the two WALKS, and why:
 *
 *   - **Type-only imports are erased and skipped** (the TREE pass refuses
 *     one of the package all the same, above) — `import type`, a named
 *     list whose every specifier is inline `type`, and the same two shapes of
 *     `export … from`. That is what let a simulation NAME a Babylon type
 *     (as `GameMap`'s mesh fields did until X6.1g) without loading a byte of it. An import
 *     NOT marked `type` counts as a value even when the bundler would elide it
 *     as unused: the gate reads syntax, not usage, so it is stricter than the
 *     runtime and never looser. Mark it `type`.
 *   - **`export … from` and `export * from` count**, as values, since a
 *     re-export loads its module exactly as an import does.
 *   - **A dynamic `import()` counts**, and on the GRAPH must take a string
 *     literal: a lazy import still lands in the bundle and still loads, and
 *     one the gate cannot follow is a hole in it, so a computed specifier
 *     fails. So does Vite's `import.meta.glob`, whose pattern nothing here
 *     can resolve. (The TREE pass reads a literal where there is one and
 *     lets an instrument compute one, above.)
 *   - **A relative specifier that does not resolve fails** for the same
 *     reason. Resolution is the bundler's, minus aliases (the tree has none):
 *     the name as written (so `src/math`'s `./vector.ts` resolves as is), `.js`
 *     read as `.ts`, `.ts` appended, and a directory's `index.ts`.
 *   - **Bare specifiers are leaves**, and the one refused is `@babylonjs/core`
 *     and its subpaths — and the same package reached by a RELATIVE path into
 *     `node_modules`, which the resolved file betrays where the specifier does
 *     not. **`@babylonjs/havok` is KEPT and is not refused**: a standalone
 *     WASM and its glue, which depends on nothing of the core's and is the
 *     one binary that ships (`docs/build.md`). Neither is Node this walk's
 *     business (below).
 *
 * **The second walk is NODE, from the local match's two entries.**
 * `server/localMatchWorker.ts` and
 * `server/localMatch.ts` are the host the page runs — in a Worker, or in its
 * own thread when the Worker does not come up — and everything they reach,
 * `Match` included, runs in a BROWSER, while every other file in `server/`
 * is free to be Node's (the socket server, `corecheck`'s `node:crypto`). So
 * from those two roots, and only from them, a `node:` specifier, `ws`, or a
 * bare Node built-in by its old name (`fs`, `path` — `node:module`'s
 * `builtinModules`, so the list is the running Node's own) fails the build,
 * by the same rules for what counts as an import and the same shortest chain
 * printed. The browser bundle would refuse most of these too, but only for
 * the Worker's chunk, only at `vite build`, and as a resolution error naming
 * no chain; this names the line that brought it in.
 *
 * Prints one line per pass on success. On failure prints every file that
 * imports what its pass refuses, the line, and (on a walk) the shortest chain
 * from a root to it, and exits 1. Paths on the command line replace the
 * GRAPH walk's roots and skip the other two passes: a diagnostic, never the
 * gate.
 */
import ts from "typescript";
import { builtinModules } from "node:module";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The GRAPH's roots: every source file under these (subdirectories with
 * them), and the root files beside them. Every directory under `src/` was
 * listed one by one as the sub-steps of X6.1 emptied it (the header); since
 * X6.1i, the whole of `src/` and `server/`, and `main.ts`.
 */
const DIRECTORIES = ["src", "server"];
const ROOT_FILES = ["main.ts"];

/**
 * The TREE: every source file under these, and the files at the repository's
 * root, is read for an import naming the package (the header). Each of these
 * must exist, and one missing fails.
 */
const TREE = ["src", "server", "scripts"];
const TREE_FILES = ["main.ts", "vite.config.ts", "vite.server.config.ts"];
/**
 * …and these two are read when they are THERE. Nothing in either ships — the
 * plans' reference harnesses and the skills' scripts are instruments — so the
 * Docker image's build stage does not copy them, and the gate on the front of
 * its `npm run build` skips them with a note rather than failing on a
 * directory it was never meant to have. Every full checkout has both, and
 * `ci.yml` gates them there. The pair is named, not a rule: a directory of
 * `TREE` missing still fails.
 */
const TREE_OPTIONAL = ["plans", ".claude/skills"];

/**
 * The simulation modules, one by one.
 * See the header for the rule that adds one.
 */
const SIMULATIONS = [
  "src/systems/CombatSystem.ts",
  "src/systems/GrenadeSystem.ts",
  "src/systems/AntiTankSystem.ts",
  "src/systems/GlassSystem.ts",
  "src/entities/Bot.ts",
  "src/systems/BattleSystem.ts",
  "src/entities/Vehicle.ts",
  "src/entities/HullSprings.ts",
  "src/systems/VehicleSystem.ts",
  "src/entities/Player.ts",
  "src/systems/ConquestSystem.ts",
  // Not a simulation but held as one: the raw Havok dialect every physics
  // client shares, whose whole point is that it is not Babylon.
  "src/systems/havok.ts",
  // Not a simulation either, and held as one for the same reason: the engine
  // that dialect speaks for — Havok's world, the static map and the substep —
  // which keeps every body's pose in a plain array and reaches no node
  // Its three clients are views and are not roots.
  "src/systems/PhysicsWorld.ts",
  // Not a simulation, and held as one for the same reason as the two above:
  // a soldier rig's joints as our own hierarchy (`BABYLON_EXIT.md` X4.1a),
  // whose world matrices Babylon only read — the half a body is drawn from
  // once Babylon drew none of it (X4.1d).
  "src/entities/rigJoints.ts",
  // Not a simulation, and held as one for the same reason again: what a
  // soldier and a hull are to a shadow (X4.1c), composed in `src/math` off the
  // bone table (`soldierBones.ts`) and a hull's own fields, so that both maps'
  // proxies can be drawn with no node behind them. It reached Babylon through
  // the rig until X4.1c's review moved the bone table out of `SoldierModel`.
  "src/core/proxyBoxes.ts",
];

/**
 * Files under a `DIRECTORIES` entry that are not roots themselves. Empty since
 * `BABYLON_EXIT.md` X6.1f deleted the one there was, the crossing between our
 * vectors and Babylon's (`src/math/babylon.ts`). Never exempt from being
 * reached — see the header.
 */
const NOT_ROOTS = [];

const SOURCE = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"];
const BANNED = /^@babylonjs\/core(?:\/|$)/;
/** The same package found by resolving a relative path into node_modules. */
const BANNED_FILE = /\/node_modules\/@babylonjs\/core\//;

/**
 * The local match's entries — the host the page runs in a browser. Roots of
 * the NODE walk only; both are already roots of the Babylon walk, as files
 * under `server/`. A root that does not exist fails, as a simulation's does.
 */
const BROWSER_HOSTS = ["server/localMatchWorker.ts", "server/localMatch.ts"];
/** Node by any name: `node:*`, a built-in's bare name (and its subpaths), and `ws`. */
const NODE_BUILTINS = new Set(builtinModules.filter((m) => !m.startsWith("_")));
const NODE_BANNED = (spec) =>
  spec.startsWith("node:") || spec === "ws" || spec.startsWith("ws/") || NODE_BUILTINS.has(spec.split("/")[0]);
/** …and `ws` reached by a relative path into node_modules. */
const NODE_BANNED_FILE = /\/node_modules\/ws\//;

const abs = (p) => resolve(REPO, p);
const rel = (p) => relative(REPO, p).replaceAll("\\", "/");

/**
 * Every source file under `path`. A declaration file (`.d.ts`) is no module
 * the graph loads and is never a root of a WALK, but the TREE pass reads it
 * (`declarations`): a type the package declares named in one is as dangling as
 * one named in a `.ts`, and `tsc`'s `skipLibCheck` would not say so.
 */
function walkDir(path, out, declarations = false) {
  if (statSync(path).isDirectory()) {
    for (const entry of readdirSync(path)) if (entry !== "node_modules") walkDir(join(path, entry), out, declarations);
  } else if (SOURCE.includes(extname(path)) && (declarations || !path.endsWith(".d.ts"))) {
    out.push(path);
  }
  return out;
}

/** A relative specifier as the bundler resolves it, or null. */
function resolveSpec(from, spec) {
  const bare = spec.replace(/[?#].*$/, "");
  const base = resolve(dirname(from), bare);
  const candidates = [base, base.replace(/\.js$/, ".ts"), `${base}.ts`, `${base}.tsx`, join(base, "index.ts")];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/** True when a named import/export list has entries and every one is `type`. */
function allTypeOnly(elements) {
  return elements.length > 0 && elements.every((e) => e.isTypeOnly);
}

/**
 * Every value import in a file: `{ spec, line }`, plus `{ dynamic, line }` for
 * an `import()` whose argument is not a string literal.
 */
function valueImports(file) {
  const text = readFileSync(file, "utf8");
  const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const out = [];
  const lineOf = (node) => src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1;
  const visit = (n) => {
    if (ts.isImportDeclaration(n)) {
      const c = n.importClause;
      const typeOnly =
        !!c &&
        (c.isTypeOnly ||
          (!c.name && !!c.namedBindings && ts.isNamedImports(c.namedBindings) && allTypeOnly(c.namedBindings.elements)));
      if (!typeOnly) out.push({ spec: n.moduleSpecifier.text, line: lineOf(n) });
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier) {
      const typeOnly =
        n.isTypeOnly || (!!n.exportClause && ts.isNamedExports(n.exportClause) && allTypeOnly(n.exportClause.elements));
      if (!typeOnly) out.push({ spec: n.moduleSpecifier.text, line: lineOf(n) });
    } else if (
      ts.isImportEqualsDeclaration(n) &&
      !n.isTypeOnly &&
      ts.isExternalModuleReference(n.moduleReference) &&
      ts.isStringLiteral(n.moduleReference.expression)
    ) {
      out.push({ spec: n.moduleReference.expression.text, line: lineOf(n) });
    } else if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === "glob" &&
      ts.isMetaProperty(n.expression.expression) &&
      n.expression.expression.keywordToken === ts.SyntaxKind.ImportKeyword
    ) {
      // `import.meta.glob` is Vite's, and loads whatever the pattern matches:
      // nothing this walk can resolve, so it is refused like a computed import().
      out.push({ dynamic: true, line: lineOf(n), why: "import.meta.glob — the gate cannot follow a pattern" });
    } else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = n.arguments[0];
      if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) {
        out.push({ spec: arg.text, line: lineOf(n) });
      } else {
        out.push({ dynamic: true, line: lineOf(n) });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  return out;
}

/** The literal a call names a module by, for the four calls that load one. */
function loadsModule(n) {
  const e = n.expression;
  if (e.kind === ts.SyntaxKind.ImportKeyword) return true;
  if (ts.isIdentifier(e) && e.text === "require") return true;
  if (ts.isPropertyAccessExpression(e)) {
    const name = e.name.text;
    if (name === "ssrLoadModule") return true;
    // `import.meta.resolve`.
    if (name === "resolve" && ts.isMetaProperty(e.expression)) return true;
  }
  return false;
}

/**
 * Every place a file NAMES the package as a module — type-only imports
 * included, the calls above with a literal, and in a declaration file a
 * `declare module` of it or a `/// <reference types>` to it — as
 * `{ line, spec }`. Read by syntax, so a comment or a string that only
 * mentions it is not one.
 */
function namesPackage(file) {
  const text = readFileSync(file, "utf8");
  if (!text.includes("@babylonjs/core")) return [];
  const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const out = [];
  const lineOf = (node) => src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1;
  const banned = (spec) => BANNED.test(spec) || BANNED_FILE.test(`/${spec.replaceAll("\\", "/")}`);
  for (const ref of src.typeReferenceDirectives) {
    if (banned(ref.fileName)) out.push({ line: src.getLineAndCharacterOfPosition(ref.pos).line + 1, spec: ref.fileName });
  }
  const visit = (n) => {
    let spec = null;
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      spec = n.moduleSpecifier.text;
    } else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference) && ts.isStringLiteral(n.moduleReference.expression)) {
      spec = n.moduleReference.expression.text;
    } else if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument) && ts.isStringLiteral(n.argument.literal)) {
      spec = n.argument.literal.text;
    } else if (ts.isModuleDeclaration(n) && ts.isStringLiteral(n.name)) {
      spec = n.name.text;
    } else if (ts.isCallExpression(n) && loadsModule(n)) {
      const arg = n.arguments[0];
      if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) spec = arg.text;
    }
    if (spec !== null && banned(spec)) out.push({ line: lineOf(n), spec });
    ts.forEachChild(n, visit);
  };
  visit(src);
  return out;
}

// Paths on the command line replace the roots: a diagnostic, never the gate.
const asked = process.argv.slice(2);
const dirs = asked.length ? asked.filter((p) => existsSync(abs(p)) && statSync(abs(p)).isDirectory()) : DIRECTORIES;
const files = asked.length ? asked.filter((p) => !dirs.includes(p)) : [...ROOT_FILES, ...SIMULATIONS];

/**
 * One walk: every value import reachable from `roots` (absolute paths),
 * breadth first so the chain printed for a hit is the shortest one. A hit is
 * an import `bannedSpec` refuses by its specifier or `bannedFile` by the file
 * it resolves to; a problem is anything the walk could not follow.
 */
function walk(roots, bannedSpec, bannedFile) {
  const parent = new Map(roots.map((f) => [f, null]));
  const queue = [...roots];
  const hits = [];
  const problems = [];
  while (queue.length) {
    const file = queue.shift();
    for (const imp of valueImports(file)) {
      if (imp.dynamic) {
        problems.push({
          file,
          line: imp.line,
          why: imp.why ?? "dynamic import() with a computed specifier — the gate cannot follow it",
        });
        continue;
      }
      if (bannedSpec(imp.spec)) {
        hits.push({ file, line: imp.line, spec: imp.spec });
        continue;
      }
      if (!imp.spec.startsWith(".")) continue;
      const target = resolveSpec(file, imp.spec);
      if (!target) {
        problems.push({ file, line: imp.line, why: `"${imp.spec}" does not resolve` });
        continue;
      }
      // The package reached by a RELATIVE path into node_modules is still the
      // package: the specifier test above cannot see it, the resolved file can.
      if (bannedFile.test(target.replaceAll("\\", "/"))) {
        hits.push({ file, line: imp.line, spec: imp.spec });
        continue;
      }
      if (!SOURCE.includes(extname(target)) || parent.has(target)) continue;
      parent.set(target, file);
      queue.push(target);
    }
  }
  const chain = (file) => {
    const out = [];
    for (let f = file; f; f = parent.get(f)) out.unshift(rel(f));
    return out.join("\n        -> ");
  };
  return { hits, problems, chain, walked: parent.size };
}

const problems = [];
const roots = [];
for (const dir of dirs) {
  if (!existsSync(abs(dir))) problems.push({ root: dir, why: "root directory does not exist" });
  else roots.push(...walkDir(abs(dir), []).filter((f) => !NOT_ROOTS.includes(rel(f))));
}
for (const file of files) {
  if (!existsSync(abs(file))) problems.push({ root: file, why: "root does not exist (renamed? update SIMULATIONS)" });
  else roots.push(abs(file));
}
const babylon = walk(roots, (spec) => BANNED.test(spec), BANNED_FILE);

// The tree, file by file — skipped for a diagnostic run.
const named = [];
let scanned = 0;
/** `TREE` and whichever of `TREE_OPTIONAL` this checkout has, and the rest. */
const treeRead = [...TREE];
const treeSkipped = [];
if (!asked.length) {
  const treeFiles = [];
  for (const dir of TREE) {
    if (!existsSync(abs(dir))) problems.push({ root: dir, why: "tree directory does not exist" });
    else walkDir(abs(dir), treeFiles, true);
  }
  for (const dir of TREE_OPTIONAL) {
    if (existsSync(abs(dir))) {
      walkDir(abs(dir), treeFiles, true);
      treeRead.push(dir);
    } else {
      treeSkipped.push(dir);
    }
  }
  for (const file of TREE_FILES) {
    if (!existsSync(abs(file))) problems.push({ root: file, why: "tree file does not exist" });
    else treeFiles.push(abs(file));
  }
  for (const file of treeFiles) {
    scanned++;
    for (const hit of namesPackage(file)) named.push({ file, ...hit });
  }
}

// The Node walk, from the local match's entries — skipped for a diagnostic
// run, whose paths name Babylon roots.
const nodeRoots = [];
if (!asked.length) {
  for (const file of BROWSER_HOSTS) {
    if (!existsSync(abs(file))) problems.push({ root: file, why: "root does not exist (renamed? update BROWSER_HOSTS)" });
    else nodeRoots.push(abs(file));
  }
}
const node = asked.length ? null : walk(nodeRoots, NODE_BANNED, NODE_BANNED_FILE);

const printProblems = (list, chain) => {
  for (const p of list) {
    console.error(p.root ? `  ${p.root}  ${p.why}` : `  ${rel(p.file)}:${p.line}  ${p.why}\n    via ${chain(p.file)}`);
  }
};

const problemCount = problems.length + babylon.problems.length + (node?.problems.length ?? 0);
if (named.length || babylon.hits.length || node?.hits.length || problemCount) {
  if (named.length) {
    console.error("\nA file in the tree names @babylonjs/core as a module:\n");
    for (const { file, line, spec } of named) console.error(`  ${rel(file)}:${line}  "${spec}"`);
    console.error(
      "\nThe package left the tree at BABYLON_EXIT.md X6.1i and is not a dependency: nothing" +
        "\nimports it, a type included. A copy of something of Babylon's is ported into the tree" +
        "\n(licenses/babylonjs.md), never imported.\n",
    );
  }
  if (babylon.hits.length) {
    console.error("\nA value import path from the game, the authority or a simulation reaches @babylonjs/core:\n");
    for (const { file, line, spec } of babylon.hits) {
      console.error(`  ${rel(file)}:${line}  imports "${spec}"`);
      console.error(`    via ${babylon.chain(file)}\n`);
    }
    console.error(
      "The authority runs without Babylon and a simulation never imports it (CLAUDE.md," +
        "\n\"Ownership and wiring\"; BABYLON_EXIT.md X2.3). Move what needs Babylon into the" +
        "\nsystem's VIEW, take the value off src/math, or make the import `import type`.\n",
    );
  }
  if (node?.hits.length) {
    console.error("\nA value import path from the local match's host reaches Node:\n");
    for (const { file, line, spec } of node.hits) {
      console.error(`  ${rel(file)}:${line}  imports "${spec}"`);
      console.error(`    via ${node.chain(file)}\n`);
    }
    console.error(
      "server/localMatch.ts and everything it reaches run in a browser — in a Worker, or in" +
        "\nthe page's own thread (BABYLON_EXIT.md X2.5c C4; server/localMatch.ts). Keep what" +
        "\nneeds Node in server/index.ts or a script, or make the import `import type`.\n",
    );
  }
  if (problemCount) {
    console.error("\ncheck-babylon-free could not walk the whole graph:\n");
    printProblems(problems, babylon.chain);
    printProblems(babylon.problems, babylon.chain);
    if (node) printProblems(node.problems, node.chain);
    console.error("");
  }
  process.exit(1);
}

const from = asked.length
  ? asked.join(", ")
  : `${DIRECTORIES.map((d) => `${d}/`).join(", ")}, ${ROOT_FILES.join(", ")} or the ${SIMULATIONS.length} simulations`;
if (!asked.length) {
  console.log(`no import of @babylonjs/core in ${treeRead.map((d) => `${d}/`).join(", ")} or ${TREE_FILES.join(", ")} (${scanned} files read)`);
  if (treeSkipped.length) {
    console.log(
      `  skipped ${treeSkipped.map((d) => `${d}/`).join(" and ")}: not in this checkout (the Docker image's build stage ` +
        "copies neither — nothing in them ships — and a full checkout, ci.yml's, gates them)",
    );
  }
}
console.log(`no path to @babylonjs/core from ${from} (${babylon.walked} modules walked)`);
if (node) {
  console.log(`no path to Node from the local match's host, ${BROWSER_HOSTS.join(" or ")} (${node.walked} modules walked)`);
}
