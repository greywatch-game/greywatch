/**
 * wgsl/includes.ts — The shader text every surface in the game shares, as
 * Babylon WGSL includes.
 * Owns: the registration of `celBand`, `celCloud`, `celShadow`, `celGi`, `celProbe`,
 * `celProbeBox`, `celDither` and the two `celInstances` entries into
 * `ShaderStore.IncludesShadersStoreWGSL`, and — for each of them — the
 * argument the GLSL original carried.
 * Invariants: every entry is prefixed `cel`; nothing here declares a uniform
 * or a sampler its consumer does not also list; registration happens at import
 * and must therefore precede the first effect COMPILE, not merely the first
 * material.
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
import { CONFIG } from "../../config";
import { DITHER_WGSL } from "../Dither";

/**
 * `CONFIG.graphics.shadows.edgeFade`, interpolated into `celShadow` below as a
 * WGSL literal rather than reaching the shader as a uniform.
 *
 * **`shadowParams` is a vec4 with all four slots spoken for** (bias, darkness,
 * normal offset, tap radius), and widening it is not the small change it
 * looks like: three consumers list those uniforms by name and the WebGPU
 * `LeftOver` UBO is built from those lists, which is the layout hazard the
 * header above exists to describe. This number never varies — not per map,
 * not per frame, not per material — so a compile-time literal is what it
 * actually is, and it costs no binding at all.
 *
 * Clamped away from 0 because it is `smoothstep`’s far edge and the two edges
 * may not be equal, and emitted through `toFixed` because WGSL is typed and a
 * whole number would reach the shader as an integer literal. See the config
 * field for why the floor reads as no ramp.
 */
const EDGE_FADE = Math.max(CONFIG.graphics.shadows.edgeFade, 1e-4);

/**
 * The length of `celShadow`'s per-slot lamp arrays, which index the same
 * slots as every consumer's `pointPos`. It is `MAX_POINT_LIGHTS` and cannot
 * import it — `CelShader` imports this module — so `CelShader` asserts the two
 * agree at load instead of trusting a comment.
 */
export const MAX_LOCAL_SLOTS = 16;

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
 * The hard-band quantizer, shared verbatim by every surface shader in the game.
 *
 * It was three identical copies — cel, grass and water — which was harmless
 * only because nobody had ever changed it. `celShadow` below is the one that
 * made sharing necessary rather than tidy, and the two travel together: a band
 * function that disagreed between the three would put a different terminator on
 * a wall, the grass in front of it and the water beside it.
 *
 * **A consumer owes `#define DISABLE_UNIFORMITY_ANALYSIS`.** `fwidth` is a
 * derivative, and WGSL's uniformity analysis rejects a derivative reached
 * through control flow it cannot prove uniform — which is what a point-light
 * loop is. There is nothing else to say here: a derivative IS what was meant,
 * so unlike a texture fetch there is no explicit-LOD form to reach for
 * instead.
 */
register(
  "celBand",
  `
// Quantizes a 0..1 diffuse term into hard bands, smoothstepping across each
// edge so the terminator reads as a hard line without aliasing.
//
// **The transition is at least one PIXEL wide, and the fixed 0.15 it used to be
// is only the floor.** A band edge is a hard edge with no geometry behind it,
// so nothing in the pipe antialiases it: FXAA works on luminance contrast and
// these are low-contrast interior edges, and there is no MSAA (the only thing
// drawn to the default framebuffer is FXAA's own quad). That was harmless while
// the normal driving ndl was a facet normal — a wall's band index moves a
// thousandth of a band per pixel and one edge crosses the whole face. It stops
// being harmless the moment a BUMP map drives it: the relief puts a terminator
// around every grain, thousands of them per screen, each one aliasing on its
// own. Measured against a 4x supersampled reference of the same frame, the
// valley floor's near ground went from 1.8% of pixels off-reference to 10.3%
// when it gained a height map — and the whole of that difference was here.
//
// fwidth(x) is how fast the band index moves per pixel, so widening the
// smoothstep to it makes the edge exactly resolvable and no wider. Where the
// index moves slowly — every wall, roof and flat face in the game — it is below
// the authored 0.15 and nothing changes at all. Clamped at 0.5 because half a
// cell either side already spans the whole band: past that the quantization
// would invert rather than soften, and what it degrades to instead is smooth
// shading, which is the correct answer for a surface whose bands can no longer
// be drawn.
fn band(ndl: f32, steps: f32) -> f32 {
  let x = ndl * steps;
  let w = clamp(fwidth(x), 0.15, 0.5);
  return min((floor(x) + smoothstep(0.5 - w, 0.5 + w, fract(x))) / steps, 1.0);
}
`,
);

