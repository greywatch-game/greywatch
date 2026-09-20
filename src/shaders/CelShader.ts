/**
 * CelShader.ts — The look: custom cel ShaderMaterial (banded directional key +
 * up to MAX_POINT_LIGHTS=16 dynamic point lights + ambient, fog, ground mist,
 * rim, hard stepped shadows, opt-in toon specular) and CelMaterialFactory,
 * the cache every lit material comes from.
 * Invariants: the scene's ONLY Babylon light is ShadowSystem's shadow-camera
 * DirectionalLight, which no material reads — light arrives via these
 * uniforms, uploaded by LightingSystem once per frame. Flat/faceted shading is
 * recovered in the fragment shader from screen-space derivatives — NEVER call
 * convertToFlatShadedMesh(). Output is display-ready color, which is why
 * pipeline.imageProcessingEnabled must stay false. Output is also opaque, and
 * an opaque cel fragment writes `opaqueAlpha` rather than 1 — the frame's alpha
 * channel is TRANSLUCENT COVERAGE and a probe's is the cube's own mask, so the
 * two passes want opposite values out of the same line (see that uniform, and
 * CelInk). Every variant but getGlass() writes it; that one, the world's one
 * alpha-blended material, writes a Fresnel alpha, needs no depth write
 * (see there, and MapBuilder's pane rules), carries the one depth bias in
 * the renderer — GLASS_DEPTH_UNITS, without which a pane past ~100 m is not
 * drawn at all — and is the one variant that samples anything the renderer
 * drew for itself (setReflection, whose cube ReflectionSystem bakes and whose
 * strength is 0 until it has). Materials are cached/shared per color — don't create per-mesh
 * materials, and NEVER dispose one: a mesh's paint belongs to the cache and not
 * to the mesh, so `dispose(false, true)` on any rig built through here disposes
 * the world's own materials with it. Nothing removes the dead entry from the
 * cache, and the released effect is shared, so what follows is most of the map
 * silently not drawn (see Vehicle.dispose). A new material reaches the cache
 * only through `remember`, which files it FROZEN: `ShaderMaterial.isReady`
 * otherwise rebuilds the whole define set for every submesh of every pass and
 * throws it away, a fifth of everything the game allocates, and `isFrozen`
 * skips exactly that while leaving the uniform push alone. That is only safe
 * while no material is worn by two meshes that DISAGREE about a vertex colour
 * buffer, instancing, bones or morph targets — the four things those defines
 * vary with — so WIDENING A CACHE KEY owes that check again (docs/rendering.md,
 * FINDINGS 36). A NEW material is seeded with
 * every piece of shared state on the spot (applyCamera/applyEnvironment/
 * applyPointLights/applyShadow): the per-frame walks are guarded on change and
 * skip a still frame entirely, so what a material is born with is what it keeps
 * until that state next moves. Effect meshes use getEmissive() (unlit
 * StandardMaterial). **Nothing here registers a mesh for INK any more**: the
 * ink is one full-screen pass over the frame's own depth (`shaders/CelInk.ts`),
 * so it takes no per-mesh bookkeeping, no back-face shell and no second
 * material — `metadata.noInk` survives as a record of INTENT that nothing
 * reads to decide ink, and what actually keeps a part out of the line work is
 * the glow's mask, the near-depth band or being coplanar (CLAUDE.md).
 * Also owns the fog as a published fact: setEnvironment writes it once, the cel
 * materials get it as uniforms, CelInk takes the same band as `fadeBand`,
 * EmissiveFog uploads it to the unlit emissive materials, and fogAmountAt()
 * hands the same curve to the glow's rules. Anything else drawn unshaded owes that
 * fade, or it hangs in front of the fog wall at full strength.
 *
 * Both stages are hand-written WGSL, and `shaderLanguage` on all six materials
 * is load-bearing rather than declarative: a `ShaderMaterial` defaults to GLSL
 * and would look these up in a store nothing writes any more. Two things about
 * the port are worth knowing before editing either stage. **A sampler a
 * variant DECLARES has to be BOUND, used or not** — which is why the sampler
 * declarations below sit under exactly the defines each material's own
 * `samplers` list is built from rather than under a looser one that would let
 * a variant declare what it never binds. And **the defines make FIVE UBO
 * LAYOUTS**, so a uniform moved into or out of an `#ifdef` moves offsets for
 * that variant alone. See `docs/rendering.md` for the rest of what the dialect
 * and Babylon's WGSL processor decide.
 */
