/**
 * samples.ts — the recorded sounds, one row per sample, and nothing else.
 *
 * Owns: the id union every sample is named by, and the url table `Sfx` fetches
 * at unlock. Invariants: a row here is a URL and never a level, a pitch or a
 * placement — what a sample SOUNDS like against the shot it replaces is
 * `Sfx`'s, exactly as the shape of a synthesized report is. Must never import
 * anything from `src/core/Sfx.ts` or from a system; it is a table, in the
 * shape `src/ui/mapShots.ts` already uses for the menu's photographs.
 *
 * **This file is the ONE exception to the project's zero-audio-assets rule and
 * it is deliberately narrow.** Every sound in the game is synthesized
 * (`Sfx.ts` argues for that at length, and the synthesis is what a shooter
 * with no sample still gets); what a row here buys is a recorded REPORT for
 * one weapon, and nothing else in the game is sampled at all. The table is
 * the kit and stops there — no footstep, no impact, no reload, no ambience —
 * and `docs/audio.md` is where the arithmetic for that boundary lives: one
 * thirty-second ambient bed would cost ten times this whole list.
 *
 * `SampleId` is a union rather than a string so a weapon naming a sample that
 * has no row does not compile, and a weapon naming nothing at all is
 * unaffected — `ReportVoice.sample` is optional, and the bots' flat round
 * (which is the rifle's row, see `Sfx`'s `FLAT_REPORT`) is the reason the
 * assault rifle's is the one that must never be removed casually.
 *
 * **A row here is not a file somebody dropped in.** Every url below is the
 * OUTPUT of `npm run audio`, cut from a committed master in `audio/src/` by
 * the numbers in `audio/manifest.json`, and `scripts/check-audio.mjs` fails
 * the build if this file and that manifest disagree in either direction — an
 * encoded file nothing imports, or an import with no master and no generator
 * behind it. So the shipped sound is reproducible from the repo, which is the
 * test `docs/build.md` sets for everything else in the tree. Do not add an
 * import here by hand; add a row to the manifest and re-run the generator.
 *
 * **A sample is a PREFERENCE and never a requirement.** The fetch is
 * fire-and-forget off `Sfx.unlock`, so a round fired before the decode lands —
 * or on a device that failed the fetch outright — is the synthesized report
 * and no caller anywhere is told the difference. Deleting a row here is
 * therefore a complete revert of that weapon's sample: the synthesis is not a
 * fallback path kept alive for this, it is what the game does.
 *
 * The url is taken through Vite's `?url`, the same way `WaterSystem` takes the
 * foam mask and `mapShots.ts` the menu photographs: the file is emitted
 * content-hashed under `/assets/` and is therefore precached by `sw.js` for
 * free (see `docs/pwa.md` — `immutable` is everything under that prefix).
 */
import assaultRifle from "../../audio/assault-rifle.webm?url";
import burstRifle from "../../audio/burst-rifle.webm?url";
import smg from "../../audio/smg.webm?url";
import dmr from "../../audio/dmr.webm?url";
import sniperRifle from "../../audio/sniper-rifle.webm?url";
import lmg from "../../audio/lmg.webm?url";
import pistol from "../../audio/pistol.webm?url";

/**
 * Every recorded sound in the game — one per weapon in the kit, and nothing
 * else in the game is sampled at all.
 *
 * **An id here names the RECORDING, not the weapon**, which is why it is
 * `burstRifle` and `sniperRifle` rather than `carbine` and `sniper`: the row
 * is a file cut from a master, `audio/manifest.json` names it, and the fact
 * that `CONFIG.weapons.carbine` happens to be what points at it is a decision
 * that lives on that weapon's `report`. `assaultRifle` set that convention
 * when it was the only row.
 */
export type SampleId =
  | "assaultRifle"
  | "burstRifle"
  | "smg"
  | "dmr"
  | "sniperRifle"
  | "lmg"
  | "pistol";

/** Where each one is fetched from. */
export const SAMPLE_URLS: Record<SampleId, string> = {
  assaultRifle,
  burstRifle,
  smg,
  dmr,
  sniperRifle,
  lmg,
  pistol,
};
