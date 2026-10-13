/**
 * config/fogWall.ts — the fog wall, alone in a module.
 * Owns: the one distance the body draw gate, the ragdoll gate and the map's
 * fog all have to agree on. Its own doc below is the whole story.
 * Why its own file: it is not a section of `CONFIG` but a constant beside it,
 * and `config/index.ts` holds one import per module and nothing else. (It
 * first moved here because `config/bots.ts` read it, for a ragdoll gate that
 * nothing ever read — `RagdollSystem.viewDistance` was always the gate — and
 * a section module that reads it again must still take it from here, since
 * `index.ts` imports every section and a cycle between two `const`
 * initializers is a TDZ crash at load.)
 */

/**
 * The fog wall: the distance past which the world is solid `fogColor` and
 * nothing is worth drawing, posing or simulating.
 *
 * It is a module constant rather than a field because two unrelated gates are
 * the SAME distance and have to move together — `NetRoster.viewDistance`,
 * where a body stops being drawn at all, and the ragdoll pool's
 * `RagdollSystem.viewDistance`, past which a corpse would be tumbling
 * somewhere nobody can see. It was written
 * out by hand in `BattleSystem` before this, which is how the ragdoll gate came
 * to be pinned to an unrelated number instead.
 *
 * **It is what a map with no opinion gets, and nothing more than that.** The
 * distance the two riders actually run on is pushed by `Game.installMap` from
 * `bodyDrawDistanceOf(environment)` — the map's `fogEnd`, or its
 * `EnvironmentSpec.bodyDrawDistance` where it states one, because a map that
 * can see past its own diagonal has no fog wall to pin them to and a body is
 * worth dropping long before the ground under it is. What survives that is the
 * property this constant exists for: the two are still ONE number, resolved
 * once and handed to both systems together, so the corpse gate can never
 * end up somewhere the rig is still being drawn.
 */
export const FOG_WALL = 78;
