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
 * moon halo, an emissive moon disc that feeds the GlowLayer, and drifting
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
   * Emissive scale on the moon colour — above 1 so the GlowLayer blooms it
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
    /**
     * Height as a fraction of width — a long flat bank to a low heap. Kept
     * LOW, and that was a photograph rather than a preference: at a quarter of
     * the width the piles read as a range of pale rocks hanging in the air,
     * because a tall faceted mass is a mountain before it is a cloud.
     */
    minFlatness: 0.1,
    maxFlatness: 0.2,
    /** Depth along the line of sight, as a fraction of width. */
    depth: 0.4,
    /** Lumps in a cloud's base row; the crown tier is added on top of these. */
    minLumps: 6,
    maxLumps: 13,
    /**
     * Radial jitter on every lump vertex. This is what makes a facet read as a
     * cut stone rather than as a panel of a geodesic ball — and, past about
     * 0.15, as a SPIKE, which is the same rock problem as the flatness above.
     */
    jitter: 0.1,
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
     * The distance whose depth every cloud fragment writes — not where a cloud
     * is but where the depth test is told it is (`Sky.buildClouds`). It has to
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
    wrap: 0.12,
    hazeAtHorizon: 0.3,
    lining: 0.45,
  },
} as const;
