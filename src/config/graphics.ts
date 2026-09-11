/**
 * config/graphics.ts — the render pipeline's knobs, and the pooled effects.
 * Owns: glow, outlines, shadows, fog, block visibility and the post chain,
 * plus tracer/spark pool sizes. Contract: `docs/rendering.md`.
 * Gotcha: several values here look like bugs if you 'fix' them — image
 * processing off, rendering group 1, the shadow window. Read the contract.
 */

export const graphics = {
  /**
   * The render-scale ladder, as a fraction of the display's NATIVE pixels —
   * `engine.setHardwareScalingLevel(1 / (devicePixelRatio * scale))`.
   *
   * Native rather than CSS pixels because CSS pixels are not a resolution: on a
   * 2x panel one CSS pixel is four real ones, so a ladder in CSS terms means
   * something different on every machine. This one means the same thing
   * everywhere, and 1.0 is exactly "as sharp as the panel goes".
   *
   * **Nothing above 1.0, deliberately.** Supersampling four chained full-screen
   * passes plus a 2048-squared depth map is not a quality setting, it is a
   * different game — and `FINDINGS.md` §1 already has a 1% low of 28 on a 60 Hz
   * panel to spend before anyone reaches for headroom.
   *
   * The DEFAULT is not on this list: it is derived per machine by
   * `defaultRenderScale` in `core/settings.ts`, so a fresh install draws exactly
   * the pixels this game has always drawn and the player opts up from there.
   *
   * **Two numbers in this file are stated against the frame and not against the
   * backing store, and both convert through the scaling level this sets**:
   * `glowKernel` and `culling.minPixels`. Both shipped as constants in
   * backing-store pixels, which made each of them a different number on every
   * rung — a bloom twice as wide at 0.5, and a size gate at twice the
   * threshold. A rung ADDED here is only honest while that stays true, which
   * is the first thing to check if this list ever grows one.
   */
  renderScales: [0.5, 0.75, 1] as const,
  /** Emissive glow (neon, reticle, tracers) — GlowLayer settings. */
  glowIntensity: 1.15,
  /**
   * The blur's width, stated against the FRAME — NOT the number handed to the
   * layer. `GlowDepth.glowKernelTexels` converts it, because the layer's kernel
   * is in texels of a main texture that is the backing store, and the backing
   * store is what `renderScales` above moves. Judged by eye at a scaling level
   * of 1, which is what every default install runs at; stating it in that unit
   * is what stops a rung changing the size of the bloom.
   */
  glowKernel: 56,
  /** Horror grade post-process (vignette / grain / chromatic aberration). */
  vignette: 0.62,
  grain: 0.055,
  aberration: 0.55,
  /** Peak red edge flash when the player is hit, and how fast it decays. */
  damageFlash: 1.0,
  damageFlashDecay: 2.6,
  /**
   * Motion blur on the look. A rotation reprojects identically at every
   * distance, so this needs no depth buffer and no second pass over the
   * scene — and equally, translation (strafing past a wall) does not blur.
   */
  motionBlur: {
    /**
     * Fraction of the frame's rotation to smear across — how long the
     * shutter is open. 1 covers the whole frame (a 360-degree shutter,
     * more than a real camera); film convention is nearer 0.5. This sits
     * well under that on purpose: the blur should register as weight
     * behind a whip pan and stay unnoticed on an ordinary look around,
     * which is most of what a round is. 0 disables the pass, at which
     * point the shader is a straight copy.
     *
     * Measured: smear length is exactly linear in speed x strength, so
     * halving this is identical to halving the pan rate.
     */
    strength: 0.3,
    /** Taps along the smear, the sharp one included. Must be at least 2. */
    samples: 10,
    /**
     * Longest smear, as a fraction of the frame. This is a safety cap, not
     * a look: one dropped frame arrives as a single huge rotation, and
     * headless captures run slow enough to smear the screen flat without
     * it. It bites at a pan rate inversely proportional to `strength` —
     * roughly 550 deg/s at the value above — so ordinary play never
     * reaches it and a hitch saturates instead of exploding.
     */
    maxShift: 0.04,
    /** Rotation in one frame (radians) below which the pass is skipped. */
    minRotation: 0.0015,
    /**
     * THE WEAPON, IN METRES: held sharp inside `nearSharp`, smearing with
     * the world by `nearFull`. The viewmodel is fixed in screen space and
     * must not smear with the world behind it, and depth is what names it —
     * `ink.near`'s argument spent a second time. Measured, hip pose, every
     * gun in the kit: the viewmodel occupies 0.05 m to 1.39 m of the lens
     * (the sniper's muzzle is the deepest), so the sharp side has to clear
     * 1.4 or a whip pan smears the front half of the barrel and not the
     * back. What the band costs is that world geometry inside `nearFull`
     * stays sharp too — a wall being hugged, a floor at a crouch — which is
     * the trade a pass with no velocity buffer has to make somewhere, and
     * the far cheaper half of it to be wrong about.
     */
    nearSharp: 1.5,
    nearFull: 2.4,
    /**
     * Radial falloff, sharp at the middle of the screen and full past the
     * outer edge. It is about the EYE alone now: it tracks where the eye is
     * pointed, so that is where a smear is read AS a smear rather than felt
     * as speed, and it is the second subtlety lever after `strength`.
     *
     * **It used to be the weapon's mask as well, and at that job it was
     * backwards** — the gun sits low and RIGHT, which is where a radial mask
     * blurs hardest, so the most smeared thing in the frame was the one thing
     * that never moves in it. The core it bought was spent on the middle
     * distance instead, where the smear is the whole effect. The band above
     * took that job, so this is a good deal narrower than the 0.35/0.85 it
     * was; those two numbers are the revert if a smaller frame is wanted.
     */
    maskInner: 0.2,
    maskOuter: 0.75,
  },
  /**
   * Volumetric moonlight: a raymarch through the shadow volume, in air, against
   * the depth the frame has already written. It is the game's ONLY light-shaft
   * effect — it replaced `GodRays`, a screen-space radial blur, and that pass
   * is gone rather than kept as a low rung. `docs/rendering.md` has why one
   * mechanism rather than two, and `Volumetrics.ts` the shader.
   *
   * **The rungs are SAMPLE COUNTS and deliberately not resolutions.** A
   * `PostProcess` with a `size` under 1 renders the chain's whole image into a
   * smaller target and the next pass reads THAT — so a half-res march is a
   * half-res frame, not a half-res effect. Scaling the march resolution is a
   * second, structural change (march into a target of its own, then a
   * bilateral upsample against depth); measured, the taps are not what this
   * costs, so it has not been worth the plumbing.
   *
   * **MEASURED against the pass it replaced**, `?gpu`, 1920x1080, headless
   * uncapped, three interleaved passes of 8 s, camera on the moon so both are
   * at their most expensive. GPU `frame`, against the shafts' own 32 taps:
   * Hollowmere **-0.036 / -0.010 / +0.233 ms** at low/medium/high, Cinderhaven
   * **-0.033 / -0.019 / +0.070**. CPU `tick` did not move on either map in
   * either direction — the march builds nothing and walks nothing, and every
   * input it reads was already computed for something else.
   *
   * **What that comparison does NOT say is that it is free over a ROUND.** The
   * shafts were detached whenever the moon was off screen, which is most of a
   * fight; this is attached always, because a shaft it can draw with the moon
   * behind you is the whole reason it exists. Read the rows above as the
   * worst case of each and the average as roughly the whole pass — ~0.75 ms of
   * GPU, on a frame this game leaves ~75% idle.
   */
  volumetrics: {
    /**
     * Taps along each ray, per rung. The player's setting is `off` plus these
     * three, and `off` is absence rather than zero: the pass is detached, so it
     * costs no read and no write of the frame — the same rule `MotionBlur` and
     * `HorrorPost` are turned off by.
     *
     * The ladder is declared HERE and exactly once: `Settings.volumetrics`
     * derives its union from these keys and `Volumetrics.ts` derives its own,
     * so neither can offer a rung the other has never heard of.
     */
    rungs: { low: 8, medium: 16, high: 32 } as const,
    /**
     * How far the march goes, as a fraction of the shadow window's HALF side.
     *
     * The window is a square centred on the player, so from the eye there is
     * only ever `frustumSize / 2` of shadow information in any direction — 55 m
     * on the default 110 m window. Past that `shadowAt` answers "lit", exactly
     * as `celShadow` does, and the haze goes smooth: the beams stop but the
     * air does not, which is the honest failure and not a wall. Held just
     * inside the boundary so the ramp is reached before the information runs
     * out.
     */
    reachFraction: 0.92,
    /**
     * Scattering per metre of lit air, at the height the haze is thickest.
     * This is the number that says how thick the night is; everything else
     * shapes it.
     */
    density: 0.02,
    /**
     * How fast the haze thins going up, per metre above `heightBase`. A
     * ground mist at 0 would put beams only in the street; this is shallow
     * enough that a shaft between two roofs still reads.
     */
    heightFalloff: 0.06,
    /** World Y the falloff is measured from — the valley floor, near enough. */
    heightBase: 0,
    /**
     * Henyey-Greenstein g: how forward-scattering the air is, 0 isotropic and
     * 1 a perfect forward lobe. It is what makes the effect strong looking
     * toward the moon and present-but-quiet looking away from it, which is the
     * whole thing a screen-space smear cannot do.
     *
     * **It is held well below what real haze measures, and the constraint is
     * the 8-BIT CHAIN rather than the air.** `DefaultRenderingPipeline` is
     * built with `hdr = false` (see `Dither.ts`), so whatever the forward lobe
     * returns has to fit in the same 0..1 the village is drawn in — there is no
     * tonemapper downstream to pull a highlight back. Measured off the phase
     * function: g 0.68 is **54x** brighter looking into the moon than across
     * it, which is either a white screen forward or nothing at all sideways,
     * and there is no exposure that is both. 0.55 is 16x, which an LDR frame
     * can hold at both ends. Raising it is what an HDR chain would buy.
     */
    anisotropy: 0.55,
    /**
     * Final scale on the accumulated scattering. The phase function carries
     * its own `1 / 4pi`, so this absorbs that — read it as a look knob and not
     * as a physical quantity.
     *
     * Set against the ALL-LIT ceiling, which is the worst case the shader can
     * produce: every tap unshadowed at ground level over the full reach. On the
     * shipped numbers that ceiling is 0.46 added looking into the moon and
     * 0.028 across it, so a fully lit street has headroom left and the shadowed
     * frame that is actually drawn sits well under.
     */
    intensity: 0.75,
  },
  /**
   * Hard-edged directional shadows from the key light (the moon), plus a
   * soft contact blob under every combatant. The shadow camera follows the
   * player inside a fixed ortho window — the fog wall at 78 m hides the
   * edge of the coverage.
   */
  shadows: {
    /** Shadow map resolution (square). 110 m / 2048 ≈ 5.4 cm texels. */
    mapSize: 2048,
    /** Width/height of the light's fixed ortho window, in metres. */
    frustumSize: 110,
    /** Light camera distance behind the focus, along the light direction. */
    distance: 90,
    /** Depth range of the ortho volume — must span valley floor to roofs. */
    depthRange: 180,
    /** Fraction of the key light that survives inside shadow. */
    darkness: 0.15,
    /**
     * How much of the shadow volume is spent RAMPING back to fully lit at its
     * own boundary, as a fraction of the window's side.
     *
     * **The window has a hard edge and this is the only thing that softens
     * it.** `shadowVisibility` returns 1.0 outside the volume, so without a
     * ramp what a player sees on open ground is a straight line sliding along
     * with them — the whole reason five maps state a `shadowWindow` at all,
     * and the reason two of them were authored to within a couple of metres of
     * a ceiling neither file names. The ramp does not move the boundary; it
     * makes the last few metres of it a gradient the eye reads as haze rather
     * than as an edge.
     *
     * **It is a FRACTION and not metres, because the boundary is only ever
     * seen from the middle of the volume.** A 110 m window puts its edge 55 m
     * away and a 240 m one puts it 120 m away, and a band that subtends the
     * same angle at both is the one that disappears at both. 0.1 is 24 m on
     * Sarab's 240 and 11 m on Hollowmere's 110.
     *
     * **0.1 rather than more, because the ramp is paid for in shadow that is
     * no longer drawn.** The cubic leaves a receiver at 100 m of Sarab's 120 m
     * reach at 93% strength, so what is given up is the outer fifth of the
     * volume and nothing a player is fighting in. A wider band hides the
     * transition better and washes the mid-field out with it.
     *
     * **The floor is 1e-4 and not 0** — the shader interpolates this into a
     * `smoothstep` whose two edges may not be equal — so setting this to 0
     * reads as a band 2.4 cm wide, which is the old hard line back again.
     */
    edgeFade: 0.1,
    /**
     * Consumer-side depth bias and facet-normal offset (metres). The
     * faceted shader shades whole triangles at once, so the offset pushes
     * each triangle's sample off its own plane — flat faces never
     * self-shadow (acne) and cast shadows stay put.
     */
    bias: 0.0035,
    normalBias: 0.06,
    /**
     * Half-width of the shadow lookup's four-tap kernel, in shadow-map texels.
     *
     * **0.5 is one texel of support, and one texel is the artefact.** A single
     * tap put the depth map's own grid on screen — at 110 m over 2048 texels an
     * edge climbs in 5.4 cm steps — and a staircase with a one-texel period is
     * cancelled by a kernel that spans exactly one texel. Going wider does not
     * clean it up further; it starts producing a genuine penumbra, which is the
     * one thing `CelShader`'s flat bands cannot have. Treat this as a constant
     * with an argument attached rather than as a dial.
     *
     * **Measured as a containment check rather than as a win**, which is the
     * honest way round for this one. Setting the map size to 1e9 collapses the
     * radius to zero and makes all four taps the same fetch — exactly the old
     * single-tap lookup — so differencing the two frames isolates every pixel
     * the kernel touches. Over the village from above: **0.33% of the frame
     * differs, with a peak of 55/255 on the pixels that do.** A large local
     * change on a third of one percent of the frame is the shape a kernel
     * confined to shadow BOUNDARIES has; a penumbra would have shown up as a
     * small change over a large area, and did not.
     *
     * `bias` above went 0.0025 -> 0.0035 with it: a half-texel wider footprint
     * is a half-texel more depth error on a sloped receiver, and the roofs are
     * where that shows.
     */
    pcfRadiusTexels: 0.5,
    /**
     * Soft contact disc under each combatant — and with `bodyShadows` below it
     * is the CONTACT term rather than the whole shadow.
     *
     * **It is deliberately not suppressed where a cast shadow covers the same
     * body**, which reads as double-shading only if you expect a shadow map to
     * be able to draw a contact. It cannot: the body map renders BACK FACES
     * (`forceBackFacesOnly`), so what it records is the far side of each
     * proxy box and the ground between a boot's front and back faces tests as
     * lit — a gap of a few centimetres exactly where the eye looks for the
     * body to be touching the floor. The disc fills it, which is the job it
     * was already doing, and the pair is what a renderer normally spends an
     * ambient-occlusion term and a shadow map on.
     */
    blobRadius: 0.6,
    blobOpacity: 0.55,
  },
  /**
   * The bodies' OWN shadow map: a second depth pass carrying nothing but
   * soldiers and hulls, re-rendered every frame, sampled by the surfaces
   * (`celShadow`) and by the volumetric march (`Volumetrics`) alongside the
   * static world's.
   *
   * **IT IS A SECOND MAP RATHER THAN MORE CASTERS IN THE FIRST ONE, and that
   * is the whole design.** `shadows` above re-renders only when its
   * texel-snapped focus MOVES, which is what makes ~150 static casters
   * affordable at all; an animated caster in that list turns it into a
   * per-frame redraw of the whole village. A map of its own pays for the
   * bodies and for nothing else, and it buys two things beside: its window is
   * sized to the BODIES rather than to the map, so it is finer than the world's
   * at a quarter of the resolution, and it can cull front faces without the
   * world having to.
   *
   * **ONE DRAW CALL carries every body in the game.** The proxies are thin
   * instances of a single unit box, so a soldier is ten instances
   * (`RAGDOLL_BONES`) and a hull is one, and the whole pass is one draw
   * whatever the roster. See `systems/BodyShadows.ts`.
   */
  bodyShadows: {
    /**
     * Shadow map resolution (square). A quarter of the world map's area for a
     * window less than half its side: 48 m / 1024 is **4.7 cm** texels against
     * the world's 5.4, so a body's shadow is drawn FINER than the wall it
     * falls on rather than coarser.
     */
    mapSize: 1024,
    /**
     * Side of the ortho window, in metres, centred on the same focus the world
     * shadows use.
     *
     * **It is sized to where a body's shadow is worth drawing and not to where
     * a body can be seen**, which are two very different distances: a shadow is
     * a contact cue, and at 24 m a soldier is 40-odd pixels tall and their
     * shadow is a smudge under them. Past the window `celShadow` answers lit
     * for this map exactly as it does for the world's, with the same
     * `edgeFade` ramp — so what a body loses at the boundary is its cast
     * shadow, and what it keeps is the contact disc.
     *
     * **Raising it costs texel density on the near bodies to buy a shadow
     * nobody is looking at**, which is the wrong way round for a 4.7 cm
     * budget. What it would buy is a FLYING hull's shadow: a gunship 40 m up
     * throws its shadow 150 m along a 14.5-degree sun, which no window a
     * client can afford is going to contain.
     */
    window: 48,
    /** Light camera distance behind the focus, along the light direction. */
    distance: 45,
    /**
     * Depth range of the ortho volume.
     *
     * It has to span the tallest thing that casts over the lowest thing that
     * receives, and along the SUN rather than vertically — the along-sun reach
     * on the ground is `2 * min(distance - 1, depthRange - distance) / cos(elevation)`,
     * which at 90/45 is 88 m at a high sun and 91 at Harrowmead's 14.5 degrees.
     * Both are past `window`, so this is not the bound on any shipped map.
     */
    depthRange: 90,
    /**
     * Depth bias, in normalised depth units — and it is smaller than the world
     * map's for a reason that is worth stating, because copying that number
     * over is the obvious thing to do and wrong.
     *
     * `shadows.bias` is 0.0035 over a 180 m volume, which is 63 cm of slop
     * along the light. It can afford that because the acne it exists to
     * prevent is a receiver testing against its OWN depth, and the facet-normal
     * offset does most of that work. **Nothing in this map is ever its own
     * receiver**: the casters are proxy boxes that are never drawn and the
     * receivers are the world and the bodies' visible meshes, so there is no
     * correlated depth error to hide. What is left to beat is half-float
     * quantisation (~5e-4 near the far plane) and the receiver's own normal
     * offset, and 0.0015 over a 90 m volume is 13.5 cm — under a boot rather
     * than under a body.
     */
    bias: 0.0015,
    /**
     * Half-width of the four-tap kernel, in texels of THIS map.
     *
     * The same 0.5 the world map uses and for the same reason — one texel of
     * support cancels a one-texel staircase — but it cannot be the same
     * NUMBER once it reaches the shader: the radius is in UV and a UV texel is
     * `1 / mapSize`, so the two maps have different radii and
     * `bodyShadowParams` carries its own.
     */
    pcfRadiusTexels: 0.5,
    /**
     * How many bodies may hold proxies in one frame.
     *
     * A budget rather than a count: Sarab and Cinderhaven field 24 a side, and
     * every one of them inside one 48 m window at once is a street fight that
     * has already stopped being about shadows. Bodies are taken NEAREST FIRST
     * to the window's focus, which is the same partial selection
     * `LightingSystem` spends its sixteen light slots with.
     */
    maxBodies: 24,
    /**
     * How many HULLS may hold proxies in one frame.
     *
     * A separate budget from `maxBodies` because it is a separate shape — one
     * instance rather than ten — and because the two run out for different
     * reasons: bodies are limited by the fight in front of you and hulls by how
     * many a map lays down at all, which is four on the most crowded of the
     * six. It exists to SIZE THE BUFFER rather than to ration anything.
     */
    maxHulls: 8,
    /**
     * Metres of slack added to a hull's collider box before it is used as a
     * proxy.
     *
     * The box is what a round is tested against and what a body may not stand
     * in, and it already encloses the turret on purpose — so as a shadow it is
     * a little generous rather than a little mean, and this is nearly zero for
     * that reason. What it is not zero for is the tracks: the collider's floor
     * is where the hull RESTS and a shadow that stops exactly there leaves a
     * bright line under the running gear on any ground that is not flat.
     */
    hullPad: 0.05,
  },
  /**
   * The ink, as a SCREEN-SPACE edge over the depth the frame has already
   * written — `shaders/CelInk.ts`, which owns the argument. It replaced an
   * inverted-hull outline pass (`renderOutline`) plus a per-merge-group ink
   * TWIN mesh, which between them drew a second copy of a large part of the
   * map every frame.
   */
  ink: {
    /**
     * How big a STEP in depth reads as a silhouette, as a fraction of the
     * distance to the pixel — dimensionless on purpose, so one doorway reads
     * the same at 5 m and at 50 and no map has to state its own number.
     */
    silhouette: 0.02,
    /**
     * How sharply the surface has to BEND to read as a crease, on the same
     * scale-free footing. This is the term that catches a box corner, where
     * depth is continuous and only its slope jumps, and it is why no normal
     * buffer is needed: under a perspective projection 1/z is linear in screen
     * space across any plane, so the centre against what its neighbours
     * predict is exactly zero on a flat surface at any angle — a floor seen
     * edge-on included — and large at a corner.
     */
    crease: 0.06,
    /**
     * What an inked pixel keeps of the colour it had, per channel.
     *
     * **The hull's `tintFactor` was a CEILING with a per-map derivation under
     * it (`shadeHeadroom`, `inkState`) and this needs neither, which is the
     * one simplification the mechanism buys outright.** All of that existed
     * because the hull's ink was UNLIT: a fraction of the albedo drawn with no
     * light term, laid over a surface that had one, so it inverted into a
     * bright halo the moment the surface was darker than the ink, and the
     * working value had to be derived from the darkest light each map could
     * put on any pixel. A screen-space line multiplies the pixel that is
     * ALREADY THERE, lit, shadowed, fogged and weathered, so it is under the
     * light term as a matter of arithmetic and cannot invert whatever the map
     * does. It is a constant again.
     */
    tint: 0.32,
    /**
     * THE NIB: how WIDE the stroke is, in texels, as a function of how far away
     * the pixel is — `eye` at the lens, `bold` at `from` metres, `fine` by
     * `to`, stated at `rows` rows of screen and scaled with the frame's own.
     *
     * **A line of one texel everywhere is the one thing a pen never draws.** It
     * gives the palm grove at 300 m exactly the weight of the crate at 5, so a
     * dense frame arrives with no hierarchy in it and `fadeBand` is left doing
     * alone what a draughtsman does with the nib. Darkness and weight are not
     * one reading — a thin black line comes forward and a thick pale one does
     * not — which is why this exists beside the fade rather than instead of it.
     *
     * **The curve has TWO SIDES because the near end is the viewmodel's**, and
     * it is the same argument `near` below makes about DARKNESS, spent on
     * width: at arm's length the parts are smaller than the pen and a full nib
     * on a trigger guard is a smudge. Everything between is the near field,
     * drawn boldest, and everything past `to` gets the fine nib.
     *
     * `to` is an absolute distance rather than a share of the map's fog band on
     * purpose: what the taper is about is the near FIELD, and tying it to the
     * band would leave Sarab's foreground bold for two hundred metres and
     * Hollowmere's fine at forty. The pass clamps the nib at 3 texels, which is
     * the reach of the two rings it samples.
     */
    width: { eye: 0.85, bold: 2.3, fine: 0.85, from: 7, to: 90, rows: 1080 },
    /**
     * What a CREASE is worth against a contour — its darkness and its width, as
     * fractions.
     *
     * The pass measures the two separately (a depth STEP against a depth BEND)
     * and used to spend them identically, which is what a machine does and not
     * what a draughtsman does: the outer contour is laid down first and
     * heaviest and the interior detail is drawn finer and lighter under it.
     * Splitting them is what gives a frame its read — and it is free, because
     * both numbers were already in hand.
     */
    creaseStroke: { weight: 0.6, width: 0.5 },
    /**
     * What the FAINTEST line keeps of a strong one's darkness.
     *
     * A threshold answers yes or no, and a pen does not: a stroke the geometry
     * only just asks for should be lighter than one it shouts. The pass ramps
     * from this to 1 over a band wide enough (the threshold to five times it)
     * that the variation runs ALONG a stroke rather than sitting at its ends.
     * At 1 the ink is uniform, which is where it was.
     */
    pressure: 0.62,
    /**
     * The WOBBLE: how far the edge lookup is displaced, in texels, and at what
     * screen frequency.
     *
     * A perfectly straight line is the clearest single tell of a machine, so
     * the whole sample cross is nudged by a two-octave field before it is read
     * — the stroke meanders instead of the sampling breaking up. **It is
     * anchored in SCREEN space**, which is a compromise rather than an
     * oversight: a surface-anchored field wants the world position
     * reconstructed per pixel and would swim over every bot that walks anyway.
     * Under a texel and at this frequency it reads as a line that wavers;
     * turning either number up finds the shower door quickly. Zero switches it
     * off and costs nothing worth measuring.
     */
    wobble: { amount: 0.4, scale: 0.03 },
    /**
     * The NEAR BAND: how much of the ink a pixel this close keeps, and how far
     * out that holds.
     *
     * **This is the viewmodel's, and it is a distance rather than a flag
     * because the weapon is the only thing that can BE this close.** The gun
     * sits 0.3-0.5 m from the lens and a body cannot get within about 0.4 m of
     * world geometry, so a depth band names it without any per-mesh data — the
     * one place `FINDINGS.md` 18 said an ink-id attachment would be needed and
     * it is not. It replaces the hand-set 0.004 m hull the weapon used to wear,
     * which existed for the same reason: a full-weight line on parts this small
     * swallows the whole weapon in black. `scale` is what the ink is multiplied
     * by AT the eye, ramping to 1 by `until` metres.
     */
    near: { until: 1.4, scale: 0.3 },
    /**
     * How bright the EMISSIVE buffer has to be under a pixel before the ink
     * gives way, and how far above that it has given way completely.
     *
     * **This is what `noInk` used to buy and the flag no longer can.** Every
     * emissive part — eyes, flames, signs, lit windows, tracers, the holo
     * reticle — was excluded from the hull, and an inked emissive is swallowed
     * glow. The mask is `glow.mainTexture`, which `GlowDepth` already made FULL
     * RESOLUTION and emissive-only, so it costs one texture read and no pass:
     * it is the emissive geometry alone, drawn sharp (the blur writes to its own
     * targets, not back into this one) and already depth-tested against the
     * frame, so a lamp behind a wall does not protect the wall in front of it.
     */
    emissiveMask: { from: 0.12, to: 0.4 },
  },
  /**
   * Toon specular: one hard two-band Blinn highlight from the key light,
   * gated by the same stepped shadow as the diffuse term. Only surfaces
   * listed here carry it — everything else stays matte, which is most of
   * the point: a highlight reads as special when metal and wet stone are
   * the only things that shine.
   */
  spec: {
    /**
     * Rifle metal (rails, fittings, crown): tight cold glint off the
     * moon. High shininess keeps it a pinpoint on small parts.
     */
    rifle: { color: "#aecbf2", intensity: 0.6, shininess: 32 },
    /**
     * The same fittings under a finish that has been rubbed back: broad,
     * dim, and spread far enough that it reads as a sheen on a surface
     * rather than as a point of light on an edge. What a satin lacquer, a
     * parkerised grey or a dulled bronze wears.
     *
     * The three weapon-finish entries here are a LADDER — matte (no spec at
     * all), `rifleSatin`, `rifle`, `rifleChrome` — and that is the whole of
     * the vocabulary `entities/finishes.ts` paints in. Adding a fourth rung
     * is fine; giving one finish a spec of its own is what is not, because
     * the point of a ladder is that two finishes claiming the same gloss
     * genuinely have it.
     */
    rifleSatin: { color: "#b7c2d2", intensity: 0.28, shininess: 12 },
    /**
     * Plating: bright, tight and near-white, for a surface that is a
     * MIRROR rather than a metal — chrome, gold plate, a black lacquer
     * polished until it behaves like one. The intensity is what separates
     * it from `rifle` at a glance; the shininess keeps the highlight a
     * hard-edged streak instead of a wash across a receiver.
     */
    rifleChrome: {
      color: "#eaf1ff",
      intensity: 0.95,
      shininess: 44,
      /**
       * And the rung is the only one that is not a highlight at all: a
       * MIRROR, which hands back the room rather than a point of light in it.
       *
       * A Blinn lobe is constant across a flat facet, so on a weapon built
       * out of a dozen boxes the three rungs below can only ever light a
       * whole face or none of it — which is why the intensity alone never
       * made this read as plating and why the gold finish came out as tan
       * paint. What separates chrome from steel is that every facet returns a
       * DIFFERENT part of the sky, and that is what this number buys: how
       * much of the environment the surface hands back face-on, with Schlick
       * taking it to all of it at a graze. It is the one spec entry the
       * shader's mirror block runs for, and the one surface in the game that
       * catches the POINT lights.
       *
       * 0.62 rather than 1: a plate that returns the whole sky face-on stops
       * carrying its own colour, and sixteen finishes at the top rung would
       * be one mirror wearing sixteen names. What is left of the albedo is
       * what keeps gold plate gold.
       */
      mirror: 0.62,
    },
    /**
     * Wet cobblestone streets: broad, dim grazing sheen, so the road
     * catches a streak when you look toward the moon — the "rained an
     * hour ago" read. Low shininess spreads it across the street.
     *
     * Intensity is tied to how high the moon sits: the lower it is, the
     * closer the half-vector comes to the street's own normal when you look
     * along it, so the same number that read as a streak under a 59-degree
     * moon turned the whole road into the brightest thing in the frame at
     * 38 degrees. If the key light's elevation changes, re-check this.
     */
    cobble: { color: "#5f7ba6", intensity: 0.18, shininess: 8 },
  },
  /**
   * Translucency: the key light coming THROUGH a thin surface rather than
   * off it, banded and gated by the same stepped shadow as the diffuse.
   * Same opt-in shape as `spec` above and the same restraint — the term
   * only reads as transmission while almost nothing in the frame carries
   * it, and only where a surface genuinely is thin enough to.
   *
   * It fires when the eye comes round to look INTO the moon through the
   * surface, so these are judged from under an awning or beneath a tree
   * with the moon beyond it, never from the lit side. The colour is what
   * the light arrives as after passing through and is NOT multiplied by
   * the surface's albedo, so both of these are far paler than the material
   * they sit on.
   */
  translucency: {
    /**
     * Market-stall canvas: pale, slightly warmed by the cloth, and the
     * brightest of the two because an awning is a single thin sheet.
     */
    awning: { color: "#c3cbd6", intensity: 0.5 },
    /**
     * Pine needles: cold green, and dimmer — a crown is many layers deep,
     * so what comes through it is what got past all of them.
     */
    foliage: { color: "#61906f", intensity: 0.3 },
    /**
     * Jungle canopy: warmer, yellower and brighter than the pine's. A frond
     * is one broad blade rather than a crown many needles deep, so far more
     * gets through it — and what gets through a leaf that size arrives
     * carrying the leaf's own colour rather than merely dimmed.
     */
    canopy: { color: "#8fb567", intensity: 0.45 },
  },
  /**
   * Glazing: what a pane of glass returns and what it lets past. One entry,
   * unlike `spec` and `translucency` above, because glass is one material —
   * a shopfront and a curtain wall differ in colour and not in behaviour, and
   * the colour is the builder's (`Build.pane`).
   *
   * These are judged from a STREET and not from a screenshot of one pane: the
   * whole point of the pair is that the same glass reads differently at the
   * two ends of a block, so a value tuned face-on turns a tower into a mirror
   * and one tuned along the street leaves a shopfront blank.
   */
  glass: {
    /**
     * What a pane returns face-on. Above glass's real 0.04-0.08 — see
     * `GlassSpec` — and raised again when the reflection stopped being a bare
     * sky gradient and became a picture of the city: 0.28 was picked against a
     * flat wash, where more of it only made a shopfront paler, and the same
     * number over a reflection with buildings in it under-reads.
     *
     * It is not free, and what it costs is stated in `GlassSpec.tint`: what
     * shows THROUGH a pane face-on is `1 - (this + tint * (1 - this))`, so this
     * and the tint spend the same budget. 0.28 left 43% of a lit interior
     * legible from the pavement and 0.36 leaves 38%, which is the most this may
     * take without the tint being reconsidered beside it.
     */
    reflectance: 0.36,
    /** Schlick's is 5; 3 brings the sheen on while you are still square-on. */
    falloff: 3,
    /** ~21 degrees of sun halo. Broad because the sky draws no disc. */
    halo: 0.93,
    /**
     * How dark the glass is. 0.4 leaves a lit office interior legible from the
     * pavement, which is the number's real job — see `GlassSpec.tint` on why
     * a pane the player cannot see through is a fairness problem and not only
     * a look.
     */
    tint: 0.4,
  },
  /**
   * How much of the map the frame's own mesh walk is offered — `WorldCulling`,
   * and `ENGINE_UPGRADE.md` wall 1.
   *
   * **Every number here is a MARGIN and none of them is the reach.** The reach
   * is the map's own `fogEnd`, because that is the distance past which a
   * surface draws exactly `fogColor` and dropping it cannot move a pixel; these
   * three only decide how much slack is carried around it so the answer is
   * never late and never thrashes. A map that states a `fogEnd` past its own
   * diagonal — which the proving ground does deliberately — culls nothing
   * whatever these say.
   */
  culling: {
    /**
     * How far the camera travels between re-evaluations, metres. Carried ON
     * TOP of the reach, so a block that comes inside the fog wall between two
     * evaluations was already admitted at the last one.
     */
    step: 3,
    /**
     * Slack past the fog wall, metres. Half a merge block: a cell's distance is
     * measured to its own bounds, which are already the tight ones, and this is
     * for the gap between "draws pure fog" and "is provably behind something
     * else that does".
     */
    pad: 24,
    /**
     * How much further than the `on` distance a block must be before it goes
     * out again, metres. Pure thrash control — without it a camera standing on
     * a boundary rebuilds the candidate list on every step it takes.
     */
    hysteresis: 12,
    /**
     * The smallest a mesh may draw before it stops being offered at all:
     * its bounding sphere's projected DIAMETER, in pixels.
     *
     * **It is a size on the SCREEN rather than a distance in the world**, so
     * one number is right at every resolution and every field of view — and it
     * tightens by itself when a sight goes up, because narrowing the FOV is
     * what makes a far thing bigger.
     *
     * **What it is for is detail with no LOD of its own.** A helicopter's
     * antenna is 16 cm and its gun ring 14 cm, and both were being drawn at
     * 880 m on Cinderhaven, where they are half a pixel: vehicles have no
     * distance tier at all, unlike a body, which `bodyDrawDistance` already
     * takes off whole. Measured at 3440x1440 it is worth **0.49 ms a frame at
     * 2 px and 0.94 ms at 3** (`FINDINGS.md` 39).
     *
     * **Two classes are exempt and both are exempt for a reason a screenshot
     * shows** — see `WorldCulling.offer`: a POOLED BODY, because a rig is many
     * meshes and dropping them one at a time decapitates a soldier rather than
     * removing him; and anything EMISSIVE, because bloom makes a sub-pixel
     * emitter visible far past its own size and this game has a night map full
     * of lit windows.
     *
     * **CSS pixels of the frame, not of the backing store** — `offer` scales by
     * the engine's own hardware-scaling level to get there. Stated the other
     * way this number means something different on every rung of
     * `renderScales`: at 0.5 it drops everything under 6 CSS px, which is twice
     * the tuning above and pops a hull in at half the range it was measured at.
     *
     * 0 disables it.
     */
    minPixels: 3,
  },
  /**
   * The cubes behind the glazing: what `ReflectionSystem` bakes per map
   * install, and what the shader mixes over the sky gradient inside it.
   *
   * There is one per GLAZED BLOCK rather than one for the map, and that count
   * is the whole design — see the system for the argument. Both numbers here
   * are judged from a street with a tower on either side of it, never square
   * on to one pane.
   */
  reflection: {
    /**
     * Face resolution, and it is a PER-PROBE cost now that there is a probe
     * per glazed block: 6 x 128 x 128 of RGBA8 plus its mip chain is ~520 KB,
     * so Coldharbour's 37 come to ~19 MB held for the process.
     *
     * 128 rather than the 256 the single map-wide cube could afford, and the
     * trade is the right way round: a reflection that is Fresnel-weighted,
     * tinted and hazed cannot show the detail 256 buys, while WHERE it is
     * baked from decides whether the building opposite is in it at all.
     * Resolution is also not what the bake costs — 37 probes are 222 face
     * renders of ~325 merged meshes, and that is draw calls rather than
     * pixels.
     */
    size: 128,
    /**
     * How much of the bake a pane returns, against the analytic sky it would
     * otherwise show there. Deliberately short of 1: a probe stands at the
     * centre of the glass it serves rather than at the pane, so the last tenth
     * is what turns a plausible reflection into one a player can catch out by
     * walking along a frontage. It also keeps the sky's own haze in the mix,
     * which is what a reflection at these distances would have anyway.
     */
    strength: 0.9,
    /**
     * How far a probe's bake reaches, in metres, measured to the near side of
     * a mesh's bounding sphere.
     *
     * **The bake is `probes x 6 faces x render list`, and this is the only
     * term that is the MAP's rather than the glazing's.** A probe standing in
     * a street does not need the far side of a 1500 m map in its cube: what a
     * pane in a city actually shows is the building opposite, and a merged
     * block a kilometre away contributes a few pixels of haze at the cost of a
     * draw call in every one of six faces.
     *
     * **800 m is past the diagonal of every map in the tree**, so nothing that
     * ships is culled by it and the shipped bakes are unchanged — it is a
     * ceiling on a map bigger than the game has ever had rather than a tuning
     * knob on the ones it has. It is also comfortably past the longest sight
     * line any map declares (Harrowmead's `fogEnd` 520, Coldharbour's 480), so
     * on a FOGGED map of any size everything this drops was already being
     * drawn as flat fog colour.
     *
     * What it costs on a map with no fog is finding 10's objection: a culled
     * mesh does not fade, it vanishes, and the cube's alpha going to 0 is
     * where the shader puts sky. At 800 m, on a reflection that is
     * Fresnel-weighted and mixed at 0.9, that hole is at the horizon of a
     * picture of a street. The measurement to beat it with is in
     * `FINDINGS.md` 10: keeping every probe and halving the list scales the
     * bake almost linearly.
     *
     * The test is to the near side of the bounding SPHERE and not to the
     * centre, which is what keeps a landform in: a rim mesh has an enormous
     * radius and its centre is nowhere near anything.
     */
    radius: 800,
    /**
     * What the cube pool is allowed to hold, in MiB, and therefore how many
     * probes a map may have.
     *
     * **The probe count is the map's GLAZING rather than its size**, so it has
     * no natural ceiling: a generated 1500 m city block grid asks for 770,
     * which is 400 MB of cube texture held for the process on top of a heap
     * already 84% full (`FINDINGS.md` 19). Past this budget glazed blocks are
     * grouped in twos, then fours, then sixteens, until the count fits — a
     * probe then stands in one of the blocks it serves rather than in the only
     * one, which is the same approximation the feature already makes one size
     * up.
     *
     * 160 MiB at `size` 128 is 320 probes. Coldharbour asks for 40 and the
     * 900 m proving ground for 265, so **nothing in the tree today groups
     * anything** and this is a bounded worst case rather than a live lever.
     * It is stated as memory because memory is what it protects; the draw cost
     * of a probe is `drawsPerFrame`'s business.
     */
    poolBudgetMiB: 160,
    /**
     * How many face draws one FRAME of the bake may issue before the rest of
     * it waits for the next one.
     *
     * **A bake is a build step, and this is what stops it being one frame.**
     * Every probe is refresh-once, so before this they all landed on the frame
     * after the install: Coldharbour's 40 probes over 175 meshes each are
     * 41,934 draws and cost ~2.3 s in that one frame, and the 900 m proving
     * ground asks for **1,373,340**. At that point the frame does not merely
     * run long — the D3D12 device is LOST inside it on
     * `ID3D12Device::CreateDescriptorHeap` and Babylon's attempt to recreate
     * it fails too, at both extents S0 measured. That is a resource ceiling
     * reached inside one command submission, so a slower bake fails
     * identically and only a SMALLER one does not.
     *
     * **50,000 is just over Coldharbour's whole bake and that is the whole
     * derivation**: the largest thing that ships still completes on the frame
     * it always did, so no shipped map's glass moves and the banked reference
     * frames cannot either. The proving ground spends the same budget over ten
     * frames of ~2.8 s. Lower would be smoother and is what the Chromebook
     * wants (`VERIFYING.md`); it would also take Coldharbour off its one
     * frame, which is the property this number is chosen to keep.
     *
     * A probe costing more than the whole budget still goes, on a frame of its
     * own rather than never, and a frame already committed to re-baking a
     * probe whose meshes were not ready spends that against this first — see
     * `ReflectionSystem.releaseBatch`.
     */
    drawsPerFrame: 50_000,
    /**
     * How many frames the building card will wait WITHOUT the outstanding
     * probe count going down before it gives up and lets the rest of the bake
     * land in the round.
     *
     * **The frames the bake is spent over are the loading card's** — see
     * `Game.bakeWait`, and `ENGINE_UPGRADE.md` S0c, which is the step that
     * moved them there. `loading` is a STEP where nothing simulates and the
     * scene still renders, so it is the one place in the state machine those
     * frames can be spent without the player in them; what it costs is that
     * the card is up for as long as the bake takes, which at 1500 m is 47
     * frames — 44.8 seconds of them before `faceOf` cut the draws and 10.6
     * after.
     *
     * **This cap is a WEDGE detector and not a timeout**, which is why it
     * counts stalled frames rather than elapsed ones. A probe re-bakes in full
     * until every mesh in its list has a compiled material, so a material that
     * never compiles is a queue that never drains — and that is
     * indistinguishable from a slow machine by any wall clock. 120 frames is
     * long past the two or three a legitimate re-bake takes and short enough
     * that a wedge is a pause rather than a hang. The state machine has no
     * concept of a step that fails, so the way out is simply to stop waiting.
     */
    drainStallFrames: 120,
    /**
     * The backstop on that wait, in milliseconds, for the failure the stall
     * counter cannot see: a bake that keeps inching forward and never stops.
     * Nothing bounds that but the probe count, and at one probe a second a
     * pool of 320 is five minutes of building card.
     *
     * 90 s is twice the worst drain ever measured (44.8 s at 1500 / 0, before
     * the per-face cull; 10.6 after it), so it cannot fire on a machine
     * merely slower than the one that number was taken on. The four shipped
     * maps drain in one frame and are nowhere near it.
     */
    drainCapMs: 90_000,
  },
  /**
   * Albedo weathering on flat cel colours — a slow value drift over world space
   * so a merged block stops arriving as one tone. Costs three ALU and no data.
   */
  albedoVariation: {
    /**
     * Metres per noise cell. Wide on purpose: the artefact being fixed is a
     * 48 m block in a single value, so the variation has to be BIGGER than a
     * building or it reads as dirt on the wall rather than as one cottage being
     * a little paler than its neighbour. Under about 3 m it starts to look like
     * texture, which this palette has no way to support.
     */
    metersPerCell: 5,
    /**
     * Peak-to-peak swing on the base colour.
     *
     * The ceiling is set by the shading, not by taste: the key light is
     * quantised into four bands, so one band is ~25% of the value, and a
     * variation approaching that reads as a LIGHTING error — a wall that looks
     * like it is catching a light that is not there. Judge it on the shadowed
     * side, where the ambient term is the only light and this is the entire
     * signal. 0 disables it.
     *
     * Measured over the village from above: this moves 3.0% of the frame,
     * peaking at 36/255 — visible as one roof slope sitting a shade off its
     * neighbour, which is the whole intent. The mask was measured too, and it
     * is the half that could go wrong silently: with the viewmodel isolated to
     * its own 10,553 pixels and this swung from 0 to 2.0 — fourteen times the
     * shipped value — **not one of those pixels changed**. That is `vBaked.y`
     * reading the disabled attrib's 0 on anything the map did not bake.
     */
    amount: 0.14,
  },
  /**
   * The same weathering for a TEXTURED ground, and it is a separate entry
   * because it is answering a different question.
   *
   * On a flat colour the drift is fighting a 48 m block arriving in one tone.
   * On the valley floor it is fighting the TILE: a ground texture repeats every
   * few metres by construction, and the one thing a tile can never carry is
   * variation at a scale larger than itself — paint a damp patch into it and
   * the patch is what advertises the period. So the tile is authored with
   * nothing in it bigger than about a quarter of its width (see
   * `world/textures.ts`), and the big slow change of soil across a valley comes
   * from here instead, in world space, where it has no period at all.
   *
   * Hence the cell: three tiles wide against `dirt`'s 4 m repeat, so what it
   * adds cannot be mistaken for part of the pattern. And hence the swing, which
   * is wider than the flat colours' — a ground texture is already broken up by
   * its own grain, so it takes more before the eye reads a lighting error, and
   * the whole point is to be seen across open ground.
   */
  groundVariation: {
    metersPerCell: 12,
    amount: 0.2,
  },
  /**
   * Cobblestone bump: fake relief height (metres) of a sett dome at
   * height-map value 1.0. The light bands ripple across individual
   * stones; too high and the street reads as rubble.
   */
  cobbleBumpScale: 0.1,
  /**
   * The most slots the drifting mote field (`systems/Atmosphere.ts`) may
   * allocate — a **VRAM ceiling and NOTHING else**, never a target. What the
   * ash looks like (colour, size, drift, how much of it there is) is the
   * map's, because a valley of falling ash and a room full of rising embers
   * disagree about every one of those; that lives on `ParticleSpec` in
   * `world/environment.ts`.
   *
   * `Atmosphere` sizes the buffer to whichever spec is applied — `count / 3
   * * 14`, the slots a life can still be running in — and rebuilds the
   * system when a map asks for a different number, so this is spent only by
   * a map that would exceed it. Hollowmere asks for 4,000, so 18,667 slots
   * at a 21-float stride across two ping-pong buffers: 3.1 MB, against the
   * 5.4 MB a fixed 32,000-slot pool would stand at whatever the map wanted.
   * It bounds a `ParticleSpec.count` of about 6,800.
   *
   * **Hitting it costs density, not correctness.** `Atmosphere` shortens
   * mote lives to match the buffer it was allowed, which keeps the circular
   * recycle from cutting motes off mid-fade; the field ends up thinner and
   * shorter-drifting, and `warnIfCeilingClamped` says so with numbers in dev
   * builds. Raise this only for a map that genuinely wants denser air.
   *
   * The headroom is deliberately modest, because **count is the weaker of
   * the two levers on how dense the air looks and the only one that costs
   * anything.** Measured on the shipped map: raising `count` from 4,000 to
   * 16,000 — 18,667 slots to 74,667 — is not visible in a still at all,
   * because each mote is one to three pixels at street distance, while
   * frame time doubles. What makes the field read is `ParticleSpec.size`.
   * Anyone reaching for this number should raise that one instead.
   */
  particlePoolCeiling: 32000,
} as const;

