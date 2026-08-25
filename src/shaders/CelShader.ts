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
 * pipeline.imageProcessingEnabled must stay false. Output is also opaque —
 * gl_FragColor's alpha is 1 for every variant but getGlass(), the world's one
 * alpha-blended material, which writes a Fresnel alpha, needs no depth write
 * (see there, and MapBuilder's pane rules), carries the one depth bias in
 * the renderer — GLASS_DEPTH_UNITS, without which a pane past ~100 m is not
 * drawn at all — and is the one variant that samples anything the renderer
 * drew for itself (setReflection, whose cube ReflectionSystem bakes and whose
 * strength is 0 until it has). Materials are cached/shared per color — don't create per-mesh
 * materials, and NEVER dispose one: a mesh's paint belongs to the cache and not
 * to the mesh, so `dispose(false, true)` on any rig built through here disposes
 * the world's own materials with it. Nothing removes the dead entry from the
 * cache, and the released effect is shared, so what follows is most of the map
 * silently not drawn (see Tank.dispose). A NEW material is seeded with
 * every piece of shared state on the spot (applyCamera/applyEnvironment/
 * applyPointLights/applyShadow): the per-frame walks are guarded on change and
 * skip a still frame entirely, so what a material is born with is what it keeps
 * until that state next moves. addOutline() skips meshes with
 * metadata.noOutline, tints the ink from the mesh's own cel colour, and
 * registers the mesh for updateOutlineScales() (distance thinning, prunes
 * disposed meshes). Effect meshes use getEmissive() (unlit StandardMaterial).
 * Also owns the fog as a published fact: setEnvironment writes it once, the cel
 * materials get it as uniforms, OutlineFog bakes it into the outline pass,
 * EmissiveFog uploads it to the unlit emissive materials, and fogAmountAt()
 * hands the same curve to the GlowLayer. Anything else drawn unshaded owes that
 * fade, or it hangs in front of the fog wall at full strength.
 */
import {
  type BaseTexture,
  Color3,
  Effect,
  Matrix,
  Mesh,
  Scene,
  ShaderMaterial,
  StandardMaterial,
  Vector2,
  Vector3,
  Vector4,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import { DITHER_GLSL } from "./Dither";
import { attachEmissiveFog, setEmissiveFog } from "./EmissiveFog";
import { refreshOutlineFog, setOutlineFog } from "./OutlineFog";
// The bone includes self-register in the IncludesShadersStore; import them
// explicitly so the cel vertex shader's #include<bones...> can never be
// tree-shaken away. Their contents are guarded internally by
// NUM_BONE_INFLUENCERS, so non-skinned materials compile to identical code.
import "@babylonjs/core/Shaders/ShadersInclude/bonesDeclaration";
import "@babylonjs/core/Shaders/ShadersInclude/bonesVertex";

/**
 * Custom cel-shading: quantized diffuse bands, a hard stylized rim highlight,
 * flat colors (or a texture albedo — uv-mapped for the skinned player body,
 * world-XZ-mapped for ground surfaces like cobblestone roads), and per-theme
 * atmosphere blended in the fragment shader. Ground-textured materials may
 * also carry a matching height map (CEL_BUMP): the facet normal is perturbed
 * by the height slope, measured from world-space taps a texel apart — never
 * from screen-space derivatives, which make the relief boil as the player walks
 * (see perturbNormal) — so the light bands ripple across individual
 * cobblestones.
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
 * The hard-band quantizer, shared verbatim by every surface shader in the game.
 *
 * It was three identical copies — cel, grass and water — which was harmless
 * only because nobody had ever changed it. `SHADOW_GLSL` below is the one that
 * made sharing necessary rather than tidy, and the two travel together: a band
 * function that disagreed between the three would put a different terminator on
 * a wall, the grass in front of it and the water beside it.
 */
export const BAND_GLSL = `
// Quantizes a 0..1 diffuse term into hard bands, smoothstepping across each
// edge so the terminator reads as a hard line without aliasing.
//
// **The transition is at least one PIXEL wide, and the fixed 0.15 it used to be
// is only the floor.** A band edge is a hard edge with no geometry behind it,
// so nothing in the pipe antialiases it: FXAA works on luminance contrast and
// these are low-contrast interior edges, and there is no MSAA (the only thing
// drawn to the default framebuffer is FXAA's own quad). That was harmless while
// the normal driving \`ndl\` was a facet normal — a wall's band index moves a
// thousandth of a band per pixel and one edge crosses the whole face. It stops
// being harmless the moment a BUMP map drives it: the relief puts a terminator
// around every grain, thousands of them per screen, each one aliasing on its
// own. Measured against a 4x supersampled reference of the same frame, the
// valley floor's near ground went from 1.8% of pixels off-reference to 10.3%
// when it gained a height map — and the whole of that difference was here.
//
// \`fwidth(x)\` is how fast the band index moves per pixel, so widening the
// smoothstep to it makes the edge exactly resolvable and no wider. Where the
// index moves slowly — every wall, roof and flat face in the game — it is below
// the authored 0.15 and nothing changes at all. Clamped at 0.5 because half a
// cell either side already spans the whole band: past that the quantization
// would invert rather than soften, and what it degrades to instead is smooth
// shading, which is the correct answer for a surface whose bands can no longer
// be drawn.
float band(float ndl, float steps) {
  float x = ndl * steps;
  float w = clamp(fwidth(x), 0.15, 0.5);
  return min((floor(x) + smoothstep(0.5 - w, 0.5 + w, fract(x))) / steps, 1.0);
}
`;

/**
 * The stepped shadow lookup, and the uniforms it reads. Included by the cel,
 * grass and water fragment shaders so all three sample the SAME depth map with
 * the SAME kernel.
 *
 * Grass and water went without this for as long as they existed, and the
 * artefact is the loudest continuity break the frame had: the key light is the
 * moon, so a cottage lays a hard shadow across the ground — and that shadow
 * stopped dead at the edge of a grass rect and at the waterline, because the
 * two surfaces standing in the same shadow were the two that could not see it.
 *
 * A consumer owes three uniforms (`lightMatrix`, `shadowParams`) and one
 * sampler (`shadowMap`), and owes REGISTERING with
 * `CelMaterialFactory.registerShadowConsumer` — the factory pushes all three,
 * and a material that is never registered samples an unbound texture.
 */
/**
 * The reflection probe a mirror samples, and the parallax correction that
 * stops it reading as a decal.
 *
 * **Shared verbatim by the two surfaces in the game that hold up a mirror**
 * — the glazing (`CEL_GLASS`, below) and the water (`WaterShader.ts`) —
 * because both sample cubes `ReflectionSystem` bakes the same way, and both
 * subtleties in the function are exactly the kind that get fixed in one copy
 * and left standing in the other. A material that interpolates this owes
 * `PROBE_UNIFORM_NAMES` and `PROBE_SAMPLER_NAMES` in its own lists.
 */
export const PROBE_GLSL = `
// The world as a mirror sees it: one cube baked per map install from the
// map's own geometry (systems/ReflectionSystem.ts). Alpha 1 where the bake
// drew something and 0 where it saw nothing at all, which is what lets the
// sky above stay the analytic gradient and the world below be a picture of
// the world. Colour is NOT premultiplied — see each sampler's own mix.
uniform samplerCube reflectionCube;
// Where the cube was baked from, and how much of it this surface returns
// against the sky it would otherwise show: reflectProbe.xyz is the bake point
// and .w is the strength — 0 where nothing was baked, which is every editor
// build and every map with nothing to bake for.
uniform vec4 reflectProbe;

// The Y flip, which every sampler of one of these cubes owes.
//
// A cube face is stored top-down while a framebuffer is bottom-up, so a cube
// RENDERED into comes out mirrored about the horizon. Babylon says as much by
// giving a cube render target INVCUBIC_MODE, and its own reflection path
// spends that define on this one line. Without it a mirror returns the
// pavement where the sky should be, which reads as glass that is simply too
// dark rather than as anything upside down — the mistake is invisible until
// it is looked for.
vec3 probeCubeDir(vec3 dir) {
  return vec3(dir.x, -dir.y, dir.z);
}
`;

/**
 * The parallax half of a probe: the box a mirrored ray leaves the world
 * through, and the re-aim that turns an infinite-distance cube into one with
 * a place in it.
 *
 * **Separate from `PROBE_GLSL` because the two mirrors want opposite things.**
 * A pane is vertical and a player walks ALONG it, so a decal that sits still
 * as you pass is exactly what the correction exists to stop. Water is
 * horizontal and its probe stands ON it, so what its rays can reach is the far
 * surround — far enough that an infinite cube is nearly right, and correcting
 * it against a map-sized box collapses every pixel onto the same far exit
 * point. So the glazing interpolates this and the water does not, and neither
 * carries the other's uniforms.
 */
export const PROBE_BOX_GLSL = `
// The box the mirrored ray is parallax-corrected against — the map's own
// extent, floor to roofline.
uniform vec3 reflectBoxMin;
uniform vec3 reflectBoxMax;

// Parallax correction for the reflection cube: where the mirrored ray leaves
// the map, expressed as a direction from the point the cube was baked at.
//
// A cube map is a picture taken from ONE place, and sampled with the raw
// mirrored ray it behaves as if everything in it were infinitely far away —
// so the city in a pane would sit still while the player walks past it, which
// reads as a decal rather than as a reflection. Intersecting the ray with a
// box that stands in for the world and re-aiming from the bake point at the
// hit is the standard correction, and here the box is not an approximation of
// anything: it is the map's own extent, which is a square with a hard boundary
// on all four sides and a roofline over it.
//
// The reciprocal is taken against a floor rather than the component itself. A
// ray exactly parallel to a face divides by zero, which is a well-behaved
// infinity that never wins the min below — but a ray parallel to a face it is
// also exactly ON divides zero by zero, and one NaN takes the whole sample
// with it. sign() cannot supply the missing direction (sign(0) is 0), so the
// magnitude is clamped and the sign restored by hand.

vec3 reflectBoxDir(vec3 dir, vec3 pos) {
  vec3 sgn = sign(dir);
  sgn += 1.0 - abs(sgn);
  vec3 inv = 1.0 / (sgn * max(abs(dir), vec3(1e-5)));
  vec3 tHi = (reflectBoxMax - pos) * inv;
  vec3 tLo = (reflectBoxMin - pos) * inv;
  // The far intersection on each axis; the nearest of the three is the face
  // the ray actually leaves through. max() picks the far one per axis because
  // one of the pair is behind the ray whenever pos is inside the box.
  vec3 t = max(tHi, tLo);
  float hit = min(min(t.x, t.y), t.z);
  vec3 aimed = (pos + dir * max(hit, 0.0)) - reflectProbe.xyz;
  return probeCubeDir(aimed);
}
`;

/** The parallax box, for a material that interpolates `PROBE_BOX_GLSL`. */
export const PROBE_BOX_UNIFORM_NAMES = ["reflectBoxMin", "reflectBoxMax"];
/** The probe uniforms a sampling material owes, beside `PROBE_SAMPLER_NAMES`. */
export const PROBE_UNIFORM_NAMES = [
  "reflectBoxMin",
  "reflectBoxMax",
  "reflectProbe",
];

/** The cube itself. */
export const PROBE_SAMPLER_NAMES = ["reflectionCube"];

export const SHADOW_GLSL = `
// Stepped directional shadows. lightMatrix is the ShadowGenerator's
// view*projection (no [0,1] bias baked in — the UV/depth remap below mirrors
// Babylon's own computeShadow: uv = clip.xy*0.5+0.5, depth = (clip.z+1)*0.5).
uniform mat4 lightMatrix;
uniform sampler2D shadowMap;
// x = depth bias, y = darkness, z = normal offset, w = tap radius in UV
uniform vec4 shadowParams;

// Hard two-level shadow: lit or not, nothing in between — a soft penumbra
// would fight the flat bands. The sample point is pushed off the facet along
// its normal so a flat face never tests against its own depth (acne).
//
// The normal passed in is the one to OFFSET along, which is not always the one
// being lit: it must be the real geometry's. The cel shader hands it the facet
// normal rather than the bumped one, and water hands it the flat up-vector
// rather than the wave normal, for the same reason in both cases — the relief
// is a fiction, and offsetting along a fiction moves the shadow with it.
//
// **FOUR taps, and the count is the whole design.** One tap put the shadow map's
// own texel grid on screen: at 110 m over 2048 texels an edge climbs in 5.4 cm
// steps, and up close that reads as a staircase rather than as a line. The
// staircase has a spatial period of exactly one texel, so a kernel whose support
// covers one period cancels it — and anything WIDER starts producing a real
// penumbra, which is the thing this shader's flat bands cannot have. The
// softening is confined to the width of the artefact: a 5.4 cm edge is
// sub-pixel past about 2 m, so what is left still reads as the hard line the
// look wants. The cel terminator is band(dot(n, -lightDir), 4.0) and is not
// touched by any of this.
//
// The 2x2 is ROTATED per pixel, which matters as much as the count. Four taps
// averaged give five possible values, and five values along an edge are five
// visible contours — a staircase with more steps. Rotating by a hash of the
// pixel turns that residue into noise, which composes with dither() rather
// than fighting it.
//
// Hardware PCF is not available: this samples a plain depth texture and
// compares by hand rather than through a comparison sampler, so every tap is a
// full fetch. That is the other half of why the count stops at four.
float shadowVisibility(vec3 n, vec3 posW) {
  vec4 sc4 = lightMatrix * vec4(posW + n * shadowParams.z, 1.0);
  vec3 sc = sc4.xyz / sc4.w;
  vec2 uv = sc.xy * 0.5 + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 1.0;
  if (sc.z < -1.0 || sc.z > 1.0) return 1.0;
  float depth = (sc.z + 1.0) * 0.5 - shadowParams.x;

  float a = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453)
    * 6.2831853;
  vec2 rot = vec2(cos(a), sin(a)) * shadowParams.w;
  vec2 perp = vec2(-rot.y, rot.x);

  float lit = step(depth, texture2D(shadowMap, uv + rot).x)
    + step(depth, texture2D(shadowMap, uv - rot).x)
    + step(depth, texture2D(shadowMap, uv + perp).x)
    + step(depth, texture2D(shadowMap, uv - perp).x);
  // Narrow smoothstep rather than a plain average: the four taps give a 0,
  // 0.25, 0.5, 0.75, 1 ladder, and this pulls the middle of it back toward a
  // decision so the edge stays an edge and only its jaggies are dissolved.
  return mix(shadowParams.y, 1.0, smoothstep(0.25, 0.75, lit * 0.25));
}
`;

/** The uniform names `SHADOW_GLSL` declares, for a consumer's uniform list. */
export const SHADOW_UNIFORM_NAMES = ["lightMatrix", "shadowParams"] as const;
/** The sampler `SHADOW_GLSL` declares, for a consumer's sampler list. */
export const SHADOW_SAMPLER_NAMES = ["shadowMap"] as const;

Effect.ShadersStore["celVertexShader"] = `
precision highp float;

attribute vec3 position;
attribute vec3 normal;
// Baked world shading, written by world/vertexShading.ts: alpha is ambient
// occlusion, green marks a vertex as WORLD geometry and RED is how much of the
// wind's travel this vertex is entitled to. Declared unconditionally and on
// purpose — a mesh with no colour buffer leaves this attrib array disabled,
// which reads back as the GL generic default (0, 0, 0, 1): occlusion 1 (none),
// mask 0 (not world) and sway 0 (planted). Every rig, the viewmodel and every
// effect mesh is therefore correct without carrying one.
attribute vec4 color;
#ifdef CEL_TEXTURED
attribute vec2 uv;
#endif

// Self-guarded by NUM_BONE_INFLUENCERS (0 for rigid meshes, set automatically
// by ShaderMaterial for skinned ones): declares matricesIndices/Weights and
// the mBones/boneSampler uniforms.
#include<bonesDeclaration>

uniform mat4 world;
uniform mat4 viewProjection;

// The wind, shared with the grass field (CONFIG.wind). windDir is the bearing,
// normalised; windParams is (travel in metres at full weight, speed, gust
// wavenumber). windTime is the same clock the grass runs on, pushed by
// CelMaterialFactory.updateWind — it advances with the world rather than with
// the frame, so a pause holds the canopy exactly as it holds the field.
uniform float windTime;
uniform vec2 windDir;
uniform vec3 windParams;

#ifdef CEL_INK
// The ink hull's own expansion, and the eye it thins against. Declared here
// rather than shared with the fragment stage because only this variant expands:
// x = full width (m), y = the distance it holds it to, z = the distance it has
// reached its floor (w) by. Same four numbers as CONFIG.graphics.outlines,
// spent per VERTEX rather than per mesh — see getInk in this file.
uniform vec3 camPos;
uniform vec4 inkParams;
#endif

varying vec3 vNormalW;
varying vec3 vPosW;
varying vec4 vBaked;
#ifdef CEL_TEXTURED
varying vec2 vUv;
#endif

void main() {
  mat4 finalWorld = world;
  // No-op when NUM_BONE_INFLUENCERS == 0; otherwise blends finalWorld
  // through the bone matrices.
  #include<bonesVertex>
  vec4 worldPos = finalWorld * vec4(position, 1.0);

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
  if (color.r > 0.0) {
    // Subtracted, not added: a gust has to travel WITH the wind, and a wave
    // whose phase runs the other way rolls up the valley against the lean of
    // everything in it. The grass shader adds instead, and gets away with it
    // because its phase is not along the bearing at all — here it is.
    float phase = dot(worldPos.xz, windDir) * windParams.z;
    float gust = sin(windTime * windParams.y - phase)
      + 0.5 * sin(windTime * windParams.y * 2.33 - phase * 1.71);
    worldPos.xz += windDir * (gust * windParams.x * color.r);
  }

  vNormalW = normalize(mat3(finalWorld) * normal);

  #ifdef CEL_INK
  // The inverted hull, expanded along the world normal AFTER the sway — which
  // is the whole reason this variant exists. Babylon's own outline pass cannot
  // do it: OutlineRenderer.isReady builds its effect with a hardcoded attribute
  // list of position and normal ("const color = false", literally) and a
  // hardcoded uniform list with no clock in it, so its hull can see neither the
  // wind nor the weight and stays at the rest pose while the leaf leaves it.
  //
  // Thinned per VERTEX against the eye rather than per mesh, which is a
  // correction as well as a convenience: updateOutlineScales measures one
  // distance per mesh, and BlockMerge hands it meshes that span the whole fog
  // band (measured: 50 of 687). The colour fade was moved per pixel for exactly
  // that reason; this is the width catching up.
  float inkDist = distance(worldPos.xyz, camPos);
  float inkT = clamp(
    (inkDist - inkParams.y) / max(inkParams.z - inkParams.y, 0.001), 0.0, 1.0);
  worldPos.xyz += vNormalW * (inkParams.x * mix(1.0, inkParams.w, inkT));
  #endif

  vPosW = worldPos.xyz;
  vBaked = color;
  #ifdef CEL_TEXTURED
  vUv = uv;
  #endif
  gl_Position = viewProjection * worldPos;
}
`;

Effect.ShadersStore["celFragmentShader"] = `
#extension GL_OES_standard_derivatives : enable
precision highp float;

#define MAX_POINT_LIGHTS ${MAX_POINT_LIGHTS}

varying vec3 vNormalW;
varying vec3 vPosW;
// Baked per-vertex world shading. w is ambient occlusion, 1 = unoccluded;
// y is 1 on map geometry and 0 on everything else; x is the wind weight the
// vertex stage has already spent. All three defaults come from the disabled
// attrib rather than from a uniform — see the vertex stage.
varying vec4 vBaked;

uniform vec3 lightDir;
uniform vec3 lightColor;
uniform vec3 ambientColor;
// Hemispheric fill from the sky dome: full strength on up-facing surfaces,
// nothing underneath. Banded like everything else so the toon look survives.
uniform vec3 skyLightColor;
uniform vec3 rimColor;
#ifdef CEL_TEXTURED
uniform sampler2D baseColorTex;
varying vec2 vUv;
#else
#ifdef CEL_GROUND_TEX
// World-mapped ground albedo: sampled at vPosW.xz * texScale, so no UVs are
// needed and the pattern keeps a constant real-world size across placements.
uniform sampler2D baseColorTex;
uniform float texScale;
// The tile's own weathering — see graphics.groundVariation in the config for
// why a ground texture gets a wider cell and a wider swing than a flat colour.
uniform float groundVariationScale;
uniform float groundVariationAmount;
#ifdef CEL_BUMP
// Height map matching the albedo texel-for-texel (domed setts, dark mortar).
uniform sampler2D bumpTex;
uniform float bumpScale; // metres of fake relief at height value 1.0
#endif
#else
uniform vec3 baseColor;
#endif
#endif
uniform vec3 fogColor;
uniform vec2 fogParams;  // x = start, y = end
#ifdef CEL_INK
uniform vec3 inkColor;
#endif
uniform vec3 mistColor;
uniform vec2 mistParams; // x = height falloff, y = strength
uniform vec3 camPos;

// Albedo weathering: cell size (as 1/metres) and peak-to-peak swing. Uniforms
// rather than literals so the pair can be judged live against a wall.
uniform float variationScale;
uniform float variationAmount;

uniform vec3 pointPos[MAX_POINT_LIGHTS];
uniform vec3 pointColor[MAX_POINT_LIGHTS]; // rgb premultiplied by intensity
uniform float pointRange[MAX_POINT_LIGHTS];
uniform float pointCount;

${SHADOW_GLSL}

// Toon specular: one hard two-band Blinn highlight from the key light.
// specColor is premultiplied by intensity — black (the default) is matte.
uniform vec3 specColor;
uniform float specShininess;

// Translucency: the key light coming THROUGH a thin surface rather than off
// it — a canvas awning or a pine crown with the moon behind it. Premultiplied
// by intensity — black (the default) is opaque.
uniform vec3 transColor;

#ifdef CEL_GLASS
// Glazing. x = reflectance face-on, y = the Fresnel falloff's exponent,
// z = cosine half-width of the sun's halo in the reflection, w = how much of
// the tint a face-on pane keeps. See CelMaterialFactory.getGlass.
uniform vec4 glassParams;
// The top of the sky dome. The HORIZON end of the same gradient is fogColor,
// which is already here and which SkySpec.horizonColor is required to sit
// close to — the one place that requirement is load-bearing rather than
// cosmetic.
uniform vec3 skyZenithColor;
#ifdef CEL_GLASS_BACKED
// The ALBEDO of the mass this sheet hangs on, named by the builder that hung
// it (the backed argument of Build.pane). Unlit, because it is shaded here by
// the same light the pane is: they are parallel faces a hand apart, so one
// light term is right for both. See the composite below for why this is exact rather
// than an approximation of the blend it replaces.
uniform vec3 glassBackdrop;
#endif
#endif

// Geometric (per-triangle) normal from the world position's screen-space
// derivatives. The cross product's sign depends on triangle winding and
// viewing direction, so it is flipped to agree with the interpolated normal.
vec3 facetNormal() {
  vec3 n = normalize(cross(dFdx(vPosW), dFdy(vPosW)));
  return dot(n, vNormalW) < 0.0 ? -n : n;
}

${BAND_GLSL}
${DITHER_GLSL}

// Trilinear value noise over world space, 0..1. Deliberately one octave: this
// is weathering, not detail — a second octave adds frequencies the palette
// cannot express and starts reading as texture on a surface that has none.
float variationHash(vec3 cell) {
  return fract(sin(dot(cell, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
}

float valueNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  // Smoothstep the interpolant, or the cell boundaries show as creases.
  f = f * f * (3.0 - 2.0 * f);
  float n000 = variationHash(i + vec3(0.0, 0.0, 0.0));
  float n100 = variationHash(i + vec3(1.0, 0.0, 0.0));
  float n010 = variationHash(i + vec3(0.0, 1.0, 0.0));
  float n110 = variationHash(i + vec3(1.0, 1.0, 0.0));
  float n001 = variationHash(i + vec3(0.0, 0.0, 1.0));
  float n101 = variationHash(i + vec3(1.0, 0.0, 1.0));
  float n011 = variationHash(i + vec3(0.0, 1.0, 1.0));
  float n111 = variationHash(i + vec3(1.0, 1.0, 1.0));
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
// formulation (Mikkelsen 2010) off dFdx(h)/dFdy(h), which is the right tool
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
// last part is the whole reason no explicit distance fade is needed here.
//
// Three taps rather than four: forward differences off a shared centre. The
// asymmetry is half a texel of bias in where a grain's slope is reported, which
// is nothing beside a fetch per ground pixel.
vec3 perturbNormal(vec3 n) {
  vec2 uv = vPosW.xz * texScale;
  // One texel of the height map. Albedo and height are painted at the same
  // size (SIZE in world/textures.ts), which is what lets this be a constant.
  float e = 1.0 / 512.0;
  float h0 = texture2D(bumpTex, uv).r;
  float hx = texture2D(bumpTex, uv + vec2(e, 0.0)).r;
  float hz = texture2D(bumpTex, uv + vec2(0.0, e)).r;
  // Metres of rise per metre travelled: the tap is e / texScale metres away.
  float perMetre = bumpScale * texScale / e;
  vec3 grad = vec3((hx - h0) * perMetre, 0.0, (hz - h0) * perMetre);
  // Only the part of the gradient lying in the surface tilts it. On the
  // near-level ground this material is for that is almost all of it, and the
  // projection is what keeps a sloped road or a pitched deck honest.
  grad -= n * dot(grad, n);
  return normalize(n - grad);
}
#endif

#ifdef CEL_GLASS
${PROBE_GLSL}${PROBE_BOX_GLSL}
#endif

void main() {
  #ifdef CEL_INK
  // The ink is a flat colour and nothing else — no lighting, no shadow, no rim,
  // no occlusion. It falls through to the shared atmosphere block at the bottom
  // so the line over a wall dissolves on exactly the curve the wall does, which
  // is what OutlineFog has to bake literals into Babylon's shader to achieve
  // and what this variant gets for free. It picks up the ground MIST as well,
  // which that one cannot do at all.
  vec3 col = inkColor;
  float alpha = 1.0;
  #else
  vec3 n = facetNormal();

  // How level this facet is, read off the TRUE geometry before any bump map
  // touches it — the rim gate below keys on it, and reading it from the
  // perturbed normal would let individual setts flick the gate on and off.
  float level = abs(n.y);

  // --- directional key light (4 bands), gated by the stepped shadow ---
  // The shadow's normal-offset uses the true facet normal — the bump relief
  // is fake, and offsetting along it would leak light at stone edges.
  float shadow = shadowVisibility(n, vPosW);

  #ifdef CEL_BUMP
  // From here on the bumped normal drives every lighting term: key bands,
  // point lights, rim, and the specular streak all follow the setts.
  n = perturbNormal(n);
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
  float ao = vBaked.w;

  vec3 light = ambientColor * ao;
  light += lightColor * band(max(dot(n, -lightDir), 0.0), 4.0) * shadow;

  // Sky fill: the whole dome is a dim source, so anything looking up at it
  // picks up moonlight even where the key light is blocked. Deliberately NOT
  // gated by the shadow map — a roof in the moon's shadow still faces the sky.
  // This is what keeps roads, roofs and open ground reading as moonlit while
  // walls and undersides stay black.
  light += skyLightColor * band(0.5 + 0.5 * n.y, 3.0) * ao;

  // --- point lights (3 bands, smooth inverse-square-ish falloff) ---
  for (int i = 0; i < MAX_POINT_LIGHTS; i++) {
    if (float(i) < pointCount) {
      vec3 toLight = pointPos[i] - vPosW;
      float dist = length(toLight);
      float range = max(pointRange[i], 0.001);
      // Smooth window falloff: 1 at the source, 0 at the range limit.
      float atten = clamp(1.0 - dist / range, 0.0, 1.0);
      atten *= atten;
      float ndl = max(dot(n, toLight / max(dist, 0.001)), 0.0);
      // Lift the floor a little so lit surfaces read as glowing pools of
      // light rather than only the faces pointed at the flame.
      light += pointColor[i] * atten * (0.25 + 0.75 * band(ndl, 3.0));
    }
  }

  // Base albedo: flat palette color, the skinned character's texture, or a
  // world-mapped ground texture. All are used raw (display-ready), matching
  // the no-image-processing pipe.
  #ifdef CEL_TEXTURED
  vec3 base = texture2D(baseColorTex, vUv).rgb;
  #else
  #ifdef CEL_GROUND_TEX
  vec3 base = texture2D(baseColorTex, vPosW.xz * texScale).rgb;
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
  base *= 1.0 + groundVariationAmount * (valueNoise(vPosW * groundVariationScale) - 0.5);
  #else
  vec3 base = baseColor;
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
  // A BRANCH, not a mix. GLSL evaluates both arguments of mix(), so the mask
  // written that way still ran valueNoise — eight variationHash calls, each a
  // sin/dot/fract — on every pixel of the viewmodel that fills the lower third
  // of the screen, on every pixel of sixteen bot rigs and every particle, and
  // then multiplied the result by zero. The branch is uniform across a whole
  // mesh (the mask is a vertex attribute that is 1 or 0 per model, never in
  // between), so it is exactly the shape a GPU predicts well.
  if (vBaked.y > 0.5) {
    base *= 1.0 + variationAmount * (valueNoise(vPosW * variationScale) - 0.5);
  }
  #endif
  #endif
  vec3 col = base * light;

  // Soft shoulder: several lights overlapping (or a torch at point-blank
  // range) would otherwise clip to flat white and destroy the palette. This
  // compresses everything above 0.75 into the remaining headroom, so hot
  // spots stay tinted by the light that made them.
  vec3 over = max(col - 0.75, 0.0);
  col = min(col, vec3(0.75)) + 0.25 * over / (1.0 + over);

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
  // The gate is on tilt, not on distance, because distance is the symptom. Zero
  // within 8 deg of level (every road, deck, terrace and the flat majority of
  // the heightfield), full past 26 deg — clear of the shallowest roof pitch in
  // the kit, ~24 deg (BuildingKit.gableRoof). Sculpted banks in between keep
  // most of theirs, and on a slope the boundary is broken up rather than being
  // a clean circle. Smooth, so a gentle rise doesn't draw an edge of its own.
  vec3 viewDir = normalize(camPos - vPosW);
  float rim = 1.0 - max(dot(viewDir, n), 0.0);
  col += base * rimColor * step(0.72, rim) * (1.0 - smoothstep(0.90, 0.99, level));

  // Toon specular: Blinn half-vector against the key light, quantized into
  // two hard bands (bright core + faint halo) and gated by the same shadow
  // as the diffuse — a glint never appears where the moon doesn't reach.
  // Added after the soft shoulder on purpose: a highlight is allowed to
  // blow past the 0.75 ceiling, that's what makes it read as a shine.
  // Matte materials carry specColor 0 and this contributes nothing.
  vec3 h = normalize(viewDir - lightDir);
  float spec = pow(max(dot(n, h), 0.0), specShininess);
  col += specColor * band(spec, 2.0) * shadow;

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
  float through = max(dot(viewDir, lightDir), 0.0) * max(dot(n, lightDir), 0.0);
  col += transColor * band(through, 2.0) * shadow;

  // Opaque unless this is glazing, and the whole of what makes a pane a pane.
  float alpha = 1.0;

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
  vec3 mirrored = reflect(-viewDir, n);
  vec3 sky = mix(fogColor, skyZenithColor,
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
  float halo = smoothstep(glassParams.z, 1.0, dot(mirrored, -lightDir));
  sky += lightColor * halo * shadow;

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
  vec4 world = textureCube(reflectionCube, reflectBoxDir(mirrored, vPosW));
  sky = mix(sky, world.rgb / max(world.a, 0.001), world.a * reflectProbe.w);

  // Schlick, and deliberately NOT banded. Every other term in this shader is
  // quantized and this one must not be: the band edge would be a contour line
  // across a FLAT sheet, drawn where the view angle crosses a step and nowhere
  // else — so it would slide over the glazing as the player walks, which is
  // exactly the artefact the rim light is gated off level surfaces to avoid.
  // The water's fresnel is smooth for the same reason and is the precedent.
  float fres = glassParams.x + (1.0 - glassParams.x)
    * pow(1.0 - max(dot(viewDir, n), 0.0), glassParams.y);

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
  col = mix(mix(glassBackdrop * light, col, glassParams.w), sky, fres);
#else
  // Composite the two layers into one colour and one alpha. The reflection
  // covers the tint, the tint covers what is behind the pane, and dividing by
  // the total is what keeps the blend from darkening the result twice — the
  // rasterizer is about to multiply the colour by this alpha, so what goes out
  // has to be the layers' colour rather than their contribution.
  float tint = glassParams.w;
  alpha = fres + tint * (1.0 - fres);
  col = (sky * fres + col * tint * (1.0 - fres)) / max(alpha, 0.001);
#endif
#endif

  #endif // CEL_INK — everything above is the lit path the ink skips

  // --- atmosphere ---
  float dist = length(vPosW - camPos);

  // Low-lying ground mist: thickest at the floor, builds up with distance.
  // The ramp is deliberately long so lit ground near the player stays
  // readable and only the middle distance turns to soup.
  float mist = mistParams.y
    * exp(-max(vPosW.y, 0.0) / max(mistParams.x, 0.001))
    * clamp((dist - 6.0) / 45.0, 0.0, 1.0);
  col = mix(col, mistColor, clamp(mist, 0.0, 0.9));

  // Theme-tinted distance fog — reaches full strength so far walls vanish.
  //
  // The two atmosphere terms are applied to the colour and NOT to the alpha,
  // and a half-transparent pane in full fog still comes out right: whatever is
  // behind it is at least as far away and has already been mixed to the same
  // fogColor, so blending fog over fog lands on fog whatever the weight is.
  float fog = clamp((dist - fogParams.x) / (fogParams.y - fogParams.x), 0.0, 1.0);
  col = mix(col, fogColor, fog * fog);

  // Last thing before the write, because the write is the quantiser.
  gl_FragColor = vec4(dither(col), alpha);
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
   * already passes through glass (`OPAQUE_ONLY` subtracts a pane), so a window
   * the player cannot see through is one the AI can shoot them through. Tint
   * it enough to read as glass and no further.
   */
  tint: number;
}

/**
 * One reflection probe, as a surface that samples it WITHOUT the parallax
 * correction needs it — which today is the water. See `PROBE_BOX_GLSL` for why
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
  /** Cache key for the one skinned+textured material (never a hex color). */
  private static readonly SKINNED_KEY = "\0skinned";
  /** Uniforms every cel material shares, flat or skinned. */
  private static readonly UNIFORMS = [
    "world",
    "viewProjection",
    "lightDir",
    "lightColor",
    "ambientColor",
    "skyLightColor",
    "rimColor",
    "baseColor",
    "fogColor",
    "fogParams",
    "mistColor",
    "mistParams",
    "camPos",
    "pointPos",
    "pointColor",
    "pointRange",
    "pointCount",
    "lightMatrix",
    "shadowParams",
    "variationScale",
    "variationAmount",
    "specColor",
    "specShininess",
    "transColor",
    "windTime",
    "windDir",
    "windParams",
    // Spent only under CEL_INK. On every other variant the compiler drops them
    // and the `setVector*` finds no location, which is the same no-op the
    // glazing uniforms already are on a matte material — one list is worth more
    // than a second one that has to be kept in step with this.
    "inkColor",
    "inkParams",
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
  /** Every cel material samples the shadow map, whatever its albedo path. */
  private static readonly SAMPLERS = ["shadowMap"];
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
   * inside 5 cm of the eye — and against a 24-bit buffer that leaves a step of
   * 1 cm at 90 m, 3 cm at 160 m and 27 cm at the fog wall, while the standoff
   * stays what the builder gave it. Measured on Coldharbour's curtain wall,
   * square on, with the pane held at a constant size on screen: full at 40 and
   * 90 m, **gone entirely from 130 m out** — the tower goes back to being blank
   * concrete, with nothing wrong in the shader and nothing wrong in the
   * geometry.
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
   * Sixteen against a measured knee of eight, because `r` is
   * implementation-defined and this was measured on one implementation. What it
   * costs at the far end is that the fins and collars standing 0.1-0.2 m proud
   * of the glass are overdrawn by it past ~100 m, where they are a pixel or two
   * of trim — against a whole elevation of glazing, which is the thing the
   * player can actually see.
   *
   * Only the depth TEST is biased: a blended draw writes no depth (see
   * `getGlass`), so nothing downstream inherits the offset.
   */
  private static readonly GLASS_DEPTH_UNITS = -16;

  private cache = new Map<string, ShaderMaterial>();
  private emissiveCache = new Map<string, StandardMaterial>();

  private lightDir = new Vector3(-0.5, -0.9, 0.4).normalize();
  private lightColor = new Color3(0.55, 0.62, 0.8);
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

  constructor(private scene: Scene) {}

  /** Returns the shared cel material for a hex color, creating it on demand. */
  get(hex: string): ShaderMaterial {
    let mat = this.cache.get(hex);
    if (!mat) {
      mat = new ShaderMaterial(
        `cel-${hex}`,
        this.scene,
        { vertex: "cel", fragment: "cel" },
        {
          attributes: [...CelMaterialFactory.ATTRIBUTES],
          uniforms: [...CelMaterialFactory.UNIFORMS],
          samplers: [...CelMaterialFactory.SAMPLERS],
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
      this.cache.set(hex, mat);
    }
    return mat;
  }

  /**
   * The same flat cel colour as get(), but with the toon specular band
   * enabled — a hard key-light highlight for metal, glass, wet stone.
   * Cached under its own key so the matte variant of the same colour is
   * untouched; named `cel-gloss-#rrggbb` so outlineInkFor() still recovers
   * the palette colour for the ink.
   *
   * **The SPEC is part of the cache key and the NAME is not**, and both
   * halves of that are load-bearing. The spec is a uniform rather than a
   * define, so one hex asked for at two gloss levels is two materials that
   * differ only in what was uploaded to them — keyed on the colour alone,
   * whichever level asked first would silently answer for both, which is a
   * weapon finish coming out matte because some other finish had already
   * minted its colour. The NAME still carries the palette colour and
   * nothing else, because `inkColorFor` parses it.
   */
  getGlossy(hex: string, spec: SpecSpec): ShaderMaterial {
    const cacheKey = `\0gloss-${hex}-${spec.color}-${spec.intensity}-${spec.shininess}`;
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
      this.cache.set(cacheKey, mat);
    }
    return mat;
  }

  /**
   * The INK for a surface that moves — an inverted hull drawn through this
   * shader instead of through Babylon's outline pass.
   *
   * **It exists because Babylon's hull cannot follow a vertex-animated
   * surface, and that is a fact about its renderer rather than a taste.**
   * `OutlineRenderer.isReady` builds its effect with a hardcoded attribute list
   * of position and normal — `const color = false`, literally — and a hardcoded
   * `uniformsNames` with no clock in it. So the hull can see neither the wind
   * nor the per-vertex weight, and a swaying leaf leans out from under a shell
   * left standing at the rest pose: a third of a metre against a five
   * centimetre line, which reads as a dark ghost of the still canopy hanging
   * behind the moving one. Everything the hull needs is already in THIS shader,
   * so the answer is to draw it here.
   *
   * Three things fall out of that which are worth having on their own:
   *
   * - **The width is thinned per VERTEX**, against the same eye the fog uses,
   *   rather than per mesh by `updateOutlineScales`. That is a correction:
   *   `BlockMerge` hands out meshes that span the whole fog band (measured: 50
   *   of 687), and the ink's COLOUR fade was already moved per pixel for
   *   exactly that reason. This is the width catching up.
   * - **The fade is the surface's own**, computed from the same `fogParams`
   *   and `mistParams` in the same block, so the line over a wall dissolves on
   *   the curve the wall dissolves on. `OutlineFog` has to bake literals into
   *   Babylon's shader and drop compiled programs to get half of this, and
   *   cannot get the ground mist at all.
   * - **It is ONE draw rather than two.** Babylon renders an opaque mesh's
   *   outline twice — once before with depth-write off, once after with
   *   colour-write off to repair the depth buffer. An inverted hull with
   *   `cullBackFaces = false` and ordinary depth state needs neither pass.
   *
   * Keyed on the SOURCE material's name rather than on a hex, so `inkColorFor`
   * resolves exactly the colour `outlineInkFor` would have given the same
   * surface, and a matte and a translucent green get their own entries the way
   * they already do everywhere else in this cache.
   */
  getInk(sourceName: string): ShaderMaterial {
    const cacheKey = `\0ink-${sourceName}`;
    let mat = this.cache.get(cacheKey);
    if (!mat) {
      mat = new ShaderMaterial(
        `${INK_PREFIX}${sourceName}`,
        this.scene,
        { vertex: "cel", fragment: "cel" },
        {
          attributes: [...CelMaterialFactory.ATTRIBUTES],
          uniforms: [...CelMaterialFactory.UNIFORMS],
          samplers: [...CelMaterialFactory.SAMPLERS],
          defines: ["#define CEL_INK"],
        },
      );
      // Culling is ON and it is the FRONT faces that go: an inverted hull is
      // the back of an expanded copy, which is why this needs no ordering
      // against the surface it wraps. Inside the silhouette the back faces are
      // behind the real surface and lose the depth test; outside it they are
      // the nearest thing there is, and that ring is the line.
      mat.backFaceCulling = true;
      mat.cullBackFaces = false;
      // `inkColor` is NOT set here: the tint is the environment's, so
      // `applyEnvironment` below owns it and is the one writer — the same
      // arrangement the fog and the light terms are under.
      const o = CONFIG.graphics.outlines;
      mat.setVector4(
        "inkParams",
        new Vector4(INK_WIDTH, o.fullDistance, o.farDistance, o.minScale),
      );
      this.applyCamera(mat);
      this.applyWind(mat);
      this.applyEnvironment(mat);
      // **The ink samples no shadow and is still BOUND one, because a sampler
      // that is DECLARED has to be bound whether or not the variant reads
      // it.** `SAMPLERS` is one list for every cel variant, so `CEL_INK`
      // carries `shadowMap` into the bind group layout like all the others,
      // and a layout entry with nothing behind it is not the harmless no-op it
      // was under WebGL2 — the bind group fails to build and the draw is lost
      // with it. Measured on Hollowmere: two swaying merge groups, two ink
      // twins, `Failed to read the 'resource' property from
      // 'GPUBindGroupEntry'` and a black frame.
      //
      // This is NOT the migration's scaffolding and does not come out with it.
      // What comes out is the `if` in `applyShadow`, if the map ever stops
      // being bound after the materials exist. Point lights are the same shape
      // and need no equivalent: they are UNIFORMS, and an unwritten uniform in
      // a UBO reads as zeros rather than failing.
      this.applyShadow(mat);
      this.cache.set(cacheKey, mat);
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
   * Cached under its own key and named `cel-trans-#rrggbb` so
   * outlineInkFor() still recovers the palette colour for the ink.
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
      this.cache.set(cacheKey, mat);
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
      this.cache.set(cacheKey, mat);
    }
    return mat;
  }

  /**
   * The one cel material for skinned, textured meshes (the imported player
   * body). Same lighting/fog/rim pipeline as the flat colors, but the albedo
   * comes from a texture and the vertex shader is bone-deformed — ShaderMaterial
   * auto-adds the bone attributes, defines, and `boneSampler`/`mBones` uniforms
   * when it binds a mesh with a skeleton. Cached under a sentinel key in the
   * same map so environment, point-light, and camera updates reach it.
   */
  getSkinned(tex: BaseTexture): ShaderMaterial {
    let mat = this.cache.get(CelMaterialFactory.SKINNED_KEY);
    if (!mat) {
      mat = new ShaderMaterial(
        "cel-skinned",
        this.scene,
        { vertex: "cel", fragment: "cel" },
        {
          attributes: [...CelMaterialFactory.ATTRIBUTES, "uv"],
          uniforms: [...CelMaterialFactory.UNIFORMS],
          samplers: ["baseColorTex", ...CelMaterialFactory.SAMPLERS],
          defines: ["#define CEL_TEXTURED"],
        },
      );
      mat.setTexture("baseColorTex", tex);
      this.applyCamera(mat);
      this.applyWind(mat);
      this.applyEnvironment(mat);
      this.applyPointLights(mat);
      this.applyShadow(mat);
      this.applySpec(mat, null);
      this.applyTranslucency(mat, null);
      this.cache.set(CelMaterialFactory.SKINNED_KEY, mat);
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
   */
  getGroundTextured(
    key: string,
    tex: BaseTexture,
    texScale: number,
    opts: { spec?: SpecSpec; bump?: BaseTexture; bumpScale?: number } = {},
  ): ShaderMaterial {
    const { spec, bump } = opts;
    const cacheKey = `\0ground-${key}${spec ? "-spec" : ""}${bump ? "-bump" : ""}`;
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
            ...(bump ? ["bumpScale"] : []),
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
      this.cache.set(cacheKey, mat);
    }
    return mat;
  }

  /** Shared unlit emissive material (used for neon/glow/effect meshes). */
  getEmissive(hex: string): StandardMaterial {
    let mat = this.emissiveCache.get(hex);
    if (!mat) {
      mat = new StandardMaterial(`emissive-${hex}`, this.scene);
      mat.emissiveColor = Color3.FromHexString(hex);
      mat.diffuseColor = Color3.Black();
      mat.specularColor = Color3.Black();
      mat.disableLighting = true;
      // Unlit means unfogged, which at village scale means a lit window burning
      // through the fog wall at full saturation. The plugin has to go on before
      // anything draws with the material — hence here, not in setEnvironment.
      attachEmissiveFog(mat);
      this.emissiveCache.set(hex, mat);
    }
    return mat;
  }

  /** Applies a theme's lighting/atmosphere to every cel material. */
  setEnvironment(env: {
    lightDir: Vector3;
    lightColor: Color3;
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
  }): void {
    this.lightDir = env.lightDir.normalizeToNew();
    this.lightColor = env.lightColor;
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
    setOutlineFog(this.scene, fogState.color, fogState.start, fogState.end);
    // And the third pass that never runs the cel shader: the unlit emissive
    // materials behind every window, flame and tracer.
    setEmissiveFog(fogState.color, fogState.start, fogState.end);
    this.mistColor = env.mistColor;
    this.mistParams.set(env.mistHeight, env.mistStrength);
    // The ink's tint is DERIVED from the two light terms just stored, and it is
    // settled here — before the walk below, which is what pushes it onto every
    // CEL_INK material. See `inkState`: an unlit line over a lit surface is only
    // a line while it is the darker of the two, and what a map calls dark is the
    // map's own business.
    const o = CONFIG.graphics.outlines;
    const floor = darkestLight(this.ambientColor).scale(o.shadeHeadroom);
    // Per channel against its own ceiling, because both are a statement about
    // the same thing: the ink may be as dark as it likes and never brighter
    // than what it is drawn beside.
    const tint = new Color3(
      Math.min(o.tintFactor, floor.r),
      Math.min(o.tintFactor, floor.g),
      Math.min(o.tintFactor, floor.b),
    );
    // The flat ink is bounded the same way, and it is the same bug when it is
    // not: Hollowmere's road network is `cel-ground-*`, so it wears
    // `fallbackColor` — rgb(0.070, 0.078, 0.102) against a cobble that measures
    // (0.038, 0.054, 0.075) under the night ambient, a light line down every
    // street. What this cannot promise is what the tinted ink can: a fallback
    // has no albedo to scale, so it is bounded as if the surface were WHITE and
    // a dark enough texture can still out-dark it. That is the honest limit of
    // an ink for a material whose colour cannot be recovered, and it is why the
    // authored value stays the ceiling rather than being replaced.
    const fallbackCeil = Color3.FromHexString(o.fallbackColor);
    const fallback = new Color3(
      Math.min(fallbackCeil.r, floor.r),
      Math.min(fallbackCeil.g, floor.g),
      Math.min(fallbackCeil.b, floor.b),
    );
    if (!tint.equals(inkState.tint) || !fallback.equals(inkState.fallback)) {
      inkState.tint = tint;
      inkState.fallback = fallback;
      // Babylon's hull holds its colour per MESH and is never walked by the
      // cache below, so the half of the ink that is not a cel material is
      // re-inked here.
      reinkOutlines();
    }
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
  }

  updateCamera(camPos: Vector3): void {
    if (!camPos.equals(this.camPos)) {
      this.camPos.copyFrom(camPos);
      this.cache.forEach((mat) => this.applyCamera(mat));
    }
    // A bake that arrived before Babylon had dynamically imported the outline
    // shaders is still outstanding; this is where it lands. No-op otherwise.
    // Outside the guard: it is not about the camera, and a bake landing on a
    // frame the player happened to be standing still for would be dropped.
    refreshOutlineFog(this.scene);
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
   * shader (see `SHADOW_GLSL`).
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
    // CEL_INK materials only, and the SOURCE material's name is recovered from
    // this one's — `inkColorFor` needs the palette colour, and the ink material
    // is the only thing that still knows which one it was drawn for. The tint
    // it scales by is the environment's (see `inkState`), so it is re-derived
    // on every change exactly as the light terms above are, and this is already
    // the walk that runs on creation and on every change alike.
    if (mat.name.startsWith(INK_PREFIX)) {
      mat.setColor3("inkColor", inkColorFor(mat.name.slice(INK_PREFIX.length)));
    }
  }

  /** The eye the shader fogs and rims against. See `camPos` for why on create. */
  private applyCamera(mat: ShaderMaterial): void {
    mat.setVector3("camPos", this.camPos);
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
      return;
    }
    this.specs.set(mat, spec);
    mat.setColor3(
      "specColor",
      Color3.FromHexString(spec.color).scale(spec.intensity),
    );
    mat.setFloat("specShininess", Math.max(1, spec.shininess));
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
 * - The OUTLINE pass gets it baked into its shader by `OutlineFog`, and fades
 *   per PIXEL. It has to: `BlockMerge` gives one mesh per 48 m block, so a
 *   per-mesh ink fade left the far half of a block in clear ink over a wall
 *   that had already gone to fog (measured: 50 of 687 outlined meshes span the
 *   entire fog band).
 * - The GLOW layer gets it through `fogAmountAt`, and fades per MESH, because
 *   its bloom is generated from a material's emissive colour and there is no
 *   per-pixel hook at all. That is affordable where the outline's was not: a
 *   bloom is a soft blob with no edge to misplace.
 */
const fogState = { color: new Color3(0.05, 0.06, 0.08), start: 24, end: 78 };

/**
 * The working ink: how much of a mesh's own albedo its outline returns, PER
 * CHANNEL, plus the flat ink for the meshes that have no albedo to return.
 *
 * **`CONFIG.graphics.outlines.tintFactor` and `fallbackColor` are CEILINGS on
 * these two, not the values.** The ink is unlit — that is the whole of the
 * `CEL_INK` branch, and Babylon's outline fragment shader is
 * `gl_FragColor = color` and nothing else — while the surface under it is
 * `albedo * light`. So an ink is a line only while it sits UNDER that light
 * term, and inverts into a bright halo the moment the surface goes darker than
 * it does.
 *
 * That is not hypothetical, and it was not fixed by deriving the tint from the
 * shaded FLOOR, which is what this used to do: a scalar 0.6 of the luma of
 * `ambient + skyFill * 0.5` describes a vertical face in shadow that is fully
 * unoccluded, and three separate things in the frame are darker than that.
 * Measured by rendering each map twice from the menu's own vantage — once as
 * shipped and once with every outline and ink twin off — and asking how many of
 * the pixels the ink pass touched it made BRIGHTER: Hollowmere 47.8%, Greyfen
 * 40.6%, Coldharbour 38.3%, Harrowmead 45.7%. It was never one map's problem.
 * The three:
 *
 * - **Occlusion.** `vBaked.w` multiplies both ambient terms and the bake runs
 *   the full [0.45, 1] its strength allows, so the darkest a shaded face gets
 *   is `1 - CONFIG.ao.strength` of what the old reference assumed — and the
 *   places it reaches are creases, eaves and doorways, which is exactly where
 *   outlines are densest.
 * - **The sky fill is not there at all on an underside.**
 *   `band(0.5 + 0.5 * n.y, 3.0)` is 0 for `n.y <= -1/3`, so every soffit, sill
 *   and branch-bottom in the game receives the flat ambient and nothing else —
 *   the old reference credited it with half the fill.
 * - **A scalar tint against a coloured light.** The ink is `albedo * tint` per
 *   CHANNEL and the surface is `albedo * light` per channel, so one number
 *   compared against a LUMA inverts in whichever channel the map's ambient is
 *   weakest in. On Greyfen (a green ambient) that is the blue: the old tint
 *   0.099 sat above a blue ambient of 0.087 before occlusion was applied at
 *   all.
 *
 * So the ink is now the albedo under the darkest light the shader can actually
 * put on it — `ambient * (1 - ao.strength)`, per channel — and being under that
 * is a property of the arithmetic rather than of a headroom number being
 * generous enough. What it costs is brightness: the four maps' inks are 2.2x
 * to 2.9x darker than they were, which is the amount by which they were wrong.
 * What it keeps is the colour, and more of it than a scalar did — the ink now
 * carries the map's own ambient hue as well as the mesh's, so Hollowmere's
 * lines are blue where Greyfen's are green.
 *
 * `setEnvironment` is the only writer, so the ink and the light it is judged
 * against cannot describe different weather — the rule `fogState` above is
 * kept by, for the same reason.
 */
const inkState = {
  /** Per channel, because the light it has to stay under is coloured. */
  tint: new Color3(1, 1, 1).scale(CONFIG.graphics.outlines.tintFactor),
  /** The same, for the ink that has no albedo to scale — see `inkColorFor`. */
  fallback: Color3.FromHexString(CONFIG.graphics.outlines.fallbackColor),
};

/**
 * The darkest light the cel shader can put on a surface, per channel: the flat
 * ambient alone, at the occlusion bake's floor.
 *
 * Every other term is either absent here by construction or additive on top of
 * it. The key light is gated by the shadow map and this is the shadowed case;
 * the sky fill is gated by `band(0.5 + 0.5 * n.y, 3.0)`, which is exactly 0 on
 * anything facing down past -1/3 (keep the two in step if that band count ever
 * moves); the point lights, the rim and the specular all only add. So
 * `light >= ambient * ao >= ambient * (1 - strength)` holds for every pixel of
 * every cel-shaded mesh in the game, which is what makes an ink derived from it
 * a line rather than a halo — not a tuning that happens to hold.
 *
 * **The occlusion floor is a REAL floor and not a pessimistic one.** The bake's
 * alpha comes out across the whole [0.45, 1] the strength allows (see
 * `world/vertexShading.ts`), and a mesh with no colour buffer reads the
 * disabled attrib's 1 — so rigs, the viewmodel and every effect mesh are
 * brighter than this rather than darker, and their ink is safe for free.
 */
function darkestLight(ambient: Color3): Color3 {
  return ambient.scale(1 - CONFIG.ao.strength);
}

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
 * The ink hull's width in metres, matching what `MapBuilder` hands
 * `addOutline` for the same world geometry — 0.05, the world's line weight.
 *
 * Not in `CONFIG.graphics.outlines` beside the four numbers it is spent with,
 * because those four are about the FADE and this is the one thing the callers
 * of `addOutline` already state per call site (the viewmodel's is 0.004 and a
 * grenade's is 0.02). The swaying geometry is all world geometry, so there is
 * one value and it is that one.
 */
const INK_WIDTH = 0.05;

/**
 * The prefix `getInk` mints its materials under, and the one thing that makes
 * an ink material recognisable after the fact — `applyEnvironment` recovers the
 * SOURCE material's name from it to re-derive the tint on an environment
 * change, the same way `inkColorFor` recovers a palette colour from `cel-`.
 */
const INK_PREFIX = "cel-ink-";

const windBearing = new Vector2(
  CONFIG.wind.dir[0],
  CONFIG.wind.dir[1],
).normalize();

/**
 * How much of the fog colour a surface `dist` from the eye is buried under, on
 * the cel shader's own curve — the `t * t` in CEL_FRAGMENT's atmosphere block,
 * repeated here for the passes that cannot run that shader.
 *
 * **Anything drawn unshaded owes this curve**, through here or baked as
 * `OutlineFog` bakes it, or it hangs in front of the fog wall at full strength
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
 * Outlined meshes and the width they were authored at, so
 * updateOutlineScales() can thin the ink with distance. Entries for disposed
 * meshes (the map is rebuilt every round) are pruned lazily on the next pass.
 * The ink's own fade is NOT here — it is per pixel, in `OutlineFog`.
 */
const outlineEntries: { mesh: Mesh; width: number }[] = [];

/**
 * Ink for a mesh: a darkened take on its own cel colour, so outlines read as
 * coloured line work instead of a uniform black cut-out. The factory names
 * flat materials `cel-#rrggbb` (matte), `cel-gloss-#rrggbb` (specular) or
 * `cel-trans-#rrggbb` (translucent), which is how the colour is recovered
 * here; textured/skinned materials get the palette-neutral fallback ink.
 */
function outlineInkFor(mesh: Mesh): Color3 {
  return inkColorFor(mesh.material?.name ?? "");
}

/**
 * The same ink, resolved from a material NAME rather than from a mesh.
 *
 * Split out because the ink is now drawn two ways and both must arrive at the
 * same colour: Babylon's outline pass takes it per mesh through
 * `outlineInkFor`, and `getInk` takes it per material for the geometry that
 * sways — where Babylon's hull cannot follow. A second darkening rule would
 * put two different lines on one map.
 *
 * The tint it scales by is `inkState`'s, which is the MAP's rather than a
 * constant, so both readers owe a re-resolve on an environment change:
 * `reinkOutlines` for the hull, `applyEnvironment` for the cel materials.
 */
export function inkColorFor(materialName: string): Color3 {
  const m = /^cel-(?:gloss-|trans-)?(#(?:[0-9a-fA-F]{6}))$/.exec(materialName);
  if (m) {
    // Per channel: the ink is the albedo under the darkest light this map can
    // put on it, which is a colour and not a scale. See `inkState`.
    return Color3.FromHexString(m[1]).multiply(inkState.tint);
  }
  return inkState.fallback.clone();
}

/**
 * Enables bold outlines on a mesh and all of its children — coloured ink that
 * updateOutlineScales() thins with distance. Meshes tagged
 * `metadata.noOutline` (glows, holo reticles) are skipped.
 */
export function addOutline(mesh: Mesh, width = 0.045): void {
  const apply = (m: Mesh) => {
    if (m.metadata && m.metadata.noOutline === true) return;
    m.renderOutline = true;
    m.outlineColor = outlineInkFor(m);
    m.outlineWidth = width;
    outlineEntries.push({ mesh: m, width });
  };
  apply(mesh);
  for (const child of mesh.getChildMeshes()) {
    if (child instanceof Mesh) apply(child);
  }
}

/**
 * Re-inks every registered outline for a new tint. Called only from
 * `setEnvironment`, and only when the derived tint actually moved.
 *
 * **The outline REGISTRY is the right set here where it is the wrong one for
 * the fog.** `OutlineFog.dropCompiled` has to walk the whole scene because
 * `ViewModel` sets `renderOutline` by hand and never registers — but it does
 * not need to be reached from here at all, because the viewmodel inks itself
 * BLACK rather than from `inkColorFor`, so there is no derived tint of its to
 * be stale. What the registry does carry, and what makes this necessary rather
 * than tidy, is the POOLED bot rigs: built once and alive across every map
 * change, so a rig inked under Hollowmere would go on wearing that tint through
 * Greyfen's forest for the rest of the session.
 *
 * The map's own geometry is inked at build time and would be correct either
 * way, since `installMap` mints it after the environment is pushed. This does
 * not rely on that ordering, which is the point of doing it at all.
 */
function reinkOutlines(): void {
  for (let i = outlineEntries.length - 1; i >= 0; i--) {
    const e = outlineEntries[i];
    if (e.mesh.isDisposed()) {
      outlineEntries[i] = outlineEntries[outlineEntries.length - 1];
      outlineEntries.pop();
      continue;
    }
    e.mesh.outlineColor = outlineInkFor(e.mesh);
  }
}

/**
 * Re-scales every registered outline for the camera's current position: full
 * width up close, thinning to `outlines.minScale` at the fog wall, so distant
 * silhouettes stay shaped instead of filling in. Meshes whose outlines were
 * LOD-dropped (bots past `lodOutlineDistance` — `renderOutline` false) are
 * left alone; their authored width returns when the LOD flips them back on.
 * Called once per frame from Game.
 *
 * **Width only — the ink's colour is not this function's to fade.** Distance
 * here is per mesh (the bounding sphere's near point), which a width can live
 * with and a colour cannot: `BlockMerge` gives one mesh per 48 m block, so a
 * per-mesh ink fade leaves the far half of a block in clear ink over a wall
 * that has already gone to fog. That fade is per pixel, baked into the outline
 * shader by `OutlineFog`. Thinning is not a substitute for it either —
 * `minScale` still leaves a line, and a line of un-fogged ink is exactly as
 * visible as a thick one.
 */
export function updateOutlineScales(camPos: Vector3): void {
  const o = CONFIG.graphics.outlines;
  for (let i = outlineEntries.length - 1; i >= 0; i--) {
    const e = outlineEntries[i];
    if (e.mesh.isDisposed()) {
      outlineEntries[i] = outlineEntries[outlineEntries.length - 1];
      outlineEntries.pop();
      continue;
    }
    if (!e.mesh.renderOutline) continue;
    const sphere = e.mesh.getBoundingInfo().boundingSphere;
    const d = Math.max(
      0,
      Vector3.Distance(sphere.centerWorld, camPos) - sphere.radiusWorld,
    );
    const t = Math.min(
      1,
      Math.max(0, (d - o.fullDistance) / (o.farDistance - o.fullDistance)),
    );
    e.mesh.outlineWidth = e.width * (1 - t * (1 - o.minScale));
  }
}
