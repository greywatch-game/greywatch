/**
 * config/world.ts — the map's extents and its surface dressing.
 * Owns: map size, water and grass. Contract: `docs/world.md`.
 * Gotcha: water and grass are VISUAL ONLY — no collider, no picking. Their
 * palettes live in the map's `EnvironmentSpec`; this is motion and shape.
 */

/** Map extents. The village is authored inside this square, centred on origin. */
export const map = {
  size: 240,
  /**
   * The LEASH: what a map whose boundary is open does about a player who walks
   * out of the play square.
   *
   * A map closed by the rim needs none of this — the four boundary colliders
   * stop a body and the escarpment is what you see stopping it. A map closed by
   * a `MapLayout.borderland` has neither: the ground simply carries on, which
   * is the whole point, and something has to be the edge instead. That
   * something is a RULE rather than a shape, because the alternative on open
   * ground is an invisible wall in a field — the one thing worse than a visible
   * one.
   *
   * It lives here rather than on the map because it is the same rule wherever
   * it applies, exactly as `regenDelay` is. What a map states is whether it has
   * an open boundary at all, and how much ground is out there.
   */
  leash: {
    /**
     * Seconds outside the square before it kills.
     *
     * The floor under a `borderland`'s `margin`: a leash that outlasts the walk
     * to the rim lets a player reach the boundary colliders, which is the
     * invisible wall this exists to avoid. At sprint (`moveSpeed *
     * sprintMult`, 6.9 m/s) ten seconds is 69 m, so a margin has to beat that
     * with room to spare. Ten is also long enough to be a mistake you can
     * correct: a fight that drifts over the line is common, and a two-second
     * leash would be a kill nobody saw coming.
     */
    seconds: 10,
    /**
     * How few seconds are left when the warning stops being informational.
     *
     * The HUD reads this and nothing else does — it is a rule about the
     * warning, not a rule about the leash, and the leash's own arithmetic is
     * identical either side of it.
     */
    urgentAt: 4,
  },
} as const;

/**
 * Baked per-vertex ambient occlusion (`world/vertexShading.ts`). Costs
 * nothing per frame — it is a vertex attribute written once per map build —
 * so both numbers are about the LOOK rather than about the budget.
 */
export const ao = {
  /**
   * How far an occluder reaches, in metres.
   *
   * This is the size of the shading, not its strength: at 2.5 m a doorway, the
   * inside of an arch and the foot of a wall all darken, while a street with a
   * cottage on the far side does not. Pushing it out starts shading whole
   * facades from their neighbours, which reads as dirt rather than as form —
   * and it is the one number here that costs build time, quadratically, since
   * it decides how many boxes each vertex has to ask.
   */
  radius: 2.5,
  /**
   * How dark a fully occluded vertex goes, as a fraction of the ambient and
   * sky-fill terms.
   *
   * It multiplies only those two — the key light has a shadow map of its own
   * and the point lights deliberately ignore occlusion, the same way they
   * ignore the shadow map, so a lantern in a doorway still lights the doorway.
   * That is also why this can be as strong as it is: it is a fraction of the
   * dimmest light in the scene, not of the frame.
   *
   * 0 disables the bake entirely, and disables it at the source — no attribute
   * is written, so every mesh falls back to the unoccluded default.
   */
  strength: 0.55,
} as const;

/**
 * Surface water (Hollowmere's creek and bog, Greyfen's flood, Harrowmead's
 * mill leat). Visual only — the planes carry no collider, so wading is free
 * and swimming never comes up. Palette lives in the map's EnvironmentSpec;
 * this is motion, shape and how much of a mirror it is.
 *
 * **Nothing in here is a texture scale any more**, and the block is shorter
 * than it was for that reason: the surface is summed from directional wave
 * trains rather than sampled from a tiling normal map, so the numbers that
 * used to exist to keep a lattice off the screen — three uv scales with a
 * sampling floor under them, three scroll speeds tied to those scales, a warp
 * strength and a detail-fade distance — have no referent. See
 * `shaders/WaterShader.ts` for what replaced them and why the replacement has
 * no equivalent trap.
 */