/**
 * `celCloud` — the CLOUDS' shadow on the ground: the field `Sky` writes
 * (`systems/cloudShadow.ts`) and the two ways of reading it. Included by
 * `celShadow`, so every consumer of that owes its names too — they are in
 * `SHADOW_UNIFORM_NAMES` and `SHADOW_SAMPLER_NAMES` — and by `Volumetrics`,
 * which lists them itself.
 *
 * **A lookup and not a shadow map**, because a cloud is kilometres away and
 * what it hides is the SKY: the field is laid in KEY space, where a point's key
 * is where its ray toward the light crosses y = 0, so one 2D texture answers
 * for a roof and the street under it alike. See `cloudShadow.ts` for why what
 * is stored is a field rather than coverage.
 *
 * **Two fields, crossfaded**, because the ring drifts and a field rewritten on
 * a clock would step the shadow's edge forward on that clock — the "low frame
 * rate" the water's twinkle was taken out for. `Sky` writes the field for the
 * ring's NEXT position while this blends the two before it; a moving outline
 * is the zero of a moving blend, so it slides.
 *
 * **It MINS with the other shadows and never multiplies**: a wall's shadow
 * under a cloud's is the same shade as either alone, because either is enough
 * to take the key away, and `w` — how lit a point inside a cloud's shadow is —
 * is a floor at or above the maps' own darkness.
 */
register(
  "celCloud",
  `
// ---- THE CLOUDS' SHADOW (systems/cloudShadow.ts, driven by Sky) ----
// x, y: the key-space corner of the field, z: 1 / its side in metres,
// w: how LIT a point wholly inside a cloud's shadow is; 1 turns the term off.
uniform cloudShadow: vec4f;
// x, y: the light's toward vector as s.xz / s.y, so a point's key is
// posW.xz - xy * posW.y; z: the crossfade from the field in R to the one in G.
uniform cloudShadowRay: vec4f;
var cloudShadowMapSampler: sampler;
var cloudShadowMap: texture_2d<f32>;

// x: how far inside a cloud's shadow p is — the crossfaded field less its 0.5
// outline, positive inside. y: 1 over the field, falling to 0 over its last
// twentieth, so a shadow runs out at the edge of what is known rather than
// being cut off there by a straight line. Branch-free and derivative-free, so
// the air's march can call it from a loop.
fn cloudShadowAt(p: vec3f) -> vec2f {
  let key = p.xz - uniforms.cloudShadowRay.xy * p.y;
  let uv = (key - uniforms.cloudShadow.xy) * uniforms.cloudShadow.z;
  let two = textureSampleLevel(cloudShadowMap, cloudShadowMapSampler, uv, 0.0).rg;
  let field = mix(two.x, two.y, uniforms.cloudShadowRay.z) - 0.5;
  let edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  return vec2f(field, smoothstep(0.0, 0.05, edge));
}

// How lit a SURFACE is by the clouds: 1 in the open, cloudShadow.w inside a
// cloud's shadow, and the outline one pixel wide at every distance — the cel
// cut every other edge in the frame has. Branch-free, so the derivative is
// taken in whatever control flow its caller is in.
fn cloudLit(p: vec3f) -> f32 {
  let c = cloudShadowAt(p);
  let w = max(fwidth(c.x), 1e-4);
  return mix(1.0, uniforms.cloudShadow.w, smoothstep(-w, w, c.x) * c.y);
}

// The same for the AIR: a hard step, no derivative — the march integrates it.
fn cloudLitAir(p: vec3f) -> f32 {
  let c = cloudShadowAt(p);
  return mix(1.0, uniforms.cloudShadow.w, step(0.0, c.x) * c.y);
}
`,
);

/**
 * The stepped shadow lookup, and the uniforms it reads. Included by the cel,
 * grass and water fragment shaders so all three sample the SAME depth maps with
 * the SAME kernel.
 *
 * Grass and water went without this for as long as they existed, and the
 * artefact is the loudest continuity break the frame had: the key light is the
 * moon, so a cottage lays a hard shadow across the ground — and that shadow
 * stopped dead at the edge of a grass rect and at the waterline, because the
 * two surfaces standing in the same shadow were the two that could not see it.
 *
 * **THERE ARE TWO MAPS NOW AND ONE LOOKUP OVER BOTH.** The world's
 * (`ShadowSystem`) re-renders only when its window moves and carries ~150
 * static casters; the bodies' (`BodyShadows`) re-renders every frame and carries
 * soldiers and hulls as proxy boxes. `shadowTap` is spent once on each and the
 * results combined with `min` — **in LIT space, before the darkness mix**,
 * which is what makes the combination free of an ordering: either occluder is
 * enough, each map answers "lit" outside its OWN volume and ramps back to lit
 * over its own `edgeFade`, so neither boundary can darken past the other and
 * nothing has to know which map is the bigger one.
 *
 * **The darkness mix moved OUT of the tap for that**, and it is exactly
 * equivalent rather than nearly: `mix(dark, 1, x)` is affine in `x` and fixes
 * `x = 1`, so `mix(1, mix(dark, 1, S), E)` — the form this shipped with — is
 * `mix(dark, 1, mix(1, S, E))` for the single-map case. The picture is
 * unchanged on a frame with nobody in it.
 *
 * A consumer owes four uniforms (`SHADOW_UNIFORM_NAMES`) and two samplers
 * (`SHADOW_SAMPLER_NAMES`) in its own lists, and owes REGISTERING with
 * `CelMaterialFactory.registerShadowConsumer` — the factory pushes all of them,
 * and a material that is never registered samples an unbound texture.
 */
