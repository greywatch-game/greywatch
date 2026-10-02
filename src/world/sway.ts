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
 * and rises with height, a mesh on a RIGGED layer carries a `swayRig` on every
 * vertex of its `uv` (see below), and a swaying mesh's line work is the FRAME's — the
 * ink is one full-screen pass over the depth a swayed vertex has already
 * written (`shaders/CelInk.ts`), so nothing here has to keep a second copy of
 * the geometry in step with the wind.
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
 * where the join is buried: a jungle palm's frond starts on the trunk axis
 * inside a crown head that is not marked, so 0.29 m of drift is spent inside
 * the head; a fern frond leaves its rootstock at 0.1 m where the ramp has
 * given it a few millimetres, inside a stock 0.15 m across. Marking something whose join
 * is neither buried nor near the foot of the ramp is what tears — the liana's
 * collar is left out for exactly that reason.
 *
 * WHAT IT COSTS is that a leaf translates rather than pivoting. On a small
 * plant, or one whose leaf all hangs at different heights, that is what a leaf
 * looks like anyway. What it would get wrong is a long thin thing lying ALONG
 * the ramp, which is why the trunk is not marked: a trunk that swayed from a
 * planted foot would bend, and a bending column is the one shape a vertex ramp
 * cannot draw honestly.
 *
 * **And it gets a PALM CROWN wrong outright, which is why a layer may be
 * RIGGED instead.** Every frond on a jungle palm leaves the head between nine
 * and ten metres up, so the ramp handed all of them very nearly the same
 * travel and the whole crown slid back and forth as one piece over a head and
 * a bole that stood still. A rigged layer (`rig: true` in `CONFIG.wind`) takes
 * no ramp at all: the BUILDER, which still knows where each frond's root is,
 * writes each vertex's place on its own frond into the `uv` buffer before the
 * merge — the per-part anchor this header says is unknowable after it, carried
 * through the merge the way `writePaletteIndex` carries an albedo, because a
 * merge concatenates vertex data and a per-vertex value survives it. `uv` is
 * the buffer because every part in the world already carries one and the cel
 * shader read none of them; on every mesh that is not rigged it is still
 * filler and is never read.
 *
 * **The red channel's SIGN is what tells the shader which it has**:
 * `swayWeight` answers a rigged layer with the NEGATIVE of its `rig` index
 * (-1 the frond, -2 the ash's bough), which no ramp can produce, so the
 * vertex stage's branch stays coherent per draw (the layer is in the merge
 * key), the neutral 0 still means planted, and the magnitude picks which
 * rigged layer's motion the vertex takes. Everything a rig
 * says is a SCALAR — how far along, which frond, how far out to the edge — and
 * never a position or a direction, because the merge bakes a placement into
 * positions and normals and leaves `uv` exactly as it found it.
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
 * ground is entitled to, in the given layer — or, for a RIGGED layer, the
 * negative of its `rig` index: a sign and a selector, not a weight. A ramp is
 * never negative, so the shader reads `< 0` as "this vertex carries its own
 * rig in `uv`" and `> 0` as the ramp it always was.
 *
 * The exponent is the grass shader's, and it is the whole of why a fern reads
 * as a stalk flexing rather than as a mesh sliding: it keeps the lower half of
 * a blade nearly still and spends the travel in the top third. Squared would
 * plant the roots harder than a fern's actually are; linear moves the crown as
 * much as the tip.
 */
export function swayWeight(height: number, layer: SwayLayer): number {
  const l = CONFIG.wind.foliage.layers[layer];
  if ("rig" in l) return -l.rig;
  const t = Math.min(1, Math.max(0, height / l.reach));
  return Math.pow(t, 1.6) * l.amount;
}

/**
 * How much of a frond's tip travel a point `f` of the way along it takes: a
 * uniformly loaded cantilever's deflection, normalised to 1 at the tip.
 *
 * Rather than `f^2`, which is a guess at the same shape, because the
 * cantilever is what a frond under its own weight and the wind's actually is
 * — stiff where it leaves the head, carrying a third of its tip's travel by
 * halfway, and 0 with a zero slope at the root, so the root does not move and
 * does not kink where the head buries it.
 */
export function frondBend(f: number): number {
  const t = Math.min(1, Math.max(0, f));
  return (t * t * (6 - 4 * t + t * t)) / 3;
}

/**
 * The phase a frond moves on, 0..1, from two numbers the builder already has
 * — so a rig takes NO draw from any stream, and adding one moved no tree, no
 * pinna and no vine anywhere on a map.
 */
export function rigPhase(a: number, b: number): number {
  const h = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return h - Math.floor(h);
}

/** How finely `edge` is stored: 64 steps of a pinna's half-width. */
const EDGE_STEPS = 63;

/**
 * One vertex's rig, packed into the two floats of `uv`.
 *
 * `bend` is `frondBend` of where it is along its frond (0 at the root, 1 at
 * the tip), `phase` the frond's own (0..1, see `rigPhase`) and `edge` how far
 * out from the rib to a pinna's point it is (0..1), which is what the flutter
 * is spent on. `u` is the bend; `v` is the edge in its WHOLE part and the
 * phase in its fraction. A vertex attribute is never interpolated in the
 * vertex stage, so packing two numbers into one float is exact rather than
 * blended, and float32 keeps the fraction to ~1e-5 under a whole part of 63.
 */
export function swayRig(bend: number, phase: number, edge: number): [number, number] {
  const e = Math.round(Math.min(1, Math.max(0, edge)) * EDGE_STEPS);
  const p = phase - Math.floor(phase);
  return [bend, e + Math.min(p, 0.999)];
}

/** How finely `boughRig` stores a bend: 1024 steps of the crown's rim travel. */
const BEND_STEPS = 1023;
/** How finely `boughRig` stores a tilt: 31 steps each side of the stalk. */
const TILT_STEPS = 31;

/**
 * One vertex of a RIGGED ash bough (`buildAshTree`), packed into `uv` — the
 * frond's rig with one more number in it, because a leaf cluster has to RUSTLE
 * and not ripple.
 *
 * `bend` and `phase` are the frond's: how much of the crown's rim travel this
 * vertex takes, and its bough's beat. `tilt` is where the vertex sits across
 * its own LEAF CLUSTER, signed, -1..1 along an axis through the stalk, and
 * `leaf` is that cluster's own phase. The shader tips every vertex of a
 * cluster by `tilt` times one number per cluster, so a cluster turns WHOLE on
 * its stalk: the displacement is linear across it, which is a rigid tilt for
 * the small angles a leaf turns through. The frond's flutter was a wave
 * travelling through world space instead, so the points of one cluster moved
 * on different phases and the leaf warped — which read as heat haze over the
 * crown rather than as leaves in a wind.
 *
 * `u` is the bend in its whole part (`BEND_STEPS`) and the leaf's phase in its
 * fraction; `v` the tilt in its whole part (`TILT_STEPS` either side of 31, so
 * the stalk is exactly 0) and the bough's phase in its fraction. Float32 keeps
 * the fraction to ~1e-4 under 1023, which is a phase, not a position.
 */
export function boughRig(bend: number, phase: number, tilt: number, leaf: number): [number, number] {
  const b = Math.round(Math.min(1, Math.max(0, bend)) * BEND_STEPS);
  const t = Math.round((Math.min(1, Math.max(-1, tilt)) + 1) * TILT_STEPS);
  const p = phase - Math.floor(phase);
  const l = leaf - Math.floor(leaf);
  return [b + Math.min(l, 0.999), t + Math.min(p, 0.999)];
}
