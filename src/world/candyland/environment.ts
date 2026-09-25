/**
 * candyland/environment.ts — Candy Land's EnvironmentSpec: palette, fog, sun
 * light, sky, water and grass. Pure data — consumed by applyEnvironment / Sky
 * / Volumetrics / WaterSystem / Atmosphere. Fixture light POSITIONS live in
 * the layout, not here.
 */
import type { EnvironmentSpec } from "../environment";

/**
 * Candy Land on a bright spring afternoon — the 1962 board's own weather
 * (`reference-media/candyland-board.jpg`): a blue sky with a lavender cloud in
 * it, green lawns, and every colour on the board at full strength.
 *
 * ## The hour, and where the sun is
 *
 * **High, and from the south-east.** Every other map in the tree picks an hour
 * for its mood; this one picks the hour a picture book is lit at, which is
 * the one with the least shadow in it. At 42 degrees a gumdrop still throws a
 * shadow you can read its shape by, and the colours on the path — which are
 * the map — are lit square rather than raked. The azimuth is the fairness
 * rule every map follows: the home yards face each other down the SW–NE
 * diagonal (START in the south-west, the Ice Cream Sea's shore in the
 * north-east), so the sun comes across it and out of neither side's eyes.
 *
 * ## The palette under the key
 *
 * **The candy is in the ALBEDOS and the light is white.** The golden-hour maps
 * put their warmth in the key and keep the ground cool; this map is the
 * opposite case of the same rule — the key is nearly white so that a red
 * space is the board's red and a pink roof is frosting, not salmon. What is
 * warm is the RIM, a little, so the gumdrops' edges glow.
 *
 * **The lawn stays dark in its swatch** for Greyfen's reason: the key, the
 * wrap, the ambient and the sky fill all land on an up-facing surface at once,
 * so what the frame shows is well over what the swatch says.
 *
 * **The air is a cotton-candy haze**, pink toward the horizon and clear in the
 * middle distance, so the whole board is legible from any corner of it
 * (`fogEnd` past the play square's diagonal from the centre) and the downs
 * beyond go soft and pastel rather than grey.
 */
export const CandylandEnvironment: EnvironmentSpec = {
  /** The lawn: a spring green, dark in the swatch. */
  floorColor: "#467f33",
  /**
   * TURF — a lawn's grain, carved shallow. Under a 42-degree sun the plates a
   * raking light turns into a cracked pan are only a mown texture, and a board
   * game's green is a flat colour with the grass tufts doing the rest.
   */
  floorSurface: "turf",
  /** The downs round the board: soft green, pulled toward the haze. */
  ridgeColor: "#7fae78",
  ridgeScreeColor: "#4f8a3a",
  accentColor: "#ff7eb0",
  skyColor: "#9fd0f2",
  /** Cotton candy: a pale pink haze, under the horizon band in value. */
  fogColor: "#f2d4e4",
  fogStart: 150,
  fogEnd: 560,
  mistColor: "#fbe4f0",
  mistHeight: 1.4,
  mistStrength: 0.05,
  lighting: {
    /** Nearly white, a breath warm: the colour is in the sweets. */
    color: "#fff6ea",
    intensity: 1.0,
    // 42 degrees up, from the south-east. See the header.
    direction: [-0.525, -0.669, 0.525],
    keyWrap: 0.3,
    /** A lilac fill: the board's lavender cloud in every shadow. */
    ambientColor: "#b4a8cc",
    ambientIntensity: 0.42,
    skyLightColor: "#bfe0ff",
    skyLightIntensity: 0.34,
    rimColor: "#fff0dc",
    rimIntensity: 0.2,
    /**
     * The plum tree is 26 m and throws 29 m at this elevation; the gumdrop
     * range and the two houses a third of that. 140 holds the tree's whole
     * shadow in the window from anywhere near its flag.
     */
    shadowWindow: 140,
    // A sunny afternoon: no shoulder lamp.
    lampIntensity: 0,
  },
  sky: {
    zenithColor: "#5ea9ea",
    horizonColor: "#fbe0ee",
    starColor: "#ffffff",
    starCount: 0,
    starBrightness: 0,
    moonColor: "#fffdf2",
    moonGlowColor: "#fff1d8",
    /**
     * The board's cloud is LAVENDER in its shadow and white where the sun is
     * on it — cotton candy — and there is a fair bit of it.
     */
    cloudColor: "#b6a2d4",
    cloudCover: 0.42,
    cloudLitColor: "#ffffff",
    cloudLitStrength: 0.85,
    discRadius: 10,
    haloStrength: 0.45,
    /** Clear air: a little shaft under the plum tree and nothing more. */
    air: { density: 0.8, intensity: 0.4 },
  },
  grade: {
    vignette: 0.14,
    grain: 0.008,
    aberration: 0.04,
  },
  /** Nothing here is cobbled; kept low in case a map edit lays a street. */
  groundSpec: { color: "#fff0e0", intensity: 0.02, shininess: 24 },
  /**
   * The Ice Cream Sea: the board's bright blue water with white crests. Blue
   * in the channel, turquoise over the shallows where the floats are.
   */
  water: {
    swell: 0.3,
    deepColor: "#1f6fbf",
    shallowColor: "#5cc6e6",
    foamColor: "#ffffff",
    bedColor: "#e9dcc0",
  },
  /** A spring lawn: bright at the tip. */
  grass: {
    rootColor: "#56a03a",
    tipColor: "#b8e870",
  },
};
