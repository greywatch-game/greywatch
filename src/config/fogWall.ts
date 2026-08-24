/**
 * config/fogWall.ts — the fog wall, alone in a module.
 * Owns: the one distance the LOD gate, the ragdoll gate and the map's fog all
 * have to agree on. Its own doc below is the whole story.
 * Why its own file: `config/bots.ts` reads it, and pulling it from
 * `config/index.ts` — which imports `bots.ts` — would be an import cycle, and a
 * cycle between two `const` initializers is a TDZ crash at load, not a warning.
 */

/**
 * The fog wall: the distance past which the world is solid `fogColor` and
 * nothing is worth drawing, posing or simulating.
 *
 * It is a module constant rather than a field because two unrelated tunables
 * are the SAME distance and have to move together — `bots.lodDisableDistance`,
 * where a rig stops being drawn at all, and `bots.death.maxDistance`, past
 * which a corpse would be tumbling somewhere nobody can see. It was written
 * out by hand in `BattleSystem` before this, which is how the ragdoll gate came
 * to be pinned to an unrelated number instead.
 *
 * It must agree with the MAP's `EnvironmentSpec.fogEnd`, which is the one that
 * actually paints the fog; `Game.installMap` warns in dev builds if a map
 * disagrees, since the two would otherwise drift silently on a second map.
 */
export const FOG_WALL = 78;
