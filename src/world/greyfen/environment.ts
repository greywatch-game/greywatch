/**
 * greyfen/environment.ts — Greyfen's EnvironmentSpec: palette, fog, sun light,
 * the shafts it throws through the canopy, sky, water, drifting spores. Pure
 * data — consumed by applyEnvironment/Sky/GodRays/WaterSystem/Atmosphere.
 * Fixture light POSITIONS live in layout.ts, not here.
 */
import type { EnvironmentSpec } from "../environment";

/**
 * Greyfen: the same drowned valley, an hour or two after sunrise, with the sun
 * off the eastern rim and burning down through the canopy.
 *
 * ## The hour, which is what everything else here follows from
 *
 * This map shipped as an OVERCAST first light — a white lid of cloud, no disc,
 * no shafts, and a light budget of ambient 0.7 plus sky fill 0.3 against a key
 * of 1.12. Every one of those was internally consistent and the set of them was
 * wrong about the setting, in exactly the way Coldharbour's own file describes
 * from the other end: under a flat dome there is nothing for atmosphere to be
 * made OF, and there is nothing for a KEY light to be brighter than.
 *
 * Two symptoms, and they were the same cause:
 *
 * - **No shafts.** `discRadius: 0` suppresses the disc and, through the
 *   moon-direction contract `Sky` and `GodRays` share, the light shafts with
 *   it. A shaft broken by a canopy is the single most iconic jungle image there
 *   is, and this map already had the canopy to break it — five belts of
 *   hardwoods whose lowest frond hangs at 9 m with a mid-story of veils under
 *   that. The overcast premise was the only thing in the way.
 * - **Flat light.** Ambient and sky fill together put 0.62 of every up-facing
 *   albedo and 0.50 of every vertical one on screen before the key light was
 *   consulted, so a trunk's sunward face and its shaded face differed by 2.1x
 *   and the hardwoods came out as pale grey-green concrete. A jungle wants the
 *   opposite: a dark floor with bright gaps punched in it.
 *
 * So the ambient gives way (0.7 -> 0.24) and the key takes what it gave up
 * (1.12 -> 1.55). On the same bark that is 2.1x becoming 9x, which is the whole
 * of the second symptom. The FIRST is what the ambient buys as well as the
 * trunks: `sky.rays.threshold` is an occlusion test done in luminance with no
 * depth pass, so it only separates sky from world on a map whose world is
 * darker than its sky — see that field, where the bracket is measured.
 *
 * ## What did NOT move
 *
 * **`fogEnd` stays at 78.** `FOG_WALL` in `config/fogWall.ts` is the same
 * number as `bots.lodDisableDistance` and `bots.death.maxDistance`, and it is
 * also what `bots.perception.engageRange` (55) and `audio.maxDistance` (70)
 * were sized against. Coldharbour is the map that moved them, at the cost of a
 * layout built around the move; this valley is a fog that happens to be lit, so
 * none of them move. What the new hour wanted from depth it got from the light
 * instead of from distance.
 *
 * **`fogColor` stays green and stays bright.** Its own note below is still the
 * governing one — the haze is what a silhouette at 60 m is read against, and
 * the green is reconstructing a depth cue the geometry cannot give away. It is
 * also, now, the floor of the shaft threshold's bracket, which is a second
 * reason not to touch it.
 *
 * **`floorColor` stays dark.** The temptation on dropping the sun is to lift
 * the albedo back, and Coldharbour's file names it: the warm term in this frame
 * is the KEY, and warming the ground underneath it double-counts the hour.
 */
