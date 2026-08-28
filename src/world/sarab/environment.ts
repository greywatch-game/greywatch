/**
 * sarab/environment.ts — the light, the air and the palette of the desert town.
 * Owns: what Sarab looks like, and nothing about where anything in it stands.
 * Paired with `SarabLayout` in `maps.ts`; building either against the other's
 * half gives a town lit for somewhere else.
 *
 * **This is the first spec in the tree written for a map that can be FOGGED**,
 * and that is the whole of its design rather than a note on it.
 *
 * Coldharbour states `fogEnd: 480` at `size: 320` and Harrowmead `520` at
 * `400` — both at or past their own diagonal, so nothing on either is ever
 * culled by distance and `WorldCulling`'s block half has never had anything to
 * do. At 900 m of play the diagonal is 1,273 m and that trend cannot continue:
 * a `fogEnd` past it would leave all 1,024 merge blocks candidates on every
 * frame, which is `ENGINE_UPGRADE.md` wall 1 with the lever taken off. So this
 * map states **560**, well inside its own square, and finding 21's dormant
 * saving — 0.6 ms of walk and 0.8 ms of frame — is what that buys.
 *
 * **The look and the budget agree here, which is unusual and is why the desert
 * city was the map chosen for it.** A dry basin at eleven in the morning has
 * real aerial haze; a town four hundred metres away genuinely goes the colour
 * of the air. A NIGHT map cannot borrow this and a jungle cannot either — fog
 * that removes work has to be fog you believe.
 *
 * Four things follow from the hour and each of them is a decision:
 *
 * - **The sun is high** (52 degrees), which is S8's cheap answer. Shadow length
 *   is `h / tan(elevation)`, so the 27 m minaret — the tallest thing on the map
 *   — throws 21 m and a house throws 3. That is what lets `shadowWindow` stay
 *   at 150 against Coldharbour's 200, and 150 m of window over the fixed 2048 m
 *   map is 7.3 cm a texel where Coldharbour's is 9.8.
 * - **`bodyDrawDistance` is 300**, and this is the first map in the tree to
 *   state one. `FINDINGS.md` 30 measured the lever with the roster stood down a
 *   900 m sight line: 65% of the frame's active meshes were soldiers and the
 *   frame went 9.2 ms to 6.6. This map HAS 900 m sight lines — down the two
 *   highways, and from the Martyrs' shelf across the whole town — so it is the
 *   map that pays for the rigs, and 300 m is a little over half its own fog. A
 *   body still POPS where it is dropped, which is the whole of the cost, and
 *   300 was chosen so that popping happens in haze thick enough to hide it
 *   rather than in clear air.
 * - **No lamps at all** (`lampIntensity: 0`), the rule Greyfen set and
 *   Harrowmead kept. A carried flame under a midday sun is a torch at noon, and
 *   it is not merely redundant: a carried light always wins one of the sixteen
 *   shader slots, so an unwanted one is a fixture somewhere going dark.
 * - **There is no `water` block at all**, because the layout declares no rect
 *   for one to colour. The wadi is DRY — `scripts/generate-sarab.mjs` carries
 *   the argument, and what it buys here is that a 900 m map spends nothing on
 *   the mirror, the foam or the reflection probe a body of water costs.
 * - **`groundSpec` is left alone.** `config/graphics.ts` warns the wet-cobble
 *   sheen is tuned against the key light's elevation, and a desert is the wrong
 *   weather for it entirely — what is stated here instead is a very low, very
 *   warm term, which is what dry grit under a high sun does and is nothing like
 *   what wet stone does.
 *
 * **The palette is a VALUE ladder rather than a hue one**, which is what a
 * bleached place is: floor, wall, roof and rim are within a few percent of one
 * another in hue and separated by lightness, and the only chroma anywhere is
 * the mosque's dome (`TILE_BLUE` in kit/desert.ts) and the two teams' liveries.
 * That is deliberate and it is a gameplay decision as much as a look — on a map
 * this size the thing you navigate by has to be the one saturated object in the
 * town, and a body's team colour has to be the one saturated thing on a body.
 */
import type { EnvironmentSpec } from "../environment";

