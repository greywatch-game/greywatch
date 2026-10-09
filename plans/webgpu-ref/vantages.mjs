/**
 * Where the reference frames are taken from, beyond the one photograph each
 * map already has.
 *
 * **The table is `src/bench/vantages.ts` and this file only re-exports it**,
 * loaded by Node's type stripping the way the map generators load
 * `src/world/roadPaths.ts`. It moved there for `BABYLON_EXIT.md` X0.3: the
 * benchmark (`?bench=<map>`) stands at these same poses, and a bank and a
 * benchmark keeping a copy each would be two ideas of where "the vantages"
 * are the first time a row was re-posed. That file's header is the argument
 * for every field a row may carry — what it proves, `pos` above the surface,
 * the wind, and the subjects a row stands in front of the camera.
 *
 * **The menu's vantage is the menu's and is NOT in that table either.** It is
 * read at runtime out of `src/ui/mapShots.ts` — the table the backdrop itself
 * stands on — so a reference frame and a menu backdrop cannot come to hold two
 * ideas of where the camera stands. `shotList` below puts the two together.
 */
import { DIFF_VANTAGES } from "../../src/bench/vantages.ts";

export { DIFF_VANTAGES };

/**
 * The full ordered shot list for a map: its menu vantage first, then its diff
 * vantages.
 *
 * The menu one leads because it is the only frame a human can check against
 * something — the committed backdrop is a photograph of it — so a bank whose
 * first frame is wrong is wrong in a way somebody can see without a differ.
 */
export function shotList(id, menuVantage) {
  const rows = [];
  if (menuVantage) {
    rows.push({
      id: "menu",
      of: "the committed menu backdrop's own vantage, read out of src/ui/mapShots.ts",
      proves: "the one frame that can be checked by eye against shots/<map>.jpg",
      ...menuVantage,
    });
  }
  return rows.concat(DIFF_VANTAGES[id] ?? []);
}
