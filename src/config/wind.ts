/**
 * config/wind.ts — the one wind, and what each layer that moves in it does
 * with it.
 * Owns: the air's direction and speed, and the layers keyed off it — the grass
 * field, the world's foliage (ramped, and the one rigged layer's `frond`), the
 * flags over the control points, and (bearing only, amplitude its own) a
 * tank's whip antennae. Contract:
 * `docs/rendering.md`.
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
   * The canopy: a jungle palm's fronds and what hangs off them, six to
   * twelve metres up.
   *
   * `reach` is the height at which the ramp reaches full travel, and 11 is
   * the canopy tree's own height — so the crown moves nearly the whole
   * `travel` and everything below it moves proportionally less. That is what
   * lets a trunk stay rigid without the crown sliding off it: every frond
   * starts ON the trunk axis inside a crown head that does not move, so a
   * third of a metre of drift is spent inside the head and reads as the
   * fronds moving over it.
   */
  canopy: { reach: 11, amount: 1 },
  /**
   * The understory: fern blades and their drooping tips, ankle to knee.
   *
   * `reach` is a fern's own height — its young fronds top out around 0.85 m — so its
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
  /**
   * A jungle palm's fronds and the vines hung off them — the one layer that is
   * RIGGED rather than ramped (`world/sway.ts`): every vertex carries where it
   * is along its OWN frond and which frond that is, written before the merge,
   * so a frond bends from its root and no two fronds move as one.
   *
   * **It takes no ramp at all, and that is the fix rather than a setting.** The
   * crown head and the bole do not move, and a ramp in height hands every frond
   * in a crown — all of them eight to eleven metres up — very nearly the same
   * travel, so the whole crown slid back and forth over a head that stood
   * still. What moves here is `CONFIG.wind.frond`'s, and it is zero at every
   * frond's root by construction.
   */
  frond: { rig: true },
} as const;

export const wind = {
  /**
   * Bearing across the XZ plane, normalised on use. Shared by every layer, and
   * the reason they read as one wind rather than two animations.
   */
  dir: [0.78, 0.63],
  /**
   * The grass field's own answer to it.
   *
   * `travel` and `speed` are the steady sway every blade has — tip travel in
   * metres and a rate — and are the numbers `CONFIG.grass` used to carry.
   *
   * **The GUSTS are what make a field read as wind rather than as blades
   * rocking**: a slow noise field, `gust` metres to a wave, carried DOWNWIND
   * at `gustSpeed` m/s, which leans every blade it is over by a further
   * `gustLean` of its own height and turns its tip up to the sky by `sheen`
   * — the pale wave you watch roll across a hayfield. Carried along `dir`, so
   * it travels the way the canopy's gust does; faster than it, because a
   * gust crosses open grass faster than it crosses a stand of trees.
   * `flutter` is the quick shiver on top, as a share of `travel`.
   */
  grass: {
    travel: 0.16,
    speed: 1.7,
    gust: 13,
    gustSpeed: 4.2,
    gustLean: 0.5,
    sheen: 0.5,
    flutter: 0.35,
  },
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
  /**
   * What a RIGGED frond does (`layers.frond`), every distance in metres at the
   * frond's TIP — a vertex part-way along takes `frondBend` of it, which is a
   * cantilever's deflection curve, so the stiff stalk barely moves and the
   * outer blade carries the motion.
   *
   * **Three motions over one gust, and the split is what reads as wind.** The
   * GUST is `foliage`'s own travelling field, so a gust still rolls across a
   * stand rather than every crown answering at once — but here it is a
   * PRESSURE rather than a swing: the crown is pushed DOWNWIND by `lean`,
   * holding `calm` of it between gusts, and never pulled back past rest. A
   * symmetric swing upwind and down is the other half of why the old crown
   * read as sliding; nothing in a wind leans INTO it. Under that, each frond
   * FLAPS — `flap` up and down at `flapRate` rad/s, `swing` across the wind at
   * a slower beat — on a phase and a rate of its own (±15%), so neighbours
   * drift in and out of step instead of nodding together, and both are
   * stronger inside a gust than outside one. Over all of it the pinnae
   * FLUTTER: `flutter` at a pinna's point and nothing at the rib, at
   * `flutterRate` rad/s, phased by position along a `flutterWave` metre wave
   * so the ripple runs down the frond instead of the fringe shivering in
   * unison. The cel shader's facets are taken off the displaced position, so
   * a fluttering pinna catches the light as it turns — no normal is moved for
   * it.
   *
   * Set against the palm's own size: a frond is ~5 m, so a 0.3 m push is a
   * three-degree lean at the root, and the lowest leaf in the crown hangs at
   * 5.5 m on the smallest tree — `flap` is the only term that takes a tip DOWN
   * and is two orders under that margin.
   */
  frond: {
    lean: 0.3,
    calm: 0.25,
    flap: 0.17,
    flapRate: 3.9,
    swing: 0.11,
    flutter: 0.035,
    flutterRate: 21,
    flutterWave: 1.4,
  },
  /**
   * The flags over the control points (`systems/FlagCloth.ts`) — the one
   * layer here that is SIMULATED rather than posed, and so the one that needs
   * the air as a SPEED rather than as a travel. A flag posed by a sine is a
   * sheet of card rocking on a hinge; what makes cloth read as cloth is that
   * the shape is the answer to the air and the air is never quite steady.
   *
   * Everything below is physics, in SI units, because the cloth is: the
   * pressure on each triangle is `air * normalDrag * area * vn|vn|` along its
   * normal and `air * skinDrag * area * |vt| vt` along it, against a sheet of
   * `density` kg/m². That ratio is what decides how a flag flies — a heavy
   * sheet in a light wind hangs, a light one in a strong wind streams — so
   * `speed` and `density` move as a PAIR, and neither means much alone.
   */
  flag: {
    /** Mean air speed at the flag, m/s. A fresh breeze: streams, never stiff. */
    speed: 6,
    /**
     * Gust share of `speed`, riding the foliage's own `gust` wavelength so a
     * gust that crosses a stand of trees crosses the flag in the same beat.
     */
    gust: 0.4,
    /** Seconds per gust — two incommensurate periods, so no beat repeats. */
    gustPeriods: [6.3, 2.7],
    /**
     * The turbulence that makes it FLAP: a cross-flow share of `speed`,
     * travelling downwind at `convect` of it with a `flutterLength` metre
     * wave. It rides the along-wind coordinate, so the ripple starts at the
     * hoist and runs out to the fly the way a real flag's does.
     */
    flutter: 0.3,
    flutterLength: 1.5,
    convect: 0.8,
    /** How far the bearing wanders either side of `dir`, radians, slowly. */
    veer: 0.14,
    /** Cloth: kg/m² — a polyester bunting is about a fifth of a kilo. */
    density: 0.2,
    /** Air density, and the two drag coefficients above. */
    air: 1.2,
    normalDrag: 1,
    skinDrag: 0.05,
    /** Fraction of velocity kept per step: a little internal friction. */
    damping: 0.998,
    /**
     * The step, Hz, and the constraint passes per step. Explicit and fixed,
     * so a flag flies the same at 30 fps as at 144.
     *
     * The passes are the cost: the constraint loop is nearly all of a flag's
     * time. Seven was the first figure and measured 0.36 ms with five flags
     * in view; four holds the sheet to its size in this wind, and a sheet that
     * reads as STRETCHY — a fly that lengthens in a gust — is the sign it has
     * gone too low.
     */
    rate: 120,
    iterations: 4,
    /** Bend stiffness 0..1 — cloth creases, it does not fold like paper. */
    bend: 0.22,
  },
} as const;