import {
  type BaseTexture,
  Color3,
  Matrix,
  Mesh,
  Scene,
  ShaderLanguage,
  ShaderMaterial,
  ShaderStore,
  StandardMaterial,
  Vector2,
  Vector3,
  Vector4,
  VertexBuffer,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import { attachEmissiveFog, setEmissiveFog } from "./EmissiveFog";
import { FlameMaterial } from "./FlameShader";
// The shared includes self-register in the IncludesShadersStoreWGSL; import
// them explicitly so the #include<cel...> lines below can never be tree-shaken
// away, and so registration is provably before the first effect COMPILE rather
// than merely before the first material.
import "./wgsl/includes";

/**
 * Custom cel-shading: quantized diffuse bands, a hard stylized rim highlight,
 * flat colors (or a world-XZ-mapped texture albedo, for ground surfaces like
 * cobblestone roads), and per-theme
 * atmosphere blended in the fragment shader. Ground-textured materials may
 * also carry a matching height map (CEL_BUMP): the facet normal is perturbed
 * by the height slope, measured from world-space taps a texel apart — never
 * from screen-space derivatives, which make the relief boil as the player walks
 * (see perturbNormal) — so the light bands ripple across individual
 * cobblestones. The same height map is also marched for DEPTH — parallax and
 * a hard self-shadow toward the key (reliefParallax, reliefLit) — so a stone
 * hides the mortar behind it and throws a shadow off its far side.
 * Outlines are drawn with Babylon's outline renderer (inverted hull).
 *
 * Lighting has four parts, all banded so the toon look survives:
 * - a directional key light (moon/sun) quantized into 4 hard bands and gated
 *   by a hard two-level shadow term (ShadowSystem's depth map — lit or not,
 *   never a soft penumbra),
 * - up to `MAX_POINT_LIGHTS` dynamic point lights (torches, neon, muzzle
 *   flashes) quantized into 3 bands with a smooth radial falloff, and
 * - a flat ambient term that sets how black the unlit side goes — the main
 *   dial for the horror mood. Point lights deliberately ignore the shadow
 *   map, so a lantern still warms ground the moon can't reach.
 * Opt-in per material (getGlossy / getGroundTextured's spec): a toon
 * specular — one two-band Blinn highlight from the key light, gated by the
 * same shadow. Everything not explicitly glossy stays matte.
 * Opt-in the same way (getTranslucent): a translucency band — the key light
 * coming THROUGH a thin surface rather than off it, for awnings and foliage.
 * Everything not explicitly translucent stays opaque.
 * Opt-in at COMPILE time (getGlass, `#define CEL_GLASS`): a pane of glazing —
 * a Fresnel between what is behind it and a reflection of the sky with the
 * city composited into it, written out as a per-pixel alpha. A define rather
 * than a uniform because, unlike the two above, its terms cannot be multiplied
 * out to nothing by a zero colour: a reflect(), a pow(), a sky gradient and a
 * cube fetch on every pixel of the world is not a price the other thousand
 * meshes should pay to keep the roster uniform.
 *
 * The rim highlight is gated OFF near-level surfaces, and must stay that way:
 * on a plane the grazing angle is just the distance from the eye, so an
 * ungated rim draws a hard-edged, camera-locked disc on the floor that slides
 * around with the player. See the gate itself for the measurement.
 *
 * Atmosphere is distance fog plus a separate height-based ground mist, so
 * arenas fade into darkness and the floor sits in a low-lying haze.
 *
 * Shading is faceted: the fragment shader recovers each triangle's geometric
 * normal from screen-space derivatives of the world position rather than
 * using the interpolated vertex normal. Every mesh in the game is built from
 * coarse primitives, so hard facets are the intended look — and doing it in
 * the shader avoids `convertToFlatShadedMesh()`, which would unweld vertices
 * on every prop, enemy, and clone.
 */

/**
 * Shader-side light slots. The LightingSystem uploads the nearest N — a big
 * arena holds far more fixtures than this, and with only a handful of slots
 * a cluster of small glows (fungus, glyphs) would starve the lanterns and
 * braziers that actually shape the room.
 */
export const MAX_POINT_LIGHTS = 16;

/**
 * How many albedos one map's world geometry may carry before the merge stops
 * collapsing it.
 *
 * **Overflow is not an error and must never become one.** A colour past this
 * cap simply keeps its own material and merges the way everything did before
 * the palette existed — one more mesh per block, which is the cost this whole
 * mechanism exists to avoid and not a broken map. That is what lets the number
 * be a judgement rather than a contract: the four shipped maps' world geometry
 * uses 43 to 79 colours, so 128 is roughly a doubling of headroom, and a map
 * that wanted 300 would get the first 128 collapsed and the rest as they were.
 *
 * The cost of raising it is a uniform buffer on two materials — WGSL pads a
 * `vec3f` in an array to 16 bytes, so this is 2 KB apiece — plus nothing else.
 * The cost of lowering it is silent, which is why it is stated here beside the
 * measurement rather than left in `config/`: it is a property of the SHADER,
 * and it has to be a compile-time literal to size the array at all.
 */
export const MAX_PALETTE = 128;

/**
 * Stamps one source mesh's palette slot into `uv2.x`, before it is merged.
 *
 * **Before, because after is too late**: `MergeMeshes` concatenates vertex
 * buffers, so the index has to already be per vertex for the merge to carry it.
 * That is also what makes the whole scheme safe against interpolation — a merge
 * never re-triangulates, so every corner of a triangle keeps the index of the
 * mesh it came from.
 *
 * `uv2` and not the colour buffer, which has the room: the colour buffer is
 * written by `vertexShading.ts` AFTER every merge and from scratch, so a value
 * put there now would be overwritten by the bake, and teaching the bake to
 * preserve a channel would couple it to this. `uv2` is untouched by all of it.
 *
 * The all-or-nothing rule `CLAUDE.md` records for `colors` applies here too —
 * `VertexData.merge` throws when one mesh in a group has an attribute and
 * another does not — and it is kept by construction rather than by a check:
 * a mesh gets a slot exactly when it is going into the paletteised group, and
 * every mesh in that group got one.
 *
 * **It lives here rather than with either caller because there are now TWO**,
 * and the two index different tables: `MapBuilder`'s merge writes slots in the
 * map palette `setPalette` publishes, and `SoldierModel` writes slots in the
 * kit palette `getBodyCel` holds. What they share is this attribute and the
 * varying that reads it, which is the shader's, so the one thing neither of
 * them may state twice is where the index goes.
 */
export function writePaletteIndex(mesh: Mesh, slot: number): void {
  const count = mesh.getTotalVertices();
  const uv2 = new Float32Array(count * 2);
  // Only x is read. y is left at 0 rather than given a second meaning: the
  // slot's whole value is that it is the ONE thing this attribute says.
  for (let i = 0; i < count; i++) uv2[i * 2] = slot;
  mesh.setVerticesData(VertexBuffer.UV2Kind, uv2, false);
}

/**
 * The parallax box's uniform names, for a material that includes `celProbeBox`.
 *
 * The include itself is in `wgsl/includes.ts` and so is the argument for it —
 * including why it is separate from `celProbe`, which is the half a reader is
 * most likely to undo. These two names stay here because registering the
 * source is only half the contract: a `ShaderMaterial` builds its bind group
 * from the lists it is CONSTRUCTED with.
 */
export const PROBE_BOX_UNIFORM_NAMES = ["reflectBoxMin", "reflectBoxMax"];
/**
 * The probe uniform a sampling material owes, beside `PROBE_SAMPLER_NAMES`.
 *
 * **One list per INCLUDE, and that is what makes "registering is half the
 * contract" mechanical rather than a thing to remember.** This is `celProbe`'s
 * one uniform; `PROBE_BOX_UNIFORM_NAMES` above is `celProbeBox`'s two, and a
 * material lists exactly the includes it takes. This list used to carry all
 * three, which was harmless under GLSL and read as though the water — which
 * includes `celProbe` and deliberately not `celProbeBox` — wanted a parallax
 * box it has never set and must never have.
 */
export const PROBE_UNIFORM_NAMES = ["reflectProbe"];

/** The cube itself. */
export const PROBE_SAMPLER_NAMES = ["reflectionCube"];

/**
 * The uniform names `celShadow` declares, for a consumer's uniform list.
 *
 * FOUR now rather than two: the world's map and the bodies' each carry a matrix
 * and a params vector, because they are two windows at two resolutions over two
 * depth volumes and nothing in either pair transfers. See
 * `systems/BodyShadows.ts`.
 */
export const SHADOW_UNIFORM_NAMES = [
  "lightMatrix",
  "shadowParams",
  "bodyLightMatrix",
  "bodyShadowParams",
] as const;
/**
 * The samplers `celShadow` declares, for a consumer's sampler list.
 *
 * **Both must be BOUND on every material that lists them, always** — a declared
 * sampler with nothing behind it is a bind group that fails to build and every
 * draw using it silently lost, which is the whole reason these two lists exist
 * as exported constants. `BodyShadows` therefore creates its map in its
 * constructor and hands it over there, before `MapBuilder` has asked for a
 * single material: there is no state in which this one is absent.
 */
export const SHADOW_SAMPLER_NAMES = ["shadowMap", "bodyShadowMap"] as const;

ShaderStore.ShadersStoreWGSL["celVertexShader"] = `
attribute position: vec3f;
attribute normal: vec3f;
// Baked world shading, written by world/vertexShading.ts: alpha is ambient
// occlusion, green marks a vertex as WORLD geometry and RED is how much of the
// wind's travel this vertex is entitled to. Declared unconditionally and on
// purpose — a mesh with no colour buffer leaves this attrib array disabled,
// which reads back as the generic default (0, 0, 0, 1): occlusion 1 (none),
// mask 0 (not world) and sway 0 (planted). Every rig, the viewmodel and every
// effect mesh is therefore correct without carrying one.
attribute color: vec4f;

#ifdef CEL_PALETTE
// The albedo's 1-based slot in \`celPalette\`, written per source mesh by
// \`MapBuilder\` before the merge concatenates it. Behind the define — unlike
// \`color\` above, which every cel material declares — because a material
// without the define binds no such buffer, and **an attribute this struct does
// not declare is a WGSL compile error rather than a disabled attrib reading a
// default**: \`vertexInputs.uv2\` comes back "struct member uv2 not found" and
// the module fails, which under \`compatibilityMode = false\` poisons the whole
// render bundle and takes the entire frame black rather than one mesh.
attribute uv2: vec2f;
#endif

// No instances declaration and no bones, and both absences are facts about the
// game rather than omissions. Nothing here is drawn instanced — the one
// thin-instanced surface is the grass, which has a shader of its own — and
// there is no rigged asset in the tree at all, so the skinned+textured variant
// this shader used to carry had no caller left. Deleting it took the two bone
// includes with it, and with them two of the four grandfathered deep imports
// into \`@babylonjs/core\` that CLAUDE.md forbids adding to.
uniform world: mat4x4f;
uniform viewProjection: mat4x4f;

// The wind, shared with the grass field (CONFIG.wind). windDir is the bearing,
// normalised; windParams is (travel in metres at full weight, speed, gust
// wavenumber). windTime is the same clock the grass runs on, pushed by
// CelMaterialFactory.updateWind — it advances with the world rather than with
// the frame, so a pause holds the canopy exactly as it holds the field.
uniform windTime: f32;
uniform windDir: vec2f;
uniform windParams: vec3f;

varying vNormalW: vec3f;
varying vPosW: vec3f;
varying vBaked: vec4f;

#ifdef CEL_PALETTE
// The 1-based index of this vertex's albedo in \`celPalette\`, carried in uv2's
// x. **It is 1-based so that 0 can mean "not paletted"**, which is what the
// disabled attrib's default gives any mesh that never had the buffer written —
// the same trick \`vBaked\` leans on, and what lets one material serve a
// merge group that a builder did not paletteise.
//
// A vertex attribute is INTERPOLATED and an index cannot be, which is safe here
// for a structural reason rather than by luck: a merge concatenates whole
// meshes and never re-triangulates, so all three corners of any triangle come
// from the same source mesh and carry the same index. The fragment stage still
// rounds, because "safe" and "guaranteed by the hardware" are different things.
varying vPalette: f32;
#endif

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  var worldPos = uniforms.world * vec4f(vertexInputs.position, 1.0);

  // --- foliage sway, in world space, weighted by the baked red channel ---
  //
  // Branched rather than multiplied out, and the branch costs nothing because
  // it is coherent: the sway mark is part of the merge KEY, so a draw is either
  // all foliage or all wall and no warp ever has both answers in it. Everything
  // that is not world geometry — every rig, the viewmodel, every grenade and
  // every effect mesh — carries no colour buffer at all and takes the disabled
  // attrib's 0, so it pays one compare and no transcendentals.
  //
  // The gust is the grass shader's shape at the canopy's scale: two crossing
  // sines, the second at 2.33x so the field never repeats on a clean beat,
  // phased along the wind's own bearing so a gust TRAVELS rather than every
  // crown leaning at once.
  if (vertexInputs.color.r > 0.0) {
    // Subtracted, not added: a gust has to travel WITH the wind, and a wave
    // whose phase runs the other way rolls up the valley against the lean of
    // everything in it. The grass shader adds instead, and gets away with it
    // because its phase is not along the bearing at all — here it is.
    let phase = dot(worldPos.xz, uniforms.windDir) * uniforms.windParams.z;
    let gust = sin(uniforms.windTime * uniforms.windParams.y - phase)
      + 0.5 * sin(uniforms.windTime * uniforms.windParams.y * 2.33 - phase * 1.71);
    // Two component writes rather than one swizzle write: WGSL allows an
    // assignment to a single component and forbids one to a multi-component
    // swizzle, so the GLSL "worldPos.xz +=" has to be spelled out.
    let lean =
      uniforms.windDir * (gust * uniforms.windParams.x * vertexInputs.color.r);
    worldPos.x += lean.x;
    worldPos.z += lean.y;
  }

  // WGSL has no mat4 -> mat3 conversion, so the upper-left block is taken by
  // hand; a matrix indexes by COLUMN, which is what makes that read correctly.
  let nW = normalize(
    mat3x3f(uniforms.world[0].xyz, uniforms.world[1].xyz, uniforms.world[2].xyz)
      * vertexInputs.normal);
  vertexOutputs.vNormalW = nW;

  vertexOutputs.vPosW = worldPos.xyz;
  vertexOutputs.vBaked = vertexInputs.color;
  #ifdef CEL_PALETTE
  vertexOutputs.vPalette = vertexInputs.uv2.x;
  #endif
  vertexOutputs.position = uniforms.viewProjection * worldPos;
}
`;

// The derivative users below are what was MEANT — a facet normal is a
// screen-space difference, band()'s width is how fast its index moves per
// pixel, and the ground albedo, its height map and the reflection cube are the
// three fetches in this shader whose textures carry a MIP CHAIN, so an implicit
// LOD is the filtering rather than an oversight. None of them has an
// explicit-LOD form to reach for, and every one of them sits behind an #ifdef
// or a loop WGSL's uniformity analysis cannot prove uniform — hence the define.
// Every fetch in celShadow is a textureSampleLevel already, because the depth
// map has no mip chain and an explicit level 0 is what was meant there.
ShaderStore.ShadersStoreWGSL["celFragmentShader"] = `
#define DISABLE_UNIFORMITY_ANALYSIS

varying vNormalW: vec3f;
varying vPosW: vec3f;
// Baked per-vertex world shading. w is ambient occlusion, 1 = unoccluded;
// y is 1 on map geometry and 0 on everything else; x is the wind weight the
// vertex stage has already spent. All three defaults come from the disabled
// attrib rather than from a uniform — see the vertex stage.
varying vBaked: vec4f;

uniform lightDir: vec3f;
uniform lightColor: vec3f;
// How far the key wraps toward full on anything facing it — see the key term.
uniform keyWrap: f32;
uniform ambientColor: vec3f;
// Hemispheric fill from the sky dome: full strength on up-facing surfaces,
// nothing underneath. Banded like everything else so the toon look survives.
uniform skyLightColor: vec3f;
uniform rimColor: vec3f;
#ifdef CEL_GROUND_TEX
// World-mapped ground albedo: sampled at vPosW.xz * texScale, so no UVs are
// needed and the pattern keeps a constant real-world size across placements.
var baseColorTexSampler: sampler;
var baseColorTex: texture_2d<f32>;
uniform texScale: f32;
// The tile's own weathering — see graphics.groundVariation in the config for
// why a ground texture gets a wider cell and a wider swing than a flat colour.
uniform groundVariationScale: f32;
uniform groundVariationAmount: f32;
#ifdef CEL_BUMP
// Height map matching the albedo texel-for-texel (domed setts, dark mortar).
var bumpTexSampler: sampler;
var bumpTex: texture_2d<f32>;
uniform bumpScale: f32; // metres of fake relief at height value 1.0
// The relief's DEPTH — see groundRelief. x, y: the distance the parallax fades
// out over; z, w: the distance the self-shadow fades out over.
uniform reliefFade: vec4f;
// x: how dark the relief's own shadow is (1 = the key gone), y: how much of the
// ambient a groove at height 0 loses.
uniform reliefShade: vec2f;
#endif
#else
uniform baseColor: vec3f;
#endif
uniform fogColor: vec3f;
uniform fogParams: vec2f;  // x = start, y = end
#ifdef CEL_PALETTE
// The map's own albedo palette, indexed by \`vPalette - 1\`. This is what lets
// one material stand for every paint colour in the village, which is what lets
// \`BlockMerge\` collapse a 48 m block to one mesh instead of ten — see
// \`getWorldCel\`. Behind a define rather than in the shared uniform list
// because only two materials in the scene ever read it and it is 2 KB.
varying vPalette: f32;
uniform celPalette: array<vec3f, ${MAX_PALETTE}>;
#endif
uniform mistColor: vec3f;
uniform mistParams: vec2f; // x = height falloff, y = strength
uniform camPos: vec3f;

// WHAT AN OPAQUE FRAGMENT WRITES INTO THE ALPHA CHANNEL, and it is 0 in the
// frame and 1 in a probe's bake because that channel means two different
// things in the two passes. In the FRAME it is TRANSLUCENT COVERAGE, which
// CelInk reads to know how much smoke got between it and the depth it is
// drawing an edge off — see that file. In a reflection PROBE it is the cube's
// own coverage mask, which is how the glazing below tells the city from the
// sky above it (city.a), and there it has to be 1 or the bake comes back
// empty. CelMaterialFactory.setOpaqueAlpha is the flip and
// ReflectionSystem is its only caller, on the same two hooks that lend the
// bake the probe's eye.
uniform opaqueAlpha: f32;

// Albedo weathering: cell size (as 1/metres) and peak-to-peak swing. Uniforms
// rather than literals so the pair can be judged live against a wall.
uniform variationScale: f32;
uniform variationAmount: f32;
// The map's grime and how much of it. x is the strength of the whole term and
// 0 is off; y is the cosine edge the vertical fade starts at; z is the ramp's
// falloff exponent, which is spent HERE rather than in the bake because a curve
// baked at a wall's two corners is a straight line by the time it is a
// fragment; w is how far the grain displaces the ramp, peak to peak.
//
// \`wearGrain\` is that grain's shape: x is 1/metres of its coarse octave, y is
// how much the noise cells are squashed vertically — which is what turns
// blotches into runs down a face — and z is how far the field is stretched
// about its middle, without which a value noise's own clustering leaves the
// tide line effectively straight. See the WEAR block in the fragment body, and
// \`CONFIG.wear\` for what the bake put in the blue channel these are spent on.
uniform wearColor: vec3f;
uniform wearParams: vec4f;
uniform wearGrain: vec3f;

uniform pointPos: array<vec3f, ${MAX_POINT_LIGHTS}>;
uniform pointColor: array<vec3f, ${MAX_POINT_LIGHTS}>; // rgb premultiplied by intensity
uniform pointRange: array<f32, ${MAX_POINT_LIGHTS}>;
uniform pointCount: f32;

// The count reaches the declarations above by INTERPOLATION and the loop bound
// below as a real const, and the split is forced rather than stylistic: a
// uniform array's size must be a literal or a #define, because Babylon resolves
// the bound out of the preprocessor table when it lays out the leftover UBO and
// a WGSL const is not in that table — while a #define is the worse of the two,
// since the processor implements one as an un-anchored regex over the whole
// source. GrassShader settled this; see docs/rendering.md.
const MAX_POINT_LIGHTS: i32 = ${MAX_POINT_LIGHTS};

// How big a light is in a mirror — the exponent of the lobe the mirrored ray
// gathers one over, read as a half-width: 8 is about 35 degrees. And how sharp
// the horizon in that room is, as the sine either side of level: 0.1 is about
// 6 degrees. Both are about the LOOK rather than about any one material, which
// is why they are here beside the band counts rather than in a spec — the same
// call TranslucencySpec makes. The mirror block says what each buys and what
// the narrow settings of both photographed as.
const MIRROR_GLOSS: f32 = 8.0;
const MIRROR_HORIZON: f32 = 0.10;

#include<celShadow>

// Toon specular: one hard two-band Blinn highlight from the key light.
// specColor is premultiplied by intensity — black (the default) is matte.
uniform specColor: vec3f;
uniform specShininess: f32;
// The top rung of the gloss ladder, and the one that is not a highlight: how
// much of the ENVIRONMENT a polished surface hands back instead of its own
// shaded colour. Zero (the default, and every matte, satin and metal material
// in the game) leaves the whole mirror block below unentered — a uniform
// branch, which is the same shape the albedo weathering's mask already is.
uniform specMirror: f32;

// Translucency: the key light coming THROUGH a thin surface rather than off
// it — a canvas awning or a pine crown with the moon behind it. Premultiplied
// by intensity — black (the default) is opaque.
uniform transColor: vec3f;

#ifdef CEL_GLASS
// Glazing. x = reflectance face-on, y = the Fresnel falloff's exponent,
// z = cosine half-width of the sun's halo in the reflection, w = how much of
// the tint a face-on pane keeps. See CelMaterialFactory.getGlass.
uniform glassParams: vec4f;
// The top of the sky dome. The HORIZON end of the same gradient is fogColor,
// which is already here and which SkySpec.horizonColor is required to sit
// close to — the one place that requirement is load-bearing rather than
// cosmetic.
uniform skyZenithColor: vec3f;
#ifdef CEL_GLASS_BACKED
// The ALBEDO of the mass this sheet hangs on, named by the builder that hung
// it (the backed argument of Build.pane). Unlit, because it is shaded here by
// the same light the pane is: they are parallel faces a hand apart, so one
// light term is right for both. See the composite below for why this is exact rather
// than an approximation of the blend it replaces.
uniform glassBackdrop: vec3f;
#endif
#endif

// Geometric (per-triangle) normal from the world position's screen-space
// derivatives. The cross product's sign depends on triangle winding and
// viewing direction, so it is flipped to agree with the interpolated normal.
//
// CEL_SMOOTH is the one exception, and it is for CLOTH: a sheet that bends is
// drawn from a fine grid, and a facet per triangle of it is a lattice of
// flickering diamonds rather than a fold. There the interpolated normal is the
// shape, and the bands still cut it hard — they just follow the folds.
fn facetNormal() -> vec3f {
#ifdef CEL_SMOOTH
  return normalize(fragmentInputs.vNormalW);
#else
  let n = normalize(cross(dpdx(fragmentInputs.vPosW), dpdy(fragmentInputs.vPosW)));
  return select(n, -n, dot(n, fragmentInputs.vNormalW) < 0.0);
#endif
}

#include<celBand>
#include<celDither>

// Trilinear value noise over world space, 0..1. Deliberately one octave: this
// is weathering, not detail — a second octave adds frequencies the palette
// cannot express and starts reading as texture on a surface that has none.
fn variationHash(cell: vec3f) -> f32 {
  return fract(sin(dot(cell, vec3f(127.1, 311.7, 74.7))) * 43758.5453123);
}

fn valueNoise(p: vec3f) -> f32 {
  let i = floor(p);
  var f = fract(p);
  // Smoothstep the interpolant, or the cell boundaries show as creases.
  f = f * f * (3.0 - 2.0 * f);
  let n000 = variationHash(i + vec3f(0.0, 0.0, 0.0));
  let n100 = variationHash(i + vec3f(1.0, 0.0, 0.0));
  let n010 = variationHash(i + vec3f(0.0, 1.0, 0.0));
  let n110 = variationHash(i + vec3f(1.0, 1.0, 0.0));
  let n001 = variationHash(i + vec3f(0.0, 0.0, 1.0));
  let n101 = variationHash(i + vec3f(1.0, 0.0, 1.0));
  let n011 = variationHash(i + vec3f(0.0, 1.0, 1.0));
  let n111 = variationHash(i + vec3f(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z);
}

#ifdef CEL_BUMP
// Bump mapping for the world-XZ ground textures: perturbs the facet normal by
// the height map's slope, so the quantized light bands ripple across individual
// stones instead of sliding over one flat plane.
//
// **The slope is measured in WORLD space, from taps a texel apart, and it must
// not be measured in screen space.** The first cut used the surface-gradient
// formulation (Mikkelsen 2010) off dpdx(h)/dpdy(h), which is the right tool
// for a UV-mapped normal map on a mesh and the wrong one here, for a reason
// that only bites once the ground is the whole frame:
//
// A screen-space derivative measures how the height changes across ONE PIXEL,
// so the slope a given patch of ground reports depends on how big a pixel is
// there — which is a fact about the camera, not about the ground. On a floor
// seen at a grazing angle a pixel spans several texels along the view
// direction, so the difference is taken across unrelated grains and comes back
// as noise; and because the sampling grid slides over the texture as the player
// walks, that noise is DIFFERENT every frame. The relief boils. It is invisible
// on the cobbled street this shader was written for — a few square metres, seen
// from close and steep — and unmissable the moment a map states a
// floorSurface and 240 m of valley floor gains a height map. Measured against
// a 4x supersampled reference of the same frame, ground at 3-9 m went from 1.8%
// of pixels off-reference to 10.3% when the floor gained relief, and every bit
// of that was this function.
//
// Central differences at a fixed WORLD offset have neither problem. The slope
// at a point is the same however far away the camera is, so nothing boils; each
// tap is a filtered fetch rather than a difference of one, so the anisotropic
// sampler does its job; and the relief fades out on its own at distance,
// because two taps a texel apart converge as the mip chain smooths them. That
// last part is the whole reason no explicit distance fade is needed here — and
// it is why these three fetches are textureSample rather than
// textureSampleLevel: the mip chain IS the fade, and an explicit level 0 would
// delete it.
//
// Three taps rather than four: forward differences off a shared centre. The
// asymmetry is half a texel of bias in where a grain's slope is reported, which
// is nothing beside a fetch per ground pixel.
//
// **Every fetch from here down is textureSampleGrad against the UNDISPLACED
// footprint** (gx, gy — the world-mapped uv's own screen derivatives, taken
// once in main). The mip chain is still the fade, exactly as it was when these
// were implicit; what the explicit gradient buys is that the parallax below may
// move uv by a different amount on neighbouring pixels without that jump being
// read as a footprint — an implicit LOD taken off a displaced uv picks the
// smallest mip along every silhouette the relief draws, which is a grey seam
// round every stone.
fn perturbNormal(n: vec3f, uv: vec2f, gx: vec2f, gy: vec2f) -> vec3f {
  // One texel of the height map. Albedo and height are painted at the same
  // size (SIZE in world/textures.ts), which is what lets this be a constant.
  let e = 1.0 / 512.0;
  let h0 = textureSampleGrad(bumpTex, bumpTexSampler, uv, gx, gy).r;
  let hx = textureSampleGrad(bumpTex, bumpTexSampler, uv + vec2f(e, 0.0), gx, gy).r;
  let hz = textureSampleGrad(bumpTex, bumpTexSampler, uv + vec2f(0.0, e), gx, gy).r;
  // Metres of rise per metre travelled: the tap is e / texScale metres away.
  let perMetre = uniforms.bumpScale * uniforms.texScale / e;
  var grad = vec3f((hx - h0) * perMetre, 0.0, (hz - h0) * perMetre);
  // Only the part of the gradient lying in the surface tilts it. On the
  // near-level ground this material is for that is almost all of it, and the
  // projection is what keeps a sloped road or a pitched deck honest.
  grad -= n * dot(grad, n);
  return normalize(n - grad);
}

// THE RELIEF'S DEPTH, which is what the slope above cannot give. A bump only
// turns a normal: every stone is still painted on one flat sheet, so nothing on
// the street ever hides anything else and nothing ever casts a shadow, and a
// raking sun — the one light that should make a street look carved — draws it
// as a mosaic with shading on it. Two marches over the SAME height map put the
// third dimension back, and both are asked of the height as a displacement
// straight DOWN in world space, which is exact rather than approximate here:
// the albedo is projected down the world Y axis, so a height keyed on world Y
// is the one frame the texture is already in, on a slope as on a level street.
//
// The sheet is the TOP of the relief (height 1) and everything is carved down
// into it, so no stone ever stands proud of the mesh the depth buffer and the
// ink know about.
const RELIEF_STEPS: i32 = ${CONFIG.graphics.relief.parallaxSteps};
const RELIEF_SHADOW_STEPS: i32 = ${CONFIG.graphics.relief.shadowSteps};

fn reliefHeight(uv: vec2f, gx: vec2f, gy: vec2f) -> f32 {
  return textureSampleGrad(bumpTex, bumpTexSampler, uv, gx, gy).r;
}

// PARALLAX: where the eye ray actually meets the carved surface, as that uv and
// the height it meets it at. A linear march through RELIEF_STEPS layers and one
// linear refine between the last two, which is enough for relief a few
// centimetres deep — the sampling layers are finer than a sett's shoulder at
// every distance this is not already faded out by.
//
// **It fades out with distance and has to.** The shift is depth over the view
// ray's rise, so at a graze it grows without limit, and a march at a fixed
// step count stops resolving it: past the fade the relief is the slope and the
// self-shadow alone, which is also all the mip chain has left of it by then.
// The rise is clamped for the same reason, so a pixel on the horizon line
// cannot ask for a shift of a whole tile.
fn reliefParallax(uv0: vec2f, gx: vec2f, gy: vec2f, dist: f32) -> vec3f {
  let amount = 1.0 - smoothstep(uniforms.reliefFade.x, uniforms.reliefFade.y, dist);
  let top = reliefHeight(uv0, gx, gy);
  if (amount <= 0.0 || top >= 1.0) {
    return vec3f(uv0, top);
  }
  let v = normalize(uniforms.camPos - fragmentInputs.vPosW);
  // Tile units of travel across the relief's whole depth.
  let span = -v.xz / max(v.y, 0.2) * uniforms.bumpScale * uniforms.texScale * amount;
  // Fewer layers looking straight down, where the shift is short, and the
  // whole count at a graze, where it is long.
  let count = i32(ceil(mix(f32(RELIEF_STEPS), f32(RELIEF_STEPS) * 0.4, v.y)));
  let layer = 1.0 / f32(count);
  var prevDepth = 0.0;
  // Surface depth minus ray depth: positive while the ray is still above.
  var prevGap = 1.0 - top;
  for (var i = 1; i <= count; i++) {
    let depth = f32(i) * layer;
    let gap = (1.0 - reliefHeight(uv0 + span * depth, gx, gy)) - depth;
    if (gap <= 0.0) {
      // Bracketed between two layers: a few secant steps inside the bracket,
      // which is what stops the side of a stone reading as a stack of plates.
      var lo = prevDepth;
      var hi = depth;
      var gLo = prevGap;
      var gHi = gap;
      for (var j = 0; j < 3; j++) {
        let mid = mix(lo, hi, gLo / max(gLo - gHi, 1e-5));
        let gMid = (1.0 - reliefHeight(uv0 + span * mid, gx, gy)) - mid;
        if (gMid > 0.0) {
          lo = mid;
          gLo = gMid;
        } else {
          hi = mid;
          gHi = gMid;
        }
      }
      let d = mix(lo, hi, gLo / max(gLo - gHi, 1e-5));
      return vec3f(uv0 + span * d, 1.0 - d);
    }
    prevGap = gap;
    prevDepth = depth;
  }
  return vec3f(uv0 + span, 0.0);
}

// SELF-SHADOW: whether the relief between this point and the key light stands
// higher than the light's ray does. Marched only as far as the ray takes to
// climb out of the relief — past height 1 nothing can stand in its way — so a
// crown costs almost nothing and a groove is where the taps are spent.
//
// It is HARD, a narrow smoothstep on how far the relief stands over the ray,
// because the frame's shadow is hard: the stepped shadow map is lit or not, and
// a soft penumbra under every stone would be the one continuous-tone shadow on
// screen. What softens the edge is the geometry — a stone's shoulder is a slope,
// so where it rises past the ray is a line, not a stipple.
//
// The sun's rise is floored, so the reach across the tile is bounded for a
// light on the horizon: a street at 14.5 degrees of sun already throws a
// shadow four times the relief's own depth, which is the look this is for.
fn reliefLit(uv: vec2f, h: f32, gx: vec2f, gy: vec2f, dist: f32) -> f32 {
  let amount = (1.0 - smoothstep(uniforms.reliefFade.z, uniforms.reliefFade.w, dist))
    * uniforms.reliefShade.x;
  let l = -uniforms.lightDir;
  if (amount <= 0.0 || l.y <= 0.0 || h >= 1.0) {
    return 1.0;
  }
  let run = l.xz / max(l.y, 0.12) * uniforms.bumpScale * uniforms.texScale;
  let climb = (1.0 - h) / f32(RELIEF_SHADOW_STEPS);
  var occ = 0.0;
  for (var i = 1; i <= RELIEF_SHADOW_STEPS; i++) {
    let rise = f32(i) * climb;
    let over = reliefHeight(uv + run * rise, gx, gy) - (h + rise);
    occ = max(occ, smoothstep(0.0, 0.03, over));
  }
  return 1.0 - occ * amount;
}
#endif

#ifdef CEL_GLASS
#include<celProbe>
#include<celProbeBox>
#endif

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  var n = facetNormal();

  // How level this facet is, read off the TRUE geometry before any bump map
  // touches it — the rim gate below keys on it, and reading it from the
  // perturbed normal would let individual setts flick the gate on and off.
  let level = abs(n.y);

  // --- directional key light (4 bands), gated by the stepped shadow ---
  // The shadow's normal-offset uses the true facet normal — the bump relief
  // is fake, and offsetting along it would leak light at stone edges.
  var shadow = shadowVisibility(n, fragmentInputs.vPosW);
  // The key's cosine off the TRUE facet, before the relief touches it — what
  // the wrap below is keyed on, for the reason the rim gate reads level.
  let ndlGeo = dot(n, -uniforms.lightDir);

  #ifdef CEL_GROUND_TEX
  // The world-mapped uv and its footprint, taken here, once, before anything
  // displaces it — see perturbNormal for why every relief fetch reads these.
  let groundUV0 = fragmentInputs.vPosW.xz * uniforms.texScale;
  let groundGX = dpdx(groundUV0);
  let groundGY = dpdy(groundUV0);
  var groundUV = groundUV0;
  #endif

  #ifdef CEL_BUMP
  let reliefDist = distance(fragmentInputs.vPosW, uniforms.camPos);
  let carved = reliefParallax(groundUV0, groundGX, groundGY, reliefDist);
  groundUV = carved.xy;
  // The relief's own shadow joins the map's, so the key, the specular and the
  // translucency all lose the light behind a stone together.
  shadow *= reliefLit(groundUV, carved.z, groundGX, groundGY, reliefDist);
  // From here on the bumped normal drives every lighting term: key bands,
  // point lights, rim, and the specular streak all follow the setts.
  n = perturbNormal(n, groundUV, groundGX, groundGY);
  #endif

  // Baked ambient occlusion, and it multiplies the two AMBIENT terms only.
  //
  // Not the key light: the shadow map already owns what the moon can reach, and
  // multiplying both would black out the underside of everything. Not the point
  // lights either, for the same reason those already ignore the shadow map — a
  // lantern hung in a doorway has to light the doorway, which is exactly the
  // place this term is darkest. What is left is the flat ambient and the sky
  // fill, which is the correct answer anyway: occlusion is a statement about
  // how much of the SKY a surface can see.
  //
  // Defaults to 1 on anything with no baked buffer (rigs, viewmodel, effects),
  // so this line is a no-op for them rather than a special case.
  #ifdef CEL_BUMP
  // A groove sees less sky than a crown, which is the relief's share of the
  // same statement — and what keeps a crack dark in a tree's shadow, where the
  // key and everything it drew are gone.
  let ao = fragmentInputs.vBaked.w
    * (1.0 - uniforms.reliefShade.y * (1.0 - smoothstep(0.0, 0.7, carved.z)));
  #else
  let ao = fragmentInputs.vBaked.w;
  #endif

  var light = uniforms.ambientColor * ao;
  // THE WRAP (EnvironmentSpec.lighting.keyWrap), which is how a cel painter
  // lights a low sun: everything turned toward the light is LIT, and the angle
  // only decides how lit. A facet's cosine is lifted by wrap * (1 - cosine), so
  // a sun-square wall is untouched (it cannot clip any harder than it already
  // does against the shoulder) while a floor at a 14-degree sun climbs from the
  // 0.25 band to the 0.75 one — the ground in the light reads as IN the light,
  // instead of the sky fill being the brightest thing on it.
  //
  // **The lift is keyed on the GEOMETRIC facet and ADDED to the bumped cosine**,
  // so the relief keeps its whole amplitude instead of being squeezed by
  // (1 - wrap): a raking sun over cobbles is exactly where the relief is the
  // picture. And it fades IN over the first few degrees of the terminator, so a
  // facet grazing the light — where the shadow map is least sure of itself —
  // is not handed a full band of key to show its acne in. Zero is the old
  // Lambert exactly, which is what every map that says nothing gets.
  let lift = uniforms.keyWrap * smoothstep(0.0, 0.08, ndlGeo) * (1.0 - max(ndlGeo, 0.0));
  light += uniforms.lightColor
    * band(clamp(dot(n, -uniforms.lightDir) + lift, 0.0, 1.0), 4.0) * shadow;

  // Sky fill: the whole dome is a dim source, so anything looking up at it
  // picks up moonlight even where the key light is blocked. Deliberately NOT
  // gated by the shadow map — a roof in the moon's shadow still faces the sky.
  // This is what keeps roads, roofs and open ground reading as moonlit while
  // walls and undersides stay black.
  light += uniforms.skyLightColor * band(0.5 + 0.5 * n.y, 3.0) * ao;

  // --- point lights (3 bands, smooth inverse-square-ish falloff) ---
  for (var i = 0; i < MAX_POINT_LIGHTS; i++) {
    if (f32(i) < uniforms.pointCount) {
      let toLight = uniforms.pointPos[i] - fragmentInputs.vPosW;
      let dist = length(toLight);
      let range = max(uniforms.pointRange[i], 0.001);
      // Smooth window falloff: 1 at the source, 0 at the range limit.
      var atten = clamp(1.0 - dist / range, 0.0, 1.0);
      atten *= atten;
      let ndl = max(dot(n, toLight / max(dist, 0.001)), 0.0);
      // Lift the floor a little so lit surfaces read as glowing pools of
      // light rather than only the faces pointed at the flame.
      light += uniforms.pointColor[i] * atten * (0.25 + 0.75 * band(ndl, 3.0));
    }
  }

  // Base albedo: a flat palette colour, or a world-mapped ground texture. Both
  // are used raw (display-ready), matching the no-image-processing pipe.
  #ifdef CEL_GROUND_TEX
  var base = textureSampleGrad(
    baseColorTex, baseColorTexSampler, groundUV, groundGX, groundGY).rgb;
  // The same world-space drift the flat colours get below, and here it is
  // load-bearing rather than a nicety: this albedo REPEATS, every 4 m on the
  // valley floor and every 1.5 m on the street, and the eye finds a period in a
  // ground plane faster than in anything else in the frame. A drift keyed on
  // world position has no period to find, so the repeat stops being the most
  // legible thing about the ground the moment there is a slower change laid
  // over it. It is also why the tiles themselves are painted with no feature
  // larger than a quarter of their width — the big variation is THIS, and a
  // tile that carried its own would only be advertising where it ends.
  //
  // No vBaked.y branch, unlike the flat path. That mask exists because a flat
  // cel colour is worn by the rigs, the viewmodel and every effect mesh, and a
  // world-keyed term on a moving mesh shimmers as it walks. Nothing that moves
  // is ever ground: getGroundTextured is reached only from the terrain and from
  // the kit's paved surfaces, both of them baked map geometry.
  base *= 1.0 + uniforms.groundVariationAmount
    * (valueNoise(fragmentInputs.vPosW * uniforms.groundVariationScale) - 0.5);
  #else
  var base = uniforms.baseColor;
  #ifdef CEL_PALETTE
  // The albedo is the VERTEX's on anything a builder paletteised, and the
  // uniform's otherwise — index 0 is "not paletted" and is what an unwritten
  // attrib gives. Both paths are the same flat colour from here on: everything
  // below, the weathering drift included, applies to whichever one won.
  if (fragmentInputs.vPalette >= 0.5) {
    base = uniforms.celPalette[u32(fragmentInputs.vPalette + 0.5) - 1u];
  }
  #endif
  // Weathering: a slow value drift over world space, so a 48 m merged block
  // stops being one flat tone. Every wall, roof, plank and rock in the game is
  // drawn from a palette of a hundred-odd hexes, and the merge is per colour —
  // so all 26 cottages are literally the same PLASTER, and a whole block of
  // them arrives as a single mesh in a single value.
  //
  // Keyed on POSITION rather than on anything per-object, which is what makes
  // it free: no vertex data, no build cost, and it survives the merge by
  // construction because the merge preserves world positions. It is also the
  // more useful axis for a village — the artefact is a flat 48 m block, and
  // what breaks that up is variation across the block rather than between the
  // buildings in it.
  //
  // INTERPOLATED, and that is not a detail. GrassShader gets away with a
  // floor()-cell hash because a tuft is a quarter of a metre and lands inside
  // one cell. On a six-metre wall a stepped hash draws a hard vertical seam
  // through the middle of it with no geometry behind it, which is worse than
  // the flatness. Value noise costs seven more taps and has no edges.
  //
  // Gated by the world mask, because a term keyed on world position applied to
  // a MOVING mesh makes it shimmer as it walks: a bot's torso would drift in
  // tone across the map. vBaked.y is 1 on baked map geometry and 0 on the
  // rigs, the viewmodel and every effect mesh.
  //
  // A BRANCH, not a mix. Both of mix()'s arguments are evaluated, so the mask
  // written that way still ran valueNoise — eight variationHash calls, each a
  // sin/dot/fract — on every pixel of the viewmodel that fills the lower third
  // of the screen, on every pixel of sixteen bot rigs and every particle, and
  // then multiplied the result by zero. The branch is uniform across a whole
  // mesh (the mask is a vertex attribute that is 1 or 0 per model, never in
  // between), so it is exactly the shape a GPU predicts well.
  if (fragmentInputs.vBaked.y > 0.5) {
    base *= 1.0 + uniforms.variationAmount
      * (valueNoise(fragmentInputs.vPosW * uniforms.variationScale) - 0.5);
  }
  #endif

  // --- WEAR: the ground's dirt climbing the first metre of every wall ---
  //
  // THREE FACTORS, AND EACH IS HERE BECAUSE THE OTHER END COULD NOT ANSWER IT.
  // \`vBaked.z\` is the height LINE the bake wrote — 1 at the footing, 0 at
  // \`CONFIG.wear.height\`, and signed above that — because only the bake can
  // know how far above the TERRAIN a vertex is without sampling the heightfield
  // per pixel. It is 0 on every face with a ROOF over it as well, which is the
  // other thing only the bake can know: this end holds one normal and one world
  // position, and the inside and the outside of a wall are the same corners
  // with opposite normals, so the ramp alone grimes a parlour like a street
  // front (\`world/vertexShading.ts\`'s \`shelteredAt\`). \`n.y\` is how vertical
  // this face is, and only the fragment can know that cheaply, because it holds
  // the world normal already; baking it would have spent the colour buffer's
  // last free channel on something free at this end. And the CURVE is the
  // third, which used to be baked and is the reason this term barely read: see
  // below.
  //
  // WHY IT IS A MIX AND NOT A MULTIPLY. Grime is a substance ON the surface,
  // not the surface being darker, so a fully-grimed footing should reach the
  // same colour whatever it is made of — a whitewashed cottage and a slate
  // warehouse meet the same mud. A multiply keeps the wall's own hue and just
  // dims it, which is what AO already does two lines up, and stacking a second
  // darkening on the first is why this read as a shadow the first time it was
  // tried. It is applied to \`base\` rather than to \`col\` for the same reason:
  // dirt is ALBEDO, and it has to be lit by the map like the wall it is on, or
  // a wall in shadow has clean-looking dirt on it.
  //
  // OUTSIDE \`CEL_PALETTE\`, deliberately. The block-merged village draws through
  // \`getWorldCel\` and would be covered by sitting inside that define with the
  // albedo variation, but not every world mesh is block-merged, and a term that
  // grimed the buildings and left the scatter props and the terrain's banks
  // clean would draw a line exactly where the merge happens to fall — which is
  // a fact about draw-call batching and not about the world.
  //
  // THE BRANCH IS THE ONE ALREADY BEING TAKEN. \`vBaked.y\` is 1 on baked world
  // geometry and 0 on the rigs, the viewmodel and every effect mesh, so this is
  // uniform across a whole mesh and predicts perfectly — the argument written
  // out in full above the albedo variation. The \`wearParams.x > 0\` half is
  // uniform across the whole DRAW, so a clean map pays nothing per pixel.
  //
  // WHY THE CURVE IS SPENT HERE AND NOT IN THE BAKE. A box part has eight
  // corners and no vertical subdivision, so a wall carries exactly two samples
  // of this ramp — its footing and its eaves — and the rasteriser joins them
  // with a STRAIGHT LINE whatever was written at each. \`pow\` applied in the
  // walk therefore never reached a pixel as a curve: it reached it as 1 falling
  // linearly to 0 over the whole wall, which at head height on a 3 m wall is
  // still 0.47 of full grime. That is not a dirty footing, it is a building
  // rendered slightly darker, and it is what this term looked like for its
  // first version. Height above ground is itself linear up a vertical face, so
  // the LINE interpolates exactly; the curve is one \`pow\` here, on pixels the
  // branch below has already narrowed to world geometry.
  //
  // AND THE GRAIN IS WHY IT DOES NOT READ AS A CONTOUR. The same tide line at
  // the same height on every wall in the village is a rule you can see, which
  // is the failure this whole renderer's weathering rules are written against
  // — no lattice and no clock. Two octaves of the value noise the albedo
  // variation already uses displace the RAMP itself rather than tinting the
  // result, so one field does both jobs at once: the top edge comes out ragged,
  // and the footing is thinned wherever the grain runs low, which is right —
  // a wall is dirtiest exactly where the water ran down it. It is sampled in
  // WORLD space with Y squashed (\`wearGrain.y\`), so the cells stretch into
  // vertical runs and a wall, a fence post and a barrel all streak the same way
  // up with nothing needed to tell them apart. No uv, no sample, no second
  // material — the same test \`albedoVariation\` passes.
  if (uniforms.wearParams.x > 0.0 && fragmentInputs.vBaked.y > 0.5) {
    // Full at vertical, none at level, smooth between. \`abs\` because an
    // UNDERSIDE is as level as a floor and collects no splash either — a
    // soffit, a deck's belly, the underside of an arch.
    let upright = 1.0 - smoothstep(uniforms.wearParams.y, 1.0, abs(n.y));
    // The squashed sampling point, and the fine octave at 3.4x the coarse one
    // with its cells stretched twice as far again — a ratio rather than a
    // second pair of uniforms, because what these two are FOR is one blotch
    // field with runs in it and the interesting knob is the pair's scale.
    let gp = vec3f(
      fragmentInputs.vPosW.x,
      fragmentInputs.vPosW.y * uniforms.wearGrain.y,
      fragmentInputs.vPosW.z) * uniforms.wearGrain.x;
    let octaves = mix(
      valueNoise(gp),
      valueNoise(vec3f(gp.x, gp.y * 0.5, gp.z) * 3.4 + vec3f(19.3, 7.1, 41.7)),
      0.35);
    // STRETCHED ABOUT ITS MIDDLE, and without this the grain is not visible at
    // all. Trilinear value noise is eight hashes averaged, so it is centrally
    // peaked rather than uniform — a cell CENTRE has a standard deviation of
    // about 0.10 where a corner has 0.29 — and summing two octaves narrows it
    // again, to something like 0.15 overall. A displacement of \`edgeBreak\`
    // times that is a tide line that wanders a few centimetres, which is a
    // straight line with extra arithmetic. The stretch turns the field bimodal,
    // which is what dirt is: a wall is either stained here or it is not, and
    // the interesting part is the boundary between those.
    let grain = clamp((octaves - 0.5) * uniforms.wearGrain.z + 0.5, 0.0, 1.0);
    // Clamped AFTER the displacement and after the interpolation, which is the
    // one place it is free and the one place it is correct.
    let ramp = clamp(
      fragmentInputs.vBaked.z + (grain - 0.5) * uniforms.wearParams.w,
      0.0, 1.0);
    base = mix(
      base,
      uniforms.wearColor,
      pow(ramp, uniforms.wearParams.z) * upright * uniforms.wearParams.x,
    );
  }

  var col = base * light;

  // Soft shoulder: several lights overlapping (or a torch at point-blank
  // range) would otherwise clip to flat white and destroy the palette. This
  // compresses everything above 0.75 into the remaining headroom, so hot
  // spots stay tinted by the light that made them.
  let over = max(col - 0.75, vec3f(0.0));
  col = min(col, vec3f(0.75)) + 0.25 * over / (1.0 + over);

  // Hard-edged rim highlight (step, not smooth — keeps colors flat), and
  // deliberately NOT applied to near-level surfaces.
  //
  // A rim light is a silhouette effect, but on a plane the grazing angle is
  // nothing but the distance from the eye: for a floor, 1 - dot(viewDir, n) is
  // 1 - eyeHeight/dist, which crosses the 0.72 step at eyeHeight/0.28 — 5.5 m
  // standing, 3.75 m crouched. So an ungated rim paints every ground pixel
  // beyond that radius and none inside it: a hard-edged disc of un-rimmed floor
  // locked to the camera and sliding across the map with the player. With the
  // shoulder lamp inside it that reads as a bright pool, then a dark ring, then
  // brighter ground — measured on Hollowmere's floor colour, luminance 0.205 at
  // 5.0 m against 0.263 at 5.6 m, a 28% step across one hard circle. A floor has
  // no silhouette to catch, so it gets no rim.
  //
  //
  // **The tilt gate is HALF the rule, and the half that was found first.** The
  // sentence above is true of EVERY plane and not only of the floor: for a wall
  // at perpendicular distance p from the eye, dot(viewDir, n) is p/dist, the
  // 0.72 step is crossed at dist = 3.57p, and the locus of that on the wall is
  // a CIRCLE of radius 3.43p about the point nearest the eye. So the same
  // camera-locked disc the floor gate exists to kill was still being drawn on
  // every large flat wall in the game, and it slid with the player exactly as
  // the floor one did: standing 3 m off a wall put a 10 m circle on it, and
  // looking along a building's flank from a hull put the arc halfway down the
  // face. It reads as a shadow with nothing casting it.
  //
  // **There is no fragment-local signal that separates the two cases**, which
  // is why this is an exclusion rather than a better test. A limb's grazing
  // facet and a wall's far corner produce the same dot() and the same distance;
  // curvature would separate them and there is none to read, because the
  // shading is FACETED and a normal is constant across a facet by construction.
  //
  // So the second gate is vBaked.y, the world marker the variation noise
  // above already keys on: 1 on baked map geometry and 0 on the rigs, the
  // vehicles, the viewmodel and every effect mesh. A rim light separates a
  // SHAPE from its background, and a merged map block IS the background — the
  // world's edges are drawn by the outline ink, which is per-mesh, thinned with
  // distance and faded into the fog, and never needed this. What is left is the
  // case the effect was raised for on the bright maps: a BODY, a vehicle or the
  // weapon in your hands standing against haze very nearly its own colour.
  //
  // The tilt gate stays, and is not made redundant by it: it is what keeps the
  // near-level top faces of a rig or a hull deck out, and it is the thing that
  // has to hold if anyone ever gives the world its rim back.
  // The gate is on tilt, not on distance, because distance is the symptom. Zero
  // within 8 deg of level (every road, deck, terrace and the flat majority of
  // the heightfield), full past 26 deg — clear of the shallowest roof pitch in
  // the kit, ~24 deg (BuildingKit.gableRoof). Sculpted banks in between keep
  // most of theirs, and on a slope the boundary is broken up rather than being
  // a clean circle. Smooth, so a gentle rise doesn't draw an edge of its own.
  let viewDir = normalize(uniforms.camPos - fragmentInputs.vPosW);
  let rim = 1.0 - max(dot(viewDir, n), 0.0);
  col += base * uniforms.rimColor
    * step(0.72, rim)
    * (1.0 - smoothstep(0.90, 0.99, level))
    * (1.0 - step(0.5, fragmentInputs.vBaked.y));

  // --- the mirror rung: the ROOM, added to what the surface already is ---
  //
  // A highlight is not a reflection, and the gloss ladder's top rung had been
  // trying to be one by being brighter — the one direction that cannot work on
  // faceted geometry. A Blinn lobe is CONSTANT across a flat facet, so at
  // shininess 44 a weapon built out of a dozen plates catches the key light on
  // a whole plate or on none of it, and on the kit stage — where a finish is
  // actually chosen — it was none. What chrome drew was a flat field of albedo
  // with the grade's grain over it, which is what a player reads as paint, and
  // the gold plate came out tan.
  //
  // What makes chrome read as chrome is that neighbouring facets hand back
  // DIFFERENT parts of the room. So this term is the room, gathered down the
  // mirrored eye ray and built out of the only things this shader knows about
  // it: a horizon, the key light, and every point light in range.
  //
  // THREE DECISIONS, each of which was photographed the other way round first.
  //
  // **It is the LIGHT in a direction rather than the picture in it.** The
  // picture is available — the glazing below reflects the sky's own gradient,
  // and that is the honest answer for a pane — but a night sky is 0.03 and the
  // dead village under it is less, so a mirror built out of what is literally
  // there is a dark grey object on every map this game ships. What a surface
  // can be LIT to is the one full-range statement about the room the shader
  // holds; it is the map's own light rather than a constant, and it moves with
  // the weather and the hour for free.
  //
  // **It is ADDED and not mixed toward, which is where this parts company with
  // what a mirror physically does** — a real one has no diffuse under the
  // reflection. Written as a mix it makes chrome DARKER than the paint it is
  // supposed to outshine, and not marginally: the kit stage's own lamps light a
  // plate past anything the environment is worth, so replacing the shading with
  // the room put the gold plate under the standard finish. Reflective reads as
  // brighter than what is beside it. Added, the term is worth what the room is
  // worth — nothing in a dark cellar, and a weapon in a desert noon lit up like
  // the sand around it.
  //
  // **The horizon is HARD, and that is the whole of the facet-to-facet
  // contrast.** A gun is a box: its plates are level or vertical, so their
  // mirrored rays cluster within a few degrees of the horizontal, and any
  // gradient smooth enough to be a sky hands every one of them the same value —
  // photographed as a uniformly tan weapon three times over. A step at the
  // horizon puts those plates on opposite sides of it: what reflects a hair
  // above takes the sky, what reflects a hair below takes the ground, and
  // tilting the weapon sweeps that line across the metal. It is also what a
  // chrome object looks like, which is the horizon drawn across it.
  //
  // The lobes are what MOVE. A reflected light is one hard plate that lands,
  // jumps to the next facet as the weapon turns, and is gone — the one part of
  // this keyed to the player rather than to where they are standing. Written as
  // an exponent on the mirrored ray rather than as a Blinn half-vector so that
  // its width is a half-angle rather than a shininess, and WIDE for the reason
  // above: a reflection narrow enough to be honest is on no facet at all almost
  // always, which is the all-or-nothing this term replaces.
  //
  // Tinted by the surface's own albedo, because a metal colours what it hands
  // back: gold plate returns a gold room and quicksilver returns the room. That
  // is what keeps sixteen finishes distinguishable at the top rung instead of
  // collapsing them into one mirror wearing sixteen names.
  //
  // Schlick over the constant, for the reason every mirror has a bright edge:
  // face-on a plate returns specMirror of the room, at a graze all of it. NOT
  // banded — the same call the glazing's fresnel makes and for the same reason,
  // that a band edge here is a contour line across a flat plate drawn wherever
  // the view angle crosses a step, which slides over the surface as the weapon
  // moves and is exactly the artefact this term exists to replace.
  //
  // The whole block is behind a uniform branch, so every matte, satin and metal
  // material in the game skips it — its loop included — rather than multiplying
  // it out by zero, which is the shape the albedo weathering's mask above
  // already argues for. It is also the only surface in the game that answers a
  // POINT light with anything but diffuse: a chrome weapon that could not see
  // the lantern it was walking past was most of what made the top rung read as
  // paint, and a wall that could see one would be a change to the world's look
  // rather than to a weapon's.
  if (uniforms.specMirror > 0.0) {
    let mirrorDir = reflect(-viewDir, n);
    let roomHi = uniforms.ambientColor + uniforms.lightColor
      + uniforms.skyLightColor;
    var env = mix(uniforms.ambientColor, roomHi,
      smoothstep(-MIRROR_HORIZON, MIRROR_HORIZON, mirrorDir.y));
    env += uniforms.lightColor * band(
      pow(max(dot(mirrorDir, -uniforms.lightDir), 0.0), MIRROR_GLOSS), 2.0)
      * shadow;
    for (var i = 0; i < MAX_POINT_LIGHTS; i++) {
      if (f32(i) < uniforms.pointCount) {
        let toLight = uniforms.pointPos[i] - fragmentInputs.vPosW;
        let dist = length(toLight);
        var atten = clamp(
          1.0 - dist / max(uniforms.pointRange[i], 0.001), 0.0, 1.0);
        atten *= atten;
        env += uniforms.pointColor[i] * atten * band(pow(
          max(dot(mirrorDir, toLight / max(dist, 0.001)), 0.0),
          MIRROR_GLOSS), 2.0);
      }
    }
    let reflectance = uniforms.specMirror
      + (1.0 - uniforms.specMirror)
      * pow(1.0 - max(dot(viewDir, n), 0.0), 5.0);
    col += env * base * reflectance;
  }

  // Toon specular: Blinn half-vector against the key light, quantized into
  // two hard bands (bright core + faint halo) and gated by the same shadow
  // as the diffuse — a glint never appears where the moon doesn't reach.
  // Added after the soft shoulder on purpose: a highlight is allowed to
  // blow past the 0.75 ceiling, that's what makes it read as a shine.
  // Matte materials carry specColor 0 and this contributes nothing.
  let h = normalize(viewDir - uniforms.lightDir);
  let spec = pow(max(dot(n, h), 0.0), uniforms.specShininess);
  col += uniforms.specColor * band(spec, 2.0) * shadow;

  // Translucency: light that came through the surface instead of off it. Two
  // terms multiply. dot(viewDir, lightDir) is how close the eye is to
  // looking INTO the key light — viewDir runs surface-to-eye and lightDir is
  // the direction the light travels, so the two align exactly when the source
  // is on the far side of the surface from the viewer. dot(n, lightDir) is
  // the diffuse term's mirror: the facet must be turned AWAY from the light,
  // since nothing transmits through a face the light is already landing on.
  // Banded like everything else, gated by the same shadow as the diffuse and
  // the specular (light cannot come through a surface the moon doesn't
  // reach), and added past the soft shoulder for the same reason the specular
  // is — a lit awning is allowed to be the brightest thing in the frame.
  // Opaque materials carry transColor 0 and this contributes nothing.
  let through = max(dot(viewDir, uniforms.lightDir), 0.0)
    * max(dot(n, uniforms.lightDir), 0.0);
  col += uniforms.transColor * band(through, 2.0) * shadow;

  // Opaque unless this is glazing, and the whole of what makes a pane a pane.
  // What "opaque" WRITES is not 1 — see opaqueAlpha.
  var alpha = uniforms.opaqueAlpha;

#ifdef CEL_GLASS
  // A window is two layers over one another and nothing else in the world is:
  // what it REFLECTS, and the tint of what you see THROUGH it. Both are
  // composited here rather than picked between, because which one you get is
  // the angle you are standing at — face-on a shopfront is the room behind it,
  // and from down the street the same glass is a sheet of sky.
  //
  // What it reflects is built in two goes down the mirrored eye ray: the sky,
  // analytically, and then the city over the top of it out of a cube baked
  // from the map's own geometry. The sky half comes first because it is what
  // the cube does NOT hold — the bake draws no dome, so everything above the
  // roofline comes back with alpha 0 and this gradient is what is left there.
  let mirrored = reflect(-viewDir, n);
  var sky = mix(uniforms.fogColor, uniforms.skyZenithColor,
    smoothstep(0.0, 0.55, mirrored.y));
  // The sun in that sky, as a HALO rather than a disc, and it is a GLARE rather
  // than a stand-in for one.
  //
  // This used to be justified by there being no disc to reflect:
  // SkySpec.discRadius was 0 on the one map with glass on it, so a hard disc
  // here would have been a reflection of something the player could not look up
  // and see. Coldharbour has a disc now (1.35 degrees of it), and the halo
  // stays broad anyway — CONFIG.graphics.glass.halo is ~21 degrees, which is
  // not that disc and is not trying to be. A low sun on a curtain wall is a
  // wide smeared glare across the whole elevation, not a sharp second sun — and
  // the same breadth is what the moon wants on Hollowmere, which is why the
  // number is global.
  //
  // Gated by the same shadow map as everything else — glass in a tower's shade
  // does not glare.
  let halo =
    smoothstep(uniforms.glassParams.z, 1.0, dot(mirrored, -uniforms.lightDir));
  sky += uniforms.lightColor * halo * shadow;

  // And the world, which is the half that makes a curtain wall read as glass
  // rather than as a tinted slab: the tower opposite, the street under it and
  // the traffic on the street, all moving across the pane as the player walks
  // because the ray is parallax-corrected before it is sampled.
  //
  // The bake is ONE cube from ONE point on the map (see ReflectionSystem), so
  // what a pane returns is the right city seen from slightly the wrong place.
  // That is the trade the feature is: six face renders once per map install
  // against a per-frame probe per building, on a renderer whose whole budget
  // argument is that the world is static and drawn once. Sold by the fact that
  // a reflection is read as motion and colour rather than as a picture —
  // nobody counts the windows in a window.
  //
  // Un-premultiplied by hand. The bake clears to a transparent black and the
  // world draws over it opaque, so a texel on a silhouette filters to a
  // fraction of the colour AND a fraction of the alpha; mixing toward that
  // colour directly would draw a dark seam around every roofline in the
  // reflection. Same arithmetic, and the same reason, as the composite below.
  //
  // textureSample and not textureSampleLevel: a ReflectionProbe's cube carries
  // a mip chain (Babylon generates one unless asked not to), so an implicit LOD
  // is the filtering the GLSL textureCube already had.
  let city = textureSample(reflectionCube, reflectionCubeSampler,
    reflectBoxDir(mirrored, fragmentInputs.vPosW));
  sky = mix(sky, city.rgb / max(city.a, 0.001), city.a * uniforms.reflectProbe.w);

  // Schlick, and deliberately NOT banded. Every other term in this shader is
  // quantized and this one must not be: the band edge would be a contour line
  // across a FLAT sheet, drawn where the view angle crosses a step and nowhere
  // else — so it would slide over the glazing as the player walks, which is
  // exactly the artefact the rim light is gated off level surfaces to avoid.
  // The water's fresnel is smooth for the same reason and is the precedent.
  let fres = uniforms.glassParams.x + (1.0 - uniforms.glassParams.x)
    * pow(1.0 - max(dot(viewDir, n), 0.0), uniforms.glassParams.y);

#ifdef CEL_GLASS_BACKED
  // Glazing hung on a solid mass, and the whole saving is that the layer behind
  // it is KNOWN — it is that mass, a hand away, on a parallel face under the
  // same key light, so the light term this sheet already computed is the one
  // that shades it too. Knowing it turns the blend into arithmetic. What the
  // rasterizer would have produced over a backdrop B is
  //
  //   C*alpha + B*(1-alpha),  C = (sky*fres + col*tint*(1-fres))/alpha
  //                           alpha = fres + tint*(1-fres)
  //
  // and since 1-alpha is exactly (1-fres)(1-tint), that whole expression folds
  // to
  //
  //   mix(mix(B, col, tint), sky, fres)
  //
  // which is what is written below. It is EXACT and not an approximation of
  // the blend: the only thing assumed is B, and the builder is the one thing
  // that knows it. No divide, and no alpha handed to a blender — alpha stays 1
  // so this sheet writes DEPTH, which is the point, because the mass behind it
  // is then rejected before it is ever shaded. See getGlass's backed argument
  // in this file, and Build.pane for who may claim it and what it costs to
  // claim it wrongly.
  col = mix(
    mix(uniforms.glassBackdrop * light, col, uniforms.glassParams.w), sky, fres);
#else
  // Composite the two layers into one colour and one alpha. The reflection
  // covers the tint, the tint covers what is behind the pane, and dividing by
  // the total is what keeps the blend from darkening the result twice — the
  // rasterizer is about to multiply the colour by this alpha, so what goes out
  // has to be the layers' colour rather than their contribution.
  let tint = uniforms.glassParams.w;
  alpha = fres + tint * (1.0 - fres);
  col = (sky * fres + col * tint * (1.0 - fres)) / max(alpha, 0.001);
#endif
#endif

  // --- atmosphere ---
  let dist = length(fragmentInputs.vPosW - uniforms.camPos);

  // Low-lying ground mist: thickest at the floor, builds up with distance.
  // The ramp is deliberately long so lit ground near the player stays
  // readable and only the middle distance turns to soup.
  let mist = uniforms.mistParams.y
    * exp(-max(fragmentInputs.vPosW.y, 0.0) / max(uniforms.mistParams.x, 0.001))
    * clamp((dist - 6.0) / 45.0, 0.0, 1.0);
  col = mix(col, uniforms.mistColor, clamp(mist, 0.0, 0.9));

  // Theme-tinted distance fog — reaches full strength so far walls vanish.
  //
  // The two atmosphere terms are applied to the colour and NOT to the alpha,
  // and a half-transparent pane in full fog still comes out right: whatever is
  // behind it is at least as far away and has already been mixed to the same
  // fogColor, so blending fog over fog lands on fog whatever the weight is.
  let fog = clamp((dist - uniforms.fogParams.x)
    / (uniforms.fogParams.y - uniforms.fogParams.x), 0.0, 1.0);
  col = mix(col, uniforms.fogColor, fog * fog);

  // Last thing before the write, because the write is the quantiser.
  fragmentOutputs.color = vec4f(dither(col), alpha);
}
`;

/** One dynamic light as uploaded to the cel shader. */
export interface PointLightData {
  position: Vector3;
  color: Color3;
  /** Radius at which the contribution reaches zero. */
  range: number;
  intensity: number;
}

/** Toon specular settings for one glossy material (see CONFIG.graphics.spec). */
export interface SpecSpec {
  /** Highlight tint, e.g. "#aecbf2"; scaled by intensity on upload. */
  color: string;
  intensity: number;
  /** Blinn exponent — high is a pinpoint glint, low a broad wet sheen. */
  shininess: number;
  /**
   * How much of the ENVIRONMENT the surface hands back face-on, 0..1 — a
   * reflection rather than a highlight, and the one thing that separates a
   * mirror from a metal that is merely very shiny.
   *
   * Absent (and zero) on every surface in the game but the gloss ladder's top
   * rung: the shader's whole mirror block is behind a uniform branch on it,
   * so a material that says nothing here pays for none of it. A surface that
   * claims it also catches the POINT lights, which nothing else in the game
   * does — both halves of that rule are in the fragment shader.
   */
  mirror?: number;
}

/**
 * Translucency settings for one thin material (see
 * CONFIG.graphics.translucency). One colour and nothing else: the term's
 * shape — how sharply it fires as the eye comes round into the key light —
 * is the band count in the shader, which belongs to the look rather than to
 * the material, the same way the diffuse's four bands do.
 */
export interface TranslucencySpec {
  /**
   * The colour the light arrives as after passing through — canvas warms it,
   * needles green it. Scaled by intensity on upload; unlike the rim, it does
   * NOT pick up the surface's own albedo, so a dark night-time canvas can
   * still glow pale.
   */
  color: string;
  intensity: number;
}

/**
 * Glazing settings for one pane material (see CONFIG.graphics.glass).
 *
 * Four numbers describing one surface, and they are read together: `tint` and
 * `reflectance` are the two layers a pane is made of, and `falloff` is how
 * fast the second takes over from the first as the angle opens out.
 */
export interface GlassSpec {
  /**
   * How much of the sky a pane returns FACE-ON, 0..1. Real glass is 0.04-0.08
   * and this is allowed to sit a little above it: the reflection is the only
   * thing telling the player a window is glass rather than a hole, and at a
   * physical 0.04 an office frontage seen square-on has nothing on it at all.
   */
  reflectance: number;
  /**
   * The Fresnel exponent. 5 is Schlick's; lower brings the sheen on sooner as
   * the angle opens, which is what makes a street of glass read as glass while
   * you walk down the middle of it rather than only at the far end of it.
   */
  falloff: number;
  /**
   * Cosine half-width of the sun's halo in the reflection — 1 is a point and
   * 0.9 is a 25-degree wash. Broad on purpose: this stands in for a disc the
   * sky does not draw (see the shader), and a hard glint would advertise that.
   */
  halo: number;
  /**
   * How much of the pane's own colour a face-on view keeps, 0..1 — so this is
   * how DARK the glass is, and it is the number that decides what can be seen
   * through a shopfront.
   *
   * It has a fairness dimension and not only a look: a bot's line of sight
   * already passes through glass (`RayWorld.castRound` subtracts a pane), so a window
   * the player cannot see through is one the AI can shoot them through. Tint
   * it enough to read as glass and no further.
   */
  tint: number;
}

/**
 * One reflection probe, as a surface that samples it WITHOUT the parallax
 * correction needs it — which today is the water. See `celProbeBox` for why
 * that is a considered choice rather than an omission.
 *
 * `ReflectionSystem` hands the three over together because they are one fact:
 * a cube is only meaningful with the point it was baked from and the strength
 * it is worth. Splitting them into setters would let a surface sample one
 * probe's picture at another probe's strength.
 */
export interface CubeReflection {
  /** The baked cube. Alpha 1 where the bake drew world, 0 where it saw sky. */
  cube: BaseTexture;
  /** Where the bake was taken from. */
  at: Vector3;
  /** How much of it the surface returns, against the sky it would show. */
  strength: number;
}

/**
 * The same, plus the box the mirrored ray is re-aimed against — what the
 * glazing needs, and what makes a reflection stay put on the building it
 * belongs to as a player walks along a frontage.
 */
export interface ProbeReflection extends CubeReflection {
  boxMin: Vector3;
  boxMax: Vector3;
}

/**
 * Creates and caches one cel ShaderMaterial per color, and keeps the shared
 * environment uniforms (light, fog, mist, camera, dynamic lights) in sync on
 * all of them.
 */
export class CelMaterialFactory {
  /** Uniforms every cel material shares, whatever its albedo path. */
  private static readonly UNIFORMS = [
    "world",
    "viewProjection",
    "lightDir",
    "lightColor",
    "keyWrap",
    "ambientColor",
    "skyLightColor",
    "rimColor",
    "baseColor",
    "fogColor",
    "fogParams",
    "mistColor",
    "mistParams",
    "camPos",
    "opaqueAlpha",
    "pointPos",
    "pointColor",
    "pointRange",
    "pointCount",
    "lightMatrix",
    "shadowParams",
    "bodyLightMatrix",
    "bodyShadowParams",
    "variationScale",
    "variationAmount",
    "wearColor",
    "wearParams",
    "wearGrain",
    "specColor",
    "specShininess",
    "specMirror",
    "transColor",
    "windTime",
    "windDir",
    "windParams",
  ];
  /**
   * Every cel material's vertex attributes.
   *
   * `color` is on ALL of them, including the ones nothing ever bakes into. It
   * has to be: the attribute is declared unconditionally in the vertex shader
   * (there is no define to gate it, on purpose — see the shader), so leaving it
   * off a material's list would leave the effect without the location and the
   * varying would read whatever the driver left there. With it declared and no
   * buffer bound the attrib array is simply disabled, which is the defined
   * `(0, 0, 0, 1)` the whole design leans on.
   */
  private static readonly ATTRIBUTES = ["position", "normal", "color"];
  /**
   * The same, plus the palette index, for the two materials that read one.
   *
   * `uv2` is a SECOND list rather than a member of the one above, which is the
   * opposite of the call `color` got and for the opposite reason. `color` is
   * declared unconditionally in the shader, so every material owes it the
   * location; `uv2` is behind `#define CEL_PALETTE`, so a material without the
   * define has no such attribute to bind and naming it here would be declaring
   * a location the effect does not have.
   */
  private static readonly PALETTE_ATTRIBUTES = [
    "position",
    "normal",
    "color",
    "uv2",
  ];
  /** Every cel material samples both shadow maps, whatever its albedo path. */
  private static readonly SAMPLERS = ["shadowMap", "bodyShadowMap"];
  /**
   * How far toward the eye a pane is biased in the depth test, in polygon
   * offset UNITS — one unit being the depth buffer's own smallest resolvable
   * step at that fragment. **Without it, glazing past ~100 m is not drawn at
   * all**, which is the bug this exists for and it is a depth-precision one
   * rather than anything about the shading.
   *
   * A pane stands a few centimetres off the wall behind it (`kit/city.ts`'s
   * `glaze`: 0.04 m of glass over the shaft, the collars proud of that again),
   * and the depth buffer stops being able to tell the two apart with distance.
   * The camera's near plane is 5 cm — it has to be, the viewmodel's optics sit
   * inside 5 cm of the eye — and against a buffer resolving 2^-24 of the range
   * that leaves a step of 1 cm at 90 m, 3 cm at 160 m and 27 cm at the fog
   * wall, while the standoff stays what the builder gave it. Measured on
   * Coldharbour's curtain wall, square on, with the pane held at a constant
   * size on screen: full at 40 and 90 m, **gone entirely from 130 m out** — the
   * tower goes back to being blank concrete, with nothing wrong in the shader
   * and nothing wrong in the geometry. (That reading was taken on WebGL2's
   * 24-bit buffer; the cliff is at ~180 m on `depth32float` and the table
   * below is the current one.)
   *
   * A polygon offset is the fix rather than a workaround because it is stated
   * in exactly the units the problem is: it scales with the buffer's step at
   * the fragment's own depth, so it is millimetres up close, where the pane
   * needs nothing, and metres at the far end of the map, where the buffer's own
   * step is that coarse. Nothing else on offer moves: `maxZ` is worth nothing
   * (measured — the near plane is the whole of the precision), a bigger
   * standoff would have to be half a metre of glass proud of the wall by the
   * fog wall, and the near plane is spoken for.
   *
   * **THE BUFFER IS `depth32float` NOW AND THE UNIT IS DEFINED DIFFERENTLY FOR
   * A FLOAT FORMAT, so this is sixteen by re-measurement rather than by
   * carrying a number across.** `stencil: false` in `main.ts` is what picks the
   * format, and for a float one `r` is `2^(exponent(the primitive's own depth)
   * - 23)` rather than a constant — which happens to land on the same `2^-24`
   * everywhere a shipped map is drawn, because a depth in [0.5, 1) is every
   * fragment past a few metres. Re-run on the north tower's 542-sheet curtain
   * wall with the rest of the map hidden and the glass tinted so a surviving
   * sheet is countable (`plans/webgpu-ref/depth.mjs`), the pane's own share of
   * the frame goes:
   *
   *     units    40 m    90 m   130 m   180 m   220 m   260 m
   *        0    83.9    68.1    67.0     0.6     0.6     0.0   goes by 180 m
   *       -4    83.9    68.1    67.1    65.2    57.3     8.4   thins, then goes
   *       -8    83.9    68.2    67.1    65.3    64.9    63.9
   *      -12    83.9    68.2    67.2    72.2    72.5    71.9   far end complete
   *      -16    83.9    68.3    67.8    72.4    72.8    72.3   SHIPPED
   *      -24    83.9    68.6    75.0    72.6    73.2    72.4   transoms eaten
   *      -64    83.9    77.6    75.7    72.8    73.0    72.3
   *
   * **It is bracketed on both sides now, which it never was before.** -12 is
   * the floor — under it the far end thins and then goes, and the unbiased
   * cliff has moved out from ~130 m to ~180 m with the format. -24 is the
   * CEILING, and what it costs is legible rather than statistical: at 130 m the
   * horizontal transoms across the curtain wall stop being drawn, which is the
   * +7.4 points of "extra" glass in that row. Sixteen sits between the two with
   * room on each side, and what it costs at the far end is unchanged — the fins
   * and collars standing 0.1-0.2 m proud of the glass are overdrawn past
   * ~100 m, where they are a pixel or two of trim against a whole elevation of
   * glazing.
   *
   * Blended glazing is the same shape and far less of it: Coldharbour's biggest
   * unbacked group is eight sheets of shopfront, and the bias roughly triples
   * what survives past 90 m. It is 2% of the map's glazing and it is all at
   * street range, so the reading that decides this number is the backed one.
   *
   * Only the depth TEST is biased: a blended draw writes no depth (see
   * `getGlass`), so nothing downstream inherits the offset.
   */
  private static readonly GLASS_DEPTH_UNITS = -16;

  /**
   * The bias for an emissive plane hung in FRONT of a `backed` pane — a lit
   * room on a tower's curtain wall or in a brick block's punched window.
   *
   * **It has to be MORE than the glass's, never the same.** The glow stands
   * 4.5 cm off the sheet's face, and that is exactly the gap
   * `GLASS_DEPTH_UNITS` exists to beat: past ~100 m sixteen units is more
   * than 4.5 cm, so an unbiased glow LOST the depth test to the glass it was
   * drawn over and the two fought per pixel as the eye moved. Equal units only
   * hand the tie back to that same 4.5 cm. Measured head-on at a Coldharbour
   * curtain wall, glass tinted and rooms keyed: unbiased, every lit room is
   * gone by 120 m and none survive at 180-300 m; at -24 all of them are drawn
   * at every range, bloom included. Eight past the glass is the roads' doubled
   * margin. It lands on the -24 at which a biased SHEET started eating the
   * trim in front of it, and that cost does not carry over: the glow is inset
   * 0.45 m from every edge of its bay, so no fin or collar stands over it
   * head on.
   */
  private static readonly OVER_GLASS_DEPTH_UNITS =
    CelMaterialFactory.GLASS_DEPTH_UNITS - 8;

  private cache = new Map<string, ShaderMaterial>();
  private emissiveCache = new Map<string, StandardMaterial>();

  private lightDir = new Vector3(-0.5, -0.9, 0.4).normalize();
  private lightColor = new Color3(0.55, 0.62, 0.8);
  private keyWrap = 0;
  private ambientColor = new Color3(0.16, 0.18, 0.24);
  private skyLightColor = new Color3(0.08, 0.11, 0.18);
  /**
   * The top of the sky dome, as glazing reflects it — a picture of the sky
   * rather than the light it throws, which is what `skyLightColor` above is
   * and why the two are different values. Falls back to the map's flat
   * `skyColor` when it states no dome at all; see `applyEnvironment`.
   */
  private skyZenithColor = new Color3(0.1, 0.14, 0.22);
  private rimColor = new Color3(0.18, 0.2, 0.26);
  private mistColor = new Color3(0.1, 0.12, 0.15);
  // A map with no `wear` block is CLEAN, and the amount is what says so — the
  // colour is then never read. Defaulted here rather than left undefined so a
  // material created before the first `setEnvironment` binds a real vec3 rather
  // than whatever an unwritten uniform holds; uniforms read as zeros when
  // unwritten, which would be black dirt at amount 0 and invisible, but relying
  // on that is relying on the amount never being raised before an environment
  // lands.
  private wearColor = new Color3(0.1, 0.1, 0.1);
  private wearAmount = 0;
  private mistParams = new Vector2(2.2, 0.45);

  // Packed point-light uniforms, re-used every frame to avoid allocation.
  private pointPos = new Float32Array(MAX_POINT_LIGHTS * 3);
  private pointColor = new Float32Array(MAX_POINT_LIGHTS * 3);
  private pointRange = new Float32Array(MAX_POINT_LIGHTS);
  private pointCount = 0;

  /**
   * The eye every material in the cache is currently holding — both what
   * `updateCamera` compares against and what a material is BORN with. The two
   * have to be the same value, and that is the whole of why this field exists
   * rather than a bare "last position walked".
   *
   * `updateCamera` skips the walk when the camera has not moved, so a material
   * minted during a still frame is a material the walk will not visit again
   * until something moves — and a still frame is not the rare case: a paused
   * round, a kit screen, a player standing still and the editor's free-fly
   * camera resting on its panel are all exactly still, to the bit. Seeded from
   * anything else, such a material fogs and rims against wherever it was
   * seeded instead of against the eye; from the origin, and the editor's
   * floor-colour field repaints the whole terrain in a material that thinks
   * the viewer is standing in the middle of the map.
   *
   * The origin is the seed because the origin is what an unwritten `vec3`
   * uniform already is, so the invariant "every material in the cache holds
   * this value" is true before the first frame as well as after it. That is
   * also why there is no first-upload sentinel: a camera genuinely at the
   * origin needs no walk, because the cache is already there.
   */
  private readonly camPos = Vector3.Zero();
  /** See `setOpaqueAlpha`. The FRAME's value, which is what a material is born with. */
  private opaqueAlpha = 0;

  /**
   * The wind's clock, in seconds of WORLD time — see `updateWind` for why that
   * is not the same as seconds of wall clock. Shared by every material in the
   * cache, so a gust crossing the valley crosses every mesh in it at once.
   */
  private windTime = 0;

  // Shadow-map state, pushed onto every cel material as it is created.
  private shadowMap: BaseTexture | null = null;
  private shadowMatrix = Matrix.Identity();
  private shadowParams = new Vector4(0.0025, 0.15, 0.06, 0);
  // The bodies' map, the same three things over again — see
  // `SHADOW_UNIFORM_NAMES` for why none of it is shared with the pair above.
  private bodyShadowMap: BaseTexture | null = null;
  private bodyShadowMatrix = Matrix.Identity();
  private bodyShadowParams = new Vector4(0.0015, 0, 0, 0);

  /**
   * What each glazing material was built FROM, so a per-probe twin of it can be
   * built from the same thing.
   *
   * The reflection is the one piece of shared state that is not shared: every
   * other uniform in here is the same on every material in the cache, and a
   * cube is one probe's picture of one place. So a pane group's material is
   * keyed by (colour, slot) rather than by colour alone, and this is what lets
   * `glassProbe` mint slot 7 of a colour it was never told the name of.
   */
  private glassRecipes = new Map<
    ShaderMaterial,
    { hex: string; glass: GlassSpec; backed: string | null }
  >();
  /**
   * The cube a glazing material is BORN holding, before any probe has claimed
   * it — `ReflectionSystem`'s first probe, published once at construction.
   *
   * It is bound with a strength of 0, so what is in it never reaches a pixel.
   * The binding is not optional even so: a `samplerCube` with nothing on its
   * unit reads whatever 2D texture is there, which is undefined behaviour
   * rather than a black fetch. This is what makes "a glazing material always
   * has a cube" true from the moment `MapBuilder` asks for one, which is
   * before any probe has been placed.
   */
  private defaultCube: BaseTexture | null = null;

  /**
   * The current map's albedo palette, flattened, as the shader indexes it.
   *
   * Held here for the reason `camPos` and `windTime` are: `installMap` mints
   * materials mid-round, so a material created after `setPalette` has to be
   * born holding it rather than waiting for the next environment change that
   * may never come.
   */
  private palette = new Float32Array(MAX_PALETTE * 3);

  /**
   * The materials that hold a palette of their OWN, and the table each holds.
   *
   * A palette is a property of the MATERIAL rather than of the factory, and it
   * stopped being one number the moment a second thing wanted one: the map's
   * is DISCOVERED by `MapBuilder`'s merge and republished on every install,
   * while a rig's is a fixed handful of hexes that outlives any map. Holding
   * the override here rather than branching in `setPalette`'s loop is what
   * keeps that loop able to say "every material that reads one" and stay
   * true — see `applyPalette`, which is the only reader.
   */
  private readonly ownPalettes = new Map<ShaderMaterial, Float32Array>();

  constructor(private scene: Scene) {}

  /**
   * Publishes the palette `MapBuilder` assembled while it merged, and pushes it
   * onto every material that reads one.
   *
   * **Called once per map build, after the merge and before anything draws**,
   * because the palette is DISCOVERED by the merge rather than declared by the
   * layout — a builder's colours are not knowable until its meshes exist. That
   * ordering is safe for the same reason the bake's is: nothing renders between
   * `installMap` building the world and the round starting.
   *
   * Entries past `MAX_PALETTE` are the caller's problem and it has already
   * solved it — see `MapBuilder.paletteIndex`, which stops handing out indices
   * and lets the overflow colours keep their own materials.
   *
   * **This is the MAP's palette and it does not reach a material holding its
   * own** (`ownPalettes`): the rigs are built once per roster and outlive any
   * number of installs, so a kit whose albedo was republished here would be
   * repainted in the map's colours by the next map. The loop below still walks
   * every material, which is what keeps this method's one job stated once —
   * `applyPalette` is where the two tables are told apart.
   */
  setPalette(colors: readonly Color3[]): void {
    this.palette.fill(0);
    const n = Math.min(colors.length, MAX_PALETTE);
    for (let i = 0; i < n; i++) {
      this.palette[i * 3] = colors[i].r;
      this.palette[i * 3 + 1] = colors[i].g;
      this.palette[i * 3 + 2] = colors[i].b;
    }
    for (const mat of this.cache.values()) this.applyPalette(mat);
  }

  /**
   * Files a freshly built material in the cache, FROZEN — the one door into
   * `cache`, so that no creation path can file an unfrozen one by omission.
   *
   * **What freezing buys is not readiness, it is the WORK OF ASKING.**
   * `ShaderMaterial.isReady` runs for every submesh of every draw, in the main
   * pass and again in the shadow pass, and before it can answer it rebuilds the
   * whole define set from scratch: two arrays, a `#define` string per entry and
   * a `join` over them — all of it thrown away after being compared to the
   * string already on the draw wrapper. Measured on the shipped maps that walk
   * is **a fifth of everything this game allocates** (`FINDINGS.md` 36), and it
   * is pure churn: the answer is the same string every frame for the life of
   * the material.
   *
   * **`isFrozen` short-circuits exactly that and nothing else.** It is read in
   * one place that matters here — the top of `isReady`, which returns the
   * cached verdict when the wrapper already has a ready effect — while what
   * gates the UNIFORM push is `_mustRebind`, which does not consult it. So the
   * light array, the fog, the eye, the wind and the palette all keep flowing;
   * `updateWind` and `updateCamera` above walk this same cache every frame and
   * are unaffected.
   *
   * **It is safe because a define set here is a property of the MATERIAL and
   * not of the mesh wearing it.** The defines `isReady` would rebuild vary with
   * the mesh on exactly four counts — a vertex COLOUR buffer, instancing, bones
   * and morph targets — and this cache is keyed finely enough that no material
   * is ever shared across a disagreement about any of them: measured over every
   * `ShaderMaterial` in the scene on all four of the big maps, **0 of 35/113/
   * 95/83 were mixed**. Re-run that check before widening a cache key, because
   * the failure it guards against is silent — a mesh drawn with the effect
   * another mesh compiled.
   *
   * Freezing at CREATION rather than once the effect is ready is deliberate and
   * costs nothing: the fast path also requires the wrapper to have been ready
   * once, so a material frozen before its first compile simply falls through to
   * the full path until it has one.
   */
  private remember(key: string, mat: ShaderMaterial): void {
    mat.freeze();
    this.cache.set(key, mat);
  }

  /**
   * Pushes the palette onto one material.
   *
   * Unconditional, and that is deliberate rather than lazy: a `setArray3` for a
   * uniform the effect does not declare is dropped when the material binds —
   * the same no-op `skyZenithColor` already rides on — so this needs no test
   * for which variant it is looking at, and gaining one would be a second list
   * to keep in step with `getWorldCel`.
   *
   * **Which TABLE it pushes is the material's own question**, and it is asked
   * here rather than at the two call sites so that neither has to know the
   * other exists: `setPalette` walks the whole cache and a material holding
   * its own is simply re-handed what it already had.
   */
  private applyPalette(mat: ShaderMaterial): void {
    const table = this.ownPalettes.get(mat) ?? this.palette;
    mat.setArray3("celPalette", table as unknown as number[]);
  }

  /**
   * The ONE matte cel material the whole village wears, whatever colour it is
   * painted: the albedo comes from `celPalette` indexed per vertex instead of
   * from this material's `baseColor`, which is never set and never read.
   *
   * **This exists to take the colour out of the merge KEY.** `mergeByMaterial`
   * splits a group once per material instance, so a 48 m block of a city held
   * ten meshes because it held ten paint colours — and each of those was drawn
   * four times over, once for itself, once for its ink, once as a glow occluder
   * and once into the shadow map. Measured on Coldharbour: 416 world meshes and
   * 1,565 draws, against 90 and ~305 with the colour moved per vertex.
   * `FINDINGS.md` #18 has the whole measurement.
   *
   * It is a define and not a branch on the shared material because the palette
   * is a 2 KB uniform array and there are 217 materials in a Coldharbour round,
   * of which exactly two — this and its ink — ever index it.
   */
  getWorldCel(): ShaderMaterial {
    const key = `\0world-cel`;
    let mat = this.cache.get(key);
    if (!mat) {
      mat = new ShaderMaterial(
        WORLD_CEL_NAME,
        this.scene,
        { vertex: "cel", fragment: "cel" },
        {
          attributes: [...CelMaterialFactory.PALETTE_ATTRIBUTES],
          uniforms: [...CelMaterialFactory.UNIFORMS, "celPalette"],
          samplers: [...CelMaterialFactory.SAMPLERS],
          defines: ["#define CEL_PALETTE"],
          shaderLanguage: ShaderLanguage.WGSL,
        },
      );
      // `baseColor` is deliberately NOT set. Every vertex this material ever
      // draws carries an index, because `MapBuilder` only hands a mesh to this
      // material when it has one — so the uniform path is unreachable here and
      // seeding it would only invite somebody to rely on it.
      this.applyCamera(mat);
      this.applyWind(mat);
      this.applyEnvironment(mat);
      this.applyPointLights(mat);
      this.applyShadow(mat);
      this.applySpec(mat, null);
      this.applyTranslucency(mat, null);
      this.applyPalette(mat);
      this.remember(key, mat);
    }
    return mat;
  }

  /**
   * The ONE matte cel material every SOLDIER RIG wears — `getWorldCel`'s twin
   * for bodies, and separate from it for two reasons that are both
   * load-bearing.
   *
   * **The palette is its OWN** (`ownPalettes`, and see `setPalette`). The
   * world's is discovered by `MapBuilder`'s merge and republished per install;
   * a kit's is nine fixed hexes that outlive every map, so folding them into
   * the map's table would put the rigs' albedo at the mercy of a rebuild and
   * spend map slots on colours no map paints with.
   *
   * **And the two could never be ONE material anyway, whatever the tables
   * did.** The define set `ShaderMaterial.isReady` rebuilds varies with
   * whether the MESH carries a vertex COLOUR buffer, and this cache is keyed
   * so that no material is ever worn across a disagreement about one — see
   * `remember`, which is where that rule and its measurement are written down.
   * Every world mesh has a colour buffer (`vertexShading` bakes it after the
   * merge) and no rig has one at all, so a shared material would be exactly
   * the silent mis-draw that rule exists to prevent.
   *
   * What it buys is the rig's draw COUNT and its material SWITCHES together:
   * a segment used to split once per paint colour, so a torso was three
   * meshes and a head four. Measured on Coldharbour, per rig, **22 meshes and
   * 6 materials against 15 and 2** — the second half mattering as much as the
   * first, since `FINDINGS.md` 18 priced a draw that reuses a bound material
   * at ~2.3 us against ~6.3 for one that switches. `SoldierModel` has the
   * arithmetic.
   *
   * **The palette is bound at CREATION**, the first call minting it and every
   * later one getting that material back — which is safe because the only
   * caller hands it a module constant.
   */
  getBodyCel(colors: readonly Color3[]): ShaderMaterial {
    const key = `\0body-cel`;
    let mat = this.cache.get(key);
    if (!mat) {
      mat = new ShaderMaterial(
        BODY_CEL_NAME,
        this.scene,
        { vertex: "cel", fragment: "cel" },
        {
          attributes: [...CelMaterialFactory.PALETTE_ATTRIBUTES],
          uniforms: [...CelMaterialFactory.UNIFORMS, "celPalette"],
          samplers: [...CelMaterialFactory.SAMPLERS],
          defines: ["#define CEL_PALETTE"],
          shaderLanguage: ShaderLanguage.WGSL,
        },
      );
      // Its own table, filled before the first `applyPalette` below can read
      // it. Sized like the map's so the two are the same uniform to the
      // shader; a kit spends nine of the hundred and twenty-eight and the
      // rest stay black, which nothing indexes.
      const table = new Float32Array(MAX_PALETTE * 3);
      const n = Math.min(colors.length, MAX_PALETTE);
      for (let i = 0; i < n; i++) {
        table[i * 3] = colors[i].r;
        table[i * 3 + 1] = colors[i].g;
        table[i * 3 + 2] = colors[i].b;
      }
      this.ownPalettes.set(mat, table);
      // `baseColor` is deliberately NOT set, for `getWorldCel`'s reason: a
      // part whose colour is not in the kit palette keeps its own per-hex
      // material and never reaches this one, so the uniform path is
      // unreachable here too.
      this.applyCamera(mat);
      this.applyWind(mat);
      this.applyEnvironment(mat);
      this.applyPointLights(mat);
      this.applyShadow(mat);
      this.applySpec(mat, null);
      this.applyTranslucency(mat, null);
      this.applyPalette(mat);
      this.remember(key, mat);
    }
    return mat;
  }

  /**
   * Returns the shared cel material for a hex color, creating it on demand.
   *
   * `depthUnits` biases the depth TEST toward the eye in polygon-offset units,
   * one unit being the depth buffer's own smallest resolvable step at that
   * fragment — the same unit `GLASS_DEPTH_UNITS` is stated in, and against the
   * same class of problem. Its one caller is a ROAD (`ROAD_DEPTH_UNITS` in
   * `world/roads.ts`), a sheet lying a centimetre over the floor that loses
   * that centimetre to the buffer's own step long before the fog wall.
   * It is part of the cache KEY for `getGlossy`'s reason: the offset is
   * renderer state rather than a uniform, so one hex asked for at two biases
   * is two materials, and keying on the colour alone would hand whichever
   * asked first to both — a car's underbody lifted off the ground because a
   * road had already minted its colour.
   */
  get(hex: string, depthUnits = 0): ShaderMaterial {
    const cacheKey = depthUnits === 0 ? hex : `\0proud-${hex}-${depthUnits}`;
    let mat = this.cache.get(cacheKey);
    if (!mat) {
      mat = new ShaderMaterial(
        depthUnits === 0 ? `cel-${hex}` : `cel-proud-${hex}`,
        this.scene,
        { vertex: "cel", fragment: "cel" },
        {
          attributes: [...CelMaterialFactory.ATTRIBUTES],
          uniforms: [...CelMaterialFactory.UNIFORMS],
          samplers: [...CelMaterialFactory.SAMPLERS],
          // A ShaderMaterial defaults to GLSL and would look these up in a
          // store nothing writes any more; see the header.
          shaderLanguage: ShaderLanguage.WGSL,
        },
      );
      mat.setColor3("baseColor", Color3.FromHexString(hex));
      this.applyCamera(mat);
      this.applyWind(mat);
      this.applyEnvironment(mat);
      this.applyPointLights(mat);
      this.applyShadow(mat);
      this.applySpec(mat, null);
      this.applyTranslucency(mat, null);
      mat.zOffsetUnits = depthUnits;
      this.remember(cacheKey, mat);
    }
    return mat;
  }

  /**
   * The same flat cel colour as get(), but with the toon specular band
   * enabled — a hard key-light highlight for metal, glass, wet stone.
   * Cached under its own key so the matte variant of the same colour is
   * untouched, and named `cel-gloss-#rrggbb` to stay in the one naming scheme
   * the merge readers parse.
   *
   * **The SPEC is part of the cache key and the NAME is not**, and both
   * halves of that are load-bearing. The spec is a uniform rather than a
   * define, so one hex asked for at two gloss levels is two materials that
   * differ only in what was uploaded to them — keyed on the colour alone,
   * whichever level asked first would silently answer for both, which is a
   * weapon finish coming out matte because some other finish had already
   * minted its colour. The NAME still carries the palette colour and nothing
   * else, because a name is what `MapBuilder.plainCelHex` reads to decide
   * whether a mesh can join the palette merge — the one reader left now that
   * the hull ink's own `inkColorFor` has gone with it.
   */
  getGlossy(hex: string, spec: SpecSpec): ShaderMaterial {
    const cacheKey =
      `\0gloss-${hex}-${spec.color}-${spec.intensity}-${spec.shininess}` +
      `-${spec.mirror ?? 0}`;
    let mat = this.cache.get(cacheKey);
    if (!mat) {
      mat = new ShaderMaterial(
        `cel-gloss-${hex}`,
        this.scene,
        { vertex: "cel", fragment: "cel" },
        {
          attributes: [...CelMaterialFactory.ATTRIBUTES],
          uniforms: [...CelMaterialFactory.UNIFORMS],
          samplers: [...CelMaterialFactory.SAMPLERS],
          shaderLanguage: ShaderLanguage.WGSL,
        },
      );
      mat.setColor3("baseColor", Color3.FromHexString(hex));
      this.applyCamera(mat);
      this.applyWind(mat);
      this.applyEnvironment(mat);
      this.applyPointLights(mat);
      this.applyShadow(mat);
      this.applySpec(mat, spec);
      this.applyTranslucency(mat, null);
      this.remember(cacheKey, mat);
    }
    return mat;
  }


  /**
   * The same flat cel colour as get(), but with the translucency band enabled
   * — the key light coming through the surface rather than off it, for the
   * thin things it should read through: canvas awnings, foliage, anything a
   * silhouette is meant to glow at the edges of when the moon is behind it.
   *
   * Deliberately a third variant beside matte and glossy rather than a fourth
   * combination with it: a surface thin enough to transmit is not one with a
   * hard Blinn glint on it, and the cache is per colour, so an axis that
   * multiplies is an axis that costs.
   *
   * Cached under its own key and named `cel-trans-#rrggbb`, in the same naming
   * scheme as the other two and for the same reason `getGlossy` gives.
   */
  getTranslucent(hex: string, trans: TranslucencySpec): ShaderMaterial {
    const cacheKey = `\0trans-${hex}`;
    let mat = this.cache.get(cacheKey);
    if (!mat) {
      mat = new ShaderMaterial(
        `cel-trans-${hex}`,
        this.scene,
        { vertex: "cel", fragment: "cel" },
        {
          attributes: [...CelMaterialFactory.ATTRIBUTES],
          uniforms: [...CelMaterialFactory.UNIFORMS],
          samplers: [...CelMaterialFactory.SAMPLERS],
          shaderLanguage: ShaderLanguage.WGSL,
        },
      );
      mat.setColor3("baseColor", Color3.FromHexString(hex));
      this.applyCamera(mat);
      this.applyWind(mat);
      this.applyEnvironment(mat);
      this.applyPointLights(mat);
      this.applyShadow(mat);
      this.applySpec(mat, null);
      this.applyTranslucency(mat, trans);
      this.remember(cacheKey, mat);
    }
    return mat;
  }

  /**
   * `getTranslucent` for a sheet that BENDS — today the flags over the
   * control points (`systems/FlagCloth.ts`) and nothing else. The one
   * difference is `CEL_SMOOTH`: shaded off the interpolated normal rather
   * than the per-triangle facet, because cloth is a fine grid and a facet per
   * triangle of it reads as a lattice rather than a fold. The bands stay hard.
   *
   * A mesh wearing one carries no vertex colour buffer, and nothing else wears
   * one, so the frozen define set is never shared across a disagreement.
   * Cached under its own key and named `cel-cloth-#rrggbb`, outside the three
   * names the merge readers parse — cloth is never merged.
   */
  getCloth(hex: string, trans: TranslucencySpec): ShaderMaterial {
    const cacheKey = `\0cloth-${hex}`;
    let mat = this.cache.get(cacheKey);
    if (!mat) {
      mat = new ShaderMaterial(
        `cel-cloth-${hex}`,
        this.scene,
        { vertex: "cel", fragment: "cel" },
        {
          attributes: [...CelMaterialFactory.ATTRIBUTES],
          uniforms: [...CelMaterialFactory.UNIFORMS],
          samplers: [...CelMaterialFactory.SAMPLERS],
          defines: ["#define CEL_SMOOTH"],
          shaderLanguage: ShaderLanguage.WGSL,
        },
      );
      mat.setColor3("baseColor", Color3.FromHexString(hex));
      this.applyCamera(mat);
      this.applyWind(mat);
      this.applyEnvironment(mat);
      this.applyPointLights(mat);
      this.applyShadow(mat);
      this.applySpec(mat, null);
      this.applyTranslucency(mat, trans);
      this.remember(cacheKey, mat);
    }
    return mat;
  }

  /**
   * The glazing material: the same flat cel colour as get(), composited over
   * what is behind it and carrying a reflection of the sky.
   *
   * **It comes in two, and which one is a statement about what stands BEHIND
   * the sheet rather than about how it should look.** `backed` glazing has a
   * solid mass a hand behind it — a tower's curtain wall on its shaft, a
   * shophouse's drawn sash, a clerestory on brick — so nothing is ever seen
   * through it and it is drawn OPAQUE: one shading of that pixel instead of
   * two, and the mass behind it rejected on depth before it is shaded at all.
   * Everything else is blended, and it is blended because something back there
   * is meant to be legible: the twenty-four shopfronts with a room behind them
   * (`tint` exists so a lit interior reads from the pavement) and a car's
   * greenhouse, which `buildCar` models a dash and seat backs into for exactly
   * that reason. `Build.pane` is where the claim is made; see it for why a
   * `backed` sheet can never also be `breakable`.
   *
   * **The blended one is the only ALPHA-BLENDED material in the world layer**,
   * and it is the only thing that has any business being one. Everything else
   * here is a flat opaque cel colour, the water fakes its depth with a fresnel
   * between two opaque colours rather than showing the bed through itself, and
   * the only other transparent thing in the scene at all is the capture zone's
   * skirt, which is annotation rather than world. What blending costs is the
   * two things it always costs and they are paid for below in `MapBuilder`: a
   * pane writes no depth and so is sorted rather than z-buffered, and it must
   * be neither an outline nor a shadow caster. A `backed` pane wants the last
   * two anyway — the mass it hangs on already casts the shadow and carries the
   * ink — so both flags stay on both kinds and only the depth changes.
   *
   * **Both carry the depth BIAS**, and that is not about transparency at all:
   * a pane hangs centimetres off the wall behind it, which is a gap the depth
   * buffer loses with distance. See `GLASS_DEPTH_UNITS`. On a `backed` sheet it
   * earns a second job — biased toward the eye, the pane wins the depth test
   * against its own mass rather than z-fighting it at range.
   *
   * Cached under its own key and named `cel-glass-#rrggbb` (`-backed` for the
   * opaque twin), like the glossy and translucent variants — though unlike them
   * nothing recovers ink from it, because glass is not outlined. **The key
   * matters beyond the cache**: both of `MapBuilder`'s merges group by
   * MATERIAL, so two variants in one placement fall into two merged meshes
   * without either merge being told that glazing now comes in two kinds.
   */
  getGlass(
    hex: string,
    glass: GlassSpec,
    slot = 0,
    backed: string | null = null,
  ): ShaderMaterial {
    const kind = backed ? `glass-backed-${backed}` : "glass";
    const cacheKey = slot === 0 ? `\0${kind}-${hex}` : `\0${kind}-${hex}#${slot}`;
    const name =
      (backed ? `cel-glass-${hex}-on-${backed}` : `cel-glass-${hex}`) +
      (slot === 0 ? "" : `#${slot}`);
    let mat = this.cache.get(cacheKey);
    if (!mat) {
      mat = new ShaderMaterial(
        name,
        this.scene,
        { vertex: "cel", fragment: "cel" },
        {
          attributes: [...CelMaterialFactory.ATTRIBUTES],
          uniforms: [
            ...CelMaterialFactory.UNIFORMS,
            "glassParams",
            "skyZenithColor",
            ...PROBE_UNIFORM_NAMES,
            ...PROBE_BOX_UNIFORM_NAMES,
            ...(backed ? ["glassBackdrop"] : []),
          ],
          samplers: [...CelMaterialFactory.SAMPLERS, ...PROBE_SAMPLER_NAMES],
          defines: backed
            ? ["#define CEL_GLASS", "#define CEL_GLASS_BACKED"]
            : ["#define CEL_GLASS"],
          // What puts these subMeshes in the transparent pass at all. The
          // material's own `alpha` stays 1: the alpha that matters is written
          // per pixel by the shader, and a material-wide one would fade the
          // reflection along with everything else.
          //
          // A `backed` sheet writes 1 for every pixel and belongs in the
          // OPAQUE queue, which is where its saving comes from — see the
          // header, and `CEL_GLASS_BACKED` in the fragment shader for why its
          // colour needs nothing from the framebuffer to be right.
          needAlphaBlending: !backed,
          shaderLanguage: ShaderLanguage.WGSL,
        },
      );
      // Biased toward the eye by the depth buffer's own step, which is what
      // keeps a distant window a window — see GLASS_DEPTH_UNITS.
      mat.zOffsetUnits = CelMaterialFactory.GLASS_DEPTH_UNITS;
      mat.setColor3("baseColor", Color3.FromHexString(hex));
      if (backed) {
        mat.setColor3("glassBackdrop", Color3.FromHexString(backed));
      }
      this.applyCamera(mat);
      this.applyWind(mat);
      this.applyEnvironment(mat);
      this.applyPointLights(mat);
      this.applyShadow(mat);
      this.applySpec(mat, null);
      this.applyTranslucency(mat, null);
      this.applyGlass(mat, glass);
      this.applyReflection(mat);
      this.glassRecipes.set(mat, { hex, glass, backed });
      this.remember(cacheKey, mat);
    }
    return mat;
  }

  /**
   * A cel material whose albedo is a texture sampled in world space
   * (`vPosW.xz * texScale`) rather than from UVs — for flat ground surfaces
   * only (walls would streak). World mapping means every mesh sharing it
   * tiles seamlessly at a constant real-world scale no matter how it is
   * sized, rotated about Y, or merged, and primitives need no UV authoring.
   * Cached per key in the shared map so environment, point-light, and camera
   * updates reach it like any flat colour.
   *
   * @param key cache key, e.g. "cobble" — one material per texture/scale pair
   * @param tex tiling texture; mipmaps + anisotropy are the caller's job
   * @param texScale texture repeats per metre (1 / metres-per-tile)
   * @param opts.spec enables the toon specular band (wet sheen); omit for matte
   * @param opts.bump height map matching the albedo texel-for-texel — the
   *   shader perturbs the normal by its slope (CEL_BUMP). Must tile exactly
   *   like the albedo.
   * @param opts.bumpScale metres of fake relief at height value 1.0
   * @param opts.depthUnits polygon offset toward the eye, exactly as `get()`
   *   takes it and keyed the same way — the cobbled road's half of
   *   `ROAD_DEPTH_UNITS`
   */
  getGroundTextured(
    key: string,
    tex: BaseTexture,
    texScale: number,
    opts: {
      spec?: SpecSpec;
      bump?: BaseTexture;
      bumpScale?: number;
      depthUnits?: number;
    } = {},
  ): ShaderMaterial {
    const { spec, bump } = opts;
    const depthUnits = opts.depthUnits ?? 0;
    const cacheKey =
      `\0ground-${key}${spec ? "-spec" : ""}${bump ? "-bump" : ""}` +
      (depthUnits === 0 ? "" : `-proud${depthUnits}`);
    let mat = this.cache.get(cacheKey);
    if (!mat) {
      mat = new ShaderMaterial(
        `cel-ground-${key}`,
        this.scene,
        { vertex: "cel", fragment: "cel" },
        {
          attributes: [...CelMaterialFactory.ATTRIBUTES],
          uniforms: [
            ...CelMaterialFactory.UNIFORMS,
            "texScale",
            "groundVariationScale",
            "groundVariationAmount",
            ...(bump ? ["bumpScale", "reliefFade", "reliefShade"] : []),
          ],
          samplers: [
            "baseColorTex",
            ...(bump ? ["bumpTex"] : []),
            ...CelMaterialFactory.SAMPLERS,
          ],
          defines: [
            "#define CEL_GROUND_TEX",
            ...(bump ? ["#define CEL_BUMP"] : []),
          ],
          shaderLanguage: ShaderLanguage.WGSL,
        },
      );
      mat.setTexture("baseColorTex", tex);
      mat.setFloat("texScale", texScale);
      // Set once here rather than in `applyEnvironment` beside the flat
      // colours' pair: these two come from CONFIG and not from the map, so
      // nothing an environment change carries could move them.
      const groundVar = CONFIG.graphics.groundVariation;
      mat.setFloat(
        "groundVariationScale",
        1 / Math.max(0.001, groundVar.metersPerCell),
      );
      mat.setFloat("groundVariationAmount", groundVar.amount);
      if (bump) {
        mat.setTexture("bumpTex", bump);
        mat.setFloat("bumpScale", opts.bumpScale ?? 0.1);
        // CONFIG's and never the map's, for groundVariation's reason above.
        const relief = CONFIG.graphics.relief;
        mat.setVector4(
          "reliefFade",
          new Vector4(
            relief.parallaxFade[0],
            relief.parallaxFade[1],
            relief.shadowFade[0],
            relief.shadowFade[1],
          ),
        );
        mat.setVector2(
          "reliefShade",
          new Vector2(relief.shadowStrength, relief.cavity),
        );
      }
      this.applyCamera(mat);
      this.applyWind(mat);
      this.applyEnvironment(mat);
      this.applyPointLights(mat);
      this.applyShadow(mat);
      // The CALLER decides whether this ground is glossy at all; the installed
      // MAP decides how glossy — see `setGroundSpec`. That split matters here
      // because materials are built during `installMap`, which runs after
      // `applyEnvironment`: taking the caller's values would hand a freshly
      // built material the shipped night sheen and never revisit it, since the
      // override has already been applied to a cache this material was not yet
      // in.
      this.applySpec(mat, spec ? this.groundSpec : null);
      this.applyTranslucency(mat, null);
      mat.zOffsetUnits = depthUnits;
      this.remember(cacheKey, mat);
    }
    return mat;
  }

  /**
   * Shared unlit emissive material (used for neon/glow/effect meshes).
   * `overGlass` biases it past a `backed` pane it is hung in front of — see
   * `OVER_GLASS_DEPTH_UNITS` — and is part of the key; `GlowPass`'s mask
   * copies the bias so the two draws still tie.
   */
  getEmissive(hex: string, overGlass = false): StandardMaterial {
    const depthUnits = overGlass ? CelMaterialFactory.OVER_GLASS_DEPTH_UNITS : 0;
    const key = overGlass ? `${hex}-over-glass` : hex;
    let mat = this.emissiveCache.get(key);
    if (!mat) {
      mat = new StandardMaterial(`emissive-${key}`, this.scene);
      mat.zOffsetUnits = depthUnits;
      mat.emissiveColor = Color3.FromHexString(hex);
      mat.diffuseColor = Color3.Black();
      mat.specularColor = Color3.Black();
      mat.disableLighting = true;
      // Unlit means unfogged, which at village scale means a lit window burning
      // through the fog wall at full saturation. The plugin has to go on before
      // anything draws with the material — hence here, not in setEnvironment.
      attachEmissiveFog(mat);
      this.emissiveCache.set(key, mat);
    }
    return mat;
  }

  /**
   * The one material every open fire wears (`FlameShader`), created on first
   * ask. Held OUTSIDE `cache` because it is not a cel material and declares
   * none of the uniforms that cache's walks write; what it does share with it
   * — the world clock, the fog and the frame's opaque alpha — is pushed to it
   * by the same three methods, beside their walks, so a fire can never keep
   * different time or weather from the wall behind it.
   */
  getFlame(): FlameMaterial {
    if (!this.flame) {
      this.flame = new FlameMaterial(this.scene);
      this.flame.setClock(this.windTime);
      this.flame.setFog(fogState.color, fogState.start, fogState.end);
      this.flame.setOpaqueAlpha(this.opaqueAlpha);
    }
    return this.flame;
  }

  private flame: FlameMaterial | null = null;

  /** Applies a theme's lighting/atmosphere to every cel material. */
  setEnvironment(env: {
    lightDir: Vector3;
    lightColor: Color3;
    keyWrap: number;
    ambientColor: Color3;
    skyLightColor: Color3;
    skyZenithColor: Color3;
    rimColor: Color3;
    fogColor: Color3;
    fogStart: number;
    fogEnd: number;
    mistColor: Color3;
    mistHeight: number;
    mistStrength: number;
    wearColor: Color3;
    wearAmount: number;
  }): void {
    this.lightDir = env.lightDir.normalizeToNew();
    this.lightColor = env.lightColor;
    this.keyWrap = env.keyWrap;
    this.ambientColor = env.ambientColor;
    this.skyLightColor = env.skyLightColor;
    this.skyZenithColor = env.skyZenithColor;
    this.rimColor = env.rimColor;
    fogState.color.copyFrom(env.fogColor);
    fogState.start = env.fogStart;
    fogState.end = env.fogEnd;
    // The outline pass takes the same fog baked into its shader; doing it here
    // is what keeps it from ever describing different weather to the cel
    // materials this call is about to write. It owns its own invalidation —
    // notably it must NOT be given `outlineEntries`, which leaves out every
    // viewmodel mesh.
    // And the third pass that never runs the cel shader: the unlit emissive
    // materials behind every window, flame and tracer.
    setEmissiveFog(fogState.color, fogState.start, fogState.end);
    this.flame?.setFog(fogState.color, fogState.start, fogState.end);
    this.mistColor = env.mistColor;
    this.mistParams.set(env.mistHeight, env.mistStrength);
    this.wearColor = env.wearColor;
    this.wearAmount = env.wearAmount;
    this.cache.forEach((mat) => this.applyEnvironment(mat));
  }

  /**
   * Uploads the active dynamic lights (already reduced to the nearest
   * `MAX_POINT_LIGHTS` by the LightingSystem). Called once per frame.
   *
   * **The walk is the expensive half, so it is skipped when the packed arrays
   * come out unchanged.** Every entry here is four setters on every material in
   * the cache, and a `ShaderMaterial` setter is a linear scan of the 24-name
   * uniform list before it stores anything.
   *
   * **Measured, and it fires far less often than it reads.** Any fixture with
   * `flicker > 0` has `flame()` rewriting its intensity every frame, so as long
   * as one lit lamp is among the winning slots — which in a village is most
   * places a player stands — the arrays genuinely differ and the walk runs in
   * full. On Hollowmere at a standstill it saved nothing at all. What it does
   * cover is the rest: an unlit stretch of map, a map with no flickering
   * fixtures, a menu, a pause. The comparison is ~112 numbers against 172
   * setter calls, so losing the bet is far cheaper than not taking it.
   *
   * **The comparison is against `Math.fround` of each input and must stay that
   * way** — see the loop. Reading a `Float32Array` back and testing it against
   * the float64 that was stored into it is a mismatch for nearly every real
   * value, and the guard was silently losing every frame, quiet cases
   * included, until it narrowed both sides.
   *
   * What this does NOT save is the GL upload. `setArray3` bypasses Babylon's
   * own value cache and re-pushes on every material bind regardless, which is
   * a thing only a uniform buffer can fix.
   */
  setPointLights(lights: PointLightData[]): void {
    const count = Math.min(lights.length, MAX_POINT_LIGHTS);
    let changed = count !== this.pointCount;
    for (let i = 0; i < count; i++) {
      const l = lights[i];
      const b = i * 3;
      // **Narrowed BEFORE the comparison, not just on the way in.** The packed
      // arrays are `Float32Array`s, so what a store keeps is `Math.fround` of
      // what it was given, and comparing that back against the float64 the
      // light still holds is a mismatch for every value not exactly
      // representable in 32 bits — which is nearly all of them: a colour
      // channel is byte/255 times an intensity, a fixture's position has been
      // through a `rotateY`. Without the fround the guard reported "changed"
      // on essentially every frame and never skipped the walk it exists for.
      const x = Math.fround(l.position.x);
      const y = Math.fround(l.position.y);
      const z = Math.fround(l.position.z);
      const r = Math.fround(l.color.r * l.intensity);
      const g = Math.fround(l.color.g * l.intensity);
      const bl = Math.fround(l.color.b * l.intensity);
      const range = Math.fround(l.range);
      if (
        this.pointPos[b] === x &&
        this.pointPos[b + 1] === y &&
        this.pointPos[b + 2] === z &&
        this.pointColor[b] === r &&
        this.pointColor[b + 1] === g &&
        this.pointColor[b + 2] === bl &&
        this.pointRange[i] === range
      ) {
        continue;
      }
      changed = true;
      this.pointPos[b] = x;
      this.pointPos[b + 1] = y;
      this.pointPos[b + 2] = z;
      this.pointColor[b] = r;
      this.pointColor[b + 1] = g;
      this.pointColor[b + 2] = bl;
      this.pointRange[i] = range;
    }
    this.pointCount = count;
    if (!changed) return;
    this.cache.forEach((mat) => this.applyPointLights(mat));
  }

  /**
   * Call once per frame so shader fog/rim track the active camera.
   *
   * Guarded on the position for the same reason `setPointLights` is, and unlike
   * that one it wins cleanly: nothing perturbs a still camera, so a menu, a
   * pause, the deploy screen and a player standing still all stop re-uploading
   * `camPos` to 43 materials — measured at 258 setter calls a frame before the
   * guards and 175 after, on a static Hollowmere view.
   *
   * **What pays for the guard is `applyCamera` running on every material as it
   * is created**, exactly as the environment, the lights and the shadow state
   * already do. Skipping a walk is only sound while the cache cannot hold a
   * material the walk has never visited.
   */
  /**
   * Advances the wind and pushes the new clock onto every cel material.
   *
   * **Called from the same place in the frame the grass field's clock is**, and
   * that is the whole of why it is a method rather than a uniform pushed from
   * `tick` beside `updateCamera`. The shader's EYE is owed by the states that
   * simulate nothing — a menu, a building card, a kit turntable all fog against
   * it — but a CLOCK is not: a pause holds the world, the grass stops, and a
   * canopy still leaning over a frozen field would be the one thing in the
   * valley the pause did not reach.
   *
   * Unguarded, unlike `updateCamera`: `dt` is never zero on a frame that gets
   * here, so a comparison would only ever cost.
   */
  updateWind(dt: number): void {
    this.windTime += dt;
    this.cache.forEach((mat) => mat.setFloat("windTime", this.windTime));
    this.flame?.setClock(this.windTime);
  }

  updateCamera(camPos: Vector3): void {
    if (!camPos.equals(this.camPos)) {
      this.camPos.copyFrom(camPos);
      this.cache.forEach((mat) => this.applyCamera(mat));
    }
  }

  /**
   * What an OPAQUE cel fragment writes into the alpha channel: 0 for the frame,
   * 1 for a reflection bake. The argument is on `opaqueAlpha` in the fragment
   * source; this is only the walk.
   *
   * Guarded like `updateCamera` and for the same reason, and it wins by more:
   * this moves on the frames a probe bakes and on no others, so a round that is
   * not installing a map never walks the cache for it at all. It is seeded on
   * create through `applyCamera`, which every one of the six creation paths
   * already calls — the same thing that pays for the guard there pays for it
   * here, since skipping a walk is only sound while the cache cannot hold a
   * material the walk has never visited.
   */
  setOpaqueAlpha(alpha: number): void {
    if (alpha === this.opaqueAlpha) return;
    this.opaqueAlpha = alpha;
    this.cache.forEach((mat) => mat.setFloat("opaqueAlpha", alpha));
    this.flame?.setOpaqueAlpha(alpha);
  }

  /**
   * Copies the eye the cache is currently holding into `out`.
   *
   * For the one caller that has to BORROW it: `ReflectionSystem` renders the
   * world from the probe rather than from the player, so every cel material in
   * that bake has to fog and rim against the probe — and the six faces have to
   * put back exactly what they found, because the main pass of the same frame
   * follows them.
   */
  readEye(out: Vector3): Vector3 {
    return out.copyFrom(this.camPos);
  }

  /**
   * Materials that sample the depth map but are not cel materials — the grass
   * and the water, each of which reproduces the cel lighting model in its own
   * shader (see `celShadow`).
   *
   * They cannot live in `this.cache`: that map is keyed by colour and its
   * entries are shared, permanent and created on demand, while these are one
   * per map build and disposed with the map. So they are a second list that
   * only the three shadow setters walk — the same shape as `specs`, which
   * holds foreign material references for the same reason.
   *
   * **Registering is the consumer's half of the contract and unregistering is
   * the other half.** Grass and water are rebuilt every round; a material left
   * here after its `dispose()` takes a `setMatrix` per frame for the rest of
   * the session.
   */
  private readonly shadowConsumers = new Set<ShaderMaterial>();

  /** Adds a non-cel material to the three shadow uploads, and seeds it now. */
  registerShadowConsumer(mat: ShaderMaterial): void {
    this.shadowConsumers.add(mat);
    this.applyShadow(mat);
  }

  /** Drops a consumer. Call from the owner's `dispose`, without exception. */
  unregisterShadowConsumer(mat: ShaderMaterial): void {
    this.shadowConsumers.delete(mat);
  }

  /** Every material that samples the depth map, cel or not. */
  private eachShadowReader(fn: (mat: ShaderMaterial) => void): void {
    this.cache.forEach(fn);
    this.shadowConsumers.forEach(fn);
  }

  /**
   * Binds the ShadowSystem's depth map to every cel material. Called once at
   * startup — the texture object is stable even though its contents re-render.
   */
  setShadowMap(map: BaseTexture): void {
    this.shadowMap = map;
    this.eachShadowReader((mat) => mat.setTexture("shadowMap", map));
  }

  /**
   * The cube every glazing material is bound to until a probe claims it.
   * Called once, by `ReflectionSystem`'s constructor, before `MapBuilder` has
   * asked for a pane material at all. See `defaultCube`.
   */
  setDefaultReflection(cube: BaseTexture): void {
    this.defaultCube = cube;
    for (const mat of this.glassRecipes.keys()) this.applyReflection(mat);
  }

  /**
   * The glazing material for ONE reflection probe: the same colour and the
   * same four glass numbers as `base`, carrying that probe's cube, the box its
   * ray is corrected against, and where it was baked from.
   *
   * This is the one place the per-colour cache is deliberately widened, and
   * the reason is that a cube is not shared state: it is one probe's picture
   * of one place, and two buildings that reflect the same thing are two
   * buildings in the same street. `slot` is the probe's index and the second
   * half of the cache key, so a map installed twice reuses the same materials
   * rather than growing the cache by a mapful every round.
   *
   * Costs no draw call: the glazing is already one merged mesh per map block
   * (`MapBuilder.paneGroup`), so this hands each of those meshes a material of
   * its own rather than splitting anything. What it does cost is a seat in the
   * cache for every one of them — the per-frame walks are guarded, so that is
   * paid on the frames that move the camera or the lights.
   */
  glassProbe(
    base: ShaderMaterial,
    slot: number,
    refl: ProbeReflection,
  ): ShaderMaterial {
    const recipe = this.glassRecipes.get(base);
    if (!recipe) {
      // Not a glazing material, which is a caller error rather than a state
      // this can be in. Handing the base back leaves the pane drawn and
      // reflecting nothing, which is the old behaviour and not a crash.
      if (import.meta.env.DEV) {
        console.warn(`[cel] glassProbe on a non-glass material: ${base.name}`);
      }
      return base;
    }
    // `backed` travels with the recipe rather than being re-derived: it is the
    // difference between the opaque twin and the blended one, and a probe twin
    // that dropped it would put a tower's curtain wall back in the transparent
    // pass the moment `ReflectionSystem` claimed a slot for it.
    const mat = this.getGlass(recipe.hex, recipe.glass, slot, recipe.backed);
    mat.setTexture("reflectionCube", refl.cube);
    // **Cloned, and that is not defensive tidiness.** `ShaderMaterial` keeps
    // the Vector3 it is handed BY REFERENCE and reads it again on every bind —
    // which is exactly what `applyCamera` leans on to push one eye onto the
    // whole cache with a single copy. Here it inverts: the caller hands over
    // one scratch pair reused down a loop over 37 probes, so storing the
    // reference would leave every glazing material in the map sharing the last
    // probe's box.
    mat.setVector3("reflectBoxMin", refl.boxMin.clone());
    mat.setVector3("reflectBoxMax", refl.boxMax.clone());
    mat.setVector4(
      "reflectProbe",
      new Vector4(refl.at.x, refl.at.y, refl.at.z, refl.strength),
    );
    return mat;
  }

  /** The light's view*projection; re-uploaded when the shadow camera moves. */
  setShadowMatrix(matrix: Matrix): void {
    this.shadowMatrix = matrix;
    this.eachShadowReader((mat) => mat.setMatrix("lightMatrix", matrix));
  }

  /**
   * The BODIES' map, bound once at startup for the same reason the world's is:
   * the texture object is stable while its contents re-render.
   *
   * Unlike the world's it re-renders EVERY frame, and nothing here has to know
   * that — a texture is a texture. What does change is that this one can never
   * be skipped: it is in `SHADOW_SAMPLER_NAMES`, so a material that lists it and
   * never receives it loses every draw.
   */
  setBodyShadowMap(map: BaseTexture): void {
    this.bodyShadowMap = map;
    this.eachShadowReader((mat) => mat.setTexture("bodyShadowMap", map));
  }

  /** The bodies' light view*projection; re-uploaded when THAT window moves. */
  setBodyShadowMatrix(matrix: Matrix): void {
    this.bodyShadowMatrix = matrix;
    this.eachShadowReader((mat) => mat.setMatrix("bodyLightMatrix", matrix));
  }

  /**
   * The bodies' depth bias and tap radius. Two values rather than four: the
   * darkness and the facet offset are the RECEIVER's and are already in
   * `shadowParams`, so restating them here would be two places to set one look.
   *
   * The radius arrives already divided by that map's size — the caller is the
   * only thing that knows which size it was — which is the opposite of
   * `setShadowParams` below, and deliberately: that one is handed a `mapSize`
   * because it is also the place the world map's number is known at all.
   */
  setBodyShadowParams(bias: number, radiusUV: number): void {
    this.bodyShadowParams.set(bias, radiusUV, 0, 0);
    this.eachShadowReader((mat) =>
      mat.setVector4("bodyShadowParams", this.bodyShadowParams),
    );
  }

  /**
   * Depth bias, in-shadow darkness, facet-normal offset, and the depth map's
   * size — which is here because the kernel's tap offsets are in UV, and one
   * texel of UV is `1 / mapSize`. Passing the size rather than the offset keeps
   * the radius a graphics tunable instead of a number two files agree on.
   */
  setShadowParams(
    bias: number,
    darkness: number,
    normalBias: number,
    mapSize: number,
  ): void {
    const radius = CONFIG.graphics.shadows.pcfRadiusTexels / Math.max(1, mapSize);
    this.shadowParams.set(bias, darkness, normalBias, radius);
    this.eachShadowReader((mat) =>
      mat.setVector4("shadowParams", this.shadowParams),
    );
  }

  private applyEnvironment(mat: ShaderMaterial): void {
    mat.setVector3("lightDir", this.lightDir);
    mat.setColor3("lightColor", this.lightColor);
    mat.setFloat("keyWrap", this.keyWrap);
    mat.setColor3("ambientColor", this.ambientColor);
    mat.setColor3("skyLightColor", this.skyLightColor);
    // The sky's own colour rather than the light it casts, and only the glass
    // materials declare it — a `setColor3` for a uniform an effect does not
    // have is dropped when the material binds, which is what lets this ride
    // along here instead of needing a second walk over a second list.
    mat.setColor3("skyZenithColor", this.skyZenithColor);
    mat.setColor3("rimColor", this.rimColor);
    mat.setColor3("fogColor", fogState.color);
    mat.setVector2("fogParams", new Vector2(fogState.start, fogState.end));
    mat.setColor3("mistColor", this.mistColor);
    mat.setVector2("mistParams", this.mistParams);
    // Weathering is a property of the LOOK rather than of the map, so it comes
    // from CONFIG and not from the environment — but it rides along here
    // because this is what already runs on every material, on creation and on
    // every environment change.
    const variation = CONFIG.graphics.albedoVariation;
    mat.setFloat("variationScale", 1 / Math.max(0.001, variation.metersPerCell));
    mat.setFloat("variationAmount", variation.amount);
    // The map's grime, and the AMOUNT is the one piece of state in this method
    // that IS the map's — see `EnvironmentSpec.wear` for why dirt is a claim
    // about a place where the albedo variation above is a claim about the
    // renderer. Everything else here is CONFIG's: the vertical fade's edge, the
    // ramp's shape and the grain are the physics of splash-back and rising damp
    // and are the same in every village. The falloff rides here rather than in
    // the bake because a curve baked at a wall's two corners arrives as a
    // straight line; see the fragment's WEAR block.
    mat.setColor3("wearColor", this.wearColor);
    mat.setVector4(
      "wearParams",
      new Vector4(
        this.wearAmount,
        Math.sin((CONFIG.wear.verticalDegrees * Math.PI) / 180),
        CONFIG.wear.falloff,
        CONFIG.wear.edgeBreak,
      ),
    );
    mat.setVector3(
      "wearGrain",
      new Vector3(
        1 / Math.max(0.001, CONFIG.wear.metersPerCell),
        CONFIG.wear.streak,
        CONFIG.wear.contrast,
      ),
    );
  }

  /**
   * WHOSE PASS this material is about to be drawn for: the eye it fogs and rims
   * against, and what it writes into that pass's alpha channel. See `camPos`
   * for why on create, and `opaqueAlpha` in the fragment for why the second one
   * is not a constant — the two facts move together and both are owned by
   * `ReflectionSystem`, which is the only thing in the tree that draws the
   * world from anywhere but the player's head.
   */
  private applyCamera(mat: ShaderMaterial): void {
    mat.setVector3("camPos", this.camPos);
    mat.setFloat("opaqueAlpha", this.opaqueAlpha);
  }

  /**
   * The wind's shape and its clock, pushed onto a material as it is created.
   *
   * The shape never changes — it is `CONFIG.wind`, read once — so only the
   * clock is walked per frame (`updateWind`). Seeding on create matters for
   * the reason `applyCamera` does: `installMap` mints materials mid-round, and
   * a canopy built from a material holding `windTime` 0 would start its gust
   * from wherever the rest of the valley is not.
   */
  private applyWind(mat: ShaderMaterial): void {
    const w = CONFIG.wind;
    mat.setFloat("windTime", this.windTime);
    mat.setVector2("windDir", windBearing);
    mat.setVector3(
      "windParams",
      // z is the gust's wavenumber — a wavelength in metres is what the config
      // states, because that is the number anyone tuning it can pace out.
      new Vector3(
        w.foliage.travel,
        w.foliage.speed,
        (Math.PI * 2) / w.foliage.gust,
      ),
    );
  }

  private applyPointLights(mat: ShaderMaterial): void {
    // Float32Array is accepted by setArray3/setFloats (typed as number[]).
    mat.setArray3("pointPos", this.pointPos as unknown as number[]);
    mat.setArray3("pointColor", this.pointColor as unknown as number[]);
    mat.setFloats("pointRange", this.pointRange as unknown as number[]);
    mat.setFloat("pointCount", this.pointCount);
  }

  private applyShadow(mat: ShaderMaterial): void {
    if (this.shadowMap) mat.setTexture("shadowMap", this.shadowMap);
    mat.setMatrix("lightMatrix", this.shadowMatrix);
    mat.setVector4("shadowParams", this.shadowParams);
    if (this.bodyShadowMap) {
      mat.setTexture("bodyShadowMap", this.bodyShadowMap);
    }
    mat.setMatrix("bodyLightMatrix", this.bodyShadowMatrix);
    mat.setVector4("bodyShadowParams", this.bodyShadowParams);
  }

  /**
   * The spec each glossy material was BUILT with, so a later override can
   * find them again.
   *
   * This exists because the cache keys — `\0gloss-<hex>` and
   * `\0ground-<key>-spec-bump` — deliberately do not include the spec's
   * values, and the factory outlives a map: the second map to ask for the
   * same colour gets the first map's material, uniforms and all. Re-applying
   * over the cache is how `setEnvironment` already solves exactly this, and
   * doing it that way rather than widening the key keeps one material per
   * colour instead of one per colour per map ever loaded.
   */
  private readonly specs = new Map<ShaderMaterial, SpecSpec>();

  /** Specular is per-material, never theme-wide: null keeps a material matte. */
  private applySpec(mat: ShaderMaterial, spec: SpecSpec | null): void {
    if (!spec) {
      mat.setColor3("specColor", Color3.Black());
      // Shininess 1 is a no-op exponent — the zero specColor wins anyway.
      mat.setFloat("specShininess", 1);
      // Zero is WRITTEN rather than left where the last spec put it: these
      // materials are cached and re-applied over (see `specs`), so an
      // unwritten uniform on a re-used material is the previous map's answer,
      // and this one is the branch the mirror block is behind.
      mat.setFloat("specMirror", 0);
      return;
    }
    this.specs.set(mat, spec);
    mat.setColor3(
      "specColor",
      Color3.FromHexString(spec.color).scale(spec.intensity),
    );
    mat.setFloat("specShininess", Math.max(1, spec.shininess));
    mat.setFloat("specMirror", Math.min(1, Math.max(0, spec.mirror ?? 0)));
  }

  /** What a ground material created from here on is built with. */
  private groundSpec: SpecSpec = CONFIG.graphics.spec.cobble;

  /**
   * Replaces the sheen on the GROUND material — the map's weather and the
   * elevation of its key light, which is what `CONFIG.graphics.spec.cobble`'s
   * own note says to re-check whenever the light moves.
   *
   * Passing `undefined` restores the shipped value, so switching back to a map
   * that states nothing genuinely undoes this rather than leaving the previous
   * map's streets behind. Scoped to the ground on purpose: the rifle's spec is
   * the player's weapon, which no map owns.
   */
  setGroundSpec(spec: SpecSpec | undefined): void {
    const next = spec ?? CONFIG.graphics.spec.cobble;
    this.groundSpec = next;
    this.specs.forEach((_, mat) => {
      if (mat.name.startsWith("cel-ground-")) this.applySpec(mat, next);
    });
  }

  /**
   * Translucency is per-material for the same reason specular is: null keeps
   * a material opaque, and the zero colour is what the shader's term
   * multiplies out to nothing against.
   */
  private applyTranslucency(
    mat: ShaderMaterial,
    trans: TranslucencySpec | null,
  ): void {
    mat.setColor3(
      "transColor",
      trans
        ? Color3.FromHexString(trans.color).scale(trans.intensity)
        : Color3.Black(),
    );
  }

  /**
   * Glazing is per-material like the other two, but unlike them it has no
   * null arm: `CEL_GLASS` is a compile-time define, so the only material this
   * is ever called on is one built to be glass and there is no "off" value to
   * push onto the rest of the cache.
   */
  private applyGlass(mat: ShaderMaterial, glass: GlassSpec): void {
    mat.setVector4(
      "glassParams",
      new Vector4(glass.reflectance, glass.falloff, glass.halo, glass.tint),
    );
  }

  /**
   * What a glazing material is BORN with: a bound cube and a strength of zero,
   * which is a pane that reflects the sky and nothing else.
   *
   * Unlike every other `apply*` here this is not a copy of shared state, and
   * that is the whole shape of the reflection: `glassProbe` is what gives a
   * material a real one, and it does it on the spot rather than from a walk.
   */
  private applyReflection(mat: ShaderMaterial): void {
    if (this.defaultCube) mat.setTexture("reflectionCube", this.defaultCube);
    mat.setVector3("reflectBoxMin", Vector3.Zero());
    mat.setVector3("reflectBoxMax", Vector3.Zero());
    mat.setVector4("reflectProbe", new Vector4(0, 0, 0, 0));
  }
}

/**
 * The installed map's fog, as the passes that are NOT the cel shader see it.
 * Written by `CelMaterialFactory.setEnvironment`, which is also what pushes it
 * onto the cel materials as uniforms — one fact, one writer, so the ink and
 * the wall it hangs in front of cannot disagree.
 *
 * It is module state rather than a factory field because the passes that need
 * it reach it from outside any material. They take it two different ways, and
 * the difference is what each pass can be told:
 *
 * - The INK takes the band itself, as `CelInk`'s `fadeBand` uniform, and fades
 *   per PIXEL off the distance it already holds. It has to be per pixel:
 *   `BlockMerge` gives one mesh per 48 m block, so a per-MESH ink fade left the
 *   far half of a block in clear ink over a wall that had already gone to fog
 *   (measured, while the ink was still a hull: 50 of 687 outlined meshes span
 *   the entire fog band). That measurement is why the hull needed a shader-store
 *   patch to fade correctly and why a full-screen pass gets it for nothing.
 * - The GLOW layer gets it through `fogAmountAt`, and fades per MESH, because
 *   its bloom is generated from a material's emissive colour and there is no
 *   per-pixel hook at all. That is affordable where the ink's was not: a bloom
 *   is a soft blob with no edge to misplace.
 */
const fogState = { color: new Color3(0.05, 0.06, 0.08), start: 24, end: 78 };



/**
 * The wind's bearing, normalised once.
 *
 * A module constant rather than a field for the reason `CONFIG.wind` is one
 * table rather than a per-map override: the air over a valley is not something
 * a map states, and nothing in the game changes it at runtime. `GrassShader`
 * normalises the same pair for its own material — two readers of one bearing,
 * which is exactly what moving it out of `CONFIG.grass` bought.
 */


/**
 * The name of the one material every matte surface in the village wears.
 *
 * **It deliberately carries no hex**, because there is no single colour to
 * name — the palette arrives per vertex (`getWorldCel`, `vPalette`) — and the
 * name is what says so to every reader that parses one: `MapBuilder`'s
 * `plainCelHex` refuses it, so a mesh already wearing the palette material is
 * never offered to the palette merge a second time.
 *
 * It used to matter to two more readers and both went with the hull ink, which
 * is worth knowing only because it is why the rule reads as bigger than it now
 * is: the ink's own name regex had to skip this material, and `MapBuilder` had
 * to keep it out of Babylon's per-MESH outline pass, which could not tint one
 * shell for a mesh holding ten colours. A full-screen ink asks the name
 * nothing.
 */
export const WORLD_CEL_NAME = "cel-world";

/**
 * The same, for the one material every soldier rig wears (`getBodyCel`).
 *
 * It carries no hex for `WORLD_CEL_NAME`'s reason and answers `plainCelHex`
 * the same way — which matters here even though no rig mesh is ever offered to
 * `MapBuilder`'s merge, because the rule that keeps a paletteised mesh from
 * being paletteised twice should hold for both palettes or for neither.
 */
export const BODY_CEL_NAME = "cel-body";

const windBearing = new Vector2(
  CONFIG.wind.dir[0],
  CONFIG.wind.dir[1],
).normalize();

/**
 * How much of the fog colour a surface `dist` from the eye is buried under, on
 * the cel shader's own curve — the `t * t` in CEL_FRAGMENT's atmosphere block,
 * repeated here for the passes that cannot run that shader.
 *
 * **Anything drawn unshaded owes this curve**, through here or through a band
 * of its own the way `CelInk` takes one, or it hangs in front of the fog wall
 * at full strength
 * while the world behind it dissolves. That was two separate bugs on Greyfen,
 * and neither showed on Hollowmere: with a near-black fog, unfogged ink is
 * invisible against the wall and a glow reads as a lamp. A bright fog is what
 * makes an un-attenuated pass obvious.
 */
export function fogAmountAt(dist: number): number {
  const span = Math.max(0.001, fogState.end - fogState.start);
  const t = Math.min(1, Math.max(0, (dist - fogState.start) / span));
  return t * t;
}

/**
 * The same curve's two ends, for the one reader that evaluates it PER PIXEL in
 * a shader of its own rather than calling `fogAmountAt` per mesh.
 *
 * `CelInk` is that reader. It owes the curve for the reason stated above — an
 * unfogged line hangs in front of the fog wall at full strength while the wall
 * behind it dissolves — and it is the map's band and not a constant, so it has
 * to be read after `setEnvironment` rather than captured once. Handed out as
 * the raw pair because the shader needs the ends to interpolate between, where
 * every other caller wants the answer.
 */
export function fogBand(): { start: number; end: number } {
  return { start: fogState.start, end: fogState.end };
}



