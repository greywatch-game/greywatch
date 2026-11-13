/**
 * render/frame.ts — The FRAME's uniforms: the one block every program our
 * renderer draws with binds at group 0, binding 0, stated once as data, and
 * the plain struct it is written from.
 * Owns: `FRAME_FIELDS` and `FRAME_BLOCK` (the declaration `celFragment.ts`,
 * `celVertex.ts` and every later program include), `frameBlockExcept`, `FrameUniforms` (one
 * `Float32Array` per field, named as the shader names it) and
 * `createFrameUniforms`; `FRAME_TEXTURES`, the rest of group 0 — every
 * shadow map, the foliage map and the irradiance volume — and
 * `FrameTextures`, the handles they are bound from — every one our
 * renderer's own (`OwnTexture`: the world's shadow maps since X3.6a, the
 * irradiance volume's seven since X5.1b, `render/GiCompute.ts`, and the lit
 * texel and the cloud field since X5.4d, `render/TextureMaker.ts`).
 * Invariants: one LAYOUT in every variant but the last field — a name only
 * some programs read is declared for all of them, and the one guarded field,
 * the 2 KB palette, is LAST, so every variant reads the same offsets (the
 * header of `celFragment.ts` argues it); a field's array is TIGHT —
 * `count * components` floats, a `vec3f` three — and only the upload
 * (`FrameUniformBuffer`) knows the padding; the struct is filled by whoever
 * already publishes the value (`CelMaterialFactory.fillFrame`), never read
 * off a Babylon material; so are the textures (`CelMaterialFactory
 * .fillFrameTextures`), read where their owners hold them.
 * Never: imports Babylon; allocates per frame — the struct is made once and
 * filled in place.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 *
 * What each field MEANS is written beside it below — and beside the cel
 * material's own in `celMaterial.ts` — since `BABYLON_EXIT.md` X6.1c, which
 * deleted the Babylon declarations of the cel program that carried it.
 *
 * WHY THE CAMERA AND THE WIND ARE HERE although the fragment reads neither:
 * they are the VERTEX stage's share of the same frame (`celVertex.ts`
 * declares them beside `world`), and a frame is one buffer bound once,
 * so a vertex stage that arrives later (X3.3) reads offsets that already
 * exist rather than moving every field after them. An unread member costs a
 * few bytes and nothing else.
 *
 * WHY THE TEXTURES ARE THE FRAME'S. Every one of them is shared state every
 * cel draw samples (`ShadowBindings`, `CelMaterialFactory.setGi`) and is
 * replaced under all of them at once, so it is one bind group per frame
 * rather than one per material.
 */
import { MAX_PALETTE, MAX_POINT_LIGHTS } from "../shaders/wgsl/celSurface";
import { GI_SLOTS } from "../shaders/wgsl/giTrace";
import type { OwnTexture } from "./HostBindGroup";
import type { Binding, UniformField } from "./wgsl/assemble";

// `giSlotChannel` is one channel per POINT-LIGHT slot, and the volume's table
// (`GiBinding.slotChannel`) is `GI_SLOTS` long: `fillFrame` copies one into
// the other, which throws every frame the moment the two differ. Loud here,
// at load, instead.
if (GI_SLOTS !== MAX_POINT_LIGHTS) {
  throw new Error(`render/frame: GI_SLOTS (${GI_SLOTS}) must equal MAX_POINT_LIGHTS (${MAX_POINT_LIGHTS})`);
}