register(
  "celShadow",
  `
#include<celCloud>

// Stepped directional shadows. lightMatrix is the ShadowGenerator's
// view*projection with no [0,1] bias baked in, so the XY remap below is the
// usual uv = clip.xy*0.5+0.5.
//
// **The DEPTH is not remapped at all, and that is a WebGPU fact rather than a
// choice.** Under WebGPU engine.isNDCHalfZRange is true, so a clip-space z is
// ALREADY in [0, 1] — and DirectionalLight.getDepthMinZ/MaxZ return 0 and 1
// there, which makes Babylon's own depthValuesSM (0, 1) and its caster metric
// (position.z + 0) / 1 the raw clip z. The receiver has to compare against
// exactly that, so depth here is sc.z and the range gate is [0, 1].
//
// **This carried the GLSL form through the WebGPU migration** — (clip.z + 1)
// * 0.5, which is correct under WebGL's [-1, 1] depth — and what it cost is
// worth writing down, because the failure did not look like a shadow bug. A
// receiver at the focus plane sits at z ~ 0.51 and was compared as 0.76
// against a caster depth of 0.51, so EVERY texel inside the window failed the
// test: the depth map decided nothing, the window's edge became a hard line
// between all-shadowed and all-lit (this function is fully lit outside it), and
// what a player saw was a pool of shade travelling with them. The edge ramp
// added since would have SOFTENED that line and not removed it — it is a
// property of the boundary, and the bug was that everything inside the
// boundary was shadow. No bias papers
// over it — the error is (1 - z) / 2, half the depth range at the near plane,
// and it reaches zero only at the far one.
uniform lightMatrix: mat4x4f;
var shadowMapSampler: sampler;
var shadowMap: texture_2d<f32>;
// x = depth bias, y = darkness, z = normal offset, w = tap radius in UV
uniform shadowParams: vec4f;

// The BODIES' map and its own view*projection — systems/BodyShadows.ts. Same
// conventions as the pair above, because it is the same kind of object built by
// the same Babylon generator: raw clip z, no [0,1] remap, XY to UV.
//
// **It is a different WINDOW, so it needs its own bias and its own tap radius
// and cannot borrow either.** The radius is in UV and a UV texel is
// 1 / mapSize, which is 1/1024 here against the world's 1/2048; the bias is
// 13 cm against the world's 5 cm, over a 90 m volume against 180. Copying
// shadowParams over would have been a 2x-wide kernel at a 2x-loose bias,
// which is a soft shadow floating off its own body.
uniform bodyLightMatrix: mat4x4f;
var bodyShadowMapSampler: sampler;
var bodyShadowMap: texture_2d<f32>;
// x = depth bias, y = tap radius in UV. Darkness and the normal offset are
// NOT restated: a shadow is a shadow whichever map resolved it, and the offset
// is a property of the RECEIVER's facet rather than of either caster set.
uniform bodyShadowParams: vec4f;

// Hard two-level shadow: lit or not, nothing in between — a soft penumbra
// would fight the flat bands. The sample point is pushed off the facet along
// its normal so a flat face never tests against its own depth (acne).
//
// **The volume's own BOUNDARY is the one place that is not two-level, and it
// is not a penumbra.** Outside the ortho volume there is no depth to compare
// against, so the honest answer is fully lit — and answering it abruptly puts
// a straight line across open ground that slides along with the player, which
// is a harder artefact than any softness. The last edgeFade of the volume
// therefore ramps the whole shadow term back to 1.0. What is being faded is
// the ABSENCE of information rather than the edge of a shadow: an occluder
// still casts a hard-edged shape out there, it is just drawn weaker the
// nearer it is to falling off the map, so what the eye reads is the same
// distance haze that is about to take the geometry too. The two-level rule
// still holds everywhere a shadow is actually resolved.
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
//
// **textureSampleLevel and never textureSample**, and this function is what
// settled the rule: the fetches sit behind an early-out, so an implicit LOD
// is a sample reached through control flow WGSL cannot prove uniform, and the
// error names a function that has been correct for the life of the project.
// The map carries no mip chain, so an explicit level 0 is what was meant.
// One map's answer: how LIT this receiver is by it, 0..1, with the volume's own
// edge ramp already applied and the darkness mix deliberately NOT — see the
// header for why that has to come after the two maps are combined.
//
// **The texture and the sampler are function PARAMETERS**, which is legal WGSL
// for a handle passed straight from a module-scope declaration and is the only
// way two maps can share one kernel. Babylon's WGSL processor rewrites the
// module-scope texture and sampler DECLARATIONS into group/binding pairs and
// leaves every reference alone, so a parameter list it never matched is a
// parameter list it never touched. The alternative was a second copy of the
// tap, which is the exact failure mode this file's header exists to describe.
//
// The declaration shape is deliberately not spelled out in this comment: the
// processor's rewrite is a regex over the whole shader source, comments
// included, so a sentence that quoted one would mint a binding with nothing
// behind it — and a bind group that fails to build loses every draw silently.
//
// dir is the per-pixel rotation, unit, computed once by the caller and shared:
// the two maps have different texel grids but the same need, which is for four
// taps to stop being five contours along an edge.
fn shadowTap(
  m: mat4x4f,
  tex: texture_2d<f32>,
  smp: sampler,
  p: vec3f,
  dir: vec2f,
  bias: f32,
  radius: f32
) -> f32 {
  let sc4 = m * vec4f(p, 1.0);
  let sc = sc4.xyz / sc4.w;
  let uv = sc.xy * 0.5 + 0.5;
  // How far inside the volume this receiver is, along whichever of the three
  // axes it is closest to leaving by: 0 at a face, 0.5 at the focus. One
  // min chain rather than three gates, because the ramp below has to be the
  // same ramp on all three or the softened faces meet the hard ones at a
  // corner and the corner is the line again.
  let edge = min(
    min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)),
    min(sc.z, 1.0 - sc.z)
  );
  if (edge <= 0.0) { return 1.0; }
  let depth = sc.z - bias;

  let rot = dir * radius;
  let perp = vec2f(-rot.y, rot.x);

  let hits = step(depth, textureSampleLevel(tex, smp, uv + rot, 0.0).x)
    + step(depth, textureSampleLevel(tex, smp, uv - rot, 0.0).x)
    + step(depth, textureSampleLevel(tex, smp, uv + perp, 0.0).x)
    + step(depth, textureSampleLevel(tex, smp, uv - perp, 0.0).x);
  // Narrow smoothstep rather than a plain average: the four taps give a 0,
  // 0.25, 0.5, 0.75, 1 ladder, and this pulls the middle of it back toward a
  // decision so the edge stays an edge and only its jaggies are dissolved.
  let shade = smoothstep(0.25, 0.75, hits * 0.25);
  // Back to fully lit over the outermost band of the volume. Cubic and not
  // linear: a linear ramp is flat-shaded ground with a crease in it at each
  // end, and a crease across open sand is the artefact this exists to remove
  // rather than a milder version of it.
  return mix(1.0, shade, smoothstep(0.0, ${EDGE_FADE.toFixed(4)}, edge));
}

fn shadowVisibility(n: vec3f, posW: vec3f) -> f32 {
  // Offset once, along the receiver's own facet, and spent on both maps. It is
  // a property of the surface being lit and not of what is shading it.
  //
  // **Always TOWARD the light**, which is the facet normal on a lit face and
  // its reverse on a face turned away. Both maps record BACK faces, so a face
  // turned away from the light is its own caster's recorded surface: offset
  // along its normal it steps BEHIND itself and shades itself, which takes the
  // translucency off every awning's underside (the one term such a face is
  // lit by). Offset toward the light it tests lit against itself and shadowed
  // against anything else in front of it, which is the right answer on both
  // counts. The light's travel direction is the depth axis of its own matrix
  // (row 2), so this needs no uniform the three consumers do not already have.
  let lightTravel = vec3f(
    uniforms.lightMatrix[0][2], uniforms.lightMatrix[1][2], uniforms.lightMatrix[2][2]);
  let toward = select(1.0, -1.0, dot(n, lightTravel) > 0.0);
  let p = posW + n * (toward * uniforms.shadowParams.z);
  let a = fract(sin(dot(fragmentInputs.position.xy, vec2f(12.9898, 78.233))) * 43758.5453)
    * 6.2831853;
  let dir = vec2f(cos(a), sin(a));
  let world = shadowTap(uniforms.lightMatrix, shadowMap, shadowMapSampler, p, dir,
    uniforms.shadowParams.x, uniforms.shadowParams.w);
  let bodies = shadowTap(uniforms.bodyLightMatrix, bodyShadowMap, bodyShadowMapSampler,
    p, dir, uniforms.bodyShadowParams.x, uniforms.bodyShadowParams.y);
  // Either occluder is enough, and min is the only combination that does not
  // invent a darkness neither map claimed: multiplying two 0.15 terms is 0.0225,
  // which is a black hole where a soldier stands in a doorway's shadow.
  return mix(uniforms.shadowParams.y, 1.0, min(world, bodies));
}

// ---- THE LAMPS' SHADOWS (systems/LocalShadows.ts) ----
//
// Every shadowed point and spot light is drawn into ONE atlas of square tiles
// — six per point light (a cube, face by face), one per spot — which is how
// this reaches every shadowed lamp through a single texture binding. A tile
// holds the RADIAL distance to the nearest caster over the light's range, and
// the atlas records BACK faces, for the moon map's reason.
//
// Per slot, beside the pointPos/pointRange every consumer already declares:
//   pointSpot.xyz  the spot's axis, unit; w its outer cosine, or -2 for a
//                  point light that shines every way
//   pointShade.x   the spot's inner cosine
//   pointShade.y   the first tile of the STATIC layer, or -1
//   pointShade.z   the first tile of the DYNAMIC layer, or -1
// Both layers at -1 is a light the atlas is not shadowing this frame, and the
// caller falls back to whatever it had (the cel shader's volume visibility).
uniform pointSpot: array<vec4f, ${MAX_LOCAL_SLOTS}>;
uniform pointShade: array<vec4f, ${MAX_LOCAL_SLOTS}>;
// x = tiles per atlas row, y = one tile's side in UV, z = one texel in UV,
// w = taps (1 or 4)
uniform localAtlas: vec4f;
// x = receiver bias (m), y = facet offset (m)
uniform localParams: vec4f;
var localAtlasMapSampler: sampler;
var localAtlasMap: texture_2d<f32>;

// The up vector a face's frame is built from — the same rule
// LocalShadows.faceFrame spends on the CPU side, which is the one thing the
// two halves of this cannot disagree about: straight up, unless the face looks
// straight up or down, where it is +Z.
fn localUp(f: vec3f) -> vec3f {
  return select(vec3f(0.0, 1.0, 0.0), vec3f(0.0, 0.0, 1.0), abs(f.y) > 0.99);
}

// How lit a receiver at d (world offset from the light) is by one LAYER of
// one light, 0..1. rel is the receiver's radial distance over the light's
// range, bias already taken off.
fn localLayer(base: f32, d: vec3f, rel: f32, spot: vec4f) -> f32 {
  var f: vec3f;
  var face = 0.0;
  var tanHalf = 1.0;
  if (spot.w > -1.5) {
    // A spot is one face down its own axis, as wide as its outer cone.
    f = spot.xyz;
    let c = clamp(spot.w, 0.2, 0.9999);
    tanHalf = sqrt(1.0 - c * c) / c;
  } else {
    // The cube face the receiver is on, in LocalShadows' order: +X -X +Y -Y +Z -Z.
    let a = abs(d);
    if (a.x >= a.y && a.x >= a.z) {
      f = vec3f(sign(d.x), 0.0, 0.0);
      face = select(1.0, 0.0, d.x > 0.0);
    } else if (a.y >= a.z) {
      f = vec3f(0.0, sign(d.y), 0.0);
      face = select(3.0, 2.0, d.y > 0.0);
    } else {
      f = vec3f(0.0, 0.0, sign(d.z));
      face = select(5.0, 4.0, d.z > 0.0);
    }
  }
  let r = normalize(cross(localUp(f), f));
  let u = cross(f, r);
  let w = dot(d, f);
  if (w <= 1e-4) { return 1.0; }
  let st = vec2f(dot(d, r), dot(d, u)) / (w * tanHalf);
  // Outside a spot's square is outside its cone as well; the cone term has
  // already taken the light away there, so lit is the honest answer.
  if (abs(st.x) > 1.0 || abs(st.y) > 1.0) { return 1.0; }

  let tile = base + face;
  let row = floor(tile / uniforms.localAtlas.x);
  let col = tile - row * uniforms.localAtlas.x;
  let side = uniforms.localAtlas.y;
  let texel = uniforms.localAtlas.z;
  let origin = vec2f(col, row) * side;
  // Clamped a texel inside the tile, so no tap reads its neighbour's face.
  let uv = clamp(origin + (st * 0.5 + 0.5) * side,
    origin + vec2f(texel), origin + vec2f(side - texel));
  if (uniforms.localAtlas.w < 2.0) {
    return step(rel, textureSampleLevel(localAtlasMap, localAtlasMapSampler, uv, 0.0).x);
  }
  let h = texel * 0.5;
  let hits = step(rel, textureSampleLevel(localAtlasMap, localAtlasMapSampler, uv + vec2f(h, h), 0.0).x)
    + step(rel, textureSampleLevel(localAtlasMap, localAtlasMapSampler, uv + vec2f(-h, h), 0.0).x)
    + step(rel, textureSampleLevel(localAtlasMap, localAtlasMapSampler, uv + vec2f(h, -h), 0.0).x)
    + step(rel, textureSampleLevel(localAtlasMap, localAtlasMapSampler, uv + vec2f(-h, -h), 0.0).x);
  // The moon's ladder-to-decision curve, for its reason.
  return smoothstep(0.25, 0.75, hits * 0.25);
}

// ---- THE LIGHTNING'S KEY (ShadowSystem.flash, LightningStrikes) ----
//
// A second directional light over a depth map of its own, rendered ONCE when a
// strike starts and aimed along it — so the moon's maps never move. flashColor
// is already times the flash's envelope and is black between strikes, which is
// what the early-out below keys on. The map records back faces and is read
// with the moon's kernel; a strike's shadow is fully dark, because the flash
// is the light being taken away and nothing else is being dimmed.
uniform flashDir: vec3f;
uniform flashColor: vec3f;
uniform flashLightMatrix: mat4x4f;
// x = depth bias, y = tap radius in UV
uniform flashParams: vec4f;
var flashMapSampler: sampler;
var flashMap: texture_2d<f32>;

// How lit a receiver is by the flash, 0..1. The offset rule is
// shadowVisibility's: along the TRUE facet, always toward the light.
fn flashVisibility(n: vec3f, posW: vec3f) -> f32 {
  let toward = select(1.0, -1.0, dot(n, uniforms.flashDir) > 0.0);
  let p = posW + n * (toward * uniforms.shadowParams.z);
  let a = fract(sin(dot(fragmentInputs.position.xy, vec2f(12.9898, 78.233))) * 43758.5453)
    * 6.2831853;
  return shadowTap(uniforms.flashLightMatrix, flashMap, flashMapSampler, p,
    vec2f(cos(a), sin(a)), uniforms.flashParams.x, uniforms.flashParams.y);
}

// The flash's whole contribution: banded like the key, cut by its own map.
// n is the normal being LIT, facet the true one the shadow offsets along.
fn flashLight(n: vec3f, facet: vec3f, posW: vec3f) -> vec3f {
  if (max(uniforms.flashColor.r, max(uniforms.flashColor.g, uniforms.flashColor.b)) <= 0.0) {
    return vec3f(0.0);
  }
  let ndl = clamp(dot(n, -uniforms.flashDir), 0.0, 1.0);
  return uniforms.flashColor * band(ndl, 4.0) * flashVisibility(facet, posW);
}

// One slot's cone (x, 0..1) and its shadow (y, 0..1 — or -1 where the atlas
// has no answer for this light and the caller keeps its own).
//
// The normal is the one to OFFSET along, the true facet's, for
// shadowVisibility's reason, and the offset is always TOWARD the light, for
// the same one.
fn pointLocal(i: i32, posW: vec3f, n: vec3f) -> vec2f {
  let spot = uniforms.pointSpot[i];
  let shade = uniforms.pointShade[i];
  let toP = posW - uniforms.pointPos[i];
  var cone = 1.0;
  if (spot.w > -1.5) {
    let c = dot(toP / max(length(toP), 1e-4), spot.xyz);
    cone = smoothstep(spot.w, max(shade.x, spot.w + 1e-4), c);
  }
  if (shade.y < 0.0 && shade.z < 0.0) { return vec2f(cone, -1.0); }
  let toward = select(-1.0, 1.0, dot(n, toP) < 0.0);
  let d = toP + n * (toward * uniforms.localParams.y);
  let rel = (length(d) - uniforms.localParams.x) / max(uniforms.pointRange[i], 1e-3);
  var lit = 1.0;
  if (shade.y >= 0.0) { lit = min(lit, localLayer(shade.y, d, rel, spot)); }
  if (shade.z >= 0.0) { lit = min(lit, localLayer(shade.z, d, rel, spot)); }
  return vec2f(cone, lit);
}
`,
);

