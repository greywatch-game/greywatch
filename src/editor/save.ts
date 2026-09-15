/**
 * editor/save.ts — Turns the edited layout back into layout.ts and posts it to
 * the dev server.
 * Owns: the raw-source snapshot, the save call, and the dirty accounting.
 *
 * The raw source arrives through Vite's `?raw` import, so the browser holds
 * both the parsed layout and the exact text it was parsed from. All the
 * decisions about what to rewrite happen here, under `npm run typecheck`; the
 * server side is a byte writer that checks the path and little else.
 *
 * A saver is bound to ONE map, by id: it picks that map's source text, its two
 * write paths and its heights export name from it, and refuses to start if the
 * source it found does not name that map. Every map's layout.ts has the same
 * shape, so a saver pointed at the wrong one patches the wrong file and
 * succeeds — which is the only failure mode here that loses work silently.
 */
import type { Heightfield, MapLayout } from "../world/layout";
import {
  bindBaselines,
  serializeLayout,
  validateScan,
  type Baselines,
  type SerializeError,
} from "./serialize";
import { scanLayout, type Scan } from "./sourceScan";

/**
 * Every map's `layout.ts` as TEXT, keyed by the path Vite resolves it under.
 *
 * A `?raw` import is a static specifier and cannot be chosen at runtime, so
 * the whole set is pulled in and looked up by map id. That is free in the only
 * build that can reach it: `src/editor/` is behind a DEV-only dynamic import
 * in `Game.toggleEditor`, so Rollup drops this and everything around it out of
 * a production bundle.
 */
