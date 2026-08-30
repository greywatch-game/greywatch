/**
 * harrowmead/environment.ts — Harrowmead's EnvironmentSpec: palette, fog, sun
 * light, sky, water, drifting hay seed. Pure data — consumed by
 * applyEnvironment/Sky/GodRays/WaterSystem/Atmosphere. Fixture light POSITIONS
 * live in layout.ts, not here.
 */
import type { EnvironmentSpec } from "../environment";

/**
 * Harrowmead: a farming vale at the end of a high-summer day — the hay cut,
 * the light gone long and gold, the sun fourteen degrees over the rim past
 * the west wood.
 *
 * ## The hour
 *
 * The sun stands at 14.5 degrees in the NORTH-WEST, and both numbers are
 * derived rather than picked, exactly as the late-morning pair this file
 * replaced were:
 *
 * - **The elevation sits mid-band, one band down.** The cel key is banded —
 *   `band(sin(elevation), 4)` on a flat floor — and sin(14.5) = 0.250 is the
 *   exact centre of the 0.25 band (7.2..22.0 degrees), so the vale's rolling
 *   ground can tilt a floor facet seven degrees either way before its band
 *   index moves. It is the only sunset elevation with that property: lower
 *   sits against the 7-degree band edge and every hillcrest flickers.
 * - **The azimuth is the FAIRNESS bearing, and it outranks the postcard**,
 *   per Coldharbour's and Greyfen's identical notes. The home spawns are at
 *   (160, 160) and (-160, -160), so the line of advance is the NE-SW
 *   diagonal, and only the two perpendicular bearings (south-east and
 *   north-west) keep the sun out of both teams' eyes for the whole round.
 *   Checked rather than asserted: this vector's horizontal component dots to
 *   0.000 against the spawn diagonal. The south-eastern one was the morning
 *   this map used to be; the north-western one is the evening — and in high
 *   summer at a farming latitude the sun genuinely goes down in the
 *   north-west, so for once the postcard and the fairness agree about where
 *   to put it.
 *
 * ## What the hour changes and what it must not
 *
 * At 14.5 degrees the mill (~10 m, the tallest thing in the vale) throws
 * 39 m of shadow instead of 9, and every hedge lays a stripe across its own
 * field — `shadowWindow` below is what that costs. The key's share of the
 * FLOOR halves (band 0.25 against the morning's 0.75) while a sun-square
 * face lands in the TOP band (cos 14.5 = 0.97), which is what a golden hour
 * IS — the walls double and the ground halves, Coldharbour's note one hour
 * later in its own evening. The compensation lives in `skyLightIntensity`
 * and nowhere else: the gold is the KEY's, and the loam, the turf and the
 * grass keep the colours they had at noon, because an albedo warmed under a
 * warm key double-counts the hour.
 *
 * What did NOT move: `fogEnd` stays 520 — it is a gameplay contract wearing
 * a palette field's clothes (`Game.installMap` pushes it into
 * `BattleSystem`, `RagdollSystem` and `NetRoster`), and the extra depth the
 * hour wants comes from `fogStart` alone, exactly as Coldharbour's file
 * argues. `audio.maxDistance` (70) and `bots.perception.engageRange` (55)
 * have not moved either, so everything the hedged, rolling layout was doing
 * about them it still does.
 */
