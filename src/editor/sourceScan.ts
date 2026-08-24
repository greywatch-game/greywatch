/**
 * editor/sourceScan.ts — Reads layout.ts as TEXT and models the editable
 * arrays as lines, so a save can rewrite the few that changed and leave
 * everything else byte-identical.
 * Owns: the line model and the one-line object-literal tokenizer. Writes
 * nothing and evaluates nothing.
 *
 * Why text and not a code generator: layout.ts is authored, not generated. It
 * carries a large ASCII map of the village, per-district commentary, and local
 * constants (BANK_H, TERRACE_H, VALEGUARD, REDLINE) used in place of bare
 * numbers.
 * Regenerating the file from data would destroy all of it on the first save.
 * So the rule is inverted — the source is authoritative and the editor patches
 * the individual lines it actually changed.
 *
 * Two facts make that practical, both checked against the real file:
 *
 * 1. Every entry in every array is exactly one line: `  { ... },` — optionally
 *    with a `// …` note after the comma. There is no multi-line entry anywhere
 *    in the file. That note belongs to the LINE and not to the entry, so it is
 *    split off before tokenizing and put back when the entry is rewritten.
 *    Coldharbour labels four of its buildings that way, and while the scanner
 *    tested the whole line for a `},` ending, those four were not entries at
 *    all: the region came up four short of the layout and the map could not be
 *    opened in the editor.
 * 2. Each array is delimited by its own `const name: Type = [` and a closing
 *    `];` at column 0. Those are the region anchors — no marker comments are
 *    needed, so layout.ts needs no preparation to be editable.
 *
 * Anything that does not fit the shape is kept as a `raw` line and re-emitted
 * untouched; an entry line that fails to tokenize becomes `opaque` and is
 * likewise never rewritten. The failure mode is always "leave it alone".
 *
 * **Line endings are stripped on the way in and restored on the way out.** A
 * Windows checkout with `core.autocrlf=true` holds the file as CRLF, so a split
 * on "\n" alone leaves every line carrying a trailing "\r" — the array's closing
 * `];` then matches nothing and every region is silently missed, which surfaces
 * as "could not find the placements array" on the first Ctrl+S. So the scan
 * normalises, records the file's own `eol`, and `serializeLayout` joins with it,
 * which is also what keeps a no-op save byte-identical on either platform.
 */

/** One `key: value` pair, with the value's ORIGINAL source text. */
export interface ParsedField {
  key: string;
  /** Verbatim source of the value, e.g. `TERRACE_H` or `Math.PI / 2`. */
  source: string;
}

/** A line holding one array entry. */
export interface ItemLine {
  kind: "item";
  /** Leading whitespace, preserved. */
  indent: string;
  /** The whole original line, re-emitted when the entry is unchanged. */
  source: string;
  /**
   * Anything after the entry's closing `},` — a ` // note` and the whitespace
   * before it, or `""`. Re-appended when the entry is rewritten, so annotating
   * a line does not cost the note the first time the editor touches it.
   */
  trailing: string;
  /** Null when the line could not be tokenized — then it is never rewritten. */
  fields: ParsedField[] | null;
}

/** A comment, a blank line, or anything else between entries. */
export interface RawLine {
  kind: "raw";
  source: string;
}

export type Line = ItemLine | RawLine;

/** One editable array in the file. */
export interface Region {
  /** The variable name, e.g. `placements`. */
  name: string;
  /** Index of the `const … = [` line in `lines`. */
  start: number;
  /** Index of the closing `];` line in `lines`. */
  end: number;
  /** Everything strictly between, in order. */
  body: Line[];
}

export interface Scan {
  /** The file split on newlines, with no line terminator left on any line. */
  lines: string[];
  /** The terminator the file was written with, put back on serialization. */
  eol: string;
  regions: Region[];
}

/** The arrays the editor is allowed to rewrite. */
const EDITABLE = [
  "placements",
  "scatter",
  "controlPoints",
  "spawns",
  "water",
  "grass",
] as const;