/**
 * `CONFIG.gi.edgeFade`, as a literal for `celGi` — the same reasoning as
 * `EDGE_FADE` above: it never varies, so it costs no binding.
 */
const GI_EDGE_FADE = Math.min(Math.max(CONFIG.gi.edgeFade, 1e-3), 0.95);

/**
 * THE IRRADIANCE VOLUME, as the cel fragment reads it — `systems/GiVolume.ts`
 * owns the textures, the trace and every uniform named here.
 *
 * **Seven textures and five uniforms, and a consumer owes all of them**:
 * `GI_UNIFORM_NAMES` and `GI_SAMPLER_NAMES` in `CelShader.ts`, pushed onto every
 * cel material by `CelMaterialFactory` from the moment it exists. `GiVolume` is
 * constructed before the first material is, and stands a real texture up on
 * every one of the seven even when the setting is off, for the reason
 * `BodyShadows` does: a declared sampler with nothing behind it is a bind group
 * that fails to build and every draw using it lost.
 *
 * **The volume is a WINDOW that scrolls with the eye, addressed TOROIDALLY**:
 * a probe column at world index `c` lives in texel `c mod columns`, and the
 * sampler REPEATS on the two horizontal axes, so the hardware's own trilinear
 * filter is correct across the seam with no remapping here at all. The only
 * thing that is not is the pair of columns either side of the window's own
 * edge — the newest and the oldest — which is why the outermost `edgeFade` of
 * the window ramps back to the flat ambient before it can be read.
 *
 * **Its layers follow the GROUND**: layer `k` of a column stands `(k + 0.5) *
 * layerHeight` above that column's floor, and the floor is carried in the
 * irradiance texture's alpha (relative to `giWindow.w`, which keeps it inside
 * half-float precision on a volcano). So the height lookup is one fetch before
 * the two that read the light.
 *
 * **What is stored is PREMULTIPLIED by each probe's validity** (`giDir.w`: 1
 * for a probe that traced from open air, 0 for one buried in a wall, or one not
 * yet traced for the column it now stands for). Dividing by the filtered weight
 * averages only the valid probes among the eight, which is what keeps a
 * buried probe from printing a dark halo on the face of the wall it is buried
 * in — without a second fetch or a validity mask.
 *
 * **The lookup returns IRRADIANCE, and the caller bands it**: what the frame
 * holds is the cel shader's own units (a colour times a light), so the traced
 * term can replace the flat ambient and the sky fill in place.
 */
