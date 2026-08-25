/**
 * solid.ts — The read side of `metadata.solid` and `metadata.porous`: the two
 * pick predicates every ray test in the game filters with.
 * Invariants: these are module CONSTANTS, not factories — they close over
 * nothing and must keep closing over nothing, because the callers are per-shot
 * and per-frame and a predicate minted at the call site allocates on every one.
 * `MapBuilder` is the only writer of either flag; this is the only spelling of
 * both questions.
 *
 * **There are two questions, and a ray asks exactly one of them.** *Where may a
 * body be?* is `SOLID_ONLY` — the floor underfoot, the wall you cannot walk
 * into, the spot the camera may not sit in. *What stops a round or a look?* is
 * `OPAQUE_ONLY`. They were one question until the fence: a post-and-rail run is
 * a wall to a body and mostly air to a bullet, and answering both with one flag
 * meant a fence either let bots walk through it or ate rounds aimed between its
 * rails.
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
 * The last two exist as a PAIR and describe one object between them: the
 * coarse box is the fence a body walks into, the struts are the timber a round
 * stops on. See `MapBuilder.collider` and `MapBuilder.struts` for the write
 * side.
 *
 * **A fourth kind is a `porous` box that stops being one, and it needs no term
 * here at all.** A breakable pane (`Build.pane({ breakable: true })`) is glass:
 * a body walks into it, a round goes through it, which is `porous` exactly. When
 * `GlassSystem` breaks it, `solid` itself is cleared and the box leaves BOTH
 * predicates in one write — so the whole of "glass" on this side of the
 * question is a flag these two functions never read. That is deliberate: these
 * are the hottest predicates in the game and the map is otherwise static, so
 * the one mutable thing in the world pays for itself with a property write
 * rather than with a term every ray in the process evaluates.
 *
 * `WorldBox.glass` exists for the readers that must skip a pane rather than
 * merely pass a round through it — `CoverMap`, the AO bake, and the collision
 * bake that carries it to the authority — and for none of the picking.
 *
 * **Both predicates END on `isPickable`, and that term is load-bearing rather
 * than tidy.** `scene.pickWithRay(ray, predicate)` runs the predicate INSTEAD
 * of Babylon's own `isEnabled && isVisible && isPickable` filter, not as well
 * as it. So a predicate that does not ask leaves every collider in the game
 * permanently pickable whatever the flag says, and the three places that take a
 * mesh out of a ray by clearing it — the tank's ground probe, the chase
 * camera's pull-in, the dismount's floor test, none of which may mint a
 * predicate of its own for the reason above — were writing a flag nothing read.
 * Two of the three were saved by their geometry; the probe is cast from INSIDE
 * the box it is meant to ignore, so it found the hull's own underside every
 * frame and `floorY` came back as whatever height the tracks already had. A
 * tank lifted by anything — Babylon's collision response climbing a barrier —
 * stayed there for the rest of the round, and none could fall at all. The same
 * term is what finally takes a hull off the field: `Tank.hide` disables and
 * unpickles the mesh, and until this read it, a wreck that had been carried
 * away went on stopping rounds in the street. It is LAST so the metadata
 * rejection still short-circuits ahead of it for the ~1,800 visuals that are
 * not solid, and it must stay a flag rather than an `isEnabled()` call, which
 * walks the parent chain on the hottest predicate in the game.
 */
import type { AbstractMesh } from "@babylonjs/core";

/**
 * Collider proxies only — the invisible boxes `MapBuilder.collider()` tags,
 * never the visual geometry they stand in for. See `MapBuilder`'s header on the
 * visual/collider split for why the two roles are separate meshes.
 *
 * Every ray about WHERE A BODY MAY BE runs through here: `Player.probeGround`,
 * the death cam's pull-in, and the editor's centre-screen pick. Porous boxes
 * are included, and that is the point — a fence is still something you stand on
 * when you jump onto it, and a ground probe that could not see one would drop
 * the player inside a box `moveWithCollisions` is still holding them out of.
 *
 * `rayOnly` geometry is excluded for the mirror reason: a fence's posts and
 * rails stop rounds, but standing on a 0.1 m rail is not a thing a body does,
 * and the coarse box beside them is what the probe is meant to find. It also
 * keeps the game's most expensive per-frame call from paying for triangles it
 * would only throw away.
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

/**
 * The solid world MINUS what a round or a sightline passes through:
 * `CombatSystem`'s hitscan and its wall cap, `BattleSystem`'s and
 * `AimAssistSystem`'s line of sight, and the grenade's step ray and blast
 * check.
 *
 * Every one of those five asks the same question — *is there something in the
 * way?* — and for a post-and-rail fence the answer is *only where the timber
 * is*: the coarse `porous` box comes out of the set, and the `strut` geometry
 * standing exactly where the posts and rails are drawn stays in it. So a round
 * through a gap goes through, and a round at a post stops on the post.
 *
 * The grenade is in this list rather than the other one because a grenade is a
 * thing travelling to somewhere, not a body standing anywhere: it goes over,
 * under and between the rails exactly as a round does, and its fragments do the
 * same.
 *
 * The extra term costs one property read on meshes that already passed the
 * `solid` test — a few hundred boxes per ray, none of the ~1,800 visuals.
 */
export const OPAQUE_ONLY = (m: AbstractMesh): boolean =>
  !!m.metadata &&
  m.metadata.solid === true &&
  m.metadata.porous !== true &&
  m.isPickable;
