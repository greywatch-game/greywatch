/**
 * WaterShader.ts — Stylized water ShaderMaterial: an analytic wave field, a
 * Fresnel mirror over a depth-graded body colour, shoreline foam, cel banding.
 * Invariants: point-light uniform arrays are pre-allocated to MAX_POINT_LIGHTS
 * and filled by WaterSystem each frame from the same LightingSystem slots as
 * the cel shader. No vertex displacement; opaque output. No Babylon lights.
 * The wave field is SAMPLED FROM NOTHING — there is no normal map and there
 * must not be one again; see the header below for what a lattice cost here.
 * Both stages are hand-written WGSL, and `shaderLanguage` on the material is
 * load-bearing rather than declarative: a `ShaderMaterial` defaults to GLSL
 * and would look these up in a store nothing writes any more. This was the
 * LAST shader in the tree to be ported, so with it went the four GLSL
 * constants three shaders used to interpolate — see `wgsl/includes.ts`, which
 * now holds the only copy of each. See `docs/rendering.md` for what the
 * dialect and Babylon's WGSL processor decide.
 */
import {
  Scene,
  ShaderLanguage,
  ShaderMaterial,
  ShaderStore,
  Texture,
  Vector3,
  Vector4,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import {
  MAX_POINT_LIGHTS,
  PROBE_SAMPLER_NAMES,
  PROBE_UNIFORM_NAMES,
  SHADOW_SAMPLER_NAMES,
  SHADOW_UNIFORM_NAMES,
} from "./CelShader";
// The shared includes self-register in the IncludesShadersStoreWGSL; import
// them explicitly so the #include<cel...> lines below can never be tree-shaken
// away, and so registration is provably before the first effect COMPILE rather
// than merely before the first material.
import "./wgsl/includes";

/**
 * Water — the one smooth-shaded material in a faceted world, and the only
 * surface in the game whose colour is mostly somewhere else.
 *
 * ## What a water surface actually is
 *
 * **It is a mirror with a dark body under it, and the split between the two is
 * the view angle.** That one sentence is the whole shader, and getting it
 * wrong is what made every earlier version of this file read as painted
 * plastic: a body colour that is merely *tinted* toward a "sky sheen" at
 * grazing angles is a flat colour wherever you stand, because the Fresnel
 * saturates within a few degrees of the horizontal and a pond seen from its
 * own bank is never anything else. The fix is not a better tint. It is that
 * the grazing end of the Fresnel has to return a PICTURE.
 *
 * So the composite is, in order:
 *
 * - the **body**, which is `deepColor` graded toward `shallowColor` over a
 *   shoal and then toward the map's own floor colour in the last few
 *   centimetres, all off the baked bed-depth map, lit by the same banded key
 *   and ambient as the ground it sits in;
 * - the **mirror**, which is the analytic sky gradient with the light's glare
 *   in it, and then a picture of the world composited over that out of a cube
 *   `ReflectionSystem` bakes per body per map install — the same two-layer
 *   build and the same un-premultiply as the glazing, shared as the `celProbe`
 *   include rather than copied — but NOT its parallax correction, which is
 *   `celProbeBox` and which this surface must not have; see the fetch itself;
 * - **Schlick** between them, unbanded, at water's own `reflectance` — which
 *   is ~2% face-on and ~100% at the bank, and is therefore also what makes the
 *   near water dark and the far water bright without a single distance term;
 * - the **glint**, a hard-edged banded sparkle on the crests, which unlike the
 *   glare in the mirror does not arrive through the Fresnel;
 * - the **foam**, at the waterline the bed-depth map knows about;
 * - and the **atmosphere**, copied term for term from the cel shader so the
 *   waterline fades out exactly like the ground it laps against.
 *
 * ## The wave field is analytic, and that is a rule rather than a preference
 *
 * **There is no normal map, and adding one back would undo the reason this
 * file is short.** The surface was three scrolled, rotated, mutually-warped
 * layers of a tiling fBm normal map, and every one of those adjectives was a
 * defence against the same thing: a lattice sampled on a plane the size of a
 * valley is a lattice you can see. Rotating each layer off the world axes
 * hides the plaid, warping each by the one above it breaks the beat, fading
 * the fine layers out with distance hides the moire — three rules, a tuning
 * floor on the wave scales that existed purely as a sampling limit, and a
 * committed 512px PNG, all to make a repeating image not look like one. What
 * it looked like anyway was lichen: low-frequency cloudy mottling with no
 * direction in it, which is what fBm is and is not what water is.
 *
 * A sum of directional wave TRAINS has no lattice at all, so none of those
 * rules exist. What replaces them is `waveDetail`, which is not a tuning at
 * all but a sampling criterion: `fwidth(vPosW.xz)` is how many metres of world
 * this pixel covers, so a train whose wavelength is under a few pixels is
 * faded out because it cannot be drawn, at any resolution and any field of
 * view, without a number anybody has to keep in step with the scales.
 *
 * Three details in `waveField` are load-bearing:
 *
 * 1. **`exp(sin(x) - 1)` rather than `sin(x)`.** A sine is as round in the
 *    trough as it is at the crest, and water is not: it piles into a narrow
 *    crest and lies flat between. The exponential is the cheapest function
 *    with that asymmetry, it stays inside 0..1 with no clamp, and its
 *    derivative is itself times `cos`, so the slope costs a multiply rather
 *    than a second transcendental.
 * 2. **Each train is dragged by the phase of the one above it** (`waveDrag`).
 *    Six sine waves crossed at fixed bearings still beat against each other on
 *    a period you can see; feeding the previous train's height into the next
 *    one's phase is what actually destroys the repeat, and it is one madd.
 *    Same idea as the old warp, applied to something that has no tile to warp.
 * 3. **The trains disperse.** `speed *= sqrt(lacunarity)` is deep-water
 *    dispersion — phase speed goes as the square root of wavelength — so the
 *    ripples crawl while the swell rolls. Give every train the same speed and
 *    the whole field slides across the pond as one sheet, which is the single
 *    most obvious "this is a scrolling texture" tell there is.
 *
 * **The bearings are spread by the golden angle and NOT evenly.** Six evenly
 * spaced trains are a hexagonal lattice by another name — the thing the whole
 * rewrite exists to be rid of.
 *
 * ## Why a flat far field is right now and was wrong before
 *
 * The old shader would not let the surface flatten with distance: it faded the
 * fine layers but never the swell, because a flat surface has one specular
 * answer across its whole area and that arrives as a hard white sheet. That
 * was true of a shader with no reflection in it. With one, a distant water
 * surface that flattens toward a mirror returns the sky and the far bank,
 * which is exactly what a lake does — so the trains here fade against the
 * FULL amplitude rather than being renormalised over the survivors, and the
 * far field is allowed to go calm. What stops the glint from sheeting is that
 * it is a function of the same slope, and the slope is what went away.
 *
 * Output is opaque and display-ready (`imageProcessingEnabled` stays false).
 */

ShaderStore.ShadersStoreWGSL["waterVertexShader"] = `
attribute position: vec3f;

uniform world: mat4x4f;
uniform viewProjection: mat4x4f;

varying vPosW: vec3f;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  let worldPos = uniforms.world * vec4f(vertexInputs.position, 1.0);
  vertexOutputs.vPosW = worldPos.xyz;
  vertexOutputs.position = uniforms.viewProjection * worldPos;
}
`;

// The derivatives are what was MEANT — `fwidth(vPosW.xz)` IS the sampling
// criterion the whole wave field rests on, and band()'s width is how fast its
// index moves per pixel — so there is no explicit-LOD form to reach for the way
// a texture fetch has one, and WGSL's uniformity analysis has to be told. Of
// the fetches below only the cube's LOD is explicit — its level IS the
// unresolved chop — so the define covers the derivatives, the bed depth and the
// foam mask, which all wanted the hardware's own LOD. (celShadow's four taps
// are explicit and need nothing.)
ShaderStore.ShadersStoreWGSL["waterFragmentShader"] = `
#define DISABLE_UNIFORMITY_ANALYSIS

varying vPosW: vec3f;

var foamTexSampler: sampler;
var foamTex: texture_2d<f32>;
var depthTexSampler: sampler;
var depthTex: texture_2d<f32>; // r = bed depth / depthMax, over "bounds"
uniform time: f32;
uniform camPos: vec3f;

uniform lightDir: vec3f;
uniform lightColor: vec3f;
uniform ambientColor: vec3f;
// The hemispheric fill from the sky itself, the same term the cel shader gives
// the ground by n.y. Water is the most up-facing surface on any map, so it
// takes essentially all of it — and leaving it out was what made a pond read
// as a hole in a lit field: every bank around it had a sky on it and the water
// did not.
uniform skyLightColor: vec3f;
uniform fogColor: vec3f;
uniform fogParams: vec2f;  // x = start, y = end
uniform mistColor: vec3f;
uniform mistParams: vec2f; // x = height falloff, y = strength
// The top of the sky dome, as the mirror returns it. The HORIZON end of the
// same gradient is fogColor, which is already here — the identical pairing the
// glazing makes, and the same reason SkySpec.horizonColor is asked to sit
// close to the fog.
uniform skyZenithColor: vec3f;
// The bright band about twelve degrees up, which on a day map is most of what
// a horizontal mirror returns. Same value SkySpec.horizonColor gives the dome.
uniform skyHorizonColor: vec3f;

uniform deepColor: vec3f;
uniform shallowColor: vec3f;
uniform bedColor: vec3f;
uniform foamColor: vec3f;
uniform bounds: vec4f;   // minX, minZ, maxX, maxZ — the rect, for the seam band

// --- the wave field (see waveField below) ---
uniform waveHeight: f32;     // metres, crest to trough of the whole sum
uniform waveLength: f32;     // metres, the longest train
uniform waveSpeed: f32;      // metres per second, the longest train
uniform waveGain: f32;       // amplitude ratio between successive trains
uniform waveLacunarity: f32; // frequency ratio between successive trains
uniform waveBearing: f32;    // radians — where the swell runs
uniform waveDrag: f32;       // how far a train is dragged by the one above it
uniform waveDetail: f32;     // pixels per wavelength a train needs to survive

// --- the mirror ---
uniform reflectance: f32;    // Fresnel face-on. Water is about 0.02
uniform fresnelPower: f32;   // Schlick is 5. Lower brings the sheen on sooner
uniform sunHalo: f32;        // cosine half-width of the light's glare in it
uniform specPower: f32;      // Blinn exponent of the crest glint
uniform specStrength: f32;
uniform mirrorBlur: f32;     // mip levels the unresolved chop blurs it by

// --- the bed ---
uniform depthMax: f32;   // metres the depth byte saturates at
uniform depthFade: f32;  // metres over which the body reaches deepColor
uniform bedDepth: f32;   // metres over which the bed stops showing through
uniform bedShow: f32;    // how much of the bed shows at zero depth
uniform caustics: f32;   // crest-focused light on a shoal

// --- the shore ---
uniform foamWidth: f32;
uniform foamScale: f32;
uniform foamSpeed: f32;
uniform foamDepth: f32;  // depth (m) at which the shoreline foam has gone
uniform foamLap: f32;    // metres the waterline breathes with the swell
uniform crestFoam: f32;  // whitecaps over a shoal
uniform fleckStrength: f32; // scum drifting out on the open water

uniform pointPos: array<vec3f, ${MAX_POINT_LIGHTS}>;
uniform pointColor: array<vec3f, ${MAX_POINT_LIGHTS}>; // rgb premultiplied by intensity
uniform pointRange: array<f32, ${MAX_POINT_LIGHTS}>;
uniform pointCount: f32;

// Both counts reach the declarations above by INTERPOLATION and the loop bounds
// below as real consts, and the split is forced rather than stylistic: a
// uniform array's size must be a literal or a #define, because Babylon resolves
// the bound out of the preprocessor table when it lays out the leftover UBO and
// a WGSL const is not in that table — while a #define is the worse of the two,
// since the processor implements one as an un-anchored regex over the whole
// source. GrassShader settled this; see docs/rendering.md.
const MAX_POINT_LIGHTS: i32 = ${MAX_POINT_LIGHTS};
const WAVE_TRAINS: i32 = ${CONFIG.water.waveTrains};
const TAU: f32 = 6.2831853;

#include<celBand>
#include<celShadow>
#include<celProbe>
#include<celDither>

// Rotates a uv about the origin. The foam mask is the one tiled image left in
// this shader, and it goes through this for the reason every layer used to: a
// lattice sampled straight off world X/Z is parallel to the plane's own edges,
// and that is what reads as "the pattern".
fn swirl(p: vec2f, c: f32, s: f32) -> vec2f {
  return vec2f(p.x * c - p.y * s, p.x * s + p.y * c);
}

// What waveField returns, and it is a struct for a dialect reason rather than a
// design one: the GLSL wrote its second and third answers through \`out\`
// parameters, and WGSL has no \`out\` — the nearest thing is a pointer argument,
// which is a worse read here than naming the three things the surface IS.
struct Surface {
  height: f32,   // 0..1, the crest term
  slope: vec2f,  // d(height)/d(world metre), per axis, at unit height
  resolved: f32, // how much of the full amplitude survived the pixel test
}

/**
 * The surface, summed from WAVE_TRAINS directional wave trains.
 *
 * The height is 0..1 and the slope is per world metre at unit height. Both are
 * normalised against the FULL amplitude rather than the visible one, so a train
 * dropped for being finer than a pixel takes its share of the relief with it
 * and the far field goes calm — see the header on why that is right here and
 * was wrong before.
 *
 * \'footprint\' is how many metres of world this pixel covers.
 */
fn waveField(p: vec2f, footprint: f32) -> Surface {
  var field: Surface;
  field.slope = vec2f(0.0);
  var height = 0.0;
  var amp = 1.0;
  var total = 0.0;
  var freq = TAU / max(uniforms.waveLength, 0.05);
  var omega = uniforms.waveSpeed * freq;
  var ang = uniforms.waveBearing;
  var carry = 0.0;
  var drawn = 0.0;
  for (var i = 0; i < WAVE_TRAINS; i++) {
    let dir = vec2f(cos(ang), sin(ang));
    // Detail 2: dragged by the train above, which is what has no period.
    let x = dot(dir, p) * freq + uniforms.time * omega + carry * uniforms.waveDrag;
    let s = sin(x);
    // Detail 1: sharp crests, flat troughs, and its own derivative.
    let h = exp(s - 1.0);
    // A train narrower than the pixel it is drawn in is not detail, it is
    // aliasing. fwidth() is what makes this a sampling test rather than a
    // tuning: it holds at any resolution and any field of view.
    let vis = smoothstep(1.0, uniforms.waveDetail, (TAU / freq) / max(footprint, 1e-4));
    height += h * amp * vis;
    drawn += amp * vis;
    field.slope += dir * (h * cos(x) * freq) * amp * vis;
    carry = h;
    total += amp;
    amp *= uniforms.waveGain;
    freq *= uniforms.waveLacunarity;
    // Detail 3: deep-water dispersion. Short waves are slow waves.
    omega *= sqrt(uniforms.waveLacunarity);
    // The golden angle. Evenly spaced bearings are a lattice again.
    ang += 2.3999632;
  }
  let inv = 1.0 / max(total, 1e-4);
  field.slope *= inv;
  field.resolved = drawn * inv;
  field.height = height * inv;
  return field;
}

/**
 * The map's own sky, at an elevation, and it is the SAME gradient 'Sky'
 * paints onto the dome — the four stops down to the horizon, read off
 * 'paintDomeTexture'.
 *
 * **A two-colour lerp is what a mirror this big cannot use, and that was the
 * single reason the water read as wet concrete.** The glazing gets away with
 * 'mix(fogColor, zenith, ...)' because a pane is a few square metres of a
 * frame and its Fresnel is weak; a pond is a third of the screen and its
 * Fresnel is 1 at every angle a player looks at it from, so whatever this
 * function returns IS the water. A sunset sky is not a gradient between two
 * colours — it is a warm band sitting about twelve degrees up with a cooler
 * zenith over it — and the band is precisely the part a horizontal surface
 * returns.
 *
 * Sampled by 'dir.y' rather than by the elevation angle, which is what the
 * dome's own 'v = acos(y) / PI' comes to; only the upper half is ever asked
 * for, because the mirrored ray is clamped above the horizon before it gets
 * here.
 */
fn domeAt(y: f32) -> vec3f {
  let v = acos(clamp(y, -1.0, 1.0)) * 0.3183099; // /PI: 0 zenith, 0.5 horizon
  let mid = mix(uniforms.skyZenithColor, uniforms.skyHorizonColor, 0.5);
  if (v < 0.28) { return mix(uniforms.skyZenithColor, mid, v / 0.28); }
  if (v < 0.43) { return mix(mid, uniforms.skyHorizonColor, (v - 0.28) / 0.15); }
  return mix(uniforms.skyHorizonColor,
    mix(uniforms.skyHorizonColor, uniforms.fogColor, 0.6),
    (v - 0.43) / 0.07);
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let posW = fragmentInputs.vPosW;
  let viewDist = length(posW - uniforms.camPos);
  let viewDir = normalize(uniforms.camPos - posW);
  // How much world one pixel covers. The whole distance story is told here.
  let fw = fwidth(posW.xz);
  let footprint = max(max(fw.x, fw.y), 1e-4);

  // --- bed depth, off the baked map (metres) ---
  let duv = (posW.xz - uniforms.bounds.xy)
    / max(uniforms.bounds.zw - uniforms.bounds.xy, vec2f(0.001));
  // **textureSample and NOT textureSampleLevel, and the reason is not the mip
  // chain — there is not one.** An explicit LOD turns ANISOTROPY off, and this
  // sampler has it on: WaterSystem.bakeDepth builds the bed map
  // BILINEAR_SAMPLINGMODE, and Babylon's WebGPU sampler cache enables
  // anisotropy for that mode whether or not the texture carries mips
  // (useMipMaps || samplingMode === 2, then maxAnisotropy from the texture's
  // default 4). So an explicit level 0 is a SINGLE bilinear tap where the GLSL
  // got an anisotropic one, which changes 'depth' in the last bits —
  // invisible everywhere except at the shoreline, where 'foamBand' is a
  // 1.2 m smoothstep seen edge-on and therefore about one pixel wide. Measured
  // against this shader's own GLSL original on Harrowmead's millpond: an
  // explicit level 0 moved 911 pixels along the far shore by up to 28/255, and
  // flattening that one threshold took the whole difference to zero. See
  // docs/rendering.md for the rule this sharpened.
  let depth = textureSample(depthTex, depthTexSampler, duv).r * uniforms.depthMax;
  // Beer-Lambert rather than a ramp, and the difference is not subtle on a
  // lumpy bed: a linear fade that CLAMPS draws the depth map own contour line
  // across the water wherever the bed crosses it, and a flood meadow is
  // nothing but scattered pockets a few centimetres either side of one. An
  // exponential is what absorption actually is, it has no knee anywhere, and
  // it never quite reaches the deep colour — which is also true of water.
  let shoal = exp(-depth / max(uniforms.depthFade, 0.001));

  // --- the surface ---
  let surf = waveField(posW.xz, footprint);
  let crest = surf.height;
  // A shoal is a little calmer than a channel, and only a little: the reason
  // is no longer that a flat patch glints as a sheet (it returns the sky now)
  // but that a hard edge in the relief would draw the depth map's own contour
  // across open water.
  let relief = uniforms.waveHeight * mix(0.8, 1.0, 1.0 - shoal);
  // y = h(x, z) has normal (-dh/dx, 1, -dh/dz).
  let n = normalize(vec3f(-surf.slope.x * relief, 1.0, -surf.slope.y * relief));

  // --- the key light over the body colour ---
  // Gated by the same shadow map as the bank it laps against — a mill standing
  // in the sun has to lay its shadow ON the water, not stop at the waterline.
  //
  // The offset normal is the FLAT up-vector, not n. Every wave here is a
  // fiction over a plane that never moves, so offsetting the shadow sample
  // along the swell would slide the shadow's edge back and forth with the
  // chop — the water's version of the bump-map problem the cel shader solves
  // by offsetting along the facet rather than the perturbed normal.
  let shade = shadowVisibility(vec3f(0.0, 1.0, 0.0), posW);
  let light = uniforms.ambientColor
    + uniforms.skyLightColor * band(0.5 + 0.5 * n.y, 3.0)
    + uniforms.lightColor * band(max(dot(n, -uniforms.lightDir), 0.0), 3.0) * shade;

  // The body: deep water, paling over a shoal, and then the bed itself in the
  // last few centimetres. \'bedColor\' is the MAP's own floor colour, so a
  // waterline grades into the bank it is cut in rather than stopping dead on
  // a colour this file chose.
  var body = mix(uniforms.deepColor, uniforms.shallowColor, shoal);
  let through = exp(-depth / max(uniforms.bedDepth, 0.001)) * uniforms.bedShow;
  body = mix(body, uniforms.bedColor, through);
  var col = body * light;

  // Light focused by the crests onto a shallow bed. Not a caustic simulation —
  // that wants the height field's curvature — but the crests are where the
  // focusing happens and this is the term that makes a shoal move.
  col += uniforms.lightColor * uniforms.caustics
    * smoothstep(0.35, 0.8, crest) * shoal * shade;

  // --- the mirror ---
  let bounced = reflect(-viewDir, n);
  // A ripple steep enough to aim the ray under the horizon is a ripple this
  // surface does not have: the relief is centimetres and the plane is flat, so
  // a downward ray is the interpolated normal at a grazing pixel rather than
  // anything real, and what it samples is the underside of the map.
  let mirrored = normalize(vec3f(bounced.x, max(bounced.y, 0.02), bounced.z));
  var sky = domeAt(mirrored.y);
  // The light's own glare, broad rather than a disc — what a low sun puts on
  // water is a smeared reach of light between you and it, not a second sun.
  // The hard sparkle is the glint below, which is a picture of the CRESTS.
  sky += uniforms.lightColor
    * smoothstep(uniforms.sunHalo, 1.0, dot(mirrored, -uniforms.lightDir)) * shade;
  // And the world: the far bank, the tree line, the roofs behind it.
  //
  // **Sampled along the raw mirrored ray, with NO parallax correction, and
  // that is the opposite of what the glazing does.** A pane is vertical and a
  // player walks ALONG it, so what a pane reflects is the building across the
  // street at a bearing that swings as you move — the correction is the whole
  // feature there. Water is horizontal and the probe stands ON it, so the
  // reflected ray leaves at a few degrees of elevation and what it can reach
  // is the far surround: the ridge, the wood, the roofline. Those are far
  // enough that an infinite-distance cube is very nearly right, and correcting
  // them against a box the size of the map is actively wrong — a ray at eight
  // degrees crosses two hundred metres before it clears the roofline, so every
  // pixel gets re-aimed at the same far exit point and the whole reflection
  // collapses to one colour. That was measured, on Harrowmead, and it is why
  // the water reads the cube the way a skybox is read. It is also why this
  // shader includes celProbe and NOT celProbeBox, and carries neither of that
  // include's two uniforms.
  //
  // What a cube from a point genuinely cannot give is the reflection of
  // something CLOSE and tall — the mill on the far bank lands at the elevation
  // it subtends from the probe rather than from the pixel. Nothing short of a
  // per-frame planar pass can, and the ripples cover most of it.
  //
  // Un-premultiplied by hand, exactly as the glazing does it: the bake clears
  // to a transparent black, so a texel on a silhouette carries a fraction of
  // the colour AND a fraction of the alpha, and mixing toward that colour
  // directly draws a dark seam around every roofline in the reflection.
  //
  // **The LOD is the unresolved half of the wave field**, which is the one
  // number in this shader that has to be an explicit level rather than the
  // hardware's own: a cube direction's screen-space derivative across a
  // grazing water pixel is enormous, so the automatic choice is the bottom of
  // the mip chain and every sample comes back as the cube's average colour —
  // a flat wash, on every map, at every angle. Driving it from 'resolved'
  // instead says the physical thing: ripples too fine to draw are roughness,
  // and roughness blurs a reflection. This is the fetch the cel shader's
  // glazing does NOT make explicit, and the two are right for the same reason:
  // an implicit LOD is correct exactly when the hardware's own derivative is
  // the filtering you wanted.
  let cube = textureSampleLevel(reflectionCube, reflectionCubeSampler,
    probeCubeDir(mirrored), (1.0 - surf.resolved) * uniforms.mirrorBlur);
  let mirror = mix(sky, cube.rgb / max(cube.a, 0.001),
    cube.a * uniforms.reflectProbe.w);

  // Schlick, and deliberately NOT banded — the same call the glazing makes.
  // A band edge here would be a contour drawn across the pond where the view
  // angle crosses a step, sliding over the surface as the player walks.
  let fres = uniforms.reflectance + (1.0 - uniforms.reflectance)
    * pow(1.0 - max(dot(viewDir, n), 0.0), uniforms.fresnelPower);
  col = mix(col, mirror, fres);

  // --- the glint: a hard-edged banded sparkle on the crests ---
  // Scaled by the map's own WaterEnvSpec.glint, and a different thing from the
  // halo above: the halo is a picture of the SOURCE and arrives through the
  // Fresnel, while this is a picture of the CRESTS and does not — a wave tips
  // a facet at the light wherever it is standing, including straight down into
  // still water where the mirror returns almost nothing. Both land before the
  // soft shoulder below, which is what keeps a lit sheet of water under the
  // luminance a map's light shafts occlude against.
  let halfway = normalize(-uniforms.lightDir + viewDir);
  let spec = pow(max(dot(n, halfway), 0.0), uniforms.specPower);
  col += uniforms.lightColor * uniforms.specStrength
    * smoothstep(0.25, 0.6, spec) * shade;

  // --- point lights: a little diffuse lift, mostly glints ---
  for (var i = 0; i < MAX_POINT_LIGHTS; i++) {
    if (f32(i) < uniforms.pointCount) {
      let toLight = uniforms.pointPos[i] - posW;
      let dist = length(toLight);
      var atten = clamp(1.0 - dist / max(uniforms.pointRange[i], 0.001), 0.0, 1.0);
      atten *= atten;
      let ldir = toLight / max(dist, 0.001);
      let lndl = max(dot(n, ldir), 0.0);
      let lh = normalize(ldir + viewDir);
      let lspec = pow(max(dot(n, lh), 0.0), uniforms.specPower * 0.6);
      col += uniforms.pointColor[i] * atten
        * (body * lndl * 0.5 + smoothstep(0.2, 0.55, lspec) * 0.9);
    }
  }

  // Same soft shoulder as the cel shader, so stacked lights stay tinted.
  let over = max(col - 0.75, vec3f(0.0));
  col = min(col, vec3f(0.75)) + 0.25 * over / (1.0 + over);

  // --- shoreline foam: the nearer of the rect's edge and the real waterline ---
  let edge = min(posW.xz - uniforms.bounds.xy, uniforms.bounds.zw - posW.xz);
  // The bed's depth expressed in the same metres the band is measured in, so
  // one width tunable covers both. A rect that ends in open water still foams.
  let shore = min(
    min(edge.x, edge.y),
    depth * (uniforms.foamWidth / max(uniforms.foamDepth, 0.001)));
  // The waterline breathes with the swell rather than on a clock of its own:
  // the foam then runs up the bank where a crest arrives and drains where one
  // has just left, which is what makes a still band read as lapping.
  let waterline = shore - (crest - 0.3) * uniforms.foamLap;
  let foamBand = 1.0 - smoothstep(0.0, uniforms.foamWidth, waterline);
  // Two takes of the mask at different scales and angles, because one is a
  // 3 m tile and a shoreline is longer than that.
  //
  // textureSample and not textureSampleLevel, on all three fetches: the mask is
  // a plain Texture and carries a mip chain, so the implicit LOD is the
  // trilinear filtering the tiled lattice needs at range and IS what was meant.
  let drift = vec2f(uniforms.time * uniforms.foamSpeed);
  let mask = textureSample(foamTex, foamTexSampler,
    swirl(posW.xz, 0.8020, -0.5972) * uniforms.foamScale + drift).r * 0.65
    + textureSample(foamTex, foamTexSampler,
      swirl(posW.xz, -0.1455, 0.9894) * uniforms.foamScale * 2.3 - drift * 0.6).r * 0.45;
  // The mask has to survive being inside the band, not just be biased over the
  // line by it: a mudflat is metres of near-zero depth, and a band that goes
  // solid the moment it is full paints the whole flat white.
  let foam = smoothstep(0.30, 0.85, mask + foamBand * 0.35) * foamBand;
  // Whitecaps: the crests breaking where the bed comes up under them.
  let caps = smoothstep(0.62, 0.95, crest) * shoal * uniforms.crestFoam;
  // Sparse flecks drifting out in the open water, on their own angle again.
  // Kept OUT of the band rather than added to it: at the shore the mask is
  // already deciding the foam, and a second copy of the same texture at a
  // different scale over the top of it is what turns a lip into a scum.
  let flecks = smoothstep(0.82, 0.97, textureSample(foamTex, foamTexSampler,
    swirl(posW.xz, -0.9284, -0.3717) * uniforms.foamScale * 0.6 - drift * 0.7).r)
    * uniforms.fleckStrength * (1.0 - foamBand);
  // Never all the way to the foam colour: a shoal broad enough to foam across
  // its whole width goes solid white at 1.0 and reads as snow, not froth.
  col = mix(col, uniforms.foamColor * light,
    clamp(foam * 0.85 + caps + flecks, 0.0, 1.0));

  // --- atmosphere: identical to the cel shader ---
  let mist = uniforms.mistParams.y
    * exp(-max(posW.y, 0.0) / max(uniforms.mistParams.x, 0.001))
    * clamp((viewDist - 6.0) / 45.0, 0.0, 1.0);
  col = mix(col, uniforms.mistColor, clamp(mist, 0.0, 0.9));
  let fog = clamp(
    (viewDist - uniforms.fogParams.x)
      / (uniforms.fogParams.y - uniforms.fogParams.x), 0.0, 1.0);
  col = mix(col, uniforms.fogColor, fog * fog);

  // Last thing before the write, because the write is the quantiser.
  fragmentOutputs.color = vec4f(dither(col), 1.0);
}
`;

/** Uniforms the WaterSystem pushes per frame / per round. */
const WATER_UNIFORMS = [
  "world",
  "viewProjection",
  "time",
  "camPos",
  "lightDir",
  "lightColor",
  "ambientColor",
  "skyLightColor",
  "fogColor",
  "fogParams",
  "mistColor",
  "mistParams",
  "skyZenithColor",
  "skyHorizonColor",
  "deepColor",
  "shallowColor",
  "bedColor",
  "foamColor",
  "bounds",
  "waveHeight",
  "waveLength",
  "waveSpeed",
  "waveGain",
  "waveLacunarity",
  "waveBearing",
  "waveDrag",
  "waveDetail",
  "reflectance",
  "fresnelPower",
  "sunHalo",
  "specPower",
  "specStrength",
  "mirrorBlur",
  "depthMax",
  "depthFade",
  "bedDepth",
  "bedShow",
  "caustics",
  "foamWidth",
  "foamScale",
  "foamSpeed",
  "foamDepth",
  "foamLap",
  "crestFoam",
  "fleckStrength",
  "pointPos",
  "pointColor",
  "pointRange",
  "pointCount",
];

/**
 * One water material per body (each carries its own shoreline `bounds`, its own
 * baked bed-depth map and its own reflection probe). Motion and shape come
 * straight from `CONFIG.water`; palette, lighting and the mirror are set by the
 * WaterSystem from the map's environment and from `ReflectionSystem`.
 *
 * Every uniform the fragment shader reads is written here or by the system —
 * `foamParams` was once declared, read and never uploaded, which silently
 * zeroed `foamWidth`/`foamScale`/`foamSpeed` and left `smoothstep(0.0, 0.0, x)`
 * to decide the shoreline. There was no foam on any map. **Add a uniform to the
 * shader and it owes a line here and a name in `WATER_UNIFORMS`.**
 *
 * `reflectionCube` is the one exception and it is deliberate: it is bound by
 * `WaterSystem.build` from the probe the reflection callback hands back inside
 * the same call, so a material never exists for a frame without one — and
 * under WebGPU that stops being a tidiness argument and becomes the binding
 * rule: **a sampler a material DECLARES has to be BOUND, used or not**, or the
 * bind group fails to build and every draw with it is lost.
 */
export function createWaterMaterial(
  scene: Scene,
  name: string,
  textures: { foam: Texture; depth: Texture },
  bounds: Vector4,
): ShaderMaterial {
  const mat = new ShaderMaterial(
    name,
    scene,
    { vertex: "water", fragment: "water" },
    {
      attributes: ["position"],
      uniforms: [
        ...WATER_UNIFORMS,
        ...SHADOW_UNIFORM_NAMES,
        ...PROBE_UNIFORM_NAMES,
      ],
      samplers: [
        "foamTex",
        "depthTex",
        ...SHADOW_SAMPLER_NAMES,
        ...PROBE_SAMPLER_NAMES,
      ],
      shaderLanguage: ShaderLanguage.WGSL,
    },
  );
  const w = CONFIG.water;
  mat.setTexture("foamTex", textures.foam);
  mat.setTexture("depthTex", textures.depth);
  mat.setVector4("bounds", bounds);
  mat.setFloat("waveHeight", w.waveHeight);
  mat.setFloat("waveLength", w.waveLength);
  mat.setFloat("waveSpeed", w.waveSpeed);
  mat.setFloat("waveGain", w.waveGain);
  mat.setFloat("waveLacunarity", w.waveLacunarity);
  mat.setFloat("waveBearing", w.waveBearing);
  mat.setFloat("waveDrag", w.waveDrag);
  mat.setFloat("waveDetail", w.waveDetail);
  mat.setFloat("reflectance", w.reflectance);
  mat.setFloat("fresnelPower", w.fresnelPower);
  mat.setFloat("sunHalo", w.sunHalo);
  mat.setFloat("specPower", w.specPower);
  mat.setFloat("mirrorBlur", w.mirrorBlur);
  mat.setFloat("depthMax", w.depthMax);
  mat.setFloat("depthFade", w.depthFade);
  mat.setFloat("bedDepth", w.bedDepth);
  mat.setFloat("bedShow", w.bedShow);
  mat.setFloat("caustics", w.caustics);
  mat.setFloat("foamWidth", w.foamWidth);
  mat.setFloat("foamScale", w.foamScale);
  mat.setFloat("foamSpeed", w.foamSpeed);
  mat.setFloat("foamDepth", w.foamDepth);
  mat.setFloat("foamLap", w.foamLap);
  mat.setFloat("crestFoam", w.crestFoam);
  mat.setFloat("fleckStrength", w.fleckStrength);
  mat.setFloat("time", 0);
  mat.setVector3("camPos", Vector3.Zero());
  mat.setArray3("pointPos", new Array(MAX_POINT_LIGHTS * 3).fill(0));
  mat.setArray3("pointColor", new Array(MAX_POINT_LIGHTS * 3).fill(0));
  mat.setFloats("pointRange", new Array(MAX_POINT_LIGHTS).fill(0));
  mat.setFloat("pointCount", 0);
  return mat;
}