export const SarabEnvironment: EnvironmentSpec = {
  /**
   * Bleached sand over hardcore. `sand` is the coarsest-grained surface in the
   * roster at 5 m a tile with almost no relief (0.015), which is right: a dune
   * field reads as drift and shadow rather than as texture, and a finer grain
   * over 1,500 m of ground tiles visibly.
   */
  floorColor: "#8c7a58",
  floorSurface: "sand",
  /**
   * The basin's rim, 750 m out. Nearly all of it is drawn in `fogColor`
   * anyway — what these two decide is the last few hundred metres of it, seen
   * from the outskirts.
   */
  ridgeColor: "#877860",
  /**
   * The rim's foot, and its job is to melt the boundary into `floorColor`
   * rather than to trim it. Near the floor and slightly warmer, never lighter:
   * the sky term lifts albedo, so a bright tone here comes back chalky on every
   * up-facing ledge.
   */
  ridgeScreeColor: "#957f5c",
  accentColor: "#ffb45a",
  skyColor: "#a9b5c6",
  /**
   * Warm dust, and the number this whole file is written around.
   *
   * `fogStart` is far enough out that nothing inside a quarter is tinted — the
   * old town's alleys are seven metres wide and a haze that reached into them
   * would read as smoke — and `fogEnd` at 560 is inside the play square's own
   * 1,273 m diagonal, which is the first time that has been true in this tree.
   * See the header.
   */
  fogColor: "#bcab88",
  fogStart: 150,
  fogEnd: 560,
  /**
   * A little over half the fog. The first map to state one; see the header for
   * what it is worth and what it costs.
   */
  bodyDrawDistance: 300,
  /**
   * Ground haze, kept very thin. A desert has shimmer near the floor rather
   * than mist, and the honest version of shimmer is a thin warm term over the
   * first couple of metres — anything stronger reads as a wet morning.
   */
  mistColor: "#cabb9b",
  mistHeight: 2.4,
  mistStrength: 0.05,
  lighting: {
    color: "#fff2d6",
    intensity: 1.02,
    /**
     * 52 degrees, an hour before noon, bearing south-west — set perpendicular
     * to the NE-SW diagonal the two home yards face down, so neither side
     * spends the walk in from its own spawn looking into the sun.
     *
     * The elevation is the load-bearing half: shadow length is
     * `h / tan(elevation)`, and at 52 degrees the tallest thing on the map
     * throws 21 m. That is what keeps `shadowWindow` at 150.
     */
    direction: [0.48, -0.79, 0.38],
    /**
     * Bounce off sand, which is warm and strong — the shadowed side of a wall
     * in a desert is nothing like the shadowed side of a wall in a valley, and
     * an ambient this high would be a mistake on any other map here.
     */
    ambientColor: "#8b7f68",
    ambientIntensity: 0.42,
    /** The sky's own fill: pale, slightly blue, and what keeps roofs reading. */
    skyLightColor: "#b2c2d8",
    skyLightIntensity: 0.26,
    rimColor: "#fff0cc",
    rimIntensity: 0.1,
    /**
     * 150 m against the default 110 and Coldharbour's 200. The map is four
     * times Coldharbour's extent and its sun is more than twice as high, so
     * what decides this is neither: it is that `shadowVisibility` returns FULLY
     * LIT outside the window rather than fading, and a window that ends inside
     * the open ground between two quarters draws a straight line across the
     * sand. 150 m puts that line past the far side of any one quarter, and the
     * `depthRange` ceiling at this elevation is 380, so nothing is spent for
     * nothing.
     */
    shadowWindow: 150,
    /** No lamps. See the header. */
    lampIntensity: 0,
  },
  /**
   * Dust in the air, drifting with the wind rather than milling in it —
   * `drift` is matched by hand to `CONFIG.wind.dir`, which is what makes the
   * motes and the palm fronds agree about a bearing. Fast, because this air is
   * going somewhere: the two maps that state a drift differ by a factor of four
   * in how fast it moves, and this is the fast one.
   */
  particles: {
    color: "#f5dcb4",
    emissive: true,
    count: 3000,
    size: 0.12,
    riseSpeed: 0.03,
    drift: [1.05, 0.85],
  },
  /**
   * A hot, hazy sky: high thin cloud, a hard white disc and almost no gradient.
   *
   * `starCount` is zero and `starBrightness` with it — the dome is baked once
   * and stars under a midday sun would be eight megapixels of nothing.
   * `horizonColor` sits on `fogColor` to within a shade, which is the one hard
   * requirement `SkySpec` states: the dome has to melt into the hazed rim
   * rather than cut against it, and on a map whose rim is 750 m out and drawn
   * almost entirely in fog, that join is most of the horizon.
   */
  sky: {
    zenithColor: "#557ead",
    horizonColor: "#bfae8c",
    starColor: "#ffffff",
    starCount: 0,
    starBrightness: 0,
    moonColor: "#fffbec",
    moonGlowColor: "#ffeec4",
    cloudColor: "#a3abb6",
    cloudOpacity: 0.28,
    cloudLitColor: "#fff2d4",
    cloudLitStrength: 0.72,
    discRadius: 10,
    haloStrength: 0.44,
    /**
     * The shafts, and the threshold is the number that matters.
     * `CONFIG.godRays`' luminance test IS the whole occlusion test — there is
     * no depth pass — so on a map whose ground is pale sand under a high sun,
     * a shipped threshold would fire on the floor. 0.9 is high enough that only
     * the disc and the brightest cloud cross it, which is what leaves the
     * shafts as something the dust does rather than something the town does.
     */
    rays: { threshold: 0.9, intensity: 0.34 },
  },
  /**
   * Dry scrub, and the one place on this map a colour is allowed to be green.
   *
   * The root sits almost on `floorColor`, which is the rule — a field has to
   * read as growing out of the ground rather than as scattered on top of it —
   * and the tip is only just off it. Desert grass is straw with a memory of
   * green in it, and anything more saturated makes 1,500 m of sand look like a
   * lawn somebody forgot to water.
   */
  grass: {
    rootColor: "#77683f",
    tipColor: "#8e7c46",
  },
  /**
   * A hot, dry grade.
   *
   * **The aberration is DOWN rather than up**, which is the opposite of the
   * obvious move for heat haze and was measured rather than reasoned: this map
   * carries a scrub field of thin instances and a palm grove of thin fronds
   * over pale ground, and a fringe that reads as warmth on a 240 m valley reads
   * as rainbow SPECKLE on a hundred metres of tuft. Grain is down with it for
   * the same reason and at the same distances.
   */
  grade: {
    vignette: 0.16,
    grain: 0.011,
    aberration: 0.06,
  },
  /**
   * NOT the wet-cobble default. Dry grit under a high sun has a broad, very
   * weak warm sheen — a wide lobe with almost nothing in it — where wet stone
   * has a narrow bright one. `config/graphics.ts` says a map that moves its
   * light's elevation owes a value here, and this map moved it further than
   * any other.
   */
  groundSpec: { color: "#ffe0aa", intensity: 0.02, shininess: 18 },
};
