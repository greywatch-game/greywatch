/**
 * environment.ts — EnvironmentSpec: the declarative shape of a map's look
 * (palette, lighting direction, fog, mist, sky, water, particles) plus
 * applyEnvironment(), which pushes it into the cel materials and scene.
 * Pure data in, uniforms out — a second map adds one new spec, no code here.
 */
import { Color3, Color4, Scene, Vector3 } from "@babylonjs/core";
import type { CelMaterialFactory, SpecSpec } from "../shaders/CelShader";
import type { FloorSurfaceId } from "./floorSurfaces";

/** A dynamic point light carried by a prop, registered when the prop is placed. */
export interface LightSpec {
  color: string;
  /** World units at prop scale 1. */
  range: number;
  intensity: number;
  /** Local offset from the prop origin; scales with the prop. */
  offset: [number, number, number];
  /** 0 steady .. 1 wild (flame ~.35, neon ~.9). */
  flicker: number;
}

/** Drifting mote field: ash, spores, embers. */
export interface ParticleSpec {
  color: string;
  emissive: boolean;
  count: number;
  size: number;
  /** Positive rises (embers), negative falls (ash). */
  riseSpeed: number;
  /**
   * Lateral drift, in metres per second on X and Z. Absent leaves the
   * symmetric jitter the field has always had, which reads as motes MILLING —
   * right for still air under a dead valley, wrong anywhere the air is meant
   * to be going somewhere.
   *
   * **This is deliberately not a per-map wind SYSTEM**, which is what it looks
   * like it wants to be, and it is still not one. Wind lives in `CONFIG.wind`
   * and is now read twice — the grass field and the world's foliage — but both
   * readers want the SAME bearing over the whole valley, which is exactly what
   * a per-map environment field is not. Promoting it here would let one map
   * describe two winds and nothing would catch it.
   *
   * What a wind field would have bought is that the dust and the blades agree
   * about a bearing, and that is now had for the asking: a map that wants it
   * states this to match `CONFIG.wind.dir`. Matched by HAND on purpose — this
   * is a velocity rather than a direction, and the two maps that set one differ
   * by a factor of four in how fast their air moves.
   */
  drift?: [number, number];
  /**
   * The side, in metres, of a box centred on the CAMERA that the field is
   * emitted into. Absent emits into the whole map, which is what every map
   * did before this existed and what all but one still does.
   *
   * **It exists because `count` was never a headcount and had quietly stopped
   * being a density either.** `Atmosphere.apply` sizes the emit box to
   * `map.size` squared by 11 m tall, so the same `count` spread over
   * Hollowmere's 240 m square and Sarab's 900 m one is two fields nineteen
   * times apart in motes per cubic metre — and the second one is air you
   * cannot see. Hollowmere's own spec reasons about its number from a density
   * it measured; the number was then copied down to a map fourteen times the
   * area, where it means something else entirely.
   *
   * **The honest fix is not a bigger count, because most of a big map's motes
   * are emitted where nobody is.** Sarab's `fogEnd` is 560 against 900 m of
   * play, so at any moment more than half the field is behind the haze being
   * simulated and drawn for nothing. A box that follows the eye spends the
   * whole budget inside the view and makes `count` mean motes per cubic metre
   * again, which is the unit every existing map's value was actually judged
   * in.
   *
   * **What it costs is that a mote is emitted at full alpha**, so the box's
   * edge is a place things appear. That is why this is a metre count rather
   * than a flag: it wants to be well past `fogStart`, so a spawn happens in
   * air already thick enough to hide it, and well past what a player crosses
   * in a mote's ~14 s life (about 70 m on foot, more in a hull) so the
   * trailing edge never overtakes the field. Clamped to the map, since a box
   * bigger than the world is the world.
   */
  volume?: number;
}

/**
 * The night-sky palette. Everything here is baked or tinted by `Sky`
 * (`src/systems/Sky.ts`); geometry (dome radius, cloud layer heights, scroll
 * speeds) lives in `CONFIG.sky`. Omitting it leaves the bare clear colour.
 */
