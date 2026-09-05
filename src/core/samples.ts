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
 * with no sample still gets); what a row here buys is one recorded EVENT, and
 * nothing else in the game is sampled at all. Eight rows are a REPORT — one
 * per weapon in the kit, plus the cupola gun three kinds of hull mount — six
 * are a MECHANISM the player works with their own hands (the two halves of a
 * magazine change and the four beats of a bolt cycle, each cut from a single
 * master), and two are a BLAST: the one explosion this game has, and the tank
 * gun that is the same physics at the other end.
 *
 * **The boundary is still a decision and not a waiting list**, and the six
 * mechanism rows are what makes it readable rather than theoretical: what
 * `docs/audio.md` refuses is a LIBRARY — thirty one-shots at 0.3 s, five
 * footsteps per surface, an ambient bed that alone costs ten times this whole
 * list — not the idea of a sound that is not a gunshot. These six are 1.244
 * mono-seconds off TWO masters with no round robin behind either, they are the
 * player's own and not every body's, and they pass the same admissibility test
 * every row here does: delete `audio/` and `Sfx.reload` is the four clacks it
 * always was and `Sfx.boltCycle` the five clacks and two sweeps it always was.
 * A footstep cannot make that second claim without bringing a surface table
 * and a variant set with it, which is the whole argument and is unchanged.
 *
 * **The two BLAST rows pass it the same way and are the cheapest answer to
 * "one more sound" this directory has**: one file is EVERY explosion in the
 * game, because there is one blast and `power` scales it, and the other is the
 * one gun the weapon table has never held. Two rows, two masters, no round
 * robin, and with `audio/` deleted `Sfx.explosion` is the four layers it
 * always was and `Sfx.cannon` the three it always was.
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
import mountedGun from "../../audio/mounted-gun.webm?url";
import magOut from "../../audio/mag-out.webm?url";
import magIn from "../../audio/mag-in.webm?url";
import boltLift from "../../audio/bolt-lift.webm?url";
import boltBack from "../../audio/bolt-back.webm?url";
import boltHome from "../../audio/bolt-home.webm?url";
import boltLock from "../../audio/bolt-lock.webm?url";
import grenade from "../../audio/grenade.webm?url";
import tankCannon from "../../audio/tank-cannon.webm?url";

/**
 * Every recorded sound in the game: one report per weapon in the kit, the
 * cupola gun the second seat of a hull lays, the two halves of a magazine
 * change, the four beats of a bolt cycle and the two blasts. Nothing else is
 * sampled at all.
 *
 * **An id here names the RECORDING, not the weapon**, which is why it is
 * `burstRifle` and `sniperRifle` rather than `carbine` and `sniper`: the row
 * is a file cut from a master, `audio/manifest.json` names it, and the fact
 * that `CONFIG.weapons.carbine` happens to be what points at it is a decision
 * that lives on that weapon's `report`. `assaultRifle` set that convention
 * when it was the only row.
 *
 * **`mountedGun` is the one row that is not a carried weapon's, and it is the
 * proof that a `SampleId` belongs to a `ReportVoice` rather than to the weapon
 * table.** Three kinds of hull point at it — `CONFIG.vehicles.<kind>.mg.report`
 * — because the gun on a tank's cupola, a truck's remote station and a
 * gunship's chin turret is one gun, and a fourth kind gets it for free. It is
 * one of three MONO rows here; see its note in the manifest for why that
 * follows from where it is heard rather than from what it is.
 *
 * **`magOut` and `magIn` are two of the other five, and they are the proof
 * that a sample belongs to a MOMENT rather than to a weapon at all.** They are the
 * two halves of one magazine change — the old one stripped out of the well
 * and the fresh one slapped home — cut from the single master
 * `audio/src/reload.wav`, and every weapon in the kit plays the same pair.
 * What tells a belt going into an LMG from a magazine going into a pistol is
 * `ReportVoice.actionPitch`/`actionVol`, which is that field's whole job and
 * is the exact INVERSE of the rule a report obeys: a report's file already IS
 * that weapon, so `pitch` is not spent on it a second time; one shared
 * recording has said nothing about which weapon it is, so the mechanism's
 * deviation must still be applied. See `Sfx.reload`.
 *
 * **`boltLift`, `boltBack`, `boltHome` and `boltLock` are the last four, and
 * they are that same argument run to the end of it: a sample belongs to a
 * BEAT.** They are one performance — `audio/src/bolt-cycle.wav`, somebody
 * working a bolt once — cut into the four moments `CONFIG.viewmodel.cycle`
 * draws, because `Sfx.boltCycle` places those moments as fractions of a
 * weapon's `shotInterval` and a recording's own timing is a fixed number of
 * milliseconds. Shipped as one file it would agree with the drawn gesture at
 * exactly one `fireRate` and at no other; shipped as four it agrees at every
 * one, which is what `magOut` bought by leaving the catch behind and what the
 * carbine's row bought by leaving two rounds behind. Every weapon that
 * declares `boltCycle` plays all four, voiced by `actionPitch`/`actionVol` for
 * the reason the magazine change is.
 *
 * **`grenade` and `tankCannon` are the last two, and the first that are not a
 * gun in anybody's hands.** `grenade` is the third reading of the same
 * sentence: a sample belongs to a `ReportVoice`, then to a MOMENT, then to a
 * BEAT — and here to a BLAST, of which this game has exactly one. `blastAt`
 * takes a `power`, the grenade passes 1 and is the reference exactly as the
 * rifle is for a report, and the tank shell is 1.85 of the same eight layers,
 * so ONE recording is every explosion in the game and `Sfx.explosion` spends
 * `power` on it as `rate` — `magOut`'s inversion again, for `magOut`'s reason.
 * `tankCannon` is the odd one in the other direction: `Sfx.cannon` is the one
 * report in the game with no row in `CONFIG.weapons` behind it, so this is the
 * one sample here that is a deviation from nothing at all. Both are MONO for
 * `mountedGun`'s reason — neither is ever heard except through a panner — and
 * on the cannon that decided the CUT as well as the channel count; the
 * manifest's note has the measurement.
 *
 * The six mechanism rows are also the only ones scheduled by their PEAK rather
 * than their start — a magazine going home and a bolt arriving on its stop are
 * ARRIVALS, with the approach drawn in front of them — and the six offsets
 * that says are in `Sfx`, measured off these trims. Move a `trim.start` in the
 * manifest and move them.
 */
export type SampleId =
  | "assaultRifle"
  | "burstRifle"
  | "smg"
  | "dmr"
  | "sniperRifle"
  | "lmg"
  | "pistol"
  | "mountedGun"
  | "magOut"
  | "magIn"
  | "boltLift"
  | "boltBack"
  | "boltHome"
  | "boltLock"
  | "grenade"
  | "tankCannon";

/** Where each one is fetched from. */
export const SAMPLE_URLS: Record<SampleId, string> = {
  assaultRifle,
  burstRifle,
  smg,
  dmr,
  sniperRifle,
  lmg,
  pistol,
  mountedGun,
  magOut,
  magIn,
  boltLift,
  boltBack,
  boltHome,
  boltLock,
  grenade,
  tankCannon,
};
