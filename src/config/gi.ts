/**
 * config/gi.ts — the irradiance volume's tunables (`systems/GiVolume.ts`).
 * Owns: the probe grid's shape per quality tier, the trace budget, how the
 * traced light is folded back into the cel shader's indirect term, and the
 * fast layer's light cap. Contract: `docs/rendering.md`, "The irradiance
 * volume".
 * Gotcha: a tier's `rays` is a WORKGROUP SIZE, compiled into the trace shader,
 * so it must be a power of two no larger than 256 — the reduction halves it.
 * And `columns^2 * layers` must not be a multiple of 7919 or over ~542k, or
 * the rolling sweep stops visiting every probe. `GiVolume` throws on either
 * in a DEV build.
 */

export const gi = {
  /**
   * The grid, per setting. `columns` is probes along each horizontal axis of a
   * CAMERA-CENTRED window that scrolls with the eye, so the window's side is
   * `columns * spacing` metres whatever the map's size; `layers` stack up from
   * the TERRAIN rather than from a fixed height, so a hillside town and a
   * harbour at sea level spend the same probes on the air people stand in.
   *
   * `probesPerFrame` is the rolling re-trace budget — the whole window is
   * re-traced every `columns^2 * layers / probesPerFrame` frames — and
   * `warmProbesPerFrame` the one spent while the window is still unconverged
   * (a fresh map, a respawn across the map).
   */
  tiers: {
    low: {
      spacing: 3,
      columns: 64,
      layers: 6,
      layerHeight: 3,
      rays: 32,
      probesPerFrame: 384,
      warmProbesPerFrame: 4096,
      fastRays: 6,
    },
    high: {
      spacing: 2,
      columns: 96,
      layers: 8,
      layerHeight: 2.5,
      rays: 64,
      probesPerFrame: 1024,
      warmProbesPerFrame: 8192,
      fastRays: 8,
    },
  },
  /**
   * How much of a re-trace a probe takes — DDGI's hysteresis, inverted, and
   * **1: the whole answer, every time**, which is the opposite of DDGI's and
   * for the reason the rest of this design differs from it.
   *
   * **The ray set is the SAME every update**, so a re-trace of an unchanged
   * scene returns the same answer and there is no noise for a history to
   * average away. What a blend below 1 bought instead was SLOWNESS: each probe
   * is re-traced once per sweep, so at 0.25 a probe was still 42% short of its
   * answer three sweeps in — measured as 5-13% of a frozen frame's pixels
   * still moving, by up to 52/255, four seconds after it had "converged".
   * Taken whole, the only thing left moving is the multi-bounce iteration,
   * which shrinks by the albedo every sweep and is below a half-float's step
   * within a few. Then nothing in the indirect term moves by itself — the rule
   * the cel look sets (no clock you can see), and why the rays are not rotated
   * per frame either.
   */
  blend: 1,
  /** How far a bounce ray looks before it is answered by the sky, metres. */
  rayLength: 48,
  /** How far a SUN visibility ray looks from a hit before calling it lit. */
  sunRayLength: 64,
  /**
   * The most steady fixtures the slow layer lights its hits with. Taken
   * nearest the window's centre whenever the window moves a block; one past
   * this is a lantern whose BOUNCE is missing, not one that goes dark.
   */
  slowLights: 48,
  /**
   * The most lights the FAST layer bounces in one frame — muzzle flashes,
   * blasts, anything registered `fast`, the carried lamp, and the flicker of
   * the fires nearest the eye. Nearest the eye first.
   */
  fastLights: 6,
  /**
   * How near the eye a steady fire has to be before its FLICKER is bounced.
   * The flicker is a garnish on a bounce the slow layer already carries, and
   * spent on every fire in the window it took the whole fast budget from the
   * muzzle flashes it exists for.
   */
  flickerReach: 24,
  /** Metres a fire's emitters are clustered over before they cost a fast light. */
  fastCluster: 4,
  /**
   * How the traced irradiance reaches the frame.
   *
   * `strength` scales the traced term. `floor` is the share of the map's flat
   * `ambientColor` kept UNOCCLUDED under it — the cel painter's "how black does
   * the unlit side go", which a physically closed room would otherwise take to
   * zero. `aoKeep` is how much of the baked vertex AO still applies: the volume
   * already owns occlusion at the scale of its spacing, and the bake is kept
   * for what is finer than that. `bands` is how many steps the indirect
   * term's LUMINANCE is cut into (its hue is kept), and `bandSpan` how many
   * times the unoccluded sky's own brightness those steps reach, so a bright
   * bounce steps up past it rather than being clamped.
   */
  strength: 1,
  floor: 0.28,
  aoKeep: 0.55,
  bands: 3,
  bandSpan: 2,
  /**
   * Along the surface normal, in PROBE SPACINGS, before the volume is sampled:
   * what keeps a wall's lit face reading the probes in front of it rather than
   * the ones behind it.
   */
  normalOffset: 0.5,
  /**
   * The outer share of the window's half-side that ramps back to the flat
   * ambient, so the window's edge is haze rather than a line. The same idea as
   * the shadow map's `edgeFade`.
   */
  edgeFade: 0.2,
  /**
   * Whether point lights are stopped by walls. Off leaves the old rule
   * (a lantern lights through anything within its range).
   */
  pointOcclusion: true,
  /**
   * Metres short of a light a visibility ray stops looking: fixtures stand IN
   * their own props (a fire drum's flame is inside the drum's collider), and a
   * ray that found the prop would black out the light it belongs to.
   */
  lightClearance: 0.75,
  /** Albedo a hull answers with, since it is in no palette the trace can read. */
  hullAlbedo: "#3a3d38",
} as const;
