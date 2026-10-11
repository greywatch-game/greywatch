/**
 * Fails the build on any VALUE import path from the authority or from a
 * simulation module that reaches `@babylonjs/core`.
 *
 * Run from `npm run build`, beside `check-deep-imports.mjs`, and by hand as
 * `node scripts/check-babylon-free.mjs` (pass paths to walk from those roots
 * instead, which is how a step finds out how far it has to go). Phase 2 of
 * `BABYLON_EXIT.md` ended with the simulation off the scene and the authority
 * without an engine (X2.3); **this is what keeps them there**, because the way
 * back in is one innocent import. A simulation module that imports a helper
 * that imports a mesh builder typechecks, plays, and passes review — and puts
 * Babylon back in the match server's bundle and a node back under an outcome,
 * which is the class of bug Phase 2 spent eleven commits taking out
 * (`CLAUDE.md`, "Ownership and wiring": a system that SIMULATES never imports
 * Babylon). `tsc` cannot see it: it is a property of the import GRAPH, not of
 * any one file.
 *
 * **The roots are two kinds, and the rule for adding one is mechanical.**
 *
 *   - `server/`, every file in it: the authority imports no Babylon at all.
 *   - `src/sim/`, every file in it: the simulation core the authority runs
 *     and the offline page will host (`SimCore`, `SimPlayer`, `LagComp`,
 *     `buildSimWorld` — moved out of `server/` at `BABYLON_EXIT.md` X2.5a), so
 *     a file added there is held whoever builds it.
 *   - Every SIMULATION module, named one by one — the left column of
 *     `BABYLON_EXIT.md` X2.2's table. Most of them the server reaches anyway,
 *     and they are listed regardless, so a simulation is held because it IS
 *     one rather than because the authority happens to build it today:
 *     `Player` is the case that proves the point, a simulation only a client
 *     ever constructs. **A new module that simulates — or a system split into
 *     a simulation and a view — joins `SIMULATIONS` in the commit that makes
 *     it**; its view never does. A root that does not exist FAILS, so a
 *     rename cannot quietly drop one out.
 *
 * `BABYLON_EXIT.md` rule 6 widens this twice: X3.2 adds `src/render/` and
 * `src/math/` to `DIRECTORIES`, with `src/math/babylon.ts` — the crossing X1.1
 * made, deleted at X6.1 — named in `NOT_ROOTS`; X6.1 widens it to the whole
 * tree. **An entry in `NOT_ROOTS` is exempt from being a root, never from
 * being REACHED**: a simulation that imports the crossing still fails, which
 * is the point of having one door.
 *
 * What counts as an import, and why:
 *
 *   - **Type-only imports are erased and skipped** — `import type`, a named
 *     list whose every specifier is inline `type`, and the same two shapes of
 *     `export … from`. That is what lets a simulation NAME a Babylon type
 *     (`GameMap`'s mesh fields do) without loading a byte of it. An import
 *     NOT marked `type` counts as a value even when the bundler would elide it
 *     as unused: the gate reads syntax, not usage, so it is stricter than the
 *     runtime and never looser. Mark it `type`.
 *   - **`export … from` and `export * from` count**, as values, since a
 *     re-export loads its module exactly as an import does.
 *   - **A dynamic `import()` counts**, and must take a string literal: a lazy
 *     import still lands in the bundle and still loads, and one the gate
 *     cannot follow is a hole in it, so a computed specifier fails. So does
 *     Vite's `import.meta.glob`, whose pattern nothing here can resolve.
 *   - **A relative specifier that does not resolve fails** for the same
 *     reason. Resolution is the bundler's, minus aliases (the tree has none):
 *     the name as written (so `src/math`'s `./vector.ts` resolves as is), `.js`
 *     read as `.ts`, `.ts` appended, and a directory's `index.ts`.
 *   - **Bare specifiers are leaves**, and the one refused is `@babylonjs/core`
 *     and its subpaths — and the same package reached by a RELATIVE path into
 *     `node_modules`, which the resolved file betrays where the specifier does
 *     not. `ws`, `node:*` and `@babylonjs/havok` (a standalone WASM, X2.4's)
 *     are not this gate's business.
 *
 * Prints one line on success. On failure prints every module that imports
 * Babylon, the line, and the shortest chain from a root to it, and exits 1.
 */