export type RegionName = (typeof EDITABLE)[number];

/**
 * Splits a one-line object literal's interior into top-level `key: value`
 * pairs, keeping each value's source verbatim. Returns null on anything it
 * cannot account for — an unbalanced bracket, a missing key — so the caller
 * can fall back to leaving the line alone.
 *
 * Deliberately not a TypeScript parser: it only has to handle one line of
 * object literal, and a parser would drag a dependency and a build step into
 * a dev tool for no gain.
 */
export function splitFields(inner: string): ParsedField[] | null {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "{" || ch === "[" || ch === "(") depth++;
    else if (ch === "}" || ch === "]" || ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
    if (depth < 0) return null;
  }
  if (depth !== 0 || quote) return null;
  parts.push(inner.slice(start));

  const fields: ParsedField[] = [];
  for (const part of parts) {
    if (!part.trim()) continue; // trailing comma
    const colon = topLevelColon(part);
    if (colon < 0) return null;
    const key = part.slice(0, colon).trim().replace(/^["']|["']$/g, "");
    const source = part.slice(colon + 1).trim();
    if (!key || !source) return null;
    fields.push({ key, source });
  }
  return fields.length ? fields : null;
}

/** Index of the `:` separating key from value, ignoring nested structures. */
function topLevelColon(part: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < part.length; i++) {
    const ch = part[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "{" || ch === "[" || ch === "(") depth++;
    else if (ch === "}" || ch === "]" || ch === ")") depth--;
    else if (ch === ":" && depth === 0) return i;
  }
  return -1;
}

/**
 * Splits a line into its code and whatever `// …` note follows it, quote-aware
 * so a `//` inside a string stays in the code half. Returns the note with its
 * leading whitespace attached, which is what lets a rewritten line come back
 * spaced exactly as it was authored.
 */
export function splitComment(line: string): [string, string] {
  let quote: string | null = null;
  for (let i = 0; i < line.length - 1; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "/" && line[i + 1] === "/") {
      const code = line.slice(0, i);
      return [code.trimEnd(), line.slice(code.trimEnd().length)];
    }
  }
  return [line, ""];
}

/** Parses one line into an entry or a raw line. */
function classify(line: string): Line {
  // The note after an entry is not part of the entry: taken off here, carried
  // on the ItemLine, and put back by `emitItem`.
  const [code, trailing] = splitComment(line);
  const trimmed = code.trim();
  // An entry is a whole object literal with a trailing comma, alone on a line.
  if (!trimmed.startsWith("{") || !trimmed.endsWith("},")) {
    return { kind: "raw", source: line };
  }
  const inner = trimmed.slice(1, -2).trim();
  return {
    kind: "item",
    indent: line.slice(0, line.length - line.trimStart().length),
    source: line,
    trailing,
    fields: splitFields(inner),
  };
}

/**
 * Finds the editable arrays in a layout source file. Anything outside them —
 * the header comment, the imports, the constants, the exported object — is not
 * modelled at all and therefore cannot be touched by a save.
 */
export function scanLayout(source: string): Scan {
  const lines = source.split(/\r?\n/);
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const regions: Region[] = [];

  for (let i = 0; i < lines.length; i++) {
    const m = /^const\s+(\w+)\s*:\s*[\w<>[\]]+\s*=\s*\[\s*$/.exec(lines[i]);
    if (!m) continue;
    const name = m[1];
    if (!(EDITABLE as readonly string[]).includes(name)) continue;

    const end = lines.indexOf("];", i + 1);
    if (end < 0) continue;

    regions.push({
      name,
      start: i,
      end,
      body: lines.slice(i + 1, end).map(classify),
    });
    i = end;
  }

  return { lines, eol, regions };
}

/** The entries of a region, in order, ignoring comments and blank lines. */
export function itemsOf(region: Region): ItemLine[] {
  return region.body.filter((l): l is ItemLine => l.kind === "item");
}
