/**
 * wgsl/includes.ts — The shader text every surface in the game shares, as
 * Babylon WGSL includes: Babylon's half of `wgsl/chunks.ts`.
 * Owns: the registration of every chunk in `WGSL_CHUNKS` (`celBand`,
 * `celCloud`, `celShadow`, `celGi`, `celProbe`, `celProbeBox`, `celDither`,
 * `celSurface`, `celVertex`) and of the two `celInstances` entries into
 * `ShaderStore.IncludesShadersStoreWGSL`, and BABYLON'S DECLARATIONS for each
 * chunk that reads a uniform or a texture — the `uniform` and
 * `var … sampler` lines in Babylon's dialect, which the shared bodies may not
 * carry.
 * Invariants: every entry is prefixed `cel`; an entry is Babylon's
 * declarations for a chunk followed by that chunk's body, and the body is the
 * text `src/render/` assembles too, which nothing here edits — the whole entry
 * goes through `stripComments` and nothing else (see "WHY THE COMMENTS GO",
 * below); nothing
 * here declares a uniform or a sampler its consumer does not also list;
 * registration happens at import and must therefore precede the first effect
 * COMPILE, not merely the first material.
 * Contract: `docs/rendering.md`.
 *
 * WHY A REGISTERED INCLUDE RATHER THAN AN INTERPOLATED STRING. The GLSL these
 * replace are template literals pasted into three consumers, which was
 * survivable for a reason that does not survive the port: under WebGL2 a copy
 * that had drifted was a COMPILE ERROR in one shader, because the uniform
 * declarations and the code reading them travelled together and a mismatch did
 * not link. `celShadow` and `celProbe` declare uniforms and samplers, and
 * under WebGPU those feed the auto-generated `LeftOver` UBO struct — so three
 * copies that disagree are no longer a diagnostic anywhere. They are a
 * DIFFERENT UBO LAYOUT per shader, which fails as plausible values read from
 * the wrong offsets, on one surface, with nothing in the console.
 *
 * WHY THE DECLARATIONS ARE HERE AND THE BODIES ARE NOT. The bodies are shared
 * with our own renderer (`src/render/`, `BABYLON_EXIT.md` X3.1), which takes
 * them as plain WGSL with explicit bind groups and cannot take Babylon's
 * dialect — so a body declares nothing, and each side states the declarations
 * its own way: Babylon's here, ours as data in `render/celFragment.ts`. Two
 * declaration lists are the price, and the cheaper of the two copies to keep:
 * a name our side failed to declare is a loud failure where it assembles, and
 * a body that drifted between two copies would have been a silent one.
 *
 * WHY THE COMMENTS GO, BEFORE BABYLON SEES AN ENTRY. Babylon's processor
 * strips the comments of the TOP-LEVEL source only (`preProcessShaderCode`
 * runs before `ProcessIncludes`), so an include reaches its declaration
 * regexes with every comment still in it — and a sentence that quoted a
 * texture or uniform declaration would be matched as one, minting a binding
 * with nothing behind it and losing every draw that uses it. The cel
 * fragment's body is ~700 lines of prose, and it was top-level until it was
 * shared. Stripped here with the same function our preprocessor runs, an
 * entry is code alone, and a body's comments are free to say anything.
 *
 * WHY THE `cel` PREFIX IS THE COLLISION GUARD AND NOT A STYLE. Babylon
 * registers an include first-writer-wins (`if (!IncludesShadersStoreWGSL[name])`),
 * and its own library ships `instancesDeclaration`, `instancesVertex` and some
 * two hundred more under bare names. An unprefixed `dither` or `band` would
 * either silently shadow one of those or be silently shadowed BY one,
 * depending on which module the bundler happened to evaluate first — and the
 * failure is a shader that compiles and draws the wrong thing.
 *
 * WHAT STAYS IN TYPESCRIPT AND WHY. `SHADOW_UNIFORM_NAMES`,
 * `SHADOW_SAMPLER_NAMES`, `PROBE_UNIFORM_NAMES` and `PROBE_SAMPLER_NAMES` stay
 * where they are, in `CelShader.ts`. Registering the source is only half the
 * contract: a `ShaderMaterial` builds its bind group from the lists it is
 * CONSTRUCTED with, so an include that declares a sampler nobody listed is a
 * binding with nothing behind it — which under WebGPU is not the harmless
 * unbound black texture it was under WebGL2 but a bind group that fails to
 * build and every draw using it lost. The two halves have to be edited
 * together, which is easier to remember when they are visibly two halves.
 */
import { ShaderStore } from "@babylonjs/core";
import { WGSL_CHUNKS, type ChunkName } from "./chunks";
import { MAX_POINT_LIGHTS } from "./celSurface";
import { stripComments } from "../../render/wgsl/preprocess";

