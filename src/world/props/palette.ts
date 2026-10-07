/**
 * props/palette.ts — The colours more than one scatter prop wears: the
 * two barks, the needles, the broadleaf, the jungle hardwood, the creeper and
 * the dark steel — and `RIM_WOOD`, which dresses a rolling rim's woods in
 * them. A colour only one prop wears is in that prop's file.
 * Invariants: art constants, deliberately not in CONFIG, and restated rather
 * than imported from the structure kit (see `VINE`). Never builds a prop.
 */
export const BARK = "#4a4238";
export const DEAD_BARK = "#3c3730";
export const NEEDLE = "#26402f";
export const NEEDLE_LIT = "#35563d";

// Jungle hardwood: paler and greyer than the valley's dead bark — a wet trunk
// under a bright sky, not a charred one under a moon.
export const JUNGLE_BARK = "#5b5443";

export const LEAF = "#2c5230";
export const LEAF_LIT = "#437a3e";

/**
 * What the woods on a rolling rim wear (`Ridge.ts`), keyed by its tones: the
 * pine's own needles and bark, so a stand on the hill and the stands on the
 * plain in front of it are one wood seen at two distances, and the dark
 * broadleaf rather than the ash's — the ash's spring green, a hundred crowns
 * of it lit by a low sun, came out as a field of bright diamonds a long way
 * brighter than the pines beside it. `trans` is the translucency each takes,
 * `null` for an opaque cel material; `MapBuilder` reads both.
 */
export const RIM_WOOD = {
  needle: { hex: NEEDLE, trans: "foliage" },
  needleLit: { hex: NEEDLE_LIT, trans: "foliage" },
  leaf: { hex: LEAF, trans: "canopy" },
  bark: { hex: BARK, trans: null },
} as const;

// Creeper and moss. The same value as the kit's CREEPER, deliberately restated
// rather than imported: the scatter set owns its own palette and takes nothing
// from the structure kit, so a prop stays placeable without a builder.
export const VINE = "#41552f";

export const DARK_METAL = "#262a33";