register(
  "celGi",
  `
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
uniform giSlotChannel: array<f32, ${16}>;

// Where a point reads the volume, and how much it may trust what it reads
// there: xyz is the texture coordinate, w the window's own edge fade times the
// fade off the top of the stack. w = 0 means "outside, use the flat path".
fn giCoord(p: vec3f) -> vec4f {
  if (uniforms.giShade.w < 0.5) {
    return vec4f(0.0);
  }
  let spacing = 1.0 / uniforms.giGrid.x;
  let d = abs(p.xz - vec2f(uniforms.giWindow.x, uniforms.giWindow.z));
  let far = max(d.x, d.y);
  let half = uniforms.giWindow.y;
  var w = 1.0 - smoothstep(half * (1.0 - ${GI_EDGE_FADE.toFixed(4)}), half - spacing, far);
  if (w <= 0.0) {
    return vec4f(0.0);
  }
  let cols = uniforms.giGrid.y;
  let layers = uniforms.giGrid.z;
  let u = (p.x * uniforms.giGrid.x + 0.5) / cols;
  let r = (p.z * uniforms.giGrid.x + 0.5) / cols;
  let floorY = textureSampleLevel(giIrr, giIrrSampler, vec3f(u, 0.5 / layers, r), 0.0).a
    + uniforms.giWindow.w;
  let v = (p.y - floorY) * uniforms.giGrid.w;
  // Off the top of the stack the column says nothing, so the flat path takes
  // over across one layer — and under the floor, which only a probe offset
  // along a normal pointing down can reach, the bottom layer answers.
  w *= 1.0 - smoothstep(1.0, 1.0 + 1.0 / layers, v);
  return vec4f(u, clamp(v, 0.0, 1.0), r, w);
}

// The traced irradiance arriving at a surface facing n, and how much of it to
// use. Evaluated from order-1 spherical harmonics: the colour is carried in the
// constant band, the DIRECTION in the linear band of luminance alone, which is
// all a banded surface can show and half the storage of three linear bands.
fn giIrradiance(c: vec4f, n: vec3f) -> vec4f {
  if (c.w <= 0.0) {
    return vec4f(0.0);
  }
  let t0 = textureSampleLevel(giIrr, giIrrSampler, c.xyz, 0.0);
  let t1 = textureSampleLevel(giDir, giDirSampler, c.xyz, 0.0);
  let valid = t1.w;
  if (valid < 0.02) {
    return vec4f(0.0);
  }
  let c0 = t0.rgb / valid;
  let c1 = t1.xyz / valid;
  // The cosine lobe's own convolution of the two bands: pi * Y0 and
  // 2pi/3 * Y1, folded into one constant each.
  let e0 = c0 * 0.886227;
  let lum0 = dot(e0, vec3f(0.2126, 0.7152, 0.0722));
  let lumN = lum0 + 1.023327 * dot(c1, n);
  let ratio = select(0.0, clamp(lumN / lum0, 0.0, 2.5), lum0 > 1e-5);
  return vec4f(e0 * ratio, c.w * clamp(valid * 3.0, 0.0, 1.0));
}

// The sixteen visibility channels from here, one per light holding a slot —
// giSlotChannel says which is whose — and 1 wherever the volume has nothing to
// say, which is the old rule (a light reaches everything in its range). Four
// fetches ONCE per pixel, before the light loop, rather than one per light
// inside it.
fn giPointVis(c: vec4f) -> array<vec4f, 4> {
  var v = array<vec4f, 4>(vec4f(1.0), vec4f(1.0), vec4f(1.0), vec4f(1.0));
  if (c.w <= 0.0 || uniforms.giBand.w < 0.5) {
    return v;
  }
  let one = vec4f(1.0);
  v[0] = mix(one, textureSampleLevel(giVis0, giVis0Sampler, c.xyz, 0.0), c.w);
  v[1] = mix(one, textureSampleLevel(giVis1, giVis1Sampler, c.xyz, 0.0), c.w);
  v[2] = mix(one, textureSampleLevel(giVis2, giVis2Sampler, c.xyz, 0.0), c.w);
  v[3] = mix(one, textureSampleLevel(giVis3, giVis3Sampler, c.xyz, 0.0), c.w);
  return v;
}

// THE SUN PAST THE SHADOW MAP. The world's depth map covers one window and
// answers fully lit outside it (celShadow), which on a big map is a line
// across open ground past which no building casts anything. Every probe also
// traced whether IT can see the sun, so where the map has run out and the
// volume has not, the shadow is the volume's: coarse — one answer per probe —
// but cut hard with a narrow step, so what reads at that range is a shadow's
// shape and not a lattice. Blended over the map's own edge ramp, so the two
// never meet at a line.
fn giFarShadow(p: vec3f, c: vec4f, mapShadow: f32) -> f32 {
  if (c.w <= 0.0) {
    return mapShadow;
  }
  let sc4 = uniforms.lightMatrix * vec4f(p, 1.0);
  let sc = sc4.xyz / sc4.w;
  let uv = sc.xy * 0.5 + 0.5;
  let edge = min(
    min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)),
    min(sc.z, 1.0 - sc.z));
  let known = smoothstep(0.0, ${EDGE_FADE.toFixed(4)}, edge);
  if (known >= 1.0) {
    return mapShadow;
  }
  let sun = textureSampleLevel(giAux, giAuxSampler, c.xyz, 0.0).r;
  let far = mix(uniforms.shadowParams.y, 1.0, smoothstep(0.4, 0.6, sun));
  return mix(mix(1.0, far, c.w), mapShadow, known);
}

// How much of the SKY a point sees, off the probes' own sky test (aux green)
// — what a lightning flash's fill reaches. 1 where the volume has no answer,
// so with bounce light off a flash lights everything it would have without
// walls, which is the old flat sky fill's rule too.
fn giSkySeen(c: vec4f) -> f32 {
  if (c.w <= 0.0) {
    return 1.0;
  }
  return mix(1.0, textureSampleLevel(giAux, giAuxSampler, c.xyz, 0.0).g, c.w);
}

// A band whose ceiling is not 1: the indirect term is cut into steps of the
// reference luminance and may climb past it (a sunlit wall's bounce), up to
// giExtra.x references. The edge is the shared band's fwidth-footed one.
fn giBandOpen(x: f32, steps: f32) -> f32 {
  let y = x * steps;
  let w = clamp(fwidth(y), 0.15, 0.5);
  return min((floor(y) + smoothstep(0.5 - w, 0.5 + w, fract(y))) / steps, uniforms.giExtra.x);
}
`,
);