export const GreyfenEnvironment: EnvironmentSpec = {
  /**
   * Shaded leaf litter: a dark olive-brown, well down from the grey-green stone
   * this map started on and down again from the warm red-brown that replaced
   * it. The sky term lifts albedo, so a floor much brighter than this comes
   * back chalky on every up-facing surface once the ambient is raised too —
   * which is the ceiling a bright soil runs into, and why this one is dark for
   * a brown.
   *
   * **It was 0x4a3928, and what moved it was the grass rather than the soil.**
   * That value is authored in display space and then multiplied by the key, the
   * ambient and the sky fill all landing on one up-facing surface at once, so a
   * floor picked as loam in the swatch renders about 2.5x brighter and arrives
   * as bright tan — savannah earth, on a map whose whole argument is that it is
   * wet. It read as a floor with nothing on it, and every tuft the layout now
   * grows sat ON it as a bright green mark rather than IN it. What fixed the
   * undergrowth was not more undergrowth: at the density the layout can afford
   * (see its note — the field is already half of this map's triangles) the
   * tufts are always going to be discrete, so what decides whether they read as
   * ground cover or as scattered weeds is how far the gaps between them are
   * from the green. Dropping the floor closes that gap from both ends.
   *
   * **It did NOT come back up when the sun came out, and resisting that is the
   * point.** The ambient dropped by two thirds, so this albedo now returns
   * roughly a third of what it did in shade — which looks like a floor that
   * went too dark and is actually the feature: the dapple is only a dapple if
   * the ground between the gaps is dark. What carries the shaded floor instead
   * is that the gaps beside it are three times brighter, and what carries the
   * FAR floor is that it is fog well before it is anything else.
   *
   * It is also the only colour the surface below is painted in: every tone
   * `dirt` puts on the ground is derived from this, so re-tinting the valley
   * is this one line.
   */
  floorColor: "#352f20",
  /**
   * Clods and grit rather than the flat colour Hollowmere's floor is. A jungle
   * valley is soil underfoot, and at 4 m a tile the grain is still legible at
   * the eye height a first-person camera reads the ground from.
   *
   * Worth re-judging on the new hour and it survived it: a low sun rakes a
   * height field far harder than a high one, and what that does here is put
   * relief on the clods instead of washing them out — the same change that made
   * this surface worth having in the first place, one step further on.
   */
  floorSurface: "dirt",
  ridgeColor: "#5c6360",
  // Moved with the floor: this band's whole job is melting the rim's foot into
  // `floorColor`, so it follows the soil rather than the rock above it.
  ridgeScreeColor: "#55503c",
  accentColor: "#7fe0a0",
  // Moved with the fog. Only the clear colour, so it shows where the dome
  // does not — but a blue backdrop behind a green wall is a seam waiting to
  // be found.
  skyColor: "#b3c1a6",
  /**
   * The haze is the light here, the same way the fog was the moonlight on
   * Hollowmere — but it is a bright wall rather than a dark one, so a
   * silhouette at 60 m reads as a dark shape against pale air instead of a
   * pale shape against dark. `fogStart` is pushed out because a bright fog
   * that begins too near flattens the middle distance into nothing.
   *
   * **It is GREEN, and that is doing a job the geometry cannot.** It was a
   * cold blue-grey, which is honest about what air is and wrong about what a
   * jungle looks like. What actually makes a rainforest read green at distance
   * is not the air — it is that every sight line past thirty metres passes
   * through several layers of leaf, so each plane arrives greener and hazier
   * than the last. This engine cannot give that away: fog is one flat colour
   * per pixel, resolved against distance, and the world beyond the near belt is
   * spaced trunks with sky between them. A neutral fog therefore washed every
   * far tree to white and threw away the one depth cue the setting owns. Tinting
   * the wall itself is the cheap reconstruction of it, and at this range it is
   * indistinguishable from the real thing.
   *
   * Held to a green-GREY. A saturated green here stops reading as distance and
   * starts reading as gas, and the luminance stays near what the blue-grey had
   * (188 against 202) because the note above is still the governing one: this
   * fog is the light, and a silhouette at 60 m has to stay a dark shape on a
   * pale field. It comes down slightly rather than not at all, which is worth
   * a little body in the middle distance.
   *
   * **Luma 0.737, and that number is now load-bearing twice.** Every distant
   * surface on the map asymptotes to exactly this colour, so it is the
   * brightest thing in the frame that is not sky — which makes it the floor of
   * `sky.rays.threshold`'s bracket. Raising it narrows the gap the shafts live
   * in from below; the ground mist is held under it for the same reason.
   *
   * `SkySpec.horizonColor` moves with it — see its own contract, which requires
   * it to sit near this or the dome cuts a line against the fogged ridge — and
   * so does `skyColor`, which is what shows where the dome does not.
   */
  fogColor: "#b5c4a4",
  fogStart: 34,
  fogEnd: 78,
  /**
   * Follows the fog, and stays the paler of the two: this is the layer nearest
   * the ground, where the light has the least depth of air to cross.
   *
   * Luma 0.787, which is above `fogColor` and still under the shaft threshold —
   * and it can never be reached anyway. The mist is a `mix` toward this at
   * `mistStrength`, so it pulls a bright surface DOWN as readily as it lifts a
   * dark one; 0.787 is the ceiling of a term that peaks at 0.28 of the way
   * there. What it is allowed to do, and does far more of now, is separate a
   * dark forest floor from the pale wall behind it.
   */
  mistColor: "#c4cfb4",
  mistHeight: 2.4,
  // Ground mist survives the sunrise — it is the one bit of Hollowmere's
  // weather that belongs to a wet morning as much as to a night, and it is the
  // half of the atmosphere the shafts are struck THROUGH.
  mistStrength: 0.28,
  lighting: {
    /**
     * Warm, because a sun two hours up is warm and because the warmth has to
     * live in the KEY rather than in the albedos it lands on — see
     * `floorColor`. Not as far over as Coldharbour's dusk (`#ffd9a0`): this is
     * a morning, and past about here the green world under it starts reading as
     * yellow rather than as lit.
     */
    color: "#ffeec9",
    /**
     * 1.12 -> 1.55, and every bit of it came out of the ambient below.
     *
     * **On a flat floor the key's own contribution barely moves, and that is
     * what the 38% is FOR.** The term is `intensity * band(sin(elevation), 4)`,
     * which is `1.12 * 0.75` = 0.84 at the old 52 degrees and `1.55 * 0.5` =
     * 0.78 at the new 28 — so raising the intensity very nearly pays for the
     * band the lower sun costs. What moves is everything around it: the total
     * on a sunlit up-facing surface goes 1.46 -> 0.99 and on a shaded one
     * 0.74 -> 0.32, so the step across a shadow edge on the ground goes
     * 2.0x -> 3.1x.
     *
     * **On a VERTICAL surface it moves the other way**, because the key's band
     * there is `cos(elevation)` rather than `sin`: a trunk's sunward face goes
     * 1.15 -> 1.44 while its shaded face goes 0.54 -> 0.16. The walls gain and
     * the ground loses, which is what a low sun IS — Coldharbour's file says
     * the same thing from the other end and COMPENSATES for it, because a city
     * of grey boxes needs its streets legible. Here it is the feature: it is
     * where the trunks stop being concrete.
     */
    intensity: 1.55,
    /**
     * **28 degrees, azimuth 043 (north-east)**, against the ~52 this map
     * shipped at. Both numbers are derived.
     *
     * **The elevation is bracketed at both ends and the bracket is narrow.**
     * From below, the key light is banded — `band(dot(n, -lightDir), 4.0)` —
     * and a flat floor's term is `sin(elevation)` quantized into quarters, so
     * anywhere between about 27 and 39 degrees the floor sits squarely inside
     * one band (0.5) and nothing wobbles; under ~23.5 it drops a whole band to
     * 0.375 and the valley floor loses a quarter of its key for one degree of
     * movement. From above, the shafts need the sun near enough to the frame to
     * be worth having: `GodRays` fades on screen radii from centre (`fadeStart`
     * 0.55, `fadeEnd` 1.25) and at `fovHip` 0.95 a sun at 28 degrees projects
     * to uv y 1.018 with the view level — 1.04 radii out, `presence` 0.31 — and
     * is at full strength by about 12 degrees of look-up. Measured at 2 degrees
     * of pitch: uv y 0.974, presence 0.43. So there is a hint of shafts
     * standing still and the whole of them the moment you look up at the
     * canopy, which is where the image is. At the shipped 52 it was off the top
     * of the screen from every stance.
     *
     * **The azimuth is a FAIRNESS decision and it outranks the postcard**, per
     * Coldharbour's identical note. The home spawns are at (-100, 96) and
     * (105, -96), so the line of advance is the NW-SE diagonal, and a low sun
     * is a weapon: every bearing but the two perpendicular to that diagonal
     * puts it behind one team and in the other's eyes for the whole round.
     * Checked rather than asserted — this vector's horizontal component dots to
     * -0.0006 against the spawn diagonal. Of the two perpendicular bearings
     * only the north-eastern one is a morning, and a tropical valley is exactly
     * where a sun that far north of east is honest.
     */
    direction: [-0.604, -0.469, -0.644],
    /**
     * **0.7 -> 0.24, and this is the change gap 7 actually was.**
     *
     * Ambient, sky fill and key all add, and the shipped map put all three
     * high: the result was correctly bright and completely flat, because
     * nothing was left for the key light to be brighter THAN. This is the term
     * that gives way, since it is the only one of the three that carries no
     * direction at all — and on this map it gives way much further than it did
     * on Coldharbour (0.42), because a city has interiors to keep legible and a
     * forest floor is supposed to be dark.
     *
     * **GREEN now, and the split with the sky fill below is the point.** A
     * shaded surface under a canopy is lit by two different things: skylight
     * through the gaps, which is blue and arrives from ABOVE, and light that
     * came through a leaf on its way, which is green and arrives from
     * everywhere. The sky fill is applied by `n.y` and this term is not, so
     * putting the blue in that one and the green in this one is not a tint
     * choice — it is the two sources landing where they actually land. What it
     * buys is that undersides, trunk backs and the inside of every hut go
     * green while the ground and the fronds above them stay cool.
     */
    ambientColor: "#63795c",
    ambientIntensity: 0.24,
    /**
     * Skylight through the canopy gaps: cool, weak, and applied by `n.y`, so it
     * lands full on the floor and the fronds and nothing at all underneath.
     * Never gated by the shadow map, which is the point — a patch of floor in
     * the canopy's shadow still faces the sky.
     *
     * It came down 0.3 -> 0.16 with the ambient rather than up the way
     * Coldharbour's did, and the two maps disagreeing here is a real
     * disagreement rather than an inconsistency. There, the term is
     * COMPENSATING: a city of grey boxes needs its horizontal surfaces
     * separated from its vertical ones or the street reads as a hole. Here the
     * horizontal surface IS the thing that has to go dark, and it is the one
     * surface the shadow map is drawing a pattern on — lifting it back would
     * fill the pattern in.
     *
     * Bluer than the overcast dome it used to describe (`#c4cdd6`), because
     * there is a real sky up there now and the ambient beside it has taken the
     * green.
     */
    skyLightColor: "#9fbcd4",
    skyLightIntensity: 0.16,
    // Barely there. A rim light reads as rim light only when the surround is
    // dark; in daylight it just makes edges look wet. It is also a
    // grazing-angle term rather than a backlight, so what it buys at this
    // strength is haze on far edges and not a gold fringe on near ones.
    rimColor: "#e8f0ff",
    rimIntensity: 0.12,
    /**
     * How far this map's shadows are allowed to reach, overriding
     * `CONFIG.graphics.shadows.frustumSize` (110).
     *
     * **The sun coming down is what made this the map's**, and the reason is
     * the canopy rather than the height of anything. At the shipped ~52 degrees
     * a frond 10 m up laid its shadow 8 m from its own trunk, so the dapple
     * never travelled; at 28 it lands 19 m away, and the pattern on the floor
     * is made of canopy the player is not standing under. `shadowVisibility` is
     * fully lit outside the window, so what that costs at 110 m is the dapple
     * ENDING on the forest floor at 55 m — dappled inside it, uniformly bright
     * beyond — sliding with the player, and the contrast this file just bought
     * is exactly what makes it visible.
     * `CONFIG.graphics.shadows.edgeFade` ramps the last tenth of the volume
     * back to lit, so it is a gradient rather than a line now; on a floor made
     * of dapple that helps more than it does on open ground, because what
     * fades out is a pattern and not an edge.
     *
     * 140 puts that edge at 70 m, where the fog is already 67% of the way to
     * `fogColor` and the line has nothing left to draw itself with. It is not
     * derived from the depth volume the way Coldharbour's 200 is: at 28 degrees
     * the along-sun reach is `2 * 89.5 / cos(28)` = +/-101 m and the across-sun
     * half is what this buys, so the binding constraint here is the fog and not
     * the geometry. Past ~156 (the fog wall) it would buy nothing at all.
     *
     * It costs texel density — `window / mapSize` goes 5.4 cm to 6.8 cm — which
     * is a quarter of what the same argument costs Coldharbour, and the thing
     * being drawn is a frond about a metre across.
     */
    shadowWindow: 140,
    // No shoulder lamp: there is nothing here it could light, and it would
    // spend one of the sixteen point-light slots doing it.
    lampIntensity: 0,
  },
  /**
   * Pollen and spores: the air of a wet forest, which has things living in it.
   *
   * **This was omitted, and the reasoning for omitting it was half right.**
   * Hollowmere's ash FALLS because falling is what says the valley is dead, and
   * a pale field falling under a bright sky reads as snow — a different claim
   * about the weather, made by accident. All true, and none of it an argument
   * for empty air. The fix is not to re-tint the ash but to invert what it is
   * doing: this drifts UP, slowly, which is the thing the ash was avoiding
   * saying.
   *
   * Non-emissive, because emissive is what an ember is and there is nothing
   * burning here. That leaves it alpha-blended, which decides where it can be
   * seen: a pale mote over the pale fog band is invisible and the same mote
   * over the shaded floor, the trunks and the canopy reads clearly. That is not
   * a compromise — it is what motes actually do. You see them against shadow.
   * The darker floor this file's new hour brought is more shadow to see them
   * against, so the field reads harder now at the same count.
   *
   * `size` is the lever and `count` is not, per Hollowmere's note; 0.11 is a
   * touch under its ash because a spore is finer than a fleck of ash, and the
   * count buys the density back. 4,800 is an emit rate of 1,600 and a buffer of
   * 22,400 slots, comfortably inside the 32,000 ceiling.
   *
   * **The drift is the valley's own bearing, and it only started mattering when
   * the layout grew grass to compare it against — and matters more now that the
   * canopy over it leans the same way.** `ParticleSpec.drift` exists so the dust
   * and the grass agree about which way the air is going, and it is matched by
   * hand — `CONFIG.wind.dir` is [0.78, 0.63] and this is that direction at
   * about 0.22 m/s. Deliberately far under the ±0.35 lateral jitter the field
   * has anyway, so the air still reads as HANGING, the way still, wet air under
   * a canopy does, while agreeing with the blades about the bearing.
   */
  particles: {
    color: "#d9d29a",
    emissive: false,
    count: 4800,
    size: 0.11,
    riseSpeed: 0.12,
    drift: [0.17, 0.14],
  },
  /**
   * Two hours after sunrise: a small fierce sun with a broken deck of cloud
   * drifting across it, and a morning blue holding above the haze.
   *
   * The whole block used to read "an overcast dawn: no disc, no stars, and a
   * low sun's warmth smeared across a white lid of cloud". What made that
   * premise expensive is that `discRadius: 0` does not merely omit a disc — it
   * hands `GodRays` a zero direction, which is the contract `Sky.clear()`
   * documents for "nothing to converge on", and takes the shafts off the camera
   * with it. So the lid was buying an overcast look at the price of the one
   * image this map is best placed in the whole game to make.
   */
  sky: {
    // A real morning blue, and it has somewhere to be now that the deck is
    // broken. Held well under the halo it is seen beside — luma 0.51, so it
    // cannot reach the shaft threshold from any angle, and the ~0.29 it sits
    // below the horizon band is what gives the dome a gradient to read as
    // depth rather than as a lid.
    zenithColor: "#6188b0",
    // Required to sit near `fogColor` (see `SkySpec`), so it moved with it —
    // and kept the ~17 of luminance it had over the fog, which is what makes
    // the band read as the brightest part of the sky rather than as more wall.
    horizonColor: "#c6d3b6",
    starColor: "#ffffff",
    starCount: 0,
    starBrightness: 0,
    // The sun's own disc: hotter and whiter than the halo around it, which is
    // what a disc has to be to survive `moonEmissiveBoost` and the GlowLayer
    // without turning into a cream blob.
    moonColor: "#fff6dc",
    /**
     * The air around the disc — and, through `Game.applySky`, the tint on the
     * shafts themselves, which is why it is the warmest thing in the block.
     * Luma 0.902: this is the ceiling of `rays.threshold`'s bracket, since it
     * is the dimmest thing the shafts are allowed to radiate from.
     */
    moonGlowColor: "#ffe4b0",
    // milkyWayColor omitted — a galactic band two hours after sunrise.
    /**
     * The lid comes apart. 0.92 -> 0.55, which is what turns an overcast into
     * high broken cloud with sky behind it, and `cloudBandBottom` is 0.47 — so
     * the decks pass IN FRONT OF a sun at 28 degrees and the shafts below are
     * modulated by moving cloud for nothing. The body cools and darkens to
     * match: a deck that is not the light source any more is the shadowed half
     * of a cloud, and it needs to be darker than the halo behind it or the sky
     * has no depth at all.
     */
    cloudColor: "#aab6be",
    cloudOpacity: 0.55,
    // The lit side, anchored to the sun by a static per-vertex mask. Warmer and
    // much stronger than the overcast version, because there is now a direction
    // for it to be lit FROM.
    cloudLitColor: "#ffeed2",
    cloudLitStrength: 0.75,
    /**
     * The disc comes back, at 14 rather than `CONFIG.sky.moonRadius`'s 32 —
     * Coldharbour's number and Coldharbour's derivation. 32 at `moonDistance`
     * 595 subtends 3.1 degrees, which is a moon; 14 subtends 1.35, which with
     * `moonEmissiveBoost` and the GlowLayer's kernel reads as a small fierce
     * sun. It is also what makes the shafts possible rather than merely
     * permitted: they need a core in frame brighter than anything in the world
     * by a margin, and a halo on its own does not give one.
     */
    discRadius: 14,
    /**
     * 0.34 -> 0.42, and this one was BRACKETED by photograph rather than
     * argued, because it is doing two jobs that pull against each other.
     *
     * With no disc the halo WAS the sun; with a disc it goes back to being the
     * air around it — and it is also the SOURCE the shafts are struck from,
     * since `rays.threshold` only passes what is brighter than 0.82 and on
     * this map that is the disc plus whatever the halo lifts near it.
     * `haloRadius` is 0.42 of the dome's HEIGHT, so whatever this number does
     * it does across tens of degrees of sky.
     *
     * - **0.55 was too much.** The dome under it is already luma ~0.72 at this
     *   elevation, so everything inside about 56% of that radius saturates and
     *   the whole north-east comes back as one white blob with the disc lost
     *   inside it — which is the overcast lid this file's header just got rid
     *   of, drawn brighter.
     * - **0.26 was too little.** The sun read beautifully, a distinct hot disc
     *   with a modest glow measured falling to 0.76 at 140 px. But the region
     *   over the threshold shrank with it and the shafts lost their fan: a
     *   frond 80 px off the sun took +0.03 at `intensity` 0.8, against +0.09 at
     *   this value, and the beams stopped reaching past the crown.
     *
     * So 0.42: a core that still reads as a disc, with enough lifted air around
     * it to be a source. Under Coldharbour's 0.6 because the halo here competes
     * with a fog wall at luma 0.737 rather than with a haze that starts at
     * 130 m — the sky's advantage over the world is smaller on this map, and
     * the halo is the term that would spend it.
     */
    haloStrength: 0.42,
    /**
     * The shafts' own two numbers. **The threshold is BRACKETED rather than
     * chosen, and both ends are measurable** — which is the only honest way to
     * set a number doing an occlusion test's whole job with no depth pass.
     *
     * The floor is the brightest non-sky pixel in the frame, and it is
     * MEASURED. Every distant surface asymptotes to `fogColor` at luma 0.737
     * and nothing in the diffuse world gets past it: the shader's soft shoulder
     * compresses anything over 0.75, the ground mist is a `mix` toward 0.787
     * that peaks at 0.28 of the way there, and the sunlit forest floor comes
     * back at 0.16-0.22 against 0.06-0.10 in the canopy's shade. Photographed
     * from inside belt 2 with the sun behind the camera, the whole frame peaks
     * at 0.795 and NOTHING crosses 0.82; over the flooded basin, masking every
     * pixel over the line puts all of them above the horizon and none in the
     * water, its foam or its flecks, which top out at 0.766.
     *
     * The ceiling is the dimmest sky the shafts can reach: `moonGlowColor` is
     * 0.902 and `cloudLitColor` 0.941, with the disc clamped at 1.0 above them.
     *
     * So 0.82 sits in a gap running 0.737 to 0.902, and it is deliberately
     * nearer the middle than the floor because the two things that can still
     * defeat it are added PAST the soft shoulder and are therefore unbounded by
     * it: the ground sheen (`groundSpec`, warmed and tightened below for
     * exactly this reason) and the water's glint, which is why `water.glint`
     * came DOWN when the sun came out rather than up.
     *
     * **`intensity` goes UP, 1.3 -> 2.0, and it is the one number in this file
     * that disagrees with Coldharbour** — which took the same term the other
     * way, to 0.5, on the argument that a lit sky is half the frame at 0.9 and
     * the night value returns a white wash. Both are right, because the number
     * is not a statement about how bright the sky is. It is a statement about
     * how much of that brightness the accumulation can actually REACH, and
     * three things take it away here:
     *
     * - **The source is small.** Coldharbour's sky over 0.82 is a whole
     *   quadrant of a 480 m view. Here it is the disc and what the halo lifts
     *   around it, because the rest of the sky is within 0.07 of the fog wall —
     *   the fog IS the light on this map, which is exactly what stops the rest
     *   of the sky being a source.
     * - **The canopy eats the walk.** `density` is 0.55, so a tap covers only
     *   part of the way to the sun, and under a belt most of that is trunk and
     *   frond. Measured from inside belt 2 at `intensity` 0.5: the frame mean
     *   moved 0.393 -> 0.398 and nothing was visible at all.
     * - **`decay` runs on blocked taps too.** `illum` falls 0.96 per sample
     *   whether or not that sample contributed, so a beam starting behind a
     *   crown arrives with a fraction of an open one's weight.
     *
     * At 2.0 a frond 80 px off the sun goes 0.148 -> 0.289, which is the fan
     * reading rather than a wash — it lands on foliage at a fifth of full
     * white, not on sky already clipped at 1.0. The wash Coldharbour warns
     * about happens to a frame whose bright half is reachable; under a canopy
     * it is not.
     */
    rays: { threshold: 0.82, intensity: 2.0 },
  },
  /**
   * The grade the map is seen through.
   *
   * Hollowmere's heavy vignette is dread; on a bright frame the same number
   * reads as a lens fault. The aberration is the one that had to be MEASURED
   * rather than reasoned about: it was left at the shipped 0.55 on the
   * argument that it is the only term still doing anything at this
   * brightness, and the first screenshot showed why that was wrong — the
   * effect scales with local contrast, and a pale sky behind dark bots is
   * nothing but high-contrast edges, so every silhouette on screen picked up
   * a colour fringe. It is a night map's number.
   *
   * The vignette comes up a little with the hour, and only a little. This is
   * the hour a real camera vignettes and flares, so the same term that read as
   * a fault under a flat dome now reads as a lens — but the player can turn the
   * grade off entirely, so nothing here may be load-bearing.
   */
  grade: {
    vignette: 0.26,
    grain: 0.02,
    aberration: 0.16,
  },
  /**
   * The wet sheen on the paved ground, overriding `CONFIG.graphics.spec.cobble`.
   *
   * **Warmed and tightened rather than turned down, and the reason is the
   * shafts.** This is one of only two things in the frame added past the
   * shader's soft shoulder (the other is a lit translucent surface), so it is
   * the god rays' problem as much as the ground's: an intensity that reads as
   * wet stone under a broad grey sky reads as a radiating slab under a 28
   * degree sun, and the threshold above has no headroom to give it. Shininess
   * 14 -> 30 confines the streak to the angles a raking sun actually produces
   * one at, and the colour follows the key light rather than the old overcast
   * grey.
   */
  groundSpec: { color: "#ffe4bc", intensity: 0.05, shininess: 30 },
  water: {
    deepColor: "#3f5148",
    shallowColor: "#7d9b90",
    foamColor: "#dfe8e2",
    /**
     * **It came DOWN when the sun came out, which is the opposite of the
     * obvious move and is the same argument the field's own contract makes.**
     *
     * The glint is a picture of the light SOURCE, and under the overcast dome
     * the source was the whole sky, so 0.3 was already restraint — a broad
     * sheen the width of a flooded valley. There is a disc now, which argues
     * for a small hard sparkle; what argues against turning the number UP is
     * the arithmetic. The term is `lightColor * specStrength * glint`, added
     * RAW past the cel shader's soft shoulder, so it scales straight with the
     * key — and the key went up 38% with the hour. At 0.3 the lobe adds
     * `1.55 * 0.9 * 0.3` = 0.42 of the key's colour on top of whatever the
     * water already is; at 0.22 it adds 0.31.
     *
     * That difference is most of the margin. Measured over the confluence
     * basin at 0.22, **nothing below the horizon reaches 0.77** against a
     * `sky.rays.threshold` of 0.82 — water, foam and flecks included, and the
     * only pixels in the frame over the line are sky. What the extra 0.08
     * would buy on the far side of it is not a brighter river: it is a river
     * that stops occluding and starts throwing shafts of its own from below
     * the horizon.
     *
     * **The water became a mirror after this was written, and the margin
     * survived it — measured again rather than assumed.** The obvious fear is
     * that a Fresnel returning the sky at every grazing angle is a sheet of
     * sky lying under the horizon, which is the one thing the threshold
     * cannot have. It is not, and the reason is the arithmetic this note
     * already makes: what the mirror returns is the DOME, and the dome below
     * its own bright band is darker than the lit water it replaced. Over the
     * same basin, along the sun and across it, the reflection LOWERED the
     * frame maximum in the bottom 45% — 0.924 against 0.940 with the mirror
     * muted — and halved the fraction over the line, and what is left over it
     * is sky seen through the canopy rather than anything on the river.
     *
     * The term that could still cross it is `CONFIG.water.sunHalo`, which is
     * added to the dome INSIDE the Fresnel and is what a low sun lays along a
     * reach. It is bounded by the sky it sits on; a map that widens it owes
     * this measurement again.
     */
    glint: 0.22,
  },
  /**
   * Wet understory: dark at the root, fresh green at the tip. These were
   * Hollowmere's dead straw for as long as the layout carried no rect for them
   * to colour — a pale grey-olive stalk under a bone tip, which is a dead
   * valley's crop and not a jungle's.
   *
   * The root does NOT sit under `floorColor` the way Hollowmere's does. That
   * rule is for a field the valley floor continues into; this is undergrowth
   * standing ON soil, and matching the root to the soil is what would make it
   * read as more soil. What it matches instead is the shaded underside of the
   * canopy above it (`graphics.translucency.canopy`), so the two green layers
   * the eye has to stack are the same green seen at two depths.
   *
   * Both are darker and more saturated than they look like they should be, for
   * the reason the ambient note above gives: the key, the ambient and the sky
   * fill all land on a lit blade at once, and a tip authored at the colour
   * wanted on screen comes back chalky. Neither moved with the hour, and the
   * new one flatters them: a blade is nearly vertical, so like the trunks it
   * GAINED key when the sun came down while the ground it stands in lost some
   * — which is exactly the separation a field never had against a floor lit as
   * brightly as this one was.
   */
  grass: {
    rootColor: "#2f4326",
    tipColor: "#7d9c42",
  },
};
