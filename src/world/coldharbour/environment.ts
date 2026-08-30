/**
 * coldharbour/environment.ts — Coldharbour's EnvironmentSpec: palette, the
 * long-range haze that stands in for fog, a low afternoon sun, the shafts it
 * throws, a warm dust field, no water. Pure data — consumed by
 * applyEnvironment/Sky/GodRays/Atmosphere. Fixture light POSITIONS live in
 * layout.ts.
 */
import type { EnvironmentSpec } from "../environment";

/**
 * Coldharbour: the business district of a city, an hour before dusk, with the
 * fighting in the streets.
 *
 * ## The fog, which is what this map is built around
 *
 * Both shipped valleys state `fogEnd: 78`, and Greyfen's file argues at length
 * that this is a design decision rather than an oversight: the fog wall was the
 * same number as the bot LOD, the ragdoll gate and the distance every other
 * budget was sized against, so "a daylight map that could see 200 m would need
 * every one of those moved together". This is that map, and they moved.
 *
 * What actually changed is that the distance is now the MAP's rather than the
 * config's: `Game.installMap` pushes `fogEnd` into `BattleSystem`, `NetRoster`
 * and `RagdollSystem`, which are the three that gated on `FOG_WALL`. So here a
 * body is drawn, posed and tumbled out to 480 m, and the fog wall as an idea is
 * gone — what is left is aerial perspective, which is a different thing doing a
 * different job.
 *
 * **`fogEnd` is therefore a GAMEPLAY contract wearing a palette field's
 * clothes, and it does not move for a look.** When this map's hour came down,
 * everything else in this file moved and that number did not: the extra depth a
 * low sun wants comes from `fogStart` alone.
 *
 * ## The hour, which is the rest of it
 *
 * This map shipped at three in the afternoon — a 58-degree sun, no disc, no
 * shafts, no particles, near-zero mist and not one outdoor light — and every
 * one of those was correct under that sun and wrong about the map. The file
 * used to argue each refusal separately. They were never separate: they were
 * all the same argument, which is that at a high neutral sun there is nothing
 * for atmosphere to be made OF. Ash reads as snow. Haze reads as smoke. A lamp
 * has nothing to do. Drop the sun and each of those inverts on its own.
 *
 * Three consequences worth knowing before tuning any of this:
 *
 * - **The shadow window is now this map's, and it is 200 m** (see
 *   `lighting.shadowWindow`). At 58 degrees a 40 m tower threw 25 m of shadow
 *   and the shipped 110 m window covered it; at 24 it throws 90 m and does not.
 *   `shadowVisibility` is fully lit outside the window, so the failure is the
 *   shadows STOPPING somewhere the player can see rather than a soft edge —
 *   `CONFIG.graphics.shadows.edgeFade` has since made that stop a gradient
 *   instead of a straight line, which changes how it reads and not where it
 *   is. This map is barely affected either way: at 200 m the boundary is
 *   100 m out and downtown has no 100 m view down a street to put it in.
 * - **There is a disc and there are shafts**, which is the reverse of what this
 *   file said for its whole life. `CONFIG.godRays`' luminance threshold IS the
 *   whole occlusion test and is calibrated against a night street, so it could
 *   not be used under a lit sky at any hour — the answer was to give the number
 *   to the map (`sky.rays`) rather than to give up the effect. See that field
 *   for how 0.82 is bracketed rather than chosen.
 * - **Sound and bot perception still did NOT move with the fog.**
 *   `audio.maxDistance` is 70 m and `bots.perception.engageRange` 55, so you
 *   can see far further than a bot will start shooting and further than you can
 *   hear one. That is deliberate and the LAYOUT is what makes it play: the
 *   avenues are broken by parked traffic, barriers and setbacks so that a clear
 *   line down one is ~110 m rather than the 320 the map is wide. This is the
 *   one of the three that the new hour leaves exactly as it was.
 */
