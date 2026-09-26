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
 * The world's WEAR: the grime a surface collects where it meets the ground,
 * baked into the BLUE channel of the same vertex walk that writes the AO and
 * spent by the cel shader as a tint toward the map's own dirt colour.
 *
 * WHY IT RIDES THE BAKE. What a fragment cannot answer for itself is how far
 * above the GROUND it is: it holds `vPosW` and its own normal, but the terrain
 * height at its own xz is a heightfield sample, and taking one per pixel would
 * put a texture fetch and a filter on every world surface in the frame. It is a
 * per-vertex quantity knowable only once the merges are done and derived from
 * where a vertex ENDED UP — which is the AO's argument word for word, and why
 * this shares that walk rather than asking for one of its own.
 *
 * AND THE SECOND THING IT CANNOT ANSWER IS WHETHER IT IS INDOORS. Splash-back
 * and rising damp are weather, and a height ramp has no opinion about which
 * side of a wall it is on — a wall box's two faces are the same four corners
 * with opposite normals, so the term climbed the inside of every cottage in the
 * village exactly as it climbed the street front. `shelterProbe` and
 * `shelterCover` are what the bake tests instead; the fragment holds one normal
 * and one world position and could never have known.
 *
 * WHAT IT IS FOR. The cel shader has no texture detail, so a wall is one flat
 * band from its footing to its eaves and meets the street with nothing but the
 * AO's crease. That reads as a building PLACED on the ground rather than one
 * standing in it. A dirt ramp up the first metre or two of every vertical face
 * is the cheapest thing that fixes it, and it is the only surface-detail term
 * in this renderer that costs no sample, no lattice and no second material.
 *
 * ONLY THE RAMP'S GEOMETRY IS HERE, and the split is the one the eight
 * overrides in `CLAUDE.md`'s table already make: how splash-back and damp climb
 * a wall is physics and is the same everywhere, so it is CONFIG; how dirty a
 * place is and what colour its dirt is are claims about a PLACE, so they are
 * `EnvironmentSpec.wear` and default to nothing. A map that says nothing is
 * unaffected.
 *
 * WHAT THE BAKE STORES IS THE STRAIGHT LINE AND NOT THE CURVE, and that is the
 * one thing in here somebody could undo without noticing. A box part has eight
 * corners and no vertical subdivision, so a wall's only samples are its footing
 * and its eaves: baking the curved weight and letting the rasteriser join them
 * up draws a straight line between 1 and 0 across the WHOLE wall, which is how
 * this term spent its first version reading as a building that is slightly
 * darker rather than a building with dirt on it — at head height on a 3 m wall
 * the interpolant was still 0.47 of full grime. The height above ground is
 * itself linear up a vertical face, so the LINE interpolates exactly where the
 * curve cannot, and `falloff` is spent per FRAGMENT. That is also why the blue
 * channel may now be NEGATIVE above `height` and why nothing may clamp it in
 * the walk: the zero crossing is what puts the stain's top edge where this
 * says, and clamping the eaves vertex to 0 moves that crossing back up to the
 * eaves. The shader clamps, after interpolation, where it is free.
 *
 * THE GRAIN IS THE SECOND HALF AND IT IS NOT A TEXTURE. A tide line at one
 * exact height on every wall in the village is a contour, and a contour is a
 * clock: you read the rule rather than the dirt. Two octaves of the value noise
 * the albedo variation already uses displace the ramp itself — sampled in WORLD
 * space with the vertical squashed, so the cells stretch into runs down a face
 * — which breaks the top edge into a ragged line and thins the footing
 * unevenly at the same time, off one field, for the price of two hashes on
 * world geometry only. It is not a lattice, it has no uv and no clock, and it
 * costs no sample: the same test `graphics.albedoVariation` passes.
 *
 * It is NOT `graphics.albedoVariation` with a different name. That term is a
 * noise breaking one flat albedo up so a wall is not one value — a property of
 * the RENDERER, which is why its own note says weathering belongs to the look
 * and not to the map. This one is directional, keyed to the ground, and says
 * something about where it is; the two stack and neither substitutes.
 */
