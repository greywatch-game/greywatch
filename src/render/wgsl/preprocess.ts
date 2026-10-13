/**
 * render/wgsl/preprocess.ts — The two directives a shared WGSL body is
 * written with, resolved into text with neither left in it.
 * Owns: `preprocess` — `#include<name>` against a table, and `#define NAME`,
 * `#ifdef`, `#ifndef`, `#else`, `#endif` over a variant's define set; and the
 * comment strip that runs first.
 * Invariants: the output carries no directive and no comment; every directive
 * it does not implement is REFUSED, by name and line, rather than passed
 * through — a line Babylon's processor would have read and ours dropped is a
 * shader that compiles and draws something else; a chunk is included at most
 * once per program, so a duplicate is an error here rather than a
 * redeclaration in the driver's words.
 * Never: imports Babylon; substitutes text — a `#define` with a VALUE is
 * refused, because a define is a flag here and a number is a WGSL `const`
 * (`docs/rendering.md` has what Babylon's un-anchored substitution does to a
 * name that is a substring of another).
 * Contract: `docs/rendering.md`, "Hand-written WGSL".
 *
 * WHY THIS SUBSET AND NO MORE. It is exactly what `shaders/wgsl/chunks.ts`
 * says a shared body may use, which is what Babylon's processor already does
 * with those same lines — so the two renderers read one body the same way,
 * and a body that reaches for `#if` or `#elif` is told so here before it
 * reaches for it on the other side too. Widening it is one more arm below and
 * one more line in that rule, together.
 *
 * WHY THE COMMENTS GO FIRST. A directive is a line whose first character is
 * `#`, so a commented-out one is already inert; what stripping buys is that a
 * body's PROSE is never read as code by the step after this one, which
 * rewrites `uniforms.` references (`assemble.ts`) and must not trip over one
 * quoted in a comment. Babylon's processor strips them first for the same
 * kind of reason.
 */

/** What a program is preprocessed against. */
export interface PreprocessOptions {
  /** The variant: a name in here is defined, and nothing else is. */
  readonly defines: Iterable<string>;
  /** What `#include<name>` resolves to, by name. */
  readonly includes: Readonly<Record<string, string>>;
  /** Names the program in an error, so a failure says whose source it was. */
  readonly label: string;
}

/** One open `#ifdef`: whether its own branch is emitting, and its parent's. */
interface Frame {
  readonly outer: boolean;
  readonly taken: boolean;
  readonly elsed: boolean;
}

/**
 * The source with every include expanded and every conditional resolved for
 * this variant, comment-free. Throws on anything it does not implement.
 */
export function preprocess(source: string, options: PreprocessOptions): string {
  const defined = new Set(options.defines);
  const included = new Set<string>();
  const out: string[] = [];

  const expand = (text: string, where: string): void => {
    const lines = stripComments(text).split("\n");
    const stack: Frame[] = [];
    let live = true;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const t = line.trim();
      if (!t.startsWith("#")) {
        if (live && t.length > 0) out.push(line);
        continue;
      }
      const at = `${options.label}: ${where}:${i + 1}`;
      const include = /^#include\s*<\s*(\w+)\s*>$/.exec(t);
      const word = /^#(\w+)\s*(\w*)\s*(.*)$/.exec(t);
      const [, directive, name, rest] = word ?? [];
      if (include) {
        if (!live) continue;
        const chunk = include[1];
        const body = options.includes[chunk];
        if (body === undefined) throw new Error(`${at}: no chunk "${chunk}" to include`);
        if (included.has(chunk)) throw new Error(`${at}: "${chunk}" is included twice`);
        included.add(chunk);
        expand(body, chunk);
      } else if ((directive === "ifdef" || directive === "ifndef") && name && !rest) {
        const holds = defined.has(name) === (directive === "ifdef");
        stack.push({ outer: live, taken: holds, elsed: false });
        live = live && holds;
      } else if (directive === "else" && !name && !rest) {
        const top = stack.pop();
        if (!top || top.elsed) throw new Error(`${at}: #else with no #ifdef open`);
        stack.push({ outer: top.outer, taken: true, elsed: true });
        live = top.outer && !top.taken;
      } else if (directive === "endif" && !name && !rest) {
        const top = stack.pop();
        if (!top) throw new Error(`${at}: #endif with no #ifdef open`);
        live = top.outer;
      } else if (directive === "define" && name && !rest) {
        if (live) defined.add(name);
      } else {
        throw new Error(`${at}: "${t}" is not a directive a shared body may use`);
      }
    }
    if (stack.length > 0) throw new Error(`${options.label}: ${where}: #ifdef left open`);
  };

  expand(source, "source");
  return out.join("\n");
}

/**
 * The text with its `//` and `/* *\/` comments blanked, line breaks kept so
 * the line an error names is the chunk's own.
 * WGSL has no string literals, so nothing that looks like a comment is
 * anything else.
 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ""))
    .replace(/\/\/[^\n]*/g, "");
}
