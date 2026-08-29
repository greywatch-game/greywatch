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
 * - **The `water` block is the map's SECOND chroma, and it owes the paragraph
 *   at the bottom of this header an answer.** It did not exist while the wadi
 *   was dry; there are four bodies now — three standing pools between the fords
 *   and the birkat dug into the mosque quarter — and every one of them is a
 *   dark, low-chroma body with a mirror on it rather than a blue rectangle. The
 *   dome stays the thing you navigate by, because water is drawn almost
 *   entirely as REFLECTED SKY at the angles a player sees it from and the sky
 *   here is pale haze. See the block itself for the two numbers that keep it
 *   there, and note the one it costs: a probe a body, baked once, under the
 *   loading card.
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
   * Ground haze: a desert has shimmer near the floor rather than mist, and the
   * honest version of shimmer is a warm term low down that builds with
   * distance.
   *
   * **It carries more of this map than of any other, and the reason is the gap
   * between the two atmosphere terms.** The mist ramp is fully in by 51 m
   * (`CelShader`, `clamp((dist - 6) / 45)`) and `fogStart` is 150, so on this
   * map the band from fifty metres to a hundred and fifty is the ONLY place
   * either term can put air — and at 0.05 over 2.4 m there was none, which is
   * most of why the town seen from a roof read as a diagram. Every other map in
   * the tree closes that gap with a `fogStart` inside 40 m; this one cannot,
   * because a haze that reached into a seven-metre alley would be smoke.
   *
   * So it is raised and, more importantly, made TALLER: at 4.5 m the falloff
   * still has two thirds of its strength at head height, which is what makes
   * the mid-distance streets sit IN heat rather than putting a band across
   * their feet. It stays well under the wet-morning reading — 0.14 against
   * Hollowmere's 0.45 — and the ramp's own 6 m dead zone keeps your own boots
   * out of it.
   */
  mistColor: "#cabb9b",
  mistHeight: 4.5,
  mistStrength: 0.14,
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
     *
     * **It came DOWN from 0.42, and the term below came up to pay for it.**
     * Ambient is the one light term that lands on every face equally, so it is
     * also the one that flattens: at 0.42 a wall out of the sun sat at 0.23
     * against the key's 1.02, and every alley in the old town read as the same
     * value as the street outside it. At 0.30 a shaded face is 28% deeper and a
     * LIT face is unmoved, because the key dominates it either way — which is
     * the whole of the trade.
     */
    ambientColor: "#8b7f68",
    ambientIntensity: 0.3,
    /**
     * The sky's own fill: pale, slightly blue, and what keeps roofs reading.
     *
     * **Raised by very nearly what the ambient above lost, and the SWAP is the
     * point rather than a way of holding the exposure.** This term is applied
     * by `n.y`, so it reaches horizontals and nothing else: paying for an
     * ambient cut out of it leaves every up-facing surface — the sand, the
     * roofs, the parapets, the ledges — at the brightness it already had, and
     * takes the whole difference out of the vertical faces. What the map gains
     * is a HUE split between the two, which is what a desert at eleven in the
     * morning actually is: blue sky bounce on everything that looks up, warm
     * sand bounce on everything that looks sideways. On a palette this
     * deliberately narrow in hue (see the header) it is the only separation
     * available that costs nothing.
     *
     * **The sand's brightness is load-bearing and was held to it**, because
     * `rays.threshold` below is a luminance test with no depth pass and the
     * floor is the brightest thing in the world that is not sky. The `sand`
     * ramp tops out at 1.22 of `floorColor` (`world/textures.ts`), which under
     * the old pair put the brightest lit sand at 0.82 luma against a 0.9
     * threshold. Under this pair it is 0.82. Anything here that raises the SUM
     * on an up-facing surface spends that margin, and the shafts start coming
     * off the ground.
     */
    skyLightColor: "#b2c2d8",
    skyLightIntensity: 0.34,
    /**
     * Raised from 0.1, and on this map it is a legibility term rather than a
     * look. The rim is gated off near-level surfaces (`CelShader`), so it
     * reaches silhouettes and only silhouettes: a body, a parapet or a wall
     * corner standing against 560 m of haze very nearly its own colour. That
     * is the case this map has more of than any other in the tree, and 0.1 was
     * not enough of an edge to find one by.
     */
    rimColor: "#fff0cc",
    rimIntensity: 0.18,
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
    /**
     * **A density, and the first one in the tree that is actually stated as
     * one** — `volume` below is what makes it one. Before that field existed
     * the emit box was the whole map, so 3,000 over a 900 m square was
     * Hollowmere's 4,000 over a 240 m one spread nineteen times thinner, which
     * is dust nobody could see.
     *
     * **What it is NOT is Hollowmere's density, and trying that first is what
     * settled the number.** Matching it exactly — 43 cubic metres a mote
     * against Hollowmere's 48 — put twenty times more dust in front of the eye
     * than this map had before and read as weather rather than as air. The two
     * fields are not comparable per cubic metre and it should have been
     * obvious from the two specs: Hollowmere's motes are ash, `emissive: false`
     * and drawn with STANDARD blending against a dark valley, and these are
     * lit dust, `emissive: true` and drawn ADDITIVE against pale sand under a
     * high sun. Every mote here is worth several of one of those. 1,600 is
     * about a third of Hollowmere's density and roughly six times what this map
     * used to put in the view, which is a hot afternoon with something moving
     * in it.
     *
     * `size` is the lever rather than the count — Hollowmere's file is where
     * that argument is made in full — so it carries the visibility instead:
     * 0.13, barely over the 0.12 every other map states, because on this one a
     * mote is additive and does not need the help.
     */
    count: 1600,
    size: 0.13,
    /**
     * 260 m, and the first map to state one.
     *
     * Three bounds and they leave very little room. It has to sit well past
     * `fogStart` (150), so that a mote — which is emitted at full alpha —
     * appears in air already thick enough to hide the appearing; well past
     * what a player crosses in the ~14 s a mote lives, which is about 70 m on
     * foot and roughly double that in a hull, so the trailing edge never
     * overtakes the field; and well inside `fogEnd` (560), or the budget goes
     * straight back to being spent on motes drawn as fog. 260 clears the first
     * by 110 m, the second by better than half, and spends nothing past the
     * haze.
     */
    volume: 260,
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
    /**
     * Raised from 0.28, and it is the cheapest thing on this map: the dome is
     * baked ONCE, so cloud costs the frame nothing at all and a thin deck was
     * buying nothing with it. What a deck is FOR here is distance — the rim is
     * 750 m out and drawn almost entirely in `fogColor`, so the sky above it is
     * most of what says how far away that is, and an empty sky says nothing. It
     * also gives the shafts something to be occluded by: at `rays.threshold`
     * 0.9 the lit tone below is the only thing in the world besides the disc
     * that crosses it, and there is now more of it.
     */
    cloudOpacity: 0.52,
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
   * Four bodies of standing water in a desert, and the palette is written
   * against what they are rather than against what water usually is.
   *
   * **These are POOLS, not a stream**: no flow, no outfall, a silt bed and a
   * few months of dust on them. So the body colour is dark and barely
   * chromatic — the shader's Fresnel puts the sky and the map's own geometry at
   * the grazing end (see `WaterEnvSpec`), which is most of what a player ever
   * sees, and what these two colours decide is only what is left looking
   * straight down into one. A blue would be a swimming pool in a wadi.
   *
   * `bedColor` is stated, which almost no map here does, and it is the one
   * choice that is about this map specifically. The default is `floorColor` —
   * the bank a body is cut in, which is right where a stream is cut in the
   * valley floor. A wadi's bed is not the desert: it is what the water left,
   * which is darker, greyer and damp, and taking the default would have graded
   * the last few centimetres of every shoreline back into pale sand and made
   * each pool look like it was painted on.
   *
   * **`glint` is the number under real pressure and it is LOW for a map with a
   * disc in its sky.** `sky.rays.threshold` is 0.9 and the god rays' occlusion
   * test is luminance with no depth pass, so anything in the world brighter
   * than that stops occluding and starts radiating; the lit sand is already at
   * 0.82 (see `skyLightIntensity`, which is held to that margin). A crest
   * sparkle is a hard specular that fires anywhere on a body including where
   * the mirror returns nothing, so it is exactly the term that would cross it.
   * 0.3 is enough to say the surface is moving and spends none of the margin.
   *
   * `mirror` is 0.85 rather than 1 for the reason the field exists: these are
   * silty and a metre of suspended dust scatters most of what lands on them.
   * The honest way to draw that is to keep the sky and lose a little of the
   * picture.
   */
  water: {
    deepColor: "#1d2f2b",
    shallowColor: "#4c6152",
    foamColor: "#e2d8bf",
    bedColor: "#6d6047",
    mirror: 0.85,
    glint: 0.3,
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
    vignette: 0.21,
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