export const HarrowmeadEnvironment: EnvironmentSpec = {
  /**
   * Dark summer loam under grass. Dark for the reason Greyfen's file argues
   * at length: the key, the ambient and the sky fill all land on one
   * up-facing surface at once, so a floor authored as "lush green" in the
   * swatch renders chalky — and every tuft the layout grows must sit IN the
   * ground, not ON it, which means the gaps between tufts have to stay near
   * the blades' own green. Every tone `turf` paints is derived from this, so
   * re-tinting the vale is this one line.
   *
   * **It did not move when the hour did, and resisting that is the point**
   * (Coldharbour's `floorColor` note, verbatim in spirit): the warm term in
   * an evening frame is the KEY, and warming the albedo underneath it
   * double-counts the hour. What carries the ground instead is
   * `skyLightIntensity`, which went up for exactly this reason.
   */
  floorColor: "#363a22",
  /**
   * The first map on `turf` — matted ground cover rather than bare clods,
   * which is the one honest answer for a valley whose whole premise is that
   * things grow here. `dirt` on the roads' verges is the road builder's
   * business, not the floor's. A low sun rakes a height field far harder
   * than a high one; `turf`'s relief is the shallowest of the four patterns,
   * which is why the hour could drop 35 degrees without re-judging it.
   */
  floorSurface: "turf",
  /**
   * The high downs: grazed summer grass going grey-green with the distance.
   *
   * **It stopped being rock when the rim stopped being a cliff.** The other
   * three maps close on an escarpment and this pair is stone and talus for
   * them; Harrowmead's rim is `form: "downs"` (see the layout), a hillside 280
   * m out with eighty metres of the map's own fields running up to its foot,
   * and chalk grey on it read as a quarry face someone had grassed the
   * approach to. Desaturated and lifted rather than greened outright, because
   * everything at that range is most of the way to `fogColor` already and a
   * saturated hill would fight the haze it is supposed to be dissolving into.
   */
  ridgeColor: "#6d7358",
  /**
   * The hill's foot — and on this form that is the lower PASTURE, not a hem of
   * talus: `DOWNS_SCREE_RING` cuts the two tones at ring 5, which is halfway up
   * the face and eighty-odd metres of run. So this is the tone that has to
   * carry the whole way from the borderland's grass to the crest colour above,
   * and it is `floorColor` lifted toward it rather than a colour of its own.
   *
   * BAKED into the rim material rather than pushed as a uniform, so unlike the
   * rest of this palette it needs the map rebuilt and the editor's work light
   * will not show it.
   */
  ridgeScreeColor: "#464c2e",
  accentColor: "#7fe0a0",
  // Shows only where the dome does not; held near the horizon band so a gap
  // never cuts a seam against the fogged downs.
  skyColor: "#c8a87e",
  /**
   * Gold evening haze — the day's dust and damp with the sun in it. A HUE
   * move against the morning's green-grey, not a value move: luma 0.735
   * against the old 0.74, because every distant surface asymptotes to
   * exactly this colour and its luminance sits under the floor of
   * `sky.rays.threshold`'s bracket (see that field — the horizon band at
   * 0.767 is the bracket's real floor now, and this tucks under it).
   *
   * `fogStart` comes down 120 -> 100: a low sun wants the depth earlier
   * (Coldharbour went 170 -> 130 for the same reason), so the gold air sits
   * over the middle distance of a lane rather than only past the far end of
   * one. `fogEnd` does not move — see the header.
   */
  fogColor: "#d4b28c",
  fogStart: 100,
  fogEnd: 520,
  /**
   * The water meadows breathing out again as the day cools — the morning
   * damp came back with the evening, and now it has a low sun raking
   * through it, which is the one condition under which ground mist reads as
   * LIGHT rather than as weather (Coldharbour's inversion, an hour later).
   * Still thin — 0.16 against Hollowmere's 0.45 — and held at luma 0.722,
   * under the shaft threshold, because the mist is the brightest thing in
   * the lower half of the frame and it must not radiate.
   */
  mistColor: "#cfb593",
  mistHeight: 2.4,
  mistStrength: 0.16,
  lighting: {
    /**
     * Deep gold, and the SATURATION is doing the work the level cannot: the
     * cel shader's soft shoulder compresses anything past 0.75, so a pale
     * bright key (#ffc287 was tried) loses its red channel to the clamp on
     * exactly the sun-square faces the hour exists for and comes back
     * KHAKI. The warmth has to arrive as ratio rather than as brightness —
     * judged from the market green, not the swatch. The gold lives here
     * and not in the albedos under it (Greyfen's rule, doing three times
     * the work now): the hay fields, the thatch and the stream all take
     * the hour from this one line.
     */
    color: "#ffa25c",
    /**
     * 1.0, and the number is the other half of the khaki problem above,
     * derived against the vale's brightest albedo. A sun-square face now
     * lands in the top band (cos 14.5 = 0.97 against the morning wall's
     * 0.66), so the full key plus the ambient lands on plaster of ~0.85 —
     * and the shoulder compresses PER CHANNEL, so the test is the GREEN:
     * at 1.15 both red and green piled against 0.75 and the gold cancelled
     * to khaki; at 1.0 a lit plaster face comes out r 0.80 / g 0.65 —
     * gold. Fields facing the sun sit a band lower and never touch the
     * shoulder, so they keep the whole warmth either way.
     */
    intensity: 1.0,
    // 14.5 degrees up, azimuth north-west. Derivations in the header.
    direction: [0.685, -0.25, -0.685],
    /**
     * Cooled from the midday field-green to a dusk slate, Coldharbour's
     * reason: at a low sun a shadow is filled by the SKY, and the warm/cool
     * split across a hedgerow is what makes the hour read as evening rather
     * than as an orange filter over everything. Up 0.02 rather than down,
     * against Coldharbour's grain, because this map's interiors are barns
     * with one door: the ambient is what keeps a floor you can read a body
     * against while the key leaves the ground.
     */
    ambientColor: "#6f7a88",
    ambientIntensity: 0.34,
    /**
     * The COMPENSATING number, per the header: the floor's share of the key
     * halved when the sun came down (and fell again when the shoulder
     * arithmetic above took the key to 1.0), and this is what keeps a flat
     * field from reading as a hole beside a lit slope. Blue skylight by n.y —
     * full on the fields and the thatch, nothing on the walls, which is
     * also what holds the warm/cool split the ambient starts.
     */
    skyLightColor: "#a3b7dc",
    skyLightIntensity: 0.44,
    /**
     * The one hour a rim light is TRUE: the term fires on steeply-turned
     * facets wherever the sun is, and at 14.5 degrees that is a warm fringe
     * on far hedge lines and rooflines, not wet edges. Still modest, and
     * still judged from a lane at 100 m rather than at a fence — in
     * daylight proper it goes back to 0.1.
     */
    rimColor: "#ffcf9e",
    rimIntensity: 0.16,
    /**
     * 185 against the morning's 150, derived the way Coldharbour's 200 is
     * rather than chosen for comfort: along the sun's own azimuth the depth
     * volume binds first (±89.5 m), and setting the across-sun half to
     * match is `2 * 89.5 / cos(14.5) = 185` — past that the number buys
     * nothing. The window's boundary (where `shadowVisibility` reaches
     * fully lit — a ramp over the last `edgeFade` of the volume rather than
     * the snap this said when it was written) moves from 75 m out to 92,
     * which the hour makes
     * load-bearing twice over: the shadows crossing it are now 39 m mill
     * stripes and whole hedge lines rather than pools at a tree's foot, and
     * the haze that eats the pop now starts at 100. Costs texel density —
     * 9.0 cm against 7.3 at 150 — on shadows whose smallest author is a
     * hedge run two metres tall.
     */
    shadowWindow: 185,
    // No shoulder lamp: the sun is still up. If this vale ever gets a dusk
    // variant, the lamps go in the LAYOUT first — a carried flame at golden
    // hour spends one of the sixteen light slots proving nothing.
    lampIntensity: 0,
  },
  /**
   * Hay seed and thistledown, the air of a mowing valley — now BACKLIT.
   * `emissive: false` was correct at midday (it is chaff, not embers) and
   * inverts with the sun, which is Coldharbour's dust argument an hour
   * earlier: an additive mote adds nothing against a bright sky and reads
   * clearly against a shadowed hedge, which is exactly how seed drift
   * behaves at a low sun — visible where the light is NOT. Colour is the
   * key's own gold; count, size and drift stay, because the wind has not
   * changed, only the light through it (drift still matched by hand to
   * `CONFIG.wind.dir` ([0.78, 0.63]) at ~0.23 m/s).
   */
  particles: {
    color: "#ffdca6",
    emissive: true,
    count: 3600,
    size: 0.1,
    riseSpeed: 0.06,
    drift: [0.18, 0.15],
  },
  /**
   * Sunset: a deep blue still holding overhead, a gold band where the day
   * is going down, and the decks lit from underneath. Star field still
   * zeroed — the sun is UP, and a star over a sunlit field reads as a bug,
   * not an evening.
   */
  sky: {
    // Deepened from the midday luma-0.55 blue to 0.39: honest for the hour,
    // and even further from ever reaching the shaft threshold.
    zenithColor: "#46679e",
    // Required to sit near `fogColor` and slightly above it (luma 0.728
    // against 0.715), so the band reads as the brightest air rather than as
    // more wall. Also now the FLOOR of the rays bracket — see `rays`.
    horizonColor: "#ddb488",
    starColor: "#ffffff",
    starCount: 0,
    starBrightness: 0,
    // The disc: hotter and whiter than its halo, per the sun maps' rule.
    moonColor: "#ffe2b0",
    // The air around the disc, and (through applySky) the tint on the
    // shafts. Deep gold — the first pass at #ffd7a0 washed the halo to
    // white-pink. Luma 0.826: the top anchor of the rays bracket.
    moonGlowColor: "#ffcc92",
    // milkyWayColor omitted — it is not dark yet.
    /**
     * More deck than the morning's fair-weather 0.32 (0.5, between the
     * morning and Coldharbour's 0.62), because the cloud is
     * what a sunset is PAINTED on: the shadowed bodies go mauve while the
     * lit shell — anchored to the sun's own bearing by the static
     * per-vertex mask — catches fire from underneath, exactly where a 14.5
     * degree sun should light it. Lit luma 0.837 is ABOVE the shaft
     * threshold on purpose: a burning deck is sky, and it radiates. The
     * decks were already drifting (Coldharbour's note), so the whole show
     * moves for nothing, and the decks crossing the disc modulate the
     * shafts below for free.
     */
    cloudColor: "#97889b",
    cloudOpacity: 0.5,
    cloudLitColor: "#ffcf9a",
    cloudLitStrength: 0.9,
    // 14, the sun maps' derivation: 1.35 degrees at moonDistance, which the
    // emissive boost and the glow kernel read as a small fierce sun.
    discRadius: 14,
    // Up from the midday 0.5 to Coldharbour's 0.6 for Coldharbour's reason:
    // at this hour the air around the sun is the brightest thing in the sky
    // by a long way, and the halo bleeds below the horizon where the rim
    // and the west wood occlude it.
    haloStrength: 0.6,
    /**
     * The sun is IN frame now whenever the player looks north-west, which
     * is the wash warning Coldharbour documents — a lit sky is half the
     * frame. The threshold is BRACKETED rather than chosen: the floor is
     * the brightest pixel that must NOT radiate, the horizon band at luma
     * 0.728 (fog 0.715 and mist 0.722 tuck under it), and the ceiling is
     * the dimmest sky that MUST — the halo at 0.826, the lit cloud shell
     * at 0.837, the disc above both. 0.78 sits mid-gap. Intensity holds at
     * 0.5: what it buys is shafts through the west wood and the hedgerow
     * gaps, and the night value returns a white wash, not beams.
     */
    rays: { threshold: 0.78, intensity: 0.5 },
  },
  // Up a touch from the morning: this is the hour a real camera vignettes
  // and flares (Coldharbour's note), so the same terms read as a lens
  // rather than a fault. Aberration held at 0.14 — every dark hedge now
  // stands against a bright gold sky, which is exactly the edge it fringes.
  grade: {
    vignette: 0.24,
    grain: 0.02,
    aberration: 0.14,
  },
  /**
   * Re-judged for the new sun, as the old comment here demanded. The term
   * explodes as the key drops — the half-vector converges on the ground's
   * own normal — and at 14.5 degrees looking north-west the cobbles through
   * town would run as a sheet of white at the midday shininess. Warmed to
   * the key and TIGHTENED (34 -> 48) rather than turned up, Coldharbour's
   * move an hour later; intensity held at 0.04 because this is added past
   * the shader's soft shoulder, which makes it the god rays' problem as
   * much as this block's.
   */
  groundSpec: { color: "#ffc784", intensity: 0.04, shininess: 48 },
  /**
   * The mill stream and the water meadows at sunset.
   *
   * **The whole of the note that used to stand here is gone, and what
   * retired it was the shader rather than a re-judgement.** It argued, at
   * length and correctly for the code it was written against, that
   * `shallowColor` was what the water IS — that the Fresnel tipped the whole
   * body toward it at grazing angles, that a stream is only ever seen at
   * grazing angles from its own bank, and that the albedo therefore had to
   * be a cool sky colour PRE-DIVIDED by this map's light transfer, because
   * `albedo * light` through a 14.5-degree key turns any warm tone brown. All
   * of that was true. It was true because the shader had nothing to put at
   * the grazing end of the Fresnel except a second flat colour.
   *
   * **It has a picture there now**, so the two colours below are what they
   * say they are: the body of the water, looking into it. The gold along the
   * horizon arrives as a REFLECTION and is neither multiplied by the key nor
   * pre-divided by anything — which is why the correction the old note made
   * (cool the albedo until the pond stops reading as a mud flat) is no longer
   * load-bearing, and why the cyan it left behind had to go: `#5ccfe6` was a
   * sky colour standing in for a sky, and with the sky itself in the mirror it
   * came back as a lit swimming pool in a hay field.
   *
   * What is here instead is a shallow chalk stream over a silty bed: dark
   * blue-green in the channel, paling toward the margins, with the bed's own
   * colour coming through the last few centimetres off `floorColor` — see
   * `WaterEnvSpec.bedColor`, which this map does not need to state.
   *
   * `glint` stays at 0.2 and the measurement behind it stands, but the reason
   * has narrowed. The Blinn term still barely fires at a 14.5-degree sun —
   * it wants a facet tipped within ten degrees of the half-vector and the
   * relief is centimetres — so it is not what puts light on this water. What
   * does is `CONFIG.water.sunHalo` through the Fresnel, which is the sun's
   * own reach along the water toward the player and is bounded by the sky it
   * is added to. The dial is left where it is because there is still nothing
   * to buy with it and the headroom it protects is still Greyfen's.
   */
  water: {
    deepColor: "#16333a",
    shallowColor: "#3c6f6b",
    foamColor: "#e6efee",
    glint: 0.2,
  },
  /**
   * Unchanged from midday, and that is discipline rather than oversight:
   * the gold lives in the KEY (the floorColor note above), so under the low
   * sun the flats dim toward the root while the west-facing slopes light to
   * gold — which is what an evening field does, and no re-tinted albedo can
   * be right for both at once.
   */
  grass: {
    rootColor: "#2c421f",
    tipColor: "#86b84c",
  },
};
