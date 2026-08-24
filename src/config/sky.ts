/**
 * config/sky.ts — the painted night sky and the moon shafts.
 * Owns: dome geometry, stars, the moon, cloud drift and the god-ray pass.
 * Contract: `docs/rendering.md`.
 * Gotcha: everything here rides at `infiniteDistance`, so radii and heights
 * are angular conveniences, not reachable places.
 */

/**
 * The night sky (src/systems/Sky.ts): a gradient dome with baked stars and
 * moon halo, an emissive moon disc that feeds the GlowLayer, and drifting
 * cloud banks. Palette lives in the map's EnvironmentSpec (`sky`); this is
 * geometry and motion. Everything rides at `infiniteDistance`, so radii and
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
  /** Moon disc radius and its distance along the key-light source dir.
   *  Beyond the cloud shells (so they veil it) and just inside the dome. */
  moonRadius: 32,
  moonDistance: 595,
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
   * Cloud decks: sphere shells just inside the dome (a plane would show
   * its edges as a hard square hanging in the sky). Each carries a
   * tileable fBm cloud mask and scrolls it azimuthally; `speedU` is uv per
   * second (a full circuit takes ~5-10 minutes — clouds should drift, not
   * fly), `uScale` is the texture repeat around the horizon, `radiusOffset`
   * how far inside the dome the shell floats, `opacity` multiplies the map
   * spec's `cloudOpacity`, and `coverage` is the fBm threshold: LOWER is
   * more cloud, and above ~0.6 the deck breaks into wisps.
   */
  cloudTextureWidth: 1024,
  cloudTextureHeight: 512,
  /** Noise: base lattice cells across the sphere, and octaves above it. */
  cloudLattice: 4,
  cloudOctaves: 5,
  /**
   * Width of the fBm ramp at the coverage threshold — edge softness.
   *
   * This is also what hides the mask's resolution. The deck texture is
   * magnified ~9x on screen (1024 texels around the horizon against ~50
   * degrees of view), and bilinear magnification of a HARD alpha contour
   * comes out as straight-edged wedges and diamonds — which read as torn
   * paper, not as cloud. A wide ramp turns the contour into a gradient,
   * which magnifies cleanly and costs nothing.
   */
  cloudSoftness: 0.5,
  /**
   * Latitude band the deck occupies, in dome-texture rows (0 = zenith,
   * 0.5 = horizon). It stops short of the horizon because the valley ridge
   * hides the last few degrees, and short of the zenith because a deck
   * directly overhead hides the moon from every angle.
   */
  cloudBandTop: 0.08,
  cloudBandBottom: 0.47,
  /** Shell tessellation. The moonlit mask is per-vertex, so this is what
   *  decides how smooth the lit patch's falloff looks. */
  cloudSegments: 48,
  /**
   * Tightness of the moonlit patch: the exponent on dot(vertex, moonDir).
   * Low is a whole hemisphere of silver (soupy), high is a hard spot.
   */
  cloudLitPower: 8,
  cloudLayers: [
    { radiusOffset: 12, uScale: 1, speedU: 0.0035, opacity: 1.0, coverage: 0.6 },
    { radiusOffset: 26, uScale: 2, speedU: -0.0018, opacity: 0.5, coverage: 0.68 },
  ],
} as const;

/**
 * Moon shafts (src/shaders/GodRays.ts): screen-space radial blur of the
 * bright parts of the frame away from the moon, so anything standing
 * between the camera and it cuts visible beams out of the haze.
 *
 * The pass costs `samples` texture fetches per pixel, so it early-outs
 * entirely when the moon is off screen or behind the camera — which is most
 * of the time in a fight.
 */
export const godRays = {
  /** Taps along each ray. The look is set by density/decay, not by this. */
  samples: 32,
  /** How far along the ray the taps reach, in screen widths. */
  density: 0.55,
  /** Per-tap falloff — how quickly a beam fades away from the moon. */
  decay: 0.96,
  /** Weight per tap, before decay. */
  weight: 0.32,
  /** Final scale on the accumulated shafts. */
  intensity: 1.3,
  /**
   * Luminance a pixel needs before it radiates. This is the whole occlusion
   * test — there is no depth pass — so it has to sit above the brightest
   * thing in the world that is NOT sky. That is the wet cobbled street,
   * which comes back around 0.67 when you look along the moon; below this
   * the road smears upward and the frame fills with haze from the ground.
   */
  threshold: 0.78,
  /**
   * The shafts fade out as the moon leaves the frame — measured in screen
   * radii from the centre, since the blur has nothing to sample once the
   * source is off screen and popping is the alternative.
   */
  fadeStart: 0.55,
  fadeEnd: 1.25,
} as const;
