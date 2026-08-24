/**
 * editor/saveEnvironment.ts — Patches a map's `environment.ts` in place.
 * Owns: the raw-source snapshot of that one file, and the single-key rewrite.
 *
 * This is `save.ts`'s sibling and follows the same rule — the file is
 * AUTHORED, so it is patched rather than regenerated. An `EnvironmentSpec` is
 * ninety percent prose: every colour in it carries the argument for why it is
 * that colour, and a code generator would take all of it out on the first
 * save of a floor tint.
 *
 * It is deliberately NOT built on `sourceScan.ts`. That scanner models a
 * layout: flat arrays of one-line entries, anchored on their own `const name:
 * Type = [` … `];`. An environment is one nested literal with multi-line
 * members, which is precisely the shape that scanner refuses to touch. So this
 * does the smallest thing that is safe instead: it rewrites whole TOP-LEVEL
 * lines, by key, and only keys it was handed.
 *
 * Three rules make that safe rather than merely short:
 *
 * - **A key is anchored at the literal's own indent (two spaces).** Every
 *   nested member — `lighting`, `sky`, `water`, `grade` — sits at four or
 *   more, so a two-space anchor cannot match one by accident. `sky.moonColor`
 *   is not reachable from here and is not meant to be.
 * - **The anchor must match EXACTLY ONCE.** If a key is somehow ambiguous the
 *   patch is refused outright rather than guessing which line was meant. The
 *   failure mode here is always "leave the file alone".
 * - **The file must declare this map's own export**, checked the same way and
 *   for the same reason `LayoutSaver` checks its own: every map's
 *   `environment.ts` has the same shape, so a saver pointed at the wrong one
 *   would patch the wrong file and report a clean save.
 *
 * A value of `null` REMOVES the line, which is how a field returns to its
 * default — the same convention the layout serializer follows when a value
 * equals the builder's own default.
 *
 * What it does NOT do is touch the COMMENT above a key. Almost every field in
 * an environment carries the argument for why it is what it is, and a rewrite
 * that tried to keep that prose true would be guessing at prose. So the line
 * changes and the paragraph above it does not: after re-tinting a floor from
 * the editor, the note explaining the old colour is the author's to bring back
 * into line.
 */
import type { EnvironmentSpec } from "../world/environment";
import { DEFAULT_FLOOR_SURFACE } from "../world/floorSurfaces";
import { post, type SaveResult } from "./save";

/**
 * Every map's `environment.ts` as text. A `?raw` specifier is static and
 * cannot be chosen at runtime, so the whole set is pulled in and looked up by
 * id — free in the only build that can reach it, since `src/editor/` is behind
 * a DEV-only dynamic import.
 */
const ENV_SOURCES = import.meta.glob("../world/*/environment.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const envPath = (mapId: string) => `src/world/${mapId}/environment.ts`;

/**
 * The spec's export name, derived from the map id exactly as the layout's and
 * the heights' are: `greyfen` -> `GreyfenEnvironment`.
 */
const envExport = (mapId: string) =>
  `${mapId.charAt(0).toUpperCase()}${mapId.slice(1)}Environment`;

/** The indent every top-level member of the spec literal is written at. */
const INDENT = "  ";

/** What a patch writes: a source token, or null to remove the key's line. */
export type EnvEdits = Record<string, string | null>;

export class EnvironmentSaver {
  private source = "";
  private eol = "\n";
  private readonly error: string | null = null;

  constructor(private readonly mapId: string) {
    const key = Object.keys(ENV_SOURCES).find((p) =>
      p.endsWith(`/${mapId}/environment.ts`),
    );
    const source = key === undefined ? undefined : ENV_SOURCES[key];
    if (source === undefined) {
      this.error = `no environment source bundled for map "${mapId}"`;
      return;
    }
    const expected = `export const ${envExport(mapId)}`;
    if (!source.includes(expected)) {
      this.error =
        `${envPath(mapId)} does not declare "${expected}" — refusing to patch ` +
        "it, since a saver bound to the wrong map rewrites the wrong file";
      return;
    }
    this.source = source;
    this.eol = source.includes("\r\n") ? "\r\n" : "\n";
  }

  /** Non-null when the source could not be bound and saving is unsafe. */
  get blocked(): string | null {
    return this.error;
  }

  /**
   * The file with `edits` applied, without writing it. Throws when a key
   * cannot be placed unambiguously — the caller turns that into a refusal.
   */
  patch(edits: EnvEdits): string {
    const lines = this.source.split(this.eol);
    for (const [key, value] of Object.entries(edits)) {
      const at = anchorsFor(lines, key);
      if (at.length > 1) {
        throw new Error(`"${key}" appears ${at.length} times — refusing to guess`);
      }
      if (value === null) {
        if (at.length) lines.splice(at[0], 1);
        continue;
      }
      const line = `${INDENT}${key}: ${value},`;
      if (at.length) {
        lines[at[0]] = line;
        continue;
      }
      // A key the file has never carried goes in at the top of the literal,
      // which is where a reader looks for what a map fundamentally IS — and
      // is the one position that needs no other key to already exist.
      const open = lines.findIndex((l) =>
        l.startsWith(`export const ${envExport(this.mapId)}`),
      );
      if (open < 0) throw new Error(`cannot find ${envExport(this.mapId)}`);
      lines.splice(open + 1, 0, line);
    }
    return lines.join(this.eol);
  }

  async save(edits: EnvEdits): Promise<SaveResult> {
    if (this.error) return { ok: false, message: this.error };

    let source: string;
    try {
      source = this.patch(edits);
    } catch (err) {
      return { ok: false, message: String((err as Error).message ?? err) };
    }
    if (source === this.source) return { ok: true, message: "unchanged" };

    const res = await post(envPath(this.mapId), source);
    // The file on disk is now what was sent, so the next save must patch THAT
    // — otherwise the second save re-applies the first one's edits to stale
    // text. Same reasoning as `LayoutSaver` re-scanning after a write.
    if (res.ok) this.source = source;
    return res;
  }
}

/**
 * The floor's two fields as source tokens. `floorSurface` is emitted only when
 * it is not the default, which is the same rule the layout serializer follows:
 * a value equal to the default is REMOVED rather than written, so a map that
 * wants the plain colour says nothing about it.
 */
export function floorEdits(env: EnvironmentSpec): EnvEdits {
  return {
    floorColor: JSON.stringify(env.floorColor),
    floorSurface:
      env.floorSurface === undefined || env.floorSurface === DEFAULT_FLOOR_SURFACE
        ? null
        : JSON.stringify(env.floorSurface),
  };
}

/** Which lines carry this key at the literal's own indent. */
function anchorsFor(lines: string[], key: string): number[] {
  const prefix = `${INDENT}${key}:`;
  const out: number[] = [];
  lines.forEach((l, i) => {
    if (l.startsWith(prefix)) out.push(i);
  });
  return out;
}
