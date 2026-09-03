/**
 * cinderhaven/environment.ts — the light, the air and the palette of the
 * volcanic island at night.
 * Owns: what Cinderhaven looks like, and nothing about where anything in it
 * stands. Paired with `CinderhavenLayout` in `maps.ts`; building either
 * against the other's half gives an island lit for somewhere else.
 *
 * **THE KEY LIGHT COMES OUT OF THE MOUNTAIN, and that one decision is the
 * whole of this file.**
 *
 * Every other night map here is lit by a moon, which is a cold source high
 * enough to put a little of itself on everything. This one is lit by Grimhold:
 * `lighting.direction` is set so the light travels away from the cone at (-400,
 * -380), twenty degrees up, in a colour a fire is. Three things fall out of it
 * and none of them is decoration:
 *
 * - **The disc goes where the light comes from.** `Sky` hangs the disc
 *   opposite `lighting.direction`, so it lands low in the north-west, over the
 *   crater — which means the ONE bright object in the sky is the eruption
 *   glow, and `GodRays`, which converges on that same point, throws its shafts
 *   out of the mountain and across the town. There is no second mechanism
 *   here; the shafts were already keyed to the light's own bearing and this
 *   map just points the light somewhere honest.
 * - **The palette splits by NORMAL rather than by hue.** The key is warm and
 *   almost horizontal, so it reaches vertical faces turned toward the cone and
 *   nothing else; `skyLightColor` is applied by `n.y`, so it reaches
 *   horizontals and nothing else. The result is that every roof, every deck
 *   and the whole sea are cold blue and every wall facing north-west is
 *   orange, off ONE ambient term. That is the Sarab trick — see that file's
 *   `skyLightIntensity` — inverted: there the sky was cold and the bounce
 *   warm, here the source is warm and the sky is cold, and it costs the same
 *   nothing.
 * - **The shadows are long and the window has to pay for them.** At twenty
 *   degrees a shadow is 2.7 times its caster, so the chapel's tower throws
 *   forty-five metres and a shophouse thirty. `shadowWindow` is 185 against a
 *   ceiling of 189 (`ShadowSystem.warnIfWindowIsWasted`, `2 * 89 /
 *   cos(elevation)`) — the most this hour can spend, and it is spent.
 *
 * **`fogEnd` is 1,250 and the MOUNTAIN is what set it, against a first answer
 * of 620 that was chosen for the budget and was wrong.**
 *
 * The budget argument is Sarab's and it is a good one: a `fogEnd` past a map's
 * own diagonal leaves every merge block a candidate on every frame, which is
 * `ENGINE_UPGRADE.md` wall 1 with the lever taken off, and 620 against this
 * map's 2,121 m diagonal is a tighter ratio than Sarab's 560 against 1,273.
 * What it missed is that fog is distance from the EYE and a landmark is a
 * fixed thing in the world: Grimhold stands 888 m from the quay and 698 m from
 * the works, so at 620 — and at 900, which was the first correction — the
 * island's one landmark was flat `fogColor` from everywhere anybody plays.
 * Measured from a helicopter over the harbour: a horizon with no cone on it at
 * all, on a map whose every road, sightline and square metre of sky is
 * arranged around one.
 *
 * **What it costs was measured rather than feared, and it is nothing at eye
 * level.** Paired warm runs at 900 and at 1,250, three of each: standing in the
 * harbour looking at the mountain, 246 active meshes against 248 and 81 fps
 * against 81. The whole cost is in the air — from 150 m up over the island,
 * 333 active meshes become 386 and the median frame goes 77 to 65. So this map
 * spends about 15% of a HELICOPTER's frame on being able to see the mountain
 * from the ground, and spends nothing at all of anybody else's. `WorldCulling`
 * still has 40% of the diagonal to work in, and `bodyDrawDistance` below is
 * doing the larger share of the same job on the larger bucket.
 *
 * **The colour is VIVID and the map is DARK, and those are not in tension —
 * they are the same decision.** Everything unlit here is near black: the floor
 * is basalt at 18% grey, the rim is darker, the sea is nearly ink. What is lit
 * is lit in saturated colour and nothing is in between, so the four things
 * that matter — the crater's glow, the harbour's lamps, the works' kilns and a
 * body's team colour — are the only chroma on the island and can be read at
 * any distance. A night map that greys its lights to look moody ends up with
 * nothing legible in it; this one spends the whole range on a handful of
 * sources and leaves the rest of the island to the shape of things.
 */
