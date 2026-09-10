/**
 * dev/mixer/source.ts — turning the live faders back into `src/config/mix.ts`.
 * Owns: the one-line-per-group patch, and nothing else about the mixer.
 * Invariant: it PATCHES rather than regenerates. Every byte of that file that
 * is not one of the eleven value lines comes back untouched, which is what
 * lets the argument for why a group exists live in the config beside the
 * number instead of being frozen inside this generator.
 * Invariant: a group whose line cannot be found is a REFUSAL, never a silent
 * skip — a mixer that writes ten of eleven faders and says "saved" is worse
 * than one that will not write at all.
 * Gotcha: dev-only. Reachable solely through the dynamic import() in
 * `Game.toggleMixer`, exactly as `src/editor/` is.
 */

import {
  MIX_CHANNELS,
  MIX_GROUPS,
  type MixChannel,
  type MixGroup,
} from "../../config";

/**
 * How a fader is spelled in the file.
 *
 * Three decimals, and then every trailing zero taken off, so a slider left at
 * unity writes `1` and re-saving an untouched mixer is a no-op diff rather
 * than eleven lines of `1.000`. Three is well inside what a `gain.value`
 * resolves and well past what an ear does — the tightest step the panel
 * offers is a quarter of a decibel, which is 0.003 at unity.
 */
function num(v: number): string {
  const s = v.toFixed(3);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

/**
 * The line a key's value lives on, WITHIN one table's own text.
 *
 * Anchored to the start of a line and to two spaces of indent, which is a
 * table's own depth and not the depth of anything else in that file — the
 * unions above spell a member `  | "ownGun"` and the prose never opens a line
 * with `ownGun:`.
 *
 * **The scoping to one table is what makes it safe against a future
 * collision**, and it is not hypothetical: `CHANNEL_GROUPS` is a third table
 * of the same shape at the same indent, and a key that ever appears in two of
 * the three would otherwise be patched in whichever came first. Splitting the
 * file on the `export const` boundaries first means each key is only ever
 * looked for where it belongs.
 */
function lineFor(key: string): RegExp {
  return new RegExp(`^ {2}${key}: -?[0-9.]+,$`, "m");
}

/**
 * The text of one `export const <name> = {` ... `};` block, as a slice of the
 * whole file.
 *
 * Found by its opening line and closed at the first line that is exactly
 * `} as const satisfies ...` — which is how both fader tables end and is not
 * how anything inside one does. A block that cannot be found is a REFUSAL:
 * that is the file having been reshaped, and the one thing this must not do is
 * guess.
 */
function blockOf(source: string, name: string): { from: number; to: number } | null {
  // Anchored with `m` rather than searched for as a literal "\nexport const
  // …": this repo's working copies are CRLF (`core.autocrlf`), so a bare
  // newline in the needle finds nothing on the very machine the tool runs
  // on — and the failure is a REFUSAL, so the mixer would never write at
  // all. JavaScript's multiline `^`/`$` match around CR as well as LF,
  // which is why `lineFor` needs no help with the same problem.
  const open = new RegExp(`^export const ${name} = \\{$`, "m").exec(source);
  if (!open) return null;
  const from = open.index;
  const end = /^\} as const satisfies/m.exec(source.slice(from));
  if (!end) return null;
  return { from, to: from + end.index };
}

/** What a patch attempt came back with. */
export type PatchResult =
  | { ok: true; source: string; changed: number }
  | { ok: false; error: string };

/**
 * Writes both tiers of faders into the file's text.
 *
 * `changed` counts the lines whose value actually moved, so the panel can say
 * "nothing to save" rather than posting a byte-identical file and claiming a
 * write — the dev server would swallow its own HMR event for it and the status
 * line would be the only evidence anything happened at all.
 */
export function patchMix(
  source: string,
  groups: Record<MixGroup, number>,
  channels: Record<MixChannel, number>,
): PatchResult {
  let out = source;
  let changed = 0;
  for (const [name, keys, values] of [
    ["groups", MIX_GROUPS, groups as Record<string, number>],
    ["channels", MIX_CHANNELS, channels as Record<string, number>],
  ] as const) {
    const at = blockOf(out, name);
    if (!at) {
      return {
        ok: false,
        error: `no \`export const ${name}\` block in mix.ts — reshaped?`,
      };
    }
    let block = out.slice(at.from, at.to);
    for (const key of keys) {
      const re = lineFor(key);
      const found = re.exec(block);
      if (!found) {
        return {
          ok: false,
          error: `no line for "${key}" in mix.ts's ${name} — reshaped?`,
        };
      }
      const next = `  ${key}: ${num(values[key])},`;
      if (found[0] !== next) changed += 1;
      block = block.replace(re, next);
    }
    out = out.slice(0, at.from) + block + out.slice(at.to);
  }
  return { ok: true, source: out, changed };
}

/**
 * Reads the file the panel is about to patch, off the dev server's own write
 * endpoint.
 *
 * Deliberately a fetch rather than a `?raw` import: a raw import is resolved
 * once when this chunk loads, so the second save of a session would re-apply
 * this session's first save on top of a baseline that no longer exists on
 * disk. The editor's save has the same rule and solves it by re-scanning what
 * it just wrote; asking the server each time is the same guarantee with
 * nothing to remember.
 */
export async function readMixSource(): Promise<
  { ok: true; source: string } | { ok: false; error: string }
> {
  try {
    const res = await fetch(`/__layout?path=${encodeURIComponent(MIX_PATH)}`);
    const data = (await res.json()) as {
      ok?: boolean;
      source?: string;
      error?: string;
    };
    if (!res.ok || !data.ok || typeof data.source !== "string") {
      return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    }
    return { ok: true, source: data.source };
  } catch (err) {
    return { ok: false, error: `dev server unreachable: ${String(err)}` };
  }
}

/** Posts the patched file back. Shares the endpoint and the shape of `editor/save.ts`'s `post`. */
export async function writeMixSource(
  source: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch("/__layout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: MIX_PATH, source }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `dev server unreachable: ${String(err)}` };
  }
}

/**
 * The one spelling of the path, and it must match `vite.config.ts`'s
 * `WRITABLE` key exactly — that table is a literal lookup, so a typo here is a
 * refusal rather than a traversal.
 */
const MIX_PATH = "src/config/mix.ts";
