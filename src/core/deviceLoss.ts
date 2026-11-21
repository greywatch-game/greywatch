/**
 * deviceLoss.ts — what the page does when its graphics device is LOST
 * (`BABYLON_EXIT.md` X5.4i, row "X5.4, a lost device": the owner's (A)),
 * past the teardown `Game` runs off the device's own `lost`.
 * Owns: the session's record of the last loss (one `sessionStorage` entry,
 * `MARK`: when it happened and the notice it left for the menu), the loop
 * guard read off it (`answerLoss`) and the notice's one reading after the
 * reload (`takeLossNotice`).
 * Invariants:
 * - **A loss RELOADS the page to the menu, and a second inside
 *   `CONFIG.graphics.deviceLossWindow` of the one before does NOT**: it is
 *   answered with the boot's "No graphics device" plate (`main.ts`), so a
 *   device that dies on every boot cannot loop the page. "The one before" is
 *   the last loss this TAB saw, whichever way it was answered — the entry is
 *   written on both — so a manual reload off the plate into a device that
 *   dies again inside the window is the plate again.
 * - **Storage that cannot be written is answered with the plate**, never a
 *   reload: a reload this cannot record is one the guard cannot see, and the
 *   reload after it could be the loop. Storage that cannot be READ is the
 *   same: nothing says this is not the second loss. **That holds for the
 *   FIRST loss too**: a page whose `sessionStorage` throws (a storage
 *   policy that refuses it) never reloads on a loss and goes straight to the
 *   plate — kept so, and named for the owner (`BABYLON_EXIT.md` X5.4i's
 *   review, `plans/done/babylon_exit_landed.md`).
 * - The entry is `sessionStorage`'s, so it is the TAB's and dies with it: a
 *   new tab or window starts with no loss behind it. The settings are not
 *   here and need nothing — they are `localStorage`'s (`core/settings.ts`),
 *   written on every change, so a reload finds them as they were.
 * - The clock is the wall clock (`Date.now()`), the one that runs across a
 *   reload. It decides a page's answer, never a round's outcome.
 * - The notice is read ONCE: the first boot after the reload shows it and
 *   clears it, keeping the loss's time for the guard. The notice is `Game`'s
 *   (`deviceLost`), and its "rejoin the match from Online" assumes the reload
 *   lands on the menu: under the dev and smoke URL `?mp`, whose reload joins a
 *   match by itself (`Game.joinFromUrl`), that clause is wrong, and is left so
 *   (`?mp` is no player's URL).
 * Never: reloads, tears anything down or draws (the caller does each:
 *   `Game`'s `device.lost`); throws (every storage access is caught).
 * Contract: `docs/game.md` ("A lost device"), `docs/states.md`.
 */
import { CONFIG } from "../config";

/** The `sessionStorage` key the last loss is recorded under. */
const MARK = "greywatch.deviceLost";

/** What the last loss left: its wall-clock time, and the menu's notice (null once shown). */
interface LossMark {
  readonly at: number;
  readonly notice: string | null;
}

/** The last loss's record, null for none or for one this cannot parse; throws if storage cannot be read. */
function readMark(): LossMark | null {
  const raw = window.sessionStorage.getItem(MARK);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const { at, notice } = parsed as { at?: unknown; notice?: unknown };
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  return { at, notice: typeof notice === "string" ? notice : null };
}

/**
 * The page's answer to a loss at `now` (`Date.now()`), and the loss recorded:
 * `"reload"` — the first in the window, its `notice` left for the menu — or
 * `"plate"` — a second inside `CONFIG.graphics.deviceLossWindow` of the last
 * (a clock run backwards across it counts as inside), or storage this cannot
 * read or write.
 */
export function answerLoss(now: number, notice: string): "reload" | "plate" {
  let last: LossMark | null;
  try {
    last = readMark();
  } catch {
    return "plate";
  }
  const again = last !== null && now - last.at < CONFIG.graphics.deviceLossWindow * 1000;
  const mark: LossMark = { at: now, notice: again ? null : notice };
  try {
    window.sessionStorage.setItem(MARK, JSON.stringify(mark));
  } catch {
    return "plate";
  }
  return again ? "plate" : "reload";
}

/**
 * The notice the last loss left for the menu, once: the boot after the
 * reload reads it and clears it, the loss's time kept for the guard. Null
 * when there is none, or storage cannot say.
 */
export function takeLossNotice(): string | null {
  try {
    const last = readMark();
    if (!last || last.notice === null) return null;
    window.sessionStorage.setItem(MARK, JSON.stringify({ at: last.at, notice: null } satisfies LossMark));
    return last.notice;
  } catch {
    return null;
  }
}
