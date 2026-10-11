/**
 * server/world.ts — Loads a map's world as the authority gets it: the baked
 * collider set and the floor, the two lazy imports `buildSimWorld` takes.
 * Owns: the LOAD and nothing else. The rebuild itself — nav, cover, obstacles,
 * rays, the sweep and the `GameMap` that carries them — is
 * `src/sim/simWorld.ts`, which every host shares (`BABYLON_EXIT.md` X2.5a).
 * Invariants: what it loads is exactly what the client built from, or a shot
 * that lands on a wall here passes through it there — the bake is checked
 * against its layout by `scripts/check-collision.mjs` and the derived
 * structures by `npm run parity`. Imports nothing from `@babylonjs/core`
 * (`scripts/check-babylon-free.mjs`).
 *
 * Why a load and not a build: `MapBuilder` builds meshes and materials and
 * reaches a canvas through `floorMaterial` (`DynamicTexture.getContext()`), and
 * this process has neither a canvas nor an engine. So the boxes come off the
 * bake (`scripts/bake-collision.mjs`) and the floor off the map's own
 * heightfield — see `src/sim/simWorld.ts` for the whole argument.
 */
import type { MapCollision } from "../src/world/collision";
import type { Heightfield } from "../src/world/layout";
import type { GameMap } from "../src/world/MapBuilder";
import type { MapDef } from "../src/world/maps";
import { buildSimWorld } from "../src/sim/simWorld";

/**
 * `def`'s collider bake and floor, loaded — the half of a round that has to
 * wait, so that `SimCore.startRound` need not. Both are lazy imports
 * (`MapDef.collision`, `MapDef.heights`): a chunk each, awaited here and
 * nowhere else on this side.
 */
export async function loadSimWorld(
  def: MapDef,
): Promise<{ collision: MapCollision; floor: Heightfield | undefined }> {
  const collision: MapCollision = (await def.collision()).default;
  const floor = def.heights ? (await def.heights()).default : undefined;
  return { collision, floor };
}

/**
 * `def`'s solid world, loaded and rebuilt in one call — what `npm run parity`
 * and `scripts/sweep-check.mjs` fingerprint. A round does not go through it:
 * `Match` and `simulate` load with `loadSimWorld` and hand the data to
 * `SimCore.startRound`, which builds.
 */
export async function buildServerWorld(def: MapDef): Promise<GameMap> {
  const { collision, floor } = await loadSimWorld(def);
  return buildSimWorld(def, collision, floor);
}
