/**
 * The map table and the source hash, shared by `bake-collision.mjs` (which
 * writes it) and `check-collision.mjs` (which enforces it).
 *
 * One module rather than a copy in each, because the two agreeing is the whole
 * mechanism: a check that hashed a different set of files from the bake would
 * pass forever, and that is a guard which exists but does not guard.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The maps to bake, and what to call each one's generated constant.
 *
 * A literal table for the same reason `vite.config.ts`'s `WRITABLE` is one: it
 * is used to build paths under `src/world/`, and deriving it from a directory
 * listing trades an explicit list for a glob that will one day match something
 * unintended. A new map adds one entry.
 */
export const MAPS = [
  { id: "hollowmere", constant: "HollowmereCollision" },
  { id: "greyfen", constant: "GreyfenCollision" },
  { id: "coldharbour", constant: "ColdharbourCollision" },
  { id: "harrowmead", constant: "HarrowmeadCollision" },
  { id: "sarab", constant: "SarabCollision" },
];

/**
 * The maps that are baked and hash-checked exactly like the four above but are
 * NOT levels — today, the DEV-only proving ground.
 *
 * **It is a second list rather than a fifth row, and the reason is `npm run
 * parity`.** That script builds the server in PRODUCTION mode and asks it for
 * a fingerprint per map; `MAPS` in `src/world/maps.ts` folds the proving
 * ground away in that build, so a fifth row here would ask the authority for
 * the fingerprint of a map it has never heard of and report a failure that is
 * the gate misreading itself. So parity reads this list SEPARATELY and pays
 * for a second server build in dev mode to answer for it; the bake and the
 * staleness check simply read both lists at once.
 *
 * **They are hash-checked all the same, and that is the point of naming them
 * at all.** `ENGINE_UPGRADE.md` S9 measures the AUTHORITY on the proving
 * ground, which it can only do off a bake — and a bake that has gone stale
 * against a regenerated layout is a measurement of a world nothing else in the
 * tree is standing in. That is the same failure the four maps are guarded
 * against, one step further from anybody noticing.
 *
 * `mark` is the string `scripts/check-proving.mjs` greps the emitted bundles
 * for. A dev-only map's generated modules each carry one, because a comment
 * saying which directory a file came from does not survive a build and a
 * string literal does. See `PROVING_HEIGHTS_MARK` for the same device on the
 * heightfield.
 */
export const DEV_MAPS = [
  { id: "proving", constant: "ProvingCollision", mark: "PG-Boxes" },
];

/** The files a map's collider boxes are derived from. */
const SOURCES = ["layout.ts", "heights.ts"];

/**
 * Hash of everything a map's collider boxes depend on.
 *
 * `heights.ts` is in here as well as `layout.ts` because an authored `y` is an
 * offset above the local floor — move the terrain and every box standing on it
 * moves, with the layout untouched. Hashing only the layout would leave exactly
 * that edit undetected, which is the silent half of the failure this guard
 * exists to prevent.
 *
 * **The line endings are normalised first, and without that this guard fails
 * on a clean checkout rather than on a stale bake.** Git hands a Windows
 * working tree CRLF and a Linux one LF for the same committed bytes, so a hash
 * taken over what `readFileSync` returns is a hash of the CHECKOUT and not of
 * the layout: measured on a pristine tree, all four maps reported "out of
 * date" with collider geometry that was byte-for-byte identical. The remedy it
 * prints — bake and commit — is the trap, because the freshly committed hash
 * is then wrong on the OTHER machine and the two of them hand the failure back
 * and forth forever. Normalising here rather than with a `.gitattributes`
 * `eol=lf` keeps the fix inside the thing that is actually asking the question,
 * and makes the hash mean the layout's CONTENT on any platform.
 */
export function sourceHash(id) {
  const h = createHash("sha256");
  for (const file of SOURCES) {
    const text = readFileSync(join(root, "src", "world", id, file), "utf8");
    h.update(text.replace(/\r\n/g, "\n"));
  }
  return h.digest("hex").slice(0, 16);
}

/** The hash recorded in a map's generated `collision.ts`, or null if absent. */
export function bakedHash(id) {
  try {
    const src = readFileSync(join(root, "src", "world", id, "collision.ts"), "utf8");
    return /sourceHash:\s*"([0-9a-f]+)"/.exec(src)?.[1] ?? null;
  } catch {
    return null;
  }
}
