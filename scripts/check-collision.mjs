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
 */
import { bakedHash, MAPS, sourceHash } from "./collision-hash.mjs";

const stale = [];
for (const { id } of MAPS) {
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

console.log(`collision bake current for ${MAPS.map((m) => m.id).join(", ")}`);
