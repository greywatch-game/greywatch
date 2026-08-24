/**
 * editor/serialize.ts — Writes an edited layout back into layout.ts's source
 * text, changing as little as possible.
 * Owns: the emit rules and the value formatter.
 *
 * The governing rule, in two halves:
 *
 * - An entry nobody touched is re-emitted as its **original line, byte for
 *   byte**. Not reformatted, not normalised — copied.
 * - An entry that changed is rebuilt field by field, and each field whose
 *   value is still equal to what was loaded re-emits its **original source
 *   token**.
 *
 * That second half is what preserves `TERRACE_H`, `BANK_H`, `VALEGUARD`,
 * `Math.PI / 2` and hand-chosen spacing even inside an entry that was
 * partially edited — without this file ever having to evaluate or understand
 * those expressions. It compares against a deep snapshot of the layout taken
 * when the editor opened, so "unchanged" is decided on values, and the token
 * is just carried along.
 *
 * Newly written values are formatted, and only then does a substitution table
 * apply — scoped per field, because an unscoped `2 -> TERRACE_H` would happily
 * corrupt `params: { length: 2 }`.
 *
 * Added and deleted entries fit that rule rather than bending it. Entries are
 * matched to source lines by OBJECT IDENTITY (see `Baseline`), so a deleted
 * entry's line is dropped, an added entry is written fresh at the end of its
 * array, and every line in between is still copied byte for byte.
 */
import { Vector3 } from "@babylonjs/core";
import type { MapLayout } from "../world/layout";
import {
  itemsOf,
  type ItemLine,
  type ParsedField,
  type Scan,
} from "./sourceScan";

/** Named constants worth restoring, per field path. */
const CONSTANTS: Record<string, [number, string][]> = {
  y: [
    [2, "TERRACE_H"],
    [1.5, "BANK_H"],
  ],
  "pos.y": [
    [2, "TERRACE_H"],
    [1.5, "BANK_H"],
  ],
};

const COLORS: Record<string, string> = {
  "#c9a15e": "VALEGUARD",
  "#ff3b3b": "REDLINE",
};

/** Fields that read better as multiples of pi, matching how they're authored. */
const ANGLE_KEYS = new Set(["rotY", "yaw", "rotX"]);

/**
 * Declaration order per array, so a field the editor ADDS lands where the
 * house style puts it instead of being appended. Without this, giving an
 * unrotated cottage a rotY writes `{ kind, x, z, params, rotY }` while every
 * line around it reads `{ kind, x, z, rotY, params }`.
 *
 * Only affects entries being rewritten anyway; untouched lines are copied.
 */
const KEY_ORDER: Record<string, string[]> = {
  placements: ["kind", "x", "z", "y", "rotY", "params"],
  scatter: [
    "prop",
    "x",
    "z",
    // A region carries `radius` or `width`/`depth`, never both; listing all
    // three keeps whichever it has in the same slot on the line.
    "radius",
    "width",
    "depth",
    "rotY",
    "count",
    "y",
    "scale",
    "blocking",
    "clearance",
  ],
  controlPoints: ["id", "name", "pos", "radius"],
  spawns: ["team", "controlPoint", "pos", "yaw"],
  water: ["x", "z", "width", "depth", "y"],
  grass: ["x", "z", "width", "depth", "y", "density"],
};

export class SerializeError extends Error {}

/** A number, trimmed to something a human would have typed. */
function num(v: number): string {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? "0" : String(r);
}

/** Angles as `Math.PI / 2` and friends when they land on a quarter turn. */
function angle(v: number): string {
  if (v === 0) return "0";
  const turns = v / Math.PI;
  const q = Math.round(turns * 4) / 4;
  if (Math.abs(turns - q) > 1e-9) return num(v);
  const sign = q < 0 ? "-" : "";
  const a = Math.abs(q);
  if (a === 1) return `${sign}Math.PI`;
  if (a === 0.5) return `${sign}Math.PI / 2`;
  if (a === 0.25) return `${sign}Math.PI / 4`;
  if (a === 0.75) return `${sign}(Math.PI * 3) / 4`;
  if (a === 1.5) return `${sign}(Math.PI * 3) / 2`;
  return num(v);
}

