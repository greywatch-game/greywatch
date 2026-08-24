/**
 * sway.ts — Which world geometry the wind moves, and how much of it moves at a
 * given height.
 * Owns: the `SwayLayer` ids (derived from `CONFIG.wind`, so each is declared
 * once), the mesh mark a builder puts on foliage, and the per-vertex weight the
 * bake writes. Owns no geometry, no materials and no uniforms — `Props` marks,
 * `MapBuilder` keeps the mark unanimous through both merges, `vertexShading`
 * writes the weight and `CelShader` spends it.
 * Invariants: only VISUAL geometry may be marked (a collider proxy is never
 * drawn, and the box it stands for never moves), the weight is 0 at the ground
 * and rises with height, and a marked group is taken out of BABYLON's outline
 * pass and given an ink twin instead — see `MapBuilder.inkTwin` for why its
 * hull cannot follow a moving surface and ours can.
 * Contract: `docs/rendering.md`.
 *
 * WHY A HEIGHT RAMP RATHER THAN A PER-PART ANCHOR. What a leaf should do is
 * pivot about the bough it grows on, and nothing downstream of the merge knows
 * where that bough was: `mergeByMaterial` collapses a jungle tree into one mesh
 * per colour and `BlockMerge` collapses forty-eight metres of forest into one
 * mesh per colour after that, so by the time anything can write a vertex
 * attribute there is no prop, no part and no local frame left — only a world
 * position and the terrain under it.
 *
 * A ramp in height above the ground is the one function of that position which
 * gets the important cases right, and it gets them right for a reason rather
 * than by luck: it is CONTINUOUS across everything marked. A frond and the leaf
 * plate beside it, a liana strand and the blade it hangs under, are in
 * different merge groups and are weighted from where they ARE rather than from
 * what they belong to, so they agree at the join and there is no seam. That is
 * exactly the argument the ambient-occlusion bake makes for a positional
 * estimate, and it is the same buffer.
 *
 * WHERE MARKED MEETS UNMARKED THERE IS A STEP, and that is what makes the
 * choice of what to mark a geometric argument rather than a taste one. A
 * marked mesh moves and its unmarked neighbour does not, so a mark is only safe
 * where the join is buried: a canopy plate is centred on the trunk axis and
 * metres across, so 0.29 m of drift is spent inside its own overlap of the
 * bole; a fern blade leaves its crown at 0.42 m where the ramp has given it
 * four centimetres, against a crown 0.3 m across. Marking something whose join
 * is neither buried nor near the foot of the ramp is what tears — the liana's
 * collar is left out for exactly that reason.
 *
 * WHAT IT COSTS is that a leaf translates rather than pivoting. At the
 * amplitudes in `CONFIG.wind` that is what a leaf looks like anyway — a third
 * of a metre on a blade three metres long is a two-degree lean, and nobody has
 * ever read that as the wrong kind of motion. What it would get wrong is a
 * long thin thing lying ALONG the ramp, which is why the trunk is not marked:
 * a trunk that swayed from a planted foot would bend, and a bending column is
 * the one shape a vertex ramp cannot draw honestly.
 */
import type { Mesh } from "@babylonjs/core";
import { CONFIG } from "../config";

/**
 * The layers of foliage the wind moves, derived from the config table so the
 * ids are declared in exactly one place — the same rule `entities/weapons.ts`
 * follows for the kit.
 */
export type SwayLayer = keyof typeof CONFIG.wind.foliage.layers;

/**
 * Marks a mesh as foliage the wind moves.
 *
 * **Called on VISUAL meshes only, and never on anything a collider stands in
 * for.** A swaying surface leaves the box that answers for it behind, so the
 * only geometry that may sway is geometry no box was ever measured against:
 * canopy leaf nine metres above a trunk's collider, fern blades in a prop with
 * no collider at all. `PROP_BODIES` is the list to check against before
 * marking anything new.
 */
export function marksSway(mesh: Mesh, layer: SwayLayer): void {
  mesh.metadata = { ...(mesh.metadata ?? {}), sway: layer };
}

/** The layer a mesh was marked with, or null. */
export function swayLayerOf(mesh: Mesh): SwayLayer | null {
  const layer = mesh.metadata?.sway;
  return typeof layer === "string" && layer in CONFIG.wind.foliage.layers
    ? (layer as SwayLayer)
    : null;
}

/**
 * How much of `CONFIG.wind.foliage.travel` a vertex `height` metres above the
 * ground is entitled to, in the given layer.
 *
 * The exponent is the grass shader's, and it is the whole of why a fern reads
 * as a stalk flexing rather than as a mesh sliding: it keeps the lower half of
 * a blade nearly still and spends the travel in the top third. Squared would
 * plant the roots harder than a fern's actually are; linear moves the crown as
 * much as the tip.
 */
export function swayWeight(height: number, layer: SwayLayer): number {
  const l = CONFIG.wind.foliage.layers[layer];
  const t = Math.min(1, Math.max(0, height / l.reach));
  return Math.pow(t, 1.6) * l.amount;
}
