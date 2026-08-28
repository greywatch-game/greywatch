/**
 * proving/environment.ts — the conditions the proving ground is measured under.
 * Owns: the palette, fog, sky and grade of the dev-only map `ENGINE_UPGRADE.md`
 * S0 exists to take numbers off.
 * Invariants: this is the ONE hand-written file under `src/world/proving/` —
 * `layout.ts` and `heights.ts` beside it are generated wholesale by
 * `scripts/generate-proving-ground.mjs` and must not be edited. It is paired
 * with the layout in `maps.ts` behind `import.meta.env.DEV` and must never
 * reach a production bundle.
 *
 * **Everything here is chosen to make the measurement HARDER, not prettier**,
 * and that is the whole of its design. A proving ground exists to price the
 * walls, so anything that would quietly hide one is turned off:
 *
 * - **`fogEnd` is 2400, past the 1500 m square's own 2121 m diagonal.** Fog is
 *   the cheapest thing in this tree that removes work — it is what S8 is about
 *   — and a proving ground fogged at Coldharbour's 480 would report a frame
 *   that a desert city at noon does not have. It is pushed into
 *   `BattleSystem`, `NetRoster` and `RagdollSystem` as the rig/body/corpse
 *   cutoff too, so every bot on the map is drawn at full rig, which is the
 *   honest worst case for wall 1.
 * - **`shadowWindow` is 200**, Coldharbour's, and deliberately NOT widened to
 *   the map. `shadowVisibility` returns FULLY LIT outside the window rather
 *   than fading, so a wider one is more casters for a picture nobody is
 *   judging; the shadow map's own cost is S8's question and this is not the
 *   instrument for it.
 * - **No water and no lamps.** `lampIntensity` is 0 and the layout states no
 *   water rects, so neither the mirror nor the sixteen light slots are in any
 *   number taken here. Adding either would make a figure unattributable, which
 *   is the one thing a proving ground may not be.
 *
 * The palette is a dry noon: high sun, bleached ground, a warm haze that never
 * closes. It is Coldharbour's structure with the hour moved and the weather
 * taken out, which is what a desert city's ruined outskirts would want and is
 * also — not by accident — the least forgiving light this engine draws.
 */
import type { EnvironmentSpec } from "../environment";

export const ProvingEnvironment: EnvironmentSpec = {
  /** Bleached sand-over-hardcore. The `dirt` surface reads as grit at range. */
  floorColor: "#8f8065",
  floorSurface: "dirt",
  /** The escarpment, where the variant closed by a rim draws one. */
  ridgeColor: "#8a7d68",
  ridgeScreeColor: "#9b8b70",
  accentColor: "#7fd0ff",
  skyColor: "#c3b79c",
  /**
   * Warm haze rather than weather. `fogStart` is far enough out that nothing
   * inside a block is tinted and `fogEnd` is past the diagonal, so the fog
   * grades the horizon and removes no work at all. See the header.
   */
  fogColor: "#d6c8ab",
  fogStart: 700,
  fogEnd: 2400,
  mistColor: "#dccfb4",
  mistHeight: 3.0,
  mistStrength: 0.06,
  lighting: {
    color: "#fff2d2",
    intensity: 1.25,
    /**
     * Nearly overhead, which is what a noon sun is and also what keeps shadow
     * length (`h / tan(elevation)`) inside the 200 m window with fifty-metre
     * towers on the map: at this elevation a 50 m shaft throws about 42 m.
     */
    direction: [0.29, -0.91, 0.29],
    ambientColor: "#8f95a4",
    ambientIntensity: 0.46,
    skyLightColor: "#b9cde8",
    skyLightIntensity: 0.36,
    rimColor: "#ffeecd",
    rimIntensity: 0.12,
    shadowWindow: 200,
    /**
     * No street lighting at all. A lamp is one of sixteen slots and a light
     * budget is a thing to measure on its own; here it would only make the
     * numbers ambiguous.
     */
    lampIntensity: 0,
  },
  /**
   * Dust, at Coldharbour's count. It is one GPU particle system whatever the
   * map's extent, so it is flat in every comparison here and cannot bias the
   * play-square-against-margin question this map exists to answer.
   */
  particles: {
    color: "#ffe6bb",
    emissive: true,
    count: 3200,
    size: 0.11,
    riseSpeed: 0.04,
    drift: [0.82, 0.6],
  },
  sky: {
    zenithColor: "#4a74a8",
    // Close to `fogColor`, so the dome melts into the hazed rim rather than
    // cutting against it — the one hard requirement `SkySpec` states.
    horizonColor: "#d8cbaf",
    starColor: "#ffffff",
    starCount: 0,
    starBrightness: 0,
    moonColor: "#fff4d8",
    moonGlowColor: "#ffe2ad",
    cloudColor: "#a9b2bd",
    cloudOpacity: 0.34,
    cloudLitColor: "#ffeccb",
    cloudLitStrength: 0.7,
    discRadius: 12,
    haloStrength: 0.5,
    rays: { threshold: 0.86, intensity: 0.4 },
  },
  grade: {
    vignette: 0.18,
    grain: 0.012,
    aberration: 0.1,
  },
  groundSpec: { color: "#ffe6b8", intensity: 0.03, shininess: 28 },
  // No water and no grass: the layout states neither rect list, so a palette
  // for either would be dead weight. See the header for why that is deliberate
  // rather than unfinished.
};
