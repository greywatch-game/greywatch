/**
 * Fails the build on a deep static import into `@babylonjs/core`.
 *
 * Run from `npm run build`, beside `check-collision.mjs`. **This is the only
 * absolute rule in the project that `tsc` cannot see**: a subpath import
 * compiles, typechecks and passes review, and what it breaks is a DEV session
 * only — Vite's optimizer pre-bundles the barrel and leaves the subpath out, so
 * the module graph ends up holding two copies of the same class and
 * `instanceof` stops answering. `CLAUDE.md` records what that cost the last
 * time: the glow layer silently unshaded, along with every `StandardMaterial`
 * in the game, blaming a subsystem that was not at fault and hiding itself on
 * the next restart.
 *
 * The tree had four of these, all in `src/shaders/` and all grandfathered
 * because the WebGL2 cel and grass shaders genuinely needed Babylon's own
 * `bones*` and `instances*` includes. The WGSL port ended with none: the
 * instances pair became `celInstances*` in `wgsl/includes.ts`, and the bone
 * pair left with the skinned cel variant, which had no caller. So the rule is
 * now enforceable rather than merely stated, and this is the moment to enforce
 * it — an empty allow-list is the only kind that stays empty.
 *
 * **Scoped to `src/` and `main.ts`**, which is what ships to a browser through
 * Vite. `server/` is deliberately outside it: `NullEngine` is imported by
 * subpath there ON PURPOSE, because the server has no Vite optimizer in front
 * of it and pulling the whole barrel into a headless process costs seconds of
 * boot for a class it does not use.
 *
 * Matches an import STATEMENT and not the string, so the several places that
 * name one of these paths in prose — the argument for why they are gone is
 * worth keeping — do not fail the build for saying so.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** `import ... from "@babylonjs/core/x"` and bare `import "@babylonjs/core/x"`. */
const DEEP = /(?:^|\n)\s*import\s+(?:[^'"\n]*?\sfrom\s+)?["']@babylonjs\/core\/[^"']+["']/g;

const ROOTS = ["src", "main.ts"];
const EXTS = [".ts", ".tsx", ".mts", ".js", ".mjs"];

/** Every source file under a root, recursively. */
function walk(path, out) {
  if (statSync(path).isDirectory()) {
    for (const entry of readdirSync(path)) walk(join(path, entry), out);
  } else if (EXTS.some((e) => path.endsWith(e))) {
    out.push(path);
  }
  return out;
}

const offenders = [];
for (const root of ROOTS) {
  for (const file of walk(root, [])) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(DEEP)) {
      const line = text.slice(0, match.index).split("\n").length;
      offenders.push({ file, line, text: match[0].trim() });
    }
  }
}

if (offenders.length > 0) {
  console.error("\nDeep import into @babylonjs/core:\n");
  for (const { file, line, text } of offenders) {
    console.error(`  ${file}:${line}  ${text}`);
  }
  console.error(
    "\nImport from the barrel instead. A subpath breaks a DEV session only," +
      "\nblames a subsystem that is not at fault, and hides on a restart." +
      "\nSee CLAUDE.md and docs/build.md.\n",
  );
  process.exit(1);
}

console.log(`no deep @babylonjs/core imports in ${ROOTS.join(", ")}`);