/**
 * Registers one include, refusing to overwrite a DIFFERENT source under a name
 * already taken. First-writer-wins is Babylon's own rule and this keeps it,
 * so a collision with the library (or with a second copy of this module) is a
 * loud failure here rather than a quiet difference in the picture.
 */
function register(name: string, source: string): void {
  const store = ShaderStore.IncludesShadersStoreWGSL;
  if (store[name] !== undefined && store[name] !== source) {
    throw new Error(`wgsl/includes: "${name}" is already registered`);
  }
  store[name] = source;
}

/**
 * Babylon's declarations for each chunk that reads anything, keyed by the
 * chunk. What each value MEANS is stated beside it; what the body DOES with it
 * is in `chunks.ts`. A chunk with no row here reads only what its consumer
 * declares (`celBand`, `celDither`) or what the cel fragment does
 * (`celSurface` and `celVertex`, whose declarations are the two stages' own,
 * in `CelShader.ts`).
 *
 * **Order is the LeftOver UBO's layout, and nothing reads the layout by
 * offset** — every uniform is set by name — so the order here is free; it is
 * kept as the declarations stood beside their code before the split.
 */
const DECLARATIONS: Partial<Record<ChunkName, string>> = {
  celCloud: `
// x, y: the key-space corner of the field, z: 1 / its side in metres,
// w: how LIT a point wholly inside a cloud's shadow is; 1 turns the term off.
uniform cloudShadow: vec4f;
// x, y: the light's toward vector as s.xz / s.y, so a point's key is
// posW.xz - xy * posW.y; z: the crossfade from the field in R to the one in G;
// w: the soft edge's half-width in field units (CONFIG's shadow.softness).
uniform cloudShadowRay: vec4f;
var cloudShadowMapSampler: sampler;
var cloudShadowMap: texture_2d<f32>;
`,
  celShadow: `
// ---- THE WORLD'S MAP AND ITS NEAR CASCADE, AND THE BODIES' MAP ----
// (ShadowSystem, BodyShadows) — the conventions are celShadow's body's.
uniform lightMatrix: mat4x4f;
var shadowMapSampler: sampler;
var shadowMap: texture_2d<f32>;
// x = depth bias, y = darkness, z = normal offset
uniform shadowParams: vec4f;

// The world's NEAR cascade — ShadowSystem's second map of the same casters,
// over a small window around the player at a fine texel. Same conventions as
// the pair above. Off is the lit 1x1 seen through a matrix that puts every
// receiver outside the window, so the far map answers alone.
uniform nearLightMatrix: mat4x4f;
var nearShadowMapSampler: sampler;
var nearShadowMap: texture_2d<f32>;
// x = depth bias, y = its own facet offset (metres)
uniform nearShadowParams: vec4f;

// The BODIES' map and its own view*projection — systems/BodyShadows.ts. Same
// conventions as the pair above, because it is the same kind of object built by
// the same Babylon generator: raw clip z, no [0,1] remap, XY to UV.
//
// **It is a different VOLUME, so it needs its own bias and cannot borrow the
// world's**: 13 cm against the world's 5 cm, over a 90 m volume against 180.
// The lookup's footprint needs nothing handed over — it is in texels of
// whichever map it reads, and the texture says its own size.
uniform bodyLightMatrix: mat4x4f;
var bodyShadowMapSampler: sampler;
var bodyShadowMap: texture_2d<f32>;
// x = depth bias. Darkness and the normal offset are
// NOT restated: a shadow is a shadow whichever map resolved it, and the offset
// is a property of the RECEIVER's facet rather than of either caster set.
uniform bodyShadowParams: vec4f;

// ---- THE LAMPS' ATLAS (systems/LocalShadows.ts) — per slot; the layout
// of each slot is stated over the lamps' half of celShadow's body.
uniform pointSpot: array<vec4f, ${MAX_POINT_LIGHTS}>;
uniform pointShade: array<vec4f, ${MAX_POINT_LIGHTS}>;
// x = tiles per atlas row, y = one tile's side in UV, z = one texel in UV,
// w = taps (1 or 4)
uniform localAtlas: vec4f;
// x = receiver bias (m), y = facet offset (m)
uniform localParams: vec4f;
var localAtlasMapSampler: sampler;
var localAtlasMap: texture_2d<f32>;

// ---- THE LIGHTNING'S KEY: its light and its map (ShadowSystem.flash) ----
uniform flashDir: vec3f;
uniform flashColor: vec3f;
uniform flashLightMatrix: mat4x4f;
// x = depth bias
uniform flashParams: vec4f;
var flashMapSampler: sampler;
var flashMap: texture_2d<f32>;
`,
  celGi: `
var giIrrSampler: sampler;
var giIrr: texture_3d<f32>;
var giDirSampler: sampler;
var giDir: texture_3d<f32>;
var giAuxSampler: sampler;
var giAux: texture_3d<f32>;
var giVis0Sampler: sampler;
var giVis0: texture_3d<f32>;
var giVis1Sampler: sampler;
var giVis1: texture_3d<f32>;
var giVis2Sampler: sampler;
var giVis2: texture_3d<f32>;
var giVis3Sampler: sampler;
var giVis3: texture_3d<f32>;
// x = 1 / spacing, y = columns, z = layers, w = 1 / (layerHeight * layers)
uniform giGrid: vec4f;
// x, z = the window's centre in the world, y = its half side, w = the height
// the stored floors are relative to
uniform giWindow: vec4f;
// x = strength, y = the unoccluded share of the flat ambient, z = how much of
// the baked vertex AO still applies, w = 1 while a volume is live
uniform giShade: vec4f;
// x = band steps per reference, y = 1 / the reference luminance, z = the
// normal offset in metres, w = 1 when point lights are occluded
uniform giBand: vec4f;
// x = the band's ceiling in references, y = the lightning flash's sky fill
uniform giExtra: vec4f;
// Which visibility CHANNEL each point-light slot reads. A channel belongs to a
// LIGHT for as long as it keeps a slot, so a lantern's visibility is traced
// once when it wins one rather than every frame — and a muzzle flash taking
// slot 0 moves nobody else's answer.
uniform giSlotChannel: array<f32, ${MAX_POINT_LIGHTS}>;
`,
  celProbe: `
// The world as a mirror sees it: one cube baked per map install from the
// map's own geometry (systems/ReflectionSystem.ts). Alpha 1 where the bake
// drew something and 0 where it saw nothing at all, which is what lets the
// sky above stay the analytic gradient and the world below be a picture of
// the world. Colour is NOT premultiplied — see each sampler's own mix.
var reflectionCubeSampler: sampler;
var reflectionCube: texture_cube<f32>;
// Where the cube was baked from, and how much of it this surface returns
// against the sky it would otherwise show: reflectProbe.xyz is the bake point
// and .w is the strength — 0 where nothing was baked, which is every editor
// build and every map with nothing to bake for.
uniform reflectProbe: vec4f;
`,
  celProbeBox: `
// The box the mirrored ray is parallax-corrected against — the map's own
// extent, floor to roofline.
uniform reflectBoxMin: vec3f;
uniform reflectBoxMax: vec3f;
`,
};