const LAYOUT_SOURCES = import.meta.glob("../world/*/layout.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/**
 * The two files a map owns, by map id. Both paths must appear in
 * `vite.config.ts`'s `WRITABLE` table or the dev server refuses the write —
 * that table is the security boundary and this is only a convenience.
 */
const layoutPath = (mapId: string) => `src/world/${mapId}/layout.ts`;
const heightsPath = (mapId: string) => `src/world/${mapId}/heights.ts`;

/**
 * The heights module's export name, derived from the map id the same way the
 * layout's is authored: `greyfen` -> `GreyfenHeights`. It has to match what
 * that map's `layout.ts` imports, and nothing checks it at runtime — a wrong
 * name here is a file that fails to compile after a terrain save.
 */
const heightsExport = (mapId: string) =>
  `${mapId.charAt(0).toUpperCase()}${mapId.slice(1)}Heights`;

export interface SaveResult {
  ok: boolean;
  message: string;
}

/**
 * The heightfield module with its NUMBERS rewritten and nothing else.
 *
 * Everything above the first row and below the last is the file's own and is
 * kept byte for byte — the rule `layout.ts` saves follow, applied to the one
 * part of this file that is authored. It used to be regenerated wholesale from
 * a template on the grounds that it was "several thousand bare numbers" with
 * nothing to preserve, and that stopped being true the moment a generator
 * wrote one: Cinderhaven's header is sixty-odd lines on the five passes its
 * floor is built from, Sarab's and Coldharbour's argue theirs too, and every
 * save of the LAYOUT — a fence moved, nothing sculpted — replaced all of it
 * with a paragraph about a village. It also changed the file, which is hashed
 * by `scripts/collision-hash.mjs`, so a save that touched no terrain still
 * staled the collision bake.
 *
 * One row per line so a diff shows which strips of the map moved rather than
 * one unreadable mega-line.
 *
 * Refuses (returns an error string) rather than guessing when `current` is not
 * the shape the editor writes, or describes a different grid or a different
 * map: a header that says 80x80 over a 100x100 field, or `GreyfenHeights` in
 * Hollowmere's file, is a file that lies or does not compile. The failure mode
 * is "leave it alone", as everywhere in the save path.
 *
 * @param current the file's text as it is on disk now, CRLF or LF.
 * @param eol the terminator to write, the layout file's own, so the two files
 *   written by one save agree with each other and with the checkout.
 */
export function serializeHeights(
  field: Heightfield,
  mapId: string,
  current: string,
  eol = "\n",
): { ok: true; source: string } | { ok: false; error: string } {
  const text = current.replace(/\r\n/g, "\n");
  const path = heightsPath(mapId);
  const open = /^ {2}heights: \[\n/m.exec(text);
  const close = open ? /^ {2}\],\n/m.exec(text.slice(open.index + open[0].length)) : null;
  if (!open || !close) {
    return { ok: false, error: `${path}: no "  heights: [" … "  ]," block to rewrite` };
  }
  const head = text.slice(0, open.index + open[0].length);
  const tail = text.slice(open.index + open[0].length + close.index);
  const claims = [
    `export const ${heightsExport(mapId)}: Heightfield = {`,
    `  size: ${field.size},`,
    `  cell: ${field.cell},`,
  ];
  const missing = claims.find((c) => !head.includes(`\n${c}\n`));
  if (missing) {
    return { ok: false, error: `${path}: expected "${missing.trim()}" — not rewriting it` };
  }

  const row = field.size + 1;
  const rows: string[] = [];
  for (let j = 0; j < row; j++) {
    const line = field.heights
      .slice(j * row, (j + 1) * row)
      .map((v) => String(Math.round(v * 100) / 100))
      .join(",");
    rows.push(`    ${line},\n`);
  }
  const out = head + rows.join("") + tail;
  return { ok: true, source: eol === "\n" ? out : out.replace(/\n/g, eol) };
}

/** A writable file's current text, through the dev server's read arm. */
async function readSource(path: string): Promise<{ ok: true; source: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/__layout?path=${encodeURIComponent(path)}`);
    const data = (await res.json()) as { ok?: boolean; source?: string; error?: string };
    if (!res.ok || !data.ok || typeof data.source !== "string") {
      return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    }
    return { ok: true, source: data.source };
  } catch (err) {
    return { ok: false, error: `dev server unreachable: ${String(err)}` };
  }
}

export class LayoutSaver {
  private scan: Scan;
  /**
   * Each live layout entry, tied to the source line it came from and to the
   * values it had then. Every "has this changed?" question is answered against
   * this, which is what lets untouched entries be copied from source rather
   * than regenerated — and, because it is keyed by object identity, what lets
   * entries be added and deleted without the rest of the file shifting.
   */
  private baselines: Baselines = new WeakMap();
  private scanError: string | null = null;

  /**
   * @param mapId which map's `layout.ts` this saver owns — it picks the source
   *   text, both write paths, and the heights module's export name.
   * @param current the live layout, which must be that same map's.
   */
  constructor(
    private readonly mapId: string,
    current: MapLayout,
  ) {
    const key = Object.keys(LAYOUT_SOURCES).find((p) =>
      p.endsWith(`/${mapId}/layout.ts`),
    );
    const source = key === undefined ? undefined : LAYOUT_SOURCES[key];
    if (source === undefined) {
      this.scan = scanLayout("");
      this.scanError = `no layout source bundled for map "${mapId}"`;
      return;
    }
    this.scan = scanLayout(source);
    try {
      // Every map's layout.ts has the same SHAPE, so a saver holding map A's
      // text and patching map B's layout would mostly succeed — writing B's
      // numbers into A's file and reporting a clean save. Nothing downstream
      // can detect that, so the pairing is checked here, against the one thing
      // in the source that names the map: its own export.
      const expected = `export const ${heightsExport(mapId).replace(/Heights$/, "Layout")}`;
      if (!source.includes(expected)) {
        throw new Error(
          `${layoutPath(mapId)} does not declare "${expected}" — refusing to ` +
            "patch it, since a saver bound to the wrong map rewrites the wrong file",
        );
      }
      validateScan(this.scan);
      this.baselines = bindBaselines(this.scan, current);
    } catch (err) {
      this.scanError = String((err as SerializeError).message ?? err);
    }
  }

  /** Non-null when the source could not be modelled and saving is unsafe. */
  get blocked(): string | null {
    return this.scanError;
  }

  /** The file contents a save would write, without writing them. */
  preview(current: MapLayout): string {
    return serializeLayout(this.scan, this.baselines, current).source;
  }

  /**
   * Writes the map back: `layout.ts` always, `heights.ts` when the map has a
   * floor.
   *
   * The floor is an ARGUMENT rather than `current.terrain`, because it is not
   * on the layout any more — it is fetched (`MapDef.heights`) and handed to
   * `MapBuilder.build`, so what the brush has been editing is
   * `map.terrain.field` and that is what the caller passes. `null` on a level
   * map, and then only `layout.ts` is written; a file nobody asked to change
   * is not one to rewrite.
   */
  async save(
    current: MapLayout,
    floor: Heightfield | null,
  ): Promise<SaveResult> {
    if (this.scanError) return { ok: false, message: this.scanError };

    let source: string;
    let skipped: string[];
    try {
      ({ source, skipped } = serializeLayout(this.scan, this.baselines, current));
    } catch (err) {
      return { ok: false, message: String((err as Error).message ?? err) };
    }

    try {
      const res = await fetch("/__layout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: layoutPath(this.mapId), source }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        return { ok: false, message: data.error ?? `HTTP ${res.status}` };
      }
      // The file on disk is now what we just sent, so subsequent saves must
      // diff against it — otherwise the second save would re-apply the first
      // one's edits on top of stale text. Re-binding here is also what gives
      // entries added in this session a source line of their own, so editing
      // one again rewrites its line instead of appending a second copy.
      this.scan = scanLayout(source);
      this.baselines = bindBaselines(this.scan, current);
    } catch (err) {
      return { ok: false, message: `dev server unreachable: ${String(err)}` };
    }

    // The floor is a second file, written only when the map has one. Sent
    // after the layout so a failure here cannot leave layout.ts unwritten
    // while the heights it refers to have already moved. Read from DISK at
    // save time rather than bundled as `?raw`: a raw import is frozen at
    // module load, and Cinderhaven's alone is megabytes of numbers.
    let heightsWritten = false;
    if (floor) {
      const path = heightsPath(this.mapId);
      const read = await readSource(path);
      if (!read.ok) {
        return { ok: false, message: `layout saved, heights.ts not read: ${read.error}` };
      }
      const heights = serializeHeights(floor, this.mapId, read.source, this.scan.eol);
      if (!heights.ok) return { ok: false, message: `layout saved, ${heights.error}` };
      // Byte-identical is the ordinary case — a save that sculpted nothing —
      // and not writing it keeps the file's timestamp and the dev server's
      // watcher out of it.
      if (heights.source !== read.source) {
        const wrote = await post(path, heights.source);
        if (!wrote.ok) return wrote;
        heightsWritten = true;
      }
    }

    return {
      ok: true,
      message: skipped.length
        ? `saved — ${skipped.length} unparseable ${
            skipped.length > 1 ? "entries" : "entry"
          } left as-is`
        : heightsWritten
          ? "saved layout.ts + heights.ts"
          : "saved to layout.ts",
    };
  }
}

/**
 * POSTs one file to the dev server's write endpoint. Shared with
 * `saveEnvironment.ts`: what a file IS differs, but the wire, the path check
 * on the far end and the failure reporting are the same for all of them.
 */
export async function post(path: string, source: string): Promise<SaveResult> {
  try {
    const res = await fetch("/__layout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, source }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) {
      return { ok: false, message: data.error ?? `HTTP ${res.status}` };
    }
    return { ok: true, message: "saved" };
  } catch (err) {
    return { ok: false, message: `dev server unreachable: ${String(err)}` };
  }
}