export const effects = {
  /**
   * A tracer is a short streak that FLIES, not a beam drawn muzzle-to-impact.
   * Everyone is hitscan, so the damage has already happened by the time the
   * streak leaves the barrel — the flight is pure presentation, and these two
   * numbers are what stop a shot reading as a laser.
   *
   * `tracerLength` is the streak itself (metres of lit round). Long enough to
   * read as a direction at 60 m, short enough that it never joins the muzzle
   * to the target. `tracerSpeed` is well under a real 900 m/s round: at true
   * muzzle velocity a 120 m shot crosses in 0.13 s, which at 60 fps is eight
   * frames of a streak nobody can follow, so it degenerates back into the
   * beam it is meant to replace.
   */
  tracerLength: 6,
  tracerSpeed: 320,
  /**
   * Sized for a 16-bot firefight: everyone is hitscan, so a tracer is drawn
   * per shot from every combatant that fires — and now each one lives for its
   * whole flight (up to `weapon.range / tracerSpeed`, ~0.4 s) rather than a
   * fixed 0.07 s, so several times as many are in the air at once. An
   * exhausted pool steals the oldest slot, which shows as a streak vanishing
   * mid-flight.
   */
  tracerPoolSize: 96,
  sparkPoolSize: 48,
  /**
   * The dust disc a round kicks off a surface — the half of an impact the
   * spark cannot do, because a sphere has no orientation and the whole point
   * of a disc is that it lies on the face it was thrown from.
   *
   * Sized like the spark pool and for the same reason: everyone is hitscan,
   * so at the worst there is one impact per round from every combatant that
   * fired. It is smaller than `sparkPoolSize` because two of the three kinds
   * take a disc and only two take a spark, and shorter-lived than the spark's
   * 0.18 s would suggest is safe — see `discLife`.
   */
  discPoolSize: 40,
  /** Seconds a disc takes to open out and fade. */
  discLife: 0.22,
  /**
   * Metres the disc is lifted off the surface along its own normal. Not
   * cosmetic: a quad coplanar with the wall it was thrown from z-fights, and
   * a flickering impact reads as a broken decal rather than as dust.
   */
  discLift: 0.02,
} as const;