/** Every member of the frame block, in layout order. */
export const FRAME_FIELDS = [
  // The camera — filled from the scene's active camera as `viewProjection`
  // (what Babylon's `ShaderMaterial` filled it from, while it had one), and
  // the eye the shading reads (and the vertex stage's bough fade).
  { name: "viewProjection", type: "mat4x4f" },
  { name: "camPos", type: "vec3f" },
  // WHAT AN OPAQUE FRAGMENT WRITES INTO THE ALPHA CHANNEL, and it is 0 in the
  // frame and 1 in a probe's bake because that channel means two different
  // things in the two passes. In the FRAME it is TRANSLUCENT COVERAGE, which
  // CelInk reads to know how much smoke got between it and the depth it is
  // drawing an edge off — see that file. In a reflection PROBE it is the cube's
  // own coverage mask, which is how the glazing (celSurface) tells the city
  // from the sky above it (city.a), and there it has to be 1 or the bake comes
  // back empty: our renderer's bake writes 1 into its own frame
  // (CelMaterialFactory.fillBakeFrame).
  { name: "opaqueAlpha", type: "f32" },
  // The environment (`CelMaterialFactory.setEnvironment`).
  { name: "lightDir", type: "vec3f" },
  // How far the key wraps toward full on anything facing it — see the key term.
  { name: "keyWrap", type: "f32" },
  { name: "lightColor", type: "vec3f" },
  { name: "ambientColor", type: "vec3f" },
  // Hemispheric fill from the sky dome: full strength on up-facing surfaces,
  // nothing underneath. Banded like everything else so the toon look survives.
  { name: "skyLightColor", type: "vec3f" },
  // The top of the sky dome, which glazing reflects. The HORIZON end of the
  // same gradient is fogColor, which SkySpec.horizonColor is required to sit
  // close to — the one place that requirement is load-bearing rather than
  // cosmetic.
  { name: "skyZenithColor", type: "vec3f" },
  { name: "rimColor", type: "vec3f" },
  { name: "fogColor", type: "vec3f" },
  // x = start, y = end.
  { name: "fogParams", type: "vec2f" },
  { name: "mistColor", type: "vec3f" },
  // x = height falloff, y = strength.
  { name: "mistParams", type: "vec2f" },
  // Albedo weathering: cell size (as 1/metres) and peak-to-peak swing. Uniforms
  // rather than literals so the pair can be judged live against a wall.
  { name: "variationScale", type: "f32" },
  { name: "variationAmount", type: "f32" },
  // The map's grime and how much of it. wearParams.x is the strength of the
  // whole term and 0 is off; y is the cosine edge the vertical fade starts at;
  // z is the ramp's falloff exponent, which is spent in the fragment rather
  // than in the bake because a curve baked at a wall's two corners is a
  // straight line by the time it is a fragment; w is how far the grain
  // displaces the ramp, peak to peak.
  //
  // `wearGrain` is that grain's shape: x is 1/metres of its coarse octave, y is
  // how much the noise cells are squashed vertically — which is what turns
  // blotches into runs down a face — and z is how far the field is stretched
  // about its middle, without which a value noise's own clustering leaves the
  // tide line effectively straight. See the WEAR block in the fragment body, and
  // `CONFIG.wear` for what the bake put in the blue channel these are spent on.
  { name: "wearColor", type: "vec3f" },
  { name: "wearParams", type: "vec4f" },
  { name: "wearGrain", type: "vec3f" },
  // The Ground relief setting: 1 marches the depth and the self-shadow, 0 skips
  // both and leaves the slope and the cavity — see setGroundRelief. Read by
  // the bumped ground alone, declared for every variant (the header).
  { name: "reliefMarch", type: "f32" },
  // The wind — the vertex stage's sway, shared with the grass field
  // (CONFIG.wind). windDir is the bearing, normalised; windParams is (travel in
  // metres at full weight, speed, gust wavenumber). windTime is the same clock
  // the grass runs on, pushed by CelMaterialFactory.updateWind — it advances
  // with the world rather than with the frame, so a pause holds the canopy
  // exactly as it holds the field.
  { name: "windTime", type: "f32" },
  { name: "windDir", type: "vec2f" },
  { name: "windParams", type: "vec3f" },
  // A rigged frond's answer to it (CONFIG.wind.frond): windFrond is the tip's
  // (lean, flap, swing, flutter) in metres, windFrondRate is (calm share, flap
  // rad/s, flutter rad/s, flutter wavenumber).
  { name: "windFrond", type: "vec4f" },
  { name: "windFrondRate", type: "vec4f" },
  // The ash bough's answer (CONFIG.wind.bough): windBough is the frond's layout
  // with w the leaf's TIP at a cluster's rim, windBoughRate (calm share, flap
  // rad/s, leaf rad/s, swell rad/s), and windBoughFade the (start, end) metres
  // from the eye the leaf's rustle fades over. The red channel picks which pair
  // a rigged vertex reads: -1 a frond, -2 a bough.
  { name: "windBough", type: "vec4f" },
  { name: "windBoughRate", type: "vec4f" },
  { name: "windBoughFade", type: "vec2f" },
  // The point lights (`setPointLights`, `LocalShadows.publish`); pointColor
  // is rgb premultiplied by intensity.
  { name: "pointPos", type: "vec3f", count: MAX_POINT_LIGHTS },
  { name: "pointColor", type: "vec3f", count: MAX_POINT_LIGHTS },
  { name: "pointRange", type: "f32", count: MAX_POINT_LIGHTS },
  { name: "pointCount", type: "f32" },
  // THE LAMPS' ATLAS (systems/LocalShadows.ts) — per slot; the layout of each
  // slot is stated over the lamps' half of celShadow's body. localAtlas: x =
  // tiles per atlas row, y = one tile's side in UV, z = one texel in UV, w =
  // taps (1 or 4); localParams: x = receiver bias (m), y = facet offset (m).
  { name: "pointSpot", type: "vec4f", count: MAX_POINT_LIGHTS },
  { name: "pointShade", type: "vec4f", count: MAX_POINT_LIGHTS },
  { name: "localAtlas", type: "vec4f" },
  { name: "localParams", type: "vec4f" },
  // The shadows (`ShadowBindings`) — THE WORLD'S MAP AND ITS NEAR CASCADE, AND
  // THE BODIES' MAP (ShadowSystem, BodyShadows); the conventions are
  // celShadow's body's. shadowParams: x = depth bias, y = darkness, z = normal
  // offset.
  { name: "lightMatrix", type: "mat4x4f" },
  { name: "shadowParams", type: "vec4f" },
  // The world's NEAR cascade — ShadowSystem's second map of the same casters,
  // over a small window around the player at a fine texel. Same conventions as
  // the pair above. Off is the lit 1x1 seen through a matrix that puts every
  // receiver outside the window, so the far map answers alone.
  // nearShadowParams: x = depth bias, y = its own facet offset (metres).
  { name: "nearLightMatrix", type: "mat4x4f" },
  { name: "nearShadowParams", type: "vec4f" },
  // The BODIES' map and its own view*projection — systems/BodyShadows.ts. Same
  // conventions as the pair above, because it is the same kind of object built
  // by the same generator: raw clip z, no [0,1] remap, XY to UV.
  //
  // **It is a different VOLUME, so it needs its own bias and cannot borrow the
  // world's**: 13 cm against the world's 5 cm, over a 90 m volume against 180.
  // The lookup's footprint needs nothing handed over — it is in texels of
  // whichever map it reads, and the texture says its own size.
  // bodyShadowParams: x = depth bias. Darkness and the normal offset are NOT
  // restated: a shadow is a shadow whichever map resolved it, and the offset
  // is a property of the RECEIVER's facet rather than of either caster set.
  { name: "bodyLightMatrix", type: "mat4x4f" },
  { name: "bodyShadowParams", type: "vec4f" },
  // The FOLIAGE's own depth map, front faces of the translucent solids only,
  // owned by ShadowSystem. It exists to measure THICKNESS for the translucency
  // term, which the two back-face maps cannot: a face turned away from the
  // key is its own recorded surface there. foliageParams: x = tap radius in
  // UV, y = 1 / the volume's depth span in metres, so transDepth converts to
  // that map's normalised depth.
  { name: "foliageLightMatrix", type: "mat4x4f" },
  { name: "foliageParams", type: "vec4f" },
  // The clouds' shadow on the ground (`celCloud`, which `celShadow` includes).
  // cloudShadow: x, y the key-space corner of the field, z 1 / its side in
  // metres, w how LIT a point wholly inside a cloud's shadow is; 1 turns the
  // term off. cloudShadowRay: x, y the light's toward vector as s.xz / s.y, so
  // a point's key is posW.xz - xy * posW.y; z the crossfade from the field in
  // R to the one in G; w the soft edge's half-width in field units (CONFIG's
  // shadow.softness). See `ShadowBindings.setCloudShadow`.
  { name: "cloudShadow", type: "vec4f" },
  { name: "cloudShadowRay", type: "vec4f" },
  // THE LIGHTNING'S KEY: its light and its map (ShadowSystem.flash) — its
  // direction, its colour (already times the flash's envelope), its map's
  // view*projection and that map's bias (flashParams.x).
  { name: "flashDir", type: "vec3f" },
  { name: "flashColor", type: "vec3f" },
  { name: "flashLightMatrix", type: "mat4x4f" },
  { name: "flashParams", type: "vec4f" },
  // The irradiance volume (`GiVolume.binding`; `celGi`). giGrid: x = 1 /
  // spacing, y = columns, z = layers, w = 1 / (layerHeight * layers);
  // giWindow: x, z = the window's centre in the world, y = its half side, w =
  // the height the stored floors are relative to; giShade: x = strength, y =
  // the unoccluded share of the flat ambient, z = how much of the baked vertex
  // AO still applies, w = 1 while a volume is live; giBand: x = band steps per
  // reference, y = 1 / the reference luminance, z = the normal offset in
  // metres, w = 1 when point lights are occluded; giExtra: x = the band's
  // ceiling in references, y = the lightning flash's sky fill.
  { name: "giGrid", type: "vec4f" },
  { name: "giWindow", type: "vec4f" },
  { name: "giShade", type: "vec4f" },
  { name: "giBand", type: "vec4f" },
  { name: "giExtra", type: "vec4f" },
  // Which visibility CHANNEL each point-light slot reads. A channel belongs to a
  // LIGHT for as long as it keeps a slot, so a lantern's visibility is traced
  // once when it wins one rather than every frame — and a muzzle flash taking
  // slot 0 moves nobody else's answer.
  { name: "giSlotChannel", type: "f32", count: MAX_POINT_LIGHTS },
  // The map's own albedo palette, indexed by `vPalette - 1`. This is what lets
  // one material stand for every paint colour in the village, which is what
  // lets `BlockMerge` collapse a 48 m block to one mesh instead of ten — see
  // `getWorldCel`. Behind a define because only the palette materials ever
  // read it and it is 2 KB.
  //
  // Guarded, so LAST — see the header. The MAP's palette; a body's own table
  // is a material's and never rides the frame (`CEL_OWN_PALETTE`, the soldier
  // kit's, `celMaterial.ts` — `BABYLON_EXIT.md` X4.1d), so a variant holding
  // its own declares none here and reads the same offsets as every other.
  { name: "celPalette", type: "vec3f", count: MAX_PALETTE, when: ["CEL_PALETTE", "!CEL_OWN_PALETTE"] },
] as const satisfies readonly UniformField[];

