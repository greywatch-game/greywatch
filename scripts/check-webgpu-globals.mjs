/**
 * Fails the build on a WebGPU global named at a module's TOP LEVEL.
 *
 * Run from `npm run build`, beside `check-deep-imports.mjs`, and by hand as
 * `node scripts/check-webgpu-globals.mjs`. `main.ts` gates the boot on
 * `navigator.gpu` and an adapter, but the gate runs AFTER the module graph is
 * evaluated (`main.ts` imports `Game` statically, and everything under it), and
 * the WebGPU globals — `GPUBufferUsage`, `GPUTextureUsage`, `GPUShaderStage`,
 * `GPUMapMode`, `GPUColorWrite`, and the interface objects (`GPUDevice`, …) —
 * are secure-context globals a browser without WebGPU, or any browser on a LAN
 * address over plain http, does not define. So one of them read while a module
 * is EVALUATED throws a `ReferenceError` before `checkWebGPU` runs, and the boot
 * card sticks on "Fetching the game" with no sentence (`CLAUDE.md`, "Project
 * overview"; `docs/build.md`, "There is no WebGL fallback"). `tsc` cannot see
 * it — the DOM lib declares every one of them — and nothing on a WebGPU
 * machine fails; before this gate the only thing that caught one was
 * `kit:hash`'s Node run, and only in a module the world's builders reach.
 *
 * **What counts as the top level is what runs when the module is evaluated**:
 * a statement's expressions, a top-level variable's initializer, an enum's
 * members, a class's `extends` clause, computed member names, static field
 * initializers and static blocks. **What does not** is anything inside a
 * function's parameters or body (a declaration, an expression, an arrow, a
 * method, an accessor, a constructor) and an INSTANCE field's initializer, which
 * runs in the constructor — where a device already exists and the globals are
 * fine. A flag a module needs before a device exists is written as a LITERAL
 * with the names in a comment (`GlowBlur.ts`, `GiCompute.ts`,
 * `particleProgram.ts`).
 *
 * **It reads SYNTAX, one file at a time** (TypeScript's parser, no program and
 * no checker, so it costs about a second): a type position is skipped (naming
 * `GPUDevice` as a type loads nothing), as is a property NAME (`x.GPUFoo`,
 * `{ GPUFoo: 1 }`) and any name the file binds itself (an import such as
 * Babylon's `GPUParticleSystem`, a declaration). What it cannot see is a
 * function CALLED at the top level that names one inside — an IIFE, or a
 * `const X = make()` — which is the transitive case `kit:hash`'s Node run still
 * catches where it reaches. Any identifier spelled `GPU` and a capital is held
 * to the rule, so a new WebGPU global needs no list kept.
 *
 * **Scoped to `src/` and `main.ts`**, which is what ships to a browser
 * (`check-deep-imports.mjs`' roots): `server/` touches no GPU.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const ROOTS = ["src", "main.ts"];
const EXTS = [".ts", ".tsx", ".mts", ".js", ".mjs"];
/** A WebGPU global's spelling: `GPU` and a capital. */
const WEBGPU = /^GPU[A-Z]/;

/** Every source file under a root, recursively; declaration files declare and never run. */
function walk(path, out) {
  if (statSync(path).isDirectory()) {
    for (const entry of readdirSync(path)) walk(join(path, entry), out);
  } else if (EXTS.some((e) => path.endsWith(e)) && !path.endsWith(".d.ts")) {
    out.push(path);
  }
  return out;
}

/** A function-like node: its parameters and body run when it is CALLED, not when the module is evaluated. */
function isFunctionLike(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

function isStatic(node) {
  return (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Static) !== 0;
}

function isAmbient(node) {
  return (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Ambient) !== 0;
}

/** Whether `id` names a declaration, a property or a label rather than reading a binding. */
function isNotAReference(id) {
  const p = id.parent;
  if (!p) return true;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return true;
  if (ts.isQualifiedName(p)) return true;
  if (
    (ts.isPropertyAssignment(p) ||
      ts.isPropertyDeclaration(p) ||
      ts.isMethodDeclaration(p) ||
      ts.isGetAccessorDeclaration(p) ||
      ts.isSetAccessorDeclaration(p) ||
      ts.isEnumMember(p) ||
      ts.isVariableDeclaration(p) ||
      ts.isParameter(p) ||
      ts.isFunctionDeclaration(p) ||
      ts.isFunctionExpression(p) ||
      ts.isClassDeclaration(p) ||
      ts.isClassExpression(p) ||
      ts.isEnumDeclaration(p)) &&
    p.name === id
  ) {
    return true;
  }
  if (ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)) return true;
  if (ts.isBindingElement(p) && (p.name === id || p.propertyName === id)) return true;
  if (ts.isImportSpecifier(p) || ts.isExportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p)) return true;
  if (ts.isImportEqualsDeclaration(p) || ts.isNamespaceExportDeclaration(p)) return true;
  return false;
}