export interface SkySpec {
  /** Top of the dome gradient. */
  zenithColor: string;
  /**
   * Bright band at the horizon line. Should sit close to `fogColor` so the
   * dome melts into the fogged ridge instead of cutting against it.
   */
  horizonColor: string;
  /** Baked star field: colour, count, and 0..1 brightness. */
  starColor: string;
  starCount: number;
  starBrightness: number;
  /**
   * The moon hangs opposite the key light's direction, so the disc always
   * agrees with the shadows. This is just its colour — size is `CONFIG.sky`.
   */
  moonColor: string;
  /**
   * The broad scattering halo baked around the moon: the air near it lit up,
   * not the disc itself. Wants to be cooler and dimmer than `moonColor` —
   * this is the term that decides whether the sky reads as lit or as black.
   */
  moonGlowColor: string;
  /** Faint galactic band. Omit for an empty sky. */
  milkyWayColor?: string;
  /**
   * The light's own disc, in world units at `CONFIG.sky.moonDistance`.
   * Defaults to `CONFIG.sky.moonRadius`.
   *
   * **Zero means no disc at all, and it switches the light shafts off with
   * it.** `Sky` hands `GodRays` the direction the light hangs in, and a zero
   * vector there already means "nothing to converge on" — the contract
   * `Sky.clear()` documents. So a sky with no disc is a sky with no shafts,
   * through the path that already existed.
   *
   * **No shipped map takes it any more, and what retired it is `rays` below.**
   * Greyfen was the one that did, on an overcast premise, and half the argument
   * for that premise was a rendering constraint rather than a look:
   * `CONFIG.godRays`' luminance threshold IS the whole occlusion test and the
   * shipped value sits above a night street, so under a lit sky it fired on
   * everything and the only way to be rid of it was to be rid of the disc.
   * Giving that number to the MAP answers it without giving up either. What is
   * left here is for a sky that genuinely has no source to see, and it still
   * works.
   */
  discRadius?: number;
  /**
   * Peak alpha of the scattering halo baked around the disc. Defaults to
   * `CONFIG.sky.haloStrength`. This is the term that decides whether the sky
   * reads as lit; on an overcast map it is also the only thing standing in
   * for a disc that is not drawn.
   */
  haloStrength?: number;
  /**
   * The shafts' own two numbers, each defaulting to `CONFIG.godRays`.
   *
   * They live on the SKY rather than at the top of the spec because the whole
   * feature already does: `discRadius` is what switches the shafts on and off,
   * through the zero-`moonDir` contract above, and `Game.applySky` already
   * reads `moonGlowColor` to tint them. `EnvironmentSpec.grade` is the shape
   * this copies — a block of `CONFIG.graphics` defaults a map may override.
   *
   * Only these two, and the omission is mechanical rather than a judgement:
   * `samples` is interpolated into the shader source as a `#define` at module
   * evaluation and cannot be per-map at all. Of what is left, these are the
   * two that are statements about a MAP rather than about the shape of a beam.
   */
  rays?: { threshold?: number; intensity?: number };
  /** Drifting cloud decks: tint (the shadowed body) and 0..1 ceiling alpha. */
  cloudColor: string;
  cloudOpacity: number;
  /**
   * The silver a deck takes on where the moon is behind it, added on a second
   * shell so the lit patch stays anchored to the moon while the cloud texture
   * scrolls through it. Strength is that shell's peak alpha.
   */
  cloudLitColor: string;
  cloudLitStrength: number;
}

/**
 * Water palette. Omitting it leaves the map dry.
 *
 * **Two of these three colours mean less than they used to, and the reason is
 * that the water is a mirror now.** The shader's Fresnel returns a PICTURE at
 * grazing angles — the sky, the light's glare in it, and the map's own
 * geometry out of a reflection probe — so the colours here are what the water
 * IS looking into it, not what it looks like from the bank. A pond seen from
 * its own bank is almost entirely reflection, and no albedo on this interface
 * is going to be the thing that makes it read.
 */