for (const [name, body] of Object.entries(WGSL_CHUNKS) as [ChunkName, string][]) {
  register(name, stripComments((DECLARATIONS[name] ?? "") + body));
}

/**
 * The mesh transform, and these two entries are OURS rather than Babylon's for
 * a reason that is a project rule and not a preference.
 *
 * The GLSL path deep-imported `@babylonjs/core/Shaders/ShadersInclude/
 * instances{Declaration,Vertex}`, which were two of the four grandfathered deep
 * imports in the tree. The WGSL twins would have been two MORE subpaths, and
 * `CLAUDE.md` forbids a new one absolutely — a deep static import into
 * `@babylonjs/core` breaks a DEV session only, blames a subsystem that is not
 * at fault, and hides itself on a restart. So the port ended with NONE of them
 * rather than six, and what these cost instead is fifteen lines that have to
 * be kept honest. `scripts/check-deep-imports.mjs` keeps the count at zero,
 * which is only an enforceable rule because these exist.
 *
 * **They mirror `ShadersWGSL/ShadersInclude/instances{Declaration,Vertex}.js`
 * of `@babylonjs/core` 9.28.0**, byte-identical to 9.19.1's where they were
 * first ported, minus the branches nothing in this game
 * compiles: `INSTANCESCOLOR` (no instance colour buffer anywhere),
 * `WORLD_UBO` (a `ShaderMaterial` never defines it) and the four velocity
 * defines (no prepass). Anything that starts using one of those does not get
 * it for free here — diff against the files named above when Babylon moves.
 */
register(
  "celInstancesDeclaration",
  `
#ifdef INSTANCES
attribute world0 : vec4f;
attribute world1 : vec4f;
attribute world2 : vec4f;
attribute world3 : vec4f;
#ifdef THIN_INSTANCES
uniform world : mat4x4f;
#endif
#else
uniform world : mat4x4f;
#endif
`,
);

/**
 * Declares `finalWorld` — the mesh's world matrix times the per-instance one.
 * Goes INSIDE `main`, and every consumer's first world-space line reads it.
 *
 * A thin instance's matrix is the mesh's own times the instance's, which is
 * why the `world` uniform is still bound under `THIN_INSTANCES`; a plain
 * hardware instance carries the whole transform in its four columns and the
 * uniform is not declared at all.
 */
register(
  "celInstancesVertex",
  `
#ifdef INSTANCES
var finalWorld = mat4x4f(
  vertexInputs.world0, vertexInputs.world1, vertexInputs.world2, vertexInputs.world3);
#ifdef THIN_INSTANCES
finalWorld = uniforms.world * finalWorld;
#endif
#else
var finalWorld = uniforms.world;
#endif
`,
);
