/**
 * Fails the build when a map's baked collider set is out of date.
 *
 * Run from `npm run build`, ahead of the typecheck. A stale bake is a
 * multiplayer server whose walls stand somewhere else from its clients' —
 * invisible until someone is shot through a house — so it is caught here rather
 * than left to be noticed in play.
 *
 * The check is against the SOURCES a bake is derived from, not against the
 * clock: touching `layout.ts` without changing it does not fail, and changing
 * it always does.
 *
 * **The DEV-only maps are checked beside the four levels and for a reason one
 * step further out.** A stale bake on a level is a server whose walls are
 * somewhere else; a stale bake on the proving ground is `ENGINE_UPGRADE.md`
 * S9 measuring the authority against a world nobody regenerated it for, which
 * nothing but this line would ever notice. They are a separate list because
 * a production build has never heard of them — see `DEV_MAPS` in
 * `collision-hash.mjs`, which is also what `npm run parity` reads to know it
 * owes them a second, dev-mode server build.
 */
import { bakedHash, DEV_MAPS, MAPS, sourceHash } from "./collision-hash.mjs";

const all = [...MAPS, ...DEV_MAPS];
const stale = [];
for (const { id } of all) {
  const want = sourceHash(id);
  const have = bakedHash(id);
  if (have !== want) stale.push({ id, want, have });
}

if (stale.length > 0) {
  console.error("\nCollision bake is out of date:\n");
  for (const { id, want, have } of stale) {
    console.error(
      `  ${id}: layout/heights hash to ${want}, ` +
        `collision.ts carries ${have ?? "(no bake at all)"}`,
    );
  }
  console.error("\nRun `npm run collision` and commit the result.\n");
  process.exit(1);
}

console.log(`collision bake current for ${all.map((m) => m.id).join(", ")}`);