export const wear = {
  /**
   * How far up a surface the grime reaches, in metres — the height at which the
   * baked ramp crosses zero, NOT where the stain stops being visible.
   *
   * Those two were the same number while the curve was baked and are not now:
   * `falloff` is spent at the fragment, so the perceptible top edge of a stain
   * at a typical `amount` sits at a bit over HALF of this, and the grain then
   * wanders that edge by `height * edgeBreak / 2` either side. At 2.6 the line
   * lands near 1.4 m and the wander is about a metre, so the DIRTIEST streaks
   * reach into the building kit's ground-floor band (sills, door heads, the
   * course a shopfront's fascia sits on, 1.4 to 2.2 m) while the wall between
   * them is clean well below it. That is the constraint that has always set
   * this number and it is why the grain is what let it be raised: a stain that
   * reaches 2 m in RUNS is a wet wall, and the same stain reaching 2 m
   * uniformly is a two-tone paint job on every building in the village.
   *
   * **A footing is not where the terrain is**, which is the thing that surprises
   * when this is set from arithmetic alone: `above` is measured from the
   * HEIGHTFIELD, and the visible bottom of a wall sits on a plinth, a step or a
   * road slab laid over it. Half a metre of this is spent before the wall
   * starts.
   */
  height: 2.6,
  /**
   * The ramp's shape: 1 is linear, higher crowds the dirt toward the footing.
   *
   * Linear puts as much grime at waist height as at the skirting, which is
   * exactly what reads as paint rather than as dirt. Splash-back and capillary
   * damp both fall off fast, so the curve wants to be well over 1 — and this is
   * the first number to move if the effect reads as a BAND rather than a STAIN.
   *
   * It is a UNIFORM and no longer a `Math.pow` in the walk, which is what makes
   * it worth having at all: see the header on why a curve baked at two vertices
   * three metres apart is not the curve it was written as.
   */
  falloff: 1.4,
  /**
   * How far from vertical a face may lean and still take the full ramp, in
   * degrees.
   *
   * Grime of this kind is splash and rising damp: both climb a wall, neither
   * collects on a floor. So the term is weighted by how vertical the surface
   * is — which the FRAGMENT answers from its own normal and which is therefore
   * not baked, the mirror of the height ramp it cannot answer.
   *
   * Without it the terrain takes the ramp over its whole area (every ground
   * vertex is at zero height above the ground by construction) and the map
   * shifts tone for nothing. A roof pitch — ~24 degrees in the kit, see
   * `BuildingKit.gableRoof` — sits well outside this and stays clean, which is
   * right: a roof's dirt is a different signal and would want its own term.
   */
  verticalDegrees: 35,
  /**
   * How far off a face the bake stands before it looks UP for cover, in metres
   * — the probe that decides a surface is an OUTSIDE one.
   *
   * Splash-back and rising damp are both weather, and an interior wall gets
   * neither: a room's plaster is as dry a metre off the floor as it is at the
   * skirting. Without this the ramp is a pure function of height above ground,
   * so it climbed the inside of every cottage in the village exactly as it
   * climbed the street front, and the two faces of one wall box — which are
   * the same four corners projected from opposite normals — came out identical.
   *
   * IT HAS TO CLEAR THE EAVES, and that is the whole of why it is a distance
   * rather than a flag, as well as why it is as big as it is. A vertex standing
   * on its own xz is under its own building's roof collider whichever side of
   * the wall it is on, so the probe steps out along the face's own normal until
   * it is past the overhang and genuinely in the open. What it is sized against
   * is the WORST overhang in the kit rather than the commonest: a cottage's
   * `gableRoof` stands 0.35 off the wall it caps, which is 0.18 past the face
   * once the wall's own half thickness comes off, but a JETTIED townhouse
   * carries its roof on the upper storey and oversails the ground floor as
   * well, so its eaves reach 0.63 m out over that facade. 0.6 was tried first
   * and is the measurement worth keeping: it cleared every cottage in
   * Hollowmere and fell 25 mm short of the townhouses, which took the grime off
   * the whole ground floor of every one of them — a facade on the square,
   * clean, between two dirty neighbours.
   *
   * WHAT BOUNDS IT ABOVE IS THE SHALLOWEST ROOM, since the same step taken
   * INWARD has to still be under the roof: the kit's smallest interior is
   * 6 m deep, so a wall's inner face has 2.8 m of cover in front of it and
   * this has most of that as headroom. It may not exceed `ao.radius` either —
   * the probe rides the AO's box index, whose `pad` is the promise that query
   * was built with — and it is clamped to it rather than asserted, because the
   * two numbers are set in different blocks of this file and neither one's own
   * note is about the other.
   */
  shelterProbe: 1.2,
  /**
   * How high a thing overhead has to be, in metres above the ground beneath it,
   * before it counts as COVER rather than as furniture.
   *
   * The probe asks "is anything above me", and everything in a village is
   * above something: a crate against a wall, a plinth, a kerb, the wall
   * itself. What separates a roof from all of that is that you can stand under
   * it, so cover is a box whose UNDERSIDE clears this — a roof slab (the kit
   * puts one at the eaves), a first floor, an arcade, an awning, a deck you
   * can walk beneath. A crate's underside is on the ground and shelters
   * nothing.
   *
   * 1.5 is under the lowest eaves in the kit and over the tallest prop, which
   * is the band this has to land in; it is not a head height and nothing walks
   * to it.
   */
  shelterCover: 1.5,
  /**
   * Metres per cell of the grain's COARSE octave — which stretch of frontage is
   * dirty and which got away with it.
   *
   * It wants to be smaller than a building and bigger than a window, so that
   * one wall carries two or three of them: at 5 m (`albedoVariation`'s figure)
   * a whole cottage is inside one cell and the grain only tilts the tide line
   * instead of breaking it. Under about 1 m the coarse octave stops being
   * blotches and starts doing the fine octave's job twice. The fine octave is
   * this at 3.4x and is not stated — what these two are FOR is one blotch field
   * with runs in it, and the knob worth having is the pair's scale.
   */
  metersPerCell: 2.2,
  /**
   * How much the noise cells are SQUASHED vertically before they are sampled, 1
   * being round and smaller being taller.
   *
   * This is the whole difference between blotches and RUNS. Water leaves a wall
   * by running down it, so the field that describes where it went has to be
   * anisotropic — and because the squash is applied to world Y before the
   * sample rather than to a uv, a wall, a fence post and a barrel all get runs
   * the same way up with nothing to say which is which. At 0.3 a cell is a
   * little over three times as tall as it is wide.
   */
  streak: 0.3,
  /**
   * How far the grain displaces the ramp, peak to peak, in RAMP units.
   *
   * The ramp is 1 at the footing and 0 at `height`, so this converts to metres
   * by halving it and multiplying by `height`: 0.8 wanders the tide line about
   * a metre either way at the shipped height. It thins the footing by the same
   * stroke — the low side of the grain takes the ramp below 1 where the high
   * side is clamped by it — so one field breaks the edge AND mottles the stain,
   * which is right, a wall being dirtiest exactly where the water ran.
   *
   * It is big because the displacement is what the effect READS as. Measured on
   * Hollowmere's square: at 0.55 with `contrast` at 2.6 the term was a smooth
   * vertical gradient and a screenshot could not find a single streak in it;
   * this pair is what turned it into runs down a wall.
   *
   * 0 is a clean contour at one height on every wall in the village, and is
   * worth setting once to see what the grain is doing.
   */
  edgeBreak: 0.8,
  /**
   * How far the grain is stretched about its own middle before it is spent.
   *
   * **Without this the grain is arithmetic nobody can see**, and it is the one
   * number here that is about the NOISE rather than about dirt. Trilinear value
   * noise is eight hashes averaged, so it is centrally peaked rather than
   * uniform — a cell centre's standard deviation is about 0.10 against a
   * corner's 0.29 — and summing two octaves narrows it again to something like
   * 0.15. At that spread `edgeBreak` moves a tide line by a few centimetres,
   * which is a straight line that cost two hashes.
   *
   * 5 takes it bimodal, which is the right shape for the thing being described:
   * a wall is stained here or it is not, and what carries the look is the
   * boundary between those rather than a smooth field of in-betweens. Lower is
   * a haze — 2.6 was tried and is invisible — and much higher is a hard-edged
   * map of the noise's own cells.
   */
  contrast: 5.0,
} as const;