import ts from "typescript";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Every source file under these is a root. */
const DIRECTORIES = ["server", "src/sim"];

/**
 * The simulation modules, one by one: `BABYLON_EXIT.md` X2.2's left column.
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
  // client shares from X2.4 on, whose whole point is that it is not Babylon.
  "src/systems/havok.ts",
  // Not a simulation either, and held as one for the same reason: the engine
  // that dialect speaks for — Havok's world, the static map and the substep —
  // which keeps every body's pose in a plain array and reaches no node
  // (X2.4 C5). Its three clients are views and are not roots.
  "src/systems/PhysicsWorld.ts",
];

/**
 * Files under a `DIRECTORIES` entry that are not roots themselves. Empty until
 * X3.2 adds `src/math/` and names `src/math/babylon.ts` here. Never exempt from
 * being reached — see the header.
 */
const NOT_ROOTS = [];

const SOURCE = [".ts", ".tsx", ".mts", ".js", ".mjs"];
const BANNED = /^@babylonjs\/core(?:\/|$)/;
/** The same package found by resolving a relative path into node_modules. */
const BANNED_FILE = /\/node_modules\/@babylonjs\/core\//;

const abs = (p) => resolve(REPO, p);
const rel = (p) => relative(REPO, p).replaceAll("\\", "/");

function walkDir(path, out) {
  if (statSync(path).isDirectory()) {
    for (const entry of readdirSync(path)) walkDir(join(path, entry), out);
  } else if (SOURCE.includes(extname(path)) && !path.endsWith(".d.ts")) {
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

// Paths on the command line replace the roots: a diagnostic, never the gate.
const asked = process.argv.slice(2);
const dirs = asked.length ? asked.filter((p) => existsSync(abs(p)) && statSync(abs(p)).isDirectory()) : DIRECTORIES;
const files = asked.length ? asked.filter((p) => !dirs.includes(p)) : SIMULATIONS;

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

// Breadth first, so the chain printed for a hit is the shortest one.
const parent = new Map(roots.map((f) => [f, null]));
const queue = [...roots];
const hits = [];
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
    if (BANNED.test(imp.spec)) {
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
    if (BANNED_FILE.test(target.replaceAll("\\", "/"))) {
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

if (hits.length || problems.length) {
  if (hits.length) {
    console.error("\nA value import path from the authority or a simulation reaches @babylonjs/core:\n");
    for (const { file, line, spec } of hits) {
      console.error(`  ${rel(file)}:${line}  imports "${spec}"`);
      console.error(`    via ${chain(file)}\n`);
    }
    console.error(
      "The authority runs without Babylon and a simulation never imports it (CLAUDE.md," +
        "\n\"Ownership and wiring\"; BABYLON_EXIT.md X2.3). Move what needs Babylon into the" +
        "\nsystem's VIEW, take the value off src/math, or make the import `import type`.\n",
    );
  }
  if (problems.length) {
    console.error("\ncheck-babylon-free could not walk the whole graph:\n");
    for (const p of problems) {
      console.error(p.root ? `  ${p.root}  ${p.why}` : `  ${rel(p.file)}:${p.line}  ${p.why}\n    via ${chain(p.file)}`);
    }
    console.error("");
  }
  process.exit(1);
}

const named = asked.length
  ? asked.join(", ")
  : `${DIRECTORIES.map((d) => `${d}/`).join(", ")} or the ${SIMULATIONS.length} simulations`;
console.log(`no path to @babylonjs/core from ${named} (${parent.size} modules walked)`);