/** The frame block: group 0, binding 0, in every program. */
export const FRAME_BLOCK = {
  kind: "uniform",
  var: "frame",
  struct: "CelFrame",
  fields: FRAME_FIELDS,
} as const satisfies Binding;

/**
 * The frame block for a program that states `own` names for itself (the grass, the
 * water): its one layout, with each of those fields renamed out of the way, so the
 * frame's one buffer still binds and a body's `uniforms.<name>` reaches the program's.
 */
export function frameBlockExcept(own: ReadonlySet<string>): Binding {
  return {
    ...FRAME_BLOCK,
    fields: (FRAME_FIELDS as readonly UniformField[]).map((f) => (own.has(f.name) ? { ...f, name: `frame_${f.name}` } : f)),
  };
}

/**
 * The rest of group 0, after the block, in binding order — what each one is
 * is written beside the block's field that reads it (`lightMatrix`,
 * `nearLightMatrix`, `bodyLightMatrix`, `localAtlas`, `flashLightMatrix`,
 * `cloudShadow`, `foliageLightMatrix`, `giGrid`). **Every one must be BOUND,
 * always** — a frame with one null draws nothing — which is why each owner
 * publishes a real texture (or the lit texel) before the first frame.
 */
export const FRAME_TEXTURES = [
  { kind: "sampled", name: "shadowMap", type: "texture_2d<f32>" },
  { kind: "sampled", name: "nearShadowMap", type: "texture_2d<f32>" },
  { kind: "sampled", name: "bodyShadowMap", type: "texture_2d<f32>" },
  { kind: "sampled", name: "localAtlasMap", type: "texture_2d<f32>" },
  { kind: "sampled", name: "flashMap", type: "texture_2d<f32>" },
  { kind: "sampled", name: "cloudShadowMap", type: "texture_2d<f32>" },
  { kind: "sampled", name: "foliageMap", type: "texture_2d<f32>" },
  { kind: "sampled", name: "giIrr", type: "texture_3d<f32>" },
  { kind: "sampled", name: "giDir", type: "texture_3d<f32>" },
  { kind: "sampled", name: "giAux", type: "texture_3d<f32>" },
  { kind: "sampled", name: "giVis0", type: "texture_3d<f32>" },
  { kind: "sampled", name: "giVis1", type: "texture_3d<f32>" },
  { kind: "sampled", name: "giVis2", type: "texture_3d<f32>" },
  { kind: "sampled", name: "giVis3", type: "texture_3d<f32>" },
] as const satisfies readonly Binding[];