export const water = {
  /** Default surface height above the ground plane: ankle-deep. */
  surfaceY: 0.32,
  /**
   * How many wave trains are summed. Six is the whole cost of the surface —
   * a sin, a cos and an exp each — and it is where the sum stops looking like
   * its own parts: at four you can still count the crossings, and at eight the
   * two finest trains are under a pixel at any range a player stands at, so
   * `waveDetail` has already faded them and they are paid for and invisible.
   *
   * It is a `#define` in the shader rather than a uniform, so changing it
   * recompiles rather than rebinds. That is the right way round for something
   * that is a loop bound.
   */
  waveTrains: 6,
  /**
   * The relief, in metres from trough to crest of the whole sum.
   *
   * **This is a small number and it has to be**: it is centimetres of chop on
   * a plane that never moves, and the reason it reads at all is the mirror.
   * A reflection is violently sensitive to slope — a two-degree tilt swings
   * the sampled ray by four — so the visible roughness of the water is set
   * here long before it is set by anything about the light. Push it past ~0.25
   * and the ripples start returning the ground behind the player, which is the
   * one direction a surface with no vertex displacement cannot honestly show.
   */
  waveHeight: 0.13,
  /**
   * The longest train's wavelength in metres, and the speed it runs at.
   *
   * Everything finer follows from `waveLacunarity` and deep-water dispersion,
   * so these two are the only ones with a unit anybody has to picture: 7.5 m
   * of swell crossing a pond at half a metre a second. The finest train is
   * `waveLength / waveLacunarity^5`, which is ~35 cm — capillary ripple, and
   * the thing that actually sparkles.
   */
  waveLength: 7.5,
  waveSpeed: 0.5,
  /**
   * Amplitude and frequency ratios between successive trains.
   *
   * Their RATIO is the interesting number, because `gain / lacunarity` is how
   * the STEEPNESS moves up the spectrum: at 1 every train is equally steep and
   * the surface is uniformly rough sandpaper, and near 0 the fine trains are
   * flat and the water is a slow swell with no sparkle on it. 0.36 leaves the
   * ripples visibly steeper than the swell, which is what a real short wave is.
   *
   * `waveLacunarity` is deliberately not 2: an octave doubling puts every
   * train's crest on a harmonic of the swell's, and harmonics beat.
   */
  waveGain: 0.66,
  waveLacunarity: 1.85,
  /**
   * Which way the swell runs, in radians. Every other train is this plus a
   * multiple of the golden angle, so one number sets the whole field's grain.
   *
   * It is NOT `CONFIG.wind.bearing`, and the two must not be joined: the wind
   * bearing is what the grass and the canopy lean in, and the shipped water is
   * a creek, a flooded valley and a mill leat — bodies whose surface grain is
   * set by where they drain to, not by the weather.
   */
  waveBearing: 0.9,
  /**
   * How far each train is dragged by the phase of the one above it.
   *
   * The whole point is that a sum of sinusoids at fixed bearings still has a
   * period, and this is what it costs to have none: one multiply-add. Zero it
   * and the beat comes back within a few seconds of watching.
   */
  waveDrag: 0.55,
  /**
   * Pixels per wavelength a train needs before it is drawn at full amplitude.
   *
   * **The one number in this block that is a sampling limit rather than a
   * look**, and unlike the tiling floor it replaced it is expressed against
   * the pixel rather than against the world: the shader measures its own
   * footprint with `fwidth`, so this holds at any resolution, any field of
   * view and any distance without a second number to keep in step. Five is
   * comfortably above the two a Nyquist argument would ask for, because the
   * crests are sharp and a sharp crest carries harmonics of its own.
   */
  waveDetail: 5,
  /**
   * Fresnel reflectance face-on. Water's own is about 0.02 and this is barely
   * over it, which is the point: looking straight down into a pond you see the
   * water, and the mirror is what the same pond does from its bank. The
   * grazing end is not a tunable at all — Schlick takes it to 1.
   */
  reflectance: 0.03,
  /**
   * Schlick's exponent, and the one place this shader is knowingly not
   * physical.
   *
   * Five is the real number and it puts the sheen on very late: a pond is
   * half mirror only inside about eight degrees of the horizontal, which is
   * true and which leaves everything a player is actually standing over
   * reading as the dark body colour. Four brings it on while you are still
   * looking down at the water in front of you, which is the same trade
   * `CONFIG.graphics.glass.falloff` makes for the same reason and by a wider
   * margin (it uses three). Do not answer a dull pond by raising
   * `reflectance` instead — that lifts the FACE-ON end, which is the one
   * angle where a pond genuinely is its own colour.
   */
  fresnelPower: 4,
  /**
   * Cosine half-width of the light's glare in the mirror — ~18 degrees, and
   * broad on purpose for the reason `CONFIG.graphics.glass.halo` is: what a
   * low sun lays on water is a smeared reach of light between you and it, not
   * a second disc. The hard sparkle is `specStrength`, which is a different
   * term about a different thing.
   */
  sunHalo: 0.95,
  /**
   * How many mip levels of the reflection cube the UNRESOLVED chop blurs it
   * by — the ripples the pixel is too small to draw, expressed as roughness.
   *
   * It has to be an explicit level rather than the hardware's own choice, and
   * that is a fact about cube maps rather than a tuning: the screen-space
   * derivative of a cube direction across a grazing water pixel is enormous,
   * so the automatic mip is the bottom of the chain and every sample comes
   * back as the cube's average colour. Four levels of 128px is down to 8px,
   * which is a smear rather than a picture — which is what a far reach of
   * broken water returns.
   */
  mirrorBlur: 4,
  /**
   * The crest glint: Blinn exponent and brightness. `specStrength` is scaled
   * by the map's own `WaterEnvSpec.glint`.
   *
   * 60 rather than the 90 this was under the old normal map. The exponent is
   * only meaningful against the slopes the surface actually reaches, and an
   * analytic field of known amplitude reaches a few degrees where a normal map
   * scaled by a `waveStrength` reached whatever it reached — so the lobe was
   * retuned against a surface whose roughness is now a stated number.
   */
  specPower: 60,
  specStrength: 0.9,
  /**
   * The baked bed-depth map (see `WaterSystem.bakeDepth`) and what reads it.
   * `depthMax` is the depth the byte saturates at, so it only has to cover the
   * deepest bed under any rect; `texels` is its resolution in texels per metre
   * and `texelsMax` the cap a map-wide rect hits.
   */
  depthMax: 1.5,
  depthTexels: 2,
  depthTexelsMax: 512,
  /**
   * The depth (m) at which the body has absorbed 1/e of the way from the
   * shallow colour to the deep one.
   *
   * Beer-Lambert, not a ramp: the fade never reaches the deep colour and has
   * no knee anywhere, which is what keeps a lumpy bed from drawing its own
   * contour across the water. See the shader.
   */
  depthFade: 0.4,
  /**
   * The bed showing THROUGH: the depth (m) over which it stops, and how much
   * of it is there at zero.
   *
   * The water is opaque and stays opaque — the world has exactly one
   * see-through material and it is glazing — so this is not transparency, it
   * is the body colour grading into the map's own `floorColor` where there is
   * nothing left of the body to see. It costs no blend, no sort and no second
   * draw, and at 5 cm of water over a bank it is indistinguishable from the
   * thing it stands in for.
   */
  bedDepth: 0.1,
  bedShow: 0.35,
  /**
   * Light focused by the crests onto a shallow bed. Small, and it is the one
   * term here that is allowed to look like an effect: a shoal that does not
   * move under a lit surface reads as a painted patch, and the crests are
   * where the focusing physically happens.
   */
  caustics: 0.1,
  /**
   * Shoreline foam: band width (m), mask tiling, mask scroll speed, the depth
   * (m) at which it has faded out, how far the waterline breathes with the
   * swell (m), and how hard the crests break over a shoal.
   *
   * **The depth is the one that matters and it wants to be SMALL.** These are
   * flood meadows and mill leats, not beaches: a rect can be ankle-deep for
   * twenty metres, and `shore` is `depth * (width / depth-at-which-it-ends`),
   * so a generous `foamDepth` does not widen a line along the bank — it paints
   * the whole flat white. Nine centimetres is a lip at the edge of the water,
   * which is what foam on still water is.
   */
  foamWidth: 0.45,
  foamScale: 0.28,
  foamSpeed: 0.045,
  foamDepth: 0.05,
  foamLap: 0.22,
  crestFoam: 0.04,
  /**
   * Scum drifting out on the open water — the one foam term with no shoreline
   * in it, and therefore the one that can paint a whole body.
   *
   * It was a literal 0.14 in the shader and it was most of what still read as
   * a mud flat after the shore band had been brought under control: a
   * thresholded copy of the foam mask over EVERY water pixel is a texture on
   * the water, which is the complaint this whole rewrite started from.
   */
  fleckStrength: 0.05,
} as const;