/**
 * The reflection probe a mirror samples, and the parallax correction that
 * stops it reading as a decal.
 *
 * **Shared verbatim by the two surfaces in the game that hold up a mirror** —
 * the glazing (`CEL_GLASS`) and the water — because both sample cubes
 * `ReflectionSystem` bakes the same way, and both subtleties in the function
 * are exactly the kind that get fixed in one copy and left standing in the
 * other. A material that includes this owes `PROBE_UNIFORM_NAMES` and
 * `PROBE_SAMPLER_NAMES` in its own lists.
 */
register(
  "celProbe",
  `
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

// The Y flip, which every sampler of one of these cubes owes.
//
// A cube face is stored top-down while a framebuffer is bottom-up, so a cube
// RENDERED into comes out mirrored about the horizon. Babylon says as much by
// giving a cube render target INVCUBIC_MODE, and its own reflection path
// spends that define on this one line. Without it a mirror returns the
// pavement where the sky should be, which reads as glass that is simply too
// dark rather than as anything upside down — the mistake is invisible until
// it is looked for.
fn probeCubeDir(dir: vec3f) -> vec3f {
  return vec3f(dir.x, -dir.y, dir.z);
}
`,
);

/**
 * The parallax half of a probe: the box a mirrored ray leaves the world
 * through, and the re-aim that turns an infinite-distance cube into one with
 * a place in it.
 *
 * **Separate from `celProbe` because the two mirrors want opposite things.** A
 * pane is vertical and a player walks ALONG it, so a decal that sits still as
 * you pass is exactly what the correction exists to stop. Water is horizontal
 * and its probe stands ON it, so what its rays can reach is the far surround —
 * far enough that an infinite cube is nearly right, and correcting it against
 * a map-sized box collapses every pixel onto the same far exit point. So the
 * glazing includes this and the water does not, and neither carries the
 * other's uniforms.
 */