export interface WaterEnvSpec {
  /** Body colour in a channel: what a deep, still look straight down returns. */
  deepColor: string;
  /** Body colour over a shoal, where the bed is close under the surface. */
  shallowColor: string;
  /** Shoreline foam, whitecaps and drifting flecks. */
  foamColor: string;
  /**
   * What the bed itself is, showing through the last few centimetres.
   * Defaults to the map's own `floorColor`, which is what a bank cut in the
   * valley floor is made of — so the waterline grades into the ground it is
   * cut in without a map having to state anything. Give it a value only where
   * the bed is genuinely not the floor: a silted mill pond, a shingle reach.
   */
  bedColor?: string;
  /**
   * How much of the reflection PROBE this map's water returns, against the
   * analytic sky it would otherwise show there. Scales
   * `CONFIG.graphics.reflection.strength`; defaults to 1.
   *
   * The dial exists for murk rather than for taste. A clear pond returns the
   * bank almost perfectly; standing water with a metre of peat under it
   * scatters most of what lands on it, and the honest way to draw that is to
   * keep the sky and lose the picture. It is also the headroom valve for a map
   * whose light shafts occlude in luminance — see `glint` below, which makes
   * the same argument about a term that cannot be turned down any other way.
   */
  mirror?: number;
  /**
   * Scales `CONFIG.water.specStrength` — the hard sparkle on the CRESTS.
   * Defaults to 1.
   *
   * **This is not the sun on the water; the sun on the water is in the
   * mirror.** The glare a low light lays across a reach is `CONFIG.water`'s
   * `sunHalo`, and it arrives through the Fresnel like everything else
   * reflected — so it is broad, it is where the geometry says it should be,
   * and it is bounded by the sky it is added to. This term is the other thing:
   * a facet tipped at the light by a passing crest, which fires anywhere on
   * the body including straight down into still water where the mirror returns
   * almost nothing. It is what makes a surface read as MOVING.
   *
   * **What it still costs is the SHAFTS, and that is the one number attached
   * to it.** `SkySpec.rays.threshold` is an occlusion test done in luminance
   * with no depth pass, so a sheet of water bright enough to cross it stops
   * being an occluder and starts radiating shafts of its own from below the
   * horizon. Greyfen's file measures the margin either side; a map with a disc
   * in its sky wants this LOWER than one without, which is the opposite of the
   * obvious move.
   */
  glint?: number;
}

/** Grass-field palette. Omitting it leaves the map bald. */
export interface GrassEnvSpec {
  /** Blade colour at the root — should sit close to floorColor so the field
   *  reads as growing out of the ground, not scattered on top of it. */
  rootColor: string;
  /** Blade colour at the tip — the part that catches the key light. */
  tipColor: string;
}

/**
 * Everything the renderer needs to make a place feel like one place: palette,
 * atmosphere, and the three light terms the cel shader bands.
 *
 * This is the old `RoomTheme.environment` minus `props` — a hand-laid map
 * carries its own placements, so the environment no longer owns a prop roster.
 */
