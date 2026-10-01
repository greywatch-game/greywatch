/**
 * kit/japan/palette.ts — The temple town's colours: the five materials and
 * the one accent the set is made of (see `./index.ts`), the glows behind its
 * paper, and the two fallen-leaf colours a stone ornament borrows from the
 * maples' litter.
 * Invariants: art constants, deliberately not in CONFIG. Vermilion (`SHU`) is
 * spent on the sacred and the crossed alone.
 */
import { CONFIG } from "../../../config";

// Art constants, judged under a 14-degree gold key: every albedo here is a
// shade darker and greyer than its swatch would suggest, because the hour is
// in the LIGHT (see `kurenai/environment.ts`) and warming a material under a
// warm key double-counts it.

/** Stained timber: posts, lattice, the frame of everything. */
export const SUMI = "#2f2620";
/** Aged cypress: the hall's pillars, an engawa, a floor. */
export const HINOKI = "#5c4332";
/** Weathered cedar decking — lighter, because it is walked on and bleached. */
export const CEDAR = "#6d5440";
/** Lime plaster. Cream rather than white, for the khaki clamp's reason. */
export const SHIKKUI = "#b3aa97";
/** Earthen plaster: the garden walls and the farmhouses. */
export const TSUCHI = "#8f7552";
/** Fired roof tile, a warm grey — the reference frame's roofs are not blue. */
export const KAWARA = "#4a4744";
/** The ridge and the end tiles, a step darker so the ridge line reads. */
export const KAWARA_DARK = "#35332f";
/** Old thatch. */
export const KAYA = "#6a5a3f";
export const KAYA_DARK = "#4d412d";
/** Vermilion: the sacred and the crossed, and nothing else. */
export const SHU = "#b23a22";
/** Granite: lanterns, plinths, footings. */
export const GRANITE = "#7a766d";
export const GRANITE_DARK = "#56534d";
/** Temple bronze — the bell, the finials, the caps on the bridge's posts. */
export const BRONZE = "#6f5b3a";
/** Namako tile: the storehouse's black skirt. */
export const NAMAKO = "#2c2d2f";
/** Unlit paper — a shoji with nobody home. */
export const PAPER = "#cbbd9e";
/** Paper with a lamp behind it. */
export const SHOJI_GLOW = "#f2b56e";
/** The one dim glow: a sanctuary's gilt in the dark of the hall. */
export const GILT_GLOW = "#e0a24a";
/** The noren over a shop door. */
export const NOREN = "#2d3d58";
/**
 * Persimmons drying under a farm's eave — the maples' own fallen flame
 * (`Props.ts`'s `FALLEN`), so the fruit shares the leaf litter's material
 * rather than adding a draw to every block a farm stands in.
 */
export const KAKI = "#c9602a";

export const TRANSLUCENCY = CONFIG.graphics.translucency;

/**
 * The maples' own red on the ground (`Props.ts`'s `FALLEN`), for the leaves
 * lying on a stone pagoda — the litter's material, so a leaf on a ledge adds
 * no draw to a garden block the litter already carpets. `KAKI` is the other.
 */
export const MOMIJI = "#b33c20";
