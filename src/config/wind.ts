/**
 * config/wind.ts — the one wind, and what each layer that moves in it does
 * with it.
 * Owns: the air's direction and speed, and the two layers keyed off it — the
 * grass field and the world's foliage. Contract: `docs/rendering.md`.
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
