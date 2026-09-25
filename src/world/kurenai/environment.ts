/**
 * kurenai/environment.ts — Kurenai's EnvironmentSpec: palette, fog, sun light,
 * sky, water, falling leaves. Pure data — consumed by applyEnvironment / Sky /
 * Volumetrics / WaterSystem / Atmosphere. Fixture light POSITIONS live in the
 * layout, not here.
 */
import type { EnvironmentSpec } from "../environment";

/**
 * Kurenai: a temple valley in the last week of the maples, forty minutes
 * before sunset — the reference frame (`reference-media/new-map.jpg`) is this
 * hour and this air.
 *
 * ## The hour, and where the sun is
 *
 * **Harrowmead's derivation, taken whole**, because it is the same hour and
 * the same fairness problem: the key sits at 14.5 degrees, the exact centre of
 * the cel key's 0.25 band so rolling ground can tilt a facet seven degrees
 * either way without its band moving, and it sits in the NORTH-WEST because
 * the home yards face each other down the SW-NE diagonal and only the two
 * perpendicular bearings keep the sun out of both teams' eyes. The wrap is
 * Harrowmead's 2/3, derived there, which lifts a flat floor to the centre of
 * the top-but-one band so the golden hour reads as lit rather than as dusk.
 *
 * ## What is different from Harrowmead's evening
 *
 * **The AIR.** The reference frame's middle distance is already half gone at
 * sixty metres — trees at the far side of the garden are shapes in a peach
 * haze, and the mountains are pale silhouettes — where Harrowmead's gold air is
 * clear to the far hedge. So the haze starts CLOSE (`fogStart` 45) and is thick
 * (a third again Harrowmead's volumetric density), and its colour is a
 * PEACH, pinker than Harrowmead's amber, because a maple valley's evening is
 * lit through red leaves as well as through dust. `fogEnd` is set by the
 * valley, which is 240 m of play inside 440 m of ground: at 280 the whole
 * play square is in view from anywhere in it, the ridges' feet stand in the
 * last third of the haze as pale shapes, and their crests go to `fogColor` —
 * the reference frame's mountains, and not a metre of ground drawn past them.
 * It was 620 when this map was 750 m across, and that reach, over that area,
 * was most of what the frame cost.
 *
 * **The SKY.** A dusky mauve overhead going to gold at the horizon, with the
 * clouds' shadow sides a lavender grey and their lit faces a pale apricot — the
 * reference frame's sky, and a cooler one than Harrowmead's amber so the RED
 * of the trees is the warmest thing in the frame rather than the sky.
 *
 * **The palette UNDER the key stays cool and dark.** The rule every golden-hour
 * map in the tree follows: the warmth is in the LIGHT, and the ground, the
 * plaster and the roofs keep the colours they would have at noon — warming
 * them under a warm key double-counts the hour and turns every lit wall khaki.
 */
