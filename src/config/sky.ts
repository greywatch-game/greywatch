/**
 * config/sky.ts — the painted night sky.
 * Owns: dome geometry, stars, the moon, and the cloud masses' shape, spread
 * and drift. It owns no light
 * shafts: those are `CONFIG.graphics.volumetrics`, marched through the shadow
 * volume rather than smeared out of the moon's own pixels.
 * Contract: `docs/rendering.md`.
 * Gotcha: the dome and the disc ride at `infiniteDistance`, so their radii and
 * heights are angular conveniences, not reachable places. The CLOUDS do not:
 * `clouds.minRadius` is real metres over the map.
 */

/**
 * The night sky (src/systems/Sky.ts): a gradient dome with baked stars and
 * moon halo, an emissive moon disc that feeds the bloom, and drifting
 * cloud banks. Palette lives in the map's EnvironmentSpec (`sky`); this is
 * geometry and motion. The dome and disc ride at `infiniteDistance`, so radii and
 * heights are angular conveniences, not reachable places.
 */
export const sky = {
  /**
   * Seed for the star field, the galactic band, the moon's maria and the
   * cloud noise. The sky is dressing, not world-building, so nothing here
   * feeds navigation — but a sky that rerolls on every boot makes "is that
   * cloud bank new?" unanswerable while tuning, so it is seeded anyway.
   */
  seed: 0x5eed5c1,
  /** Dome radius. Well under the camera's default 10000 far plane. */
  domeRadius: 600,
  /**
   * Dome texture: width wraps the horizon, height runs pole to pole. The
   * dome is magnified hard — 360 degrees of texture against ~50 degrees of
   * screen — so this is what decides whether a star reads as a point or as
   * a bilinear smudge. At 4096 a 1 px star is still ~2 px on a 1080p screen.
   */
  domeTextureWidth: 4096,
  domeTextureHeight: 2048,
  /** Moon disc radius, and the distance along the key-light source dir that
   *  radius is measured AT — an angular reference, since the disc itself is
   *  stood at `moonDepthDistance` and scaled to keep this angle. */
  moonRadius: 32,
  moonDistance: 595,
  /**
   * Where the disc is actually STOOD, scaled up from `moonDistance` so it keeps
   * the angle every `moonRadius`/`discRadius` was written against. It has to be
   * behind `clouds.depthMetres`, or the glow layer blooms it through every
   * cloud in front of it — and inside the camera's 10 km far plane.
   */
  moonDepthDistance: 9000,
  /**
   * Emissive scale on the moon colour — above 1 so the bloom (`GlowPass`) takes it
   * into a proper halo on top of the soft one baked into the dome texture.
   */
  moonEmissiveBoost: 1.9,
  /** Moon disc texture: size, the fraction of the radius that is limb
   *  falloff (a hard circle reads as a sticker), and how many maria. */
  moonTextureSize: 256,
  moonLimbFraction: 0.16,
  moonMaria: 11,
  /**
   * The scattering halo baked into the dome, as a fraction of the dome
   * texture's HEIGHT (i.e. of 180 degrees of sky): a wide, faint bloom of
   * moonlight in the air, plus the tight core inside it. This is the
   * single biggest reason the old sky read as black — a 46 px halo on a
   * 512 px dome is 8 degrees of glow and nothing else.
   */
  haloRadius: 0.42,
  haloCore: 0.09,
  haloStrength: 0.5,
  /**
   * Largest star dot, in texture px; most stars are drawn far smaller.
   * Keep it near a pixel: the dome is magnified, so a dot drawn much bigger
   * than this comes out as a soft bokeh ball rather than a star.
   */
  starMaxSize: 1.6,
  /**
   * Stars inside this fraction of the halo radius are washed out by it,
   * the way they are under a real moon — and, more practically, so the
   * brightest part of the sky doesn't turn into visual noise.
   */
  starMoonWash: 0.8,
  /** Bright stars (the top of the magnitude curve) get diffraction spikes. */
  starSpikeFraction: 0.06,
  starSpikeLength: 7,
  /**
   * The galactic band: a great circle of dust drawn as overlapping soft
   * blobs plus its own dense star field, tilted off the horizon.
   */
  milkyWayTilt: 0.6,
  milkyWayBlobs: 260,
  milkyWayWidth: 0.1,
  milkyWayStars: 900,
  /**
   * The cloud MASSES: a ring of faceted, flat-bottomed cloud piles
   * (`systems/cloudMasses.ts`), lit per facet by `shaders/CloudShader.ts`. They
   * replaced two fBm shells whose soft alpha contour was the one continuous-tone
   * smear left in a frame drawn in hard bands. Every angle here is in DEGREES;
   * the map's `SkySpec` carries the palette and `cloudCover`.
   */
  clouds: {
    /**
     * How many clouds a map at `cloudCover` 1 carries. The map's cover scales
     * it, so 0.5 is half the ring — a COUNT and not an alpha, because a cloud
     * here is either there or it is not.
     */
    maxCount: 34,
    /**
     * REAL metres from the map's centre to a cloud's base: `perMapSize` times
     * the map's side, never under `minRadius`. The clouds stand in the world
     * and are drawn at the far plane (`Sky.buildClouds`), so this is not bounded
     * by the dome or the disc — it is how much the sky moves when the player
     * does.
     *
     * **It scales with the map because a ring is only a sky from INSIDE it.**
     * One fixed distance that moved a cloud visibly on Harrowmead would have
     * Cinderhaven's players walking out from under their own sky, and one sized
     * for Cinderhaven moved nothing on a 240 m village. At twice the side the
     * edge of every play square is a quarter of the way out.
     *
     * 2000 was tried first on every map and it was right about the physics and
     * wrong about the picture: 150 m of walking slid a cloud four degrees, and
     * a player who had just said the clouds moved with them would have said so
     * again. 1200 puts Harrowmead's bases 125 to 600 m up — clear of the
     * helicopter's 40 m ceiling — and measured about five degrees of slide over
     * the same walk, in a frame where the trees beside it moved clean across.
     */
    minRadius: 1200,
    perMapSize: 2,
    /**
     * The lowest and highest a cloud's BASE sits. The floor is the dome's
     * contract with the rim (see `docs/rendering.md`, "The sky") — the old
     * decks stopped at 5.4 degrees because nothing below that is ever seen.
     */
    minElevation: 6,
    maxElevation: 30,
    /**
     * Piles clouds toward the horizon: 1 is uniform in elevation, and 1.6 puts
     * about two thirds of the ring below 20 degrees — which is where a sky seen
     * from the ground actually keeps its cloud, perspective stacking the far
     * ones into the band over the rim.
     */
    elevationBias: 1.8,
    /** Angular width of a cloud, narrowest and widest. */
    minWidth: 16,
    maxWidth: 42,
    /** Depth along the line of sight, as a fraction of width. */
    depth: 0.4,
    /**
     * Lobes in a cumulus's base row (a bank carries `maxLumps` and up, a puff
     * two or three); the tiers and the side lobes are added on top of these.
     */
    minLumps: 3,
    maxLumps: 6,
    /**
     * Radial jitter on every lump vertex. This is what makes a facet read as a
     * cut face rather than as a panel of a geodesic ball — and, past about
     * 0.15, as a SPIKE, which is a rock before it is a cloud.
     */
    jitter: 0.045,
    /**
     * Subdivisions of each lobe's icosahedron. Two, not one: at one a round
     * lobe is a polygon with a few big facets across it, and a heap of those
     * is a heap of rocks. See `cloudMasses.ts`'s `icosphere`.
     */
    subdivisions: 2,
    /**
     * A cumulus lobe's height against its own half-width. ROUNDER than the
     * 0.38 cap the old piles carried, and what makes that safe is that no lobe
     * is ever seen whole: it overlaps its neighbours by most of its width and
     * its buried facets are dropped (`cloudMasses.ts`), so a row of them is a
     * scalloped top over one mass rather than the heap of pale boulders the
     * cap was put there against.
     */
    minRise: 0.55,
    maxRise: 0.78,
    /** The same for a bank's lobes — the long flat stratocumulus rows. */
    bankRise: 0.45,
    /**
     * What the ring is made of: towering cumulus, long banks, and the rest
     * small puffs scattered between them. A sky of one kind of cloud reads as a
     * stamp repeated round the horizon.
     */
    cumulusShare: 0.5,
    bankShare: 0.3,
    /** Most tiers a cumulus piles over its base row; each is fewer and smaller lobes. */
    maxTiers: 3,
    /**
     * How much of the normal the light is asked of is the whole CLOUD's dome
     * rather than the lobe's own — the stylised painter's normal transfer. Lit
     * per lobe, every billow in the crown turned its own small terminator to
     * the light and a sunlit face came out spotted with dark crescents, a heap
     * of stones; toward the cloud, the light is one big shape across the mass
     * with a scalloped edge, and the billows are left to break the silhouette.
     */
    proxyShare: 0.75,
    /**
     * Drift, in degrees per second, as a turn of the whole ring about the map.
     * About forty minutes a circuit: a cloud crossing the sun takes the better
     * part of a minute, which is a sky moving rather than a sky animating.
     */
    driftDegPerSec: 0.15,
    /**
     * How far the eye walks, in metres, or the ring turns, in radians, before
     * the lumps are re-sorted back to front. The clouds write no depth, so
     * that order IS their occlusion; kilometres out, it changes over metres of
     * walking rather than over frames.
     */
    resortMetres: 2,
    resortTurn: 0.002,
    /**
     * How much farther, in metres, a lump must be than the one ahead of it in
     * the painter's order before the re-sort moves it (`Sky.sortClouds`). A
     * near-tie between two lobes a few hundred metres across says nothing
     * about which covers which, and re-deciding every one of them was two
     * thirds of the index buffer uploaded on every re-sort.
     */
    resortSlack: 6,
    /**
     * The clouds' SHADOW on the ground (`systems/cloudShadow.ts`, `Sky`,
     * `celCloud`): each cloud's lobes cast along the key light onto a field
     * the lit shaders cut, so a shadow the shape of the cloud crossing the
     * sun slides across the map as the ring drifts.
     */
    shadow: {
      /**
       * Texels a side of the field. It covers the ground a player can see, so
       * this is a few metres a texel on the small maps and about nine on the
       * biggest.
       */
      size: 256,
      /**
       * Metres past the play square's edge the field reaches, when the map's
       * fog does not stop sight sooner.
       */
      reach: 450,
      /**
       * How LIT a point wholly inside a cloud's shadow is, as a share of the
       * key. Not the maps' own shadow darkness (0.15): a cloud's shadow is the
       * whole street rather than one side of it, and at that darkness a
       * passing cloud turns a village to night. 1 turns the shadows off.
       */
      lit: 0.45,
      /**
       * How far ahead, in seconds of drift, each field is written: the
       * crossfade runs between two fields this far apart, and the next is
       * written a slice a frame over this long. At 0.15 degrees a second a
       * shadow 1.2 km out moves about 4 m in that time.
       */
      stepSeconds: 1.5,
      /** Texels the next field may visit per frame; its whole cost is spread over these. */
      texelsPerFrame: 12000,
      /** Degrees. A key light lower than this casts no cloud shadow. */
      minElevation: 4,
    },
    /**
     * The distance whose depth every cloud fragment writes, measured ALONG the
     * pixel's ray — not where a cloud is but where the depth test is told it is
     * (`Sky.buildClouds`). A RADIAL distance like `moonDepthDistance`, which is
     * what keeps the two in order at the edge of the screen. It has to
     * be behind every surface any map draws (Cinderhaven's sea runs about
     * 3 km from its edges) and in front of `moonDepthDistance`, both inside the
     * camera's 10 km far plane. 7 km leaves roughly a hundred 24-bit steps to
     * the world and twenty-five to the disc.
     */
    depthMetres: 7000,
    /**
     * The shading constants `CloudShader` reads: how far the key WRAPS round a
     * lump (a volume, not a wall), how much of the dome's horizon colour the
     * lowest clouds take, and the strength of the silver lining on silhouette
     * facets looking toward the light.
     */
    wrap: -0.1,
    hazeAtHorizon: 0.3,
    lining: 0.45,
    /**
     * How much of each FACET's own normal the light sees, the rest being the
     * lump's smooth one. At 1 every triangle is its own tone and a cloud is a
     * crystal; at 0 the terminator is an airbrushed curve. Between, it is one
     * line across the lump that breaks along the facets.
     */
    facetShare: 0.1,
    /**
     * How far the shadow side is pulled toward the sky behind it: a cloud's
     * shade is lit by the dome all round it, so it is a darker patch OF the
     * sky rather than a solid in front of it.
     */
    shadeSky: 0.35,
    /**
     * The lit side is TWO tones, cut at the wrap and again at `highlight` (a
     * cosine to the light): `litStep` is how far toward the lit colour the
     * first cut goes, and the facets square to the light take the rest. One
     * cut left a flat bank's whole top a single cream shape with nothing in it.
     */
    litStep: 0.8,
    highlight: 0.6,
    /** How much darker the flat belly's tone is than the shadow side. */
    belly: 0.12,
    /**
     * How much of the sky behind it every cloud takes, however high — the
     * floor under `hazeAtHorizon`'s ramp.
     */
    air: 0.15,
    /**
     * How far the shadow side's UPPER facets go toward the sky above them. A
     * cloud's shade is lit by the whole dome, and most by the part overhead, so
     * the top of the dark side is a lighter, sky-tinted tone than its foot —
     * the third tone every painted cloud has between its light and its belly.
     */
    skyFill: 0.4,
    /**
     * How much of the air's share the LIT side sheds. The haze above sets a far
     * bank back behind a near one, but hazed as hard as the shade a sunlit face
     * lands on its sky's own value, and a cloud no brighter than the sky it
     * stands in is a pale stone. At 0.6 the lit face stays the palest thing
     * in its part of the sky and the shade still recedes.
     */
    litAir: 0.6,
  },
} as const;
