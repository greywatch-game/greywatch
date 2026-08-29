/**
 * solid.ts — The read side of `metadata.solid`: the one pick predicate left in
 * the game, and the three-way answer a collider gives.
 * Invariants: `SOLID_ONLY` is a module CONSTANT, not a factory — it closes over
 * nothing and must keep closing over nothing. `MapBuilder` is the only writer
 * of `solid`; this is the only spelling of the question against a MESH.
 *
 * **THE RAYS LEFT THIS FILE, and what is here is the editor's.** Every ray in
 * the game used to be `scene.pickWithRay` with one of two predicates from here,
 * and `ENGINE_UPGRADE.md` wall 2 retired all eight of those sites: they ask
 * `RayWorld` now, which walks `colliderBoxes`, the strut groups and the
 * heightfield rather than `scene.meshes`, and the two questions live on there
 * as `castBody` and `castRound`. `OPAQUE_ONLY` went with them, because the only
 * remaining caller of anything here is the editor's centre-screen pick — which
 * is a `scene.pick` over real geometry and is right to stay one, because what
 * it wants is the MESH.
 *
 * **The three-way answer is still the world layer's rule and did not move.** It
 * is stated here because this is where it was argued and because `BoxSpec` is
 * written against it; `RayWorld`'s header carries the same table for the two
 * queries that now read it off the boxes.
 *
 * **There are two questions and a collider answers each separately.** *Where
 * may a body be?* is this predicate — the floor underfoot, the wall you cannot
 * walk into, the spot the camera may not sit in. *What stops a round or a
 * look?* is `RayWorld.castRound`. They were one question until the fence: a
 * post-and-rail run is a wall to a body and mostly air to a bullet, and
 * answering both with one flag meant a fence either let bots walk through it or
 * ate rounds aimed between its rails.
 *
 * A collider therefore answers in one of three ways, and a builder picks which
 * by how it declares the box (`BoxSpec`, `Build.wall` / `block` / `strut`):
 *
 * | collider | body | round |
 * | --- | --- | --- |
 * | ordinary (`wall`, `block`) | yes | yes |
 * | `porous` — a fence's coarse run | yes | **no** |
 * | `rayOnly` — a fence's posts and rails (`strut`) | **no** | yes |
 *
 * The last two exist as a PAIR and describe one object between them: the coarse
 * box is the fence a body walks into, the struts are the timber a round stops
 * on. See `MapBuilder.collider` and `MapBuilder.struts` for the write side.
 *
 * **A fourth kind is a `porous` box that stops being one, and it needs no term
 * anywhere at all.** A breakable pane (`Build.pane({ breakable: true })`) is
 * glass: a body walks into it, a round goes through it, which is `porous`
 * exactly. When `GlassSystem` breaks it, `solid` itself is cleared and the box
 * leaves BOTH answers in one write — a `RayWorld.remove` for the queries and
 * this flag for the editor. That is deliberate: the map is otherwise static, so
 * the one mutable thing in the world pays for itself with a property write
 * rather than with a term every query in the process evaluates.
 *
 * `WorldBox.glass` exists for the readers that must skip a pane rather than
 * merely pass a round through it — `CoverMap`, the AO bake, and the collision
 * bake that carries it to the authority — and for none of the picking.
 *
 * **The predicate ENDS on `isPickable`, and that term is load-bearing rather
 * than tidy.** `scene.pick(x, y, predicate)` runs the predicate INSTEAD of
 * Babylon's own `isEnabled && isVisible && isPickable` filter, not as well as
 * it. So a predicate that does not ask leaves every collider in the game
 * permanently pickable whatever the flag says. Three places used to take a mesh
 * out of a ray by clearing it — the tank's ground probe, the chase camera's
 * pull-in, the dismount's floor test; all three pass their hull to `RayWorld`'s
 * `skip` now, and `Vehicle.rayBox` reads the same two terms so a WRECK that has
 * been carried away stops stopping rounds in the street. It is LAST so the
 * metadata rejection still short-circuits ahead of it for the ~1,800 visuals
 * that are not solid, and it must stay a flag rather than an `isEnabled()`
 * call, which walks the parent chain.
 */
import type { AbstractMesh } from "@babylonjs/core";

/**
 * Collider proxies only — the invisible boxes `MapBuilder.collider()` tags,
 * never the visual geometry they stand in for. See `MapBuilder`'s header on the
 * visual/collider split for why the two roles are separate meshes.
 *
 * **One caller: the editor's centre-screen pick.** The three rays that used to
 * ask this question — the death cam's pull-in, a tank's chase camera, the
 * dismount's floor test — ask `RayWorld.castBody` instead. **The ground probe
 * was never one of them** either: `Player.probeGround` reads `ObstacleField`,
 * and has since long before the rest followed.
 *
 * The SET this describes is nonetheless still the set `castBody` walks, box for
 * box, and the two must not drift. Porous boxes are included, and that is the
 * point — a fence is still something you stand on when you jump onto it, and a
 * ground answer that could not see one would drop the player inside a box
 * `moveWithCollisions` is still holding them out of. `rayOnly` geometry is
 * excluded for the mirror reason: a fence's posts and rails stop rounds, but
 * standing on a 0.1 m rail is not a thing a body does, and the coarse box
 * beside them is what the probe is meant to find. `MapBuilder` keeps that
 * agreement mechanically — a `rayOnly` collider emits no `WorldBox` at all, so
 * what this predicate subtracts is exactly what the box queries never had.
 *
 * It is written as a `!!metadata &&` guard rather than `metadata?.solid` so the
 * hot path does one truthiness test on a field that is `null` for most meshes
 * in the scene — every visual, every rig node, every effect — before it reaches
 * for a property at all.
 */
export const SOLID_ONLY = (m: AbstractMesh): boolean =>
  !!m.metadata &&
  m.metadata.solid === true &&
  m.metadata.rayOnly !== true &&
  m.isPickable;