export const ColdharbourEnvironment: EnvironmentSpec = {
  /**
   * Weathered pavement. Everything not roadway is this, which is most of the
   * ground plane, so it is picked dark for a grey: the sky term is applied by
   * `n.y` and the ground is the largest up-facing surface there is, so a slab
   * chosen to look right in isolation comes back white the moment the sun is on
   * it. Greyfen's note on `floorColor` is the same lesson in soil.
   *
   * **It did not move when the hour did, and resisting that is the point.** The
   * key is banded by `dot(n, -lightDir)`, so dropping the sun to 24 degrees
   * takes the ground's key term down by about a third and the temptation is to
   * lift the albedo back. It must not be lifted: the warm term in this frame is
   * the KEY, and warming the albedo underneath it double-counts the hour. What
   * carries the ground instead is `skyLightIntensity`, which went up for
   * exactly this reason.
   */
  floorColor: "#4c4a45",
  /**
   * Weathered paving, and the four surfaces were looked at from the middle of
   * the square before this was picked — which is the only place to judge one,
   * since the floor is what a first-person camera reads for the whole round.
   *
   * `dirt`'s field is fine crazing over a 4 m tile, and in grey it is cracked
   * concrete rather than soil. The other three are all wrong here and wrong in
   * different ways: `gravel` (2.5 m) reads as a loose stone yard, not a
   * pavement, and its finer tile aliases hardest at the distances a map with no
   * fog actually shows you; `sand` puts visible DUNE RIPPLES across the square,
   * which no tint can argue with; and `flat` returns the featureless wash
   * Hollowmere's own note describes, over a map with even fewer height changes
   * to break it up.
   *
   * A low sun rakes a height field far harder than a high one, so this is the
   * choice most worth re-judging on the new hour — from the middle of the
   * square, looking down, which is where it was judged the first time.
   */
  floorSurface: "dirt",
  /**
   * The bluffs the city sits under. Read only by the rim — and on this map you
   * can actually SEE the rim, from anywhere, which is new: on both valleys it
   * is `fogColor` past 78 m and this colour only at the two home spawns. So it
   * is picked as a landform at a distance rather than as rock up close, and it
   * is deliberately close in value to the haze it stands in.
   */
  ridgeColor: "#6a7078",
  /**
   * The rim's foot, melting into `floorColor`. Warmer and near it, per the
   * EnvironmentSpec note: a bright tone here comes back chalky on the ledges.
   *
   * Warmed with the hour — this is the band of the rim a low sun actually
   * rakes. Note it is BAKED into the rim material rather than pushed as a
   * uniform, so unlike everything else in this block it needs the map rebuilt
   * and the editor's work light will not show it.
   */
  ridgeScreeColor: "#71685c",
  /**
   * Unread. `accentColor` is declared here, set by all three maps, and consumed
   * by nothing in the codebase — left alone deliberately rather than pressed
   * into service as a signage colour, which would mean threading the
   * environment through forty builders to give one dead field a job. If it is
   * to be resolved it should be deleted from all three maps in a change of its
   * own.
   */
  accentColor: "#7fd0ff",
  skyColor: "#b8ac97",
  /**
   * Distance, not weather. `fogStart` is beyond the near blocks, so what the
   * term does is put air between them and the far skyline, which is the only
   * thing that makes a city read as deep rather than as a flat elevation.
   *
   * **The colour is a HUE move and nothing else, and that is deliberate.**
   * `#c9bfae` is luma 0.753 — the same as the `#b3c3d2` it replaces, to three
   * places. Every distant surface asymptotes to this colour, which makes its
   * luminance the number that brackets `sky.rays.threshold` from below; moving
   * hue and value at once would have left nothing to reason from.
   *
   * `fogStart` 170 -> 130 because a low sun wants the depth earlier: haze now
   * sits over the middle third of an avenue rather than only past the far end
   * of one. `fogEnd` does not move — see the header.
   */
  fogColor: "#c9bfae",
  fogStart: 130,
  fogEnd: 480,
  /**
   * A shallow warm haze at head height, and the one term on this map that
   * reads as an HOUR rather than as weather.
   *
   * This file used to say a mist here "at any strength reads as smoke, and a
   * city with smoke in it is making a claim the rest of the map does not
   * support". That was true against a 58-degree sun, where a mist layer has
   * nothing raking through it and can only look like something burning. Under a
   * 24-degree one it is the light being visible, which is the opposite claim.
   *
   * It stays thin all the same — 0.11, against Hollowmere's 0.45 — because the
   * argument about smoke was right about the ceiling even where it was wrong
   * about the floor. And it is held at luma 0.753, under the shaft threshold,
   * for the reason `fogColor` is: the ground mist is the brightest thing in the
   * lower half of the frame and it must not radiate.
   */
  mistColor: "#cbbfa9",
  mistHeight: 4.5,
  mistStrength: 0.11,
  lighting: {
    color: "#ffd9a0",
    intensity: 1.12,
    /**
     * An hour before dusk: **24 degrees, azimuth 225 (south-west)**, against
     * the 58 this map shipped at. Both numbers are derived, and neither is a
     * taste decision.
     *
     * **The elevation is where the arithmetic lands.** At 24 degrees a 26 m
     * tower throws 58 m, a 40 m tower 90 m and a lamp column a full avenue's
     * width. It is the lowest sun at which the great majority of the 44 towers
     * still lay a COMPLETE shadow inside the depth volume; below about 20 a
     * dozen of them overrun it, and above about 30 the streets stop being
     * striped and the hour stops reading at all.
     *
     * **The azimuth is a FAIRNESS decision and it outranks the look.** The two
     * home yards are at (-144, 144) and (144, -144), so the map's line of
     * advance is the NW-SE diagonal — and a low sun is a weapon. Every bearing
     * except the two perpendicular to that diagonal hands one team the sun
     * behind them and puts it in the other's eyes for the whole round. Only 45
     * and 225 are neutral, and only 225 is an afternoon. (Checked rather than
     * asserted: this vector's horizontal component dots to zero against the
     * spawn diagonal.)
     *
     * What that costs is the postcard — at 45 degrees to a grid the light
     * lances down no avenue. What it buys is better: every avenue gets a
     * diagonal shadow pattern instead of four being blown out and four in full
     * shade, and every tower's shadow crosses a carriageway rather than running
     * down it. It also makes this file's long-standing "high in the south-west"
     * comment true for the first time — the shipped vector was north-west.
     */
    direction: [0.646, -0.407, 0.646],
    /**
     * Lifted, but well under what the total light budget would take — Greyfen's
     * lesson exactly. Ambient, sky fill and key all add, and the first pass
     * here had all three high: correctly bright, and completely flat, because
     * nothing was left for the key to be brighter than. Ambient gives way
     * because it is the only one of the three carrying no direction, and it is
     * also the one that decides how legible an INTERIOR is — which on this map
     * matters more than on either valley, because there are interiors.
     *
     * Cooled and dropped slightly with the hour. At a low sun a shadow is
     * filled by the SKY rather than by the sun, and the sky is blue; cooling
     * this is what makes the warm/cool split across a street read as a time of
     * day rather than as an orange filter over everything. It comes down by
     * 0.03 and no further, because of the interiors.
     */
    ambientColor: "#7f8a9c",
    ambientIntensity: 0.42,
    /**
     * The sky's own light, and the term that does the most work here. It lands
     * by `n.y`, so it separates every horizontal surface in the city — roadway,
     * pavement, deck, roof — from the vertical ones beside them, which on a map
     * built almost entirely of grey boxes is the only thing keeping the boxes
     * apart. Cool and weak: a saturated tone here tints the whole palette.
     *
     * **This is the one number in the block that is COMPENSATING rather than
     * describing.** The key is banded by `dot(n, -lightDir)`, so dropping the
     * sun took the ground's share of it down by about a third while doubling a
     * sun-facing wall's — the walls double and the ground halves, which is what
     * a golden hour IS. Left alone, the street then reads as a hole. 0.28 ->
     * 0.34 puts it back to where it separates from a sunlit facade rather than
     * disappearing under one.
     */
    skyLightColor: "#a8c4e6",
    skyLightIntensity: 0.34,
    /**
     * Barely there, and it stays barely there. Greyfen's reason still holds: a
     * rim light reads as rim light only against a dark surround, and in
     * daylight it makes edges look wet. It is also a GRAZING-ANGLE term rather
     * than a backlight — it fires on any steeply-turned facet wherever the sun
     * is — so what 0.14 buys is haze on far edges, not a golden fringe on near
     * ones, and it has to be judged from the middle of an avenue at 100 m
     * rather than from a facade you are standing at.
     */
    rimColor: "#ffe3bd",
    rimIntensity: 0.14,
    /**
     * How far this map's shadows are allowed to reach, overriding
     * `CONFIG.graphics.shadows.frustumSize` (110).
     *
     * **200 is derived from the DEPTH volume, not chosen for comfort.** The
     * window is a square perpendicular to the light, so its footprint on the
     * ground stretches by `1/sin(elevation)` along the sun's own azimuth — and
     * along that axis it is `depthRange` that binds, giving ±98 m here. Setting
     * the across-sun half to match is `2 * 89.5 / cos(24) = 196`. Past that this
     * number buys nothing along the sun, and widening `depthRange` to chase it
     * is not free: `shadowParams.x` is a NORMALISED bias, so a deeper volume
     * silently rescales what it means in metres and the failure is peter-panning
     * at the foot of a wall.
     *
     * It costs texel density — `window / mapSize` goes 5.4 cm to 9.8 cm — and
     * that is the honest price of the hour. The four-tap kernel is in TEXELS so
     * it still cancels the staircase, but the distance at which a shadow edge
     * is sub-pixel roughly doubles, and on a city pavement that is an edge you
     * walk over. `mapSize` stays 2048: 4096 would put the texel back under
     * today's, and it is 4x the fill on a pass that runs on most frames, which
     * is not a trade to make before FINDINGS.md's frame-pacing entry is settled.
     */
    shadowWindow: 200,
    /**
     * No shoulder lamp. There is nothing outdoors it could light that the sun
     * is not already lighting, and it would spend one of the sixteen shader
     * slots doing it — slots this map wants for the fixtures the offices carry
     * and the handful the street now carries with them.
     */
    lampIntensity: 0,
  },
  /**
   * Warm dust, drifting slightly up.
   *
   * This file refused a particle field for its whole life, on the grounds that
   * "ash is what tells you Hollowmere is dead; under this sky the same field
   * reads as snow, and dust over a city reads as an event". Both halves of that
   * still hold — but they are arguments about a FIELD, and the tells they name
   * are density, a cold grey-brown tint and a downward fall. Invert all three
   * and the same system says something else entirely: warm, sparse, and rising.
   *
   * **`emissive: true` is the load-bearing choice and it is not about
   * brightness.** It switches `Atmosphere` to additive blending, and an
   * additive mote adds nothing visible against a bright sky while reading
   * clearly against a shadowed facade. That is exactly how airborne dust
   * behaves at a low sun — it is visible where the light is NOT — and it is why
   * this field works at this hour and would have looked like snow at the last
   * one.
   *
   * `size` is the lever rather than `count` (Hollowmere's own note measured the
   * whole range from 140 to 16,000 as nearly indistinguishable), so this is a
   * modest count at a size that reads. At 3,200 the emit rate is ~1,067 and the
   * buffer ~14,900 slots against a 32,000 ceiling — comparable to Hollowmere's
   * and nowhere near the clamp, so `warnIfCeilingClamped` must stay silent.
   * This map also gets better value for the spend than Hollowmere does: there,
   * everything past a 78 m fog wall is paid for and never seen, and here
   * `fogStart` is 130.
   */
  particles: {
    color: "#ffd9a8",
    emissive: true,
    count: 3200,
    size: 0.1,
    riseSpeed: 0.05,
    /**
     * Drifting with the wind rather than milling, and set to match
     * `CONFIG.wind.dir` — the grass on the square, the pines planted in it and
     * the dust over both have to agree about which way the air is moving.
     * Change the bearing there and change this.
     */
    drift: [0.78, 0.63],
  },
  /**
   * An hour before dusk: a warm low sun with a disc, high cloud lit from
   * underneath, and a deep blue still holding at the zenith.
   */
  sky: {
    zenithColor: "#41618f",
    // Close to `fogColor`, so the dome melts into the hazed rim rather than
    // cutting against it — the one hard requirement `SkySpec` states.
    horizonColor: "#cdc0ac",
    starColor: "#ffffff",
    starCount: 0,
    starBrightness: 0,
    moonColor: "#fff0cf",
    moonGlowColor: "#ffd9a2",
    // milkyWayColor omitted — it is not dark yet.
    /**
     * **The cloud is the largest single answer to "nothing moves" on this map,
     * and it costs nothing, because the decks were ALREADY drifting.**
     * `CONFIG.sky.cloudLayers` scrolls them at 0.0035 and -0.0018 uv/s — a
     * circuit in about five and nine minutes — and at the 0.4 opacity this file
     * shipped there was simply nothing up there solid enough to see move.
     * Hollowmere ships 0.72, so 0.62 is well inside precedent.
     *
     * The contrast between a cool shadowed body and a warm lit side is what
     * makes the drift legible, and the lit shell is anchored to the sun by a
     * static per-vertex mask, so at 24 degrees the golden underside sits where
     * it belongs. `cloudBandBottom` is 0.47 — 5.4 degrees of elevation — so at
     * this hour the decks pass IN FRONT OF the sun, and the shafts below are
     * modulated by moving cloud for nothing.
     */
    cloudColor: "#9aa6b4",
    cloudOpacity: 0.62,
    cloudLitColor: "#ffe0b0",
    cloudLitStrength: 0.82,
    /**
     * The disc comes back, at 14 rather than `CONFIG.sky.moonRadius`'s 32.
     *
     * 32 at `moonDistance` 595 subtends 3.1 degrees, which is a moon; 14
     * subtends 1.35, which with `moonEmissiveBoost` and the GlowLayer's kernel
     * reads as a small fierce sun with a bloom around it. It is also what makes
     * the shafts possible at all rather than merely permitted: they need a core
     * in the frame brighter than anything in the world by a margin, and a halo
     * on its own does not give one.
     */
    discRadius: 14,
    /**
     * 0.3 -> 0.6. With no disc the halo WAS the sun and had to be restrained;
     * with a disc it goes back to being the air around it, and at this hour
     * that air is the brightest thing in the sky by a long way. `haloRadius` is
     * 0.42 of the dome's height, so centred at 24 degrees it fills the
     * south-west sky and bleeds below the horizon, where the rim occludes it.
     */
    haloStrength: 0.6,
    /**
     * The shafts' own two numbers. **The threshold is BRACKETED rather than
     * chosen, and both ends are measurable** — which is the only way to set a
     * number that is doing an occlusion test's whole job with no depth pass.
     *
     * The floor is the brightest non-sky pixel in the frame. Every distant
     * surface asymptotes to `fogColor` and the ground mist takes the lower half
     * of the frame toward `mistColor`, and both of those are held at luma
     * 0.753 on purpose. Nothing else in the diffuse world gets near it — the
     * shader's soft shoulder compresses anything over 0.75 anyway.
     *
     * The ceiling is the dimmest sky the shafts can reach: `moonGlowColor` is
     * 0.867 and `cloudLitColor` 0.891, with the disc clamped at 1.0 above them.
     *
     * So 0.82 sits in a gap running 0.758 to 0.867, roughly in the middle of
     * it. **The two things that can still defeat it are the ones added PAST the
     * soft shoulder** — the ground spec and a lit translucent surface — which
     * is why the sheen below is warmed and tightened rather than turned up.
     *
     * `intensity` 1.3 -> 0.5 because the accumulation is a different size on a
     * lit map: at night the sky is a thin band over a near-black village, and
     * here it is half the frame at 0.9 and above. The night number returns a
     * white wash rather than beams.
     */
    rays: { threshold: 0.82, intensity: 0.5 },
  },
  /**
   * The grade comes up a little, and only a little. A vignette that reads as
   * dread over a night village read as a lens FAULT over a flat afternoon —
   * but this is the hour a real camera vignettes and flares, so the same term
   * now reads as a lens instead. It stays modest because the player can turn
   * the grade off entirely, so nothing here may be load-bearing.
   */
  grade: {
    vignette: 0.24,
    grain: 0.015,
    aberration: 0.14,
  },
  /**
   * The wet sheen, warmed to the sun's own colour and TIGHTENED rather than
   * turned up.
   *
   * **Correcting a claim this file used to make: the sheen never touches the
   * roadway.** `buildRoad` takes the textured cobble path only when `surface`
   * is neither `dirt` nor `asphalt`, and every avenue on this map states
   * `asphalt` — a flat tone with no spec at all. The only cobble on Coldharbour
   * is the four 4 x 27 m paths across the civic square: 432 m², not "the
   * roadway".
   *
   * That is what makes a low sun affordable here. The term explodes as the key
   * light drops — the half-vector converges on the ground's own normal — and at
   * 24 degrees looking toward the sun it would be a sheet of white if it
   * reached the avenues. Over 432 m² of path it is a streak on the square.
   * Shininess 20 -> 34 to keep it a streak rather than a wash, and the
   * intensity is HELD: this is one of only two things in the frame added past
   * the shader's soft shoulder, which makes it the god rays' problem as much as
   * this block's.
   */
  groundSpec: { color: "#ffdcae", intensity: 0.05, shininess: 34 },
  // No water: the rect list has no entry, so a palette here would be dead
  // weight. See `WaterEnvSpec` — omitting it is what leaves the map dry.
  /**
   * The civic square's lawn, and the one green thing on the map.
   *
   * This file used to say "no water and no grass ... which is what a downtown
   * is", and the second half of that was wrong about downtowns rather than
   * about this one: a business district has exactly one planted place in it,
   * and it is the square everybody walks through. The rest of the city is
   * still bald, because `GrassSystem` grows only what the rects ask for.
   *
   * Tuned brighter and greener than either valley — Hollowmere's field is dead
   * and Greyfen's is jungle understorey, and both are lit by something far
   * dimmer than this. The root still sits close to `floorColor` (#4c4a45) in
   * VALUE if not in hue, which is what `GrassEnvSpec` asks for: the lawn has to
   * read as growing out of the ground rather than as a green mat laid on it,
   * and the tufts are thin enough that the floor shows between them from any
   * distance at all.
   */
  grass: {
    rootColor: "#3d4a2e",
    tipColor: "#7d9c4a",
  },
};