/**
 * Grass fields (src/systems/GrassSystem.ts): thin-instanced tufts with a
 * vertex-shader wind sway plus a radial "pusher" bend around every nearby
 * combatant — the ripple as you run through it. Visual only: no collider,
 * no picking, no outline. Palette lives in the map's EnvironmentSpec.
 */
export const grass = {
  /** Tufts per square metre when a rect doesn't override density. One tuft
   *  is `bladesPerTuft` blades, so this is ~5x that in blades. */
  density: 1.1,
  bladesPerTuft: 5,
  /**
   * Blade height range (metres). Knee-high at the top end — tall enough to
   * read as a field and to swallow boots, short enough that it never hides
   * a crawling firefight.
   */
  heightMin: 0.45,
  heightMax: 0.85,
  // The ambient wind is NOT here. It moved to `config/wind.ts` when the world's
  // foliage became a second thing that leans in it: a bearing this file owned
  // and one reader read is a bearing the canopy could only agree with by
  // copying it. See that module for why the direction is shared and the
  // amplitudes are not.
  /**
   * Character interaction: how far out a body bends blades (m) and how far
   * the tip travels at ground zero (m). The radius wants to be just past a
   * sprint stride so the grass reacts ahead of the feet, not under them.
   */
  pushRadius: 1.35,
  pushStrength: 0.6,
  /**
   * Shader array size for simultaneous pushers. The player plus the seven
   * nearest bots; beyond that the bend is outside reading distance anyway.
   */
  maxPushers: 8,
} as const;