/** The name of a frame texture. */
export type FrameTexture = (typeof FRAME_TEXTURES)[number]["name"];

/**
 * The frame's textures as last pulled: a handle per binding, our renderer's
 * own, or null for one its owner has not published yet: a frame with any null
 * draws nothing.
 */
export type FrameTextures = { [K in FrameTexture]: OwnTexture | null };

/** Every frame texture unpublished. Made once by whoever fills it. */
export function createFrameTextures(): FrameTextures {
  const out: Partial<Record<FrameTexture, OwnTexture | null>> = {};
  for (const t of FRAME_TEXTURES) out[t.name] = null;
  return out as FrameTextures;
}

/** The name of a frame field — what the shader calls it. */
export type FrameField = (typeof FRAME_FIELDS)[number]["name"];

/** The frame's values, one tight array per field. Filled in place, never re-made. */
export type FrameUniforms = { readonly [K in FrameField]: Float32Array };

/** Floats in one element of each type a frame field may be. */
const COMPONENTS: Readonly<Record<string, number>> = {
  f32: 1,
  vec2f: 2,
  vec3f: 3,
  vec4f: 4,
  mat4x4f: 16,
};

/** A zeroed frame. Made once by whoever fills it. */
export function createFrameUniforms(): FrameUniforms {
  const out: Record<string, Float32Array> = {};
  for (const f of FRAME_FIELDS as readonly UniformField[]) {
    out[f.name] = new Float32Array(COMPONENTS[f.type] * (f.count ?? 1));
  }
  return out as FrameUniforms;
}