export interface EnvironmentSpec {
  /**
   * The valley floor's colour, and the ONE answer to what colour the ground
   * is: `floorSurface` derives every tone it paints from this, `ridgeScreeColor`
   * is asked to melt into it, and a grass field's roots are matched to it.
   */
  floorColor: string;
  /**
   * What the floor is made of — the grain painted in `floorColor`, not a
   * second colour. Defaults to `flat`, the untextured cel colour the floor
   * has always been and the only one that costs no texture sample per ground
   * pixel. See `floorSurfaces.ts` for the roster.
   *
   * It is a MATERIAL, so unlike everything else here it is baked at build time
   * rather than pushed as a uniform: changing it needs the map rebuilt, which
   * is why the editor treats it as a structural edit and why `workLight.ts`
   * leaves it alone along with the two rim colours.
   */
  floorSurface?: FloorSurfaceId;
  /**
   * The valley rim's rock. Read only by the ridge — nothing in the village is
   * coloured from here; a building's palette is its builder's. Past the fog
   * wall the crest is pure `fogColor` anyway, so this is what the rim reads as
   * from close up: at the two home spawns, which stand 15-24 m off it.
   */
  ridgeColor: string;
  /**
   * The rim's foot — the basal band and the first metres of the face. Its job
   * is to melt the boundary into `floorColor` so the rim does not cut a hard
   * line across the valley, so it wants to be near it and slightly warmer, NOT
   * a bright trim: the sky term lifts albedo, so a light tone here comes back
   * chalky on the up-facing ledges.
   */
  ridgeScreeColor: string;
  accentColor: string;
  skyColor: string;
  fogColor: string;
  fogStart: number;
  fogEnd: number;
  /**
   * How far a BODY is worth drawing, in metres, overriding `fogEnd` for the
   * three gates that ask that question — the bots' rig LOD
   * (`BattleSystem.viewDistance`), the remote roster's
   * (`NetRoster.viewDistance`) and the ragdoll pool's one remaining refusal
   * (`RagdollSystem.viewDistance`). Absent is `fogEnd`, which is what every
   * shipped map states by saying nothing, so this changes no map that does not
   * ask for it.
   *
   * **It exists because those three were pinned to the weather, and on a map
   * with no weather that is not a distance at all.** `fogEnd` is where the
   * world goes to `fogColor`, so it is exactly right for the WALK
   * (`WorldCulling`, whose reach stays `fogEnd` and must — a structure dropped
   * inside the fog does not fade, it vanishes). A body is the other case: it
   * is nineteen merged meshes and it is two pixels tall at four hundred
   * metres, and a frame that is DRAW-CALL bound (`FINDINGS.md` 17) pays the
   * whole nineteen for those two pixels. Coldharbour and Harrowmead already
   * see past their own diagonals, so both of them draw every rig on the map at
   * all times; at 1500 m that is the largest bucket in the frame.
   * `ENGINE_UPGRADE.md` S8 is this field.
   *
   * **A body still POPS where it is dropped**, which is the whole of the cost
   * and the reason this defaults to the fog rather than to a number: past
   * `fogEnd` a body is `fogColor` in front of `fogColor` and dropping it cannot
   * move a pixel, and inside it a body vanishing is a thing a player can see.
   * So a map states this only when it has decided that a soldier a few pixels
   * tall is worth less than the draws — and it is capped at `fogEnd`
   * (`bodyDrawDistanceOf`), because a body drawn past the fog is a body drawn
   * as fog.
   *
   * **The two riders stay pinned to each other**, which is what
   * `config/fogWall.ts` exists to say: `bots.lodDisableDistance` and
   * `bots.death.maxDistance` are the same distance BY CONSTRUCTION, and they
   * still are — all three systems above are handed the one number this
   * resolves to, so a corpse can never be refused a tumble somewhere its rig
   * is still being drawn.
   */
  bodyDrawDistance?: number;
  mistColor: string;
  mistHeight: number;
  mistStrength: number;
  lighting: {
    color: string;
    intensity: number;
    /** Normalized on load. */
    direction: [number, number, number];
    ambientColor: string;
    ambientIntensity: number;
    /**
     * Hemispheric fill from the sky itself, applied by n.y: full on up-facing
     * surfaces, nothing underneath, and never gated by the shadow map. Flat
     * ambient alone lifts every face equally and reads as a grey wash; this is
     * what makes ground and roofs look moonlit while walls stay dark. Should
     * sit close to the sky's own zenith/horizon colours.
     */
    skyLightColor: string;
    skyLightIntensity: number;
    rimColor: string;
    rimIntensity: number;
    /**
     * The ortho window the shadow camera covers, in metres, overriding
     * `CONFIG.graphics.shadows.frustumSize`.
     *
     * **This is the fourth thing that reads like a global constant and is the
     * MAP's**, and it is here rather than on the layout for the reason
     * `fogEnd` is here: it is not a shape, it is a consequence of the key
     * light's ELEVATION, which is the field directly above it. A 40 m tower
     * throws 25 m of shadow at 58 degrees and 90 m at 24, and
     * `shadowVisibility` returns fully-lit outside the window rather than
     * fading — so a window sized for a high sun does not soften under a low
     * one, it draws a straight line across the ground where the shadows stop.
     *
     * Raising it costs texel density (`window / mapSize`), and there is a
     * ceiling past which it buys nothing: along the sun's own azimuth the
     * depth volume binds first. See `ShadowSystem.setShadowWindow`.
     */
    shadowWindow?: number;
    /**
     * The player's own shoulder lamp, overriding `CONFIG.lighting.lampIntensity`.
     *
     * **Zero removes it entirely, and that is the point of the field.** The
     * lamp exists because a night village between fixtures is too dark to
     * fight in; under a lit sky it is a torch at noon, and it is not merely
     * redundant — carried lights always win one of the sixteen shader slots,
     * so an unwanted one is a lantern somewhere that stops being drawn.
     */
    lampIntensity?: number;
  };
  particles?: ParticleSpec;
  water?: WaterEnvSpec;
  grass?: GrassEnvSpec;
  sky?: SkySpec;
  /**
   * How hard the horror grade is pushed on this map. Each field defaults to
   * its `CONFIG.graphics` value, which is Hollowmere's.
   *
   * The map scales the effect; the PLAYER still decides whether it runs at
   * all (`settings.horrorGrade`). Those are different questions: a heavy
   * vignette is dread on a night village and a lens fault on a bright one,
   * but wanting it off entirely is a preference no map should override.
   */
  grade?: {
    vignette?: number;
    grain?: number;
    aberration?: number;
  };
  /**
   * The wet sheen on cobbled ground, overriding `CONFIG.graphics.spec.cobble`.
   *
   * It lives here because it is not a graphics setting — it is a statement
   * about this map's weather and the elevation of this map's key light. The
   * shipped value is tuned against a 38-degree moon and its own comment says
   * to re-check it whenever that moves; a map that moves it therefore owes a
   * value here.
   */
  groundSpec?: SpecSpec;
}