export const KurenaiEnvironment: EnvironmentSpec = {
  /**
   * Dark loam under leaf-fall: brown with the olive of moss in it. Dark for
   * Greyfen's reason — the key, the ambient and the sky fill all land on an
   * up-facing surface at once, so the swatch has to be well under what the
   * frame shows.
   */
  floorColor: "#3f3526",
  /**
   * LOAM — soft earth under a canopy, moss in the hollows and last week's
   * leaves gone to rust in drifts — and it is the one surface in the roster
   * made for this place. `dirt` and `turf` both carve plates, which under a
   * raking sun read as a cracked desert pan, and `sand` is dunes; `flat` was
   * honest but read as one dead brown sheet between the leaf drifts. Loam's
   * soil has no cell field in it at all, so the ground stays soft and the
   * bright red on it is still the drifts' (`leafLitter`), not the texture's.
   */
  floorSurface: "loam",
  /**
   * The mountains: cedar-dark slopes a long way into a peach haze. Pulled
   * toward `fogColor` already, because at this range a saturated hill fights
   * the air it is standing in; the reference frame's ranges are pale mauve
   * shapes and nothing more.
   */
  ridgeColor: "#6a5a58",
  ridgeScreeColor: "#4d4234",
  accentColor: "#ff9a6a",
  skyColor: "#e4b08a",
  /**
   * A peach haze: the reference frame's air, the colour of the light through
   * it, pinker than Harrowmead's amber. Under the horizon band in value so the
   * band still reads as the brightest air.
   */
  fogColor: "#dca888",
  fogStart: 45,
  fogEnd: 280,
  /**
   * Ground mist in the hollows at sunset, lit from behind — the river valley
   * breathing out. Thin, and held under the shaft threshold so it does not
   * radiate.
   */
  mistColor: "#dcb094",
  mistHeight: 2.6,
  mistStrength: 0.2,
  /** Wet autumn: damp climbing plaster and timber, darker than the wall. */
  wear: { color: "#2a2218", amount: 0.55 },
  lighting: {
    /** Deep gold, carried as saturation rather than level (Harrowmead's khaki argument). */
    color: "#ffa060",
    intensity: 1.0,
    // 14.5 degrees up, from the north-west. See the header.
    direction: [0.685, -0.25, -0.685],
    keyWrap: 0.667,
    /** A mauve-grey: the sky's own colour in the shadows. */
    ambientColor: "#7a7280",
    ambientIntensity: 0.44,
    /** The cool lift in a shadow — the warm/cool split across a garden. */
    skyLightColor: "#a8a8d0",
    skyLightIntensity: 0.34,
    /** A warm fringe on the far rooflines and every crown's edge. */
    rimColor: "#ffc79a",
    rimIntensity: 0.18,
    /**
     * Harrowmead's number for Harrowmead's hour: the depth volume binds along
     * the sun's azimuth, and 185 is what matches it across. The pagoda throws
     * 110 m at this elevation and the part of that inside the window is what a
     * player standing in its court sees.
     */
    shadowWindow: 185,
    // The sun is still up.
    lampIntensity: 0,
  },
  /**
   * FALLING LEAVES: red, drifting down and downwind, the air of a maple valley
   * in the week this is. Not emissive — a leaf is a thing the light is ON —
   * and emitted round the eye, Sarab's `volume`, so the count is a density
   * where anybody is standing rather than a budget spread over the margin.
   * The box is well past `fogStart` and past what a player crosses in a
   * leaf's life; the count is the 750 m map's density at this box's size.
   */
  particles: {
    color: "#c8482a",
    emissive: false,
    count: 1600,
    size: 0.13,
    riseSpeed: -0.35,
    drift: [0.3, 0.24],
    volume: 140,
  },
  sky: {
    zenithColor: "#8a7496",
    horizonColor: "#f2c08a",
    starColor: "#ffffff",
    starCount: 0,
    starBrightness: 0,
    moonColor: "#ffe4b8",
    moonGlowColor: "#ffc98a",
    /**
     * Lavender in shadow, apricot where lit: the reference frame's clouds. Dark
     * enough that a bank against the sun is a silhouette with a lit rim.
     */
    cloudColor: "#7d6a80",
    cloudCover: 0.5,
    cloudLitColor: "#ffd4b0",
    cloudLitStrength: 0.9,
    discRadius: 14,
    haloStrength: 0.65,
    /**
     * Thick air: the reference frame's garden is full of it, and the maples'
     * crowns are what the shafts come through. A third again Harrowmead's
     * density at the same intensity — 5 was tried and washed the town out
     * seen from above.
     */
    air: { density: 4, intensity: 1.2 },
  },
  grade: {
    vignette: 0.26,
    grain: 0.02,
    aberration: 0.12,
  },
  /**
   * The stone paths' sheen, judged for a 14.5-degree sun: warm and tight, and
   * low, because this is added past the shader's shoulder.
   */
  groundSpec: { color: "#ffc080", intensity: 0.04, shininess: 48 },
  /**
   * A clear mountain stream, the koi pond and the hot spring: dark green-blue
   * in the channel, paling over the stones. The gold comes from the mirror.
   */
  water: {
    deepColor: "#17313a",
    shallowColor: "#3d6a6a",
    foamColor: "#eef2ee",
    glint: 0.2,
  },
  /** Autumn grass: olive at the root, gone to straw at the tip. */
  grass: {
    rootColor: "#353820",
    tipColor: "#8e8a44",
  },
};