import type { EnvironmentSpec } from "../environment";

export const CinderhavenEnvironment: EnvironmentSpec = {
  /**
   * Basalt, and the darkest floor in the tree.
   *
   * `gravel` is the surface a lava apron is: broken clinker at a scale the eye
   * reads as ground rather than as objects, and its ramp tops out low enough
   * over `floorColor` that even under the key light the ground never crosses
   * `sky.rays.threshold` — which on a map whose whole sky is one bright disc is
   * the number the floor is held against (see Sarab's `skyLightIntensity` for
   * the same margin measured from the other end).
   */
  floorColor: "#332e38",
  floorSurface: "gravel",
  /**
   * **Nothing on this map is painted in either of these, and they are here
   * because the type asks for them.** They were the far islands — the rest of
   * the caldera's wall, a ring of downs a kilometre out — and the layout now
   * states `ridge: { form: "none" }`, so no rim geometry is built at all: what
   * closes this horizon is the ocean running out past `fogEnd`, which is that
   * layout entry's argument and `Ridge.ts`'s.
   *
   * They are left at what they were rather than deleted or blanked. A map's
   * environment is swapped live by the editor's work light and read by
   * `MapThumb`, so an unused colour is worth nothing and a wrong one is worth
   * less than nothing the day somebody puts an island back out there.
   */
  ridgeColor: "#211c24",
  ridgeScreeColor: "#2c2528",
  accentColor: "#ff7a2a",
  skyColor: "#0a0716",
  /**
   * Sea mist with the mountain's own light in it, and the number this whole
   * file is written around.
   *
   * `fogStart` is 80 rather than the 22 a night village uses, and that is the
   * SHADOW WINDOW rather than the weather: the window is centred on the player
   * and everything outside it answers fully lit, so the boundary is a ring
   * about 92 m out that slides with you. `CONFIG.graphics.shadows.edgeFade`
   * turns that ring into a gradient over its last tenth — 83 to 92 m — and
   * this hands the gradient over to haze that has already started. Sarab's
   * file found the same join from the other side, with 150 m of clear air in
   * between it and nothing to hide it.
   *
   * The ramp from 80 to 1,250 is long and gentle on purpose — see the header
   * for why the far end moved — so the cone at 888 m arrives as a silhouette
   * with 31% of its own colour left in it rather than as a wall of nothing.
   */
  fogColor: "#221a2c",
  fogStart: 80,
  fogEnd: 1250,
  /**
   * A little over half the fog, and the second map in the tree to state one.
   *
   * This map has 1,500 m of play and, across the bay or down from the works,
   * sight lines the length of it — so it is exactly the case `FINDINGS.md` 30
   * measured, where the roster was 65% of the frame's active meshes and 2.6 ms
   * of a 9.2 ms frame. 420 m is where a body is three pixels of `fogColor`
   * against `fogColor`, and it is inside the haze rather than in clear air,
   * which is the whole of what stops the drop being something a player can see
   * happen. It is a third of `fogEnd` rather than a fixed distance, because
   * what it is a fraction of is the WEATHER and not the extent — and on this
   * map it is doing the larger share of the work `fogEnd` gave up (see the
   * header): 48 rigs of nineteen merged meshes each, dropped at 420 m on a
   * square with 1,500 m sight lines down it.
   */
  bodyDrawDistance: 420,
  /**
   * Sea mist, low and cold, and the term that does the most work on this map's
   * middle distance.
   *
   * It is nearly Hollowmere's strength (0.45) at half again its height,
   * because what it is standing in for is different: a wet valley has mist
   * lying in it, and an island in a cold ocean has air the sea has been
   * breathing on all night. At 5 m it still has two thirds of its strength at
   * head height, so the bay and the strand sit IN it rather than wearing a
   * band across their feet, and the ramp's own 6 m dead zone keeps your boots
   * out of it.
   */
  mistColor: "#241d33",
  mistHeight: 5,
  mistStrength: 0.38,
  lighting: {
    /**
     * Fire, not moonlight — see the header. The intensity is under a moon's
     * because a volcano twelve hundred metres away lighting a whole island is
     * already generous; what sells it is the hue and the angle, not the level.
     */
    color: "#ff6a1c",
    intensity: 0.95,
    /**
     * Twenty degrees up, travelling south-east — set so that the light comes
     * FROM Grimhold at (-400, -380), which puts the disc, the halo and every
     * shaft `GodRays` draws over the crater.
     *
     * The elevation is load-bearing twice. Shadow length is `h /
     * tan(elevation)`, so at twenty degrees the chapel's tower throws 45 m and
     * every wall in the old town lays a long one down its own lane — which is
     * what the map wants and what `shadowWindow` below has to cover. And the
     * same twenty degrees sets the CEILING that window may not pass, because
     * the depth volume's reach along the sun goes as `1 / cos(elevation)`: a
     * low light is the most expensive hour to buy window at, and 185 is
     * essentially all of it.
     */
    direction: [0.681, -0.342, 0.647],
    /**
     * Starlight and sea, and it is COLD — the opposite hue to the key, which
     * is the split the header argues for. It is also low: ambient lands on
     * every face equally, so it is the term that flattens, and on a map whose
     * whole read is warm faces against cold ones there is very little of it to
     * spend.
     */
    ambientColor: "#2b2c4e",
    ambientIntensity: 0.66,
    /**
     * The sky's own fill, applied by `n.y`, and the cold half of the split.
     *
     * This is the term that makes every roof, deck, road and standing pool on
     * the island read blue while the walls facing the mountain read orange, and
     * it is deliberately stronger than any other night map's (Hollowmere is
     * 0.27) because on this one it is doing a job rather than lifting a wash:
     * with the key nearly horizontal, horizontals get almost nothing from it,
     * and without this the ground would be the darkest thing in the frame
     * rather than the thing you navigate by.
     */
    skyLightColor: "#4470b8",
    skyLightIntensity: 0.44,
    /**
     * The rim, and on this map it is a legibility term rather than a look: a
     * body against a kilometre of dark haze has very little else to be found by. It
     * is warm because everything that edge-lights anything here is the
     * mountain.
     */
    rimColor: "#ffb066",
    rimIntensity: 0.38,
    /**
     * 185 m, against a ceiling of 189.
     *
     * `ShadowSystem.warnIfWindowIsWasted` derives that ceiling as `2 *
     * halfDepth / cos(elevation)` — `2 * 89 / 0.94` — past which `depthRange`
     * binds along the light whatever this says and the extra metres are texel
     * density spent for nothing. At 185 the ring the player carries is 92 m
     * across-sun and 95 along it, and `fogStart` is 80, so the `edgeFade`
     * gradient runs 83–92 m inside haze that is already thickening. That join
     * is the only reason this number is not smaller: a 20-degree light on a
     * town of six-metre walls does not need 185 m of window for its SHADOWS,
     * it needs it so that the place they stop is somewhere you cannot see.
     *
     * What it costs is 9.0 cm a texel over the fixed 2048 map, between
     * Coldharbour's 9.8 and Hollowmere's 5.4.
     */
    shadowWindow: 185,
    /**
     * **The lamp STAYS, and this is the only map in the tree since Hollowmere
     * that keeps it.** Greyfen, Harrowmead and Sarab all zero it, and all three
     * have the same reason: a carried flame under a lit sky is a torch at noon
     * and it costs one of the sixteen shader slots to prove it. Neither half of
     * that applies here. The sky is dark, the island's own fixtures are eleven
     * lamp posts and a handful of kilns and drums over 1,500 m, and the ground
     * between them — the moor, the lava field, the strand, and the four
     * hundred metres of open bay between the two waterfronts — has no light on
     * it at all beyond a mountain twelve
     * hundred metres away. It is dimmer than the shipped 1.6 because the key
     * light IS warm here and a full-strength shoulder lamp on top of it makes
     * the nearest three metres of ground the brightest thing in the frame.
     */
    lampIntensity: 1.2,
  },
  /**
   * Embers off the crater, rising and carried down the wind.
   *
   * `emissive` and rising, which is the opposite of Hollowmere's falling ash
   * and is the point: what is in this air came out of the mountain. `drift` is
   * matched by hand to `CONFIG.wind.dir` so the embers and the pines agree
   * about a bearing — the field is a velocity and the direction is the wind's,
   * and this is the middle of the three speeds the tree now states, at about
   * half Sarab's.
   *
   * **`count` is a DENSITY because `volume` is stated**, which is the whole of
   * why that field exists: without it the emit box is the map, and 1,300 motes
   * over a 1,500 m square is one per 12,000 cubic metres — air nobody can see.
   * Inside a 250 m box on the eye it is a quiet drift with something in it
   * everywhere you look. It is well past `fogStart` (80), so a mote appears in
   * air already thick enough to hide the appearing; well past what a player
   * crosses in the ~14 s a mote lives; and well inside `fogEnd` (1,250), so
   * nothing in the budget is spent on embers drawn as fog.
   *
   * `size` is the lever rather than the count — Hollowmere's file owns that
   * argument — and 0.09 is small because these are additive against a dark
   * island, where every mote is worth several of one drawn over a lit valley.
   */
  particles: {
    color: "#ff9a4a",
    emissive: true,
    count: 1300,
    size: 0.09,
    volume: 250,
    riseSpeed: 0.34,
    drift: [0.62, 0.5],
  },
  /**
   * A deep violet night with the mountain burning a hole in one side of it.
   *
   * `moonColor` is not a moon: it is the crater, and it is nearly white-hot at
   * the middle because that is the only way a disc reads as a SOURCE rather
   * than as a coloured circle. The heat is in `moonGlowColor`, which is the
   * halo baked round it — the air near the cone lit up — and in
   * `cloudLitColor`, which is the deck over the crater catching it from below.
   * `cloudLitStrength` is the highest in the tree at 0.9 for that reason: an
   * eruption column lighting the underside of the cloud is most of what says
   * the mountain is alive, and the dome is baked ONCE so it costs the frame
   * nothing at all.
   *
   * The stars are the map's other half. They are what make the south and east
   * of the sky read as night rather than as an unlit surface, and
   * `milkyWayColor` is there because the one thing an island under a clear
   * cold sky has that a valley does not is no horizon in the way.
   */
  sky: {
    zenithColor: "#080615",
    horizonColor: "#1f1727",
    starColor: "#cfe0ff",
    starCount: 1500,
    starBrightness: 0.95,
    moonColor: "#ffd9a0",
    moonGlowColor: "#ff7b30",
    milkyWayColor: "#57648f",
    cloudColor: "#171423",
    cloudOpacity: 0.66,
    cloudLitColor: "#ff8b3a",
    cloudLitStrength: 0.9,
    /**
     * A big soft disc. It is not a moon and it is not meant to have an edge —
     * what it stands for is a crater rim glowing over the top of a mountain
     * you can see the shape of below it — so it is larger than any other map's
     * and it is carrying an unusually strong halo.
     */
    discRadius: 15,
    haloStrength: 0.62,
    /**
     * The shafts, and the threshold is the number that matters.
     * `CONFIG.godRays`' luminance test IS the whole occlusion test — there is
     * no depth pass — so what it has to sit above is the brightest thing in
     * the world that is not sky. On this map that is the lit crest of the
     * `gravel` ramp under the key light, which is dark, so 0.62 clears it
     * comfortably while the disc and the lit cloud cross it easily. The
     * intensity is up because this is the one map where the shafts are the
     * subject rather than an atmosphere: they come out of the mountain, and
     * the island's whole skyline is drawn against them.
     */
    rays: { threshold: 0.62, intensity: 0.62 },
  },
  /**
   * The sea, and it is drawn almost entirely as REFLECTION — which is what
   * `WaterEnvSpec`'s header says to expect and what makes these three colours
   * mean less than they look like they should.
   *
   * At the angles a standing player sees water from, the Fresnel is nearly all
   * mirror, so what the ocean IS on this map is the night sky with an erupting
   * mountain in one corner of it, and what these decide is only the last few
   * metres of shoal and what a look straight down into the harbour returns.
   * The deep is near black and the shallow is a saturated cold green, which is
   * the one place on the island a colour is allowed to be that is not fire:
   * the bay is wadeable end to end, and the shoal colour is what tells a
   * player standing on the strand that the water in front of them is.
   *
   * `mirror` is 1 — clean cold ocean over rock, with no peat and no silt in it
   * — and `glint` is up rather than down, which is the opposite of Sarab's
   * call and for the opposite reason. There, a crest sparkle was the term that
   * would have crossed a 0.9 god-ray threshold over pale sand; here the
   * threshold is 0.62 but the surrounding world is dark, and what a moving sea
   * needs against a black island is exactly the hard specular that fires where
   * the mirror returns nothing.
   */
  water: {
    deepColor: "#050d14",
    shallowColor: "#12525a",
    foamColor: "#9fd6d4",
    bedColor: "#241f22",
    mirror: 1,
    glint: 1.15,
  },
  /**
   * Moss and tussock, and the one green on the island.
   *
   * The root sits close to `floorColor`, which is the rule — a field has to
   * read as growing out of the ground rather than as scattered on top of it —
   * and the tip is a long way off it, which is not. On any other map that gap
   * would read as two materials; here it is what moss on basalt actually looks
   * like, and it is the only unlit thing in the world with any chroma in it at
   * all.
   */
  grass: {
    rootColor: "#2a3128",
    tipColor: "#5f8a3e",
  },
  /**
   * A cold, heavy grade.
   *
   * The vignette is the strongest in the tree, and on this map it is doing the
   * work `fogEnd` cannot: the corners of the frame on an island at night are
   * where the sea and the sky meet with nothing in between, and pulling them
   * down is what keeps the eye in the middle where the fight is. Grain is up
   * with it, because a dark frame is where grain reads as film rather than as
   * noise. The aberration stays near the shipped value — this map has no field
   * of thin instances over pale ground for a fringe to speckle on, which is
   * the trap Sarab's file measured.
   */
  grade: {
    vignette: 0.74,
    grain: 0.028,
    aberration: 0.1,
  },
  /**
   * WET stone, and this is the one map in the tree with a better claim to the
   * shipped cobble sheen than the map it was tuned for.
   *
   * `config/graphics.ts` warns the wet-cobble term is tuned against a
   * 38-degree key and that a map moving its light owes a value here. This one
   * moved it to 20, which is a far more grazing angle and fires the lobe much
   * more broadly — so the intensity comes down and the lobe is tightened to
   * compensate, and what is left is a hard cold glitter along the Strand and
   * over the quay rather than a sheen across the whole waterfront. The colour
   * is the SKY's rather than the key's, because what is being reflected off
   * wet basalt at a grazing angle is the thing overhead.
   */
  groundSpec: { color: "#8fb4e8", intensity: 0.055, shininess: 64 },
};
