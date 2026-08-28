/**
 * config/wind.ts — the one wind, and what each layer that moves in it does
 * with it.
 * Owns: the air's direction and speed, and the layers keyed off it — the grass
 * field, the world's foliage, and (bearing only, amplitude its own) a tank's
 * whip antennae. Contract: `docs/rendering.md`.
 * Gotcha: `dir` is not normalised here. Every reader normalises on use, so a
 * hand-tuned pair need not be a unit vector.
 *
 * WHY THIS IS A MODULE OF ITS OWN. The three numbers below lived in
 * `CONFIG.grass` and had exactly one reader, which was fine while grass was
 * the only thing in the valley that moved — and is the whole problem the
 * moment anything else does. Two layers swaying on two directions is not a
 * breeze, it is two animations running at once, and a player reads that as
 * wrong long before they can say why. So the DIRECTION is shared and the
 * amplitudes are not: what a gust does to a blade of grass and what it does to
 * ten metres of canopy are different answers to the same question.
 *
 * The split is also why `speed` is per layer rather than shared. Mass sets
 * frequency — a fern answers a gust in a second, a crown of leaf takes three —
 * so a single speed would either buzz the canopy or becalm the grass. What
 * makes them read as one wind is the shared bearing and the shared travelling
 * phase, not a shared clock.
 */

/** Foliage layers, keyed by how far above the ground the layer's mass sits. */
const foliageLayers = {
  /**
   * The canopy: a jungle tree's leaf plates, its fronds and what hangs off
   * them, nine to eleven metres up.
   *
   * `reach` is the height at which the ramp reaches full travel, and 11 is
   * the canopy tree's own height — so the crown moves nearly the whole
   * `travel` and everything below it moves proportionally less. That is what
   * lets a trunk stay rigid without the crown sliding off it: the plates are
   * centred ON the trunk axis and overlap it by metres, so a third of a metre
   * of drift is inside the overlap and reads as leaf moving over a bough.
   */
  canopy: { reach: 11, amount: 1 },
  /**
   * The understory: fern blades and their drooping tips, ankle to knee.
   *
   * `reach` is a fern's own height — its tips top out around 0.75 m — so its
   * roots are planted and its tips travel, the same shape the grass shader
   * gives a blade and for the same reason. Half the canopy's `amount` because
   * these are small stiff leaves close to the ground rather than a crown
   * catching the whole of the wind, and because this is the layer the player
   * walks through: it is the one place a sway big enough to notice is also big
   * enough to read as the world sliding.
   *
   * The pair is set against the GRASS beside it rather than in the abstract. A
   * fern tip ends up with about 0.09 m of travel where a blade of grass has
   * 0.16, which is the right way round — a fern is stiffer — and close enough
   * that the two do not look like they are standing in different weather.
   */
  understory: { reach: 1, amount: 0.5 },
  /**
   * Hung cloth: a drape over a parapet, a rag tied to a compound wall. Two to
   * eight metres up, and the first layer here that is not a plant.
   *
   * **This layer is the ramp being used AGAINST its own grain, and both
   * numbers are the price of that.** The weight is a function of HEIGHT ABOVE
   * THE GROUND (`world/vertexShading.ts`), which is exactly right for a thing
   * planted at the bottom and free at the top — a blade, a bole, a crown — and
   * exactly inverted for a thing fixed at the TOP and free everywhere else.
   * A hung sheet gets its LARGEST travel at the one edge that is nailed down
   * and its smallest at the hem that should be swinging. There is no per-layer
   * setting that fixes this, because the anchor is not knowable where the
   * weight is written: the bake runs after `BlockMerge`, by which point a
   * whole block's washing is one mesh and no drape has a top of its own any
   * more. `FINDINGS.md` 33 is the open thread.
   *
   * **So the layer is tuned so that the inversion cannot be seen, and the SHAPE
   * carries the effect instead.** `reach` at 5 m spans the heights cloth is
   * actually hung at, so a drape gets a real gradient down its own length — a
   * one-storey parapet's head travels 1.5x its hem, which reads as the sheet
   * shearing rather than sliding — and `amount` at 0.28 puts the largest
   * travel anywhere in the layer at 0.095 m. That number is not taste: every
   * drape in `kit/desert.ts` hangs under a coping that oversails its wall by
   * 0.08, so a head that never travels further than the oversail can never
   * emerge from under it, whatever the wind's bearing does relative to the
   * wall. Cloth that BREATHES rather than swinging, in other words, which is
   * the honest reading of a sheet in a steady wind and is what the amplitude
   * can be held to honestly.
   *
   * **What makes it read as cloth is `drape` and not this**: three strips of
   * differing length, width, hang and proudness under one rolled head, all
   * marked, so the assembly has no internal join to shear and a ragged
   * silhouette to be seen by. A single box on this layer is a slab that
   * translates, which is what it was before and what it looked like.
   */
  cloth: { reach: 5, amount: 0.28 },
} as const;

export const wind = {
  /**
   * Bearing across the XZ plane, normalised on use. Shared by every layer, and
   * the reason they read as one wind rather than two animations.
   */
  dir: [0.78, 0.63],
  /**
   * The grass field's own answer to it — tip travel in metres, and speed.
   * These are the numbers `CONFIG.grass` used to carry; grass looks exactly as
   * it did.
   */
  grass: { travel: 0.16, speed: 1.7 },
  /**
   * The world's foliage: how far a fully-weighted vertex travels (metres), how
   * fast, and how long a gust is on the ground.
   *
   * `gust` is the wavelength of the travelling wave along the wind's own
   * bearing, so a gust crosses a stand of trees rather than every crown in the
   * valley leaning at once. It is long — twenty-six metres against the grass
   * shader's twelve — because a canopy tree is eight metres across and a gust
   * shorter than the thing it moves puts opposite leans on one crown.
   */
  foliage: { travel: 0.34, speed: 0.62, gust: 26, layers: foliageLayers },
} as const;
