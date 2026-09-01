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
   */
  renderScales: [0.5, 0.75, 1] as const,
  /** Emissive glow (neon, reticle, tracers) — GlowLayer settings. */
  glowIntensity: 1.15,
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
     * Radial falloff, sharp at the crosshair and full past the outer edge.
     * The viewmodel is fixed in screen space and must not smear with the
     * world behind it, and there is no depth in this pass to tell them
     * apart — so the centre of the frame, where the weapon sits and where
     * the eye is tracking, keeps its edges. Widening the sharp core is the
     * second subtlety lever after `strength`, and the better-behaved one:
     * it takes the blur off exactly the pixels the player is reading and
     * leaves it where peripheral motion belongs.
     */
    maskInner: 0.35,
    maskOuter: 0.85,
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
    /** Soft contact disc under each combatant. */
    blobRadius: 0.6,
    blobOpacity: 0.55,
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