/** Formats a value as source, at the given field path. */
function format(value: unknown, path: string): string {
  if (value === undefined) return "undefined";
  // null is a VALUE here, not an absence: `team: null` is how the layout
  // spells a spawn that belongs to a flag rather than to a side.
  if (value === null) return "null";
  if (typeof value === "boolean") return String(value);

  if (typeof value === "number") {
    const leaf = path.split(".").pop() ?? path;
    if (ANGLE_KEYS.has(leaf)) return angle(value);
    for (const [n, name] of CONSTANTS[path] ?? []) {
      if (value === n) return name;
    }
    return num(value);
  }

  if (typeof value === "string") {
    const named = COLORS[value.toLowerCase()];
    return named ?? JSON.stringify(value);
  }

  if (value instanceof Vector3) {
    // The y goes back through `format` so a flag standing on the terrace is
    // written `new Vector3(-60, TERRACE_H, 76)` like its neighbours, rather
    // than with a bare 2 nobody would recognise later.
    return `new Vector3(${num(value.x)}, ${format(value.y, `${path}.y`)}, ${num(value.z)})`;
  }

  if (Array.isArray(value)) {
    return `[${value.map((v) => format(v, path)).join(", ")}]`;
  }

  if (typeof value === "object") {
    const body = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}: ${format(v, `${path}.${k}`)}`)
      .join(", ");
    return `{ ${body} }`;
  }

  return String(value);
}

/** Value equality that understands Vector3 and plain data. */
export function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Vector3 && b instanceof Vector3) return a.equals(b);
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => equal(v, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as object).filter(
      (k) => (a as Record<string, unknown>)[k] !== undefined,
    );
    const kb = Object.keys(b as object).filter(
      (k) => (b as Record<string, unknown>)[k] !== undefined,
    );
    if (ka.length !== kb.length) return false;
    return ka.every((k) =>
      equal((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    );
  }
  return false;
}

/** A deep copy, so the original values survive being edited in place. */
export function snapshot<T>(value: T): T {
  if (value instanceof Vector3) return value.clone() as unknown as T;
  if (Array.isArray(value)) return value.map(snapshot) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = snapshot(v);
    return out as T;
  }
  return value;
}

/**
 * Rebuilds one entry's line. Retained fields keep their original order and
 * their original token; changed and added fields are formatted; fields the
 * editor removed simply do not appear, and the line's trailing note comes back
 * on the end.
 */
function emitItem(
  line: ItemLine,
  original: Record<string, unknown>,
  current: Record<string, unknown>,
  region: string,
): string {
  const fields = line.fields;
  // Untokenizable entry: refuse to rewrite it rather than risk mangling it.
  if (!fields) return line.source;

  const byKey = new Map(fields.map((f) => [f.key, f]));
  const canonical = KEY_ORDER[region] ?? [];
  // Canonical first, then anything the table doesn't know about, in the order
  // the source had it — an unrecognised field must never be silently dropped.
  const order = [
    ...canonical,
    ...fields.map((f) => f.key).filter((k) => !canonical.includes(k)),
    ...Object.keys(current).filter(
      (k) => !canonical.includes(k) && !byKey.has(k),
    ),
  ];

  const out: string[] = [];
  const done = new Set<string>();
  for (const key of order) {
    if (done.has(key)) continue;
    done.add(key);
    const now = current[key];
    if (now === undefined) continue; // absent, or removed by the editor
    const field = byKey.get(key);
    out.push(
      `${key}: ${field ? tokenFor(field, original[key], now, key) : format(now, key)}`,
    );
  }

  // The note the line was authored with rides along: it annotates this entry,
  // so it survives the entry being edited exactly as an untouched line's does.
  return `${line.indent}{ ${out.join(", ")} },${line.trailing}`;
}

/** The original token when the value is untouched, a fresh one otherwise. */
function tokenFor(
  field: ParsedField,
  before: unknown,
  after: unknown,
  path: string,
): string {
  return equal(before, after) ? field.source : format(after, path);
}

/** A brand-new entry, formatted from nothing. Added entries only. */
function emitFresh(
  entry: Record<string, unknown>,
  region: string,
  indent: string,
): string {
  const canonical = KEY_ORDER[region] ?? [];
  const rest = Object.keys(entry).filter((k) => !canonical.includes(k));
  const out: string[] = [];
  for (const key of [...canonical, ...rest]) {
    const v = entry[key];
    if (v === undefined) continue;
    out.push(`${key}: ${format(v, key)}`);
  }
  return `${indent}{ ${out.join(", ")} },`;
}

/** The entries of one region, as plain records, from a layout. */
function entriesOf(layout: MapLayout, name: string): Record<string, unknown>[] {
  const v = (layout as unknown as Record<string, unknown>)[name];
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
}

/**
 * What one live layout entry looked like when the editor opened, and which
 * source line it came from.
 *
 * Identity is the ENTRY OBJECT itself, not its position in the array. That is
 * what lets entries be added and deleted: an entry that was spliced out simply
 * never turns up while walking the source, and an entry with no baseline is
 * one the editor created and has to be written from scratch. Positional
 * matching would go wrong the moment anything ahead of it was deleted.
 */
export interface Baseline {
  line: ItemLine;
  values: Record<string, unknown>;
}

export type Baselines = WeakMap<object, Baseline>;

/**
 * Associates each live entry with the source line it was parsed from.
 *
 * Positional here, and correctly so: this runs against a file the layout was
 * just loaded from (or just written to), where the two are in step by
 * construction. Everything afterwards works off object identity.
 */
export function bindBaselines(scan: Scan, layout: MapLayout): Baselines {
  const map: Baselines = new WeakMap();
  for (const region of scan.regions) {
    const items = itemsOf(region);
    const entries = entriesOf(layout, region.name);
    if (items.length !== entries.length) {
      throw new SerializeError(
        `${region.name}: source has ${items.length} entries, layout has ` +
          `${entries.length}. Reload the editor.`,
      );
    }
    for (const [i, entry] of entries.entries()) {
      map.set(entry, { line: items[i], values: snapshot(entry) });
    }
  }
  return map;
}

export interface SerializeResult {
  source: string;
  /**
   * Entries that changed but could not be rewritten because their source line
   * did not tokenize. Reported rather than thrown: one unparseable line must
   * not block a save of twenty good edits, but silently dropping the edit
   * would be worse than either.
   */
  skipped: string[];
}

/**
 * Produces the new contents of layout.ts.
 *
 * Walks the source, not the layout: every line comes out in the order the file
 * already had it, and the layout only decides whether each one survives, gets
 * rewritten, or is joined by new lines at the end of its array. Comments and
 * blank lines are `raw` and are copied wherever they sit, so district headers
 * stay attached to the district they introduce.
 */
export function serializeLayout(
  scan: Scan,
  baselines: Baselines,
  current: MapLayout,
): SerializeResult {
  const out: string[] = [];
  const skipped: string[] = [];
  let cursor = 0;

  for (const region of scan.regions) {
    for (; cursor <= region.start; cursor++) out.push(scan.lines[cursor]);

    const entries = entriesOf(current, region.name);
    // Which live entry, if any, still owns each source line.
    const owner = new Map<ItemLine, Record<string, unknown>>();
    const fresh: Record<string, unknown>[] = [];
    for (const entry of entries) {
      const base = baselines.get(entry);
      if (base && !owner.has(base.line)) owner.set(base.line, entry);
      else fresh.push(entry);
    }

    for (const line of region.body) {
      if (line.kind === "raw") {
        out.push(line.source);
        continue;
      }
      const entry = owner.get(line);
      if (!entry) continue; // deleted — the line goes with it
      const base = baselines.get(entry)!;
      // The whole point: an untouched entry is copied, not regenerated.
      if (equal(base.values, entry)) {
        out.push(line.source);
        continue;
      }
      if (!line.fields) skipped.push(line.source.trim());
      out.push(emitItem(line, base.values, entry, region.name));
    }

    // Added entries land at the end of their array, which is also where the
    // editor appended them, so the file and the data stay in the same order.
    if (fresh.length) {
      const indent = itemsOf(region)[0]?.indent ?? "  ";
      for (const entry of fresh) {
        out.push(emitFresh(entry, region.name, indent));
      }
    }
    cursor = region.end;
  }

  for (; cursor < scan.lines.length; cursor++) out.push(scan.lines[cursor]);
  declareMissingRegions(out, scan, current);
  // The scan's own terminator, not "\n": a CRLF checkout must come back CRLF or
  // a no-op save rewrites every line in the file.
  return { source: out.join(scan.eol), skipped };
}

/**
 * The element type each creatable list is declared with. These are the two
 * arrays `MapLayout` marks optional, so they are the two a map can be missing
 * entirely — and both are exported from `world/layout`, which every layout
 * file already imports its vocabulary from.
 */
const REGION_TYPES: Record<string, string> = {
  water: "WaterRect",
  grass: "GrassRect",
};

/**
 * Declares any list that has entries but has never existed in the source.
 *
 * A map with no lawns has no `grass` array at all, so the first rect added to
 * one has nowhere in the file to live. Without this, `serializeLayout` walks
 * REGIONS and a list with no region is skipped in silence: the entries are
 * dropped on save and the author is told it went fine. That is the worst of
 * the three available behaviours — worse than refusing the add, which is what
 * the editor used to do — and it is why the fix lives here and not only in
 * `addItem`. The two halves are a pair: an array the editor creates at runtime
 * and a declaration written for it here, and either one alone loses data.
 */
function declareMissingRegions(
  out: string[],
  scan: Scan,
  current: MapLayout,
): void {
  for (const [name, type] of Object.entries(REGION_TYPES)) {
    if (scan.regions.some((r) => r.name === name)) continue;
    const entries = entriesOf(current, name);
    if (entries.length > 0) declareRegion(out, name, type, entries);
  }
}

/**
 * Writes one array declaration into the source, in the three places this
 * file's house style spells one.
 *
 * Every anchor is checked and a missing one throws, because the alternative is
 * emitting a layout.ts that does not compile — and the editor's whole contract
 * is that it patches an authored file rather than regenerating it. The `const`
 * goes after the last array already declared rather than immediately before
 * the export, so it lands among its siblings instead of between the export's
 * doc comment and the export.
 */
function declareRegion(
  out: string[],
  name: string,
  type: string,
  entries: Record<string, unknown>[],
): void {
  const exportAt = out.findIndex((l) => /^export const \w+: MapLayout = \{$/.test(l));
  if (exportAt < 0) {
    throw new SerializeError(
      `layout.ts: no "export const …: MapLayout = {" to declare ${name} in`,
    );
  }

  // The shorthand member first: it goes BELOW the export line, so inserting
  // the const above it afterwards leaves this index alone.
  let member = exportAt + 1;
  while (member < out.length && /^ {2}\w+,$/.test(out[member])) member++;
  if (member === exportAt + 1) {
    throw new SerializeError(
      `layout.ts: ${name} has nowhere to go — the exported object lists no arrays`,
    );
  }
  out.splice(member, 0, `  ${name},`);

  let end = exportAt - 1;
  while (end >= 0 && out[end] !== "];") end--;
  if (end < 0) {
    throw new SerializeError(
      `layout.ts: no array declaration to put ${name} after`,
    );
  }
  out.splice(
    end + 1,
    0,
    "",
    `const ${name}: ${type}[] = [`,
    ...entries.map((e) => emitFresh(e, name, "  ")),
    "];",
  );

  addTypeImport(out, type);
}

/**
 * Adds one name to the `import type { … } from "../layout"` block, keeping it
 * alphabetical — which is how all three shipped maps hold that list.
 *
 * Both forms are handled because both are things a hand-authored layout may
 * reasonably be written as, and the file this runs against is authored.
 */
function addTypeImport(out: string[], type: string): void {
  const close = out.indexOf('} from "../layout";');
  if (close >= 0) {
    const open = out.lastIndexOf("import type {", close);
    if (open < 0) {
      throw new SerializeError(`layout.ts: unclosed import type block`);
    }
    const line = `  ${type},`;
    if (out.slice(open + 1, close).includes(line)) return;
    let at = open + 1;
    while (at < close && out[at].trim().replace(/,$/, "") < type) at++;
    out.splice(at, 0, line);
    return;
  }

  const oneLine = out.findIndex((l) =>
    /^import type \{ .* \} from "\.\.\/layout";$/.test(l),
  );
  if (oneLine < 0) {
    throw new SerializeError(
      `layout.ts: no \`import type { … } from "../layout"\` to add ${type} to`,
    );
  }
  const names = out[oneLine]
    .replace(/^import type \{ | \} from "\.\.\/layout";$/g, "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
  if (names.includes(type)) return;
  names.push(type);
  names.sort();
  out[oneLine] = `import type { ${names.join(", ")} } from "../layout";`;
}

/** Regions the scanner must have found for a save to be considered safe. */
export function validateScan(scan: Scan): void {
  const required: Record<string, number> = {};
  for (const r of scan.regions) required[r.name] = r.end - r.start;
  for (const name of ["placements", "scatter", "controlPoints", "spawns"]) {
    if (!(name in required)) {
      throw new SerializeError(`layout.ts: could not find the ${name} array`);
    }
  }
}