/** Every name the file binds itself — an import, a declaration — which is never the global. */
function boundNames(source) {
  const names = new Set();
  const visit = (node) => {
    if (ts.isIdentifier(node) && WEBGPU.test(node.text) && isNotAReference(node)) {
      const p = node.parent;
      // A property's name binds nothing; everything else here declares a binding.
      const property =
        (ts.isPropertyAccessExpression(p) && p.name === node) ||
        ts.isQualifiedName(p) ||
        ((ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p)) && p.name === node) ||
        ((ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p) || ts.isEnumMember(p)) && p.name === node) ||
        (ts.isBindingElement(p) && p.propertyName === node) ||
        (ts.isImportSpecifier(p) && p.propertyName === node) ||
        ts.isExportSpecifier(p);
      if (!property) names.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

/** `class X extends Y`: the one clause in a type-shaped node that is EVALUATED. */
function isExtendsExpression(node) {
  const clause = node.parent;
  return (
    ts.isExpressionWithTypeArguments(node) &&
    clause &&
    ts.isHeritageClause(clause) &&
    clause.token === ts.SyntaxKind.ExtendsKeyword &&
    (ts.isClassDeclaration(clause.parent) || ts.isClassExpression(clause.parent))
  );
}

function check(file, offenders) {
  const text = readFileSync(file, "utf8");
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : file.endsWith(".ts") || file.endsWith(".mts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const bound = boundNames(source);

  /** `deferred`: inside something that runs only when called (or constructed). */
  const visit = (node, deferred) => {
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isModuleDeclaration(node)) return;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (isAmbient(node) && !ts.isSourceFile(node)) return;
    if (ts.isTypeNode(node) && !isExtendsExpression(node)) return;

    if (isFunctionLike(node)) {
      // Its NAME (a computed method name) is evaluated with the class; the rest when it is called.
      if (node.name) visit(node.name, deferred);
      for (const child of node.parameters) visit(child, true);
      if (node.body) visit(node.body, true);
      return;
    }
    if (ts.isPropertyDeclaration(node)) {
      visit(node.name, deferred);
      if (node.initializer) visit(node.initializer, deferred || !isStatic(node));
      return;
    }

    if (!deferred && ts.isIdentifier(node) && WEBGPU.test(node.text) && !bound.has(node.text) && !isNotAReference(node)) {
      const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
      offenders.push({ file, line: line + 1, column: character + 1, name: node.text, text: text.split(/\r?\n/)[line].trim() });
    }
    ts.forEachChild(node, (child) => visit(child, deferred));
  };
  visit(source, false);
}

const offenders = [];
let files = 0;
for (const root of ROOTS) {
  for (const file of walk(root, [])) {
    files++;
    check(file, offenders);
  }
}

if (offenders.length > 0) {
  console.error("\nA WebGPU global named at a module's top level:\n");
  for (const { file, line, column, name, text } of offenders) {
    console.error(`  ${file}:${line}:${column}  ${name}  —  ${text}`);
  }
  console.error(
    "\nIt throws a ReferenceError while the module graph is evaluated, before" +
      "\nmain.ts' WebGPU gate can say why, on any browser without WebGPU or any" +
      "\nplain-http LAN address. Write the flag as a LITERAL with the names in a" +
      "\ncomment, or name it inside the function that needs it." +
      "\nSee CLAUDE.md and docs/build.md.\n",
  );
  process.exit(1);
}

console.log(`no WebGPU global at a module's top level in ${files} files under ${ROOTS.join(", ")}`);