/**
 * Surface water (Hollowmere's creek and bog, Greyfen's flood, Harrowmead's
 * river, two seas and a desert's pools). Visual only — the surfaces carry no
 * collider, so wading is free and swimming never comes up. Palette and how
 * big the waves are live in the map's `WaterEnvSpec`; this is the physics of
 * the waves, the grid that carries them, and how the light lands on them.
 *
 * **Nothing in here is a texture scale.** The surface is summed from
 * directional wave trains rather than sampled from a tiling normal map, and
 * since the swell became GEOMETRY it is summed twice — once per vertex to
 * displace the grid, once per pixel to light it — from one WGSL function. See
 * `shaders/WaterShader.ts`.
 */
export const water = {
  /** Default surface height above the ground plane: ankle-deep. */
  surfaceY: 0.32,
  /**
   * The wave field: a SPECTRUM, of which a map states only the top.
   *
   * `WaterEnvSpec.swell` is how tall the longest train stands, crest to
   * trough, on open water; `steepness` turns that into its wavelength, and
   * `gain` and `lacunarity` walk down from there to `ripple`, the shortest
   * train worth summing. So a pond with a 12 cm swell is a 2.7 m wave and
   * eight trains of chop under it, and a sea with 80 cm is an 18 m wave and
   * sixteen — the same physics at two sizes, which is why one number per map
   * is enough.
   */
  waves: {
    /**
     * The most trains any body sums. A loop bound and a uniform ARRAY's size,
     * interpolated into the shader as a literal, so raising it recompiles. A
     * small swell stops early, at `ripple`.
     */
    trains: 16,
    /** The swell a map gets that states none, metres crest to trough. */
    swell: 0.12,
    /**
     * Metres of swell per metre of a rect's SHORT side, as a cap on the map's
     * own: wind raises a wave over the water it crosses, so a 6 m creek
     * cannot carry a harbour's swell whatever map it is on. A sea's rects are
     * hundreds of metres across and never meet it.
     */
    fetch: 0.015,
    /**
     * Height over wavelength of the longest train. 1/22: a wind sea that has
     * been blowing a while, well short of the 1/7 at which a wave breaks. It
     * is what turns a map's swell into a wavelength, so raising it makes
     * every map's longest wave SHORTER and choppier, not taller.
     */
    steepness: 0.045,
    /**
     * Amplitude and wavelength ratios between successive trains. Their
     * PRODUCT is how the steepness moves down the spectrum: at 0.94 the chop
     * is a little flatter than the swell it rides, so the long waves carry
     * the shape and the short ones the sparkle. Never an exact ratio —
     * `jitter` moves each step by up to that fraction, because an exact one
     * puts every crest on a harmonic of the swell's and harmonics beat.
     */
    gain: 0.7,
    lacunarity: 1.31,
    jitter: 0.12,
    /** Metres: the shortest train summed — capillary ripple, what sparkles. */
    ripple: 0.28,
    /**
     * Which way the swell runs, radians, and how far a train may stray from
     * it: `spread[0]` for the longest, `spread[1]` for the shortest. A wind
     * sea's swell is ordered and its chop comes from everywhere; spreading
     * every train evenly all round is a crosshatch, which read as crinkled
     * foil. NOT `CONFIG.wind.bearing` — the bodies here are creeks, a river,
     * a flood and two seas, whose grain is set by where they drain and what
     * fetch they have, not by the weather in the canopy.
     */
    bearing: 0.9,
    spread: [1.0, 2.8],
    /** The seed every body's trains are drawn from. See `waveTrains`. */
    seed: 0x5ea5,
    /**
     * How many of the longest trains are the SWELL — the shapes the body's
     * tone bands, the crest glow and the whitecaps follow. The rest is chop,
     * which the mirror and the glints are asked of.
     */
    broad: 4,
    /**
     * How far each train's sample is dragged toward the crest of the one
     * above it, in multiples of that train's amplitude. It is what breaks the
     * beat between fixed bearings and what bunches the chop onto the swell's
     * crests; zero it and the repeat comes back within a few seconds.
     */
    drag: 1.4,
    /** Multiple of deep-water dispersion (`sqrt(g k)`). 1 is physical. */
    speed: 0.85,
    /**
     * Metres per second a STREAM carries its whole field downstream — a rect
     * whose `sound` is `"stream"` runs along its long side, because that is
     * the rect's own claim that the water runs. Standing water has none.
     */
    stream: 0.55,
    /**
     * No wave taller than `1 / break` of the water under it — a wave breaks
     * at about 0.78 of the depth, and 1.6 keeps well short of that — plus
     * `lap` metres at the very waterline, so the edge still breathes rather
     * than standing dead. This is what makes a flood meadow calm and a
     * channel through it move, with nobody saying which is which.
     */
    break: 1.6,
    lap: 0.035,
    /**
     * Pixels per wavelength a train needs before it is LIT at full amplitude.
     * A sampling limit, not a look: the shader measures its own footprint
     * with `fwidth`, so it holds at any resolution and field of view. What a
     * pixel cannot draw becomes roughness rather than nothing.
     */
    detail: 5,
  },
  /**
   * The grid the swell is displaced on, stood under the camera and clamped to
   * each rect in the vertex shader.
   *
   * **Uniform under the camera, geometric beyond.** `cell` metres out to
   * `near`, then each step `growth` times the last out to `reach`, then one
   * last line far enough to close any rect in the tree. The origin snaps to
   * one near cell, so near vertices land on the same world points every
   * frame; a far vertex moves a near cell's width when it snaps, which is
   * nothing against the only trains it carries — a vertex draws a train only
   * where it has `detail[1]` cells per wavelength (none below `detail[0]`),
   * so the swell leaves the geometry of its own accord as the cells grow.
   * `quadBeyond` is the distance past which a body is drawn with a plain
   * two-triangle quad instead, because none of the grid is carrying anything
   * there and its triangles would all be clamped to nothing.
   */
  grid: {
    cell: 0.5,
    near: 12,
    growth: 1.05,
    reach: 240,
    far: 40000,
    detail: [5, 8],
    quadBeyond: 120,
  },
  /**
   * Fresnel reflectance face-on. Water's own is about 0.02: looking straight
   * down into a pond you see the water, and the mirror is what the same pond
   * does from its bank.
   */
  reflectance: 0.03,
  /**
   * Schlick's exponent, and the one place this shader is knowingly not
   * physical: five puts the sheen on only inside about eight degrees of the
   * horizontal, four brings it on while you are still looking down at the
   * water in front of you. Do not answer a dull pond by raising `reflectance`
   * — that lifts the FACE-ON end, the one angle where a pond is its own
   * colour.
   */
  fresnelPower: 4,
  /**
   * Cosine half-width and strength of the light's SOFT glare in the mirror —
   * the sky itself round the sun, reflected, ~18 degrees. The hard light is
   * `light`, below; this is what is left of it where the chop is too fine to
   * draw.
   */
  sunHalo: 0.95,
  haloStrength: 0.6,
  /**
   * How many mip levels of the reflection cube the UNRESOLVED chop blurs it
   * by. It has to be an explicit level: the automatic mip across a grazing
   * water pixel is the bottom of the chain, every sample the cube's average.
   */
  mirrorBlur: 4,
  /**
   * The share of the CHOP the reflected picture follows; the swell it follows
   * whole, and the light on the waves takes all of both. Low, because that
   * split is the stylisation: a reflection painted as a few smooth wobbling
   * shapes, and the sun on the same water as hard sparks. At 1 the chop that
   * breaks the sun into glitter breaks the far bank into foil with it.
   */
  mirrorChop: 0.35,
  /**
   * **Every light on the water is asked of the WAVES and cut hard in
   * DEGREES** — on the angle between the mirrored ray and the light, off the
   * full wave field's normal. `glint` is the core, where a facet shows the
   * light itself; `sheen` is the path of light round it. The chop too fine to
   * draw widens both and dims them by the same factor, so the far reach goes
   * to the soft `sunHalo` instead of drawing the light as an egg. `lamp` is
   * the same pair for a point light, wider because a lamp is near.
   *
   * `through` is the light glowing THROUGH a backlit crest — looking toward a
   * low sun, the thin top of a swell lit from behind in the water's own
   * shallow colour. `crest` is how near the top of the swell it starts, and
   * `swell` the range (m) over which a map's water goes from showing none of
   * it to all of it — a pond's ripple has no crest thick enough to see into.
   *
   * A map scales `glint.strength` and `sheen.strength` by its own
   * `WaterEnvSpec.glint`.
   */
  light: {
    glint: { degrees: 2.2, strength: 1.3 },
    sheen: { degrees: 6, strength: 0.28 },
    lamp: [2, 5],
    through: { strength: 0.55, crest: 0.72, swell: [0.25, 0.6] },
  },
  /**
   * Whitecaps: how near the crest one may start, and the swell (m) over which
   * a map's water goes from breaking nowhere to breaking at `crestFoam`.
   */
  caps: { level: 0.9, swell: [0.35, 0.9] },
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
   * shallow colour to the deep one. Beer-Lambert, not a ramp: the fade never
   * reaches the deep colour and has no knee anywhere, which is what keeps a
   * lumpy bed from drawing its own contour across the water.
   */
  depthFade: 0.4,
  /**
   * The bed showing THROUGH: the depth (m) over which it stops, and how much
   * of it is there at zero. Not transparency — the body colour grading into
   * the map's own `floorColor` where there is nothing left of the body to see.
   */
  bedDepth: 0.1,
  bedShow: 0.35,
  /** Light focused by the crests onto a shallow bed. */
  caustics: 0.1,
  /**
   * The share of the key the BODY takes whichever way the surface faces.
   * What colours water is light scattered inside it, which does not care
   * which way the surface is tilted, so the banded tone patches the swell
   * casts are a shift over this floor rather than the whole of the light —
   * at 0 a wave's back facing away from the sun went to ambient and read
   * as a hole in the sea.
   */
  scatter: 0.55,
  /**
   * Shoreline foam: how far out from the waterline the lace runs (m), the
   * mask's tiling and scroll speed, and the flattest bed the line is measured
   * against.
   *
   * **`foamWidth` is a DISTANCE from the waterline, not a depth.** The shader
   * divides the water's depth by the bed's own slope, so the lace is one
   * width on a steep bank and a gentle one — keyed on depth alone, a flat just
   * awash foamed across its whole area. `foamSlope` is the floor under that
   * slope: a bed flatter than it counts as this steep, so a truly level shoal
   * foams only where it actually meets the air. The lapping is no longer a
   * number either: the depth the band reads is the DISPLACED surface's, so
   * the line runs up the bank under a crest and drains behind it.
   */
  foamWidth: 0.45,
  foamScale: 0.28,
  foamSpeed: 0.045,
  foamSlope: 0.04,
  /** How far a breaking crest goes toward the foam colour, at full swell. */
  crestFoam: 0.8,
  /**
   * Scum drifting out on the open water — the one foam term with no shoreline
   * in it, and therefore the one that can paint a whole body.
   */
  fleckStrength: 0.05,
  /**
   * What a ROTOR does to the surface it is hovering over: the hole a downwash
   * tears in the water, the white ring at the edge of the disc, and the rings
   * running out from under it.
   *
   * **It is here and the SPRAY is on the vehicle, and that split is the same
   * one `CONFIG.vehicles.wash` already makes with `flight.washHeight`.** What
   * a machine states is what its rotor reaches; what a picture costs is one
   * block. Spray is a picture of the MACHINE — a ring of particles emitted by
   * a rotor, priced and coloured beside the dust it replaces — and the ripple
   * is a picture of the WATER, drawn by the water's own shader and owing
   * agreement with the numbers above it: its relief is spent against the same
   * normal as `waveHeight`, its foam lands in the same mix as `crestFoam`, and
   * its roughness is added to the same `resolved` the mirror's LOD reads. A
   * number that has to agree with `waveHeight` belongs beside `waveHeight`.
   *
   * `RotorWash` is what publishes the sites, because it is already asking each
   * machine the one question this needs — see `WaterSystem.setWash`.
   */
  wash: {
    /**
     * How many rotors may be working the water at once. The shipped maps field
     * one machine a side, so two is the real number and four is the headroom;
     * it is the uniform ARRAY's bound, interpolated into the shader as a
     * literal for the reason `waveTrains` is, so raising it recompiles.
     */
    sites: 4,
    /**
     * How far the disturbance runs out, as a multiple of the ring's own radius
     * — which is the disc's, so on the gunship's 5.7 m ring this is about 23 m
     * of bay. It is where the rings have died, not where they are strongest:
     * everything up to the ring is the hole and everything past it is the
     * wake.
     */
    reach: 3.5,
    /**
     * How much of the wind's own wave field is pressed OUT under the disc.
     *
     * Near 1 rather than 1: a rotor does not calm water, it atomises it, so
     * what goes away is the ordered swell and what replaces it is `blur` — the
     * ordered trains would otherwise go on rolling through a patch of water
     * that is visibly being shredded, which is the tell that the two effects
     * are drawn by different things.
     */
    flatten: 0.8,
    /**
     * Roughness added to the mirror inside the disc, in the same units the
     * wave field's unresolved half is measured in (`1 - resolved`, mip levels
     * through `mirrorBlur`).
     *
     * **This is what actually reads as a hole in the water**, and it is the
     * term to reach for before any of the others. A water surface is mostly
     * its reflection, so the fastest way to say "this is not a mirror any
     * more" is to blur what it returns — and it is physically the same
     * sentence the wave field makes, that ripples too fine to draw are
     * roughness.
     */
    blur: 0.6,
    /**
     * Whitewater across the disc, into the same mix as the shoreline foam and
     * the whitecaps — so it is modulated by the same drifting mask rather than
     * laid on as a flat disc, which is the difference between froth and a
     * white circle painted on the bay.
     */
    foam: 0.85,
    /**
     * The rings running out from the rim: relief (m), wavelength (m) and the
     * speed they travel at (m/s) — deliberately the same three numbers a wave
     * train states above, because that is what this is.
     *
     * **The number that matters is the SLOPE, and it is amplitude over
     * wavelength rather than either one.** These two were first fitted on a
     * night map, where a mirror returns a dark sky and almost nothing shows —
     * 0.09 m over 2.2 m, which is four times the steepest thing the wind's own
     * field produces. On Sarab in daylight that rendered as a set of hard
     * white arcs: the crests were tipped far enough to catch `specStrength`
     * through its own `smoothstep`, so what a viewer read was a stencil of
     * rings rather than water moving. **Judge these on a BRIGHT map**, where
     * the glint and the mirror are both live; a night harbour cannot fail this
     * test.
     *
     * The relief must also stay inside `waveHeight`'s own bound and for its
     * reason: this surface has no vertex displacement, so past about a quarter
     * of a metre of implied relief the slope aims the reflected ray under the
     * horizon and the water returns the ground behind the player. What buys
     * the effect is not amplitude anyway — it is that these rings are
     * CONCENTRIC, the one shape nothing else on the surface has, since every
     * train in the field is directional.
     */
    height: 0.085,
    length: 3.4,
    speed: 4.5,
  },
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