/**
 * How far a body is worth drawing on this map, resolved.
 *
 * The one place `EnvironmentSpec.bodyDrawDistance` is read, so the three gates
 * that ask this question cannot be handed three different answers — which is
 * the failure `config/fogWall.ts` was written to prevent when the number was
 * spelled out per system.
 *
 * **Capped at `fogEnd` rather than trusted**, because past the fog a body draws
 * `fogColor` in front of ground that draws `fogColor`: a map asking for more is
 * asking for draws that cannot move a pixel, and the ragdoll pool would be
 * tumbling corpses out there to go with them. The cap is silent in a
 * production build and SAYS SO in a dev one — the two ways to write it, a map
 * that raised `fogEnd` and forgot this and a map that meant it, are the same
 * text, so the only thing the engine can do about the first is put it where
 * the author will see it.
 */
export function bodyDrawDistanceOf(env: EnvironmentSpec): number {
  const stated = env.bodyDrawDistance;
  if (stated === undefined) return env.fogEnd;
  if (import.meta.env.DEV && stated > env.fogEnd) {
    console.warn(
      `[environment] bodyDrawDistance ${stated} is past fogEnd ${env.fogEnd};` +
        " a body out there is already drawn as fog. Clamping to fogEnd.",
    );
  }
  return Math.max(0, Math.min(stated, env.fogEnd));
}

/**
 * Push an environment into the scene clear color and every cel material's
 * lighting/fog uniforms. The scene has no Babylon lights — this is how light
 * reaches the shader.
 */
export function applyEnvironment(
  scene: Scene,
  env: EnvironmentSpec,
  mats: CelMaterialFactory,
): void {
  const sky = Color3.FromHexString(env.skyColor);
  scene.clearColor = new Color4(sky.r, sky.g, sky.b, 1);

  const [dx, dy, dz] = env.lighting.direction;
  const lit = env.lighting;
  mats.setEnvironment({
    lightDir: new Vector3(dx, dy, dz),
    lightColor: Color3.FromHexString(lit.color).scale(lit.intensity),
    ambientColor: Color3.FromHexString(lit.ambientColor).scale(
      lit.ambientIntensity,
    ),
    skyLightColor: Color3.FromHexString(lit.skyLightColor).scale(
      lit.skyLightIntensity,
    ),
    // What glazing reflects, and the one thing here taken from the DOME rather
    // than from the lighting block: a reflection is a picture of the sky, so it
    // wants the colour the sky is painted, not the light the sky throws. The
    // other end of that gradient is `fogColor`, which `SkySpec.horizonColor` is
    // already required to sit close to. A map with no dome falls back to its
    // flat clear colour, which is then literally what is overhead.
    skyZenithColor: Color3.FromHexString(env.sky?.zenithColor ?? env.skyColor),
    rimColor: Color3.FromHexString(lit.rimColor).scale(lit.rimIntensity),
    fogColor: Color3.FromHexString(env.fogColor),
    fogStart: env.fogStart,
    fogEnd: env.fogEnd,
    mistColor: Color3.FromHexString(env.mistColor),
    mistHeight: env.mistHeight,
    mistStrength: env.mistStrength,
  });
  // The ground's wet sheen is the map's weather, and it is tuned against the
  // key light's elevation — which this function has just changed. Pushed here
  // rather than from `installMap` so it lands BEFORE the map's materials are
  // built, and so the editor's work light re-derives it like everything else.
  mats.setGroundSpec(env.groundSpec);
}