register(
  "celProbeBox",
  `
// The box the mirrored ray is parallax-corrected against — the map's own
// extent, floor to roofline.
uniform reflectBoxMin: vec3f;
uniform reflectBoxMax: vec3f;

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

fn reflectBoxDir(dir: vec3f, pos: vec3f) -> vec3f {
  var sgn = sign(dir);
  sgn += 1.0 - abs(sgn);
  let inv = 1.0 / (sgn * max(abs(dir), vec3f(1e-5)));
  let tHi = (uniforms.reflectBoxMax - pos) * inv;
  let tLo = (uniforms.reflectBoxMin - pos) * inv;
  // The far intersection on each axis; the nearest of the three is the face
  // the ray actually leaves through. max() picks the far one per axis because
  // one of the pair is behind the ray whenever pos is inside the box.
  let t = max(tHi, tLo);
  let hit = min(min(t.x, t.y), t.z);
  let aimed = (pos + dir * max(hit, 0.0)) - uniforms.reflectProbe.xyz;
  return probeCubeDir(aimed);
}
`,
);

/**
 * Triangular-PDF dither at one LSB, keyed on the pixel and NOT on time.
 *
 * **The source and the argument are both in `Dither.ts`**, and this is the one
 * entry in the table that reaches for its text instead of stating it. Why it
 * exists at all, why it is not in the grade, why one LSB rather than half and
 * the run-length measurement that settled it are sixty lines against a
 * six-line function, and a reader arriving at either wants the other. The four
 * entries above are the opposite shape — a paragraph over a paragraph — so
 * they state their own.
 */
register("celDither", DITHER_WGSL);

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
 * of `@babylonjs/core` 9.19.1**, minus the branches nothing in this game
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
